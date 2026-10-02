-- ============================================================================
-- _org_8a_remaining_sqleditor_20261002.sql — Supabase SQL Editor 에 통째로 붙여 넣고 Run (1회, 재실행 안전)
-- MCP 는 함수 본문의 DELETE/TRUNCATE/DROP 토큰을 차단해서 이 4건만 남음. 나머지 8-A(컬럼·org_place_unit·org_duplicate_unit·가드·권한)는 적용 완료.
--   1) org_delete_unit  2) org_copy_file(유형·포지션·메모 복사)  3) org_undo_last(새 컬럼 복원)  4) 엑셀 재이관 stage 테이블 삭제
-- ============================================================================
BEGIN;

-- [C] 단위 삭제 — 카드는 보류로 (한 트랜잭션)
CREATE OR REPLACE FUNCTION public.org_delete_unit(p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid; v_kind text; v_name text; v_bench uuid; v_cards int := 0; v_base int; v_dup text;
BEGIN
  PERFORM public.org_assert_org();
  SELECT file_id, kind, name INTO v_file, v_kind, v_name FROM public.org_units WHERE id = p_unit_id;
  IF v_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
  IF v_kind <> 'unit' THEN RAISE EXCEPTION 'ORG_BENCH_PROTECTED' USING HINT = '보류 영역은 삭제할 수 없습니다.'; END IF;
  IF NOT public.org_file_is_editable(v_file) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.org_units WHERE parent_unit_id = p_unit_id) THEN
    RAISE EXCEPTION 'ORG_UNIT_HAS_CHILDREN' USING HINT = '하위 단위가 있는 단위는 삭제할 수 없습니다. 하위를 먼저 옮기거나 합치세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_cards WHERE unit_id = p_unit_id) THEN
    v_bench := public.org_ensure_bench(v_file);
    SELECT string_agg(COALESCE(p.name, pe.name, a.display_name, '?'), ', ') INTO v_dup
      FROM public.org_cards a JOIN public.org_cards b ON b.unit_id = v_bench
       AND ((a.profile_id IS NOT NULL AND a.profile_id = b.profile_id) OR (a.person_id IS NOT NULL AND a.person_id = b.person_id))
      LEFT JOIN public.profiles p ON p.id = a.profile_id LEFT JOIN public.org_persons pe ON pe.id = a.person_id
     WHERE a.unit_id = p_unit_id;
    IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'ORG_MOVE_DUPLICATE_PERSON' USING HINT = format('보류 카드에 이미 있는 사람: %s — 먼저 정리하세요.', v_dup); END IF;
    UPDATE public.org_units SET head_card_id = NULL WHERE id = p_unit_id AND head_card_id IS NOT NULL;
    SELECT COALESCE(max(sort_order), -1) + 1 INTO v_base FROM public.org_cards WHERE unit_id = v_bench;
    WITH ord AS (SELECT id, row_number() OVER (ORDER BY sort_order) - 1 AS k FROM public.org_cards WHERE unit_id = p_unit_id)
    UPDATE public.org_cards c SET unit_id = v_bench, sort_order = v_base + ord.k, is_unit_head = false, reports_to_card_id = NULL
      FROM ord WHERE c.id = ord.id;
    GET DIAGNOSTICS v_cards = ROW_COUNT;
  END IF;
  DELETE FROM public.org_units WHERE id = p_unit_id;
  RETURN jsonb_build_object('deleted', p_unit_id, 'name', v_name, 'cards_to_bench', v_cards);
END $$;


-- [E] org_copy_file — Phase 7 원문 + 새 컬럼 복사
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

  INSERT INTO public.org_units (id, file_id, parent_unit_id, name, code, azure_division, head_card_id, sort_order, kind, unit_type, head_job_id, memo)
  SELECT m.new_id, v_new, NULL, u.name, u.code, u.azure_division, NULL, u.sort_order, u.kind, u.unit_type, u.head_job_id, u.memo   -- [8-A] 유형·포지션·메모
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


-- [F] org_undo_last — 단위 update 복원에 새 컬럼 포함 (Phase 6 원문 + 1줄)
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
        UPDATE public.org_units u SET (parent_unit_id, name, code, azure_division, head_card_id, sort_order, unit_type, head_job_id, memo) =
          ((r.before->>'parent_unit_id')::uuid, r.before->>'name', r.before->>'code', r.before->>'azure_division', (r.before->>'head_card_id')::uuid, (r.before->>'sort_order')::int,
           r.before->>'unit_type', (r.before->>'head_job_id')::uuid, r.before->>'memo')   -- [8-A]
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


REVOKE ALL ON FUNCTION public.org_delete_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_delete_unit(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.org_copy_file(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_copy_file(uuid, text, date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.org_undo_last(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_undo_last(uuid) TO authenticated, service_role;

-- 4) 엑셀 재이관 stage 정리 (RLS·권한 회수 상태로 남아 있던 임시 테이블)
DROP TABLE IF EXISTS public.org_import_stage_cards, public.org_import_stage_units;

-- 검증 — 결과: 3행(org_copy_file · org_delete_unit · org_undo_last) 모두 anon_can_exec = false, stage = NULL
SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_exec, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_exec,
       to_regclass('public.org_import_stage_units') AS stage
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('org_delete_unit','org_copy_file','org_undo_last') ORDER BY 1;

COMMIT;
