-- ============================================================================
-- 20260743_noshow_penalty.sql
-- 노쇼 이용 제재 — "8월부터, 노쇼 최초 발생일로부터 1개월 이내 노쇼 3회 누적 시
--                  1주일(7일) 동안 예약 생성 불가"
--
-- ✅ 변경 이력
--  - [2026-08-10] 신규 — 고지 지시: 2026-08-01 시행. 노쇼 관리(20260740)와 짝.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 정책 해석 (앵커-윈도우 모델) — 확정 룰
-- ═══════════════════════════════════════════════════════════════════════════
--   · 노쇼 판정 = 확정룰 그대로: status='confirmed' AND cancelled_by='system'
--     AND checked_in=false (utils/noshow.ts isNoshow 1:1 — 절대 변경 금지)
--   · 발생일 = 해당 예약의 start_at (마킹 시각이 아님 — cron 지연과 무관하게 결정적)
--   · 대상 = start_at >= 2026-08-01 00:00 KST 인 노쇼만 (7월 이전 소급 없음)
--   · 앵커 = (직전 사이클 종료 후) 첫 노쇼의 start_at. 윈도우 = [앵커, 앵커+1개월)
--   · 윈도우 안에서 3번째 노쇼 발생 → 제재 성립, 사이클 종료. 다음 노쇼가 새 앵커.
--   · 윈도우 안에 3회 미달 → 윈도우 밖 첫 노쇼가 새 앵커 (이월 없음)
--   · 제재 기간 = 3번째 노쇼의 start_at 부터 7일 (결정적 — 평가가 늦어도 종료일 불변.
--     이미 지난 사이클을 재평가해 ends_at<=now() 면 생성 생략)
--   · 제재 중 = 신규 예약 생성(INSERT) 차단. 이미 잡아둔 미래 예약은 유지(취소 안 함).
--     대리 예약도 차단 — 필요 시 관리자가 제재를 해제하는 것이 정도(도서 제재와 동일 원칙)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 왜 이 구조인가
-- ═══════════════════════════════════════════════════════════════════════════
-- ① 제재는 테이블 이력으로 남긴다 (book_penalties 20260725 원칙 동일)
--    profiles 컬럼 하나로 두면 왜/몇 번째/누가 풀었는지 추적 불가.
--    counted_booking_ids(근거 3건)를 저장해야 노쇼 해제/삭제 시 정합성 유지 가능.
--
-- ② 감지 = bookings AFTER UPDATE 트리거
--    노쇼 확정 경로가 2개(프론트 markNoshow 직접 UPDATE + cron auto-cancel-bookings)
--    라서 어느 한쪽에 로직을 두면 다른 경로가 샌다. DB 트리거가 유일한 단일 지점.
--
-- ③ 차단 = bookings BEFORE INSERT 트리거 (프론트 검사만으로는 임시방편)
--    insertBooking 은 PostgREST 직접 INSERT(RLS with_check = authenticated 뿐)라
--    클라이언트 검사만 두면 devtools 로 우회 가능. 20260735 재직 가드와 동일하게
--    DB 가 최종 강제. 프론트는 에러코드 매핑(한글 토스트)만 담당.
--
-- ④ 판정은 항상 "살아있는 노쇼 행"에서 재계산 (evaluate_noshow_penalty)
--    관리자가 노쇼를 해제/삭제하면 그 행은 더 이상 노쇼가 아니므로
--    재계산 결과가 자동으로 달라진다. 이미 발급된 제재는 counted 에 그 예약이
--    포함돼 있으면 자동 해제(revoke) 후 재평가 — 근거가 무너진 제재가
--    좀비로 남지 않는다. (admin_resolve_noshow / admin_delete_noshow_booking 갱신)
--
-- ⑤ 중복 발급 방지 = triggered_booking_id UNIQUE
--    같은 "3번째 노쇼"로는 한 번만 발급. 관리자가 수동 해제한 제재를
--    재평가가 되살리지 않는다(동일 근거면 skip). 근거 구성이 바뀌면
--    triggered id 도 바뀌므로 정당한 신규 발급은 막히지 않는다.
--
-- 배포 안전성: 기존 RPC 는 CREATE OR REPLACE (시그니처 동일 — DROP 불필요),
--   구 프론트는 NOSHOW_PENALTY_BLOCKED 를 몰라도 일반 오류 문구로 표시됨.
--   프론트보다 먼저 배포해도 화면이 깨지지 않는다. 멱등 — 재실행 안전.
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) 제재 이력 테이블
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.noshow_penalties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,               -- bookings.user_id (FK 없음 — bookings 관례 동일)
  user_email           text,                        -- 스냅샷 — 퇴사자 표시 폴백용
  user_name            text,                        -- 스냅샷 — 퇴사자 표시 폴백용

  anchor_at            timestamptz NOT NULL,        -- 사이클 첫 노쇼 start_at (1개월 윈도우 기점)
  counted_booking_ids  text[]      NOT NULL,        -- 근거 노쇼 3건 (bookings.id, text)
  triggered_booking_id text        NOT NULL,        -- 3번째 노쇼 — 중복 발급 방지 키
  starts_at            timestamptz NOT NULL,        -- 3번째 노쇼 start_at
  ends_at              timestamptz NOT NULL,        -- starts_at + 7일

  -- 해제 이력 (관리자 수동 해제 + 근거 노쇼 해제/삭제 시 자동 해제)
  revoked_at           timestamptz,
  revoked_by           uuid,
  revoked_reason       text,

  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT noshow_penalties_trigger_unique UNIQUE (triggered_booking_id),
  CONSTRAINT noshow_penalties_revoke_pair CHECK (
    (revoked_at IS NULL     AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.noshow_penalties IS
  '[2026-08-10] 노쇼 이용 제재 이력 — 1개월 내 3회 → 7일 예약 생성 차단. '
  '근거 3건(counted_booking_ids)을 보존해 노쇼 해제/삭제 시 정합성을 유지한다.';
COMMENT ON COLUMN public.noshow_penalties.starts_at IS
  '3번째 노쇼의 start_at — 평가 지연과 무관하게 결정적. ends_at = starts_at + 7일.';

-- 차단 판정이 예약 생성마다 도는 경로 — 유효 제재만 훑는 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_noshow_penalties_active
  ON public.noshow_penalties (user_id, ends_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_noshow_penalties_user_created
  ON public.noshow_penalties (user_id, created_at DESC);

-- 감지 트리거의 재계산 쿼리 경로 — 사용자별 노쇼를 start_at 순으로 훑는다
CREATE INDEX IF NOT EXISTS idx_bookings_noshow_by_user
  ON public.bookings (user_id, start_at)
  WHERE status = 'confirmed' AND cancelled_by = 'system' AND checked_in = false;

-- ════════════════════════════════════════════════════════════════════════
-- 2) RLS — 본인 것 + 예약 관리 권한자만 조회. 쓰기 정책 없음(트리거/RPC 전용)
--    직접 쓰기를 열면 본인이 자기 제재를 지울 수 있다 (book_penalties 원칙 동일)
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.noshow_penalties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS noshow_penalties_select ON public.noshow_penalties;
CREATE POLICY noshow_penalties_select ON public.noshow_penalties
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_role('booking'));

GRANT SELECT ON public.noshow_penalties TO authenticated;
GRANT ALL    ON public.noshow_penalties TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 3) 평가 함수 — 살아있는 노쇼 행으로 앵커-윈도우 재계산, 필요 시 제재 생성
--
--    호출 지점: ① 노쇼 확정 트리거 ② 노쇼 해제/삭제 RPC(정합성 재평가)
--              ③ 마이그레이션 말미 1회 백필(8/1 이후 기존 노쇼 반영)
--    반환: 새로 생성한 제재 id (생성 없으면 NULL)
--    SECURITY DEFINER: 트리거가 일반 사용자 UPDATE 문맥에서 실행돼도
--      noshow_penalties 쓰기(RLS 정책 없음)가 가능해야 하기 때문.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.evaluate_noshow_penalty(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- 정책 상수 — 변경 시 프론트 문구(utils/noshowPenalty.ts)와 함께 개정할 것
  c_policy_start constant timestamptz := timestamptz '2026-08-01 00:00:00+09'; -- 시행일 (KST)
  c_window       constant interval    := interval '1 month';                   -- 누적 윈도우
  c_strikes      constant int         := 3;                                    -- 제재 발동 횟수
  c_penalty      constant interval    := interval '7 days';                    -- 예약 불가 기간

  r          record;
  v_anchor   timestamptz := NULL;
  v_cnt      int         := 0;
  v_ids      text[]      := '{}';
  -- 마지막(가장 최신) 성립 사이클 — 발급 후보
  v_trig_id  text        := NULL;
  v_trig_at  timestamptz := NULL;
  v_c_anchor timestamptz := NULL;
  v_c_ids    text[]      := NULL;
  v_new_id   uuid        := NULL;
  v_email    text;
  v_name     text;
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;

  -- 앵커-윈도우 워크 — 노쇼 확정룰 1:1 (절대 변경 금지), start_at 오름차순
  FOR r IN
    SELECT b.id, b.start_at, b.user_email, b.user_name
      FROM public.bookings b
     WHERE b.user_id      = p_user_id
       AND b.status       = 'confirmed'
       AND b.cancelled_by = 'system'
       AND b.checked_in   = false
       AND b.start_at    >= c_policy_start
     ORDER BY b.start_at, b.id
  LOOP
    v_email := COALESCE(r.user_email, v_email);
    v_name  := COALESCE(r.user_name,  v_name);

    IF v_anchor IS NULL OR r.start_at >= v_anchor + c_window THEN
      v_anchor := r.start_at;                    -- 새 사이클 시작 (윈도우 미달 이월 없음)
      v_cnt    := 1;
      v_ids    := ARRAY[r.id];
    ELSE
      v_cnt := v_cnt + 1;
      v_ids := v_ids || r.id;
      IF v_cnt = c_strikes THEN                  -- 3번째 — 제재 성립, 사이클 종료
        v_trig_id  := r.id;
        v_trig_at  := r.start_at;
        v_c_anchor := v_anchor;
        v_c_ids    := v_ids;
        v_anchor   := NULL;                      -- 다음 노쇼가 새 앵커
        v_cnt      := 0;
        v_ids      := '{}';
      END IF;
    END IF;
  END LOOP;

  IF v_trig_id IS NULL THEN RETURN NULL; END IF;                    -- 성립 사이클 없음
  IF v_trig_at + c_penalty <= now() THEN RETURN NULL; END IF;       -- 이미 기간 경과 — 발급 무의미
  IF EXISTS (SELECT 1 FROM public.noshow_penalties
              WHERE triggered_booking_id = v_trig_id) THEN          -- 이미 발급(해제 이력 포함) — 재발급 금지
    RETURN NULL;
  END IF;

  INSERT INTO public.noshow_penalties
         (user_id, user_email, user_name, anchor_at,
          counted_booking_ids, triggered_booking_id, starts_at, ends_at)
  VALUES (p_user_id, v_email, v_name, v_c_anchor,
          v_c_ids, v_trig_id, v_trig_at, v_trig_at + c_penalty)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

-- 내부 전용 — 클라이언트 직접 호출 금지 (트리거/RPC/백필은 owner 권한으로 실행됨)
REVOKE ALL ON FUNCTION public.evaluate_noshow_penalty(uuid) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_noshow_penalty(uuid) TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- 4) 감지 트리거 — 예약이 노쇼로 "전환"되는 순간 평가
--    (프론트 markNoshow 직접 UPDATE + cron auto-cancel-bookings 양쪽 커버)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.on_booking_noshow_marked()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.evaluate_noshow_penalty(NEW.user_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_noshow_penalty_eval ON public.bookings;
CREATE TRIGGER trg_noshow_penalty_eval
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed'
    AND NEW.cancelled_by = 'system'
    AND NEW.checked_in = false
    AND OLD.cancelled_by IS DISTINCT FROM 'system')   -- 전환 순간에만 1회
  EXECUTE FUNCTION public.on_booking_noshow_marked();

-- ════════════════════════════════════════════════════════════════════════
-- 5) 차단 트리거 — 유효 제재 중 신규 예약 INSERT 거부
--    SECURITY DEFINER: 대리 예약(관리자가 타인 user_id 로 INSERT) 시에도
--    RLS 와 무관하게 대상자의 제재 행을 항상 볼 수 있어야 구멍이 없다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.block_booking_if_noshow_penalized()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ends timestamptz;
BEGIN
  -- SQL Editor 복구 경로 허용 (trg_block_cancel_on_checked_in 과 동일 관례)
  IF session_user = 'postgres' THEN RETURN NEW; END IF;

  SELECT p.ends_at INTO v_ends
    FROM public.noshow_penalties p
   WHERE p.user_id    = NEW.user_id
     AND p.revoked_at IS NULL
     AND now() >= p.starts_at
     AND now() <  p.ends_at
   ORDER BY p.ends_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- 형식 고정: NOSHOW_PENALTY_BLOCKED:{KST 해제 시각} — 프론트 매핑 계약
    RAISE EXCEPTION 'NOSHOW_PENALTY_BLOCKED:%',
      to_char(v_ends AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_booking_noshow_penalty ON public.bookings;
CREATE TRIGGER trg_block_booking_noshow_penalty
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.block_booking_if_noshow_penalized();

-- ════════════════════════════════════════════════════════════════════════
-- 6) 내 제재 상태 조회 — 프론트 사전 안내용 (없으면 blocked=false 1행)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.my_noshow_penalty_state()
RETURNS TABLE (blocked boolean, penalty_id uuid, starts_at timestamptz, ends_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.noshow_penalties%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO v
    FROM public.noshow_penalties p
   WHERE p.user_id    = auth.uid()
     AND p.revoked_at IS NULL
     AND now() >= p.starts_at
     AND now() <  p.ends_at
   ORDER BY p.ends_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT true, v.id, v.starts_at, v.ends_at;
  ELSE
    RETURN QUERY SELECT false, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.my_noshow_penalty_state() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.my_noshow_penalty_state() TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 7) 관리자 수동 해제 RPC
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_revoke_noshow_penalty(
  p_penalty_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.noshow_penalties%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('booking') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  SELECT * INTO v FROM public.noshow_penalties WHERE id = p_penalty_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PENALTY_NOT_FOUND'; END IF;
  IF v.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_REVOKED'; END IF;

  UPDATE public.noshow_penalties
     SET revoked_at     = now(),
         revoked_by     = auth.uid(),
         revoked_reason = COALESCE(NULLIF(trim(p_reason), ''), '관리자 수동 해제')
   WHERE id = p_penalty_id;

  RETURN jsonb_build_object('ok', true, 'id', p_penalty_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_revoke_noshow_penalty(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_noshow_penalty(uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 8) 노쇼 해제/삭제 RPC 갱신 — 제재 정합성 블록 추가 (20260740 본문 + 말미 3줄)
--    근거(counted)에 포함된 유효 제재를 자동 해제하고, 살아있는 노쇼로 재평가.
--    (4번째 노쇼가 윈도우 안에 있었다면 새 구성으로 정당하게 재발급된다)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_resolve_noshow(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row  public.bookings%ROWTYPE;
  v_snap jsonb;
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

  v_snap := to_jsonb(v_row);

  UPDATE public.bookings
     SET checked_in           = true,   -- 재노쇼 원천 차단 (markNoshow 가드 ②) + '사용완료' 라벨
         auto_cancelled       = false,
         cancelled_by         = NULL,
         cancelled_by_user_id = NULL
   WHERE id = p_booking_id;

  INSERT INTO public.noshow_admin_actions (booking_id, action, booking_snapshot, actor)
  VALUES (p_booking_id, 'resolve', v_snap, auth.uid());

  -- ← [2026-08-10 이용제재] 근거가 무너진 제재 자동 해제 + 재평가 (파일 헤더 ④⑤ 참조)
  UPDATE public.noshow_penalties
     SET revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = '근거 노쇼 해제(admin_resolve_noshow: ' || p_booking_id || ') — 자동 해제'
   WHERE revoked_at IS NULL AND p_booking_id = ANY(counted_booking_ids);
  PERFORM public.evaluate_noshow_penalty(v_row.user_id);

  RETURN jsonb_build_object('ok', true, 'id', p_booking_id, 'title', v_row.title);
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_noshow(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_resolve_noshow(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_noshow_booking(p_booking_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row  public.bookings%ROWTYPE;
  v_snap jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('booking') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  SELECT * INTO v_row FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;

  -- ⚠ 노쇼 확정룰 1:1 (위와 동일) — 노쇼가 아닌 예약은 이 경로로 삭제 불가
  IF NOT (v_row.status = 'confirmed'
      AND v_row.cancelled_by = 'system'
      AND v_row.checked_in = false) THEN
    RAISE EXCEPTION 'NOT_NOSHOW';
  END IF;

  -- 스냅샷 = 원본 행 + 참석자 목록 (삭제 후 유일한 이력)
  v_snap := to_jsonb(v_row) || jsonb_build_object(
    'attendees',
    COALESCE((SELECT jsonb_agg(jsonb_build_object('email', a.email, 'name', a.name))
                FROM public.booking_attendees a
               WHERE a.booking_id = p_booking_id), '[]'::jsonb)
  );

  DELETE FROM public.booking_attendees WHERE booking_id = p_booking_id;
  DELETE FROM public.bookings          WHERE id         = p_booking_id;

  INSERT INTO public.noshow_admin_actions (booking_id, action, booking_snapshot, actor)
  VALUES (p_booking_id, 'delete', v_snap, auth.uid());

  -- ← [2026-08-10 이용제재] 근거가 무너진 제재 자동 해제 + 재평가 (파일 헤더 ④⑤ 참조)
  UPDATE public.noshow_penalties
     SET revoked_at = now(), revoked_by = auth.uid(),
         revoked_reason = '근거 노쇼 삭제(admin_delete_noshow_booking: ' || p_booking_id || ') — 자동 해제'
   WHERE revoked_at IS NULL AND p_booking_id = ANY(counted_booking_ids);
  PERFORM public.evaluate_noshow_penalty(v_row.user_id);

  RETURN jsonb_build_object('ok', true, 'id', p_booking_id, 'title', v_row.title);
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_noshow_booking(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_noshow_booking(text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 9) 1회 백필 — 8/1 이후 이미 쌓인 노쇼 반영 (시행일 이후 발생분은 소급 아님)
--    ends_at 이 이미 지난 사이클은 evaluate 가 알아서 생성 생략한다.
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_uid uuid;
BEGIN
  FOR v_uid IN
    SELECT DISTINCT b.user_id
      FROM public.bookings b
     WHERE b.status       = 'confirmed'
       AND b.cancelled_by = 'system'
       AND b.checked_in   = false
       AND b.start_at    >= timestamptz '2026-08-01 00:00:00+09'
       AND b.user_id IS NOT NULL
  LOOP
    PERFORM public.evaluate_noshow_penalty(v_uid);
  END LOOP;
END $$;

COMMIT;

-- ── 배포 후 확인 (읽기 전용) ─────────────────────────────────────────────
-- SELECT to_regclass('public.noshow_penalties') IS NOT NULL                          AS table_ok,
--        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_noshow_penalty_eval')          AS eval_trg_ok,
--        EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_block_booking_noshow_penalty') AS block_trg_ok,
--        EXISTS(SELECT 1 FROM pg_proc    WHERE proname='my_noshow_penalty_state')         AS state_ok,
--        EXISTS(SELECT 1 FROM pg_proc    WHERE proname='admin_revoke_noshow_penalty')     AS revoke_ok;
-- SELECT user_name, starts_at, ends_at, revoked_at FROM public.noshow_penalties ORDER BY created_at DESC;
