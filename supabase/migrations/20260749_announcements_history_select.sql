-- ⛔ [2026-10-06] 실행 금지 — 운영 미반영 상태로 20261019_announcement_read_functions.sql 로 대체됨.
--    이 파일을 실행하면 ① 헤더 배너에 종료된 공지가 전 직원에게 뜨고(이전 프론트의 배너 조회는 게시 기간을 RLS 에 맡긴다)
--    ② 정책을 대상 역할 없이 다시 만들어 20261018(로그인 사용자 전용)이 풀린다.
--    지난 공지 열람(아래 "게시가 시작된 활성 공지" 기준 그대로)은 서버 함수 get_announcement_history 가 맡는다.
-- ============================================================================
-- 20260749_announcements_history_select.sql
-- 공지사항 페이지 신설(2026-08-19 고지 확정) — 지난 공지 이력 열람 허용
--
-- 현행(실측): announcements_select = 게시중(is_active + 기간 내)만 전 직원,
--             이력은 notice 관리자 전용 → 공지사항 페이지가 이력을 못 읽는다.
-- 변경: "게시가 시작된 활성 공지"는 종료 후에도 전 직원 열람.
--   - starts_at > now()  : 예약 공지 — 게시 전이므로 계속 숨김
--   - is_active = false  : 철회/임시저장 — 잘못 올린 공지가 이력에 남지 않게 숨김
--   - 관리자(notice)는 기존대로 전체
--
-- 실행: SQL Editor 붙여넣기 → Run. 재실행 안전.
-- ============================================================================

DROP POLICY IF EXISTS announcements_select ON announcements;
CREATE POLICY announcements_select ON announcements FOR SELECT USING (
  (is_active AND now() >= starts_at)          -- 게시 시작된 활성 공지 — 종료돼도 이력 열람
  OR has_admin_role('notice'::text)
);

-- 검증 — 정책 1행, qual 에 'now() >= starts_at' 포함 확인
SELECT policyname, qual FROM pg_policies
WHERE tablename = 'announcements' AND policyname = 'announcements_select';
