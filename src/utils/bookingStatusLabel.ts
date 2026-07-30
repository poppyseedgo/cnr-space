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
import { isExpiredPending } from './pendingStatus'  // ← [2026-07-23] 만료 pending 판정 SSOT
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

  // ①-2 퇴사 취소 — ← [2026-07-30] cancelled_by='departed' 실사용 (process_departure RPC, 20260735)
  //     status='cancelled'라 노쇼 SSOT(④)·기한초과(⑤)와 자연 배타. system/user/admin 어느 분기에도 안 걸림.
  if (b.status === 'cancelled' && b.cancelledBy === 'departed') return '퇴사 취소'

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

  // ⑤-2 기한초과 — DB에 `status='pending'` 그대로 남아 있는 만료 건
  //
  //  🐞 [2026-07-23 버그수정] 과거 에메랄드 예약이 목록에서 '승인 대기'로 표시되던 문제
  //
  //   원인: auto-cancel cron의 pending 처리 블록이 비활성 상태라 DB에는 마감이 지난 건도
  //         `status='pending', auto_cancelled=false` 그대로 남는다.
  //         DetailDrawer 테이블은 loadBookingsByRange로 **DB를 직접 조회**하므로 그 원본을 보고
  //         ⑥번 분기에 걸려 '승인 대기'로 찍혔다.
  //         (반면 상세 모달은 App.tsx tick이 `status:'cancelled'`로 낙관 마킹한 전역 state를
  //          참조하므로 같은 예약이 다른 상태로 보였다 — 화면 간 불일치의 정체)
  //
  //   수정: 마감 경과 여부를 **시각 기준**으로 직접 판정한다. DB 상태나 tick 마킹 여부와
  //         무관하게 항상 같은 답이 나오므로, 어느 화면에서 보든 일치한다.
  //
  //  ⚠ 기한초과 ≠ 노쇼. 기한초과는 '관리자가 승인하지 않은 것'이고
  //    노쇼는 '승인된 예약에 사용자가 나타나지 않은 것'이다. 절대 합치지 말 것.
  if (isExpiredPending(b)) return '기한초과 취소'

  // ⑥ 승인 대기 (Emerald 룸 pending — 마감 전, 관리자가 지금 처리할 수 있는 건)
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * getBookingStatusGroup — **집계·필터 전용** 상태 그룹
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규. 고지 지시: 상세 테이블의 상태 지표에서 '조기반납'을 '사용완료'에 통합.
 *
 * 📌 왜 getBookingStatusLabel을 직접 고치지 않는가
 *    이 함수는 CSV 내보내기·배지 등 여러 곳이 쓰는 확정 SSOT다.
 *    라벨 자체를 바꾸면 CSV의 '상태' 컬럼에서 조기반납 사실이 사라져
 *    원본 데이터로서의 가치가 훼손된다.
 *    → 표시 라벨은 그대로 두고, **집계할 때만 묶는 매핑 계층**을 따로 둔다.
 *      개별 행의 배지는 여전히 '조기반납'을 보여주고, 상단 지표에서만 '사용완료'로 합산된다.
 *
 * 📌 통합 근거
 *    조기반납 = 체크인 후 예정보다 일찍 종료. **회의실을 실제로 사용한 건**이다.
 *    사용완료와 성격이 같으므로 지표에서 갈라놓으면 실사용 건수가 두 갈래로 쪼개져
 *    "얼마나 정상적으로 쓰였나"를 한눈에 볼 수 없다.
 *
 * ⚠ 확장 시 주의
 *    '진행 중'·'체크인 완료'는 아직 종료되지 않은 상태라 통합 대상이 아니다.
 *    통합은 지시받은 항목만 추가한다 — 임의로 묶으면 지표 의미가 조용히 바뀐다.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS_GROUP: Record<string, string> = {
  '조기반납': '사용완료',   // ← [2026-07-23] 실제 사용한 건이므로 사용완료에 합산
}

export function getBookingStatusGroup(b: Booking): string {
  const label = getBookingStatusLabel(b)
  return STATUS_GROUP[label] ?? label
}
