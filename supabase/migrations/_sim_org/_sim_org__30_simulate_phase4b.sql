-- 시뮬레이션 Phase 4-B: 00 스텁 → 20261005 → 20261006 → 20261007 적용 후
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
CREATE OR REPLACE FUNCTION public._expect(p_case text, p_ok boolean, p_note text DEFAULT '')
RETURNS text LANGUAGE sql AS $$ SELECT format('%s  %s %s', CASE WHEN p_ok THEN '✅' ELSE '❌' END, p_case, p_note) $$;
CREATE OR REPLACE FUNCTION public._err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
\set SUPER '''0120852b-faae-4903-9515-c9c28ecaf76b'''
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
INSERT INTO admin_roles (user_id, role) VALUES (:ORGADM, 'org');

\echo === [1] Active 전환 — 인앱 미삽입 · 반환 보강 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_files (id, name, effective_on, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','10월 조직도','2026-10-01', :ORGADM);
INSERT INTO org_units (id, file_id, name, code) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','C&R','ROOT');
INSERT INTO org_cards (file_id, unit_id, profile_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', :STAFF);
SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file('aaaaaaaa-0000-0000-0000-000000000001') AS a1 \gset
SELECT _expect('1-1 반환: file_name·units·cards', (:'a1'::jsonb->>'file_name')='10월 조직도' AND (:'a1'::jsonb->>'units')::int=1 AND (:'a1'::jsonb->>'cards')::int=1);
SELECT _expect('1-2 인앱 미삽입 (notifications 0행)', (SELECT count(*) FROM notifications WHERE type='org_activated')=0);
SELECT _expect('1-3 inapp_sent 키 없음', NOT (:'a1'::jsonb ? 'inapp_sent'));
SET request.jwt.claim.sub = :ORGADM;
SELECT org_copy_file('aaaaaaaa-0000-0000-0000-000000000001', '11월', '2026-11-01') AS c \gset
SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file((:'c'::jsonb->>'file_id')::uuid) AS a2 \gset
SELECT _expect('1-4 두 번째 전환: prev_file_name 채움', (:'a2'::jsonb->>'prev_file_name')='10월 조직도' AND (:'a2'::jsonb->>'prev_file_id')='aaaaaaaa-0000-0000-0000-000000000001');
RESET ROLE;

\echo === [2] 시스템 잔여 확인 ===
INSERT INTO books (title) VALUES ('클린 코드');
INSERT INTO book_checkouts (book_id, user_id, due_at, status) VALUES (1, :STAFF, now() + interval '3 days', 'active'), (1, :STAFF, now() - interval '30 days', 'returned');
INSERT INTO resource_items (label) VALUES ('포인터 A');
INSERT INTO resource_bookings (item_id, user_id, start_at, end_at, occupied_until, status) VALUES (1, :STAFF, now() + interval '1 day', now() + interval '2 days', now() + interval '2 days', 'confirmed'), (1, :STAFF, now() - interval '5 days', now() - interval '4 days', now() - interval '4 days', 'confirmed');
INSERT INTO bookings (user_id, status, start_at) VALUES (:STAFF, 'confirmed', now() + interval '2 days'), (:STAFF, 'cancelled', now() + interval '2 days'), (:STAFF, 'confirmed', now() - interval '2 days');
INSERT INTO admin_roles (user_id, role) VALUES (:STAFF, 'book');
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_offboarding_system_check(:STAFF) AS sc \gset
SELECT _expect('2-1 도서 active 1 (returned 제외)', (:'sc'::jsonb->>'book_count')::int=1 AND (:'sc'::jsonb->'books'->0->>'title')='클린 코드');
SELECT _expect('2-2 미래 자원예약 1 (과거 제외)', (:'sc'::jsonb->>'resource_count')::int=1);
SELECT _expect('2-3 어드민 역할 1 (book)', (:'sc'::jsonb->>'admin_role_count')::int=1 AND (:'sc'::jsonb->'admin_roles'->>0)='book');
SELECT _expect('2-4 미래 회의실 예약 1 (취소·과거 제외)', (:'sc'::jsonb->>'future_room_bookings')::int=1);
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('2-5 일반 직원 호출 → FORBIDDEN', _err($q$SELECT org_offboarding_system_check('22222222-2222-2222-2222-222222222222')$q$)='FORBIDDEN');
RESET ROLE;
