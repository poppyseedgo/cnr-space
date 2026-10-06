-- ============================================================================
-- 공지(announcements) 정책을 로그인 사용자 전용으로 한정                 (2026-10-06)
--
-- 배경 (운영 실측, 2026-10-06):
--   헤더 공지 조회는 App 마운트 시 1회 나가므로 로그인 화면(비로그인)에서도 요청된다.
--   announcements 정책 2개는 대상 역할 없이(= public, anon 포함) 만들어져 있어 anon 요청에서도
--   정책식의 has_admin_role() 이 평가되는데, has_admin_role 실행 권한은 authenticated 에만 있다(20260511).
--   → "permission denied for function has_admin_role" (HTTP 401). 최근 24시간 16건, 전부 anon
--     (로그인 화면 진입 · 검색엔진 봇). 로그인 사용자의 공지 표시는 영향 없음.
--
-- 확정 (고지, 2026-10-06): 로그인하지 않으면 서비스에 들어올 수 없다 → 공지도 로그인 사용자 전용.
--
-- 변경: 정책 2개의 "대상 역할"만 public → authenticated. 정책식(USING / WITH CHECK)은 건드리지 않는다.
--   · anon                    : 적용되는 정책이 없어 조회 0행(오류 없는 빈 결과) · 쓰기는 RLS 가 거부
--   · authenticated           : 지금과 동일 (일반 사용자 = 게시 중 공지, notice 관리자 = 전체)
--   · service_role / postgres : RLS 우회 — 지금과 동일
--
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 재실행 안전)
-- 운영 적용: 2026-10-06 (고지, SQL Editor) — 적용 후 정책 2개 roles = {authenticated} 확인
-- 롤백: 파일 맨 아래 주석 2줄
-- ============================================================================
BEGIN;

ALTER POLICY announcements_select      ON public.announcements TO authenticated;
ALTER POLICY announcements_admin_write ON public.announcements TO authenticated;

-- 검증 — 하나라도 어긋나면 전체 롤백
DO $$
DECLARE
  v_n integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.announcements'::regclass) THEN
    RAISE EXCEPTION '검증 실패: announcements RLS 비활성 (정책 대상 역할 변경이 무의미)';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'announcements'
     AND policyname IN ('announcements_select', 'announcements_admin_write')
     AND roles = '{authenticated}'::name[];
  IF v_n <> 2 THEN RAISE EXCEPTION '검증 실패: authenticated 전용 정책 % / 2', v_n; END IF;

  -- 비로그인(anon · public)에 열려 있는 정책이 남아 있지 않은지
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'announcements'
     AND roles <> '{authenticated}'::name[];
  IF v_n <> 0 THEN RAISE EXCEPTION '검증 실패: 로그인 전용이 아닌 정책 %개 잔존', v_n; END IF;
END $$;

COMMIT;

-- ── 확인 (기대값: 2행 모두 roles = {authenticated}) ──
SELECT policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'announcements'
 ORDER BY policyname;

-- ── 롤백 (적용 전 상태로) ──
-- ALTER POLICY announcements_select      ON public.announcements TO public;
-- ALTER POLICY announcements_admin_write ON public.announcements TO public;
