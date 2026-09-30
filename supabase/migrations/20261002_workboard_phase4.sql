-- ============================================================================
-- WORKBOARD Phase 4 — 반복 업무 자동 생성 + 템플릿 관리   (2026-09-30)
--   [A] wb_recurring_runs (실행 로그) · activity_log target_type += 'template'
--   [B] 영업일 판정 wb_is_workday / wb_next_workday / wb_prev_workday   (비영업일 = 토·일 + holidays.kind='holiday')
--   [C] 주기 계산 SSOT wb_period_due(rrule, weekday, month_day, skip, p_date)
--       · 매일: 비영업일이면 없음
--       · 주간: 지정 요일, 비영업일이면 다음 영업일 — 단 그 주(일요일)를 넘기면 이전 영업일
--       · 월간: 지정 일(말일 초과 clamp — 31 = 말일), 비영업일이면 다음 영업일 — 단 월을 넘기면 이전 영업일   (고지 확정)
--   [D] 생성기 wb_generate_recurring_internal(p_date, p_actor) — cron·수동 공용. 소급 창 3일(due ≤ p_date ≤ due+3 ∧ 주기 안)
--       wb_generate_recurring_now() — 화면 버튼(멤버 가드). 마감 = 생성일 18:00 KST 고정 (고지 확정)
--   [E] 미리보기 wb_template_preview(...) / wb_templates_next() — 화면 '다음 생성' 은 이 함수만 쓴다(규칙 SSOT 1벌)
--   [F] wb_upsert_task_template — 템플릿 쓰기 RPC(이력). 직접 INSERT/UPDATE/DELETE 회수, 삭제 없음(비활성화)
--       (근거: wb_tasks.template_id ON DELETE SET NULL 시 period_pair CHECK 위반 → 삭제가 성립하지 않는 구조)
--   [G] pg_cron 'wb-generate-recurring-0000kst'  '0 15 * * *' (UTC 15:00 = KST 00:00) — 확장 있을 때만
--   [H] 검증
-- 선행: phase1 · 3c · 3d · 3e · 3f
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A]
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wb_recurring_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_on        date NOT NULL,                 -- 생성 기준일(KST)
  ran_at        timestamptz NOT NULL DEFAULT now(),
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,    -- 활성 템플릿 중 이날 생성 대상이 아니었던 수(비영업일·주기 아님·이미 생성)
  triggered_by  uuid                           -- NULL = cron
);
COMMENT ON TABLE public.wb_recurring_runs IS '[WORKBOARD] 반복 생성 실행 로그 — 화면 상단 "마지막 자동 생성" 표시용';
CREATE INDEX IF NOT EXISTS idx_wb_recurring_runs_ran ON public.wb_recurring_runs (ran_at DESC);
ALTER TABLE public.wb_recurring_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wb_recurring_runs_select ON public.wb_recurring_runs;
CREATE POLICY wb_recurring_runs_select ON public.wb_recurring_runs FOR SELECT USING (public.has_admin_role('workboard'));
REVOKE ALL ON public.wb_recurring_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wb_recurring_runs TO authenticated;
GRANT ALL ON public.wb_recurring_runs TO service_role;

DO $$
DECLARE v_name text;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.wb_activity_log'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%target_type%';
  IF v_name IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = v_name AND conrelid = 'public.wb_activity_log'::regclass)) LIKE '%template%' THEN RETURN; END IF;
  IF v_name IS NOT NULL THEN EXECUTE format('ALTER TABLE public.wb_activity_log DROP CONSTRAINT %I', v_name); END IF;
  ALTER TABLE public.wb_activity_log ADD CONSTRAINT wb_activity_log_target_type_check
    CHECK (target_type IN ('area','task','issue','milestone','template'));
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 영업일
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_is_workday(p_date date)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public','pg_temp' AS $$
  SELECT EXTRACT(ISODOW FROM p_date) < 6
     AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.holiday_date = p_date AND h.kind = 'holiday')
$$;
CREATE OR REPLACE FUNCTION public.wb_next_workday(p_date date)
 RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE d date := p_date; i int := 0;
BEGIN
  WHILE NOT public.wb_is_workday(d) AND i < 14 LOOP d := d + 1; i := i + 1; END LOOP;
  RETURN d;
END $$;
CREATE OR REPLACE FUNCTION public.wb_prev_workday(p_date date)
 RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE d date := p_date; i int := 0;
BEGIN
  WHILE NOT public.wb_is_workday(d) AND i < 14 LOOP d := d - 1; i := i + 1; END LOOP;
  RETURN d;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 주기 계산 SSOT — p_date 가 속한 주기의 (생성일, period_key, 주기 종료일, 이동 사유)
--     due_on NULL = 그 주기에 생성 없음 (매일 + 비영업일)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.wb_period_due(text,smallint,smallint,boolean,date);
CREATE OR REPLACE FUNCTION public.wb_period_due(
  p_rrule text, p_weekday integer, p_month_day integer, p_skip boolean, p_date date,
  OUT due_on date, OUT period_key text, OUT period_start date, OUT period_end date, OUT shifted text
) LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE v_target date; v_moved date;
BEGIN
  shifted := NULL;
  IF p_rrule = 'daily' THEN
    period_start := p_date; period_end := p_date; period_key := to_char(p_date, 'YYYY-MM-DD');
    due_on := CASE WHEN p_skip AND NOT public.wb_is_workday(p_date) THEN NULL ELSE p_date END;
    IF due_on IS NULL THEN shifted := 'skipped'; END IF;
    RETURN;
  END IF;

  IF p_rrule = 'weekly' THEN
    period_start := p_date - (EXTRACT(ISODOW FROM p_date)::int - 1);          -- 월요일
    period_end   := period_start + 6;
    period_key   := to_char(period_start, 'IYYY-"W"IW');
    v_target     := period_start + (CASE WHEN p_weekday = 0 THEN 6 ELSE p_weekday - 1 END);
  ELSIF p_rrule = 'monthly' THEN
    period_start := date_trunc('month', p_date)::date;
    period_end   := (period_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
    period_key   := to_char(period_start, 'YYYY-MM');
    v_target     := period_start + (LEAST(p_month_day, EXTRACT(DAY FROM period_end)::int) - 1);   -- 31 = 말일 clamp
  ELSE
    RAISE EXCEPTION 'INVALID_RRULE' USING ERRCODE = 'P0001';
  END IF;

  due_on := v_target;
  IF p_skip AND NOT public.wb_is_workday(v_target) THEN
    v_moved := public.wb_next_workday(v_target);
    IF v_moved > period_end THEN
      v_moved := public.wb_prev_workday(v_target); shifted := 'prev';     -- 주기를 넘기면 앞당김 (고지 확정)
    ELSE
      shifted := 'next';
    END IF;
    due_on := v_moved;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 생성기
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_generate_recurring_internal(
  p_date  date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date,
  p_actor uuid DEFAULT NULL
) RETURNS TABLE (created_count integer, skipped_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  t        record;
  d        record;
  v_task   uuid;
  v_ins    integer;
  v_created integer := 0;
  v_skipped integer := 0;
  v_start  date;
  v_uid    uuid;
BEGIN
  FOR t IN SELECT * FROM public.wb_task_templates WHERE is_active ORDER BY created_at LOOP
    SELECT * INTO d FROM public.wb_period_due(t.rrule, t.weekday, t.month_day, t.skip_non_workdays, p_date);
    -- 생성 조건: 이 주기에 생성일이 있고, due ≤ p_date ≤ min(due+3, 주기 끝)  (소급 창 3일 — cron 누락 대비, 새 템플릿의 과거분 양산 방지)
    IF d.due_on IS NULL OR p_date < d.due_on OR p_date > LEAST(d.due_on + 3, d.period_end) THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    v_start := CASE t.rrule WHEN 'weekly' THEN d.period_start WHEN 'monthly' THEN d.period_start ELSE NULL END;

    INSERT INTO public.wb_tasks (area_id, template_id, period_key, title, description, status, priority, due_at, start_on, checklist, created_by)
    VALUES (t.area_id, t.id, d.period_key, t.title, t.description, 'todo', 'normal',
            ((d.due_on::text || ' 18:00')::timestamp AT TIME ZONE 'Asia/Seoul'),           -- 마감 18:00 KST 고정
            v_start,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c->>'id', 'text', c->>'text', 'done', false)) FROM jsonb_array_elements(t.checklist) c), '[]'::jsonb),
            p_actor)
    ON CONFLICT (template_id, period_key) DO NOTHING
    RETURNING id INTO v_task;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins = 0 THEN v_skipped := v_skipped + 1; CONTINUE; END IF;      -- 이미 생성됨(dedupe)

    FOREACH v_uid IN ARRAY t.default_assignee_ids LOOP
      INSERT INTO public.wb_task_assignees (task_id, user_id) VALUES (v_task, v_uid) ON CONFLICT DO NOTHING;
    END LOOP;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('task', v_task, 'created', jsonb_build_object('template_id', t.id, 'period_key', d.period_key, 'due_on', d.due_on, 'shifted', d.shifted), p_actor);
    v_created := v_created + 1;
  END LOOP;

  INSERT INTO public.wb_recurring_runs (run_on, created_count, skipped_count, triggered_by) VALUES (p_date, v_created, v_skipped, p_actor);
  created_count := v_created; skipped_count := v_skipped;
  RETURN NEXT;
END $$;

-- 화면 버튼 — 멤버만, 오늘(KST) 기준
CREATE OR REPLACE FUNCTION public.wb_generate_recurring_now()
 RETURNS TABLE (created_count integer, skipped_count integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := public.wb_assert_member();
BEGIN
  RETURN QUERY SELECT * FROM public.wb_generate_recurring_internal((now() AT TIME ZONE 'Asia/Seoul')::date, v_uid);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [E] 미리보기 — 임의 파라미터(드로어, 저장 전) / 전체 템플릿 다음 생성(목록)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.wb_template_preview(text,smallint,smallint,boolean,date,integer);
CREATE OR REPLACE FUNCTION public.wb_template_preview(
  p_rrule text, p_weekday integer, p_month_day integer, p_skip boolean,
  p_from date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date, p_count integer DEFAULT 4
) RETURNS TABLE (due_on date, period_key text, shifted text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := public.wb_assert_member(); d record; cur date := p_from; n int := 0; guard int := 0;
BEGIN
  IF p_rrule NOT IN ('daily','weekly','monthly') THEN RAISE EXCEPTION 'INVALID_RRULE' USING ERRCODE = 'P0001'; END IF;
  WHILE n < LEAST(p_count, 12) AND guard < 400 LOOP
    guard := guard + 1;
    SELECT * INTO d FROM public.wb_period_due(p_rrule, p_weekday, p_month_day, p_skip, cur);
    IF d.due_on IS NOT NULL AND d.due_on >= p_from THEN
      due_on := d.due_on; period_key := d.period_key; shifted := d.shifted; RETURN NEXT; n := n + 1;
    END IF;
    cur := d.period_end + 1;     -- 다음 주기 첫날
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.wb_templates_next(p_from date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date)
 RETURNS TABLE (template_id uuid, due_on date, period_key text, shifted text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := public.wb_assert_member(); t record; p record;
BEGIN
  FOR t IN SELECT * FROM public.wb_task_templates WHERE is_active LOOP
    SELECT * INTO p FROM public.wb_template_preview(t.rrule, t.weekday, t.month_day, t.skip_non_workdays, p_from, 1);
    IF p.due_on IS NOT NULL THEN
      template_id := t.id; due_on := p.due_on; period_key := p.period_key; shifted := p.shifted; RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] 템플릿 쓰기 RPC
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.wb_upsert_task_template(uuid,uuid,text,text,jsonb,text,smallint,smallint,boolean,uuid[],boolean);
CREATE OR REPLACE FUNCTION public.wb_upsert_task_template(
  p_id                   uuid,
  p_area_id              uuid,
  p_title                text,
  p_description          text,
  p_checklist            jsonb,          -- [{id,text}]
  p_rrule                text,
  p_weekday              integer,
  p_month_day            integer,
  p_skip_non_workdays    boolean,
  p_default_assignee_ids uuid[],
  p_is_active            boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid  uuid := public.wb_assert_member();
  v_id   uuid; v_old jsonb; v_new jsonb; v_diff jsonb; c jsonb;
BEGIN
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wb_work_areas WHERE id = p_area_id) THEN RAISE EXCEPTION 'AREA_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF p_rrule IS NULL OR p_rrule NOT IN ('daily','weekly','monthly') THEN RAISE EXCEPTION 'INVALID_RRULE' USING ERRCODE = 'P0001'; END IF;
  IF p_rrule = 'weekly'  AND (p_weekday   IS NULL OR p_weekday   NOT BETWEEN 0 AND 6)  THEN RAISE EXCEPTION 'WEEKLY_NEEDS_WEEKDAY' USING ERRCODE = 'P0001'; END IF;
  IF p_rrule = 'monthly' AND (p_month_day IS NULL OR p_month_day NOT BETWEEN 1 AND 31) THEN RAISE EXCEPTION 'MONTHLY_NEEDS_DAY'   USING ERRCODE = 'P0001'; END IF;
  IF p_checklist IS NULL OR jsonb_typeof(p_checklist) <> 'array' THEN RAISE EXCEPTION 'INVALID_CHECKLIST' USING ERRCODE = 'P0001'; END IF;
  FOR c IN SELECT * FROM jsonb_array_elements(p_checklist) LOOP
    IF jsonb_typeof(c) <> 'object' OR NOT (c ? 'id') OR NOT (c ? 'text') THEN RAISE EXCEPTION 'INVALID_CHECKLIST' USING ERRCODE = 'P0001'; END IF;
  END LOOP;

  v_new := jsonb_build_object('area_id', p_area_id, 'title', btrim(p_title), 'description', p_description, 'checklist', p_checklist,
    'rrule', p_rrule, 'weekday', CASE WHEN p_rrule = 'weekly' THEN p_weekday END, 'month_day', CASE WHEN p_rrule = 'monthly' THEN p_month_day END,
    'skip_non_workdays', COALESCE(p_skip_non_workdays, true), 'default_assignee_ids', to_jsonb(COALESCE(p_default_assignee_ids, '{}'::uuid[])), 'is_active', COALESCE(p_is_active, true));

  IF p_id IS NULL THEN
    INSERT INTO public.wb_task_templates (area_id, title, description, checklist, rrule, weekday, month_day, skip_non_workdays, default_assignee_ids, is_active, created_by)
    VALUES (p_area_id, btrim(p_title), p_description, p_checklist, p_rrule,
            CASE WHEN p_rrule = 'weekly' THEN p_weekday END, CASE WHEN p_rrule = 'monthly' THEN p_month_day END,
            COALESCE(p_skip_non_workdays, true), COALESCE(p_default_assignee_ids, '{}'::uuid[]), COALESCE(p_is_active, true), v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id) VALUES ('template', v_id, 'created', v_new, v_uid);
    RETURN v_id;
  END IF;

  SELECT jsonb_build_object('area_id', area_id, 'title', title, 'description', description, 'checklist', checklist,
    'rrule', rrule, 'weekday', weekday, 'month_day', month_day, 'skip_non_workdays', skip_non_workdays,
    'default_assignee_ids', to_jsonb(default_assignee_ids), 'is_active', is_active)
    INTO v_old FROM public.wb_task_templates WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'TEMPLATE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  v_diff := public.wb_jsonb_diff(v_old, v_new);
  IF v_diff = '{}'::jsonb THEN RETURN p_id; END IF;

  UPDATE public.wb_task_templates
     SET area_id = p_area_id, title = btrim(p_title), description = p_description, checklist = p_checklist, rrule = p_rrule,
         weekday = CASE WHEN p_rrule = 'weekly' THEN p_weekday END, month_day = CASE WHEN p_rrule = 'monthly' THEN p_month_day END,
         skip_non_workdays = COALESCE(p_skip_non_workdays, true), default_assignee_ids = COALESCE(p_default_assignee_ids, '{}'::uuid[]),
         is_active = COALESCE(p_is_active, true), updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id) VALUES ('template', p_id, 'updated', v_diff, v_uid);
  RETURN p_id;
END $$;

-- 직접 쓰기 회수 (정책 14 → 13)
REVOKE INSERT, UPDATE, DELETE ON public.wb_task_templates FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS wb_task_templates_write ON public.wb_task_templates;

-- 함수 권한
REVOKE ALL ON FUNCTION public.wb_is_workday(date)                                                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_next_workday(date)                                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_prev_workday(date)                                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_period_due(text,integer,integer,boolean,date)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_generate_recurring_internal(date,uuid)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_generate_recurring_now()                                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_template_preview(text,integer,integer,boolean,date,integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_templates_next(date)                                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_upsert_task_template(uuid,uuid,text,text,jsonb,text,integer,integer,boolean,uuid[],boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_is_workday(date), public.wb_next_workday(date), public.wb_prev_workday(date)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_period_due(text,integer,integer,boolean,date)                                TO service_role;   -- 내부용 (definer 함수가 호출)
GRANT EXECUTE ON FUNCTION public.wb_generate_recurring_internal(date,uuid)                                         TO service_role;   -- cron(postgres 소유) · service_role 만
GRANT EXECUTE ON FUNCTION public.wb_generate_recurring_now()                                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_template_preview(text,integer,integer,boolean,date,integer)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_templates_next(date)                                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_upsert_task_template(uuid,uuid,text,text,jsonb,text,integer,integer,boolean,uuid[],boolean) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [G] cron — KST 00:00 = UTC 15:00. 확장 없으면(로컬) 건너뜀. 같은 이름 잡은 교체
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[cron] pg_cron 없음 — 잡 등록 건너뜀 (운영에서는 등록됨)'; RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'wb-generate-recurring-0000kst';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('wb-generate-recurring-0000kst', '0 15 * * *', $c$SELECT public.wb_generate_recurring_internal()$c$);
  RAISE NOTICE '[cron] wb-generate-recurring-0000kst 등록 (0 15 * * * UTC = 00:00 KST)';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [H] 검증
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_cnt int;
BEGIN
  IF to_regclass('public.wb_recurring_runs') IS NULL THEN RAISE EXCEPTION '[검증] wb_recurring_runs 없음'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.wb_activity_log'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%template%') THEN
    RAISE EXCEPTION '[검증] activity_log target_type 에 template 없음'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND p.proname IN ('wb_is_workday','wb_next_workday','wb_prev_workday','wb_period_due','wb_generate_recurring_internal','wb_generate_recurring_now','wb_template_preview','wb_templates_next','wb_upsert_task_template');
  IF v_cnt <> 9 THEN RAISE EXCEPTION '[검증] Phase 4 함수 수 % (기대 9)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%';
  IF v_cnt <> 14 THEN RAISE EXCEPTION '[검증] wb_ 정책 수 % (기대 14 = 13 + recurring_runs select)', v_cnt; END IF;
  IF has_table_privilege('authenticated', 'public.wb_task_templates', 'INSERT') OR has_table_privilege('authenticated', 'public.wb_task_templates', 'UPDATE') OR has_table_privilege('authenticated', 'public.wb_task_templates', 'DELETE') THEN
    RAISE EXCEPTION '[검증] authenticated 가 wb_task_templates 직접 쓰기 가능'; END IF;
  IF has_function_privilege('authenticated', 'public.wb_generate_recurring_internal(date,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] authenticated 가 internal 생성기 실행 가능'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'wb\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] anon 실행 가능 wb_ 함수 %개', v_cnt; END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 4 전 항목 통과';
END $$;

COMMIT;
