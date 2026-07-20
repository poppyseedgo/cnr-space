-- ═══════════════════════════════════════════════════════════════════════════
-- [2026-07-20] books.new_until — ⭐NEW⭐ 라벨 수동 지정
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 배경 (변경 전 설계)
--   NEW 는 DB 컬럼이 없었다. 프론트에서 books.acquired_at(취득연월)이
--   "이번 달"과 일치하는지로 매번 파생시켰다. 그래서:
--     · 관리자가 NEW 를 켜고 끌 수 없다 (취득월을 조작해야만 하는데 데이터 왜곡)
--     · 월이 바뀌면 전부 한꺼번에 사라진다 (월초 입고는 한 달, 월말 입고는 하루)
--     · 과거 입고 도서를 기획 전시용으로 띄울 수 없다
--
-- 변경 후
--   "언제까지 NEW 로 보일지"를 값 하나로 명시한다. 이게 단일 진실 소스다.
--     new_until IS NULL          → NEW 아님
--     new_until >= 오늘(KST)     → NEW
--     new_until <  오늘(KST)     → 기간 만료, 자동으로 사라짐
--
--   boolean(is_new) 대신 날짜를 쓴 이유: boolean 은 끄는 걸 잊으면 영구 NEW 가
--   되어 라벨이 의미를 잃는다. 만료일을 강제하면 방치돼도 스스로 정리된다.
--
-- ⚠ 적용 방법
--   로컬 migrations 가 원격의 부분집합이라 `supabase db push` 는 실패한다.
--   Supabase 대시보드 → SQL Editor 에 이 파일 내용을 붙여넣어 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.books
  add column if not exists new_until date;

comment on column public.books.new_until is
  '⭐NEW⭐ 라벨 노출 종료일(KST). NULL이면 표시하지 않음. 이 날짜까지 포함하여 노출.';

-- 목록 필터가 new_until 로 거르므로 부분 인덱스만 있으면 충분하다
-- (NULL 이 대다수라 전체 인덱스는 낭비).
create index if not exists idx_books_new_until
  on public.books (new_until)
  where new_until is not null;

-- ── 백필 ────────────────────────────────────────────────────────────────────
-- 기존 화면 상태를 그대로 보존한다.
-- 지금 NEW 로 보이는 책 = "취득월이 이번 달"인 책 → 이번 달 말일까지 NEW 유지.
-- 이렇게 해야 배포 직후 뱃지가 사라지거나 새로 생기는 일이 없다.
update public.books
set new_until = (
      date_trunc('month', acquired_at)::date + interval '1 month - 1 day'
    )::date
where new_until is null
  and acquired_at is not null
  and to_char(acquired_at, 'YYYY-MM')
      = to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM');

-- ── 검증 ────────────────────────────────────────────────────────────────────
-- 실행 후 아래로 확인:
--   select count(*) filter (where new_until is not null)              as flagged,
--          count(*) filter (where new_until >= (now() at time zone 'Asia/Seoul')::date) as visible_now
--   from public.books;
