-- ============================================================================
-- _rollback_20261022_profiles_employee_no.sql
-- 20261022_profiles_employee_no.sql 되돌리기 — 필요할 때만 SQL Editor 에서 실행
--
-- ✅ 변경 이력
--  - [2026-11-19] 신규
-- ⚠ employee_no 칸을 지우면 채워 둔 사번 데이터도 함께 사라진다(복구 = 엑셀 재반영).
-- 순서: process_departure 를 20261020 배포본으로 먼저 되돌린 뒤 칸을 지운다(함수가 칸을 참조하므로).
-- ============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.process_departure(p_user_id uuid, p_actor uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_profile            public.profiles%ROWTYPE;
  v_now                timestamptz := now();
  v_cancelled_rooms    int := 0;
  v_cancelled_res      int := 0;
  v_returned_res       int := 0;
  v_returned_books     int := 0;
  v_cancelled_books    int := 0;
  v_revoked_roles      int := 0;
BEGIN
  -- 권한: 서비스 롤(Edge/cron) 또는 사용자 관리 권한자
  IF NOT ( auth.role() = 'service_role'
           OR public.is_profile_admin()
           OR public.has_admin_role('user') ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING HINT = '퇴사 처리 권한이 없습니다.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;

  -- ① 이력 upsert — 프로필이 이미 없으면(재호출) 이력은 이미 있으므로 skip
  IF FOUND THEN
    INSERT INTO public.departed_users (id, name, email, dept, employee_id, avatar_url, departed_at)
    VALUES (
      v_profile.id,
      COALESCE(v_profile.name, ''),
      COALESCE(v_profile.email, ''),
      COALESCE(v_profile.dept, ''),
      COALESCE(v_profile.employee_id, ''),
      v_profile.avatar_url,
      v_now
    )
    ON CONFLICT (id) DO UPDATE
      SET avatar_url = COALESCE(EXCLUDED.avatar_url, public.departed_users.avatar_url);
      -- departed_at 은 최초 기록 유지 (재호출이 퇴사일을 밀지 않도록)
  END IF;

  -- ② 미래 회의실 예약 일괄 취소 — cancelled_by='departed' (신규 실사용)
  --    checked_in 건은 미래에 존재할 수 없어 trg_block_cancel_on_checked_in 비충돌
  UPDATE public.bookings
     SET status         = 'cancelled',
         cancelled_by   = 'departed',
         auto_cancelled = true
   WHERE user_id = p_user_id
     AND start_at > v_now
     AND status IN ('confirmed','pending');
  GET DIAGNOSTICS v_cancelled_rooms = ROW_COUNT;

  -- ③ 미래 자원 예약 취소
  UPDATE public.resource_bookings
     SET status       = 'cancelled',
         cancelled_by = 'departed',
         cancelled_at = v_now
   WHERE user_id = p_user_id
     AND start_at > v_now
     AND status = 'confirmed';
  GET DIAGNOSTICS v_cancelled_res = ROW_COUNT;

  -- ④ 자원 진행 중 대여 강제 반납 (물품은 관리자가 실물 회수 — 기록만 종결)
  --    ⚠ resource_bookings_guard_update 가 [C2] 바이패스(current_user='postgres')로 통과 필수
  UPDATE public.resource_bookings
     SET returned_at = v_now,
         returned_by = p_actor
   WHERE user_id = p_user_id
     AND status = 'confirmed'
     AND start_at <= v_now
     AND returned_at IS NULL;
  GET DIAGNOSTICS v_returned_res = ROW_COUNT;

  -- ⑤-a 도서 진행 중 대여(active/overdue) 강제 반납 — 이력 보존
  --      제재 신규 부과 없음(퇴사자 대상 무의미) — admin_return_book 미경유 의도적
  UPDATE public.book_checkouts
     SET status      = 'returned',
         returned_at = v_now,
         notes       = COALESCE(notes || E'\n', '') || '[퇴사 처리 강제 반납 ' || to_char(v_now AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') || ']',
         updated_at  = v_now
   WHERE user_id = p_user_id
     AND status IN ('active','overdue')
     AND checkout_at <= v_now;
  GET DIAGNOSTICS v_returned_books = ROW_COUNT;

  -- ⑤-b 미시작 도서 예약 + 승인대기(pending) 신청 취소 — 20260724 정리 관례(cancelled+사유)
  UPDATE public.book_checkouts
     SET status        = 'cancelled',
         processed_at  = v_now,
         reject_reason = '퇴사 처리로 자동 취소되었습니다.',
         updated_at    = v_now
   WHERE user_id = p_user_id
     AND ( (status = 'active' AND checkout_at > v_now)   -- 미시작 예약 (기존)
           OR status = 'pending' );                      -- ← [2026-10-14 M3] 승인대기 신청 — 승인 패널 유령 잔존 차단
  GET DIAGNOSTICS v_cancelled_books = ROW_COUNT;

  -- ⑥ books.status 정합화 — 이 사용자 반납분 중 다른 live 대여가 없는 도서만 해제
  --    (20260724 ③-a 와 동일 판정식. lost 는 더 강한 상태라 불변)
  UPDATE public.books b
     SET status = 'available', updated_at = v_now
   WHERE b.status = 'borrowed'
     AND EXISTS (
           SELECT 1 FROM public.book_checkouts c
            WHERE c.book_id = b.id AND c.user_id = p_user_id
              AND c.returned_at = v_now )       -- 방금 이 트랜잭션에서 반납한 건
     AND NOT EXISTS (
           SELECT 1 FROM public.book_checkouts c
            WHERE c.book_id = b.id
              AND c.status IN ('active','overdue')
              AND c.checkout_at <= v_now
              AND c.returned_at IS NULL );

  -- ⑦ 관리자 권한 회수 + 감사 기록 (auth.users CASCADE 의존 제거 — 수동 경로에서도 보장)
  --    ← [2026-10-14 H2] super 제외 — super 는 revoke_roles_on_departure 트리거(①에서 발화)가
  --       "대체자 있으면 회수 / 마지막이면 보존" 으로 전담. 여기서 무조건 지우면 super 0명 가능.
  WITH del AS (
    DELETE FROM public.admin_roles
     WHERE user_id = p_user_id
       AND role <> 'super'                      -- ← [2026-10-14 H2]
     RETURNING role
  )
  INSERT INTO public.admin_role_grants (target_user, role, action, actor)
  SELECT p_user_id, role, 'revoke', p_actor FROM del;
  GET DIAGNOSTICS v_revoked_roles = ROW_COUNT;

  -- ⑧ profiles DELETE (이메일 재사용 정책 유지 — 기존 구조 보존)
  DELETE FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id',            p_user_id,
    'cancelled_bookings', v_cancelled_rooms,
    'cancelled_resources',v_cancelled_res,
    'returned_resources', v_returned_res,
    'returned_books',     v_returned_books,
    'cancelled_books',    v_cancelled_books,
    'revoked_roles',      v_revoked_roles,
    'processed_at',       v_now
  );
END $function$;

DROP TRIGGER IF EXISTS trg_profiles_employee_no_client_lock ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_employee_no_client_write();
DROP INDEX IF EXISTS public.profiles_employee_no_key;
ALTER TABLE public.departed_users DROP COLUMN IF EXISTS employee_no;
ALTER TABLE public.profiles       DROP COLUMN IF EXISTS employee_no;
COMMENT ON COLUMN public.profiles.employee_id IS NULL;

COMMIT;
