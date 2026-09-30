-- ============================================================================
-- _diagnose_workboard_20260930.sql  — 읽기 전용 · 단일 결과셋  (v4: Phase 4 기준)
-- Phase 3-E 배포 후 SQL Editor 에서 실행. 전 항목 ✅ 여야 정상.
-- [2026-09-30 v2] 정책 16→14, 함수 6→13(3-C convert · 3-D set_task_dates · 3-E 4종), milestones 직접 쓰기 없음
-- 카탈로그(pg_*) + 존재 확정 객체(admin_roles·profiles)만 참조 → 마이그레이션이
-- 롤백됐어도 파싱 단계에서 죽지 않는다 (wb_ 테이블은 to_regclass 로만 확인).
-- ============================================================================
WITH chk AS (
  SELECT pg_get_constraintdef(oid) def FROM pg_constraint
   WHERE conrelid='public.admin_roles'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%role = ANY%'
), fn AS (
  SELECT p.proname, p.prosrc, p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
)
SELECT * FROM (
  SELECT 1 ord, '[1] admin_roles CHECK 에 workboard' item,
         CASE WHEN (SELECT def FROM chk) LIKE '%''workboard''%' THEN '✅' ELSE '❌' END ok,
         (SELECT def FROM chk) detail
  UNION ALL
  SELECT 2, '[2] admin_set_user_roles 재계산 예외',
         CASE WHEN (SELECT prosrc FROM fn WHERE proname='admin_set_user_roles') LIKE '%array_remove(v_new, ''workboard'')%' THEN '✅' ELSE '❌' END,
         'array_remove(v_new,''workboard'') 포함 여부'
  UNION ALL
  SELECT 3, '[3] wb_ 테이블 9개 존재 (P4 +recurring_runs)',
         CASE WHEN count(*)=9 THEN '✅' ELSE '❌ '||count(*)||'개' END,
         string_agg(t, ', ' ORDER BY t)
    FROM unnest(ARRAY['wb_work_areas','wb_milestones','wb_task_templates','wb_tasks','wb_task_assignees','wb_issues','wb_comments','wb_activity_log','wb_recurring_runs']) t
   WHERE to_regclass('public.'||t) IS NOT NULL
  UNION ALL
  SELECT 4, '[4] wb_ RLS 활성 9개',
         CASE WHEN count(*)=9 THEN '✅' ELSE '❌ '||count(*)||'개' END,
         string_agg(tablename, ', ' ORDER BY tablename)
    FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND rowsecurity
  UNION ALL
  SELECT 5, '[5] wb_ 정책 14개 (3-E −2 · P4: templates_write 제거 + recurring_runs select)',
         CASE WHEN count(*)=14 THEN '✅' ELSE '❌ '||count(*)||'개' END,
         string_agg(tablename||'.'||policyname||'['||cmd||']', ' ' ORDER BY tablename, policyname)
    FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%'
  UNION ALL
  SELECT 6, '[6] 정책 가드 전부 has_admin_role(''workboard'')',
         CASE WHEN count(*)=0 THEN '✅' ELSE '❌ '||count(*)||'개 어긋남' END,
         COALESCE(string_agg(tablename||'.'||policyname, ', '), '-')
    FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%'
     AND COALESCE(qual, with_check) NOT LIKE '%has_admin_role(''workboard''%'
  UNION ALL
  SELECT 7, '[7] wb_ 함수 22개 (P4 +9: 영업일 3 · period_due · 생성기 2 · 미리보기 2 · 템플릿 upsert)',
         CASE WHEN count(*)=22 AND bool_and(CASE WHEN proname IN ('wb_jsonb_diff','wb_is_workday','wb_next_workday','wb_prev_workday','wb_period_due') THEN true ELSE prosecdef END) THEN '✅' ELSE '❌ '||count(*)||'개' END,
         string_agg(proname||CASE WHEN prosecdef THEN '(definer)' ELSE '' END, ', ' ORDER BY proname)
    FROM fn WHERE proname IN ('wb_assert_member','wb_jsonb_diff','wb_upsert_work_area','wb_upsert_task','wb_set_task_status','wb_upsert_issue','wb_convert_issue_to_task','wb_set_task_dates','wb_upsert_milestone','wb_set_milestone_status','wb_delete_milestone','wb_reorder_work_areas','wb_list_members','wb_is_workday','wb_next_workday','wb_prev_workday','wb_period_due','wb_generate_recurring_internal','wb_generate_recurring_now','wb_template_preview','wb_templates_next','wb_upsert_task_template')
  UNION ALL
  SELECT 8, '[8] anon 에 wb_ 함수 EXECUTE 없음',
         CASE WHEN count(*)=0 THEN '✅' ELSE '❌ '||count(*)||'개' END,
         COALESCE(string_agg(p.proname, ', '), '-')
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'wb\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE')
  UNION ALL
  SELECT 9, '[9] authenticated 직접 INSERT 권한 — tasks·issues·assignees·activity_log·work_areas·milestones·templates·recurring_runs 없어야 함',
         CASE WHEN count(*)=0 THEN '✅' ELSE '❌ '||string_agg(t, ',') END,
         '직접 쓰기 허용 테이블: comments 만 (전부 RPC)'
    FROM unnest(ARRAY['wb_tasks','wb_issues','wb_task_assignees','wb_activity_log','wb_work_areas','wb_milestones','wb_task_templates','wb_recurring_runs']) t
   WHERE to_regclass('public.'||t) IS NOT NULL AND has_table_privilege('authenticated', 'public.'||t, 'INSERT')
  UNION ALL
  SELECT 10, '[10] workboard 역할 보유자',
         CASE WHEN count(*)>0 THEN '✅ '||count(*)||'명' ELSE '⚠ 0명 (Phase2 후 권한 매트릭스에서 부여)' END,
         COALESCE(string_agg(pr.name||'('||pr.role||')', ', ' ORDER BY pr.name), '-')
    FROM public.admin_roles a JOIN public.profiles pr ON pr.id=a.user_id WHERE a.role='workboard'
  UNION ALL
  SELECT 11, '[11] ★ workboard 단독 보유자인데 profiles.role=ADMIN (재계산 예외 이전 부여분)',
         CASE WHEN count(*)=0 THEN '✅ 0명' ELSE '❌ '||count(*)||'명 — admin_set_user_roles 재실행으로 정정' END,
         COALESCE(string_agg(pr.name, ', '), '-')
    FROM public.profiles pr
   WHERE pr.role='ADMIN'
     AND EXISTS (SELECT 1 FROM public.admin_roles a WHERE a.user_id=pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.admin_roles a WHERE a.user_id=pr.id AND a.role<>'workboard')
  UNION ALL
  SELECT 12, '[12] 데이터 현황',
         '✅',
         format('areas %s · milestones %s · templates %s · tasks %s · issues %s · comments %s · log %s',
           (SELECT count(*) FROM public.wb_work_areas), (SELECT count(*) FROM public.wb_milestones),
           (SELECT count(*) FROM public.wb_task_templates), (SELECT count(*) FROM public.wb_tasks),
           (SELECT count(*) FROM public.wb_issues), (SELECT count(*) FROM public.wb_comments),
           (SELECT count(*) FROM public.wb_activity_log))
   WHERE to_regclass('public.wb_activity_log') IS NOT NULL
) x ORDER BY ord;
