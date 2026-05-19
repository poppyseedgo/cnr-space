import { useState } from 'react'

interface UserAvatarProps {
  name:       string
  avatarUrl?: string | null
  size?:      number
  bgColor?:   string
  textColor?: string
  fontSize?:  number
  fontWeight?: number   // ← [2026-04-30] override 가능 (기본값 500 유지로 기존 사용처 영향 0)
  borderRadius?: number | string   // ← [2026-05-04 STEP 1] 추가: MY PAGE 프로필 카드 64×64 rounded-24 대응 (기본값 '50%' 유지로 기존 사용처 영향 0)
  border?:    string    // ← [2026-05-19] 추가: UserChip 팝오버 72×72 아바타에 1px solid #f7f9fa 테두리 적용 (기본값 undefined 유지로 기존 사용처 영향 0)
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
 * ← [2026-05-04 STEP 1] borderRadius prop 추가 (MY PAGE 64px 프로필 카드: 24px rounded)
 *     · 기본값 '50%' 유지 → 기존 사용처(BookingModal/UserChip/ProfileDropdown/AdminPage 등) 영향 0
 * ← [2026-05-19] border prop 추가 (UserChip 팝오버 72×72: 1px solid #f7f9fa)
 *     · 기본값 undefined 유지 → 기존 사용처 영향 0
 */
export function UserAvatar({
  name,
  avatarUrl,
  size       = 36,
  bgColor    = '#000',
  textColor  = '#E7E7E7',
  fontSize,
  fontWeight = 500,    // ← 기본값 500 유지 (다른 사용처 영향 0)
  borderRadius = '50%', // ← [2026-05-04 STEP 1] 기본값 '50%' (원형) — 기존 동일
  border,               // ← [2026-05-19] 기본값 undefined — 기존 동일
  className  = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)

  // ← [피그마] 아바타 대비 이니셜 폰트 50%
  const resolvedFontSize = fontSize ?? Math.round(size * 0.5)
  const initial          = (name ?? '?').charAt(0).toUpperCase()

  const baseStyle: React.CSSProperties = {
    width:          size,
    height:         size,
    borderRadius,                       // ← [2026-05-04 STEP 1] prop 사용 (기본값 '50%' = 기존 동일)
    border,                             // ← [2026-05-19] prop 사용 (기본값 undefined = 기존 동일)
    flexShrink:     0,
    overflow:       'hidden',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    boxSizing:      'border-box',       // ← [2026-05-19] border 추가 시 외부 size 유지를 위해 명시
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
