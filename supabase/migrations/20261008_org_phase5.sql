-- ============================================================================
-- 20261008_org_phase5.sql
-- 조직도(ORG) Phase 5 — 조직도 표기 이름(org_display_names)
--
-- 배경 (2026-10-01 결정): 그룹웨어 조직도는 한글 이름으로 통일돼 있으나 Azure 기반 profiles.name 은
--   한글/영문 혼용 · 부서 접미(박슬기_CO) 등 제각각. Azure 이름(profiles.name, sync SSOT)은 그대로 두고
--   조직도 안에서 보일 이름을 사람 단위로 수기 관리한다. 파일(버전)과 무관한 사람 속성이므로 org_cards 가 아니라
--   profile_id 키의 별도 테이블. 퇴사(profiles DELETE) 시 FK CASCADE 로 함께 정리.
--
-- 범위
--   [A] org_display_names — id(surrogate, 변경로그 target_id 용) · profile_id UNIQUE · display_name · note
--   [B] RLS(org 읽기/쓰기) · 변경 로그 트리거 · 권한
--   [C] 검증
--
-- 실행: Supabase SQL Editor 에 전체 붙여넣기 → Run
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 테이블
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_display_names (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  note          text,                                  -- 예: '엑셀 이관 2026-10-01' · '영문 프로필'
  updated_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_display_names_nonempty CHECK (length(btrim(display_name)) > 0)
);
COMMENT ON TABLE public.org_display_names IS '[ORG] 조직도 표기 이름 — Azure profiles.name 과 별개로 조직도 화면·CSV 에서 보일 이름. 사람 단위(파일 무관)';
COMMENT ON COLUMN public.org_display_names.display_name IS '조직도 표기 이름(수기). 비우려면 행 삭제';

-- touch
CREATE OR REPLACE FUNCTION public.org_display_names_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); NEW.updated_by := COALESCE(auth.uid(), NEW.updated_by); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_org_display_names_touch ON public.org_display_names;
CREATE TRIGGER trg_org_display_names_touch BEFORE UPDATE ON public.org_display_names
  FOR EACH ROW EXECUTE FUNCTION public.org_display_names_touch();

-- ────────────────────────────────────────────────────────────────────────────
-- [B] RLS · 변경 로그 · 권한
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_display_names ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_display_names_select ON public.org_display_names;
CREATE POLICY org_display_names_select ON public.org_display_names FOR SELECT USING (public.has_admin_role('org'));
DROP POLICY IF EXISTS org_display_names_write ON public.org_display_names;
CREATE POLICY org_display_names_write ON public.org_display_names FOR ALL
  USING (public.has_admin_role('org')) WITH CHECK (public.has_admin_role('org'));

DROP TRIGGER IF EXISTS trg_org_log ON public.org_display_names;
CREATE TRIGGER trg_org_log AFTER INSERT OR UPDATE OR DELETE ON public.org_display_names
  FOR EACH ROW EXECUTE FUNCTION public.org_log_change();

REVOKE ALL ON public.org_display_names FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_display_names TO authenticated;
GRANT ALL ON public.org_display_names TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 검증
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='org_display_names' AND policyname='org_display_names_write') THEN
    RAISE EXCEPTION '[검증] org_display_names RLS 누락';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.org_display_names'::regclass AND tgname='trg_org_log') THEN
    RAISE EXCEPTION '[검증] org_display_names 변경 로그 트리거 누락';
  END IF;
  RAISE NOTICE '[검증] ORG Phase 5 전 항목 통과';
END $$;

COMMIT;
