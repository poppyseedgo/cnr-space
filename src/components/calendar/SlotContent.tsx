import type { Booking, Room } from '../../types'
import { fmtTSRange } from '../../utils/time'
import { BookingStatusBadge } from '../common/BookingStatusBadge'

// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-04-23] Daily 뷰 Figma 재설계 (242:427) — variant='daily' 신규
//   · 구조: flex justify-between (상단: 제목/시간/예약자 / 하단: 칩 row 우측 정렬)
//   · 스펙: 제목 11px, 서브 10px, gap 4px, 칩 gap 4px (Figma 242:427 준수)
//   · weekly/timeline은 기존 gap 기반 구조 유지 (영향 0)
// ─────────────────────────────────────────────────────────────────────────────

interface SlotContentProps {
  booking:     Booking
  room?:       Room | null
  isAdminRoom?: boolean
  currentUser?: string
  titleColor:  string
  subColor:    string
  /** flex gap (px). Weekly=1.5, Daily(레거시)=1.5, Timeline=2 */
  gap?:        number
  /** 3번째 줄 표시 텍스트. Weekly=room_name, Daily/Timeline=b.user */
  thirdLine?:  string
  /**
   * 레이아웃 variant
   *   · 'daily' — Figma 242:427 스펙: justify-between, 11px/10px, 칩 하단 우측
   *   · 'legacy' (기본) — 기존 세로 gap 구조 (Weekly/Timeline 유지용)
   * ← [2026-04-23] Daily 뷰만 선별적으로 새 스펙 적용, 다른 뷰 영향 없음
   */
  variant?:    'daily' | 'legacy'
}

/**
 * CalendarSlotContent
 * Weekly / Daily / Timeline 슬롯 공통 내부 컨텐츠
 */
export function SlotContent({
  booking: b,
  room,
  isAdminRoom,
  currentUser = '',
  titleColor,
  subColor,
  gap = 1.5,
  thirdLine,
  variant = 'legacy',
}: SlotContentProps) {
  // ─── daily variant: Figma 242:427 구조 ────────────────────────────────────
  // 상단 영역: 제목(11px) / 시간(10px) / 예약자(10px) — gap 4
  // 하단 영역: 상태 칩 row 우측 정렬 — gap 4
  // 컨테이너: justify-between으로 상·하 분리, 슬롯 높이 남으면 중간에 빈공간
  if (variant === 'daily') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        height: '100%', overflow: 'hidden',
      }}>
        {/* 상단: 제목 + 시간 + 예약자 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflow: 'hidden' }}>
          {/* 제목 — 1줄 ellipsis (Figma 242:427 스펙) */}
          <div style={{
            fontSize: 11, fontWeight: 500, color: titleColor,
            lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: "'Pretendard', -apple-system, sans-serif",
          }}>
            {b.title}
          </div>
          {/* 시간 */}
          <div style={{
            fontSize: 10, fontWeight: 500, color: subColor,
            lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            fontFamily: "'Pretendard', -apple-system, sans-serif",
          }}>
            {fmtTSRange(b.start_at, b.end_at)}
          </div>
          {/* 예약자(thirdLine) */}
          {thirdLine && (
            <div style={{
              fontSize: 10, fontWeight: 500, color: subColor,
              lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              fontFamily: "'Pretendard', -apple-system, sans-serif",
            }}>
              {thirdLine}
            </div>
          )}
        </div>

        {/* 하단: 칩 row — 우측 정렬, overflow-clip */}
        {/* BookingStatusBadge는 내부에서 inline-flex + flexWrap으로 칩 렌더 (gap 3 for xs) */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', overflow: 'hidden', width: '100%' }}>
          <BookingStatusBadge booking={b} room={room ?? undefined} isAdminRoom={isAdminRoom} size="xs" currentUser={currentUser} />
        </div>
      </div>
    )
  }

  // ─── legacy variant: 기존 구조 (Weekly / Timeline 유지) ────────────────────
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
      <BookingStatusBadge booking={b} room={room ?? undefined} isAdminRoom={isAdminRoom} size="xs" currentUser={currentUser} />

    </div>
  )
}
