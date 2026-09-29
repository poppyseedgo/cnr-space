-- ============================================================================
-- 20260929_workboard_phase1.sql
-- WORKBOARD (MS팀 업무보드) Phase 1 — DB 기반
--
-- 범위
--   [A] admin_roles CHECK 에 'workboard' 추가 (현행 정의를 읽어 값 1개만 append)
--   [B] admin_set_user_roles(): profiles.role 재계산에서 'workboard' 제외
--   [C] wb_ 테이블 8개 + 인덱스
--   [D] RLS — 전 테이블 has_admin_role('workboard') 단일 게이트
--   [E] RPC 4종 (쓰기 경로 강제 + wb_activity_log 기록)
--   [F] 권한(REVOKE 기본권한 → GRANT) · 검증 DO 블록
--   [2026-09-29 v2] Supabase 기본 권한(anon/authenticated ALL) REVOKE 누락 정정 — 1b 핫픽스와 동일 내용
--
-- 설계 근거 (2026-09-23 / 09-29 확정)
--   · 사람 참조(owner·assignee·actor·author)는 FK 없이 uuid 값만 저장 —
--     manualDepartUser 가 profiles 를 DELETE 하므로 FK 를 걸면 퇴사 시 이력이 함께 사라진다.
--     표시는 프론트에서 profiles live lookup → departed_users 폴백 (bookings 스냅샷 원칙).
--   · admin_roles.user_id → auth.users CASCADE + departed_users INSERT 트리거(Phase2)가
--     이미 역할을 회수하므로 workboard 회수는 추가 작업 없음.
--   · activity_log 는 트리거가 아닌 RPC 안에서 기록 (admin_roles B안과 동일한 이유:
--     호출부 추적 가능, 감사로그와 동일 트랜잭션, n+1 발동 없음).
--   · 전부 멱등 — 재실행 안전. 트랜잭션 1개로 묶어 중간 실패 시 전체 롤백.
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run (또는 supabase db push --linked)
-- 검증: _diagnose_workboard_20260929.sql 실행 → 전 항목 ✅ 확인
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] admin_roles CHECK 확장 — 값을 하드코딩하지 않는다
--     실측 2026-09-29: 12종 + 레거시 2종(zoom, meeting_room). 저장소 마이그레이션과 다르므로
--     현행 정의를 pg_get_constraintdef 로 읽어 'workboard' 만 끼워 넣는다.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_name text;
  v_def  text;
  v_new  text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid)
    INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.admin_roles'::regclass
     AND contype  = 'c'
     AND pg_get_constraintdef(oid) LIKE '%role = ANY%';

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'admin_roles 의 role CHECK 제약을 찾을 수 없음 — 수동 확인 필요';
  END IF;

  IF v_def LIKE '%''workboard''%' THEN
    RAISE NOTICE '[A] 이미 workboard 포함 — 건너뜀 (%)', v_name;
    RETURN;
  END IF;

  -- ARRAY[ 직후에 'workboard'::text, 삽입
  v_new := replace(v_def, 'ARRAY[', 'ARRAY[''workboard''::text, ');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'CHECK 정의 형태가 예상과 다름: %', v_def;
  END IF;

  EXECUTE format('ALTER TABLE public.admin_roles DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE public.admin_roles ADD CONSTRAINT %I %s', v_name, v_new);
  RAISE NOTICE '[A] % 재정의 완료 → %', v_name, v_new;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] admin_set_user_roles — 재계산 규칙 1줄 변경
--     원문: 운영 pg_get_functiondef (2026-09-29) 그대로. 변경은 마지막 UPDATE 한 곳만.
--     이유: workboard 는 어드민 탭이 없는 일반 뷰 권한. 이것만 가진 사람이 profiles.role='ADMIN'
--           이 되면 어드민 진입은 허용되는데 탭이 0개 → 첫 탭 리다이렉트가 깨진다.
--     ⚠ revoke_roles_on_departure() 는 변경 불필요 — 퇴사 시 workboard 도 함께 삭제되므로
--       EXISTS 재계산 결과가 어차피 USER.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_roles(p_user_id uuid, p_roles text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_new       text[] := COALESCE(p_roles, ARRAY[]::text[]);
  v_had_super boolean;
  v_will_super boolean;
  v_super_cnt integer;
  r           text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_admin_role('super') THEN
    RAISE EXCEPTION 'NOT_SUPER' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 'zoom' 은 폐기라 신규 부여 금지 (기존 행은 아래 교체로 자연 정리된다)
  IF 'zoom' = ANY(v_new) THEN
    RAISE EXCEPTION 'DEPRECATED_ROLE:zoom' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = p_user_id AND role = 'super')
    INTO v_had_super;
  v_will_super := 'super' = ANY(v_new);

  -- ② 자기 자신의 super 회수 금지
  IF p_user_id = v_uid AND v_had_super AND NOT v_will_super THEN
    RAISE EXCEPTION 'CANNOT_REVOKE_OWN_SUPER' USING ERRCODE = 'P0001';
  END IF;

  -- ③ 마지막 super 보호
  IF v_had_super AND NOT v_will_super THEN
    SELECT count(*) INTO v_super_cnt FROM public.admin_roles WHERE role = 'super';
    IF v_super_cnt <= 1 THEN
      RAISE EXCEPTION 'LAST_SUPER' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── 감사 로그 (교체 전후 차집합) ──────────────────────────────────────
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'revoke', v_uid
    FROM (SELECT role AS x FROM public.admin_roles WHERE user_id = p_user_id) old
   WHERE x <> ALL(v_new);

  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, x, 'grant', v_uid
    FROM unnest(v_new) AS x
   WHERE x NOT IN (SELECT role FROM public.admin_roles WHERE user_id = p_user_id);

  -- ── 교체 ──────────────────────────────────────────────────────────────
  DELETE FROM public.admin_roles WHERE user_id = p_user_id;

  FOREACH r IN ARRAY v_new LOOP
    INSERT INTO public.admin_roles (user_id, role, granted_by, granted_at)
    VALUES (p_user_id, r, v_uid, now())
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;

  -- ── profiles.role 재계산 (트리거 대신 여기서 1회) ────────────────────
  --   어드민 탭 역할이 하나라도 있으면 ADMIN, 없으면 USER.
  --   'workboard' 는 어드민 탭이 없는 일반 뷰 권한이라 재계산에서 제외한다.   ← [2026-09-29 WORKBOARD Phase1]
  UPDATE public.profiles
     SET role = CASE WHEN array_length(array_remove(v_new, 'workboard'), 1) > 0 THEN 'ADMIN' ELSE 'USER' END
   WHERE id = p_user_id;

  RETURN v_new;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 테이블 8개
--     enum 은 text + CHECK (프로젝트 관례). 시각은 timestamptz, 날짜성은 date.
--     updated_at 은 트리거가 아닌 RPC 가 갱신한다.
-- ────────────────────────────────────────────────────────────────────────────

-- C-1 업무영역 (= 업무분장표)
CREATE TABLE IF NOT EXISTS public.wb_work_areas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  description       text,
  primary_owner_id  uuid,                       -- profiles.id (FK 없음 — 헤더 참조)
  backup_owner_id   uuid,
  sort_order        integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wb_work_areas_name_nonempty CHECK (length(btrim(name)) > 0)
);
COMMENT ON TABLE public.wb_work_areas IS '[WORKBOARD] 업무영역 = 분장표. primary/backup owner 는 책임자, 건별 실행자는 wb_task_assignees';

-- C-2 마일스톤
CREATE TABLE IF NOT EXISTS public.wb_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text,
  start_on     date,
  end_on       date,
  status       text NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','active','done','cancelled')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wb_milestones_range CHECK (start_on IS NULL OR end_on IS NULL OR end_on >= start_on)
);
COMMENT ON TABLE public.wb_milestones IS '[WORKBOARD] 기간 목표. 업무·이슈가 선택적으로 소속';

-- C-3 반복 업무 템플릿
CREATE TABLE IF NOT EXISTS public.wb_task_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id               uuid NOT NULL REFERENCES public.wb_work_areas(id) ON DELETE RESTRICT,
  title                 text NOT NULL,
  description           text,
  checklist             jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{id,text}]
  rrule                 text NOT NULL CHECK (rrule IN ('daily','weekly','monthly')),
  weekday               smallint CHECK (weekday BETWEEN 0 AND 6),          -- weekly: 0=일
  month_day             smallint CHECK (month_day BETWEEN 1 AND 31),       -- monthly: 말일 초과 시 clamp
  skip_non_workdays     boolean NOT NULL DEFAULT true,                     -- 주말·holidays 건너뜀
  default_assignee_ids  uuid[] NOT NULL DEFAULT '{}',
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wb_tpl_weekly_needs_weekday   CHECK (rrule <> 'weekly'  OR weekday   IS NOT NULL),
  CONSTRAINT wb_tpl_monthly_needs_day      CHECK (rrule <> 'monthly' OR month_day IS NOT NULL)
);
COMMENT ON TABLE public.wb_task_templates IS '[WORKBOARD] 반복 업무 원본. Phase4 wb_generate_recurring() 가 KST 00:00 에 당일분 wb_tasks 를 생성';

-- C-4 업무 (중심 엔티티)
CREATE TABLE IF NOT EXISTS public.wb_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id        uuid NOT NULL REFERENCES public.wb_work_areas(id) ON DELETE RESTRICT,
  milestone_id   uuid REFERENCES public.wb_milestones(id) ON DELETE SET NULL,
  template_id    uuid REFERENCES public.wb_task_templates(id) ON DELETE SET NULL,
  period_key     text,                                   -- '2026-09-29' | '2026-W40' | '2026-09'
  title          text NOT NULL,
  description    text,
  status         text NOT NULL DEFAULT 'todo'   CHECK (status IN ('todo','doing','done','hold')),
  priority       text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_at         timestamptz,
  checklist      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{id,text,done}]
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  completed_by   uuid,
  CONSTRAINT wb_tasks_title_nonempty  CHECK (length(btrim(title)) > 0),
  CONSTRAINT wb_tasks_period_pair     CHECK ((template_id IS NULL) = (period_key IS NULL)),
  CONSTRAINT wb_tasks_done_pair       CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CONSTRAINT wb_tasks_template_period UNIQUE (template_id, period_key)   -- cron 중복 실행 dedupe
);
COMMENT ON TABLE public.wb_tasks IS '[WORKBOARD] 업무. 쓰기는 wb_upsert_task / wb_set_task_status RPC 로만 (RLS 가 직접 INSERT/UPDATE 차단)';

-- C-5 담당자 N:M
CREATE TABLE IF NOT EXISTS public.wb_task_assignees (
  task_id      uuid NOT NULL REFERENCES public.wb_tasks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,                             -- profiles.id (FK 없음)
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  assigned_by  uuid,
  PRIMARY KEY (task_id, user_id)
);

-- C-6 이슈
CREATE TABLE IF NOT EXISTS public.wb_issues (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid REFERENCES public.wb_tasks(id)      ON DELETE SET NULL,
  milestone_id       uuid REFERENCES public.wb_milestones(id) ON DELETE SET NULL,
  converted_task_id  uuid REFERENCES public.wb_tasks(id)      ON DELETE SET NULL,
  title              text NOT NULL,
  description        text,
  severity           text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status             text NOT NULL DEFAULT 'open'   CHECK (status IN ('open','in_progress','resolved','wontfix')),
  occurred_on        date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Seoul')::date),
  reporter_id        uuid,
  resolved_at        timestamptz,
  resolved_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wb_issues_title_nonempty CHECK (length(btrim(title)) > 0),
  CONSTRAINT wb_issues_resolved_pair  CHECK ((status IN ('resolved','wontfix')) = (resolved_at IS NOT NULL))
);
COMMENT ON TABLE public.wb_issues IS '[WORKBOARD] 이슈. 독립 생성 가능, task/milestone 선택 연결. occurred_on 기본값 = KST 오늘';

-- C-7 댓글 (업무·이슈 공통, 다형 참조)
CREATE TABLE IF NOT EXISTS public.wb_comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text NOT NULL CHECK (target_type IN ('task','issue')),
  target_id    uuid NOT NULL,
  body         text NOT NULL CHECK (length(btrim(body)) > 0),
  author_id    uuid NOT NULL DEFAULT auth.uid(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- C-8 변경 이력
CREATE TABLE IF NOT EXISTS public.wb_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type  text NOT NULL CHECK (target_type IN ('area','task','issue')),
  target_id    uuid NOT NULL,
  action       text NOT NULL,        -- created | updated | status | assignees
  diff         jsonb,                -- {field:{from,to}} | {added:[],removed:[]}
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.wb_activity_log IS '[WORKBOARD] 변경 이력. RPC 안에서만 INSERT (트리거 미사용)';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_wb_tasks_status        ON public.wb_tasks (status);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_due_at        ON public.wb_tasks (due_at) WHERE status IN ('todo','doing');
CREATE INDEX IF NOT EXISTS idx_wb_tasks_area          ON public.wb_tasks (area_id);
CREATE INDEX IF NOT EXISTS idx_wb_tasks_milestone     ON public.wb_tasks (milestone_id) WHERE milestone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wb_assignees_user      ON public.wb_task_assignees (user_id);
CREATE INDEX IF NOT EXISTS idx_wb_issues_status_date  ON public.wb_issues (status, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_wb_issues_milestone    ON public.wb_issues (milestone_id) WHERE milestone_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wb_comments_target     ON public.wb_comments (target_type, target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wb_activity_target     ON public.wb_activity_log (target_type, target_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- [D] RLS — has_admin_role('workboard') 단일 게이트 (super 자동 통과)
--     · 조회: 8개 전부 workboard
--     · 직접 쓰기 허용: work_areas 는 RPC 전용(이력), milestones·templates 는 직접 CRUD,
--       comments 는 본인 것만 수정/삭제
--     · tasks / issues / assignees / activity_log: 직접 INSERT/UPDATE 차단 → RPC 경유
--     · tasks DELETE 는 이력 없는 상태(todo·미완료)만, issues DELETE 는 open 만 —
--       그 외는 hold / wontfix 로 유도 (도서 대여이력 삭제차단과 동일 원칙)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.wb_work_areas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_milestones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_tasks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_issues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wb_activity_log   ENABLE ROW LEVEL SECURITY;

-- 조회 8개
DROP POLICY IF EXISTS wb_work_areas_select     ON public.wb_work_areas;
DROP POLICY IF EXISTS wb_milestones_select     ON public.wb_milestones;
DROP POLICY IF EXISTS wb_task_templates_select ON public.wb_task_templates;
DROP POLICY IF EXISTS wb_tasks_select          ON public.wb_tasks;
DROP POLICY IF EXISTS wb_task_assignees_select ON public.wb_task_assignees;
DROP POLICY IF EXISTS wb_issues_select         ON public.wb_issues;
DROP POLICY IF EXISTS wb_comments_select       ON public.wb_comments;
DROP POLICY IF EXISTS wb_activity_log_select   ON public.wb_activity_log;
CREATE POLICY wb_work_areas_select     ON public.wb_work_areas     FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_milestones_select     ON public.wb_milestones     FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_task_templates_select ON public.wb_task_templates FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_tasks_select          ON public.wb_tasks          FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_task_assignees_select ON public.wb_task_assignees FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_issues_select         ON public.wb_issues         FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_comments_select       ON public.wb_comments       FOR SELECT USING (public.has_admin_role('workboard'));
CREATE POLICY wb_activity_log_select   ON public.wb_activity_log   FOR SELECT USING (public.has_admin_role('workboard'));

-- 직접 쓰기: milestones · templates (전체), work_areas (DELETE 만 — 생성/수정은 RPC)
DROP POLICY IF EXISTS wb_milestones_write     ON public.wb_milestones;
DROP POLICY IF EXISTS wb_task_templates_write ON public.wb_task_templates;
DROP POLICY IF EXISTS wb_work_areas_delete    ON public.wb_work_areas;
CREATE POLICY wb_milestones_write     ON public.wb_milestones     FOR ALL
  USING (public.has_admin_role('workboard')) WITH CHECK (public.has_admin_role('workboard'));
CREATE POLICY wb_task_templates_write ON public.wb_task_templates FOR ALL
  USING (public.has_admin_role('workboard')) WITH CHECK (public.has_admin_role('workboard'));
CREATE POLICY wb_work_areas_delete    ON public.wb_work_areas     FOR DELETE
  USING (public.has_admin_role('workboard'));          -- 업무·템플릿이 참조 중이면 FK RESTRICT 로 실패

-- comments: 작성은 본인 명의로만, 수정·삭제는 본인 것만
DROP POLICY IF EXISTS wb_comments_insert ON public.wb_comments;
DROP POLICY IF EXISTS wb_comments_update ON public.wb_comments;
DROP POLICY IF EXISTS wb_comments_delete ON public.wb_comments;
CREATE POLICY wb_comments_insert ON public.wb_comments FOR INSERT
  WITH CHECK (public.has_admin_role('workboard') AND author_id = auth.uid());
CREATE POLICY wb_comments_update ON public.wb_comments FOR UPDATE
  USING (public.has_admin_role('workboard') AND author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());
CREATE POLICY wb_comments_delete ON public.wb_comments FOR DELETE
  USING (public.has_admin_role('workboard') AND author_id = auth.uid());

-- tasks / issues: 조건부 DELETE 만 직접 허용 (INSERT/UPDATE 정책 없음 = 차단)
DROP POLICY IF EXISTS wb_tasks_delete  ON public.wb_tasks;
DROP POLICY IF EXISTS wb_issues_delete ON public.wb_issues;
CREATE POLICY wb_tasks_delete  ON public.wb_tasks  FOR DELETE
  USING (public.has_admin_role('workboard') AND status = 'todo' AND completed_at IS NULL);
CREATE POLICY wb_issues_delete ON public.wb_issues FOR DELETE
  USING (public.has_admin_role('workboard') AND status = 'open');

-- ────────────────────────────────────────────────────────────────────────────
-- [E] RPC 4종 — SECURITY DEFINER + 첫 줄 권한 가드. activity_log 를 같은 트랜잭션에 기록.
--     E-1 wb_upsert_work_area   분장 변경 이력 필요 → RPC 경유 (인수인계 근거)
--     E-2 wb_upsert_task        생성/수정 + 담당자 동기화 (상태 변경은 하지 않음)
--     E-3 wb_set_task_status    상태 전이 + completed_at/by
--     E-4 wb_upsert_issue       생성/수정 + resolved_at/by
--     공통 실패코드(P0001): NOT_AUTHENTICATED · NOT_WORKBOARD · NOT_FOUND · INVALID_*
-- ────────────────────────────────────────────────────────────────────────────

-- 공통 가드 (인라인 대신 함수로 — 4곳 동일 보장)
CREATE OR REPLACE FUNCTION public.wb_assert_member()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.has_admin_role('workboard') THEN RAISE EXCEPTION 'NOT_WORKBOARD' USING ERRCODE = 'P0001'; END IF;
  RETURN v_uid;
END $$;

-- 공통 diff (변경된 키만 {field:{from,to}}) — 두 jsonb 비교
CREATE OR REPLACE FUNCTION public.wb_jsonb_diff(p_old jsonb, p_new jsonb)
 RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('from', p_old -> k, 'to', p_new -> k)), '{}'::jsonb)
    FROM jsonb_object_keys(p_new) AS k
   WHERE (p_old -> k) IS DISTINCT FROM (p_new -> k)
$$;

-- E-1 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_upsert_work_area(
  p_id               uuid,          -- NULL 이면 생성
  p_name             text,
  p_description      text DEFAULT NULL,
  p_primary_owner_id uuid DEFAULT NULL,
  p_backup_owner_id  uuid DEFAULT NULL,
  p_sort_order       integer DEFAULT 0,
  p_is_active        boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid  uuid := public.wb_assert_member();
  v_id   uuid;
  v_old  jsonb;
  v_new  jsonb;
  v_diff jsonb;
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'INVALID_NAME' USING ERRCODE = 'P0001';
  END IF;
  IF p_primary_owner_id IS NOT NULL AND p_primary_owner_id = p_backup_owner_id THEN
    RAISE EXCEPTION 'INVALID_OWNER_SAME' USING ERRCODE = 'P0001';
  END IF;

  v_new := jsonb_build_object(
    'name', p_name, 'description', p_description,
    'primary_owner_id', p_primary_owner_id, 'backup_owner_id', p_backup_owner_id,
    'sort_order', p_sort_order, 'is_active', p_is_active);

  IF p_id IS NULL THEN
    INSERT INTO public.wb_work_areas (name, description, primary_owner_id, backup_owner_id, sort_order, is_active, created_by)
    VALUES (p_name, p_description, p_primary_owner_id, p_backup_owner_id, COALESCE(p_sort_order, 0), COALESCE(p_is_active, true), v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('area', v_id, 'created', v_new, v_uid);
    RETURN v_id;
  END IF;

  SELECT jsonb_build_object(
    'name', name, 'description', description,
    'primary_owner_id', primary_owner_id, 'backup_owner_id', backup_owner_id,
    'sort_order', sort_order, 'is_active', is_active)
    INTO v_old FROM public.wb_work_areas WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  v_diff := public.wb_jsonb_diff(v_old, v_new);
  IF v_diff = '{}'::jsonb THEN RETURN p_id; END IF;      -- 변경 없음 → 이력도 없음

  UPDATE public.wb_work_areas
     SET name = p_name, description = p_description,
         primary_owner_id = p_primary_owner_id, backup_owner_id = p_backup_owner_id,
         sort_order = COALESCE(p_sort_order, 0), is_active = COALESCE(p_is_active, true),
         updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('area', p_id, 'updated', v_diff, v_uid);
  RETURN p_id;
END $$;

-- E-2 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_upsert_task(
  p_id            uuid,            -- NULL 이면 생성
  p_area_id       uuid,
  p_title         text,
  p_description   text DEFAULT NULL,
  p_priority      text DEFAULT 'normal',
  p_due_at        timestamptz DEFAULT NULL,
  p_milestone_id  uuid DEFAULT NULL,
  p_checklist     jsonb DEFAULT '[]'::jsonb,
  p_assignee_ids  uuid[] DEFAULT '{}'
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

  v_new := jsonb_build_object(
    'area_id', p_area_id, 'milestone_id', p_milestone_id, 'title', p_title,
    'description', p_description, 'priority', p_priority, 'due_at', p_due_at,
    'checklist', COALESCE(p_checklist, '[]'::jsonb));

  IF p_id IS NULL THEN
    INSERT INTO public.wb_tasks (area_id, milestone_id, title, description, priority, due_at, checklist, created_by)
    VALUES (p_area_id, p_milestone_id, p_title, p_description, p_priority, p_due_at, COALESCE(p_checklist, '[]'::jsonb), v_uid)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('task', v_id, 'created', v_new - 'checklist', v_uid);
    v_cur := '{}';
  ELSE
    v_id := p_id;
    SELECT jsonb_build_object(
      'area_id', area_id, 'milestone_id', milestone_id, 'title', title,
      'description', description, 'priority', priority, 'due_at', due_at, 'checklist', checklist)
      INTO v_old FROM public.wb_tasks WHERE id = v_id FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

    v_diff := public.wb_jsonb_diff(v_old, v_new);
    IF v_diff <> '{}'::jsonb THEN
      UPDATE public.wb_tasks
         SET area_id = p_area_id, milestone_id = p_milestone_id, title = p_title,
             description = p_description, priority = p_priority, due_at = p_due_at,
             checklist = COALESCE(p_checklist, '[]'::jsonb), updated_at = now()
       WHERE id = v_id;
      INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
      VALUES ('task', v_id, 'updated', v_diff, v_uid);
    END IF;
    SELECT COALESCE(array_agg(user_id), '{}') INTO v_cur FROM public.wb_task_assignees WHERE task_id = v_id;
  END IF;

  -- 담당자 동기화 (차집합)
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

-- E-3 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_set_task_status(p_id uuid, p_status text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid uuid := public.wb_assert_member();
  v_old text;
BEGIN
  IF p_status NOT IN ('todo','doing','done','hold') THEN RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001'; END IF;
  SELECT status INTO v_old FROM public.wb_tasks WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_old = p_status THEN RETURN v_old; END IF;

  UPDATE public.wb_tasks
     SET status       = p_status,
         completed_at = CASE WHEN p_status = 'done' THEN now() ELSE NULL END,
         completed_by = CASE WHEN p_status = 'done' THEN v_uid ELSE NULL END,
         updated_at   = now()
   WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('task', p_id, 'status', jsonb_build_object('from', v_old, 'to', p_status), v_uid);
  RETURN p_status;
END $$;

-- E-4 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_upsert_issue(
  p_id            uuid,            -- NULL 이면 생성
  p_title         text,
  p_description   text DEFAULT NULL,
  p_severity      text DEFAULT 'medium',
  p_status        text DEFAULT 'open',
  p_task_id       uuid DEFAULT NULL,
  p_milestone_id  uuid DEFAULT NULL,
  p_occurred_on   date DEFAULT NULL  -- NULL 이면 KST 오늘
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_uid   uuid := public.wb_assert_member();
  v_id    uuid;
  v_old   jsonb;
  v_new   jsonb;
  v_diff  jsonb;
  v_old_status text;
  v_occ   date := COALESCE(p_occurred_on, (now() AT TIME ZONE 'Asia/Seoul')::date);
  v_resolved boolean := p_status IN ('resolved','wontfix');
BEGIN
  IF p_title IS NULL OR length(btrim(p_title)) = 0 THEN RAISE EXCEPTION 'INVALID_TITLE' USING ERRCODE = 'P0001'; END IF;
  IF p_severity NOT IN ('low','medium','high','critical') THEN RAISE EXCEPTION 'INVALID_SEVERITY' USING ERRCODE = 'P0001'; END IF;
  IF p_status NOT IN ('open','in_progress','resolved','wontfix') THEN RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = 'P0001'; END IF;
  IF p_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wb_tasks WHERE id = p_task_id) THEN RAISE EXCEPTION 'TASK_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF p_milestone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wb_milestones WHERE id = p_milestone_id) THEN RAISE EXCEPTION 'MILESTONE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  v_new := jsonb_build_object(
    'title', p_title, 'description', p_description, 'severity', p_severity, 'status', p_status,
    'task_id', p_task_id, 'milestone_id', p_milestone_id, 'occurred_on', v_occ);

  IF p_id IS NULL THEN
    INSERT INTO public.wb_issues (title, description, severity, status, task_id, milestone_id, occurred_on, reporter_id,
                                  resolved_at, resolved_by)
    VALUES (p_title, p_description, p_severity, p_status, p_task_id, p_milestone_id, v_occ, v_uid,
            CASE WHEN v_resolved THEN now() END, CASE WHEN v_resolved THEN v_uid END)
    RETURNING id INTO v_id;
    INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
    VALUES ('issue', v_id, 'created', v_new, v_uid);
    RETURN v_id;
  END IF;

  SELECT jsonb_build_object(
    'title', title, 'description', description, 'severity', severity, 'status', status,
    'task_id', task_id, 'milestone_id', milestone_id, 'occurred_on', occurred_on), status
    INTO v_old, v_old_status FROM public.wb_issues WHERE id = p_id FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  v_diff := public.wb_jsonb_diff(v_old, v_new);
  IF v_diff = '{}'::jsonb THEN RETURN p_id; END IF;

  UPDATE public.wb_issues
     SET title = p_title, description = p_description, severity = p_severity, status = p_status,
         task_id = p_task_id, milestone_id = p_milestone_id, occurred_on = v_occ,
         -- 해결 상태로 들어갈 때만 스탬프, 다시 열면 해제, 해결↔해결 간 이동은 유지
         resolved_at = CASE WHEN v_resolved AND v_old_status NOT IN ('resolved','wontfix') THEN now()
                            WHEN v_resolved THEN resolved_at ELSE NULL END,
         resolved_by = CASE WHEN v_resolved AND v_old_status NOT IN ('resolved','wontfix') THEN v_uid
                            WHEN v_resolved THEN resolved_by ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
  INSERT INTO public.wb_activity_log (target_type, target_id, action, diff, actor_id)
  VALUES ('issue', p_id, CASE WHEN v_diff ? 'status' THEN 'status' ELSE 'updated' END, v_diff, v_uid);
  RETURN p_id;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] 권한 · 검증
-- ────────────────────────────────────────────────────────────────────────────
-- ⚠ Supabase 는 ALTER DEFAULT PRIVILEGES 로 public 신규 테이블에 anon/authenticated ALL 을 자동 부여한다
--   (운영 실측 2026-09-29: pg_default_acl anon=arwdDxtm, authenticated=arwdDxtm).
--   따라서 아래 GRANT 만으로는 "직접 쓰기 차단"이 성립하지 않는다 — 먼저 전부 REVOKE 하고 필요한 것만 다시 준다.
REVOKE ALL ON public.wb_work_areas, public.wb_milestones, public.wb_task_templates, public.wb_tasks,
              public.wb_task_assignees, public.wb_issues, public.wb_comments, public.wb_activity_log
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wb_work_areas, public.wb_milestones, public.wb_task_templates, public.wb_tasks,
                public.wb_task_assignees, public.wb_issues, public.wb_comments, public.wb_activity_log TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.wb_milestones, public.wb_task_templates, public.wb_comments TO authenticated;
GRANT DELETE ON public.wb_work_areas, public.wb_tasks, public.wb_issues TO authenticated;
GRANT ALL ON public.wb_work_areas, public.wb_milestones, public.wb_task_templates, public.wb_tasks,
             public.wb_task_assignees, public.wb_issues, public.wb_comments, public.wb_activity_log TO service_role;

REVOKE ALL ON FUNCTION public.wb_assert_member()                                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_jsonb_diff(jsonb,jsonb)                                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_upsert_work_area(uuid,text,text,uuid,uuid,integer,boolean)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_set_task_status(uuid,text)                                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.wb_upsert_issue(uuid,text,text,text,text,uuid,uuid,date)               FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_assert_member()                                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_upsert_work_area(uuid,text,text,uuid,uuid,integer,boolean)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_upsert_task(uuid,uuid,text,text,text,timestamptz,uuid,jsonb,uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_set_task_status(uuid,text)                                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_upsert_issue(uuid,text,text,text,text,uuid,uuid,date)               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wb_jsonb_diff(jsonb,jsonb) TO authenticated, service_role;

-- 자기 검증: 하나라도 어긋나면 EXCEPTION → 트랜잭션 전체 롤백
DO $$
DECLARE v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c'
                   AND pg_get_constraintdef(oid) LIKE '%''workboard''%') THEN
    RAISE EXCEPTION '[검증] admin_roles CHECK 에 workboard 없음';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='admin_set_user_roles') NOT LIKE '%array_remove(v_new, ''workboard'')%' THEN
    RAISE EXCEPTION '[검증] admin_set_user_roles 재계산 예외 미반영';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND rowsecurity;
  IF v_cnt <> 8 THEN RAISE EXCEPTION '[검증] wb_ 테이블 RLS 활성 수 % (기대 8)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%';
  IF v_cnt <> 16 THEN RAISE EXCEPTION '[검증] wb_ 정책 수 % (기대 16)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('wb_assert_member','wb_jsonb_diff','wb_upsert_work_area','wb_upsert_task','wb_set_task_status','wb_upsert_issue');
  IF v_cnt <> 6 THEN RAISE EXCEPTION '[검증] wb_ 함수 수 % (기대 6)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM unnest(ARRAY['wb_tasks','wb_issues','wb_task_assignees','wb_activity_log','wb_work_areas']) t
   WHERE has_table_privilege('authenticated', 'public.'||t, 'INSERT') OR has_table_privilege('authenticated', 'public.'||t, 'UPDATE');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] authenticated 직접 쓰기 권한 잔존 %개 (기본 권한 REVOKE 실패)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND has_table_privilege('anon', 'public.'||tablename, 'SELECT');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] anon 에 wb_ SELECT 잔존 %개', v_cnt; END IF;
  RAISE NOTICE '[검증] WORKBOARD Phase 1 전 항목 통과';
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- (선택) MS팀 권한 부여 — Phase 2 배포 후 어드민 '권한 매트릭스'에서 하는 것이 정석.
--        급하면 super 계정으로 SQL Editor 에서 아래 형태로 실행 (감사로그 남김):
--   SELECT public.admin_set_user_roles(
--     (SELECT id FROM public.profiles WHERE lower(email) = lower('someone@cnrres.com')),
--     (SELECT array_agg(role) || 'workboard' FROM public.admin_roles
--       WHERE user_id = (SELECT id FROM public.profiles WHERE lower(email) = lower('someone@cnrres.com'))));
-- ────────────────────────────────────────────────────────────────────────────
