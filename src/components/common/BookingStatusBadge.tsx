import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  /** is_admin_only 직접 전달 — room prop 없이도 승인완료 배지 표시 가능 */
  isAdminRoom?: boolean
  currentUser?: string
  /** md = DetailModal·ListView / sm = 소형카드 / xs = 캘린더 슬롯 */
  size?:        'md' | 'sm' | 'xs'
}

/** size별 chip 크기 override — 색상은 chip-* 클래스가 담당 */
const CHIP_SIZE = {
  md: {},
  sm: { fontSize: 9,  padding: '2px 7px'  },
  xs: { fontSize: 8,  padding: '1px 4px', borderRadius: 3 },
} as const

export function BookingStatusBadge({
  booking: b,
  room: r,
  isAdminRoom,
  currentUser = '',
  size = 'md',
}: BookingStatusBadgeProps) {
  const now     = nowMinutes()
  const isToday = tsDate(b.start_at) === todayStr()
  const sm      = tsMin(b.start_at)
  const em      = tsMin(b.end_at)

  // isAdminRoom prop 우선, 없으면 room.is_admin_only fallback
  const adminRoom = isAdminRoom ?? !!r?.is_admin_only

  // ── 취소 상태 판별 (상호 배타적) ──────────────────────────────────
  const isRejected       = b.status === 'rejected'
  const isExpiredPending = b.status === 'pending' && b.autoCancelled
  const isAdminCancel    = b.autoCancelled && b.cancelledBy === 'admin' && !isRejected
  const isNoshow         = b.autoCancelled && b.cancelledBy === 'system' && !isRejected
  const isUserCancel     = b.autoCancelled && b.cancelledBy === 'user'

  // ── 진행 상태 판별 ──────────────────────────────────────────────
  const isAct     = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const isApproved = adminRoom && b.status === 'confirmed' && !b.autoCancelled
  const nci       = isAct && !b.checkedIn
  const isFuture  = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  // 과거: 진행 중도 미래도 아니고, 취소·거절·earlyEnded·pending도 아닌 경우
  const isPast    = !isAct && !isFuture && !b.autoCancelled && !b.earlyEnded
                    && b.status !== 'pending' && b.status !== 'rejected'
  const tl        = sm - now
  const isOwner   = !!currentUser && b.user === currentUser

  const hasAny =
    isRejected ||
    isExpiredPending ||
    isAdminCancel ||
    isNoshow ||
    (isUserCancel && isOwner) ||
    (b.status === 'pending' && !b.autoCancelled) ||
    isApproved ||
    (isOwner && !b.autoCancelled && !isRejected) ||
    isAct ||
    nci ||
    (b.checkedIn && isAct) ||
    isPast ||
    b.earlyEnded ||
    (!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10)

  if (!hasAny) return null

  const cs  = CHIP_SIZE[size]
  const gap = size === 'xs' ? 3 : 5

  const C = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
    <span className={`chip ${cls}`} style={cs}>{children}</span>
  )

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* ① 거절됨 — 최우선, 단독 표시 */}
      {isRejected && <C cls="chip-rejected">거절됨</C>}

      {/* ② 기한초과 취소 (pending + autoCancelled) */}
      {isExpiredPending && <C cls="chip-expired">기한초과 취소</C>}

      {/* ③ 관리자 강제취소 (rejected 제외) */}
      {isAdminCancel && <C cls="chip-admin">관리자 강제취소</C>}

      {/* ④ 노쇼 (system 자동취소) */}
      {isNoshow && <C cls="chip-noshow">노쇼</C>}

      {/* ⑤ 사용자 직접 취소 — 본인 컨텍스트(MyPage)에서만 */}
      {isUserCancel && isOwner && <C cls="chip-neutral">취소됨</C>}

      {/* ── 이하 정상 상태 (취소 없는 경우) ── */}
      {/* ⑥ 승인 대기 */}
      {b.status === 'pending' && !b.autoCancelled && <C cls="chip-pending">승인 대기</C>}

      {/* ⑦ 승인완료 */}
      {isApproved && <C cls="chip-approved">승인완료</C>}

      {/* ⑧ 내 예약 */}
      {isOwner && !b.autoCancelled && !isRejected && <C cls="chip-mine">내 예약</C>}

      {/* ⑨ 진행 중 */}
      {isAct && !b.autoCancelled && (
        <span className="chip" style={{ ...cs, background: (r?.color ?? '#6366F1') + '18', color: r?.color ?? '#6366F1' }}>
          진행 중
        </span>
      )}

      {/* ⑩ 체크인 대기 / 완료 */}
      {nci && <C cls="chip-checkin-wait">체크인 대기</C>}
      {b.checkedIn && isAct && <C cls="chip-success">체크인 완료</C>}

      {/* ⑪ 종료 */}
      {isPast && <C cls="chip-done">종료</C>}

      {/* ⑫ 조기반납 */}
      {b.earlyEnded && <C cls="chip-earlyend">조기반납</C>}

      {/* ⑬ N분 후 카운트다운 */}
      {!isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <C cls="chip-countdown">{tl}분 후</C>
      )}
    </div>
  )
}
