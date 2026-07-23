/**
 * DashboardUserCell.tsx — 대시보드 카드 안 "사용자 표시" 공통 셀
 *
 * ✅ 변경 이력
 *  - [2026-07-23 Phase 2 수정] 신규 생성
 *    · 사유: '최근 생성된 예약'은 UserAvatar에 avatarUrl을 넘겨 실제 프로필 사진이 뜨는데,
 *            '사용자 예약 순위' / '사용자 누적 노쇼'는 avatarUrl 없이 이니셜 원만 떴다.
 *            같은 사람이 카드마다 다르게 보이는 상태였다.
 *    · 조치: 세 카드가 쓰는 표시 마크업을 이 컴포넌트 하나로 통일한다.
 *            avatarUrl을 안 넘기는 실수 자체가 불가능해진다(필수 prop).
 *
 * 📐 Figma 1:1 (Frame "예약자": 아바타 16 + gap 4 + 이름)
 *
 * ※ 공통 UserChip을 쓰지 않은 이유: UserChip은 클릭 시 상세 모달을 여는 인터랙션과
 *   dept 뱃지를 함께 갖고 있다. 대시보드 카드는 wrapper 전체가 DetailDrawer를 여는
 *   클릭 영역이라 내부에 또 다른 클릭 대상이 생기면 이벤트가 충돌한다.
 *   여기서는 표시 전용 셀만 필요하다.
 */
import { UserAvatar } from '../common/UserAvatar'

const FONT = "'Pretendard', -apple-system, sans-serif"

export function DashboardUserCell({ name, avatarUrl, size = 16, fontSize = 13 }: {
  name:      string
  avatarUrl: string | null | undefined   // ← 필수 — 넘기지 않으면 타입 에러로 잡힌다
  size?:     number
  fontSize?: number
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, minWidth:0 }}>
      <UserAvatar
        name={name}
        avatarUrl={avatarUrl}
        size={size}
        fontSize={Math.round(size / 2)}
        fontWeight={500}
      />
      <span style={{
        fontFamily: FONT,
        fontWeight: 400, fontSize, lineHeight: 1.4, color: '#111',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{name}</span>
    </div>
  )
}

/**
 * 부서명 표시 — [2026-07-23 고지 지시] 색상 제거, 회색 단일 톤.
 *   기존 #6366F1(인디고)은 링크처럼 보여서 클릭 가능한 요소로 오인된다.
 */
export function DashboardDeptText({ dept, fontSize = 13 }: { dept?: string | null; fontSize?: number }) {
  return (
    <span style={{
      fontFamily: FONT,
      fontWeight: 400, fontSize, lineHeight: 1.4, color: '#697077',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block',
    }}>{dept || '—'}</span>
  )
}
