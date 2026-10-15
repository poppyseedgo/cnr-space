-- ============================================================================
-- 조직도 퇴사자 실명 표시 — 익명처리('(퇴사자)') 근본 수정 (고지 확정 2026-10-14)
--
-- ✅ 변경 이력
--  - [2026-10-14] 신규 — 퇴사자 카드 11장(6명) 전원 익명 표시 사고의 구조 결함 3건 수정
--      · 원인 실측: 퇴사자 표시 폴백 체인(departed_users → card.display_name)의 두 소스가 모두 비어 있었음
--        ⓐ 6명 전원 departed_users 미매칭(과거 process_departure 우회 퇴사 — 고아 케이스)
--        ⓑ org_display_names(표기 이름)가 FK ON DELETE CASCADE 라 퇴사 순간 표기 이름 자체가 삭제됨
--        ⓒ 퇴사 시점에 이름을 카드에 고정하는 메커니즘 부재
--      · [A] org_display_names.profile_id FK 제거 — 퇴사 후에도 표기 이름 보존
--            (notification_logs·departed_users 와 동일한 스냅샷 보존 관례. 정합성은 응용 레벨)
--      · [B] profiles AFTER DELETE 트리거 — 삭제되는 사람의 전체 org_cards.display_name 에
--            이름 스냅샷 고정(표기 이름 우선 → Azure 이름). RPC·sync·SQL 직접 실행 등
--            모든 퇴사 경로를 DB 가 보장(admin_roles 퇴사 회수 트리거와 동일 설계 근거).
--            수기 입력된 display_name 은 보존(덮어쓰지 않음).
--            org_cards_guard 는 org.lifecycle GUC 로 통과 — 구조 변경이 아니라 이름 고정이며,
--            Active·지난 조직도의 카드도 이름은 남아야 함.
--      · [C] 백필 — 고아 6명 중 org_change_log 스냅샷으로 이름 복구 가능한 2명
--            (박석준 257ac144 · 김수아 9f884cc0). 나머지 4명은 이름 소스 전무
--            (예약·알림로그·변경로그 전부 0건) → 프론트 수기 입력 UI 로 입력(짝 배포).
--
-- 선행: 20261020_departure_fixes.sql
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 짝 배포: 프론트 orgStatus.ts(폴백 보강)·api.ts(avatar_url)·OrgCardDrawer(수기 입력)
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 표기 이름 FK 제거 — 퇴사(profiles DELETE) 시 CASCADE 삭제 중단
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.org_display_names DROP CONSTRAINT IF EXISTS org_display_names_profile_id_fkey;
COMMENT ON COLUMN public.org_display_names.profile_id IS
  '[2026-10-14] FK 없음(의도) — 퇴사 후에도 표기 이름 보존(스냅샷 관례). 정합성은 응용 레벨에서 검증';

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 퇴사 이름 스냅샷 트리거 — 모든 퇴사 경로 커버 (profiles AFTER DELETE)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_snapshot_departed_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text;
  v_prev text;
BEGIN
  -- 표기 이름(수기) 우선, 없으면 Azure 이름 — 프론트 표시 우선순위와 동일 (SSOT: 설계 §이름 표기 원칙)
  SELECT display_name INTO v_name FROM public.org_display_names WHERE profile_id = OLD.id;
  v_name := NULLIF(btrim(COALESCE(v_name, OLD.name, '')), '');
  IF v_name IS NULL THEN RETURN OLD; END IF;

  -- org_cards_guard(초안 전용 편집 가드) 통과 — 이름 고정은 구조 변경이 아님.
  -- GUC 는 트랜잭션 로컬이므로 이전 값 저장 후 복원 (퇴사 트랜잭션 내 후속 문장 오염 방지)
  v_prev := COALESCE(current_setting('org.lifecycle', true), '');
  PERFORM set_config('org.lifecycle', 'on', true);

  UPDATE public.org_cards
     SET display_name = v_name
   WHERE profile_id = OLD.id
     AND (display_name IS NULL OR btrim(display_name) = '');   -- 수기값 보존

  PERFORM set_config('org.lifecycle', v_prev, true);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_org_snapshot_departed_name ON public.profiles;
CREATE TRIGGER trg_org_snapshot_departed_name
  AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.org_snapshot_departed_name();

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 백필 — 변경로그 이름 스냅샷으로 복구 가능한 고아 2명 (멱등: 빈 카드만)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n int := 0; v_tmp int;
BEGIN
  PERFORM set_config('org.lifecycle', 'on', true);

  UPDATE public.org_cards SET display_name = '박석준'
   WHERE profile_id = '257ac144-8127-4108-9226-ecf149d9115c'
     AND (display_name IS NULL OR btrim(display_name) = '');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_n := v_n + v_tmp;

  UPDATE public.org_cards SET display_name = '김수아'
   WHERE profile_id = '9f884cc0-4d29-4790-b401-d36d8bff25ba'
     AND (display_name IS NULL OR btrim(display_name) = '');
  GET DIAGNOSTICS v_tmp = ROW_COUNT; v_n := v_n + v_tmp;

  PERFORM set_config('org.lifecycle', '', true);
  RAISE NOTICE '[20261021 백필] 고아 카드 이름 복구 %건 (재실행 시 0건 정상)', v_n;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 검증 — 하나라도 실패하면 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'org_display_names_profile_id_fkey') THEN
    RAISE EXCEPTION '[검증 A] FK 잔존';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_org_snapshot_departed_name') THEN
    RAISE EXCEPTION '[검증 B] 스냅샷 트리거 없음';
  END IF;
  RAISE NOTICE '[20261021] 검증 통과 — FK 제거·스냅샷 트리거·백필 완료';
END $$;

COMMIT;
