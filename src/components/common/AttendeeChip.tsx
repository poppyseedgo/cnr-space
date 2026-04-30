import { UserChip } from './UserChip'
import type { AppUser } from '../../types'

/**
 * AttendeeChip — 참석자 표시
 * ← [피그마 180:534 반영] pill 배경 제거 → 아바타 + 이름 평문
 *   · onRemove 있을 때(BookingModal 편집 화면)만 X 버튼 표시
 *   · 아바타/이름은 UserChip md variant에 위임 (avatar 24 / name 14 Medium / gap 7)
 *
 * ✅ 변경 이력
 *  - [2026-04-30 가로스크롤 회귀 fix] 조회 모드 wrapper 추가
 *    · 증상: DetailModal/BookingDoneModal 참석자 영역에서 긴 이름(예: "안영환_Yeonghwan An",
 *            "권혁준_David Hyuckjun") 시 칩이 부모 너비를 초과 → 모달 전체 가로 스크롤 발생
 *    · 원인: UserChip의 외부 inline-flex (flexShrink:0, whiteSpace:nowrap)는
 *            자기 콘텐츠 너비로 무한 확장 가능. 부모 너비 제약 무시
 *            (4-23 fix 이후 어떤 변경으로 회귀)
 *    · 해결: 조회 모드 UserChip을 wrapper div로 감싸 max-width:100%, min-width:0 강제
 *            → 부모 너비 초과 방지 → flex-wrap 컨테이너가 정상적으로 다음 줄로 wrap
 *    · 무수정: UserChip 자체 (다른 사용처 영향 차단), 편집 모드 onRemove 분기, props
 *    · 짝 배포: DetailModal grid → flex-wrap 변경 (한 묶음)
 *
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
  //   ← [2026-04-30 가로스크롤 회귀 fix] wrapper div 추가
  //      배경: UserChip 외부 inline-flex (flexShrink:0, whiteSpace:nowrap)는
  //            긴 이름 시 부모 너비를 초과하여 가로 스크롤 유발.
  //      해결: wrapper로 max-width:100% + min-width:0 적용 → 부모 너비 초과 차단
  //            → flex-wrap 부모가 다음 줄로 wrap 가능 (Figma 의도)
  //      이름 자체는 한 줄 유지 (UserChip 내부 whitespace:nowrap 그대로) —
  //      극히 긴 이름은 ellipsis로 잘림 (overflow:hidden 처리)
  return (
    <div style={{
      maxWidth: '100%',
      minWidth: 0,
      overflow: 'hidden',
      display: 'inline-flex',  // ← UserChip의 inline-flex 동작 유지 (block 변환 방지)
    }}>
      <UserChip
        name={name}
        avatarUrl={avatarUrl}
        variant="md"
        userInfo={canClick ? userInfo : undefined}
      />
    </div>
  )
}
