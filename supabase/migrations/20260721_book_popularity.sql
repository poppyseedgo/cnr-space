-- ════════════════════════════════════════════════════════════════════════════
-- 20260721_book_popularity.sql
--   도서 목록 '인기 순' 정렬용 대여 횟수 집계
--
-- [2026-07-21] 신규
--
-- ── 왜 RPC 인가 (클라이언트 집계가 안 되는 이유) ─────────────────────────────
--
--   book_checkouts 의 SELECT 정책(book_checkouts_select_self_or_admin)은
--   비관리자에게 **본인 행만** 돌려준다. 프론트에서 book_checkouts 를 받아
--   count 하면 일반 임직원에게는 "내가 빌린 책 순"이 나온다 —
--   사용자마다 인기 순위가 달라지는 상태다.
--
--   → SECURITY DEFINER 로 RLS 를 우회하되, **집계값만** 반환한다.
--     누가 언제 빌렸는지(user_id / checkout_at)는 이 함수로 새어 나가지 않는다.
--
-- ── 무엇을 세는가 ────────────────────────────────────────────────────────────
--
--   status <> 'pending'  = 실제로 대여가 성립한 건만.
--     · active / returned / overdue / lost → 카운트
--     · pending(승인 대기)               → 제외.
--       신청만 하고 거절된 건까지 인기로 잡으면 수치를 부풀릴 수 있다.
--   반납분(returned)을 포함해야 '누적 인기'가 된다.
--
-- ── 성능 ─────────────────────────────────────────────────────────────────────
--   idx_book_checkouts_book (book_checkouts(book_id)) 가 이미 있어
--   GROUP BY book_id 를 커버한다. 별도 인덱스 불필요.
--
-- ── 멱등 ─────────────────────────────────────────────────────────────────────
--   CREATE OR REPLACE + DROP 선행. 재실행 안전.
-- ════════════════════════════════════════════════════════════════════════════

-- 반환 타입이 바뀌면 CREATE OR REPLACE 가 거부되므로 먼저 떨어뜨린다
DROP FUNCTION IF EXISTS public.get_book_checkout_counts();

CREATE FUNCTION public.get_book_checkout_counts()
RETURNS TABLE (book_id int, checkout_count bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT bc.book_id, count(*)::bigint
  FROM public.book_checkouts bc
  WHERE bc.status <> 'pending'
  GROUP BY bc.book_id
$$;

COMMENT ON FUNCTION public.get_book_checkout_counts() IS
  '도서별 누적 대여 횟수(pending 제외). 목록 인기 순 정렬 전용. '
  'RLS 상 비관리자는 본인 대여 행만 볼 수 있어 클라이언트 집계가 불가능하므로 '
  'SECURITY DEFINER 로 집계값만 노출한다.';

-- 기본 PUBLIC 실행 권한을 회수하고 로그인 사용자에게만 부여
REVOKE ALL ON FUNCTION public.get_book_checkout_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_book_checkout_counts() TO authenticated;

-- ── 확인용 (실행해도 무해) ───────────────────────────────────────────────────
-- SELECT * FROM public.get_book_checkout_counts() ORDER BY checkout_count DESC LIMIT 10;
