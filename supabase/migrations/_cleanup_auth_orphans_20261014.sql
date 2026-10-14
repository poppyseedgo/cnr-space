-- ============================================================================
-- [H1②] auth.users 고아 36건 일회성 정리 — 2026-10-14 (고지 확정)
--
--   대상: profiles 에 id·email 어느 쪽으로도 없고, departed_users 에 이메일이 있는
--         auth 계정 = audit_log FK(NO ACTION)가 삭제를 막아 누적된 퇴사자 잔재.
--   안전: 운영 실측(2026-10-14)에서 라이브 프로필과 이메일이 겹치는 고아 0건 확인.
--         departed_users 매칭 조건이 라이브 직원 오삭제를 구조적으로 차단.
--   선행: 20261020_departure_fixes.sql (audit_log FK → ON DELETE SET NULL — 미적용 시 여기서 FK 에러로 실패)
--   실행: SQL Editor 전체 Run. [1] 로 목록 확인 → [2] 주석 해제 후 실행 → [3] 잔여 0 확인
--   ⚠ 마이그레이션이 아니라 일회성 데이터 정리 스크립트 (파일명 _ 접두 관례)
-- ============================================================================

-- [1] 삭제 대상 확인 (읽기전용)
SELECT u.id, u.email, d.name, d.departed_at::date
FROM auth.users u
JOIN public.departed_users d ON lower(d.email) = lower(u.email)
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p  WHERE p.id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE lower(p2.email) = lower(u.email))
ORDER BY d.departed_at;

-- [2] 삭제 실행 — [1] 목록이 기대(36건 내외, 전원 퇴사자)와 일치할 때만 주석 해제
--     admin_roles 는 FK CASCADE 로 함께 정리(퇴사 트리거가 이미 회수해 잔여 없음이 정상),
--     audit_log.actor_id 는 SET NULL(이름은 actor_name 스냅샷 보존)
-- DELETE FROM auth.users u
-- WHERE NOT EXISTS (SELECT 1 FROM public.profiles p  WHERE p.id = u.id)
--   AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE lower(p2.email) = lower(u.email))
--   AND EXISTS (SELECT 1 FROM public.departed_users d WHERE lower(d.email) = lower(u.email));

-- [3] 잔여 확인 — 0 이어야 정상
SELECT count(*) AS remaining_orphans
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p  WHERE p.id = u.id)
  AND NOT EXISTS (SELECT 1 FROM public.profiles p2 WHERE lower(p2.email) = lower(u.email))
  AND EXISTS (SELECT 1 FROM public.departed_users d WHERE lower(d.email) = lower(u.email));
