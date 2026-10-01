-- 시뮬레이션: 20261005_org_phase1.sql 적용 상태에서 케이스별 기대값 검증
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION public._expect(p_case text, p_ok boolean, p_note text DEFAULT '')
RETURNS text LANGUAGE sql AS $$ SELECT format('%s  %s %s', CASE WHEN p_ok THEN '✅' ELSE '❌' END, p_case, p_note) $$;
CREATE OR REPLACE FUNCTION public._err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
-- RPC 내부 흉내: 함수 SET 절로 org.lifecycle='on' 을 켜고 실행 (Phase 2 RPC 가 SET LOCAL 로 하는 것과 동일 효과)
CREATE OR REPLACE FUNCTION public._err_lc(p_sql text) RETURNS text LANGUAGE plpgsql SET org.lifecycle = 'on' AS $$
BEGIN EXECUTE p_sql; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

\echo === [0] 마이그레이션 결과 ===
SELECT _expect('0-1 admin_roles CHECK 에 org', EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%''org''%'));
SELECT _expect('0-2 기존 15종 보존(workboard·meeting_room)', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.admin_roles'::regclass AND contype='c') LIKE '%workboard%meeting_room%');
SELECT _expect('0-3 시스템 상태 7종', (SELECT count(*) FROM org_status_types WHERE is_system)=7);
SELECT _expect('0-4 직무 시드 99 · 별칭 보유 10', (SELECT count(*) FROM org_jobs)=99 AND (SELECT count(*) FROM org_jobs WHERE cardinality(aliases)>0)=10);
SELECT _expect('0-5 반납 템플릿 5 · 법인폰 조건부+중요', (SELECT count(*) FROM org_offboarding_templates)=5 AND EXISTS (SELECT 1 FROM org_offboarding_templates WHERE label='법인폰' AND is_conditional AND is_critical));
-- 멱등: 두 번째 실행
\i /sql/20261005_org_phase1.sql
SELECT _expect('0-6 재실행 멱등 (직무 99 유지)', (SELECT count(*) FROM org_jobs)=99);

\echo === [1] org 역할 부여 → 담당자로 전환 ===
INSERT INTO admin_roles (user_id, role) VALUES ('11111111-1111-1111-1111-111111111111','org');
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT _expect('1-1 has_admin_role(org) = true', has_admin_role('org'));

\echo === [2] 파일 생성·구조 편집 (초안) ===
INSERT INTO org_files (id, name, effective_on, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2026-10 초안','2026-10-01','11111111-1111-1111-1111-111111111111');
INSERT INTO org_units (id, file_id, name, code, sort_order) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','C&R Research','ROOT',0),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','CO Division','CO',1),
  ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','CO1','CO1',1);
UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000001' WHERE id='bbbbbbbb-0000-0000-0000-000000000002';
UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000002' WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
SELECT _expect('2-1 단위 3개 트리 구성', (SELECT count(*) FROM org_units WHERE file_id='aaaaaaaa-0000-0000-0000-000000000001' AND parent_unit_id IS NOT NULL)=2);
SELECT _expect('2-2 순환 금지 (ROOT 를 CO1 아래로)', _err($q$UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000003' WHERE id='bbbbbbbb-0000-0000-0000-000000000001'$q$) = 'ORG_UNIT_CYCLE');
SELECT _expect('2-3 자기 자신 부모 금지', _err($q$UPDATE org_units SET parent_unit_id=id WHERE id='bbbbbbbb-0000-0000-0000-000000000003'$q$) = 'ORG_UNIT_CYCLE');
SELECT _expect('2-4 자식 있는 단위 삭제 금지', _err($q$DELETE FROM org_units WHERE id='bbbbbbbb-0000-0000-0000-000000000002'$q$) = 'ORG_UNIT_HAS_CHILDREN');
-- 카드
INSERT INTO org_cards (id, file_id, unit_id, profile_id, rank_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',(SELECT id FROM org_ranks WHERE code='director'));
INSERT INTO org_cards (id, file_id, unit_id, profile_id) VALUES
  ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333');
INSERT INTO org_cards (id, file_id, unit_id, is_vacancy, display_name) VALUES
  ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003', true, '공석 CRA');
SELECT _expect('2-5 같은 사람 2장 금지 (부분 UNIQUE)', _err($q$INSERT INTO org_cards (file_id, unit_id, profile_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222')$q$) LIKE '%org_cards_file_profile%');
SELECT _expect('2-6 공석+사람 동시 금지 (CHECK)', _err($q$INSERT INTO org_cards (file_id, unit_id, profile_id, is_vacancy) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222', true)$q$) LIKE '%org_cards_vacancy_no_person%');
SELECT _expect('2-7 신원 없는 비공석 금지 (CHECK)', _err($q$INSERT INTO org_cards (file_id, unit_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')$q$) LIKE '%org_cards_identity%');
-- 직무 복수 + 대표 1개
INSERT INTO org_card_jobs (card_id, job_id, is_primary) VALUES ('cccccccc-0000-0000-0000-000000000001',(SELECT id FROM org_jobs WHERE code='CRM'), true);
INSERT INTO org_card_jobs (card_id, job_id) VALUES ('cccccccc-0000-0000-0000-000000000001',(SELECT id FROM org_jobs WHERE code='PMgr'));
SELECT _expect('2-8 카드 직무 2개(겸직)', (SELECT count(*) FROM org_card_jobs WHERE card_id='cccccccc-0000-0000-0000-000000000001')=2);
SELECT _expect('2-9 대표 직무 2개 금지', _err($q$INSERT INTO org_card_jobs (card_id, job_id, is_primary) VALUES ('cccccccc-0000-0000-0000-000000000001',(SELECT id FROM org_jobs WHERE code='PL'), true)$q$) LIKE '%org_card_jobs_one_primary%');
-- 보고선·단위장
UPDATE org_cards SET reports_to_card_id='cccccccc-0000-0000-0000-000000000001' WHERE id='cccccccc-0000-0000-0000-000000000002';
UPDATE org_units SET head_card_id='cccccccc-0000-0000-0000-000000000001' WHERE id='bbbbbbbb-0000-0000-0000-000000000003';
SELECT _expect('2-10 보고선·단위장 설정', (SELECT head_card_id FROM org_units WHERE id='bbbbbbbb-0000-0000-0000-000000000003')='cccccccc-0000-0000-0000-000000000001');
SELECT _expect('2-11 카드 있는 단위 삭제 금지', _err($q$DELETE FROM org_units WHERE id='bbbbbbbb-0000-0000-0000-000000000003'$q$) = 'ORG_UNIT_HAS_CARDS');
-- 카드→다른 단위 이동 (드래그)
UPDATE org_cards SET unit_id='bbbbbbbb-0000-0000-0000-000000000002' WHERE id='cccccccc-0000-0000-0000-000000000002';
SELECT _expect('2-12 카드 소속 이동', (SELECT unit_id FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000002')='bbbbbbbb-0000-0000-0000-000000000002');
SELECT _expect('2-13 파일 updated_by = 편집자 (touch 트리거)', (SELECT updated_by FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001')='11111111-1111-1111-1111-111111111111');

\echo === [3] 다른 파일 교차 참조 차단 ===
INSERT INTO org_files (id, name, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000002','다른 초안','11111111-1111-1111-1111-111111111111');
INSERT INTO org_units (id, file_id, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000002','X');
SELECT _expect('3-1 다른 파일 단위를 부모로 금지', _err($q$UPDATE org_units SET parent_unit_id='bbbbbbbb-0000-0000-0000-000000000009' WHERE id='bbbbbbbb-0000-0000-0000-000000000003'$q$) = 'ORG_UNIT_PARENT_OTHER_FILE');
SELECT _expect('3-2 다른 파일 단위에 카드 배치 금지', _err($q$UPDATE org_cards SET unit_id='bbbbbbbb-0000-0000-0000-000000000009' WHERE id='cccccccc-0000-0000-0000-000000000003'$q$) = 'ORG_CARD_UNIT_OTHER_FILE');
SELECT _expect('3-3 다른 파일 카드로 보고선 금지', _err($q$UPDATE org_cards SET reports_to_card_id='cccccccc-0000-0000-0000-000000000001' WHERE id='cccccccc-0000-0000-0000-000000000003' AND false; INSERT INTO org_cards (file_id, unit_id, is_vacancy, reports_to_card_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000009', true, 'cccccccc-0000-0000-0000-000000000001')$q$) = 'ORG_CARD_REPORTS_OTHER_FILE');

\echo === [4] 파일 수명주기 — 직접 status 변경 차단, RPC 플래그로만 ===
SELECT _expect('4-1 클라 직접 active 전환 차단', _err($q$UPDATE org_files SET status='active' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'ORG_FILE_STATUS_RPC_ONLY');
RESET ROLE;
-- RPC 내부를 흉내: SET LOCAL org.lifecycle='on' (Phase 2 org_activate_file 가 하는 일)
BEGIN;
SET LOCAL org.lifecycle = 'on';
UPDATE org_files SET status='active', activated_at=now() WHERE id='aaaaaaaa-0000-0000-0000-000000000001';
COMMIT;
SELECT _expect('4-2 플래그 켜면 active 전환', (SELECT status FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001')='active');
SELECT _expect('4-3 Active 2개 금지 (부분 UNIQUE)', _err_lc($q$UPDATE org_files SET status='active', effective_on='2026-11-01' WHERE id='aaaaaaaa-0000-0000-0000-000000000002'$q$) LIKE '%org_files_one_active%');
SELECT _expect('4-4 active 는 effective_on 필수 (CHECK)', _err_lc($q$UPDATE org_files SET status='active' WHERE id='aaaaaaaa-0000-0000-0000-000000000002'$q$) LIKE '%org_files_active_needs_effective%');
SELECT _expect('4-4b 플래그 없이 postgres 도 status 변경 불가', _err($q$UPDATE org_files SET status='draft' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'ORG_FILE_STATUS_RPC_ONLY');
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT _expect('4-5 Active 파일 구조 편집 차단 (단위)', _err($q$UPDATE org_units SET name='변경' WHERE id='bbbbbbbb-0000-0000-0000-000000000003'$q$) IN ('ORG_FILE_NOT_EDITABLE') OR (SELECT name FROM org_units WHERE id='bbbbbbbb-0000-0000-0000-000000000003')='CO1');
SELECT _expect('4-6 Active 파일 카드 추가 차단 (RLS 또는 트리거)', _err($q$INSERT INTO org_cards (file_id, unit_id, is_vacancy) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000003', true)$q$) <> 'OK');
SELECT _expect('4-7 Active 파일 삭제 차단 (RLS 0행)', EXISTS (SELECT 1 FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001') AND _err($q$DELETE FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'OK' AND EXISTS (SELECT 1 FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001'));
SELECT _expect('4-8 Active 파일 잠금·메모는 허용', _err($q$UPDATE org_files SET memo='확정본', lock_by='11111111-1111-1111-1111-111111111111', lock_at=now() WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'OK');
SELECT _expect('4-9 Active 적용일 변경 차단', _err($q$UPDATE org_files SET effective_on='2026-12-01' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'ORG_FILE_ACTIVE_READONLY');
RESET ROLE;
BEGIN; SET LOCAL org.lifecycle='on'; UPDATE org_files SET status='archived', archived_at=now() WHERE id='aaaaaaaa-0000-0000-0000-000000000001'; COMMIT;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT _expect('4-10 archived 수정 차단 (RLS 0행 · memo 유지)', _err($q$UPDATE org_files SET memo='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'OK' AND (SELECT memo FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001')='확정본');
RESET ROLE;
SELECT _expect('4-10b archived 수정 차단 (postgres 는 트리거)', _err($q$UPDATE org_files SET memo='x' WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'ORG_FILE_ARCHIVED_READONLY');
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
RESET ROLE;
SELECT _expect('4-11 archived 삭제 차단 (postgres 도)', _err($q$DELETE FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000001'$q$) = 'ORG_FILE_NOT_DELETABLE');

\echo === [5] 초안 삭제 → CASCADE (단위·카드 가드가 CASCADE 를 막지 않는가) ===
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
INSERT INTO org_cards (file_id, unit_id, is_vacancy) VALUES ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000009', true);
SELECT _expect('5-0 삭제 전 파일·단위·카드 존재', EXISTS (SELECT 1 FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000002') AND EXISTS (SELECT 1 FROM org_cards WHERE file_id='aaaaaaaa-0000-0000-0000-000000000002'));
SELECT _err($q$DELETE FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000002'$q$) AS delete_result;
SELECT _expect('5-1 초안 삭제 성공 (단위·카드 CASCADE)', NOT EXISTS (SELECT 1 FROM org_files WHERE id='aaaaaaaa-0000-0000-0000-000000000002') AND NOT EXISTS (SELECT 1 FROM org_units WHERE file_id='aaaaaaaa-0000-0000-0000-000000000002') AND NOT EXISTS (SELECT 1 FROM org_cards WHERE file_id='aaaaaaaa-0000-0000-0000-000000000002'));
RESET ROLE;

\echo === [6] 권한 게이트 ===
SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';   -- 일반 직원
SELECT _expect('6-1 일반 직원 파일 0행', (SELECT count(*) FROM org_files)=0);
SELECT _expect('6-2 일반 직원 카드 0행', (SELECT count(*) FROM org_cards)=0);
SELECT _expect('6-3 일반 직원 파일 생성 차단', _err($q$INSERT INTO org_files (name, created_by) VALUES ('x','22222222-2222-2222-2222-222222222222')$q$) <> 'OK');
SET request.jwt.claim.sub = '0120852b-faae-4903-9515-c9c28ecaf76b';  -- super
SELECT _expect('6-4 super 는 org 없이도 열람', (SELECT count(*) FROM org_files)>=1);
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT _expect('6-5 org 담당자: 상태 테이블 직접 INSERT 차단 (RPC 전용)', _err($q$INSERT INTO org_person_status (profile_id, status_code) VALUES ('22222222-2222-2222-2222-222222222222','leave')$q$) <> 'OK');
SELECT _expect('6-6 org 담당자: 로그 직접 INSERT 차단', _err($q$INSERT INTO org_change_log (action,target_table,target_id) VALUES ('insert','x','1')$q$) <> 'OK');
SELECT _expect('6-7 시스템 상태코드 삭제 차단', _err($q$DELETE FROM org_status_types WHERE code='leave'$q$) = 'ORG_STATUS_SYSTEM_PROTECTED');
SELECT _expect('6-8 사용자 정의 상태코드 추가·삭제 가능', _err($q$INSERT INTO org_status_types (code,label,category) VALUES ('sabbatical','안식휴직','leave'); DELETE FROM org_status_types WHERE code='sabbatical'$q$) = 'OK');
RESET ROLE;

\echo === [7] 변경 로그 ===
SELECT _expect('7-1 단위·카드·직무 insert 기록', (SELECT count(*) FROM org_change_log WHERE action='insert' AND target_table IN ('org_units','org_cards','org_card_jobs'))>=7);
SELECT _expect('7-2 카드 이동 update 기록(before/after unit_id 다름)', EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_cards' AND action='update' AND before->>'unit_id' <> after->>'unit_id'));
SELECT _expect('7-3 actor = 편집자', EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_cards' AND actor='11111111-1111-1111-1111-111111111111'));
SELECT _expect('7-4 status 전환 기록 (lifecycle)', EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_files' AND before->>'status'='draft' AND after->>'status'='active'));
SELECT _expect('7-5 잠금만 바뀐 update 는 미기록', NOT EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_files' AND action='update' AND (before - ARRAY['updated_at','updated_by','lock_by','lock_at']) = (after - ARRAY['updated_at','updated_by','lock_by','lock_at'])));
SELECT _expect('7-6 card_jobs 로그에 file_id 채움', EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_card_jobs' AND file_id='aaaaaaaa-0000-0000-0000-000000000001'));
SELECT _expect('7-7 파일 삭제 시 로그 보존(FK 없음)', EXISTS (SELECT 1 FROM org_change_log WHERE file_id='aaaaaaaa-0000-0000-0000-000000000002'));
