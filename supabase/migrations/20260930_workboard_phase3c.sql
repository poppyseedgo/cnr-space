-- ============================================================================
-- 20260930_workboard_phase3c.sql — WORKBOARD Phase 3-C · 이슈 → 업무 전환 RPC
--
-- 왜 필요한가
--   Phase 1 [F] 에서 authenticated 의 wb_issues 권한은 SELECT·DELETE 뿐이고 쓰기는 wb_upsert_issue
--   만 열려 있다. converted_task_id 는 그 RPC 인자에 없어(의도: 전환은 "업무 생성 + 연결 + 상태 전이"
--   가 한 트랜잭션이어야 함) 클라이언트가 채울 방법이 없다 → 전환 전용 RPC 1개.
--
-- 동작 (원자적)
--   ① 이슈 존재·미전환 검증  ② wb_upsert_task 로 업무 생성(제목·설명 복사, 담당 = 이슈 보고자)
--   ③ wb_issues.converted_task_id / task_id 연결 + status open → in_progress
--   ④ activity_log 'converted' (issue) — task 쪽 'created' 는 ②에서 이미 기록됨
-- 멱등 아님 — 이미 전환된 이슈는 ALREADY_CONVERTED. 재실행 안전(CREATE OR REPLACE).
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.wb_convert_issue_to_task(p_issue_id uuid, p_area_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid     uuid := public.wb_assert_member();
  v_issue   public.wb_issues%ROWTYPE;
  v_task_id uuid;
  v_assignees uuid[];
BEGIN
  SELECT * INTO v_issue FROM public.wb_issues WHERE id = p_issue_id FOR UPDATE;
  IF v_issue.id IS NULL THEN RAISE EXCEPTION 'ISSUE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_issue.converted_task_id IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CONVERTED' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wb_work_areas WHERE id = p_area_id) THEN RAISE EXCEPTION 'AREA_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  -- 담당 = 보고자(있으면), 없으면 전환한 사람
  v_assignees := ARRAY[COALESCE(v_issue.reporter_id, v_uid)];

  -- 업무 생성 (기존 RPC 재사용 → activity_log 'created' + 'assignees' 기록)
  v_task_id := public.wb_upsert_task(
    NULL, p_area_id, v_issue.title,
    CASE WHEN v_issue.description IS NULL THEN format('[이슈 전환] 발생 %s', v_issue.occurred_on)
         ELSE format('[이슈 전환] 발생 %s%s%s', v_issue.occurred_on, E'\n\n', v_issue.description) END,
    CASE v_issue.severity WHEN 'critical' THEN 'urgent' WHEN 'high' THEN 'high' WHEN 'low' THEN 'low' ELSE 'normal' END,
    NULL, v_issue.milestone_id, '[]'::jsonb, v_assignees);

  UPDATE public.wb_issues
     SET converted_task_id = v_task_id,
         task_id = COALESCE(task_id, v_task_id),       -- 기존 연결 업무가 없으면 전환 업무를 연결로
         status  = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
         updated_at = now()
   WHERE id = p_issue_id;

  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('issue', p_issue_id, 'converted', jsonb_build_object('task_id', v_task_id,
          'status', jsonb_build_object('from', v_issue.status, 'to', CASE WHEN v_issue.status = 'open' THEN 'in_progress' ELSE v_issue.status END)), v_uid);

  RETURN v_task_id;
END $$;

REVOKE ALL ON FUNCTION public.wb_convert_issue_to_task(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_convert_issue_to_task(uuid,uuid) TO authenticated, service_role;

-- 이슈 목록 조회 인덱스 (status + occurred_on 은 Phase 1 에 있음; 전환 역참조용)
CREATE INDEX IF NOT EXISTS idx_wb_issues_converted ON public.wb_issues (converted_task_id) WHERE converted_task_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wb_convert_issue_to_task' AND p.prosecdef) THEN
    RAISE EXCEPTION '[검증] wb_convert_issue_to_task 미생성';
  END IF;
  IF has_function_privilege('anon', 'public.wb_convert_issue_to_task(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] anon EXECUTE 잔존';
  END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 3-C 통과';
END $$;

COMMIT;
