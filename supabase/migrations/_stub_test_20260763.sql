CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
GRANT authenticated TO authenticator; GRANT anon TO authenticator;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;

CREATE TABLE public.bookings (
  id text PRIMARY KEY, room_id int NOT NULL, title text, user_id uuid, user_name text, user_dept text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'confirmed', checked_in bool NOT NULL DEFAULT false,
  auto_cancelled bool DEFAULT false, cancelled_by text, cancelled_by_user_id uuid,
  early_ended bool NOT NULL DEFAULT false, original_end_at timestamptz, noshow_notified bool DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  CONSTRAINT bookings_time_valid CHECK (end_at > start_at),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (room_id WITH =, tstzrange(start_at,end_at) WITH &&)
    WHERE (status IN ('confirmed','pending') AND auto_cancelled=false AND early_ended=false)
);
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
CREATE TABLE public.noshow_admin_actions (id bigserial PRIMARY KEY, booking_id text, action text, booking_snapshot jsonb, actor uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.noshow_penalties (id bigserial PRIMARY KEY, user_id uuid, counted_booking_ids text[], revoked_at timestamptz, revoked_by uuid, revoked_reason text);
CREATE TABLE public.noshow_guard_rejections (id bigserial PRIMARY KEY, booking_id text, reason text);
CREATE TABLE public.eval_calls (user_id uuid, at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION public.evaluate_noshow_penalty(p uuid) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.eval_calls(user_id) VALUES (p) $$;
CREATE OR REPLACE FUNCTION public.has_admin_role(p text) RETURNS bool LANGUAGE sql STABLE AS $$ SELECT current_setting('app.is_admin', true) = 'true' $$;
CREATE OR REPLACE FUNCTION public.noshow_grace_minutes() RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 10 $$;

-- 운영 트리거 4종 재현 (실물 로직 기준)
CREATE OR REPLACE FUNCTION public.block_cancel_on_checked_in() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.checked_in OR OLD.early_ended) AND (NEW.status='cancelled' OR NEW.auto_cancelled IS TRUE OR NEW.cancelled_by IS NOT NULL)
     AND NOT (current_user='postgres' OR session_user='postgres') THEN
    RAISE EXCEPTION 'CHECKED_IN_CANCEL_BLOCKED';
  END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_block_cancel_on_checked_in BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.block_cancel_on_checked_in();

CREATE OR REPLACE FUNCTION public.block_noshow_on_checked_in() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.checked_in AND NEW.cancelled_by='system' AND NEW.auto_cancelled IS TRUE THEN
    RAISE EXCEPTION 'NOSHOW_ON_CHECKED_IN_BLOCKED';
  END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_block_noshow_on_checked_in BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.block_noshow_on_checked_in();

CREATE OR REPLACE FUNCTION public.block_premature_noshow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF now() < NEW.start_at + make_interval(mins => public.noshow_grace_minutes()) THEN
    INSERT INTO public.noshow_guard_rejections(booking_id, reason) VALUES (NEW.id, 'premature');
    RETURN NULL;
  END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_block_premature_noshow BEFORE UPDATE ON public.bookings FOR EACH ROW
  WHEN (NEW.cancelled_by='system' AND NEW.auto_cancelled IS TRUE AND OLD.auto_cancelled IS DISTINCT FROM true)
  EXECUTE FUNCTION public.block_premature_noshow();

CREATE OR REPLACE FUNCTION public.lock_cancelled_by_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.cancelled_by IN ('user','system') AND NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
     AND NOT (current_user='postgres' OR session_user='postgres') THEN
    RAISE EXCEPTION 'IMMUTABLE_CANCELLED_BY';
  END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_lock_cancelled_by_immutable BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.lock_cancelled_by_immutable();

-- mark_noshow (20260746 요지)
CREATE OR REPLACE FUNCTION public.mark_noshow(p_booking_id text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n int; BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  UPDATE public.bookings SET auto_cancelled=true, cancelled_by='system'
   WHERE id=p_booking_id AND status='confirmed' AND checked_in=false AND early_ended=false
     AND auto_cancelled=false AND cancelled_by IS NULL
     AND now() >= start_at + make_interval(mins => public.noshow_grace_minutes());
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
GRANT EXECUTE ON FUNCTION public.mark_noshow(text) TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
\set ON_ERROR_STOP off
\pset format aligned
\c stub authenticator
\c stub authenticator
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);

SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);
SELECT 'session='||session_user||' current='||current_user AS ctx;
\c stub postgres
-- 시드 (postgres)
INSERT INTO bookings(id,room_id,title,user_id,user_name,start_at,end_at) VALUES
 ('A',1,'2h 노쇼',        '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()),                 -- T1: RPC 마킹
 ('B',2,'cron 노쇼',      '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()),                 -- T2: cron 직접 UPDATE
 ('C',3,'미래',           '22222222-2222-2222-2222-222222222222','홍', now()+interval '1h', now()+interval '2h'),   -- T3: premature
 ('D',4,'15분',           '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()-interval '105min'),-- T4
 ('L',5,'레거시 노쇼',    '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()),                 -- T6: 종결 전 마킹 + 재예약
 ('K',6,'레거시 충돌',    '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()),                 -- T7
 ('E',7,'조기반납',       '22222222-2222-2222-2222-222222222222','홍', now()-interval '2h', now()-interval '1h');
UPDATE bookings SET early_ended=true, original_end_at=end_at, end_at=now()-interval '90min', checked_in=true WHERE id='E';
-- 레거시: 트리거 없던 시절 마킹 재현
ALTER TABLE bookings DISABLE TRIGGER trg_noshow_close_end;
UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id IN ('L','K');
ALTER TABLE bookings ENABLE TRIGGER trg_noshow_close_end;
INSERT INTO bookings(id,room_id,title,user_name,start_at,end_at) VALUES
 ('L2',5,'재예약(45분 뒤)','김', now()-interval '75min', now()),          -- L 종결구간 [s, s+15) 과 무겹침
 ('K2',6,'재예약(즉시)',   '김', now()-interval '110min', now()-interval '80min'); -- K 종결구간과 겹침

\echo '── T1 RPC mark_noshow → 15분 종결'
\c stub authenticator
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);

SELECT mark_noshow('A') AS rows;
SELECT id, end_at - start_at AS dur, original_end_at - start_at AS orig_dur, noshow_closed_at = end_at AS closed_eq_end, auto_cancelled, cancelled_by FROM bookings WHERE id='A';
\c stub postgres

\echo '── T2 cron 직접 UPDATE(service_role) → 동일 종결'
UPDATE bookings SET auto_cancelled=true, cancelled_by='system' WHERE id='B' AND auto_cancelled=false AND cancelled_by IS NULL;
SELECT id, end_at - start_at AS dur, original_end_at - start_at AS orig_dur, noshow_closed_at IS NOT NULL AS closed FROM bookings WHERE id='B';
\echo '── T3 미래 예약 조기노쇼 → 0행, 부분반영 없음'
\c stub authenticator
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);
 SELECT mark_noshow('C') AS rows; \c stub postgres

SELECT id, auto_cancelled, cancelled_by, end_at - start_at AS dur, original_end_at, noshow_closed_at FROM bookings WHERE id='C';
SELECT count(*) AS rejections FROM noshow_guard_rejections;
\echo '── T4 15분 예약 마킹 → end_at 불변, closed=end'
\c stub authenticator
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);
 SELECT mark_noshow('D') AS rows; \c stub postgres

SELECT id, end_at - start_at AS dur, original_end_at = end_at AS orig_eq_end, noshow_closed_at = end_at AS closed_eq_end FROM bookings WHERE id='D';
\echo '── T5 해제 정상(A) → 사용완료, end 불변'
\c stub authenticator
SET ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false);
SELECT set_config('app.is_admin','true', false);

SELECT admin_resolve_noshow('A');
SELECT id, checked_in, auto_cancelled, cancelled_by, end_at - start_at AS dur, original_end_at - start_at AS orig_dur, noshow_closed_at IS NOT NULL AS closed_kept FROM bookings WHERE id='A';
\echo '── T5b 재해제 → NOT_NOSHOW / 재노쇼 → 0행'
SELECT admin_resolve_noshow('A');
SELECT mark_noshow('A') AS renoshow_rows;
\echo '── T6 레거시(2h) + 45분 뒤 재예약 → 해제 시 종결 적용, 충돌 없음'
SELECT admin_resolve_noshow('L');
SELECT id, checked_in, auto_cancelled, end_at - start_at AS dur, original_end_at - start_at AS orig_dur, noshow_closed_at = end_at AS closed FROM bookings WHERE id='L';
\echo '── T7 레거시 + 종결구간 겹침 재예약 → SLOT_OCCUPIED:K2, 행 불변'
SELECT admin_resolve_noshow('K');
SELECT id, checked_in, auto_cancelled, cancelled_by, end_at - start_at AS dur, original_end_at FROM bookings WHERE id='K';
\echo '── T9 비관리자 → NOT_ADMIN'
SELECT set_config('app.is_admin','false', false);
SELECT admin_resolve_noshow('K');
SELECT set_config('app.is_admin','true', false);
\echo '── T10 조기반납 행 마킹 시도 → 가드 차단, 원본 보존'
SELECT mark_noshow('E') AS rows;
SELECT id, early_ended, original_end_at - start_at AS orig_dur, noshow_closed_at FROM bookings WHERE id='E';
\c stub postgres

\echo '── 감사/제재 재평가 호출'
SELECT action, booking_id FROM noshow_admin_actions ORDER BY id;
SELECT count(*) AS eval_calls FROM eval_calls;
