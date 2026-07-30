/**
 * EmploymentBadge — 아바타 앞 재직 상태 라벨 칩 (SSOT: utils/employment.ts)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 퇴사자 정책 개편 Phase 3
 *      · 확정 요구사항: "해당 직원 아바타 앞에 항상 라벨" — 아바타 좌측 배치 전제
 *      · 재직(active)은 null 반환 → 렌더 안 함 (라벨 없음이 기본)
 *      · 퇴사자는 라벨 + 이름 취소선 — 취소선은 이름을 렌더하는 쪽에서
 *        spec.strike 를 보고 적용한다 (이 컴포넌트는 칩만 담당)
 *
 * 사용:
 *   재직자(users 배열):  <EmploymentBadge user={u} />
 *   퇴사자(이력 화면):   <EmploymentBadge departed />
 *   판정만 필요할 때:    getEmploymentBadge(u) / departedBadge() 직접 사용
 */

import type { CSSProperties } from 'react'
import type { AppUser } from '../../types'
import { getEmploymentBadge, departedBadge, type EmploymentBadgeSpec } from '../../utils/employment'

interface EmploymentBadgeProps {
  user?:     Pick<AppUser, 'employment_status' | 'departure_scheduled_on'> | null
  /** 퇴사자(users 부재) 강제 표시 — user 보다 우선 */
  departed?: boolean
  variant?:  'sm' | 'md'
  style?:    CSSProperties
}

const SIZE = {
  sm: { fontSize: 9,  padding: '1px 5px', radius: 4 },
  md: { fontSize: 10, padding: '2px 6px', radius: 5 },
}

export function EmploymentBadge({ user, departed = false, variant = 'md', style }: EmploymentBadgeProps) {
  const spec: EmploymentBadgeSpec | null = departed ? departedBadge() : getEmploymentBadge(user)
  if (!spec) return null   // active(재직) = 라벨 없음

  const s = SIZE[variant]
  return (
    <span
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        flexShrink:   0,
        fontSize:     s.fontSize,
        fontWeight:   600,
        lineHeight:   1.4,
        padding:      s.padding,
        borderRadius: s.radius,
        color:        spec.color,
        background:   spec.bg,
        whiteSpace:   'nowrap',
        ...style,
      }}
    >
      {spec.label}
    </span>
  )
}

/** 퇴사자 이름 취소선 스타일 — 이름 렌더 측에서 spread (확정: 취소선 전부 적용) */
export const departedNameStyle: CSSProperties = {
  textDecoration:      'line-through',
  textDecorationColor: 'rgba(220,38,38,0.55)',
  color:               '#94A3B8',
}
