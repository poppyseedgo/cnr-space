import { AlertTriangle, CheckCircle2, Circle, Clock, User, XCircle } from 'lucide-react'
import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room        // 진행 중 뱃지에 room.color 사용
  currentUser?: string      // 내 예약 뱃지 표시 여부
  /** 'md' = DetailModal 칩 크기(default) / 'sm' = MyPage 카드 소형 */
  size?:        'sm' | 'md'
}

/**
 * BookingStatusBadge
 * 예약 상태 뱃지 공통 컴포넌트.
 *
 * 표시 우선순위:
 *   1. 내 예약 (amber)
 *   2. 관리자 강제취소 (black)
 *   3. 자동취소 (neutral)
 *   4. 체크인 완료 (green)
 *   5. 조기 반납 (purple)
 *   6. 진행 중 (room.color)
 *   7. 승인 대기 (yellow)
 *   8. 거절됨 (red)
 *   9. N분 후 — 10분 이내만 표시 (indigo)
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
  const isAct   = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const tl      = sm - now   // 시작까지 남은 분
  const isOwner = !!currentUser && b.user === currentUser

  const ico = size === 'sm' ? 9 : 11

  return (
    <div style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>

      {/* 1. 내 예약 */}
      {isOwner && (
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

      {/* 3. 자동취소 (노쇼 포함) */}
      {b.autoCancelled && b.cancelledBy !== 'admin' && (
        <span className="chip chip-neutral">
          <XCircle size={ico} strokeWidth={1.8} />
          자동취소
        </span>
      )}

      {/* 4. 체크인 완료 */}
      {b.checkedIn && (
        <span className="chip chip-success">
          <CheckCircle2 size={ico} strokeWidth={1.8} />
          체크인 완료
        </span>
      )}

      {/* 5. 조기 반납 */}
      {b.earlyEnded && (
        <span className="chip chip-earlyend">
          <CheckCircle2 size={ico} strokeWidth={1.8} />
          조기 반납
        </span>
      )}

      {/* 6. 진행 중 */}
      {isAct && !b.autoCancelled && r && (
        <span className="chip" style={{ background: r.color + '18', color: r.color }}>
          <Circle size={size === 'sm' ? 6 : 7} fill={r.color} strokeWidth={0} />
          진행 중
        </span>
      )}

      {/* 7. 승인 대기 */}
      {b.status === 'pending' && !b.autoCancelled && (
        <span className="chip chip-pending">
          승인 대기
        </span>
      )}

      {/* 8. 거절됨 */}
      {b.status === 'rejected' && (
        <span className="chip chip-danger">
          거절됨
        </span>
      )}

      {/* 9. N분 후 — 오늘, 시작 전, 10분 이내만 표시 */}
      {!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <span className="chip chip-countdown">
          <Clock size={ico} strokeWidth={1.8} />
          {tl}분 후
        </span>
      )}

    </div>
  )
}
