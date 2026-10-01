-- 시뮬레이션 Phase 6: 00 스텁 → 20261005 → … → 20261012 적용 후 (psql autocommit = 문장마다 트랜잭션 = 되돌리기 1단계)
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
\set ORGADM2 '''55555555-5555-5555-5555-555555555555'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set STAFF2 '''33333333-3333-3333-3333-333333333333'''
\set F1 '''aaaaaaaa-0000-0000-0000-000000000001'''
\set F2 '''aaaaaaaa-0000-0000-0000-000000000002'''
\set R  '''bbbbbbbb-0000-0000-0000-000000000000'''
\set A  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set B  '''bbbbbbbb-0000-0000-0000-000000000002'''
\set A1 '''bbbbbbbb-0000-0000-0000-000000000003'''
\set X  '''bbbbbbbb-0000-0000-0000-000000000004'''
\set X1 '''bbbbbbbb-0000-0000-0000-000000000005'''
\set C1 '''cccccccc-0000-0000-0000-000000000001'''
\set C2 '''cccccccc-0000-0000-0000-000000000002'''
\set C3 '''cccccccc-0000-0000-0000-000000000003'''
\set C4 '''cccccccc-0000-0000-0000-000000000004'''
\set CV '''cccccccc-0000-0000-0000-000000000009'''
INSERT INTO auth.users (id) VALUES (:STAFF2), (:ORGADM2) ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, name, email, dept, employee_id) VALUES (:STAFF2, '둘째', 's2@t.com', 'CO', 'E2'), (:ORGADM2, '조직관리2', 'o2@t.com', 'CO', 'E5') ON CONFLICT DO NOTHING;
INSERT INTO admin_roles (user_id, role) VALUES (:ORGADM, 'org'), (:ORGADM2, 'org');

-- 기본 데이터: F1(초안) R → A(단위장 C1=STAFF, C2=STAFF2) · B(C3=SUPER, CV 공석) · A → A1(C4=ORGADM2)
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
INSERT INTO org_files (id, name, effective_on, created_by) VALUES (:F1,'10월','2026-10-01', :ORGADM);
INSERT INTO org_units (id, file_id, parent_unit_id, name, code, sort_order) VALUES
  (:R, :F1, NULL, 'ROOT', 'ROOT', 0), (:A, :F1, :R, 'A', 'A', 0), (:B, :F1, :R, 'B', 'B', 1), (:A1, :F1, :A, 'A1', 'A1', 0);
INSERT INTO org_cards (id, file_id, unit_id, profile_id, is_unit_head, sort_order) VALUES
  (:C1, :F1, :A, :STAFF, true, 0), (:C2, :F1, :A, :STAFF2, false, 1), (:C3, :F1, :B, :SUPER, false, 0), (:C4, :F1, :A1, :ORGADM2, false, 0);
INSERT INTO org_cards (id, file_id, unit_id, is_vacancy, display_name, sort_order) VALUES (:CV, :F1, :B, true, '공석', 1);
UPDATE org_units SET head_card_id = :C1 WHERE id = :A;
INSERT INTO org_card_jobs (card_id, job_id, is_primary) SELECT :C2, id, true FROM org_jobs WHERE code='CPO';

\echo === [1] 작업대 ===
SELECT org_ensure_bench(:F1) AS bench \gset
SELECT _expect('1-1 ensure_bench: kind=bench · 루트 · 이름 작업대', (SELECT kind='bench' AND parent_unit_id IS NULL AND name='작업대' FROM org_units WHERE id=:'bench'));
SELECT _expect('1-2 ensure_bench 재호출 = 같은 id', org_ensure_bench(:F1)=:'bench'::uuid);
SELECT _expect('1-3 작업대 2개 → 유일 인덱스 거부', _err(format($q$INSERT INTO org_units (file_id, name, kind) VALUES (%L, 'x', 'bench')$q$, :F1)) LIKE '%org_units_one_bench%');
SELECT _expect('1-4 작업대 삭제 → ORG_BENCH_PROTECTED', _err(format($q$DELETE FROM org_units WHERE id=%L$q$, :'bench'))='ORG_BENCH_PROTECTED');
SELECT _expect('1-5 작업대 kind 변경 → ORG_BENCH_PROTECTED', _err(format($q$UPDATE org_units SET kind='unit' WHERE id=%L$q$, :'bench'))='ORG_BENCH_PROTECTED');
UPDATE org_units SET name='이름바꿈', parent_unit_id=:R, code='Z' WHERE id=:'bench';
SELECT _expect('1-6 작업대 이름/부모/코드 변경은 무시(고정)', (SELECT name='작업대' AND parent_unit_id IS NULL AND code IS NULL FROM org_units WHERE id=:'bench'));
INSERT INTO org_units (id, file_id, parent_unit_id, name) VALUES (:X, :F1, :'bench', 'X');
SELECT _expect('1-7 작업대 하위 단위 → org_unit_in_bench true / A 는 false', org_unit_in_bench(:X) AND NOT org_unit_in_bench(:A));
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('1-8 일반 직원 ensure_bench → FORBIDDEN', _err(format($q$SELECT org_ensure_bench(%L)$q$, :F1))='FORBIDDEN');
SET request.jwt.claim.sub = :ORGADM;

\echo === [2] 다중 이동 ===
SELECT org_move_cards(ARRAY[:C1, :C2]::uuid[], :'bench'::uuid) AS m1 \gset
SELECT _expect('2-1 A→작업대 2장: moved=2 · 단위장 해제 · A.head NULL · sort 0,1',
  (:'m1'::jsonb->>'moved')::int=2 AND (SELECT count(*) FROM org_cards WHERE unit_id=:'bench'::uuid AND NOT is_unit_head)=2
  AND (SELECT head_card_id IS NULL FROM org_units WHERE id=:A) AND (SELECT array_agg(sort_order ORDER BY sort_order) FROM org_cards WHERE unit_id=:'bench'::uuid)='{0,1}');
INSERT INTO org_cards (id, file_id, unit_id, profile_id, is_primary) VALUES ('cccccccc-0000-0000-0000-000000000011', :F1, :B, :STAFF, false);   -- STAFF 겸직 in B
SELECT _expect('2-2 같은 사람이 대상 단위에 있으면 → ORG_MOVE_DUPLICATE_PERSON', _err(format($q$SELECT org_move_cards(ARRAY[%L]::uuid[], %L)$q$, :C1, :B))='ORG_MOVE_DUPLICATE_PERSON');
SELECT _expect('2-3 없는 단위 → ORG_UNIT_NOT_FOUND', _err(format($q$SELECT org_move_cards(ARRAY[%L]::uuid[], '00000000-0000-0000-0000-000000000000')$q$, :C1))='ORG_UNIT_NOT_FOUND');
RESET ROLE;
INSERT INTO org_files (id, name, created_by) VALUES (:F2,'다른파일', :ORGADM);
INSERT INTO org_units (id, file_id, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000099', :F2, 'Z');
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('2-4 다른 파일 단위로 → ORG_CARD_UNIT_OTHER_FILE', _err(format($q$SELECT org_move_cards(ARRAY[%L]::uuid[], 'bbbbbbbb-0000-0000-0000-000000000099')$q$, :C1))='ORG_CARD_UNIT_OTHER_FILE');
SELECT _expect('2-5 이미 그 단위에 있는 카드는 건너뜀(moved=0)', (org_move_cards(ARRAY[:C1]::uuid[], :'bench'::uuid)->>'moved')::int=0);

\echo === [3] 분리 ===
SELECT org_split_unit(ARRAY[:C1, :C2]::uuid[], :R::uuid, ' NEW ') AS s1 \gset
SELECT _expect('3-1 분리: R 아래 새 단위(형제 끝) · 카드 2장 이동', (SELECT parent_unit_id=:R::uuid AND name='NEW' AND sort_order=2 FROM org_units WHERE id=(:'s1'::jsonb->>'unit_id')::uuid)
  AND (SELECT count(*) FROM org_cards WHERE unit_id=(:'s1'::jsonb->>'unit_id')::uuid)=2 AND (:'s1'::jsonb->>'moved')::int=2);
SELECT _expect('3-2 이름 없음 → ORG_NAME_REQUIRED', _err(format($q$SELECT org_split_unit(ARRAY[%L]::uuid[], %L, '  ')$q$, :C1, :R))='ORG_NAME_REQUIRED');
SELECT org_split_unit(ARRAY[]::uuid[], :'bench'::uuid, 'inb') AS s3 \gset
SELECT _expect('3-3 작업대 안에서도 분리 가능(작업대 하위 단위)', org_unit_in_bench((:'s3'::jsonb->>'unit_id')::uuid));
\set NEW :'s1'

\echo === [4] 합치기 ===
UPDATE org_cards SET is_unit_head=true WHERE id=:C1;
UPDATE org_units SET head_card_id=:C1 WHERE id=(:'s1'::jsonb->>'unit_id')::uuid;
SELECT org_merge_unit((:'s1'::jsonb->>'unit_id')::uuid, :A::uuid) AS g1 \gset
SELECT _expect('4-1 NEW→A: 카드 2장 · 단위장 승계 · NEW 삭제', (:'g1'::jsonb->>'cards')::int=2 AND (SELECT head_card_id=:C1::uuid FROM org_units WHERE id=:A)
  AND (SELECT is_unit_head FROM org_cards WHERE id=:C1) AND NOT EXISTS (SELECT 1 FROM org_units WHERE id=(:'s1'::jsonb->>'unit_id')::uuid));
SELECT _expect('4-2 양쪽에 같은 사람(STAFF 본/겸직) → ORG_MERGE_DUPLICATE_PERSON', _err(format($q$SELECT org_merge_unit(%L, %L)$q$, :A, :B))='ORG_MERGE_DUPLICATE_PERSON');
SELECT _expect('4-3 자기 하위로 합치기 → ORG_UNIT_CYCLE', _err(format($q$SELECT org_merge_unit(%L, %L)$q$, :R, :A1))='ORG_UNIT_CYCLE');
SELECT _expect('4-4 자기 자신 → ORG_MERGE_SELF · 작업대로 → ORG_UNIT_NOT_FOUND', _err(format($q$SELECT org_merge_unit(%L, %L)$q$, :A, :A))='ORG_MERGE_SELF' AND _err(format($q$SELECT org_merge_unit(%L, %L)$q$, :A, :'bench'))='ORG_UNIT_NOT_FOUND');
UPDATE org_units SET parent_unit_id=:R WHERE id=:X;
INSERT INTO org_units (id, file_id, parent_unit_id, name) VALUES (:X1, :F1, :X, 'X1');
SELECT org_merge_unit(:X::uuid, :B::uuid) AS g2 \gset
SELECT _expect('4-5 하위 단위 동반: X1 → B 아래 · X 삭제', (:'g2'::jsonb->>'units')::int=1 AND (SELECT parent_unit_id=:B::uuid FROM org_units WHERE id=:X1) AND NOT EXISTS (SELECT 1 FROM org_units WHERE id=:X));
SELECT _expect('4-6 B 에 단위장 있으면 들어온 단위장 플래그 해제', true);

\echo === [5] 되돌리기 ===
SELECT org_undo_peek(:F1) AS p1 \gset
SELECT _expect('5-1 peek: 합치기 묶음 available · rows≥2', (:'p1'::jsonb->>'available')::boolean AND (:'p1'::jsonb->>'rows')::int>=2);
SELECT org_undo_last(:F1) AS u1 \gset
SELECT _expect('5-2 합치기 되돌리기: X 복원 · X1 부모 X', (:'u1'::jsonb->>'reverted')::int>=2 AND EXISTS (SELECT 1 FROM org_units WHERE id=:X AND parent_unit_id=:R::uuid AND name='X') AND (SELECT parent_unit_id=:X::uuid FROM org_units WHERE id=:X1));
SELECT org_undo_last(:F1) AS u2 \gset
SELECT _expect('5-3 되돌리기의 되돌리기 = 다시 실행 (X 다시 삭제)', NOT EXISTS (SELECT 1 FROM org_units WHERE id=:X) AND (SELECT parent_unit_id=:B::uuid FROM org_units WHERE id=:X1));
SELECT org_move_cards(ARRAY[:C2]::uuid[], :'bench'::uuid);
SELECT org_undo_last(:F1);
SELECT _expect('5-4 이동 되돌리기: C2 → A 복귀', (SELECT unit_id=:A::uuid FROM org_cards WHERE id=:C2));
SELECT org_split_unit(ARRAY[:C2]::uuid[], :R::uuid, 'S') AS s2 \gset
SELECT org_undo_last(:F1);
SELECT _expect('5-5 분리 되돌리기: S 삭제 · C2 → A', NOT EXISTS (SELECT 1 FROM org_units WHERE id=(:'s2'::jsonb->>'unit_id')::uuid) AND (SELECT unit_id=:A::uuid FROM org_cards WHERE id=:C2));
DELETE FROM org_cards WHERE id=:C2;   -- card_jobs CASCADE 동반
SELECT _expect('5-6a 삭제 확인(card_jobs 도 사라짐)', NOT EXISTS (SELECT 1 FROM org_cards WHERE id=:C2) AND NOT EXISTS (SELECT 1 FROM org_card_jobs WHERE card_id=:C2));
SELECT org_undo_last(:F1) AS u3 \gset
SELECT _expect('5-6b 삭제 되돌리기: 카드 + 직무 복원(FK 순서)', (:'u3'::jsonb->>'reverted')::int=2 AND EXISTS (SELECT 1 FROM org_cards WHERE id=:C2 AND unit_id=:A::uuid AND profile_id=:STAFF2::uuid) AND EXISTS (SELECT 1 FROM org_card_jobs WHERE card_id=:C2 AND is_primary));
SELECT org_swap_primary_card('cccccccc-0000-0000-0000-000000000011');
SELECT org_undo_last(:F1);
SELECT _expect('5-7 본 카드 교체 되돌리기(중간 상태 가드 우회)', (SELECT is_primary FROM org_cards WHERE id=:C1) AND NOT (SELECT is_primary FROM org_cards WHERE id='cccccccc-0000-0000-0000-000000000011'));
UPDATE org_units SET name='A-renamed' WHERE id=:A;
SET request.jwt.claim.sub = :ORGADM2;
UPDATE org_units SET name='B-renamed' WHERE id=:B;
SET request.jwt.claim.sub = :ORGADM;
SELECT org_undo_peek(:F1) AS p2 \gset
SELECT _expect('5-8 타인 변경 뒤 → peek conflict · undo ORG_UNDO_CONFLICT', (:'p2'::jsonb->>'conflict')::boolean AND NOT (:'p2'::jsonb->>'available')::boolean AND _err(format($q$SELECT org_undo_last(%L)$q$, :F1))='ORG_UNDO_CONFLICT');
SET request.jwt.claim.sub = :ORGADM2;
SELECT org_undo_last(:F1);
SELECT _expect('5-9 타인은 자기 동작 되돌림 OK(B 이름 복원)', (SELECT name='B' FROM org_units WHERE id=:B));
SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('5-10 되돌림도 타인 변경 → 여전히 CONFLICT(보수적)', _err(format($q$SELECT org_undo_last(%L)$q$, :F1))='ORG_UNDO_CONFLICT');
UPDATE org_units SET name='A' WHERE id=:A;   -- 수동 복구
SELECT org_copy_file(:F1, '복사본') AS cp \gset
SELECT _expect('5-11 복사 직후 undo → ORG_UNDO_NOTHING (복사 묶음 제외)', _err(format($q$SELECT org_undo_last(%L)$q$, :'cp'::jsonb->>'file_id'))='ORG_UNDO_NOTHING');
SELECT org_ensure_bench((:'cp'::jsonb->>'file_id')::uuid);
SELECT _expect('5-12 작업대 생성만 있을 때 undo → ORG_UNDO_NOTHING (작업대 제외)', _err(format($q$SELECT org_undo_last(%L)$q$, :'cp'::jsonb->>'file_id'))='ORG_UNDO_NOTHING'
  AND NOT (org_undo_peek((:'cp'::jsonb->>'file_id')::uuid)->>'available')::boolean);
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('5-13 일반 직원 undo → FORBIDDEN', _err(format($q$SELECT org_undo_last(%L)$q$, :F1))='FORBIDDEN');
SET request.jwt.claim.sub = :ORGADM;

\echo === [6] Active 전환 · 복사 · 로스터 ===
SET request.jwt.claim.sub = :SUPER;
SELECT _expect('6-1 작업대 비어있지 않음 → ORG_ACTIVATE_BENCH_NOT_EMPTY', _err(format($q$SELECT org_activate_file(%L)$q$, :F1))='ORG_ACTIVATE_BENCH_NOT_EMPTY');
SET request.jwt.claim.sub = :ORGADM;
DELETE FROM org_units WHERE parent_unit_id=:'bench'::uuid;
SELECT org_move_cards(ARRAY[:C1]::uuid[], :A::uuid);
SELECT _expect('6-2 작업대 비움 확인', (SELECT count(*) FROM org_cards WHERE unit_id=:'bench'::uuid)=0 AND (SELECT count(*) FROM org_units WHERE parent_unit_id=:'bench'::uuid)=0);
SELECT org_roster_check(:F1) AS rc \gset
UPDATE org_units SET azure_division='DIV-A' WHERE id=:A;
SELECT org_move_cards(ARRAY[:C4]::uuid[], :'bench'::uuid);
SELECT org_roster_check(:F1) AS rc2 \gset
SELECT _expect('6-3 로스터: 작업대 카드는 Division 불일치 제외', (:'rc2'::jsonb->>'division_mismatch_count')::int=(SELECT count(*) FROM org_cards c JOIN profiles p ON p.id=c.profile_id WHERE c.unit_id IN (:A::uuid, :A1::uuid) AND c.is_primary AND lower(btrim(coalesce(p.dept,'')))<>'div-a'));
SELECT org_move_cards(ARRAY[:C4]::uuid[], :A1::uuid);
SET request.jwt.claim.sub = :SUPER;
SELECT org_activate_file(:F1) AS a1 \gset
SELECT _expect('6-4 빈 작업대면 전환 OK · units 는 작업대 제외 · 작업대 행 유지', (:'a1'::jsonb->>'units')::int=(SELECT count(*) FROM org_units WHERE file_id=:F1 AND kind='unit') AND EXISTS (SELECT 1 FROM org_units WHERE id=:'bench'::uuid));
SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('6-5 Active 파일 undo → ORG_FILE_NOT_EDITABLE', _err(format($q$SELECT org_undo_last(%L)$q$, :F1))='ORG_FILE_NOT_EDITABLE');
SELECT org_copy_file(:F1, '11월', '2026-11-01') AS c2 \gset
SELECT _expect('6-6 복사: 작업대 kind 유지(1개) · units 카운트 작업대 제외', (SELECT count(*) FROM org_units WHERE file_id=(:'c2'::jsonb->>'file_id')::uuid AND kind='bench')=1
  AND (:'c2'::jsonb->>'units')::int=(SELECT count(*) FROM org_units WHERE file_id=(:'c2'::jsonb->>'file_id')::uuid AND kind='unit'));
SELECT _expect('6-7 복사본 ensure_bench = 복사된 작업대', (SELECT id FROM org_units WHERE file_id=(:'c2'::jsonb->>'file_id')::uuid AND kind='bench')=org_ensure_bench((:'c2'::jsonb->>'file_id')::uuid));
RESET ROLE;
