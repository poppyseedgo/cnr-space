-- ⚠ LOCAL_ONLY — 로컬 PG 시뮬 전용 스텁. 운영 실행 금지.
-- _sim_booking_guard/LOCAL_ONLY__00_stub_prod.sql + 20261017_booking_write_guard.sql 적용 뒤에 얹는 추가분.
--   · audit_log (운영 2026-11-23 실측 컬럼)
--   · net.http_post 스텁 — 실제 HTTP 대신 호출 기록만 남긴다 (pg_net 대체)
--   · 운영 잔여 2건과 같은 형태의 "마감 지난 승인 대기" 시드 (에메랄드 room_id=3)
--   · 기존 스텁의 E3(에메랄드 진행중 confirmed)는 시뮬 시간대와 겹쳐 제거

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  actor_id uuid, actor_name text, before_data jsonb, after_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS net._calls (id bigserial PRIMARY KEY, url text, headers jsonb, body jsonb, at timestamptz DEFAULT now());
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                         headers jsonb DEFAULT '{"Content-Type":"application/json"}'::jsonb,
                                         timeout_milliseconds integer DEFAULT 5000)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO net._calls (url, headers, body) VALUES (url, headers, body) RETURNING id INTO v;
  RETURN v;
END $$;

SET session_replication_role = replica;
DELETE FROM public.bookings WHERE id = 'E3';
INSERT INTO public.bookings (id, room_id, title, start_at, end_at, user_id, user_name, user_dept, user_email, status, checked_in) VALUES
  -- L1 운영 b1795393755338_0 형태: 오늘 시작 직전에 만든 승인 대기, 마감 경과 (시작 90분 전 ~ 60분 뒤)
  ('L1', 3, '잔여 오늘', now()-interval '90 minutes', now()+interval '60 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','pending', false),
  -- L2 운영 b1794294002331_0 형태: 13일 전 승인 대기 그대로
  ('L2', 3, '잔여 과거', now()-interval '13 days', now()-interval '13 days'+interval '90 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','pending', false),
  -- L3 운영의 기존 기한초과 건 형태(6·7월): cancelled/system
  ('L3', 3, '기존 기한초과', now()-interval '100 days', now()-interval '100 days'+interval '60 minutes', '11111111-1111-1111-1111-111111111111','U1예약자','CDI','u1@cnrres.com','cancelled', false);
UPDATE public.bookings SET auto_cancelled = true, cancelled_by = 'system' WHERE id = 'L3';
SET session_replication_role = origin;
