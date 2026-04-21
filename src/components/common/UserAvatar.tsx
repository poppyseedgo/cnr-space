import { useState } from 'react'

interface UserAvatarProps {
  name:       string
  avatarUrl?: string | null
  size?:      number
  bgColor?:   string
  textColor?: string
  fontSize?:  number
  fontWeight?: number   // ← [2026-04-21] 피그마 detail variant (Medium 500) 지원용
  className?: string
}

/**
 * UserAvatar
 * - avatarUrl 있으면 이미지 표시
 * - 없거나 로드 실패 시 이름 첫 글자 이니셜 표시
 *
 * ✅ 변경 이력
 *  - [2026-04-21] fontWeight prop 추가. 기본값 800 유지(기존 동작 보존),
 *    UserChip detail variant에서 Medium(500)으로 override
 */
export function UserAvatar({
  name,
  avatarUrl,
  size       = 36,
  bgColor    = '#111',
  textColor  = '#fff',
  fontSize,
  fontWeight = 800,
  className  = '',
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
        fontWeight,
        lineHeight: 1.3,
      }}
      className={className}
    >
      {initial}
    </div>
  )
}
