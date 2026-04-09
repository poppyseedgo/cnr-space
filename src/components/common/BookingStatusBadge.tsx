import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  currentUser?: string
  size?:        'sm' | 'md'
}

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

  return (
    <div style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>

      {/* 1. 내 예약 */}
      {isOwner && !b.autoCancelled && (
        <span className="chip chip-mine">내 예약</span>
      )}

      {/* 2. 관리자 강제취소 */}
      {b.cancelledBy === 'admin' && (
        <span className="chip chip-admin">관리자 강제취소</span>
      )}

      {/* 3. 노쇼 */}
      {b.autoCancelled && b.cancelledBy === 'system' && (
        <span className="chip chip-noshow">노쇼</span>
      )}

      {/* 4. 승인 대기 */}
      {b.status === 'pending' && !b.autoCancelled && (
        <span className="chip chip-pending">승인 대기</span>
      )}

      {/* 5. 진행 중 */}
      {isAct && !b.autoCancelled && r && (
        <span className="chip" style={{ background: r.color + '18', color: r.color }}>
          진행 중
        </span>
      )}

      {/* 6. 체크인 대기 */}
      {nci && (
        <span className="chip chip-checkin-wait">체크인 대기</span>
      )}

      {/* 7. 체크인 완료 */}
      {b.checkedIn && isAct && (
        <span className="chip chip-success">체크인 완료</span>
      )}

      {/* 8. 종료 */}
      {isPast && (
        <span className="chip chip-done">종료</span>
      )}

      {/* 9. 조기반납 */}
      {b.earlyEnded && (
        <span className="chip chip-earlyend">조기반납</span>
      )}

      {/* 10. N분 후 */}
      {!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <span className="chip chip-countdown">{tl}분 후</span>
      )}

    </div>
  )
}
