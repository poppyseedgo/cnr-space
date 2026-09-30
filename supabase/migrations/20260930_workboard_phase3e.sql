-- ============================================================================
-- WORKBOARD Phase 3-E — 마일스톤 · 업무영역(분장표) 쓰기 경로 통일   (2026-09-30)
--   [A] wb_activity_log.target_type 에 'milestone' 추가
--   [B] RPC 4종
--       wb_upsert_milestone(p_id, p_title, p_description, p_start_on, p_end_on)  → uuid
--       wb_set_milestone_status(p_id, p_status)                                  → text
--       wb_delete_milestone(p_id)   연결 업무·이슈 0건일 때만 (고지 확정 2026-09-30)
--       wb_reorder_work_areas(p_ids uuid[])   한 트랜잭션에 전체 재번호
--   [C] 권한 회수 — wb_milestones 직접 INSERT/UPDATE/DELETE, wb_work_areas 직접 DELETE
--       (업무영역은 삭제 없음 · 비활성화 정책 — 고지 확정 2026-09-30)
--       정책 16 → 14 (wb_milestones_write, wb_work_areas_delete 제거)
--   [D] 검증 DO 블록
--
-- 선행: 20260929_workboard_phase1(v2 또는 v1+1b) · 20260930_phase3c · 20260930_phase3d
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run (트랜잭션 1개, 멱등)
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] activity_log target_type 확장 (컬럼 인라인 CHECK 라 이름을 카탈로그에서 찾는다)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.wb_activity_log'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%target_type%';
  IF v_name IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = v_name AND conrelid = 'public.wb_activity_log'::regclass)) LIKE '%milestone%' THEN
    RETURN;   -- 이미 적용
  END IF;
  IF v_name IS NOT NULL THEN EXECUTE format('ALTER TABLE public.wb_activity_log DROP CONSTRAINT %I', v_name); END IF;
  ALTER TABLE public.wb_activity_log
    ADD CONSTRAINT wb_activity_log_target_type_check CHECK (target_type IN ('area','task','issue','milestone'));
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] RPC
-- ────────────────────────────────────────────────────────────────────────────

-- B-1 마일스톤 생성/수정 (상태는 B-2 로만 바꾼다 — 상태 이력을 별도 action 으로 남기기 위해)
CREATE OR REPLACE FUNCTION public.wb_upsert_milestone(
  p_id          uuid,                 -- NULL 이면 생성
  p_title       text,
  p_description text DEFAULT NULL,
  p_start_on    date DEFAULT NULL,
  p_end_on      date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid  uuid := public.wb_assert_member();
  v_id   uuid;
  v_old  jsonb;
  v_new  jsonb;
  v_diff jsonb;
BEGIN
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_on IS NOT NULL AND p_end_on IS NOT NULL AND p_end_on < p_start_on THEN
    RAISE EXCEPTION 'END_BEFORE_START' USING ERRCODE = 'P0001';
  END IF;

  v_new := jsonb_build_object('title', btrim(p_title), 'description', p_description, 'start_on', p_start_on, 'end_on', p_end_on);

  IF p_id IS NULL THEN
    INSERT INTO public.wb_milestones (title, description, start_on, end_on, created_by)
    VALUES (btrim(p_title), p_description, p_start_on, p_end_on, v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('milestone', v_id, 'created', v_new, v_uid);
    RETURN v_id;
  END IF;

  SELECT jsonb_build_object('title', title, 'description', description, 'start_on', start_on, 'end_on', end_on)
    INTO v_old FROM public.wb_milestones WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'MILESTONE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  v_diff := public.wb_jsonb_diff(v_old, v_new);
  IF v_diff = '{}'::jsonb THEN RETURN p_id; END IF;      -- 변경 없음 → 이력도 없음

  UPDATE public.wb_milestones
     SET title = btrim(p_title), description = p_description, start_on = p_start_on, end_on = p_end_on, updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('milestone', p_id, 'updated', v_diff, v_uid);
  RETURN p_id;
END $$;

-- B-2 상태 전이 (planned · active · done · cancelled). 같은 값이면 무동작
CREATE OR REPLACE FUNCTION public.wb_set_milestone_status(p_id uuid, p_status text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid uuid := public.wb_assert_member();
  v_old text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('planned','active','done','cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001';
  END IF;
  SELECT status INTO v_old FROM public.wb_milestones WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'MILESTONE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_old = p_status THEN RETURN p_status; END IF;

  UPDATE public.wb_milestones SET status = p_status, updated_at = now() WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('milestone', p_id, 'status', jsonb_build_object('status', jsonb_build_object('from', v_old, 'to', p_status)), v_uid);
  RETURN p_status;
END $$;

-- B-3 삭제 — 연결 업무·이슈가 하나라도 있으면 HAS_LINKS (그 경우 화면은 '취소' 상태로 유도)
--     이력(activity_log)은 대상이 사라지므로 함께 정리
CREATE OR REPLACE FUNCTION public.wb_delete_milestone(p_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid   uuid := public.wb_assert_member();
  v_links int;
BEGIN
  PERFORM 1 FROM public.wb_milestones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MILESTONE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  SELECT (SELECT count(*) FROM public.wb_tasks  WHERE milestone_id = p_id)
       + (SELECT count(*) FROM public.wb_issues WHERE milestone_id = p_id) INTO v_links;
  IF v_links > 0 THEN RAISE EXCEPTION 'HAS_LINKS' USING ERRCODE = 'P0001'; END IF;

  DELETE FROM public.wb_activity_log WHERE target_type = 'milestone' AND target_id = p_id;
  DELETE FROM public.wb_milestones WHERE id = p_id;
END $$;

-- B-4 업무영역 순서 재번호 — p_ids 순서대로 sort_order = 1..n (한 트랜잭션). 바뀐 행만 이력
CREATE OR REPLACE FUNCTION public.wb_reorder_work_areas(p_ids uuid[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid uuid := public.wb_assert_member();
  v_cnt int;
  r     record;
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RAISE EXCEPTION 'INVALID_IDS' USING ERRCODE = 'P0001'; END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_ids) x) <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'INVALID_IDS' USING ERRCODE = 'P0001';        -- 중복
  END IF;
  SELECT count(*) INTO v_cnt FROM public.wb_work_areas WHERE id = ANY (p_ids);
  IF v_cnt <> array_length(p_ids, 1) THEN RAISE EXCEPTION 'INVALID_IDS' USING ERRCODE = 'P0001'; END IF;  -- 없는 id

  FOR r IN
    SELECT a.id, a.sort_order AS old_order, u.ord::int AS new_order
      FROM unnest(p_ids) WITH ORDINALITY AS u(id, ord)
      JOIN public.wb_work_areas a ON a.id = u.id
     WHERE a.sort_order IS DISTINCT FROM u.ord::int
     ORDER BY u.ord
  LOOP
    UPDATE public.wb_work_areas SET sort_order = r.new_order, updated_at = now() WHERE id = r.id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('area', r.id, 'updated', jsonb_build_object('sort_order', jsonb_build_object('from', r.old_order, 'to', r.new_order)), v_uid);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 권한 — 직접 쓰기 회수, RPC 만 열기
-- ────────────────────────────────────────────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE ON public.wb_milestones FROM PUBLIC, anon, authenticated;
REVOKE DELETE                 ON public.wb_work_areas FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS wb_milestones_write  ON public.wb_milestones;
DROP POLICY IF EXISTS wb_work_areas_delete ON public.wb_work_areas;

REVOKE ALL ON FUNCTION public.wb_upsert_milestone(uuid,text,text,date,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_set_milestone_status(uuid,text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_delete_milestone(uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_reorder_work_areas(uuid[])                 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_upsert_milestone(uuid,text,text,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_set_milestone_status(uuid,text)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_delete_milestone(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_reorder_work_areas(uuid[])                 TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 검증 — 어긋나면 EXCEPTION → 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.wb_activity_log'::regclass AND contype='c'
                   AND pg_get_constraintdef(oid) LIKE '%milestone%') THEN
    RAISE EXCEPTION '[검증] activity_log target_type 에 milestone 없음';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('wb_upsert_milestone','wb_set_milestone_status','wb_delete_milestone','wb_reorder_work_areas') AND p.prosecdef;
  IF v_cnt <> 4 THEN RAISE EXCEPTION '[검증] 3-E RPC 수 % (기대 4, definer)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%';
  IF v_cnt <> 14 THEN RAISE EXCEPTION '[검증] wb_ 정책 수 % (기대 14)', v_cnt; END IF;
  IF has_table_privilege('authenticated', 'public.wb_milestones', 'INSERT') OR has_table_privilege('authenticated', 'public.wb_milestones', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.wb_milestones', 'DELETE') OR has_table_privilege('authenticated', 'public.wb_work_areas', 'DELETE') THEN
    RAISE EXCEPTION '[검증] authenticated 직접 쓰기 권한 잔존 (milestones / work_areas DELETE)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.wb_milestones', 'SELECT') THEN
    RAISE EXCEPTION '[검증] wb_milestones SELECT 이 사라짐';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'wb\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] anon 실행 가능 wb_ 함수 %개', v_cnt; END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 3-E 전 항목 통과';
END $$;

COMMIT;
