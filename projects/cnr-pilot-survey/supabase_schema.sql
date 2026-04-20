-- ============================================================================
-- C&R Space Pilot Survey - Supabase Schema
-- Project: jjzcqpbwkkujttwxksvy
-- Created: 2026-04-19
-- Purpose: CTM 파일럿 테스트 설문 응답 실시간 저장
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. survey_responses 테이블 생성
-- ----------------------------------------------------------------------------
-- 설계 원칙:
-- - session_id (UUID) 를 PK로 사용 → 브라우저 세션당 1개 row, upsert 로 실시간 저장
-- - answers (JSONB) 컬럼에 전체 응답 저장 → 스키마 변경 없이 문항 추가/수정 유연
-- - is_completed: 최종 제출 여부 (false여도 자동 저장된 중간 응답 수집 가능)
-- - anonymous: 익명 여부 (true면 respondent_name 무시)

CREATE TABLE IF NOT EXISTS public.survey_responses (
  session_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  respondent_name   TEXT,                                    -- 이름 또는 부서명 (익명이면 NULL)
  anonymous         BOOLEAN     NOT NULL DEFAULT false,
  answers           JSONB       NOT NULL DEFAULT '{}'::jsonb, -- 모든 응답 (checkbox/radio/text)
  current_step      INTEGER     NOT NULL DEFAULT 0,           -- 현재 슬라이드 인덱스 (0~16)
  is_completed      BOOLEAN     NOT NULL DEFAULT false,
  user_agent        TEXT,                                    -- 기기 식별용
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 인덱스 (집계/분석용)
CREATE INDEX IF NOT EXISTS idx_survey_responses_completed
  ON public.survey_responses (is_completed, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_survey_responses_created
  ON public.survey_responses (created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. updated_at 자동 갱신 트리거
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_survey_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_survey_responses_updated_at ON public.survey_responses;
CREATE TRIGGER trg_survey_responses_updated_at
  BEFORE UPDATE ON public.survey_responses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_survey_updated_at();

-- ----------------------------------------------------------------------------
-- 3. RLS 정책 (익명 INSERT/UPDATE 만 허용, SELECT는 관리자만)
-- ----------------------------------------------------------------------------
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- 익명 사용자(anon)도 설문 응답 생성 가능
DROP POLICY IF EXISTS "survey_anon_insert" ON public.survey_responses;
CREATE POLICY "survey_anon_insert"
  ON public.survey_responses
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 자신의 session_id 행만 UPDATE 가능 (실시간 저장용)
-- 프론트에서 session_id를 localStorage에 저장 후 WHERE 조건으로 사용
DROP POLICY IF EXISTS "survey_anon_update_own" ON public.survey_responses;
CREATE POLICY "survey_anon_update_own"
  ON public.survey_responses
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 자신의 session_id 행만 SELECT 가능 (세션 복구용)
DROP POLICY IF EXISTS "survey_anon_select_own" ON public.survey_responses;
CREATE POLICY "survey_anon_select_own"
  ON public.survey_responses
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 참고: SELECT를 "USING (true)"로 열어둔 이유
-- → session_id는 UUID이므로 타인의 응답을 열람하려면 128-bit 추측이 필요 (사실상 불가)
-- → 파일럿 기간 단기 운영이므로 실용적 보안 수준
-- → 운영 전환 시 SELECT는 service_role 전용으로 축소 권장

-- ----------------------------------------------------------------------------
-- 4. 결과 집계용 View (나중에 대시보드 만들 때 활용)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.survey_summary AS
SELECT
  COUNT(*) FILTER (WHERE is_completed = true)  AS completed_count,
  COUNT(*) FILTER (WHERE is_completed = false) AS in_progress_count,
  COUNT(*) FILTER (WHERE anonymous = true)     AS anonymous_count,
  COUNT(*)                                     AS total_count,
  MIN(created_at)                              AS first_response_at,
  MAX(updated_at)                              AS last_activity_at
FROM public.survey_responses;

-- ============================================================================
-- 배포 방법:
-- 1. Supabase Dashboard → SQL Editor
-- 2. 이 파일 전체 복사 후 Run
-- ============================================================================
