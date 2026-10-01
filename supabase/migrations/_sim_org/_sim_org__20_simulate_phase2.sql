-- 시뮬레이션 Phase 2: 00 스텁 → 20261005 → 20261006 적용 후 실행 (10_simulate 이후가 아닌 깨끗한 DB 에서)
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION public._expect(p_case text, p_ok boolean, p_note text DEFAULT '')
RETURNS text LANGUAGE sql AS $$ SELECT format('%s  %s %s', CASE WHEN p_ok THEN '✅' ELSE '❌' END, p_case, p_note) $$;
CREATE OR REPLACE FUNCTION public._err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- 세션 역할 전환 헬퍼
\set SUPER '''0120852b-faae-4903-9515-c9c28ecaf76b'''
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set STAFF2 '''33333333-3333-3333-3333-333333333333'''

INSERT INTO admin_roles (user_id, role) VALUES (:ORGADM, 'org');

\echo === [1] admin_set_employment_status 분리 — 기존 동작 동일 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('1-1 org 만 가진 담당자가 기존 RPC 직접 호출 → FORBIDDEN 유지', _err($q$SELECT admin_set_employment_status('22222222-2222-2222-2222-222222222222','leave')$q$) = 'FORBIDDEN');
SELECT _expect('1-2 authenticated 는 employment_status_apply 직접 실행 불가', _err($q$SELECT employment_status_apply('22222222-2222-2222-2222-222222222222','leave')$q$) LIKE '%permission denied%');
RESET ROLE;
INSERT INTO admin_roles (user_id, role) VALUES (:ORGADM, 'user');
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('1-3 user 역할 보유 시 기존 RPC 정상 (departing + 예정일)', (admin_set_employment_status(:STAFF2,'departing',current_date + 10)->>'employment_status') = 'departing');
SELECT _expect('1-4 DEPARTURE_DATE_PAST 유지', _err($q$SELECT admin_set_employment_status('33333333-3333-3333-3333-333333333333','departing',current_date - 1)$q$) = 'DEPARTURE_DATE_PAST');
SELECT _expect('1-5 INVALID_STATUS 유지', _err($q$SELECT admin_set_employment_status('33333333-3333-3333-3333-333333333333','vacation')$q$) = 'INVALID_STATUS');
SELECT admin_set_employment_status(:STAFF2,'active');
RESET ROLE;
DELETE FROM admin_roles WHERE user_id = :ORGADM AND role = 'user';

\echo === [2] 잠금 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_files (id, name, effective_on, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2026-10 초안','2026-10-01', :ORGADM);
SELECT _expect('2-1 잠금 획득', (org_acquire_lock('aaaaaaaa-0000-0000-0000-000000000001')->>'lock_by')::uuid = :ORGADM);
SET request.jwt.claim.sub = :SUPER;
SELECT _expect('2-2 타인 잠금 중 → ORG_FILE_LOCKED', _err($q$SELECT org_acquire_lock('aaaaaaaa-0000-0000-0000-000000000001')$q$) = 'ORG_FILE_LOCKED');
SELECT _expect('2-3 super 강제 획득', (org_acquire_lock('aaaaaaaa-0000-0000-0000-000000000001', true)->>'forced')::boolean);
SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('2-4 비보유자 해제 불가 (false)', NOT org_release_lock('aaaaaaaa-0000-0000-0000-000000000001'));
RESET ROLE;
UPDATE org_files SET lock_at = now() - interval '31 minutes' WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('2-5 30분 경과 → 타인 획득 가능', (org_acquire_lock('aaaaaaaa-0000-0000-0000-000000000001')->>'lock_by')::uuid = :ORGADM);
SELECT _expect('2-6 보유자 해제', org_release_lock('aaaaaaaa-0000-0000-0000-000000000001'));

\echo === [3] 구조 구성 → 복사 ===
INSERT INTO org_units (id, file_id, name, code, azure_division, sort_order) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','C&R Research','ROOT',NULL,0),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','CO Division','CO','CO',1),
  ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','CO1','CO1',NULL,1);
UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000001' WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000002' WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
INSERT INTO org_cards (id, file_id, unit_id, profile_id, rank_id, is_unit_head) VALUES
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003', :STAFF, (SELECT id FROM org_ranks WHERE code='director'), true);
INSERT INTO org_cards (id, file_id, unit_id, profile_id, reports_to_card_id) VALUES
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003', :STAFF2, 'cccccccc-0000-0000-0000-000000000001');
UPDATE org_units SET head_card_id='cccccccc-0000-0000-0000-000000000001' WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
INSERT INTO org_card_jobs (card_id, job_id, is_primary) VALUES ('cccccccc-0000-0000-0000-000000000001',(SELECT id FROM org_jobs WHERE code='CRM'), true);
INSERT INTO org_card_jobs (card_id, job_id, is_primary) VALUES ('cccccccc-0000-0000-0000-000000000002',(SELECT id FROM org_jobs WHERE code='CRA'), true);

SELECT org_copy_file('aaaaaaaa-0000-0000-0000-000000000001', '복사본', '2026-11-01') AS copy_result \gset
SELECT _expect('3-1 복사: 단위 3 · 카드 2', (:'copy_result'::jsonb->>'units')::int = 3 AND (:'copy_result'::jsonb->>'cards')::int = 2);
SELECT (:'copy_result'::jsonb->>'file_id')::uuid AS copy_id \gset
SELECT _expect('3-2 복사본 draft + 계보', EXISTS (SELECT 1 FROM org_files WHERE id = :'copy_id' AND status='draft' AND parent_file_id='aaaaaaaa-0000-0000-0000-000000000001'));
SELECT _expect('3-3 부모 재매핑 (CO1 의 부모 = 복사본 CO)', EXISTS (SELECT 1 FROM org_units c JOIN org_units p ON p.id=c.parent_unit_id WHERE c.file_id=:'copy_id' AND c.code='CO1' AND p.code='CO' AND p.file_id=:'copy_id'));
SELECT _expect('3-4 보고선·단위장·직무 재매핑', EXISTS (SELECT 1 FROM org_cards c JOIN org_cards b ON b.id=c.reports_to_card_id WHERE c.file_id=:'copy_id' AND b.file_id=:'copy_id')
  AND EXISTS (SELECT 1 FROM org_units u JOIN org_cards h ON h.id=u.head_card_id WHERE u.file_id=:'copy_id' AND h.file_id=:'copy_id')
  AND (SELECT count(*) FROM org_card_jobs j JOIN org_cards c ON c.id=j.card_id WHERE c.file_id=:'copy_id') = 2);
SELECT _expect('3-5 로스터 누락 = 사번 있는 미배치 2명(고지·조직담당)', (:'copy_result'::jsonb->>'missing_count')::int = 2);
SELECT _expect('3-6 원본 ID 가 복사본에 없음 (재매핑)', NOT EXISTS (SELECT 1 FROM org_units WHERE file_id=:'copy_id' AND id IN ('bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')));

\echo === [4] Active 전환 ===
SELECT _expect('4-1 org 역할은 NOT_SUPER', _err($q$SELECT org_activate_file('aaaaaaaa-0000-0000-0000-000000000001')$q$) = 'NOT_SUPER');
SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file('aaaaaaaa-0000-0000-0000-000000000001') AS act1 \gset
SELECT _expect('4-2 첫 Active (prev 없음, diff 0)', (:'act1'::jsonb->>'prev_file_id') IS NULL AND (:'act1'::jsonb->>'diff_count')::int = 0 AND (SELECT status FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001')='active');
SELECT _expect('4-3 인앱 알림 → org 역할 보유자 (조직담당 1명, super 는 org 미보유라 제외)', (:'act1'::jsonb->>'inapp_sent')::int = 1 AND EXISTS (SELECT 1 FROM notifications WHERE type='org_activated' AND user_id=:ORGADM AND booking_id='org-file-aaaaaaaa-0000-0000-0000-000000000001'));
SELECT _expect('4-4 Active 재지정 → NOT_DRAFT', _err($q$SELECT org_activate_file('aaaaaaaa-0000-0000-0000-000000000001')$q$) = 'ORG_ACTIVATE_NOT_DRAFT');
-- 복사본 편집: STAFF2 승진(이사) + 직무 변경 + 새 단위 + 신규 입사예정자 배치, 유령카드 1장
SET request.jwt.claim.sub = :ORGADM;
UPDATE org_cards SET rank_id=(SELECT id FROM org_ranks WHERE code='director') WHERE file_id=:'copy_id' AND profile_id=:STAFF2;
UPDATE org_card_jobs SET job_id=(SELECT id FROM org_jobs WHERE code='PL') WHERE card_id=(SELECT id FROM org_cards WHERE file_id=:'copy_id' AND profile_id=:STAFF2);
INSERT INTO org_units (id, file_id, parent_unit_id, name, code) VALUES ('bbbbbbbb-0000-0000-0000-000000000099', :'copy_id', (SELECT id FROM org_units WHERE file_id=:'copy_id' AND code='CO'), 'CO2', 'CO2');
UPDATE org_cards SET unit_id='bbbbbbbb-0000-0000-0000-000000000099' WHERE file_id=:'copy_id' AND profile_id=:STAFF;
INSERT INTO org_persons (id, name, email) VALUES ('dddddddd-0000-0000-0000-000000000001','신입A','newbie@cnrres.com');
INSERT INTO org_cards (file_id, unit_id, person_id) VALUES (:'copy_id', 'bbbbbbbb-0000-0000-0000-000000000099', 'dddddddd-0000-0000-0000-000000000001');
INSERT INTO org_cards (file_id, unit_id, profile_id) VALUES (:'copy_id', 'bbbbbbbb-0000-0000-0000-000000000099', '99999999-9999-9999-9999-999999999999');  -- 유령
SET request.jwt.claim.sub = :SUPER;
SELECT _expect('4-5 유령 카드 → ORG_ACTIVATE_GHOSTS', _err(format($q$SELECT org_activate_file(%L)$q$, :'copy_id')) = 'ORG_ACTIVATE_GHOSTS');
SET request.jwt.claim.sub = :ORGADM;
DELETE FROM org_cards WHERE file_id=:'copy_id' AND profile_id='99999999-9999-9999-9999-999999999999';
SELECT org_acquire_lock(:'copy_id');
SET request.jwt.claim.sub = :SUPER;
SELECT _expect('4-6 타인 잠금 중 → ORG_FILE_LOCKED', _err(format($q$SELECT org_activate_file(%L)$q$, :'copy_id')) = 'ORG_FILE_LOCKED');
SELECT org_activate_file(:'copy_id', true) AS act2 \gset
SELECT _expect('4-7 force 전환: 이전 Active archived · 새 Active · 잠금 해제', (SELECT status FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001')='archived'
  AND (SELECT status FROM org_files WHERE id=:'copy_id')='active' AND (SELECT lock_by FROM org_files WHERE id=:'copy_id') IS NULL
  AND (SELECT count(*) FROM org_files WHERE status='active') = 1);
SELECT _expect('4-8 diff: hired 1 · moved 1 · promoted 1 · job_changed 1 · unit_created 1', (:'act2'::jsonb->'diff'->>'hired')::int = 1 AND (:'act2'::jsonb->'diff'->>'moved')::int = 1
  AND (:'act2'::jsonb->'diff'->>'promoted')::int = 1 AND (:'act2'::jsonb->'diff'->>'job_changed')::int = 1 AND (:'act2'::jsonb->'diff'->>'unit_created')::int = 1
  AND (:'act2'::jsonb->'diff'->>'departed') IS NULL, :'act2');
SELECT _expect('4-9 diff 라벨 = profiles live 이름', EXISTS (SELECT 1 FROM org_activation_diffs WHERE file_id=:'copy_id' AND kind='promoted' AND label='직원B' AND after->>'rank'='이사'));
SELECT _expect('4-10 변경 로그에 status 전환 2건 (archived·active)', (SELECT count(*) FROM org_change_log WHERE target_table='org_files' AND action='update' AND before->>'status' <> after->>'status') >= 3);

\echo === [5] 사람 상태 ===
SET request.jwt.claim.sub = :ORGADM;
SELECT org_set_person_status(:STAFF, NULL, 'departing', jsonb_build_object('departure_on', (current_date + 20)::text)) AS st1 \gset
SELECT _expect('5-1 퇴사예정 → profiles departing + 예정일', (SELECT employment_status FROM profiles WHERE id=:STAFF)='departing' AND (SELECT departure_scheduled_on FROM profiles WHERE id=:STAFF) = current_date + 20);
SELECT _expect('5-2 체크리스트 5항목 복제 · 법인폰 applicable=false(미지정)', (SELECT count(*) FROM org_offboarding_items WHERE status_id=(:'st1'::jsonb->>'id')::uuid) = 5
  AND EXISTS (SELECT 1 FROM org_offboarding_items WHERE status_id=(:'st1'::jsonb->>'id')::uuid AND label='법인폰' AND NOT applicable AND is_critical));
SELECT _expect('5-3 퇴사예정 예정일 누락 → DEPARTURE_DATE_REQUIRED', _err($q$SELECT org_set_person_status('33333333-3333-3333-3333-333333333333', NULL, 'departing', '{}')$q$) = 'DEPARTURE_DATE_REQUIRED');
SELECT _expect('5-4 과거 예정일 → DEPARTURE_DATE_PAST (기존 규칙 승계)', _err(format($q$SELECT org_set_person_status('33333333-3333-3333-3333-333333333333', NULL, 'departing', '{"departure_on":"%s"}')$q$, current_date - 1)) = 'DEPARTURE_DATE_PAST');
SELECT _expect('5-5 사용자 상태 테이블에 활성 1건', (SELECT count(*) FROM org_person_status WHERE profile_id=:STAFF AND ended_at IS NULL) = 1);
-- 퇴사예정 철회
SELECT org_end_person_status((:'st1'::jsonb->>'id')::uuid, 'manual');
SELECT _expect('5-6 철회 → profiles active · 예정일 NULL · 체크리스트 보존', (SELECT employment_status FROM profiles WHERE id=:STAFF)='active' AND (SELECT departure_scheduled_on FROM profiles WHERE id=:STAFF) IS NULL
  AND (SELECT count(*) FROM org_offboarding_items WHERE status_id=(:'st1'::jsonb->>'id')::uuid) = 5);
-- 휴직예정 → (cron) 휴직 → (cron D-30) 복직예정 → (cron) 복직
SELECT org_set_person_status(:STAFF2, NULL, 'leave_planned', jsonb_build_object('start_on', current_date::text, 'return_on', (current_date + 20)::text, 'planned_status_code', 'parental_leave')) AS st2 \gset
SELECT _expect('5-7 휴직예정 등록: profiles 는 active 유지', (SELECT employment_status FROM profiles WHERE id=:STAFF2)='active');
SELECT _expect('5-8 휴직예정에 예정 종류 누락 → 에러', _err($q$SELECT org_set_person_status('33333333-3333-3333-3333-333333333333', NULL, 'leave_planned', '{"start_on":"2026-12-01"}')$q$) = 'ORG_STATUS_PLANNED_REQUIRED');
RESET ROLE;
SELECT org_daily_transitions() AS d1 \gset
SELECT _expect('5-9 cron 1회차: 휴직예정→육아휴직 + (return_on D-20 이라) 곧바로 복직예정 · profiles leave', (:'d1'::jsonb->>'leave_started')::int = 1 AND (:'d1'::jsonb->>'return_planned')::int = 1
  AND (SELECT status_code FROM org_person_status WHERE profile_id=:STAFF2 AND ended_at IS NULL)='return_planned' AND (SELECT employment_status FROM profiles WHERE id=:STAFF2)='leave');
SELECT _expect('5-10 종료 사유 auto 2건', (SELECT count(*) FROM org_person_status WHERE profile_id=:STAFF2 AND ended_reason='auto') = 2);
UPDATE org_person_status SET return_on = current_date WHERE profile_id=:STAFF2 AND ended_at IS NULL;
SELECT org_daily_transitions() AS d2 \gset
SELECT _expect('5-11 cron 2회차: 복직예정→복직 · profiles returned + returned_on', (:'d2'::jsonb->>'returned')::int = 1 AND (SELECT employment_status FROM profiles WHERE id=:STAFF2)='returned'
  AND (SELECT returned_on FROM profiles WHERE id=:STAFF2) = current_date AND NOT EXISTS (SELECT 1 FROM org_person_status WHERE profile_id=:STAFF2 AND ended_at IS NULL));
SELECT _expect('5-12 cron 멱등 (변화 0)', (org_daily_transitions()->>'leave_started')::int = 0);
-- 사용자 정의 휴직 종류도 category 로 동작
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_status_types (code, label, category) VALUES ('sabbatical', '안식휴직', 'leave');
SELECT org_set_person_status(:STAFF2, NULL, 'sabbatical', jsonb_build_object('start_on', current_date::text)) AS st3 \gset
SELECT _expect('5-13 사용자 정의 코드(category leave) → profiles leave', (SELECT employment_status FROM profiles WHERE id=:STAFF2)='leave');
SELECT org_end_person_status((:'st3'::jsonb->>'id')::uuid);
SELECT _expect('5-14 휴직 수동 종료 → returned', (SELECT employment_status FROM profiles WHERE id=:STAFF2)='returned');

\echo === [6] 입사예정자 연결 (sync 후크) ===
SELECT org_set_person_status(NULL, 'dddddddd-0000-0000-0000-000000000001', 'hire_planned', jsonb_build_object('start_on', (current_date + 7)::text)) AS st4 \gset
SELECT _expect('6-1 입사예정 등록 → planned_start_on', (SELECT planned_start_on FROM org_persons WHERE id='dddddddd-0000-0000-0000-000000000001') = current_date + 7);
RESET ROLE;
INSERT INTO auth.users VALUES ('44444444-4444-4444-4444-444444444444','newbie@cnrres.com');
INSERT INTO profiles (id,email,name,dept,employee_id) VALUES ('44444444-4444-4444-4444-444444444444','newbie@cnrres.com','신입A','CO','E4444');
SET ROLE service_role; SET request.jwt.claim.role = 'service_role'; SET request.jwt.claim.sub = '';
SELECT org_link_planned_person('newbie@cnrres.com') AS link \gset
SELECT _expect('6-2 service_role 연결: Active 파일 카드 profile_id 백필 (lifecycle 플래그)', (:'link'::jsonb->>'linked')::boolean AND (:'link'::jsonb->>'cards_linked')::int = 1
  AND EXISTS (SELECT 1 FROM org_cards WHERE file_id=:'copy_id' AND profile_id='44444444-4444-4444-4444-444444444444' AND person_id IS NULL));
SELECT _expect('6-3 입사예정 상태 종료(linked) · org_persons 연결', EXISTS (SELECT 1 FROM org_person_status WHERE person_id='dddddddd-0000-0000-0000-000000000001' AND ended_reason='linked')
  AND (SELECT linked_profile_id FROM org_persons WHERE id='dddddddd-0000-0000-0000-000000000001') = '44444444-4444-4444-4444-444444444444');
SELECT _expect('6-4 재호출 → no_unlinked_person (멱등)', (org_link_planned_person('newbie@cnrres.com')->>'reason') = 'no_unlinked_person');
RESET ROLE; RESET request.jwt.claim.role;

\echo === [7] 퇴사 트리거 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_set_person_status(:STAFF, NULL, 'departing', jsonb_build_object('departure_on', current_date::text));
RESET ROLE;
INSERT INTO departed_users (id, name, email) VALUES (:STAFF, '직원A', 'staff@cnrres.com');
DELETE FROM profiles WHERE id = :STAFF;
SELECT _expect('7-1 departed_users INSERT → 활성 상태 departed 종결', EXISTS (SELECT 1 FROM org_person_status WHERE profile_id=:STAFF AND ended_reason='departed') AND NOT EXISTS (SELECT 1 FROM org_person_status WHERE profile_id=:STAFF AND ended_at IS NULL));
SELECT _expect('7-2 카드 보존 (FK 없음)', EXISTS (SELECT 1 FROM org_cards WHERE profile_id=:STAFF));
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_roster_check(:'copy_id') AS rc \gset
SELECT _expect('7-3 roster_check: 유령 1(직원A) · 누락 2(고지·조직담당)', (:'rc'::jsonb->>'ghost_count')::int = 1 AND (:'rc'::jsonb->>'missing_count')::int = 2 AND (:'rc'::jsonb->'ghosts'->0->>'departed_name') = '직원A');
SELECT _expect('7-4 Division 불일치: 신입A dept=CO, CO2 조상 CO.azure_division=CO → 0건 / 직원B dept CO → 0건', (:'rc'::jsonb->>'division_mismatch_count')::int = 0);
RESET ROLE;
UPDATE profiles SET dept = 'DM' WHERE id = :STAFF2;
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('7-5 dept 바꾸면 불일치 1건', (org_roster_check(:'copy_id')->>'division_mismatch_count')::int = 1);
RESET ROLE;
