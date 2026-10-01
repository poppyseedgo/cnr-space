-- ============================================================================
-- 20261013_org_phase7_layout.sql
-- 조직도(ORG) Phase 7 — 노드 캔버스 배치 저장 (설계서 §14, 2026-10-01 확정)
--
-- 전제: 20261012_org_phase6.sql 적용 완료
-- 범위
--   [A] org_unit_layout(file_id, unit_id PK, x, y) — 노드 캔버스의 단위 위치. 변경 로그 트리거 없음(배치 이동은 되돌리기 대상 아님)
--       RLS: SELECT = org 역할. 쓰기는 RPC 만(직접 INSERT/UPDATE 정책 없음)
--   [B] org_save_layout(p_file_id, p_items jsonb[{unit_id,x,y}]) — 묶음 upsert, 초안만, 단위는 같은 파일이어야
--   [C] org_copy_file — Phase 6 원문 + 배치 복사
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.org_unit_layout (
  unit_id     uuid PRIMARY KEY REFERENCES public.org_units(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES public.org_files(id) ON DELETE CASCADE,
  x           double precision NOT NULL,
  y           double precision NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
CREATE INDEX IF NOT EXISTS org_unit_layout_file ON public.org_unit_layout (file_id);
COMMENT ON TABLE public.org_unit_layout IS '[ORG Phase 7] 노드 캔버스 단위 위치(파일별). 로그 없음 — 구조가 아니라 보기 배치. 없으면 프론트가 자동 정렬 위치로 초기화';

ALTER TABLE public.org_unit_layout ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_unit_layout_read ON public.org_unit_layout;
CREATE POLICY org_unit_layout_read ON public.org_unit_layout FOR SELECT USING (public.has_admin_role('org'));
REVOKE ALL ON public.org_unit_layout FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_unit_layout TO authenticated;
GRANT ALL ON public.org_unit_layout TO service_role;

-- [B] 묶음 저장 — 노드 드래그 종료·자동 정렬 시 호출
CREATE OR REPLACE FUNCTION public.org_save_layout(p_file_id uuid, p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_n int;
BEGIN
  PERFORM public.org_assert_org();
  IF NOT public.org_file_is_editable(p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 배치를 저장할 수 있습니다.'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'ORG_LAYOUT_INVALID'; END IF;
  INSERT INTO public.org_unit_layout (unit_id, file_id, x, y, updated_at, updated_by)
  SELECT (i->>'unit_id')::uuid, p_file_id, (i->>'x')::double precision, (i->>'y')::double precision, now(), v_uid
    FROM jsonb_array_elements(p_items) i
   WHERE EXISTS (SELECT 1 FROM public.org_units u WHERE u.id = (i->>'unit_id')::uuid AND u.file_id = p_file_id)
     AND i->>'x' IS NOT NULL AND i->>'y' IS NOT NULL
  ON CONFLICT (unit_id) DO UPDATE SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now(), updated_by = EXCLUDED.updated_by;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.org_save_layout(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_save_layout(uuid, jsonb) TO authenticated, service_role;

-- [C] org_copy_file — Phase 6 원문 + 배치 복사
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

  INSERT INTO public.org_units (id, file_id, parent_unit_id, name, code, azure_division, head_card_id, sort_order, kind)
  SELECT m.new_id, v_new, NULL, u.name, u.code, u.azure_division, NULL, u.sort_order, u.kind   -- [Phase 6] 작업대(kind) 도 그대로 복사
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

  -- [Phase 7] 노드 캔버스 배치도 함께 복사
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='org_unit_layout') THEN RAISE EXCEPTION '[검증] org_unit_layout 없음'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_copy_file') NOT LIKE '%org_unit_layout%' THEN RAISE EXCEPTION '[검증] copy 배치 복사 미반영'; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_org_log' AND tgrelid='public.org_unit_layout'::regclass) THEN RAISE EXCEPTION '[검증] layout 에 로그 트리거가 붙음'; END IF;
  RAISE NOTICE '[검증] ORG Phase 7 layout 통과';
END $$;

COMMIT;
