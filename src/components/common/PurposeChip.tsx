/**
 * PurposeChip.tsx — 예약 '목적' 표시 전용 칩 (조회 화면 공용)
 *
 * [2026-07-27 목적 Phase 3]
 *   · BookingModal의 선택형 칩(PurposeChips)과 별개 — 이 컴포넌트는 표시 전용.
 *   · Figma 실측 3사이즈 (전부 bg #CAEFFF / 검정 텍스트 / radius 16):
 *       row   (2691:18, 완료 모달 정보행) : padding 4px 14px / 13px Medium
 *       title (2691:12, 상세 모달 타이틀) : padding 4px 12px / 12px Regular
 *       card  (2688:27, 캘린더뷰 카드)    : padding 1px 6px  /  8px Medium
 *   · 다크 카드(Active)에서도 칩 색은 동일 — Figma 2688:23 두 상태 모두 #CAEFFF.
 *   · purpose가 null/미정의(기능 도입 전 예약)면 null 반환 → 호출부 조건 분기 불필요,
 *     레이아웃도 밀리지 않음 (고지 확정: 과거 예약은 칩 생략).
 */
import type { CSSProperties } from 'react'
import { purposeLabelOf } from '../../data/bookingPurpose'

type PurposeChipSize = 'row' | 'title' | 'card'

const SIZE_STYLE: Record<PurposeChipSize, CSSProperties> = {
  row:   { padding: '4px 14px', fontSize: 13, fontWeight: 500 },
  title: { padding: '4px 12px', fontSize: 12, fontWeight: 400 },
  card:  { padding: '1px 6px',  fontSize: 8,  fontWeight: 500 },
}

export function PurposeChip({
  purpose, size, style,
}: {
  purpose?: string | null;
  size: PurposeChipSize;
  style?: CSSProperties;   // 배치용 여백(margin 등)만 — 색/폰트 오버라이드 금지
}) {
  const label = purposeLabelOf(purpose)
  if (!label) return null   // 과거 예약(NULL)·미정의 코드 → 칩 생략
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: '#CAEFFF', borderRadius: 16,
      color: '#000', lineHeight: 1.5, whiteSpace: 'nowrap',
      fontFamily: 'Pretendard, sans-serif',
      verticalAlign: 'middle',   // 타이틀 텍스트 플로우 안(inline)에서 세로 중앙 정렬
      flexShrink: 0,
      ...SIZE_STYLE[size],
      ...style,
    }}>
      {label}
    </span>
  )
}
