-- ============================================================================
-- 20261015_org_phase8b.sql
-- 조직도(ORG) Phase 8-B — ② 단위 바인드 (설계서 §15.4 B1·B2·B3, §15.5 W2, 2026-10-02 확정)
--
-- 전제: 20261014_org_phase8a.sql 적용 완료
-- 범위
--   [A] org_units.prev_unit_id — 승계 바인드: 이 단위가 이어받는 '기준 조직도(보통 활성)' 의 단위. 같은 파일 단위는 금지. 기준 단위 삭제 시 NULL
--       org_units.bind_checked_at — 담당자가 바인드 행을 확인한 시각(확인 필요 → 확인됨). 작업대는 둘 다 NULL 고정
--   [B] org_bind_suggest(p_file_id, p_base_file_id) — 자동 매칭 제안(읽기): 약칭(code) 일치 → 이름 경로 일치 → 이름 유일 일치 순.
--       기준 단위 하나가 두 단위에 제안되지 않게 우선순위로 1:1. + Azure 부서 제안(단위 하위 인원 profiles.dept 최빈값) + 단위장 포지션 제안(현재/기준 단위장 카드의 대표 직무)
--   [C] org_bind_apply(p_file_id, p_items jsonb[{unit_id, prev_unit_id?, azure_division?, head_job_id?, checked?}]) — 묶음 저장 한 트랜잭션(되돌리기 1단계). 키가 있는 필드만 갱신(null 허용)
--   [D] org_copy_file — 복사본 단위는 원본 단위를 prev_unit_id 로 자동 승계(활성 조직도 복사 = 전부 자동 바인드)
--   [E] org_undo_last — 단위 update 복원에 prev_unit_id·bind_checked_at 포함
-- ============================================================================

BEGIN;

-- [A] 컬럼
ALTER TABLE public.org_units
  ADD COLUMN IF NOT EXISTS prev_unit_id    uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bind_checked_at timestamptz;
CREATE INDEX IF NOT EXISTS org_units_prev ON public.org_units (prev_unit_id);
COMMENT ON COLUMN public.org_units.prev_unit_id    IS '[ORG 8-B] 승계 바인드 — 기준(이전) 조직도의 단위. 같은 파일 금지. 인원 배치 자동 제안·버전 비교 기준';
COMMENT ON COLUMN public.org_units.bind_checked_at IS '[ORG 8-B] 바인드 행 확인 시각(담당자). NULL = 미확인';

-- [A-2] 가드 (8-A 원문 + prev_unit_id 같은 파일 금지 · 작업대 NULL)
CREATE OR REPLACE FUNCTION public.org_units_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent_file uuid; v_cur uuid; v_depth int := 0; v_prev_file uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = OLD.file_id) THEN RETURN OLD; END IF;
    IF NOT public.org_file_is_editable(OLD.file_id) AND NOT public.org_lifecycle_on() THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
    END IF;
    IF OLD.kind = 'bench' THEN RAISE EXCEPTION 'ORG_BENCH_PROTECTED' USING HINT = '작업대는 삭제할 수 없습니다.'; END IF;
    IF EXISTS (SELECT 1 FROM public.org_units WHERE parent_unit_id = OLD.id) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_CHILDREN' USING HINT = '하위 단위가 있는 단위는 삭제할 수 없습니다.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.org_cards WHERE unit_id = OLD.id) THEN
      RAISE EXCEPTION 'ORG_UNIT_HAS_CARDS' USING HINT = '카드가 남아 있는 단위는 삭제할 수 없습니다. 카드를 먼저 옮기세요.';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT public.org_file_is_editable(NEW.file_id) AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.file_id <> NEW.file_id THEN
    RAISE EXCEPTION 'ORG_UNIT_FILE_IMMUTABLE';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.kind <> NEW.kind THEN
    RAISE EXCEPTION 'ORG_BENCH_PROTECTED' USING HINT = '단위 종류(작업대)는 바꿀 수 없습니다.';
  END IF;
  IF NEW.kind = 'bench' THEN
    NEW.name := '작업대'; NEW.code := NULL; NEW.parent_unit_id := NULL; NEW.head_card_id := NULL; NEW.azure_division := NULL;
    NEW.unit_type := NULL; NEW.head_job_id := NULL; NEW.memo := NULL;
    NEW.prev_unit_id := NULL; NEW.bind_checked_at := NULL;   -- [8-B]
  END IF;
  IF NEW.unit_type IS NOT NULL AND length(btrim(NEW.unit_type)) = 0 THEN NEW.unit_type := NULL; END IF;
  IF NEW.azure_division IS NOT NULL AND length(btrim(NEW.azure_division)) = 0 THEN NEW.azure_division := NULL; END IF;   -- [8-B] 빈 문자열 → NULL
  IF NEW.prev_unit_id IS NOT NULL THEN   -- [8-B] 승계 단위는 다른 파일의 조직 단위여야
    SELECT file_id INTO v_prev_file FROM public.org_units WHERE id = NEW.prev_unit_id AND kind = 'unit';
    IF v_prev_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING HINT = '승계할 단위를 찾을 수 없습니다.'; END IF;
    IF v_prev_file = NEW.file_id THEN RAISE EXCEPTION 'ORG_BIND_SAME_FILE' USING HINT = '같은 조직도 안의 단위를 승계할 수는 없습니다.'; END IF;
  END IF;
  IF NEW.parent_unit_id IS NOT NULL THEN
    IF NEW.parent_unit_id = NEW.id THEN
      RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '자기 자신을 상위 단위로 둘 수 없습니다.';
    END IF;
    SELECT file_id INTO v_parent_file FROM public.org_units WHERE id = NEW.parent_unit_id;
    IF v_parent_file IS NULL OR v_parent_file <> NEW.file_id THEN
      RAISE EXCEPTION 'ORG_UNIT_PARENT_OTHER_FILE' USING HINT = '상위 단위는 같은 조직도 파일 안에 있어야 합니다.';
    END IF;
    v_cur := NEW.parent_unit_id;
    WHILE v_cur IS NOT NULL LOOP
      v_depth := v_depth + 1;
      IF v_depth > 64 THEN RAISE EXCEPTION 'ORG_UNIT_DEPTH_EXCEEDED'; END IF;
      SELECT parent_unit_id INTO v_cur FROM public.org_units WHERE id = v_cur;
      IF v_cur = NEW.id THEN
        RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '하위 단위 아래로 이동할 수 없습니다(순환).';
      END IF;
    END LOOP;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- [B] 자동 매칭 제안 (읽기 전용)
CREATE OR REPLACE FUNCTION public.org_bind_suggest(p_file_id uuid, p_base_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.org_assert_org();
  IF p_base_file_id IS NULL OR p_base_file_id = p_file_id THEN RAISE EXCEPTION 'ORG_BIND_SAME_FILE' USING HINT = '기준 조직도는 다른 파일이어야 합니다.'; END IF;
  WITH RECURSIVE
  nu AS (   -- 새 파일 단위 + 이름 경로 (루트·연결 안 된 단위에서 시작)
    SELECT u.id, u.parent_unit_id, u.name, u.code, u.prev_unit_id, u.head_card_id, ARRAY[u.name] AS path, u.sort_order
      FROM public.org_units u LEFT JOIN public.org_units pu ON pu.id = u.parent_unit_id
     WHERE u.file_id = p_file_id AND u.kind = 'unit' AND (u.parent_unit_id IS NULL OR pu.kind = 'bench')
    UNION ALL
    SELECT u.id, u.parent_unit_id, u.name, u.code, u.prev_unit_id, u.head_card_id, nu.path || u.name, u.sort_order
      FROM public.org_units u JOIN nu ON u.parent_unit_id = nu.id WHERE u.kind = 'unit'
  ),
  bu AS (   -- 기준 파일 단위 + 이름 경로
    SELECT u.id, u.name, u.code, ARRAY[u.name] AS path
      FROM public.org_units u LEFT JOIN public.org_units pu ON pu.id = u.parent_unit_id
     WHERE u.file_id = p_base_file_id AND u.kind = 'unit' AND (u.parent_unit_id IS NULL OR pu.kind = 'bench')
    UNION ALL
    SELECT u.id, u.name, u.code, bu.path || u.name FROM public.org_units u JOIN bu ON u.parent_unit_id = bu.id WHERE u.kind = 'unit'
  ),
  cand AS (
    SELECT nu.id AS unit_id, bu.id AS prev_id, 1 AS pri, 'code' AS method FROM nu JOIN bu ON bu.code IS NOT NULL AND nu.code IS NOT NULL AND bu.code = nu.code
    UNION ALL SELECT nu.id, bu.id, 2, 'path' FROM nu JOIN bu ON bu.path = nu.path
    UNION ALL SELECT nu.id, bu.id, 3, 'name' FROM nu JOIN bu ON bu.name = nu.name
                 WHERE (SELECT count(*) FROM bu b2 WHERE b2.name = nu.name) = 1 AND (SELECT count(*) FROM nu n2 WHERE n2.name = nu.name) = 1
  ),
  best AS (SELECT DISTINCT ON (unit_id) unit_id, prev_id, pri, method FROM cand ORDER BY unit_id, pri),
  best1 AS (SELECT DISTINCT ON (prev_id) unit_id, prev_id, method FROM best ORDER BY prev_id, pri, unit_id),   -- 기준 단위 1개 → 새 단위 1개
  sub AS (   -- 새 파일·기준 파일 단위별 하위 포함 노드 (Azure 부서 최빈값: 새 파일에 카드가 없으면 기준 단위 하위로 대체)
    SELECT u.id AS root, u.id AS node FROM public.org_units u WHERE u.file_id IN (p_file_id, p_base_file_id) AND u.kind = 'unit'
    UNION ALL SELECT s.root, c.id FROM sub s JOIN public.org_units c ON c.parent_unit_id = s.node
  ),
  dept_mode AS (
    SELECT s.root AS unit_id, mode() WITHIN GROUP (ORDER BY p.dept) AS dept, count(*) AS n
      FROM sub s JOIN public.org_cards c ON c.unit_id = s.node AND c.is_primary AND NOT c.is_vacancy AND c.hidden_at IS NULL
      JOIN public.profiles p ON p.id = c.profile_id AND p.dept IS NOT NULL AND btrim(p.dept) <> ''
     GROUP BY s.root
  ),
  head_job AS (
    SELECT u.id AS unit_id, j.job_id FROM public.org_units u JOIN public.org_card_jobs j ON j.card_id = u.head_card_id AND j.is_primary
     WHERE u.file_id IN (p_file_id, p_base_file_id)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'unit_id', nu.id, 'prev_unit_id', b.prev_id, 'method', b.method,
           'suggested_division', COALESCE(dm.dept, dmp.dept), 'division_n', COALESCE(dm.n, dmp.n, 0),
           'suggested_head_job_id', COALESCE(hj_own.job_id, hj_prev.job_id)) ORDER BY nu.path), '[]'::jsonb)
    INTO v_out
    FROM nu LEFT JOIN best1 b ON b.unit_id = nu.id
    LEFT JOIN dept_mode dm ON dm.unit_id = nu.id
    LEFT JOIN dept_mode dmp ON dmp.unit_id = COALESCE(nu.prev_unit_id, b.prev_id)
    LEFT JOIN head_job hj_own ON hj_own.unit_id = nu.id
    LEFT JOIN head_job hj_prev ON hj_prev.unit_id = b.prev_id;
  RETURN v_out;
END $$;

-- [C] 묶음 저장 (한 트랜잭션)
CREATE OR REPLACE FUNCTION public.org_bind_apply(p_file_id uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE it jsonb; v_n int := 0; v_prev uuid; v_prev_file uuid; v_unit uuid;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT public.org_file_is_editable(p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'ORG_BIND_INVALID' USING HINT = '항목 배열이 필요합니다.'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_unit := (it->>'unit_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.org_units WHERE id = v_unit AND file_id = p_file_id AND kind = 'unit') THEN
      RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING HINT = '이 조직도의 단위가 아닙니다.';
    END IF;
    IF it ? 'prev_unit_id' AND it->>'prev_unit_id' IS NOT NULL THEN
      v_prev := (it->>'prev_unit_id')::uuid;
      SELECT file_id INTO v_prev_file FROM public.org_units WHERE id = v_prev AND kind = 'unit';
      IF v_prev_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING HINT = '승계할 단위를 찾을 수 없습니다.'; END IF;
      IF v_prev_file = p_file_id THEN RAISE EXCEPTION 'ORG_BIND_SAME_FILE' USING HINT = '같은 조직도 안의 단위를 승계할 수는 없습니다.'; END IF;
    END IF;
    UPDATE public.org_units u SET
      prev_unit_id    = CASE WHEN it ? 'prev_unit_id'   THEN (it->>'prev_unit_id')::uuid ELSE u.prev_unit_id END,
      azure_division  = CASE WHEN it ? 'azure_division' THEN NULLIF(btrim(it->>'azure_division'), '') ELSE u.azure_division END,
      head_job_id     = CASE WHEN it ? 'head_job_id'    THEN (it->>'head_job_id')::uuid ELSE u.head_job_id END,
      bind_checked_at = CASE WHEN it ? 'checked'        THEN (CASE WHEN (it->>'checked')::boolean THEN now() ELSE NULL END) ELSE u.bind_checked_at END
     WHERE u.id = v_unit
       AND (   (it ? 'prev_unit_id'   AND u.prev_unit_id IS DISTINCT FROM (it->>'prev_unit_id')::uuid)
            OR (it ? 'azure_division' AND u.azure_division IS DISTINCT FROM NULLIF(btrim(it->>'azure_division'), ''))
            OR (it ? 'head_job_id'    AND u.head_job_id IS DISTINCT FROM (it->>'head_job_id')::uuid)
            OR (it ? 'checked'        AND (u.bind_checked_at IS NOT NULL) IS DISTINCT FROM (it->>'checked')::boolean));
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('updated', v_n);
END $$;

-- [D] org_copy_file — 8-A 원문 + 복사본 단위는 원본 단위를 승계(prev_unit_id = 원본 id)
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

  CREATE TEMP TABLE IF NOT EXISTS _org_map (kind text, old_id uuid, new_id uuid, PRIMARY KEY (kind, old_id)) ON COMMIT DROP;
  TRUNCATE _org_map;
  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'unit', id, gen_random_uuid() FROM public.org_units WHERE file_id = p_source_file_id;
  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'card', id, gen_random_uuid() FROM public.org_cards WHERE file_id = p_source_file_id;

  INSERT INTO public.org_units (id, file_id, parent_unit_id, name, code, azure_division, head_card_id, sort_order, kind, unit_type, head_job_id, memo, prev_unit_id)
  SELECT m.new_id, v_new, NULL, u.name, u.code, u.azure_division, NULL, u.sort_order, u.kind, u.unit_type, u.head_job_id, u.memo,
         CASE WHEN u.kind = 'unit' THEN u.id END   -- [8-B] 원본 단위 승계
    FROM public.org_units u JOIN _org_map m ON m.kind = 'unit' AND m.old_id = u.id
   WHERE u.file_id = p_source_file_id;
  UPDATE public.org_units nu
     SET parent_unit_id = pm.new_id
    FROM public.org_units ou JOIN _org_map m ON m.kind = 'unit' AND m.old_id = ou.id
    JOIN _org_map pm ON pm.kind = 'unit' AND pm.old_id = ou.parent_unit_id
   WHERE nu.id = m.new_id AND ou.file_id = p_source_file_id;
  GET DIAGNOSTICS v_units = ROW_COUNT;

  PERFORM set_config('org.lifecycle', 'on', true);
  INSERT INTO public.org_cards (id, file_id, unit_id, profile_id, person_id, display_name, rank_id, reports_to_card_id,
                                is_unit_head, is_vacancy, employment_type, work_location, fte, memo, sort_order, is_primary, hidden_at)
  SELECT m.new_id, v_new, um.new_id, c.profile_id, c.person_id, c.display_name, c.rank_id, NULL,
         c.is_unit_head, c.is_vacancy, c.employment_type, c.work_location, c.fte, c.memo, c.sort_order, c.is_primary, c.hidden_at
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

  INSERT INTO public.org_card_jobs (card_id, job_id, is_primary, sort_order)
  SELECT m.new_id, j.job_id, j.is_primary, j.sort_order
    FROM public.org_card_jobs j JOIN _org_map m ON m.kind = 'card' AND m.old_id = j.card_id;

  INSERT INTO public.org_unit_layout (file_id, unit_id, x, y, updated_by)
  SELECT v_new, m.new_id, l.x, l.y, v_uid
    FROM public.org_unit_layout l JOIN _org_map m ON m.kind = 'unit' AND m.old_id = l.unit_id
   WHERE l.file_id = p_source_file_id;

  v_check := public.org_roster_check(v_new);
  RETURN jsonb_build_object('file_id', v_new, 'parent_file_id', p_source_file_id,
                            'units', (SELECT count(*) FROM public.org_units WHERE file_id = v_new AND kind = 'unit'),
                            'cards', v_cards,
                            'missing_count', v_check->'missing_count', 'ghost_count', v_check->'ghost_count');
END $$;

-- [E] org_undo_last — 단위 update 복원에 prev_unit_id·bind_checked_at 포함 (8-A 원문 + 2컬럼)
CREATE OR REPLACE FUNCTION public.org_undo_last(p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record; r record; v_n int := 0; v_row jsonb;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT public.org_file_is_editable(p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  SELECT * INTO g FROM public.org_undo_group(p_file_id);
  IF g.at IS NULL THEN RAISE EXCEPTION 'ORG_UNDO_NOTHING' USING HINT = '되돌릴 내 변경이 없습니다.'; END IF;
  IF g.conflict THEN RAISE EXCEPTION 'ORG_UNDO_CONFLICT' USING HINT = '그 뒤에 다른 사용자의 변경이 있어 되돌릴 수 없습니다.'; END IF;
  PERFORM set_config('org.lifecycle', 'on', true);
  FOR r IN
    SELECT l.* FROM public.org_undo_rows(p_file_id, g.at) l
     ORDER BY CASE l.action WHEN 'delete' THEN 0 WHEN 'update' THEN 1 ELSE 2 END,
              CASE WHEN l.action = 'insert' THEN -1 ELSE 1 END * (CASE l.target_table WHEN 'org_units' THEN 0 WHEN 'org_cards' THEN 1 ELSE 2 END),
              l.id DESC
  LOOP
    IF r.action = 'insert' THEN
      IF r.target_table = 'org_card_jobs' THEN DELETE FROM public.org_card_jobs WHERE card_id = (r.after->>'card_id')::uuid AND job_id = (r.after->>'job_id')::uuid;
      ELSE EXECUTE format('DELETE FROM public.%I WHERE id = $1', r.target_table) USING r.target_id::uuid; END IF;
    ELSIF r.action = 'delete' THEN
      v_row := r.before;
      IF r.target_table = 'org_units' AND NOT (v_row ? 'kind') THEN v_row := v_row || '{"kind":"unit"}'; END IF;
      IF r.target_table = 'org_cards' AND NOT (v_row ? 'is_primary') THEN v_row := v_row || '{"is_primary":true}'; END IF;
      EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)', r.target_table, r.target_table) USING v_row;
    ELSE
      IF r.target_table = 'org_card_jobs' THEN
        UPDATE public.org_card_jobs j SET is_primary = (r.before->>'is_primary')::boolean, sort_order = (r.before->>'sort_order')::int
         WHERE j.card_id = (r.before->>'card_id')::uuid AND j.job_id = (r.before->>'job_id')::uuid;
      ELSIF r.target_table = 'org_units' THEN
        UPDATE public.org_units u SET (parent_unit_id, name, code, azure_division, head_card_id, sort_order, unit_type, head_job_id, memo, prev_unit_id, bind_checked_at) =
          ((r.before->>'parent_unit_id')::uuid, r.before->>'name', r.before->>'code', r.before->>'azure_division', (r.before->>'head_card_id')::uuid, (r.before->>'sort_order')::int,
           r.before->>'unit_type', (r.before->>'head_job_id')::uuid, r.before->>'memo', (r.before->>'prev_unit_id')::uuid, (r.before->>'bind_checked_at')::timestamptz)   -- [8-B]
         WHERE u.id = r.target_id::uuid;
      ELSE
        UPDATE public.org_cards c SET (unit_id, profile_id, person_id, display_name, rank_id, reports_to_card_id, is_unit_head, is_vacancy, employment_type, work_location, fte, memo, sort_order, is_primary, hidden_at) =
          ((r.before->>'unit_id')::uuid, (r.before->>'profile_id')::uuid, (r.before->>'person_id')::uuid, r.before->>'display_name', (r.before->>'rank_id')::uuid, (r.before->>'reports_to_card_id')::uuid,
           (r.before->>'is_unit_head')::boolean, (r.before->>'is_vacancy')::boolean, r.before->>'employment_type', r.before->>'work_location', (r.before->>'fte')::numeric, r.before->>'memo',
           (r.before->>'sort_order')::int, COALESCE((r.before->>'is_primary')::boolean, true), (r.before->>'hidden_at')::timestamptz)
         WHERE c.id = r.target_id::uuid;
      END IF;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('reverted', v_n, 'at', g.at);
END $$;

-- 권한
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['org_bind_suggest(uuid, uuid)', 'org_bind_apply(uuid, jsonb)', 'org_copy_file(uuid, text, date)', 'org_undo_last(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 자기검증
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_units' AND column_name IN ('prev_unit_id','bind_checked_at')) <> 2 THEN RAISE EXCEPTION '[8-B] 컬럼 누락'; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('org_bind_suggest','org_bind_apply')) <> 2 THEN RAISE EXCEPTION '[8-B] RPC 누락'; END IF;
  RAISE NOTICE '[8-B] OK — org_units +2 컬럼, org_bind_suggest/apply, copy/undo 갱신';
END $$;

COMMIT;
