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
