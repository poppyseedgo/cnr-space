-- ============================================================================
-- 20261009_org_phase5b.sql
-- 조직도(ORG) Phase 5-B — 겸직 카드(다중 카드) · 퇴사 카드 숨김
--
-- 전제: 20261008_org_phase5.sql 적용 완료
-- 설계: 설계서 §12 (2026-10-01)
--
-- 범위
--   [A] org_cards.is_primary(본 카드/겸직 카드) · hidden_at(숨김) — 유일 제약을 본 카드에만
--   [B] org_cards_guard 확장 — 겸직 카드는 본 카드가 있어야 · 본 카드 제거/강등 시 겸직 잔존 금지 · 공석은 본 카드만
--   [C] org_set_card_hidden(p_card_id, p_hidden) — Active/Archived 파일에서도 숨김 토글 (lifecycle GUC)
--   [D] org_roster_check — 미배치에서 퇴사예정+퇴사일 경과 제외 · 유령에서 숨김 카드 제외
--   [E] org_activate_file — 전환 시 숨김 카드 자동 제거(diff departed) · 사람 diff 는 본 카드 기준 · 겸직 diff 2종
--   [F] org_copy_file — is_primary · hidden_at 복사
--   [G] org_activation_diffs.kind CHECK 확장 · 검증
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 컬럼 · 제약
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_cards ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT true;
ALTER TABLE public.org_cards ADD COLUMN IF NOT EXISTS hidden_at  timestamptz;
COMMENT ON COLUMN public.org_cards.is_primary IS '본 카드(true, 사람당 파일 내 1장) / 겸직 카드(false, n장). 헤드카운트·사람 diff 는 본 카드 기준';
COMMENT ON COLUMN public.org_cards.hidden_at  IS '수동 숨김 시각. 퇴사 카드 즉시 숨김 — 화면·CSV·헤드카운트 제외, Active 전환 시 자동 제거';

ALTER TABLE public.org_cards DROP CONSTRAINT IF EXISTS org_cards_vacancy_primary;
ALTER TABLE public.org_cards ADD CONSTRAINT org_cards_vacancy_primary CHECK (is_primary OR NOT is_vacancy);

DROP INDEX IF EXISTS public.org_cards_file_profile;
DROP INDEX IF EXISTS public.org_cards_file_person;
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_file_profile_primary ON public.org_cards (file_id, profile_id) WHERE profile_id IS NOT NULL AND is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_file_person_primary  ON public.org_cards (file_id, person_id)  WHERE person_id  IS NOT NULL AND is_primary;
-- 같은 단위에 같은 사람 카드 2장은 의미 없음
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_unit_profile ON public.org_cards (unit_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_unit_person  ON public.org_cards (unit_id, person_id)  WHERE person_id  IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] org_cards_guard — Phase 1 원문 + 겸직 규칙
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_cards_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_f uuid; v_n int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = OLD.file_id) THEN RETURN OLD; END IF;
    IF NOT public.org_file_is_editable(OLD.file_id) AND NOT public.org_lifecycle_on() THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
    END IF;
    -- 본 카드 제거: 겸직 카드가 남아 있으면 금지 (하나를 본 카드로 승격 후 제거)
    IF OLD.is_primary AND NOT public.org_lifecycle_on() THEN
      SELECT count(*) INTO v_n FROM public.org_cards c
       WHERE c.file_id = OLD.file_id AND c.id <> OLD.id AND NOT c.is_primary
         AND ((OLD.profile_id IS NOT NULL AND c.profile_id = OLD.profile_id) OR (OLD.person_id IS NOT NULL AND c.person_id = OLD.person_id));
      IF v_n > 0 THEN
        RAISE EXCEPTION 'ORG_CARD_PRIMARY_HAS_CONCURRENT' USING HINT = format('겸직 카드 %s장이 남아 있습니다. 겸직 카드 하나를 본 카드로 바꾼 뒤 제거하세요.', v_n);
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  IF NOT public.org_file_is_editable(NEW.file_id) AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.file_id <> NEW.file_id THEN
    RAISE EXCEPTION 'ORG_CARD_FILE_IMMUTABLE';
  END IF;
  SELECT file_id INTO v_f FROM public.org_units WHERE id = NEW.unit_id;
  IF v_f IS NULL OR v_f <> NEW.file_id THEN
    RAISE EXCEPTION 'ORG_CARD_UNIT_OTHER_FILE' USING HINT = '카드는 같은 조직도 파일의 단위에만 배치할 수 있습니다.';
  END IF;
  IF NEW.reports_to_card_id IS NOT NULL THEN
    SELECT file_id INTO v_f FROM public.org_cards WHERE id = NEW.reports_to_card_id;
    IF v_f IS NULL OR v_f <> NEW.file_id THEN
      RAISE EXCEPTION 'ORG_CARD_REPORTS_OTHER_FILE' USING HINT = '보고선은 같은 조직도 파일의 카드여야 합니다.';
    END IF;
  END IF;
  -- 본 카드 → 겸직 카드 강등: 다른 겸직 카드가 있으면 금지 (본 카드 0장 방지)
  IF TG_OP = 'UPDATE' AND OLD.is_primary AND NOT NEW.is_primary AND NOT public.org_lifecycle_on() THEN
    SELECT count(*) INTO v_n FROM public.org_cards c
     WHERE c.file_id = NEW.file_id AND c.id <> NEW.id AND NOT c.is_primary
       AND ((NEW.profile_id IS NOT NULL AND c.profile_id = NEW.profile_id) OR (NEW.person_id IS NOT NULL AND c.person_id = NEW.person_id));
    IF v_n > 0 THEN
      RAISE EXCEPTION 'ORG_CARD_PRIMARY_HAS_CONCURRENT' USING HINT = '다른 겸직 카드를 먼저 본 카드로 바꾸세요.';
    END IF;
  END IF;
  -- 겸직 카드: 같은 파일에 본 카드가 있어야 한다 (딥카피·전환 중에는 생략)
  IF NOT NEW.is_primary AND NOT public.org_lifecycle_on() THEN
    IF NEW.profile_id IS NULL AND NEW.person_id IS NULL THEN
      RAISE EXCEPTION 'ORG_CARD_CONCURRENT_NEEDS_PERSON';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.org_cards c WHERE c.file_id = NEW.file_id AND c.is_primary AND c.id <> NEW.id
                    AND ((NEW.profile_id IS NOT NULL AND c.profile_id = NEW.profile_id) OR (NEW.person_id IS NOT NULL AND c.person_id = NEW.person_id))) THEN
      RAISE EXCEPTION 'ORG_CARD_CONCURRENT_NEEDS_PRIMARY' USING HINT = '먼저 본 카드가 배치돼 있어야 겸직 카드를 추가할 수 있습니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- 본 카드 교체(승격)를 한 트랜잭션으로: 겸직 카드 → 본 카드, 기존 본 카드 → 겸직 카드
CREATE OR REPLACE FUNCTION public.org_swap_primary_card(p_card_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c public.org_cards%ROWTYPE; v_old uuid;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO v_c FROM public.org_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_CARD_NOT_FOUND'; END IF;
  IF v_c.is_primary THEN RETURN; END IF;
  IF NOT public.org_file_is_editable(v_c.file_id) THEN RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.'; END IF;
  SELECT id INTO v_old FROM public.org_cards c
   WHERE c.file_id = v_c.file_id AND c.is_primary
     AND ((v_c.profile_id IS NOT NULL AND c.profile_id = v_c.profile_id) OR (v_c.person_id IS NOT NULL AND c.person_id = v_c.person_id))
   FOR UPDATE;
  PERFORM set_config('org.lifecycle', 'on', true);   -- 가드 우회: 중간 상태(본 카드 0장/2장) 허용
  UPDATE public.org_cards SET is_primary = false WHERE id = v_old;
  UPDATE public.org_cards SET is_primary = true  WHERE id = p_card_id;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] org_set_card_hidden — 어떤 status 의 파일에서도 숨김 토글 (RLS 는 초안만 쓰기 가능하므로 RPC)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_set_card_hidden(p_card_id uuid, p_hidden boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c public.org_cards%ROWTYPE;
BEGIN
  PERFORM public.org_assert_org();
  SELECT * INTO v_c FROM public.org_cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORG_CARD_NOT_FOUND'; END IF;
  IF v_c.is_vacancy THEN RAISE EXCEPTION 'ORG_CARD_HIDE_VACANCY' USING HINT = '공석 카드는 숨기지 않고 제거합니다.'; END IF;
  PERFORM set_config('org.lifecycle', 'on', true);
  UPDATE public.org_cards SET hidden_at = CASE WHEN p_hidden THEN now() ELSE NULL END WHERE id = p_card_id;
  RETURN jsonb_build_object('card_id', p_card_id, 'hidden', p_hidden);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] org_roster_check — Phase 2 [L] 원문 + 퇴사 경과자 제외 · 숨김 카드 제외
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
     -- 퇴사 예정일이 지난 사람은 '미배치' 가 아니라 퇴사자 (Azure 비활성 대기 중)
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
   WHERE c.file_id = p_file_id AND c.is_primary AND c.hidden_at IS NULL AND lower(btrim(COALESCE(p.dept,''))) <> lower(btrim(d.azure_division));

  RETURN jsonb_build_object('file_id', p_file_id,
                            'missing', v_missing, 'missing_count', jsonb_array_length(v_missing),
                            'ghosts', v_ghosts, 'ghost_count', jsonb_array_length(v_ghosts),
                            'division_mismatch', v_mismatch, 'division_mismatch_count', jsonb_array_length(v_mismatch));
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [G-1] diff kind 확장 (activate 가 사용하므로 먼저)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_activation_diffs DROP CONSTRAINT IF EXISTS org_activation_diffs_kind_check;
ALTER TABLE public.org_activation_diffs ADD CONSTRAINT org_activation_diffs_kind_check
  CHECK (kind IN ('moved','promoted','job_changed','hired','departed','unit_created','unit_removed','unit_renamed','unit_moved','reassigned','head_changed',
                  'concurrent_added','concurrent_removed'));

-- ────────────────────────────────────────────────────────────────────────────
-- [E] org_activate_file — 4-B 원문 + 숨김 카드 제거 · 본 카드 기준 diff · 겸직 diff
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_activate_file(p_file_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_f public.org_files%ROWTYPE; v_prev uuid; v_check jsonb; v_cnt int;
  v_diff jsonb; v_prev_name text; v_units int; v_cards int; v_hidden int;
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

  v_check := public.org_roster_check(p_file_id);   -- 숨김 카드는 유령 검사에서 제외됨
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

  -- ── diff (이전 Active 대비, 숨김 카드 제거 전에 계산 → 숨김 = departed 로 잡힌다) ──
  DELETE FROM public.org_activation_diffs WHERE file_id = p_file_id;
  IF v_prev IS NOT NULL THEN
    WITH cur AS (   -- 본 카드만 (숨김 제외)
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = p_file_id AND NOT c.is_vacancy AND c.is_primary AND c.hidden_at IS NULL
    ), prev AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, c.*,
             COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             (SELECT j.job_id FROM public.org_card_jobs j WHERE j.card_id = c.id AND j.is_primary LIMIT 1) AS job_id,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = v_prev AND NOT c.is_vacancy AND c.is_primary AND c.hidden_at IS NULL
    ), cur_cc AS (   -- 겸직 카드 (사람 키 + 단위 키)
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = p_file_id AND NOT c.is_primary AND c.hidden_at IS NULL
    ), prev_cc AS (
      SELECT COALESCE(c.profile_id::text, 'p:' || c.person_id::text) AS key, COALESCE(u.code, u.name) AS unit_key, u.name AS unit_name,
             COALESCE(p.name, pe.name, c.display_name) AS label
        FROM public.org_cards c JOIN public.org_units u ON u.id = c.unit_id
        LEFT JOIN public.profiles p ON p.id = c.profile_id LEFT JOIN public.org_persons pe ON pe.id = c.person_id
       WHERE c.file_id = v_prev AND NOT c.is_primary AND c.hidden_at IS NULL
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

  -- ── 숨김 카드 자동 제거 (설계 §12.2) — 단위장 참조 해제 → 겸직 먼저 → 본 카드 ──
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
  SELECT count(*) INTO v_units FROM public.org_units WHERE file_id = p_file_id;
  SELECT count(*) INTO v_cards FROM public.org_cards WHERE file_id = p_file_id AND NOT is_vacancy AND is_primary;
  RETURN jsonb_build_object('file_id', p_file_id, 'file_name', v_f.name, 'prev_file_id', v_prev, 'prev_file_name', v_prev_name,
                            'effective_on', v_f.effective_on, 'units', v_units, 'cards', v_cards, 'hidden_removed', v_hidden,
                            'diff_count', v_cnt, 'diff', v_diff, 'ghost_count', v_check->'ghost_count',
                            'missing_count', v_check->'missing_count');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [F] org_copy_file — Phase 2 [E] 원문 + is_primary · hidden_at
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
  DELETE FROM _org_map;
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

-- ────────────────────────────────────────────────────────────────────────────
-- [G-2] 권한 · 검증
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.org_set_card_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_set_card_hidden(uuid, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.org_swap_primary_card(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_swap_primary_card(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='org_cards' AND column_name='is_primary') THEN RAISE EXCEPTION '[검증] is_primary 없음'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='org_cards_file_profile_primary') THEN RAISE EXCEPTION '[검증] 본 카드 유일 인덱스 없음'; END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='org_cards_file_profile') THEN RAISE EXCEPTION '[검증] 구 유일 인덱스 잔존'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_activate_file') NOT LIKE '%concurrent_added%' THEN RAISE EXCEPTION '[검증] activate 겸직 diff 미반영'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname='org_roster_check') NOT LIKE '%departure_scheduled_on%' THEN RAISE EXCEPTION '[검증] roster 퇴사 경과 제외 미반영'; END IF;
  RAISE NOTICE '[검증] ORG Phase 5-B 전 항목 통과';
END $$;

COMMIT;
