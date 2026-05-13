-- ============================================================
-- C&R Space v2.0 Phase B-Supp: 포인터/도서 RPC 함수
-- Date: 2026-05-13
-- File: 20260513_v2_phase_b_supp_rpc_functions.sql
--
-- 목적:
--   포인터/도서 대여·반납·연장 작업은 두 테이블 (checkouts + items/books)
--   상태를 원자적으로 변경해야 합니다. 일반 사용자는 books/items 테이블에
--   UPDATE 권한이 없으므로 SECURITY DEFINER 함수로 RLS를 우회하면서
--   본인 검증 + 비즈니스 규칙 검증을 함수 내부에서 직접 수행합니다.
--
-- 함수 목록:
--   1) borrow_pointer(item_id, due_at, notes)  → 포인터 대여
--   2) return_pointer(checkout_id)              → 포인터 반납
--   3) borrow_book(book_id)                     → 도서 대여
--   4) return_book(checkout_id)                 → 도서 반납
--   5) extend_book_checkout(checkout_id)        → 도서 연장 (1회 한정)
--
-- 공통 설계:
--   - SET search_path 고정 (schema injection 방지)
--   - SELECT FOR UPDATE로 동시성 보호
--   - 명시적 권한 GRANT (REVOKE FROM PUBLIC + GRANT TO authenticated)
--   - 함수는 변경된 row를 RETURN → 클라이언트가 캐시 즉시 갱신 가능
--
-- 사용 예시 (Frontend):
--   const { data, error } = await supabase.rpc('borrow_pointer', {
--     p_item_id: 3,
--     p_due_at: '2026-05-14T18:00:00+09:00',
--     p_notes: '자리에서 사용'
--   });
-- ============================================================

BEGIN;


-- ============================================================
-- 1) borrow_pointer: 포인터 대여
-- ============================================================
CREATE OR REPLACE FUNCTION public.borrow_pointer(
  p_item_id int,
  p_due_at  timestamptz,
  p_notes   text DEFAULT NULL
)
RETURNS pointer_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id      uuid;
  v_item_status  text;
  v_new_checkout pointer_checkouts;
BEGIN
  -- 1. 인증 확인
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 2. 입력 검증
  IF p_due_at <= now() THEN
    RAISE EXCEPTION '반납 예정일은 현재 시각보다 이후여야 합니다' USING ERRCODE = '22023';
  END IF;

  IF p_due_at > now() + interval '7 days' THEN
    RAISE EXCEPTION '포인터 대여 기간은 최대 7일까지 가능합니다' USING ERRCODE = '22023';
  END IF;

  -- 3. 개체 잠금 + 상태 확인 (동시 대여 방지)
  SELECT status INTO v_item_status
  FROM pointer_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '포인터 % 를 찾을 수 없습니다', p_item_id USING ERRCODE = 'P0002';
  END IF;

  IF v_item_status <> 'available' THEN
    RAISE EXCEPTION '포인터 % 는 현재 대여할 수 없습니다 (상태: %)', p_item_id, v_item_status
      USING ERRCODE = '22023';
  END IF;

  -- 4. checkouts INSERT
  --    partial unique index `idx_pointer_checkouts_active_item_unique` 가
  --    active 중복 INSERT를 추가 차단 (race 안전망)
  INSERT INTO pointer_checkouts (item_id, user_id, due_at, notes, status)
  VALUES (p_item_id, v_user_id, p_due_at, p_notes, 'active')
  RETURNING * INTO v_new_checkout;

  -- 5. items.status = 'borrowed'
  UPDATE pointer_items
  SET status = 'borrowed'
  WHERE id = p_item_id;

  RETURN v_new_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.borrow_pointer(int, timestamptz, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.borrow_pointer(int, timestamptz, text) TO authenticated;

COMMENT ON FUNCTION public.borrow_pointer(int, timestamptz, text) IS
  '포인터 대여. checkouts INSERT + items.status=borrowed를 원자적으로 처리. 본인 user_id로 자동 INSERT.';


-- ============================================================
-- 2) return_pointer: 포인터 반납
-- ============================================================
CREATE OR REPLACE FUNCTION public.return_pointer(p_checkout_id uuid)
RETURNS pointer_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id  uuid;
  v_checkout pointer_checkouts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. checkout 잠금 + 조회
  SELECT * INTO v_checkout
  FROM pointer_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대여 기록 % 를 찾을 수 없습니다', p_checkout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. 권한 확인: 본인 또는 pointer 관리자
  IF v_checkout.user_id <> v_user_id AND NOT has_admin_role('pointer') THEN
    RAISE EXCEPTION '본인의 대여 기록만 반납할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 3. 상태 확인: active 또는 overdue만 반납 가능
  IF v_checkout.status NOT IN ('active', 'overdue') THEN
    RAISE EXCEPTION '대여 기록 % 는 반납할 수 없는 상태입니다 (status: %)',
      p_checkout_id, v_checkout.status USING ERRCODE = '22023';
  END IF;

  -- 4. checkouts UPDATE
  UPDATE pointer_checkouts
  SET status      = 'returned',
      returned_at = now()
  WHERE id = p_checkout_id
  RETURNING * INTO v_checkout;

  -- 5. items.status = 'available'
  --    단, 'borrowed' 상태일 때만 변경. lost/maintenance 같은 특수 상태는
  --    관리자가 별도로 처리해야 하므로 건드리지 않음.
  UPDATE pointer_items
  SET status = 'available'
  WHERE id     = v_checkout.item_id
    AND status = 'borrowed';

  RETURN v_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.return_pointer(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.return_pointer(uuid) TO authenticated;

COMMENT ON FUNCTION public.return_pointer(uuid) IS
  '포인터 반납. 본인 또는 pointer 관리자만 호출 가능. checkouts.status=returned + items.status=available.';


-- ============================================================
-- 3) borrow_book: 도서 대여
-- ============================================================
CREATE OR REPLACE FUNCTION public.borrow_book(p_book_id int)
RETURNS book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id      uuid;
  v_book_status  text;
  v_new_checkout book_checkouts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. 도서 잠금 + 상태 확인
  SELECT status INTO v_book_status
  FROM books
  WHERE id = p_book_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '도서 % 를 찾을 수 없습니다', p_book_id USING ERRCODE = 'P0002';
  END IF;

  IF v_book_status <> 'available' THEN
    RAISE EXCEPTION '도서 % 는 현재 대여할 수 없습니다 (상태: %)', p_book_id, v_book_status
      USING ERRCODE = '22023';
  END IF;

  -- 2. checkouts INSERT (대여 + 7일 후 반납 기한)
  INSERT INTO book_checkouts (book_id, user_id, due_at, status)
  VALUES (p_book_id, v_user_id, now() + interval '7 days', 'active')
  RETURNING * INTO v_new_checkout;

  -- 3. books.status = 'borrowed'
  UPDATE books
  SET status = 'borrowed'
  WHERE id = p_book_id;

  RETURN v_new_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.borrow_book(int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.borrow_book(int) TO authenticated;

COMMENT ON FUNCTION public.borrow_book(int) IS
  '도서 대여. 표준 대여 기간 7일. checkouts INSERT + books.status=borrowed를 원자적으로 처리.';


-- ============================================================
-- 4) return_book: 도서 반납
-- ============================================================
CREATE OR REPLACE FUNCTION public.return_book(p_checkout_id uuid)
RETURNS book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id  uuid;
  v_checkout book_checkouts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. checkout 잠금 + 조회
  SELECT * INTO v_checkout
  FROM book_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대여 기록 % 를 찾을 수 없습니다', p_checkout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. 권한 확인: 본인 또는 book 관리자
  IF v_checkout.user_id <> v_user_id AND NOT has_admin_role('book') THEN
    RAISE EXCEPTION '본인의 대여 기록만 반납할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 3. 상태 확인
  IF v_checkout.status NOT IN ('active', 'overdue') THEN
    RAISE EXCEPTION '대여 기록 % 는 반납할 수 없는 상태입니다 (status: %)',
      p_checkout_id, v_checkout.status USING ERRCODE = '22023';
  END IF;

  -- 4. checkouts UPDATE
  UPDATE book_checkouts
  SET status      = 'returned',
      returned_at = now()
  WHERE id = p_checkout_id
  RETURNING * INTO v_checkout;

  -- 5. books.status = 'available' (borrowed일 때만)
  UPDATE books
  SET status = 'available'
  WHERE id     = v_checkout.book_id
    AND status = 'borrowed';

  RETURN v_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.return_book(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.return_book(uuid) TO authenticated;

COMMENT ON FUNCTION public.return_book(uuid) IS
  '도서 반납. 본인 또는 book 관리자만 호출 가능.';


-- ============================================================
-- 5) extend_book_checkout: 도서 연장 (1회 한정)
-- ============================================================
CREATE OR REPLACE FUNCTION public.extend_book_checkout(p_checkout_id uuid)
RETURNS book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id  uuid;
  v_checkout book_checkouts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. checkout 잠금 + 조회
  SELECT * INTO v_checkout
  FROM book_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대여 기록 % 를 찾을 수 없습니다', p_checkout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. 권한 확인: 본인만 연장 가능 (관리자 대리 연장 불가 — 정책)
  IF v_checkout.user_id <> v_user_id THEN
    RAISE EXCEPTION '본인의 대여만 연장할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 3. 상태 확인
  IF v_checkout.status <> 'active' THEN
    RAISE EXCEPTION '활성(active) 상태의 대여만 연장할 수 있습니다 (현재: %)',
      v_checkout.status USING ERRCODE = '22023';
  END IF;

  -- 4. 연장 횟수 확인 (1회 한정)
  IF v_checkout.extension_count >= 1 THEN
    RAISE EXCEPTION '이미 한 번 연장했습니다. 추가 연장은 불가능합니다'
      USING ERRCODE = '22023';
  END IF;

  -- 5. UPDATE: due_at +7일, extension_count +1
  --    DB CHECK 제약 (extension_count <= 1) 이 추가 안전망
  UPDATE book_checkouts
  SET due_at           = due_at + interval '7 days',
      extension_count  = extension_count + 1,
      last_extended_at = now()
  WHERE id = p_checkout_id
  RETURNING * INTO v_checkout;

  RETURN v_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.extend_book_checkout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.extend_book_checkout(uuid) TO authenticated;

COMMENT ON FUNCTION public.extend_book_checkout(uuid) IS
  '도서 연장 (1회 한정, 7일 추가). 본인만 호출 가능. 관리자도 대리 연장 불가.';


COMMIT;


-- ============================================================
-- 검증 쿼리 (적용 후 실행)
-- ============================================================

-- 1) 5개 함수 모두 정상 생성됐는지
SELECT
  proname,
  prosecdef AS is_security_definer,
  proacl
FROM pg_proc
WHERE proname IN (
  'borrow_pointer', 'return_pointer',
  'borrow_book', 'return_book',
  'extend_book_checkout'
)
ORDER BY proname;
-- 기대: 5 rows, 모두 is_security_definer=true

-- 2) authenticated role에 EXECUTE 권한이 있는지
SELECT
  proname,
  has_function_privilege('authenticated', oid, 'EXECUTE') AS authenticated_can_exec,
  has_function_privilege('anon', oid, 'EXECUTE') AS anon_can_exec
FROM pg_proc
WHERE proname IN (
  'borrow_pointer', 'return_pointer',
  'borrow_book', 'return_book',
  'extend_book_checkout'
)
ORDER BY proname;
-- 기대: authenticated=true, anon=false (모두)

-- 3) 함수 사용 시나리오 시뮬레이션 (SQL Editor에서 실제 호출은 안 됨 - auth.uid()가 NULL이라 에러남)
--    프론트엔드 사용 예시는 위 주석 참조


-- ============================================================
-- 트러블슈팅 가이드
-- ============================================================
-- 
-- Q. 함수 호출 시 "Authentication required" 에러
-- A. SQL Editor는 service_role이라 auth.uid()=NULL.
--    프론트엔드(authenticated)에서 호출해야 정상 동작.
-- 
-- Q. "본인의 대여 기록만 반납할 수 있습니다" 에러
-- A. 다른 사용자의 checkout을 반납하려는 경우.
--    관리자 권한이 있어야 함 (admin_roles에 'pointer' 또는 'book' role 필요).
-- 
-- Q. "포인터 X 는 현재 대여할 수 없습니다 (상태: borrowed)"
-- A. 동시에 다른 사용자가 먼저 대여했을 가능성.
--    프론트엔드에서 가용 목록 새로고침 후 재시도.
-- 
-- Q. 도서 연장 후 due_at이 너무 미래로 가는 경우
-- A. 정상. 7일짜리 대여를 연장 1회 = 총 14일. 더 이상 연장 불가.
