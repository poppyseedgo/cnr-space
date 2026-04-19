-- ═══════════════════════════════════════════════════════════════════════════
-- P2 v6 Backfill: pending_expired 알림 누락 건 복구
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 배경:
--   App.tsx useEffect의 expirePendingBooking() 호출이 DB에 auto_cancelled=true로
--   선점하여 auto-cancel-bookings cron의 기존 쿼리(auto_cancelled=false 필터)에서
--   배제됨. 그 결과 pending_expired 알림이 발송되지 않은 과거 17건 존재.
--
-- 배포 순서 (중요):
--   1. 먼저 App.tsx + auto-cancel-bookings 신규 버전 배포 (v6)
--   2. 그 다음 이 SQL 실행
--   → 신버전이 cancelled_by='system' 케이스도 처리 가능한 상태에서 backfill해야
--     다음 cron 실행(최대 5분 후)에 자동으로 이메일/인앱 알림 발송됨
--
-- 선택:
--   [Option A] 알림 발송하면서 정상 처리 → 권장 (아래 실행)
--   [Option B] 알림 없이 조용히 cancelled로 확정 → 주석 처리된 쪽
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── STEP 1: 사전 확인 (실행 전 필수) ─────────────────────────────────────
-- 영향받을 예약 조회. 예상: 약 17건 (쿼리 1 결과와 동일)
SELECT
  id, title, status, auto_cancelled, cancelled_by,
  start_at, user_name,
  EXTRACT(EPOCH FROM (NOW() - start_at))/60 AS minutes_since_start
FROM bookings
WHERE status = 'pending'
  AND auto_cancelled = true
  AND cancelled_by = 'system'
  AND start_at < NOW()
ORDER BY start_at DESC;
-- ✅ 이 결과가 예상(17건 내외)과 일치하는지 확인 후 STEP 2 진행


-- ─── STEP 2 (Option A, 권장): auto_cancelled 되돌려서 cron이 정상 처리하게 함 ──
-- 효과:
--   · 다음 cron 실행(최대 5분) 때 이 건들이 pending_expired 쿼리에 매칭됨
--   · auto-cancel-bookings가 status='cancelled'로 확정하며 send-notification 호출
--   · 예약자 + 참석자 + 관리자 전원에게 이메일/인앱 알림 발송 (지연 발송)
--
-- 주의: 과거 3일 이내 건만 처리 (너무 오래된 건은 알림 의미 없음)
UPDATE bookings
SET
  auto_cancelled = false,
  cancelled_by = NULL
WHERE status = 'pending'
  AND auto_cancelled = true
  AND cancelled_by = 'system'
  AND start_at < NOW()
  AND start_at > NOW() - INTERVAL '3 days'
RETURNING id, title, start_at;


-- ─── STEP 3: 3일 이전의 오래된 건은 알림 없이 조용히 확정 (Option B) ──────
-- 너무 오래된 건은 지금 알림 보내면 오히려 혼란 → status만 cancelled로 확정
UPDATE bookings
SET
  status = 'cancelled'
WHERE status = 'pending'
  AND auto_cancelled = true
  AND cancelled_by = 'system'
  AND start_at <= NOW() - INTERVAL '3 days'
RETURNING id, title, start_at;


-- ─── STEP 4: 배포 후 검증 쿼리 (5분 후 실행) ──────────────────────────────
-- (a) pending 선점 상태 해소 확인
SELECT COUNT(*) AS remaining_stuck
FROM bookings
WHERE status = 'pending'
  AND auto_cancelled = true
  AND start_at < NOW();
-- ✅ 기대: 0

-- (b) pending_expired 알림 발송 수 확인
SELECT COUNT(*) AS recent_notifs, MAX(created_at) AS last_sent
FROM notifications
WHERE type = 'booking_pending_expired'
  AND created_at > NOW() - INTERVAL '15 minutes';
-- ✅ 기대: 10건 이상 (backfill된 예약 × 예약자+참석자+관리자 알림 개수)
