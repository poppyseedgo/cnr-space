-- ⚠ LOCAL_ONLY — 로컬 PG 시뮬 전용 스텁. 운영 실행 금지 (가짜 사용자 데이터 포함).
-- 운영(jjzcqpbwkkujttwxksvy) 2026-11-19 실측 정의를 옮김:
--   has_admin_role · admin_set_user_roles(prosrc md5 3e6aaf80edd47d74431a8070457c81dd) = pg_get_functiondef 원문
--   admin_roles_role_check = pg_get_constraintdef 원문 / Supabase 기본 권한(anon·authenticated·service_role ALL) 재현
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, email text, name text, dept text, role text DEFAULT 'USER',
  employee_id text, is_active boolean DEFAULT true, employee_no text
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_read ON public.profiles FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TABLE public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role text NOT NULL,
  granted_at timestamptz DEFAULT now(), granted_by uuid,
  CONSTRAINT admin_roles_role_check CHECK ((role = ANY (ARRAY['org'::text, 'workboard'::text, 'dashboard'::text, 'booking'::text, 'approval'::text, 'room'::text, 'user'::text, 'visitor'::text, 'book'::text, 'notification'::text, 'notice'::text, 'resource'::text, 'super'::text, 'kb'::text, 'zoom'::text, 'meeting_room'::text]))),
  UNIQUE (user_id, role)
);
CREATE TABLE public.admin_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_user uuid, role text, action text, actor uuid, created_at timestamptz DEFAULT now()
);

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
$function$
;

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
$function$
;
REVOKE ALL ON FUNCTION public.has_admin_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_roles(uuid,text[]) FROM PUBLIC, anon;

-- 가짜 사용자 (LOCAL 전용)
INSERT INTO public.profiles (id, email, name, role, employee_no) VALUES
 ('00000000-0000-0000-0000-00000000000a','a@sim.local','시뮬A','USER','20990001'),
 ('00000000-0000-0000-0000-00000000000b','b@sim.local','시뮬B_Sim B_DM','USER','20990002'),
 ('00000000-0000-0000-0000-00000000000c','ga@sim.local','시뮬GA','USER','20990003'),
 ('00000000-0000-0000-0000-00000000000d','super@sim.local','시뮬SUPER','ADMIN','20990004'),
 ('00000000-0000-0000-0000-00000000000e','nosabun@sim.local','시뮬사번없음','USER',NULL);
INSERT INTO public.admin_roles (user_id, role) VALUES ('00000000-0000-0000-0000-00000000000d','super');
