-- ============================================================================
-- 20260763_noshow_close_end.sql
-- C&R Space — 노쇼 15분 종결(DB 구현) + 노쇼 해제 RPC 재작성
--
-- 사고 [2026-09-09 11:07 KST] 어드민 '노쇼 해제' 전면 불능
--   Postgres 로그: conflicting key value violates exclusion constraint "bookings_no_overlap"
--   · admin_resolve_noshow 가 auto_cancelled=false 로 되돌리면 행이 exclusion 제약
--     (WHERE status∈confirmed/pending ∧ auto_cancelled=false ∧ early_ended=false) 안으로
--     재진입 → 노쇼 직후 같은 슬롯을 타인이 재예약했으면 23P01 충돌.
--   · 실측: 노쇼 419건 중 120건(29%)이 해제 시 충돌. noshow_admin_actions 에 resolve 성공
--     이력 0건 — 운영에서 한 번도 성공한 적 없음. 프론트 에러맵이 23P01 을 일반 폴백
--     문구로 삼켜 원인이 한 달간 은폐.
--   · 8/5 설계가 트리거 5종만 검토하고 exclusion 제약을 빠뜨린 결함.
--
-- 핵심 모델 (고지 확정)
--   노쇼 판정된 예약은 [start_at, start_at+15분) 으로 **종결**된다 — 슬롯은 그 뒤로 비어
--   타인이 예약할 수 있다. 노쇼 해제는 종결된 15분 블록의 상태만 노쇼→'사용 완료' 로 바꾸며
--   end_at 은 절대 원본으로 되돌리지 않는다. (기존에는 고지가 DB 에서 end_at 을 수동 변경해
--   같은 효과를 내 왔음 — 이번에 DB 규칙으로 승격)
--
-- 구현
--   1) bookings.noshow_closed_at timestamptz — 노쇼 종결(강제 종료) 시각. 해제 후에도 유지되어
--      '한 번 노쇼로 종결됐던 예약' 을 영구 식별. original_end_at(조기반납과 공용, 이미 존재)
--      에 원본 종료시각 보존.
--   2) BEFORE UPDATE 트리거 trg_noshow_close_end — 노쇼 전환(cancelled_by='system' ∧
--      auto_cancelled true 로 바뀌는 순간) 시 end_at := LEAST(end_at, start_at+15분),
--      original_end_at := 원본, noshow_closed_at := 종결 시각.
--      · RPC mark_noshow / cron auto-cancel-bookings(service_role 직접 UPDATE) / 수동 SQL
--        모든 경로를 한 곳에서 커버.
--      · trg_block_premature_noshow 가 RETURN NULL 하면 이 변경도 함께 무효(부분 반영 없음).
--   3) admin_resolve_noshow 재작성
--      · 목표 상태(8/5 그대로): checked_in=true, auto_cancelled=false, cancelled_by=NULL
--      · end_at 불변. 단, 종결 전 마킹된 레거시 노쇼(noshow_closed_at IS NULL)는 해제 시점에
--        같은 UPDATE 안에서 15분 종결을 함께 적용 → 과거 데이터 백필 불필요.
--      · 사전 검사: 종결 구간과 겹치는 살아있는 예약이 있으면 SLOT_OCCUPIED:{conflict_id}.
--        exclusion_violation 도 같은 코드로 변환(동시 INSERT 레이스 대비 이중).
--      · 제재 자동 해제·재평가(20260743) 로직 유지.
--
-- 무변경: 노쇼 확정룰(status='confirmed' ∧ cancelled_by='system' ∧ checked_in=false),
--         mark_noshow, admin_delete_noshow_booking, evaluate_noshow_penalty, 통계 RPC.
-- 과거 데이터 마이그레이션: 없음 (고지 결정). 멱등: 재실행 안전.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) 노쇼 종결 슬롯 길이(분) — 단일 상수 (noshow_grace_minutes 패턴)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.noshow_close_slot_minutes()
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$ SELECT 15 $$;

-- ----------------------------------------------------------------------------
-- 1) 컬럼: 노쇼 종결 시각
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS noshow_closed_at timestamptz;

COMMENT ON COLUMN public.bookings.noshow_closed_at IS
  '노쇼 종결(강제 종료) 시각 = start_at + noshow_close_slot_minutes(). 노쇼 전환 시 트리거가 기록, '
  '해제(사용완료 전환) 후에도 유지되어 노쇼 이력 식별. 원본 종료시각은 original_end_at.';

-- ----------------------------------------------------------------------------
-- 2) 트리거: 노쇼 전환 시 15분 종결
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.noshow_close_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_close timestamptz;
BEGIN
  -- WHEN 절(노쇼 전환)에서 이미 걸렸지만 함수 단독 호출 방어
  IF NOT (NEW.cancelled_by = 'system'
          AND NEW.auto_cancelled IS TRUE
          AND OLD.auto_cancelled IS DISTINCT FROM true) THEN
    RETURN NEW;
  END IF;

  v_close := LEAST(OLD.end_at,
                   NEW.start_at + make_interval(mins => public.noshow_close_slot_minutes()));

  NEW.original_end_at  := COALESCE(OLD.original_end_at, OLD.end_at);
  NEW.end_at           := v_close;
  NEW.noshow_closed_at := v_close;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_noshow_close_end ON public.bookings;
CREATE TRIGGER trg_noshow_close_end
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (NEW.cancelled_by = 'system'
        AND NEW.auto_cancelled IS TRUE
        AND OLD.auto_cancelled IS DISTINCT FROM true)
  EXECUTE FUNCTION public.noshow_close_end();

-- ----------------------------------------------------------------------------
-- 3) 노쇼 해제 RPC 재작성
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_noshow(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row      public.bookings%ROWTYPE;
  v_snap     jsonb;
  v_close    timestamptz;
  v_conflict text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('booking') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  SELECT * INTO v_row FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;

  -- ⚠ 노쇼 확정룰 1:1 — utils/noshow.ts isNoshow 와 정확히 동일해야 한다 (절대 변경 금지)
  IF NOT (v_row.status = 'confirmed'
      AND v_row.cancelled_by = 'system'
      AND v_row.checked_in = false) THEN
    RAISE EXCEPTION 'NOT_NOSHOW';
  END IF;

  -- 종결 구간: 이미 종결된 행은 end_at 그대로, 레거시(종결 전 마킹) 행은 여기서 15분 종결
  v_close := COALESCE(v_row.noshow_closed_at,
                      LEAST(v_row.end_at,
                            v_row.start_at + make_interval(mins => public.noshow_close_slot_minutes())));

  -- 사전 검사: 종결 구간과 겹치는 살아있는 예약(= exclusion 제약 도메인)이 있으면 명시 실패
  SELECT o.id INTO v_conflict
    FROM public.bookings o
   WHERE o.room_id = v_row.room_id
     AND o.id     <> v_row.id
     AND o.status IN ('confirmed', 'pending')
     AND o.auto_cancelled = false
     AND o.early_ended    = false
     AND tstzrange(o.start_at, o.end_at) && tstzrange(v_row.start_at, v_close)
   LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'SLOT_OCCUPIED:%', v_conflict;
  END IF;

  v_snap := to_jsonb(v_row);

  BEGIN
    UPDATE public.bookings
       SET checked_in           = true,          -- 재노쇼 원천 차단 + '사용완료' 라벨
           auto_cancelled       = false,
           cancelled_by         = NULL,
           cancelled_by_user_id = NULL,
           -- 종결 상태 유지(이미 종결) / 레거시 행은 이 시점에 종결 적용. end_at 원본 복원 금지.
           original_end_at      = COALESCE(original_end_at, end_at),
           end_at               = v_close,
           noshow_closed_at     = COALESCE(noshow_closed_at, v_close)
     WHERE id = p_booking_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      -- 사전 검사 이후 끼어든 동시 INSERT — 같은 코드로 프론트에 전달
      RAISE EXCEPTION 'SLOT_OCCUPIED:RACE';
  END;

  INSERT INTO public.noshow_admin_actions (booking_id, action, booking_snapshot, actor)
  VALUES (p_booking_id, 'resolve', v_snap, auth.uid());

  -- ← [2026-08-10 이용제재] 근거가 무너진 제재 자동 해제 + 재평가 (20260743 헤더 ④⑤)
  UPDATE public.noshow_penalties
     SET revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = '근거 노쇼 해제(admin_resolve_noshow: ' || p_booking_id || ') — 자동 해제'
   WHERE revoked_at IS NULL AND p_booking_id = ANY(counted_booking_ids);
  PERFORM public.evaluate_noshow_penalty(v_row.user_id);

  RETURN jsonb_build_object('ok', true, 'id', p_booking_id, 'title', v_row.title,
                            'closed_end_at', v_close);
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_noshow(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_resolve_noshow(text) TO authenticated;

COMMIT;

-- ── 배포 후 확인 (읽기 전용) ─────────────────────────────────────────────
-- SELECT EXISTS(SELECT 1 FROM information_schema.columns
--               WHERE table_name='bookings' AND column_name='noshow_closed_at')           AS col_ok,
--        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_noshow_close_end')            AS trg_ok,
--        (SELECT prosrc ILIKE '%SLOT_OCCUPIED%' FROM pg_proc WHERE proname='admin_resolve_noshow') AS rpc_ok,
--        public.noshow_close_slot_minutes()                                                AS slot_min;
