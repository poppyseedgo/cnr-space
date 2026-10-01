-- ============================================================================
-- Work Space 알림 (Phase 5-B)   2026-09-30
--
--   [A] wb_notification_recipients(p_type, p_target_type, p_target_id, p_actor, p_added)
--       — Edge 가 wb_* 5종의 수신자를 얻는 유일한 경로.
--         base = notification_resolve_recipients(p_type, p_actor)  (자격 workboard ∩ 지정 · 개인 채널 플래그 · 행위자 제외 · 재직)
--         ∩ 타입별 대상:
--           wb_task_assigned   : p_added (이번 저장으로 새로 담당이 된 사람)
--           wb_comment_added   : 관련자 = 담당자 ∪ 작성자 ∪ 기존 댓글 작성자   (이슈: 등록자 ∪ 연결 업무 담당자 ∪ 댓글 작성자)
--           wb_issue_created   : 멤버 전원
--           wb_issue_resolved  : 관련자 (댓글과 동일 집합)
--           wb_daily_digest    : p_target_type='user' 의 그 사람 1명
--   [B] wb_notification_context(p_target_type, p_target_id, p_comment_id) → jsonb
--       — 이메일·인앱 본문 재료(제목·영역·상태·마감·D-day·마일스톤·담당·작성자·댓글·처리자). 화면 계산 금지 원칙(DB SSOT)
--   [C] wb_digest_build(p_user, p_date, p_scope) → jsonb
--       — 지연 · 오늘 마감 · 내일 마감 · 오늘 생성된 반복 업무. p_scope 'all'(기본, 고지 확정) | 'mine'(후속: 개인 선택)
--   [D] wb_digest_log — (user_id, digest_date) 1회 발송 dedupe (cron 재실행·수동 호출 보호)
--   [E] cron wb-daily-digest-0900kst — '0 0 * * *' UTC = 09:00 KST. 기존 book-due-reminder 잡 command 복제(키 하드코딩 금지 관례)
--   [F] 검증
--
-- 선행: 20261003 (notification_resolve_recipients · wb_is_member · notification_user_prefs)
-- 실행: SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 후속: send-notification 재배포(POLICIES wb_ 5종 · 렌더러) + wb-daily-digest 신규 배포 + 프론트
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 수신자
-- ────────────────────────────────────────────────────────────────────────────

-- 관련자 집합 (댓글·해결 알림 공통) — 이름=의미: "이 대상에 이미 엮인 사람"
CREATE OR REPLACE FUNCTION public.wb_related_user_ids(p_target_type text, p_target_id uuid)
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT COALESCE(array_agg(DISTINCT u), '{}') FROM (
    -- 업무: 담당자 ∪ 작성자
    SELECT a.user_id AS u FROM public.wb_task_assignees a WHERE p_target_type = 'task' AND a.task_id = p_target_id
    UNION SELECT t.created_by FROM public.wb_tasks t WHERE p_target_type = 'task' AND t.id = p_target_id
    -- 이슈: 등록자 ∪ 연결 업무 담당자 ∪ 전환 업무 담당자
    UNION SELECT i.reporter_id FROM public.wb_issues i WHERE p_target_type = 'issue' AND i.id = p_target_id
    UNION SELECT a.user_id FROM public.wb_issues i JOIN public.wb_task_assignees a ON a.task_id IN (i.task_id, i.converted_task_id)
          WHERE p_target_type = 'issue' AND i.id = p_target_id
    -- 공통: 기존 댓글 작성자
    UNION SELECT c.author_id FROM public.wb_comments c WHERE c.target_type = p_target_type AND c.target_id = p_target_id
  ) s WHERE u IS NOT NULL
$$;

DROP FUNCTION IF EXISTS public.wb_notification_recipients(text, text, uuid, uuid, uuid[]);
CREATE FUNCTION public.wb_notification_recipients(p_type text, p_target_type text, p_target_id uuid, p_actor uuid DEFAULT NULL, p_added uuid[] DEFAULT NULL)
 RETURNS TABLE (user_id uuid, email text, name text, dept text, avatar_url text, email_enabled boolean, inapp_enabled boolean)
 LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_target uuid[];   -- NULL = 제한 없음(멤버 전원)
BEGIN
  IF p_type NOT IN ('wb_task_assigned','wb_comment_added','wb_issue_created','wb_issue_resolved','wb_daily_digest') THEN
    RAISE EXCEPTION 'INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;
  v_target := CASE p_type
    WHEN 'wb_task_assigned'  THEN COALESCE(p_added, '{}')
    WHEN 'wb_comment_added'  THEN public.wb_related_user_ids(p_target_type, p_target_id)
    WHEN 'wb_issue_resolved' THEN public.wb_related_user_ids(p_target_type, p_target_id)
    WHEN 'wb_daily_digest'   THEN ARRAY[p_target_id]
    ELSE NULL
  END;
  RETURN QUERY
    SELECT r.user_id, r.email, r.name, r.dept, r.avatar_url, r.email_enabled, r.inapp_enabled
      FROM public.notification_resolve_recipients(p_type, p_actor) r
     WHERE v_target IS NULL OR r.user_id = ANY (v_target);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 본문 컨텍스트
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_person_json(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT CASE WHEN p_id IS NULL THEN NULL ELSE
    COALESCE((SELECT jsonb_build_object('user_id', p.id, 'name', p.name, 'dept', p.dept, 'avatar_url', p.avatar_url) FROM public.profiles p WHERE p.id = p_id),
             (SELECT jsonb_build_object('user_id', d.id, 'name', d.name, 'dept', d.dept, 'avatar_url', d.avatar_url, 'departed', true) FROM public.departed_users d WHERE d.id = p_id),
             jsonb_build_object('user_id', p_id, 'name', '알 수 없음', 'dept', NULL, 'avatar_url', NULL))
  END
$$;

-- 마감 표기 — '2026-10-08 (목) 18:00' · D-day 문자열 · 지연 여부 (KST 날짜 기준, 이메일·인앱 공용)
CREATE OR REPLACE FUNCTION public.wb_due_json(p_due timestamptz, p_today date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date)
 RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_due IS NULL THEN jsonb_build_object('due_kst', NULL, 'dday', NULL, 'overdue', false, 'days', NULL) ELSE
    jsonb_build_object(
      'due_kst', to_char(p_due AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || ' (' || (ARRAY['일','월','화','수','목','금','토'])[EXTRACT(DOW FROM (p_due AT TIME ZONE 'Asia/Seoul'))::int + 1] || ') ' || to_char(p_due AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
      'days',    ((p_due AT TIME ZONE 'Asia/Seoul')::date - p_today),
      'dday',    CASE WHEN (p_due AT TIME ZONE 'Asia/Seoul')::date = p_today THEN 'D-day'
                      WHEN (p_due AT TIME ZONE 'Asia/Seoul')::date > p_today THEN 'D-' || ((p_due AT TIME ZONE 'Asia/Seoul')::date - p_today)
                      ELSE 'D+' || (p_today - (p_due AT TIME ZONE 'Asia/Seoul')::date) END,
      'overdue', (p_due AT TIME ZONE 'Asia/Seoul')::date < p_today)
  END
$$;

DROP FUNCTION IF EXISTS public.wb_notification_context(text, uuid, uuid);
CREATE FUNCTION public.wb_notification_context(p_target_type text, p_target_id uuid, p_comment_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v jsonb;
  t public.wb_tasks%ROWTYPE;
  i public.wb_issues%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF p_target_type = 'task' THEN
    SELECT * INTO t FROM public.wb_tasks WHERE id = p_target_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v := jsonb_build_object(
      'target_type', 'task', 'id', t.id, 'title', t.title, 'kind_label', '업무',
      'area', (SELECT a.name FROM public.wb_work_areas a WHERE a.id = t.area_id),
      'status', t.status,
      'status_label', CASE t.status WHEN 'todo' THEN '할 일' WHEN 'doing' THEN '진행 중' WHEN 'done' THEN '완료' WHEN 'hold' THEN '보류' ELSE t.status END,
      'priority', t.priority,
      'milestone', (SELECT m.title FROM public.wb_milestones m WHERE m.id = t.milestone_id),
      'is_recurring', t.template_id IS NOT NULL,
      'assignees', COALESCE((SELECT jsonb_agg(public.wb_person_json(a.user_id) ORDER BY a.assigned_at) FROM public.wb_task_assignees a WHERE a.task_id = t.id), '[]'::jsonb),
      'creator', public.wb_person_json(t.created_by)
    ) || public.wb_due_json(t.due_at, v_today);
  ELSIF p_target_type = 'issue' THEN
    SELECT * INTO i FROM public.wb_issues WHERE id = p_target_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v := jsonb_build_object(
      'target_type', 'issue', 'id', i.id, 'title', i.title, 'kind_label', '이슈',
      'area', (SELECT a.name FROM public.wb_work_areas a JOIN public.wb_tasks t2 ON t2.area_id = a.id WHERE t2.id = COALESCE(i.task_id, i.converted_task_id)),
      'status', i.status,
      'status_label', CASE i.status WHEN 'open' THEN '열림' WHEN 'in_progress' THEN '진행 중' WHEN 'resolved' THEN '해결' WHEN 'wontfix' THEN '보류' ELSE i.status END,
      'severity', i.severity,
      'severity_label', CASE i.severity WHEN 'low' THEN '낮음' WHEN 'medium' THEN '보통' WHEN 'high' THEN '높음' WHEN 'critical' THEN '긴급' ELSE i.severity END,
      'occurred_on', to_char(i.occurred_on, 'YYYY-MM-DD'),
      'milestone', (SELECT m.title FROM public.wb_milestones m WHERE m.id = i.milestone_id),
      'linked_task', (SELECT t2.title FROM public.wb_tasks t2 WHERE t2.id = COALESCE(i.task_id, i.converted_task_id)),
      'assignees', COALESCE((SELECT jsonb_agg(public.wb_person_json(a.user_id)) FROM public.wb_task_assignees a WHERE a.task_id = COALESCE(i.task_id, i.converted_task_id)), '[]'::jsonb),
      'creator', public.wb_person_json(i.reporter_id),
      'resolver', public.wb_person_json(i.resolved_by),
      'resolved_kst', CASE WHEN i.resolved_at IS NULL THEN NULL ELSE to_char(i.resolved_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') END,
      'due_kst', NULL, 'dday', NULL, 'overdue', false, 'days', NULL
    );
  ELSE
    RAISE EXCEPTION 'INVALID_TARGET_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF p_comment_id IS NOT NULL THEN
    v := v || jsonb_build_object('comment', (
      SELECT jsonb_build_object('id', c.id, 'body', c.body, 'author', public.wb_person_json(c.author_id),
                                'created_kst', to_char(c.created_at AT TIME ZONE 'Asia/Seoul', 'MM-DD HH24:MI'))
        FROM public.wb_comments c WHERE c.id = p_comment_id));
  END IF;
  RETURN v;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 일일 다이제스트 재료 — 대상 = 미완료(todo·doing) 업무. hold 는 의도적 정지라 지연 독촉에서 제외
--     p_scope: 'all' = 멤버 전원 업무(본인 담당 mine=true 표기) / 'mine' = 본인 담당만 (후속 개인 선택용)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.wb_digest_build(uuid, date, text);
CREATE FUNCTION public.wb_digest_build(p_user uuid, p_date date DEFAULT (now() AT TIME ZONE 'Asia/Seoul')::date, p_scope text DEFAULT 'all')
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_overdue jsonb; v_today jsonb; v_tomorrow jsonb; v_recur jsonb;
BEGIN
  IF p_scope NOT IN ('all','mine') THEN RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = 'P0001'; END IF;

  -- 공통 항목 셀렉터: 제목·영역·담당 이름 목록·mine·마감
  WITH base AS (
    SELECT t.id, t.title, t.status, t.due_at, t.template_id, t.created_at,
           (SELECT a.name FROM public.wb_work_areas a WHERE a.id = t.area_id) AS area,
           COALESCE((SELECT array_agg(COALESCE(p.name, '?') ORDER BY x.assigned_at) FROM public.wb_task_assignees x LEFT JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id), '{}') AS assignee_names,
           -- 수신자 본인은 '나' 로 표기 (이메일·인앱이 그대로 출력 — 화면 계산 금지)
           COALESCE((SELECT array_agg(CASE WHEN x.user_id = p_user THEN '나' ELSE COALESCE(p.name, '?') END ORDER BY (x.user_id <> p_user), x.assigned_at) FROM public.wb_task_assignees x LEFT JOIN public.profiles p ON p.id = x.user_id WHERE x.task_id = t.id), '{}') AS assignee_labels,
           EXISTS (SELECT 1 FROM public.wb_task_assignees x WHERE x.task_id = t.id AND x.user_id = p_user) AS mine,
           (t.due_at AT TIME ZONE 'Asia/Seoul')::date AS due_date
      FROM public.wb_tasks t
     WHERE t.status IN ('todo','doing')
       AND (p_scope = 'all' OR EXISTS (SELECT 1 FROM public.wb_task_assignees x WHERE x.task_id = t.id AND x.user_id = p_user))
  ), item AS (
    SELECT b.*, jsonb_build_object('id', b.id, 'title', b.title, 'area', b.area, 'assignees', to_jsonb(b.assignee_names), 'assignee_labels', to_jsonb(b.assignee_labels), 'mine', b.mine,
                                   'status', b.status, 'is_recurring', b.template_id IS NOT NULL) || public.wb_due_json(b.due_at, p_date) AS j
      FROM base b
  )
  SELECT
    COALESCE((SELECT jsonb_agg(j ORDER BY due_date, title) FROM item WHERE due_date < p_date), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(j ORDER BY due_at, title)   FROM item WHERE due_date = p_date), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(j ORDER BY due_at, title)   FROM item WHERE due_date = p_date + 1), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(j ORDER BY due_at, title)   FROM item WHERE template_id IS NOT NULL AND (created_at AT TIME ZONE 'Asia/Seoul')::date = p_date), '[]'::jsonb)
  INTO v_overdue, v_today, v_tomorrow, v_recur;

  RETURN jsonb_build_object(
    'date', to_char(p_date, 'YYYY-MM-DD'),
    'date_label', to_char(p_date, 'YYYY-MM-DD') || ' (' || (ARRAY['일','월','화','수','목','금','토'])[EXTRACT(DOW FROM p_date)::int + 1] || ')',
    'date_short', to_char(p_date, 'FMMM/FMDD') || ' (' || (ARRAY['일','월','화','수','목','금','토'])[EXTRACT(DOW FROM p_date)::int + 1] || ')',
    'scope', p_scope,
    'counts', jsonb_build_object('overdue', jsonb_array_length(v_overdue), 'today', jsonb_array_length(v_today),
                                 'tomorrow', jsonb_array_length(v_tomorrow), 'recurring', jsonb_array_length(v_recur)),
    'total', jsonb_array_length(v_overdue) + jsonb_array_length(v_today) + jsonb_array_length(v_tomorrow) + jsonb_array_length(v_recur),
    'overdue', v_overdue, 'today', v_today, 'tomorrow', v_tomorrow, 'recurring', v_recur);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 다이제스트 발송 기록 — 1인 1일 1통 (PK 로 강제)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wb_digest_log (
  user_id      uuid NOT NULL,
  digest_date  date NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  counts       jsonb,
  result       text,                   -- 'sent' | 'empty'(0건 → 미발송) | 'failed:<사유>'
  PRIMARY KEY (user_id, digest_date)
);
COMMENT ON TABLE public.wb_digest_log IS '[WORKBOARD] 일일 다이제스트 발송 기록 — 같은 날 재실행 시 건너뜀. 쓰기 service_role 전용';
ALTER TABLE public.wb_digest_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wb_digest_log_select ON public.wb_digest_log;
CREATE POLICY wb_digest_log_select ON public.wb_digest_log FOR SELECT TO authenticated USING (public.wb_is_member());
REVOKE ALL ON public.wb_digest_log FROM anon, authenticated;
GRANT SELECT ON public.wb_digest_log TO authenticated;
GRANT ALL ON public.wb_digest_log TO service_role;

-- 권한 — 전부 service_role 전용 (Edge 만 호출). 화면은 호출하지 않는다
REVOKE ALL ON FUNCTION public.wb_related_user_ids(text, uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_notification_recipients(text, text, uuid, uuid, uuid[])   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_person_json(uuid)                                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_notification_context(text, uuid, uuid)                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wb_digest_build(uuid, date, text)                            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wb_related_user_ids(text, uuid)                            TO service_role;
GRANT EXECUTE ON FUNCTION public.wb_notification_recipients(text, text, uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.wb_person_json(uuid)                                       TO service_role;
GRANT EXECUTE ON FUNCTION public.wb_notification_context(text, uuid, uuid)                  TO service_role;
GRANT EXECUTE ON FUNCTION public.wb_digest_build(uuid, date, text)                          TO service_role;
GRANT EXECUTE ON FUNCTION public.wb_due_json(timestamptz, date)                             TO authenticated, service_role;   -- 순수 함수, 화면 재사용 가능

-- ────────────────────────────────────────────────────────────────────────────
-- [E] cron — 09:00 KST. 기존 book-due-reminder-0900kst 잡의 command(URL·헤더) 복제 (키 하드코딩 금지 관례, 20260748 동일)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_job bigint; v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[cron] pg_cron 없음 — 잡 등록 건너뜀 (운영에서는 등록됨)'; RETURN;
  END IF;
  SELECT command INTO v_cmd FROM cron.job WHERE jobname = 'book-due-reminder-0900kst';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION '[cron] 원본 잡 book-due-reminder-0900kst 없음 — 복제 불가. cron.job 을 확인하세요';
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'wb-daily-digest-0900kst';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule('wb-daily-digest-0900kst', '0 0 * * *', replace(v_cmd, 'book-due-reminder', 'wb-daily-digest'));
  RAISE NOTICE '[cron] wb-daily-digest-0900kst 등록 (0 0 * * * UTC = 09:00 KST)';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] 검증
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v jsonb;
BEGIN
  IF to_regclass('public.wb_digest_log') IS NULL THEN RAISE EXCEPTION '[검증] wb_digest_log 누락'; END IF;
  IF has_function_privilege('authenticated', 'public.wb_notification_recipients(text,text,uuid,uuid,uuid[])', 'EXECUTE') THEN RAISE EXCEPTION '[검증] recipients 가 authenticated 에 열림'; END IF;
  IF has_function_privilege('authenticated', 'public.wb_digest_build(uuid,date,text)', 'EXECUTE') THEN RAISE EXCEPTION '[검증] digest_build 가 authenticated 에 열림'; END IF;
  v := public.wb_due_json('2026-10-08 18:00+09'::timestamptz, '2026-09-30'::date);
  IF v->>'dday' <> 'D-8' OR v->>'due_kst' <> '2026-10-08 (목) 18:00' THEN RAISE EXCEPTION '[검증] wb_due_json %', v; END IF;
  v := public.wb_due_json('2026-09-27 18:00+09'::timestamptz, '2026-09-30'::date);
  IF v->>'dday' <> 'D+3' OR (v->>'overdue')::boolean IS NOT TRUE THEN RAISE EXCEPTION '[검증] wb_due_json 지연 %', v; END IF;
  IF public.notification_required_roles('wb_daily_digest') <> ARRAY['workboard'] THEN RAISE EXCEPTION '[검증] required_roles wb_daily_digest'; END IF;
  RAISE NOTICE '[검증] Phase 5-B SQL 전 항목 통과';
END $$;

COMMIT;
