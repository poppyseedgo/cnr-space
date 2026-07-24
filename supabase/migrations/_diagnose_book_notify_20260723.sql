-- ═══════════════════════════════════════════════════════════════════════════
-- _diagnose_book_notify_20260723.sql   (읽기 전용 — 아무것도 바꾸지 않음)
--
-- 대여 접수 알림(book_checkout_created) 배포 **전** 에 확인할 것.
--   [1] 실제 수신자가 누구인지        ← 메일이 몇 통 나가는지 여기서 결정된다
--   [2] 폴백이 발동하는 상황인지
--   [3] notifications.type 에 CHECK 제약이 있는지  ← 있으면 인앱만 조용히 실패한다
--   [4] 대여 생성 빈도(= 예상 메일량)
--
-- Supabase SQL Editor 에 통째로 붙여넣고 실행.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── [1] 실제 수신자 — admin_roles 'book' / 'super' 보유자 ──────────────────
--   여기 나오는 사람들이 대여 1건마다 메일 + 인앱을 받는다.
--   의도한 명단이 아니면 admin_roles 를 조정하고 배포할 것.
SELECT p.name, p.email, p.dept,
       string_agg(a.role, ',' ORDER BY a.role) AS roles,
       p.is_active
  FROM public.admin_roles a
  JOIN public.profiles p ON p.id = a.user_id
 WHERE a.role IN ('book','super')
 GROUP BY p.id, p.name, p.email, p.dept, p.is_active
 ORDER BY p.name;

-- ── [2] 폴백 발동 여부 ────────────────────────────────────────────────────
--   book_admin_count = 0 이면 resolver 가 profiles.role='ADMIN' 전원으로
--   폴백한다(= admin_count 명에게 발송). 그 숫자가 감당 가능한지 확인.
SELECT
  (SELECT count(DISTINCT a.user_id)
     FROM public.admin_roles a JOIN public.profiles p ON p.id = a.user_id
    WHERE a.role IN ('book','super') AND p.is_active IS DISTINCT FROM false) AS book_admin_count,
  (SELECT count(*) FROM public.profiles
    WHERE role = 'ADMIN' AND is_active = true)                                AS profile_admin_count;

-- ── [3] notifications.type CHECK 제약 ─────────────────────────────────────
--   제약이 있고 'book_checkout_created' 가 빠져 있으면 인앱 INSERT 만
--   조용히 실패한다(코드가 warn 만 남기고 throw 하지 않는다).
--   0행이면 제약 없음 = 그대로 배포 가능.
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
 WHERE ns.nspname = 'public' AND rel.relname = 'notifications' AND con.contype = 'c';

-- ── [4] 예상 발송량 — 최근 30일 대여 생성 건수 ────────────────────────────
SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date,
       count(*) AS 대여생성건수
  FROM public.book_checkouts
 WHERE created_at >= now() - interval '30 days'
 GROUP BY 1
 ORDER BY 1 DESC;

-- ── [5] 참고: 이번 버그(시작 판정 불일치)의 잔존 여부 ─────────────────────
--   20260727 적용 후 실행하면 세 블록 모두 0행이어야 한다.
SELECT 'A. 잠금 고착(대여 없는데 borrowed)' AS check_name, count(*) AS cnt
  FROM public.books b
 WHERE b.status = 'borrowed'
   AND NOT EXISTS (SELECT 1 FROM public.book_checkouts c
                    WHERE c.book_id = b.id AND c.status IN ('active','overdue')
                      AND c.returned_at IS NULL
                      AND (c.checkout_at AT TIME ZONE 'Asia/Seoul')::date
                          <= (now() AT TIME ZONE 'Asia/Seoul')::date)
UNION ALL
SELECT 'B. 미잠금(시작됐는데 available)', count(*)
  FROM public.books b
 WHERE b.status = 'available'
   AND EXISTS (SELECT 1 FROM public.book_checkouts c
                WHERE c.book_id = b.id AND c.status IN ('active','overdue')
                  AND c.returned_at IS NULL
                  AND (c.checkout_at AT TIME ZONE 'Asia/Seoul')::date
                      <= (now() AT TIME ZONE 'Asia/Seoul')::date)
UNION ALL
SELECT 'C. 두 기준 판정 불일치 대여', count(*)
  FROM public.book_checkouts
 WHERE status IN ('active','overdue')
   AND ((checkout_at AT TIME ZONE 'Asia/Seoul')::date
        <= (now() AT TIME ZONE 'Asia/Seoul')::date) <> (checkout_at <= now());
