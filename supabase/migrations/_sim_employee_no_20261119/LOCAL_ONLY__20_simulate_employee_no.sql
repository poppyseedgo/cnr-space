-- ============================================================================
-- ⚠⚠ LOCAL_ONLY — 로컬 PG 시뮬 전용. 운영 SQL Editor 에서 실행 금지 (가짜 사용자 데이터 포함) ⚠⚠
-- 시뮬 시나리오 — 20261022_profiles_employee_no.sql 적용 후 실행 (psql -v ON_ERROR_STOP=1)
--
-- ✅ 변경 이력
--  - [2026-11-19] 신규
--
-- 스텁: _sim_departure_20261014/_sim__00_stub_prod.sql (운영 실측 1:1) 재사용
-- 적용 순서: 스텁 → 20261020 → 20261021 → 20261022 → 20261022(재실행·멱등) → _sim__10_simulate.sql(기존 14항목 회귀) → 이 파일
--   N1  사번 있는 직원 퇴사 → departed_users.employee_no 에 사번 스냅샷, profiles 삭제
--   N2  사번 없는(NULL) 직원 퇴사 → 퇴사 성공, 스냅샷 NULL
--   N3  같은 id 재입사 후 사번 없이 재퇴사 → 기존 사번 유지(ON CONFLICT)
--   N4  같은 id 재입사 후 새 사번으로 재퇴사 → 새 사번으로 갱신, departed_at 은 최초 유지
--   N5  클라이언트(authenticated) 본인 행 사번 변경 → 42501 차단
--   N6  클라이언트 본인 행의 다른 칸(name) 변경 → 통과, 사번 불변
--   N7  sync PATCH 모사(service 경로: name · employee_id 만 갱신) → 사번 불변
--   N8  postgres 경로 사번 채움(일회성 채움 경로) → 통과
--   N9  사번 중복 → unique 위반 / NULL · '' 여러 명 → 허용
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO auth.users VALUES
  ('91000000-0000-0000-0000-000000000001','no-has@cnrres.com'),
  ('92000000-0000-0000-0000-000000000002','no-null@cnrres.com'),
  ('93000000-0000-0000-0000-000000000003','no-client@cnrres.com'),
  ('94000000-0000-0000-0000-000000000004','no-dup@cnrres.com'),
  ('95000000-0000-0000-0000-000000000005','no-blank1@cnrres.com'),
  ('96000000-0000-0000-0000-000000000006','no-blank2@cnrres.com'),
  ('97000000-0000-0000-0000-000000000007','no-null2@cnrres.com'),
  ('98000000-0000-0000-0000-000000000008','no-null3@cnrres.com');
INSERT INTO public.profiles (id,email,name,dept,role,employee_id,employee_no) VALUES
  ('91000000-0000-0000-0000-000000000001','no-has@cnrres.com','사번있음','CO','USER','no-has@cnrres.com','20240101'),
  ('92000000-0000-0000-0000-000000000002','no-null@cnrres.com','사번없음','CO','USER','no-null@cnrres.com',NULL),
  ('93000000-0000-0000-0000-000000000003','no-client@cnrres.com','클라이언트','CO','USER','no-client@cnrres.com','20240303'),
  ('94000000-0000-0000-0000-000000000004','no-dup@cnrres.com','중복시도','CO','USER','no-dup@cnrres.com',NULL),
  ('95000000-0000-0000-0000-000000000005','no-blank1@cnrres.com','빈값1','CO','USER','no-blank1@cnrres.com',''),
  ('96000000-0000-0000-0000-000000000006','no-blank2@cnrres.com','빈값2','CO','USER','no-blank2@cnrres.com',''),   -- N9: '' 두 명 INSERT 자체가 통과해야 한다
  ('97000000-0000-0000-0000-000000000007','no-null2@cnrres.com','널2','CO','USER','no-null2@cnrres.com',NULL),      -- N9: NULL 두 명(퇴사시키지 않는 행) — 1차 실행 때 시드 부족으로 NULL 이 1명만 남아 판정 불가였음
  ('98000000-0000-0000-0000-000000000008','no-null3@cnrres.com','널3','CO','USER','no-null3@cnrres.com',NULL);

SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- N1
SELECT public.process_departure('91000000-0000-0000-0000-000000000001') \gset n1_
DO $$ BEGIN
  IF (SELECT employee_no FROM public.departed_users WHERE id='91000000-0000-0000-0000-000000000001') IS DISTINCT FROM '20240101' THEN RAISE EXCEPTION 'N1 실패 — 사번 스냅샷 누락'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id='91000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'N1 실패 — profiles 잔존'; END IF;
  RAISE NOTICE '✅ N1 통과 — 사번 스냅샷 + profiles 삭제';
END $$;

-- N2
SELECT public.process_departure('92000000-0000-0000-0000-000000000002') \gset n2_
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.departed_users WHERE id='92000000-0000-0000-0000-000000000002' AND employee_no IS NULL) THEN RAISE EXCEPTION 'N2 실패'; END IF;
  RAISE NOTICE '✅ N2 통과 — 사번 없는 직원 퇴사 성공(스냅샷 NULL)';
END $$;

-- N3 — 같은 id 재입사(사번 없음) → 재퇴사: 기존 사번 유지
RESET SESSION AUTHORIZATION;
INSERT INTO public.profiles (id,email,name,dept,role,employee_id,employee_no) VALUES
  ('91000000-0000-0000-0000-000000000001','no-has@cnrres.com','사번있음','CO','USER','no-has@cnrres.com',NULL);
SELECT departed_at AS first_departed FROM public.departed_users WHERE id='91000000-0000-0000-0000-000000000001' \gset
SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT public.process_departure('91000000-0000-0000-0000-000000000001') \gset n3_
DO $$ BEGIN
  IF (SELECT employee_no FROM public.departed_users WHERE id='91000000-0000-0000-0000-000000000001') IS DISTINCT FROM '20240101' THEN RAISE EXCEPTION 'N3 실패 — 기존 사번 유실'; END IF;
  RAISE NOTICE '✅ N3 통과 — 사번 없이 재퇴사해도 기존 사번 유지';
END $$;

-- N4 — 같은 id 재입사(새 사번) → 재퇴사: 새 사번으로 갱신, departed_at 최초 유지
RESET SESSION AUTHORIZATION;
INSERT INTO public.profiles (id,email,name,dept,role,employee_id,employee_no) VALUES
  ('91000000-0000-0000-0000-000000000001','no-has@cnrres.com','사번있음','CO','USER','no-has@cnrres.com','20261199');
SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT public.process_departure('91000000-0000-0000-0000-000000000001') \gset n4_
SELECT (employee_no = '20261199') AS n4_no_ok, (departed_at = :'first_departed'::timestamptz) AS n4_at_ok
  FROM public.departed_users WHERE id='91000000-0000-0000-0000-000000000001' \gset
\if :n4_no_ok
\else
  \echo 'N4 실패 — 새 사번 미반영'
  \quit 3
\endif
\if :n4_at_ok
  \echo ' ✅ N4 통과 — 새 사번으로 갱신 · departed_at 최초 유지'
\else
  \echo 'N4 실패 — departed_at 이 밀림'
  \quit 3
\endif

-- N5 · N6 — 클라이언트(authenticated) 경로
RESET SESSION AUTHORIZATION;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', '93000000-0000-0000-0000-000000000003', false);
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET employee_no = '99999999' WHERE id='93000000-0000-0000-0000-000000000003';
    RAISE EXCEPTION 'N5 실패 — 클라이언트 사번 변경이 통과됨';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE '%EMPLOYEE_NO_READONLY%' THEN RAISE; END IF;
    RAISE NOTICE '✅ N5 통과 — 클라이언트 사번 변경 차단 (42501)';
  END;
END $$;
UPDATE public.profiles SET name = '클라이언트수정' WHERE id='93000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='93000000-0000-0000-0000-000000000003' AND name='클라이언트수정' AND employee_no='20240303') THEN RAISE EXCEPTION 'N6 실패'; END IF;
  RAISE NOTICE '✅ N6 통과 — 다른 칸 변경은 통과 · 사번 불변';
END $$;
RESET ROLE;

-- N7 — sync PATCH 모사: sync-all-users v11 의 patchBody(name · employee_id · azure_*) 에는 employee_no 가 없다
SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub', '', false);
UPDATE public.profiles SET name = '싱크이름', employee_id = 'no-client@cnrres.com' WHERE email = 'no-client@cnrres.com';
DO $$ BEGIN
  IF (SELECT employee_no FROM public.profiles WHERE email='no-client@cnrres.com') IS DISTINCT FROM '20240303' THEN RAISE EXCEPTION 'N7 실패 — sync 가 사번을 지움'; END IF;
  RAISE NOTICE '✅ N7 통과 — sync PATCH 뒤 사번 불변';
END $$;

-- N8 — postgres 경로 채움 (일회성 채움과 같은 경로)
RESET SESSION AUTHORIZATION;
UPDATE public.profiles SET employee_no = '20240404' WHERE email = 'no-dup@cnrres.com';
DO $$ BEGIN
  IF (SELECT employee_no FROM public.profiles WHERE email='no-dup@cnrres.com') IS DISTINCT FROM '20240404' THEN RAISE EXCEPTION 'N8 실패'; END IF;
  RAISE NOTICE '✅ N8 통과 — postgres 경로 사번 채움';
END $$;

-- N9 — 중복 거절 / NULL · '' 다수 허용
DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET employee_no = '20240303' WHERE email = 'no-dup@cnrres.com';
    RAISE EXCEPTION 'N9 실패 — 중복 사번이 통과됨';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.profiles WHERE employee_no = '') < 2 THEN RAISE EXCEPTION 'N9 실패 — 빈 값 다수 불가'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE employee_no IS NULL) < 2 THEN RAISE EXCEPTION 'N9 실패 — NULL 다수 불가'; END IF;
  RAISE NOTICE '✅ N9 통과 — 중복 거절 · NULL/빈 값 다수 허용';
END $$;

\echo '== 사번 시뮬 N1~N9 전체 통과 =='
