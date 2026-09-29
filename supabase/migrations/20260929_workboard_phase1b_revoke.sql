-- ============================================================================
-- 20260929_workboard_phase1b_revoke.sql — Phase 1 핫픽스 (이미 Phase 1 을 적용한 운영 DB 용)
--
-- 원인: Supabase 는 ALTER DEFAULT PRIVILEGES 로 public 의 모든 신규 테이블에
--       anon / authenticated 에 ALL(arwdDxtm) 을 자동 부여한다 (pg_default_acl 실측).
--       Phase 1 의 GRANT 는 추가만 했기 때문에 "직접 INSERT/UPDATE 는 GRANT 자체를 안 줌" 이
--       운영에서는 성립하지 않았다 → 진단 [9] ❌.
-- 영향: RLS 정책이 실제 게이트라 데이터는 안전했다 (INSERT/UPDATE 정책이 없어 RLS 가 차단).
--       이 파일은 두 번째 겹(테이블 권한)을 설계대로 맞추는 것.
-- 멱등 · 재실행 안전. 20260929_workboard_phase1.sql v2 에도 같은 내용이 반영되어 있어
-- 신규 환경에서는 이 파일이 필요 없다.
-- ============================================================================
BEGIN;

REVOKE ALL ON public.wb_work_areas, public.wb_milestones, public.wb_task_templates, public.wb_tasks,
              public.wb_task_assignees, public.wb_issues, public.wb_comments, public.wb_activity_log
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.wb_work_areas, public.wb_milestones, public.wb_task_templates, public.wb_tasks,
                public.wb_task_assignees, public.wb_issues, public.wb_comments, public.wb_activity_log TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wb_milestones, public.wb_task_templates, public.wb_comments TO authenticated;
GRANT DELETE ON public.wb_work_areas, public.wb_tasks, public.wb_issues TO authenticated;
-- service_role 은 기본 권한 그대로(ALL) — Edge Function · cron 경로

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM unnest(ARRAY['wb_tasks','wb_issues','wb_task_assignees','wb_activity_log','wb_work_areas']) t
   WHERE has_table_privilege('authenticated', 'public.'||t, 'INSERT') OR has_table_privilege('authenticated', 'public.'||t, 'UPDATE');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] authenticated 직접 쓰기 권한 잔존 %개', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND has_table_privilege('anon', 'public.'||tablename, 'SELECT');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] anon 에 wb_ SELECT 잔존 %개', v_cnt; END IF;
  IF NOT has_table_privilege('authenticated', 'public.wb_milestones', 'INSERT') THEN RAISE EXCEPTION '[검증] milestones 직접 쓰기가 사라짐'; END IF;
  RAISE NOTICE '[검증] Phase 1b 통과 — 직접 쓰기 권한은 milestones · templates · comments 만';
END $$;

COMMIT;
