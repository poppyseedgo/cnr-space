-- 시뮬레이션 Phase 8-A: orgsim6(Phase 7 시뮬 완료 상태) 에 20261014 적용 후 (psql autocommit = 문장마다 트랜잭션 = 되돌리기 1단계)
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on
\set ORGADM '''11111111-1111-1111-1111-111111111111'''
\set STAFF '''22222222-2222-2222-2222-222222222222'''
\set F1 '''aaaaaaaa-0000-0000-0000-000000000001'''
\set Z  '''bbbbbbbb-0000-0000-0000-000000000099'''
\echo === [8-A] 구조 편집 RPC · 컬럼 · 복사 · 되돌리기 ===
SET ROLE authenticated; SET request.jwt.claim.sub = :ORGADM;
SELECT org_copy_file(:F1, 'p8') AS cp \gset
SELECT (:'cp'::jsonb->>'file_id') AS f8 \gset
SELECT id AS root FROM org_units WHERE file_id=:'f8' AND name='ROOT' \gset
SELECT id AS a  FROM org_units WHERE file_id=:'f8' AND name='A'  \gset
SELECT id AS b  FROM org_units WHERE file_id=:'f8' AND name='B'  \gset
SELECT id AS a1 FROM org_units WHERE file_id=:'f8' AND name='A1' \gset
SELECT id AS x1 FROM org_units WHERE file_id=:'f8' AND name='X1' \gset
SELECT id AS bench FROM org_units WHERE file_id=:'f8' AND kind='bench' \gset
SELECT id AS c1 FROM org_cards WHERE file_id=:'f8' AND unit_id=:'a' AND is_unit_head \gset
SELECT id AS c11 FROM org_cards WHERE file_id=:'f8' AND unit_id=:'b' AND is_primary=false \gset
SELECT id AS job FROM org_jobs WHERE code='CPO' \gset

-- 배치(org_place_unit)
SELECT org_place_unit(:'a1', :'b', 0);
SELECT _expect('8-1 A1 → B 의 0번째: A1(0) X1(1)', (SELECT parent_unit_id=:'b' AND sort_order=0 FROM org_units WHERE id=:'a1') AND (SELECT sort_order=1 FROM org_units WHERE id=:'x1'));
SELECT org_place_unit(:'x1', :'root', 1);
SELECT _expect('8-2 X1 → ROOT 의 1번째: A(0) X1(1) B(2)', (SELECT string_agg(name, ',' ORDER BY sort_order) FROM org_units WHERE parent_unit_id=:'root')='A,X1,B');
SELECT org_place_unit(:'x1', :'root', NULL);
SELECT _expect('8-3 index NULL = 끝: A(0) B(1) X1(2)', (SELECT string_agg(name||sort_order, ',' ORDER BY sort_order) FROM org_units WHERE parent_unit_id=:'root')='A0,B1,X12');
SELECT _expect('8-4 순환(ROOT → A1 아래) 거부', _err(format('SELECT org_place_unit(%L, %L, 0)', :'root', :'a1'))='ORG_UNIT_CYCLE');
SELECT _expect('8-5 다른 파일 단위 아래 거부', _err(format('SELECT org_place_unit(%L, %L, 0)', :'a', :Z))='ORG_UNIT_PARENT_OTHER_FILE');
SELECT _expect('8-6 보류 영역 자체 이동 거부', _err(format('SELECT org_place_unit(%L, %L, 0)', :'bench', :'root'))='ORG_BENCH_PROTECTED');
SELECT org_place_unit(:'a1', :'bench', NULL);
SELECT _expect('8-7 보류 아래로 = 선 끊기', (SELECT parent_unit_id=:'bench' AND sort_order=0 FROM org_units WHERE id=:'a1'));
SELECT org_undo_last(:'f8');
SELECT _expect('8-8 되돌리기 1단계 → A1 다시 B 아래', (SELECT parent_unit_id=:'b' FROM org_units WHERE id=:'a1'));

-- 삭제(org_delete_unit)
SELECT _expect('8-9 하위 단위 있는 B 삭제 거부', _err(format('SELECT org_delete_unit(%L)', :'b'))='ORG_UNIT_HAS_CHILDREN');
SELECT org_move_cards(ARRAY[:'c11'::uuid], :'bench');
SELECT _expect('8-10 보류에 같은 사람(STAFF) 있으면 A 삭제 거부', _err(format('SELECT org_delete_unit(%L)', :'a'))='ORG_MOVE_DUPLICATE_PERSON');
SELECT org_undo_last(:'f8');
SELECT org_delete_unit(:'a') AS d1 \gset
SELECT _expect('8-11 A 삭제: 카드 2장 보류로 · 단위 없음', (:'d1'::jsonb->>'cards_to_bench')::int=2 AND NOT EXISTS (SELECT 1 FROM org_units WHERE id=:'a') AND (SELECT count(*) FROM org_cards WHERE unit_id=:'bench')=2 AND (SELECT bool_and(NOT is_unit_head) FROM org_cards WHERE unit_id=:'bench'));
SELECT org_undo_last(:'f8') AS u1 \gset
SELECT _expect('8-12 되돌리기 1단계로 A·카드·단위장 복원', EXISTS (SELECT 1 FROM org_units WHERE id=:'a' AND head_card_id=:'c1') AND (SELECT count(*) FROM org_cards WHERE unit_id=:'a')=2 AND (SELECT is_unit_head FROM org_cards WHERE id=:'c1') AND (SELECT count(*) FROM org_cards WHERE unit_id=:'bench')=0, '(' || (:'u1'::jsonb->>'reverted') || '건)');
SELECT org_delete_unit(:'x1');
SELECT _expect('8-13 빈 단위 X1 삭제', NOT EXISTS (SELECT 1 FROM org_units WHERE id=:'x1'));

-- 컬럼 · 복제 · 복사
UPDATE org_units SET unit_type='팀', head_job_id=:'job', memo='개편 메모' WHERE id=:'a';
SELECT org_duplicate_unit(:'a') AS dup \gset
SELECT _expect('8-14 복제: 바로 뒤 · 이름 (복사) · code NULL · 유형/포지션/메모 복사', (SELECT string_agg(name, ',' ORDER BY sort_order) FROM org_units WHERE parent_unit_id=:'root')='A,A (복사),B'
  AND (SELECT code IS NULL AND unit_type='팀' AND head_job_id=:'job' AND memo='개편 메모' FROM org_units WHERE id=:'dup'));
SELECT org_copy_file(:'f8', 'p8-copy') AS cp2 \gset
SELECT _expect('8-15 파일 복사에 유형·포지션·메모 포함', (SELECT unit_type='팀' AND head_job_id=:'job' AND memo='개편 메모' FROM org_units WHERE file_id=(:'cp2'::jsonb->>'file_id')::uuid AND name='A'));
UPDATE org_units SET unit_type='본부' WHERE id=:'a';
SELECT org_undo_last(:'f8');
SELECT _expect('8-16 유형 변경 되돌리기', (SELECT unit_type='팀' FROM org_units WHERE id=:'a'));
UPDATE org_units SET unit_type='x', memo='y', head_job_id=:'job' WHERE id=:'bench';
SELECT _expect('8-17 보류 영역은 새 컬럼 NULL 고정', (SELECT unit_type IS NULL AND memo IS NULL AND head_job_id IS NULL FROM org_units WHERE id=:'bench'));
UPDATE org_units SET unit_type='  ' WHERE id=:'b';
SELECT _expect('8-18 빈 유형 → NULL', (SELECT unit_type IS NULL FROM org_units WHERE id=:'b'));

-- 권한 · 수명주기
SET request.jwt.claim.sub = :STAFF;
SELECT _expect('8-19 일반 직원 → FORBIDDEN', _err(format('SELECT org_place_unit(%L, %L, 0)', :'a', :'root'))='FORBIDDEN');
SET request.jwt.claim.sub = :ORGADM;
SELECT id AS fa FROM org_units WHERE file_id=:F1 AND name='A' \gset
SELECT id AS froot FROM org_units WHERE file_id=:F1 AND name='ROOT' \gset
SELECT _expect('8-20 Active 파일 → ORG_FILE_NOT_EDITABLE', _err(format('SELECT org_place_unit(%L, %L, 0)', :'fa', :'froot'))='ORG_FILE_NOT_EDITABLE' AND _err(format('SELECT org_delete_unit(%L)', :'fa'))='ORG_FILE_NOT_EDITABLE');
RESET ROLE;
