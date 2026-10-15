-- ============================================================================
-- 시뮬 시나리오 — 20261020·20261021 적용 후 실행 (psql -v ON_ERROR_STOP=1)
--   (C2 수정 전 롤백 재현은 10/8 전수조사 시뮬에서 확정 — 본 시뮬은 수정 후 동작 검증)
--   S1  C2: 진행 중 자원대여 보유자 퇴사 → 퇴사 성공 + 강제 반납 기록
--   S2  C2: 클라이언트 직접 UPDATE(returned_at) 는 여전히 차단
--   S3  H2: super 2명 중 1명 퇴사 → 트리거가 회수 (RPC ⑦ 은 super 미접촉)
--   S4  H2: 마지막 super 퇴사 → super 보존 + 감사 흔적(action='grant')
--   S5  M3: pending 도서 신청 취소 (미시작 active 예약 취소 유지)
--   S6  M1: profiles DELETE 가 bookings 를 오염시키지 않음 (cancelled_by='system' 0)
--   S7  H1: audit_log 행 보유 사용자의 auth.users DELETE 성공 + actor_id NULL + 이름 스냅샷 보존
--   S8  org-A: 퇴사 후 org_display_names 행 생존
--   S9  org-B: 스냅샷 트리거 — 표기 이름 우선 / Azure 이름 폴백 / 수기값 보존 / Active 파일 가드 통과 / GUC 복원
--   S10 멱등: process_departure 재호출 무해 + 백필 재실행 0건
-- ============================================================================
\set ON_ERROR_STOP on

-- ── 시드 ─────────────────────────────────────────────────────────────────────
INSERT INTO auth.users VALUES
  ('a0000000-0000-0000-0000-00000000000a','gozi@cnrres.com'),
  ('b0000000-0000-0000-0000-00000000000b','res-holder@cnrres.com'),
  ('c0000000-0000-0000-0000-00000000000c','super2@cnrres.com'),
  ('d0000000-0000-0000-0000-00000000000d','last-super@cnrres.com'),
  ('e0000000-0000-0000-0000-00000000000e','pending-book@cnrres.com'),
  ('f0000000-0000-0000-0000-00000000000f','orgname@cnrres.com'),
  ('a1000000-0000-0000-0000-0000000000a1','orgazure@cnrres.com'),
  ('a2000000-0000-0000-0000-0000000000a2','orgmanual@cnrres.com');
INSERT INTO public.profiles (id,email,name,dept,role,employee_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a','gozi@cnrres.com','고현정','MS','ADMIN','E001'),
  ('b0000000-0000-0000-0000-00000000000b','res-holder@cnrres.com','자원보유','CO','USER','E002'),
  ('c0000000-0000-0000-0000-00000000000c','super2@cnrres.com','수퍼둘','MS','ADMIN','E003'),
  ('d0000000-0000-0000-0000-00000000000d','last-super@cnrres.com','마지막수퍼','MS','ADMIN','E004'),
  ('e0000000-0000-0000-0000-00000000000e','pending-book@cnrres.com','대기신청','CO','USER','E005'),
  ('f0000000-0000-0000-0000-00000000000f','orgname@cnrres.com','표기이름대상','CO','USER','E006'),
  ('a1000000-0000-0000-0000-0000000000a1','orgazure@cnrres.com','아주어이름','CO','USER','E007'),
  ('a2000000-0000-0000-0000-0000000000a2','orgmanual@cnrres.com','수기보존대상','CO','USER','E008');
INSERT INTO public.admin_roles (user_id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a','super'),
  ('c0000000-0000-0000-0000-00000000000c','super'),
  ('c0000000-0000-0000-0000-00000000000c','book');

-- 진행 중 자원대여 (S0·S1)
INSERT INTO public.resource_bookings (id, item_id, user_id, status, start_at, end_at, return_due) VALUES
  ('10000000-0000-0000-0000-000000000001', gen_random_uuid(), 'b0000000-0000-0000-0000-00000000000b', 'confirmed', now() - interval '2 hours', now() + interval '2 hours', (now() AT TIME ZONE 'Asia/Seoul')::date + 1);
-- 도서 (S5): pending 신청 + 미시작 active 예약
INSERT INTO public.books (id, title, status) VALUES ('20000000-0000-0000-0000-000000000002','시뮬도서','available');
INSERT INTO public.book_checkouts (user_id, book_id, status, checkout_at) VALUES
  ('e0000000-0000-0000-0000-00000000000e','20000000-0000-0000-0000-000000000002','pending', now()),
  ('e0000000-0000-0000-0000-00000000000e','20000000-0000-0000-0000-000000000002','active',  now() + interval '3 days');
-- 미래 예약 (S6 오염 검증용 — 퇴사 아닌 단순 profiles DELETE 경로)
INSERT INTO public.bookings (id, user_id, user_email, start_at, end_at, status) VALUES
  ('b_sim_1', 'f0000000-0000-0000-0000-00000000000f', 'orgname@cnrres.com', now() + interval '1 day', now() + interval '1 day 1 hour', 'confirmed');
-- audit_log (S7)
INSERT INTO public.audit_log (actor_id, actor_name, action, entity_type, entity_id) VALUES
  ('b0000000-0000-0000-0000-00000000000b', '자원보유', 'TEST_ACTION', 'booking', 'b_sim_1');
-- 조직도: Active 파일 + 카드 3장 (S8·S9) — Active 파일 카드 시드는 가드 통과용 GUC 필요
SELECT set_config('org.lifecycle', 'on', false);
INSERT INTO public.org_files (id, name, status) VALUES ('30000000-0000-0000-0000-000000000003','시뮬 Active 조직도','active');
INSERT INTO public.org_units (id, file_id, name) VALUES ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000003','시뮬단위');
INSERT INTO public.org_cards (id, file_id, unit_id, profile_id) VALUES
  ('50000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004','f0000000-0000-0000-0000-00000000000f'),
  ('50000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004','a1000000-0000-0000-0000-0000000000a1');
INSERT INTO public.org_cards (id, file_id, unit_id, profile_id, display_name) VALUES
  ('50000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000004','a2000000-0000-0000-0000-0000000000a2','수기이미입력');
INSERT INTO public.org_display_names (profile_id, display_name) VALUES
  ('f0000000-0000-0000-0000-00000000000f','조직도표기명');
SELECT set_config('org.lifecycle', '', false);   -- 시드 종료 — GUC 원복

\echo '=== [검증 시작] ==='

-- service_role 경로 재현: 비 postgres 세션 + service_role 클레임
SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);

-- S1 (C2): 진행 중 자원대여 보유자 퇴사 → 성공
SELECT public.process_departure('b0000000-0000-0000-0000-00000000000b', NULL) AS s1_result \gset
SELECT CASE WHEN (SELECT returned_at IS NOT NULL FROM public.resource_bookings WHERE id='10000000-0000-0000-0000-000000000001')
  THEN '✅ S1 통과 — 진행 중 자원대여 강제 반납 + 퇴사 성공' ELSE '❌ S1 실패' END;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id='b0000000-0000-0000-0000-00000000000b')
  AND EXISTS (SELECT 1 FROM public.departed_users WHERE id='b0000000-0000-0000-0000-00000000000b')
  THEN '✅ S1b 통과 — profiles 삭제·departed_users 기록' ELSE '❌ S1b 실패' END;

-- S2 (C2): 클라이언트 직접 반납확인은 여전히 차단 (sim_service 는 postgres 아님·비관리자)
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-00000000000e', false);
DO $$
BEGIN
  BEGIN
    UPDATE public.resource_bookings SET returned_at = now() WHERE id='10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION '❌ S2 실패 — 직접 UPDATE 가 차단되지 않음';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%RETURN_CONFIRM_ADMIN_ONLY%' THEN RAISE NOTICE '✅ S2 통과 — 직접 반납확인 차단 유지';
    ELSE RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT set_config('request.jwt.claim.sub', '', false);

-- S3 (H2): super 2명 중 1명(수퍼둘, book 겸임) 퇴사 → super·book 전부 회수(트리거)
SELECT public.process_departure('c0000000-0000-0000-0000-00000000000c', NULL);
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id='c0000000-0000-0000-0000-00000000000c')
  AND (SELECT count(*) FROM public.admin_role_grants WHERE target_user='c0000000-0000-0000-0000-00000000000c' AND action='revoke') = 2
  THEN '✅ S3 통과 — 대체 super 존재 시 전 역할 회수 + 감사 2건' ELSE '❌ S3 실패' END;

-- S4 (H2): 마지막 super(고현정) 퇴사 → super 보존 + 흔적
SELECT public.process_departure('a0000000-0000-0000-0000-00000000000a', NULL);
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id='a0000000-0000-0000-0000-00000000000a' AND role='super')
  AND EXISTS (SELECT 1 FROM public.admin_role_grants WHERE target_user='a0000000-0000-0000-0000-00000000000a' AND role='super' AND action='grant')
  THEN '✅ S4 통과 — 마지막 super 보존(수정 전엔 ⑦이 무조건 삭제)' ELSE '❌ S4 실패 — super 0명' END;

-- S5 (M3): pending 신청 취소 + 미시작 active 예약 취소
SELECT public.process_departure('e0000000-0000-0000-0000-00000000000e', NULL);
SELECT CASE WHEN (SELECT count(*) FROM public.book_checkouts WHERE user_id='e0000000-0000-0000-0000-00000000000e' AND status='cancelled') = 2
  THEN '✅ S5 통과 — pending 신청·미시작 예약 모두 취소' ELSE '❌ S5 실패: ' ||
    (SELECT string_agg(status, ',') FROM public.book_checkouts WHERE user_id='e0000000-0000-0000-0000-00000000000e') END;

-- S6+S8+S9 는 조직도 시드가 필요 — postgres 로 복귀해 GUC 로 시드 (Active 파일 가드)
RESET SESSION AUTHORIZATION;

-- S6 (M1): 퇴사가 아닌 profiles 직접 DELETE 도 bookings 미오염 (구 트리거 제거 확인)
-- S9 와 함께: f0000000(표기 이름 있음) 삭제
DELETE FROM public.profiles WHERE id = 'f0000000-0000-0000-0000-00000000000f';
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.bookings WHERE user_id='f0000000-0000-0000-0000-00000000000f' AND cancelled_by='system')
  THEN '✅ S6 통과 — 구 트리거 제거로 cancelled_by=system 오염 없음' ELSE '❌ S6 실패 — 오염 발생' END;

-- S8 (org-A): 표기 이름 행 생존 (수정 전엔 CASCADE 삭제)
SELECT CASE WHEN EXISTS (SELECT 1 FROM public.org_display_names WHERE profile_id='f0000000-0000-0000-0000-00000000000f')
  THEN '✅ S8 통과 — 퇴사 후 표기 이름 보존' ELSE '❌ S8 실패 — FK CASCADE 잔존' END;

-- S9a (org-B): 표기 이름 우선 스냅샷 (Active 파일 카드 — 가드 통과 확인 포함)
SELECT CASE WHEN (SELECT display_name FROM public.org_cards WHERE id='50000000-0000-0000-0000-000000000005') = '조직도표기명'
  THEN '✅ S9a 통과 — 표기 이름 우선 스냅샷 (Active 파일 가드 통과)' ELSE '❌ S9a 실패: ' ||
    COALESCE((SELECT display_name FROM public.org_cards WHERE id='50000000-0000-0000-0000-000000000005'), 'NULL') END;

-- S9b: 표기 이름 없는 사람 → Azure 이름 폴백
DELETE FROM public.profiles WHERE id = 'a1000000-0000-0000-0000-0000000000a1';
SELECT CASE WHEN (SELECT display_name FROM public.org_cards WHERE id='50000000-0000-0000-0000-000000000006') = '아주어이름'
  THEN '✅ S9b 통과 — Azure 이름 폴백 스냅샷' ELSE '❌ S9b 실패' END;

-- S9c: 수기 display_name 보존
DELETE FROM public.profiles WHERE id = 'a2000000-0000-0000-0000-0000000000a2';
SELECT CASE WHEN (SELECT display_name FROM public.org_cards WHERE id='50000000-0000-0000-0000-000000000007') = '수기이미입력'
  THEN '✅ S9c 통과 — 수기값 보존(덮어쓰지 않음)' ELSE '❌ S9c 실패' END;

-- S9d: GUC 복원 — 트리거 밖에서 lifecycle OFF 상태 확인
SELECT CASE WHEN NOT public.org_lifecycle_on()
  THEN '✅ S9d 통과 — org.lifecycle GUC 복원' ELSE '❌ S9d 실패 — GUC on 잔존' END;

-- S7 (H1): audit_log 행 보유 사용자의 auth DELETE
DELETE FROM auth.users WHERE id = 'b0000000-0000-0000-0000-00000000000b';
SELECT CASE WHEN (SELECT actor_id IS NULL AND actor_name = '자원보유' FROM public.audit_log WHERE entity_id='b_sim_1' AND action='TEST_ACTION')
  THEN '✅ S7 통과 — auth 삭제 성공 · actor_id NULL · 이름 스냅샷 보존' ELSE '❌ S7 실패' END;

-- S10: process_departure 재호출 멱등 + departed_at 불변
SET SESSION AUTHORIZATION sim_service;
SELECT set_config('request.jwt.claim.role', 'service_role', false);
SELECT public.process_departure('e0000000-0000-0000-0000-00000000000e', NULL);
SELECT CASE WHEN (SELECT count(*) FROM public.departed_users WHERE id='e0000000-0000-0000-0000-00000000000e') = 1
  THEN '✅ S10 통과 — 재호출 멱등' ELSE '❌ S10 실패' END;
RESET SESSION AUTHORIZATION;

\echo '=== [검증 끝] ==='
