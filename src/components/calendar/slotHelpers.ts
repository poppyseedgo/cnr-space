import { tsMin } from '../../utils/time'
import type { Booking } from '../../types'

/**
 * 캘린더 슬롯 공통 상태 계산
 * Weekly / Daily / Timeline 세 뷰에서 동일하게 사용
 *
 * ✅ 변경 이력
 *  - [2026-04-21 v2.1] auto_cancelled 설계 재정립 반영
 *     · 배경: api.ts와 BookingStatusBadge.tsx가 v2.1 설계로 업데이트됨
 *     · v2.1 DB 규칙:
 *        · User/Admin 취소: status='cancelled' + autoCancelled=false + cancelledBy='user'/'admin'
 *        · Admin 거절:      status='rejected'  + autoCancelled=false + cancelledBy='admin'
 *        · 기한초과(cron):  status='pending'   + autoCancelled=true  + cancelledBy='system'
 *        · 노쇼(cron):      status='confirmed' + autoCancelled=true  + cancelledBy='system' + !checkedIn
 *     · 판별 로직 재설계:
 *        (1) isExpiredPending: status='pending' && autoCancelled && cancelledBy='system' (시간축 제거)
 *        (2) isNoshow: status='confirmed' && autoCancelled && cancelledBy='system' && !checkedIn && !earlyEnded
 *        (3) isShownInDailyView: v2.1 설계 기반으로 명확하게 재작성
 *     · 캘린더 슬롯 정책 (변경 없음):
 *        · 노쇼 → 15분 고정 슬롯 박제 (캘린더 잔존)
 *        · 기한초과/User취소/Admin취소/거절 → 캘린더에서 제외 (시간 점유 해제)
 *     · 설계 문서: 예약상태관리_설계문서_v2.1.md
 *
 *  - [2026-04-19 P2 v7] pending_expired 노쇼 오판 해결 (판별 로직 통일)
 *     · 기존: `isNoshow = autoCancelled && cancelledBy==='system' && status!=='rejected'`
 *             → pending_expired(시스템 취소)도 노쇼로 오분류됨
 *     · 해결: BookingStatusBadge와 동일한 시간축 기반 판별로 통일
 *            · isExpiredPending: system 취소 + status='pending' OR 시작 후 10분 이내
 *            · isNoshow:        system 취소 + 시작 후 10분 경과 + !isExpiredPending
 *     · 단일 진실 원천: 캘린더 3뷰 + BookingStatusBadge 동일 판별 공유
 */

export interface SlotState {
  sm:               number    // start_at 분 단위
  em:               number    // end_at 분 단위
  isExpiredPending: boolean   // 기한초과 취소 (승인 기한 전/직후 system 취소)
  isNoshow:         boolean   // 노쇼 (시작 후 10분 경과 시 system 취소)
  isEnded:          boolean   // 조기 반납
  isAct:            boolean   // 진행 중
  nci:              boolean   // 진행 중 + 미체크인
  isMyBooking:      boolean
}

/**
 * 일간 뷰에 표시할 예약인지 판별
 *
 * 정책 (v2.1):
 *  · 캘린더 슬롯에 남는 유일한 취소 유형 = "노쇼"
 *  · 나머지 취소/거절/기한초과는 모두 캘린더에서 제외 (시간 점유 해제)
 *
 * 제외 대상:
 *  · status='rejected'                           → Admin 거절
 *  · status='cancelled' + cancelledBy='user'     → 사용자 본인 취소
 *  · status='cancelled' + cancelledBy='admin'    → 관리자 강제 취소
 *  · status='pending'   + autoCancelled=true     → 기한초과 (에메랄드 전용)
 *
 * 포함 대상:
 *  · 정상 예약 (status='confirmed' 또는 'pending', autoCancelled=false) → 표시
 *  · 노쇼 (status='confirmed' + autoCancelled=true + cancelledBy='system' + !checkedIn)
 *    → 15분 고정 슬롯으로 박제 표시 (기록 목적)
 *
 * ← [2026-04-21 v2.1] v2.1 설계 반영, status 기반 명확한 필터링
 */
export function isShownInDailyView(b: Booking, now: number, isToday: boolean): boolean {
  // ① 거절 제외 (status로 명확히 판별)
  if (b.status === 'rejected') return false

  // ② 사람 취소 제외 (v2.1: autoCancelled=false이므로 status로 판별)
  if (b.status === 'cancelled') return false   // User/Admin 취소 모두 제외

  // ③ 기한초과 제외 (status='pending' + autoCancelled=true)
  if (b.status === 'pending' && b.autoCancelled) return false

  // ④ 정상 예약 포함 (autoCancelled=false)
  if (!b.autoCancelled) return true

  // ⑤ 남은 건: status='confirmed' + autoCancelled=true
  //    → 노쇼 판정하여 포함 여부 결정 (15분 슬롯으로 박제)
  const st = getSlotState(b, now, isToday, '')
  return st.isNoshow
}

export function getSlotState(
  b: Booking,
  now: number,
  isToday: boolean,
  currentUser = ''
): SlotState {
  const sm = tsMin(b.start_at)
  const em = tsMin(b.end_at)

  // ── 상태 판별 (v2.1 — BookingStatusBadge.tsx와 동일 로직) ──────────
  //
  // ← [2026-04-21 v2.1] 판별 로직 재설계
  //
  //   v2.1 DB 규칙:
  //     · User/Admin 취소: status='cancelled' + autoCancelled=false + cancelledBy='user'/'admin'
  //     · Admin 거절:      status='rejected'
  //     · 기한초과(cron):  status='pending' + autoCancelled=true + cancelledBy='system'
  //     · 노쇼(cron):      status='confirmed'+ autoCancelled=true + cancelledBy='system' + !checkedIn
  //
  //   판별 원칙:
  //     · status 값으로 1차 분기 (rejected/pending/cancelled/confirmed)
  //     · autoCancelled + cancelledBy 조합으로 2차 판별
  //     · 시간축 판별 제거 (now<sm+10 등) — status로 명확히 구분됨

  // ① 기한초과 (status='pending' + autoCancelled + system)
  const isExpiredPending = b.status === 'pending'
                           && b.autoCancelled
                           && b.cancelledBy === 'system'

  // ② 노쇼 (status='confirmed' + autoCancelled + system + !checkedIn + !earlyEnded)
  //    v2.1: !checkedIn 조건 추가 (노쇼의 본질)
  const isNoshow = b.status === 'confirmed'
                   && b.autoCancelled
                   && b.cancelledBy === 'system'
                   && !b.checkedIn
                   && !b.earlyEnded

  const isEnded     = b.earlyEnded
  // ← [v2.1] 진행 중: status='confirmed' 명시 (cancelled 제외)
  //   v2.1에서는 User/Admin 취소도 autoCancelled=false라서
  //   !isNoshow 만으로는 취소된 예약 필터링 불가 → status 조건 추가
  const isAct       = isToday && sm <= now && now < em
                      && b.status === 'confirmed'      // ← [v2.1 추가] cancelled 제외
                      && !isNoshow && !isExpiredPending && !isEnded
  const nci         = isAct && !b.checkedIn
  const isMyBooking = !!currentUser && b.user === currentUser

  return { sm, em, isExpiredPending, isNoshow, isEnded, isAct, nci, isMyBooking }
}

/**
 * 슬롯 텍스트 색상 계산
 *
 * Weekly (dark bg on active):  active → 흰색, ended → 회색, default → room color
 * Daily  (항상 dark #111 bg):  active/normal → 흰색, noshow/expired/ended → 회색
 * Timeline (light bg):         isCan → 회색, default → borderCol
 *
 * ← [P2 v7] isExpiredPending도 noshow와 동일하게 흐릿하게 표시 (둘 다 '버려진' 예약)
 */
export function getSlotColors(opts: {
  variant:   'weekly' | 'daily' | 'timeline'
  isAct:     boolean
  isEnded:   boolean
  isNoshow?: boolean
  isExpiredPending?: boolean
  isCan?:    boolean
  roomColor?: string
  borderCol?: string
}) {
  const { variant, isAct, isEnded, isNoshow = false, isExpiredPending = false,
          isCan = false, roomColor = '#6366F1', borderCol = '#3B82F6' } = opts
  const isCancelledLike = isNoshow || isExpiredPending

  if (variant === 'weekly') {
    return {
      titleColor: isEnded ? '#94A3B8' : isAct ? '#fff' : roomColor,
      subColor:   isEnded ? '#CBD5E1' : isAct ? 'rgba(255,255,255,0.75)' : '#94A3B8',
    }
  }
  if (variant === 'daily') {
    return {
      titleColor: isCancelledLike || isEnded ? '#94A3B8' : '#fff',
      subColor:   isCancelledLike || isEnded ? '#CBD5E1' : '#94A3B8',
    }
  }
  // timeline
  return {
    titleColor: isCan ? '#94A3B8' : isAct ? '#15803D' : '#1D4ED8',
    subColor:   isCan ? '#94A3B8' : '#64748B',
  }
}
