/**
 * bookingStatusLabel.ts — 예약 상태 단일 라벨 SSOT
 *
 * ✅ 생성: 2026-05-28
 *
 * 📌 목적
 *    CSV 내보내기·텍스트 표시 등 "단일 라벨"이 필요한 곳을 위한 SSOT.
 *    BookingStatusBadge는 칩을 다중 노출(예: '체크인 완료' + '진행 중')하므로
 *    CSV/엑셀 등에 그대로 쓸 수 없음 → 우선순위 1개만 반환하는 헬퍼 필요.
 *
 * 📌 우선순위 (BookingStatusBadge chipList push 순서 1:1 정렬)
 *    ① 거절됨 (rejected)
 *    ② 예약자 취소 (status='cancelled' && cancelledBy='user')
 *    ③ 관리자 강제취소 (autoCancelled && cancelledBy='admin')
 *    ④ 노쇼 (isNoshow SSOT)
 *    ⑤ 기한초과 취소 (autoCancelled && cancelledBy='system' && status='cancelled')
 *    ⑥ 승인 대기 (status='pending')
 *    ⑦ 조기반납 (earlyEnded)
 *    ⑧ 진행 중 (checkedIn && 시작~종료 구간)
 *    ⑨ 체크인 완료 (checkedIn && 시작 전 또는 종료 후)  ← [2026-05-28 isCheckedInWaiting 신설과 연계]
 *    ⑩ 사용완료 (미체크인 + 종료 후)
 *    ⑪ 예약확정 (그 외 confirmed, 폴백)
 *
 * 📌 isNoshow SSOT 사용 — 옛 룰(autoCancelled && !checkedIn && !earlyEnded) 절대 금지
 *    · userMemories 확정 룰: status='confirmed' && cancelledBy='system' && !checkedIn
 *    · AdminPage DetailDrawer L320 인라인 옛 룰이 본 SSOT 대체 대상
 *
 * 📌 사용처
 *    · AdminPage DetailDrawer CSV 내보내기 (L282)
 *    · 향후 다른 CSV/엑셀 라벨 분기에 재사용 가능
 */

import type { Booking } from '../types'
import { isNoshow } from './noshow'
import { tsMin, tsDate, nowMinutes, todayStr } from './time'

/**
 * getBookingStatusLabel — 예약의 단일 상태 라벨 반환
 *
 * @param b - Booking 객체 (camelCase 필드)
 * @returns 우선순위 가장 높은 라벨 1개 (예: '노쇼', '예약자 취소', '진행 중' 등)
 *
 * @example
 * ```typescript
 * const csvRows = bookings.map(b => ({ ..., 상태: getBookingStatusLabel(b) }))
 * ```
 */
export function getBookingStatusLabel(b: Booking): string {
  // ① 거절됨 (최우선 — status==='rejected'이면 다른 분기 평가 불필요)
  if (b.status === 'rejected') return '거절됨'

  // ② 예약자 취소 (사용자 직접 취소)
  //    BookingStatusBadge L166과 동일 공식 (autoCancelled 가드 없음 — Option A 2026-05-06)
  if (b.status === 'cancelled' && b.cancelledBy === 'user') return '예약자 취소'

  // ③ 관리자 강제취소 (rejected는 위에서 이미 처리됨)
  if (b.autoCancelled && b.cancelledBy === 'admin') return '관리자 강제취소'

  // ④ 노쇼 (SSOT 사용 — status='confirmed' && cancelledBy='system' && !checkedIn)
  if (isNoshow(b)) return '노쇼'

  // ⑤ 기한초과 취소 (Emerald pending 자동취소 → status='cancelled' + cancelledBy='system')
  //    노쇼와 ④에서 자동 배타 (노쇼는 status='confirmed', 기한초과는 status='cancelled')
  if (b.autoCancelled && b.cancelledBy === 'system' && b.status === 'cancelled') {
    return '기한초과 취소'
  }

  // ⑥ 승인 대기 (Emerald 룸 pending — 자동취소되지 않은 진짜 대기)
  if (b.status === 'pending' && !b.autoCancelled) return '승인 대기'

  // ⑦ 조기반납 (체크인 후 조기 종료)
  if (b.earlyEnded) return '조기반납'

  // ⑧ ⑨ ⑩ ⑪ — checkedIn 여부 + 시간 기준 분기
  const sm = tsMin(b.start_at)
  const em = tsMin(b.end_at)
  const now = nowMinutes()
  const isToday = tsDate(b.start_at) === todayStr()
  const isFuture = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  const isAct = isToday && sm <= now && now < em
  const isPast = !isAct && !isFuture

  if (b.checkedIn) {
    if (isAct)  return '진행 중'       // ⑧ 체크인 완료 + 진행 중 → '진행 중' 우선
    if (isPast) return '사용완료'      // 체크인 후 종료
    return '체크인 완료'                // ⑨ 체크인 후 시작 전 (isCheckedInWaiting 상태)
  }

  // 미체크인
  if (isPast) return '사용완료'        // ⑩ 미체크인 + 종료 후 (사실상 데이터 오염 — 정상이라면 노쇼 cron이 처리)
  if (isAct)  return '진행 중'         // 진행 중인데 미체크인 (체크인 윈도우 안)

  // ⑪ 폴백: 미래 confirmed = 예약확정
  return '예약확정'
}
