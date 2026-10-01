-- 시뮬레이션 Phase 7 layout: orgsim6(Phase 6 시뮬 완료 상태) 에 20261013 적용 후
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set F1 '''aaaaaaaa-0000-0000-0000-000000000001'''
\set A  '''bbbbbbbb-0000-0000-0000-000000000001'''
\set B  '''bbbbbbbb-0000-0000-0000-000000000002'''
\echo === [7] 배치 저장 · 복사 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('7-1 Active 파일(F1) 저장 → ORG_FILE_NOT_EDITABLE', _err(format($q$SELECT org_save_layout(%L, '[]'::jsonb)$q$, :F1))='ORG_FILE_NOT_EDITABLE');
SELECT org_copy_file(:F1, 'p7') AS cp \gset
\set F7 :'cp'
SELECT id AS ua FROM org_units WHERE file_id=(:'cp'::jsonb->>'file_id')::uuid AND name='A' \gset
SELECT id AS ub FROM org_units WHERE file_id=(:'cp'::jsonb->>'file_id')::uuid AND name='B' \gset
SELECT org_save_layout((:'cp'::jsonb->>'file_id')::uuid, format('[{"unit_id":"%s","x":10,"y":20},{"unit_id":"%s","x":30.5,"y":40},{"unit_id":"%s","x":1,"y":1}]', :'ua', :'ub', :A)::jsonb) AS n1 \gset
SELECT _expect('7-2 초안 저장 2건 + 다른 파일 단위는 무시', :n1=2 AND (SELECT count(*) FROM org_unit_layout WHERE file_id=(:'cp'::jsonb->>'file_id')::uuid)=2);
SELECT org_save_layout((:'cp'::jsonb->>'file_id')::uuid, format('[{"unit_id":"%s","x":99,"y":98}]', :'ua')::jsonb) AS n2 \gset
SELECT _expect('7-3 upsert 갱신', :n2=1 AND (SELECT x=99 AND y=98 FROM org_unit_layout WHERE unit_id=:'ua'));
SELECT _expect('7-4 읽기: org 역할 SELECT OK', (SELECT count(*) FROM org_unit_layout)>=2);
SELECT _expect('7-5 직접 INSERT 는 RLS 거부', _err(format($q$INSERT INTO org_unit_layout (unit_id, file_id, x, y) VALUES (%L, %L, 0, 0)$q$, :'ub', :'cp'::jsonb->>'file_id')) LIKE '%permission denied%' OR _err(format($q$INSERT INTO org_unit_layout (unit_id, file_id, x, y) VALUES (%L, %L, 0, 0)$q$, :'ub', :'cp'::jsonb->>'file_id')) LIKE '%row-level security%');
SELECT org_copy_file((:'cp'::jsonb->>'file_id')::uuid, 'p7-copy') AS cp2 \gset
SELECT _expect('7-6 복사 시 배치 함께 복사(2건, 새 unit id 로)', (SELECT count(*) FROM org_unit_layout WHERE file_id=(:'cp2'::jsonb->>'file_id')::uuid)=2
  AND (SELECT x=99 FROM org_unit_layout l JOIN org_units u ON u.id=l.unit_id WHERE l.file_id=(:'cp2'::jsonb->>'file_id')::uuid AND u.name='A'));
INSERT INTO org_units (id, file_id, parent_unit_id, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000077', (:'cp'::jsonb->>'file_id')::uuid, :'ua', 'tmp');
SELECT org_save_layout((:'cp'::jsonb->>'file_id')::uuid, '[{"unit_id":"bbbbbbbb-0000-0000-0000-000000000077","x":5,"y":5}]'::jsonb);
DELETE FROM org_units WHERE id='bbbbbbbb-0000-0000-0000-000000000077';
SELECT _expect('7-7 단위 삭제 시 배치 CASCADE', NOT EXISTS (SELECT 1 FROM org_unit_layout WHERE unit_id='bbbbbbbb-0000-0000-0000-000000000077'));
SELECT _expect('7-8 배치 저장은 변경 로그에 없음 → undo 대상 아님', NOT EXISTS (SELECT 1 FROM org_change_log WHERE target_table='org_unit_layout'));
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('7-9 일반 직원 → FORBIDDEN', _err(format($q$SELECT org_save_layout(%L, '[]'::jsonb)$q$, :'cp'::jsonb->>'file_id'))='FORBIDDEN');
SELECT _expect('7-10 일반 직원 SELECT 0행', (SELECT count(*) FROM org_unit_layout)=0);
RESET ROLE;
