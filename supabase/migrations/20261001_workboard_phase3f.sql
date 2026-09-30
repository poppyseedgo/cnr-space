-- ============================================================================
-- WORKBOARD Phase 3-F — 멤버 풀 RPC  wb_list_members()   (2026-09-30)
--   사람 선택(담당자·주/부 담당·담당자 필터)의 검색 풀을 "Work Space 를 쓸 수 있는 사람"으로 한정한다.
--   멤버 = admin_roles.role IN ('workboard','super') 보유 ∧ profiles.is_active ≠ false  (고지 확정: super 반드시 포함)
--
--   왜 RPC 인가: admin_roles SELECT 정책(20260730)은 본인·super·'user' 역할만 타인 행을 읽을 수 있다.
--   workboard 단독 보유자는 다른 멤버의 권한 행을 못 읽으므로 프론트 조인으로는 풀을 만들 수 없다
--   → SECURITY DEFINER + wb_assert_member() 가드로 멤버에게만 멤버 목록을 준다.
--
-- 선행: 20260929_workboard_phase1 (wb_assert_member)
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run (멱등)
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.wb_list_members();
CREATE FUNCTION public.wb_list_members()
 RETURNS TABLE (
   user_id           uuid,
   name              text,
   dept              text,
   email             text,
   avatar_url        text,
   employment_status text,
   is_super          boolean
 )
 LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
  SELECT p.id, p.name, p.dept, p.email, p.avatar_url, p.employment_status,
         bool_or(r.role = 'super') AS is_super
    FROM public.profiles p
    JOIN public.admin_roles r ON r.user_id = p.id AND r.role IN ('workboard','super')
   WHERE public.wb_assert_member() IS NOT NULL      -- 가드 (비멤버 → NOT_WORKBOARD, 비로그인 → NOT_AUTHENTICATED)
     AND p.is_active IS DISTINCT FROM false
   GROUP BY p.id, p.name, p.dept, p.email, p.avatar_url, p.employment_status
   ORDER BY p.name COLLATE "C", p.id
$$;
COMMENT ON FUNCTION public.wb_list_members() IS '[WORKBOARD] 사람 선택 풀 — workboard·super 보유 재직자. 멤버만 호출 가능';

REVOKE ALL ON FUNCTION public.wb_list_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_list_members() TO authenticated, service_role;

-- 검증
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='wb_list_members' AND p.prosecdef;
  IF v_cnt <> 1 THEN RAISE EXCEPTION '[검증] wb_list_members 없음/definer 아님'; END IF;
  IF has_function_privilege('anon', 'public.wb_list_members()', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] anon 이 wb_list_members 실행 가능';
  END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 3-F 통과';
END $$;

COMMIT;
