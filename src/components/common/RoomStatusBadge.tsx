import type { RoomStatus } from '../../types'
import { fmtTimeFull } from '../../utils/time'

interface RoomStatusBadgeProps {
  status: RoomStatus
}

/**
 * RoomStatusBadge
 * 룸카드 전용 상태 뱃지 컴포넌트.
 * getRoomStatus() 반환값을 그대로 받아 렌더링.
 *
 * AVAILABLE → ● 예약가능
 * SOON      → N분 뒤 사용 + HH:MM 부터
 * BUSY      → ● 사용중  [체크인 대기 | 체크인 완료]  [N분 뒤 종료]
 */
export function RoomStatusBadge({ status }: RoomStatusBadgeProps) {
  const { type, minsUntil, minsLeft, checkedIn, checkinWaiting, nextStart } = status

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>

      {/* ── AVAILABLE ── */}
      {type === 'AVAILABLE' && (
        <span className="chip chip-available">예약가능</span>
      )}

      {/* ── SOON ── */}
      {type === 'SOON' && (
        <>
          <span className="chip chip-soon">
            {minsUntil}분 뒤 사용
          </span>
          {nextStart && (
            <span className="chip chip-neutral">
              {fmtTimeFull(nextStart)} 부터
            </span>
          )}
        </>
      )}

      {/* ── BUSY ── */}
      {type === 'BUSY' && (
        <>
          <span className="chip chip-busy">
            <span style={{ width: 7, height: 7, borderRadius: '50%',
              background: '#EC4899', display: 'inline-block', flexShrink: 0 }} />
            사용중
          </span>
          {checkinWaiting && (
            <span className="chip chip-checkin-wait">체크인 대기</span>
          )}
          {checkedIn && (
            <span className="chip chip-success">체크인 완료</span>
          )}
          {checkedIn && minsLeft !== undefined && (
            <span className="chip chip-neutral">
              {minsLeft}분 뒤 종료
            </span>
          )}
        </>
      )}

    </div>
  )
}
