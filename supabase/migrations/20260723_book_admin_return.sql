-- ============================================================================
-- [2026-07-23] 도서 반납 / 분실 처리 RPC — admin_return_book
--
-- 배경 (근본 원인):
--   기존 LibraryPage.handleReturn 은 클라이언트에서 UPDATE 를 두 번 실행했다.
--
--       ① book_checkouts.status = 'returned', returned_at = now()
--       ② books.status          = 'available'
--
--   이 둘은 서로 다른 HTTP 요청이라 트랜잭션이 아니다. ①이 성공하고 ②가
--   실패하면(네트워크 끊김 / RLS 거부 / 탭 종료) 다음 상태로 영구 고착된다.
--
--       book_checkouts = 반납완료   +   books = 대여중
--
--   이 상태의 도서는 목록에서 "대여중"으로 보이지만 활성 대여 기록이 없어
--   반납 버튼도 나오지 않는다. 즉 관리자가 화면에서 복구할 방법이 없고
--   SQL Editor 직접 수정 외에는 해소되지 않는다.
--
--   재시도 로직이나 롤백 코드로 덮는 것은 임시방편이다. 두 UPDATE 가
--   "하나의 원자적 상태 전이"라는 사실을 DB 계층에 명시하는 것이 근본 해결이다.
--   프로젝트 원칙(모든 상태 전이는 SECURITY DEFINER RPC 경유)과도 일치한다.
--
-- 처리 액션 2종:
--   'return' — 정상 반납. checkout → returned(+returned_at), book → available
--   'lost'   — 분실 처리. checkout → lost,                    book → lost
--              분실은 반납이 아니므로 returned_at 은 채우지 않는다.
--              (returned_at 을 채우면 대여기간 통계에 정상 반납으로 섞인다)
--
-- 권한:
--   has_admin_role('book') OR is_profile_admin()
--   — 20260716_library_rls_update.sql 에서 확립한 이중 판정 기준과 동일.
--     둘 중 하나만 쓰면 관리자 이중분리 버그가 재발한다.
--
-- 멱등: CREATE OR REPLACE — 재실행 안전.
--
-- 실행 순서: 20260716 → 20260718 → 20260720* → 20260721 → 20260722 → 이 파일
-- ============================================================================

create or replace function public.admin_return_book(
  p_checkout_id uuid,
  p_action      text default 'return'
)
returns public.book_checkouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin  boolean;
  v_checkout  public.book_checkouts;
  v_now       timestamptz := now();
begin
  -- ── 1) 인증 ──────────────────────────────────────────────────────────────
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- ── 2) 권한 (도서 관리자 OR profiles.role='ADMIN') ───────────────────────
  select coalesce(public.has_admin_role('book'), false)
      or coalesce(public.is_profile_admin(),     false)
    into v_is_admin;

  if not v_is_admin then
    raise exception 'NOT_ADMIN';
  end if;

  -- ── 3) 액션 검증 ─────────────────────────────────────────────────────────
  if p_action is null or p_action not in ('return', 'lost') then
    raise exception 'INVALID_ACTION';
  end if;

  -- ── 4) 대상 조회 + 행 잠금 ───────────────────────────────────────────────
  --   FOR UPDATE: 두 관리자가 동시에 반납 버튼을 눌러도 한 쪽만 통과한다.
  --   (뒤 트랜잭션은 잠금 해제 후 재조회 → status 가 이미 returned 라 NOT_ACTIVE)
  select * into v_checkout
    from public.book_checkouts
   where id = p_checkout_id
   for update;

  if not found then
    raise exception 'CHECKOUT_NOT_FOUND';
  end if;

  -- 반납/분실 가능한 상태는 대여가 성립한 건뿐이다.
  --   pending/rejected/cancelled 는 애초에 대여가 아니고,
  --   returned/lost 는 이미 종결된 건이다.
  if v_checkout.status not in ('active', 'overdue') then
    raise exception 'NOT_ACTIVE:%', v_checkout.status;
  end if;

  -- ── 5) 상태 전이 (여기서부터 ①②가 한 트랜잭션) ─────────────────────────
  if p_action = 'return' then
    update public.book_checkouts
       set status      = 'returned',
           returned_at = v_now,
           updated_at  = v_now
     where id = p_checkout_id
     returning * into v_checkout;

    update public.books
       set status     = 'available',
           updated_at = v_now
     where id = v_checkout.book_id;

  else  -- p_action = 'lost'
    update public.book_checkouts
       set status     = 'lost',
           updated_at = v_now
     where id = p_checkout_id
     returning * into v_checkout;

    update public.books
       set status     = 'lost',
           updated_at = v_now
     where id = v_checkout.book_id;
  end if;

  return v_checkout;
end;
$$;

revoke execute on function public.admin_return_book(uuid, text) from public;
grant  execute on function public.admin_return_book(uuid, text) to authenticated;

comment on function public.admin_return_book(uuid, text) is
  '[2026-07-23] 도서 반납(return)/분실(lost) 처리. book_checkouts 와 books 를 '
  '단일 트랜잭션으로 갱신해 "반납완료인데 도서는 대여중" 불일치를 구조적으로 차단한다. '
  '권한: has_admin_role(''book'') OR is_profile_admin().';


-- ============================================================================
-- 정합성 점검 쿼리 (읽기 전용 — 필요할 때 SQL Editor 에서 수동 실행)
--
--   과거 2단 UPDATE 방식으로 생긴 불일치 데이터가 남아 있는지 확인한다.
--   결과가 0행이면 정상.
-- ----------------------------------------------------------------------------
-- -- ① books 는 borrowed 인데 활성 대여 기록이 없는 도서
-- select b.id, b.title, b.status
--   from public.books b
--  where b.status = 'borrowed'
--    and not exists (
--          select 1 from public.book_checkouts c
--           where c.book_id = b.id and c.status in ('active','overdue')
--        );
--
-- -- ② 활성 대여 기록은 있는데 books 는 borrowed 가 아닌 도서
-- select b.id, b.title, b.status, c.id as checkout_id, c.status as checkout_status
--   from public.books b
--   join public.book_checkouts c on c.book_id = b.id
--  where c.status in ('active','overdue')
--    and b.status <> 'borrowed';
--
-- -- 복구 예시 (①): 활성 대여가 없는데 borrowed 로 남은 도서를 available 로
-- -- update public.books set status = 'available', updated_at = now()
-- --  where status = 'borrowed'
-- --    and not exists (select 1 from public.book_checkouts c
-- --                     where c.book_id = books.id and c.status in ('active','overdue'));
-- ============================================================================
