-- ============================================================================
-- 20260740_noshow_admin.sql
-- 노쇼 관리 (어드민 '예약 관리' 탭 하위) — 노쇼 해제(사용 완료) / DB 완전 삭제
--
-- ✅ 변경 이력
--  - [2026-08-05] 신규 — 고지 지시: 기간별 노쇼 소팅 + 해제/영구삭제 관리 화면
--
-- 📌 왜 RPC 인가 (클라 직접 UPDATE/DELETE 금지)
--    · 노쇼 확정룰(status='confirmed' AND cancelled_by='system' AND checked_in=false)은
--      절대 변경 금지 SSOT — 해제/삭제 대상 검증을 서버가 강제해야
--      "노쇼가 아닌 행"이 실수로 삭제되는 사고를 원천 차단한다.
--    · bookings 에 클라이언트 DELETE 경로는 현재 존재하지 않으며 새로 여는 것은
--      RLS 확장 = 전면 노출. SECURITY DEFINER RPC 단일 경로가 근본 해법.
--
-- 📌 감사 테이블을 두는 이유
--    · '완전 삭제'는 행 자체가 사라져 이력이 0 이 된다. admin_role_grants 와 같은
--      원칙 — 스냅샷(jsonb)을 남겨야 "누가 언제 무엇을 지웠나"를 복원할 수 있다.
--
-- 📌 권한: has_admin_role('booking') — 어드민 탭=역할 1:1 원칙.
--    노쇼 관리는 '예약 관리' 탭 하위 섹션이므로 booking 계열 (super 자동 통과).
--
-- 📌 해제 = checked_in=true 로 전환하는 이유 (근본 처리)
--    · cancelled_by 만 NULL 로 되돌리면 App tick / cron ①이 [start+10, start+25) 창의
--      건을 다시 markNoshow 할 수 있다(과거 건은 창 밖이지만 구조적으로 열려 있음).
--    · markNoshow 가드 ②(checked_in=false)가 checked_in=true 행을 영구 차단하므로
--      재노쇼가 원리적으로 불가능해진다. 라벨도 '사용완료'(getBookingStatusLabel ⑧)로
--      정확히 떨어진다. (trg_block_cancel_on_checked_in 은 '취소' UPDATE 차단용 —
--      본 전환은 취소가 아니고, 대상 행은 checked_in=false 상태라 발동 조건 밖)
-- ============================================================================

BEGIN;

-- ── [1] 감사 테이블 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.noshow_admin_actions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       text        NOT NULL,                    -- bookings.id (text 'b{epoch}_{i}')
  action           text        NOT NULL CHECK (action IN ('resolve', 'delete')),
  booking_snapshot jsonb       NOT NULL,                    -- 삭제 전 원본 행 + 참석자
  actor            uuid,                                    -- 실행 관리자 (auth.uid())
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.noshow_admin_actions IS
  '노쇼 해제/영구삭제 감사 로그 — 하드 삭제 후에도 스냅샷으로 이력 보존';

ALTER TABLE public.noshow_admin_actions ENABLE ROW LEVEL SECURITY;

-- 읽기: 예약 관리 권한자만. 쓰기 정책 없음 — RPC(SECURITY DEFINER) 전용
DROP POLICY IF EXISTS noshow_actions_read ON public.noshow_admin_actions;
CREATE POLICY noshow_actions_read ON public.noshow_admin_actions
  FOR SELECT TO authenticated USING (public.has_admin_role('booking'));

GRANT SELECT ON public.noshow_admin_actions TO authenticated;
GRANT ALL    ON public.noshow_admin_actions TO service_role;

-- ── [2] 노쇼 해제 (사용 완료 전환) ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_resolve_noshow(text);
CREATE FUNCTION public.admin_resolve_noshow(p_booking_id text)
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

  RETURN jsonb_build_object('ok', true, 'id', p_booking_id, 'title', v_row.title);
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_noshow(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_resolve_noshow(text) TO authenticated;

-- ── [3] 노쇼 예약 영구 삭제 ──────────────────────────────────────────────
--    참석자 행을 먼저 명시 삭제 — booking_attendees FK 의 ON DELETE 설정에
--    의존하지 않는다 (CASCADE 여부와 무관하게 동일 결과, 멱등).
DROP FUNCTION IF EXISTS public.admin_delete_noshow_booking(text);
CREATE FUNCTION public.admin_delete_noshow_booking(p_booking_id text)
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

  RETURN jsonb_build_object('ok', true, 'id', p_booking_id, 'title', v_row.title);
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_noshow_booking(text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_delete_noshow_booking(text) TO authenticated;

COMMIT;

-- ── 배포 후 확인 (읽기 전용) ─────────────────────────────────────────────
-- SELECT to_regclass('public.noshow_admin_actions') IS NOT NULL AS table_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='admin_resolve_noshow')        AS resolve_ok,
--        EXISTS(SELECT 1 FROM pg_proc WHERE proname='admin_delete_noshow_booking') AS delete_ok;
