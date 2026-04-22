import { X } from 'lucide-react'
import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

/**
 * AttendeeChip — 참석자 표시
 * ← [피그마 180:534 반영] pill 배경 제거 → 아바타 + 이름 평문
 *   · onRemove 있을 때(BookingModal 편집 화면)만 X 버튼 표시
 *   · 아바타/이름은 UserChip md variant에 위임 (avatar 24 / name 14 Medium / gap 7)
 *
 * ✅ 변경 이력
 *  - [2026-04-22 피그마] bg #EEF2FF + padding + rounded 999 제거 → 평문화
 *  - [2026-04-18 스타일 정리] 배경색 하드코딩 #EEF2FF → var(--color-attendee-bg)
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

  // ── 편집 모드: 이전 pill 디자인 유지 (X 버튼 공간 필요) ──────────────────
  if (onRemove) {
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
          userInfo={undefined}
        />
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          style={{ background:'none', border:'none', cursor:'pointer', color:'#CBD5E1', lineHeight:1, padding:0, marginLeft:2, display:'flex', alignItems:'center' }}
        >
          <X size={10} strokeWidth={1.8} />
        </button>
      </div>
    )
  }

  // ── 조회 모드 (피그마 180:534): 평문 — 아바타 + 이름 ─────────────────────
  return (
    <UserChip
      name={name}
      avatarUrl={avatarUrl}
      variant="md"
      userInfo={canClick ? userInfo : undefined}
    />
  )
}
