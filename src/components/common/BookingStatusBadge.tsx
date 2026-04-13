import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  currentUser?: string
  /** md = DetailModal·ListView / sm = 소형카드 / xs = 캘린더 슬롯 */
  size?:        'md' | 'sm' | 'xs'
}

/** size별 chip 크기 override — 색상은 chip-* 클래스가 담당 */
const CHIP_SIZE = {
  md: {},
  sm: { fontSize: 9,  padding: '2px 7px'  },
  xs: { fontSize: 8,  padding: '1px 4px', borderRadius: 3 },
} as const

export function BookingStatusBadge({
  booking: b,
  room: r,
  currentUser = '',
  size = 'md',
}: BookingStatusBadgeProps) {
  const now     = nowMinutes()
  const isToday = tsDate(b.start_at) === todayStr()
  const sm      = tsMin(b.start_at)
  const em      = tsMin(b.end_at)

  const isAct    = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const nci      = isAct && !b.checkedIn
  const isFuture = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  const isPast   = !isAct && !isFuture && !b.autoCancelled
  const tl       = sm - now
  const isOwner  = !!currentUser && b.user === currentUser


  const hasAny =
    (isOwner && !b.autoCancelled) ||
    b.cancelledBy === 'admin' ||
    (b.autoCancelled && b.cancelledBy === 'system') ||
    (b.status === 'pending' && !b.autoCancelled) ||
    (isAct && !b.autoCancelled && !!r) ||
    nci ||
    (b.checkedIn && isAct) ||
    isPast ||
    b.earlyEnded ||
    (!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10)

  if (!hasAny) return null

  const cs = CHIP_SIZE[size]
  const gap = size === 'xs' ? 3 : 5

  const C = ({ cls, children, extraStyle }: { cls: string, children: React.ReactNode, extraStyle?: React.CSSProperties }) => (
    <span className={`chip ${cls}`} style={{ ...cs, ...extraStyle }}>{children}</span>
  )

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {isOwner && !b.autoCancelled && <C cls="chip-mine">내 예약</C>}
      {b.cancelledBy === 'admin' && <C cls="chip-admin">관리자 강제취소</C>}
      {b.autoCancelled && b.cancelledBy === 'system' && <C cls="chip-noshow">노쇼</C>}
      {b.status === 'pending' && !b.autoCancelled && <C cls="chip-pending">승인 대기</C>}
      {isAct && !b.autoCancelled && r && (
        <span className="chip" style={{ ...cs, background: r.color + '18', color: r.color }}>진행 중</span>
      )}
      {nci && <C cls="chip-checkin-wait">체크인 대기</C>}
      {b.checkedIn && isAct && <C cls="chip-success">체크인 완료</C>}
      {isPast && <C cls="chip-done">종료</C>}
      {b.earlyEnded && <C cls="chip-earlyend">조기반납</C>}
      {!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <C cls="chip-countdown">{tl}분 후</C>
      )}
    </div>
  )
}
