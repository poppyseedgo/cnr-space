-- ============================================================================
-- 20260739_company_events.sql
-- 회사 이벤트(패밀리 데이·창립기념일 등) — holidays 테이블 kind 확장
--
-- ✅ 변경 이력
--  - [2026-08-03] 신규 — 고지 요청: 법정공휴일 + 회사 패밀리데이(원칙상 1·3주 금요일
--    단축근무) + 창립기념일 등 회사 경조사를 공통 달력·캘린더 뷰에 반영, 어드민 관리
--
-- 📌 설계
--  - 별도 테이블 대신 kind 확장 — 로드/캐시/표기 경로 1벌 재사용, sync(추후)는
--    kind='holiday' 만 대상. 'company' 행은 API 와 무관.
--  - ⚠PK 를 (holiday_date, kind) 복합으로 교체 — 같은 날 공휴일+패밀리데이 공존
--    가능(예: 금요일과 겹친 삼일절). 단일 date PK 면 둘 중 하나가 소실된다.
--  - 패밀리데이 시드는 2026 전체 24건 — 고지 제공 사내 캘린더 PDF 와 전건 대조 완료
--    (매월 1·3번째 금요일 규칙과 정확히 일치: 1/2, 5/1 포함).
--  - 2027 이후는 admin_generate_family_days(연도) 로 생성 (원칙 자동화, 예외는
--    어드민 수정) — 근거 문서 없는 미래 시드는 넣지 않는다.
--  - 창립기념일: 날짜 미확인 — 어드민 등록 경로(upsert kind='company')로 입력.
-- ============================================================================

BEGIN;

-- ── [1] kind 컬럼 + 복합 PK 전환 ────────────────────────────────────────
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'holiday'
  CHECK (kind IN ('holiday', 'company'));

COMMENT ON COLUMN public.holidays.kind IS
  'holiday=법정 공휴일(빨강, API sync 대상) / company=회사 이벤트(패밀리데이·창립기념일 — sync 무관)';

-- 기존 40행은 DEFAULT 로 kind='holiday' 백필됨. PK 교체:
ALTER TABLE public.holidays DROP CONSTRAINT holidays_pkey;
ALTER TABLE public.holidays ADD PRIMARY KEY (holiday_date, kind);

-- ── [2] RPC 재생성 — kind 파라미터 (기본 'holiday' — 기존 호출 하위호환) ──
DROP FUNCTION IF EXISTS public.admin_upsert_holiday(date, text);
DROP FUNCTION IF EXISTS public.admin_upsert_holiday(date, text, text);
CREATE FUNCTION public.admin_upsert_holiday(p_date date, p_name text, p_kind text DEFAULT 'holiday')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('room') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN RAISE EXCEPTION 'NAME_REQUIRED'; END IF;
  IF p_kind NOT IN ('holiday', 'company') THEN RAISE EXCEPTION 'INVALID_KIND'; END IF;

  INSERT INTO public.holidays (holiday_date, name, source, kind)
  VALUES (p_date, btrim(p_name), 'manual', p_kind)
  ON CONFLICT (holiday_date, kind)
  DO UPDATE SET name = EXCLUDED.name, source = 'manual', updated_at = now();
END $$;

DROP FUNCTION IF EXISTS public.admin_delete_holiday(date);
DROP FUNCTION IF EXISTS public.admin_delete_holiday(date, text);
CREATE FUNCTION public.admin_delete_holiday(p_date date, p_kind text DEFAULT 'holiday')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('room') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;

  DELETE FROM public.holidays WHERE holiday_date = p_date AND kind = p_kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOLIDAY_NOT_FOUND'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_upsert_holiday(date, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_holiday(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_upsert_holiday(date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_holiday(date, text) TO authenticated;

-- ── [3] 패밀리데이 연도 생성 RPC — "원칙상 1·3주 금요일" 자동화 ─────────
--    이미 있는 (날짜, company) 행은 보존(DO NOTHING) — 관리자 조정 유지.
--    반환: 신규 생성 건수.
DROP FUNCTION IF EXISTS public.admin_generate_family_days(int);
CREATE FUNCTION public.admin_generate_family_days(p_year int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_month int;
  v_first date;
  v_fri1  date;
  v_cnt   int := 0;
  v_ins   int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.has_admin_role('room') THEN RAISE EXCEPTION 'NOT_ADMIN'; END IF;
  IF p_year < 2020 OR p_year > 2100 THEN RAISE EXCEPTION 'INVALID_YEAR'; END IF;

  FOR v_month IN 1..12 LOOP
    v_first := make_date(p_year, v_month, 1);
    -- 해당 월 첫 금요일: dow(0=일..5=금..6=토) → (5 - dow + 7) % 7 일 뒤
    v_fri1  := v_first + ((5 - EXTRACT(dow FROM v_first)::int + 7) % 7);

    INSERT INTO public.holidays (holiday_date, name, source, kind)
    VALUES (v_fri1,                    'Family Day', 'manual', 'company'),
           (v_fri1 + 14,              'Family Day', 'manual', 'company')
    ON CONFLICT (holiday_date, kind) DO NOTHING;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    v_cnt := v_cnt + v_ins;
  END LOOP;

  RETURN v_cnt;
END $$;

REVOKE ALL ON FUNCTION public.admin_generate_family_days(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_generate_family_days(int) TO authenticated;

-- ── [4] 2026 패밀리데이 시드 24건 — 고지 제공 사내 캘린더 PDF 전건 대조 ──
INSERT INTO public.holidays (holiday_date, name, source, kind) VALUES
  ('2026-01-02', 'Family Day', 'seed', 'company'), ('2026-01-16', 'Family Day', 'seed', 'company'),
  ('2026-02-06', 'Family Day', 'seed', 'company'), ('2026-02-20', 'Family Day', 'seed', 'company'),
  ('2026-03-06', 'Family Day', 'seed', 'company'), ('2026-03-20', 'Family Day', 'seed', 'company'),
  ('2026-04-03', 'Family Day', 'seed', 'company'), ('2026-04-17', 'Family Day', 'seed', 'company'),
  ('2026-05-01', 'Family Day', 'seed', 'company'), ('2026-05-15', 'Family Day', 'seed', 'company'),
  ('2026-06-05', 'Family Day', 'seed', 'company'), ('2026-06-19', 'Family Day', 'seed', 'company'),
  ('2026-07-03', 'Family Day', 'seed', 'company'), ('2026-07-17', 'Family Day', 'seed', 'company'),
  ('2026-08-07', 'Family Day', 'seed', 'company'), ('2026-08-21', 'Family Day', 'seed', 'company'),
  ('2026-09-04', 'Family Day', 'seed', 'company'), ('2026-09-18', 'Family Day', 'seed', 'company'),
  ('2026-10-02', 'Family Day', 'seed', 'company'), ('2026-10-16', 'Family Day', 'seed', 'company'),
  ('2026-11-06', 'Family Day', 'seed', 'company'), ('2026-11-20', 'Family Day', 'seed', 'company'),
  ('2026-12-04', 'Family Day', 'seed', 'company'), ('2026-12-18', 'Family Day', 'seed', 'company')
ON CONFLICT (holiday_date, kind) DO NOTHING;

COMMIT;
