-- 운영 실측(2026-10-01) 기반 스텁 — 20261005_org_phase1.sql 이 만지는 객체만 1:1 재현
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, dept text, role text DEFAULT 'USER',
  created_at timestamptz DEFAULT now(), employee_id text, azure_user_id text, is_active boolean DEFAULT true,
  avatar_url text, employment_status text DEFAULT 'active', departure_scheduled_on date, returned_on date);
-- 실측 2026-10-01: 15종 (workboard 포함)
CREATE TABLE public.admin_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL,
  granted_at timestamptz DEFAULT now(), granted_by uuid,
  CONSTRAINT admin_roles_role_check CHECK ((role = ANY (ARRAY['workboard'::text, 'dashboard'::text, 'booking'::text, 'approval'::text, 'room'::text, 'user'::text, 'visitor'::text, 'book'::text, 'notification'::text, 'notice'::text, 'resource'::text, 'super'::text, 'kb'::text, 'zoom'::text, 'meeting_room'::text]))),
  CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role));
CREATE TABLE public.departed_users (id uuid PRIMARY KEY, name text, email text, dept text, employee_id text, departed_at timestamptz DEFAULT now(), avatar_url text);
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

-- 운영 원본 그대로 (prosrc 2026-10-01)
CREATE OR REPLACE FUNCTION public.has_admin_role(role_name text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND (role = role_name OR role = 'super'));
END; $$;
CREATE POLICY admin_roles_select_self_or_admin ON public.admin_roles FOR SELECT USING ((user_id = auth.uid()) OR has_admin_role('super') OR has_admin_role('user'));

-- Supabase 기본 권한 재현 (anon/authenticated 가 public 테이블 ALL 을 기본으로 가짐)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 시드 사용자: 고지(super) / 조직도 담당(org 만 — 마이그레이션 후 부여) / 일반 직원
INSERT INTO auth.users VALUES
  ('0120852b-faae-4903-9515-c9c28ecaf76b','gohj@cnrres.com'),
  ('11111111-1111-1111-1111-111111111111','orgadmin@cnrres.com'),
  ('22222222-2222-2222-2222-222222222222','staff@cnrres.com'),
  ('33333333-3333-3333-3333-333333333333','staff2@cnrres.com');
INSERT INTO public.profiles (id,email,name,dept,role) VALUES
  ('0120852b-faae-4903-9515-c9c28ecaf76b','gohj@cnrres.com','고현정','MS','ADMIN'),
  ('11111111-1111-1111-1111-111111111111','orgadmin@cnrres.com','조직담당','MS','ADMIN'),
  ('22222222-2222-2222-2222-222222222222','staff@cnrres.com','직원A','CO','USER'),
  ('33333333-3333-3333-3333-333333333333','staff2@cnrres.com','직원B','CO','USER');
INSERT INTO public.admin_roles (user_id, role) VALUES ('0120852b-faae-4903-9515-c9c28ecaf76b','super');

-- ── Phase 2 용 추가 스텁 (운영 실측 2026-10-01) ──
CREATE OR REPLACE FUNCTION public.is_profile_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text, booking_id text, is_read boolean DEFAULT false, created_at timestamptz DEFAULT now());
CREATE TABLE public.notification_recipients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text, user_id uuid, created_at timestamptz DEFAULT now(), created_by uuid);
CREATE TABLE public.notification_user_prefs (user_id uuid, type text, channel text, enabled boolean);
CREATE OR REPLACE FUNCTION public.notification_required_roles(p_type text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_type = 'book_checkout_created' THEN ARRAY['book']
    WHEN p_type = 'resource_overdue'      THEN ARRAY['resource']
    WHEN p_type = 'resource_hold_conflict' THEN ARRAY['resource']
    WHEN p_type LIKE 'wb\_%'              THEN ARRAY['workboard']
    ELSE NULL
  END
$function$;
-- 운영 원본 그대로 (pg_get_functiondef 2026-10-01)
CREATE OR REPLACE FUNCTION public.notification_resolve_recipients(p_type text, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, email text, name text, dept text, avatar_url text, email_enabled boolean, inapp_enabled boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_roles text[] := public.notification_required_roles(p_type);
  v_e uuid[]; v_des uuid[]; v_int uuid[]; v_final uuid[];
BEGIN
  IF v_roles IS NULL THEN
    SELECT COALESCE(array_agg(p.id), '{}') INTO v_e FROM public.profiles p WHERE p.role = 'ADMIN' AND p.is_active IS DISTINCT FROM false;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT r.user_id), '{}') INTO v_e FROM public.admin_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.role = ANY (v_roles) AND p.is_active IS DISTINCT FROM false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_recipients nr WHERE nr.type = p_type) THEN
    SELECT COALESCE(array_agg(nr.user_id), '{}') INTO v_des FROM public.notification_recipients nr JOIN public.profiles p ON p.id = nr.user_id
     WHERE nr.type = p_type AND p.is_active IS DISTINCT FROM false;
    SELECT COALESCE(array_agg(x), '{}') INTO v_int FROM unnest(v_des) x WHERE x = ANY (v_e);
    IF array_length(v_des, 1) IS NULL THEN v_final := '{}';
    ELSIF array_length(v_int, 1) IS NOT NULL THEN v_final := v_int;
    ELSE v_final := v_e; END IF;
  ELSE
    v_final := v_e;
  END IF;
  RETURN QUERY
    SELECT p.id, COALESCE(p.email, ''), COALESCE(p.name, ''), COALESCE(p.dept, ''), p.avatar_url,
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs x WHERE x.user_id = p.id AND x.type = p_type AND x.channel = 'email' AND NOT x.enabled),
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs x WHERE x.user_id = p.id AND x.type = p_type AND x.channel = 'inapp' AND NOT x.enabled)
      FROM unnest(v_final) f(id) JOIN public.profiles p ON p.id = f.id
     WHERE p_exclude IS NULL OR p.id <> p_exclude
     ORDER BY p.name;
END $function$;
-- 운영 원본 그대로 (20260735)
CREATE OR REPLACE FUNCTION public.admin_set_employment_status(p_user_id uuid, p_status text, p_departure_on date DEFAULT NULL::date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_row public.profiles%ROWTYPE;
BEGIN
  IF NOT (public.is_profile_admin() OR public.has_admin_role('user')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = '사용자 관리 권한이 필요합니다.';
  END IF;
  IF p_status NOT IN ('active','departing','leave','returned') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF p_status = 'departing' THEN
    IF p_departure_on IS NULL THEN RAISE EXCEPTION 'DEPARTURE_DATE_REQUIRED' USING HINT = '퇴사 예정일을 지정해야 합니다.'; END IF;
    IF p_departure_on < (now() AT TIME ZONE 'Asia/Seoul')::date THEN RAISE EXCEPTION 'DEPARTURE_DATE_PAST' USING HINT = '퇴사 예정일은 오늘 이후여야 합니다.'; END IF;
  END IF;
  UPDATE public.profiles SET employment_status = p_status,
    departure_scheduled_on = CASE WHEN p_status = 'departing' THEN p_departure_on ELSE NULL END,
    returned_on = CASE WHEN p_status = 'returned' THEN (now() AT TIME ZONE 'Asia/Seoul')::date ELSE NULL END
  WHERE id = p_user_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('user_id', v_row.id, 'employment_status', v_row.employment_status, 'departure_scheduled_on', v_row.departure_scheduled_on, 'returned_on', v_row.returned_on);
END $function$;
-- 사번(employee_id) = sync 관리 계정 표식
UPDATE public.profiles SET employee_id = 'E' || substr(id::text, 1, 4);
-- 스텁 생성 시점 이전 테이블에도 Supabase 기본 권한 재현
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
