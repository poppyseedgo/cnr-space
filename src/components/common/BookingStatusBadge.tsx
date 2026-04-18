import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'

/**
 * BookingStatusBadge — 예약 상태 뱃지 묶음
 *
 * 사용 방식:
 * 1) booking 자동 판별 (기본): <BookingStatusBadge booking={b} room={r} currentUser={u} />
 *    - 예약 객체의 상태를 분석해 해당 상태 칩을 자동으로 렌더
 *    - 기존 호출부 전부 이 방식 사용 중 (호환성 유지)
 *
 * 2) 명시적 타입 지정: <BookingStatusBadge booking={b} only={['pending']} />
 *    - `only` prop에 지정한 타입만 노출 (필터)
 *    - 예: "이 위치엔 승인 대기 뱃지만 보이기"
 *
 * ✅ 변경 이력
 *  - [2026-04-18 스타일 정리]
 *    · only prop 추가 — 특정 상태만 필터링해서 표시 가능
 *    · BadgeType 타입 export — 외부 코드에서 상태 참조 가능
 *    · 판별 로직은 100% 기존 유지 (회귀 위험 0)
 */

export type BadgeType =
  | 'rejected'
  | 'expired-pending'
  | 'admin-cancel'
  | 'noshow'
  | 'user-cancel'
  | 'pending'
  | 'approved'
  | 'mine'
  | 'active'
  | 'checkin-wait'
  | 'checkin-done'
  | 'past'
  | 'early-end'
  | 'countdown'

interface BookingStatusBadgeProps {
  booking:      Booking
  room?:        Room
  /** is_admin_only 직접 전달 — room prop 없이도 승인완료 배지 표시 가능 */
  isAdminRoom?: boolean
  currentUser?: string
  /** md = DetailModal·ListView / sm = 소형카드 / xs = 캘린더 슬롯 */
  size?:        'md' | 'sm' | 'xs'
  /** 지정 시 해당 타입의 뱃지만 렌더. 미지정 시 전체 자동 판별. */
  only?:        BadgeType[]
}

/** size별 chip modifier 클래스 — tokens.css 정의 */
const SIZE_CLASS = {
  md: '',
  sm: 'chip--sm',
  xs: 'chip--xs',
} as const

export function BookingStatusBadge({
  booking: b,
  room: r,
  isAdminRoom,
  currentUser = '',
  size = 'md',
  only,
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
  const isNoshow         = b.autoCancelled && b.cancelledBy === 'system' && !isRejected && b.status !== 'pending'
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

  // ── only 필터 헬퍼 ─────────────────────────────────────────────
  const show = (t: BadgeType) => !only || only.includes(t)

  const hasAny =
    (show('rejected')        && isRejected) ||
    (show('expired-pending') && isExpiredPending) ||
    (show('admin-cancel')    && isAdminCancel) ||
    (show('noshow')          && isNoshow) ||
    (show('user-cancel')     && isUserCancel && isOwner) ||
    (show('pending')         && b.status === 'pending' && !b.autoCancelled) ||
    (show('approved')        && isApproved) ||
    (show('mine')            && isOwner && !b.autoCancelled && !isRejected) ||
    (show('active')          && isAct) ||
    (show('checkin-wait')    && nci) ||
    (show('checkin-done')    && b.checkedIn && isAct) ||
    (show('past')            && isPast) ||
    (show('early-end')       && b.earlyEnded) ||
    (show('countdown')       && !isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10)

  if (!hasAny) return null

  const sizeClass = SIZE_CLASS[size]
  const gap = size === 'xs' ? 3 : 5

  const C = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
    <span className={`chip ${sizeClass} ${cls}`.trim()}>{children}</span>
  )

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* ① 거절됨 — 최우선, 단독 표시 */}
      {show('rejected') && isRejected && <C cls="chip-rejected">거절됨</C>}

      {/* ② 기한초과 취소 (pending + autoCancelled) */}
      {show('expired-pending') && isExpiredPending && <C cls="chip-expired">기한초과 취소</C>}

      {/* ③ 관리자 강제취소 (rejected 제외) */}
      {show('admin-cancel') && isAdminCancel && <C cls="chip-admin">관리자 강제취소</C>}

      {/* ④ 노쇼 (system 자동취소) */}
      {show('noshow') && isNoshow && <C cls="chip-noshow">노쇼</C>}

      {/* ⑤ 사용자 직접 취소 — 본인 컨텍스트(MyPage)에서만 */}
      {show('user-cancel') && isUserCancel && isOwner && <C cls="chip-neutral">취소됨</C>}

      {/* ── 이하 정상 상태 (취소 없는 경우) ── */}
      {/* ⑥ 승인 대기 */}
      {show('pending') && b.status === 'pending' && !b.autoCancelled && <C cls="chip-pending">승인 대기</C>}

      {/* ⑦ 승인완료 */}
      {show('approved') && isApproved && <C cls="chip-approved">승인완료</C>}

      {/* ⑧ 내 예약 — sm 소형카드 제외, 노쇼(생성자 박제)도 표시 */}
      {show('mine') && isOwner && (!b.autoCancelled || isNoshow) && !isRejected && size !== 'sm' && <C cls="chip-mine">내 예약</C>}

      {/* ⑨ 진행 중 */}
      {show('active') && isAct && !b.autoCancelled && (
        <span className={`chip ${sizeClass}`.trim()} style={{ background: (r?.color ?? '#6366F1') + '18', color: r?.color ?? '#6366F1' }}>
          진행 중
        </span>
      )}

      {/* ⑩ 체크인 대기 / 완료 */}
      {show('checkin-wait') && nci && <C cls="chip-checkin-wait">체크인 대기</C>}
      {show('checkin-done') && b.checkedIn && isAct && <C cls="chip-success">체크인 완료</C>}

      {/* ⑪ 종료 */}
      {show('past') && isPast && <C cls="chip-done">종료</C>}

      {/* ⑫ 조기반납 */}
      {show('early-end') && b.earlyEnded && <C cls="chip-earlyend">조기반납</C>}

      {/* ⑬ N분 후 카운트다운 */}
      {show('countdown') && !isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <C cls="chip-countdown">{tl}분 후</C>
      )}
    </div>
  )
}
