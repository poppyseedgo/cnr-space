-- ============================================================
-- 20260716_library_rls_update.sql
-- 도서관 모듈 RLS 정합화 (근본 원인 수정)
-- ============================================================
-- 배경:
--   · 프론트엔드 isAdmin = (profiles.role = 'ADMIN')   [useAuth.tsx:254]
--   · 기존 도서 RLS       = has_admin_role('book')     [admin_roles 테이블 기반]
--   → 두 관리자 판별 체계가 분리되어 서로 연결되지 않음.
--     profiles.role='ADMIN' 관리자는 도서관 UI는 보이지만
--     admin_roles에 'book' 행이 없으면 모든 쓰기가 RLS에 막혀
--     "new row violates row-level security policy" 로 전부 실패.
--
--   추가로 book_checkouts INSERT 정책이 WITH CHECK (user_id = auth.uid()) 뿐이라
--   "관리자가 직원 대신 대여"(핵심 기능)가 구조적으로 불가능했음.
--
-- 해결 원칙 (임시방편 아님):
--   RLS 쓰기 권한을  has_admin_role('book')  OR  is_profile_admin()  로 확장.
--   → 세분화된 admin_roles('book') 권한과, 운영상 실제 사용하는
--     profiles.role='ADMIN' 관리자 모델을 "둘 다" 인정하여 정합화.
--   → book_checkouts INSERT/UPDATE에 관리자 분기를 추가하여 타인 대여 허용.
--
-- 멱등(idempotent): 재실행 안전. DROP IF EXISTS + CREATE OR REPLACE.
--
-- 배포:
--   supabase db push --project-ref jjzcqpbwkkujttwxksvy
--   (또는 Supabase SQL Editor에 전체 붙여넣기 실행)
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 0) Helper: 현재 인증 사용자가 profiles.role = 'ADMIN' 인지 확인
--    · SECURITY DEFINER 로 profiles RLS 우회 → 정책 내 재귀/권한 문제 방지
--    · has_admin_role() 와 동일한 패턴
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_profile_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
      AND role = 'ADMIN'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_profile_admin() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_profile_admin() TO authenticated;

COMMENT ON FUNCTION public.is_profile_admin() IS
  '현재 인증 사용자의 profiles.role 이 ADMIN 인지 확인 (도서관 RLS 정책용). SECURITY DEFINER.';


-- ─────────────────────────────────────────────────────────────
-- 1) book_categories: 쓰기 정책 확장
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "book_categories_write_admin" ON book_categories;
CREATE POLICY "book_categories_write_admin" ON book_categories
  FOR ALL TO authenticated
  USING      (has_admin_role('book') OR is_profile_admin())
  WITH CHECK (has_admin_role('book') OR is_profile_admin());


-- ─────────────────────────────────────────────────────────────
-- 2) books: 쓰기 정책 확장 (추가 / 수정 / 삭제 / CSV 일괄등록)
--    · SELECT("books_select_all")는 전 직원 열람이므로 변경하지 않음
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "books_write_admin" ON books;
CREATE POLICY "books_write_admin" ON books
  FOR ALL TO authenticated
  USING      (has_admin_role('book') OR is_profile_admin())
  WITH CHECK (has_admin_role('book') OR is_profile_admin());


-- ─────────────────────────────────────────────────────────────
-- 3) book_checkouts: SELECT — 관리자는 전체 대여현황 조회 가능
--    (일반 직원은 본인 대여만; 도서 상태는 books.status로 별도 표시)
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "book_checkouts_select_self_or_admin" ON book_checkouts;
CREATE POLICY "book_checkouts_select_self_or_admin" ON book_checkouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('book')
    OR is_profile_admin()
  );


-- ─────────────────────────────────────────────────────────────
-- 4) book_checkouts: INSERT — 관리자 "타인 대여" 허용 (핵심 수정)
--    · 기존: WITH CHECK (user_id = auth.uid()) → 관리자 대리 대여 불가
--    · 변경: 관리자면 임의 user_id 로 대여 기록 삽입 가능
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "book_checkouts_insert_self"          ON book_checkouts;
DROP POLICY IF EXISTS "book_checkouts_insert_self_or_admin" ON book_checkouts;
CREATE POLICY "book_checkouts_insert_self_or_admin" ON book_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR has_admin_role('book')
    OR is_profile_admin()
  );


-- ─────────────────────────────────────────────────────────────
-- 5) book_checkouts: UPDATE — 관리자 반납 처리 허용
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "book_checkouts_update_self_or_admin" ON book_checkouts;
CREATE POLICY "book_checkouts_update_self_or_admin" ON book_checkouts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('book')
    OR is_profile_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR has_admin_role('book')
    OR is_profile_admin()
  );


-- ─────────────────────────────────────────────────────────────
-- 6) book_checkouts: DELETE — 관리자만
-- ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "book_checkouts_delete_admin" ON book_checkouts;
CREATE POLICY "book_checkouts_delete_admin" ON book_checkouts
  FOR DELETE TO authenticated
  USING (has_admin_role('book') OR is_profile_admin());


-- ─────────────────────────────────────────────────────────────
-- 7) Storage: book-covers 버킷 (카카오 표지 영구 저장)
--    · search-book Edge Function이 service_role로 업로드 → Storage RLS 우회
--    · 브라우저에서 표지를 보려면 public 버킷이어야 함
--    · 이미 존재하면 public=true 로만 보정
-- ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('book-covers', 'book-covers', true)
ON CONFLICT (id) DO UPDATE SET public = true;

COMMIT;


-- ============================================================
-- 검증 쿼리 (COMMIT 이후 실행 — 결과 육안 확인용)
-- ============================================================

-- 7-1. 헬퍼 함수 존재 확인 (1행이면 정상)
SELECT proname, prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'is_profile_admin';

-- 7-2. 도서 관련 정책 전수 확인
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('books', 'book_categories', 'book_checkouts')
ORDER BY tablename, cmd, policyname;

-- 7-3. book-covers 버킷 public 확인 (public=true 면 정상)
SELECT id, name, public FROM storage.buckets WHERE id = 'book-covers';

-- 7-4. (선택) 특정 사용자가 관리자로 인식되는지 확인
--   SELECT id, email, role FROM profiles WHERE email = 'gohyunjung@cnrres.com';
--   → role 이 'ADMIN' 이어야 도서 쓰기 가능
