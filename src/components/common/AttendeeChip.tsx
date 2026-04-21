import { X } from 'lucide-react'
import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

/**
 * AttendeeChip — 참석자 칩
 *
 * variant:
 *  - pill   (기본): 기존 동작. 배경 pill + 아바타 20 + 이름 12. BookingModal 참석자 입력 등에서 사용
 *  - plain  [2026-04-21 신규]: BookingDetailModal 참석자 그리드 전용
 *           배경 없음, 아바타 24 bg #000 + 이름 14 Medium (UserChip detail variant 위임)
 *           피그마 node 202:1184
 *
 * ✅ 변경 이력
 *  - [2026-04-18 스타일 정리] 배경색 하드코딩 → var(--color-attendee-bg) 토큰
 *  - [2026-04-21] variant prop 추가 (pill | plain)
 *    DetailModal 참석자 그리드에서 plain 사용
 */

interface AttendeeChipProps {
  name:       string
  avatarUrl?: string | null
  dept?:      string
  userInfo?:  AppUser
  onRemove?:  () => void
  variant?:   'pill' | 'plain'
}

export function AttendeeChip({ name, avatarUrl, userInfo, onRemove, variant = 'pill' }: AttendeeChipProps) {
  const canClick = !!userInfo && !onRemove

  // plain variant: 배경/padding 없이 UserChip detail 그대로 사용 (BookingDetailModal 전용)
  if (variant === 'plain') {
    return (
      <UserChip
        name={name}
        avatarUrl={avatarUrl}
        variant="detail"
        userInfo={canClick ? userInfo : undefined}
      />
    )
  }

  // pill variant (기존): 배경 pill + 소형 아바타 + X버튼 선택적
  return (
    <div
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          4,
        background:   'var(--color-attendee-bg)',
        padding:      '3px 8px 3px 4px',
        borderRadius: 999,
      }}
    >
      <UserChip
        name={name}
        avatarUrl={avatarUrl}
        variant="sm"
        userInfo={canClick ? userInfo : undefined}
      />
      {onRemove && (
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          style={{ background:'none', border:'none', cursor:'pointer', color:'#CBD5E1', lineHeight:1, padding:0, marginLeft:2, display:'flex', alignItems:'center' }}
        >
          <X size={10} strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}
