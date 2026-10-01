-- ============================================================================
-- 20261010_org_hotfix_copy.sql
-- 조직도(ORG) HOTFIX — org_copy_file 이 PostgREST 경유 호출에서 400 'DELETE requires a WHERE clause'
--
-- 원인: Supabase 는 anon/authenticated 세션에 pg_safeupdate 를 로드한다. SECURITY DEFINER 함수 안이라도 세션 설정이므로
--       WHERE 없는 DELETE(`DELETE FROM _org_map;`) 가 거부된다. MCP/psql(postgres 세션)에서는 재현되지 않아 시뮬이 놓쳤다.
-- 조치: 임시 테이블 비우기를 TRUNCATE 로. (org_ 함수 전수 점검: WHERE 없는 DELETE/UPDATE 는 이 한 곳뿐)
-- 규칙: 앞으로 RPC 안의 DELETE/UPDATE 는 반드시 WHERE (전체 삭제는 TRUNCATE 또는 WHERE true)
-- ============================================================================
BEGIN;

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
  TRUNCATE _org_map;   -- ← [2026-10-01 HOTFIX] DELETE 무조건절 금지: PostgREST(authenticated) 는 pg_safeupdate 가 로드돼 'DELETE requires a WHERE clause' 로 실패
  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'unit', id, gen_random_uuid() FROM public.org_units WHERE file_id = p_source_file_id;
  INSERT INTO _org_map (kind, old_id, new_id) SELECT 'card', id, gen_random_uuid() FROM public.org_cards WHERE file_id = p_source_file_id;

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

  PERFORM set_config('org.lifecycle', 'on', true);   -- 겸직 카드가 본 카드보다 먼저 들어가도 가드 통과
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

  v_check := public.org_roster_check(v_new);
  RETURN jsonb_build_object('file_id', v_new, 'parent_file_id', p_source_file_id,
                            'units', (SELECT count(*) FROM public.org_units WHERE file_id = v_new),
                            'cards', v_cards,
                            'missing_count', v_check->'missing_count', 'ghost_count', v_check->'ghost_count');
END $$;

DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'org_copy_file') LIKE '%DELETE FROM _org_map;%' THEN RAISE EXCEPTION '[검증] WHERE 없는 DELETE 잔존'; END IF;
  RAISE NOTICE '[검증] ORG HOTFIX copy 통과';
END $$;

COMMIT;
