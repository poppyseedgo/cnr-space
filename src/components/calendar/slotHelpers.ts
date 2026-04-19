import { tsMin } from '../../utils/time'
import type { Booking } from '../../types'

/**
 * 캘린더 슬롯 공통 상태 계산
 * Weekly / Daily / Timeline 세 뷰에서 동일하게 사용
 *
 * ✅ 변경 이력
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
 * · 활성 예약 (autoCancelled=false)
 * · + 시스템 취소 (노쇼 또는 기한초과) — 이벤트 흔적을 남기기 위해 흐리게 표시
 * · 제외: 사용자/관리자 수동 취소, 관리자 거절
 *
 * ← [P2 v7] 기존 CalendarShell line 125 자체 판별 로직을 여기로 이동.
 *          판별 규칙의 단일 진실 원천 확립.
 */
export function isShownInDailyView(b: Booking): boolean {
  if (!b.autoCancelled) return true   // 활성 예약
  if (b.status === 'rejected') return false
  return b.cancelledBy === 'system'   // system 취소만 포함 (user/admin 수동 취소 제외)
}

export function getSlotState(
  b: Booking,
  now: number,
  isToday: boolean,
  currentUser = ''
): SlotState {
  const sm = tsMin(b.start_at)
  const em = tsMin(b.end_at)

  // ── 시스템 취소 분리 (BookingStatusBadge P2 v7과 동일 로직) ──────
  const isRejected    = b.status === 'rejected'
  const isUserCancel  = b.autoCancelled && b.cancelledBy === 'user'
  const isAdminCancel = b.autoCancelled && b.cancelledBy === 'admin'
                        && !isRejected && !isUserCancel
  const isSystemCancel = b.autoCancelled && b.cancelledBy === 'system'
                         && !isRejected && !isUserCancel && !isAdminCancel
  // 기한초과: status='pending' 유지되거나, cancelled지만 start_at 도달 직후 (10분 이내)
  const isExpiredPending = isSystemCancel
                           && (b.status === 'pending' || now < sm + 10)
  // 노쇼: 그 외 시스템 취소 (start_at + 10분 경과 이후)
  const isNoshow         = isSystemCancel && !isExpiredPending

  const isEnded     = b.earlyEnded
  const isAct       = isToday && sm <= now && now < em
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
