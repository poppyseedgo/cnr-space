-- ⚠ LOCAL_ONLY — 운영 정의를 1:1 로 옮긴 스텁 (2026-10-06 실측). 운영에서 실행 금지.
--   · has_admin_role: pg_get_functiondef 원문 + 실행 권한(postgres/authenticated/service_role, anon 없음)
--   · announcements: 컬럼·RLS·정책 2개(대상 역할 public)·테이블 권한(anon/authenticated ALL)
--   · 데이터: 운영 8행(is_active·기간) + 판정 확인용 3행(게시 중 / 게시 예정 / 비활성)
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;

CREATE TABLE public.admin_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, role text, granted_at timestamptz DEFAULT now(), granted_by uuid);

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
REVOKE EXECUTE ON FUNCTION public.has_admin_role(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.has_admin_role(text) TO authenticated, service_role;

-- 운영 기본 권한(pg_default_acl 실측): public 스키마에 새로 만드는 함수는 anon·authenticated·service_role 에 EXECUTE 가 자동 부여된다.
--   (has_admin_role 은 운영에서 anon 권한이 빠져 있으므로 그 뒤에 둔다 — 이후 마이그레이션이 만드는 함수에만 적용)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.announcements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message text NOT NULL,
  bg_color text NOT NULL DEFAULT '#E6F2FF'::text,
  text_color text NOT NULL DEFAULT '#1E1E1E'::text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT ALL ON public.announcements TO anon, authenticated, service_role;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY announcements_select ON public.announcements FOR SELECT
  USING (((is_active AND (now() >= starts_at) AND (now() <= ends_at)) OR has_admin_role('notice'::text)));
CREATE POLICY announcements_admin_write ON public.announcements FOR ALL
  USING (has_admin_role('notice'::text)) WITH CHECK (has_admin_role('notice'::text));

-- 사용자: 일반 / notice 관리자 / super 관리자 / 다른 역할(book)만 가진 관리자
INSERT INTO public.admin_roles (user_id, role) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000002', 'notice'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'super'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'book');

INSERT INTO public.announcements (is_active, starts_at, ends_at, message) VALUES
  ('t','2026-04-21 15:00:00+00','2026-05-06 14:59:59+00','운영1'),
  ('t','2026-07-15 15:00:00+00','2026-07-23 14:59:59+00','운영2'),
  ('t','2026-07-20 15:00:00+00','2026-07-28 14:59:59+00','운영3'),
  ('t','2026-07-21 15:00:00+00','2026-07-29 14:59:59+00','운영4'),
  ('t','2026-07-26 15:00:00+00','2026-08-03 14:59:59+00','운영5'),
  ('t','2026-08-02 15:00:00+00','2026-08-10 14:59:59+00','운영6'),
  ('t','2026-08-03 15:00:00+00','2026-08-31 14:59:59+00','운영7'),
  ('t','2026-09-07 15:00:00+00','2026-09-21 14:59:59+00','운영8'),
  ('t', now() - interval '1 day', now() + interval '1 day',  '시뮬-게시중'),
  ('t', now() + interval '1 day', now() + interval '2 day',  '시뮬-게시예정'),
  ('f', now() - interval '1 day', now() + interval '1 day',  '시뮬-비활성');
