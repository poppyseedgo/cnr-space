-- ============================================================================
-- Phase 5-A 배포 후 진단 (읽기 전용 · SQL Editor 에서 Run)   2026-09-30
--   기대값은 각 쿼리 주석에. 하나라도 어긋나면 배포 중단하고 결과를 그대로 전달.
-- ============================================================================

-- 1) 자격 규칙 — book / resource / wb_ 는 명시 권한, 승인 3종은 NULL(ADMIN 전원)
SELECT t, public.notification_required_roles(t) AS roles
FROM unnest(ARRAY['pending','pending_expiring','pending_expired','book_checkout_created','resource_overdue','resource_hold_conflict','wb_issue_created']) t;

-- 2) 타입별 실제 수신자 (Edge 가 쓰는 결과 그대로) — book 은 도서관리 보유자 ∩ 지정명단, 송지나 없어야 함
SELECT 'book_checkout_created' AS type, name, dept, email_enabled, inapp_enabled FROM public.notification_resolve_recipients('book_checkout_created', NULL)
UNION ALL SELECT 'resource_overdue', name, dept, email_enabled, inapp_enabled FROM public.notification_resolve_recipients('resource_overdue', NULL)
UNION ALL SELECT 'pending', name, dept, email_enabled, inapp_enabled FROM public.notification_resolve_recipients('pending', NULL)
ORDER BY 1, 2;

-- 3) Work Space 멤버 = 정확히 4명 (김기남·송보람·박찬희·고현정), is_super 는 참고 배지
SELECT p.name, p.dept, EXISTS (SELECT 1 FROM public.admin_roles s WHERE s.user_id = ar.user_id AND s.role = 'super') AS is_super
FROM public.admin_roles ar JOIN public.profiles p ON p.id = ar.user_id
WHERE ar.role = 'workboard' ORDER BY p.name;

-- 4) wb_ RLS 정책 — has_admin_role('workboard') 0개, wb_is_member() 14개
SELECT count(*) FILTER (WHERE coalesce(qual,'') || coalesce(with_check,'') LIKE '%has_admin_role(''workboard''%') AS legacy_cnt,
       count(*) FILTER (WHERE coalesce(qual,'') || coalesce(with_check,'') LIKE '%wb_is_member()%') AS member_cnt
FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'wb_%';

-- 5) 사용자별 설정 행 (초기 0행 정상 · 토글 OFF 시에만 행 생성)
SELECT p.name, u.type, u.channel, u.enabled, u.updated_at FROM public.notification_user_prefs u JOIN public.profiles p ON p.id = u.user_id ORDER BY u.updated_at DESC;

-- 6) 발송 로그 — Edge 재배포 후 첫 발송부터 쌓임 (status: sent/failed/skipped · detail: user_off/no_recipient/channel_off …)
SELECT created_at, type, channel, status, detail, recipient_name FROM public.notification_logs ORDER BY created_at DESC LIMIT 30;

-- 7) 함수 권한 — resolve 는 service_role 만
SELECT has_function_privilege('authenticated', 'public.notification_resolve_recipients(text,uuid)', 'EXECUTE') AS resolve_open_to_authenticated  -- 기대 false
     , has_function_privilege('authenticated', 'public.admin_set_user_notification_pref(uuid,text,text,boolean)', 'EXECUTE') AS set_pref_authenticated; -- 기대 true
