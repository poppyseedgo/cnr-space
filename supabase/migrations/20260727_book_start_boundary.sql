-- ═══════════════════════════════════════════════════════════════════════════
-- 20260727_book_start_boundary.sql
--   대여 "시작 시점" 판정 기준 통일 (KST 날짜) + books.status 고착 복구
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 근본 원인
-- ═══════════════════════════════════════════════════════════════════════════
--
--   대여일은 프론트가 KST 정오로 고정해 보낸다 (`${date}T12:00:00+09:00`).
--   그런데 "이 대여가 시작되었는가" 판정이 두 갈래였다.
--
--     · 잠금 경로 (user_checkout_books / admin_checkout_books, 20260724)
--         v_req_kst <= v_today_kst          ← KST **날짜** 비교
--         → 오늘 날짜로 대여하면 시각과 무관하게 즉시 books.status='borrowed'
--
--     · 표시·취소·배치 경로
--         c.checkout_at <= now()            ← 절대 **시각** 비교
--         → KST 00:00 ~ 11:59 구간에는 "아직 시작 전"
--
--   두 기준이 어긋나는 구간이 매일 오전 12시간 생기고, 그 구간에서만
--   아래 4개 결함이 동시에 나타났다.
--
--     ① 도서 카드가 '대여중'인데 대여자·반납기한 행이 통째로 누락
--        (books.status 는 잠겼는데 프론트가 대여 건을 "미시작"으로 걸러냄)
--     ② 마이페이지가 이미 시작된 대여를 '대여 예정'으로 표시
--     ③ ★그 상태에서 사용자가 '예약 취소'를 누르면
--        book_checkouts.status='cancelled' 인데 books.status='borrowed' 가 남는다.
--        활성 대여가 없으니 반납 버튼도 나오지 않아 화면으로는 복구 불가.
--     ④ 09:00 배치(start_due_book_checkouts)가 정오 시작 건을 탈락시켜
--        시작일 알림이 하루 밀림
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 해결 방향 — 왜 '날짜' 기준으로 합치는가
-- ═══════════════════════════════════════════════════════════════════════════
--
--   반대로 '시각' 기준으로 합치려면 잠금 조건도 시각으로 바꿔야 하는데,
--   그러면 "오늘 대여했는데 정오까지는 남이 빌릴 수 있는" 구멍이 생긴다.
--   잠금이 곧 점유이므로 잠금 기준(KST 날짜)이 사실상의 정답이고,
--   나머지 경로를 여기에 맞춘다.
--
--     불변식:  books 가 잠겼다  ==  대여가 시작되었다  ==  취소 불가
--
--   판정식 SSOT
--     DB    : public.book_checkout_started(timestamptz)
--     프론트: src/utils/bookLoan.ts  hasCheckoutStarted()
--   두 곳의 식이 달라지면 이 결함이 그대로 재발한다.
--
-- 실행: Supabase SQL Editor (BEGIN..COMMIT — 실패 시 전체 롤백, 재실행 안전)
-- 선행: 20260724_book_self_checkout.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1) 판정식 헬퍼 — book_checkout_started()
--
--    STABLE 이지 IMMUTABLE 이 아니다. now() 에 의존하므로 인덱스 식으로는
--    쓸 수 없고, 쿼리 안에서만 쓴다.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_checkout_started(p_checkout_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_checkout_at IS NULL
      OR (p_checkout_at AT TIME ZONE 'Asia/Seoul')::date
         <= (now()      AT TIME ZONE 'Asia/Seoul')::date;
$$;

REVOKE EXECUTE ON FUNCTION public.book_checkout_started(timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.book_checkout_started(timestamptz) TO authenticated, service_role;

COMMENT ON FUNCTION public.book_checkout_started(timestamptz) IS
  '[2026-07-23] 대여 시작 판정 SSOT — KST 날짜 기준. '
  'user/admin_checkout_books 의 잠금 조건(v_req_kst <= v_today_kst)과 동일한 식. '
  '프론트 utils/bookLoan.hasCheckoutStarted() 와 반드시 일치시킬 것.';


-- ────────────────────────────────────────────────────────────────────────
-- 2) books.status 정합화 — ③ 고착 복구
--
--    ★순서 주의: 해제(2-a)를 먼저, 잠금(2-b)을 나중에.
--    반대로 하면 방금 잠근 행을 2-a 가 다시 풀어버린다.
-- ────────────────────────────────────────────────────────────────────────

-- 2-a) 진행 중인 대여가 없는데 'borrowed' 로 남아 있는 도서 → 해제
--      취소·반납 도중 끊긴 건, 그리고 이번 결함 ③ 으로 고착된 건이 여기 걸린다.
--      maintenance / lost 는 사람이 지정한 상태이므로 건드리지 않는다.
UPDATE public.books b
   SET status = 'available', updated_at = now()
 WHERE b.status = 'borrowed'
   AND NOT EXISTS (
         SELECT 1 FROM public.book_checkouts c
          WHERE c.book_id = b.id
            AND c.status IN ('active','overdue')
            AND c.returned_at IS NULL
            AND public.book_checkout_started(c.checkout_at)
       );

-- 2-b) 시작된 대여가 있는데 'available' 인 도서 → 잠금
--      ①의 오전 구간에 취소 없이 넘어간 건이 여기 걸린다.
UPDATE public.books b
   SET status = 'borrowed', updated_at = now()
 WHERE b.status = 'available'
   AND EXISTS (
         SELECT 1 FROM public.book_checkouts c
          WHERE c.book_id = b.id
            AND c.status IN ('active','overdue')
            AND c.returned_at IS NULL
            AND public.book_checkout_started(c.checkout_at)
       );


-- ────────────────────────────────────────────────────────────────────────
-- 3) cancel_book_checkout — ALREADY_STARTED 판정 교체
--
--    기존: IF v_row.checkout_at <= now()
--      → 오늘 대여(정오 저장) 건이 오전에는 취소를 통과해 ③ 고착을 만들었다.
--    변경: book_checkout_started() 위임 — 잠금 기준과 동일해진다.
--
--    ※ 반환 타입(public.book_checkouts) 변경 없음 → CREATE OR REPLACE 가능.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_book_checkout(p_checkout_id uuid)
RETURNS public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.book_checkouts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
    FROM public.book_checkouts
   WHERE id = p_checkout_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 관리자도 이 함수로는 타인 예약을 취소하지 않는다.
  -- 관리자 취소는 별도 경로로 열어야 감사 로그(누가 취소했는지)를 남길 수 있다.
  IF v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_ACTIVE:%', v_row.status USING ERRCODE = 'P0001';
  END IF;

  -- ← [2026-07-23] 시작 판정을 SSOT 헬퍼로 위임.
  --   시작된 대여를 취소하면 books.status='borrowed' 가 되돌려지지 않아
  --   도서가 영구히 잠긴다(반납 버튼도 안 나온다). 여기서 반드시 막아야 한다.
  IF public.book_checkout_started(v_row.checkout_at) THEN
    RAISE EXCEPTION 'ALREADY_STARTED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.book_checkouts
     SET status       = 'cancelled',
         processed_at = now(),
         updated_at   = now()
   WHERE id = p_checkout_id
   RETURNING * INTO v_row;

  -- books.status 는 건드리지 않는다.
  -- 미래 예약은 애초에 도서를 잠그지 않았으므로 되돌릴 상태가 없다.
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_book_checkout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_book_checkout(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_book_checkout(uuid) IS
  '[2026-07-23] 본인의 시작 전 예약 취소. 시작 판정은 book_checkout_started(KST 날짜).';


-- ────────────────────────────────────────────────────────────────────────
-- 4) start_due_book_checkouts — 시작 판정 교체
--
--    ④ 알림 하루 지연 수정. 09:00 배치 시점에 checkout_at 이 정오라
--    now() 비교에서 탈락하던 건이 이제 당일에 잡힌다.
--
--    ★ TABLE 반환 함수는 DROP 선행 (42P13 재발 방지 규칙).
--      반환 컬럼을 바꾸지 않아도, 이 파일이 개정되며 재실행될 때를 대비해
--      처음부터 DROP 을 붙여 둔다. DROP 하면 GRANT 도 사라지므로 재부여 필수.
-- ────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.start_due_book_checkouts();

CREATE FUNCTION public.start_due_book_checkouts()
RETURNS TABLE (
  checkout_id uuid,
  user_id     uuid,
  book_id     integer,
  book_title  text,
  due_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ① 시작일이 도래한 대여의 도서를 잠근다 (멱등 — 이미 borrowed 면 제외)
  UPDATE public.books b
     SET status = 'borrowed', updated_at = now()
   WHERE b.status = 'available'
     AND EXISTS (
           SELECT 1 FROM public.book_checkouts c
            WHERE c.book_id = b.id
              AND c.status IN ('active','overdue')
              AND public.book_checkout_started(c.checkout_at)   -- ← [2026-07-23]
              AND c.returned_at IS NULL
         );

  -- ② 시작 통지 대상 (아직 안 보낸 건만)
  RETURN QUERY
  SELECT c.id, c.user_id, c.book_id, bk.title, c.due_at
    FROM public.book_checkouts c
    JOIN public.books bk ON bk.id = c.book_id
   WHERE c.status IN ('active','overdue')
     AND public.book_checkout_started(c.checkout_at)             -- ← [2026-07-23]
     AND c.returned_at IS NULL
     AND c.notified_started IS NULL
   ORDER BY c.checkout_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_due_book_checkouts() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_due_book_checkouts() TO service_role;

COMMENT ON FUNCTION public.start_due_book_checkouts() IS
  '[2026-07-23] 대여 시작일 도래 처리 — 도서 잠금 + 시작 통지 대상 반환. '
  '시작 판정은 book_checkout_started(KST 날짜). book-due-reminder 가 09:00 KST 호출.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 배포 후 검증 (읽기 전용 — 각각 0행이어야 정상)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- -- [A] 잠금 고착: 진행 중 대여가 없는데 borrowed
-- SELECT b.id, b.title
--   FROM public.books b
--  WHERE b.status = 'borrowed'
--    AND NOT EXISTS (SELECT 1 FROM public.book_checkouts c
--                     WHERE c.book_id = b.id AND c.status IN ('active','overdue')
--                       AND c.returned_at IS NULL
--                       AND public.book_checkout_started(c.checkout_at));
--
-- -- [B] 역방향 미잠금: 시작된 대여가 있는데 available
-- SELECT b.id, b.title
--   FROM public.books b
--  WHERE b.status = 'available'
--    AND EXISTS (SELECT 1 FROM public.book_checkouts c
--                 WHERE c.book_id = b.id AND c.status IN ('active','overdue')
--                   AND c.returned_at IS NULL
--                   AND public.book_checkout_started(c.checkout_at));
--
-- -- [C] 판정 불일치 잔존: 두 기준의 결과가 다른 진행 중 대여
-- --     (오늘 대여한 건이 KST 오후에 조회하면 0행. 오전에도 0행이어야 정상이다)
-- SELECT id, checkout_at,
--        public.book_checkout_started(checkout_at) AS started_kst,
--        (checkout_at <= now())                    AS started_ts
--   FROM public.book_checkouts
--  WHERE status IN ('active','overdue')
--    AND public.book_checkout_started(checkout_at) <> (checkout_at <= now());
