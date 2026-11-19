-- ============================================================================
-- _rollback_20261023_shipping_temp.sql — 20261023_shipping_temp.sql 되돌리기
-- ⚠ shipping_records 의 등록 데이터가 함께 삭제된다. 실행 전 관리자 화면에서 엑셀을 내려받아 둘 것.
--   임시 페이지 종료(그룹웨어 재개) 후 정리할 때도 이 파일을 쓴다.
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 프론트 짝: App.tsx 의 #shipping 블록 · import · DIRECT_VIEWS 항목, adminRoles.ts 'shipping' 을 deprecated 로
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.shipping_create(jsonb);
DROP FUNCTION IF EXISTS public.shipping_update(uuid, jsonb);
DROP FUNCTION IF EXISTS public.shipping_delete(uuid);
DROP FUNCTION IF EXISTS public.shipping_fill(jsonb);
DROP FUNCTION IF EXISTS public.shipping_no_prefix(text);
DROP TABLE IF EXISTS public.shipping_records;
DROP TABLE IF EXISTS public.shipping_no_counters;

-- 'shipping' 역할 회수 (감사 로그에 흔적을 남긴다)
WITH del AS (
  DELETE FROM public.admin_roles WHERE role = 'shipping' RETURNING user_id
)
INSERT INTO public.admin_role_grants (target_user, role, action, actor)
SELECT user_id, 'shipping', 'revoke', NULL FROM del;

-- admin_set_user_roles 재계산 줄 원복 (1줄 치환)
DO $$
DECLARE
  v_def  text;
  v_from text := $s$array_length(array_remove(array_remove(v_new, 'workboard'), 'shipping'), 1) > 0$s$;
  v_to   text := $s$array_length(array_remove(v_new, 'workboard'), 1) > 0$s$;
BEGIN
  SELECT pg_get_functiondef('public.admin_set_user_roles(uuid,text[])'::regprocedure) INTO v_def;
  IF position(v_from IN v_def) = 0 THEN
    RAISE NOTICE '재계산 줄이 이미 원복 상태 — 건너뜀';
  ELSE
    EXECUTE replace(v_def, v_from, v_to);
  END IF;
END $$;
COMMENT ON FUNCTION public.admin_set_user_roles(uuid, text[]) IS NULL;

-- admin_roles CHECK 에서 'shipping' 제거
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.admin_roles'::regclass AND conname = 'admin_roles_role_check';
  IF v_def LIKE '%''shipping''::text, %' THEN
    v_def := replace(v_def, '''shipping''::text, ', '');
    ALTER TABLE public.admin_roles DROP CONSTRAINT admin_roles_role_check;
    EXECUTE 'ALTER TABLE public.admin_roles ADD CONSTRAINT admin_roles_role_check ' || v_def;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.shipping_records') IS NOT NULL THEN RAISE EXCEPTION '[롤백 검증] shipping_records 남아 있음'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND conname='admin_roles_role_check') LIKE '%shipping%'
    THEN RAISE EXCEPTION '[롤백 검증] CHECK 에 shipping 남아 있음'; END IF;
  RAISE NOTICE '[rollback 20261023] 완료';
END $$;

COMMIT;
