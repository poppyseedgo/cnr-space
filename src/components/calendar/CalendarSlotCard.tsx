// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-04-24 P5] 캘린더 슬롯 이름 live + 뱃지 판정 UUID/email 전환
//   · 이름 live 표시 (2곳):
//     - L155 노쇼 박제 슬롯 예약자 이름
//     - L258 일반 Daily 슬롯 예약자 이름
//     → users 배열에서 user_id 매칭 → profiles.name 우선, snapshot fallback
//   · isOwner 판정 (L173): b.user === currentUser → isBooker(UUID OR email)
//   · 시그니처 확장: currentUserId, currentUserEmail, users prop 추가
//   · getSlotState 호출 업데이트: (b, now, isToday, currentUserId, currentUserEmail)
//   · 기존 currentUser prop 유지 (호환 — CalendarShell에서 아직 전달 중, 내부적으로는 미사용)
//   · 원칙: 이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식 (UUID/email OR)
//
// [2026-04-23] 신규 — 캘린더 Daily 뷰 예약 슬롯 전용 카드 컴포넌트
//
//   배경: Daily 뷰 슬롯은 배경색/border/텍스트색/칩 row가 다양한 상태 조건으로 얽혀
//         CalendarShell 본체에 인라인으로 둘 경우 200줄 이상의 렌더 블록이 됨
//         → 별도 컴포넌트로 분리해 가독성·재사용성·테스트 용이성 확보
//
//   범위: 이 파일은 "슬롯 카드 내부" 만 담당. 외부 위치(absolute top/left/width)는
//         호출부(CalendarShell)가 계산해 props로 주입. 즉 이 컴포넌트는 스타일/레이
//         아웃/컨텐츠만 책임.
//
//   ─── 배경 규칙 (해석 B) ─────────────────────────────────────────────────
//     · 사용 중 (isAct):         흰 배경 + border 1px #373737  (Figma 242:427)
//     · 예약됨/사용완료/조기반납:  #1D1D1D 검정 배경 (border 없음)
//     · 노쇼:                   #FFEAEA (15분 폭 전용 박제, 내부 구조 별도)
//
//   ─── 텍스트 색 ──────────────────────────────────────────────────────────
//     · 흰 배경:  제목 #000 / 서브 #94A3B8
//     · 검정 배경: 제목 #FFF / 서브 #94A3B8
//     · 노쇼 박제: 제목 숨김 / 이름 #2A2A2A 10px
//
//   ─── "15분 폭" 컨텐츠 규칙 (새 규칙, 2026-04-23) ───────────────────────
//     · 15분 폭 + 노쇼:      노쇼 칩 + 이름만
//     · 15분 폭 + 그 외:     제목 + 시간 + 이름 (칩 row 전부 숨김)
//     · 15분 초과 폭:        기존 풀 구조 (제목 + 시간 + 이름 + 칩 row)
//
//   ─── 칩 구성 (Figma 242:427 chip div 순서) ─────────────────────────────
//     조기반납 → 사용완료 → 승인완료 → 내 예약 (우측 정렬, justify-end)
//     어떤 칩이 나오는지는 상태 조합에 따라 결정:
//       · 조기반납/사용완료 세트: earlyEnded → 조기반납 + 사용완료
//                                · earlyEnded=false + isPast: 사용완료만
//       · 승인완료: 에메랄드룸 + confirmed + !autoCancelled
//       · 내 예약: 본인 소유 + !cancelled + !rejected
//
// ─────────────────────────────────────────────────────────────────────────────

import { PurposeChip } from '../common/PurposeChip'  // ← [2026-07-27 목적 Phase 3] 타이틀 앞 목적 라벨
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import type { Booking, Room, AppUser } from '../../types'  // ← [2026-04-24 P5] AppUser 추가 — users 배열에서 live 이름 조회
import { fmtTSRange, tsDate, todayStr } from '../../utils/time'
import { getSlotState } from './slotHelpers'
import { CalendarSlotBadge, type DailySlotBadgeType } from './CalendarSlotBadge'
import { isBooker } from '../../utils/bookingOwnership'  // ← [2026-04-24 P5] isOwner 판정 UUID/email OR 기반

// ── 상수 ───────────────────────────────────────────────────────────────────
const BG_ACTIVE   = '#FFFFFF'
const BG_DEFAULT  = '#1D1D1D'   // 예약됨/사용완료/조기반납
const BG_NOSHOW   = '#FFEAEA'

const COLOR_ON_DARK_TITLE = '#FFFFFF'
const COLOR_ON_LIGHT_TITLE = '#000000'
const COLOR_SUB = '#94A3B8'

const BORDER_ACTIVE = '1px solid #373737'   // Figma 242:427

// 15분 = 슬롯 폭의 quantize 최소 단위. 이 값과 정확히 같으면 "컴팩트" 렌더
const COMPACT_THRESHOLD_MIN = 15

export interface CalendarSlotCardProps {
  booking:      Booking
  room?:        Room | null
  /** @deprecated P5 이후 표시/판정 모두 UUID/email 기반. 호환성 유지용으로 남겨둠 */
  currentUser?: string
  /** ← [2026-04-24 P5] 현재 로그인 사용자 UUID */
  currentUserId?: string
  /** ← [2026-04-24 P5] 현재 로그인 사용자 이메일 */
  currentUserEmail?: string
  /** ← [2026-04-24 P5] 전체 사용자 배열 (loadUsers live 데이터) — 예약자 이름 live 조회용 */
  users?:       AppUser[]
  now:          number              // 현재 시각(분), 부모에서 주입해 일관 렌더
  isToday:      boolean
  /** quantize된 슬롯 폭 (분). 15면 컴팩트 모드, 그 이상이면 풀 모드 */
  occupiedMin:  number
  /** absolute 위치 + 크기 (부모가 계산해서 주입) */
  positionStyle: CSSProperties
  onClick?:     (e: ReactMouseEvent) => void
  onMouseEnter?: (e: ReactMouseEvent) => void
  onMouseMove?:  (e: ReactMouseEvent) => void
  onMouseLeave?: (e: ReactMouseEvent) => void
}

/** 이 예약에 표시할 칩 타입들을 결정 (Figma 순서: 조기반납 → 사용완료 → 승인완료 → 내 예약) */
function resolveBadges(b: Booking, isOwner: boolean, isAdminRoom: boolean, isPast: boolean): DailySlotBadgeType[] {
  const badges: DailySlotBadgeType[] = []

  // 조기반납: 조기반납 + 사용완료 세트로 표시
  if (b.earlyEnded) {
    badges.push('earlyEnd')
    badges.push('done')
  } else if (isPast) {
    // 일반 종료
    badges.push('done')
  }

  // 승인완료: 에메랄드룸 + confirmed + 자동취소 아님
  if (isAdminRoom && b.status === 'confirmed' && !b.autoCancelled) {
    badges.push('approved')
  }

  // 내 예약: 본인 소유 + 취소/거절 아님
  if (isOwner && !b.autoCancelled && b.status !== 'rejected') {
    badges.push('mine')
  }

  return badges
}

export function CalendarSlotCard({
  booking: b,
  room,
  currentUser = '',
  currentUserId = '',     // ← [2026-04-24 P5]
  currentUserEmail = '',  // ← [2026-04-24 P5]
  users = [],             // ← [2026-04-24 P5] 예약자 이름 live 조회용
  now,
  isToday,
  occupiedMin,
  positionStyle,
  onClick,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
}: CalendarSlotCardProps) {
  // ← [2026-04-24 P5] getSlotState 시그니처 변경 — 이름 → UUID/email
  const st = getSlotState(b, now, isToday, currentUserId, currentUserEmail)
  const { isAct, isEnded, isNoshow, isExpiredPending } = st

  // ← [2026-04-24 P5] 예약자 이름 live 조회 — profiles.name 우선, snapshot은 fallback
  //   원칙: 이름이 바뀌어도 users 배열의 현재 값이 즉시 반영됨
  const owner = users.find(u => u.user_id === b.user_id)
  const displayUserName = owner?.name ?? b.user

  // ─── 배경/텍스트 색 결정 ───────────────────────────────────────────────
  // 해석 B: isAct만 흰 배경, 노쇼는 #FFEAEA, 그 외 전부 검정
  const isLight = isAct   // 흰 배경 = isAct 뿐
  const bg =
    isNoshow ? BG_NOSHOW :
    isAct    ? BG_ACTIVE :
    BG_DEFAULT

  const titleColor = isNoshow ? '#94A3B8'
                   : isLight   ? COLOR_ON_LIGHT_TITLE
                   : COLOR_ON_DARK_TITLE
  const subColor   = COLOR_SUB   // 모든 상태 공통

  // ─── 15분 폭 컴팩트 모드 감지 ──────────────────────────────────────────
  const isCompact = occupiedMin <= COMPACT_THRESHOLD_MIN

  // ─── 노쇼 전용 렌더 (Figma 242:529 구조) ───────────────────────────────
  if (isNoshow) {
    return (
      <div
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        style={{
          ...positionStyle,
          background: BG_NOSHOW,
          borderRadius: 10,
          padding: 8,
          cursor: 'pointer',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minWidth: 0,
        }}
      >
        {/* 상단: 노쇼 칩 */}
        <CalendarSlotBadge type="noshow" style={{ alignSelf: 'flex-start' }} />
        {/* 하단: 예약자명 ← [2026-04-24 P5] live 이름 (profiles.name) 우선, snapshot fallback */}
        {displayUserName && (
          <span style={{
            display: 'block', width: '100%', minWidth: 0,
            fontSize: 10, fontWeight: 500, color: '#2A2A2A',
            fontFamily: "'Pretendard', -apple-system, sans-serif",
            lineHeight: 1.5,
            padding: '1px 0',
            whiteSpace: 'nowrap',
            wordBreak: 'keep-all',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{displayUserName}</span>
        )}
      </div>
    )
  }

  // ─── 일반 예약 슬롯 렌더 (Figma 242:427 구조) ─────────────────────────
  // 칩 결정 (컴팩트 모드에서는 숨김)
  // ← [2026-04-24 P5] 이름 비교 완전 제거 — isBooker(UUID OR email) 사용
  //   기존: const isOwner = !!currentUser && b.user === currentUser
  //   변경: isBooker 헬퍼 — user_id/user_email 중 하나라도 일치 → "내 예약" 뱃지 불변 표시
  const isOwner = isBooker(b, currentUserId, currentUserEmail)
  const isAdminRoom = !!room?.is_admin_only
  const isFuture = tsDate(b.start_at) > todayStr() || (isToday && st.sm > now)
  const isPast = !isAct && !isFuture && !b.autoCancelled
                  && b.status !== 'pending' && b.status !== 'rejected'
  const badges = isCompact ? [] : resolveBadges(b, isOwner, isAdminRoom, isPast)

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{
        ...positionStyle,
        background: bg,
        border: isAct ? BORDER_ACTIVE : 'none',
        borderRadius: 10,
        padding: 8,
        cursor: 'pointer',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'all 0.12s',
      }}
    >
      {/* ← [2026-04-23 v13] Figma 242:427 구조 정확 반영:
          outer(242:555) gap 4
          └─ inner(242:428) gap 6: title row + time+name container
          칩 row: outer 레벨 (justify-end)

          변경 포인트:
          · 제목 row에 isAct면 6×6 #BAE3FF 닷 추가 (243:632, ← [2026-04-24] FF6E6E → BAE3FF)
          · 제목-시간 gap: 4 → 6 (Figma 242:428 gap-[6px])
          · 시간/이름 lineHeight: 1.5 → 10px (Figma 242:433 leading-[10px])
          · 제목: 2줄 wrap은 실사용 요청 유지 (Figma 1줄 ellipsis와 의도적 불일치) */}

      {/* 상단: 제목 행 + 시간/이름 컨테이너 (Figma 242:555 + 242:428) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden', width: '100%' }}>

        {/* 제목 row (Figma 242:429): 닷 + 제목 수평 배치 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', minWidth: 0 }}>
          {/* 사용 중 깜빡임 닷 (Figma 243:632) — isAct에만 렌더 */}
          {isAct && (
            <span
              className="slot-active-dot"
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#FF6E6E', flexShrink: 0, // ← [2026-04-24] FF6E6E → BAE3FF (사용 중 닷 색상 변경)
              }}
              aria-hidden
            />
          )}
          {/* 제목 — 1줄 ellipsis (Figma 242:432 스펙)
              ← [2026-04-24] 2줄 wrap → 1줄 ellipsis로 변경
                 · 긴 제목은 "..." 처리, 슬롯 높이 일관성 유지 */}
          <div style={{
            flex: 1, minWidth: 0,
            fontSize: 11, fontWeight: 500, color: titleColor,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: "'Pretendard', -apple-system, sans-serif",
          }}>
            <PurposeChip purpose={b.purpose} size="card" style={{marginRight:4}} />{/* ← [2026-07-27 목적 Phase 3] 타이틀 앞 라벨 (Figma 2688:27) */}
            {b.title}
          </div>
        </div>

        {/* 시간 + 이름 컨테이너 (Figma 242:433)
            ← [2026-04-24] 실제 렌더 기준 미세 보정:
            · lineHeight: 10px → 12px (한글 descender 여유 확보)
            · gap: 4 → 2 (두 줄 간격 타이트하게) */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 2, width: '100%',
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          color: subColor, fontSize: 10, fontWeight: 500,
          lineHeight: '12px',
        }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtTSRange(b.start_at, b.end_at)}
          </div>
          {/* ← [2026-04-24 P5] live 이름 표시 — profiles.name 우선, snapshot fallback */}
          {displayUserName && (
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {displayUserName}
            </div>
          )}
        </div>
      </div>

      {/* 하단: 칩 row — 컴팩트 모드에서는 숨김 */}
      {badges.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 4,
          overflow: 'hidden',
          width: '100%',
        }}>
          {badges.map(type => <CalendarSlotBadge key={type} type={type} />)}
        </div>
      )}
    </div>
  )
}
