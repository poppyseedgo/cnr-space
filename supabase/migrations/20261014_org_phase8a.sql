-- ============================================================================
-- 20261014_org_phase8a.sql
-- 조직도(ORG) Phase 8-A — 구조 설계 화면(① 구조 편집기) 기반 (설계서 §15, 2026-10-02 확정)
--
-- 전제: 20261013_org_phase7_layout.sql 적용 완료
-- 범위
--   [A] org_units 컬럼 3종 — unit_type(단위 유형: 회사·본부·실·Division·팀·파트, 자유 텍스트) · head_job_id(단위장 포지션 직무, org_jobs FK) · memo
--       가드: 작업대(bench) 는 세 컬럼 모두 NULL 고정. 변경 로그는 to_jsonb(row) 라 자동 포함
--   [B] org_place_unit(p_unit_id, p_parent_id, p_index) — 상위 변경 + 형제 순서 삽입을 한 트랜잭션(되돌리기 1단계)으로.
--       기존 '단위 UPDATE 1회 + reorder N회' 를 대체(되돌리기가 N단계로 쪼개지던 문제 해결). p_index NULL = 끝, p_parent_id NULL = 루트 층
--   [C] org_delete_unit(p_unit_id) — 하위 단위 없는 단위 삭제. 카드가 있으면 보류(작업대)로 옮긴 뒤 삭제(한 트랜잭션). 보류에 같은 사람이 있으면 거부
--   [D] org_duplicate_unit(p_unit_id) — 같은 층 바로 뒤에 복제(이름 ' (복사)', code 는 유일 제약으로 NULL, 유형·포지션·Azure·메모 복사). 하위·카드는 복사하지 않음
--   [E] org_copy_file — Phase 7 원문 + 새 컬럼 3종 복사
--   [F] org_undo_last — 단위 update 복원에 새 컬럼 3종 포함
-- ============================================================================

BEGIN;

-- [A] 컬럼
ALTER TABLE public.org_units
  ADD COLUMN IF NOT EXISTS unit_type   text,
  ADD COLUMN IF NOT EXISTS head_job_id uuid REFERENCES public.org_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS memo        text;
COMMENT ON COLUMN public.org_units.unit_type   IS '[ORG 8-A] 단위 유형 라벨(회사·본부·실·Division·팀·파트 — 프론트 상수, 자유 텍스트). 표시·필터용';
COMMENT ON COLUMN public.org_units.head_job_id IS '[ORG 8-A] 단위장 포지션 직무(org_jobs). 단위장 카드가 없어도 "이 자리의 직무"를 정의 — 공석 표시·바인드용';
COMMENT ON COLUMN public.org_units.memo        IS '[ORG 8-A] 단위 메모(개편 사유 등)';

-- [A-2] 가드: 작업대는 새 컬럼 NULL 고정 (Phase 6 원문 + 3줄)
CREATE OR REPLACE FUNCTION public.org_units_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent_file uuid; v_cur uuid; v_depth int := 0;
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
    NEW.unit_type := NULL; NEW.head_job_id := NULL; NEW.memo := NULL;   -- [8-A]
  END IF;
  IF NEW.unit_type IS NOT NULL AND length(btrim(NEW.unit_type)) = 0 THEN NEW.unit_type := NULL; END IF;   -- [8-A] 빈 문자열 → NULL
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

-- [B] 상위 변경 + 형제 순서 삽입 (한 트랜잭션)
CREATE OR REPLACE FUNCTION public.org_place_unit(p_unit_id uuid, p_parent_id uuid, p_index integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid; v_kind text; v_pfile uuid; v_pkind text; v_cnt int; v_idx int; v_n int;
BEGIN
  PERFORM public.org_assert_org();
  SELECT file_id, kind INTO v_file, v_kind FROM public.org_units WHERE id = p_unit_id;
  IF v_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
  IF v_kind <> 'unit' THEN RAISE EXCEPTION 'ORG_BENCH_PROTECTED' USING HINT = '보류 영역은 옮길 수 없습니다.'; END IF;
  IF NOT public.org_file_is_editable(v_file) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF p_parent_id IS NOT NULL THEN
    IF p_parent_id = p_unit_id THEN RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '자기 자신을 상위 단위로 둘 수 없습니다.'; END IF;
    SELECT file_id, kind INTO v_pfile, v_pkind FROM public.org_units WHERE id = p_parent_id;
    IF v_pfile IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
    IF v_pfile <> v_file THEN RAISE EXCEPTION 'ORG_UNIT_PARENT_OTHER_FILE' USING HINT = '상위 단위는 같은 조직도 파일 안에 있어야 합니다.'; END IF;
    IF EXISTS (WITH RECURSIVE a AS (SELECT id, parent_unit_id FROM public.org_units WHERE id = p_parent_id
                                    UNION ALL SELECT u.id, u.parent_unit_id FROM public.org_units u JOIN a ON u.id = a.parent_unit_id)
               SELECT 1 FROM a WHERE id = p_unit_id) THEN
      RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '하위 단위 아래로 이동할 수 없습니다(순환).';
    END IF;
  END IF;
  -- 대상 층의 형제(자기 제외, 작업대 제외) 수 → 삽입 위치 보정
  SELECT count(*) INTO v_cnt FROM public.org_units
   WHERE file_id = v_file AND parent_unit_id IS NOT DISTINCT FROM p_parent_id AND id <> p_unit_id AND kind = 'unit';
  v_idx := LEAST(GREATEST(COALESCE(p_index, v_cnt), 0), v_cnt);
  WITH sib AS (
    SELECT id, row_number() OVER (ORDER BY sort_order, name) - 1 AS k FROM public.org_units
     WHERE file_id = v_file AND parent_unit_id IS NOT DISTINCT FROM p_parent_id AND id <> p_unit_id AND kind = 'unit'
  ), placed AS (
    SELECT id, CASE WHEN k < v_idx THEN k ELSE k + 1 END AS so FROM sib
    UNION ALL SELECT p_unit_id, v_idx
  )
  UPDATE public.org_units u SET sort_order = placed.so, parent_unit_id = p_parent_id
    FROM placed WHERE u.id = placed.id AND (u.sort_order <> placed.so OR u.id = p_unit_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('unit_id', p_unit_id, 'parent_id', p_parent_id, 'index', v_idx, 'updated', v_n);
END $$;

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

-- [D] 복제 — 같은 층 바로 뒤
CREATE OR REPLACE FUNCTION public.org_duplicate_unit(p_unit_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u record; v_new uuid; v_idx int;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO u FROM public.org_units WHERE id = p_unit_id;
  IF u.id IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
  IF u.kind <> 'unit' THEN RAISE EXCEPTION 'ORG_BENCH_PROTECTED'; END IF;
  IF NOT public.org_file_is_editable(u.file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  INSERT INTO public.org_units (file_id, parent_unit_id, name, code, azure_division, sort_order, kind, unit_type, head_job_id, memo)
  VALUES (u.file_id, u.parent_unit_id, u.name || ' (복사)', NULL, u.azure_division, u.sort_order + 1, 'unit', u.unit_type, u.head_job_id, u.memo)
  RETURNING id INTO v_new;
  -- 원본 바로 뒤로 (형제 순서 재부여 — 원본의 현재 위치 + 1)
  SELECT s.k INTO v_idx FROM (SELECT id, row_number() OVER (ORDER BY sort_order, name) - 1 AS k FROM public.org_units
                                WHERE file_id = u.file_id AND parent_unit_id IS NOT DISTINCT FROM u.parent_unit_id AND kind = 'unit' AND id <> v_new) s
   WHERE s.id = u.id;
  PERFORM public.org_place_unit(v_new, u.parent_unit_id, v_idx + 1);
  RETURN v_new;
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

-- 권한
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['org_place_unit(uuid, uuid, integer)', 'org_delete_unit(uuid)', 'org_duplicate_unit(uuid)', 'org_copy_file(uuid, text, date)', 'org_undo_last(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- 자기검증
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_units' AND column_name IN ('unit_type','head_job_id','memo') GROUP BY table_name HAVING count(*) = 3) THEN
    RAISE EXCEPTION '[8-A] org_units 컬럼 누락';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('org_place_unit','org_delete_unit','org_duplicate_unit')) <> 3 THEN
    RAISE EXCEPTION '[8-A] RPC 누락';
  END IF;
  RAISE NOTICE '[8-A] OK — org_units +3 컬럼, RPC 3종, copy/undo 갱신';
END $$;

COMMIT;
