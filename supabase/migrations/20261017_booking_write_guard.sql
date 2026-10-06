-- ============================================================================
-- 예약 쓰기 가드 + profiles.role 잠금 + 참석자 직접 쓰기 차단          (2026-10-06)
--
-- 배경 (2026-10-06 14:54 KST 사고, 운영 실측):
--   일반 사용자(profiles.role='USER')가 어드민 화면에 진입해 본인 에메랄드 예약을 직접 승인.
--   bookings_update RLS 가 `auth.role()='authenticated'` 뿐이고 승인/거절/강제취소가 전부
--   클라이언트 직접 UPDATE 라서, 서버에 "누가 무엇을 바꿀 수 있는가" 를 검사하는 지점이 없었다.
--
-- 확정 정책 (고지, 2026-10-06):
--   · 승인 권한 = ADMIN 전원 (profiles.role='ADMIN')
--   · 일반 사용자는 본인이 예약자 또는 참석자인 예약만 수정 가능
--   · 승인·거절·강제취소 등 관리자 전용 기능은 DB 에서 가드
--
--   [A] guard_booking_client_write() + trg_bookings_client_write_guard
--       클라이언트 직접 쓰기(current_user = authenticated/anon)에만 적용.
--       SECURITY DEFINER RPC(mark_noshow · sync_booking_attendees · admin_change_booking_owner ·
--       admin_resolve_noshow · process_departure …) · service_role(Edge/cron) · postgres(SQL Editor)는
--       current_user 가 달라 트리거 WHEN 에서 제외 — 각 경로는 자체 검증을 이미 갖고 있다.
--       (lock_cancelled_by_immutable 의 current_user='postgres' 우회와 같은 관례)
--
--       관리자(ADMIN)          : 전부 통과
--       비관리자 INSERT        : I1 대리 예약 금지(user_id = 본인)
--                                I2 승인룸(is_admin_only)은 pending 으로만 생성
--                                I3 관리자 표식(rejected · cancelled_by≠user · processed_by_* · reject_reason) 금지
--       비관리자 UPDATE        : U1 예약자(user_id 또는 user_email) 또는 참석자(booking_attendees.email)만
--                                U2 예약자 스냅샷(user_id·user_email·user_name·user_dept) 변경 금지 — 예약자 변경은 RPC
--                                U3 승인/거절 처리 표식(status→rejected · reject_reason · processed_by_*) 금지
--                                U4 취소 주체는 본인 취소(NULL→'user')만 — 'admin'(강제취소)·'system'·'departed' 금지
--                                U5 승인룸에서 confirmed 는 "이미 승인된 그대로"만 — pending→confirmed,
--                                   승인룸으로 이동, 승인 후 시작시각 변경·종료 연장 금지
--                                   (체크인·조기반납·취소는 통과 / 프론트 2026-09-29 확정 정책과 동일)
--       신원 판정은 sync_booking_attendees 와 동일 기준: auth.uid() + JWT email (profiles.email 은 본인 수정 가능이라 미사용)
--
--   [B] guard_profile_role_client_write() + trg_profiles_role_client_lock
--       profiles_update 정책(auth.uid()=id)에 WITH CHECK 가 없어 본인 role 을 'ADMIN' 으로 바꾸는
--       요청이 통과했다. [A] 가 profiles.role 을 관리자 기준으로 쓰므로 같은 배포에서 반드시 잠근다.
--       role 변경은 admin_set_user_roles(DEFINER) · revoke_roles_on_departure(DEFINER) · service_role 만.
--
--   [C] booking_attendees 직접 쓰기 정책(attendees_write) 제거
--       누구나 자신을 참석자로 INSERT 하면 [A] U1 을 통과하게 된다. 프론트는 2026-04-29 부터
--       sync_booking_attendees RPC 만 사용(직접 쓰기 0건 — 10/1·10/5~6 운영 로그 확인).
--
--   [D] 검증
--
-- 호환성: 현재 배포된 프론트의 모든 예약 쓰기 경로(생성·수정·체크인·조기반납·취소·노쇼 tick·참석자 동기화·
--         관리자 승인/거절/강제취소/대리예약/예약자변경)는 변경 없이 통과. 운영 최근 3영업일 직접 PATCH 106쌍 전부 U1 충족.
-- 실행: Supabase SQL Editor 전체 Run (트랜잭션 1개 · 멱등)
-- 롤백: _rollback_20261017_booking_write_guard.sql
-- ============================================================================
BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- [A] 예약 클라이언트 쓰기 가드
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_booking_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid         uuid;
  v_email       text;
  v_admin_room  boolean;
  v_participant boolean;
BEGIN
  v_uid   := auth.uid();
  v_email := lower(btrim(COALESCE(auth.jwt() ->> 'email', '')));

  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다. (BOOKING_GUARD:NOT_AUTHENTICATED)' USING ERRCODE = '42501';
  END IF;

  -- 관리자 = ADMIN 전원 (프론트 isAdmin 과 동일 기준 — 버튼이 보이는 사람이 곧 실행 가능한 사람)
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.role = 'ADMIN') THEN
    RETURN NEW;
  END IF;

  v_admin_room := COALESCE(
    (SELECT r.is_admin_only FROM public.rooms r WHERE r.room_id = NEW.room_id), false);

  -- ══ INSERT ══════════════════════════════════════════════════════════════
  IF TG_OP = 'INSERT' THEN
    -- I1 대리 예약 = 관리자 전용
    IF NEW.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION '다른 사람 명의의 예약은 관리자만 생성할 수 있습니다. (BOOKING_GUARD:PROXY_ADMIN_ONLY)'
        USING ERRCODE = '42501';
    END IF;
    -- I2 승인룸은 승인 대기로만 생성
    IF v_admin_room AND NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION '승인이 필요한 회의실은 승인 대기 상태로만 예약할 수 있습니다. (BOOKING_GUARD:APPROVAL_ADMIN_ONLY)'
        USING ERRCODE = '42501';
    END IF;
    -- I3 관리자/시스템 표식을 단 채로 생성 금지
    IF COALESCE(NEW.status = 'rejected', false)
       OR (NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by <> 'user')
       OR NEW.processed_by_name   IS NOT NULL
       OR NEW.processed_by_avatar IS NOT NULL
       OR NEW.reject_reason       IS NOT NULL THEN
      RAISE EXCEPTION '관리자 처리 정보는 관리자만 기록할 수 있습니다. (BOOKING_GUARD:ADMIN_MARK_ONLY)'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ══ UPDATE ══════════════════════════════════════════════════════════════
  -- U1 예약자 또는 참석자만 (sync_booking_attendees 와 동일 판정)
  v_participant :=
       COALESCE(OLD.user_id = v_uid, false)
    OR (v_email <> '' AND lower(btrim(COALESCE(OLD.user_email, ''))) = v_email)
    OR (v_email <> '' AND EXISTS (
          SELECT 1 FROM public.booking_attendees a
           WHERE a.booking_id = OLD.id
             AND lower(btrim(a.email)) = v_email));
  IF NOT v_participant THEN
    RAISE EXCEPTION '본인이 예약자 또는 참석자인 예약만 변경할 수 있습니다. (BOOKING_GUARD:NOT_PARTICIPANT)'
      USING ERRCODE = '42501';
  END IF;

  -- U2 예약자 변경 = 관리자 전용 (admin_change_booking_owner RPC)
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id
     OR NEW.user_email IS DISTINCT FROM OLD.user_email
     OR NEW.user_name  IS DISTINCT FROM OLD.user_name
     OR NEW.user_dept  IS DISTINCT FROM OLD.user_dept THEN
    RAISE EXCEPTION '예약자 변경은 관리자만 할 수 있습니다. (BOOKING_GUARD:OWNER_CHANGE_ADMIN_ONLY)'
      USING ERRCODE = '42501';
  END IF;

  -- U3 승인/거절 처리 = 관리자 전용
  IF (COALESCE(NEW.status = 'rejected', false) AND OLD.status IS DISTINCT FROM 'rejected')
     OR NEW.reject_reason       IS DISTINCT FROM OLD.reject_reason
     OR NEW.processed_by_name   IS DISTINCT FROM OLD.processed_by_name
     OR NEW.processed_by_avatar IS DISTINCT FROM OLD.processed_by_avatar THEN
    RAISE EXCEPTION '승인·거절은 관리자만 처리할 수 있습니다. (BOOKING_GUARD:APPROVAL_ADMIN_ONLY)'
      USING ERRCODE = '42501';
  END IF;

  -- U4 취소 주체: 본인 취소(NULL → 'user')만. 강제취소('admin')·시스템('system')·퇴사('departed') 표식 금지
  IF NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
     AND NOT (OLD.cancelled_by IS NULL AND COALESCE(NEW.cancelled_by = 'user', false)) THEN
    RAISE EXCEPTION '강제 취소는 관리자만 할 수 있습니다. (BOOKING_GUARD:CANCEL_MARK_ADMIN_ONLY)'
      USING ERRCODE = '42501';
  END IF;

  -- U5 승인룸의 confirmed 는 "이미 승인된 그대로"만 유지 가능
  --    (pending→confirmed · 승인룸으로 이동 · 승인 후 시작시각 변경/종료 연장 = 승인 우회)
  IF v_admin_room AND COALESCE(NEW.status = 'confirmed', false)
     AND NOT COALESCE(
           OLD.status   = 'confirmed'
       AND OLD.room_id  = NEW.room_id
       AND NEW.start_at = OLD.start_at
       AND NEW.end_at  <= OLD.end_at, false) THEN
    RAISE EXCEPTION '승인이 필요한 회의실 예약은 관리자 승인 후에만 확정됩니다. (BOOKING_GUARD:APPROVAL_ADMIN_ONLY)'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.guard_booking_client_write() IS
  '[2026-10-06] 클라이언트 직접 쓰기 가드 — 비관리자는 본인(예약자·참석자) 예약만, 승인/거절/강제취소/대리예약/예약자변경은 ADMIN 전용. 트리거 WHEN 이 authenticated/anon 로 한정(RPC·service_role·postgres 제외)';

DROP TRIGGER IF EXISTS trg_bookings_client_write_guard ON public.bookings;
CREATE TRIGGER trg_bookings_client_write_guard
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  WHEN (current_user IN ('authenticated', 'anon'))
  EXECUTE FUNCTION public.guard_booking_client_write();

-- ────────────────────────────────────────────────────────────────────────────
-- [B] profiles.role 클라이언트 변경 잠금
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_profile_role_client_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RAISE EXCEPTION '권한(role)은 직접 변경할 수 없습니다. 사용자 관리의 권한 부여 기능을 사용하세요. (PROFILE_GUARD:ROLE_READONLY)'
    USING ERRCODE = '42501';
END;
$function$;

COMMENT ON FUNCTION public.guard_profile_role_client_write() IS
  '[2026-10-06] profiles.role 은 admin_set_user_roles(DEFINER)·service_role 로만 변경. 클라이언트 직접 UPDATE 차단';

DROP TRIGGER IF EXISTS trg_profiles_role_client_lock ON public.profiles;
CREATE TRIGGER trg_profiles_role_client_lock
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  WHEN (OLD.role IS DISTINCT FROM NEW.role AND current_user IN ('authenticated', 'anon'))
  EXECUTE FUNCTION public.guard_profile_role_client_write();

-- ────────────────────────────────────────────────────────────────────────────
-- [C] 참석자 직접 쓰기 차단 (쓰기는 sync_booking_attendees 등 DEFINER RPC 로만)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS attendees_write ON public.booking_attendees;

-- ────────────────────────────────────────────────────────────────────────────
-- [D] 검증 — 하나라도 어긋나면 전체 롤백
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- 가드 트리거 2종이 활성 상태로 존재
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE NOT tgisinternal AND tgenabled = 'O'
     AND ( (tgrelid = 'public.bookings'::regclass AND tgname = 'trg_bookings_client_write_guard')
        OR (tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_role_client_lock') );
  IF v_n <> 2 THEN RAISE EXCEPTION '검증 실패: 가드 트리거 % / 2', v_n; END IF;

  -- booking_attendees: RLS 켜져 있고 쓰기 정책 0개 (RLS 가 꺼져 있으면 정책 제거가 무의미 → 중단)
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.booking_attendees'::regclass) THEN
    RAISE EXCEPTION '검증 실패: booking_attendees RLS 비활성';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'booking_attendees' AND cmd <> 'SELECT';
  IF v_n <> 0 THEN RAISE EXCEPTION '검증 실패: booking_attendees 쓰기 정책 %개 잔존', v_n; END IF;

  -- 가드가 우회시키는 경로가 실제로 DEFINER + postgres 소유인지 (아니면 정상 기능이 막힌다)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('mark_noshow','sync_booking_attendees','admin_change_booking_owner',
                       'admin_resolve_noshow','admin_delete_noshow_booking','process_departure','admin_set_user_roles')
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'postgres';
  IF v_n <> 7 THEN RAISE EXCEPTION '검증 실패: DEFINER RPC % / 7 (소유자·보안 속성 확인 필요)', v_n; END IF;

  -- 관리자 기준 정합성: profiles.role='ADMIN' ⟺ admin_roles 에 workboard 외 역할 보유
  SELECT count(*) INTO v_n FROM public.profiles p
   WHERE (p.role = 'ADMIN') <> EXISTS (SELECT 1 FROM public.admin_roles ar WHERE ar.user_id = p.id AND ar.role <> 'workboard');
  IF v_n <> 0 THEN RAISE EXCEPTION '검증 실패: profiles.role 과 admin_roles 불일치 %명', v_n; END IF;
END $$;

COMMIT;

-- ── 확인 (기대값: guard_triggers=2 · attendee_write_policies=0 · admins=현재 관리자 수) ──
SELECT
  (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
      AND tgname IN ('trg_bookings_client_write_guard','trg_profiles_role_client_lock'))                AS guard_triggers,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='booking_attendees' AND cmd <> 'SELECT') AS attendee_write_policies,
  (SELECT count(*) FROM public.profiles WHERE role = 'ADMIN')                                           AS admins;
