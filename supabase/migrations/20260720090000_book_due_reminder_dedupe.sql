-- ============================================================================
-- 20260720090000_book_due_reminder_dedupe.sql
-- book-due-reminder 중복 발송 방지 컬럼 + 연장 시 초기화
-- ============================================================================
--
-- 배경
-- ----------------------------------------------------------------------------
-- book-due-reminder Edge Function 은 아래 3개 컬럼을 SELECT / UPDATE 한다.
--   notified_due_tomorrow, notified_due_today, notified_overdue_on
-- 그러나 book_checkouts 테이블에는 이 컬럼이 존재하지 않았다
-- (20260511_v2_extension_schema.sql 의 CREATE TABLE 에 없음).
-- → 함수가 배포되더라도 첫 SELECT 에서 42703(column does not exist)로 전량 실패.
--
-- 또한 함수 헤더 주석은 "연장 시 RPC 가 3개 컬럼을 NULL 로 초기화한다"고
-- 선언하고 있으나 extend_book_checkout 에 해당 로직이 없었다.
-- → 초기화가 없으면 연장으로 due_at 이 +7일 밀려도
--   notified_due_today 에 과거 발송일이 남아 있어 새 due_at 기준 알림이
--   영구히 스킵되지는 않지만(날짜 비교라 다른 날이면 재발송됨),
--   "연장 직후 같은 날 다시 D-1이 되는" 경계에서 판정이 흐려진다.
--   설계 의도(연장=알림 사이클 리셋)를 코드로 확정한다.
--
-- 설계 결정
-- ----------------------------------------------------------------------------
-- · 타입은 date. 함수가 KST 'YYYY-MM-DD' 문자열을 그대로 기록하므로
--   timestamptz 로 두면 서버 타임존 해석이 개입해 하루가 밀 수 있다.
--   date 로 두면 타임존이 개입할 여지가 원천 차단된다(근본 해결).
-- · 기본값 NULL = "아직 한 번도 발송 안 함".
-- · IF NOT EXISTS — 원격 DB 에 일부가 이미 있어도 안전하게 재실행 가능(멱등).
--
-- 적용 방법은 2가지 중 하나 (아래 bash 절차 참고)
--   A) Supabase Dashboard → SQL Editor 에 이 파일 전체를 붙여넣고 실행  (권장)
--   B) migration history repair 후 supabase db push
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) 중복 발송 방지 컬럼 3종
-- ----------------------------------------------------------------------------
ALTER TABLE public.book_checkouts
  ADD COLUMN IF NOT EXISTS notified_due_tomorrow date,
  ADD COLUMN IF NOT EXISTS notified_due_today    date,
  ADD COLUMN IF NOT EXISTS notified_overdue_on   date;

COMMENT ON COLUMN public.book_checkouts.notified_due_tomorrow IS
  'book_due_tomorrow 알림을 발송한 KST 날짜. NULL=미발송. 대여 1건당 1회.';
COMMENT ON COLUMN public.book_checkouts.notified_due_today IS
  'book_due_today 알림을 발송한 KST 날짜. NULL=미발송. 대여 1건당 1회.';
COMMENT ON COLUMN public.book_checkouts.notified_overdue_on IS
  'book_overdue 알림을 마지막으로 발송한 KST 날짜. 연체는 매일 1회 반복 발송.';

-- ----------------------------------------------------------------------------
-- 2) 리마인더 스캔용 인덱스
-- ----------------------------------------------------------------------------
--   함수는 매일 status='active' 전건을 조회한다. 기존
--   idx_book_checkouts_due (due_at) WHERE status='active' 로 충분하지만,
--   대여 건수가 늘어도 스캔이 due_at 순서로 유지되도록 그대로 활용한다.
--   (추가 인덱스 없음 — 불필요한 인덱스는 쓰기 비용만 늘린다)

-- ----------------------------------------------------------------------------
-- 3) extend_book_checkout: 연장 시 알림 사이클 리셋
-- ----------------------------------------------------------------------------
--   기존 정의(20260513_v2_phase_b_supp_rpc_functions.sql)를 그대로 유지하고
--   UPDATE 절에 3개 컬럼 NULL 초기화만 추가한다.
CREATE OR REPLACE FUNCTION public.extend_book_checkout(p_checkout_id uuid)
RETURNS book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id  uuid;
  v_checkout book_checkouts;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 1. checkout 잠금 + 조회
  SELECT * INTO v_checkout
  FROM book_checkouts
  WHERE id = p_checkout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '대여 기록 % 를 찾을 수 없습니다', p_checkout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. 권한 확인: 본인만 연장 가능 (관리자 대리 연장 불가 — 정책)
  IF v_checkout.user_id <> v_user_id THEN
    RAISE EXCEPTION '본인의 대여만 연장할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 3. 상태 확인
  IF v_checkout.status <> 'active' THEN
    RAISE EXCEPTION '활성(active) 상태의 대여만 연장할 수 있습니다 (현재: %)',
      v_checkout.status USING ERRCODE = '22023';
  END IF;

  -- 4. 연장 횟수 확인 (1회 한정)
  IF v_checkout.extension_count >= 1 THEN
    RAISE EXCEPTION '이미 한 번 연장했습니다. 추가 연장은 불가능합니다'
      USING ERRCODE = '22023';
  END IF;

  -- 5. UPDATE: due_at +7일, extension_count +1, 알림 사이클 리셋
  --    ← [2026-07-20] notified_* 3종 NULL 초기화 추가.
  --      연장으로 due_at 이 미래로 밀리므로, 새 due_at 기준으로
  --      D-1 / 당일 / 연체 알림이 다시 1회씩 나가야 한다.
  UPDATE book_checkouts
  SET due_at                = due_at + interval '7 days',
      extension_count       = extension_count + 1,
      last_extended_at      = now(),
      notified_due_tomorrow = NULL,
      notified_due_today    = NULL,
      notified_overdue_on   = NULL
  WHERE id = p_checkout_id
  RETURNING * INTO v_checkout;

  RETURN v_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.extend_book_checkout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.extend_book_checkout(uuid) TO authenticated;

COMMIT;

-- ============================================================================
-- 검증 쿼리 (적용 후 SQL Editor 에서 실행 — 3행이 나와야 정상)
-- ============================================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name   = 'book_checkouts'
--   AND column_name LIKE 'notified%'
-- ORDER BY column_name;
