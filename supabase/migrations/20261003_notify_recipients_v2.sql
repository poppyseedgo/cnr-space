-- ============================================================================
-- 알림 수신자 결정 v2 + 사용자별 알림 설정 + Work Space 멤버 명시화   (2026-09-30, Phase 5-A)
--
-- 배경 (2026-09-30 운영 실측): 관리자 알림 수신자 결정이 ①지정명단 ②admin_roles 를 PostgREST 임베드(FK 필요)로
--   읽는데 FK 가 없어 항상 ③ profiles.role='ADMIN' 전원(11명)으로 폴백 → 권한을 빼도 알림이 계속 감.
--   해결: 수신자 결정을 DB 함수 1개(notification_resolve_recipients)로 옮기고 Edge 는 그 결과만 쓴다.
--
--   [A] notification_required_roles 재정의 — super 자동 포함 폐지(고지 확정), wb_* → workboard. 승인 3종은 ADMIN 전원 유지(고지 확정)
--   [B] notification_user_prefs — 사용자별 (type, channel) OFF. RPC admin_set_user_notification_pref / admin_list_user_notification_prefs
--   [C] notification_resolve_recipients(p_type, p_exclude) — 자격 ∩ 지정, 폴백 없음, 개인 채널 플래그 포함 (service_role 전용)
--   [D] notification_logs — 20260741 재작성 (운영 미적용 상태)
--   [E] Work Space 멤버 = 명시 workboard 보유자만: wb_is_member() → RLS 14 정책 · wb_assert_member · wb_list_members 교체
--       + MS 4인 시드(김기남·송보람·박찬희·고현정, 4명 검증 실패 시 전체 롤백)
--   [F] 검증
--
-- 선행: 20260728(settings) · 20260747(entitlement 트리거) · 20260929~20261002(workboard)
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 후속: _shared/recipient-resolver.ts 교체 + send-notification 재배포 (Edge 미배포 시 이 SQL 만으로는 발송 수신자가 안 바뀜)
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 자격 규칙 SSOT
--     NULL = profiles.role='ADMIN' 전원 (회의실 승인 계열 — 유지)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notification_required_roles(p_type text)
 RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_type = 'book_checkout_created' THEN ARRAY['book']        -- ← [2026-09-30] super 제거 (자격 = 명시 모듈 권한만)
    WHEN p_type = 'resource_overdue'      THEN ARRAY['resource']    -- ← [2026-09-30] super 제거
    WHEN p_type = 'resource_hold_conflict' THEN ARRAY['resource']   -- ← [2026-09-30] 8/28 신설 타입 — 종전엔 규칙 누락으로 ADMIN 전원
    WHEN p_type LIKE 'wb\_%'              THEN ARRAY['workboard']   -- ← [2026-09-30] Work Space (Phase 5-B 알림)
    ELSE NULL
  END
$$;

-- notification_recipient_entitled(p_user, p_type) 는 required_roles 를 읽으므로 그대로 (20260747)

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 사용자별 알림 설정
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_user_prefs (
  user_id    uuid NOT NULL,
  type       text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('email','inapp')),
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (user_id, type, channel)
);
COMMENT ON TABLE public.notification_user_prefs IS '사용자별 알림 채널 OFF. 우선순위: 전역(notification_settings) OFF > 개인 OFF > 자격. 행 없음 = 켜짐';
ALTER TABLE public.notification_user_prefs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_user_prefs_select ON public.notification_user_prefs;
CREATE POLICY notification_user_prefs_select ON public.notification_user_prefs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_role('notification') OR public.has_admin_role('user'));
REVOKE ALL ON public.notification_user_prefs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_user_prefs TO authenticated;
GRANT ALL ON public.notification_user_prefs TO service_role;

-- 저장: notification 역할 (알림 설정 담당) 또는 user 역할 (사용자 관리 담당) — 사용자 상세 모달은 user 탭 안에 있다
CREATE OR REPLACE FUNCTION public.admin_set_user_notification_pref(p_user uuid, p_type text, p_channel text, p_enabled boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF NOT (public.has_admin_role('notification') OR public.has_admin_role('user')) THEN RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001'; END IF;
  IF p_channel NOT IN ('email','inapp') THEN RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE = 'P0001'; END IF;
  IF p_type IS NULL OR length(btrim(p_type)) = 0 THEN RAISE EXCEPTION 'INVALID_TYPE' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user) THEN RAISE EXCEPTION 'USER_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  -- 자격 없는 타입은 저장 자체를 거부 — "켜도 안 오는 스위치" 를 DB 에 남기지 않는다
  IF NOT public.notification_recipient_entitled(p_user, p_type) THEN RAISE EXCEPTION 'NOT_ENTITLED' USING ERRCODE = 'P0001'; END IF;

  IF p_enabled THEN
    DELETE FROM public.notification_user_prefs WHERE user_id = p_user AND type = p_type AND channel = p_channel;   -- 켜짐 = 행 없음
  ELSE
    INSERT INTO public.notification_user_prefs (user_id, type, channel, enabled, updated_at, updated_by)
    VALUES (p_user, p_type, p_channel, false, now(), v_uid)
    ON CONFLICT (user_id, type, channel) DO UPDATE SET enabled = false, updated_at = now(), updated_by = v_uid;
  END IF;
END $$;

-- 조회: 사용자 상세 모달 — 그 사람의 자격 있는 타입 목록 + 개인 OFF 상태를 한 번에
DROP FUNCTION IF EXISTS public.admin_list_user_notification_prefs(uuid);
CREATE FUNCTION public.admin_list_user_notification_prefs(p_user uuid)
 RETURNS TABLE (type text, email_enabled boolean, inapp_enabled boolean)
 LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF NOT (public.has_admin_role('notification') OR public.has_admin_role('user')) THEN RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY
    SELECT t.type,
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs p WHERE p.user_id = p_user AND p.type = t.type AND p.channel = 'email' AND NOT p.enabled),
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs p WHERE p.user_id = p_user AND p.type = t.type AND p.channel = 'inapp' AND NOT p.enabled)
      FROM unnest(ARRAY['pending','pending_expiring','pending_expired','book_checkout_created','resource_overdue','resource_hold_conflict',
                        'wb_task_assigned','wb_comment_added','wb_issue_created','wb_issue_resolved','wb_daily_digest']) AS t(type)
     WHERE public.notification_recipient_entitled(p_user, t.type);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 수신자 결정 — Edge 가 호출하는 유일한 경로
--     E = 자격 집합 (required_roles NULL → profiles.role='ADMIN'; 아니면 admin_roles 보유자)  ∧ is_active
--     지정(notification_recipients) 이 있으면: 재직 지정자 ∩ E. 재직 지정자가 0 이면 빈 집합(규칙 ③ — 전원 퇴사 시 폴백 금지).
--       재직 지정자는 있는데 ∩E 가 0 이면 E (자격 상실분은 20260747 트리거가 커밋 시 지우므로 정상 경로에선 발생 안 함)
--     지정이 없으면 E. E 가 0 이면 빈 집합 (ADMIN 전원 폴백 폐지 — 고지 확정)
--     p_exclude = 행위자/예약자 본인 제외. 개인 OFF 는 채널 플래그로 전달 (Edge 가 채널별 적용)
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.notification_resolve_recipients(text, uuid);
CREATE FUNCTION public.notification_resolve_recipients(p_type text, p_exclude uuid DEFAULT NULL)
 RETURNS TABLE (user_id uuid, email text, name text, dept text, avatar_url text, email_enabled boolean, inapp_enabled boolean)
 LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_roles text[] := public.notification_required_roles(p_type);
  v_e     uuid[];          -- 자격 집합 E
  v_des   uuid[];          -- 지정(재직) 집합
  v_int   uuid[];          -- 지정 ∩ E
  v_final uuid[];
BEGIN
  IF v_roles IS NULL THEN
    SELECT COALESCE(array_agg(p.id), '{}') INTO v_e FROM public.profiles p WHERE p.role = 'ADMIN' AND p.is_active IS DISTINCT FROM false;
  ELSE
    SELECT COALESCE(array_agg(DISTINCT r.user_id), '{}') INTO v_e FROM public.admin_roles r JOIN public.profiles p ON p.id = r.user_id
     WHERE r.role = ANY (v_roles) AND p.is_active IS DISTINCT FROM false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.notification_recipients nr WHERE nr.type = p_type) THEN
    SELECT COALESCE(array_agg(nr.user_id), '{}') INTO v_des FROM public.notification_recipients nr JOIN public.profiles p ON p.id = nr.user_id
     WHERE nr.type = p_type AND p.is_active IS DISTINCT FROM false;
    SELECT COALESCE(array_agg(x), '{}') INTO v_int FROM unnest(v_des) x WHERE x = ANY (v_e);
    IF array_length(v_des, 1) IS NULL THEN
      v_final := '{}';                                   -- 규칙 ③: 지정 전원 퇴사 → 빈 집합 (폴백 금지)
    ELSIF array_length(v_int, 1) IS NOT NULL THEN
      v_final := v_int;                                  -- 지정 ∩ 자격
    ELSE
      v_final := v_e;                                    -- 지정자 전원 자격 상실 → 기본 집합 (20260747 트리거가 커밋 시 지우므로 정상 경로선 미발생)
    END IF;
  ELSE
    v_final := v_e;                                      -- 지정 없음 → 자격 집합. 0명이면 빈 집합 (ADMIN 전원 폴백 폐지)
  END IF;

  RETURN QUERY
    SELECT p.id, COALESCE(p.email, ''), COALESCE(p.name, ''), COALESCE(p.dept, ''), p.avatar_url,
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs x WHERE x.user_id = p.id AND x.type = p_type AND x.channel = 'email' AND NOT x.enabled),
           NOT EXISTS (SELECT 1 FROM public.notification_user_prefs x WHERE x.user_id = p.id AND x.type = p_type AND x.channel = 'inapp' AND NOT x.enabled)
      FROM unnest(v_final) f(id) JOIN public.profiles p ON p.id = f.id
     WHERE p_exclude IS NULL OR p.id <> p_exclude
     ORDER BY p.name;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] notification_logs (20260741 재작성) — 행 = 수신자 1 × 채널 1, 스냅샷, FK 없음
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email','inapp','teams')),
  recipient_id    uuid,
  recipient_email text,
  recipient_name  text,
  booking_id      text,
  status          text NOT NULL CHECK (status IN ('sent','failed','skipped')),
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.notification_logs IS '알림 발송 로그 — 건너뛴 것도 기록(channel_off · no_recipient · user_off). 쓰기는 service_role 전용';
CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON public.notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_type    ON public.notification_logs (type, created_at DESC);
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_logs_select ON public.notification_logs;
CREATE POLICY notification_logs_select ON public.notification_logs FOR SELECT TO authenticated USING (public.has_admin_role('notification'));
REVOKE ALL ON public.notification_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_logs TO authenticated;
GRANT ALL ON public.notification_logs TO service_role;
CREATE OR REPLACE FUNCTION public.purge_notification_logs(keep_days integer DEFAULT 90)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE n integer;
BEGIN
  IF NOT public.has_admin_role('super') THEN RAISE EXCEPTION 'NOT_SUPER' USING ERRCODE = 'P0001'; END IF;
  DELETE FROM public.notification_logs WHERE created_at < now() - make_interval(days => keep_days);
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [E] Work Space 멤버 = 명시 workboard 보유자만 (super 자동 통과 폐지 — 고지 확정 2026-09-30, 사용자 4명 제한)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wb_is_member()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid() AND role = 'workboard')
$$;
REVOKE ALL ON FUNCTION public.wb_is_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_is_member() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wb_assert_member()
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF NOT public.wb_is_member() THEN RAISE EXCEPTION 'NOT_WORKBOARD' USING ERRCODE = 'P0001'; END IF;
  RETURN v_uid;
END $$;

-- RLS 14 정책: has_admin_role('workboard') → wb_is_member() 치환 (표현식 그대로, 조건은 유지)
DO $$
DECLARE r record; v_qual text; v_chk text; v_sql text;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname, qual, with_check FROM pg_policies
            WHERE schemaname = 'public' AND tablename LIKE 'wb\_%'
              AND (COALESCE(qual,'') LIKE '%has_admin_role(''workboard''%' OR COALESCE(with_check,'') LIKE '%has_admin_role(''workboard''%') LOOP
    v_qual := replace(r.qual,       'has_admin_role(''workboard''::text)', 'wb_is_member()');
    v_chk  := replace(r.with_check, 'has_admin_role(''workboard''::text)', 'wb_is_member()');
    v_sql := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF v_qual IS NOT NULL THEN v_sql := v_sql || ' USING (' || v_qual || ')'; END IF;
    IF v_chk  IS NOT NULL THEN v_sql := v_sql || ' WITH CHECK (' || v_chk || ')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END $$;

-- 멤버 풀: 명시 보유자만. is_super 는 배지용 정보로 유지
DROP FUNCTION IF EXISTS public.wb_list_members();
CREATE FUNCTION public.wb_list_members()
 RETURNS TABLE (user_id uuid, name text, dept text, email text, avatar_url text, employment_status text, is_super boolean)
 LANGUAGE sql SECURITY DEFINER STABLE SET search_path TO 'public','pg_temp' AS $$
  SELECT p.id, p.name, p.dept, p.email, p.avatar_url, p.employment_status,
         EXISTS (SELECT 1 FROM public.admin_roles s WHERE s.user_id = p.id AND s.role = 'super') AS is_super
    FROM public.profiles p
    JOIN public.admin_roles r ON r.user_id = p.id AND r.role = 'workboard'
   WHERE public.wb_assert_member() IS NOT NULL
     AND p.is_active IS DISTINCT FROM false
   ORDER BY p.name COLLATE "C", p.id
$$;
REVOKE ALL ON FUNCTION public.wb_list_members() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wb_list_members() TO authenticated, service_role;

-- MS 4인 시드 — 이름 매칭, 정확히 4명이 아니면 전체 롤백(동명이인·퇴사 방어). 이미 있으면 건너뜀. 감사로그 actor NULL = 시스템
DO $$
DECLARE v_ids uuid[]; v_id uuid;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.profiles
   WHERE name IN ('김기남','송보람','박찬희','고현정') AND is_active IS DISTINCT FROM false;
  IF COALESCE(array_length(v_ids, 1), 0) <> 4 THEN
    RAISE EXCEPTION '[시드] Work Space 멤버 4명 매칭 실패 (%명) — 이름 확인 필요', COALESCE(array_length(v_ids, 1), 0);
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = v_id AND role = 'workboard') THEN
      INSERT INTO public.admin_roles (user_id, role) VALUES (v_id, 'workboard');
      INSERT INTO public.admin_role_grants (target_user, role, action, actor) VALUES (v_id, 'workboard', 'grant', NULL);
    END IF;
  END LOOP;
END $$;

-- 자격 함수 권한 (Edge/서비스 전용 · 프론트는 admin_list_user_notification_prefs 경유)
REVOKE ALL ON FUNCTION public.notification_resolve_recipients(text, uuid)                        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_resolve_recipients(text, uuid)                     TO service_role;
REVOKE ALL ON FUNCTION public.admin_set_user_notification_pref(uuid, text, text, boolean)        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_notification_pref(uuid, text, text, boolean)     TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_list_user_notification_prefs(uuid)                           FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_user_notification_prefs(uuid)                        TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.purge_notification_logs(integer)                                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_notification_logs(integer)                                TO authenticated, service_role;

-- 소급 정리: super 자격 제거로 자격을 잃은 지정 수신자 (있으면 NOTICE 후 삭제 — 20260747 트리거는 삭제 이벤트에만 반응하므로 여기서 직접)
DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT nr.id, nr.type, p.name FROM public.notification_recipients nr JOIN public.profiles p ON p.id = nr.user_id
            WHERE NOT public.notification_recipient_entitled(nr.user_id, nr.type) LOOP
    RAISE NOTICE '[소급] 자격 없는 지정 수신자 삭제: % / %', r.type, r.name;
    DELETE FROM public.notification_recipients WHERE id = r.id; n := n + 1;
  END LOOP;
  RAISE NOTICE '[소급] 정리 %건', n;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] 검증
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_cnt int;
BEGIN
  IF public.notification_required_roles('book_checkout_created') <> ARRAY['book'] THEN RAISE EXCEPTION '[검증] required_roles book'; END IF;
  IF public.notification_required_roles('wb_comment_added') <> ARRAY['workboard'] THEN RAISE EXCEPTION '[검증] required_roles wb'; END IF;
  IF public.notification_required_roles('pending') IS NOT NULL THEN RAISE EXCEPTION '[검증] pending 은 ADMIN 전원 유지여야 함'; END IF;
  IF to_regclass('public.notification_user_prefs') IS NULL OR to_regclass('public.notification_logs') IS NULL THEN RAISE EXCEPTION '[검증] 테이블 누락'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND (COALESCE(qual,'')||COALESCE(with_check,'')) LIKE '%has_admin_role(''workboard''%';
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] wb_ 정책에 has_admin_role(workboard) 잔존 %개', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'wb\_%' AND (COALESCE(qual,'')||COALESCE(with_check,'')) LIKE '%wb_is_member()%';
  IF v_cnt <> 14 THEN RAISE EXCEPTION '[검증] wb_is_member 정책 수 % (기대 14)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.admin_roles WHERE role = 'workboard';
  IF v_cnt < 4 THEN RAISE EXCEPTION '[검증] workboard 보유자 % (기대 ≥4)', v_cnt; END IF;
  IF has_function_privilege('authenticated', 'public.notification_resolve_recipients(text,uuid)', 'EXECUTE') THEN RAISE EXCEPTION '[검증] resolve 가 authenticated 에 열림'; END IF;
  RAISE NOTICE '[검증] Phase 5-A 전 항목 통과';
END $$;

COMMIT;
