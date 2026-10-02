-- ============================================================================
-- 20261016_org_phase8c.sql
-- 조직도(ORG) Phase 8-C — ③ 인원 배치 (설계서 §15.5 W3, 2026-10-02 확정)
--
-- 전제: 20261015_org_phase8b.sql 적용 완료
-- 범위
--   [A] org_place_suggest(p_file_id, p_base_file_id) — 자동 배치 제안(읽기). 대상 = 이 파일에 카드가 없는 재직 프로필 + 보류 카드 + 기준 파일에만 있는 입사예정자(org_persons).
--       근거 1 'prev': 기준 조직도에서 그 사람이 속한 단위를 승계(prev_unit_id)한 새 단위  2 'dept': profiles.dept 와 같은 Azure 부서를 가진 새 단위가 정확히 1개
--   [B] org_place_cards(p_file_id, p_items jsonb[{unit_id, profile_id?|person_id?|card_id?}]) — 일괄 배치 한 트랜잭션(되돌리기 1단계).
--       profile/person → 카드 생성(본 카드, 단위 끝) · card_id → 이동(org_move_cards 와 같은 규칙: 단위장·보고선 해제). 같은 사람 중복은 이름을 들어 거부
-- ============================================================================

BEGIN;

-- [A] 자동 배치 제안
CREATE OR REPLACE FUNCTION public.org_place_suggest(p_file_id uuid, p_base_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_FOUND'; END IF;
  WITH
  nu AS (SELECT id, prev_unit_id, azure_division, name FROM public.org_units WHERE file_id = p_file_id AND kind = 'unit'),
  -- 기준 파일 단위 → 승계한 새 단위(여럿이면 sort_order 가장 앞)
  inherit AS (
    SELECT DISTINCT ON (u.prev_unit_id) u.prev_unit_id AS base_unit_id, u.id AS unit_id, u.name
      FROM public.org_units u WHERE u.file_id = p_file_id AND u.kind = 'unit' AND u.prev_unit_id IS NOT NULL
     ORDER BY u.prev_unit_id, u.sort_order, u.name
  ),
  -- Azure 부서가 정확히 1개 단위에만 지정된 경우만 부서 매칭
  dept_unit AS (
    SELECT lower(btrim(azure_division)) AS dept, min(id::text)::uuid AS unit_id, min(name) AS name
      FROM nu WHERE azure_division IS NOT NULL GROUP BY lower(btrim(azure_division)) HAVING count(*) = 1
  ),
  -- 대상 1: 이 파일에 카드가 없는 재직 프로필
  pool_profiles AS (
    SELECT p.id AS profile_id, NULL::uuid AS person_id, NULL::uuid AS card_id, p.name, p.dept
      FROM public.profiles p
     WHERE p.employee_id IS NOT NULL AND p.employee_id <> ''
       AND NOT EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_file_id AND c.profile_id = p.id)
       AND NOT (p.employment_status = 'departing' AND p.departure_scheduled_on IS NOT NULL AND p.departure_scheduled_on <= v_today)
  ),
  -- 대상 2: 보류 카드(작업대) — 프로필 또는 입사예정자
  pool_bench AS (
    SELECT c.profile_id, c.person_id, c.id AS card_id, COALESCE(p.name, pe.name, c.display_name) AS name, p.dept
      FROM public.org_cards c JOIN public.org_units b ON b.id = c.unit_id AND b.kind = 'bench'
      LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
     WHERE c.file_id = p_file_id AND NOT c.is_vacancy AND c.hidden_at IS NULL
  ),
  -- 대상 3: 기준 파일에 카드가 있는 입사예정자(미연결) 중 이 파일에 없는 사람
  pool_persons AS (
    SELECT NULL::uuid AS profile_id, pe.id AS person_id, NULL::uuid AS card_id, pe.name, NULL::text AS dept
      FROM public.org_persons pe
     WHERE pe.linked_profile_id IS NULL AND p_base_file_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_base_file_id AND c.person_id = pe.id)
       AND NOT EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_file_id AND c.person_id = pe.id)
  ),
  pool AS (SELECT * FROM pool_profiles UNION ALL SELECT * FROM pool_bench UNION ALL SELECT * FROM pool_persons),
  -- 근거 1: 기준 파일의 본 카드 단위 → 승계 단위
  prev AS (
    SELECT po.profile_id, po.person_id, po.card_id, i.unit_id, i.name AS unit_name, bu.name AS base_unit_name
      FROM pool po
      JOIN public.org_cards bc ON bc.file_id = p_base_file_id AND bc.is_primary AND bc.hidden_at IS NULL
       AND ((po.profile_id IS NOT NULL AND bc.profile_id = po.profile_id) OR (po.person_id IS NOT NULL AND bc.person_id = po.person_id))
      JOIN public.org_units bu ON bu.id = bc.unit_id AND bu.kind = 'unit'
      JOIN inherit i ON i.base_unit_id = bu.id
     WHERE p_base_file_id IS NOT NULL
  ),
  -- 근거 2: Azure 부서 유일 매칭
  dept AS (
    SELECT po.profile_id, po.person_id, po.card_id, d.unit_id, d.name AS unit_name
      FROM pool po JOIN dept_unit d ON po.dept IS NOT NULL AND lower(btrim(po.dept)) = d.dept
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'profile_id', po.profile_id, 'person_id', po.person_id, 'card_id', po.card_id, 'name', po.name,
           'unit_id', COALESCE(pv.unit_id, dp.unit_id), 'unit_name', COALESCE(pv.unit_name, dp.unit_name),
           'reason', CASE WHEN pv.unit_id IS NOT NULL THEN 'prev' WHEN dp.unit_id IS NOT NULL THEN 'dept' END,
           'base_unit_name', pv.base_unit_name, 'dept', po.dept) ORDER BY po.name), '[]'::jsonb)
    INTO v_out
    FROM pool po
    LEFT JOIN prev pv ON pv.profile_id IS NOT DISTINCT FROM po.profile_id AND pv.person_id IS NOT DISTINCT FROM po.person_id AND pv.card_id IS NOT DISTINCT FROM po.card_id
    LEFT JOIN dept dp ON dp.profile_id IS NOT DISTINCT FROM po.profile_id AND dp.person_id IS NOT DISTINCT FROM po.person_id AND dp.card_id IS NOT DISTINCT FROM po.card_id;
  RETURN v_out;
END $$;

-- [B] 일괄 배치 — 카드 생성 + 보류 카드 이동 (한 트랜잭션)
CREATE OR REPLACE FUNCTION public.org_place_cards(p_file_id uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; v_unit uuid; v_card uuid; v_prof uuid; v_pers uuid; v_ins int := 0; v_mov int := 0; v_dup text; v_so int;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT public.org_file_is_editable(p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'ORG_PLACE_INVALID' USING HINT = '항목 배열이 필요합니다.'; END IF;
  -- 사전 검사: 같은 사람이 이 파일에 이미 있으면(생성) / 대상 단위에 이미 있으면(이동) 이름을 들어 거부
  SELECT string_agg(DISTINCT COALESCE(p.name, pe.name, '?'), ', ') INTO v_dup
    FROM jsonb_array_elements(p_items) i
    LEFT JOIN public.profiles p ON p.id = (i->>'profile_id')::uuid LEFT JOIN public.org_persons pe ON pe.id = (i->>'person_id')::uuid
   WHERE i->>'card_id' IS NULL AND EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_file_id
            AND ((i->>'profile_id' IS NOT NULL AND c.profile_id = (i->>'profile_id')::uuid) OR (i->>'person_id' IS NOT NULL AND c.person_id = (i->>'person_id')::uuid)));
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'ORG_MOVE_DUPLICATE_PERSON' USING HINT = format('이 조직도에 이미 카드가 있는 사람: %s', v_dup); END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_unit := (it->>'unit_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_unit AND file_id = p_file_id) THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING HINT = '이 조직도의 단위가 아닙니다.'; END IF;
    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_so FROM public.org_cards WHERE unit_id = v_unit;
    IF it->>'card_id' IS NOT NULL THEN
      v_card := (it->>'card_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.org_cards WHERE id = v_card AND file_id = p_file_id) THEN RAISE EXCEPTION 'ORG_CARD_UNIT_OTHER_FILE' USING HINT = '카드는 같은 조직도의 단위에만 배치할 수 있습니다.'; END IF;
      SELECT string_agg(COALESCE(p.name, pe.name, a.display_name, '?'), ', ') INTO v_dup
        FROM public.org_cards a JOIN public.org_cards b ON b.unit_id = v_unit AND b.id <> a.id
         AND ((a.profile_id IS NOT NULL AND a.profile_id = b.profile_id) OR (a.person_id IS NOT NULL AND a.person_id = b.person_id))
        LEFT JOIN public.profiles p ON p.id = a.profile_id LEFT JOIN public.org_persons pe ON pe.id = a.person_id
       WHERE a.id = v_card;
      IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'ORG_MOVE_DUPLICATE_PERSON' USING HINT = format('대상 단위에 이미 있는 사람: %s', v_dup); END IF;
      UPDATE public.org_cards SET unit_id = v_unit, sort_order = v_so, is_unit_head = false, reports_to_card_id = NULL WHERE id = v_card AND unit_id <> v_unit;
      IF FOUND THEN
        v_mov := v_mov + 1;
        UPDATE public.org_units u SET head_card_id = NULL WHERE u.file_id = p_file_id AND u.id <> v_unit AND u.head_card_id = v_card;
      END IF;
    ELSE
      v_prof := (it->>'profile_id')::uuid; v_pers := (it->>'person_id')::uuid;
      IF v_prof IS NULL AND v_pers IS NULL THEN RAISE EXCEPTION 'ORG_PLACE_INVALID' USING HINT = 'profile_id · person_id · card_id 중 하나가 필요합니다.'; END IF;
      INSERT INTO public.org_cards (file_id, unit_id, profile_id, person_id, is_primary, sort_order)
      VALUES (p_file_id, v_unit, v_prof, v_pers, true, v_so);
      v_ins := v_ins + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('inserted', v_ins, 'moved', v_mov);
END $$;

-- 권한
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['org_place_suggest(uuid, uuid)', 'org_place_cards(uuid, jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('org_place_suggest','org_place_cards')) <> 2 THEN RAISE EXCEPTION '[8-C] RPC 누락'; END IF;
  RAISE NOTICE '[8-C] OK — org_place_suggest / org_place_cards';
END $$;

COMMIT;
