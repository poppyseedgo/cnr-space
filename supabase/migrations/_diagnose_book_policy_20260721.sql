-- ============================================================================
-- [2026-07-21] 대여 정책 변경 사전 진단 (읽기 전용)
--
-- 목적:
--   20260724_book_self_checkout.sql 은 book_checkouts 에 기간 겹침 방지
--   EXCLUDE 제약을 추가한다. 제약은 "기존 데이터가 전부 조건을 만족할 때만"
--   생성된다. 겹치는 행이 하나라도 있으면 ALTER TABLE 이 실패하고
--   마이그레이션 전체가 롤백된다.
--
--   따라서 반드시 이 파일을 먼저 실행해 결과를 확인한 뒤 배포한다.
--   ①~④ 가 모두 0행이면 그대로 배포해도 된다.
--
-- 실행 위치: Supabase SQL Editor (프로젝트 jjzcqpbwkkujttwxksvy)
-- 부작용: 없음 (SELECT 전용)
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- ① 【치명】 같은 도서에 기간이 겹치는 활성 대여
--
--    이 행이 있으면 EXCLUDE 제약 생성이 실패한다.
--    지금까지는 books.status 로만 배타 제어했기 때문에 이론상 없어야 하지만,
--    소급 등록(p_checkout_at)이 들어간 뒤로는 발생 가능하다.
--    → 나오면 한쪽을 returned/cancelled 로 정리한 뒤 배포할 것.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  a.book_id,
  bk.title,
  a.id            AS checkout_a,
  a.status        AS status_a,
  a.checkout_at   AS a_시작,
  a.due_at        AS a_기한,
  b.id            AS checkout_b,
  b.status        AS status_b,
  b.checkout_at   AS b_시작,
  b.due_at        AS b_기한
FROM public.book_checkouts a
JOIN public.book_checkouts b
  ON a.book_id = b.book_id
 AND a.id < b.id                       -- 같은 쌍을 두 번 세지 않는다
 AND tstzrange(a.checkout_at, a.due_at, '[]')
  && tstzrange(b.checkout_at, b.due_at, '[]')
JOIN public.books bk ON bk.id = a.book_id
WHERE a.status IN ('active','overdue')
  AND b.status IN ('active','overdue')
ORDER BY a.book_id;


-- ─────────────────────────────────────────────────────────────────────────
-- ② 【치명】 checkout_at >= due_at 인 행
--
--    tstzrange 는 하한 > 상한이면 즉시 에러를 낸다.
--    테이블에 CHECK(due_at > checkout_at) 가 있어 없어야 정상이지만,
--    제약을 우회한 SQL Editor 직접 수정 이력이 있으므로 확인한다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT id, book_id, status, checkout_at, due_at
  FROM public.book_checkouts
 WHERE due_at <= checkout_at;


-- ─────────────────────────────────────────────────────────────────────────
-- ③ 승인 대기(pending) 잔여 건
--
--    승인 플로우가 사라지므로 남아 있으면 어느 화면에도 안 나오는 유령이 된다.
--    마이그레이션이 자동으로 cancelled 처리하지만, 사전에 건수를 알아둔다.
--    (0건이면 그대로 진행 / 있으면 해당 사용자에게 안내 필요)
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  c.id, c.user_id, p.name AS 신청자, p.email,
  bk.title AS 도서, c.requested_at
FROM public.book_checkouts c
LEFT JOIN public.books    bk ON bk.id = c.book_id
LEFT JOIN public.profiles p  ON p.id  = c.user_id
WHERE c.status = 'pending'
ORDER BY c.requested_at;


-- ─────────────────────────────────────────────────────────────────────────
-- ④ books.status 와 실제 대여 상태의 불일치
--
--    이번 변경으로 books.status='borrowed' 의 의미가
--    "예약 포함 점유" → "지금 물리적으로 나가 있음" 으로 좁혀진다.
--    미래 예약 때문에 borrowed 로 잠겨 있던 도서는 available 로 풀어야 한다.
--    (마이그레이션이 자동 정합화하지만, 사전에 규모를 확인한다)
-- ─────────────────────────────────────────────────────────────────────────
-- ④-a 미래 시작 예약 때문에 borrowed 로 잠긴 도서 → 풀어줘야 함
SELECT bk.id, bk.title, bk.status, c.checkout_at AS 시작예정, c.due_at
  FROM public.books bk
  JOIN public.book_checkouts c ON c.book_id = bk.id
 WHERE bk.status = 'borrowed'
   AND c.status IN ('active','overdue')
   AND c.checkout_at > now()
 ORDER BY c.checkout_at;

-- ④-b 진행 중 대여가 있는데 borrowed 가 아닌 도서 → borrowed 로 맞춰야 함
SELECT bk.id, bk.title, bk.status, c.id AS checkout_id, c.checkout_at, c.due_at
  FROM public.books bk
  JOIN public.book_checkouts c ON c.book_id = bk.id
 WHERE bk.status NOT IN ('borrowed','lost')
   AND c.status IN ('active','overdue')
   AND c.checkout_at <= now()
   AND c.returned_at IS NULL;

-- ④-c 활성 대여가 없는데 borrowed 인 도서 (기존 2단 UPDATE 결함 잔재)
SELECT bk.id, bk.title, bk.status
  FROM public.books bk
 WHERE bk.status = 'borrowed'
   AND NOT EXISTS (
         SELECT 1 FROM public.book_checkouts c
          WHERE c.book_id = bk.id AND c.status IN ('active','overdue')
       );


-- ─────────────────────────────────────────────────────────────────────────
-- ⑤ 전체 상태 분포 (참고)
-- ─────────────────────────────────────────────────────────────────────────
SELECT status, count(*) AS 건수
  FROM public.book_checkouts
 GROUP BY status
 ORDER BY 건수 DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑥ btree_gist 확장 설치 여부
--
--    EXCLUDE ... USING gist 에서 정수 컬럼(book_id)에 '=' 연산자를 쓰려면
--    btree_gist 가 필요하다. 마이그레이션이 CREATE EXTENSION 하지만,
--    권한 문제로 실패할 수 있어 미리 확인한다.
--    installed_version 이 NULL 이면 아직 미설치 (마이그레이션이 설치함).
-- ─────────────────────────────────────────────────────────────────────────
SELECT name, default_version, installed_version
  FROM pg_available_extensions
 WHERE name = 'btree_gist';


-- ─────────────────────────────────────────────────────────────────────────
-- ⑦ 폐기 대상 RPC 존재 확인
--
--    저장소에 마이그레이션 파일이 없는 함수들이다. 실제 DB 에 어떤 시그니처로
--    존재하는지 확인해야 DROP 문이 정확히 맞는다.
--    → 결과에 아래 4개가 보이면 마이그레이션의 DROP 문이 그대로 동작한다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS 인자,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'request_book_checkout',
    'admin_approve_book_request',
    'admin_reject_book_request',
    'cancel_book_request',
    'admin_checkout_books',
    'admin_return_book',
    'extend_book_checkout',
    'get_book_checkout_counts'
  )
ORDER BY p.proname;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑧ book_checkouts RLS 정책 현황
--
--    "사용자는 pending 만 INSERT" 정책이 어떤 이름으로 걸려 있는지 확인한다.
--    마이그레이션이 DROP POLICY IF EXISTS 로 정리하지만, 예상과 다른 이름이
--    있으면 그 정책이 남아 사용자 직접 INSERT 가 계속 허용된다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT policyname, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename  = 'book_checkouts'
 ORDER BY cmd, policyname;
