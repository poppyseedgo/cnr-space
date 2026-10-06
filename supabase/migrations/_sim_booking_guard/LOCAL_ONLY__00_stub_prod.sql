-- ⚠ LOCAL_ONLY — 로컬 PG 시뮬 전용 스텁. 운영 실행 금지.
-- 운영(jjzcqpbwkkujttwxksvy) 2026-10-06 실측 정의를 옮김: 함수·트리거·정책은 pg_get_functiondef / pg_get_triggerdef / pg_policies 원문.
-- 미포함(가드 판정과 무관): trg_noshow_penalty_eval(AFTER UPDATE → evaluate_noshow_penalty)

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Supabase 역할 (PostgREST: authenticator 로 접속 → SET LOCAL ROLE) ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
CREATE OR REPLACE FUNCTION auth.email()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$function$;
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

-- ── 테이블 (운영 컬럼·기본값·제약) ──
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, email text, name text, dept text, role text, created_at timestamptz DEFAULT now(),
  employee_id text, azure_user_id text, is_active boolean, avatar_url text,
  employment_status text, departure_scheduled_on date, returned_on date, azure_extra jsonb, azure_synced_at timestamptz
);
CREATE TABLE public.rooms (room_id integer PRIMARY KEY, room_name text, is_admin_only boolean DEFAULT false);
CREATE TABLE public.bookings (
  id text PRIMARY KEY,
  room_id integer NOT NULL,
  title text NOT NULL,
  memo text DEFAULT ''::text,
  attendees jsonb DEFAULT '[]'::jsonb,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  user_name text NOT NULL,
  user_dept text NOT NULL DEFAULT ''::text,
  checked_in boolean DEFAULT false,
  auto_cancelled boolean DEFAULT false,
  early_ended boolean DEFAULT false,
  recur_group_id text,
  created_at timestamptz DEFAULT now(),
  cancelled_by text,
  status text DEFAULT 'confirmed'::text,
  original_end_at timestamptz,
  reject_reason text,
  approval_reminder_sent boolean NOT NULL DEFAULT false,
  processed_by_name text,
  processed_by_avatar text,
  noshow_notified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_email text NOT NULL,
  cancelled_by_user_id uuid REFERENCES public.profiles(id) ON UPDATE CASCADE ON DELETE SET NULL,
  purpose text,
  purpose_detail text,
  noshow_closed_at timestamptz,
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at) WITH &&) WHERE (((status = ANY (ARRAY['confirmed'::text, 'pending'::text])) AND (auto_cancelled = false) AND (early_ended = false))),
  CONSTRAINT bookings_time_valid CHECK ((end_at > start_at)),
  CONSTRAINT chk_bookings_purpose_code CHECK (((purpose IS NULL) OR (purpose = ANY (ARRAY['audit'::text, 'hr'::text, 'task'::text, 'survey'::text, 'client'::text, 'part'::text, 'team'::text, 'mgmt'::text, 'training'::text, 'etc'::text])))),
  CONSTRAINT chk_bookings_purpose_detail CHECK (((purpose_detail IS NULL) OR ((purpose = 'etc'::text) AND ((char_length(purpose_detail) >= 1) AND (char_length(purpose_detail) <= 40)))))
);
CREATE TABLE public.booking_attendees (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id text REFERENCES public.bookings(id) ON DELETE CASCADE,
  email text NOT NULL, created_at timestamptz DEFAULT now(), name text DEFAULT ''::text
);
CREATE TABLE public.admin_roles (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, user_id uuid NOT NULL, role text NOT NULL,
  granted_at timestamptz DEFAULT now() NOT NULL, granted_by uuid,
  CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role)
);
CREATE TABLE public.admin_role_grants (
  id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, target_user uuid NOT NULL, role text NOT NULL,
  action text NOT NULL, actor uuid, created_at timestamptz DEFAULT now() NOT NULL
);
CREATE TABLE public.noshow_penalties (id bigserial PRIMARY KEY, user_id uuid, starts_at timestamptz, ends_at timestamptz, revoked_at timestamptz);
CREATE TABLE public.noshow_guard_rejections (
  id bigserial PRIMARY KEY, booking_id text, start_at timestamptz, attempted_at timestamptz DEFAULT now(),
  early_by_sec integer, actor_id uuid, db_role text, reason text
);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ── RLS (운영 pg_policies 원문) ──
ALTER TABLE public.bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles       ENABLE ROW LEVEL SECURITY;

CREATE POLICY bookings_read   ON public.bookings FOR SELECT USING (true);
CREATE POLICY bookings_insert ON public.bookings FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY bookings_update ON public.bookings FOR UPDATE USING ((auth.role() = 'authenticated'::text));
CREATE POLICY bookings_delete ON public.bookings FOR DELETE USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1 FROM profiles WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'ADMIN'::text))))));

CREATE POLICY attendees_read  ON public.booking_attendees FOR SELECT USING (true);
CREATE POLICY attendees_write ON public.booking_attendees FOR ALL WITH CHECK (true);

CREATE POLICY profiles_read   ON public.profiles FOR SELECT USING ((auth.role() = 'authenticated'::text));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING ((auth.uid() = id));
CREATE POLICY admins_can_update_profiles ON public.profiles FOR UPDATE TO authenticated
  USING ((( SELECT profiles_1.role FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())) = 'ADMIN'::text))
  WITH CHECK ((( SELECT profiles_1.role FROM profiles profiles_1 WHERE (profiles_1.id = auth.uid())) = 'ADMIN'::text));

CREATE POLICY rooms_read ON public.rooms FOR SELECT USING (true);

-- ── 함수 (운영 원문) ──
CREATE OR REPLACE FUNCTION public.has_admin_role(role_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- 미인증 사용자는 즉시 false
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM admin_roles
    WHERE user_id = auth.uid()
      AND (role = role_name OR role = 'super')
  );
END;
$function$;

CREATE POLICY admin_roles_select_self_or_admin ON public.admin_roles FOR SELECT USING (((user_id = auth.uid()) OR has_admin_role('super'::text) OR has_admin_role('user'::text)));
CREATE POLICY admin_roles_write_super ON public.admin_roles FOR ALL USING (has_admin_role('super'::text)) WITH CHECK (has_admin_role('super'::text));

CREATE OR REPLACE FUNCTION public.noshow_grace_minutes()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT 10 $function$;
CREATE OR REPLACE FUNCTION public.noshow_close_slot_minutes()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ SELECT 15 $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_booking_if_noshow_penalized()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.block_cancel_on_checked_in()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF session_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  IF (OLD.checked_in = TRUE OR OLD.early_ended = TRUE)
     AND (OLD.status != NEW.status
          OR OLD.auto_cancelled != NEW.auto_cancelled)
  THEN
    RAISE EXCEPTION
      'BLOCKED: checked_in/early_ended booking cannot be cancelled (booking_id=%, checked_in=%, early_ended=%)',
      NEW.id, NEW.checked_in, NEW.early_ended
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_noshow_on_checked_in()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 기존에 체크인했거나 조기종료한 예약을 system이 취소/노쇼 처리하려 할 때 차단
  IF (OLD.checked_in = true OR OLD.early_ended = true)
     AND NEW.cancelled_by = 'system'
     AND (NEW.auto_cancelled = true OR NEW.status = 'cancelled')
  THEN
    RAISE EXCEPTION
      'BLOCKED: checked_in/early_ended booking cannot be marked as system-noshow (booking_id=%)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_premature_noshow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.check_booking_date_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_is_admin  BOOLEAN;
  v_jwt_sub   TEXT;
  v_kst_today TIMESTAMPTZ;
  v_kst_limit TIMESTAMPTZ;
BEGIN
  -- JWT에서 호출자 sub 추출 (없으면 NULL)
  BEGIN
    v_jwt_sub := current_setting('request.jwt.claim.sub', true);
  EXCEPTION WHEN OTHERS THEN
    v_jwt_sub := NULL;
  END;

  -- 서비스 롤(cron, admin tool)은 통과 (jwt_sub NULL이면 서버 경로)
  IF v_jwt_sub IS NULL OR v_jwt_sub = '' THEN
    RETURN NEW;
  END IF;

  -- profiles.is_admin 조회
  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_jwt_sub::uuid;

  -- 관리자면 통과
  IF v_is_admin = true THEN
    RETURN NEW;
  END IF;

  -- 일반 사용자: 30일 초과 차단
  -- KST 오늘 자정 ~ +31일 자정 직전까지 허용
  v_kst_today := date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  v_kst_limit := v_kst_today + INTERVAL '31 days';  -- 오늘+31일 00:00 이전까지 = 오늘+30일 23:59:59까지

  IF NEW.start_at >= v_kst_limit THEN
    RAISE EXCEPTION
      '예약은 오늘부터 30일 이내만 가능합니다 (시도한 예약 시작: %, 허용 한계: %)',
      NEW.start_at, v_kst_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.emergency_log_user_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.cancelled_by = 'user'
     AND NEW.status = 'cancelled'
     AND (OLD.cancelled_by IS NULL OR OLD.cancelled_by != 'user') THEN
    -- 호출한 세션 정보를 로그로 남김
    RAISE WARNING '[TRACE] cancel_by=user set on booking % by user=% ip=% app=%',
      NEW.id,
      current_user,
      inet_client_addr(),
      current_setting('application_name', true);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_cancelled_by_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- postgres superuser bypass (사용자님 SQL Editor 수동 복구는 가능)
  IF current_user = 'postgres' OR session_user = 'postgres' THEN
    RETURN NEW;
  END IF;

  -- OLD.cancelled_by가 'user' 또는 'system'으로 박혀있고
  -- NEW가 그 값을 변경하려 하면 차단
  IF OLD.cancelled_by IN ('user', 'system')
     AND COALESCE(NEW.cancelled_by, '') <> OLD.cancelled_by
  THEN
    RAISE EXCEPTION
      'IMMUTABLE_CANCELLED_BY: cancelled_by once set to % cannot change to % (id=%, actor=%, ip=%)',
      OLD.cancelled_by, COALESCE(NEW.cancelled_by, 'NULL'),
      OLD.id, current_user, COALESCE(inet_client_addr()::text, 'local');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.noshow_close_end()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.prevent_past_booking_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- 신규 INSERT 시에만 start_at 검증
  -- 10분 여유: 시계 오차 + "방금 시작한 예약 저장" 허용
  IF NEW.start_at < (now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'Cannot create booking with start_at in the past: % (now: %)', NEW.start_at, now()
      USING ERRCODE = '23514',  -- check_violation
            HINT = '클라이언트의 selectedDate가 stale일 가능성이 있습니다. 브라우저 새로고침 후 재시도해주세요.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_employment_can_create(p_user_id uuid, p_start_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_dep_on date;
BEGIN
  SELECT employment_status, departure_scheduled_on
    INTO v_status, v_dep_on
    FROM public.profiles
   WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN; END IF;  -- 프로필 없는 행(스냅샷 전용)은 기존 동작 유지

  IF v_status = 'leave' THEN
    RAISE EXCEPTION 'LEAVE_CANNOT_CREATE'
      USING HINT = '휴직 중인 사용자는 예약·대여를 생성할 수 없습니다.';
  END IF;

  IF v_status = 'departing'
     AND (p_start_at AT TIME ZONE 'Asia/Seoul')::date > v_dep_on THEN
    RAISE EXCEPTION 'AFTER_DEPARTURE_DATE'
      USING HINT = '퇴사 예정일 이후에 시작하는 예약은 생성할 수 없습니다.';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.assert_employment_can_own(p_user_id uuid, p_start_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_dep_on date;
BEGIN
  SELECT employment_status, departure_scheduled_on
    INTO v_status, v_dep_on
    FROM public.profiles
   WHERE id = p_user_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_status = 'leave' THEN
    RAISE EXCEPTION 'NEW_OWNER_ON_LEAVE'
      USING HINT = '휴직 중인 사용자는 예약자로 지정할 수 없습니다.';
  END IF;

  IF v_status = 'departing'
     AND (p_start_at AT TIME ZONE 'Asia/Seoul')::date > v_dep_on THEN
    RAISE EXCEPTION 'NEW_OWNER_AFTER_DEPARTURE'
      USING HINT = '새 예약자의 퇴사 예정일 이후에 시작하는 예약입니다.';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_employment_guard_bookings()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_employment_can_create(NEW.user_id, NEW.start_at);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_owner_change_employment_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_employment_can_own(NEW.user_id, NEW.start_at);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.prevent_booker_as_attendee()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_booker_email TEXT;
BEGIN
  SELECT p.email INTO v_booker_email
  FROM bookings b
  JOIN profiles p ON b.user_id = p.id
  WHERE b.id = NEW.booking_id;

  IF v_booker_email IS NOT NULL
     AND LOWER(TRIM(NEW.email)) = LOWER(TRIM(v_booker_email)) THEN
    -- 예약자는 참석자로 중복 등록하지 않음
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 트리거 (운영 pg_get_triggerdef 원문) ──
CREATE TRIGGER bookings_updated_at_trigger BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trace_user_cancel BEFORE UPDATE ON public.bookings FOR EACH ROW WHEN (((new.cancelled_by = 'user'::text) AND (new.status = 'cancelled'::text))) EXECUTE FUNCTION emergency_log_user_cancel();
CREATE TRIGGER trg_block_booking_noshow_penalty BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION block_booking_if_noshow_penalized();
CREATE TRIGGER trg_block_cancel_on_checked_in BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION block_cancel_on_checked_in();
CREATE TRIGGER trg_block_noshow_on_checked_in BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION block_noshow_on_checked_in();
CREATE TRIGGER trg_block_premature_noshow BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION block_premature_noshow();
CREATE TRIGGER trg_bookings_employment_guard BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION trg_employment_guard_bookings();
CREATE TRIGGER trg_bookings_owner_employment_guard BEFORE UPDATE OF user_id ON public.bookings FOR EACH ROW WHEN ((old.user_id IS DISTINCT FROM new.user_id)) EXECUTE FUNCTION trg_owner_change_employment_guard();
CREATE TRIGGER trg_check_booking_date_limit_insert BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION check_booking_date_limit();
CREATE TRIGGER trg_check_booking_date_limit_update BEFORE UPDATE OF start_at ON public.bookings FOR EACH ROW WHEN ((new.start_at IS DISTINCT FROM old.start_at)) EXECUTE FUNCTION check_booking_date_limit();
CREATE TRIGGER trg_lock_cancelled_by_immutable BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION lock_cancelled_by_immutable();
CREATE TRIGGER trg_noshow_close_end BEFORE UPDATE ON public.bookings FOR EACH ROW WHEN (((new.cancelled_by = 'system'::text) AND (new.auto_cancelled IS TRUE) AND (old.auto_cancelled IS DISTINCT FROM true))) EXECUTE FUNCTION noshow_close_end();
CREATE TRIGGER trg_prevent_past_booking BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION prevent_past_booking_insert();
CREATE TRIGGER trg_prevent_booker_as_attendee BEFORE INSERT ON public.booking_attendees FOR EACH ROW EXECUTE FUNCTION prevent_booker_as_attendee();

-- ── RPC (운영 원문) ──
CREATE OR REPLACE FUNCTION public.mark_noshow(p_booking_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.sync_booking_attendees(p_booking_id text, p_attendees jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id    uuid;
  v_caller_email text;
  v_is_admin     boolean;
  v_deleted      int;
  v_inserted     int;
BEGIN
  -- ── 0. 인증된 사용자 확인 ──────────────────────────────────────────────
  v_caller_id    := auth.uid();
  v_caller_email := COALESCE(auth.jwt() ->> 'email', '');

  IF v_caller_id IS NULL AND v_caller_email = '' THEN
    RAISE EXCEPTION 'sync_booking_attendees: not authenticated';
  END IF;

  -- ── 1. 권한 검증: 예약자 OR 참석자 OR 관리자 ─────────────────────────
  v_is_admin := EXISTS (
    SELECT 1 FROM profiles
    WHERE id = v_caller_id AND role = 'ADMIN'
  );

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id = p_booking_id
      AND (
        b.user_id    = v_caller_id
        OR b.user_email = v_caller_email
      )
  ) AND NOT EXISTS (
    SELECT 1 FROM booking_attendees
    WHERE booking_id = p_booking_id
      AND LOWER(TRIM(email)) = LOWER(TRIM(v_caller_email))
  ) THEN
    RAISE EXCEPTION 'sync_booking_attendees: permission denied for booking %', p_booking_id;
  END IF;

  -- ── 2. 기존 모두 삭제 (RLS 우회) ──────────────────────────────────────
  DELETE FROM booking_attendees WHERE booking_id = p_booking_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- ── 3. dedupe + INSERT ────────────────────────────────────────────────
  IF p_attendees IS NOT NULL
     AND jsonb_typeof(p_attendees) = 'array'
     AND jsonb_array_length(p_attendees) > 0
  THEN
    INSERT INTO booking_attendees (booking_id, email, name)
    SELECT
      p_booking_id,
      sub.email,
      sub.name
    FROM (
      SELECT DISTINCT ON (LOWER(TRIM(elem ->> 'email')))
        TRIM(elem ->> 'email')           AS email,
        COALESCE(TRIM(elem ->> 'name'), '') AS name
      FROM jsonb_array_elements(p_attendees) AS elem
      WHERE elem ->> 'email' IS NOT NULL
        AND TRIM(elem ->> 'email') != ''
      ORDER BY LOWER(TRIM(elem ->> 'email'))
    ) sub
    WHERE sub.email != '';

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  ELSE
    v_inserted := 0;
  END IF;

  RETURN jsonb_build_object(
    'deleted',  v_deleted,
    'inserted', v_inserted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_change_booking_owner(p_booking_id text, p_new_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id  uuid;
  v_is_admin   boolean;
  v_booking    bookings%ROWTYPE;
  -- 원래 예약자 스냅샷 (퇴사/프로필 삭제 시 bookings 스냅샷으로 fallback)
  v_old_email  text;
  v_old_name   text;
  v_old_dept   text;
  -- 새 예약자 프로필
  v_new_email  text;
  v_new_name   text;
  v_new_dept   text;
  v_new_active boolean;
  v_removed    boolean := false;
BEGIN
  -- ── 1) 인증 확인 ──────────────────────────────────────────────────────────
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = '28000';
  END IF;

  -- ── 2) 호출자 관리자 검증 (profiles.role='ADMIN' AND is_active) ────────────
  --     bookings 도메인 admin 기준은 profiles.role (v2 has_admin_role 아님)
  SELECT (role = 'ADMIN' AND COALESCE(is_active, true))
    INTO v_is_admin
    FROM profiles
   WHERE id = v_caller_id;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'FORBIDDEN_NOT_ADMIN' USING ERRCODE = '42501';
  END IF;

  -- ── 3) 예약 조회 + 행 잠금 (동시성 안전: 동시 변경/취소 race 차단) ──────────
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- ── 4) 변경 가능 범위 가드: 미래 + confirmed (확정 정책 #1) ────────────────
  IF v_booking.status <> 'confirmed' THEN
    RAISE EXCEPTION 'NOT_CONFIRMED' USING ERRCODE = 'P0001';   -- pending/rejected/cancelled 차단
  END IF;
  IF v_booking.start_at <= now() THEN
    RAISE EXCEPTION 'NOT_FUTURE' USING ERRCODE = 'P0001';      -- 진행중/과거 차단
  END IF;
  -- status='confirmed' 외 추가 안전망 (노쇼/조기반납/취소 흔적 차단)
  IF COALESCE(v_booking.auto_cancelled, false)
     OR COALESCE(v_booking.early_ended, false)
     OR v_booking.cancelled_by IS NOT NULL THEN
    RAISE EXCEPTION 'NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  -- ── 5) no-op 방어: 새 예약자가 현재 예약자와 동일 ─────────────────────────
  IF v_booking.user_id = p_new_user_id THEN
    RAISE EXCEPTION 'SAME_OWNER' USING ERRCODE = 'P0001';
  END IF;

  -- ── 6) 새 예약자 프로필 조회 (활성 사용자 + 이메일 필수) ──────────────────
  --     user_email NOT NULL 제약 + isBooker email 경로 보장을 위해 email 필수
  SELECT email, name, dept, COALESCE(is_active, true)
    INTO v_new_email, v_new_name, v_new_dept, v_new_active
    FROM profiles
   WHERE id = p_new_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NEW_OWNER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_new_active THEN
    RAISE EXCEPTION 'NEW_OWNER_INACTIVE' USING ERRCODE = 'P0001';  -- 퇴사자 지정 차단
  END IF;
  IF v_new_email IS NULL OR length(trim(v_new_email)) = 0 THEN
    RAISE EXCEPTION 'NEW_OWNER_NO_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  -- ── 7) 원래 예약자 스냅샷 확보 (알림 payload용) ───────────────────────────
  --     profiles에 있으면 live 우선, 없으면(퇴사/삭제) bookings 스냅샷 fallback
  SELECT p.email, p.name, p.dept
    INTO v_old_email, v_old_name, v_old_dept
    FROM profiles p
   WHERE p.id = v_booking.user_id;
  v_old_email := COALESCE(v_old_email, v_booking.user_email);
  v_old_name  := COALESCE(v_old_name,  v_booking.user_name);
  v_old_dept  := COALESCE(v_old_dept,  v_booking.user_dept);

  -- ── 8) 새 예약자가 기존 참석자면 참석자 목록에서 제거 (확정 정책 #2) ──────
  --     상호배타 §1.3: 한 사람이 같은 예약에서 예약자+참석자 동시 불가
  --     email 정규화(lower) 기준 삭제 — 자동 승격
  DELETE FROM booking_attendees
   WHERE booking_id = p_booking_id
     AND lower(email) = lower(v_new_email);
  IF FOUND THEN
    v_removed := true;
  END IF;

  -- ── 9) 예약자 4-스냅샷 원자적 갱신 ────────────────────────────────────────
  --     user_id + user_email(NOT NULL) + user_name + user_dept 동시 갱신
  UPDATE bookings
     SET user_id    = p_new_user_id,
         user_email = v_new_email,
         user_name  = v_new_name,
         user_dept  = v_new_dept
   WHERE id = p_booking_id;

  -- ── 10) 결과 반환 (App.tsx 알림 페이로드 구성용) ──────────────────────────
  RETURN jsonb_build_object(
    'ok', true,
    'old_booker', jsonb_build_object(
      'user_id', v_booking.user_id,
      'email',   v_old_email,
      'name',    v_old_name,
      'dept',    v_old_dept
    ),
    'new_booker', jsonb_build_object(
      'user_id', p_new_user_id,
      'email',   v_new_email,
      'name',    v_new_name,
      'dept',    v_new_dept
    ),
    'removed_from_attendees', v_removed
  );
END;
$function$;

-- admin_set_user_roles — 운영 prosrc 원문 + 헤더(args·returns·search_path·DEFINER) 실측값으로 재조립
CREATE OR REPLACE FUNCTION public.admin_set_user_roles(p_user_id uuid, p_roles text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_new       text[] := COALESCE(p_roles, ARRAY[]::text[]);
  v_had_super boolean;
  v_will_super boolean;
  v_super_cnt integer;
  r           text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_admin_role('super') THEN
    RAISE EXCEPTION 'NOT_SUPER' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 'zoom' 은 폐기라 신규 부여 금지 (기존 행은 아래 교체로 자연 정리된다)
  IF 'zoom' = ANY(v_new) THEN
    RAISE EXCEPTION 'DEPRECATED_ROLE:zoom' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_user_id AND role = 'super')
    INTO v_had_super;
  v_will_super := 'super' = ANY(v_new);

  -- ② 자기 자신의 super 회수 금지
  IF p_user_id = v_uid AND v_had_super AND NOT v_will_super THEN
    RAISE EXCEPTION 'CANNOT_REVOKE_OWN_SUPER' USING ERRCODE = 'P0001';
  END IF;

  -- ③ 마지막 super 보호
  IF v_had_super AND NOT v_will_super THEN
    SELECT count(*) INTO v_super_cnt FROM public.admin_roles WHERE role = 'super';
    IF v_super_cnt <= 1 THEN
      RAISE EXCEPTION 'LAST_SUPER' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 감사 로그 (교체 전후 차집합) ──────────────────────────────────────
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'revoke', v_uid
    FROM (SELECT role AS x FROM public.admin_roles WHERE user_id = p_user_id) old
   WHERE x <> ALL(v_new);

  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'grant', v_uid
    FROM unnest(v_new) AS x
   WHERE x NOT IN (SELECT role FROM public.admin_roles WHERE user_id = p_user_id);

  -- ── 교체 ──────────────────────────────────────────────────────────────
  DELETE FROM public.admin_roles WHERE user_id = p_user_id;

  FOREACH r IN ARRAY v_new LOOP
    INSERT INTO public.admin_roles (user_id, role, granted_by, granted_at)
    VALUES (p_user_id, r, v_uid, now())
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  -- ── profiles.role 재계산 (트리거 대신 여기서 1회) ────────────────────
  --   어드민 탭 역할이 하나라도 있으면 ADMIN, 없으면 USER.
  --   'workboard' 는 어드민 탭이 없는 일반 뷰 권한이라 재계산에서 제외한다.   ← [2026-09-29 WORKBOARD Phase1]
  UPDATE public.profiles
     SET role = CASE WHEN array_length(array_remove(v_new, 'workboard'), 1) > 0 THEN 'ADMIN' ELSE 'USER' END
   WHERE id = p_user_id;

  RETURN v_new;
END;
$function$;

-- 가드 [D] 검증이 소유자·DEFINER 를 확인하는 나머지 RPC — 본문은 이 시뮬 범위 밖이라 시그니처만 (운영: DEFINER·postgres 소유)
CREATE OR REPLACE FUNCTION public.admin_resolve_noshow(p_booking_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RAISE EXCEPTION 'SIM_NOT_IMPLEMENTED'; END $f$;
CREATE OR REPLACE FUNCTION public.admin_delete_noshow_booking(p_booking_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RAISE EXCEPTION 'SIM_NOT_IMPLEMENTED'; END $f$;
CREATE OR REPLACE FUNCTION public.process_departure(p_user_id uuid, p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RAISE EXCEPTION 'SIM_NOT_IMPLEMENTED'; END $f$;

-- ══ 시드 (트리거 우회: 과거 시각 예약을 넣어야 하므로 replica 모드) ══
SET session_replication_role = replica;
INSERT INTO public.profiles (id, email, name, dept, role, is_active, employment_status) VALUES
  ('11111111-1111-1111-1111-111111111111','u1@cnrres.com','U1예약자','CDI','USER', true,'active'),
  ('22222222-2222-2222-2222-222222222222','u2@cnrres.com','U2참석자','CDI','USER', true,'active'),
  ('33333333-3333-3333-3333-333333333333','u3@cnrres.com','U3외부인','BD', 'USER', true,'active'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','a1@cnrres.com','A1관리자','MS', 'ADMIN',true,'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','old@cnrres.com','레거시ID','MS','USER', true,'active');
INSERT INTO public.admin_roles (user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','approval'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','booking'), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','super');
INSERT INTO public.rooms VALUES (1,'일반1',false),(2,'일반2',false),(3,'2F Emerald',true),(4,'일반4',false),(5,'일반5',false),(6,'일반6',false),(7,'승인룸-시뮬2',true);

INSERT INTO public.bookings (id, room_id, title, start_at, end_at, user_id, user_name, user_dept, user_email, status, checked_in) VALUES
  -- N1 일반·미래·confirmed (예약자 U1, 참석자 U2)
  ('N1', 1, '일반 미래', now()+interval '2 hours', now()+interval '3 hours', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', false),
  -- N3 일반·진행중·체크인 완료 (조기반납용)
  ('N3', 2, '진행중', now()-interval '20 minutes', now()+interval '40 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', true),
  -- N4 일반·시작 15분 경과·미체크인 (노쇼 대상)
  ('N4', 4, '노쇼 대상', now()-interval '15 minutes', now()+interval '45 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', false),
  -- N5 일반·시작 3분 전 (체크인 창)
  ('N5', 5, '체크인 창', now()+interval '3 minutes', now()+interval '63 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', false),
  -- N6 예약자 user_id 가 다른 uuid(레거시)지만 user_email 은 U1 — email 경로 판정
  ('N6', 6, 'email 경로', now()+interval '2 hours', now()+interval '3 hours', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','U1예약자','CDI','U1@CNRRES.COM','confirmed', false),
  -- N7 예약자 프로필 삭제(user_id NULL) — NULL 3값 논리 방어
  ('N7', 6, 'user_id NULL', now()+interval '5 hours', now()+interval '6 hours', NULL,'퇴사자','CDI','gone@cnrres.com','confirmed', false),
  -- E1 승인룸·pending (예약자 U1) — 2026-10-06 사고 형태
  ('E1', 3, '승인 대기', now()+interval '2 hours', now()+interval '3 hours', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','pending', false),
  -- E2 승인룸·승인 완료 (예약자 U1, 참석자 U2)
  ('E2', 3, '승인 완료', now()+interval '6 hours', now()+interval '7 hours', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', false),
  -- E3 승인룸·승인 완료·진행중·체크인 완료 (조기반납용)
  ('E3', 3, '승인룸 진행중', now()-interval '20 minutes', now()+interval '40 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','confirmed', true);
UPDATE public.bookings SET processed_by_name='A1관리자' WHERE id IN ('E2','E3');
-- E4 승인룸(7)·pending·시작 12분 경과 (cron ④ 승인 기한 초과 처리 대상)
INSERT INTO public.bookings (id, room_id, title, start_at, end_at, user_id, user_name, user_dept, user_email, status, checked_in) VALUES
  ('E4', 7, '기한 초과 pending', now()-interval '12 minutes', now()+interval '48 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','pending', false);
INSERT INTO public.booking_attendees (booking_id, email, name) VALUES
  ('N1','  U2@CnrRes.com ','U2참석자'), ('E2','u2@cnrres.com','U2참석자'), ('N7','u2@cnrres.com','U2참석자');
SET session_replication_role = origin;
