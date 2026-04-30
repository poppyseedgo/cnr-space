import { useState } from 'react'

interface UserAvatarProps {
  name:       string
  avatarUrl?: string | null
  size?:      number
  bgColor?:   string
  textColor?: string
  fontSize?:  number
  fontWeight?: number   // ← [2026-04-30] override 가능 (기본값 500 유지로 기존 사용처 영향 0)
  className?: string
}

/**
 * UserAvatar
 * - avatarUrl 있으면 이미지 표시
 * - 없거나 로드 실패 시 이름 첫 글자 이니셜 표시
 * ← [피그마 202:1178] 이니셜 폰트 비율 0.38 → 0.5
 *     · 24px 아바타 → 12px 이니셜 (이전 9px, 너무 작음)
 *     · 36px → 18px / 44px → 22px 자동 환산
 * ← [피그마 180:534] 기본값: bg #000, text #E7E7E7, fw 500
 * ← [2026-04-30] fontWeight prop 추가 (헤더 프로필은 400으로 override)
 */
export function UserAvatar({
  name,
  avatarUrl,
  size       = 36,
  bgColor    = '#000',
  textColor  = '#E7E7E7',
  fontSize,
  fontWeight = 500,    // ← 기본값 500 유지 (다른 사용처 영향 0)
  className  = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)

  // ← [피그마] 아바타 대비 이니셜 폰트 50%
  const resolvedFontSize = fontSize ?? Math.round(size * 0.5)
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
        fontWeight,                 // ← [2026-04-30] prop 사용 (기본값 500)
        lineHeight: 1.3,            // ← [피그마] leading 1.3
      }}
      className={className}
    >
      {initial}
    </div>
  )
}
