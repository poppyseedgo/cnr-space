import { tsMin } from '../../utils/time'
import type { Booking } from '../../types'

/**
 * 캘린더 슬롯 공통 상태 계산
 * Weekly / Daily / Timeline 세 뷰에서 동일하게 사용
 */
export function getSlotState(
  b: Booking,
  now: number,
  isToday: boolean,
  currentUser = ''
) {
  const sm = tsMin(b.start_at)
  const em = tsMin(b.end_at)
  const isNoshow    = b.autoCancelled && b.cancelledBy !== 'user'
  const isEnded     = b.earlyEnded
  const isAct       = isToday && sm <= now && now < em && !isNoshow && !isEnded
  const nci         = isAct && !b.checkedIn
  const isMyBooking = !!currentUser && b.user === currentUser
  return { sm, em, isNoshow, isEnded, isAct, nci, isMyBooking }
}

/**
 * 슬롯 텍스트 색상 계산
 *
 * Weekly (dark bg on active):  active → 흰색, ended → 회색, default → room color
 * Daily  (항상 dark #111 bg):  active/normal → 흰색, noshow/ended → 회색
 * Timeline (light bg):         isCan → 회색, default → borderCol
 */
export function getSlotColors(opts: {
  variant:   'weekly' | 'daily' | 'timeline'
  isAct:     boolean
  isEnded:   boolean
  isNoshow?: boolean
  isCan?:    boolean
  roomColor?: string
  borderCol?: string
}) {
  const { variant, isAct, isEnded, isNoshow = false, isCan = false, roomColor = '#6366F1', borderCol = '#3B82F6' } = opts

  if (variant === 'weekly') {
    return {
      titleColor: isEnded ? '#94A3B8' : isAct ? '#fff' : roomColor,
      subColor:   isEnded ? '#CBD5E1' : isAct ? 'rgba(255,255,255,0.75)' : '#94A3B8',
    }
  }
  if (variant === 'daily') {
    return {
      titleColor: isNoshow || isEnded ? '#94A3B8' : '#fff',
      subColor:   isNoshow || isEnded ? '#CBD5E1' : '#94A3B8',
    }
  }
  // timeline
  return {
    titleColor: isCan ? '#94A3B8' : isAct ? '#15803D' : '#1D4ED8',
    subColor:   isCan ? '#94A3B8' : '#64748B',
  }
}
