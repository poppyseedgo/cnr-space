-- ============================================================================
-- 20261012_org_phase6.sql
-- 조직도(ORG) Phase 6 — 대규모 개편 편집: 작업대(bench) · 다중 이동 · 단위 분리/합치기 · 되돌리기(내 동작만)
--
-- 전제: 20261010_org_hotfix_copy.sql 적용 완료.  설계: 설계서 §13 (2026-10-01 확정 — 명칭 '작업대', 되돌리기 = 내 동작만)
--
-- 범위
--   [A] org_units.kind ('unit'|'bench') — 파일당 작업대 1개(두 번째 루트). 가드: 작업대는 부모 없음·이름 고정·삭제는 파일 CASCADE 만
--   [B] org_ensure_bench(p_file_id) — 작업대 반환(없으면 생성, 초안만)
--   [C] org_move_cards(p_card_ids, p_unit_id) — 다중 카드 이동 단일 트랜잭션 (같은 파일 검사)
--   [D] org_split_unit(p_card_ids, p_parent_unit_id, p_name) — 선택 카드로 새 형제 단위
--   [E] org_merge_unit(p_from, p_into) — 카드·하위 단위를 into 로, from 삭제. 같은 사람 중복이면 거부
--   [F] org_undo_last(p_file_id) — 내 마지막 동작(같은 트랜잭션 = created_at 동일) 되돌리기. 그 뒤 다른 사람 변경이 있으면 거부
--   [G] org_activate_file — 작업대가 비어 있어야 전환 (ORG_ACTIVATE_BENCH_NOT_EMPTY) · diff/카운트는 작업대 제외
--   [H] org_roster_check — Division 불일치는 작업대 제외 (작업대 카드는 '배치됨' 으로 취급해 미배치에서 제외)
--   [I] org_copy_file — kind(작업대) 복사
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 작업대 컬럼 · 제약
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_units ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'unit';
ALTER TABLE public.org_units DROP CONSTRAINT IF EXISTS org_units_kind_check;
ALTER TABLE public.org_units ADD CONSTRAINT org_units_kind_check CHECK (kind IN ('unit','bench'));
ALTER TABLE public.org_units DROP CONSTRAINT IF EXISTS org_units_bench_is_root;
ALTER TABLE public.org_units ADD CONSTRAINT org_units_bench_is_root CHECK (kind <> 'bench' OR parent_unit_id IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS org_units_one_bench ON public.org_units (file_id) WHERE kind = 'bench';
COMMENT ON COLUMN public.org_units.kind IS 'unit = 조직 단위 / bench = 작업대(파일당 1개, 두 번째 루트). 작업대 하위는 트리·헤드카운트·Excel·diff 제외, Active 전환 시 비어 있어야 함';

-- 작업대 하위 여부 (단위 id 기준) — 프론트와 동일 규칙의 SSOT
CREATE OR REPLACE FUNCTION public.org_unit_in_bench(p_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE a AS (
    SELECT id, parent_unit_id, kind FROM public.org_units WHERE id = p_unit_id
    UNION ALL SELECT u.id, u.parent_unit_id, u.kind FROM public.org_units u JOIN a ON u.id = a.parent_unit_id
  ) SELECT EXISTS (SELECT 1 FROM a WHERE kind = 'bench')
$$;

-- org_units_guard — Phase 1 원문 + 작업대 규칙 (부모 없음 · 이름/종류 불변 · 삭제는 CASCADE 만)
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

-- ────────────────────────────────────────────────────────────────────────────
-- [B] org_ensure_bench
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_ensure_bench(p_file_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM public.org_assert_org();
  SELECT id INTO v_id FROM public.org_units WHERE file_id = p_file_id AND kind = 'bench';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  IF NOT public.org_file_is_editable(p_file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  INSERT INTO public.org_units (file_id, parent_unit_id, name, kind, sort_order) VALUES (p_file_id, NULL, '작업대', 'bench', 9999) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] org_move_cards — 다중 이동 (한 트랜잭션 = 되돌리기 1단계)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_move_cards(p_card_ids uuid[], p_unit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid; v_n int; v_base int; v_dup text;
BEGIN
  PERFORM public.org_assert_org();
  SELECT file_id INTO v_file FROM public.org_units WHERE id = p_unit_id;
  IF v_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
  IF NOT public.org_file_is_editable(v_file) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF EXISTS (SELECT 1 FROM public.org_cards WHERE id = ANY(p_card_ids) AND file_id <> v_file) THEN
    RAISE EXCEPTION 'ORG_CARD_UNIT_OTHER_FILE' USING HINT = '카드는 같은 조직도의 단위에만 배치할 수 있습니다.';
  END IF;
  -- 같은 사람이 대상 단위에 이미 있으면(본/겸직) 거부 — 유일 인덱스(org_cards_unit_profile/person) 대신 읽을 수 있는 메시지
  SELECT string_agg(COALESCE(p.name, pe.name, a.display_name, '?'), ', ') INTO v_dup
    FROM public.org_cards a JOIN public.org_cards b ON b.unit_id = p_unit_id AND b.id <> a.id
     AND ((a.profile_id IS NOT NULL AND a.profile_id = b.profile_id) OR (a.person_id IS NOT NULL AND a.person_id = b.person_id))
    LEFT JOIN public.profiles p ON p.id = a.profile_id LEFT JOIN public.org_persons pe ON pe.id = a.person_id
   WHERE a.id = ANY(p_card_ids) AND a.unit_id <> p_unit_id;
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'ORG_MOVE_DUPLICATE_PERSON' USING HINT = format('대상 단위에 이미 있는 사람: %s', v_dup); END IF;
  SELECT COALESCE(max(sort_order), -1) + 1 INTO v_base FROM public.org_cards WHERE unit_id = p_unit_id;
  WITH ord AS (SELECT id, row_number() OVER (ORDER BY array_position(p_card_ids, id)) - 1 AS k FROM public.org_cards WHERE id = ANY(p_card_ids) AND unit_id <> p_unit_id)
  UPDATE public.org_cards c SET unit_id = p_unit_id, sort_order = v_base + ord.k, is_unit_head = false, reports_to_card_id = NULL
    FROM ord WHERE c.id = ord.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  -- 옮겨간 카드가 이전 단위의 단위장이었으면 해제
  UPDATE public.org_units u SET head_card_id = NULL WHERE u.file_id = v_file AND u.id <> p_unit_id AND u.head_card_id = ANY(p_card_ids);
  RETURN jsonb_build_object('moved', v_n, 'unit_id', p_unit_id);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] org_split_unit — 선택 카드로 새 단위 (부모 아래 형제 끝)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_split_unit(p_card_ids uuid[], p_parent_unit_id uuid, p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid; v_new uuid; v_sort int; v_moved jsonb;
BEGIN
  PERFORM public.org_assert_org();
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'ORG_NAME_REQUIRED'; END IF;
  SELECT file_id INTO v_file FROM public.org_units WHERE id = p_parent_unit_id;
  IF v_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND'; END IF;
  IF NOT public.org_file_is_editable(v_file) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  SELECT COALESCE(max(sort_order), -1) + 1 INTO v_sort FROM public.org_units WHERE parent_unit_id = p_parent_unit_id;
  INSERT INTO public.org_units (file_id, parent_unit_id, name, sort_order) VALUES (v_file, p_parent_unit_id, btrim(p_name), v_sort) RETURNING id INTO v_new;
  v_moved := public.org_move_cards(p_card_ids, v_new);
  RETURN jsonb_build_object('unit_id', v_new, 'moved', v_moved->'moved');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [E] org_merge_unit — from 의 카드·하위 단위를 into 로, from 삭제
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_merge_unit(p_from uuid, p_into uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid; v_into_file uuid; v_cards int; v_units int; v_dup text; v_base int; v_ubase int;
BEGIN
  PERFORM public.org_assert_org();
  IF p_from = p_into THEN RAISE EXCEPTION 'ORG_MERGE_SELF'; END IF;
  SELECT file_id INTO v_file FROM public.org_units WHERE id = p_from AND kind = 'unit';
  SELECT file_id INTO v_into_file FROM public.org_units WHERE id = p_into AND kind = 'unit';
  IF v_file IS NULL OR v_into_file IS NULL THEN RAISE EXCEPTION 'ORG_UNIT_NOT_FOUND' USING HINT = '합치기는 조직 단위끼리만 가능합니다(작업대 제외).'; END IF;
  IF v_file <> v_into_file THEN RAISE EXCEPTION 'ORG_UNIT_PARENT_OTHER_FILE'; END IF;
  IF NOT public.org_file_is_editable(v_file) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  IF EXISTS (WITH RECURSIVE a AS (SELECT id, parent_unit_id FROM public.org_units WHERE id = p_into UNION ALL SELECT u.id, u.parent_unit_id FROM public.org_units u JOIN a ON u.id = a.parent_unit_id) SELECT 1 FROM a WHERE id = p_from) THEN
    RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '자기 하위 단위로는 합칠 수 없습니다.';
  END IF;
  -- 같은 사람이 양쪽에 있으면 거부 (어느 카드를 남길지 사람이 정해야 함)
  SELECT string_agg(COALESCE(p.name, pe.name, '?'), ', ') INTO v_dup
    FROM public.org_cards a JOIN public.org_cards b ON (a.profile_id IS NOT NULL AND a.profile_id = b.profile_id) OR (a.person_id IS NOT NULL AND a.person_id = b.person_id)
    LEFT JOIN public.profiles p ON p.id = a.profile_id LEFT JOIN public.org_persons pe ON pe.id = a.person_id
   WHERE a.unit_id = p_from AND b.unit_id = p_into;
  IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'ORG_MERGE_DUPLICATE_PERSON' USING HINT = format('양쪽 단위에 모두 있는 사람: %s — 한쪽 카드를 먼저 정리하세요.', v_dup); END IF;

  SELECT COALESCE(max(sort_order), -1) + 1 INTO v_base FROM public.org_cards WHERE unit_id = p_into;
  WITH ord AS (SELECT id, row_number() OVER (ORDER BY sort_order) - 1 AS k FROM public.org_cards WHERE unit_id = p_from)
  UPDATE public.org_cards c SET unit_id = p_into, sort_order = v_base + ord.k, is_unit_head = CASE WHEN (SELECT head_card_id FROM public.org_units WHERE id = p_into) IS NULL THEN c.is_unit_head ELSE false END
    FROM ord WHERE c.id = ord.id;
  GET DIAGNOSTICS v_cards = ROW_COUNT;
  UPDATE public.org_units i SET head_card_id = f.head_card_id FROM public.org_units f WHERE i.id = p_into AND f.id = p_from AND i.head_card_id IS NULL AND f.head_card_id IS NOT NULL;
  UPDATE public.org_units SET head_card_id = NULL WHERE id = p_from;

  SELECT COALESCE(max(sort_order), -1) + 1 INTO v_ubase FROM public.org_units WHERE parent_unit_id = p_into;
  WITH ord AS (SELECT id, row_number() OVER (ORDER BY sort_order) - 1 AS k FROM public.org_units WHERE parent_unit_id = p_from)
  UPDATE public.org_units u SET parent_unit_id = p_into, sort_order = v_ubase + ord.k FROM ord WHERE u.id = ord.id;
  GET DIAGNOSTICS v_units = ROW_COUNT;

  DELETE FROM public.org_units WHERE id = p_from;
  RETURN jsonb_build_object('into', p_into, 'cards', v_cards, 'units', v_units);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] org_undo_last — 내 마지막 동작 되돌리기
--   동작 = 같은 트랜잭션의 변경 로그 묶음(created_at = 트랜잭션 시각, actor = 나, file_id = 이 파일, 대상 units/cards/card_jobs)
--   · 작업대 행(kind=bench) 자체의 생성은 동작으로 치지 않는다(보호 대상). 파일 생성/복사 묶음(org_files insert 동반)도 제외
--   · 그 묶음 뒤에 다른 사람의 변경이 있으면 거부(ORG_UNDO_CONFLICT). 되돌린 결과도 로그로 남아 다시 되돌릴 수 있다(= 다시 실행)
--   · 복원 순서(FK 안전): 삭제 복원(상위 테이블 먼저) → 수정 복원(역순) → 삽입 취소(하위 테이블 먼저)
--   · 가드 우회(org.lifecycle): 직전의 일관된 상태로 되돌리는 것이므로 중간 상태 가드(본 카드 0/2장 등)는 적용하지 않는다
-- ────────────────────────────────────────────────────────────────────────────
-- 묶음의 행들 (undo_last · undo_group 공용). file_id 가 NULL 인 org_card_jobs delete(카드 CASCADE 로 지워져 트리거가 파일을 못 찾은 행)는
-- 같은 묶음의 org_cards delete 와 card_id 로 묶어 포함한다
CREATE OR REPLACE FUNCTION public.org_undo_rows(p_file_id uuid, p_at timestamptz)
RETURNS SETOF public.org_change_log LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.* FROM public.org_change_log l
   WHERE l.actor = auth.uid() AND l.created_at = p_at AND l.target_table IN ('org_units','org_cards','org_card_jobs')
     AND NOT (l.target_table = 'org_units' AND COALESCE(l.after->>'kind', l.before->>'kind') = 'bench')
     AND (l.file_id = p_file_id
          OR (l.file_id IS NULL AND l.target_table = 'org_card_jobs' AND l.action = 'delete'
              AND EXISTS (SELECT 1 FROM public.org_change_log d WHERE d.created_at = p_at AND d.actor = l.actor AND d.file_id = p_file_id
                           AND d.target_table = 'org_cards' AND d.action = 'delete' AND d.target_id = l.before->>'card_id')))
$$;

-- 되돌릴 묶음 찾기 (undo_last · undo_peek 공용): at = 묶음 시각(없으면 NULL), rows = 건수, conflict = 뒤에 타인 변경 있음
CREATE OR REPLACE FUNCTION public.org_undo_group(p_file_id uuid)
RETURNS TABLE (at timestamptz, rows int, conflict boolean) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_tables text[] := ARRAY['org_units','org_cards','org_card_jobs'];
BEGIN
  SELECT max(l.created_at) INTO at FROM public.org_change_log l
   WHERE l.file_id = p_file_id AND l.actor = v_uid AND l.target_table = ANY(v_tables)
     AND NOT (l.target_table = 'org_units' AND COALESCE(l.after->>'kind', l.before->>'kind') = 'bench');
  IF at IS NULL THEN rows := 0; conflict := false; RETURN NEXT; RETURN; END IF;
  -- 파일 생성·복사 묶음(같은 시각에 이 파일의 org_files insert) 은 되돌리기 대상이 아님 (org_files 로그는 file_id 없음 → target_id 로 식별)
  IF EXISTS (SELECT 1 FROM public.org_change_log l WHERE l.created_at = at AND l.target_table = 'org_files' AND l.action = 'insert' AND l.target_id = p_file_id::text) THEN
    at := NULL; rows := 0; conflict := false; RETURN NEXT; RETURN;
  END IF;
  SELECT count(*)::int INTO rows FROM public.org_undo_rows(p_file_id, at);
  SELECT EXISTS (SELECT 1 FROM public.org_change_log l WHERE l.file_id = p_file_id AND l.created_at > at AND l.actor IS DISTINCT FROM v_uid AND l.target_table = ANY(v_tables)) INTO conflict;
  RETURN NEXT;
END $$;

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
      -- 이후 추가된 NOT NULL 컬럼이 로그에 없으면 기본값 보충 (kind · is_primary)
      v_row := r.before;
      IF r.target_table = 'org_units' AND NOT (v_row ? 'kind') THEN v_row := v_row || '{"kind":"unit"}'; END IF;
      IF r.target_table = 'org_cards' AND NOT (v_row ? 'is_primary') THEN v_row := v_row || '{"is_primary":true}'; END IF;
      EXECUTE format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)', r.target_table, r.target_table) USING v_row;
    ELSE   -- update: before 로 복원 (updated_at 은 가드가 갱신)
      IF r.target_table = 'org_card_jobs' THEN
        UPDATE public.org_card_jobs j SET is_primary = (r.before->>'is_primary')::boolean, sort_order = (r.before->>'sort_order')::int
         WHERE j.card_id = (r.before->>'card_id')::uuid AND j.job_id = (r.before->>'job_id')::uuid;
      ELSIF r.target_table = 'org_units' THEN
        UPDATE public.org_units u SET (parent_unit_id, name, code, azure_division, head_card_id, sort_order) =
          ((r.before->>'parent_unit_id')::uuid, r.before->>'name', r.before->>'code', r.before->>'azure_division', (r.before->>'head_card_id')::uuid, (r.before->>'sort_order')::int)
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

-- 되돌릴 게 있는지 미리보기 (버튼 활성화용)
CREATE OR REPLACE FUNCTION public.org_undo_peek(p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g record;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO g FROM public.org_undo_group(p_file_id);
  IF g.at IS NULL THEN RETURN jsonb_build_object('available', false); END IF;
  RETURN jsonb_build_object('available', NOT g.conflict, 'conflict', g.conflict, 'at', g.at, 'rows', g.rows);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [G] org_activate_file — 5-B 원문 + 작업대 비어 있어야 · diff/카운트 작업대 제외
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_activate_file(p_file_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_f public.org_files%ROWTYPE; v_prev uuid; v_check jsonb; v_cnt int;
  v_diff jsonb; v_prev_name text; v_units int; v_cards int; v_hidden int; v_bench uuid; v_bn int;
BEGIN
  PERFORM public.org_assert_super();
  SELECT * INTO v_f FROM public.org_files WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_FILE_NOT_FOUND'; END IF;
  IF v_f.status <> 'draft' THEN RAISE EXCEPTION 'ORG_ACTIVATE_NOT_DRAFT' USING HINT = '초안만 Active 로 지정할 수 있습니다.'; END IF;
  IF v_f.effective_on IS NULL THEN RAISE EXCEPTION 'ORG_ACTIVATE_NEEDS_EFFECTIVE' USING HINT = '적용일을 먼저 지정하세요.'; END IF;
  IF v_f.lock_by IS NOT NULL AND v_f.lock_by <> v_uid AND v_f.lock_at > now() - interval '30 minutes' AND NOT p_force THEN
    RAISE EXCEPTION 'ORG_FILE_LOCKED' USING HINT = '다른 사용자가 편집 중입니다. 강제 전환하려면 force 를 지정하세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_units WHERE file_id = p_file_id AND kind = 'unit') THEN
    RAISE EXCEPTION 'ORG_ACTIVATE_EMPTY' USING HINT = '단위가 없는 빈 조직도는 Active 로 지정할 수 없습니다.';
  END IF;
  -- [Phase 6] 작업대 비어 있어야
  SELECT id INTO v_bench FROM public.org_units WHERE file_id = p_file_id AND kind = 'bench';
  IF v_bench IS NOT NULL THEN
    SELECT (SELECT count(*) FROM public.org_units WHERE parent_unit_id = v_bench) + (SELECT count(*) FROM public.org_cards WHERE unit_id = v_bench) INTO v_bn;
    IF v_bn > 0 THEN RAISE EXCEPTION 'ORG_ACTIVATE_BENCH_NOT_EMPTY' USING HINT = format('작업대에 %s개 항목이 남아 있습니다. 조직에 붙이거나 제거하세요.', v_bn); END IF;
  END IF;

  v_check := public.org_roster_check(p_file_id);
  IF (v_check->>'ghost_count')::int > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'ORG_ACTIVATE_GHOSTS' USING HINT = format('퇴사자 카드 %s장이 남아 있습니다. 정리하거나 force 로 전환하세요.', v_check->>'ghost_count'), DETAIL = (v_check->'ghosts')::text;
  END IF;

  PERFORM set_config('org.lifecycle', 'on', true);

  SELECT id INTO v_prev FROM public.org_files WHERE status = 'active' AND id <> p_file_id FOR UPDATE;
  IF v_prev IS NOT NULL THEN
    UPDATE public.org_files SET status = 'archived', archived_at = now(), lock_by = NULL, lock_at = NULL WHERE id = v_prev;
  END IF;
  UPDATE public.org_files SET status = 'active', activated_at = now(), activated_by = v_uid, lock_by = NULL, lock_at = NULL, updated_by = v_uid
   WHERE id = p_file_id;

  DELETE FROM public.org_activation_diffs WHERE file_id = p_file_id;
  IF v_prev IS NOT NULL THEN
    WITH cur AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = p_file_id AND NOT c.is_vacancy AND c.is_primary AND c.hidden_at IS NULL AND u.kind = 'unit'
    ), prev AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = v_prev AND NOT c.is_vacancy AND c.is_primary AND c.hidden_at IS NULL AND u.kind = 'unit'
    ), cur_cc AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = p_file_id AND NOT c.is_primary AND c.hidden_at IS NULL AND u.kind = 'unit'
    ), prev_cc AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = v_prev AND NOT c.is_primary AND c.hidden_at IS NULL AND u.kind = 'unit'
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
      SELECT 'concurrent_added', c.key, c.label, NULL, jsonb_build_object('unit', c.unit_name)
        FROM cur_cc c WHERE NOT EXISTS (SELECT 1 FROM prev_cc p WHERE p.key = c.key AND p.unit_key = c.unit_key)
      UNION ALL
      SELECT 'concurrent_removed', p.key, p.label, jsonb_build_object('unit', p.unit_name), NULL
        FROM prev_cc p WHERE NOT EXISTS (SELECT 1 FROM cur_cc c WHERE c.key = p.key AND c.unit_key = p.unit_key)
      UNION ALL
      SELECT 'unit_created', COALESCE(u.code, u.name), u.name, NULL, jsonb_build_object('name', u.name, 'code', u.code)
        FROM public.org_units u WHERE u.file_id = p_file_id AND u.kind = 'unit'
         AND NOT EXISTS (SELECT 1 FROM public.org_units o WHERE o.file_id = v_prev AND o.kind = 'unit' AND COALESCE(o.code, o.name) = COALESCE(u.code, u.name))
      UNION ALL
      SELECT 'unit_removed', COALESCE(o.code, o.name), o.name, jsonb_build_object('name', o.name, 'code', o.code), NULL
        FROM public.org_units o WHERE o.file_id = v_prev AND o.kind = 'unit'
         AND NOT EXISTS (SELECT 1 FROM public.org_units u WHERE u.file_id = p_file_id AND u.kind = 'unit' AND COALESCE(u.code, u.name) = COALESCE(o.code, o.name))
    )
    INSERT INTO public.org_activation_diffs (file_id, prev_file_id, kind, card_ref, label, before, after)
    SELECT p_file_id, v_prev, kind, key, label, before, after FROM rows;
  END IF;

  UPDATE public.org_units u SET head_card_id = NULL
   WHERE u.file_id = p_file_id AND EXISTS (SELECT 1 FROM public.org_cards c WHERE c.id = u.head_card_id AND c.hidden_at IS NOT NULL);
  UPDATE public.org_cards SET reports_to_card_id = NULL
   WHERE file_id = p_file_id AND reports_to_card_id IN (SELECT id FROM public.org_cards WHERE file_id = p_file_id AND hidden_at IS NOT NULL);
  DELETE FROM public.org_cards WHERE file_id = p_file_id AND hidden_at IS NOT NULL AND NOT is_primary;
  DELETE FROM public.org_cards WHERE file_id = p_file_id AND hidden_at IS NOT NULL;
  GET DIAGNOSTICS v_hidden = ROW_COUNT;

  SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) INTO v_diff
    FROM (SELECT kind, count(*) n FROM public.org_activation_diffs WHERE file_id = p_file_id GROUP BY kind) s;
  SELECT count(*) INTO v_cnt FROM public.org_activation_diffs WHERE file_id = p_file_id;

  SELECT name INTO v_prev_name FROM public.org_files WHERE id = v_prev;
  SELECT count(*) INTO v_units FROM public.org_units WHERE file_id = p_file_id AND kind = 'unit';
  SELECT count(*) INTO v_cards FROM public.org_cards WHERE file_id = p_file_id AND NOT is_vacancy AND is_primary;
  RETURN jsonb_build_object('file_id', p_file_id, 'file_name', v_f.name, 'prev_file_id', v_prev, 'prev_file_name', v_prev_name,
                            'effective_on', v_f.effective_on, 'units', v_units, 'cards', v_cards, 'hidden_removed', v_hidden,
                            'diff_count', v_cnt, 'diff', v_diff, 'ghost_count', v_check->'ghost_count',
                            'missing_count', v_check->'missing_count');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [H] org_roster_check — 5-B 원문 + Division 불일치에서 작업대 제외
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_roster_check(p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_missing jsonb; v_ghosts jsonb; v_mismatch jsonb; v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  PERFORM public.org_assert_org();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id', p.id, 'name', p.name, 'dept', p.dept, 'email', p.email) ORDER BY p.dept, p.name), '[]'::jsonb)
    INTO v_missing
    FROM public.profiles p
   WHERE p.employee_id IS NOT NULL AND p.employee_id <> ''
     AND NOT EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = p_file_id AND c.profile_id = p.id)
     AND NOT (p.employment_status = 'departing' AND p.departure_scheduled_on IS NOT NULL AND p.departure_scheduled_on <= v_today)
     AND NOT EXISTS (SELECT 1 FROM public.org_person_status s JOIN public.org_status_types t ON t.code = s.status_code
                      WHERE s.profile_id = p.id AND s.ended_at IS NULL AND t.category = 'departing' AND s.end_on IS NOT NULL AND s.end_on <= v_today);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('card_id', c.id, 'profile_id', c.profile_id, 'unit_id', c.unit_id,
                                                'departed_name', d.name, 'departed_at', d.departed_at)), '[]'::jsonb)
    INTO v_ghosts
    FROM public.org_cards c LEFT JOIN public.departed_users d ON d.id = c.profile_id
   WHERE c.file_id = p_file_id AND c.profile_id IS NOT NULL AND c.hidden_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.profile_id);

  WITH RECURSIVE anc AS (
    SELECT u.id AS unit_id, u.id AS cur, u.parent_unit_id, u.azure_division, u.kind, 0 AS depth
      FROM public.org_units u WHERE u.file_id = p_file_id
    UNION ALL
    SELECT a.unit_id, pu.id, pu.parent_unit_id, pu.azure_division, pu.kind, a.depth + 1
      FROM anc a JOIN public.org_units pu ON pu.id = a.parent_unit_id
     WHERE a.depth < 64
  ), bench_units AS (SELECT DISTINCT unit_id FROM anc WHERE kind = 'bench'),
  div AS (
    SELECT DISTINCT ON (unit_id) unit_id, azure_division FROM anc WHERE azure_division IS NOT NULL ORDER BY unit_id, depth
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('card_id', c.id, 'profile_id', c.profile_id, 'name', p.name,
                                                'unit_division', d.azure_division, 'azure_dept', p.dept) ORDER BY p.name), '[]'::jsonb)
    INTO v_mismatch
    FROM public.org_cards c JOIN public.profiles p ON p.id = c.profile_id JOIN div d ON d.unit_id = c.unit_id
   WHERE c.file_id = p_file_id AND c.is_primary AND c.hidden_at IS NULL AND c.unit_id NOT IN (SELECT unit_id FROM bench_units)
     AND lower(btrim(COALESCE(p.dept,''))) <> lower(btrim(d.azure_division));

  RETURN jsonb_build_object('file_id', p_file_id,
                            'missing', v_missing, 'missing_count', jsonb_array_length(v_missing),
                            'ghosts', v_ghosts, 'ghost_count', jsonb_array_length(v_ghosts),
                            'division_mismatch', v_mismatch, 'division_mismatch_count', jsonb_array_length(v_mismatch));
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [I] org_copy_file — 핫픽스(20261010) 원문 + kind(작업대) 복사 · units 카운트 작업대 제외
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

  v_check := public.org_roster_check(v_new);
  RETURN jsonb_build_object('file_id', v_new, 'parent_file_id', p_source_file_id,
                            'units', (SELECT count(*) FROM public.org_units WHERE file_id = v_new AND kind = 'unit'),
                            'cards', v_cards,
                            'missing_count', v_check->'missing_count', 'ghost_count', v_check->'ghost_count');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 권한 · 검증
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['org_ensure_bench(uuid)','org_move_cards(uuid[],uuid)','org_split_unit(uuid[],uuid,text)','org_merge_unit(uuid,uuid)','org_undo_last(uuid)','org_undo_peek(uuid)','org_undo_group(uuid)','org_undo_rows(uuid,timestamptz)','org_unit_in_bench(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_units' AND column_name='kind') THEN RAISE EXCEPTION '[검증] org_units.kind 없음'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_activate_file') NOT LIKE '%ORG_ACTIVATE_BENCH_NOT_EMPTY%' THEN RAISE EXCEPTION '[검증] activate 작업대 가드 미반영'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_copy_file') LIKE '%DELETE FROM _org_map;%' THEN RAISE EXCEPTION '[검증] 핫픽스(20261010) 미적용'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_copy_file') NOT LIKE '%u.kind%' THEN RAISE EXCEPTION '[검증] copy kind 미반영'; END IF;
  RAISE NOTICE '[검증] ORG Phase 6 전 항목 통과';
END $$;

COMMIT;
