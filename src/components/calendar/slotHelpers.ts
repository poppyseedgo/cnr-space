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
 *
 * 정책 (박제 정책):
 *  · 활성 예약 (autoCancelled=false) → 표시
 *  · 노쇼 (체크인 없이 start_at+10분 경과 후 시스템 자동 취소) → **박제 표시**
 *    └ "이 시간에 노쇼가 있었다"는 기록을 남기기 위함
 *  · 기한초과 (pending_expired, 시작 전 자동 취소) → **제외** (일반 취소와 동일)
 *    └ 애초에 승인되지 않아 "일어나지 않은 약속"이므로 기록 불필요
 *  · 사용자/관리자 수동 취소 → 제외 (기존)
 *  · 관리자 거절 → 제외 (기존)
 *
 * ← [2026-04-19 P2 v7 hotfix] 기한초과가 일간 뷰에 잔존하던 버그 수정
 *     · 기존: `cancelledBy === 'system'`이면 전부 포함 → 기한초과도 표시됨
 *     · 수정: getSlotState로 isNoshow만 정확히 필터링 (기한초과 분리 후 제외)
 *     · 판별 동기화: getSlotState의 시간축 분리와 완전히 일치
 */
export function isShownInDailyView(b: Booking, now: number, isToday: boolean): boolean {
  // 거절 → 무조건 제외 (autoCancelled 값과 무관)
  if (b.status === 'rejected') return false
  // 활성 예약 (취소 안 됨)
  if (!b.autoCancelled) return true
  // 취소된 예약: 사용자/관리자 수동 취소 → 제외
  if (b.cancelledBy !== 'system') return false
  // 시스템 취소 중: 노쇼만 박제, 기한초과는 제외
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
