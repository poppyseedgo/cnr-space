-- 시뮬레이션 Phase 5-B: 00 스텁 → 20261005 → 20261006 → 20261007 → 20261008 → 20261009 적용 후
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
\set STAFF2 '''33333333-3333-3333-3333-333333333333'''
INSERT INTO auth.users (id) VALUES (:STAFF2) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, name, email, dept, employee_id) VALUES (:STAFF2, '둘째', 's2@t.com', 'CO', 'E2') ON CONFLICT DO NOTHING;
INSERT INTO admin_roles (user_id, role) VALUES (:ORGADM, 'org');

\echo === [1] 겸직 카드 가드 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_files (id, name, effective_on, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','10월','2026-10-01', :ORGADM);
INSERT INTO org_units (id, file_id, name, code) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','A','A'), ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','B','B');
SELECT _expect('1-1 본 카드 없이 겸직 카드 → 거부', _err($q$INSERT INTO org_cards (file_id, unit_id, profile_id, is_primary) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222', false)$q$)='ORG_CARD_CONCURRENT_NEEDS_PRIMARY');
INSERT INTO org_cards (id, file_id, unit_id, profile_id) VALUES ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', :STAFF);
SELECT _expect('1-2 본 카드 2장 → 유일 인덱스 거부', _err($q$INSERT INTO org_cards (file_id, unit_id, profile_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222')$q$) LIKE '%org_cards_file_profile_primary%');
INSERT INTO org_cards (id, file_id, unit_id, profile_id, is_primary, is_unit_head) VALUES ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002', :STAFF, false, true);
SELECT _expect('1-3 본 카드 있으면 겸직 카드 OK (단위장 가능)', (SELECT count(*) FROM org_cards WHERE profile_id=:STAFF)=2);
SELECT _expect('1-4 같은 단위에 같은 사람 2장 → 거부', _err($q$INSERT INTO org_cards (file_id, unit_id, profile_id, is_primary) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222', false)$q$) LIKE '%org_cards_unit_profile%');
SELECT _expect('1-5 겸직 남긴 채 본 카드 제거 → 거부', _err($q$DELETE FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000001'$q$)='ORG_CARD_PRIMARY_HAS_CONCURRENT');
SELECT _expect('1-6 본 카드 강등(겸직 잔존) → 거부', _err($q$UPDATE org_cards SET is_primary=false WHERE id='cccccccc-0000-0000-0000-000000000001'$q$)='ORG_CARD_PRIMARY_HAS_CONCURRENT');
SELECT _expect('1-7 공석은 겸직 불가(가드 → CHECK 백스톱)', _err($q$INSERT INTO org_cards (file_id, unit_id, is_vacancy, is_primary, display_name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002', true, false, '공석')$q$)='ORG_CARD_CONCURRENT_NEEDS_PERSON');
SELECT org_swap_primary_card('cccccccc-0000-0000-0000-000000000002');
SELECT _expect('1-8 승격 RPC: 본/겸직 교체', (SELECT is_primary FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000002') AND NOT (SELECT is_primary FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000001'));
DELETE FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000001';
SELECT _expect('1-9 강등된 카드(겸직) 제거 OK → 본 카드 1장', (SELECT count(*) FROM org_cards WHERE profile_id=:STAFF)=1);
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('1-10 일반 직원 승격 RPC → FORBIDDEN', _err($q$SELECT org_swap_primary_card('cccccccc-0000-0000-0000-000000000002')$q$)='FORBIDDEN');
RESET ROLE;

\echo === [2] 숨김 · 로스터 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_cards (id, file_id, unit_id, profile_id) VALUES ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', :STAFF2);
SELECT org_set_card_hidden('cccccccc-0000-0000-0000-000000000003', true);
SELECT _expect('2-1 초안에서 숨김 OK', (SELECT hidden_at IS NOT NULL FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000003'));
RESET ROLE;
UPDATE profiles SET employment_status='departing', departure_scheduled_on=current_date - 1 WHERE id=:ORGADM;   -- ORGADM: 퇴사일 경과, 카드 없음
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_roster_check('aaaaaaaa-0000-0000-0000-000000000001') AS rc \gset
SELECT _expect('2-2 미배치: 퇴사일 경과자 제외', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(:'rc'::jsonb->'missing') x WHERE x->>'profile_id'=:ORGADM));
RESET ROLE;
UPDATE profiles SET employment_status='active', departure_scheduled_on=NULL WHERE id=:ORGADM;
-- 유령(프로필 삭제) + 숨김 → 유령 검사 제외
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_cards (id, file_id, unit_id, profile_id) VALUES ('cccccccc-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', :ORGADM);
RESET ROLE;
INSERT INTO auth.users (id) VALUES ('44444444-4444-4444-4444-444444444444') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, name, email, dept, employee_id) VALUES ('44444444-4444-4444-4444-444444444444','유령','g@t.com','CO','E4');
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_cards (id, file_id, unit_id, profile_id) VALUES ('cccccccc-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444');
RESET ROLE;
DELETE FROM profiles WHERE id='44444444-4444-4444-4444-444444444444';
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_roster_check('aaaaaaaa-0000-0000-0000-000000000001') AS rc2 \gset
SELECT _expect('2-3 유령 카드 1 (숨김 전)', (:'rc2'::jsonb->>'ghost_count')::int=1);
SELECT org_set_card_hidden('cccccccc-0000-0000-0000-000000000005', true);
SELECT org_roster_check('aaaaaaaa-0000-0000-0000-000000000001') AS rc3 \gset
SELECT _expect('2-4 숨기면 유령 0', (:'rc3'::jsonb->>'ghost_count')::int=0);
RESET ROLE;

\echo === [3] Active 전환 · 복사 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file('aaaaaaaa-0000-0000-0000-000000000001') AS a1 \gset
SELECT _expect('3-1 force 없이 전환(숨김 유령은 통과) · 숨김 2장 제거', (:'a1'::jsonb->>'hidden_removed')::int=2 AND NOT EXISTS (SELECT 1 FROM org_cards WHERE file_id='aaaaaaaa-0000-0000-0000-000000000001' AND hidden_at IS NOT NULL));
SELECT _expect('3-2 cards = 본 카드(공석·숨김 제외)', (:'a1'::jsonb->>'cards')::int=2);
SET request.jwt.claim.sub = :ORGADM;
SELECT _err($q$SELECT org_set_card_hidden('cccccccc-0000-0000-0000-000000000004', true)$q$) AS h1 \gset
SELECT _expect('3-3 Active 파일에서도 숨김 RPC 동작', :'h1'='OK' AND (SELECT hidden_at IS NOT NULL FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000004'));
SELECT org_set_card_hidden('cccccccc-0000-0000-0000-000000000004', false);
-- 복사 → 겸직 추가 → 전환 → diff concurrent_added · departed(숨김)
SELECT org_copy_file('aaaaaaaa-0000-0000-0000-000000000001', '11월', '2026-11-01') AS c \gset
SELECT _expect('3-4 복사: is_primary 유지', (SELECT count(*) FROM org_cards WHERE file_id=(:'c'::jsonb->>'file_id')::uuid AND is_primary)=2);
INSERT INTO org_cards (file_id, unit_id, profile_id, is_primary)
SELECT (:'c'::jsonb->>'file_id')::uuid, u.id, :ORGADM, false FROM org_units u WHERE u.file_id=(:'c'::jsonb->>'file_id')::uuid AND u.code='B';
SELECT org_set_card_hidden((SELECT id FROM org_cards WHERE file_id=(:'c'::jsonb->>'file_id')::uuid AND profile_id=:STAFF), true);
SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file((:'c'::jsonb->>'file_id')::uuid) AS a2 \gset
SELECT _expect('3-5 diff: concurrent_added 1 · departed 1(숨김)', (:'a2'::jsonb->'diff'->>'concurrent_added')::int=1 AND (:'a2'::jsonb->'diff'->>'departed')::int=1);
SELECT _expect('3-6 숨김 본 카드 제거됨 · 겸직 카드 잔존', NOT EXISTS (SELECT 1 FROM org_cards WHERE file_id=(:'c'::jsonb->>'file_id')::uuid AND profile_id=:STAFF) AND (SELECT count(*) FROM org_cards WHERE file_id=(:'c'::jsonb->>'file_id')::uuid AND profile_id=:ORGADM)=2);
RESET ROLE;
