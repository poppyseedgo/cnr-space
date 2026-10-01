-- ============================================================================
-- _import_org_20261001_concurrent.sql — 엑셀 이관 파일의 (겸) 단위장 14건을 겸직 카드로 변환 (Phase 5-B 후속)
--
-- 전제: 20261009_org_phase5b.sql 적용. 이관 당시(Phase 5-A)는 다인카드가 없어 head_card_id 로만 연결했음.
-- 동작: 단위장 카드가 다른 단위에 있는 단위마다 → 그 단위에 겸직 카드(is_primary=false, is_unit_head=true, 엑셀의 (겸) 직무) 생성 → head_card_id 교체
-- 멱등: 이미 그 단위에 같은 사람 카드가 있으면 건너뜀
-- ============================================================================
DO $$
DECLARE
  v_file uuid; r record; v_card uuid; v_job uuid; v_n int := 0;
  -- 엑셀 (겸) 표기: 단위명 → 직무 코드 (이관 stage 원본)
  spec jsonb := '{"Data Management Division":"CPO","Biostat2":"BSDH","EA":"DXM","기업부설연구소":"DXM","Finance1":"FNM","경영관리팀":"FNM","BD3":"HBO","RA2":"RAM","RWL1":"COM","Medical2-2":"Mgr","PV2":"Mgr","Biostat1-1":"Mgr","Biostat1-2":"Mgr","SP3":"Mgr"}'::jsonb;
BEGIN
  SELECT id INTO v_file FROM public.org_files WHERE name = '2026-10-01 조직도 (엑셀 이관)' AND status = 'draft';
  IF v_file IS NULL THEN RAISE EXCEPTION '[겸직 변환] 이관 초안 파일 없음'; END IF;

  FOR r IN
    SELECT u.id AS unit_id, u.name AS unit_name, h.profile_id, h.person_id
      FROM public.org_units u JOIN public.org_cards h ON h.id = u.head_card_id
     WHERE u.file_id = v_file AND h.unit_id <> u.id
  LOOP
    IF spec ? r.unit_name THEN
      SELECT id INTO v_job FROM public.org_jobs WHERE code = spec->>r.unit_name;
      IF v_job IS NULL THEN RAISE EXCEPTION '[겸직 변환] 직무 코드 없음: %', spec->>r.unit_name; END IF;
    ELSE
      v_job := NULL;   -- 엑셀 표기 없음 → 직무 없이 생성 (어드민에서 지정)
    END IF;
    IF EXISTS (SELECT 1 FROM public.org_cards c WHERE c.unit_id = r.unit_id AND (c.profile_id = r.profile_id OR c.person_id = r.person_id)) THEN CONTINUE; END IF;

    INSERT INTO public.org_cards (file_id, unit_id, profile_id, person_id, is_primary, is_unit_head, memo, sort_order)
    VALUES (v_file, r.unit_id, r.profile_id, r.person_id, false, true, '엑셀 이관: (겸) 단위장', 0)
    RETURNING id INTO v_card;
    IF v_job IS NOT NULL THEN
      INSERT INTO public.org_card_jobs (card_id, job_id, is_primary, sort_order) VALUES (v_card, v_job, true, 0);
    END IF;
    UPDATE public.org_units SET head_card_id = v_card WHERE id = r.unit_id;
    v_n := v_n + 1;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.org_units u JOIN public.org_cards h ON h.id = u.head_card_id WHERE u.file_id = v_file AND h.unit_id <> u.id) THEN
    RAISE EXCEPTION '[검증] 타 단위 카드를 가리키는 단위장이 남아 있음';
  END IF;
  RAISE NOTICE '[겸직 변환] file=% 겸직 카드 생성=% 겸직 카드 총=%', v_file, v_n, (SELECT count(*) FROM public.org_cards WHERE file_id = v_file AND NOT is_primary);
END $$;
