-- 운영 실측(2026-09-29) 기반 스텁 — 마이그레이션이 만지는 객체만 1:1 재현
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
-- auth.uid() 스텁: SET request.jwt.claim.sub 로 사용자 전환
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE public.profiles (id uuid PRIMARY KEY, email text, name text, dept text, role text DEFAULT 'USER',
  created_at timestamptz DEFAULT now(), employee_id text, azure_user_id text, is_active boolean DEFAULT true,
  avatar_url text, employment_status text, departure_scheduled_on date, returned_on date);
CREATE TABLE public.admin_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL,
  granted_at timestamptz DEFAULT now(), granted_by uuid,
  CONSTRAINT admin_roles_role_check CHECK ((role = ANY (ARRAY['dashboard'::text, 'booking'::text, 'approval'::text, 'room'::text, 'user'::text, 'visitor'::text, 'book'::text, 'notification'::text, 'notice'::text, 'resource'::text, 'super'::text, 'kb'::text, 'zoom'::text, 'meeting_room'::text]))),
  CONSTRAINT admin_roles_user_id_role_key UNIQUE (user_id, role));
CREATE TABLE public.admin_role_grants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_user uuid, role text, action text, actor uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.departed_users (id uuid PRIMARY KEY, name text, email text, dept text, employee_id text, departed_at timestamptz DEFAULT now(), avatar_url text);
CREATE TABLE public.holidays (holiday_date date PRIMARY KEY, name text, source text, created_at timestamptz, updated_at timestamptz, kind text);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text, booking_id text, is_read boolean DEFAULT false, created_at timestamptz DEFAULT now());
ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_admin_role(role_name text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM admin_roles WHERE user_id = auth.uid() AND (role = role_name OR role = 'super'));
END; $$;
CREATE POLICY admin_roles_select_self_or_admin ON public.admin_roles FOR SELECT USING ((user_id = auth.uid()) OR has_admin_role('super') OR has_admin_role('user'));
CREATE POLICY admin_roles_write_super ON public.admin_roles FOR ALL USING (has_admin_role('super')) WITH CHECK (has_admin_role('super'));

-- 운영 원본 그대로 (pg_get_functiondef 2026-09-29)
CREATE OR REPLACE FUNCTION public.admin_set_user_roles(p_user_id uuid, p_roles text[])
 RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_new text[] := COALESCE(p_roles, ARRAY[]::text[]);
  v_had_super boolean; v_will_super boolean; v_super_cnt integer; r text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.has_admin_role('super') THEN RAISE EXCEPTION 'NOT_SUPER' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF 'zoom' = ANY(v_new) THEN RAISE EXCEPTION 'DEPRECATED_ROLE:zoom' USING ERRCODE = 'P0001'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_user_id AND role = 'super') INTO v_had_super;
  v_will_super := 'super' = ANY(v_new);
  IF p_user_id = v_uid AND v_had_super AND NOT v_will_super THEN RAISE EXCEPTION 'CANNOT_REVOKE_OWN_SUPER' USING ERRCODE = 'P0001'; END IF;
  IF v_had_super AND NOT v_will_super THEN
    SELECT count(*) INTO v_super_cnt FROM public.admin_roles WHERE role = 'super';
    IF v_super_cnt <= 1 THEN RAISE EXCEPTION 'LAST_SUPER' USING ERRCODE = 'P0001'; END IF;
  END IF;
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'revoke', v_uid FROM (SELECT role AS x FROM public.admin_roles WHERE user_id = p_user_id) old WHERE x <> ALL(v_new);
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'grant', v_uid FROM unnest(v_new) AS x WHERE x NOT IN (SELECT role FROM public.admin_roles WHERE user_id = p_user_id);
  DELETE FROM public.admin_roles WHERE user_id = p_user_id;
  FOREACH r IN ARRAY v_new LOOP
    INSERT INTO public.admin_roles (user_id, role, granted_by, granted_at) VALUES (p_user_id, r, v_uid, now()) ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
  UPDATE public.profiles SET role = CASE WHEN array_length(v_new, 1) > 0 THEN 'ADMIN' ELSE 'USER' END WHERE id = p_user_id;
  RETURN v_new;
END; $function$;

-- 데이터: super 1명(고지), 일반 관리자 1명, 일반 직원 1명
INSERT INTO auth.users VALUES ('0120852b-faae-4903-9515-c9c28ecaf76b','goji@x'), ('11111111-1111-1111-1111-111111111111','admin1@x'), ('22222222-2222-2222-2222-222222222222','staff@x');
INSERT INTO public.profiles (id,email,name,role) VALUES ('0120852b-faae-4903-9515-c9c28ecaf76b','goji@x','고현정','ADMIN'), ('11111111-1111-1111-1111-111111111111','admin1@x','관리자1','ADMIN'), ('22222222-2222-2222-2222-222222222222','staff@x','직원','USER');
INSERT INTO public.admin_roles (user_id, role) VALUES ('0120852b-faae-4903-9515-c9c28ecaf76b','super'), ('11111111-1111-1111-1111-111111111111','book'), ('11111111-1111-1111-1111-111111111111','notice');
INSERT INTO public.holidays VALUES ('2026-10-03','개천절','api',now(),now(),'holiday'), ('2026-10-09','한글날','api',now(),now(),'holiday');
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
