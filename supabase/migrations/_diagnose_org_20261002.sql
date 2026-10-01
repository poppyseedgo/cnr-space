-- _diagnose_org_20261002.sql — 조직도 Phase 2 배포 후 상태 진단 (읽기 전용, 단일 결과셋)
SELECT 1 ord, '[1] RPC 13종' item,
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
         ('employment_status_apply','org_assert_org','org_assert_super','org_acquire_lock','org_release_lock','org_roster_check','org_copy_file',
          'org_activate_file','org_set_person_status','org_end_person_status','org_link_planned_person','org_on_departed','org_daily_transitions'))=13 THEN '✅' ELSE '❌' END status,
       (SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'org\_%' OR p.proname='employment_status_apply')) detail
UNION ALL
SELECT 2, '[2] admin_set_employment_status = 가드 + employment_status_apply 호출',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname='admin_set_employment_status') LIKE '%employment_status_apply%' THEN '✅' ELSE '❌' END,
       left((SELECT prosrc FROM pg_proc WHERE proname='admin_set_employment_status'), 200)
UNION ALL
SELECT 3, '[3] notification_required_roles org_% → org',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE proname='notification_required_roles') LIKE '%org\_%' THEN '✅' ELSE '❌' END,
       (SELECT array_to_string(public.notification_required_roles('org_activated'), ','))
UNION ALL
SELECT 4, '[4] departed_users 트리거 2개 (권한 회수 + 조직도 상태 종결)',
       CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='departed_users' AND NOT t.tgisinternal)=2 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(tgname, ', ') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname='departed_users' AND NOT t.tgisinternal)
UNION ALL
SELECT 5, '[5] pg_cron org-daily-transitions-0015kst',
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname='org-daily-transitions-0015kst' AND active) THEN '✅' ELSE '❌' END,
       (SELECT schedule||' · '||command FROM cron.job WHERE jobname='org-daily-transitions-0015kst')
UNION ALL
SELECT 6, '[6] 내부 함수 authenticated 실행 불가',
       CASE WHEN NOT has_function_privilege('authenticated','public.employment_status_apply(uuid,text,date)','EXECUTE')
             AND NOT has_function_privilege('authenticated','public.org_daily_transitions()','EXECUTE') THEN '✅' ELSE '❌' END,
       'employment_status_apply / org_daily_transitions'
UNION ALL
SELECT 7, '[7] 담당자 RPC authenticated 실행 가능',
       CASE WHEN has_function_privilege('authenticated','public.org_copy_file(uuid,text,date)','EXECUTE')
             AND has_function_privilege('authenticated','public.org_set_person_status(uuid,uuid,text,jsonb)','EXECUTE')
             AND has_function_privilege('authenticated','public.org_activate_file(uuid,boolean)','EXECUTE') THEN '✅' ELSE '❌' END,
       'org_copy_file / org_set_person_status / org_activate_file (내부 가드가 역할 검사)'
UNION ALL
SELECT 8, '[8] 활성 상태 현황', '✅',
       COALESCE((SELECT string_agg(status_code||':'||n, ', ') FROM (SELECT status_code, count(*) n FROM public.org_person_status WHERE ended_at IS NULL GROUP BY 1) s), '(없음)')
UNION ALL
SELECT 9, '[9] cron 최근 실행', COALESCE((SELECT status FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='org-daily-transitions-0015kst' ORDER BY d.start_time DESC LIMIT 1), '(아직 없음)'),
       (SELECT return_message FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='org-daily-transitions-0015kst' ORDER BY d.start_time DESC LIMIT 1)
ORDER BY ord;
