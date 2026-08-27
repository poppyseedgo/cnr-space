-- ============================================================================
-- 20260746_noshow_time_guard.sql
-- C&R Space — 노쇼 마킹 '시간 조건' 가드 (서버 시계 SSOT)
--
-- 사고 [2026-08-27 13:00:03 KST]
--   한다운 브라우저의 App.tsx 10초 tick 이 stale state + 클라이언트 시계 기준으로
--   markNoshow 10건 일괄 발사 → 기존 가드 5종(status/checked_in/early_ended/
--   auto_cancelled/cancelled_by)은 9건을 걸렀으나, 시작 15분 전인 13:15 예약
--   (b1785108574121_0)은 체크인 전이라 통과 → 미래 예약이 노쇼 확정.
--   근본 원인 = 가드에 '시간 조건'이 없고, start+10분 판정을 클라이언트 시계에 의존.
--
-- 수정
--   1) BEFORE UPDATE 트리거 block_premature_noshow:
--        cancelled_by='system' 노쇼 전환 시 now() < start_at + 10분이면 UPDATE 무효화
--        (RETURN NULL = 0행, 클라이언트 tick 은 에러 없이 지나감). 모든 경로 커버.
--        거부 시도는 noshow_guard_rejections 에 기록(시계 이상 클라이언트 식별용).
--   2) RPC mark_noshow(id): 가드 5종 + 시간 조건을 now() 로 한 번에 판정, 갱신 행 수 반환.
--        프론트 markNoshow 는 이 RPC 로 전환하고, 반환 1일 때만 audit_log 기록.
--   3) 데이터 정정은 data_fix_20260827_sdv.sql 로 분리 (동일 슬롯 재예약과 exclusion 충돌)
--
-- 멱등: 재실행 안전.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0) 노쇼 판정 유예 시간(분) — 단일 상수 함수 (cron 창 [start+10, start+25) 와 동일 값)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.noshow_grace_minutes()
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$ SELECT 10 $$;

-- ----------------------------------------------------------------------------
-- 1) 거부 시도 기록 테이블
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.noshow_guard_rejections (
  id            bigserial PRIMARY KEY,
  booking_id    text        NOT NULL,
  start_at      timestamptz NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  early_by_sec  integer     NOT NULL,          -- (start_at+grace) - now()
  actor_id      uuid,                          -- auth.uid() (클라이언트 경로), NULL=anon/cron
  db_role       text        NOT NULL,          -- JWT role(authenticated/anon) 또는 session_user
  reason        text        NOT NULL
);
CREATE INDEX IF NOT EXISTS noshow_guard_rejections_attempted_idx
  ON public.noshow_guard_rejections (attempted_at DESC);

ALTER TABLE public.noshow_guard_rejections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS noshow_guard_rejections_admin_select ON public.noshow_guard_rejections;
CREATE POLICY noshow_guard_rejections_admin_select
  ON public.noshow_guard_rejections FOR SELECT
  TO authenticated
  USING (public.has_admin_role('booking'));
-- 쓰기는 트리거(SECURITY DEFINER) 전용 — 클라이언트 INSERT 정책 없음
GRANT SELECT ON public.noshow_guard_rejections TO authenticated;

-- ----------------------------------------------------------------------------
-- 2) 트리거 함수: 조기 노쇼 차단 (서버 시계)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.block_premature_noshow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_threshold timestamptz;
  v_uid uuid;
BEGIN
  -- 수동 복구(SQL Editor, postgres 세션)는 통과 — 기존 가드 트리거와 동일 원칙
  IF session_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  -- 노쇼 전환 이벤트만 검사: system 마킹 + auto_cancelled false→true
  IF NEW.cancelled_by = 'system'
     AND NEW.auto_cancelled = true
     AND OLD.auto_cancelled IS DISTINCT FROM true
  THEN
    v_threshold := OLD.start_at + make_interval(mins => public.noshow_grace_minutes());

    IF now() < v_threshold THEN
      BEGIN
        v_uid := auth.uid();
      EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
      END;

      INSERT INTO public.noshow_guard_rejections
        (booking_id, start_at, early_by_sec, actor_id, db_role, reason)
      VALUES
        (OLD.id, OLD.start_at,
         EXTRACT(EPOCH FROM (v_threshold - now()))::integer,
         v_uid, COALESCE(current_setting('request.jwt.claim.role', true), session_user::text),
         'PREMATURE_NOSHOW: now() < start_at + grace');

      -- UPDATE 무효화 (0행). 에러를 던지지 않는 이유: 클라이언트 tick 의 Promise.all 이
      -- 죽지 않게 + 기존 가드 5종과 동일한 "조용한 skip" 계약 유지
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_premature_noshow ON public.bookings;
CREATE TRIGGER trg_block_premature_noshow
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.block_premature_noshow();

-- ----------------------------------------------------------------------------
-- 3) RPC: mark_noshow — 가드 5종 + 시간 조건, 서버 시계 단일 판정
--    반환: 실제 갱신된 행 수 (0 | 1). 프론트는 1일 때만 audit_log 기록.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_noshow(p_booking_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  UPDATE public.bookings
     SET auto_cancelled = true,
         cancelled_by   = 'system'
   WHERE id             = p_booking_id
     AND status         = 'confirmed'
     AND checked_in     = false
     AND early_ended    = false
     AND auto_cancelled = false
     AND cancelled_by   IS NULL
     AND now() >= start_at + make_interval(mins => public.noshow_grace_minutes());

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_noshow(text) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_noshow(text) TO authenticated;

-- (데이터 정정은 별도 스크립트 data_fix_20260827_sdv.sql — 중복 예약 판단이 필요해 분리)

COMMIT;
