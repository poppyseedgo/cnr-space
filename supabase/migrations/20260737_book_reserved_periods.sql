-- ============================================================================
-- 20260737_book_reserved_periods.sql
-- 도서 예약 기간 공개 RPC + 관리자 예약 취소 (예약 기간 미노출 이슈, Phase 1)
--
-- ✅ 변경 이력
--  - [2026-07-30] 신규 — 고지 확정: ①예약 기간 전 직원 공개(기간만, 예약자는 관리자 한정)
--    ②date picker 달력에서 예약 구간 비활성화 ③관리자 예약 취소 신설(무통보)
--
-- 📌 근본 원인: book_checkouts_select_self_or_admin RLS 가 비관리자에게 본인 행만
--    반환 → 타인 예약 기간을 클라가 조회할 방법 자체가 없었음 (인기순 RPC 와 동일
--    뿌리). 해법도 동일 — 개인정보 없는 집계값만 SECURITY DEFINER RPC 로 노출.
--
-- 📌 설계 정정: PERIOD_CONFLICT detail 에 기간을 넣는 안(D3)은 폐기 —
--    프론트가 이 RPC 로 구간 데이터를 이미 보유하므로 충돌 시 로컬에서 표시.
--    최신 대여 RPC 본문(20260725, 각 700줄대)을 재작성할 리스크 대비 이득 0.
--
-- 📌 기존 RPC·정책·제약 무수정 — 신규 함수 2개만 추가. 프론트보다 먼저 배포해도
--    화면 안 깨짐 (RPC 부재 시 프론트는 표시만 생략하는 안전값 패턴 예정).
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- [1] get_book_reserved_periods — 살아있는 대여/예약의 기간만 전 직원 공개
--     · user_id 미포함 (예약자 신원은 관리자 화면에서 기존 RLS 로만)
--     · KST 날짜로 변환해 반환 — 달력 비활성화·표시가 전부 날짜 단위이고,
--       시각을 주면 화면마다 변환 규칙이 갈릴 위험 (시작 판정 불일치 사고 전례)
--     · 진행 중(overdue 포함) + 미래 예약 전부 — 달력은 현재 대여의 잔여
--       기간도 막아야 하므로 미래만 주면 안 됨
--     · TABLE 반환 — 개정 대비 DROP 선행 (42P13 규칙)
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_book_reserved_periods();

CREATE FUNCTION public.get_book_reserved_periods()
RETURNS TABLE (
  book_id  bigint,
  start_on date,   -- 대여 시작일 (KST)
  due_on   date    -- 반납기한 (KST)
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT bc.book_id::bigint,
         (bc.checkout_at AT TIME ZONE 'Asia/Seoul')::date,
         (bc.due_at      AT TIME ZONE 'Asia/Seoul')::date
    FROM public.book_checkouts bc
   WHERE bc.status IN ('active', 'overdue')
$$;

REVOKE ALL ON FUNCTION public.get_book_reserved_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_book_reserved_periods() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_book_reserved_periods() TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- [2] admin_cancel_book_checkout — 관리자 예약 취소 (미시작 건 한정)
--     · 기존 cancel_book_checkout 은 본인 전용(NOT_OWNER) — 관리자 경로 부재로
--       잘못 등록된 예약을 SQL 로만 지울 수 있었음
--     · 시작 판정은 KST '날짜' — utils/bookLoan.hasCheckoutStarted /
--       book_checkout_started() 와 동일식 (인라인 — 헬퍼 의존 없이 자기완결,
--       식이 어긋나면 잠금/취소 불일치 사고 재발이므로 식 자체를 복제 고정)
--     · 시작된 대여는 취소가 아니라 반납/분실(admin_return_book) 경로
--     · books.status 무수정 — 미시작 예약은 애초에 status 를 잠그지 않음
--     · 감사 흔적은 notes 에 append (별도 테이블 불요 — 행이 cancelled 로 보존됨)
--     · 알림 무발송 (고지 확정 — 퇴사 취소와 동일 원칙, 필요 시 후속 추가)
--     · 에러코드는 기존 checkoutErrorMessage 매핑 재사용:
--       NOT_AUTHENTICATED / NOT_ADMIN / CHECKOUT_NOT_FOUND / NOT_ACTIVE / ALREADY_STARTED
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_cancel_book_checkout(uuid);

CREATE FUNCTION public.admin_cancel_book_checkout(p_checkout_id uuid)
RETURNS TABLE (
  checkout_id uuid,
  book_id     bigint,
  user_id     uuid,
  book_title  text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.book_checkouts%ROWTYPE;
  v_title text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF NOT public.has_admin_role('book') THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  SELECT * INTO v_row FROM public.book_checkouts bc
   WHERE bc.id = p_checkout_id
   FOR UPDATE;                      -- 동시 취소/시작 배치와 경합 방지 (admin_return_book 동일)

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND';
  END IF;
  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_ACTIVE';
  END IF;
  -- 시작 판정 (KST 날짜) — hasCheckoutStarted SSOT 와 동일식
  IF (v_row.checkout_at AT TIME ZONE 'Asia/Seoul')::date
     <= (now() AT TIME ZONE 'Asia/Seoul')::date THEN
    RAISE EXCEPTION 'ALREADY_STARTED';
  END IF;

  UPDATE public.book_checkouts bc
     SET status = 'cancelled',
         notes  = trim(both E'\n' from
                    coalesce(bc.notes, '') || E'\n' ||
                    '[관리자 취소 · ' || to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') || ']')
   WHERE bc.id = p_checkout_id;

  SELECT b.title INTO v_title FROM public.books b WHERE b.id = v_row.book_id;

  RETURN QUERY SELECT v_row.id, v_row.book_id::bigint, v_row.user_id, coalesce(v_title, '');
END $$;

REVOKE ALL ON FUNCTION public.admin_cancel_book_checkout(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_book_checkout(uuid) TO authenticated;

COMMIT;
