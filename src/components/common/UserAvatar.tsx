import { useState } from 'react'

interface UserAvatarProps {
  name:       string
  avatarUrl?: string | null
  size?:      number       // 기본 36
  bgColor?:   string       // 이니셜 fallback 배경색 (기본 #111)
  textColor?: string       // 이니셜 글자색 (기본 #fff)
  fontSize?:  number       // 이니셜 폰트 크기 (기본 size * 0.38)
  className?: string
}

/**
 * UserAvatar
 * - avatarUrl 있으면 이미지 표시
 * - 없거나 이미지 로드 실패 시 이름 첫 글자 이니셜 표시
 *
 * 사용 예시:
 *   <UserAvatar name={user.name} avatarUrl={user.avatar_url} size={56} />
 *   <UserAvatar name={user.name} avatarUrl={user.avatar_url} size={36} bgColor={isAdmin ? '#111' : '#E2E8F0'} textColor={isAdmin ? '#fff' : '#64748B'} />
 */
export function UserAvatar({
  name,
  avatarUrl,
  size      = 36,
  bgColor   = '#111',
  textColor = '#fff',
  fontSize,
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)

  const resolvedFontSize = fontSize ?? Math.round(size * 0.38)
  const initial          = (name ?? '?').charAt(0).toUpperCase()

  const baseStyle: React.CSSProperties = {
    width:        size,
    height:       size,
    borderRadius: '50%',
    flexShrink:   0,
    overflow:     'hidden',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
  }

  // 이미지가 있고 에러 없으면 이미지 표시
  if (avatarUrl && !imgError) {
    return (
      <div style={baseStyle} className={className}>
        <img
          src={avatarUrl}
          alt={name}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgError(true)}
        />
      </div>
    )
  }

  // 이니셜 fallback
  return (
    <div
      style={{
        ...baseStyle,
        background:  bgColor,
        color:       textColor,
        fontSize:    resolvedFontSize,
        fontWeight:  800,
      }}
      className={className}
    >
      {initial}
    </div>
  )
}
