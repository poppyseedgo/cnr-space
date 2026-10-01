-- _diagnose_org_20261007.sql — 조직도 Phase 4-B 배포 후 상태 진단 (읽기 전용, 단일 결과셋)
--   SQL Editor 에서 20261007_org_phase4b.sql 적용 후 실행. 전부 ✅ 면 정상.
SELECT 1 ord, '[1] org_offboarding_system_check(uuid) 존재 · SECURITY DEFINER' item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                          WHERE n.nspname='public' AND p.proname='org_offboarding_system_check' AND p.prosecdef) THEN '✅' ELSE '❌' END status,
       (SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='org_offboarding_system_check' LIMIT 1) detail
UNION ALL
SELECT 2, '[2] org_offboarding_system_check — authenticated EXECUTE · anon 없음',
       CASE WHEN has_function_privilege('authenticated','public.org_offboarding_system_check(uuid)','EXECUTE')
             AND NOT has_function_privilege('anon','public.org_offboarding_system_check(uuid)','EXECUTE') THEN '✅' ELSE '❌' END,
       '내부 org_assert_org() 가 역할 검사'
UNION ALL
SELECT 3, '[3] org_activate_file — 인앱 INSERT 제거(알림은 Edge send-notification 담당)',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname='org_activate_file') NOT LIKE '%INSERT INTO public.notifications%' THEN '✅' ELSE '❌' END,
       '20261007 이전 버전은 notifications 직접 INSERT'
UNION ALL
SELECT 4, '[4] org_activate_file — 반환에 file_name · units · cards 포함',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname='org_activate_file') LIKE '%''file_name''%'
             AND (SELECT prosrc FROM pg_proc WHERE proname='org_activate_file') LIKE '%''prev_file_name''%' THEN '✅' ELSE '❌' END,
       'OrgActivateResult (orgApi.ts) 와 1:1'
UNION ALL
SELECT 5, '[5] notification_required_roles(''org_activated'') = {org}',
       CASE WHEN public.notification_required_roles('org_activated') = ARRAY['org']::text[] THEN '✅' ELSE '❌' END,
       array_to_string(public.notification_required_roles('org_activated'), ',')
UNION ALL
SELECT 6, '[6] org 역할 보유자 수 (알림 수신 대상)',
       CASE WHEN (SELECT count(*) FROM public.admin_roles WHERE role IN ('org','super')) > 0 THEN '✅' ELSE '⚠️' END,
       (SELECT string_agg(p.name || '(' || r.role || ')', ', ') FROM public.admin_roles r JOIN public.profiles p ON p.id = r.user_id WHERE r.role IN ('org','super'))
UNION ALL
SELECT 7, '[7] 코드 테이블 RLS — org 쓰기 정책 존재 (org_ranks/org_jobs/org_status_types/org_offboarding_templates)',
       CASE WHEN (SELECT count(DISTINCT tablename) FROM pg_policies WHERE schemaname='public'
                   AND tablename IN ('org_ranks','org_jobs','org_status_types','org_offboarding_templates') AND cmd IN ('ALL','INSERT','UPDATE')) = 4 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(tablename||':'||policyname, ', ') FROM pg_policies WHERE schemaname='public' AND tablename IN ('org_ranks','org_jobs','org_status_types','org_offboarding_templates'))
UNION ALL
SELECT 8, '[8] 시스템 상태코드 보호 트리거',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.org_status_types'::regclass AND NOT tgisinternal) THEN '✅' ELSE '❌' END,
       (SELECT string_agg(tgname, ', ') FROM pg_trigger WHERE tgrelid='public.org_status_types'::regclass AND NOT tgisinternal)
ORDER BY ord;
