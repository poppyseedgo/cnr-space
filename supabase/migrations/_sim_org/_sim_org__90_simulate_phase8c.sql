-- 시뮬레이션 Phase 8-C: orgsim6(8-B 시뮬 완료 상태) 에 20261016 적용 후 (psql autocommit = 문장마다 트랜잭션 = 되돌리기 1단계)
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\set SUPER '''0120852b-faae-4903-9515-c9c28ecaf76b'''
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set STAFF2 '''33333333-3333-3333-3333-333333333333'''
\set F1 '''aaaaaaaa-0000-0000-0000-000000000001'''
\set FA1 '''bbbbbbbb-0000-0000-0000-000000000003'''
\set FB '''bbbbbbbb-0000-0000-0000-000000000002'''
\echo === [8-C] 자동 배치 제안 · 일괄 배치 · 되돌리기 ===
-- 기준(활성) 파일에 입사예정자 카드 1장 (수명주기 GUC 로)
INSERT INTO org_persons (id, name, created_by) VALUES ('dddddddd-0000-0000-0000-00000000008c', '입사예정자C', :ORGADM) ON CONFLICT DO NOTHING;
DO $$ BEGIN PERFORM set_config('org.lifecycle','on',true);
  INSERT INTO org_cards (id, file_id, unit_id, person_id, sort_order) VALUES ('cccccccc-0000-0000-0000-00000000008c', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-00000000008c', 9) ON CONFLICT DO NOTHING; END $$;
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_copy_file(:F1, 'p8c') AS cp \gset
SELECT (:'cp'::jsonb->>'file_id') AS fc \gset
SELECT id AS ua FROM org_units WHERE file_id=:'fc' AND name='A' \gset
SELECT id AS ua1 FROM org_units WHERE file_id=:'fc' AND name='A1' \gset
SELECT id AS ub FROM org_units WHERE file_id=:'fc' AND name='B' \gset
SELECT id AS bench FROM org_units WHERE file_id=:'fc' AND kind='bench' \gset
-- 풀 만들기: 직원B 카드 제거(미배치) · 고현정 카드 보류로 · 입사예정자C 카드 제거(기준에만 있음) · B 에 Azure 'MS'(조직담당 dept 매칭)
DELETE FROM org_cards WHERE file_id=:'fc' AND profile_id=:STAFF2;
SELECT id AS c3 FROM org_cards WHERE file_id=:'fc' AND profile_id=:SUPER \gset
SELECT org_move_cards(ARRAY[:'c3'::uuid], :'bench');
DELETE FROM org_cards WHERE file_id=:'fc' AND person_id='dddddddd-0000-0000-0000-00000000008c';
UPDATE org_units SET azure_division='MS' WHERE id=:'ub';

SELECT org_place_suggest(:'fc', :F1) AS sg \gset
SELECT _expect('8C-1 풀 4명: 직원B(미배치) · 고현정(보류 카드) · 조직담당(미배치) · 입사예정자C(기준에만)', (SELECT jsonb_array_length(:'sg'::jsonb))=4, :'sg');
SELECT _expect('8C-2 직원B → A (승계, 기준 단위 A)', (SELECT e->>'unit_id'=:'ua' AND e->>'reason'='prev' AND e->>'base_unit_name'='A' FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'profile_id'=:STAFF2));
SELECT _expect('8C-3 고현정 보류 카드 → B (승계, card_id 포함)', (SELECT e->>'unit_id'=:'ub' AND e->>'reason'='prev' AND e->>'card_id'=:'c3' FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'profile_id'=:SUPER));
SELECT _expect('8C-4 조직담당(기준에 없음, dept MS) → B (Azure 부서 유일 매칭)', (SELECT e->>'unit_id'=:'ub' AND e->>'reason'='dept' FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'profile_id'=:ORGADM));
SELECT _expect('8C-5 입사예정자C → A1 (승계, person_id)', (SELECT e->>'unit_id'=:'ua1' AND e->>'reason'='prev' FROM jsonb_array_elements(:'sg'::jsonb) e WHERE e->>'person_id'='dddddddd-0000-0000-0000-00000000008c'));
SELECT _expect('8C-6 기준 없이(NULL) 는 dept 근거만', (SELECT count(*) FILTER (WHERE e->>'reason'='prev')=0 AND count(*) FILTER (WHERE e->>'reason'='dept')=2 FROM jsonb_array_elements(org_place_suggest(:'fc', NULL)) e));

-- 일괄 배치
SELECT org_place_cards(:'fc', format('[{"unit_id":"%s","profile_id":"%s"},{"unit_id":"%s","card_id":"%s"},{"unit_id":"%s","person_id":"dddddddd-0000-0000-0000-00000000008c"}]', :'ua', :STAFF2, :'ub', :'c3', :'ua1')::jsonb) AS pl \gset
SELECT _expect('8C-7 생성 2 · 이동 1', (:'pl'::jsonb->>'inserted')::int=2 AND (:'pl'::jsonb->>'moved')::int=1
  AND EXISTS (SELECT 1 FROM org_cards WHERE file_id=:'fc' AND profile_id=:STAFF2 AND unit_id=:'ua' AND is_primary)
  AND (SELECT unit_id=:'ub' AND NOT is_unit_head FROM org_cards WHERE id=:'c3')
  AND EXISTS (SELECT 1 FROM org_cards WHERE file_id=:'fc' AND person_id='dddddddd-0000-0000-0000-00000000008c' AND unit_id=:'ua1'));
SELECT _expect('8C-8 배치 후 풀에서 사라짐', (SELECT jsonb_array_length(org_place_suggest(:'fc', :F1)))=1);
SELECT _expect('8C-9 이미 카드 있는 사람 생성 → 거부(이름)', _err(format('SELECT org_place_cards(%L, %L)', :'fc', format('[{"unit_id":"%s","profile_id":"%s"}]', :'ub', :STAFF2)))='ORG_MOVE_DUPLICATE_PERSON');
SELECT id AS c1 FROM org_cards WHERE file_id=:'fc' AND profile_id=:STAFF AND is_primary \gset
SELECT _expect('8C-10 대상 단위에 같은 사람(겸직) → 이동 거부', _err(format('SELECT org_place_cards(%L, %L)', :'fc', format('[{"unit_id":"%s","card_id":"%s"}]', :'ub', :'c1')))='ORG_MOVE_DUPLICATE_PERSON');
SELECT org_undo_last(:'fc') AS u1 \gset
SELECT _expect('8C-11 되돌리기 1단계 = 생성 2 삭제 + 이동 복귀', (:'u1'::jsonb->>'reverted')::int>=3
  AND NOT EXISTS (SELECT 1 FROM org_cards WHERE file_id=:'fc' AND profile_id=:STAFF2)
  AND (SELECT unit_id=:'bench' FROM org_cards WHERE id=:'c3')
  AND NOT EXISTS (SELECT 1 FROM org_cards WHERE file_id=:'fc' AND person_id='dddddddd-0000-0000-0000-00000000008c'));
SELECT _expect('8C-12 잘못된 항목 → ORG_PLACE_INVALID', _err(format('SELECT org_place_cards(%L, %L)', :'fc', format('[{"unit_id":"%s"}]', :'ua')))='ORG_PLACE_INVALID');
SELECT _expect('8C-13 타 파일 단위 → ORG_UNIT_NOT_FOUND', _err(format('SELECT org_place_cards(%L, %L)', :'fc', format('[{"unit_id":"%s","profile_id":"%s"}]', :FA1, :STAFF2)))='ORG_UNIT_NOT_FOUND');
SELECT _expect('8C-14 타 파일 카드 → ORG_CARD_UNIT_OTHER_FILE', _err(format('SELECT org_place_cards(%L, %L)', :'fc', format('[{"unit_id":"%s","card_id":"cccccccc-0000-0000-0000-000000000001"}]', :'ua')))='ORG_CARD_UNIT_OTHER_FILE');
-- 단위장 카드가 이동하면 단위장 해제
UPDATE org_units SET head_card_id=:'c1' WHERE id=:'ua';
SELECT org_place_cards(:'fc', format('[{"unit_id":"%s","card_id":"%s"}]', :'ua1', :'c1')::jsonb);
SELECT _expect('8C-15 단위장 카드 이동 → 원 단위 head 해제 · is_unit_head false', (SELECT head_card_id IS NULL FROM org_units WHERE id=:'ua') AND (SELECT unit_id=:'ua1' AND NOT is_unit_head FROM org_cards WHERE id=:'c1'));
SELECT org_undo_last(:'fc');
-- 권한 · 수명주기
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('8C-16 일반 직원 → FORBIDDEN', _err(format('SELECT org_place_suggest(%L, %L)', :'fc', :F1))='FORBIDDEN' AND _err(format('SELECT org_place_cards(%L, %L)', :'fc', '[]'))='FORBIDDEN');
SET request.jwt.claim.sub = :ORGADM;
SELECT _expect('8C-17 Active 파일 배치 → ORG_FILE_NOT_EDITABLE', _err(format('SELECT org_place_cards(%L, %L)', :F1, format('[{"unit_id":"%s","profile_id":"%s"}]', :FB, :ORGADM)))='ORG_FILE_NOT_EDITABLE');
RESET ROLE;
