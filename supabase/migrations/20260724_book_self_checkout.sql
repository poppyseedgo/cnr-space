-- ============================================================================
-- [2026-07-21] 대여 정책 변경 — 승인 플로우 폐지 + 기간 겹침 예약(B안)
--
-- 확정 정책
--   ① 사용자가 [대여하기] 를 누르면 승인 없이 즉시 대여가 성립한다.
--   ② 사용자는 오늘 ~ 오늘+3일 범위에서 대여 시작일을 지정할 수 있다(예약).
--   ③ 반납기한은 현행 유지 — 대여일 + 7일.
--   ④ 같은 도서라도 기간이 겹치지 않으면 여러 예약이 공존한다.
--   ⑤ 대여 시작일이 도래하면 도서가 '대여중'으로 전환되고 알림이 나간다.
--
-- ★ 이 마이그레이션의 핵심: books.status 의 의미 축소
--
--   변경 전 : 'borrowed' = 예약 포함 점유 (미래 예약도 즉시 잠금)
--   변경 후 : 'borrowed' = 지금 물리적으로 나가 있음
--
--   왜 바꿔야 하는가. 겹침 검사(B안)를 도입하면 "3일 뒤 예약이 잡힌 책"도
--   오늘~내일 구간은 비어 있다. 예약이 books.status 를 즉시 잠그면 그 구간을
--   아무도 쓸 수 없어 B안이 성립하지 않는다. 예약은 book_checkouts 의 기간이
--   표현하고, books.status 는 현재 시점의 물리 상태만 표현하도록 역할을 나눈다.
--
-- ★ 겹침 차단은 DB 제약이 최종 방어선
--
--   RPC 안에서 SELECT 로 먼저 검사하지만, 그것만으로는 두 사용자가 같은 순간에
--   같은 책을 예약하는 경합을 막을 수 없다(검사와 INSERT 사이에 틈이 있다).
--   EXCLUDE 제약이 있어야 구조적으로 불가능해진다. RPC 의 사전 검사는
--   "친절한 한글 메시지"를 위한 것이고, 정합성 보장은 제약이 한다.
--
--   경계는 양끝 포함 '[]' 이다. 앞사람 반납기한 당일에 뒷사람이 시작하는 것을
--   허용하면 오프라인 인수인계가 그날 안에 반드시 일어나야 한다. 앞사람이
--   일찍 반납하면 status='returned' 가 되어 제약 대상에서 빠지므로,
--   실제 운영에서는 즉시 다음 대여가 가능하다.
--
-- 선행 조건
--   _diagnose_book_policy_20260721.sql 의 ①②가 0행이어야 한다.
--   겹치는 기존 데이터가 있으면 EXCLUDE 제약 생성에서 전체가 롤백된다.
--
-- 실행 순서
--   20260716 → 20260718 → 20260720* → 20260721_popularity
--   → 20260722(신청승인) → 20260723_admin_return → 이 파일
--
-- 멱등: 재실행 안전 (IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS)
-- ============================================================================

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 0) 확장 — btree_gist
--    EXCLUDE ... USING gist 에서 정수 컬럼(book_id)에 '=' 를 쓰려면 필요하다.
--    gist 는 기본적으로 범위/기하 타입만 다루고 정수 동등 비교를 모른다.
-- ════════════════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ════════════════════════════════════════════════════════════════════════
-- 1) 승인 대기(pending) 잔여분 정리
--
--    승인 플로우가 사라지므로 pending 은 어느 화면에도 표시되지 않는 유령이
--    된다. 도서를 점유하지도 않으면서 1인 한도만 깎는 최악의 상태다.
--    고지 결정: "없을 것으로 보이나 혹시 있으면 취소 처리".
--
--    reject_reason 에 사유를 남겨 사용자가 마이페이지 이력에서 이유를 볼 수
--    있게 한다(cancelled 는 원래 사용자 자의 취소라 사유가 비어 있다).
-- ════════════════════════════════════════════════════════════════════════
UPDATE public.book_checkouts
   SET status        = 'cancelled',
       processed_at  = now(),
       reject_reason = '대여 정책 변경으로 승인 절차가 폐지되어 자동 취소되었습니다. 도서관에서 다시 대여해 주세요.',
       updated_at    = now()
 WHERE status = 'pending';


-- ════════════════════════════════════════════════════════════════════════
-- 2) 대여 시작 알림 dedupe 컬럼
--
--    기존 알림 dedupe 3종(notified_due_tomorrow / due_today / overdue_on)과
--    동일한 패턴이다. date 로 저장한다 — timestamptz 로 두면 타임존 변환에서
--    날짜가 밀려 "어제 보냈는데 오늘 또 보냄"이 생긴다(2026-07-20 사례).
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.book_checkouts
  ADD COLUMN IF NOT EXISTS notified_started date;

COMMENT ON COLUMN public.book_checkouts.notified_started IS
  '[2026-07-21] 대여 시작 알림을 보낸 KST 날짜. NULL = 미발송. '
  '예약(미래 시작) 건이 시작일에 도달했을 때 1회만 통지하기 위한 dedupe 키.';


-- ════════════════════════════════════════════════════════════════════════
-- 3) books.status 정합화 — 새 의미에 맞게 현재 데이터를 맞춘다
--
--    순서 주의: ③-a 를 먼저 해야 한다. 미래 예약으로 잠긴 도서를 먼저 풀고
--    나서 진행 중 대여를 잠가야, 같은 도서에 두 조건이 걸렸을 때 결과가
--    'borrowed' 로 수렴한다. 반대로 하면 available 로 잘못 끝난다.
-- ════════════════════════════════════════════════════════════════════════

-- ③-a 미래 시작 예약 때문에 잠겨 있던 도서를 푼다
UPDATE public.books b
   SET status = 'available', updated_at = now()
 WHERE b.status = 'borrowed'
   AND NOT EXISTS (                       -- 지금 진행 중인 대여가 없고
         SELECT 1 FROM public.book_checkouts c
          WHERE c.book_id = b.id
            AND c.status IN ('active','overdue')
            AND c.checkout_at <= now()
            AND c.returned_at IS NULL
       );

-- ③-b 진행 중 대여가 있는데 borrowed 가 아닌 도서를 잠근다
--     (분실 처리된 도서는 건드리지 않는다 — lost 가 더 강한 상태다)
UPDATE public.books b
   SET status = 'borrowed', updated_at = now()
 WHERE b.status NOT IN ('borrowed','lost')
   AND EXISTS (
         SELECT 1 FROM public.book_checkouts c
          WHERE c.book_id = b.id
            AND c.status IN ('active','overdue')
            AND c.checkout_at <= now()
            AND c.returned_at IS NULL
       );


-- ════════════════════════════════════════════════════════════════════════
-- 4) 기간 겹침 방지 제약 (핵심)
--
--    · 대상: 살아 있는 대여만 (active / overdue)
--            returned / lost / cancelled / rejected 는 점유하지 않는다.
--    · 범위: [checkout_at, due_at] 양끝 포함
--    · 이름을 고정해 재실행 시 중복 생성되지 않게 한다.
-- ════════════════════════════════════════════════════════════════════════
ALTER TABLE public.book_checkouts
  DROP CONSTRAINT IF EXISTS book_checkouts_no_overlap;

ALTER TABLE public.book_checkouts
  ADD CONSTRAINT book_checkouts_no_overlap
  EXCLUDE USING gist (
    book_id WITH =,
    tstzrange(checkout_at, due_at, '[]') WITH &&
  )
  WHERE (status IN ('active','overdue'));

COMMENT ON CONSTRAINT book_checkouts_no_overlap ON public.book_checkouts IS
  '[2026-07-21] 같은 도서의 대여 기간 중복 금지. 예약(미래 대여) 도입에 따른 '
  '핵심 정합성 제약. RPC 사전 검사만으로는 동시 요청 경합을 막을 수 없다.';


-- ════════════════════════════════════════════════════════════════════════
-- 5) 조회 성능 — 겹침 검사와 시작일 배치가 매번 도는 경로
-- ════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_book_checkouts_live_period
  ON public.book_checkouts (book_id, checkout_at, due_at)
  WHERE status IN ('active','overdue');

CREATE INDEX IF NOT EXISTS idx_book_checkouts_start_pending
  ON public.book_checkouts (checkout_at)
  WHERE status IN ('active','overdue') AND notified_started IS NULL;


-- ════════════════════════════════════════════════════════════════════════
-- 6) 폐기 RPC 제거
--
--    이 4개는 저장소에 마이그레이션 파일이 없다(운영 DB 에만 존재).
--    여기서 DROP 하면서 형상 결손도 함께 정리된다.
--    ※ 진단 SQL ⑦ 결과와 시그니처가 다르면 아래를 실제 값으로 고칠 것.
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.request_book_checkout(integer[], text);
DROP FUNCTION IF EXISTS public.admin_approve_book_request(uuid, text);
DROP FUNCTION IF EXISTS public.admin_reject_book_request(uuid, text, text);
DROP FUNCTION IF EXISTS public.cancel_book_request(uuid);


-- ════════════════════════════════════════════════════════════════════════
-- 7) 공용 헬퍼 — 대여 가능 기간 검사
--
--    user_checkout_books / admin_checkout_books 가 같은 규칙을 써야 한다.
--    각자 구현하면 사용자와 관리자가 서로 다른 판정을 하게 된다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.book_period_conflict(
  p_book_id     integer,
  p_checkout_at timestamptz,
  p_due_at      timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.book_checkouts c
     WHERE c.book_id = p_book_id
       AND c.status IN ('active','overdue')
       AND tstzrange(c.checkout_at, c.due_at, '[]')
        && tstzrange(p_checkout_at, p_due_at, '[]')
  );
$$;

COMMENT ON FUNCTION public.book_period_conflict(integer, timestamptz, timestamptz) IS
  '[2026-07-21] 해당 도서의 요청 기간이 기존 활성 대여와 겹치는지. '
  '사용자/관리자 대여 RPC 가 동일 규칙을 쓰도록 하는 SSOT.';


-- ════════════════════════════════════════════════════════════════════════
-- 8) [사용자] 자가 대여 — user_checkout_books
--
--    승인 없이 즉시 성립한다. 관리자 RPC 와 분리하는 이유는 권한 경계와
--    허용 범위가 다르기 때문이다.
--      · 사용자 : 본인만, 오늘~+3일, 소급 불가
--      · 관리자 : 타인 지정 가능, ±365일, 소급 등록 가능
--    하나의 함수에 분기를 넣으면 "관리자면 통과" 조건이 사용자 경로에도
--    걸쳐 있게 되어, 나중에 조건 하나가 빠질 때 권한 구멍이 된다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.user_checkout_books(
  p_book_ids    integer[],
  p_notes       text        DEFAULT NULL,
  p_checkout_at timestamptz DEFAULT NULL      -- NULL = 지금 바로 대여
)
RETURNS SETOF public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_borrow_days  constant int := 7;   -- BORROW_DAYS (프론트 상수와 일치)
  c_max_borrow   constant int := 2;   -- MAX_BORROW_PER_USER (프론트 상수와 일치)
  c_reserve_days constant int := 3;   -- RESERVE_MAX_DAYS — 오늘 + 3일까지 예약

  v_uid       uuid := auth.uid();
  v_ids       int[];
  v_count     int;
  v_held      int;
  v_book      record;
  v_checkout  timestamptz;
  v_due       timestamptz;
  v_today_kst date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_req_kst   date;
BEGIN
  -- ── 1) 인증 ───────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- ── 2) 입력 정규화 ────────────────────────────────────────────────────
  SELECT array_agg(DISTINCT x) INTO v_ids
    FROM unnest(COALESCE(p_book_ids, '{}'::int[])) AS x;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_BOOKS' USING ERRCODE = 'P0001';
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 100 THEN
    RAISE EXCEPTION 'NOTES_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  -- ── 3) 대여일 확정 + 허용 범위 ────────────────────────────────────────
  --   사용자는 소급 등록을 할 수 없다. 과거 날짜를 허용하면 반납기한이 이미
  --   지난 대여를 스스로 만들어 연체를 회피/조작할 수 있다.
  --   비교는 KST 날짜 단위로 한다 — 시각으로 비교하면 "오늘"을 선택했는데
  --   지금이 오후라 '과거'로 판정되는 경계 사고가 난다.
  v_checkout := COALESCE(p_checkout_at, now());
  v_req_kst  := (v_checkout AT TIME ZONE 'Asia/Seoul')::date;

  IF v_req_kst < v_today_kst THEN
    RAISE EXCEPTION 'CHECKOUT_AT_PAST' USING ERRCODE = 'P0001';
  END IF;

  IF v_req_kst > v_today_kst + c_reserve_days THEN
    RAISE EXCEPTION 'RESERVE_TOO_FAR:%', c_reserve_days USING ERRCODE = 'P0001';
  END IF;

  v_due := v_checkout + make_interval(days => c_borrow_days);

  -- ── 4) 1인 한도 ───────────────────────────────────────────────────────
  --   승인 플로우가 사라져 pending 이 없으므로 active/overdue 만 센다.
  --   예약(미래 시작)도 status='active' 이므로 자동으로 합산된다 —
  --   "예약만 잔뜩 걸어두고 실제로는 안 빌리는" 사용을 막는다.
  SELECT count(*) INTO v_held
    FROM public.book_checkouts
   WHERE user_id = v_uid
     AND status IN ('active','overdue');

  IF v_held + v_count > c_max_borrow THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:%:%', v_held, c_max_borrow
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 5) 도서별 검사 ────────────────────────────────────────────────────
  --   FOR UPDATE 로 잠가 동시 요청을 직렬화한다.
  --   ORDER BY id — 여러 권을 동시에 잠글 때 교착을 피하려면 순서가 고정돼야 한다.
  FOR v_book IN
    SELECT id, title, status
      FROM public.books
     WHERE id = ANY(v_ids)
     ORDER BY id
     FOR UPDATE
  LOOP
    -- 정비중/분실 도서는 기간과 무관하게 대여 대상이 아니다.
    -- 'borrowed' 는 여기서 막지 않는다 — 지금 나가 있어도 반납기한 이후
    -- 구간은 예약할 수 있어야 B안이 성립한다. 기간 판정은 아래에서 한다.
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

  -- ── 6) 생성 ───────────────────────────────────────────────────────────
  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.book_checkouts
      (book_id, user_id, checkout_at, due_at, status, notes,
       notified_started)
    SELECT
      unnest(v_ids), v_uid, v_checkout, v_due, 'active',
      NULLIF(btrim(COALESCE(p_notes,'')), ''),
      -- 지금 시작하는 대여는 시작 알림 대상이 아니다(대여 확정 알림이 나간다).
      -- 미리 오늘 날짜로 찍어두면 시작일 배치가 중복 통지하지 않는다.
      CASE WHEN v_req_kst <= v_today_kst THEN v_today_kst ELSE NULL END
    RETURNING *
  ),
  upd AS (
    -- 오늘 시작하는 대여만 도서를 잠근다.
    -- 미래 예약은 books.status 를 건드리지 않는다 (이 마이그레이션의 핵심).
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

COMMENT ON FUNCTION public.user_checkout_books(integer[], text, timestamptz) IS
  '[2026-07-21] 사용자 자가 대여. 승인 없음. 오늘~+3일 예약 가능, 소급 불가. '
  '미래 예약은 books.status 를 잠그지 않는다.';


-- ════════════════════════════════════════════════════════════════════════
-- 9) [관리자] 대여 등록 — admin_checkout_books 갱신
--
--    변경점 3가지
--      ① 한도 산식: active + pending → active/overdue (pending 폐지)
--      ② 기간 겹침 검사 추가 (books.status 만으로는 예약을 못 본다)
--      ③ books.status 는 "오늘 이전 시작" 일 때만 borrowed 로 바꾼다
--    유지: ±365일 소급/미래 등록, 타인 지정, 트랜잭션 전량 성공/실패
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_checkout_books(uuid, integer[], text, timestamptz);

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
BEGIN
  IF NOT (has_admin_role('book') OR is_profile_admin()) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'NO_BORROWER' USING ERRCODE = 'P0001';
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

  -- ← [2026-07-21] pending 폐지에 따라 한도 산식 변경
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

    -- ← [2026-07-21] 신규: 기간 겹침. 소급 등록 시 과거 대여와도 겹칠 수 있다.
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


-- ════════════════════════════════════════════════════════════════════════
-- 10) [본인] 예약 취소 — cancel_book_checkout
--
--     구 cancel_book_request(pending 취소)를 대체한다.
--     시작 전(checkout_at > now)인 본인 예약만 취소할 수 있다.
--     이미 시작된 대여는 취소가 아니라 반납이므로 관리자 경로로만 처리한다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_book_checkout(p_checkout_id uuid)
RETURNS public.book_checkouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.book_checkouts;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
    FROM public.book_checkouts
   WHERE id = p_checkout_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHECKOUT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- 관리자도 이 함수로는 타인 예약을 취소하지 않는다.
  -- 관리자 취소는 별도 경로로 열어야 감사 로그(누가 취소했는지)를 남길 수 있다.
  IF v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.status <> 'active' THEN
    RAISE EXCEPTION 'NOT_ACTIVE:%', v_row.status USING ERRCODE = 'P0001';
  END IF;

  -- 이미 시작된 대여는 취소 대상이 아니다(책이 이미 나가 있다).
  IF v_row.checkout_at <= now() THEN
    RAISE EXCEPTION 'ALREADY_STARTED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.book_checkouts
     SET status       = 'cancelled',
         processed_at = now(),
         updated_at   = now()
   WHERE id = p_checkout_id
   RETURNING * INTO v_row;

  -- books.status 는 건드리지 않는다.
  -- 미래 예약은 애초에 도서를 잠그지 않았으므로 되돌릴 상태가 없다.
  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_book_checkout(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_book_checkout(uuid) TO authenticated;

COMMENT ON FUNCTION public.cancel_book_checkout(uuid) IS
  '[2026-07-21] 본인의 시작 전 예약 취소. 시작된 대여는 반납 경로로 처리.';


-- ════════════════════════════════════════════════════════════════════════
-- 11) 대여 시작일 배치 — start_due_book_checkouts
--
--     매일 KST 09:00 에 book-due-reminder Edge Function 이 호출한다.
--     ① 시작일이 도래한 예약의 도서를 'borrowed' 로 전환
--     ② 통지 대상 목록을 반환 (Edge Function 이 알림 발송 후 마킹)
--
--     전환과 통지를 한 함수에서 하되 마킹은 분리한 이유:
--     알림 발송이 실패했는데 notified_started 가 찍히면 영구 미발송이 된다.
--     발송 성공 후 mark_book_start_notified 로 별도 마킹한다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.start_due_book_checkouts()
RETURNS TABLE (
  checkout_id uuid,
  user_id     uuid,
  book_id     integer,
  book_title  text,
  due_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- ① 시작일이 도래한 대여의 도서를 잠근다 (멱등 — 이미 borrowed 면 제외)
  UPDATE public.books b
     SET status = 'borrowed', updated_at = now()
   WHERE b.status = 'available'
     AND EXISTS (
           SELECT 1 FROM public.book_checkouts c
            WHERE c.book_id = b.id
              AND c.status IN ('active','overdue')
              AND c.checkout_at <= now()
              AND c.returned_at IS NULL
         );

  -- ② 시작 통지 대상 (아직 안 보낸 건만)
  RETURN QUERY
  SELECT c.id, c.user_id, c.book_id, bk.title, c.due_at
    FROM public.book_checkouts c
    JOIN public.books bk ON bk.id = c.book_id
   WHERE c.status IN ('active','overdue')
     AND c.checkout_at <= now()
     AND c.returned_at IS NULL
     AND c.notified_started IS NULL
   ORDER BY c.checkout_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_due_book_checkouts() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_due_book_checkouts() TO service_role;

COMMENT ON FUNCTION public.start_due_book_checkouts() IS
  '[2026-07-21] 대여 시작일 도래 처리 — 도서 잠금 + 시작 통지 대상 반환. '
  'book-due-reminder Edge Function 이 매일 KST 09:00 에 호출한다.';


/** 시작 통지 발송 성공 마킹 (KST 날짜) */
CREATE OR REPLACE FUNCTION public.mark_book_start_notified(p_checkout_ids uuid[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.book_checkouts
     SET notified_started = (now() AT TIME ZONE 'Asia/Seoul')::date,
         updated_at       = now()
   WHERE id = ANY(p_checkout_ids)
     AND notified_started IS NULL;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_book_start_notified(uuid[]) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_book_start_notified(uuid[]) TO service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 12) RLS — 사용자 직접 INSERT 차단
--
--     대여 생성은 전부 SECURITY DEFINER RPC 를 거친다. 직접 INSERT 를 열어두면
--     한도·기간·소급 검증을 전부 우회할 수 있다(EXCLUDE 제약만 남는다).
--     RPC 는 DEFINER 라 RLS 를 우회하므로 정책을 좁혀도 정상 동작한다.
-- ════════════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "book_checkouts_insert_self_or_admin" ON public.book_checkouts;
DROP POLICY IF EXISTS "book_checkouts_insert_self"          ON public.book_checkouts;
DROP POLICY IF EXISTS "book_checkouts_insert_pending_self"  ON public.book_checkouts;

CREATE POLICY "book_checkouts_insert_admin_only" ON public.book_checkouts
  FOR INSERT TO authenticated
  WITH CHECK (has_admin_role('book') OR is_profile_admin());


-- ════════════════════════════════════════════════════════════════════════
-- 13) 인기 순 집계 — 대여 성립 건만
--
--     pending 은 더 이상 생기지 않지만 과거 행이 남아 있고,
--     rejected / cancelled(예약 취소)도 대여가 성립하지 않은 건이다.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_book_checkout_counts()
RETURNS TABLE (book_id integer, checkout_count bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT bc.book_id, count(*)::bigint
    FROM public.book_checkouts bc
   WHERE bc.status NOT IN ('pending','rejected','cancelled')
   GROUP BY bc.book_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_book_checkout_counts() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_book_checkout_counts() TO authenticated;

COMMENT ON FUNCTION public.get_book_checkout_counts() IS
  '[2026-07-21] 도서별 누적 대여 횟수(대여 성립 건만). 목록 인기 순 정렬 전용.';


COMMIT;


-- ============================================================================
-- 배포 후 검증 (읽기 전용 — SQL Editor 에서 별도 실행)
-- ============================================================================
-- -- ① 제약 생성 확인 (1행이어야 정상)
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint where conname = 'book_checkouts_no_overlap';
--
-- -- ② 신규/갱신 함수 확인 (6행이어야 정상)
-- select proname, pg_get_function_identity_arguments(oid) as args, prosecdef
--   from pg_proc
--  where proname in ('user_checkout_books','admin_checkout_books',
--                    'cancel_book_checkout','start_due_book_checkouts',
--                    'mark_book_start_notified','book_period_conflict')
--  order by proname;
--
-- -- ③ 폐기 함수 제거 확인 (0행이어야 정상)
-- select proname from pg_proc
--  where proname in ('request_book_checkout','admin_approve_book_request',
--                    'admin_reject_book_request','cancel_book_request');
--
-- -- ④ pending 잔여 확인 (0행이어야 정상)
-- select count(*) from public.book_checkouts where status = 'pending';
--
-- -- ⑤ books.status 정합성 (④-a/b/c 전부 0행이어야 정상)
-- select bk.id, bk.title from public.books bk
--  where bk.status = 'borrowed'
--    and not exists (select 1 from public.book_checkouts c
--                     where c.book_id = bk.id and c.status in ('active','overdue')
--                       and c.checkout_at <= now() and c.returned_at is null);
-- ============================================================================
