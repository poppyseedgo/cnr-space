-- _diagnose_org_20261001.sql — 조직도 Phase 1 배포 후 상태 진단 (읽기 전용, 단일 결과셋)
-- Supabase SQL Editor 에서 실행. 전 항목 ✅ 여야 정상.
SELECT 1 ord, '[1] admin_roles CHECK 에 org' item,
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c'
                           AND pg_get_constraintdef(oid) LIKE '%''org''%') THEN '✅' ELSE '❌' END status,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c' LIMIT 1) detail
UNION ALL
SELECT 2, '[2] org_ 테이블 13개 + RLS',
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%' AND rowsecurity)=13 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(tablename||CASE WHEN rowsecurity THEN '' ELSE '(RLS OFF)' END, ', ' ORDER BY tablename) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%')
UNION ALL
SELECT 3, '[3] 정책 25개',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'org\_%')=25 THEN '✅' ELSE '❌' END,
       (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'org\_%')
UNION ALL
SELECT 4, '[4] 가드 트리거 5 + 로그 11 + touch 3',
       CASE WHEN (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname LIKE 'org\_%' AND NOT t.tgisinternal)=19 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(DISTINCT tgname, ', ') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relname LIKE 'org\_%' AND NOT t.tgisinternal)
UNION ALL
SELECT 5, '[5] 시드 — 상태 7 · 직급 6 · 직무 99 · 템플릿 5',
       CASE WHEN (SELECT count(*) FROM public.org_status_types WHERE is_system)=7 AND (SELECT count(*) FROM public.org_ranks)>=6
             AND (SELECT count(*) FROM public.org_jobs)>=99 AND (SELECT count(*) FROM public.org_offboarding_templates)>=5 THEN '✅' ELSE '❌' END,
       format('status %s / ranks %s / jobs %s / templates %s', (SELECT count(*) FROM public.org_status_types), (SELECT count(*) FROM public.org_ranks),
              (SELECT count(*) FROM public.org_jobs), (SELECT count(*) FROM public.org_offboarding_templates))
UNION ALL
SELECT 6, '[6] Active 유일 인덱스',
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='org_files_one_active') THEN '✅' ELSE '❌' END,
       (SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='org_files_one_active')
UNION ALL
SELECT 7, '[7] RPC 전용 테이블에 authenticated INSERT 없음',
       CASE WHEN (SELECT count(*) FROM unnest(ARRAY['org_person_status','org_change_log','org_activation_diffs']) t
                   WHERE has_table_privilege('authenticated','public.'||t,'INSERT'))=0 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(t, ', ') FROM unnest(ARRAY['org_person_status','org_change_log','org_activation_diffs']) t WHERE has_table_privilege('authenticated','public.'||t,'INSERT'))
UNION ALL
SELECT 8, '[8] anon SELECT 잔존 없음',
       CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%' AND has_table_privilege('anon','public.'||tablename,'SELECT'))=0 THEN '✅' ELSE '❌' END,
       (SELECT string_agg(tablename, ', ') FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%' AND has_table_privilege('anon','public.'||tablename,'SELECT'))
UNION ALL
SELECT 9, '[9] org 역할 보유자', CASE WHEN EXISTS (SELECT 1 FROM public.admin_roles WHERE role='org') THEN '✅' ELSE '⚠ 0명 (권한 매트릭스에서 부여 필요)' END,
       (SELECT string_agg(p.name, ', ') FROM public.admin_roles a JOIN public.profiles p ON p.id=a.user_id WHERE a.role='org')
UNION ALL
SELECT 10, '[10] 파일 현황', '✅',
       (SELECT format('draft %s / active %s / archived %s', count(*) FILTER (WHERE status='draft'), count(*) FILTER (WHERE status='active'), count(*) FILTER (WHERE status='archived')) FROM public.org_files)
ORDER BY ord;
