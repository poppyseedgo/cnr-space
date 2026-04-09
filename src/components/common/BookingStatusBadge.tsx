import { AlertTriangle, CheckCircle2, Circle, Clock, User } from 'lucide-react'
import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  currentUser?: string
  size?:        'sm' | 'md'
}

/**
 * BookingStatusBadge
 * 확정 매트릭스 기준 예약 상태 칩 컴포넌트
 *
 * 칩 표시 순서:
 *   1. 내 예약        — isOwner && !autoCancelled
 *   2. 관리자 강제취소 — cancelledBy === 'admin'
 *   3. 노쇼           — autoCancelled && cancelledBy === 'system'
 *   4. 승인 대기      — status === 'pending' && !autoCancelled
 *   5. 진행 중        — isAct (room.color 기반)
 *   6. 체크인 대기    — nci (isAct && !checkedIn)
 *   7. 체크인 완료   — checkedIn && isAct (진행중에만)
 *   8. 종료           — isPast && !autoCancelled
 *   9. 조기반납       — earlyEnded
 *  10. N분 후         — isToday && tl > 0 && tl ≤ 10 (알림 기준)
 */
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

  // ── 상태 파생 ──────────────────────────────────────────────────
  const isAct    = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const nci      = isAct && !b.checkedIn
  const isFuture = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  const isPast   = !isAct && !isFuture && !b.autoCancelled
  const tl       = sm - now
  const isOwner  = !!currentUser && b.user === currentUser

  const ico = size === 'sm' ? 9 : 11

  // 칩이 하나도 없으면 null 반환 (빈 영역 방지)
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

      {/* 1. 내 예약 — 취소/노쇼 상태에서는 숨김 */}
      {isOwner && !b.autoCancelled && (
        <span className="chip chip-mine">
          <User size={ico} strokeWidth={2} />
          내 예약
        </span>
      )}

      {/* 2. 관리자 강제취소 */}
      {b.cancelledBy === 'admin' && (
        <span className="chip chip-admin">
          <AlertTriangle size={ico} strokeWidth={1.8} />
          관리자 강제취소
        </span>
      )}

      {/* 3. 노쇼 — system 자동취소만 */}
      {b.autoCancelled && b.cancelledBy === 'system' && (
        <span className="chip chip-noshow">
          <AlertTriangle size={ico} strokeWidth={1.8} />
          노쇼
        </span>
      )}

      {/* 4. 승인 대기 */}
      {b.status === 'pending' && !b.autoCancelled && (
        <span className="chip chip-pending">
          승인 대기
        </span>
      )}

      {/* 5. 진행 중 — room.color 기반 */}
      {isAct && !b.autoCancelled && r && (
        <span className="chip" style={{ background: r.color + '18', color: r.color }}>
          <Circle size={size === 'sm' ? 6 : 7} fill={r.color} strokeWidth={0} />
          진행 중
        </span>
      )}

      {/* 6. 체크인 대기 — nci (진행중 + 미체크인) */}
      {nci && (
        <span className="chip chip-checkin-wait">
          <Clock size={ico} strokeWidth={1.8} />
          체크인 대기
        </span>
      )}

      {/* 7. 체크인 완료 — 진행중에만 표시 (종료 후에는 종료 칩으로 대체) */}
      {b.checkedIn && isAct && (
        <span className="chip chip-success">
          <CheckCircle2 size={ico} strokeWidth={1.8} />
          체크인 완료
        </span>
      )}

      {/* 8. 종료 — 정상완료 + 조기반납 공통 */}
      {isPast && (
        <span className="chip chip-done">
          종료
        </span>
      )}

      {/* 9. 조기반납 */}
      {b.earlyEnded && (
        <span className="chip chip-earlyend">
          <CheckCircle2 size={ico} strokeWidth={1.8} />
          조기반납
        </span>
      )}

      {/* 10. N분 후 — 오늘, 시작 전, 10분 이내만 */}
      {!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <span className="chip chip-countdown">
          <Clock size={ico} strokeWidth={1.8} />
          {tl}분 후
        </span>
      )}

    </div>
  )
}
