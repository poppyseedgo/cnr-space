-- ============================================================
-- HR Interview (근태 APP 내재화 1차 인터뷰) — DB 기반
-- Date: 2026-09-03 / Project ref: jjzcqpbwkkujttwxksvy
-- File: 20260903_hr_interview.sql  (멱등 — 재실행 안전)
--
-- 설계
--   · 문항(8개)은 프론트 상수 src/data/hrInterviewQuestions.ts 가 SSOT (Figma 7:750 확정본).
--     DB는 응답자 화이트리스트 + 답변만 보관한다.
--   · 접근 게이트 hr_interview_can_access():
--       hr_interview_respondents 에 등록된 사용자 OR is_profile_admin() OR has_admin_role('super')
--   · 답변은 문항×응답자 UNIQUE. status: draft(자동저장) → submitted(저장하기).
--   · 이미지는 private 버킷 hr-interview, 경로 {auth.uid()}/{question_id}/{file} — 본인 폴더만 쓰기,
--     열람은 본인 + 관리자(signed URL).
-- 의존: public.is_profile_admin(), public.has_admin_role(text) (도서관/권한 마이그레이션에서 기존 생성)
-- ============================================================

-- ─────────────────────────────────────────────
-- 0. 접근 게이트 헬퍼
-- ─────────────────────────────────────────────
create table if not exists public.hr_interview_respondents (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  added_at  timestamptz not null default now(),
  added_by  uuid references public.profiles(id),
  note      text
);
comment on table public.hr_interview_respondents is 'HR 인터뷰 응답 허용 사용자(화이트리스트). 관리자는 별도 등록 없이 접근 가능';

create or replace function public.hr_interview_can_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.hr_interview_respondents r where r.user_id = auth.uid())
    or public.is_profile_admin()
    or public.has_admin_role('super');
$$;
revoke all on function public.hr_interview_can_access() from public;
grant execute on function public.hr_interview_can_access() to authenticated;

create or replace function public.hr_interview_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_profile_admin() or public.has_admin_role('super');
$$;
revoke all on function public.hr_interview_is_admin() from public;
grant execute on function public.hr_interview_is_admin() to authenticated;

-- ─────────────────────────────────────────────
-- 1. 답변 테이블
-- ─────────────────────────────────────────────
create table if not exists public.hr_interview_answers (
  id            uuid primary key default gen_random_uuid(),
  question_id   text not null,                       -- 'q1' ~ 'q8' (프론트 상수 id)
  user_id       uuid not null references public.profiles(id) on delete cascade,
  content       text not null default '',
  image_paths   text[] not null default '{}',        -- storage 경로(버킷 hr-interview 내부)
  status        text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_interview_answers_uq unique (question_id, user_id)
);
create index if not exists idx_hr_interview_answers_user on public.hr_interview_answers(user_id);

create or replace function public.hr_interview_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (old.status is distinct from 'submitted') then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_hr_interview_answers_touch on public.hr_interview_answers;
create trigger trg_hr_interview_answers_touch
before update on public.hr_interview_answers
for each row execute function public.hr_interview_touch_updated_at();

-- ─────────────────────────────────────────────
-- 2. RLS
-- ─────────────────────────────────────────────
alter table public.hr_interview_respondents enable row level security;
alter table public.hr_interview_answers     enable row level security;

-- respondents: 본인 행 조회(게이트 판정용) / 관리자 전체 관리
drop policy if exists hr_resp_select on public.hr_interview_respondents;
create policy hr_resp_select on public.hr_interview_respondents
  for select to authenticated
  using (user_id = auth.uid() or public.hr_interview_is_admin());

drop policy if exists hr_resp_admin_write on public.hr_interview_respondents;
create policy hr_resp_admin_write on public.hr_interview_respondents
  for all to authenticated
  using (public.hr_interview_is_admin())
  with check (public.hr_interview_is_admin());

-- answers: 본인 행 CRUD(게이트 통과 시) / 관리자 전체 조회
drop policy if exists hr_ans_select on public.hr_interview_answers;
create policy hr_ans_select on public.hr_interview_answers
  for select to authenticated
  using (user_id = auth.uid() or public.hr_interview_is_admin());

drop policy if exists hr_ans_insert on public.hr_interview_answers;
create policy hr_ans_insert on public.hr_interview_answers
  for insert to authenticated
  with check (user_id = auth.uid() and public.hr_interview_can_access());

drop policy if exists hr_ans_update on public.hr_interview_answers;
create policy hr_ans_update on public.hr_interview_answers
  for update to authenticated
  using (user_id = auth.uid() and public.hr_interview_can_access())
  with check (user_id = auth.uid() and public.hr_interview_can_access());

drop policy if exists hr_ans_delete on public.hr_interview_answers;
create policy hr_ans_delete on public.hr_interview_answers
  for delete to authenticated
  using (user_id = auth.uid() and public.hr_interview_can_access());

grant select, insert, update, delete on public.hr_interview_answers     to authenticated;
grant select, insert, update, delete on public.hr_interview_respondents to authenticated;

-- ─────────────────────────────────────────────
-- 3. Storage — private 버킷 hr-interview
--    경로 규약: {auth.uid()}/{question_id}/{timestamp}_{filename}
-- ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-interview', 'hr-interview', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists hr_img_insert on storage.objects;
create policy hr_img_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hr-interview'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.hr_interview_can_access()
  );

drop policy if exists hr_img_select on storage.objects;
create policy hr_img_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hr-interview'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.hr_interview_is_admin())
  );

drop policy if exists hr_img_delete on storage.objects;
create policy hr_img_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'hr-interview'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─────────────────────────────────────────────
-- 4. 응답자 등록 예시 (SQL Editor에서 이메일로 등록 — 실행 시 이메일만 교체)
-- ─────────────────────────────────────────────
-- insert into public.hr_interview_respondents (user_id, added_by, note)
-- select p.id, '0120852b-faae-4903-9515-c9c28ecaf76b', 'HR 1차 인터뷰'
--   from public.profiles p
--  where lower(p.email) in ('hr1@cnrres.com', 'hr2@cnrres.com')
-- on conflict (user_id) do nothing;

-- ─────────────────────────────────────────────
-- 5. 적용 확인 (읽기전용)
-- ─────────────────────────────────────────────
-- select to_regclass('public.hr_interview_answers')      is not null as answers_ok,
--        to_regclass('public.hr_interview_respondents')  is not null as respondents_ok,
--        to_regprocedure('public.hr_interview_can_access()') is not null as gate_ok,
--        exists(select 1 from storage.buckets where id='hr-interview' and public=false) as bucket_ok;
