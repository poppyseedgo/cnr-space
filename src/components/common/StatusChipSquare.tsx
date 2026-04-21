/**
 * StatusChipSquare — BookingDetailModal 헤더 전용 네모칩
 *
 * 피그마 파일: node 180:539 (outline) / node 180:541 (solid)
 * ⚠️ 적용 범위: BookingDetailModal 헤더에만 사용
 *   다른 상태칩(BookingStatusBadge, RoomStatusBadge 등 pill 형)은 유지
 *
 * 스펙:
 *  · border-radius: 8px (기존 .chip pill 999와 구분)
 *  · padding: 4px 10px (outline) / 4px 12px (solid)
 *  · font-size: 11px SemiBold
 *  · line-height: 1.5
 *
 * 2개 variant:
 *  · outline  — border 0.5px #111, text #111, bg transparent  ("내 예약" 등 중립)
 *  · solid    — bg·text 토큰 기반 (상태별 색)                 ("승인 대기" 등 상태)
 *
 * ✅ 변경 이력
 *  - [2026-04-21 신규] BookingDetailModal 피그마 전면 재설계 반영
 */

type ChipVariant = 'outline' | 'solid'

// solid variant color map — tokens.css 칩 색상과 동일 값 참조
const SOLID_COLOR_MAP = {
  'pending':     { bg: '#E6FFB0', text: '#111'    },   // 승인 대기 (에메랄드 키 컬러와 일치)
  'approved':    { bg: '#DCFCE7', text: '#166534' },   // 승인완료
  'confirmed':   { bg: '#DCFCE7', text: '#166534' },   // 확정 (approved alias)
  'rejected':    { bg: '#FEE2E2', text: '#991B1B' },   // 거절됨
  'noshow':      { bg: '#FEE2E2', text: '#B91C1C' },   // 노쇼
  'cancelled':   { bg: '#F1F5F9', text: '#64748B' },   // 예약자 취소
  'expired':     { bg: '#E2E8F0', text: '#64748B' },   // 기한초과
  'admin':       { bg: '#111111', text: '#ffffff' },   // 관리자 강제취소
  'using':       { bg: '#EEF2FF', text: '#6366F1' },   // 사용 중
  'done':        { bg: '#F1F5F9', text: '#64748B' },   // 종료
  'early-end':   { bg: '#EDE9FE', text: '#7C3AED' },   // 조기반납
} as const

export type StatusChipSquareStatus = keyof typeof SOLID_COLOR_MAP

interface StatusChipSquareProps {
  variant: ChipVariant
  status?: StatusChipSquareStatus     // variant='solid'일 때 필수
  children: React.ReactNode
}

export function StatusChipSquare({ variant, status, children }: StatusChipSquareProps) {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: variant === 'outline' ? '4px 10px' : '4px 12px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 600,   // SemiBold
    lineHeight: 1.5,
    whiteSpace: 'nowrap',
  }

  if (variant === 'outline') {
    return (
      <span style={{
        ...base,
        border: '0.5px solid #111',
        background: 'transparent',
        color: '#111',
      }}>
        {children}
      </span>
    )
  }

  // solid
  const color = status ? SOLID_COLOR_MAP[status] : SOLID_COLOR_MAP['pending']
  return (
    <span style={{
      ...base,
      background: color.bg,
      color: color.text,
      border: 'none',
    }}>
      {children}
    </span>
  )
}
