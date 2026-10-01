-- ============================================================================
-- _import_org_20261001.sql — 2026.10.01 조직도.xlsx → 초안 파일 1회 이관 (Phase 5)
--
-- 전제: org_import_stage_units / org_import_stage_cards 적재 완료 (org-deliverables/p5/build_stage.py 산출),
--       20261008_org_phase5.sql(org_display_names) 적용.
-- 실행: 전체를 한 트랜잭션으로. 실패 시 전부 롤백. 끝의 검증 블록이 기대 수치와 다르면 RAISE.
-- 설정값: :creator = 생성자 profiles.id (고현정) — 아래 v_creator
--
-- 매핑 규칙 (2026-10-01 확정)
--   1) 한글 이름 1:1(split_part(profiles.name,'_',1) = 엑셀 이름, 후보 1명) → 자동
--   2) 동명이인 → 부서 힌트 자동 + 수동 확정 7건 (아래 man)
--   3) 영문 프로필 로마자 대응 25건 (man) — 김유진(RWL3)→Yujin Kim 포함
--   4) 프로필 없음(박석준·김수아) → org_persons(프로필 없는 카드)
--   5) profiles.name ≠ 엑셀 이름이면 org_display_names 에 엑셀 이름 등록 (Azure 이름 유지 + 조직도 표기 이름)
--   6) (겸) 단위장 → 카드 중복 없이 org_units.head_card_id 만 연결
--   7) Medica2/3 → Medical2/3, 두 번째 'Medical Operation Division'(DM1~3) → 'Data Management Division', 루트에 CEO 윤문태 단위장 카드
-- ============================================================================
BEGIN;

DO $$
DECLARE
  v_creator uuid := '0120852b-faae-4903-9515-c9c28ecaf76b';   -- 고현정
  v_ceo     uuid := 'c3c45d73-cb2d-46dd-a031-ef79903e668c';   -- 윤문태 (CEO)
  v_file uuid; r record; v_unit uuid; v_card uuid; v_job uuid; v_rank uuid; v_person uuid; v_head uuid;
  n_units int; n_cards int; n_heads int; n_names int; n_persons int; n_nohead int;
BEGIN
  -- ── 0. 매핑 테이블 ──
  CREATE TEMP TABLE map (n int PRIMARY KEY, profile_id uuid) ON COMMIT DROP;
  -- 0-a 수동 확정 (엑셀 n → profiles.name)
  CREATE TEMP TABLE man (n int PRIMARY KEY, pname text NOT NULL) ON COMMIT DROP;
  INSERT INTO man VALUES
    -- 동명이인 수동
    (69,'조아라_RWO'), (83,'김민정_DM1'), (220,'김민정_DM3'), (283,'박지은'), (224,'박지은_Stat'), (395,'Jane Minjeong Kim_CTM'), (509,'김한나_CPRI'),
    -- 영문 프로필 로마자 대응
    (6,'MiSook Hyun'), (5,'Jinhak Kim'), (19,'Hyunji Seo'), (50,'Hyunji Seo'), (56,'Boramyi Lee_C&R'), (72,'Sojung Kang'), (106,'Jeongsoo Ahn'),
    (114,'Heeyoon Ryu'), (121,'Hyejin Lee'), (178,'Sarang Oh'), (179,'Jaehyun Park'), (202,'Suji Ahn'), (239,'엄영선_youngsun um'), (240,'Seonha Jeong'),
    (262,'Doojin Kim'), (295,'Sora Huh'), (346,'Inkyung Park'), (349,'Hyeonjin Park_Jenny'), (351,'Sunah Chung'), (396,'Yeji Choi'),
    (408,'Yejin Hyun'), (409,'Byoungmoon Min'), (467,'Ara Oh'), (478,'Eunmin Byun'),
    (317,'Yujin Kim');   -- RWL3 PLⅠ김유진 — 한글 1:1 이 김유진_CO(CO2-2 김유진B) 와 충돌 → RWO 영문 프로필
  INSERT INTO map SELECT m.n, p.id FROM man m JOIN public.profiles p ON p.name = m.pname;
  IF (SELECT count(*) FROM map) <> (SELECT count(*) FROM man) THEN
    RAISE EXCEPTION '[이관] 수동 매핑 이름이 profiles 에 없음: %', (SELECT string_agg(pname, ', ') FROM man WHERE n NOT IN (SELECT n FROM map));
  END IF;
  -- 0-b 한글 1:1
  INSERT INTO map
  SELECT c.n, (SELECT p.id FROM public.profiles p WHERE p.employee_id <> '' AND split_part(p.name,'_',1) = c.name)
    FROM public.org_import_stage_cards c
   WHERE NOT c.is_vacancy AND c.n NOT IN (SELECT n FROM map)
     AND (SELECT count(*) FROM public.profiles p WHERE p.employee_id <> '' AND split_part(p.name,'_',1) = c.name) = 1;
  -- 0-c 동명이인 부서 힌트 (후보 2+ 중 단위 경로에 부서 키가 1명만 걸리는 경우)
  WITH RECURSIVE t AS (
    SELECT k, name AS path FROM public.org_import_stage_units WHERE parent_k IS NULL
    UNION ALL SELECT u.k, t.path||' > '||u.name FROM public.org_import_stage_units u JOIN t ON t.k = u.parent_k
  ), p AS (
    SELECT id, split_part(name,'_',1) AS base,
           upper(CASE WHEN dept ILIKE 'Biostat%' OR dept ILIKE 'STAT%' THEN 'BIOSTAT' WHEN dept = 'MD' THEN 'MEDICAL DEVICE'
                      WHEN dept ILIKE 'Medical %' THEN replace(dept,' ','') WHEN dept = 'Management Administration' THEN '경영관리'
                      WHEN dept = 'Clinical Platform Research Institute' THEN '기업부설연구소' WHEN dept = 'EDC' THEN 'DM'
                      ELSE split_part(dept,' ',1) END) AS key
      FROM public.profiles WHERE employee_id <> ''
  ), hit AS (
    SELECT c.n, p.id, count(*) OVER (PARTITION BY c.n) AS hits
      FROM public.org_import_stage_cards c JOIN t ON t.k = c.unit_k JOIN p ON p.base = c.name
     WHERE c.n NOT IN (SELECT n FROM map) AND NOT c.is_vacancy
       AND (upper(t.path) LIKE '%'||p.key||'%' OR (p.key = 'BIOSTAT' AND upper(t.path) LIKE '%BS DIVISION%'))
  )
  INSERT INTO map SELECT n, id FROM hit WHERE hits = 1;

  -- ── 1. 파일 ──
  INSERT INTO public.org_files (name, status, effective_on, memo, created_by, updated_by)
  VALUES ('2026-10-01 조직도 (엑셀 이관)', 'draft', DATE '2026-10-01',
          '2026.10.01 조직도.xlsx 1회 이관 — 단위 100 · 엑셀 표기 509행. 매핑: 한글 1:1 + 동명이인 부서판별 + 영문 프로필 로마자 24건. 확인 필요: 박지은 2명(엑셀 순서대로 연결), 프로필 없음 2명(박석준·김수아)',
          v_creator, v_creator)
  RETURNING id INTO v_file;

  -- ── 2. 단위 (부모 먼저: 재귀 깊이 순) ──
  CREATE TEMP TABLE umap (k text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;
  FOR r IN
    WITH RECURSIVE t AS (
      SELECT k, parent_k, name, sort_order, 0 AS depth FROM public.org_import_stage_units WHERE parent_k IS NULL
      UNION ALL SELECT u.k, u.parent_k, u.name, u.sort_order, t.depth + 1 FROM public.org_import_stage_units u JOIN t ON t.k = u.parent_k)
    SELECT * FROM t ORDER BY depth, sort_order
  LOOP
    INSERT INTO public.org_units (file_id, parent_unit_id, name, sort_order)
    VALUES (v_file, (SELECT id FROM umap WHERE k = r.parent_k),
            CASE r.k WHEN 'JN18' THEN 'Medical2' WHEN 'JW18' THEN 'Medical3' WHEN 'LM15' THEN 'Data Management Division' ELSE r.name END,
            r.sort_order)
    RETURNING id INTO v_unit;
    INSERT INTO umap VALUES (r.k, v_unit);
  END LOOP;

  -- ── 3. 카드 (겸직 단위장 제외) ──
  CREATE TEMP TABLE cmap (n int PRIMARY KEY, card_id uuid NOT NULL) ON COMMIT DROP;
  FOR r IN SELECT c.*, m.profile_id FROM public.org_import_stage_cards c LEFT JOIN map m ON m.n = c.n WHERE NOT c.concurrent ORDER BY c.n LOOP
    v_person := NULL;
    IF NOT r.is_vacancy AND r.profile_id IS NULL THEN
      -- 프로필 없음 → org_persons (프로필 없는 카드). sync 시 이메일 일치하면 자동 연결(이메일은 어드민에서 입력)
      INSERT INTO public.org_persons (name, created_by) VALUES (r.name, v_creator) RETURNING id INTO v_person;
    END IF;
    SELECT id INTO v_rank FROM public.org_ranks WHERE code = r.rank_code;
    INSERT INTO public.org_cards (file_id, unit_id, profile_id, person_id, display_name, rank_id, is_unit_head, is_vacancy, employment_type, work_location, fte, memo, sort_order)
    VALUES (v_file, (SELECT id FROM umap WHERE k = r.unit_k), r.profile_id, v_person,
            CASE WHEN r.is_vacancy THEN r.raw ELSE NULL END,
            v_rank, r.is_head, r.is_vacancy,
            CASE WHEN r.flag = '계약' THEN 'contract' WHEN r.job_code IN ('인턴','CRA Intern','PV Intern') THEN 'intern' ELSE 'regular' END,
            r.work_location, r.fte,
            NULLIF(concat_ws(' · ',
              CASE WHEN r.flag = '퇴사예정' THEN '엑셀: 퇴사예정(일자 미기재 — 상태 등록 필요)' END,
              CASE WHEN r.hint IS NOT NULL THEN '엑셀 표기: '||r.raw END,
              CASE WHEN NOT r.is_vacancy AND r.profile_id IS NULL THEN '엑셀 이관: Azure 프로필 없음' END), ''),
            r.n)
    RETURNING id INTO v_card;
    INSERT INTO cmap VALUES (r.n, v_card);
    IF r.job_code IS NOT NULL THEN
      SELECT id INTO v_job FROM public.org_jobs WHERE code = r.job_code;
      IF v_job IS NULL THEN RAISE EXCEPTION '[이관] 직무 코드 없음: % (n=%)', r.job_code, r.n; END IF;
      INSERT INTO public.org_card_jobs (card_id, job_id, is_primary, sort_order) VALUES (v_card, v_job, true, 0);
    END IF;
    -- 표기 이름: Azure 이름 ≠ 엑셀 이름
    IF r.profile_id IS NOT NULL AND (SELECT name FROM public.profiles WHERE id = r.profile_id) <> r.name THEN
      INSERT INTO public.org_display_names (profile_id, display_name, note, updated_by)
      VALUES (r.profile_id, r.name, '엑셀 이관 2026-10-01', v_creator) ON CONFLICT (profile_id) DO NOTHING;
    END IF;
  END LOOP;

  -- ── 3-b. 루트 CEO 카드 ──
  INSERT INTO public.org_cards (file_id, unit_id, profile_id, is_unit_head, sort_order, memo)
  VALUES (v_file, (SELECT id FROM umap WHERE k = 'GM3'), v_ceo, true, 0, '엑셀 루트 박스 "C&R Research / CEO"')
  RETURNING id INTO v_card;
  UPDATE public.org_units SET head_card_id = v_card WHERE id = (SELECT id FROM umap WHERE k = 'GM3');

  -- ── 4. 단위장 연결 ──
  -- 4-a 전임 단위장: 본인 카드
  UPDATE public.org_units u SET head_card_id = cm.card_id
    FROM public.org_import_stage_cards c JOIN cmap cm ON cm.n = c.n JOIN umap um ON um.k = c.unit_k
   WHERE c.is_head AND NOT c.concurrent AND u.id = um.id;
  -- 4-b (겸) 단위장: 같은 사람의 본 카드(이 파일 안)
  FOR r IN SELECT c.*, m.profile_id FROM public.org_import_stage_cards c LEFT JOIN map m ON m.n = c.n WHERE c.concurrent LOOP
    SELECT id INTO v_head FROM public.org_cards WHERE file_id = v_file AND profile_id = r.profile_id;
    IF v_head IS NULL THEN RAISE EXCEPTION '[이관] 겸직 단위장 본 카드 없음: % (n=%)', r.raw, r.n; END IF;
    UPDATE public.org_units SET head_card_id = v_head WHERE id = (SELECT id FROM umap WHERE k = r.unit_k);
  END LOOP;

  -- ── 5. 검증 ──
  SELECT count(*) INTO n_units  FROM public.org_units WHERE file_id = v_file;
  SELECT count(*) INTO n_cards  FROM public.org_cards WHERE file_id = v_file;
  SELECT count(*) INTO n_heads  FROM public.org_units WHERE file_id = v_file AND head_card_id IS NOT NULL;
  SELECT count(*) INTO n_nohead FROM public.org_units WHERE file_id = v_file AND head_card_id IS NULL;
  SELECT count(*) INTO n_names  FROM public.org_display_names WHERE note = '엑셀 이관 2026-10-01';
  SELECT count(*) INTO n_persons FROM public.org_cards WHERE file_id = v_file AND person_id IS NOT NULL;
  IF n_units <> 100 THEN RAISE EXCEPTION '[검증] 단위 수 % ≠ 100', n_units; END IF;
  IF n_cards <> (SELECT count(*) FROM public.org_import_stage_cards WHERE NOT concurrent) + 1 THEN RAISE EXCEPTION '[검증] 카드 수 %', n_cards; END IF;
  IF n_persons <> 2 THEN RAISE EXCEPTION '[검증] 프로필 없는 카드 % ≠ 2', n_persons; END IF;
  RAISE NOTICE '[이관] file=% 단위=% 카드=% 단위장 연결=% 미연결 단위=% 표기이름=% 프로필없음=%', v_file, n_units, n_cards, n_heads, n_nohead, n_names, n_persons;
END $$;

COMMIT;
