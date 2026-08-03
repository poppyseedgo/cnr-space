-- ============================================================================
-- 20260738_holidays.sql
-- 한국 법정 공휴일 SSOT — 테이블 + 관리자 RPC + 2026~2027 시드
--
-- ✅ 변경 이력
--  - [2026-08-03] 신규 — 고지 확정: ①공휴일은 표기만(예약 차단 없음 — 예약 가드 없음)
--    ②토 파랑·일 빨강(프론트) ③공공데이터포털 가입 불가로 API 없이 우선 가동
--
-- 📌 source 3값 설계 — API 없이 시작해도 나중에 자가 교정되는 구조:
--    'seed'   = 이 마이그레이션이 넣은 값. 추후 sync-holidays(천문연 API)가 덮어씀
--    'api'    = 동기화가 넣은 값. 다음 동기화가 갱신
--    'manual' = 관리자가 넣은 값(임시공휴일 등). ⚠동기화가 절대 덮지 않음
--    → 웹 소스 간 날짜 불일치가 실증됐으므로(2027 설날), seed 는 잠정값이고
--      API 연결 시점에 sync 가 seed/api 행만 교정한다.
--
-- 📌 2027 음력 기반(설·추석·석탄일) 시드는 잠정 — API 동기화 전까지 어드민
--    '공휴일 관리'(Phase 3)에서 수동 교정 가능. 2026 은 복수 소스 교차검증 완료.
-- ============================================================================

BEGIN;

-- ── [1] 테이블 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.holidays (
  holiday_date date PRIMARY KEY,
  name         text NOT NULL,
  source       text NOT NULL DEFAULT 'manual'
               CHECK (source IN ('seed', 'api', 'manual')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.holidays IS
  '한국 법정 공휴일 SSOT — 표기 전용(예약 차단 없음). source=manual 은 동기화가 보존';

-- ── [2] RLS — 전 직원 읽기, 쓰기는 RPC 로만 ─────────────────────────────
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS holidays_read ON public.holidays;
CREATE POLICY holidays_read ON public.holidays
  FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE 정책 없음 — RPC(SECURITY DEFINER) 전용

GRANT SELECT ON public.holidays TO authenticated;
GRANT ALL    ON public.holidays TO service_role;   -- 추후 sync-holidays Edge 용

-- ── [3] 관리자 RPC — 권한은 has_admin_role('room') ──────────────────────
--    공휴일은 회의실 캘린더 표기에 직결되므로 room 권한 계열로 묶는다 (super 자동 통과).
--    임시공휴일 지정·잠정 시드 교정이 주 용도.
DROP FUNCTION IF EXISTS public.admin_upsert_holiday(date, text);
CREATE FUNCTION public.admin_upsert_holiday(p_date date, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('room') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;

  INSERT INTO public.holidays (holiday_date, name, source)
  VALUES (p_date, btrim(p_name), 'manual')
  ON CONFLICT (holiday_date)
  DO UPDATE SET name = EXCLUDED.name, source = 'manual', updated_at = now();
END $$;

DROP FUNCTION IF EXISTS public.admin_delete_holiday(date);
CREATE FUNCTION public.admin_delete_holiday(p_date date)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('room') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  DELETE FROM public.holidays WHERE holiday_date = p_date;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLIDAY_NOT_FOUND'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_upsert_holiday(date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_holiday(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_holiday(date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_holiday(date) TO authenticated;

-- ── [4] 시드 — 2026 전체(교차검증 완료) + 2027(잠정, 음력분은 API 로 교정 예정) ──
INSERT INTO public.holidays (holiday_date, name, source) VALUES
  -- 2026
  ('2026-01-01', '신정',                    'seed'),
  ('2026-02-16', '설날 연휴',               'seed'),
  ('2026-02-17', '설날',                    'seed'),
  ('2026-02-18', '설날 연휴',               'seed'),
  ('2026-03-01', '삼일절',                  'seed'),
  ('2026-03-02', '대체공휴일(삼일절)',       'seed'),
  ('2026-05-05', '어린이날',                'seed'),
  ('2026-05-24', '부처님오신날',            'seed'),
  ('2026-05-25', '대체공휴일(부처님오신날)', 'seed'),
  ('2026-06-03', '전국동시지방선거',         'seed'),
  ('2026-06-06', '현충일',                  'seed'),
  ('2026-08-15', '광복절',                  'seed'),
  ('2026-08-17', '대체공휴일(광복절)',       'seed'),
  ('2026-09-24', '추석 연휴',               'seed'),
  ('2026-09-25', '추석',                    'seed'),
  ('2026-09-26', '추석 연휴',               'seed'),
  ('2026-10-03', '개천절',                  'seed'),
  ('2026-10-05', '대체공휴일(개천절)',       'seed'),
  ('2026-10-09', '한글날',                  'seed'),
  ('2026-12-25', '기독탄신일',              'seed'),
  -- 2027 (음력 기반은 잠정 — sync 또는 어드민에서 교정)
  ('2027-01-01', '신정',                    'seed'),
  ('2027-02-05', '설날 연휴',               'seed'),
  ('2027-02-06', '설날',                    'seed'),
  ('2027-02-07', '설날 연휴',               'seed'),
  ('2027-02-08', '대체공휴일(설날)',         'seed'),
  ('2027-03-01', '삼일절',                  'seed'),
  ('2027-05-05', '어린이날',                'seed'),
  ('2027-05-13', '부처님오신날',            'seed'),
  ('2027-06-06', '현충일',                  'seed'),
  ('2027-08-15', '광복절',                  'seed'),
  ('2027-08-16', '대체공휴일(광복절)',       'seed'),
  ('2027-09-14', '추석 연휴',               'seed'),
  ('2027-09-15', '추석',                    'seed'),
  ('2027-09-16', '추석 연휴',               'seed'),
  ('2027-10-03', '개천절',                  'seed'),
  ('2027-10-04', '대체공휴일(개천절)',       'seed'),
  ('2027-10-09', '한글날',                  'seed'),
  ('2027-10-11', '대체공휴일(한글날)',       'seed'),
  ('2027-12-25', '기독탄신일',              'seed'),
  ('2027-12-27', '대체공휴일(기독탄신일)',   'seed')
ON CONFLICT (holiday_date) DO NOTHING;   -- 재실행 멱등 + 기존 manual 보존

COMMIT;
