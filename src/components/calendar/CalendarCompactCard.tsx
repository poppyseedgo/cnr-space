// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-04-24] 신규 — 주간/월간 공용 예약 컴팩트 카드
//
//   배경: 주간뷰는 회색 배경의 "컴팩트 카드" 스타일, 월간뷰는 룸 색상 배경 + border-left
//         막대 스타일로 이원화되어 있었음. 월간뷰를 주간뷰와 통일하기 위해
//         주간뷰 카드 규칙을 공통 컴포넌트로 추출.
//
//   스펙 (주간뷰 기존 규칙 그대로):
//     · height: 20px
//     · padding: 0 8px
//     · border-radius: 6px
//     · 오늘: bg #1F232A, text #fff
//     · 그 외: bg #E7E7E7, text #1F232A
//     · 내부: [시간 10px 400 opacity 0.7] + [제목 10px 500 ellipsis] (gap 5)
//
//   사용처:
//     · WeeklyView (CalendarShell.tsx) — 요일 컬럼 × 시간 셀
//     · MonthlyView (CalendarShell.tsx) — 날짜 셀 내부 목록
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { Booking } from '../../types'
import { tsMin, fmt2 } from '../../utils/time'

export interface CalendarCompactCardProps {
  booking:  Booking
  /** 오늘 날짜의 카드면 true — 검정 테마, 아니면 회색 테마 */
  isToday?: boolean
  onClick?: (e: ReactMouseEvent) => void
  /** 카드 외곽 추가 스타일 (flex 정렬 등에 필요 시) */
  style?:   CSSProperties
}

/** timestamptz(KST offset 포함) → "오전 9:00" / "오후 1:30" */
function fmtAmPmFromTS(ts: string): string {
  const m = tsMin(ts)
  const h = Math.floor(m / 60)
  const min = m % 60
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h < 12 ? '오전' : '오후'} ${h12}:${fmt2(min)}`
}

/**
 * 캘린더 컴팩트 예약 카드 (Weekly/Monthly 공통)
 * — 주간뷰 카드 규칙 (높이 20, padding 0·8, radius 6, 시간+제목 한 줄)
 */
export function CalendarCompactCard({
  booking: b,
  isToday = false,
  onClick,
  style,
}: CalendarCompactCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        height: 20, padding: '0 8px', borderRadius: 6,
        background: isToday ? '#1F232A' : '#E7E7E7',
        color:      isToday ? '#FFFFFF' : '#1F232A',
        cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
        ...style,
      }}
    >
      <span style={{
        fontSize: 10, fontWeight: 400, flexShrink: 0, opacity: 0.7, whiteSpace: 'nowrap',
      }}>
        {fmtAmPmFromTS(b.start_at)}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 500,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1,
      }}>
        {b.title}
      </span>
    </div>
  )
}
