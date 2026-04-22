import { X } from 'lucide-react'
import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

/**
 * AttendeeChip — 참석자 pill 형태
 * 아바타+이름 렌더링 및 클릭 모달은 UserChip에 위임
 * onRemove 있으면 X 버튼 표시 (BookingModal 전용)
 *
 * ✅ 변경 이력
 *  - [2026-04-18 스타일 정리] 배경색 하드코딩 #EEF2FF → var(--color-attendee-bg)
 *    · 이유: tokens.css 단일 소스 원칙 준수, 다크모드 대응 여지 확보
 */

interface AttendeeChipProps {
  name:       string
  avatarUrl?: string | null
  dept?:      string
  userInfo?:  AppUser
  onRemove?:  () => void
}

export function AttendeeChip({ name, avatarUrl, userInfo, onRemove }: AttendeeChipProps) {
  const canClick = !!userInfo && !onRemove

  return (
    <div
      style={{
        display:      'inline-flex',
        alignItems:   'center',
        gap:          4,
        background:   'var(--color-attendee-bg)',  // ← [변경] 하드코딩 #EEF2FF → 토큰
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
