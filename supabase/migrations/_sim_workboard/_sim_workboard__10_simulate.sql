-- 시뮬레이션: 실제 마이그레이션 적용 상태에서 케이스별 기대값 검증
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION public._expect(p_case text, p_ok boolean, p_note text DEFAULT '')
RETURNS text LANGUAGE sql AS $$ SELECT format('%s  %s %s', CASE WHEN p_ok THEN '✅' ELSE '❌' END, p_case, p_note) $$;
CREATE OR REPLACE FUNCTION public._rows(p_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int; BEGIN EXECUTE p_sql; GET DIAGNOSTICS n = ROW_COUNT; RETURN n; END $$;
-- 예외 문자열 잡기
CREATE OR REPLACE FUNCTION public._err(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'OK';
EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

\echo === [1] admin_set_user_roles 재계산 ===
SET request.jwt.claim.sub = '0120852b-faae-4903-9515-c9c28ecaf76b';  -- super(고지)
-- 1-1 직원에게 workboard 만 → profiles.role 은 USER 유지
SELECT admin_set_user_roles('22222222-2222-2222-2222-222222222222', ARRAY['workboard']);
SELECT _expect('1-1 workboard 단독 → USER', (SELECT role FROM profiles WHERE id='22222222-2222-2222-2222-222222222222') = 'USER');
SELECT _expect('1-1 admin_roles 행 존재', EXISTS (SELECT 1 FROM admin_roles WHERE user_id='22222222-2222-2222-2222-222222222222' AND role='workboard'));
SELECT _expect('1-1 감사로그 grant 기록', EXISTS (SELECT 1 FROM admin_role_grants WHERE target_user='22222222-2222-2222-2222-222222222222' AND role='workboard' AND action='grant'));
-- 1-2 관리자1에게 기존(book,notice)+workboard → ADMIN 유지
SELECT admin_set_user_roles('11111111-1111-1111-1111-111111111111', ARRAY['book','notice','workboard']);
SELECT _expect('1-2 탭 역할 + workboard → ADMIN', (SELECT role FROM profiles WHERE id='11111111-1111-1111-1111-111111111111') = 'ADMIN');
-- 1-3 관리자1에서 탭 역할 전부 회수, workboard 만 남김 → USER 로 강등
SELECT admin_set_user_roles('11111111-1111-1111-1111-111111111111', ARRAY['workboard']);
SELECT _expect('1-3 탭 역할 회수 후 workboard 만 → USER', (SELECT role FROM profiles WHERE id='11111111-1111-1111-1111-111111111111') = 'USER');
-- 1-4 전부 회수 → USER, 행 0
SELECT admin_set_user_roles('11111111-1111-1111-1111-111111111111', ARRAY[]::text[]);
SELECT _expect('1-4 전부 회수 → USER · 행0', (SELECT role FROM profiles WHERE id='11111111-1111-1111-1111-111111111111') = 'USER' AND NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id='11111111-1111-1111-1111-111111111111'));
-- 1-5 기존 안전장치 유지: 자기 super 회수 금지
SELECT _expect('1-5 CANNOT_REVOKE_OWN_SUPER 유지', _err($q$SELECT admin_set_user_roles('0120852b-faae-4903-9515-c9c28ecaf76b', ARRAY['workboard'])$q$) = 'CANNOT_REVOKE_OWN_SUPER');
-- 복구: 관리자1 = book,notice,workboard
SELECT admin_set_user_roles('11111111-1111-1111-1111-111111111111', ARRAY['book','notice','workboard']);

\echo === [2] RLS 게이트 (authenticated 롤로 전환) ===
SET ROLE authenticated;
-- 2-1 workboard 없는 사람 (권한 전부 회수한 상태로 임시 테스트) → 우선 직원(workboard 보유)으로 조회
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SELECT _expect('2-1 workboard 보유자 SELECT 가능(0행이지만 에러 없음)', _err('SELECT count(*) FROM wb_tasks') = 'OK');
SELECT _expect('2-2 직접 INSERT wb_tasks 차단', _err($q$INSERT INTO wb_tasks(area_id,title) VALUES (gen_random_uuid(),'x')$q$) ~ '(row-level security|permission denied)', _err($q$INSERT INTO wb_tasks(area_id,title) VALUES (gen_random_uuid(),'x')$q$));
SELECT _expect('2-2b 직접 UPDATE wb_tasks 차단', _err($q$UPDATE wb_tasks SET title='x'$q$) ~ '(row-level security|permission denied)', _err($q$UPDATE wb_tasks SET title='x'$q$));
SELECT _expect('2-3 직접 INSERT wb_work_areas 차단 (RPC 전용)', _err($q$INSERT INTO wb_work_areas(name) VALUES ('x')$q$) LIKE '%row-level security%' OR _err($q$INSERT INTO wb_work_areas(name) VALUES ('x')$q$) LIKE '%permission denied%');
SELECT _expect('2-4 직접 INSERT wb_activity_log 차단', _err($q$INSERT INTO wb_activity_log(target_type,target_id,action) VALUES ('task',gen_random_uuid(),'x')$q$) LIKE '%permission denied%' OR _err($q$INSERT INTO wb_activity_log(target_type,target_id,action) VALUES ('task',gen_random_uuid(),'x')$q$) LIKE '%row-level security%');
-- 2-5 milestones 는 직접 CRUD 허용
SELECT _expect('2-5 wb_milestones 직접 INSERT 허용', _err($q$INSERT INTO wb_milestones(title,start_on,end_on) VALUES ('Q4 마일스톤','2026-10-01','2026-12-31')$q$) = 'OK');
-- 2-6 미인증(uid NULL)
RESET request.jwt.claim.sub;
SELECT _expect('2-6 미인증 SELECT → 0행', (SELECT count(*) FROM wb_milestones) = 0);
SELECT _expect('2-6 미인증 RPC → NOT_AUTHENTICATED', _err($q$SELECT wb_upsert_work_area(NULL,'x')$q$) = 'NOT_AUTHENTICATED');

\echo === [3] RPC — 업무영역 ===
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
SELECT wb_upsert_work_area(NULL, '비품 관리', '사무용 소모품 구매·재고', '22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 1) AS area_id \gset
SELECT _expect('3-1 생성 + created 이력', EXISTS (SELECT 1 FROM wb_activity_log WHERE target_type='area' AND target_id=:'area_id' AND action='created'));
SELECT _expect('3-2 동일값 재저장 → 이력 없음', (SELECT wb_upsert_work_area(:'area_id','비품 관리','사무용 소모품 구매·재고','22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',1)) = :'area_id'
   AND (SELECT count(*) FROM wb_activity_log WHERE target_id=:'area_id') = 1);
SELECT wb_upsert_work_area(:'area_id','비품 관리','사무용 소모품 구매·재고','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',1);
SELECT _expect('3-3 담당 교체 → diff 에 owner 2필드만', (SELECT diff FROM wb_activity_log WHERE target_id=:'area_id' AND action='updated') ?& ARRAY['primary_owner_id','backup_owner_id']
   AND NOT ((SELECT diff FROM wb_activity_log WHERE target_id=:'area_id' AND action='updated') ? 'name'));
SELECT _expect('3-4 주=부 동일인 거부', _err(format($q$SELECT wb_upsert_work_area(%L,'x',NULL,'11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111')$q$, :'area_id')) = 'INVALID_OWNER_SAME');
SELECT _expect('3-5 빈 이름 거부', _err($q$SELECT wb_upsert_work_area(NULL,'  ')$q$) = 'INVALID_NAME');

\echo === [4] RPC — 업무 ===
SELECT wb_upsert_task(NULL, :'area_id', 'A4 용지 구매', NULL, 'high', '2026-10-02 09:00+09', NULL,
  '[{"id":"c1","text":"견적","done":false},{"id":"c2","text":"발주","done":false}]'::jsonb,
  ARRAY['22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111']::uuid[]) AS task_id \gset
SELECT _expect('4-1 생성: 상태 todo · 담당 2명', (SELECT status FROM wb_tasks WHERE id=:'task_id')='todo' AND (SELECT count(*) FROM wb_task_assignees WHERE task_id=:'task_id')=2);
SELECT _expect('4-1 이력: created + assignees', (SELECT array_agg(action ORDER BY action) FROM wb_activity_log WHERE target_id=:'task_id') = ARRAY['assignees','created']);
-- 4-2 담당 1명 제거 + 체크리스트 1개 완료
SELECT wb_upsert_task(:'task_id', :'area_id', 'A4 용지 구매', NULL, 'high', '2026-10-02 09:00+09', NULL,
  '[{"id":"c1","text":"견적","done":true},{"id":"c2","text":"발주","done":false}]'::jsonb,
  ARRAY['22222222-2222-2222-2222-222222222222']::uuid[]);
SELECT _expect('4-2 담당 1명 남음', (SELECT count(*) FROM wb_task_assignees WHERE task_id=:'task_id')=1);
SELECT _expect('4-2 assignees diff removed 1', (SELECT diff->'removed' FROM wb_activity_log WHERE target_id=:'task_id' AND action='assignees' ORDER BY created_at DESC LIMIT 1) = '["11111111-1111-1111-1111-111111111111"]'::jsonb);
SELECT _expect('4-2 updated diff 는 checklist 만', (SELECT diff FROM wb_activity_log WHERE target_id=:'task_id' AND action='updated') ? 'checklist'
   AND (SELECT count(*) FROM jsonb_object_keys((SELECT diff FROM wb_activity_log WHERE target_id=:'task_id' AND action='updated')))=1);
-- 4-3 상태 전이
SELECT wb_set_task_status(:'task_id','doing');
SELECT wb_set_task_status(:'task_id','done');
SELECT _expect('4-3 done → completed_at/by 스탬프', (SELECT completed_at IS NOT NULL AND completed_by='22222222-2222-2222-2222-222222222222' FROM wb_tasks WHERE id=:'task_id'));
SELECT _expect('4-3 동일 상태 재호출 → 이력 없음', (SELECT wb_set_task_status(:'task_id','done'))='done' AND (SELECT count(*) FROM wb_activity_log WHERE target_id=:'task_id' AND action='status')=2);
SELECT wb_set_task_status(:'task_id','hold');
SELECT _expect('4-3 done→hold → completed 해제', (SELECT completed_at IS NULL AND completed_by IS NULL FROM wb_tasks WHERE id=:'task_id'));
SELECT _expect('4-4 잘못된 상태 거부', _err(format($q$SELECT wb_set_task_status(%L,'cancelled')$q$, :'task_id'))='INVALID_STATUS');
SELECT _expect('4-5 없는 영역 거부', _err($q$SELECT wb_upsert_task(NULL, gen_random_uuid(), 'x')$q$)='AREA_NOT_FOUND');
-- 4-6 삭제 게이트: hold 상태는 삭제 불가(0행), todo 만 가능
SELECT _expect('4-6 hold 업무 DELETE → 0행(정책 차단)', _rows(format($d$DELETE FROM wb_tasks WHERE id=%L$d$, :'task_id'))=0);
SELECT wb_upsert_task(NULL, :'area_id', '임시 업무') AS tmp_id \gset
SELECT _expect('4-6 todo 업무 DELETE → 1행', _rows(format($d$DELETE FROM wb_tasks WHERE id=%L$d$, :'tmp_id'))=1);
-- 4-7 UNIQUE(template_id, period_key) — 템플릿 만들고 직접 INSERT 는 막히므로 postgres 로 확인
RESET ROLE;
INSERT INTO wb_task_templates(area_id,title,rrule,month_day) VALUES (:'area_id','월간 비품구매','monthly',1) RETURNING id AS tpl_id \gset
INSERT INTO wb_tasks(area_id,title,template_id,period_key) VALUES (:'area_id','월간 비품구매',:'tpl_id','2026-10');
SELECT _expect('4-7 같은 period_key 재삽입 → UNIQUE 위반', _err(format($q$INSERT INTO wb_tasks(area_id,title,template_id,period_key) VALUES (%L,'월간 비품구매',%L,'2026-10')$q$, :'area_id', :'tpl_id')) LIKE '%wb_tasks_template_period%');
SELECT _expect('4-7 template_id 만 있고 period_key 없음 → CHECK 위반', _err(format($q$INSERT INTO wb_tasks(area_id,title,template_id) VALUES (%L,'x',%L)$q$, :'area_id', :'tpl_id')) LIKE '%wb_tasks_period_pair%');
SELECT _expect('4-8 weekly 템플릿 weekday 누락 → CHECK', _err(format($q$INSERT INTO wb_task_templates(area_id,title,rrule) VALUES (%L,'x','weekly')$q$, :'area_id')) LIKE '%wb_tpl_weekly_needs_weekday%');
SET ROLE authenticated;

\echo === [5] RPC — 이슈 ===
SELECT wb_upsert_issue(NULL, '복합기 3층 고장', '용지 걸림 반복', 'high', 'open', :'task_id', NULL, NULL) AS issue_id \gset
SELECT _expect('5-1 생성: occurred_on = KST 오늘 · reporter', (SELECT occurred_on = (now() AT TIME ZONE 'Asia/Seoul')::date AND reporter_id='22222222-2222-2222-2222-222222222222' AND resolved_at IS NULL FROM wb_issues WHERE id=:'issue_id'));
SELECT wb_upsert_issue(:'issue_id', '복합기 3층 고장', '용지 걸림 반복', 'high', 'resolved', :'task_id', NULL, NULL);
SELECT _expect('5-2 resolved → resolved_at/by 스탬프 · action=status', (SELECT resolved_at IS NOT NULL AND resolved_by='22222222-2222-2222-2222-222222222222' FROM wb_issues WHERE id=:'issue_id')
   AND (SELECT action FROM wb_activity_log WHERE target_id=:'issue_id' ORDER BY created_at DESC LIMIT 1)='status');
SELECT resolved_at AS ra1 FROM wb_issues WHERE id=:'issue_id' \gset
SELECT wb_upsert_issue(:'issue_id', '복합기 3층 고장', '용지 걸림 반복', 'high', 'wontfix', :'task_id', NULL, NULL);
SELECT _expect('5-3 resolved→wontfix → resolved_at 유지', (SELECT resolved_at FROM wb_issues WHERE id=:'issue_id') = :'ra1'::timestamptz);
SELECT wb_upsert_issue(:'issue_id', '복합기 3층 고장', '용지 걸림 반복', 'critical', 'open', :'task_id', NULL, NULL);
SELECT _expect('5-4 재오픈 → resolved 해제 · diff 에 severity+status', (SELECT resolved_at IS NULL FROM wb_issues WHERE id=:'issue_id')
   AND (SELECT diff ?& ARRAY['severity','status'] FROM wb_activity_log WHERE target_id=:'issue_id' ORDER BY created_at DESC LIMIT 1));
SELECT _expect('5-5 open 이슈 DELETE 허용', _rows(format($d$DELETE FROM wb_issues WHERE id=%L$d$, :'issue_id'))=1);
SELECT wb_upsert_issue(NULL, '종결 이슈', NULL, 'low', 'resolved') AS issue2 \gset
SELECT _expect('5-5 resolved 이슈 DELETE 차단(0행)', _rows(format($d$DELETE FROM wb_issues WHERE id=%L$d$, :'issue2'))=0);
SELECT _expect('5-6 없는 task 참조 거부', _err($q$SELECT wb_upsert_issue(NULL,'x',NULL,'low','open',gen_random_uuid())$q$)='TASK_NOT_FOUND');

\echo === [6] 댓글 RLS ===
SELECT _expect('6-1 본인 명의 댓글 INSERT', _err(format($q$INSERT INTO wb_comments(target_type,target_id,body) VALUES ('task',%L,'견적 받았음')$q$, :'task_id'))='OK');
SELECT _expect('6-2 타인 명의 댓글 INSERT 차단', _err(format($q$INSERT INTO wb_comments(target_type,target_id,body,author_id) VALUES ('task',%L,'x','11111111-1111-1111-1111-111111111111')$q$, :'task_id')) LIKE '%row-level security%');
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
SELECT _expect('6-3 타인 댓글 DELETE → 0행', _rows(format($d$DELETE FROM wb_comments WHERE target_id=%L$d$, :'task_id'))=0);
SELECT _expect('6-4 타인 댓글 SELECT 은 가능(팀 공유)', (SELECT count(*) FROM wb_comments WHERE target_id=:'task_id')=1);

\echo === [7] 퇴사 트리거 연동 (workboard 자동 회수) — 스텁엔 트리거가 없어 CASCADE 만 확인 ===
RESET ROLE;
DELETE FROM auth.users WHERE id='11111111-1111-1111-1111-111111111111';
SELECT _expect('7-1 auth.users 삭제 → admin_roles(workboard 포함) CASCADE 회수', NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id='11111111-1111-1111-1111-111111111111'));
SELECT _expect('7-2 wb_task_assignees 는 FK 없음 → 이력 보존', EXISTS (SELECT 1 FROM wb_activity_log WHERE diff::text LIKE '%11111111-1111-1111-1111-111111111111%'));
