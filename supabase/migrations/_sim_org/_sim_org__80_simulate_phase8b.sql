-- 시뮬레이션 Phase 8-B: orgsim6(8-A 시뮬 완료 상태) 에 20261015 적용 후 (psql autocommit = 문장마다 트랜잭션 = 되돌리기 1단계)
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set F1 '''aaaaaaaa-0000-0000-0000-000000000001'''
\set FA '''bbbbbbbb-0000-0000-0000-000000000001'''
\set FB '''bbbbbbbb-0000-0000-0000-000000000002'''
\set FA1 '''bbbbbbbb-0000-0000-0000-000000000003'''
\set FX1 '''bbbbbbbb-0000-0000-0000-000000000005'''
\set FROOT '''bbbbbbbb-0000-0000-0000-000000000000'''
\echo === [8-B] 승계 바인드 · 자동 매칭 · 묶음 저장 · 복사 · 되돌리기 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT id AS cpo FROM org_jobs WHERE code='CPO' \gset

-- 복사 = 자동 승계
SELECT org_copy_file(:F1, 'p8b-copy') AS cp \gset
SELECT (:'cp'::jsonb->>'file_id') AS fc \gset
SELECT _expect('8B-1 복사본 단위 5개 모두 원본 승계(prev_unit_id) · 작업대는 NULL',
  (SELECT count(*) FROM org_units n JOIN org_units o ON o.id = n.prev_unit_id WHERE n.file_id=:'fc' AND o.file_id=:F1 AND o.name=n.name)=5
  AND (SELECT prev_unit_id IS NULL FROM org_units WHERE file_id=:'fc' AND kind='bench'));

-- 빈 파일에서 구조만 만든 경우 → 자동 매칭
INSERT INTO org_files (id, name, status, created_by, updated_by) VALUES ('aaaaaaaa-0000-0000-0000-00000000008b', 'p8b-new', 'draft', :ORGADM, :ORGADM);
\set FN '''aaaaaaaa-0000-0000-0000-00000000008b'''
INSERT INTO org_units (id, file_id, parent_unit_id, name, code, sort_order) VALUES
  ('bbbbbbbb-0000-0000-0000-00000000008b', :FN, NULL, 'ROOT', 'ROOT', 0),
  ('bbbbbbbb-0000-0000-0000-00000000018b', :FN, 'bbbbbbbb-0000-0000-0000-00000000008b', 'A', NULL, 0),
  ('bbbbbbbb-0000-0000-0000-00000000028b', :FN, 'bbbbbbbb-0000-0000-0000-00000000018b', 'A1', NULL, 0),
  ('bbbbbbbb-0000-0000-0000-00000000038b', :FN, 'bbbbbbbb-0000-0000-0000-00000000008b', 'B2', NULL, 1),
  ('bbbbbbbb-0000-0000-0000-00000000048b', :FN, 'bbbbbbbb-0000-0000-0000-00000000038b', 'X1', NULL, 0);
\set NROOT '''bbbbbbbb-0000-0000-0000-00000000008b'''
\set NA '''bbbbbbbb-0000-0000-0000-00000000018b'''
\set NA1 '''bbbbbbbb-0000-0000-0000-00000000028b'''
\set NB2 '''bbbbbbbb-0000-0000-0000-00000000038b'''
\set NX1 '''bbbbbbbb-0000-0000-0000-00000000048b'''
SELECT org_bind_suggest(:FN, :F1) AS sg \gset
SELECT _expect('8B-2 제안: ROOT=code · A=path · A1=path · X1=name(유일) · B2=없음',
  (SELECT jsonb_object_agg(e->>'unit_id', coalesce(e->>'method','-')) FROM jsonb_array_elements(:'sg'::jsonb) e)
  = jsonb_build_object(:NROOT::text, 'code', :NA::text, 'path', :NA1::text, 'path', :NX1::text, 'name', :NB2::text, '-'), :'sg');
SELECT _expect('8B-3 제안 prev 가 기준 파일의 같은 이름 단위', (SELECT bool_and((SELECT name FROM org_units WHERE id=(e->>'prev_unit_id')::uuid) = (SELECT name FROM org_units WHERE id=(e->>'unit_id')::uuid)) FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'prev_unit_id' IS NOT NULL));
SELECT _expect('8B-4 단위장 포지션 제안 = 기준 단위장 카드 대표 직무(A → CPO 없음: 단위장 C1 직무 없음, A1 없음)', (SELECT count(*) FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'suggested_head_job_id' IS NOT NULL) = 0);
SELECT _expect('8B-4b Azure 부서 제안: 빈 초안은 기준 단위 하위 인원 최빈값(A 하위 포함 → CO 3명)', (SELECT e->>'suggested_division'='CO' AND (e->>'division_n')::int=3 FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'unit_id'=:NA));
SELECT _expect('8B-5 같은 파일을 기준으로 → ORG_BIND_SAME_FILE', _err(format('SELECT org_bind_suggest(%L, %L)', :FN, :FN))='ORG_BIND_SAME_FILE');

-- 묶음 저장
SELECT org_bind_apply(:FN, format('[{"unit_id":"%s","prev_unit_id":"%s","azure_division":"CO","head_job_id":"%s","checked":true},{"unit_id":"%s","prev_unit_id":"%s"}]', :NA, :FA, :'cpo', :NA1, :FA1)::jsonb) AS ap \gset
SELECT _expect('8B-6 적용 2건: prev·Azure·포지션·확인', (:'ap'::jsonb->>'updated')::int=2
  AND (SELECT prev_unit_id=:FA AND azure_division='CO' AND head_job_id=:'cpo' AND bind_checked_at IS NOT NULL FROM org_units WHERE id=:NA)
  AND (SELECT prev_unit_id=:FA1 FROM org_units WHERE id=:NA1));
SELECT org_bind_apply(:FN, format('[{"unit_id":"%s","prev_unit_id":"%s","azure_division":"CO"}]', :NA, :FA)::jsonb) AS ap2 \gset
SELECT _expect('8B-7 같은 값 재적용 = 0건(로그 없음)', (:'ap2'::jsonb->>'updated')::int=0);
SELECT _expect('8B-8 같은 파일 단위 승계 거부', _err(format('SELECT org_bind_apply(%L, %L)', :FN, format('[{"unit_id":"%s","prev_unit_id":"%s"}]', :NA, :NB2)))='ORG_BIND_SAME_FILE');
SELECT _expect('8B-9 타 파일 단위를 unit_id 로 → ORG_UNIT_NOT_FOUND', _err(format('SELECT org_bind_apply(%L, %L)', :FN, format('[{"unit_id":"%s","checked":true}]', :FA)))='ORG_UNIT_NOT_FOUND');
SELECT org_bind_apply(:FN, format('[{"unit_id":"%s","checked":false,"azure_division":"  "}]', :NA)::jsonb);
SELECT _expect('8B-10 확인 해제 + 빈 Azure → NULL', (SELECT bind_checked_at IS NULL AND azure_division IS NULL FROM org_units WHERE id=:NA));
SELECT org_undo_last(:FN) AS u1 \gset
SELECT _expect('8B-11 되돌리기 1단계 → 확인·Azure 복원', (SELECT bind_checked_at IS NOT NULL AND azure_division='CO' FROM org_units WHERE id=:NA), '(' || (:'u1'::jsonb->>'reverted') || '건)');
SELECT org_bind_apply(:FN, format('[{"unit_id":"%s","prev_unit_id":null}]', :NA1)::jsonb);
SELECT _expect('8B-12 prev null 로 해제', (SELECT prev_unit_id IS NULL FROM org_units WHERE id=:NA1));

-- 가드 · 직접 UPDATE
UPDATE org_units SET prev_unit_id=:FX1 WHERE id=:NX1;
SELECT _expect('8B-13 직접 UPDATE 로도 승계 가능(다른 파일)', (SELECT prev_unit_id=:FX1 FROM org_units WHERE id=:NX1));
SELECT _expect('8B-14 직접 UPDATE 같은 파일 → ORG_BIND_SAME_FILE', _err(format('UPDATE org_units SET prev_unit_id=%L WHERE id=%L', :NB2, :NX1))='ORG_BIND_SAME_FILE');
SELECT id AS nbench FROM org_units WHERE file_id=:'fc' AND kind='bench' \gset
UPDATE org_units SET prev_unit_id=:FA, bind_checked_at=now() WHERE id=:'nbench';
SELECT _expect('8B-15 작업대는 prev·확인 NULL 고정', (SELECT prev_unit_id IS NULL AND bind_checked_at IS NULL FROM org_units WHERE id=:'nbench'));
SELECT org_duplicate_unit(:NA) AS dup \gset
SELECT _expect('8B-16 복제 단위는 승계 없음(신설)', (SELECT prev_unit_id IS NULL FROM org_units WHERE id=:'dup'));

-- 기준 단위 삭제 → SET NULL
INSERT INTO org_files (id, name, status, created_by, updated_by) VALUES ('aaaaaaaa-0000-0000-0000-00000000009b', 'p8b-base2', 'draft', :ORGADM, :ORGADM);
INSERT INTO org_units (id, file_id, parent_unit_id, name, sort_order) VALUES ('bbbbbbbb-0000-0000-0000-00000000009b', 'aaaaaaaa-0000-0000-0000-00000000009b', NULL, 'TMP', 0);
UPDATE org_units SET prev_unit_id='bbbbbbbb-0000-0000-0000-00000000009b' WHERE id=:NB2;
SELECT org_delete_unit('bbbbbbbb-0000-0000-0000-00000000009b');
SELECT _expect('8B-17 기준 단위 삭제 시 prev_unit_id NULL', (SELECT prev_unit_id IS NULL FROM org_units WHERE id=:NB2));

-- 권한 · 수명주기
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('8B-18 일반 직원 → FORBIDDEN', _err(format('SELECT org_bind_suggest(%L, %L)', :FN, :F1))='FORBIDDEN' AND _err(format('SELECT org_bind_apply(%L, %L)', :FN, '[]'))='FORBIDDEN');
SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('8B-19 Active 파일 apply → ORG_FILE_NOT_EDITABLE', _err(format('SELECT org_bind_apply(%L, %L)', :F1, format('[{"unit_id":"%s","checked":true}]', :FA)))='ORG_FILE_NOT_EDITABLE');
SELECT _expect('8B-20 Active 파일 suggest 는 읽기라 허용', (SELECT jsonb_array_length(org_bind_suggest(:F1, :FN)))=5);
RESET ROLE;
