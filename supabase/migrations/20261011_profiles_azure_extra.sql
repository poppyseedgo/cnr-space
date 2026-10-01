-- ============================================================================
-- 20261011_profiles_azure_extra.sql
-- profiles — Azure 프로필 전체 필드 보존 (sync-all-users v10 짝 배포)
--
-- 배경 (2026-10-01): 조직도 카드 상세에 Azure 에서 가져오는 정보를 전부 표시. name/email/employee_id/dept 는 기존 컬럼(규칙 불변),
--   나머지(jobTitle·officeLocation·mobilePhone·businessPhones·employeeId·employeeType·employeeHireDate·companyName·city·country·
--   usageLocation·preferredLanguage·createdDateTime·accountEnabled·userType·manager)는 정규화하지 않고 jsonb 원본으로 보존 —
--   Graph 필드가 늘어도 스키마 변경 없이 드로어가 그대로 표시.
-- 권한: profiles 기존 RLS/GRANT 그대로 (SELECT 는 authenticated, 쓰기는 service_role = sync)
-- ============================================================================
BEGIN;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS azure_extra     jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS azure_synced_at timestamptz;
COMMENT ON COLUMN public.profiles.azure_extra     IS '[Azure] Graph /users 응답 전체(@odata 제외, manager 는 {id,displayName,mail}). sync-all-users v10 이 매 sync 갱신. 읽기 전용';
COMMENT ON COLUMN public.profiles.azure_synced_at IS '[Azure] azure_extra 마지막 갱신 시각';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='azure_extra') THEN RAISE EXCEPTION '[검증] azure_extra 없음'; END IF;
  RAISE NOTICE '[검증] profiles azure_extra 통과';
END $$;
COMMIT;
