-- ============================================================================
-- Phase 5-B 배포 후 진단 (읽기 전용 · SQL Editor 에서 Run)   2026-09-30
-- ============================================================================

-- 1) 함수·테이블·cron 존재
SELECT 'wb_notification_recipients' AS item, to_regprocedure('public.wb_notification_recipients(text,text,uuid,uuid,uuid[])') IS NOT NULL AS ok
UNION ALL SELECT 'wb_notification_context', to_regprocedure('public.wb_notification_context(text,uuid,uuid)') IS NOT NULL
UNION ALL SELECT 'wb_digest_build',         to_regprocedure('public.wb_digest_build(uuid,date,text)') IS NOT NULL
UNION ALL SELECT 'wb_digest_log',           to_regclass('public.wb_digest_log') IS NOT NULL
UNION ALL SELECT 'cron wb-daily-digest-0900kst', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wb-daily-digest-0900kst' AND active)
UNION ALL SELECT 'recipients authenticated 차단', NOT has_function_privilege('authenticated', 'public.wb_notification_recipients(text,text,uuid,uuid,uuid[])', 'EXECUTE');

-- 2) 다이제스트 수신자 (= workboard 멤버 4명 · 개인 채널 플래그)
SELECT name, dept, email_enabled, inapp_enabled FROM public.notification_resolve_recipients('wb_daily_digest', NULL) ORDER BY name;

-- 3) 오늘 다이제스트 미리보기 (첫 멤버 기준) — counts 만
SELECT p.name, (public.wb_digest_build(p.id, (now() AT TIME ZONE 'Asia/Seoul')::date, 'all'))->'counts' AS counts
  FROM public.admin_roles r JOIN public.profiles p ON p.id = r.user_id WHERE r.role = 'workboard' ORDER BY p.name;

-- 4) 다이제스트 발송 기록 (09:00 이후 · 멤버 수만큼 행)
SELECT p.name, l.digest_date, l.result, l.counts, l.sent_at FROM public.wb_digest_log l JOIN public.profiles p ON p.id = l.user_id ORDER BY l.digest_date DESC, p.name LIMIT 20;

-- 5) Work Space 알림 발송 로그 (send-notification 재배포 후 첫 발송부터)
SELECT created_at, type, channel, status, detail, recipient_name, booking_id FROM public.notification_logs WHERE type LIKE 'wb\_%' ORDER BY created_at DESC LIMIT 30;

-- 6) 인앱 알림 (booking_id 가 task-/issue-/digest- 형태)
SELECT n.created_at, p.name, n.type, n.title, n.body, n.booking_id, n.is_read FROM public.notifications n JOIN public.profiles p ON p.id = n.user_id WHERE n.type LIKE 'wb\_%' ORDER BY n.created_at DESC LIMIT 20;
