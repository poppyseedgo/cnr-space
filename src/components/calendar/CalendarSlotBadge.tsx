// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-04-23] 신규 — 캘린더 Daily 뷰 슬롯 전용 상태 뱃지
//   배경: 전역 BookingStatusBadge는 홈/마이페이지/룸상세 등 모든 화면 공통 사용
//         Daily 슬롯만을 위한 Figma 신규 스펙(242:427 컨텐츠 + 242:608 내 예약 +
//         242:610 사용완료 #c4edff)을 전역에 적용하면 타 화면 영향이 너무 큼
//   해결: Daily 슬롯 전용 뱃지 파일을 분리해 독립적으로 관리
//   스펙 (모든 뱃지 공통):
//     · 크기: px-[4px] py-px, rounded-[4px]
//     · 폰트: 9px Pretendard Medium, leading-[1.5]
//   색상 (Figma 기준):
//     · 내 예약(mine):     bg #fff / text #000  (242:608)
//     · 사용완료(done):    bg #C4EDFF / text #000  (242:610)
//     · 조기반납(earlyEnd): bg #EDE9FE / text #7C3AED  (242:437)
//     · 승인완료(approved): bg #E6FFB0 / text #000  (242:446)
//     · 노쇼(noshow):      bg #FFD1D1 / text #DE0707  (242:545)
// ─────────────────────────────────────────────────────────────────────────────

import type { CSSProperties, ReactNode } from 'react'

export type DailySlotBadgeType =
  | 'mine'        // 내 예약
  | 'done'        // 사용완료
  | 'earlyEnd'    // 조기반납
  | 'approved'    // 승인완료
  | 'noshow'      // 노쇼

// 뱃지 타입별 색상 정의 (Figma 스펙)
const STYLE_MAP: Record<DailySlotBadgeType, { bg: string; text: string; label: string }> = {
  mine:     { bg: '#FFFFFF', text: '#000000', label: '내 예약'   },
  done:     { bg: '#C4EDFF', text: '#000000', label: '사용완료'  },
  earlyEnd: { bg: '#EDE9FE', text: '#7C3AED', label: '조기반납'  },
  approved: { bg: '#E6FFB0', text: '#000000', label: '승인완료'  },
  noshow:   { bg: '#FFD1D1', text: '#DE0707', label: '노쇼'      },
}

interface CalendarSlotBadgeProps {
  type: DailySlotBadgeType
  /** 라벨 오버라이드 (기본값은 STYLE_MAP의 label) */
  label?: ReactNode
  style?: CSSProperties
}

/**
 * Daily 뷰 슬롯 전용 상태 뱃지 (Figma 242:608 · 242:610 · 242:437 · 242:446 · 242:545)
 *
 * 사용처: CalendarSlotCard 내부 칩 row
 * 독립성: 전역 BookingStatusBadge와 별개 — 이 컴포넌트 변경이 타 화면에 영향 없음
 *
 * 사용 예:
 *   <CalendarSlotBadge type="mine" />
 *   <CalendarSlotBadge type="done" />
 *   <CalendarSlotBadge type="earlyEnd" />
 */
export function CalendarSlotBadge({ type, label, style }: CalendarSlotBadgeProps) {
  const s = STYLE_MAP[type]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1px 4px',
        borderRadius: 4,
        background: s.bg,
        color: s.text,
        fontSize: 9,
        fontWeight: 500,
        lineHeight: 1.5,
        fontFamily: "'Pretendard', -apple-system, sans-serif",
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      {label ?? s.label}
    </span>
  )
}
