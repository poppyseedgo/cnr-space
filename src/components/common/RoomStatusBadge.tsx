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

      {/* ── SOON ──
          [2026-05-12 사용자 정책]
          · 시작 10~5분 전: 'chip-soon' (곧 사용) — 기존 그대로
          · 시작 5분 전 ~ 시작 직전: 'chip-checkin-wait' (체크인 대기 중)
              · checkinWaiting=true는 getRoomStatus 내부에서 isCheckinable로 판정 (5분 전 윈도우 + 미체크인)
              · "곧 사용" 칩 자리에 "체크인 대기 중" 칩으로 교체 (양자택일)
              · 카운트다운 + nextStart 칩은 둘 다 동일 표시 */}
      {type === 'SOON' && (
        <>
          {checkinWaiting ? (
            <span className="chip chip-checkin-wait">체크인 대기 중</span>
          ) : (
            <span className="chip chip-soon">
              {minsUntil}분 뒤 사용
            </span>
          )}
          {checkinWaiting && minsUntil !== undefined && (
            <span className="chip chip-neutral">
              {minsUntil}분 뒤 사용
            </span>
          )}
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
