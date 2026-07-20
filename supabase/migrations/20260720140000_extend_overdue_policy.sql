-- ============================================================================
-- 20260720140000_extend_overdue_policy.sql
-- 도서 연장 정책 확정: 연체 중에도 연장 가능, 단 연체 7일 초과 시 불가
-- ============================================================================
--
-- 배경 (현재 설계 상태 점검 결과)
-- ----------------------------------------------------------------------------
-- 프론트엔드는 이미 "연체=연장 불가"로 만들어져 있었다.
--   · bookLoan.ts canExtend()  → daysUntilDue < 0 이면 버튼 비활성화
--   · ExtendErrorCode 'OVERDUE' + "연체 중에는 연장할 수 없습니다" 문구 존재
--   · book_overdue 이메일 배너 "연체 중에는 연장 신청이 불가"
-- 그러나 extend_book_checkout RPC 에는 연체 검사가 전혀 없었다.
--   → 클라이언트 차단은 RPC 직접 호출로 우회 가능 → 실질적으로 무제한 허용.
--   → 정책이 UI 에만 존재하고 서버에 강제되지 않는 상태(권한 구멍).
--
-- 정책 확정 (2026-07-20)
-- ----------------------------------------------------------------------------
--   "연체 중에도 연장 가능. 단 연체일이 1회 연장 기일(7일)을 넘긴 경우 불가"
--
-- 상한이 왜 7일인가 (매직넘버가 아닌 이유):
--   연장은 due_at + 7일이다. 연체 d일 시점에 연장하면 잔여일수는 (7 - d).
--     d < 7  → 새 반납일이 미래       (정상)
--     d = 7  → 새 반납일이 오늘       (잔여 0일 — 허용이 정책)
--     d > 7  → 새 반납일이 여전히 과거 (연장 즉시 재연체 — 무의미)
--   즉 상한은 연장 기일과 같을 수밖에 없다. 별도 상수를 만들지 않고
--   v_extend_days 하나로 연장 기일과 유예 상한을 동시에 표현한다.
--   (연장 기일을 바꾸면 유예 상한도 자동으로 따라간다 → SSOT)
--
-- 날짜 판정 기준
-- ----------------------------------------------------------------------------
--   due_at 은 "대여시각 + 7일"이라 시각 성분(예: 14:37)을 갖는다.
--   now() 와 시각째로 비교하면 하루 경계에서 판정이 갈리므로,
--   book-due-reminder Edge Function 과 동일하게 KST 날짜 단위로만 비교한다.
--     v_overdue_days = KST날짜(now) - KST날짜(due_at)
--   시각 성분이 판정에 관여하지 않아 몇 시에 대여했든 결과가 동일하다.
--
-- 프론트 동기화 (이 마이그레이션과 반드시 함께 배포)
-- ----------------------------------------------------------------------------
--   · src/utils/bookLoan.ts       — OVERDUE_EXTEND_GRACE_DAYS, canExtend
--   · src/types/index.ts          — ExtendErrorCode 'OVERDUE_TOO_LONG'
--   · src/lib/api.ts              — parseExtendError 순서, extendErrorMessage
--   · _shared/notification-types.ts — book_overdue 배너 문구
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.extend_book_checkout(p_checkout_id uuid)
RETURNS book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id      uuid;
  v_checkout     book_checkouts;
  v_extend_days  int := 7;   -- 연장 기일 = 연체 유예 상한 (SSOT)
  v_overdue_days int;
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
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND: 대여 기록 % 를 찾을 수 없습니다', p_checkout_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. 권한 확인: 본인만 연장 가능 (관리자 대리 연장 불가 — 정책)
  IF v_checkout.user_id <> v_user_id THEN
    RAISE EXCEPTION 'NOT_OWNER: 본인의 대여만 연장할 수 있습니다' USING ERRCODE = '42501';
  END IF;

  -- 3. 상태 확인
  IF v_checkout.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_ACTIVE: 활성(active) 상태의 대여만 연장할 수 있습니다 (현재: %)',
      v_checkout.status USING ERRCODE = '22023';
  END IF;

  -- 4. 연장 횟수 확인 (1회 한정)
  --    연체 검사보다 앞에 둔다 — 이미 연장한 건은 연체 여부와 무관하게 불가이고,
  --    사용자에게도 "연장완료"가 더 정확한 사유다.
  IF v_checkout.extension_count >= 1 THEN
    RAISE EXCEPTION 'ALREADY_EXTENDED: 이미 한 번 연장했습니다. 추가 연장은 불가능합니다'
      USING ERRCODE = '22023';
  END IF;

  -- 5. 연체 유예 확인 (← [2026-07-20] 신규)
  --    KST 날짜 단위 비교. 음수면 아직 반납일 전이므로 연체 아님.
  v_overdue_days := (now()               AT TIME ZONE 'Asia/Seoul')::date
                  - (v_checkout.due_at   AT TIME ZONE 'Asia/Seoul')::date;

  IF v_overdue_days > v_extend_days THEN
    RAISE EXCEPTION
      'OVERDUE_TOO_LONG: 연체 %일이 지나 연장할 수 없습니다 (한도 %일)',
      v_overdue_days, v_extend_days
      USING ERRCODE = '22023';
  END IF;

  -- 6. UPDATE: due_at +7일, extension_count +1, 알림 사이클 리셋
  --    연장 기준점은 due_at 이다(now() 아님).
  --    now() 기준으로 하면 연체자가 정시 반납자보다 더 긴 대여기간을 갖게 되어
  --    연체에 이득이 생긴다. due_at 기준이면 연체할수록 잔여일수가 줄어든다.
  UPDATE book_checkouts
  SET due_at                = due_at + (v_extend_days || ' days')::interval,
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

COMMENT ON FUNCTION public.extend_book_checkout(uuid) IS
  '도서 연장 (1회 한정, +7일). 연체 중에도 연장 가능하나 연체 7일 초과 시 OVERDUE_TOO_LONG.';

COMMIT;

-- ============================================================================
-- 검증
-- ============================================================================
-- 1) 함수 정의에 정책이 들어갔는지
-- SELECT prosrc LIKE '%OVERDUE_TOO_LONG%' AS 정책적용
-- FROM pg_proc WHERE proname = 'extend_book_checkout';
--
-- 2) 현재 대여건별 연장 가능 여부 미리보기
-- SELECT bc.id, b.title,
--        (now() AT TIME ZONE 'Asia/Seoul')::date
--        - (bc.due_at AT TIME ZONE 'Asia/Seoul')::date AS 연체일,
--        bc.extension_count,
--        CASE
--          WHEN bc.extension_count >= 1 THEN '연장완료'
--          WHEN (now() AT TIME ZONE 'Asia/Seoul')::date
--             - (bc.due_at AT TIME ZONE 'Asia/Seoul')::date > 7 THEN '연체초과'
--          ELSE '연장가능'
--        END AS 판정
-- FROM book_checkouts bc JOIN books b ON b.id = bc.book_id
-- WHERE bc.status = 'active' ORDER BY 연체일 DESC;
