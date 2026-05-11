/**
 * noshow.ts — 노쇼 판별 단일 진실 원천 (SSOT)
 *
 * ✅ 변경 이력
 *  - [2026-05-11 Phase 2] 신규 생성 — 6곳 분산 → 단일 함수로 통일
 *    · 통일 대상 (불일치 4 + DRY 5):
 *      ❶ AdminPage.tsx L186 (AdminApprovals)        ← autoCancelled 룰 (불일치)
 *      ❷ AdminPage.tsx L783 (AdminDashboard)        ← autoCancelled 룰 (불일치)
 *      ❸ AdminPage.tsx L1073 (AdminBookings)        ← autoCancelled + admin guard (불일치)
 *      ❹ BookingListTable.tsx L35                   ← autoCancelled + pending/rejected guard (불일치)
 *      ❺ MyBookingTable.tsx L61                     ← 확정 룰 동일 (DRY)
 *      ❻ MyPage.tsx L200 (isNoshowBooking)          ← 확정 룰 동일 (DRY)
 *      ❼ slotHelpers.ts L127                        ← 확정 룰 동일 (DRY)
 *      ❽ RoomDetailModal.tsx L273                   ← 확정 룰 동일 (DRY)
 *    · 통일 제외: BookingStatusBadge.tsx L186 — 칩 렌더 시간 인지 로직 (다른 컨셉)
 *
 * 📌 확정 룰 (userMemories 명시 — 절대 변경 금지)
 *    isNoshow = status === 'confirmed'
 *            && cancelledBy === 'system'
 *            && !checkedIn
 *
 *    · auto_cancelled는 노쇼 판정에 사용 금지 (룰 명시)
 *    · 컬럼명 snake_case 원칙 — types.ts에서 camelCase 매핑되어 들어옴
 *
 * 📌 옛 룰(autoCancelled 기반)과의 의미 차이
 *    · markNoshow API (api.ts:611) 결과 데이터:
 *        status='confirmed' (유지) / cancelled_by='system' (set) /
 *        auto_cancelled=true (set, 하위 호환) / checked_in=false / early_ended=false
 *      → 두 룰 모두 markNoshow 결과를 잡음 (정상 노쇼는 동일하게 판정)
 *
 *    · 차이가 발생하는 데이터:
 *        ⓐ status='cancelled' + auto_cancelled=true + cancelled_by='system' (cron ③ 시절 데이터)
 *           - 옛 룰: 노쇼로 판정 ✓
 *           - 확정 룰: 노쇼 아님 (status='cancelled' 라서) ✗
 *           - 의미: cron ②③ 비활성화 후 contaminated 데이터로 분류, 노쇼 통계에서 제외 — 더 정확
 *           - 배경: "noshow HOTFIX v3"에서 contaminated 49 records 정리 완료 (userMemories)
 *
 *        ⓑ status='cancelled' + auto_cancelled=true + cancelled_by='admin' (관리자 강제취소)
 *           - 옛 룰(L186/L783): 노쇼로 판정 ✗ (강제취소가 노쇼로 잡힘 — 버그)
 *           - 옛 룰(L1073): 노쇼 아님 (cancelledBy!=='admin' 가드 있음)
 *           - 확정 룰: 노쇼 아님 (status='cancelled' 라서, 자동 분리)
 *           - 의미: 확정 룰은 별도 guard 없이도 강제취소 자동 분리 — 가드 제거 가능
 *
 *        ⓒ status='confirmed' + cancelled_by='system' + auto_cancelled=false + !checkedIn
 *           - 옛 룰: 노쇼 아님 (autoCancelled=false 라서)
 *           - 확정 룰: 노쇼 판정 ✓
 *           - 의미: markNoshow는 항상 auto_cancelled=true도 함께 set 하므로 이론적으로 거의 없음
 *
 * 📌 영향도 (배포 전 비교 SQL 함께 제공)
 *    · AdminDashboard 노쇼율 → 변동 가능 (contaminated 데이터 제외)
 *    · AdminBookings 노쇼 카운트 → 변동 가능 (동일 사유)
 *    · BookingListTable 노쇼 카운트 → 변동 가능 (동일 사유)
 *    · 정상 노쇼 케이스는 동일 판정 — 통일 후에도 일관성 보장
 */

import type { Booking } from '../types'

/**
 * isNoshow — 예약이 노쇼인지 판별
 *
 * @param b - Booking 객체 (camelCase 필드: status / cancelledBy / checkedIn)
 * @returns 노쇼 여부
 *
 * @example
 * ```typescript
 * const noshowBookings = bookings.filter(isNoshow)
 * const noshowRate = past.length > 0
 *   ? Math.round(past.filter(isNoshow).length / past.length * 100)
 *   : 0
 * ```
 */
export function isNoshow(b: Booking): boolean {
  return b.status === 'confirmed'
      && b.cancelledBy === 'system'
      && !b.checkedIn
}
