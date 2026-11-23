-- ============================================================================
-- [롤백] 20261123_emerald_pending_expiry.sql 되돌리기                       (2026-11-23)
--
--   ⚠ 실행하면 기한초과 전환을 다시 아무도 DB 에 기록하지 않는다.
--     프론트(fix/emerald-pending-expiry)는 브라우저 임시 마킹을 지웠으므로, 프론트도 함께
--     이전 버전으로 되돌려야 한다. 그렇지 않으면 마감이 지난 건이 '승인 대기' 로 계속 보인다.
--   · [D] 에서 정리한 데이터(잔여 건 → 기한초과 취소)는 되돌리지 않는다.
--   · pending_expired_notified 컬럼·인덱스·상수 함수는 남긴다 (남아 있어도 동작에 영향 없음).
--   부분 롤백: 아래 블록은 서로 독립 — 문제가 된 블록만 골라 실행해도 된다.
-- 실행: Supabase SQL Editor 전체 Run
-- ============================================================================
BEGIN;

-- [G] 매분 작업 해제
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-pending-bookings';
  END IF;
END $$;

-- [E] 기한초과 전환 함수 제거
DROP FUNCTION IF EXISTS public.expire_pending_bookings();

-- [F] 직전 신청 차단 해제
DROP TRIGGER IF EXISTS trg_bookings_approval_lead_time ON public.bookings;
DROP FUNCTION IF EXISTS public.guard_approval_room_lead_time();

-- [C] 노쇼 종결 트리거 원복 (20260763 원문)
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

COMMIT;

SELECT
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
      AND tgname = 'trg_bookings_approval_lead_time')                       AS lead_trigger_should_be_0,
  (SELECT count(*) FROM pg_proc WHERE proname = 'expire_pending_bookings')  AS expire_fn_should_be_0;
