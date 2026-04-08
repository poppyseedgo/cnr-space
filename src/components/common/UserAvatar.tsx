import { useState } from 'react'

interface UserAvatarProps {
  name:       string
  avatarUrl?: string | null
  size?:      number
  bgColor?:   string
  textColor?: string
  fontSize?:  number
  className?: string
}

/**
 * UserAvatar
 * - avatarUrl 있으면 이미지 표시
 * - 없거나 로드 실패 시 이름 첫 글자 이니셜 표시
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
    width:          size,
    height:         size,
    borderRadius:   '50%',
    flexShrink:     0,
    overflow:       'hidden',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
  }

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

  return (
    <div
      style={{
        ...baseStyle,
        background: bgColor,
        color:      textColor,
        fontSize:   resolvedFontSize,
        fontWeight: 800,
      }}
      className={className}
    >
      {initial}
    </div>
  )
}
