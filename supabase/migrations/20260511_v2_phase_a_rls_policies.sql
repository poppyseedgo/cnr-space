-- ============================================================
-- C&R Space v2.0 Phase A: Row Level Security Policies
-- Date: 2026-05-11
-- File: 20260511_v2_phase_a_rls_policies.sql
--
-- 전제 조건:
--   - 스키마 r5 적용 완료 (10개 테이블 + RLS ENABLE 상태)
--   - 모든 테이블이 정책 없는 RLS 잠금 상태에서 시작 (service_role만 접근 가능)
--
-- 적용 후:
--   - 일반 사용자(authenticated): 본인 데이터 + 공개 자원 접근 가능
--   - 시스템별 관리자(meeting_room/zoom/pointer/book): 해당 모듈 전체 권한
--   - super 관리자: 모든 모듈 전체 권한
--   - service_role(Edge Function): RLS 우회, 모든 작업 가능
--   - anon(미인증): 전부 차단
--
-- 정책 명명 규칙: <테이블>_<액션>_<주체>
--   예: zoom_bookings_select_all, zoom_bookings_update_self_or_admin
-- ============================================================

BEGIN;

-- ============================================================
-- 0) Helper Function: has_admin_role(role_name)
-- ============================================================
-- 현재 인증된 사용자가 특정 admin 역할(또는 super)을 가졌는지 검증.
-- SECURITY DEFINER로 admin_roles 테이블의 RLS를 우회하여 무한 재귀 방지.
-- search_path 고정으로 schema injection 방지.

CREATE OR REPLACE FUNCTION public.has_admin_role(role_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
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
$$;

-- 일반 사용자는 함수 실행 가능, PUBLIC은 차단
REVOKE EXECUTE ON FUNCTION public.has_admin_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_admin_role(text) TO authenticated;

COMMENT ON FUNCTION public.has_admin_role(text) IS '현재 인증된 사용자가 특정 admin 역할(또는 super)을 가졌는지 확인. RLS 정책 내에서 사용';


-- ============================================================
-- 1) admin_roles 정책
-- ============================================================
-- 보안 원칙: 누가 admin인지 일반 사용자에게 노출하지 않음.
-- 본인의 admin 권한은 본인이 볼 수 있고, super만 admin_roles 전체를 봄/수정.

-- SELECT: 본인 권한 + super
CREATE POLICY "admin_roles_select_self_or_super" ON admin_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('super')
  );

-- INSERT/UPDATE/DELETE: super만 가능
CREATE POLICY "admin_roles_write_super" ON admin_roles
  FOR ALL TO authenticated
  USING (has_admin_role('super'))
  WITH CHECK (has_admin_role('super'));


-- ============================================================
-- 2) zoom_accounts 정책 (9개 sub-user 메타)
-- ============================================================
-- SELECT: 인증된 모든 사용자 (예약 UI에서 9개 풀 표시용)
CREATE POLICY "zoom_accounts_select_all" ON zoom_accounts
  FOR SELECT TO authenticated
  USING (true);

-- INSERT/UPDATE/DELETE: zoom 또는 super 관리자
CREATE POLICY "zoom_accounts_write_admin" ON zoom_accounts
  FOR ALL TO authenticated
  USING (has_admin_role('zoom'))
  WITH CHECK (has_admin_role('zoom'));


-- ============================================================
-- 3) zoom_oauth_token 정책 (민감 - 토큰)
-- ============================================================
-- 정책 없음 = service_role 외 어떤 role도 접근 불가.
-- Edge Function (create-zoom-meeting 등)만 토큰 read/write.
-- 일반 사용자는 절대 토큰 노출 안 됨.


-- ============================================================
-- 4) zoom_bookings 정책
-- ============================================================
-- SELECT: 인증된 모든 사용자 (캘린더에서 가용 시간대 확인용 - 회의실 패턴과 일치)
--   ⚠️ 다른 사용자의 user_id, title도 노출됨. 프라이버시 강화 필요 시 별도 VIEW로 분리.
CREATE POLICY "zoom_bookings_select_all" ON zoom_bookings
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: 본인 user_id로만 가능
CREATE POLICY "zoom_bookings_insert_self" ON zoom_bookings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: 본인 또는 zoom 관리자. user_id 변경 방지(WITH CHECK도 동일 조건).
CREATE POLICY "zoom_bookings_update_self_or_admin" ON zoom_bookings
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('zoom')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR has_admin_role('zoom')
  );

-- DELETE: 관리자만. 일반 사용자는 UPDATE로 status='cancelled' 처리.
CREATE POLICY "zoom_bookings_delete_admin" ON zoom_bookings
  FOR DELETE TO authenticated
  USING (has_admin_role('zoom'));


-- ============================================================
-- 5) pointer_types, pointer_items 정책 (공개 자원)
-- ============================================================
-- SELECT: 인증된 모든 사용자 (대여 UI에서 종류/재고 표시용)
CREATE POLICY "pointer_types_select_all" ON pointer_types
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pointer_items_select_all" ON pointer_items
  FOR SELECT TO authenticated
  USING (true);

-- Write: pointer 또는 super 관리자만 (재고 관리)
CREATE POLICY "pointer_types_write_admin" ON pointer_types
  FOR ALL TO authenticated
  USING (has_admin_role('pointer'))
  WITH CHECK (has_admin_role('pointer'));

CREATE POLICY "pointer_items_write_admin" ON pointer_items
  FOR ALL TO authenticated
  USING (has_admin_role('pointer'))
  WITH CHECK (has_admin_role('pointer'));
-- 주의: pointer_items.status는 대여/반납 시 Edge Function이 service_role로 UPDATE.
--       일반 사용자가 직접 status 변경 못 함 (관리자만).


-- ============================================================
-- 6) pointer_checkouts 정책
-- ============================================================
-- SELECT: 본인 대여 이력만 (대여는 개인적, 다른 사람 거 안 보임). 관리자는 전체.
CREATE POLICY "pointer_checkouts_select_self_or_admin" ON pointer_checkouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('pointer')
  );

-- INSERT: 본인만
CREATE POLICY "pointer_checkouts_insert_self" ON pointer_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: 본인(반납) 또는 관리자
CREATE POLICY "pointer_checkouts_update_self_or_admin" ON pointer_checkouts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('pointer')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR has_admin_role('pointer')
  );

-- DELETE: 관리자만
CREATE POLICY "pointer_checkouts_delete_admin" ON pointer_checkouts
  FOR DELETE TO authenticated
  USING (has_admin_role('pointer'));


-- ============================================================
-- 7) book_categories, books 정책 (공개 자원)
-- ============================================================
CREATE POLICY "book_categories_select_all" ON book_categories
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "books_select_all" ON books
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "book_categories_write_admin" ON book_categories
  FOR ALL TO authenticated
  USING (has_admin_role('book'))
  WITH CHECK (has_admin_role('book'));

CREATE POLICY "books_write_admin" ON books
  FOR ALL TO authenticated
  USING (has_admin_role('book'))
  WITH CHECK (has_admin_role('book'));


-- ============================================================
-- 8) book_checkouts 정책
-- ============================================================
CREATE POLICY "book_checkouts_select_self_or_admin" ON book_checkouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('book')
  );

CREATE POLICY "book_checkouts_insert_self" ON book_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "book_checkouts_update_self_or_admin" ON book_checkouts
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('book')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR has_admin_role('book')
  );

CREATE POLICY "book_checkouts_delete_admin" ON book_checkouts
  FOR DELETE TO authenticated
  USING (has_admin_role('book'));


COMMIT;


-- ============================================================
-- 사후 작업: 첫 super 관리자 INSERT (별도 실행 필요)
-- ============================================================
-- 첫 super 관리자는 service_role(SQL Editor 또는 postgres role)로 직접 INSERT.
-- RLS 정책 자체가 "super 사용자 존재" 가정으로 동작하므로 이게 부트스트랩.
--
-- 실행 예시 (고지님 user_id 확인 후):
--   SELECT id, email FROM auth.users WHERE email = 'gohyunjung@cnrres.com';
--
--   INSERT INTO admin_roles (user_id, role)
--   VALUES ('<위에서 확인한 uuid>', 'super');
--
-- 이후 super는 admin_roles 정책에 따라 추가 관리자 INSERT 가능.


-- ============================================================
-- 검증 쿼리 (적용 후 실행)
-- ============================================================

-- 정책 개수 확인 (기대값: 약 20개)
SELECT schemaname, tablename, count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'admin_roles', 'zoom_accounts', 'zoom_oauth_token', 'zoom_bookings',
    'pointer_types', 'pointer_items', 'pointer_checkouts',
    'book_categories', 'books', 'book_checkouts'
  )
GROUP BY schemaname, tablename
ORDER BY tablename;

-- 헬퍼 함수 존재 확인
SELECT proname, prosecdef AS is_security_definer
FROM pg_proc
WHERE proname = 'has_admin_role';

-- zoom_oauth_token 정책 없음 확인 (기대값: 0 rows)
SELECT * FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'zoom_oauth_token';
