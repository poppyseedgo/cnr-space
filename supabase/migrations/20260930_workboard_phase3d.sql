-- ============================================================================
-- 20260930_workboard_phase3d.sql — WORKBOARD Phase 3-D · 일정(타임라인) DB
--
-- [A] wb_tasks.start_on date (nullable) — 기간 업무 시작일. NULL = 마감만 있는 업무(◆)
--     CHECK: start_on ≤ due_at 의 KST 날짜. due_at 이 NULL 이면 start_on 만으로도 허용(시작만 잡힌 업무)
-- [B] wb_upsert_task 에 p_start_on 추가 — ⚠ 9-인자 구버전을 DROP 하고 10-인자로 재생성.
--     CREATE OR REPLACE 만 하면 오버로드 2개가 공존해 PostgREST rpc(named args) 가
--     "Could not choose the best candidate function" 으로 실패한다. 3-C 의 wb_convert_issue_to_task 는
--     9개 위치 인자로 호출하므로 10번째 DEFAULT NULL 로 그대로 동작.
-- [C] wb_set_task_dates — 타임라인 바 드래그 전용 (start_on·due_at 만 갱신, 이력 'dates').
--     전체 upsert 로 하면 드래그 중 클라 스냅샷이 다른 필드(체크리스트·담당)를 덮어쓸 수 있어 분리.
-- 멱등 · 재실행 안전.
-- ============================================================================
BEGIN;

-- [A]
ALTER TABLE public.wb_tasks ADD COLUMN IF NOT EXISTS start_on date;
ALTER TABLE public.wb_tasks DROP CONSTRAINT IF EXISTS wb_tasks_start_before_due;
ALTER TABLE public.wb_tasks ADD CONSTRAINT wb_tasks_start_before_due
  CHECK (start_on IS NULL OR due_at IS NULL OR start_on <= (due_at AT TIME ZONE 'Asia/Seoul')::date);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_start_on ON public.wb_tasks (start_on) WHERE start_on IS NOT NULL;
COMMENT ON COLUMN public.wb_tasks.start_on IS '[3-D] 기간 업무 시작일(KST date). NULL=마감만. 타임라인 바 = start_on~due_at';

-- [B] 구버전 DROP → 10-인자 재생성 (본문은 Phase 1 원문 + start_on 3곳)
DROP FUNCTION IF EXISTS public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[]);

CREATE OR REPLACE FUNCTION public.wb_upsert_task(
  p_id            uuid,
  p_area_id       uuid,
  p_title         text,
  p_description   text DEFAULT NULL,
  p_priority      text DEFAULT 'normal',
  p_due_at        timestamptz DEFAULT NULL,
  p_milestone_id  uuid DEFAULT NULL,
  p_checklist     jsonb DEFAULT '[]'::jsonb,
  p_assignee_ids  uuid[] DEFAULT '{}',
  p_start_on      date DEFAULT NULL           -- ← [3-D]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid   uuid := public.wb_assert_member();
  v_id    uuid;
  v_old   jsonb;
  v_new   jsonb;
  v_diff  jsonb;
  v_ass   uuid[] := (SELECT COALESCE(array_agg(DISTINCT x), '{}') FROM unnest(COALESCE(p_assignee_ids, '{}')) x WHERE x IS NOT NULL);
  v_cur   uuid[];
  v_added uuid[];
  v_removed uuid[];
BEGIN
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001'; END IF;
  IF p_priority NOT IN ('low','normal','high','urgent') THEN RAISE EXCEPTION 'INVALID_PRIORITY' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(COALESCE(p_checklist, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'INVALID_CHECKLIST' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wb_work_areas WHERE id = p_area_id) THEN RAISE EXCEPTION 'AREA_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF p_milestone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wb_milestones WHERE id = p_milestone_id) THEN
    RAISE EXCEPTION 'MILESTONE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_on IS NOT NULL AND p_due_at IS NOT NULL AND p_start_on > (p_due_at AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'START_AFTER_DUE' USING ERRCODE = 'P0001';           -- ← [3-D]
  END IF;

  v_new := jsonb_build_object(
    'area_id', p_area_id, 'milestone_id', p_milestone_id, 'title', p_title,
    'description', p_description, 'priority', p_priority, 'due_at', p_due_at, 'start_on', p_start_on,   -- ← [3-D]
    'checklist', COALESCE(p_checklist, '[]'::jsonb));

  IF p_id IS NULL THEN
    INSERT INTO public.wb_tasks (area_id, milestone_id, title, description, priority, due_at, start_on, checklist, created_by)
    VALUES (p_area_id, p_milestone_id, p_title, p_description, p_priority, p_due_at, p_start_on, COALESCE(p_checklist, '[]'::jsonb), v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('task', v_id, 'created', v_new - 'checklist', v_uid);
    v_cur := '{}';
  ELSE
    v_id := p_id;
    SELECT jsonb_build_object(
      'area_id', area_id, 'milestone_id', milestone_id, 'title', title,
      'description', description, 'priority', priority, 'due_at', due_at, 'start_on', start_on, 'checklist', checklist)   -- ← [3-D]
      INTO v_old FROM public.wb_tasks WHERE id = v_id FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

    v_diff := public.wb_jsonb_diff(v_old, v_new);
    IF v_diff <> '{}'::jsonb THEN
      UPDATE public.wb_tasks
         SET area_id = p_area_id, milestone_id = p_milestone_id, title = p_title,
             description = p_description, priority = p_priority, due_at = p_due_at, start_on = p_start_on,   -- ← [3-D]
             checklist = COALESCE(p_checklist, '[]'::jsonb), updated_at = now()
       WHERE id = v_id;
      INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
      VALUES ('task', v_id, 'updated', v_diff, v_uid);
    END IF;
    SELECT COALESCE(array_agg(user_id), '{}') INTO v_cur FROM public.wb_task_assignees WHERE task_id = v_id;
  END IF;

  SELECT COALESCE(array_agg(x), '{}') INTO v_added   FROM unnest(v_ass) x WHERE NOT (x = ANY(v_cur));
  SELECT COALESCE(array_agg(x), '{}') INTO v_removed FROM unnest(v_cur) x WHERE NOT (x = ANY(v_ass));
  IF cardinality(v_removed) > 0 THEN
    DELETE FROM public.wb_task_assignees WHERE task_id = v_id AND user_id = ANY(v_removed);
  END IF;
  IF cardinality(v_added) > 0 THEN
    INSERT INTO public.wb_task_assignees (task_id, user_id, assigned_by)
    SELECT v_id, x, v_uid FROM unnest(v_added) x
    ON CONFLICT DO NOTHING;
  END IF;
  IF cardinality(v_added) > 0 OR cardinality(v_removed) > 0 THEN
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('task', v_id, 'assignees', jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)), v_uid);
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[],date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[],date) TO authenticated, service_role;

-- [C] 드래그 전용
CREATE OR REPLACE FUNCTION public.wb_set_task_dates(p_id uuid, p_start_on date, p_due_at timestamptz)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid uuid := public.wb_assert_member();
  v_old_start date; v_old_due timestamptz;
BEGIN
  IF p_start_on IS NOT NULL AND p_due_at IS NOT NULL AND p_start_on > (p_due_at AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'START_AFTER_DUE' USING ERRCODE = 'P0001';
  END IF;
  SELECT start_on, due_at INTO v_old_start, v_old_due FROM public.wb_tasks WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_old_start IS NOT DISTINCT FROM p_start_on AND v_old_due IS NOT DISTINCT FROM p_due_at THEN RETURN; END IF;

  UPDATE public.wb_tasks SET start_on = p_start_on, due_at = p_due_at, updated_at = now() WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('task', p_id, 'dates', jsonb_build_object(
    'start_on', jsonb_build_object('from', v_old_start, 'to', p_start_on),
    'due_at',   jsonb_build_object('from', v_old_due,   'to', p_due_at)), v_uid);
END $$;
REVOKE ALL ON FUNCTION public.wb_set_task_dates(uuid,date,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_set_task_dates(uuid,date,timestamptz) TO authenticated, service_role;

DO $$
DECLARE v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='wb_tasks' AND column_name='start_on') THEN
    RAISE EXCEPTION '[검증] start_on 컬럼 없음';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wb_upsert_task';
  IF v_cnt <> 1 THEN RAISE EXCEPTION '[검증] wb_upsert_task 오버로드 %개 (기대 1 — PostgREST 모호성)', v_cnt; END IF;
  IF (SELECT pronargs FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wb_upsert_task') <> 10 THEN
    RAISE EXCEPTION '[검증] wb_upsert_task 인자 수 ≠ 10';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='wb_set_task_dates' AND p.prosecdef) THEN
    RAISE EXCEPTION '[검증] wb_set_task_dates 미생성';
  END IF;
  IF has_function_privilege('anon', 'public.wb_set_task_dates(uuid,date,timestamptz)', 'EXECUTE') OR has_function_privilege('anon', 'public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[],date)', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] anon EXECUTE 잔존';
  END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 3-D 통과';
END $$;

COMMIT;
