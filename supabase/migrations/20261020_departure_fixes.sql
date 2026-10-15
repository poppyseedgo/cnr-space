-- ============================================================================
-- 퇴사 파이프라인 전수조사(2026-10-08) 수정안 — DB 측 4건 (C2 · H1 · H2+M3 · M1)
--
-- ✅ 변경 이력
--  - [2026-10-14] 신규 — 10/8 전수조사 수정안 7건 중 DB 계층 (고지 확정 2026-10-14)
--      · [C2] resource_bookings_guard_update — 바이패스를 current_user='postgres' 로 확장.
--             process_departure(SECURITY DEFINER, owner=postgres) 내부 UPDATE 는
--             session_user='authenticator' 라 기존 바이패스 미발동 → 진행 중 자원대여
--             보유자의 퇴사가 RETURN_CONFIRM_ADMIN_ONLY 로 전체 롤백되던 결함(시뮬 재현).
--             클라이언트 직접 UPDATE 는 여전히 차단(bookings 가드와 동일 원칙).
--      · [H1] audit_log.actor_id FK → ON DELETE SET NULL.
--             기존 NO ACTION 이 auth.users DELETE 를 차단 → 고아 36건 누적의 근본 원인.
--             actor_name 스냅샷 컬럼이 있어 행위자 이름은 보존된다.
--             (고아 36건 정리는 본 파일이 아니라 일회성 스크립트 — 데이터 삭제는 마이그레이션에 넣지 않음)
--      · [H2] process_departure ⑦ — admin_roles 삭제에 role <> 'super' 조건 추가.
--             super 처리는 revoke_roles_on_departure 트리거(①의 departed_users INSERT 발화)가
--             "대체자 있으면 회수 / 마지막이면 보존+WARNING" 으로 전담한다(일원화).
--             기존엔 트리거가 보존한 마지막 super 를 ⑦이 무조건 삭제 → super 0명 가능(시뮬 확정).
--             ⚠잔여 경로: 보존된 super 도 이후 auth.users DELETE 의 admin_roles CASCADE 로는
--             지워질 수 있다 — 트리거의 WARNING·감사 흔적(action='grant')이 추적 근거.
--      · [M3] process_departure ⑤-b — 취소 대상에 승인대기(pending) 신청 추가.
--             기존엔 미시작 active 만 취소해 퇴사자의 pending 신청이 승인 패널에 유령 잔존.
--      · [M1] on_profile_deleted 트리거 + handle_user_deletion() DROP.
--             구 로직(cancelled_by='system' 오염 시도)이 block_premature_noshow 의 RETURN NULL 로
--             우연히 무효화되던 상태 — 가드 로직이 바뀌는 순간 노쇼 오염이 재개되는 구조라 제거.
--             미래 예약 취소는 process_departure ② 가 전담(cancelled_by='departed').
--
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 순서: 이 파일 → 20261021_org_departed_names.sql
-- 배포 짝: depart-user·process-scheduled-departures 신규 배포 + sync-all-users v11 (M2·H1③)
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [C2] resource_bookings_guard_update — SECURITY DEFINER RPC 경유 통과
--      (원본 20260828 자원예약 가드 — 본문 운영 배포본 그대로, 바이패스 1줄만 확장)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resource_bookings_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin      boolean := has_admin_role('resource');
  v_today_kst  date    := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_started    boolean := now() >= OLD.start_at;
  v_period_chg boolean := NEW.start_at   IS DISTINCT FROM OLD.start_at
                       OR NEW.end_at     IS DISTINCT FROM OLD.end_at
                       OR NEW.return_due IS DISTINCT FROM OLD.return_due;
BEGIN
  IF session_user = 'postgres' OR current_user = 'postgres' THEN RETURN NEW; END IF;  -- ← [2026-10-14 C2] SECURITY DEFINER RPC(owner=postgres) 경유 통과 — process_departure ④ 강제 반납 허용

  -- (구 guard_return) 반납 확인은 관리자 전용
  IF (NEW.returned_at IS DISTINCT FROM OLD.returned_at
      OR NEW.returned_by IS DISTINCT FROM OLD.returned_by)
     AND NOT v_admin THEN
    RAISE EXCEPTION 'RETURN_CONFIRM_ADMIN_ONLY' USING ERRCODE = 'P0001';
  END IF;

  -- 불변 필드 — 개체 바꾸기는 취소 후 재예약(EXCLUDE 판정이 개체 기준)
  IF NOT v_admin AND (NEW.item_id IS DISTINCT FROM OLD.item_id
                      OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'IMMUTABLE_FIELD' USING ERRCODE = 'P0001';
  END IF;

  IF v_period_chg THEN
    IF OLD.status <> 'confirmed' OR OLD.returned_at IS NOT NULL THEN
      RAISE EXCEPTION 'BOOKING_CLOSED' USING ERRCODE = 'P0001';
    END IF;
    IF v_started AND NEW.start_at IS DISTINCT FROM OLD.start_at THEN
      RAISE EXCEPTION 'START_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.start_at IS DISTINCT FROM OLD.start_at THEN
      IF NEW.start_at < now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'PAST_START' USING ERRCODE = '23514';
      END IF;
      IF NOT v_admin
         AND NEW.start_at >= ((v_today_kst + 31)::timestamp AT TIME ZONE 'Asia/Seoul') THEN
        RAISE EXCEPTION 'DATE_LIMIT_30D' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF NEW.end_at IS DISTINCT FROM OLD.end_at AND NEW.end_at < now() THEN
      RAISE EXCEPTION 'PAST_END' USING ERRCODE = '23514';
    END IF;
    IF NEW.return_due IS DISTINCT FROM OLD.return_due AND NEW.return_due < v_today_kst THEN
      RAISE EXCEPTION 'PAST_RETURN_DUE' USING ERRCODE = '23514';
    END IF;
    NEW.period_changed_at := now();
    NEW.period_changed_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- [H1] audit_log.actor_id FK — auth.users DELETE 차단 해제 (이름은 actor_name 스냅샷 보존)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_actor_id_fkey
  FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- [H2 + M3] process_departure 재정의 (운영 배포본 기준, ⑤-b·⑦ 만 수정)
-- ────────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────────
-- [M1] 구 퇴사 트리거 제거 — process_departure ② 가 전담 (cancelled_by='departed')
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_profile_deleted ON public.profiles;
DROP FUNCTION IF EXISTS public.handle_user_deletion();

-- ────────────────────────────────────────────────────────────────────────────
-- 검증 — 하나라도 실패하면 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_src text; v_del "char";
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'resource_bookings_guard_update';
  IF v_src NOT LIKE '%current_user = ''postgres''%' THEN RAISE EXCEPTION '[검증 C2] 바이패스 확장 미반영'; END IF;

  SELECT confdeltype INTO v_del FROM pg_constraint WHERE conname = 'audit_log_actor_id_fkey';
  IF v_del IS DISTINCT FROM 'n' THEN RAISE EXCEPTION '[검증 H1] FK ON DELETE SET NULL 미반영 (%)', v_del; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'process_departure';
  IF v_src NOT LIKE '%role <> ''super''%' THEN RAISE EXCEPTION '[검증 H2] super 제외 미반영'; END IF;
  IF v_src NOT LIKE '%OR status = ''pending''%' THEN RAISE EXCEPTION '[검증 M3] pending 취소 미반영'; END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_profile_deleted') THEN RAISE EXCEPTION '[검증 M1] 구 트리거 잔존'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND proname = 'handle_user_deletion') THEN RAISE EXCEPTION '[검증 M1] 구 함수 잔존'; END IF;
  RAISE NOTICE '[20261020] 검증 통과 — C2·H1·H2·M3·M1 반영 완료';
END $$;

COMMIT;
