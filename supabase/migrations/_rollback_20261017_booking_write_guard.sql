-- ============================================================================
-- [롤백] 20261017_booking_write_guard.sql 되돌리기                          (2026-10-06)
--
--   ⚠ 실행하면 2026-10-06 사고 이전 상태로 돌아간다 — 로그인한 누구나 타인 예약 수정·승인·강제취소,
--     본인 profiles.role 변경, 참석자 자가 등록이 다시 가능해진다. 가드가 정상 기능을 막는
--     장애가 확인됐을 때만 사용하고, 원인 수정 후 20261017 을 다시 적용할 것.
--
--   부분 롤백: 아래 3블록은 서로 독립 — 문제가 된 블록만 골라 실행해도 된다.
-- 실행: Supabase SQL Editor 전체 Run
-- ============================================================================
BEGIN;

-- [A] 예약 쓰기 가드 해제
DROP TRIGGER IF EXISTS trg_bookings_client_write_guard ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_booking_client_write();

-- [B] profiles.role 잠금 해제
DROP TRIGGER IF EXISTS trg_profiles_role_client_lock ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_role_client_write();

-- [C] 참석자 직접 쓰기 정책 복원 (원본: FOR ALL · WITH CHECK (true) · USING 없음)
DROP POLICY IF EXISTS attendees_write ON public.booking_attendees;
CREATE POLICY attendees_write ON public.booking_attendees FOR ALL WITH CHECK (true);

COMMIT;

SELECT
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
      AND tgname IN ('trg_bookings_client_write_guard','trg_profiles_role_client_lock'))                AS guard_triggers_should_be_0,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='booking_attendees' AND cmd <> 'SELECT') AS attendee_write_policies_should_be_1;
