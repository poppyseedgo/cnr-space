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
  booking_created_on_behalf:"#16A34A",  // ← [2026-06-12] 대리 예약 — 생성 계열 그린
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
  booking_owner_changed:    "#4F46E5",  // ← [2026-06-12] 예약자 지정 — 인디고(긍정/지정)
  booking_former_booker:    "#64748B",  // ← [2026-06-12] 예약자 해제 — 회색(중립/상실)
  checkin_reminder_10:      "#0891B2",
  checkin_required:         "#16A34A",
  checkin_warning:          "#EF4444",

  // ── 도서관 (← [2026-07-20] 신규) ────────────────────────────────────────
  //   · 대여/연장 = 인디고 계열(긍정·확정)
  //   · 반납 임박 = 앰버(주의) → 당일 = 주황(강한 주의) → 연체 = 빨강(경고)
  //     단계가 올라갈수록 색이 강해져 벨 목록에서 긴급도가 한눈에 구분된다.
  book_borrowed:            "#4F46E5",  // 대여 확정 — 인디고
  book_extended:            "#4F46E5",  // 연장 완료 — 인디고
  book_due_tomorrow:        "#D97706",  // 반납 1일 전 — 앰버
  book_due_today:           "#EA580C",  // 반납 당일 — 주황
  book_overdue:             "#DC2626",  // 연체중 — 빨강
  book_started:             "#4338CA",  // 대여 시작(예약 도래) — 인디고 진하게 (← [2026-07-21])
  book_penalty_applied:     "#DC2626",  // 연체 제재 확정 — 빨강 (← [2026-07-21])
  book_penalty_cleared:     "#16A34A",  // 제재 해제 — 그린 (← [2026-07-21])
  noshow_penalty_applied:   "#DC2626",  // 노쇼 이용 제재 발생 — 빨강 (← [2026-08-10] 도서 제재와 동일 매핑)
  noshow_penalty_cleared:   "#16A34A",  // 노쇼 이용 제재 해제 — 그린 (← [2026-08-10])
  // ← [2026-07-23] 대여 접수 → 도서 담당 관리자. 관리자 액션 계열이라
  //   대여자용 인디고(#4F46E5)와 구분되는 슬레이트 블루를 쓴다.
  book_checkout_created:    "#4338CA",

  // ── 대여 신청/승인 (← [2026-07-22]) ────────────────────────────────────
  // ← [2026-07-21] 승인 폐지로 신규 발송 없음. 과거 알림 이력 렌더링용으로 유지.
  book_requested:           "#D97706",  // [폐지] 신청 접수
  book_request_approved:    "#16A34A",  // [폐지] 승인
  book_request_rejected:    "#DC2626",  // [폐지] 거절
};

/** type별 색상 반환 (등록되지 않은 type은 fallback 회색) */
export function getNotificationColor(type: string): string {
  return NOTIFICATION_TYPE_COLORS[type] ?? "#64748B";
}
