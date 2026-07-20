-- ═══════════════════════════════════════════════════════════════════════════
-- [2026-07-20] admin_checkout_books — 대여일(checkout_at) 지정 지원
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 변경 요약
--   1) p_checkout_at timestamptz 파라미터 추가 (NULL → 기존과 동일하게 now())
--   2) checkout_at 을 INSERT 에 명시하고, due_at 을 "대여일 + 7일"로 계산
--      (기존: due_at = now() + 7일 → 소급/예약 등록 시 기한이 어긋났다)
--   3) 대여일 허용 범위 검증 추가 (CHECKOUT_AT_OUT_OF_RANGE)
--   4) [별건 결함 수정] 1인 한도 검사에 pending 포함 — 아래 상세
--
-- ⚠ drop 이 필요한 이유
--   PostgreSQL 은 인자 목록이 다르면 **다른 함수**로 취급한다.
--   create or replace 만 하면 3인자/4인자 두 개가 공존하고, PostgREST 가
--   3개 파라미터로 호출할 때 어느 쪽인지 모호해져 실패한다.
--   따라서 기존 시그니처를 먼저 drop 한다. 아래는 단일 트랜잭션이라
--   중단 구간은 밀리초 단위다.
--
--   drop 하면 GRANT 도 함께 사라지므로 재부여한다.
--   ▶ 실행 전에 현재 권한을 반드시 확인할 것:
--       select proname, proacl from pg_proc where proname = 'admin_checkout_books';
--     결과가 아래 GRANT 와 다르면 그에 맞게 수정한 뒤 실행할 것.
--
-- ⚠ 배포 순서: DB 먼저 → 프론트 나중.
--   p_checkout_at 에 DEFAULT 가 있어 구 프론트(3인자 호출)도 그대로 동작한다.
--
-- ⚠ 적용 방법
--   로컬 migrations 가 원격의 부분집합이라 `supabase db push` 는 실패한다.
--   Supabase 대시보드 → SQL Editor 에 이 파일 내용을 붙여넣어 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.admin_checkout_books(uuid, integer[], text);

create or replace function public.admin_checkout_books(
  p_user_id     uuid,
  p_book_ids    integer[],
  p_notes       text        default null::text,
  p_checkout_at timestamptz default null::timestamptz
)
 returns setof book_checkouts
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  c_borrow_days constant int := 7;   -- BORROW_DAYS (프론트 상수와 일치)
  c_max_borrow  constant int := 2;   -- MAX_BORROW_PER_USER (프론트 상수와 일치)
  c_range_days  constant int := 365; -- 대여일 허용 범위 (과거/미래 각각)

  v_ids        int[];
  v_count      int;
  v_active_cnt int;
  v_book       record;
  v_checkout   timestamptz;
  v_due        timestamptz;
BEGIN
  -- ── 1) 관리자 권한 확인 ────────────────────────────────────────────────
  --   20260716 마이그레이션에서 정합화한 두 관리자 모델을 그대로 사용
  IF NOT (has_admin_role('book') OR is_profile_admin()) THEN
    RAISE EXCEPTION 'NOT_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  -- ── 2) 입력 정규화/검증 ────────────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'NO_BORROWER' USING ERRCODE = 'P0001';
  END IF;

  -- 중복 도서 id 제거 (같은 책 2번 담아도 1건으로)
  SELECT array_agg(DISTINCT x) INTO v_ids
  FROM unnest(COALESCE(p_book_ids, '{}'::int[])) AS x;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'NO_BOOKS' USING ERRCODE = 'P0001';
  END IF;

  -- 메모 길이 (Figma 0/100 규격)
  IF p_notes IS NOT NULL AND char_length(p_notes) > 100 THEN
    RAISE EXCEPTION 'NOTES_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  -- ── 2-b) 대여일 확정 및 범위 검증 ← [2026-07-20] 신규 ──────────────────
  --   NULL 이면 기존 동작(등록 시각)을 그대로 유지한다.
  --   오타로 2026 → 2062 같은 값이 들어오면 반납기한과 알림 사이클이
  --   전부 망가지므로 상한/하한을 둔다.
  v_checkout := COALESCE(p_checkout_at, now());

  IF v_checkout < now() - make_interval(days => c_range_days)
     OR v_checkout > now() + make_interval(days => c_range_days) THEN
    RAISE EXCEPTION 'CHECKOUT_AT_OUT_OF_RANGE:%', c_range_days
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 3) 1인 동시 대여 한도 검증 ─────────────────────────────────────────
  --
  --   ← [2026-07-20] 결함 수정: 기존에는 status = 'active' 만 세었다.
  --     그런데 request_book_checkout 은 'pending' 행을 만들고,
  --     프론트(myHeldCount)와 사용자 안내 문구는 "대여 + 신청 합계 2권"을
  --     기준으로 쓰고 있었다. 즉 DB 가 화면과 다른 규칙을 강제하고 있었다.
  --     결과: 신청 2건이 걸린 사용자에게 관리자가 2권을 더 등록하면
  --           실보유 4권이 된다.
  --     → 프론트가 이미 사용자에게 고지하는 규칙에 DB 를 맞춘다.
  --
  --   ※ 되돌리려면 아래 IN (...) 을 = 'active' 로 바꾸면 된다.
  SELECT count(*) INTO v_active_cnt
  FROM public.book_checkouts
  WHERE user_id = p_user_id
    AND status IN ('active', 'pending');

  IF v_active_cnt + v_count > c_max_borrow THEN
    RAISE EXCEPTION 'LIMIT_EXCEEDED:%:%', v_active_cnt, c_max_borrow
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 4) 도서 잠금 + 대여가능 여부 확인 ──────────────────────────────────
  --   FOR UPDATE 로 잠가 동시 등록 경합을 막는다.
  --   한 권이라도 조건에 안 맞으면 예외 → 트랜잭션 전체 롤백(부분 성공 없음)
  FOR v_book IN
    SELECT id, title, status
    FROM public.books
    WHERE id = ANY(v_ids)
    ORDER BY id                      -- 교착(deadlock) 방지: 항상 동일 순서로 잠금
    FOR UPDATE
  LOOP
    IF v_book.status <> 'available' THEN
      RAISE EXCEPTION 'BOOK_NOT_AVAILABLE:%:%', v_book.id, v_book.title
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 존재하지 않는 도서 id 가 섞였는지 확인 (위 루프는 존재하는 행만 돈다)
  IF (SELECT count(*) FROM public.books WHERE id = ANY(v_ids)) <> v_count THEN
    RAISE EXCEPTION 'BOOK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- ── 5) 대여 기록 생성 + 도서 상태 전환 ─────────────────────────────────
  --
  --   ← [2026-07-20] checkout_at 을 명시적으로 넣는다.
  --     기존에는 컬럼 DEFAULT(now())에 맡겨서 대여일을 지정할 수 없었다.
  --     due_at 도 now() 가 아니라 **대여일 기준**으로 계산한다 —
  --     소급 등록 시 "이미 반납기한이 지난 대여"가 정확히 표현된다.
  v_due := v_checkout + make_interval(days => c_borrow_days);

  RETURN QUERY
  WITH ins AS (
    INSERT INTO public.book_checkouts (book_id, user_id, checkout_at, due_at, status, notes)
    SELECT unnest(v_ids), p_user_id, v_checkout, v_due, 'active', NULLIF(btrim(COALESCE(p_notes,'')), '')
    RETURNING *
  ),
  upd AS (
    UPDATE public.books
       SET status     = 'borrowed',
           updated_at = now()
     WHERE id = ANY(v_ids)
    RETURNING id
  )
  SELECT * FROM ins;

END;
$function$;

-- drop 으로 사라진 실행 권한 재부여
-- (실행 전 확인한 proacl 과 다르면 이 부분을 수정할 것)
grant execute on function public.admin_checkout_books(uuid, integer[], text, timestamptz)
  to authenticated;

commit;

-- ── 검증 ────────────────────────────────────────────────────────────────────
-- 1) 시그니처가 하나만 남았는지 (2건이면 모호성 오류가 난다)
--    select oid::regprocedure, proacl
--    from pg_proc where proname = 'admin_checkout_books';
--
-- 2) 구 프론트(3인자) 호환 확인 — p_checkout_at 없이 호출해도 통과해야 한다
