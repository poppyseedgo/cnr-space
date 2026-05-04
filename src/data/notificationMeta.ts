/**
 * notificationMeta.ts — 알림 type별 시각 메타데이터
 *
 * ✅ 변경 이력
 *  - [2026-05-04] App.tsx NotificationBell 인라인 typeColors 객체 분리 (Phase 1+2 Step 3)
 *      · 원본: App.tsx L1647~1662 인라인 객체
 *      · 분리 이유: 추후 MyPage·AdminPage 알림 영역 등에서도 재사용 가능한 메타데이터
 *      · 데이터 무수정 (key/value 그대로 이전)
 *
 * 알림 type 도메인 (메모리 기반):
 *  · 기본 booking 라이프사이클: created, pending, approved, rejected, cancelled,
 *                                admin_cancelled, checkin, early_end, noshow, expired, updated
 *  · 체크인 알림: checkin_reminder_10, checkin_required, checkin_warning
 *
 * 색상 의미:
 *  · 녹색 (#16A34A): 긍정 액션 (생성/승인/체크인 필수)
 *  · 빨강 (#DC2626/#EF4444): 거절/관리자 취소/노쇼/체크인 경고
 *  · 파랑 (#2563EB/#0891B2): 정보성 (체크인 완료/리마인더/수정)
 *  · 주황 (#D97706): 대기 (pending)
 *  · 회색 (#64748B/#94A3B8): 중성 (사용자 취소/만료)
 *  · 보라 (#7C3AED): 조기 반납
 */

export const NOTIFICATION_TYPE_COLORS: Record<string, string> = {
  booking_created:          "#16A34A",
  booking_pending:          "#D97706",
  booking_approved:         "#16A34A",
  booking_rejected:         "#DC2626",
  booking_cancelled:        "#64748B",
  booking_admin_cancelled:  "#DC2626",  // 관리자 강제취소 — 빨간색
  booking_checkin:          "#2563EB",
  booking_early_end:        "#7C3AED",
  booking_noshow:           "#EF4444",
  booking_expired:          "#94A3B8",
  booking_updated:          "#0891B2",
  checkin_reminder_10:      "#0891B2",
  checkin_required:         "#16A34A",
  checkin_warning:          "#EF4444",
};

/** type별 색상 반환 (등록되지 않은 type은 fallback 회색) */
export function getNotificationColor(type: string): string {
  return NOTIFICATION_TYPE_COLORS[type] ?? "#64748B";
}
