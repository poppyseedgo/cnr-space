-- ═══════════════════════════════════════════════════════════════════════════
-- 20260728_notification_settings.sql
--   알림 채널 on/off + 관리자 수신자 지정 (어드민 '알림 설정' 화면의 저장소)
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 왜 테이블인가 — 코드 상수로 두지 않는 이유
-- ═══════════════════════════════════════════════════════════════════════════
--
--   "대여 생성 메일은 고현정·박찬희·송보람에게만" 같은 규칙을 코드에 박으면
--   담당자가 바뀔 때마다 배포가 필요하고, 퇴사자가 남아 메일이 반송된다.
--   수신자와 on/off 는 운영 데이터이지 코드가 아니다.
--
-- ★ 미설정 = 켜짐 (fail-open)
--
--   notification_settings 에 행이 없으면 발송한다. 설정 조회가 실패해도 발송한다.
--   알림이 한 번 더 가는 것보다 "예약이 잡혔는데 아무도 모르는" 쪽이 훨씬 위험하고,
--   새 알림 타입을 추가했을 때 시드를 깜빡해도 조용히 죽지 않게 하기 위해서다.
--   끄는 것은 항상 명시적 행위여야 한다.
--
-- ★ 수신자 지정은 '있으면 대체, 없으면 기존 규칙'
--
--   notification_recipients 에 그 타입의 행이 하나라도 있으면 **그 명단만** 받는다.
--   행이 없으면 기존 규칙(admins_only=profiles ADMIN 전원 / book_admins=도서 담당)이
--   그대로 동작한다. 빈 목록으로 저장하면 "규칙대로"로 되돌아간다 — 완전히 끄고
--   싶으면 채널 토글을 쓰는 것이 맞다(끄기와 대상 지정은 다른 행위다).
--
-- 실행: Supabase SQL Editor (BEGIN..COMMIT, 멱등 — 재실행 안전)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- 1) 채널 on/off
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_settings (
  type       text        NOT NULL,
  channel    text        NOT NULL CHECK (channel IN ('email','inapp','teams')),
  enabled    boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (type, channel)
);

COMMENT ON TABLE public.notification_settings IS
  '[2026-07-23] 알림 타입×채널 on/off. 행이 없으면 켜짐(fail-open).';

-- ────────────────────────────────────────────────────────────────────────
-- 2) 관리자 수신자 지정
--
--    user_id 에 FK 를 걸지 않는다 — bookings/book_checkouts 와 동일한 기존 규칙.
--    (profiles 삭제/재생성 시 알림 설정까지 연쇄로 사라지면 복구가 어렵다)
--    대신 조회 시 profiles 를 INNER JOIN 해 살아있는 계정만 반환한다.
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_recipients (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text        NOT NULL,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_type
  ON public.notification_recipients(type);

COMMENT ON TABLE public.notification_recipients IS
  '[2026-07-23] 알림 타입별 명시 수신자. 행이 있으면 그 명단만, 없으면 기존 수신자 규칙.';

-- ────────────────────────────────────────────────────────────────────────
-- 3) RLS — 읽기/쓰기 모두 관리자만
--
--    Edge Function 은 SERVICE_ROLE_KEY 로 접속해 RLS 를 우회하므로
--    발송 경로는 이 정책의 영향을 받지 않는다.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.notification_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_settings_admin_all   ON public.notification_settings;
CREATE POLICY notification_settings_admin_all
  ON public.notification_settings FOR ALL
  USING      (public.is_profile_admin() OR public.has_admin_role('super'))
  WITH CHECK (public.is_profile_admin() OR public.has_admin_role('super'));

DROP POLICY IF EXISTS notification_recipients_admin_all ON public.notification_recipients;
CREATE POLICY notification_recipients_admin_all
  ON public.notification_recipients FOR ALL
  USING      (public.is_profile_admin() OR public.has_admin_role('super'))
  WITH CHECK (public.is_profile_admin() OR public.has_admin_role('super'));

-- ────────────────────────────────────────────────────────────────────────
-- 4) 채널 토글 — admin_set_notification_channel
--
--    upsert 로 처리한다. "끔"만 행을 만드는 방식(있으면 꺼짐)도 가능하지만,
--    그러면 "누가 언제 켰는지"가 남지 않아 감사 추적이 끊긴다.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_notification_channel(
  p_type    text,
  p_channel text,
  p_enabled boolean
)
RETURNS public.notification_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.notification_settings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.is_profile_admin() OR public.has_admin_role('super')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  IF p_channel NOT IN ('email','inapp','teams') THEN
    RAISE EXCEPTION 'INVALID_CHANNEL' USING ERRCODE = 'P0001';
  END IF;
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.notification_settings (type, channel, enabled, updated_at, updated_by)
  VALUES (p_type, p_channel, p_enabled, now(), v_uid)
  ON CONFLICT (type, channel) DO UPDATE
     SET enabled    = EXCLUDED.enabled,
         updated_at = now(),
         updated_by = v_uid
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_notification_channel(text, text, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_notification_channel(text, text, boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 5) 수신자 저장 — admin_set_notification_recipients
--
--    "추가/삭제" 가 아니라 **전체 교체**다. 화면이 보여준 목록이 곧 결과가 되어야
--    하고, 부분 갱신은 두 관리자가 동시에 편집할 때 한쪽 변경이 조용히 사라진다.
--    빈 배열을 주면 전부 지워져 기존 수신자 규칙으로 되돌아간다.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_notification_recipients(
  p_type     text,
  p_user_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cnt integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.is_profile_admin() OR public.has_admin_role('super')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  IF p_type IS NULL OR length(trim(p_type)) = 0 THEN
    RAISE EXCEPTION 'INVALID_TYPE' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.notification_recipients WHERE type = p_type;

  INSERT INTO public.notification_recipients (type, user_id, created_by)
  SELECT p_type, u, v_uid
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS u
    -- 존재하지 않는/퇴사한 계정은 저장 단계에서 거른다.
    -- 저장은 됐는데 발송에서 조용히 빠지면 "설정했는데 안 온다"가 된다.
   WHERE EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.id = u AND p.is_active IS DISTINCT FROM false)
  ON CONFLICT (type, user_id) DO NOTHING;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_notification_recipients(text, uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_set_notification_recipients(text, uuid[]) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 6) 수신자 조회 — 이름/부서까지 함께 (화면 표시용)
--    ※ TABLE 반환 함수는 개정 가능성이 있으므로 DROP 선행 (42P13 재발 방지)
-- ────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_list_notification_recipients();

CREATE FUNCTION public.admin_list_notification_recipients()
RETURNS TABLE (
  type    text,
  user_id uuid,
  name    text,
  email   text,
  dept    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_profile_admin() OR public.has_admin_role('super')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT r.type, r.user_id, p.name, p.email, p.dept
    FROM public.notification_recipients r
    JOIN public.profiles p ON p.id = r.user_id
   WHERE p.is_active IS DISTINCT FROM false
   ORDER BY r.type, p.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_notification_recipients() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_notification_recipients() TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 7) 시드 — 대여 접수 알림 수신자 3인
--
--    이름으로 찾는다. 동명이인이 있으면 3명이 넘게 들어가므로 아래 검증에서
--    건수를 반드시 확인할 것. 다르면 이 블록을 중단하고 email 로 다시 지정한다.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO public.notification_recipients (type, user_id)
SELECT 'book_checkout_created', p.id
  FROM public.profiles p
 WHERE p.name IN ('고현정','박찬희','송보람')
   AND p.is_active IS DISTINCT FROM false
ON CONFLICT (type, user_id) DO NOTHING;

DO $$
DECLARE v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM public.notification_recipients
   WHERE type = 'book_checkout_created';

  IF v_cnt <> 3 THEN
    RAISE EXCEPTION
      '수신자 시드 결과가 3명이 아닙니다 (실제 %명). 동명이인 또는 미등록 계정 가능성 — '
      '전체 롤백합니다. profiles 에서 이름을 확인한 뒤 email 기준으로 다시 지정하세요.', v_cnt;
  END IF;

  RAISE NOTICE '대여 접수 알림 수신자 3명 설정 완료';
END $$;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 배포 후 확인
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SELECT r.type, p.name, p.email, p.dept
--   FROM public.notification_recipients r
--   JOIN public.profiles p ON p.id = r.user_id
--  ORDER BY r.type, p.name;
--
-- SELECT * FROM public.notification_settings ORDER BY type, channel;
