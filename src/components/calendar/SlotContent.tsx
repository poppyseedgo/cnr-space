import type { Booking, Room } from '../../types'
import { fmtTSRange } from '../../utils/time'
import { BookingStatusBadge } from '../common/BookingStatusBadge'

interface SlotContentProps {
  booking:     Booking
  room?:       Room | null
  currentUser?: string
  titleColor:  string
  subColor:    string
  /** flex gap (px). Weekly=1.5, Daily=1.5, Timeline=2 */
  gap?:        number
  /** 3번째 줄 표시 텍스트. Weekly=room_name, Daily/Timeline=b.user */
  thirdLine?:  string
}

/**
 * CalendarSlotContent
 * Weekly / Daily / Timeline 슬롯 공통 내부 컨텐츠
 *
 * ┌────────────────────┐
 * │ 제목 (2줄 clamp)   │
 * │ 시간범위            │
 * │ 예약자 or 회의실명  │
 * │ BookingStatusBadge │
 * └────────────────────┘
 */
export function SlotContent({
  booking: b,
  room,
  currentUser = '',
  titleColor,
  subColor,
  gap = 1.5,
  thirdLine,
}: SlotContentProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, overflow: 'hidden', height: '100%' }}>

      {/* 제목 — 2줄 clamp */}
      <div style={{
        fontSize: 10, fontWeight: 600, color: titleColor,
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        lineHeight: 1.3,
      }}>
        {b.title}
      </div>

      {/* 시간 */}
      <div style={{ fontSize: 9, color: subColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {fmtTSRange(b.start_at, b.end_at)}
      </div>

      {/* 예약자 or 회의실명 */}
      {thirdLine && (
        <div style={{ fontSize: 9, color: subColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {thirdLine}
        </div>
      )}

      {/* 상태 뱃지 */}
      <BookingStatusBadge booking={b} room={room ?? undefined} size="xs" currentUser={currentUser} />

    </div>
  )
}
