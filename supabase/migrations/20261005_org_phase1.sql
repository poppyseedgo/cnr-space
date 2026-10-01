-- ============================================================================
-- 20261005_org_phase1.sql
-- 조직도(ORG) Phase 1 — DB 기반
--
-- 범위
--   [A] admin_roles CHECK 에 'org' 추가 (현행 정의를 읽어 값 1개만 append — 20260929 [A] 와 동일 방식)
--   [B] 코드 테이블 4종 (org_status_types · org_ranks · org_jobs · org_offboarding_templates) + 시드
--   [C] 본 테이블 9종 (org_files · org_units · org_persons · org_cards · org_card_jobs ·
--       org_person_status · org_offboarding_items · org_change_log · org_activation_diffs) + 인덱스
--   [D] 가드 트리거 — Active 1개 · archived 보호 · 파일 수명주기 RPC 전용 · 단위 동일파일/순환 금지 ·
--       초안 외 편집 차단 · 코드 시스템값 보호 · 변경 로그(전 테이블) · 파일 updated_at 갱신
--   [E] RLS — 전 테이블 has_admin_role('org') 게이트, 초안 파일만 직접 편집
--   [F] 권한(REVOKE 기본권한 → GRANT) · 자기 검증 DO 블록
--
-- 설계 근거 (설계서 §7 · 2026-10-01 확정)
--   · 카드의 사람 참조(profile_id)는 FK 없이 uuid 만 — process_departure 가 profiles 를 DELETE 하므로
--     FK 를 걸면 퇴사와 함께 카드가 사라진다(workboard 와 동일 원칙). 퇴사 판정 = profiles 부재 + departed_users 존재.
--   · 상태(org_person_status)는 파일 밖 '사람 소속' 데이터 — 어느 초안에서 봐도 같은 값.
--     profiles.employment_status 동기화는 Phase 2 RPC(org_set_person_status) 에서. Phase 1 은 테이블만.
--   · 파일 수명주기(draft→active→archived)는 RPC(Phase 2 org_activate_file) 안에서만 —
--     트리거가 GUC `org.lifecycle = 'on'` 없는 status 변경을 거부한다.
--   · 변경 로그는 **트리거**(쓰기 경로가 UI 직접쓰기·RPC·SQL 셋이라 호출부마다 붙이면 빠진다 — admin_roles Phase 2 와 같은 이유).
--   · 전부 멱등 — 재실행 안전. 트랜잭션 1개로 묶어 중간 실패 시 전체 롤백.
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run
-- 검증: _diagnose_org_20261001.sql 실행 → 전 항목 ✅ 확인
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] admin_roles CHECK 확장 — 값을 하드코딩하지 않는다 (실측 2026-10-01: 15종, workboard 포함)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_name text; v_def text; v_new text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.admin_roles'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%role = ANY%';
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'admin_roles 의 role CHECK 제약을 찾을 수 없음 — 수동 확인 필요';
  END IF;
  IF v_def LIKE '%''org''%' THEN
    RAISE NOTICE '[A] 이미 org 포함 — 건너뜀 (%)', v_name;
    RETURN;
  END IF;
  v_new := replace(v_def, 'ARRAY[', 'ARRAY[''org''::text, ');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'CHECK 정의 형태가 예상과 다름: %', v_def;
  END IF;
  EXECUTE format('ALTER TABLE public.admin_roles DROP CONSTRAINT %I', v_name);
  EXECUTE format('ALTER TABLE public.admin_roles ADD CONSTRAINT %I %s', v_name, v_new);
  RAISE NOTICE '[A] % 재정의 완료 → %', v_name, v_new;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 코드 테이블 — enum 은 text + CHECK (프로젝트 관례)
-- ────────────────────────────────────────────────────────────────────────────

-- B-1 상태 코드 (10/1 확정 7종 + 수동 추가 가능)
CREATE TABLE IF NOT EXISTS public.org_status_types (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  category    text NOT NULL CHECK (category IN ('hire_planned','departing','leave_planned','leave','return_planned')),
  color       text NOT NULL DEFAULT 'slate',           -- 프론트 토큰 키 (orgStatus.ts 에서 매핑)
  sort_order  integer NOT NULL DEFAULT 0,
  is_system   boolean NOT NULL DEFAULT false,          -- 시스템 7종: 삭제·category 변경 금지
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_status_types_code_fmt CHECK (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  CONSTRAINT org_status_types_label_nonempty CHECK (length(btrim(label)) > 0)
);
COMMENT ON TABLE public.org_status_types IS '[ORG] 인사 상태 코드. category 가 동기화·자동전환 규칙을 결정(설계서 §5.4). is_system 행은 삭제 불가';

INSERT INTO public.org_status_types (code, label, category, color, sort_order, is_system) VALUES
  ('hire_planned',    '입사예정', 'hire_planned',   'teal',   10, true),
  ('departing',       '퇴사예정', 'departing',      'amber',  20, true),
  ('leave_planned',   '휴직예정', 'leave_planned',  'violet', 30, true),
  ('maternity_leave', '출산휴가', 'leave',          'violet', 40, true),
  ('parental_leave',  '육아휴직', 'leave',          'violet', 50, true),
  ('leave',           '휴직',     'leave',          'violet', 60, true),
  ('return_planned',  '복직예정', 'return_planned', 'indigo', 70, true)
ON CONFLICT (code) DO NOTHING;

-- B-2 직급 (엑셀 실측: 임원만 표기 — 사장·부사장·전무·상무·이사·실장)
CREATE TABLE IF NOT EXISTS public.org_ranks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  level       integer NOT NULL DEFAULT 0,              -- 클수록 상위. hierarchy 정렬 1순위
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.org_ranks IS '[ORG] 직급 코드. level 이 카드 정렬 1순위(없으면 직무 level)';
INSERT INTO public.org_ranks (code, label, level, sort_order) VALUES
  ('president',      '사장',   100, 10),
  ('vice_president', '부사장',  90, 20),
  ('evp',            '전무',    80, 30),
  ('svp',            '상무',    70, 40),
  ('director',       '이사',    60, 50),
  ('office_head',    '실장',    50, 60)
ON CONFLICT (code) DO NOTHING;

-- B-3 직무 (엑셀 실측 105 변형 → 정규화 99종. aliases 로 표기 변형 흡수. label 은 약어 그대로(풀네임 추정 금지 — 어드민에서 편집), level 은 초기값)
CREATE TABLE IF NOT EXISTS public.org_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                    -- 표시 약어 그대로 (CRM, Sr.CRA …)
  label       text NOT NULL,
  level       integer NOT NULL DEFAULT 40,             -- 95 C-level · 80 Head · 70 Manager · 60 Principal · 50 Sr. · 42 II · 41 I · 40 일반 · 10 인턴
  aliases     text[] NOT NULL DEFAULT '{}',            -- 엑셀 이관 매칭용 (Sr.BSⅠ, Sr.BS1 …)
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.org_jobs IS '[ORG] 직무 코드. 카드당 복수(org_card_jobs). level 이 직급 없는 카드의 hierarchy 정렬 기준';
INSERT INTO public.org_jobs (code, label, level, aliases, sort_order) VALUES
  ('CPO', 'CPO', 95, '{}'::text[], 10),
  ('CCO', 'CCO', 95, '{}'::text[], 20),
  ('CDO', 'CDO', 95, '{}'::text[], 30),
  ('DXM', 'DXM', 80, '{}'::text[], 40),
  ('HBO', 'HBO', 80, '{}'::text[], 50),
  ('HRA', 'HRA', 40, '{}'::text[], 60),
  ('CDIM', 'CDIM', 80, '{}'::text[], 70),
  ('HBS', 'HBS', 80, '{}'::text[], 80),
  ('HCO', 'HCO', 80, '{}'::text[], 90),
  ('HCTM', 'HCTM', 80, '{}'::text[], 100),
  ('MSM', 'MSM', 80, '{}'::text[], 110),
  ('CRM', 'CRM', 70, '{}'::text[], 120),
  ('DMPM', 'DMPM', 70, '{}'::text[], 130),
  ('Mgr', 'Mgr', 70, '{}'::text[], 140),
  ('CTMM', 'CTMM', 70, '{}'::text[], 150),
  ('CDMM', 'CDMM', 70, '{}'::text[], 160),
  ('COM', 'COM', 70, '{}'::text[], 170),
  ('FNM', 'FNM', 70, '{}'::text[], 180),
  ('PMgr', 'PMgr', 70, '{}'::text[], 190),
  ('BSPM', 'BSPM', 70, '{}'::text[], 200),
  ('DMTM', 'DMTM', 70, '{}'::text[], 210),
  ('MM', 'MM', 70, '{}'::text[], 220),
  ('MPM', 'MPM', 70, '{}'::text[], 230),
  ('SPPM', 'SPPM', 70, '{}'::text[], 240),
  ('BDM', 'BDM', 70, '{}'::text[], 250),
  ('RAM', 'RAM', 70, '{}'::text[], 260),
  ('SSUM', 'SSUM', 70, '{}'::text[], 270),
  ('BSM', 'BSM', 70, '{}'::text[], 280),
  ('CSS Mgr', 'CSS Mgr', 70, '{}'::text[], 290),
  ('DSPM', 'DSPM', 70, '{}'::text[], 300),
  ('ISS', 'ISS', 70, '{}'::text[], 310),
  ('MDM', 'MDM', 70, '{}'::text[], 320),
  ('PVM', 'PVM', 70, '{}'::text[], 330),
  ('PVPM', 'PVPM', 70, '{}'::text[], 340),
  ('QMM', 'QMM', 70, '{}'::text[], 350),
  ('SAPM', 'SAPM', 70, '{}'::text[], 360),
  ('SPM', 'SPM', 70, '{}'::text[], 370),
  ('SQA', 'SQA', 70, '{}'::text[], 380),
  ('BS Advisor', 'BS Advisor', 65, '{}'::text[], 390),
  ('Principal SIS', 'Principal SIS', 60, '{}'::text[], 400),
  ('Principal CRA', 'Principal CRA', 60, '{}'::text[], 410),
  ('Sr.CRA', 'Sr.CRA', 50, '{}'::text[], 420),
  ('Sr.DMA', 'Sr.DMA', 50, '{}'::text[], 430),
  ('Sr.CDMA', 'Sr.CDMA', 50, '{}'::text[], 440),
  ('Sr.BSI', 'Sr.BSI', 50, ARRAY['Sr.BS1','Sr.BSⅠ']::text[], 450),
  ('Sr.MW', 'Sr.MW', 50, '{}'::text[], 460),
  ('Sr.PL', 'Sr.PL', 50, '{}'::text[], 470),
  ('Sr.SP', 'Sr.SP', 50, '{}'::text[], 480),
  ('Sr.SIS', 'Sr.SIS', 50, ARRAY['SR.SIS']::text[], 490),
  ('Sr.DMAII', 'Sr.DMAII', 50, ARRAY['Sr.DMAⅡ']::text[], 500),
  ('Sr.BDA', 'Sr.BDA', 50, '{}'::text[], 510),
  ('Sr.CDMAII', 'Sr.CDMAII', 50, ARRAY['Sr.CDMAⅡ']::text[], 520),
  ('Sr.BS', 'Sr.BS', 50, '{}'::text[], 530),
  ('Sr.BSII', 'Sr.BSII', 50, ARRAY['Sr.BSⅡ']::text[], 540),
  ('Sr.BSIII', 'Sr.BSIII', 50, ARRAY['Sr.BSⅢ']::text[], 550),
  ('Sr.CSS', 'Sr.CSS', 50, ARRAY['Sr. CSS']::text[], 560),
  ('Sr.QMA', 'Sr.QMA', 50, '{}'::text[], 570),
  ('Sr.QML', 'Sr.QML', 50, '{}'::text[], 580),
  ('Sr.SA', 'Sr.SA', 50, '{}'::text[], 590),
  ('Sr.SE', 'Sr.SE', 50, '{}'::text[], 600),
  ('CRAII', 'CRAII', 42, ARRAY['CRA II','CRAⅡ']::text[], 610),
  ('PLII', 'PLII', 42, ARRAY['PLⅡ']::text[], 620),
  ('BDAII', 'BDAII', 42, '{}'::text[], 630),
  ('BDAI', 'BDAI', 41, '{}'::text[], 640),
  ('PLI', 'PLI', 41, ARRAY['PLⅠ']::text[], 650),
  ('PL', 'PL', 40, '{}'::text[], 660),
  ('CRA', 'CRA', 40, '{}'::text[], 670),
  ('PCRA', 'PCRA', 45, '{}'::text[], 680),
  ('DMA', 'DMA', 40, '{}'::text[], 690),
  ('CSS', 'CSS', 40, '{}'::text[], 700),
  ('RAA', 'RAA', 40, '{}'::text[], 710),
  ('SE', 'SE', 40, '{}'::text[], 720),
  ('PVA', 'PVA', 40, '{}'::text[], 730),
  ('APD', 'APD', 40, '{}'::text[], 740),
  ('SP', 'SP', 40, '{}'::text[], 750),
  ('CDMA', 'CDMA', 40, '{}'::text[], 760),
  ('FNA', 'FNA', 40, '{}'::text[], 770),
  ('MW', 'MW', 40, '{}'::text[], 780),
  ('PVS', 'PVS', 40, '{}'::text[], 790),
  ('CMS', 'CMS', 40, '{}'::text[], 800),
  ('MMA', 'MMA', 40, '{}'::text[], 810),
  ('SIS', 'SIS', 40, '{}'::text[], 820),
  ('BMS', 'BMS', 40, '{}'::text[], 830),
  ('MSA', 'MSA', 40, '{}'::text[], 840),
  ('Remote PL', 'Remote PL', 40, '{}'::text[], 850),
  ('AXE', 'AXE', 40, '{}'::text[], 860),
  ('BDA', 'BDA', 40, '{}'::text[], 870),
  ('Biostat', 'Biostat', 40, '{}'::text[], 880),
  ('DSS', 'DSS', 40, '{}'::text[], 890),
  ('GAA', 'GAA', 40, '{}'::text[], 900),
  ('QMA', 'QMA', 40, '{}'::text[], 910),
  ('RAS', 'RAS', 40, '{}'::text[], 920),
  ('BSDH', 'BSDH', 80, '{}'::text[], 930),
  ('MA', 'MA', 40, '{}'::text[], 940),
  ('MAA', 'MAA', 40, '{}'::text[], 950),
  ('QML', 'QML', 40, '{}'::text[], 960),
  ('인턴', '인턴', 10, '{}'::text[], 970),
  ('CRA Intern', 'CRA Intern', 10, '{}'::text[], 980),
  ('PV Intern', 'PV Intern', 10, '{}'::text[], 990)
ON CONFLICT (code) DO NOTHING;

-- B-4 퇴사 반납 체크리스트 템플릿 (10/1 확정 5항목)
CREATE TABLE IF NOT EXISTS public.org_offboarding_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL,
  is_conditional  boolean NOT NULL DEFAULT false,      -- 해당자만(법인폰)
  is_critical     boolean NOT NULL DEFAULT false,      -- 미반납 시 강조
  sort_order      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_offboarding_templates_label_nonempty CHECK (length(btrim(label)) > 0)
);
COMMENT ON TABLE public.org_offboarding_templates IS '[ORG] 퇴사예정 등록 시 org_offboarding_items 로 복제되는 반납 항목';
INSERT INTO public.org_offboarding_templates (label, is_conditional, is_critical, sort_order)
SELECT v.label, v.cond, v.crit, v.ord
  FROM (VALUES ('노트북', false, false, 10), ('노트북 충전기', false, false, 20), ('마우스', false, false, 30),
               ('법인카드', false, false, 40), ('법인폰', true, true, 50)) AS v(label, cond, crit, ord)
 WHERE NOT EXISTS (SELECT 1 FROM public.org_offboarding_templates t WHERE t.label = v.label);

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 본 테이블
-- ────────────────────────────────────────────────────────────────────────────

-- C-1 조직도 파일(버전)
CREATE TABLE IF NOT EXISTS public.org_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  effective_on    date,                                -- 적용일(발령일). Active 전환 시 필수
  parent_file_id  uuid REFERENCES public.org_files(id) ON DELETE SET NULL,  -- 복사 원본(계보)
  memo            text,
  lock_by         uuid,                                -- 편집 중인 사람(profiles.id, FK 없음)
  lock_at         timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  activated_by    uuid,
  archived_at     timestamptz,
  CONSTRAINT org_files_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT org_files_active_needs_effective CHECK (status <> 'active' OR effective_on IS NOT NULL)
);
COMMENT ON TABLE public.org_files IS '[ORG] 조직도 파일 = 버전. draft(초안, 편집 가능) → active(현재 반영본, 정확히 1개) → archived(과거본, 수정·삭제 불가)';
-- Active 는 동시에 정확히 1개
CREATE UNIQUE INDEX IF NOT EXISTS org_files_one_active ON public.org_files ((status)) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS org_files_status_updated ON public.org_files (status, updated_at DESC);

-- C-2 조직 단위 (트리) — 이름·위치·순서 자유 편집(10/1 확정)
CREATE TABLE IF NOT EXISTS public.org_units (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id         uuid NOT NULL REFERENCES public.org_files(id) ON DELETE CASCADE,
  parent_unit_id  uuid REFERENCES public.org_units(id) ON DELETE RESTRICT,   -- 자식 있는 단위는 삭제 불가(가드 트리거와 이중)
  name            text NOT NULL,
  code            text,                                -- 약칭(CO1-1 등). 파일 내 UNIQUE
  azure_division  text,                                -- 교차검증용 Azure department 값(선택)
  head_card_id    uuid,                                -- FK 는 org_cards 생성 후 아래에서 추가
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_name_nonempty CHECK (length(btrim(name)) > 0)
);
COMMENT ON TABLE public.org_units IS '[ORG] 파일 소속 조직 단위 트리. parent 는 같은 file_id 여야 하고 순환 금지(트리거)';
CREATE UNIQUE INDEX IF NOT EXISTS org_units_file_code ON public.org_units (file_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_units_file_parent ON public.org_units (file_id, parent_unit_id, sort_order);

-- C-3 입사 예정자 (profiles 에 아직 없는 사람)
CREATE TABLE IF NOT EXISTS public.org_persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  email              text,                             -- lower 저장. sync 후크가 profiles.email 과 대조
  planned_start_on   date,
  linked_profile_id  uuid,                             -- 연결된 profiles.id (FK 없음)
  linked_at          timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_persons_name_nonempty CHECK (length(btrim(name)) > 0),
  CONSTRAINT org_persons_email_lower CHECK (email IS NULL OR email = lower(email))
);
COMMENT ON TABLE public.org_persons IS '[ORG] 입사 예정자 임시 신원. 입사 후 sync-all-users 후크(Phase 2)가 linked_profile_id 를 채우고 카드 profile_id 를 백필';
CREATE UNIQUE INDEX IF NOT EXISTS org_persons_email_unlinked ON public.org_persons (email) WHERE email IS NOT NULL AND linked_profile_id IS NULL;

-- C-4 인사 카드 (= 파일 안의 사람 1명 또는 공석 1자리)
CREATE TABLE IF NOT EXISTS public.org_cards (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id             uuid NOT NULL REFERENCES public.org_files(id) ON DELETE CASCADE,
  unit_id             uuid NOT NULL REFERENCES public.org_units(id) ON DELETE CASCADE,
  profile_id          uuid,                            -- profiles.id (FK 없음 — 퇴사 DELETE 와 분리)
  person_id           uuid REFERENCES public.org_persons(id) ON DELETE SET NULL,
  display_name        text,                            -- profile/person 없는 공석·외부 표기용. 사람 카드는 NULL(live 표시)
  rank_id             uuid REFERENCES public.org_ranks(id) ON DELETE SET NULL,
  reports_to_card_id  uuid,                            -- FK 아래에서 추가(자기참조)
  is_unit_head        boolean NOT NULL DEFAULT false,
  is_vacancy          boolean NOT NULL DEFAULT false,
  employment_type     text NOT NULL DEFAULT 'regular' CHECK (employment_type IN ('regular','contract','parttime','intern')),
  work_location       text,                            -- 부산 등
  fte                 numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (fte > 0 AND fte <= 1),
  memo                text,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_cards_identity CHECK (is_vacancy OR profile_id IS NOT NULL OR person_id IS NOT NULL),
  CONSTRAINT org_cards_vacancy_no_person CHECK (NOT is_vacancy OR (profile_id IS NULL AND person_id IS NULL)),
  CONSTRAINT org_cards_no_self_report CHECK (reports_to_card_id IS NULL OR reports_to_card_id <> id)
);
COMMENT ON TABLE public.org_cards IS '[ORG] 인사 카드. 이름·이메일·아바타는 profiles live, 카드는 배치·직급·직무·보고선만 보유';
-- 한 파일에 같은 사람 1장 (다인카드 불필요 — 10/1 확정. 겸직은 org_card_jobs 로)
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_file_profile ON public.org_cards (file_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_cards_file_person  ON public.org_cards (file_id, person_id)  WHERE person_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_cards_file_unit ON public.org_cards (file_id, unit_id, sort_order);
CREATE INDEX IF NOT EXISTS org_cards_profile   ON public.org_cards (profile_id) WHERE profile_id IS NOT NULL;

ALTER TABLE public.org_cards DROP CONSTRAINT IF EXISTS org_cards_reports_to_fk;
ALTER TABLE public.org_cards ADD CONSTRAINT org_cards_reports_to_fk
  FOREIGN KEY (reports_to_card_id) REFERENCES public.org_cards(id) ON DELETE SET NULL;
ALTER TABLE public.org_units DROP CONSTRAINT IF EXISTS org_units_head_card_fk;
ALTER TABLE public.org_units ADD CONSTRAINT org_units_head_card_fk
  FOREIGN KEY (head_card_id) REFERENCES public.org_cards(id) ON DELETE SET NULL;

-- C-5 카드 직무 (복수, 대표 1개)
CREATE TABLE IF NOT EXISTS public.org_card_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id     uuid NOT NULL REFERENCES public.org_cards(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES public.org_jobs(id) ON DELETE RESTRICT,
  is_primary  boolean NOT NULL DEFAULT false,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_card_jobs_card_job UNIQUE (card_id, job_id)
);
COMMENT ON TABLE public.org_card_jobs IS '[ORG] 카드당 직무 복수(겸직·직무대행). is_primary 1개가 카드 표시·정렬 기준';
CREATE UNIQUE INDEX IF NOT EXISTS org_card_jobs_one_primary ON public.org_card_jobs (card_id) WHERE is_primary;

-- C-6 사람 상태 (파일 밖)
CREATE TABLE IF NOT EXISTS public.org_person_status (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           uuid,                           -- profiles.id (FK 없음)
  person_id            uuid REFERENCES public.org_persons(id) ON DELETE CASCADE,
  status_code          text NOT NULL REFERENCES public.org_status_types(code) ON DELETE RESTRICT,
  planned_status_code  text REFERENCES public.org_status_types(code) ON DELETE RESTRICT,  -- 휴직예정 → 도래 시 전환될 종류
  start_on             date,
  end_on               date,
  return_on            date,                           -- 복귀 예정일
  note                 text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,                    -- NULL = 활성
  ended_by             uuid,
  ended_reason         text CHECK (ended_reason IS NULL OR ended_reason IN ('manual','auto','departed','linked','superseded')),
  CONSTRAINT org_person_status_subject CHECK ((profile_id IS NOT NULL) <> (person_id IS NOT NULL)),
  CONSTRAINT org_person_status_range CHECK (start_on IS NULL OR end_on IS NULL OR end_on >= start_on)
);
COMMENT ON TABLE public.org_person_status IS '[ORG] 사람 단위 상태 이력. 활성(ended_at IS NULL)은 사람당 1개. 등록·종료는 Phase 2 RPC(org_set_person_status) 전용 — profiles.employment_status 동기화 때문';
CREATE UNIQUE INDEX IF NOT EXISTS org_person_status_active_profile ON public.org_person_status (profile_id) WHERE ended_at IS NULL AND profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_person_status_active_person  ON public.org_person_status (person_id)  WHERE ended_at IS NULL AND person_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_person_status_dates ON public.org_person_status (status_code, start_on, return_on) WHERE ended_at IS NULL;

-- C-7 반납 체크리스트 항목
CREATE TABLE IF NOT EXISTS public.org_offboarding_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id    uuid NOT NULL REFERENCES public.org_person_status(id) ON DELETE CASCADE,
  template_id  uuid REFERENCES public.org_offboarding_templates(id) ON DELETE SET NULL,
  label        text NOT NULL,
  is_critical  boolean NOT NULL DEFAULT false,
  applicable   boolean NOT NULL DEFAULT true,          -- 조건부 항목(법인폰) 해당 여부
  checked      boolean NOT NULL DEFAULT false,
  checked_by   uuid,
  checked_at   timestamptz,
  sort_order   integer NOT NULL DEFAULT 0,
  CONSTRAINT org_offboarding_items_checked_consistent CHECK ((checked AND checked_at IS NOT NULL) OR (NOT checked AND checked_at IS NULL))
);
COMMENT ON TABLE public.org_offboarding_items IS '[ORG] 퇴사예정 상태 1건당 반납 항목. 퇴사 실행 후에도 보존(반납 이력)';
CREATE INDEX IF NOT EXISTS org_offboarding_items_status ON public.org_offboarding_items (status_id, sort_order);

-- C-8 변경 로그 (트리거 기록)
CREATE TABLE IF NOT EXISTS public.org_change_log (
  id            bigserial PRIMARY KEY,
  file_id       uuid,                                  -- NULL = 파일 밖 데이터(상태·코드·입사예정자)
  actor         uuid,                                  -- auth.uid() — NULL 이면 시스템(cron/service)
  action        text NOT NULL CHECK (action IN ('insert','update','delete')),
  target_table  text NOT NULL,
  target_id     text NOT NULL,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.org_change_log IS '[ORG] 전 org_ 테이블 변경 감사 로그. 트리거 전용 INSERT — 클라 INSERT 정책 없음';
CREATE INDEX IF NOT EXISTS org_change_log_file_time ON public.org_change_log (file_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_change_log_target    ON public.org_change_log (target_table, target_id);

-- C-9 Active 전환 diff (Phase 2 RPC 가 생성)
CREATE TABLE IF NOT EXISTS public.org_activation_diffs (
  id            bigserial PRIMARY KEY,
  file_id       uuid NOT NULL REFERENCES public.org_files(id) ON DELETE CASCADE,
  prev_file_id  uuid REFERENCES public.org_files(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('moved','promoted','job_changed','hired','departed','unit_created','unit_removed','unit_renamed','unit_moved','reassigned','head_changed')),
  card_ref      text,                                  -- profile_id / person_id / unit id
  label         text,                                  -- 사람·단위 표시명 스냅샷(diff 열람용)
  before        jsonb,
  after         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.org_activation_diffs IS '[ORG] Active 전환 시 이전 Active 대비 변경분 — 인사발령 목록·IT 변경요청서 원본';
CREATE INDEX IF NOT EXISTS org_activation_diffs_file ON public.org_activation_diffs (file_id, kind);

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 가드 트리거
-- ────────────────────────────────────────────────────────────────────────────

-- D-0 헬퍼: 파일 편집 가능 여부 / 수명주기 플래그
CREATE OR REPLACE FUNCTION public.org_file_is_editable(p_file_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_files WHERE id = p_file_id AND status = 'draft')
$$;
CREATE OR REPLACE FUNCTION public.org_lifecycle_on()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('org.lifecycle', true), '') = 'on'
$$;
COMMENT ON FUNCTION public.org_lifecycle_on() IS '[ORG] RPC(org_activate_file 등)가 SET LOCAL org.lifecycle = ''on'' 으로 켜는 플래그. 켜져 있을 때만 status 변경·archived 수정 허용';

-- D-1 org_files 가드: archived 보호 · status 변경은 RPC 전용 · draft 만 삭제
CREATE OR REPLACE FUNCTION public.org_files_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_DELETABLE' USING HINT = '초안(draft) 파일만 삭제할 수 있습니다.';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_STATUS_RPC_ONLY' USING HINT = '파일 상태 변경은 org_activate_file RPC 로만 가능합니다.';
  END IF;
  IF OLD.status = 'archived' AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_ARCHIVED_READONLY' USING HINT = '지난 조직도는 수정할 수 없습니다. 복사해서 편집하세요.';
  END IF;
  IF OLD.status = 'active' AND NOT public.org_lifecycle_on() THEN
    -- Active 파일은 잠금·메모·이름 외 변경 불가 (구조 편집은 units/cards 가드가 막는다)
    IF (OLD.effective_on IS DISTINCT FROM NEW.effective_on) OR (OLD.parent_file_id IS DISTINCT FROM NEW.parent_file_id) THEN
      RAISE EXCEPTION 'ORG_FILE_ACTIVE_READONLY' USING HINT = 'Active 조직도의 적용일·계보는 변경할 수 없습니다.';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_files_guard ON public.org_files;
CREATE TRIGGER trg_org_files_guard BEFORE UPDATE OR DELETE ON public.org_files
  FOR EACH ROW EXECUTE FUNCTION public.org_files_guard();

-- D-2 org_units 가드: 같은 파일 · 순환 금지 · 초안만 편집 · 자식/카드 있으면 삭제 금지
CREATE OR REPLACE FUNCTION public.org_units_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_parent_file uuid; v_cur uuid; v_depth int := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 파일 CASCADE 중(파일 행이 이미 없음)이면 통과
    IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = OLD.file_id) THEN RETURN OLD; END IF;
    IF NOT public.org_file_is_editable(OLD.file_id) AND NOT public.org_lifecycle_on() THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
    END IF;
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
  IF NEW.parent_unit_id IS NOT NULL THEN
    IF NEW.parent_unit_id = NEW.id THEN
      RAISE EXCEPTION 'ORG_UNIT_CYCLE' USING HINT = '자기 자신을 상위 단위로 둘 수 없습니다.';
    END IF;
    SELECT file_id INTO v_parent_file FROM public.org_units WHERE id = NEW.parent_unit_id;
    IF v_parent_file IS NULL OR v_parent_file <> NEW.file_id THEN
      RAISE EXCEPTION 'ORG_UNIT_PARENT_OTHER_FILE' USING HINT = '상위 단위는 같은 조직도 파일 안에 있어야 합니다.';
    END IF;
    -- 순환: 새 부모의 조상 중에 자기 자신이 있으면 거부
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
DROP TRIGGER IF EXISTS trg_org_units_guard ON public.org_units;
CREATE TRIGGER trg_org_units_guard BEFORE INSERT OR UPDATE OR DELETE ON public.org_units
  FOR EACH ROW EXECUTE FUNCTION public.org_units_guard();

-- D-3 org_cards 가드: 초안만 편집 · 단위는 같은 파일 · 보고선은 같은 파일
CREATE OR REPLACE FUNCTION public.org_cards_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_f uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.org_files WHERE id = OLD.file_id) THEN RETURN OLD; END IF;
    IF NOT public.org_file_is_editable(OLD.file_id) AND NOT public.org_lifecycle_on() THEN
      RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
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
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_cards_guard ON public.org_cards;
CREATE TRIGGER trg_org_cards_guard BEFORE INSERT OR UPDATE OR DELETE ON public.org_cards
  FOR EACH ROW EXECUTE FUNCTION public.org_cards_guard();

-- D-4 org_card_jobs 가드: 카드의 파일이 초안일 때만
CREATE OR REPLACE FUNCTION public.org_card_jobs_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_card uuid := COALESCE(NEW.card_id, OLD.card_id); v_file uuid;
BEGIN
  SELECT file_id INTO v_file FROM public.org_cards WHERE id = v_card;
  IF v_file IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- 카드 CASCADE 중
  IF NOT public.org_file_is_editable(v_file) AND NOT public.org_lifecycle_on() THEN
    RAISE EXCEPTION 'ORG_FILE_NOT_EDITABLE' USING HINT = '초안 파일에서만 편집할 수 있습니다.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_org_card_jobs_guard ON public.org_card_jobs;
CREATE TRIGGER trg_org_card_jobs_guard BEFORE INSERT OR UPDATE OR DELETE ON public.org_card_jobs
  FOR EACH ROW EXECUTE FUNCTION public.org_card_jobs_guard();

-- D-5 코드 테이블 시스템값 보호 (status_types)
CREATE OR REPLACE FUNCTION public.org_status_types_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN RAISE EXCEPTION 'ORG_STATUS_SYSTEM_PROTECTED' USING HINT = '시스템 상태 코드는 삭제할 수 없습니다. is_active 로 숨기세요.'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_system AND (OLD.category <> NEW.category OR OLD.code <> NEW.code OR NOT NEW.is_system) THEN
    RAISE EXCEPTION 'ORG_STATUS_SYSTEM_PROTECTED' USING HINT = '시스템 상태 코드의 code·category 는 변경할 수 없습니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_status_types_guard ON public.org_status_types;
CREATE TRIGGER trg_org_status_types_guard BEFORE UPDATE OR DELETE ON public.org_status_types
  FOR EACH ROW EXECUTE FUNCTION public.org_status_types_guard();

-- D-6 변경 로그 — 전 org_ 데이터 테이블 공용 (AFTER ROW)
CREATE OR REPLACE FUNCTION public.org_log_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old jsonb; v_new jsonb; v_file uuid; v_id text;
  v_noise text[] := ARRAY['updated_at','updated_by','lock_by','lock_at'];   -- 이것만 바뀐 UPDATE 는 기록하지 않음
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (v_old - v_noise) = (v_new - v_noise) THEN RETURN NULL; END IF;

  v_id := COALESCE(v_new->>'id', v_old->>'id', v_new->>'code', v_old->>'code');
  v_file := COALESCE((v_new->>'file_id')::uuid, (v_old->>'file_id')::uuid);
  IF v_file IS NULL AND TG_TABLE_NAME = 'org_card_jobs' THEN
    SELECT file_id INTO v_file FROM public.org_cards WHERE id = COALESCE((v_new->>'card_id')::uuid, (v_old->>'card_id')::uuid);
  END IF;

  INSERT INTO public.org_change_log (file_id, actor, action, target_table, target_id, before, after)
  VALUES (v_file, auth.uid(), lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE v_old END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE v_new END);
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_files','org_units','org_persons','org_cards','org_card_jobs','org_person_status',
                           'org_offboarding_items','org_status_types','org_ranks','org_jobs','org_offboarding_templates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_org_log ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_org_log AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.org_log_change()', t);
  END LOOP;
END $$;

-- D-7 구조 변경 시 파일 updated_at/updated_by 갱신 (units · cards · card_jobs)
CREATE OR REPLACE FUNCTION public.org_touch_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_file uuid;
BEGIN
  IF TG_TABLE_NAME = 'org_card_jobs' THEN
    SELECT file_id INTO v_file FROM public.org_cards WHERE id = COALESCE(NEW.card_id, OLD.card_id);
  ELSE
    v_file := COALESCE((to_jsonb(NEW)->>'file_id')::uuid, (to_jsonb(OLD)->>'file_id')::uuid);
  END IF;
  IF v_file IS NOT NULL THEN
    UPDATE public.org_files SET updated_at = now(), updated_by = COALESCE(auth.uid(), updated_by) WHERE id = v_file;
  END IF;
  RETURN NULL;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_units','org_cards','org_card_jobs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_org_touch ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_org_touch AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.org_touch_file()', t);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- [E] RLS — 전 테이블 has_admin_role('org') 단일 게이트
--     쓰기: 파일 구조(files/units/cards/card_jobs) + 입사예정자 + 코드 테이블 + 체크 항목(UPDATE) 은 직접 쓰기 허용(초안 가드는 트리거).
--          상태(org_person_status)·로그·diff 는 Phase 2 RPC/트리거 전용 — 클라 쓰기 정책 없음.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_status_types','org_ranks','org_jobs','org_offboarding_templates','org_files','org_units','org_persons',
                           'org_cards','org_card_jobs','org_person_status','org_offboarding_items','org_change_log','org_activation_diffs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.has_admin_role(''org''))', t || '_select', t);
  END LOOP;
  -- 코드 테이블 · 입사예정자: org 역할 전체 쓰기
  FOREACH t IN ARRAY ARRAY['org_status_types','org_ranks','org_jobs','org_offboarding_templates','org_persons'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (public.has_admin_role(''org'')) WITH CHECK (public.has_admin_role(''org''))', t || '_write', t);
  END LOOP;
END $$;

-- org_files: 생성(초안만) · 수정(초안 + Active 의 잠금/메모) · 삭제(초안, 생성자 또는 super)
DROP POLICY IF EXISTS org_files_insert ON public.org_files;
CREATE POLICY org_files_insert ON public.org_files FOR INSERT
  WITH CHECK (public.has_admin_role('org') AND status = 'draft' AND created_by = auth.uid());
DROP POLICY IF EXISTS org_files_update ON public.org_files;
CREATE POLICY org_files_update ON public.org_files FOR UPDATE
  USING (public.has_admin_role('org') AND status IN ('draft','active'))
  WITH CHECK (public.has_admin_role('org'));
DROP POLICY IF EXISTS org_files_delete ON public.org_files;
CREATE POLICY org_files_delete ON public.org_files FOR DELETE
  USING (public.has_admin_role('org') AND status = 'draft' AND (created_by = auth.uid() OR public.has_admin_role('super')));

-- org_units / org_cards: 초안 파일만 (트리거와 이중 — RLS 는 조용히 0행, 트리거는 에러를 돌려준다)
DROP POLICY IF EXISTS org_units_write ON public.org_units;
CREATE POLICY org_units_write ON public.org_units FOR ALL
  USING (public.has_admin_role('org') AND public.org_file_is_editable(file_id))
  WITH CHECK (public.has_admin_role('org') AND public.org_file_is_editable(file_id));
DROP POLICY IF EXISTS org_cards_write ON public.org_cards;
CREATE POLICY org_cards_write ON public.org_cards FOR ALL
  USING (public.has_admin_role('org') AND public.org_file_is_editable(file_id))
  WITH CHECK (public.has_admin_role('org') AND public.org_file_is_editable(file_id));
DROP POLICY IF EXISTS org_card_jobs_write ON public.org_card_jobs;
CREATE POLICY org_card_jobs_write ON public.org_card_jobs FOR ALL
  USING (public.has_admin_role('org') AND EXISTS (SELECT 1 FROM public.org_cards c WHERE c.id = card_id AND public.org_file_is_editable(c.file_id)))
  WITH CHECK (public.has_admin_role('org') AND EXISTS (SELECT 1 FROM public.org_cards c WHERE c.id = card_id AND public.org_file_is_editable(c.file_id)));

-- 체크리스트 항목: 체크/해당여부만 UPDATE
DROP POLICY IF EXISTS org_offboarding_items_update ON public.org_offboarding_items;
CREATE POLICY org_offboarding_items_update ON public.org_offboarding_items FOR UPDATE
  USING (public.has_admin_role('org')) WITH CHECK (public.has_admin_role('org'));

-- ────────────────────────────────────────────────────────────────────────────
-- [F] 권한 — Supabase 기본 권한(anon/authenticated ALL) 을 먼저 REVOKE 하고 필요한 것만 GRANT
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.org_status_types, public.org_ranks, public.org_jobs, public.org_offboarding_templates, public.org_files,
              public.org_units, public.org_persons, public.org_cards, public.org_card_jobs, public.org_person_status,
              public.org_offboarding_items, public.org_change_log, public.org_activation_diffs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_status_types, public.org_ranks, public.org_jobs, public.org_offboarding_templates, public.org_files,
                public.org_units, public.org_persons, public.org_cards, public.org_card_jobs, public.org_person_status,
                public.org_offboarding_items, public.org_change_log, public.org_activation_diffs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.org_status_types, public.org_ranks, public.org_jobs, public.org_offboarding_templates,
                                public.org_files, public.org_units, public.org_persons, public.org_cards, public.org_card_jobs TO authenticated;
GRANT UPDATE ON public.org_offboarding_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.org_change_log_id_seq, public.org_activation_diffs_id_seq TO authenticated;
GRANT ALL ON public.org_status_types, public.org_ranks, public.org_jobs, public.org_offboarding_templates, public.org_files,
             public.org_units, public.org_persons, public.org_cards, public.org_card_jobs, public.org_person_status,
             public.org_offboarding_items, public.org_change_log, public.org_activation_diffs TO service_role;
GRANT ALL ON SEQUENCE public.org_change_log_id_seq, public.org_activation_diffs_id_seq TO service_role;

REVOKE ALL ON FUNCTION public.org_file_is_editable(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.org_lifecycle_on()        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_file_is_editable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.org_lifecycle_on()        TO authenticated, service_role;

-- 자기 검증: 하나라도 어긋나면 EXCEPTION → 트랜잭션 전체 롤백
DO $$
DECLARE v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c'
                   AND pg_get_constraintdef(oid) LIKE '%''org''%') THEN
    RAISE EXCEPTION '[검증] admin_roles CHECK 에 org 없음';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%' AND rowsecurity;
  IF v_cnt <> 13 THEN RAISE EXCEPTION '[검증] org_ 테이블 RLS 활성 수 % (기대 13)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename LIKE 'org\_%';
  IF v_cnt <> 25 THEN RAISE EXCEPTION '[검증] org_ 정책 수 % (기대 25)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.org_status_types WHERE is_system;
  IF v_cnt <> 7 THEN RAISE EXCEPTION '[검증] 시스템 상태 코드 % (기대 7)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.org_offboarding_templates;
  IF v_cnt < 5 THEN RAISE EXCEPTION '[검증] 반납 템플릿 % (기대 5+)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM public.org_jobs;
  IF v_cnt < 90 THEN RAISE EXCEPTION '[검증] 직무 시드 % (기대 90+)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   WHERE c.relname LIKE 'org\_%' AND t.tgname = 'trg_org_log' AND NOT t.tgisinternal;
  IF v_cnt <> 11 THEN RAISE EXCEPTION '[검증] 변경로그 트리거 수 % (기대 11)', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM unnest(ARRAY['org_person_status','org_change_log','org_activation_diffs']) t
   WHERE has_table_privilege('authenticated', 'public.'||t, 'INSERT');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] authenticated 가 RPC 전용 테이블 INSERT 가능 %개', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'org\_%' AND has_table_privilege('anon', 'public.'||tablename, 'SELECT');
  IF v_cnt <> 0 THEN RAISE EXCEPTION '[검증] anon 에 org_ SELECT 잔존 %개', v_cnt; END IF;
  RAISE NOTICE '[검증] ORG Phase 1 전 항목 통과';
END $$;

COMMIT;
