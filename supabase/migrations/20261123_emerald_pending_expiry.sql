-- ============================================================================
-- 20261123_emerald_pending_expiry.sql                                 (2026-11-23)
-- 에메랄드(승인룸) '기한초과 취소' — 판정·기록 주체를 DB 한 곳으로 + 직전 신청 차단
--
-- 배경 (2026-11-23 운영 실측):
--   · auto-cancel-bookings ③(승인 기한 초과 자동 취소)이 2026-04-23 HOTFIX 로 정지된 뒤
--     DB 에는 마감이 지난 승인 대기 건이 status='pending' 그대로 남았다.
--   · 프론트 App.tsx 10초 tick 이 브라우저 메모리에서만 cancelled/system 으로 바꿔 왔고,
--     DB 를 다시 읽을 때마다(Realtime·탭 복귀·10분 동기화) 원본(pending)으로 되돌아가
--     화면이 "기한초과 ↔ 승인 대기(점유)" 를 반복했다.  → 판정 주체 2곳이 원인.
--   · 잔여 2건(b1794294002331_0 · b1795393755338_0) 모두 일반 사용자가 시작 1분 이내에
--     만든 건 — 만들자마자 기한 초과.
--
-- 확정 결정 (고지, 2026-11-23):
--   · 수정 범위 = 에메랄드 '기한초과 취소' 상태 오류에 한정
--   · 기한초과 메일·인앱 알림 복구
--   · 직전 신청 차단: 일반 사용자 = 시작 15분 전까지 / 관리자 = 시작 1분 전까지
--   · 관리자 본인 예약은 대리 예약처럼 즉시 확정 (프론트 App.tsx — DB 가드는 관리자 전부 통과라 무변경)
--   · 승인 마감 임박 관리자 알림: 10분 전 → 5분 전으로 바꿔 복구
--
-- 구성 (실행 순서 = 아래 순서 그대로, 한 트랜잭션):
--   [A] 상수 함수 4종 — 판정 수치 SSOT
--   [B] bookings.pending_expired_notified 컬럼 + 부분 인덱스 (알림 1회 발송 보장용)
--   [C] trg_noshow_close_end 에 status='confirmed' 조건 추가
--       기한초과 전환(cancelled_by='system' ∧ auto_cancelled false→true)이 노쇼 종결 트리거
--       WHEN 에도 걸려 end_at 이 시작+15분으로 잘리고 noshow_closed_at 이 찍히는 것을 막는다.
--       노쇼 확정룰(status='confirmed' + cancelled_by='system' + !checked_in)과 같은 조건이라
--       노쇼 동작은 그대로다 (trg_noshow_penalty_eval 은 원래 status='confirmed' 포함).
--   [D] 잔여 기한초과 건 1회 정리 — 알림 없이(pending_expired_notified=true)
--   [E] expire_pending_bookings() — 유일한 기록 주체. pg_cron 매분.
--       판정식은 프론트 SSOT(utils/pendingStatus.ts isExpiredPending)와 1:1:
--         status='pending' ∧ !auto_cancelled ∧ cancelled_by IS NULL ∧ room_id=3 ∧ now ≥ start_at − 1분
--       전환 후 알림 대상(기한초과 미통지 · 승인 마감 5분 전 미통지)이 있으면
--       auto-cancel-bookings 를 깨운다(pg_net, verify_jwt=false 라 키 불필요).
--   [F] guard_approval_room_lead_time() + trg_bookings_approval_lead_time — 직전 신청 차단
--       클라이언트 직접 쓰기(current_user = authenticated/anon)에만 적용 (20261017 가드와 같은 관례).
--   [G] pg_cron 등록 (pg_cron 이 있는 DB 에서만 — 로컬 시뮬은 건너뜀)
--
-- ⚠ expire_pending_bookings() 는 pg_cron(postgres 세션) 전용이다.
--   block_premature_noshow 트리거가 "system 마킹 + 시작+10분 이전" UPDATE 를 조용히 0행으로
--   만드는데 session_user='postgres' 는 통과한다. 다른 역할로 호출하면 전환이 0건이 된다.
--   그래서 실행 권한을 PUBLIC/anon/authenticated/service_role 모두에서 회수한다.
--
-- 멱등: 전체 재실행 안전.   롤백: _rollback_20261123_emerald_pending_expiry.sql
-- 짝 배포: Edge auto-cancel-bookings · send-notification / 프론트 (fix/emerald-pending-expiry)
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- [A] 상수 — 판정 수치 SSOT (noshow_grace_minutes() 와 같은 관례)
-- ----------------------------------------------------------------------------
-- 승인룸 ID. 프론트 utils/pendingStatus.ts APPROVAL_ROOM_ID 와 같은 값.
CREATE OR REPLACE FUNCTION public.approval_room_id()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3 $$;

-- 승인 마감 = 시작 N분 전 (프론트 APPROVAL_DEADLINE_MS = 60_000). 관리자 생성 마감과 같다.
CREATE OR REPLACE FUNCTION public.approval_deadline_minutes()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;

-- 일반 사용자 신청 마감 = 시작 N분 전 (프론트 APPROVAL_REQUEST_LEAD_MS)
CREATE OR REPLACE FUNCTION public.approval_request_lead_minutes()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 15 $$;

-- 승인 마감 임박 관리자 알림 = 승인 마감 N분 전
CREATE OR REPLACE FUNCTION public.approval_reminder_minutes()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;

-- ----------------------------------------------------------------------------
-- [B] 기한초과 알림 발송 표식
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pending_expired_notified boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bookings.pending_expired_notified IS
  '기한초과 취소 알림(pending_expired) 발송 완료 표식. auto-cancel-bookings 가 선점 후 발송, 실패 시 되돌림. '
  '(noshow_notified 와 같은 역할)';

CREATE INDEX IF NOT EXISTS idx_bookings_pending_expired_notify
  ON public.bookings (start_at)
  WHERE status = 'cancelled' AND cancelled_by = 'system' AND pending_expired_notified = false;

-- ----------------------------------------------------------------------------
-- [C] 노쇼 종결 트리거 — 노쇼(status='confirmed')에만 적용
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
          AND OLD.auto_cancelled IS DISTINCT FROM true
          AND NEW.status = 'confirmed') THEN   -- ← [2026-11-23] 기한초과(status='cancelled') 제외
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
        AND OLD.auto_cancelled IS DISTINCT FROM true
        AND NEW.status = 'confirmed')            -- ← [2026-11-23] 기한초과(status='cancelled') 제외
  EXECUTE FUNCTION public.noshow_close_end();

-- ----------------------------------------------------------------------------
-- [D] 잔여 기한초과 건 1회 정리 — 알림 없이
--     이 시점까지 쌓인 "마감 지난 승인 대기" 를 기한초과 취소로 기록하고 통지 완료로 표시한다.
--     (그대로 두면 [E] 가 첫 실행에서 전환하며 뒤늦은 메일을 보낸다)
--     기존 기한초과 건(cancelled/system)도 통지 완료로 표시해 재발송 대상에서 뺀다.
-- ----------------------------------------------------------------------------
UPDATE public.bookings b
   SET status = 'cancelled', auto_cancelled = true, cancelled_by = 'system',
       pending_expired_notified = true
 WHERE b.status = 'pending'
   AND b.auto_cancelled IS NOT TRUE
   AND b.cancelled_by IS NULL
   AND b.room_id = public.approval_room_id()
   AND now() >= b.start_at - make_interval(mins => public.approval_deadline_minutes());

UPDATE public.bookings b
   SET pending_expired_notified = true
 WHERE b.status = 'cancelled'
   AND b.cancelled_by = 'system'
   AND b.room_id = public.approval_room_id()
   AND b.pending_expired_notified = false;

-- ----------------------------------------------------------------------------
-- [E] 기한초과 전환 — 유일한 기록 주체
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_pending_bookings()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_room     integer     := public.approval_room_id();
  v_deadline interval    := make_interval(mins => public.approval_deadline_minutes());
  v_remind   interval    := make_interval(mins => public.approval_reminder_minutes());
  v_now      timestamptz := now();
  v_ids      text[];
  v_expired  integer := 0;
  v_woke     boolean := false;
BEGIN
  -- ① 전환: 마감(시작 1분 전)이 지난 승인 대기 → 기한초과 취소
  --    조건부 UPDATE 한 번 — 그 사이 승인/거절/취소된 건은 status 조건에서 빠진다.
  WITH x AS (
    UPDATE public.bookings b
       SET status = 'cancelled', auto_cancelled = true, cancelled_by = 'system'
     WHERE b.status = 'pending'
       AND b.auto_cancelled IS NOT TRUE
       AND b.cancelled_by IS NULL
       AND b.room_id = v_room
       AND v_now >= b.start_at - v_deadline
    RETURNING b.id
  )
  SELECT array_agg(id), count(*) INTO v_ids, v_expired FROM x;

  IF v_expired > 0 THEN
    -- 처리 이력 (프론트 expirePendingBooking 이 남기던 형식 그대로)
    INSERT INTO public.audit_log (action, entity_type, entity_id, actor_name, after_data)
    SELECT 'BOOKING_CANCELLED', 'booking', i, 'system',
           jsonb_build_object('reason', '승인 기한 초과 자동 취소', 'cancelled_by', 'system')
      FROM unnest(v_ids) AS i;
  END IF;

  -- ② 알림 대상이 있으면 auto-cancel-bookings 를 깨운다 (발송·표식은 그쪽 담당)
  --    · 기한초과 미통지: 최근 1시간 안에 시작한 건만 (오래된 건 뒤늦은 메일 방지)
  --    · 승인 마감 임박 미통지: 마감 5분 전 ~ 마감 직전
  IF EXISTS (
       SELECT 1 FROM public.bookings b
        WHERE b.status = 'cancelled' AND b.cancelled_by = 'system'
          AND b.pending_expired_notified = false
          AND b.room_id = v_room
          AND b.start_at >= v_now - interval '1 hour')
     OR EXISTS (
       SELECT 1 FROM public.bookings b
        WHERE b.status = 'pending'
          AND b.auto_cancelled IS NOT TRUE
          AND b.cancelled_by IS NULL
          AND b.approval_reminder_sent = false
          AND b.room_id = v_room
          AND v_now >= b.start_at - v_deadline - v_remind
          AND v_now <  b.start_at - v_deadline)
  THEN
    PERFORM net.http_post(
      url     := 'https://jjzcqpbwkkujttwxksvy.supabase.co/functions/v1/auto-cancel-bookings',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{"task":"pending"}'::jsonb
    );
    v_woke := true;
  END IF;

  RETURN jsonb_build_object('expired', v_expired, 'woke', v_woke, 'at', v_now);
END $$;

REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM anon;          END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN REVOKE ALL ON FUNCTION public.expire_pending_bookings() FROM service_role;  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- [F] 직전 신청 차단
--     승인룸(is_admin_only — 20261017 가드 I2 "승인룸은 pending 으로만 생성" 과 같은 기준)
--       · 일반 사용자: 시작 15분 전까지만 신청 (INSERT · 승인룸으로 이동/시작시각 변경 UPDATE)
--       · 관리자(profiles.role='ADMIN'): 시작 1분 전까지만 생성 (INSERT)
--     에러 형식 고정: APPROVAL_ROOM_LEAD_TIME:{분} — 프론트 매핑 계약 (utils/pendingStatus.ts)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_approval_room_lead_time()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_admin boolean;
  v_lead  integer;
BEGIN
  IF NOT COALESCE((SELECT r.is_admin_only FROM public.rooms r WHERE r.room_id = NEW.room_id), false) THEN
    RETURN NEW;
  END IF;

  -- 관리자 = ADMIN 전원 (guard_booking_client_write · 프론트 isAdmin 과 동일 기준)
  v_admin := EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN');

  IF TG_OP = 'UPDATE' THEN
    IF v_admin THEN
      RETURN NEW;                       -- 관리자 변경은 대상 아님 (확정 규칙은 "생성" 한정)
    END IF;
    IF NEW.room_id = OLD.room_id AND NEW.start_at = OLD.start_at THEN
      RETURN NEW;                       -- 방·시작시각이 그대로인 수정(취소·제목 등)은 대상 아님
    END IF;
  END IF;

  v_lead := CASE WHEN v_admin THEN public.approval_deadline_minutes()
                 ELSE public.approval_request_lead_minutes() END;

  IF now() > NEW.start_at - make_interval(mins => v_lead) THEN
    RAISE EXCEPTION 'APPROVAL_ROOM_LEAD_TIME:%', v_lead USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_bookings_approval_lead_time ON public.bookings;
CREATE TRIGGER trg_bookings_approval_lead_time
  BEFORE INSERT OR UPDATE OF room_id, start_at ON public.bookings
  FOR EACH ROW
  WHEN (CURRENT_USER = ANY (ARRAY['authenticated'::name, 'anon'::name]))
  EXECUTE FUNCTION public.guard_approval_room_lead_time();

-- ----------------------------------------------------------------------------
-- [G] pg_cron 등록 — 매분
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'expire-pending-bookings';
    PERFORM cron.schedule('expire-pending-bookings', '* * * * *', 'SELECT public.expire_pending_bookings();');
  END IF;
END $$;

COMMIT;

-- 확인 행
SELECT
  (SELECT count(*) FROM public.bookings
    WHERE status = 'pending' AND room_id = public.approval_room_id()
      AND now() >= start_at - make_interval(mins => public.approval_deadline_minutes()))      AS stale_pending_should_be_0,
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
      AND tgname = 'trg_bookings_approval_lead_time')                                          AS lead_trigger_should_be_1,
  (SELECT count(*) FROM pg_proc WHERE proname = 'expire_pending_bookings')                     AS expire_fn_should_be_1;
