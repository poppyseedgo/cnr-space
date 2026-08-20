-- ============================================================================
-- 20260751_announcements_backfill_2.sql
-- 공지 백필 2차 (2026-08-19 고지 확정) — 4~7월 채팅 전수 조사 발굴분
--
-- 전 직원의 행동이 바뀐 정책 2건을 지난 공지로 추가:
--   ① 체크인 정책 변경 (5/12) — 시작 5분 전부터 체크인 가능
--   ② 반복 예약 재개방 (5/28) — 관리자 한정, 당해 12/31까지
--
-- 1차 백필(20260750)과 동일 패턴: message 기준 중복 방지 멱등, created_by NULL,
-- 색은 어드민 프리셋(안내 #E6F2FF), 기간 경계 KST.
-- 실행: SQL Editor 전체 붙여넣기 → Run. 재실행 안전.
-- ============================================================================

INSERT INTO announcements (message, bg_color, text_color, starts_at, ends_at, is_active)
SELECT v.message, v.bg, v.fg, v.starts_at::timestamptz, v.ends_at::timestamptz, true
FROM (VALUES
  ('체크인 정책이 변경되었습니다 — 회의 시작 5분 전부터 체크인할 수 있습니다. 리마인드도 시작 5분 전·후 2회로 정비되었습니다.',
   '#E6F2FF', '#1E1E1E', '2026-05-12T00:00:00+09:00', '2026-05-26T23:59:59+09:00'),

  ('반복 예약이 관리자 한정으로 다시 열렸습니다. 정기 회의는 관리자에게 요청해 당해 12월 31일까지 확보할 수 있습니다.',
   '#E6F2FF', '#1E1E1E', '2026-05-28T00:00:00+09:00', '2026-06-11T23:59:59+09:00')
) AS v(message, bg, fg, starts_at, ends_at)
WHERE NOT EXISTS (SELECT 1 FROM announcements a WHERE a.message = v.message);

-- ── 검증 — 전체 공지 시간순 (1차 백필 완료 기준 11건 기대) ────────────────
SELECT to_char(starts_at AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS 시작,
       to_char(ends_at   AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS 종료,
       CASE WHEN is_active AND now() BETWEEN starts_at AND ends_at
            THEN '게시중' ELSE '지난 공지' END AS 상태,
       left(message, 40) AS 내용
FROM announcements ORDER BY starts_at;
