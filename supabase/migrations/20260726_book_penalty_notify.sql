-- ============================================================================
-- [2026-07-21] 연체 패널티 알림 지원 (Phase 3)
--
-- 배경
--   제재 알림은 세 시점에 필요하다.
--     ① 반납 시 제재 확정  → 프론트(adminReturnBook)가 발송
--     ② 관리자 해제        → 프론트(revokeBookPenalty)가 발송
--     ③ 기간 만료          → ★ 아무도 안 보고 있다
--
--   ③이 문제다. ends_at 이 지나는 순간 제재는 자동으로 풀리지만
--   (book_penalty_state 가 ends_at > now() 만 유효로 보므로),
--   그때 코드가 도는 곳이 없어 사용자는 "언제 풀렸는지" 알 수 없다.
--   매일 09:00 KST 에 도는 book-due-reminder 에 태워 해결한다.
--
-- 설계
--   book_started 알림과 동일한 패턴을 쓴다 — 조회와 마킹을 분리한다.
--     expire_book_penalties()            → 만료됐고 아직 미통지인 건 반환
--     mark_book_penalty_cleared_notified()→ 발송 성공한 건만 마킹
--   한 함수로 합쳐 "조회하면서 마킹" 하면, 발송이 실패했을 때 이미 마킹돼
--   그 사용자는 해제 통지를 영구히 못 받는다.
--
-- ★ 반환 타입 변경 주의 (← 2026-07-21 배포 중 두 번 겪음)
--
--   Postgres 는 CREATE OR REPLACE 로 반환 타입을 바꾸지 못한다.
--   RETURNS TABLE 의 경우 "컬럼을 하나 추가" 하는 것도 반환 타입 변경이다
--   (DETAIL: Row type defined by OUT parameters is different).
--
--   이 파일은 개정되며 여러 번 재실행되므로, TABLE 을 반환하는 함수 3종은
--   전부 DROP FUNCTION 을 선행한다. 지금 안 겪어도 다음 개정에서 겪는다.
--     · expire_book_penalties()            — checkout_id 추가
--     · get_book_penalty_by_checkout(uuid) — 방어적
--     · admin_revoke_book_penalty(uuid,text) — 반환 타입 자체가 바뀜
--
--   mark_book_penalty_cleared_notified 는 int 스칼라 반환이라 해당 없다.
--
-- (구) 반환 타입 변경 주의
--   admin_revoke_book_penalty 는 20260725 에서 RETURNS public.book_penalties 로
--   만들어졌다. 여기서 RETURNS TABLE(...) 로 바꾸므로 CREATE OR REPLACE 만으로는
--   ERROR 42P13 (cannot change return type of existing function) 이 난다.
--   → 아래 5) 블록에서 DROP FUNCTION 을 먼저 수행한다.
--
--   나머지 3개(expire_book_penalties / mark_book_penalty_cleared_notified /
--   get_book_penalty_by_checkout)는 이 파일에서 처음 만들어지므로 충돌이 없다.
--
-- 알림 딥링크 규약 (← 2026-07-21 추가)
--   인앱 알림은 booking_id 하나로 "클릭 시 열 대상" 을 가리킨다.
--   도서 알림은 이 값에 **book_checkouts.id** 를 넣는 것이 규약이다
--   (book_borrowed / book_started / book_due_* / book_overdue 전부 그렇다).
--
--   제재 알림만 penalty_id 를 넣으면 클릭 시 대여 건을 못 찾아 빈 화면이 뜬다.
--   그래서 아래 두 함수가 checkout_id 를 함께 반환한다.
--   "제재를 보여주는 화면" 이 따로 있는 게 아니라, 사용자가 알고 싶은 것은
--   "어느 대여 때문에 막혔는가" 이므로 대여 상세로 보내는 것이 맞다.
--
-- 멱등: 재실행 안전
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) 만료 통지 여부 기록 컬럼
--
--    revoked_at(관리자 해제)과 구분되는 별도 개념이다.
--    관리자 해제는 그 자리에서 프론트가 알림을 보내므로 배치 대상이 아니다.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.book_penalties
  ADD COLUMN IF NOT EXISTS notified_cleared_at timestamptz;

COMMENT ON COLUMN public.book_penalties.notified_cleared_at IS
  '[2026-07-21] 기간 만료 해제 알림을 보낸 시각. NULL 이면 미발송. '
  '관리자 해제(revoked_at)는 프론트가 즉시 발송하므로 이 컬럼을 쓰지 않는다.';

-- 배치가 매일 훑는 경로 — 미통지 건만 남기는 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_book_penalties_pending_clear
  ON public.book_penalties (ends_at)
  WHERE notified_cleared_at IS NULL
    AND revoked_at IS NULL
    AND ends_at IS NOT NULL;


-- ════════════════════════════════════════════════════════════════════════
-- 2) 만료된 제재 조회 (마킹하지 않는다)
--
--    제외 대상
--      · ends_at IS NULL   → 영구 제재. 만료가 없다
--      · revoked_at 있음   → 관리자가 이미 풀었고 그때 알림도 나갔다
--      · notified_cleared_at 있음 → 이미 통지함
--
--    ★ 같은 사용자에게 다른 제재가 아직 살아 있으면 보내지 않는다.
--      7일 제재가 풀렸는데 30일 제재가 남아 있는 상황에서
--      "대여 제한이 해제되었습니다" 를 보내면 거짓말이 된다.
--      (중복 제재는 max 규칙이라 이런 상태가 실제로 생긴다)
--      이 건은 마킹만 하고 넘어가도록 별도 플래그로 알려준다.
-- ════════════════════════════════════════════════════════════════════════
-- ★ RETURNS TABLE 의 컬럼 구성이 바뀌면 CREATE OR REPLACE 가 거부된다.
--   (DETAIL: Row type defined by OUT parameters is different)
--   이 함수는 checkout_id 컬럼이 추가되면서 구성이 바뀌었으므로 DROP 이 필요하다.
--   DROP 하면 GRANT 도 사라지므로 아래에서 재부여한다.
DROP FUNCTION IF EXISTS public.expire_book_penalties();

CREATE OR REPLACE FUNCTION public.expire_book_penalties()
RETURNS TABLE (
  penalty_id     uuid,
  user_id        uuid,
  checkout_id    uuid,     -- ← 알림 딥링크 대상. 제재 id 가 아니다 (아래 주석)
  tier           text,
  ends_at        timestamptz,
  book_title     text,
  still_blocked  boolean   -- true 면 다른 제재가 남아 있어 발송하면 안 됨
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.user_id,
    p.checkout_id,
    p.tier,
    p.ends_at,
    bk.title,
    EXISTS (
      SELECT 1
        FROM public.book_penalties q
       WHERE q.user_id = p.user_id
         AND q.id     <> p.id
         AND q.revoked_at IS NULL
         AND (q.ends_at IS NULL OR q.ends_at > now())
    ) AS still_blocked
  FROM public.book_penalties p
  LEFT JOIN public.book_checkouts c ON c.id = p.checkout_id
  LEFT JOIN public.books          bk ON bk.id = c.book_id
  WHERE p.ends_at IS NOT NULL
    AND p.ends_at <= now()
    AND p.revoked_at          IS NULL
    AND p.notified_cleared_at IS NULL
  ORDER BY p.ends_at;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_book_penalties() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.expire_book_penalties() TO service_role;

COMMENT ON FUNCTION public.expire_book_penalties() IS
  '[2026-07-21] 기간이 만료됐고 아직 해제 통지를 안 보낸 제재 목록. '
  'still_blocked=true 면 다른 제재가 남아 있으므로 발송 없이 마킹만 한다.';


-- ════════════════════════════════════════════════════════════════════════
-- 3) 통지 완료 마킹 (발송 성공분만)
--
--    still_blocked 로 발송을 건너뛴 건도 여기로 마킹한다.
--    안 그러면 매일 조회에 다시 잡혀 배치가 계속 헛돈다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mark_book_penalty_cleared_notified(
  p_penalty_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_penalty_ids IS NULL OR array_length(p_penalty_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.book_penalties
     SET notified_cleared_at = now()
   WHERE id = ANY(p_penalty_ids)
     AND notified_cleared_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_book_penalty_cleared_notified(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_book_penalty_cleared_notified(uuid[]) TO service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 4) 반납 직후 생성된 제재 조회 (알림 페이로드용)
--
--    admin_return_book 은 book_checkouts 행을 반환하므로 프론트는
--    "제재가 생겼는지" 를 알 수 없다.
--
--    프론트가 같은 공식으로 다시 계산하게 만들 수도 있지만 그러면
--    "DB 가 만든 사실" 과 "화면이 추측한 사실" 두 갈래가 생긴다.
--    둘이 어긋나면 제재가 없는데 제재 안내 메일이 나간다.
--    실제로 생성된 행을 그대로 읽는다.
-- ════════════════════════════════════════════════════════════════════════
-- 이 파일이 여러 번 개정되며 재실행되는 상황을 전제로, TABLE 반환 함수는
-- 전부 DROP 을 선행한다. 컬럼을 하나만 더해도 42P13 이 나기 때문이다.
DROP FUNCTION IF EXISTS public.get_book_penalty_by_checkout(uuid);

CREATE OR REPLACE FUNCTION public.get_book_penalty_by_checkout(
  p_checkout_id uuid
)
RETURNS TABLE (
  penalty_id   uuid,
  user_id      uuid,
  tier         text,
  overdue_days int,
  ends_at      timestamptz,
  book_title   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.user_id, p.tier, p.overdue_days, p.ends_at, bk.title
    FROM public.book_penalties p
    LEFT JOIN public.book_checkouts c ON c.id = p.checkout_id
    LEFT JOIN public.books          bk ON bk.id = c.book_id
   WHERE p.checkout_id = p_checkout_id
     AND p.revoked_at IS NULL
     AND (has_admin_role('book') OR is_profile_admin() OR p.user_id = auth.uid())
   ORDER BY p.created_at DESC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_book_penalty_by_checkout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_book_penalty_by_checkout(uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 5) 해제 RPC 갱신 — 알림에 필요한 정보를 반환하도록
--
--    기존은 book_penalties 행만 반환해 도서명을 알 수 없었다.
--    프론트가 별도 조회를 한 번 더 하는 것보다 여기서 같이 주는 편이
--    "해제 직후 상태" 를 원자적으로 읽는다는 점에서도 정확하다.
-- ════════════════════════════════════════════════════════════════════════
-- ★ CREATE OR REPLACE 로는 반환 타입을 바꿀 수 없다 (ERROR 42P13).
--   20260725 에서 이 함수는 RETURNS public.book_penalties 였고, 여기서
--   RETURNS TABLE(...) 로 바꾸므로 반드시 먼저 DROP 해야 한다.
--
--   DROP 하면 GRANT 도 함께 사라지므로 아래에서 다시 부여한다.
--   (이 파일은 트랜잭션 안이라 중간에 실패하면 구 함수가 그대로 남는다)
--
--   시그니처를 정확히 적어야 한다 — 인자가 다르면 IF EXISTS 라도
--   대상을 못 찾고 조용히 넘어가 CREATE 에서 같은 에러가 다시 난다.
DROP FUNCTION IF EXISTS public.admin_revoke_book_penalty(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_revoke_book_penalty(
  p_penalty_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS TABLE (
  penalty_id    uuid,
  user_id       uuid,
  checkout_id   uuid,     -- ← 알림 딥링크 대상
  tier          text,
  book_title    text,
  still_blocked boolean   -- 해제 후에도 다른 제재가 남아 있는가
)
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
         revoked_reason = NULLIF(btrim(COALESCE(p_reason,'')), ''),
         -- 해제하면 만료 통지 대상에서도 빠져야 한다.
         -- 안 그러면 나중에 ends_at 이 지날 때 배치가 또 잡아
         -- "해제되었습니다" 를 두 번 보낸다.
         notified_cleared_at = now()
   WHERE id = p_penalty_id
   RETURNING * INTO v_row;

  RETURN QUERY
  SELECT
    v_row.id,
    v_row.user_id,
    v_row.checkout_id,
    v_row.tier,
    (SELECT bk.title
       FROM public.book_checkouts c
       JOIN public.books bk ON bk.id = c.book_id
      WHERE c.id = v_row.checkout_id),
    EXISTS (
      SELECT 1 FROM public.book_penalties q
       WHERE q.user_id = v_row.user_id
         AND q.id     <> v_row.id
         AND q.revoked_at IS NULL
         AND (q.ends_at IS NULL OR q.ends_at > now())
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_revoke_book_penalty(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_revoke_book_penalty(uuid, text) TO authenticated;


COMMIT;


-- ============================================================================
-- 배포 후 검증 (읽기 전용)
-- ============================================================================
-- -- ① 컬럼/함수 생성 확인
-- select column_name from information_schema.columns
--  where table_name = 'book_penalties' and column_name = 'notified_cleared_at';
--
-- select proname,
--        pg_get_function_identity_arguments(oid) as args,
--        pg_get_function_result(oid)             as returns
--   from pg_proc
--  where proname in ('expire_book_penalties','mark_book_penalty_cleared_notified',
--                    'get_book_penalty_by_checkout','admin_revoke_book_penalty')
--  order by proname;
--   expire_book_penalties     의 returns 에 checkout_id uuid 가 있어야 한다
--   admin_revoke_book_penalty 의 returns 에 checkout_id uuid 가 있어야 한다
--   (없으면 구 버전이 남은 것 — DROP 이 안 걸렸다)
--
-- -- ② 만료 대상 조회 (아직 제재가 없으면 0행이 정상)
-- select * from public.expire_book_penalties();
--
-- -- ③ 배치 재실행 안전성 — 마킹 후 다시 조회하면 사라져야 한다
-- --   (테스트 제재를 만들어 확인할 것. 운영 데이터로 하지 말 것)
-- ============================================================================
