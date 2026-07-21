-- ============================================================================
-- [2026-07-21] 도서 연체 패널티 정책
--
-- 확정 정책
--   effective_due 초과  3일 이상 → 7일   대여 불가
--                       7일 이상 → 30일  대여 불가
--                      14일 이상 → 영구  대여 불가
--
-- ★ 핵심 1 — 제재 기준일은 due_at 이 아니라 effective_due 다
--
--   기존 정책상 한 권을 최대 14일(대여 7일 + 1회 연장 7일) 쓸 수 있다.
--   연장을 안 쓴 사람이 9일째 반납했다면 화면상 '연체 2일'이지만
--   원래 쓸 수 있었던 기간 안이다. 여기에 제재를 걸면 부당하다.
--
--     연장 미사용(extension_count = 0) → effective_due = due_at + 7일
--     연장 사용  (extension_count > 0) → effective_due = due_at
--
--   연장을 실제로 하면 extend_book_checkout 이 due_at 을 +7일 하므로
--   두 경로의 기준일이 정확히 같아진다. "연장 버튼을 눌렀는지" 로
--   제재가 갈리지 않는다 — 실제로 막고 싶은 것은 14일 초과 점유다.
--
--   ※ 화면의 '연체중' 뱃지는 지금처럼 due_at 기준을 유지한다.
--     연체 표시(7일)와 제재 카운터(14일)는 의도적으로 다른 시점이다.
--
-- ★ 핵심 2 — 미반납 중에도 즉시 차단한다 (B안)
--
--   "반납해야 제재 시작" 으로 만들면 안 돌려주는 사람이 이득을 본다.
--   30일째 붙들고 있는 사람에게 제재 이력이 없어 남은 한도로 새 책을
--   빌릴 수 있게 된다. 그래서 차단 판정은 두 축을 OR 로 묶는다.
--
--     ① 진행 중 초과 3일 이상 (미반납)  — 실시간 계산
--     ② 확정 제재 유효 (반납 시 생성)   — book_penalties 조회
--
-- ★ 핵심 3 — 제재는 테이블에 이력으로 남긴다
--
--   profiles 에 blocked_until 컬럼 하나로 두면 왜 막혔는지, 몇 번째인지,
--   누가 언제 풀었는지 추적이 안 된다. 영구 정지를 다루는 기능에서
--   근거를 남기지 않는 것은 위험하다.
--
-- 결정 사항
--   · 중복 제재  : max (더 늦은 해제일 하나만. 합산 안 함)
--   · 소급 적용  : 하지 않음. 시행 시점 미반납 건은 면제 처리
--   · 관리자 대리: 차단. 단 admin_revoke_book_penalty 로 해제 가능
--   · 분실(lost) : 제재 대상 제외 (returned_at 이 없어 계산 불가, 별도 처리)
--
-- 선행 조건
--   _diagnose_book_penalty_20260721.sql 을 먼저 실행해 ①번 인원을 확인할 것.
--
-- 배포 안전성
--   이 마이그레이션은 기존 RPC 를 DROP 하지 않고 검사만 추가한다.
--   따라서 프론트보다 먼저 배포해도 화면이 깨지지 않는다.
--   (구 프론트는 PENALTY_BLOCKED 를 모르는 코드라 일반 오류 문구로 보인다)
--
-- 멱등: 재실행 안전
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) 제재 이력 테이블
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.book_penalties (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 어떤 대여 때문인지. 대여 기록이 지워져도 제재 이력은 남겨야 하므로 SET NULL.
  checkout_id   uuid REFERENCES public.book_checkouts(id) ON DELETE SET NULL,

  overdue_days  int  NOT NULL,          -- effective_due 초과 일수 (판정 근거)
  tier          text NOT NULL CHECK (tier IN ('7d','30d','permanent')),

  starts_at     timestamptz NOT NULL DEFAULT now(),
  -- NULL = 영구. CHECK 로 tier 와의 정합성을 강제한다 —
  -- '영구인데 종료일이 있는' 행이 생기면 해제 판정이 조용히 틀어진다.
  ends_at       timestamptz,

  reason        text,

  -- 관리자 해제 이력
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_reason text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT book_penalties_tier_ends_at CHECK (
    (tier =  'permanent' AND ends_at IS NULL) OR
    (tier <> 'permanent' AND ends_at IS NOT NULL)
  ),
  CONSTRAINT book_penalties_revoke_pair CHECK (
    (revoked_at IS NULL     AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

COMMENT ON TABLE public.book_penalties IS
  '[2026-07-21] 도서 연체 제재 이력. 해제 이력을 포함해 근거를 보존한다.';
COMMENT ON COLUMN public.book_penalties.overdue_days IS
  'effective_due(연장 여지 반영 기준일) 초과 일수. due_at 초과 일수가 아니다.';

-- 차단 판정이 매 대여 시도마다 도는 경로 — 유효 제재만 훑도록 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_book_penalties_active
  ON public.book_penalties (user_id, ends_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_book_penalties_user_created
  ON public.book_penalties (user_id, created_at DESC);


-- ════════════════════════════════════════════════════════════════════════
-- 2) RLS — 본인 것만 조회, 쓰기는 RPC(SECURITY DEFINER) 경유
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.book_penalties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_penalties_select_self_or_admin" ON public.book_penalties;
CREATE POLICY "book_penalties_select_self_or_admin" ON public.book_penalties
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_admin_role('book')
    OR is_profile_admin()
  );

-- INSERT/UPDATE 정책을 만들지 않는다.
-- 생성·해제는 전부 SECURITY DEFINER RPC 가 하며, RLS 를 우회한다.
-- 직접 쓰기를 열어두면 본인이 자기 제재를 지울 수 있다.


-- ════════════════════════════════════════════════════════════════════════
-- 3) 면제 플래그 — 소급 미적용을 위한 장치
--
--    시행 시점에 이미 나가 있는 책은 "14일 넘기면 제재" 라는 규칙을
--    모르고 빌린 것이다. 그 건에는 제재를 걸지 않는다.
--    컬럼으로 두는 이유: 시행일 상수를 코드에 박으면 나중에 정책을
--    다시 바꿀 때 그 날짜가 무슨 의미였는지 알 수 없게 된다.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.book_checkouts
  ADD COLUMN IF NOT EXISTS penalty_exempt boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.book_checkouts.penalty_exempt IS
  '[2026-07-21] true 면 연체 제재 대상에서 제외. 정책 시행 전에 대여된 건과 '
  '관리자가 사유를 인정한 건에 사용한다.';

-- 시행 시점의 미반납 건 전부 면제 (소급 적용 안 함)
UPDATE public.book_checkouts
   SET penalty_exempt = true
 WHERE status IN ('active','overdue')
   AND returned_at IS NULL;


-- ════════════════════════════════════════════════════════════════════════
-- 4) 제재 기준일 SSOT — book_effective_due()
--
--    연장 여지를 반영한 기준일. 다른 모든 함수가 이 하나를 참조한다.
--    각자 계산하면 "반납 시 생성한 제재"와 "진행 중 차단 판정"이
--    서로 다른 기준을 쓰게 되어, 반납했더니 등급이 달라지는 사고가 난다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.book_effective_due(
  p_due_at          timestamptz,
  p_extension_count int
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$
  -- 연장 기일(7일)은 extend_book_checkout 의 v_extend_days 와 반드시 일치.
  SELECT p_due_at
       + CASE WHEN COALESCE(p_extension_count, 0) = 0
              THEN interval '7 days'
              ELSE interval '0'
         END;
$$;

COMMENT ON FUNCTION public.book_effective_due(timestamptz, int) IS
  '[2026-07-21] 제재 판정 기준일. 연장 미사용 건은 due_at + 7일(연장 여지). '
  '연장 사용 건은 due_at 자체가 이미 +7일 되어 있으므로 그대로.';


/** effective_due 초과 일수 (KST 날짜 단위, 음수면 기한 내) */
CREATE OR REPLACE FUNCTION public.book_overdue_days(
  p_due_at          timestamptz,
  p_extension_count int,
  p_ref_at          timestamptz DEFAULT NULL   -- NULL = 지금
)
RETURNS int
LANGUAGE sql
STABLE
AS $$
  SELECT (COALESCE(p_ref_at, now())                                  AT TIME ZONE 'Asia/Seoul')::date
       - (public.book_effective_due(p_due_at, p_extension_count)     AT TIME ZONE 'Asia/Seoul')::date;
$$;


/** 초과 일수 → 등급. 해당 없으면 NULL */
CREATE OR REPLACE FUNCTION public.book_penalty_tier(p_overdue_days int)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_overdue_days >= 14 THEN 'permanent'
    WHEN p_overdue_days >=  7 THEN '30d'
    WHEN p_overdue_days >=  3 THEN '7d'
    ELSE NULL
  END;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 5) 차단 상태 조회 — book_penalty_state()
--
--    두 축을 OR 로 묶는다.
--      ① 진행 중 초과 3일 이상 (미반납) — 실시간
--      ② 확정 제재 유효 — book_penalties
--
--    blocked_until 은 max 규칙을 따른다. 영구가 하나라도 있으면 영구다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.book_penalty_state(p_user_id uuid)
RETURNS TABLE (
  blocked        boolean,
  tier           text,          -- '7d' | '30d' | 'permanent' | 'overdue_now'
  blocked_until  timestamptz,   -- NULL = 영구 또는 반납 시까지
  overdue_days   int,
  reason         text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_live_days   int;
  v_pen         record;
  v_perm        boolean := false;
  v_until       timestamptz;
BEGIN
  -- ① 진행 중 미반납 초과 일수 중 최대값 (면제 건 제외)
  SELECT max(public.book_overdue_days(c.due_at, c.extension_count))
    INTO v_live_days
    FROM public.book_checkouts c
   WHERE c.user_id = p_user_id
     AND c.status IN ('active','overdue')
     AND c.returned_at IS NULL
     AND c.checkout_at <= now()          -- 시작 전 예약은 연체가 아니다
     AND c.penalty_exempt = false;

  -- ② 확정 제재 — 영구 여부와 가장 늦은 해제일
  SELECT bool_or(p.tier = 'permanent') AS has_perm,
         max(p.ends_at)                AS max_end
    INTO v_pen
    FROM public.book_penalties p
   WHERE p.user_id = p_user_id
     AND p.revoked_at IS NULL
     AND (p.ends_at IS NULL OR p.ends_at > now());

  v_perm  := COALESCE(v_pen.has_perm, false);
  v_until := v_pen.max_end;

  -- 영구가 최우선
  IF v_perm THEN
    RETURN QUERY SELECT true, 'permanent'::text, NULL::timestamptz,
                        COALESCE(v_live_days, 0),
                        '연체 14일 초과로 대여가 영구 제한되었습니다'::text;
    RETURN;
  END IF;

  -- 진행 중 연체가 3일을 넘으면 반납 전까지 차단.
  --   확정 제재보다 앞에 두는 이유: 지금 책을 안 돌려준 상태가 더 급한
  --   문제이고, 사용자에게도 "반납하세요" 가 정확한 안내다.
  IF COALESCE(v_live_days, -999) >= 3 THEN
    RETURN QUERY SELECT true, 'overdue_now'::text, NULL::timestamptz,
                        v_live_days,
                        format('연체 중인 도서가 있습니다 (기한 %s일 초과). 반납 후 이용할 수 있습니다',
                               v_live_days)::text;
    RETURN;
  END IF;

  IF v_until IS NOT NULL THEN
    RETURN QUERY
      SELECT true,
             (SELECT p.tier FROM public.book_penalties p
               WHERE p.user_id = p_user_id AND p.revoked_at IS NULL
                 AND p.ends_at = v_until
               LIMIT 1),
             v_until,
             COALESCE(v_live_days, 0),
             format('연체 제재로 %s 까지 대여할 수 없습니다',
                    to_char(v_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text, NULL::timestamptz,
                      COALESCE(v_live_days, 0), NULL::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.book_penalty_state(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.book_penalty_state(uuid) TO authenticated;

COMMENT ON FUNCTION public.book_penalty_state(uuid) IS
  '[2026-07-21] 대여 차단 상태. 진행 중 연체(3일 초과)와 확정 제재를 함께 본다.';


/** 내 차단 상태 — 프론트에서 타인 조회를 막기 위해 별도 래퍼 */
CREATE OR REPLACE FUNCTION public.my_book_penalty_state()
RETURNS TABLE (
  blocked boolean, tier text, blocked_until timestamptz,
  overdue_days int, reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.book_penalty_state(auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.my_book_penalty_state() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_book_penalty_state() TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 6) 반납 시 제재 생성 — admin_return_book 갱신
--
--    변경점은 'return' 분기 뒤에 제재 생성 블록을 추가한 것뿐이다.
--    분실(lost)은 returned_at 이 없어 초과 일수를 계산할 수 없고,
--    정책상 제외이므로 건드리지 않는다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_return_book(
  p_checkout_id uuid,
  p_action      text default 'return'
)
RETURNS public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin  boolean;
  v_checkout  public.book_checkouts;
  v_now       timestamptz := now();
  v_over      int;
  v_tier      text;
  v_ends      timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT coalesce(public.has_admin_role('book'), false)
      OR coalesce(public.is_profile_admin(),     false)
    INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF p_action IS NULL OR p_action NOT IN ('return', 'lost') THEN
    RAISE EXCEPTION 'INVALID_ACTION';
  END IF;

  SELECT * INTO v_checkout
    FROM public.book_checkouts
   WHERE id = p_checkout_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND';
  END IF;

  IF v_checkout.status NOT IN ('active', 'overdue') THEN
    RAISE EXCEPTION 'NOT_ACTIVE:%', v_checkout.status;
  END IF;

  IF p_action = 'return' THEN
    UPDATE public.book_checkouts
       SET status      = 'returned',
           returned_at = v_now,
           updated_at  = v_now
     WHERE id = p_checkout_id
     RETURNING * INTO v_checkout;

    UPDATE public.books
       SET status     = 'available',
           updated_at = v_now
     WHERE id = v_checkout.book_id;

    -- ── [2026-07-21 신규] 연체 제재 확정 ────────────────────────────────
    --   반납 시각을 기준으로 등급을 확정하고, 제재 기간은 반납일부터 센다.
    --   "빨리 반납할수록 빨리 풀린다" 는 방향을 만들기 위함이다.
    --   면제 건(정책 시행 전 대여분)은 건너뛴다.
    IF NOT v_checkout.penalty_exempt THEN
      v_over := public.book_overdue_days(
                  v_checkout.due_at, v_checkout.extension_count, v_now);
      v_tier := public.book_penalty_tier(v_over);

      IF v_tier IS NOT NULL THEN
        v_ends := CASE v_tier
                    WHEN '7d'  THEN v_now + interval '7 days'
                    WHEN '30d' THEN v_now + interval '30 days'
                    ELSE NULL                       -- permanent
                  END;

        -- 같은 대여 건으로 두 번 생성되지 않게 한다(반납은 1회지만
        -- 데이터 복구 등으로 재실행될 수 있다).
        IF NOT EXISTS (
          SELECT 1 FROM public.book_penalties
           WHERE checkout_id = v_checkout.id AND revoked_at IS NULL
        ) THEN
          INSERT INTO public.book_penalties
            (user_id, checkout_id, overdue_days, tier, starts_at, ends_at, reason)
          VALUES
            (v_checkout.user_id, v_checkout.id, v_over, v_tier, v_now, v_ends,
             format('반납 시 기한 %s일 초과 (연장 여지 반영 기준)', v_over));
        END IF;
      END IF;
    END IF;

  ELSE  -- p_action = 'lost'
    -- 분실은 제재 대상이 아니다 (정책). 변상 등 별도 처리.
    UPDATE public.book_checkouts
       SET status     = 'lost',
           updated_at = v_now
     WHERE id = p_checkout_id
     RETURNING * INTO v_checkout;

    UPDATE public.books
       SET status     = 'lost',
           updated_at = v_now
     WHERE id = v_checkout.book_id;
  END IF;

  RETURN v_checkout;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_return_book(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_return_book(uuid, text) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 7) 관리자 제재 해제
--
--    영구 정지를 다루는 이상 해제 수단이 반드시 있어야 한다.
--    삭제가 아니라 revoked_* 기록이다 — 누가 왜 풀었는지가 남아야 한다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_revoke_book_penalty(
  p_penalty_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS public.book_penalties
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.book_penalties;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  IF NOT (has_admin_role('book') OR is_profile_admin()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  IF p_reason IS NOT NULL AND char_length(p_reason) > 200 THEN
    RAISE EXCEPTION 'REASON_TOO_LONG';
  END IF;

  SELECT * INTO v_row
    FROM public.book_penalties
   WHERE id = p_penalty_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PENALTY_NOT_FOUND';
  END IF;

  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_REVOKED';
  END IF;

  UPDATE public.book_penalties
     SET revoked_at     = now(),
         revoked_by     = auth.uid(),
         revoked_reason = NULLIF(btrim(COALESCE(p_reason,'')), '')
   WHERE id = p_penalty_id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_book_penalty(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_book_penalty(uuid, text) TO authenticated;


/**
 * 진행 중 연체로 인한 차단을 관리자가 개별 면제
 *   해당 대여 건에 penalty_exempt 를 세운다. 출장·병가 등으로
 *   반납이 불가능한 사정이 확인됐을 때 쓴다.
 */
CREATE OR REPLACE FUNCTION public.admin_exempt_book_checkout(
  p_checkout_id uuid,
  p_exempt      boolean DEFAULT true
)
RETURNS public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.book_checkouts;
BEGIN
  IF NOT (has_admin_role('book') OR is_profile_admin()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  UPDATE public.book_checkouts
     SET penalty_exempt = p_exempt,
         updated_at     = now()
   WHERE id = p_checkout_id
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_exempt_book_checkout(uuid, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_exempt_book_checkout(uuid, boolean) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 8) 관리자용 제재 현황 조회
--
--    어드민 '대여 제한' 탭이 쓴다. 진행 중 연체 차단은 book_penalties 에
--    행이 없으므로, 확정 제재만 반환한다(진행 중 연체는 연체 관리 탭이 담당).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.admin_list_book_penalties(
  p_active_only boolean DEFAULT true
)
RETURNS TABLE (
  id             uuid,
  user_id        uuid,
  checkout_id    uuid,
  book_title     text,
  overdue_days   int,
  tier           text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  reason         text,
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoked_reason text,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id, p.user_id, p.checkout_id, bk.title,
    p.overdue_days, p.tier, p.starts_at, p.ends_at, p.reason,
    p.revoked_at, p.revoked_by, p.revoked_reason, p.created_at
  FROM public.book_penalties p
  LEFT JOIN public.book_checkouts c ON c.id = p.checkout_id
  LEFT JOIN public.books          bk ON bk.id = c.book_id
  WHERE (has_admin_role('book') OR is_profile_admin())
    AND (
      NOT p_active_only
      OR (p.revoked_at IS NULL AND (p.ends_at IS NULL OR p.ends_at > now()))
    )
  ORDER BY p.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_list_book_penalties(boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_list_book_penalties(boolean) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 9) 대여 차단 적용 — user_checkout_books / admin_checkout_books
--
--    두 RPC 모두 한도 검사 직전에 차단 검사를 넣는다.
--    관리자 대리 대여도 막는다 — 안 막으면 "관리자에게 부탁" 으로
--    제재가 무력화된다. 사정이 있으면 해제 RPC 를 쓴다.
--
--    ※ 아래 두 함수는 20260724_book_self_checkout.sql 본문에
--      차단 블록만 끼워 넣은 것이다. 나머지 로직은 동일하다.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.user_checkout_books(
  p_book_ids    integer[],
  p_notes       text        DEFAULT NULL,
  p_checkout_at timestamptz DEFAULT NULL
)
RETURNS SETOF public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_borrow_days  constant int := 7;
  c_max_borrow   constant int := 2;
  c_reserve_days constant int := 3;

  v_uid       uuid := auth.uid();
  v_ids       int[];
  v_count     int;
  v_held      int;
  v_book      record;
  v_checkout  timestamptz;
  v_due       timestamptz;
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_req_kst   date;
  v_pen       record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- ── [2026-07-21 신규] 연체 제재 차단 ──────────────────────────────────
  --   한도·기간 검사보다 앞에 둔다. 제재 중인 사용자에게
  --   "한도 초과" 같은 엉뚱한 사유를 보여주면 안 된다.
  SELECT * INTO v_pen FROM public.book_penalty_state(v_uid);
  IF v_pen.blocked THEN
    RAISE EXCEPTION 'PENALTY_BLOCKED:%:%',
      v_pen.tier,
      COALESCE(to_char(v_pen.blocked_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), '')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(COALESCE(p_book_ids, '{}'::int[])) AS x;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_BOOKS' USING ERRCODE = 'P0001';
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 100 THEN
    RAISE EXCEPTION 'NOTES_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  v_checkout := COALESCE(p_checkout_at, now());
  v_req_kst  := (v_checkout AT TIME ZONE 'Asia/Seoul')::date;

  IF v_req_kst < v_today_kst THEN
    RAISE EXCEPTION 'CHECKOUT_AT_PAST' USING ERRCODE = 'P0001';
  END IF;

  IF v_req_kst > v_today_kst + c_reserve_days THEN
    RAISE EXCEPTION 'RESERVE_TOO_FAR:%', c_reserve_days USING ERRCODE = 'P0001';
  END IF;

  v_due := v_checkout + make_interval(days => c_borrow_days);

  SELECT count(*) INTO v_held
    FROM public.book_checkouts
   WHERE user_id = v_uid
     AND status IN ('active','overdue');

  IF v_held + v_count > c_max_borrow THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:%:%', v_held, c_max_borrow
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_book IN
    SELECT id, title, status
      FROM public.books
     WHERE id = ANY(v_ids)
     ORDER BY id
     FOR UPDATE
  LOOP
    IF v_book.status IN ('maintenance','lost') THEN
      RAISE EXCEPTION 'BOOK_NOT_AVAILABLE:%:%', v_book.id, v_book.title
        USING ERRCODE = 'P0001';
    END IF;

    IF public.book_period_conflict(v_book.id, v_checkout, v_due) THEN
      RAISE EXCEPTION 'PERIOD_CONFLICT:%:%', v_book.id, v_book.title
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.books WHERE id = ANY(v_ids)) <> v_count THEN
    RAISE EXCEPTION 'BOOK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.book_checkouts
      (book_id, user_id, checkout_at, due_at, status, notes, notified_started)
    SELECT
      unnest(v_ids), v_uid, v_checkout, v_due, 'active',
      NULLIF(btrim(COALESCE(p_notes,'')), ''),
      CASE WHEN v_req_kst <= v_today_kst THEN v_today_kst ELSE NULL END
    RETURNING *
  ),
  upd AS (
    UPDATE public.books
       SET status = 'borrowed', updated_at = now()
     WHERE id = ANY(v_ids)
       AND v_req_kst <= v_today_kst
       AND status = 'available'
    RETURNING id
  )
  SELECT * FROM ins;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_checkout_books(integer[], text, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.user_checkout_books(integer[], text, timestamptz) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_checkout_books(
  p_user_id     uuid,
  p_book_ids    integer[],
  p_notes       text        DEFAULT NULL,
  p_checkout_at timestamptz DEFAULT NULL
)
RETURNS SETOF public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_borrow_days constant int := 7;
  c_max_borrow  constant int := 2;
  c_range_days  constant int := 365;

  v_ids       int[];
  v_count     int;
  v_held      int;
  v_book      record;
  v_checkout  timestamptz;
  v_due       timestamptz;
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_req_kst   date;
  v_pen       record;
BEGIN
  IF NOT (has_admin_role('book') OR is_profile_admin()) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'NO_BORROWER' USING ERRCODE = 'P0001';
  END IF;

  -- ── [2026-07-21 신규] 대여자의 연체 제재 차단 ─────────────────────────
  --   관리자 대리 대여도 막는다. 열어두면 제재가 무력화된다.
  --   정당한 사유가 있으면 admin_revoke_book_penalty /
  --   admin_exempt_book_checkout 으로 먼저 해제한 뒤 등록한다.
  SELECT * INTO v_pen FROM public.book_penalty_state(p_user_id);
  IF v_pen.blocked THEN
    RAISE EXCEPTION 'PENALTY_BLOCKED:%:%',
      v_pen.tier,
      COALESCE(to_char(v_pen.blocked_until AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'), '')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(COALESCE(p_book_ids, '{}'::int[])) AS x;
  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_BOOKS' USING ERRCODE = 'P0001';
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 100 THEN
    RAISE EXCEPTION 'NOTES_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  v_checkout := COALESCE(p_checkout_at, now());
  v_req_kst  := (v_checkout AT TIME ZONE 'Asia/Seoul')::date;

  IF v_checkout < now() - make_interval(days => c_range_days)
     OR v_checkout > now() + make_interval(days => c_range_days) THEN
    RAISE EXCEPTION 'CHECKOUT_AT_OUT_OF_RANGE:%', c_range_days
      USING ERRCODE = 'P0001';
  END IF;

  v_due := v_checkout + make_interval(days => c_borrow_days);

  SELECT count(*) INTO v_held
    FROM public.book_checkouts
   WHERE user_id = p_user_id
     AND status IN ('active','overdue');

  IF v_held + v_count > c_max_borrow THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:%:%', v_held, c_max_borrow
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_book IN
    SELECT id, title, status
      FROM public.books
     WHERE id = ANY(v_ids)
     ORDER BY id
     FOR UPDATE
  LOOP
    IF v_book.status IN ('maintenance','lost') THEN
      RAISE EXCEPTION 'BOOK_NOT_AVAILABLE:%:%', v_book.id, v_book.title
        USING ERRCODE = 'P0001';
    END IF;

    IF public.book_period_conflict(v_book.id, v_checkout, v_due) THEN
      RAISE EXCEPTION 'PERIOD_CONFLICT:%:%', v_book.id, v_book.title
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.books WHERE id = ANY(v_ids)) <> v_count THEN
    RAISE EXCEPTION 'BOOK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.book_checkouts
      (book_id, user_id, checkout_at, due_at, status, notes, notified_started)
    SELECT
      unnest(v_ids), p_user_id, v_checkout, v_due, 'active',
      NULLIF(btrim(COALESCE(p_notes,'')), ''),
      CASE WHEN v_req_kst <= v_today_kst THEN v_today_kst ELSE NULL END
    RETURNING *
  ),
  upd AS (
    UPDATE public.books
       SET status = 'borrowed', updated_at = now()
     WHERE id = ANY(v_ids)
       AND v_req_kst <= v_today_kst
       AND status = 'available'
    RETURNING id
  )
  SELECT * FROM ins;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_checkout_books(uuid, integer[], text, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_checkout_books(uuid, integer[], text, timestamptz) TO authenticated;


COMMIT;


-- ============================================================================
-- 배포 후 검증 (읽기 전용 — SQL Editor 에서 별도 실행)
-- ============================================================================
-- -- ① 테이블/컬럼 생성 확인
-- select column_name, data_type from information_schema.columns
--  where table_name = 'book_penalties' order by ordinal_position;
-- select column_name from information_schema.columns
--  where table_name = 'book_checkouts' and column_name = 'penalty_exempt';
--
-- -- ② 함수 8개 확인
-- select proname, pg_get_function_identity_arguments(oid) as args, prosecdef
--   from pg_proc
--  where proname in ('book_effective_due','book_overdue_days','book_penalty_tier',
--                    'book_penalty_state','my_book_penalty_state',
--                    'admin_revoke_book_penalty','admin_exempt_book_checkout',
--                    'admin_list_book_penalties')
--  order by proname;
--
-- -- ③ 소급 면제가 걸렸는지 (미반납 건이 전부 true 여야 정상)
-- select penalty_exempt, count(*) from public.book_checkouts
--  where status in ('active','overdue') and returned_at is null
--  group by 1;
--
-- -- ④ 등급 경계 검산 — 3/7/14 에서 정확히 바뀌는지
-- select d, public.book_penalty_tier(d)
--   from generate_series(0, 16) d;
--   -- 0~2 → null / 3~6 → 7d / 7~13 → 30d / 14~ → permanent
--
-- -- ⑤ effective_due 검산 (연장 미사용은 +7일, 사용은 그대로)
-- select public.book_effective_due('2026-07-08 12:00+09', 0) as 미사용,
--        public.book_effective_due('2026-07-15 12:00+09', 1) as 사용;
--   -- 둘 다 2026-07-15 12:00+09 여야 정상 (기준일이 같아진다)
--
-- -- ⑥ 지금 차단되는 사람이 있는지 (소급 미적용이므로 0행이 정상)
-- select p.name, s.*
--   from public.profiles p
--   cross join lateral public.book_penalty_state(p.id) s
--  where s.blocked;
-- ============================================================================
