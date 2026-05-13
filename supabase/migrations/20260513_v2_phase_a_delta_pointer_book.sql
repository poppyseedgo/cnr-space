-- ============================================================
-- C&R Space v2.0 Phase A Delta: 누락된 16개 RLS 정책 추가
-- Date: 2026-05-13
-- File: 20260513_v2_phase_a_delta_pointer_book.sql
--
-- 배경:
--   원본 20260511_v2_phase_a_rls_policies.sql 적용 시 zoom_bookings까지
--   8개 정책만 적용되고 pointer/book 섹션이 누락된 것을 진단으로 확인.
--   이 파일은 누락된 16개 정책만 추가 (기존 8개는 그대로 보존).
--
-- 사전 조건:
--   - has_admin_role() 함수가 이미 존재 (원본 파일에서 생성됨)
--   - 8개 정책이 이미 존재 (admin_roles, zoom_accounts, zoom_bookings)
--   - 첫 super 관리자가 admin_roles에 INSERT된 상태
-- ============================================================

BEGIN;

-- ============================================================
-- pointer_types, pointer_items 정책 (4개)
-- ============================================================
CREATE POLICY "pointer_types_select_all" ON pointer_types
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pointer_items_select_all" ON pointer_items
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "pointer_types_write_admin" ON pointer_types
  FOR ALL TO authenticated
  USING (has_admin_role('pointer'))
  WITH CHECK (has_admin_role('pointer'));

CREATE POLICY "pointer_items_write_admin" ON pointer_items
  FOR ALL TO authenticated
  USING (has_admin_role('pointer'))
  WITH CHECK (has_admin_role('pointer'));


-- ============================================================
-- pointer_checkouts 정책 (4개)
-- ============================================================
CREATE POLICY "pointer_checkouts_select_self_or_admin" ON pointer_checkouts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('pointer')
  );

CREATE POLICY "pointer_checkouts_insert_self" ON pointer_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

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

CREATE POLICY "pointer_checkouts_delete_admin" ON pointer_checkouts
  FOR DELETE TO authenticated
  USING (has_admin_role('pointer'));


-- ============================================================
-- book_categories, books 정책 (4개)
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
-- book_checkouts 정책 (4개)
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
-- 검증 쿼리
-- ============================================================

-- 1) 총 정책 개수 (기대값: 24)
SELECT count(*) AS total_policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'admin_roles', 'zoom_accounts', 'zoom_bookings',
    'pointer_types', 'pointer_items', 'pointer_checkouts',
    'book_categories', 'books', 'book_checkouts'
  );

-- 2) 테이블별 정책 개수 (기대값: 9 rows, 모두 일치)
SELECT
  tablename,
  count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'admin_roles', 'zoom_accounts', 'zoom_bookings',
    'pointer_types', 'pointer_items', 'pointer_checkouts',
    'book_categories', 'books', 'book_checkouts'
  )
GROUP BY tablename
ORDER BY tablename;
-- 기대:
--   admin_roles        | 2
--   book_categories    | 2
--   book_checkouts     | 4
--   books              | 2
--   pointer_checkouts  | 4
--   pointer_items      | 2
--   pointer_types      | 2
--   zoom_accounts      | 2
--   zoom_bookings      | 4
