-- ============================================================================
-- [2026-07-21] 연체 패널티 정책 시행 전 진단 (읽기 전용)
--
-- 목적
--   이 정책은 "직원의 대여를 막는" 기능이다. 시행 순간 누가 몇 명이나
--   차단되는지 모르고 배포하면 다음 날 아침 문의가 몰린다.
--   반드시 이 파일을 먼저 실행해 규모를 확인한 뒤 배포한다.
--
-- 제재 기준일(effective_due) — 이 파일 전체가 쓰는 계산식
--   화면의 '연체중' 뱃지는 due_at 기준이지만, 제재는 그보다 늦게 시작한다.
--   한 권을 최대 14일(대여 7일 + 1회 연장 7일) 쓸 수 있는 것이 기존 정책이라,
--   연장을 안 쓴 사람이 9일째 반납했다면 원래 쓸 수 있었던 기간 안이다.
--
--     연장 미사용(extension_count = 0) → effective_due = due_at + 7일
--     연장 사용  (extension_count > 0) → effective_due = due_at
--
--   연장을 실제로 하면 due_at 자체가 +7일 되므로 두 경로의 기준일이 같아진다.
--   "연장 버튼을 눌렀는지"로 제재가 갈리지 않는다.
--
-- 제재 등급 (effective_due 초과 일수, KST 날짜 단위)
--     3일 이상  → 7일   대여 불가
--     7일 이상  → 30일  대여 불가
--    14일 이상  → 영구  대여 불가
--
-- 실행 위치: Supabase SQL Editor (프로젝트 jjzcqpbwkkujttwxksvy)
-- 부작용: 없음 (SELECT 전용)
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- ① 【필수】 지금 미반납 상태에서 이미 제재 대상인 인원
--
--    소급 적용을 하지 않기로 했으므로 이들은 마이그레이션에서 면제 처리된다.
--    다만 "면제 대상이 몇 명인지"는 알고 배포해야 한다.
--    여기 인원이 많다면 시행 전에 반납 독려 공지를 먼저 하는 편이 낫다.
-- ─────────────────────────────────────────────────────────────────────────
WITH live AS (
  SELECT
    c.id, c.user_id, c.book_id, c.due_at, c.extension_count,
    (c.due_at + CASE WHEN c.extension_count = 0
                     THEN interval '7 days' ELSE interval '0' END) AS effective_due
  FROM public.book_checkouts c
  WHERE c.status IN ('active','overdue')
    AND c.returned_at IS NULL
    AND c.checkout_at <= now()        -- 아직 시작 안 한 예약은 제외
)
SELECT
  p.name  AS 직원,
  p.email,
  bk.title AS 도서,
  (now() AT TIME ZONE 'Asia/Seoul')::date
    - (l.due_at AT TIME ZONE 'Asia/Seoul')::date        AS 화면상_연체일,
  (now() AT TIME ZONE 'Asia/Seoul')::date
    - (l.effective_due AT TIME ZONE 'Asia/Seoul')::date AS 제재기준_초과일,
  l.extension_count AS 연장횟수,
  CASE
    WHEN (now() AT TIME ZONE 'Asia/Seoul')::date
       - (l.effective_due AT TIME ZONE 'Asia/Seoul')::date >= 14 THEN '영구'
    WHEN (now() AT TIME ZONE 'Asia/Seoul')::date
       - (l.effective_due AT TIME ZONE 'Asia/Seoul')::date >= 7  THEN '30일'
    WHEN (now() AT TIME ZONE 'Asia/Seoul')::date
       - (l.effective_due AT TIME ZONE 'Asia/Seoul')::date >= 3  THEN '7일'
    ELSE '해당없음'
  END AS 예상등급
FROM live l
JOIN public.books    bk ON bk.id = l.book_id
LEFT JOIN public.profiles p ON p.id = l.user_id
WHERE (now() AT TIME ZONE 'Asia/Seoul')::date
    - (l.effective_due AT TIME ZONE 'Asia/Seoul')::date >= 3
ORDER BY 제재기준_초과일 DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- ② 【참고】 과거 반납 건에 소급 적용했다면 몇 명이 걸렸을까
--
--    ③번 결정(소급 안 함)을 재확인하기 위한 자료다.
--    숫자가 크면 소급하지 않기로 한 판단이 옳았다는 근거가 된다.
-- ─────────────────────────────────────────────────────────────────────────
WITH done AS (
  SELECT
    c.user_id, c.returned_at,
    (c.returned_at AT TIME ZONE 'Asia/Seoul')::date
      - ((c.due_at + CASE WHEN c.extension_count = 0
                          THEN interval '7 days' ELSE interval '0' END)
         AT TIME ZONE 'Asia/Seoul')::date AS over_days
  FROM public.book_checkouts c
  WHERE c.status = 'returned'
    AND c.returned_at IS NOT NULL
)
SELECT
  CASE WHEN over_days >= 14 THEN '영구'
       WHEN over_days >= 7  THEN '30일'
       WHEN over_days >= 3  THEN '7일'
  END AS 등급,
  count(*)                  AS 건수,
  count(DISTINCT user_id)   AS 인원
FROM done
WHERE over_days >= 3
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────
-- ③ 【참고】 연체 분포 — 정책 임계값(3/7/14)이 현실에 맞는지 확인
--
--    3일 구간에 대부분이 몰려 있다면 임계값이 너무 빡빡한 것이고,
--    아무도 안 걸린다면 정책이 유명무실한 것이다.
-- ─────────────────────────────────────────────────────────────────────────
WITH all_loans AS (
  SELECT
    COALESCE(c.returned_at, now()) AS ref_at,
    (c.due_at + CASE WHEN c.extension_count = 0
                     THEN interval '7 days' ELSE interval '0' END) AS effective_due
  FROM public.book_checkouts c
  WHERE c.status IN ('active','overdue','returned')
    AND c.checkout_at <= now()
)
SELECT
  CASE
    WHEN d <  0 THEN 'a. 기한 내'
    WHEN d <  3 THEN 'b. 1~2일 초과 (제재 없음)'
    WHEN d <  7 THEN 'c. 3~6일 초과 → 7일 제한'
    WHEN d < 14 THEN 'd. 7~13일 초과 → 30일 제한'
    ELSE             'e. 14일 이상 → 영구'
  END AS 구간,
  count(*) AS 건수
FROM (
  SELECT (ref_at AT TIME ZONE 'Asia/Seoul')::date
       - (effective_due AT TIME ZONE 'Asia/Seoul')::date AS d
  FROM all_loans
) t
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────
-- ④ 분실 처리 건 — 제재 대상에서 제외되는지 확인용
--
--    lost 는 returned_at 이 없어 연체일수 계산 자체가 불가능하다.
--    정책에서 제외하기로 했으므로 여기 나오는 건은 제재를 받지 않는다.
--    (변상 등 별도 처리 대상)
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.name AS 직원, bk.title AS 도서, c.due_at, c.updated_at AS 분실처리일
FROM public.book_checkouts c
JOIN public.books    bk ON bk.id = c.book_id
LEFT JOIN public.profiles p ON p.id = c.user_id
WHERE c.status = 'lost'
ORDER BY c.updated_at DESC;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑤ 사전 점검 — 마이그레이션이 참조하는 객체가 실재하는지
--
--    아래 5개가 모두 나와야 마이그레이션이 통과한다.
--    admin_return_book / user_checkout_books / admin_checkout_books /
--    has_admin_role / is_profile_admin
-- ─────────────────────────────────────────────────────────────────────────
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS 인자,
  p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'admin_return_book',
    'user_checkout_books',
    'admin_checkout_books',
    'has_admin_role',
    'is_profile_admin'
  )
ORDER BY p.proname;


-- ─────────────────────────────────────────────────────────────────────────
-- ⑥ book_penalties 테이블 존재 여부 (재실행 안전성 확인)
--    최초 배포라면 0행이 정상이다.
-- ─────────────────────────────────────────────────────────────────────────
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name   = 'book_penalties';
