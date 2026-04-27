import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

/**
 * AttendeeChip — 참석자 표시
 * ← [피그마 180:534 반영] pill 배경 제거 → 아바타 + 이름 평문
 *   · onRemove 있을 때(BookingModal 편집 화면)만 X 버튼 표시
 *   · 아바타/이름은 UserChip md variant에 위임 (avatar 24 / name 14 Medium / gap 7)
 *
 * ✅ 변경 이력
 *  - [2026-04-27 Phase G 보충 17] 편집 모드 X 아이콘: lucide X → 사용자 제공 attendeechipX.svg 인라인 (Figma 331:1238 / fill #1C1B1F)
 *      · BookingModal inline 칩 (L2175 부근) 동일 SVG 로 통일 — 디자인 일관성
 *      · DetailModal/BookingDoneModal 영향 없음 (onRemove 미전달 → if (onRemove) 분기 미진입 → 평문 모드만 사용)
 *      · 크기: 10 → 16 (Figma 331:1238 size-[16px])
 *      · color/strokeWidth prop 제거 → SVG path fill #1C1B1F 직접 적용
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
          style={{ background:'none', border:'none', cursor:'pointer', lineHeight:1, padding:0, marginLeft:2, display:'flex', alignItems:'center' }}
        >
          {/* ← [Phase G 보충 17 2026-04-27] lucide X → 사용자 제공 attendeechipX.svg 인라인 (Figma 331:1238 / fill #1C1B1F / size 16) */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M4.26693 12.0669L3.93359 11.7336L7.66693 8.00026L3.93359 4.26693L4.26693 3.93359L8.00026 7.66693L11.7336 3.93359L12.0669 4.26693L8.33359 8.00026L12.0669 11.7336L11.7336 12.0669L8.00026 8.33359L4.26693 12.0669Z" fill="#1C1B1F"/>
          </svg>
        </button>
      </div>
    )
  }

  // ── 조회 모드 (피그마 180:534): 평문 — 아바타 + 이름 ─────────────────────
  //   ← [2026-04-23 재수정] 이전에 추가했던 wrap(내부 줄바꿈) 제거.
  //      대신 부모 grid 쪽에서 auto-fit으로 긴 칩이면 열이 1열로 무너지도록 함
  //      → 이름은 한 줄 유지, 칩 자체가 아래로 떨어지는 구조.
  return (
    <UserChip
      name={name}
      avatarUrl={avatarUrl}
      variant="md"
      userInfo={canClick ? userInfo : undefined}
    />
  )
}
