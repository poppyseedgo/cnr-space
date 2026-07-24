-- ═══════════════════════════════════════════════════════════════════════════
-- 20260729_announcements.sql — 헤더 상단 공지 배너
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 배경
-- ═══════════════════════════════════════════════════════════════════════════
--
--   NoticeBar 컴포넌트는 2026-04-30 에 만들어졌지만 데이터가 App.tsx 의
--   `MOCK_ANNOUNCEMENT` 상수였다. 그래서 공지를 바꾸려면 **코드 수정 + 배포**가
--   필요했고, 실제로 5/12 핫픽스 안내가 두 달 넘게 그대로 떠 있었다.
--   게시 기간이 없으니 "내려야 한다"는 사실을 아무도 기억하지 못한 것이다.
--
--   → 내용·색·게시기간을 DB 로 옮기고, 기간이 지나면 **자동으로 사라지게** 한다.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ★ 노출 판정을 어디서 하는가 — RLS 에서 한다
-- ═══════════════════════════════════════════════════════════════════════════
--
--   "지금 보여줄 공지인가" 를 프론트에서 계산하면, 화면마다 조건이 갈리고
--   기간이 지난 공지가 어딘가에서 계속 보인다(도서 모듈에서 이미 겪은 패턴).
--   RLS SELECT 정책에 기간·활성 조건을 넣어 **일반 사용자에게는 애초에
--   보일 공지만 내려간다.** 관리자는 전부 본다.
--
--   기간은 timestamptz 로 저장하고 비교도 now() 로 한다. 날짜 문자열로 비교하면
--   서버 타임존에 따라 하루가 밀린다(20260727 에서 겪은 그것).
--   UI 는 KST 하루 단위로 다룬다 — 시작 00:00:00+09, 종료 23:59:59+09.
--
-- 실행: Supabase SQL Editor (BEGIN..COMMIT · 멱등 · 재실행 안전)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message     text        NOT NULL,
  bg_color    text        NOT NULL DEFAULT '#E6F2FF',
  text_color  text        NOT NULL DEFAULT '#1E1E1E',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid,
  CONSTRAINT announcements_period_check CHECK (ends_at > starts_at),
  CONSTRAINT announcements_message_check CHECK (length(btrim(message)) > 0)
);

COMMENT ON TABLE public.announcements IS
  '[2026-07-24] 헤더 상단 공지 배너. 노출 판정은 RLS(is_active + 기간)에서 한다.';

-- 노출 대상 조회용 — 기간이 겹치는 공지가 여럿이면 최근 시작한 것부터
CREATE INDEX IF NOT EXISTS idx_announcements_live
  ON public.announcements (starts_at DESC, created_at DESC)
  WHERE is_active;

-- ────────────────────────────────────────────────────────────────────────
-- RLS
--   · 일반 사용자: 지금 게시 중인 공지만 SELECT
--   · 관리자: 전부 SELECT (지난 공지 재사용·예약 등록 확인용)
--   · 쓰기: 관리자만. 실제 저장은 아래 RPC 를 쓰지만, 정책도 함께 잠근다.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS announcements_select ON public.announcements;
CREATE POLICY announcements_select
  ON public.announcements FOR SELECT
  USING (
    (is_active AND now() >= starts_at AND now() <= ends_at)
    OR public.is_profile_admin()
    OR public.has_admin_role('super')
  );

DROP POLICY IF EXISTS announcements_admin_write ON public.announcements;
CREATE POLICY announcements_admin_write
  ON public.announcements FOR ALL
  USING      (public.is_profile_admin() OR public.has_admin_role('super'))
  WITH CHECK (public.is_profile_admin() OR public.has_admin_role('super'));

-- ────────────────────────────────────────────────────────────────────────
-- 저장 — admin_save_announcement
--
--   p_id 가 NULL 이면 생성, 있으면 수정. 한 함수로 묶은 이유는 화면이
--   "새 공지 / 기존 공지 편집" 을 같은 폼으로 다루기 때문이다.
--   폼이 하나인데 저장 경로가 둘이면 검증 규칙이 갈린다.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_save_announcement(
  p_id         uuid,
  p_message    text,
  p_bg_color   text,
  p_text_color text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_is_active  boolean
)
RETURNS public.announcements
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.announcements;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (public.is_profile_admin() OR public.has_admin_role('super')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) = 0 THEN
    RAISE EXCEPTION 'EMPTY_MESSAGE' USING ERRCODE = 'P0001';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'INVALID_PERIOD' USING ERRCODE = 'P0001';
  END IF;
  -- 색은 #RGB / #RRGGBB 만 허용. 임의 문자열이 들어오면 배너가 통째로 깨진다.
  IF p_bg_color !~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$'
     OR p_text_color !~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$' THEN
    RAISE EXCEPTION 'INVALID_COLOR' USING ERRCODE = 'P0001';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.announcements
      (message, bg_color, text_color, starts_at, ends_at, is_active, created_by, updated_by)
    VALUES
      (btrim(p_message), p_bg_color, p_text_color, p_starts_at, p_ends_at, p_is_active, v_uid, v_uid)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.announcements
       SET message    = btrim(p_message),
           bg_color   = p_bg_color,
           text_color = p_text_color,
           starts_at  = p_starts_at,
           ends_at    = p_ends_at,
           is_active  = p_is_active,
           updated_at = now(),
           updated_by = v_uid
     WHERE id = p_id
     RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ANNOUNCEMENT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_save_announcement(uuid, text, text, text, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_save_announcement(uuid, text, text, text, timestamptz, timestamptz, boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 삭제 — 지난 공지는 남겨 두는 편이 낫지만(문구 재사용), 오타 등록은 지운다
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT (public.is_profile_admin() OR public.has_admin_role('super')) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.announcements WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_announcement(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_delete_announcement(uuid) TO authenticated;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 배포 후 확인
-- ═══════════════════════════════════════════════════════════════════════════
--
-- -- [A] 지금 게시 중인 공지 (일반 사용자에게 보이는 것과 동일)
-- SELECT id, message, bg_color, text_color, starts_at, ends_at
--   FROM public.announcements
--  WHERE is_active AND now() BETWEEN starts_at AND ends_at
--  ORDER BY starts_at DESC, created_at DESC;
--
-- -- [B] 기존 하드코딩 공지를 옮기려면 (선택)
-- --     App.tsx 의 MOCK_ANNOUNCEMENT 는 이 마이그레이션 이후 사용하지 않는다.
-- -- SELECT public.admin_save_announcement(
-- --   NULL, '공지 문구', '#E6F2FF', '#1E1E1E',
-- --   '2026-07-25T00:00:00+09:00', '2026-07-31T23:59:59+09:00', true);
