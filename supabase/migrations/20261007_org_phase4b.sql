-- ============================================================================
-- 20261007_org_phase4b.sql
-- 조직도(ORG) Phase 4-B — 알림 경로 일원화 · 퇴사 시스템 잔여 확인
--
-- 전제: 20261006_org_phase2.sql 적용 완료
--
-- 범위
--   [A] org_activate_file 재정의 — 인앱 INSERT 제거(알림은 send-notification org_activated 가 이메일+인앱 담당), 반환값에
--       file_name · prev_file_name · units · cards 추가 (프론트가 payload.booking.org 로 그대로 전달)
--   [B] org_offboarding_system_check(p_profile_id) — 도서 미반납 · 미래 자원예약 · 어드민 역할 (org 담당자는 해당 테이블 RLS 없음 → SECURITY DEFINER)
--   [C] 권한 · 검증
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] org_activate_file — 20261006 [F] 원문 + 변경 2곳 (인앱 루프 제거 · 반환 보강)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_activate_file(p_file_id uuid, p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_f public.org_files%ROWTYPE; v_prev uuid; v_check jsonb; v_cnt int;
  v_diff jsonb; v_prev_name text; v_units int; v_cards int;
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

  -- ← [2026-10-01 Phase 4-B] 인앱 INSERT 제거 — 알림은 프론트가 send-notification(org_activated) 으로 발사 (이메일+인앱, 채널 설정·개인 설정·로그 일원화)

  SELECT name INTO v_prev_name FROM public.org_files WHERE id = v_prev;
  SELECT count(*) INTO v_units FROM public.org_units WHERE file_id = p_file_id;
  SELECT count(*) INTO v_cards FROM public.org_cards WHERE file_id = p_file_id AND NOT is_vacancy;
  RETURN jsonb_build_object('file_id', p_file_id, 'file_name', v_f.name, 'prev_file_id', v_prev, 'prev_file_name', v_prev_name,
                            'effective_on', v_f.effective_on, 'units', v_units, 'cards', v_cards,
                            'diff_count', v_cnt, 'diff', v_diff, 'ghost_count', v_check->'ghost_count',
                            'missing_count', v_check->'missing_count');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 퇴사 시스템 잔여 확인 — 반납 체크리스트 아래 읽기 전용 표시용 (실제 회수는 process_departure 가 수행)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_offboarding_system_check(p_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_books jsonb; v_res jsonb; v_roles text[]; v_future_rooms int;
BEGIN
  PERFORM public.org_assert_org();
  SELECT COALESCE(jsonb_agg(jsonb_build_object('title', b.title, 'due_at', c.due_at) ORDER BY c.due_at), '[]'::jsonb)
    INTO v_books
    FROM public.book_checkouts c JOIN public.books b ON b.id = c.book_id
   WHERE c.user_id = p_profile_id AND c.status = 'active';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('label', i.label, 'start_at', r.start_at, 'end_at', r.end_at) ORDER BY r.start_at), '[]'::jsonb)
    INTO v_res
    FROM public.resource_bookings r JOIN public.resource_items i ON i.id = r.item_id
   WHERE r.user_id = p_profile_id AND r.status = 'confirmed' AND r.returned_at IS NULL AND (r.end_at >= now() OR r.occupied_until >= now());
  SELECT COALESCE(array_agg(role ORDER BY role), '{}') INTO v_roles FROM public.admin_roles WHERE user_id = p_profile_id;
  SELECT count(*) INTO v_future_rooms FROM public.bookings WHERE user_id = p_profile_id AND status IN ('confirmed','pending') AND start_at > now();
  RETURN jsonb_build_object('profile_id', p_profile_id,
                            'books', v_books, 'book_count', jsonb_array_length(v_books),
                            'resources', v_res, 'resource_count', jsonb_array_length(v_res),
                            'admin_roles', to_jsonb(v_roles), 'admin_role_count', COALESCE(array_length(v_roles, 1), 0),
                            'future_room_bookings', v_future_rooms);
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 권한 · 검증
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.org_offboarding_system_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_offboarding_system_check(uuid) TO authenticated, service_role;

DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'org_activate_file') LIKE '%INSERT INTO public.notifications%' THEN
    RAISE EXCEPTION '[검증] org_activate_file 에 인앱 INSERT 잔존';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'org_activate_file') NOT LIKE '%prev_file_name%' THEN
    RAISE EXCEPTION '[검증] org_activate_file 반환 보강 미반영';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'org_offboarding_system_check') THEN
    RAISE EXCEPTION '[검증] org_offboarding_system_check 없음';
  END IF;
  RAISE NOTICE '[검증] ORG Phase 4-B 전 항목 통과';
END $$;

COMMIT;
