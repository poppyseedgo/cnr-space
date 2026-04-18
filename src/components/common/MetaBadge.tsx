/**
 * MetaBadge — 예약의 메타 속성 뱃지 묶음
 *
 * 상태 뱃지(BookingStatusBadge)와 구분되는 "예약 본연의 속성" 표시용.
 * 예: 반복 예약인가? / 내가 참석자인가?
 *
 * ✅ 변경 이력
 *  - [2026-04-18 신규] HomeView·BookingListTable에 인라인으로 흩어져있던
 *    '반복'(2곳, 서로 색이 달랐음) / '참석자'(1곳) 뱃지를 공통화
 *    · 반복 뱃지 색상: 민트(#E1F5EE/#0F6E56)로 통일
 *    · 참석자 뱃지 색상: 연초록(#F0FDF4/#15803D) 기존 유지
 *  - [2026-04-18 아이콘 제거] recurring 라벨에서 🔁 이모지 제거
 *    · 사유: 뱃지는 색상·텍스트로 충분히 의미 전달, 장식 이모지는 시각 노이즈
 */

export type MetaBadgeType = 'recurring' | 'guest'

interface MetaBadgeProps {
  type: MetaBadgeType
  /** 크기: xs(HomeView 소형카드용) / sm(리스트·테이블용) */
  size?: 'xs' | 'sm'
}

const LABEL: Record<MetaBadgeType, string> = {
  recurring: '반복',      // ← [변경] '🔁 반복' → '반복'
  guest:     '참석자',
}

const CLASS: Record<MetaBadgeType, string> = {
  recurring: 'meta-recurring',
  guest:     'meta-guest',
}

export function MetaBadge({ type, size = 'sm' }: MetaBadgeProps) {
  const sizeClass = size === 'xs' ? 'meta-badge--xs' : ''
  return (
    <span className={`meta-badge ${sizeClass} ${CLASS[type]}`.trim()}>
      {LABEL[type]}
    </span>
  )
}
