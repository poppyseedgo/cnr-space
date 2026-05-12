import type { RoomStatus } from '../../types'
import { fmtTimeFull } from '../../utils/time'

interface RoomStatusBadgeProps {
  status: RoomStatus
  /** ← [신규] 관리자 전용(에메랄드) 룸이면 'HR 승인 후 확정' 칩 추가 노출 */
  isAdminRoom?: boolean
}

/**
 * RoomStatusBadge
 * 룸카드/룸모달 공통 상태 뱃지 컴포넌트.
 * getRoomStatus() 반환값 + isAdminRoom을 받아 렌더링.
 *
 * AVAILABLE → 예약가능
 * SOON      → N분 뒤 사용 + HH:MM 부터
 * BUSY      → ● 사용중  [체크인 대기 | 체크인 완료]  [N분 뒤 종료]
 *
 * isAdminRoom=true 일 때 위 상태 앞에 'HR 승인 후 확정' 칩을 항상 노출 (에메랄드룸 표식)
 */
export function RoomStatusBadge({ status, isAdminRoom = false }: RoomStatusBadgeProps) {
  const { type, minsUntil, minsLeft, checkedIn, checkinWaiting, nextStart } = status

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 /* ← [피그마] 칩 간격 4 */, flexWrap: 'wrap' }}>

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
            <span className="rec-dot" style={{ width: 7, height: 7, borderRadius: '50%',
              background: '#EC4899', display: 'inline-block', flexShrink: 0 }} />
            사용중
          </span>
          {checkinWaiting && (
            // ← [2026-05-12] "체크인 대기" → "체크인 대기 중"
            <span className="chip chip-checkin-wait">체크인 대기 중</span>
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

      {/* ← [신규 피그마 195:1071] 에메랄드(관리자 전용) 룸 표식 — 항상 노출 */}
      {isAdminRoom && (
        <span className="chip chip-approval-required">HR 승인 후 확정</span>
      )}

    </div>
  )
}
