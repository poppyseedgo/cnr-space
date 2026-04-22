import type { RoomStatus } from '../../types'
import { fmtTimeFull } from '../../utils/time'

interface RoomStatusBadgeProps {
  status: RoomStatus
  isAdminOnly?: boolean   // ← [2026-04-21] 에메랄드룸(관리자 승인 필요) 여부
}

/**
 * RoomStatusBadge
 * 룸카드 전용 상태 뱃지 컴포넌트.
 * getRoomStatus() 반환값을 그대로 받아 렌더링.
 *
 * AVAILABLE → ● 예약가능 [승인 후 확정(에메랄드)]
 * SOON      → N분 뒤 사용 + HH:MM 부터 [승인 후 확정(에메랄드)]
 * BUSY      → ● 사용중  [체크인 대기 | 체크인 완료]  [N분 뒤 종료] [승인 후 확정(에메랄드)]
 *
 * ✅ 변경 이력
 *  - [2026-04-21] isAdminOnly prop 추가 — 에메랄드룸이면 상태 무관 "승인 후 확정" 칩 항상 표시
 *    (피그마 node 195:1071 스펙)
 */
export function RoomStatusBadge({ status, isAdminOnly = false }: RoomStatusBadgeProps) {
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
            <span className="rec-dot" style={{ width: 7, height: 7, borderRadius: '50%',
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

      {/* ── [2026-04-21] 에메랄드룸 "승인 후 확정" 칩 — 상태 무관 항상 표시 ── */}
      {/* 피그마 node 195:1071: bg #E6FFB0, text #111, fs 11 SemiBold, radius 24, padding 4px 12px */}
      {isAdminOnly && (
        <span className="chip chip-admin-approval">승인 후 확정</span>
      )}

    </div>
  )
}
