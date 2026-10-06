-- ============================================================================
-- 공지 읽기 경로 2종을 서버 함수로 분리 — 헤더 배너(지금 게시 중) / 공지사항 페이지(이력)   (2026-10-06)
--
-- 배경 (운영 실측, 2026-10-06):
--   ① 공지사항 페이지가 일반 직원에게 비어 있다 (공지 8건 중 0건).
--      8/19 확정 설계("게시가 시작된 활성 공지는 종료 후에도 전 직원 열람")를 담은 20260749 가 운영에 반영돼 있지 않고,
--      announcements_select 는 그 이전 상태(게시 중 OR notice 관리자)다. 관리자는 전체가 보여 드러나지 않았다.
--   ② notice 관리자 계정의 헤더 배너에 종료된 공지가 뜬다 (9/21 종료 노쇼 공지).
--      배너 조회(api.ts loadActiveAnnouncement)는 "is_active 중 최근 시작 1건" 만 묻고 게시 기간 판정을 RLS 에 맡겼는데,
--      RLS 는 관리자에게 전체 행을 준다 → 관리자에게는 기간과 무관한 1건이 내려온다.
--
-- 근본원인: RLS(누가 어떤 행을 읽을 수 있나)를 화면 조회 조건(지금 무엇을 보여줄까)으로 겸용했다.
--   읽을 수 있는 범위가 "게시 중"보다 넓어지는 순간(관리자 · 이력 열람) 배너가 틀어진다.
--   그래서 20260749(정책을 이력까지 확장)를 그대로 적용하면 ②가 전 직원으로 번진다 — 적용하지 않는다.
--
-- 변경: 두 화면이 각자 "무엇을 보여줄지"를 서버 함수 한 곳에서 판정한다 (서버 시각 now()).
--   [A] get_active_announcement()   헤더 배너 — 지금 게시 중인 공지 중 최근 시작 1건
--         is_active AND starts_at <= now() <= ends_at · SECURITY INVOKER (RLS 그대로 적용 — 접근 범위를 넓히지 않는다)
--   [B] get_announcement_history()  공지사항 페이지 — 게시가 시작된 활성 공지 (종료분 포함)
--         is_active AND now() >= starts_at  ← 8/19 확정 기준(20260749 와 동일 식). 예약(미래 시작)·철회(is_active=false)는 제외
--         SECURITY DEFINER (종료된 공지는 테이블 정책상 일반 직원이 직접 읽을 수 없으므로) · 로그인 사용자만
--   둘 다 실행 권한 = authenticated · service_role (anon 불가 — 20261018 과 같은 원칙)
--
-- 바꾸지 않는 것: announcements 테이블 정책 2개(20261018 적용 상태 그대로).
--   → 배포 전에 열려 있던 탭(이전 프론트)은 지금과 똑같이 동작한다. 프론트 배포와 실행 순서가 엇갈려도 회귀가 없다.
--     (이 SQL 을 먼저 실행 → 그 다음 프론트 배포. SQL 만 실행된 동안은 아무 화면도 달라지지 않는다)
--
-- 선행: 20261018_announcements_authenticated_only.sql
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 재실행 안전)
-- 운영 적용: 2026-10-06 (BEGIN~COMMIT 본문 적용 — 함수 정의 md5 가 로컬 시뮬 적용본과 일치함을 확인)
-- 롤백: 파일 맨 아래 주석 (프론트를 이전 버전으로 되돌린 뒤에만)
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 헤더 배너 — 지금 게시 중인 공지 1건 (기간이 겹치면 최근 시작한 것 · 종전 정렬 기준 그대로)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_active_announcement()
 RETURNS SETOF public.announcements
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.*
    FROM public.announcements a
   WHERE a.is_active
     AND now() >= a.starts_at
     AND now() <= a.ends_at
   ORDER BY a.starts_at DESC, a.created_at DESC
   LIMIT 1
$function$;

COMMENT ON FUNCTION public.get_active_announcement() IS
  '[2026-10-06] 헤더 공지 배너 — 지금 게시 중(is_active · 기간 내)인 공지 중 최근 시작 1건. "게시 중" 판정의 단일 지점(서버 시각). SECURITY INVOKER';

REVOKE EXECUTE ON FUNCTION public.get_active_announcement() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_active_announcement() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 공지사항 페이지 — 게시가 시작된 활성 공지 (종료분 포함). 기간 창(최근 6개월)·정렬은 화면이 정한다
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_announcement_history()
 RETURNS SETOF public.announcements
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.*
    FROM public.announcements a
   WHERE auth.uid() IS NOT NULL      -- 로그인 사용자만 (DEFINER 라 RLS 를 거치지 않으므로 여기서 확인)
     AND a.is_active                 -- 철회·임시저장 제외
     AND now() >= a.starts_at        -- 예약(게시 전) 제외
$function$;

COMMENT ON FUNCTION public.get_announcement_history() IS
  '[2026-10-06] 공지사항 페이지 — 게시가 시작된 활성 공지(종료분 포함, 8/19 확정 기준). 예약·철회 공지 제외. SECURITY DEFINER · 로그인 사용자만';

REVOKE EXECUTE ON FUNCTION public.get_announcement_history() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_announcement_history() TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 검증 — 하나라도 어긋나면 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- 함수 2종: 보안 속성 (배너 = INVOKER, 이력 = DEFINER)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND ( (p.proname = 'get_active_announcement'  AND NOT p.prosecdef)
        OR (p.proname = 'get_announcement_history' AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres') );
  IF v_n <> 2 THEN RAISE EXCEPTION '검증 실패: 공지 조회 함수 % / 2 (보안 속성·소유자 확인 필요)', v_n; END IF;

  -- 실행 권한: 로그인 사용자 가능 · 비로그인 불가
  IF NOT has_function_privilege('authenticated', 'public.get_active_announcement()',  'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_announcement_history()', 'EXECUTE') THEN
    RAISE EXCEPTION '검증 실패: authenticated 실행 권한 없음';
  END IF;
  IF has_function_privilege('anon', 'public.get_active_announcement()',  'EXECUTE')
     OR has_function_privilege('anon', 'public.get_announcement_history()', 'EXECUTE') THEN
    RAISE EXCEPTION '검증 실패: anon 에 실행 권한이 남아 있음';
  END IF;

  -- 테이블 정책은 건드리지 않았는지 (20261018 적용 상태: 2개 모두 authenticated 전용)
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'announcements'
     AND policyname IN ('announcements_select', 'announcements_admin_write')
     AND roles = '{authenticated}'::name[];
  IF v_n <> 2 THEN RAISE EXCEPTION '검증 실패: announcements 정책 % / 2 (선행 20261018 미적용?)', v_n; END IF;
END $$;

COMMIT;

-- ── 확인 (SQL Editor = postgres 실행이라 RLS 를 거치지 않는다 — 건수만 본다) ──
--   banner_now      : 지금 게시 중인 공지 수 (0 이면 헤더 배너 없음이 정상)
--   history_total   : 공지사항 페이지 대상(게시 시작 + 활성). auth.uid() 가 없는 SQL Editor 에서는 함수가 0행을 주므로 식으로 직접 센다
SELECT
  (SELECT count(*) FROM public.announcements WHERE is_active AND now() >= starts_at AND now() <= ends_at) AS banner_now,
  (SELECT count(*) FROM public.announcements WHERE is_active AND now() >= starts_at)                     AS history_total,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('get_active_announcement', 'get_announcement_history')) AS functions;

-- ── 롤백 (프론트를 이전 버전으로 되돌린 뒤에만 — 새 프론트는 이 함수를 호출한다) ──
-- DROP FUNCTION IF EXISTS public.get_active_announcement();
-- DROP FUNCTION IF EXISTS public.get_announcement_history();
