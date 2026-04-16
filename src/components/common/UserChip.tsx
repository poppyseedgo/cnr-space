import { UserAvatar } from './UserAvatar'

interface UserChipProps {
  name:       string
  avatarUrl?: string | null
  variant?:   'sm' | 'md'   // sm: 테이블/인라인  md: 모달/카드
  isAdmin?:   boolean        // true면 아바타 배경색 어둡게
}

const CONFIG = {
  sm: { avatarSize: 20, fontSize: 12, gap: 5 },
  md: { avatarSize: 28, fontSize: 14, gap: 7 },
}

/**
 * UserChip — 아바타 + 이름 공통 컴포넌트
 *
 * variant="sm"  아바타 20px / 이름 12px  →  테이블, 인라인
 * variant="md"  아바타 28px / 이름 14px  →  모달, 카드, 상세
 *
 * pill 형태(참석자 태그)는 AttendeeChip이 담당합니다.
 */
export function UserChip({ name, avatarUrl, variant = 'md', isAdmin = false }: UserChipProps) {
  const { avatarSize, fontSize, gap } = CONFIG[variant]

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap, flexShrink: 0 }}>
      <UserAvatar
        name={name}
        avatarUrl={avatarUrl ?? null}
        size={avatarSize}
        bgColor={isAdmin ? '#111' : '#E6F1FB'}
        textColor={isAdmin ? '#fff' : '#185FA5'}
      />
      <span style={{ fontSize, fontWeight: 500, color: 'var(--color-text-primary, #111)', whiteSpace: 'nowrap' }}>
        {name}
      </span>
    </div>
  )
}
