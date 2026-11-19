-- ============================================================================
-- 20261022_profiles_employee_no.sql
-- 사번(employee_no) 칸 신설 — profiles · departed_users + 퇴사 시 사번 보존
--
-- ✅ 변경 이력
--  - [2026-11-19] 신규 (고지 확정 2026-11-19 "SPACE 칸 신설 작업 진행")
--      · [A] profiles.employee_no / departed_users.employee_no (text, NULL 허용) 추가.
--            ⚠ 기존 profiles.employee_id 는 이름과 달리 사번이 아니라 Entra 로그인 ID(UPN) —
--              sync-all-users 가 매 sync 덮어쓰고, 이 값으로 퇴사자를 감지한다(azUPNSet 대조).
--              여기에 사번을 넣으면 다음 sync 에서 전 직원이 퇴사 감지 대상이 되므로 별도 칸으로 둔다.
--            Entra 에는 사번이 없어(employeeId 전원 공란, 2026-11-19 실측) sync 는 이 칸을 건드리지 않는다.
--      · [B] profiles_employee_no_key — 사번 유일(값이 있는 행만. NULL · '' 는 여러 명 허용).
--      · [C] guard_profile_employee_no_client_write() + trg_profiles_employee_no_client_lock —
--            클라이언트(authenticated/anon) 직접 변경 차단. profiles_update 정책(본인 행 UPDATE 허용)으로
--            직원이 자기 사번을 API 로 바꿀 수 있는 경로를 막는다(role 잠금 20261017 [B] 와 같은 방식).
--            postgres · service_role(SQL Editor · sync · DEFINER RPC)은 통과.
--      · [D] process_departure ① — departed_users INSERT 에 employee_no 포함(재호출 시 기존 값 유지).
--            profiles 행은 퇴사 시 DELETE 되므로 옮겨 적지 않으면 사번이 사라진다.
--            본문은 운영 배포본(20261020, prosrc md5 8a40119d896d445bb7d1e4e26dcccc18) 그대로, ① 블록 3곳만 수정.
--
-- 권한: profiles 기존 RLS/GRANT 그대로 — SELECT 는 로그인 사용자 전원(profiles_read), 쓰기는 postgres · service_role.
-- 데이터: 사번 채움(11/1 직원명부 엑셀 → 회사 메일 일치 행)은 일회성 작업 — 개인 데이터라 이 파일에 넣지 않는다.
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 운영 적용: 2026-11-19 14시대(KST) Supabase MCP apply_migration (schema_migrations 20261119051105) — 적용본은 검증 블록에
--            함수 본문 md5(43203dbcd6167803c0d5ef36a31517ea = 로컬 시뮬 통과본) 대조 1줄을 더해 실행. 같은 날 사번 493/517명 채움
-- 시뮬: _sim_employee_no_20261119/ (기존 퇴사 14항목 회귀 + 사번 N1~N9, 결과 _sim__result_20261119.txt)
-- 순서: 20261021_org_departed_names.sql → 이 파일
-- 배포 짝: 없음 (Edge · 프론트 변경 없음 — sync-all-users v11 은 employee_no 를 읽지도 쓰지도 않는다)
-- 롤백: _rollback_20261022_profiles_employee_no.sql
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 사번 칸
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles       ADD COLUMN IF NOT EXISTS employee_no text;   -- ← [2026-11-19] 사번
ALTER TABLE public.departed_users ADD COLUMN IF NOT EXISTS employee_no text;   -- ← [2026-11-19] 퇴사 시점 사번 스냅샷

COMMENT ON COLUMN public.profiles.employee_no       IS '[2026-11-19] 사번(인사 명부 기준). Entra 에 없는 값 — sync 가 쓰지 않는다. 클라이언트 직접 변경 불가(trg_profiles_employee_no_client_lock)';
COMMENT ON COLUMN public.departed_users.employee_no IS '[2026-11-19] 퇴사 시점 사번 스냅샷 — process_departure ① 이 profiles.employee_no 를 옮겨 적는다';
COMMENT ON COLUMN public.profiles.employee_id       IS '⚠ 사번 아님 — Entra 로그인 ID(userPrincipalName). sync-all-users 가 매 sync 갱신 · 퇴사 감지 키. 사번은 employee_no';   -- ← [2026-11-19] 이름 혼동 방지 설명만 추가(값 · 동작 불변)

-- ────────────────────────────────────────────────────────────────────────────
-- [B] 사번 유일 — 값이 있는 행만
-- ────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS profiles_employee_no_key
  ON public.profiles (employee_no)
  WHERE employee_no IS NOT NULL AND employee_no <> '';   -- ← [2026-11-19]

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 클라이언트 직접 변경 잠금 (20261017 [B] role 잠금과 같은 방식)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_employee_no_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION '사번(employee_no)은 직접 변경할 수 없습니다. 관리자에게 요청하세요. (PROFILE_GUARD:EMPLOYEE_NO_READONLY)'
    USING ERRCODE = '42501';
END;
$function$;

COMMENT ON FUNCTION public.guard_profile_employee_no_client_write() IS
  '[2026-11-19] profiles.employee_no 는 postgres · service_role 로만 변경. 클라이언트 직접 UPDATE 차단';

DROP TRIGGER IF EXISTS trg_profiles_employee_no_client_lock ON public.profiles;
CREATE TRIGGER trg_profiles_employee_no_client_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.employee_no IS DISTINCT FROM NEW.employee_no AND current_user IN ('authenticated', 'anon'))
  EXECUTE FUNCTION public.guard_profile_employee_no_client_write();

-- ────────────────────────────────────────────────────────────────────────────
-- [D] process_departure 재정의 (운영 배포본 기준, ① 만 수정)
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
    INSERT INTO public.departed_users (id, name, email, dept, employee_id, employee_no, avatar_url, departed_at)  -- ← [2026-11-19] employee_no(사번) 열 추가
    VALUES (
      v_profile.id,
      COALESCE(v_profile.name, ''),
      COALESCE(v_profile.email, ''),
      COALESCE(v_profile.dept, ''),
      COALESCE(v_profile.employee_id, ''),
      v_profile.employee_no,                 -- ← [2026-11-19] 사번 스냅샷 (미등록이면 NULL 그대로)
      v_profile.avatar_url,
      v_now
    )
    ON CONFLICT (id) DO UPDATE
      SET avatar_url  = COALESCE(EXCLUDED.avatar_url, public.departed_users.avatar_url),
          employee_no = COALESCE(EXCLUDED.employee_no, public.departed_users.employee_no);  -- ← [2026-11-19] 재호출 시 사번은 새 값 우선 · 없으면 기존 유지
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
-- 검증 — 하나라도 실패하면 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='employee_no')
    THEN RAISE EXCEPTION '[검증 A] profiles.employee_no 없음'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='departed_users' AND column_name='employee_no')
    THEN RAISE EXCEPTION '[검증 A] departed_users.employee_no 없음'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='profiles_employee_no_key')
    THEN RAISE EXCEPTION '[검증 B] 유일 인덱스 없음'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_profiles_employee_no_client_lock' AND tgrelid='public.profiles'::regclass)
    THEN RAISE EXCEPTION '[검증 C] 잠금 트리거 없음'; END IF;

  SELECT prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND proname = 'process_departure';
  IF v_src NOT LIKE '%v_profile.employee_no%' THEN RAISE EXCEPTION '[검증 D] process_departure 사번 스냅샷 미반영'; END IF;
  IF v_src NOT LIKE '%role <> ''super''%' OR v_src NOT LIKE '%OR status = ''pending''%'
    THEN RAISE EXCEPTION '[검증 D] 20261020 수정분(H2·M3) 유실'; END IF;
  RAISE NOTICE '[20261022] 검증 통과 — 사번 칸 · 유일 인덱스 · 잠금 트리거 · 퇴사 스냅샷 반영 완료';
END $$;

COMMIT;
