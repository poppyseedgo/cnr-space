-- ============================================================
-- 방문로그(Visitor Log) Phase 1 — DB 기반 (스키마 + RLS + 인증 + Storage)
-- Date: 2026-07-10
-- Project ref: jjzcqpbwkkujttwxksvy  (C&R Space / esg 공유 인스턴스)
-- File: 20260710_visitor_log_phase1_schema.sql
--
-- 목적:
--   동료가 만든 단일 HTML 방문로그(임시 Supabase pnfgmaolozrzcgqnbbqt)를
--   Space 공유 인스턴스로 이관하기 위한 DB 토대.
--
-- 설계 결정 (확정):
--   1) 이미지(이름/소속/서명 PNG)는 base64 컬럼이 아니라 Storage 버킷에 저장,
--      DB에는 경로만. → 공유 운영 DB 비대화 방지 (근본 해결)
--   2) 방문 INSERT는 Phase 2의 visitor-submit Edge Function(service_role)이 전담.
--      → 익명 클라이언트는 테이블/버킷에 직접 접근하지 않음 (전면 잠금)
--   3) 관리자 게이트 = 2단계 AND:
--        ① profiles.role='ADMIN' AND is_active=true  (visitor_is_admin)
--        ② 방문로그 전용 2차 비밀번호 (visitor_settings 해시, pgcrypto)
--      → "직원 중에서도 제한된 인원만" 요건 충족
--   4) 테이블/함수 네이밍: Space 컨벤션(무접두어, snake_case) — visitor_* 로 통일
--      (esg의 esg_ 접두어와 구분. 방문로그는 Space 앱 도메인 기능)
--
-- 전제:
--   - profiles 테이블에 role(text), is_active(boolean) 컬럼 존재
--     (esg_is_admin이 동일 인스턴스에서 is_active를 이미 사용 → 존재 확정)
--     ※ 적용 전 함께 제공한 검증 bash(preflight)로 컬럼 존재 재확인
--
-- Phase 1 범위 (본 파일): 테이블 2개 + 인증/비번 함수 3개 + Storage 버킷/정책
-- Phase 2(다음): visitor-submit / visitor-purge Edge Function + 1년 폐기 cron
--                (Storage 파일 삭제는 service_role 필요 → cron이 Edge 호출)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0) 확장: pgcrypto (2차 비밀번호 해시 crypt/gen_salt)
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ------------------------------------------------------------
-- 1) visitor_logs — 방문 기록 본체
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visitor_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name_img_path text        NOT NULL,   -- Storage(visitor-signatures) 내 이름 필기 PNG 경로
  org_img_path  text        NOT NULL,   -- 〃 소속 필기 PNG 경로
  sig_img_path  text        NOT NULL,   -- 〃 서명 PNG 경로
  purpose       text        NOT NULL,   -- 방문 목적: 점검 / 미팅 / 기타
  card_no       smallint,               -- Visitor Card 번호(1~10). NULL = 미대여
  returned      boolean     NOT NULL DEFAULT false,  -- 카드 반납 여부
  returned_at   timestamptz,            -- 반납 시각 (returned=true일 때만)
  visited_at    timestamptz NOT NULL DEFAULT now(),  -- 방문(작성) 일시 — 1년 폐기 기준
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- purpose 허용값 고정 (프론트 select 옵션과 1:1)
ALTER TABLE public.visitor_logs
  ADD CONSTRAINT visitor_logs_purpose_chk
  CHECK (purpose IN ('점검', '미팅', '기타'));

-- card_no 범위 고정 (1~10 또는 NULL)
ALTER TABLE public.visitor_logs
  ADD CONSTRAINT visitor_logs_card_no_chk
  CHECK (card_no IS NULL OR (card_no BETWEEN 1 AND 10));

-- 반납 정합성: returned=true면 returned_at 필수
ALTER TABLE public.visitor_logs
  ADD CONSTRAINT visitor_logs_returned_chk
  CHECK (returned = false OR returned_at IS NOT NULL);

-- 날짜 내림차순 조회/그룹핑 + 1년 폐기 스캔 인덱스
CREATE INDEX IF NOT EXISTS visitor_logs_visited_at_idx
  ON public.visitor_logs (visited_at DESC);

-- 미반납 카드 조회용 부분 인덱스
CREATE INDEX IF NOT EXISTS visitor_logs_card_open_idx
  ON public.visitor_logs (card_no)
  WHERE card_no IS NOT NULL AND returned = false;

-- RLS 잠금(정책 무): client(anon/authenticated) 전면 차단.
--   · 방문 INSERT → Phase 2 Edge Function(service_role)
--   · 관리 조회/반납/삭제 → Phase 4 RPC(SECURITY DEFINER, 소유자 권한으로 RLS 우회)
ALTER TABLE public.visitor_logs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.visitor_logs IS '방문객 로그. 이미지는 Storage(visitor-signatures) 경로만 저장. RLS 잠금 — service_role/SECURITY DEFINER 함수로만 접근';

-- ------------------------------------------------------------
-- 2) visitor_settings — 방문로그 전용 설정(2차 비밀번호 해시)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.visitor_settings (
  key        text        PRIMARY KEY,          -- 예: 'admin_pw_hash'
  value      text        NOT NULL,             -- bcrypt 해시 (평문 저장 금지)
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid                              -- 마지막 변경 관리자 auth.uid()
);

-- RLS 잠금(정책 무): 해시 유출 방지. SECURITY DEFINER 함수로만 접근.
ALTER TABLE public.visitor_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.visitor_settings IS '방문로그 설정. admin_pw_hash(2차 비밀번호 bcrypt) 보관. RLS 잠금 — 함수 경유만';

-- ------------------------------------------------------------
-- 3) visitor_is_admin() — 게이트 ① (profiles.role='ADMIN' AND is_active)
-- ------------------------------------------------------------
--   Space 어드민 UI 게이트(isAdmin = profiles.role==='ADMIN')와 정합.
--   is_active까지 확인 = 공유 인스턴스(esg_is_admin) 표준과 동일.
CREATE OR REPLACE FUNCTION public.visitor_is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'ADMIN'
      AND is_active = true
  );
$$;

REVOKE EXECUTE ON FUNCTION public.visitor_is_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.visitor_is_admin() TO authenticated;

COMMENT ON FUNCTION public.visitor_is_admin() IS '현재 인증 사용자가 ADMIN(활성)인지. 방문로그 RLS/Storage 정책 게이트 ①';

-- ------------------------------------------------------------
-- 4) visitor_verify_pw() — 게이트 ② (2차 비밀번호 해시 대조, 내부용)
-- ------------------------------------------------------------
--   authenticated에 직접 실행권 부여 안 함. 상위 관리 RPC(Phase 4)에서 내부 호출.
CREATE OR REPLACE FUNCTION public.visitor_verify_pw(p_pw text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_hash text;
BEGIN
  SELECT value INTO v_hash
    FROM public.visitor_settings
    WHERE key = 'admin_pw_hash';
  IF v_hash IS NULL THEN
    RETURN false;                       -- 비번 미설정 = 접근 불가(안전 기본값)
  END IF;
  RETURN crypt(p_pw, v_hash) = v_hash;  -- bcrypt 대조
END;
$$;

REVOKE EXECUTE ON FUNCTION public.visitor_verify_pw(text) FROM PUBLIC;

COMMENT ON FUNCTION public.visitor_verify_pw(text) IS '방문로그 2차 비밀번호 해시 대조(내부용). 게이트 ②. 상위 관리 RPC에서만 호출';

-- ------------------------------------------------------------
-- 5) visitor_set_pw() — 2차 비밀번호 설정/변경 (ADMIN 전용)
-- ------------------------------------------------------------
--   평문 비번을 마이그레이션에 심지 않음. 배포 후 관리자가 UI에서 최초 설정/회전.
CREATE OR REPLACE FUNCTION public.visitor_set_pw(p_new_pw text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  IF NOT public.visitor_is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN: admin only' USING errcode = '42501';
  END IF;
  IF p_new_pw IS NULL OR length(p_new_pw) < 4 THEN
    RAISE EXCEPTION 'PW_TOO_SHORT: min 4 chars' USING errcode = '22023';
  END IF;

  INSERT INTO public.visitor_settings (key, value, updated_at, updated_by)
  VALUES ('admin_pw_hash', crypt(p_new_pw, gen_salt('bf')), now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value      = EXCLUDED.value,
        updated_at = now(),
        updated_by = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.visitor_set_pw(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.visitor_set_pw(text) TO authenticated;

COMMENT ON FUNCTION public.visitor_set_pw(text) IS '방문로그 2차 비밀번호 설정/변경. ADMIN만. bcrypt 저장';

-- ------------------------------------------------------------
-- 6) Storage 버킷 + 정책 (visitor-signatures, private)
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('visitor-signatures', 'visitor-signatures', false)
ON CONFLICT (id) DO NOTHING;

-- 정책: ADMIN만 SELECT(signed URL 생성용). 쓰기/삭제는 정책 무 → service_role만.
--   · 익명/일반 사용자: 읽기 불가 (개인정보 보호)
--   · 방문 업로드(Edge Fn) / 폐기 삭제(cron Edge Fn): service_role로 RLS 우회
DROP POLICY IF EXISTS "visitor_sig_select_admin" ON storage.objects;
CREATE POLICY "visitor_sig_select_admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'visitor-signatures'
    AND public.visitor_is_admin()
  );

COMMIT;
