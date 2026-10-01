-- ============================================================================
-- 20261006_org_phase2.sql
-- 조직도(ORG) Phase 2 — RPC · 후크 · 자동 전환
--
-- 전제: 20261005_org_phase1.sql 적용 완료 (org_ 테이블 13·가드 트리거·RLS)
--
-- 범위
--   [A] employment_status_apply() 신설 — admin_set_employment_status 본문을 내부 함수로 분리(무가드),
--       admin_set_employment_status 는 "가드 + 호출" 로 재정의 (동작 동일). 조직도 RPC 가 같은 함수를 호출한다.
--   [B] notification_required_roles(): 'org_%' → ['org'] 1줄 추가 (원문 그대로 + 1줄)
--   [C] 가드 헬퍼 org_assert_org() / org_assert_super()
--   [D] 편집 잠금 org_acquire_lock / org_release_lock (TTL 30분, super 강제 해제)
--   [E] org_copy_file — 단위·카드·직무 딥카피(id 재매핑), 계보 기록, 로스터 대조 반환
--   [F] org_activate_file — super 전용. 단일 트랜잭션: 유령카드 검증 → 현 Active archived → 대상 active →
--       잠금 해제 → 이전 Active 대비 diff 생성 → 인앱 알림(org_activated)
--   [G] org_set_person_status / [H] org_end_person_status — 상태 등록·종료 + profiles.employment_status 동기화 + 반납 체크리스트 복제
--   [I] org_link_planned_person — sync-all-users 후크: 입사예정자 ↔ 신규 profile 연결, 카드 백필
--   [J] departed_users INSERT 트리거 — 활성 상태 종결(departed)
--   [K] org_daily_transitions — 휴직예정→휴직 / 휴직 D-30→복직예정 / 복직예정→복직. pg_cron KST 00:15
--   [L] org_roster_check — 로스터 누락·유령 카드·Division 불일치 (저장 없이 실시간 계산)
--   [M] 권한 · 자기 검증
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run
-- 검증: _diagnose_org_20261002.sql 전 항목 ✅
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] employment_status_apply — admin_set_employment_status(20260735) 본문 그대로, 권한 가드만 제거
--     ⚠ 호출자가 권한 검증을 책임진다. authenticated 에 EXECUTE 를 주지 않는다.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.employment_status_apply(p_user_id uuid, p_status text, p_departure_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.profiles%ROWTYPE;
BEGIN
  IF p_status NOT IN ('active','departing','leave','returned') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  IF p_status = 'departing' THEN
    IF p_departure_on IS NULL THEN
      RAISE EXCEPTION 'DEPARTURE_DATE_REQUIRED' USING HINT = '퇴사 예정일을 지정해야 합니다.';
    END IF;
    -- 과거일 등록 방지 — 당일(KST) 등록은 허용 (당일 퇴사 예정 → 익일 00시 자동 처리)
    IF p_departure_on < (now() AT TIME ZONE 'Asia/Seoul')::date THEN
      RAISE EXCEPTION 'DEPARTURE_DATE_PAST' USING HINT = '퇴사 예정일은 오늘 이후여야 합니다.';
    END IF;
  END IF;

  UPDATE public.profiles SET
    employment_status      = p_status,
    -- departing 이 아니면 예정일 잔존 금지 (예정 철회 = active 복귀 시 자동 소거)
    departure_scheduled_on = CASE WHEN p_status = 'departing' THEN p_departure_on ELSE NULL END,
    -- 복직 전환 시각 기록 → 30일 라벨 소멸 기준. 그 외 상태로 바꾸면 소거.
    returned_on            = CASE WHEN p_status = 'returned' THEN (now() AT TIME ZONE 'Asia/Seoul')::date ELSE NULL END
  WHERE id = p_user_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  RETURN jsonb_build_object(
    'user_id',                v_row.id,
    'employment_status',      v_row.employment_status,
    'departure_scheduled_on', v_row.departure_scheduled_on,
    'returned_on',            v_row.returned_on
  );
END $function$;
COMMENT ON FUNCTION public.employment_status_apply(uuid, text, date) IS '[내부] 재직 상태 적용 — 권한 가드 없음. admin_set_employment_status(사용자 관리)·org_set_person_status(조직도)가 호출. authenticated EXECUTE 금지';

-- 기존 함수 = 가드 + 호출 (호출부·반환 형식 동일)
CREATE OR REPLACE FUNCTION public.admin_set_employment_status(p_user_id uuid, p_status text, p_departure_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_profile_admin() OR public.has_admin_role('user')) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = '사용자 관리 권한이 필요합니다.';
  END IF;
  RETURN public.employment_status_apply(p_user_id, p_status, p_departure_on);   -- ← [2026-10-01 ORG Phase2] 본문 분리
END $function$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] notification_required_roles — 원문(2026-09-30) + org 1줄
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notification_required_roles(p_type text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_type = 'book_checkout_created' THEN ARRAY['book']        -- ← [2026-09-30] super 제거 (자격 = 명시 모듈 권한만)
    WHEN p_type = 'resource_overdue'      THEN ARRAY['resource']    -- ← [2026-09-30] super 제거
    WHEN p_type = 'resource_hold_conflict' THEN ARRAY['resource']   -- ← [2026-09-30] 8/28 신설 타입 — 종전엔 규칙 누락으로 ADMIN 전원
    WHEN p_type LIKE 'wb\_%'              THEN ARRAY['workboard']   -- ← [2026-09-30] Work Space (Phase 5-B 알림)
    WHEN p_type LIKE 'org\_%'             THEN ARRAY['org']         -- ← [2026-10-01 ORG Phase2] 조직도 (org_activated)
    ELSE NULL
  END
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 가드 헬퍼
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_assert_org()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('org') THEN RAISE EXCEPTION 'FORBIDDEN' USING HINT = '조직도 관리 권한이 필요합니다.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.org_assert_super()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = auth.uid() AND role = 'super') THEN
    RAISE EXCEPTION 'NOT_SUPER' USING HINT = 'Active 지정은 최고 관리자만 할 수 있습니다.';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 편집 잠금 — TTL 30분. 보유자 본인은 갱신, 만료되면 누구나, super 는 p_force 로 강제
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_acquire_lock(p_file_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_f public.org_files%ROWTYPE; v_holder text;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO v_f FROM public.org_files WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_FILE_NOT_FOUND'; END IF;
  IF v_f.status <> 'draft' THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일만 편집할 수 있습니다.'; END IF;
  IF v_f.lock_by IS NOT NULL AND v_f.lock_by <> v_uid AND v_f.lock_at > now() - interval '30 minutes' THEN
    IF NOT (p_force AND public.has_admin_role('super')) THEN
      SELECT name INTO v_holder FROM public.profiles WHERE id = v_f.lock_by;
      RAISE EXCEPTION 'ORG_FILE_LOCKED' USING HINT = format('%s 님이 편집 중입니다.', COALESCE(v_holder, '다른 사용자')), DETAIL = v_f.lock_by::text;
    END IF;
  END IF;
  UPDATE public.org_files SET lock_by = v_uid, lock_at = now() WHERE id = p_file_id;
  RETURN jsonb_build_object('file_id', p_file_id, 'lock_by', v_uid, 'lock_at', now(), 'forced', p_force AND v_f.lock_by IS DISTINCT FROM v_uid);
END $$;

CREATE OR REPLACE FUNCTION public.org_release_lock(p_file_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  PERFORM public.org_assert_org();
  UPDATE public.org_files SET lock_by = NULL, lock_at = NULL
   WHERE id = p_file_id AND (lock_by = v_uid OR public.has_admin_role('super') OR lock_at < now() - interval '30 minutes');
  RETURN FOUND;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [L] 로스터 대조 — 저장하지 않고 호출 시점에 계산 (sync 시점과 어긋난 값이 남지 않게)
--     missing: profiles(employee_id 있음 = sync 관리 계정, 재직)인데 파일에 카드 없음
--     ghosts : 카드 profile_id 가 profiles 에 없음 (퇴사 완료 등)
--     division_mismatch: 카드 소속 단위의 조상 중 azure_division 이 설정된 가장 가까운 단위 값 ≠ profiles.dept
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_roster_check(p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_missing jsonb; v_ghosts jsonb; v_mismatch jsonb;
BEGIN
  PERFORM public.org_assert_org();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.name, 'dept', p.dept, 'email', p.email) ORDER BY p.dept, p.name), '[]'::jsonb)
    INTO v_missing
    FROM public.profiles p
   WHERE p.employee_id IS NOT NULL AND p.employee_id <> ''
     AND NOT EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_file_id AND c.profile_id = p.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('card_id', c.id, 'profile_id', c.profile_id, 'unit_id', c.unit_id,
                                                'departed_name', d.name, 'departed_at', d.departed_at)), '[]'::jsonb)
    INTO v_ghosts
    FROM public.org_cards c LEFT JOIN public.departed_users d ON d.id = c.profile_id
   WHERE c.file_id = p_file_id AND c.profile_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.profile_id);

  WITH RECURSIVE anc AS (
    SELECT u.id AS unit_id, u.id AS cur, u.parent_unit_id, u.azure_division, 0 AS depth
      FROM public.org_units u WHERE u.file_id = p_file_id
    UNION ALL
    SELECT a.unit_id, pu.id, pu.parent_unit_id, pu.azure_division, a.depth + 1
      FROM anc a JOIN public.org_units pu ON pu.id = a.parent_unit_id
     WHERE a.azure_division IS NULL AND a.depth < 64
  ), div AS (
    SELECT DISTINCT ON (unit_id) unit_id, azure_division FROM anc WHERE azure_division IS NOT NULL ORDER BY unit_id, depth
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('card_id', c.id, 'profile_id', c.profile_id, 'name', p.name,
                                                'unit_division', d.azure_division, 'azure_dept', p.dept) ORDER BY p.name), '[]'::jsonb)
    INTO v_mismatch
    FROM public.org_cards c JOIN public.profiles p ON p.id = c.profile_id JOIN div d ON d.unit_id = c.unit_id
   WHERE c.file_id = p_file_id AND lower(btrim(COALESCE(p.dept,''))) <> lower(btrim(d.azure_division));

  RETURN jsonb_build_object('file_id', p_file_id,
                            'missing', v_missing, 'missing_count', jsonb_array_length(v_missing),
                            'ghosts', v_ghosts, 'ghost_count', jsonb_array_length(v_ghosts),
                            'division_mismatch', v_mismatch, 'division_mismatch_count', jsonb_array_length(v_mismatch));
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [E] org_copy_file — 딥카피. 원본은 어떤 status 든 가능, 결과는 항상 draft
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_copy_file(p_source_file_id uuid, p_name text, p_effective_on date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_new uuid; v_units int; v_cards int; v_check jsonb;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = p_source_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_FOUND'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'ORG_NAME_REQUIRED'; END IF;

  INSERT INTO public.org_files (name, status, effective_on, parent_file_id, created_by, updated_by)
  VALUES (btrim(p_name), 'draft', p_effective_on, p_source_file_id, v_uid, v_uid)
  RETURNING id INTO v_new;

  -- id 재매핑 테이블 (세션 임시)
  CREATE TEMP TABLE IF NOT EXISTS _org_map (kind text, old_id uuid, new_id uuid, PRIMARY KEY (kind, old_id)) ON COMMIT DROP;
  DELETE FROM _org_map;

  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'unit', id, gen_random_uuid() FROM public.org_units WHERE file_id = p_source_file_id;
  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'card', id, gen_random_uuid() FROM public.org_cards WHERE file_id = p_source_file_id;

  -- 단위: 부모 없이 먼저 넣고 → 부모 재매핑 (가드: 같은 파일·순환 검사 통과)
  INSERT INTO public.org_units (id, file_id, parent_unit_id, name, code, azure_division, head_card_id, sort_order)
  SELECT m.new_id, v_new, NULL, u.name, u.code, u.azure_division, NULL, u.sort_order
    FROM public.org_units u JOIN _org_map m ON m.kind = 'unit' AND m.old_id = u.id
   WHERE u.file_id = p_source_file_id;
  UPDATE public.org_units nu
     SET parent_unit_id = pm.new_id
    FROM public.org_units ou JOIN _org_map m ON m.kind = 'unit' AND m.old_id = ou.id
    JOIN _org_map pm ON pm.kind = 'unit' AND pm.old_id = ou.parent_unit_id
   WHERE nu.id = m.new_id AND ou.file_id = p_source_file_id;
  GET DIAGNOSTICS v_units = ROW_COUNT;

  -- 카드
  INSERT INTO public.org_cards (id, file_id, unit_id, profile_id, person_id, display_name, rank_id, reports_to_card_id,
                                is_unit_head, is_vacancy, employment_type, work_location, fte, memo, sort_order)
  SELECT m.new_id, v_new, um.new_id, c.profile_id, c.person_id, c.display_name, c.rank_id, NULL,
         c.is_unit_head, c.is_vacancy, c.employment_type, c.work_location, c.fte, c.memo, c.sort_order
    FROM public.org_cards c
    JOIN _org_map m  ON m.kind = 'card' AND m.old_id = c.id
    JOIN _org_map um ON um.kind = 'unit' AND um.old_id = c.unit_id
   WHERE c.file_id = p_source_file_id;
  GET DIAGNOSTICS v_cards = ROW_COUNT;
  UPDATE public.org_cards nc
     SET reports_to_card_id = rm.new_id
    FROM public.org_cards oc JOIN _org_map m ON m.kind = 'card' AND m.old_id = oc.id
    JOIN _org_map rm ON rm.kind = 'card' AND rm.old_id = oc.reports_to_card_id
   WHERE nc.id = m.new_id AND oc.file_id = p_source_file_id;
  UPDATE public.org_units nu
     SET head_card_id = hm.new_id
    FROM public.org_units ou JOIN _org_map m ON m.kind = 'unit' AND m.old_id = ou.id
    JOIN _org_map hm ON hm.kind = 'card' AND hm.old_id = ou.head_card_id
   WHERE nu.id = m.new_id AND ou.file_id = p_source_file_id;

  -- 직무
  INSERT INTO public.org_card_jobs (card_id, job_id, is_primary, sort_order)
  SELECT m.new_id, j.job_id, j.is_primary, j.sort_order
    FROM public.org_card_jobs j JOIN _org_map m ON m.kind = 'card' AND m.old_id = j.card_id;

  v_check := public.org_roster_check(v_new);
  RETURN jsonb_build_object('file_id', v_new, 'parent_file_id', p_source_file_id,
                            'units', (SELECT count(*) FROM public.org_units WHERE file_id = v_new),
                            'cards', v_cards,
                            'missing_count', v_check->'missing_count', 'ghost_count', v_check->'ghost_count');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] org_activate_file — super 전용 단일 트랜잭션
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_activate_file(p_file_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_f public.org_files%ROWTYPE; v_prev uuid; v_check jsonb; v_cnt int;
  v_diff jsonb; v_title text; v_body text; r record; v_in int := 0;
BEGIN
  PERFORM public.org_assert_super();
  SELECT * INTO v_f FROM public.org_files WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_FILE_NOT_FOUND'; END IF;
  IF v_f.status <> 'draft' THEN RAISE EXCEPTION 'ORG_ACTIVATE_NOT_DRAFT' USING HINT = '초안만 Active 로 지정할 수 있습니다.'; END IF;
  IF v_f.effective_on IS NULL THEN RAISE EXCEPTION 'ORG_ACTIVATE_NEEDS_EFFECTIVE' USING HINT = '적용일을 먼저 지정하세요.'; END IF;
  IF v_f.lock_by IS NOT NULL AND v_f.lock_by <> v_uid AND v_f.lock_at > now() - interval '30 minutes' AND NOT p_force THEN
    RAISE EXCEPTION 'ORG_FILE_LOCKED' USING HINT = '다른 사용자가 편집 중입니다. 강제 전환하려면 force 를 지정하세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_units WHERE file_id = p_file_id) THEN
    RAISE EXCEPTION 'ORG_ACTIVATE_EMPTY' USING HINT = '단위가 없는 빈 조직도는 Active 로 지정할 수 없습니다.';
  END IF;

  v_check := public.org_roster_check(p_file_id);
  IF (v_check->>'ghost_count')::int > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'ORG_ACTIVATE_GHOSTS' USING HINT = format('퇴사자 카드 %s장이 남아 있습니다. 정리하거나 force 로 전환하세요.', v_check->>'ghost_count'), DETAIL = (v_check->'ghosts')::text;
  END IF;

  PERFORM set_config('org.lifecycle', 'on', true);   -- 트랜잭션 로컬

  SELECT id INTO v_prev FROM public.org_files WHERE status = 'active' AND id <> p_file_id FOR UPDATE;
  IF v_prev IS NOT NULL THEN
    UPDATE public.org_files SET status = 'archived', archived_at = now(), lock_by = NULL, lock_at = NULL WHERE id = v_prev;
  END IF;
  UPDATE public.org_files SET status = 'active', activated_at = now(), activated_by = v_uid, lock_by = NULL, lock_at = NULL, updated_by = v_uid
   WHERE id = p_file_id;

  -- ── diff (이전 Active 대비). 사람 키 = profile_id | person_id, 단위 키 = code(없으면 name) ──
  DELETE FROM public.org_activation_diffs WHERE file_id = p_file_id;
  IF v_prev IS NOT NULL THEN
    WITH cur AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = p_file_id AND NOT c.is_vacancy
    ), prev AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = v_prev AND NOT c.is_vacancy
    ), rows AS (
      SELECT 'hired' AS kind, cur.key, cur.label, NULL::jsonb AS before, jsonb_build_object('unit', cur.unit_name) AS after
        FROM cur WHERE NOT EXISTS (SELECT 1 FROM prev WHERE prev.key = cur.key)
      UNION ALL
      SELECT 'departed', prev.key, prev.label, jsonb_build_object('unit', prev.unit_name), NULL
        FROM prev WHERE NOT EXISTS (SELECT 1 FROM cur WHERE cur.key = prev.key)
      UNION ALL
      SELECT 'moved', cur.key, cur.label, jsonb_build_object('unit', prev.unit_name), jsonb_build_object('unit', cur.unit_name)
        FROM cur JOIN prev ON prev.key = cur.key WHERE prev.unit_key IS DISTINCT FROM cur.unit_key
      UNION ALL
      SELECT 'promoted', cur.key, cur.label,
             jsonb_build_object('rank', (SELECT label FROM public.org_ranks WHERE id = prev.rank_id)),
             jsonb_build_object('rank', (SELECT label FROM public.org_ranks WHERE id = cur.rank_id))
        FROM cur JOIN prev ON prev.key = cur.key WHERE prev.rank_id IS DISTINCT FROM cur.rank_id
      UNION ALL
      SELECT 'job_changed', cur.key, cur.label,
             jsonb_build_object('job', (SELECT code FROM public.org_jobs WHERE id = prev.job_id)),
             jsonb_build_object('job', (SELECT code FROM public.org_jobs WHERE id = cur.job_id))
        FROM cur JOIN prev ON prev.key = cur.key WHERE prev.job_id IS DISTINCT FROM cur.job_id
      UNION ALL
      SELECT 'head_changed', cur.key, cur.label, jsonb_build_object('is_unit_head', prev.is_unit_head), jsonb_build_object('is_unit_head', cur.is_unit_head)
        FROM cur JOIN prev ON prev.key = cur.key WHERE prev.is_unit_head <> cur.is_unit_head
      UNION ALL
      SELECT 'unit_created', COALESCE(u.code, u.name), u.name, NULL, jsonb_build_object('name', u.name, 'code', u.code)
        FROM public.org_units u WHERE u.file_id = p_file_id
         AND NOT EXISTS (SELECT 1 FROM public.org_units o WHERE o.file_id = v_prev AND COALESCE(o.code, o.name) = COALESCE(u.code, u.name))
      UNION ALL
      SELECT 'unit_removed', COALESCE(o.code, o.name), o.name, jsonb_build_object('name', o.name, 'code', o.code), NULL
        FROM public.org_units o WHERE o.file_id = v_prev
         AND NOT EXISTS (SELECT 1 FROM public.org_units u WHERE u.file_id = p_file_id AND COALESCE(u.code, u.name) = COALESCE(o.code, o.name))
    )
    INSERT INTO public.org_activation_diffs (file_id, prev_file_id, kind, card_ref, label, before, after)
    SELECT p_file_id, v_prev, kind, key, label, before, after FROM rows;
  END IF;

  SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_diff
    FROM (SELECT kind, count(*) n FROM public.org_activation_diffs WHERE file_id = p_file_id GROUP BY kind) s;
  SELECT count(*) INTO v_cnt FROM public.org_activation_diffs WHERE file_id = p_file_id;

  -- ── 인앱 알림 org_activated (이메일은 프론트가 send-notification 호출) ──
  v_title := '조직도 Active 전환';
  v_body  := format('%s · 적용일 %s · 변경 %s건', v_f.name, to_char(v_f.effective_on, 'YYYY-MM-DD'), v_cnt);
  FOR r IN SELECT * FROM public.notification_resolve_recipients('org_activated', NULL) LOOP
    IF r.inapp_enabled THEN
      INSERT INTO public.notifications (user_id, type, title, body, booking_id)
      VALUES (r.user_id, 'org_activated', v_title, v_body, 'org-file-' || p_file_id::text);
      v_in := v_in + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('file_id', p_file_id, 'prev_file_id', v_prev, 'effective_on', v_f.effective_on,
                            'diff_count', v_cnt, 'diff', v_diff, 'ghost_count', v_check->'ghost_count',
                            'missing_count', v_check->'missing_count', 'inapp_sent', v_in);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [G] org_set_person_status — 상태 등록 (기존 활성 상태는 superseded 로 종료)
--     p_payload: start_on · end_on · return_on · departure_on · planned_status_code · note · applicable_template_ids (uuid[])
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_set_person_status(p_profile_id uuid, p_person_id uuid, p_status_code text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_type public.org_status_types%ROWTYPE; v_planned public.org_status_types%ROWTYPE;
  v_start date := (p_payload->>'start_on')::date; v_end date := (p_payload->>'end_on')::date;
  v_return date := (p_payload->>'return_on')::date; v_dep date := (p_payload->>'departure_on')::date;
  v_planned_code text := p_payload->>'planned_status_code'; v_note text := p_payload->>'note';
  v_applicable uuid[]; v_id uuid; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  PERFORM public.org_assert_org();
  IF (p_profile_id IS NULL) = (p_person_id IS NULL) THEN RAISE EXCEPTION 'ORG_STATUS_SUBJECT' USING HINT = 'profile_id 또는 person_id 중 하나만 지정하세요.'; END IF;
  SELECT * INTO v_type FROM public.org_status_types WHERE code = p_status_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_STATUS_UNKNOWN' USING HINT = format('상태 코드 %s 없음', p_status_code); END IF;
  IF p_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN RAISE EXCEPTION 'USER_NOT_FOUND'; END IF;
  IF p_person_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.org_persons WHERE id = p_person_id) THEN RAISE EXCEPTION 'ORG_PERSON_NOT_FOUND'; END IF;

  -- 분류별 필수값·동기화
  CASE v_type.category
    WHEN 'hire_planned' THEN
      IF p_person_id IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_PERSON_REQUIRED' USING HINT = '입사예정은 입사 예정자(org_persons)에만 등록합니다.'; END IF;
      IF v_start IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_START_REQUIRED' USING HINT = '입사일을 지정하세요.'; END IF;
      UPDATE public.org_persons SET planned_start_on = v_start WHERE id = p_person_id;
    WHEN 'departing' THEN
      IF p_profile_id IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_PROFILE_REQUIRED'; END IF;
      IF v_dep IS NULL THEN RAISE EXCEPTION 'DEPARTURE_DATE_REQUIRED' USING HINT = '퇴사 예정일을 지정하세요.'; END IF;
      PERFORM public.employment_status_apply(p_profile_id, 'departing', v_dep);
      v_end := v_dep;
    WHEN 'leave_planned' THEN
      IF v_start IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_START_REQUIRED' USING HINT = '휴직 시작일을 지정하세요.'; END IF;
      SELECT * INTO v_planned FROM public.org_status_types WHERE code = v_planned_code AND category = 'leave' AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'ORG_STATUS_PLANNED_REQUIRED' USING HINT = '예정 휴직 종류(출산휴가/육아휴직/휴직)를 지정하세요.'; END IF;
      -- 아직 근무 중 — profiles 미변경
    WHEN 'leave' THEN
      IF p_profile_id IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_PROFILE_REQUIRED'; END IF;
      IF v_start IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_START_REQUIRED' USING HINT = '휴직 시작일을 지정하세요.'; END IF;
      PERFORM public.employment_status_apply(p_profile_id, 'leave', NULL);
    WHEN 'return_planned' THEN
      IF p_profile_id IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_PROFILE_REQUIRED'; END IF;
      IF v_return IS NULL THEN RAISE EXCEPTION 'ORG_STATUS_RETURN_REQUIRED' USING HINT = '복귀 예정일을 지정하세요.'; END IF;
      PERFORM public.employment_status_apply(p_profile_id, 'leave', NULL);   -- 복귀 전까지는 휴직
  END CASE;

  -- 기존 활성 상태 종료 (superseded)
  UPDATE public.org_person_status SET ended_at = now(), ended_by = v_uid, ended_reason = 'superseded'
   WHERE ended_at IS NULL AND ((p_profile_id IS NOT NULL AND profile_id = p_profile_id) OR (p_person_id IS NOT NULL AND person_id = p_person_id));

  INSERT INTO public.org_person_status (profile_id, person_id, status_code, planned_status_code, start_on, end_on, return_on, note, created_by)
  VALUES (p_profile_id, p_person_id, p_status_code, CASE WHEN v_type.category = 'leave_planned' THEN v_planned_code END, v_start, v_end, v_return, v_note, v_uid)
  RETURNING id INTO v_id;

  -- 퇴사예정: 반납 체크리스트 복제
  IF v_type.category = 'departing' THEN
    SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_applicable FROM jsonb_array_elements_text(COALESCE(p_payload->'applicable_template_ids', '[]'::jsonb)) x;
    INSERT INTO public.org_offboarding_items (status_id, template_id, label, is_critical, applicable, sort_order)
    SELECT v_id, t.id, t.label, t.is_critical, (NOT t.is_conditional) OR (t.id = ANY (v_applicable)), t.sort_order
      FROM public.org_offboarding_templates t WHERE t.is_active ORDER BY t.sort_order;
  END IF;

  RETURN (SELECT to_jsonb(s) FROM public.org_person_status s WHERE s.id = v_id);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [H] org_end_person_status — 상태 종료 (수동). 퇴사예정 철회 → active / 휴직·복직예정 종료 → returned
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_end_person_status(p_status_id uuid, p_reason text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_s public.org_person_status%ROWTYPE; v_cat text;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO v_s FROM public.org_person_status WHERE id = p_status_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_STATUS_NOT_FOUND'; END IF;
  IF v_s.ended_at IS NOT NULL THEN RAISE EXCEPTION 'ORG_STATUS_ALREADY_ENDED'; END IF;
  SELECT category INTO v_cat FROM public.org_status_types WHERE code = v_s.status_code;

  IF v_s.profile_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v_s.profile_id) THEN
    IF v_cat = 'departing' THEN
      PERFORM public.employment_status_apply(v_s.profile_id, 'active', NULL);
    ELSIF v_cat IN ('leave', 'return_planned') THEN
      PERFORM public.employment_status_apply(v_s.profile_id, 'returned', NULL);
    END IF;
  END IF;

  UPDATE public.org_person_status SET ended_at = now(), ended_by = v_uid, ended_reason = COALESCE(p_reason, 'manual') WHERE id = p_status_id;
  RETURN (SELECT to_jsonb(s) FROM public.org_person_status s WHERE s.id = p_status_id);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [I] org_link_planned_person — sync-all-users 후크 (service_role) · 수동 연결(org)
--     이메일 일치 profile 이 생기면: org_persons 연결 → 전 파일 카드 profile_id 백필 → 입사예정 상태 종료
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_link_planned_person(p_email text, p_person_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_person public.org_persons%ROWTYPE; v_profile uuid; v_cards int := 0; v_dropped int := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' AND auth.uid() IS NOT NULL THEN
    PERFORM public.org_assert_org();
  END IF;
  IF p_person_id IS NOT NULL THEN
    SELECT * INTO v_person FROM public.org_persons WHERE id = p_person_id AND linked_profile_id IS NULL;
  ELSE
    SELECT * INTO v_person FROM public.org_persons WHERE email = lower(btrim(p_email)) AND linked_profile_id IS NULL;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('linked', false, 'reason', 'no_unlinked_person'); END IF;
  SELECT id INTO v_profile FROM public.profiles WHERE lower(email) = lower(btrim(COALESCE(p_email, v_person.email)));
  IF v_profile IS NULL THEN RETURN jsonb_build_object('linked', false, 'reason', 'no_profile'); END IF;

  PERFORM set_config('org.lifecycle', 'on', true);   -- Active 파일 카드도 백필 (구조 변경 아님 — 신원 연결)
  -- 같은 파일에 이미 그 profile 카드가 있으면 입사예정 카드는 제거(중복 방지)
  DELETE FROM public.org_cards c WHERE c.person_id = v_person.id
     AND EXISTS (SELECT 1 FROM public.org_cards x WHERE x.file_id = c.file_id AND x.profile_id = v_profile);
  GET DIAGNOSTICS v_dropped = ROW_COUNT;
  UPDATE public.org_cards SET profile_id = v_profile, person_id = NULL, display_name = NULL WHERE person_id = v_person.id;
  GET DIAGNOSTICS v_cards = ROW_COUNT;
  UPDATE public.org_persons SET linked_profile_id = v_profile, linked_at = now() WHERE id = v_person.id;
  UPDATE public.org_person_status SET ended_at = now(), ended_reason = 'linked' WHERE person_id = v_person.id AND ended_at IS NULL;

  RETURN jsonb_build_object('linked', true, 'person_id', v_person.id, 'profile_id', v_profile, 'cards_linked', v_cards, 'cards_dropped', v_dropped);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [J] departed_users INSERT 트리거 — 활성 상태 종결 (카드는 보존)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_on_departed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.org_person_status SET ended_at = now(), ended_reason = 'departed'
   WHERE profile_id = NEW.id AND ended_at IS NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_on_departed ON public.departed_users;
CREATE TRIGGER trg_org_on_departed AFTER INSERT ON public.departed_users
  FOR EACH ROW EXECUTE FUNCTION public.org_on_departed();

-- ────────────────────────────────────────────────────────────────────────────
-- [K] org_daily_transitions — pg_cron KST 00:15
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_daily_transitions()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date; r record; n1 int := 0; n2 int := 0; n3 int := 0;
BEGIN
  -- 1) 휴직예정 → 예정 종류 (시작일 도래) + profiles leave
  FOR r IN SELECT s.* FROM public.org_person_status s JOIN public.org_status_types t ON t.code = s.status_code
            WHERE s.ended_at IS NULL AND t.category = 'leave_planned' AND s.start_on <= v_today AND s.profile_id IS NOT NULL LOOP
    UPDATE public.org_person_status SET ended_at = now(), ended_reason = 'auto' WHERE id = r.id;
    INSERT INTO public.org_person_status (profile_id, status_code, start_on, end_on, return_on, note)
    VALUES (r.profile_id, r.planned_status_code, r.start_on, r.end_on, r.return_on, r.note);
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = r.profile_id) THEN PERFORM public.employment_status_apply(r.profile_id, 'leave', NULL); END IF;
    n1 := n1 + 1;
  END LOOP;
  -- 2) 휴직 → 복직예정 (복귀 예정일 D-30)
  FOR r IN SELECT s.* FROM public.org_person_status s JOIN public.org_status_types t ON t.code = s.status_code
            WHERE s.ended_at IS NULL AND t.category = 'leave' AND s.return_on IS NOT NULL AND s.return_on <= v_today + 30 AND s.profile_id IS NOT NULL LOOP
    UPDATE public.org_person_status SET ended_at = now(), ended_reason = 'auto' WHERE id = r.id;
    INSERT INTO public.org_person_status (profile_id, status_code, start_on, end_on, return_on, note)
    VALUES (r.profile_id, 'return_planned', r.start_on, r.end_on, r.return_on, r.note);
    n2 := n2 + 1;
  END LOOP;
  -- 3) 복직예정 → 복직 (복귀일 도래) + profiles returned (30일 라벨 소멸은 기존 cron)
  FOR r IN SELECT s.* FROM public.org_person_status s JOIN public.org_status_types t ON t.code = s.status_code
            WHERE s.ended_at IS NULL AND t.category = 'return_planned' AND s.return_on <= v_today AND s.profile_id IS NOT NULL LOOP
    UPDATE public.org_person_status SET ended_at = now(), ended_reason = 'auto' WHERE id = r.id;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = r.profile_id) THEN PERFORM public.employment_status_apply(r.profile_id, 'returned', NULL); END IF;
    n3 := n3 + 1;
  END LOOP;
  RETURN jsonb_build_object('date', v_today, 'leave_started', n1, 'return_planned', n2, 'returned', n3);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'org-daily-transitions-0015kst';
    PERFORM cron.schedule('org-daily-transitions-0015kst', '15 15 * * *', $c$SELECT public.org_daily_transitions()$c$);   -- UTC 15:15 = KST 00:15
    RAISE NOTICE '[K] pg_cron org-daily-transitions-0015kst 등록';
  ELSE
    RAISE NOTICE '[K] pg_cron 없음 — 로컬 시뮬 환경. 운영에서는 자동 등록됨';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [M] 권한 · 검증
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.employment_status_apply(uuid,text,date)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.org_assert_org()                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_assert_super()                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_acquire_lock(uuid,boolean)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_release_lock(uuid)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_roster_check(uuid)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_copy_file(uuid,text,date)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_activate_file(uuid,boolean)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_set_person_status(uuid,uuid,text,jsonb)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_end_person_status(uuid,text)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_link_planned_person(text,uuid)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_daily_transitions()                            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.employment_status_apply(uuid,text,date)         TO service_role;
GRANT EXECUTE ON FUNCTION public.org_assert_org(), public.org_assert_super()     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_acquire_lock(uuid,boolean), public.org_release_lock(uuid), public.org_roster_check(uuid),
                         public.org_copy_file(uuid,text,date), public.org_activate_file(uuid,boolean),
                         public.org_set_person_status(uuid,uuid,text,jsonb), public.org_end_person_status(uuid,text),
                         public.org_link_planned_person(text,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_daily_transitions() TO service_role;

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('employment_status_apply','org_assert_org','org_assert_super','org_acquire_lock','org_release_lock',
         'org_roster_check','org_copy_file','org_activate_file','org_set_person_status','org_end_person_status','org_link_planned_person','org_on_departed','org_daily_transitions');
  IF v_cnt <> 13 THEN RAISE EXCEPTION '[검증] 함수 수 % (기대 13)', v_cnt; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'admin_set_employment_status') NOT LIKE '%employment_status_apply%' THEN
    RAISE EXCEPTION '[검증] admin_set_employment_status 분리 미반영';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'notification_required_roles') NOT LIKE '%org\_%' THEN
    RAISE EXCEPTION '[검증] notification_required_roles 에 org 미반영';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_org_on_departed') THEN RAISE EXCEPTION '[검증] departed 트리거 없음'; END IF;
  IF has_function_privilege('authenticated', 'public.employment_status_apply(uuid,text,date)', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] authenticated 가 employment_status_apply 실행 가능';
  END IF;
  IF has_function_privilege('authenticated', 'public.org_daily_transitions()', 'EXECUTE') THEN
    RAISE EXCEPTION '[검증] authenticated 가 org_daily_transitions 실행 가능';
  END IF;
  RAISE NOTICE '[검증] ORG Phase 2 전 항목 통과';
END $$;

COMMIT;
