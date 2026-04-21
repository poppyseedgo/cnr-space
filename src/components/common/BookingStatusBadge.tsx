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
 *  - [2026-04-21 v2.1] auto_cancelled 설계 재정립에 따른 판별 로직 전면 수정
 *     · 배경: api.ts의 cancelBooking/adminForceCancel/rejectBooking에서
 *             auto_cancelled을 true→false로 변경 (사람 개입은 auto_cancelled=false)
 *     · v2.1 DB 규칙:
 *        · User 취소:    status='cancelled' + autoCancelled=false + cancelledBy='user'
 *        · Admin 취소:   status='cancelled' + autoCancelled=false + cancelledBy='admin'
 *        · Admin 거절:   status='rejected'  + autoCancelled=false + cancelledBy='admin'
 *        · 기한초과(cron): status='pending' + autoCancelled=true  + cancelledBy='system'
 *        · 노쇼(cron):    status='confirmed'+ autoCancelled=true  + cancelledBy='system'
 *     · 판정 로직 변경:
 *        (1) isUserCancel: autoCancelled 체크 제거 → status='cancelled' + cancelledBy='user'
 *        (2) isAdminCancel: autoCancelled 체크 제거 → status='cancelled' + cancelledBy='admin'
 *        (3) isExpiredPending: status='pending' 고정 (시간축 판별 제거)
 *        (4) isNoshow: status='confirmed' + !checkedIn + !earlyEnded 조건 추가 (견고성)
 *        (5) isAct/isPast: status='confirmed' 조건 추가 (cancelled 제외)
 *     · 상호 배타성 유지: 한 예약이 동시에 두 뱃지 나올 수 없음
 *     · 설계 문서: 예약상태관리_설계문서_v2.1.md
 *
 *  - [2026-04-19 P2 v7] 판별 로직 전면 재설계 — pending_expired 노쇼 오표시 버그 해결
 *     · 증상: 승인 기한 초과로 자동 취소된 예약이 모든 화면에서 "노쇼" 뱃지로 표시됨
 *             (룸 상세 카드, 예약 상세, 캘린더 슬롯, 홈 카드 전부)
 *     · 원인: P2 v6에서 cron이 pending_expired를 처리하며 status='pending' → 'cancelled' 변경
 *             기존 판별 `isExpiredPending = status==='pending' && autoCancelled` 는
 *             status='cancelled'가 되는 순간 false → isNoshow 조건이 true로 뒤집힘
 *     · 추가 발견: 사용자 pending 수동 취소 시 isExpiredPending + isUserCancel 동시 true → 뱃지 중복
 *     · 해결:
 *        (1) 우선순위 엄격화: user_cancel > rejected > admin_cancel > system_cancel
 *        (2) system_cancel을 시간축으로 분리
 *            · 기한초과: status='pending' OR now < start_at + 10분 (시작 전/직후의 시스템 취소)
 *            · 노쇼:    그 외 (시작 후 10분 경과 이후의 시스템 취소)
 *        (3) 상호 배타적 보장 — 한 예약이 동시에 두 뱃지 나오지 않음
 *     · 검증: 판별 시뮬레이션 8가지 케이스 통과 (pending 선점/cron 완료/수동취소/노쇼 등)
 *     · 단일 진실 원천: 이 컴포넌트 수정만으로 5개 사용처(홈/마이페이지/캘린더/룸상세/예약상세) 일괄 수정
 *
 *  - [2026-04-18 스타일 정리]
 *    · only prop 추가 — 특정 상태만 필터링해서 표시 가능
 *    · BadgeType 타입 export — 외부 코드에서 상태 참조 가능
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

  // ── 취소 상태 판별 (v2.1 — auto_cancelled 설계 재정립 반영) ──────────
  //
  // ← [2026-04-21 v2.1] 판별 로직 전면 재설계
  //
  //   v2.1 DB 저장 규칙 (설계 문서 v2.1 참조):
  //     · User/Admin 취소: autoCancelled=false (사람 개입이므로)
  //     · Admin 거절:      autoCancelled=false (사람 개입이므로)
  //     · 기한초과(cron):  status='pending' + autoCancelled=true + cancelledBy='system'
  //     · 노쇼(cron):      status='confirmed'+ autoCancelled=true + cancelledBy='system'
  //
  //   판정 원칙:
  //     1. status 값으로 1차 분기 (rejected/pending/cancelled/confirmed)
  //     2. autoCancelled + cancelledBy 조합으로 2차 판별
  //     3. checkedIn 등 세부 플래그로 3차 확정 (노쇼 견고성)
  //
  //   배타성:
  //     · 한 예약은 오직 하나의 취소/상태 카테고리에 해당
  //     · status='cancelled' → user_cancel 또는 admin_cancel 둘 중 하나
  //     · status='pending'+autoCancelled → 기한초과 (오직 에메랄드룸)
  //     · status='confirmed'+autoCancelled → 노쇼 (체크인 안 한 경우)

  // ① 거절 (최우선, Admin이 명시적으로 거절)
  const isRejected    = b.status === 'rejected'

  // ② 사용자 본인 취소
  //    v2.1: autoCancelled 체크 제거 (사람 개입은 autoCancelled=false)
  const isUserCancel  = b.status === 'cancelled' && b.cancelledBy === 'user'

  // ③ 관리자 강제 취소
  //    v2.1: autoCancelled 체크 제거 (사람 개입은 autoCancelled=false)
  const isAdminCancel = b.status === 'cancelled' && b.cancelledBy === 'admin'

  // ④ 기한초과 취소 (cron 자동 처리, 에메랄드룸 전용)
  //    v2.1: status='pending' 유지 (cron이 status 안 건드림)
  //    룸 조건 안전장치: 일반룸에서 발생하면 데이터 이상 경고
  const isExpiredPending = b.status === 'pending'
                           && b.autoCancelled
                           && b.cancelledBy === 'system'
  if (isExpiredPending && r && !adminRoom) {
    // ← [v2.1 안전장치] 기한초과는 에메랄드룸에서만 발생해야 함
    console.warn('[BookingStatusBadge] 기한초과가 일반룸에서 발생? 데이터 이상:', b.id)
  }

  // ⑤ 노쇼 (cron 자동 처리)
  //    v2.1: !checkedIn + !earlyEnded 조건 추가 (노쇼의 본질: 체크인 안 함)
  //          status='confirmed' 명시 (기한초과와 구분)
  const isNoshow = b.status === 'confirmed'
                   && b.autoCancelled
                   && b.cancelledBy === 'system'
                   && !b.checkedIn
                   && !b.earlyEnded

  // ── 진행 상태 판별 ──────────────────────────────────────────────
  //
  // ← [v2.1] status='confirmed' 조건을 명시적으로 추가
  //   이유: v2.1부터 User/Admin 취소는 autoCancelled=false로 저장됨
  //         → !b.autoCancelled만으로는 취소된 예약 필터링 불가
  //         → status='confirmed' 조건 추가로 cancelled 상태 명확히 제외
  const isAct     = isToday && sm <= now && now < em
                    && b.status === 'confirmed'         // ← [v2.1 추가] cancelled 제외
                    && !b.autoCancelled                 // 노쇼 제외
                    && !b.earlyEnded
  const isApproved = adminRoom && b.status === 'confirmed' && !b.autoCancelled
  const nci       = isAct && !b.checkedIn
  const isFuture  = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  // 과거(종료): 진행 중도 미래도 아니고, 정상 확정 상태인 경우
  //   v2.1: status='confirmed' 명시 (cancelled/rejected/pending 모두 제외)
  const isPast    = !isAct && !isFuture
                    && b.status === 'confirmed'         // ← [v2.1 변경] 명시적 confirmed
                    && !b.autoCancelled                 // 노쇼 제외
                    && !b.earlyEnded                    // 조기종료는 별도 뱃지
  const tl        = sm - now
  const isOwner   = !!currentUser && b.user === currentUser

  // ── only 필터 헬퍼 ─────────────────────────────────────────────
  const show = (t: BadgeType) => !only || only.includes(t)

  // ← [v2.1] 취소/거절 상태 판별 헬퍼 (mine 뱃지 표시 여부 결정용)
  //   v2.1부터 User/Admin 취소도 autoCancelled=false로 저장되므로
  //   !b.autoCancelled만으로는 취소 상태를 판별할 수 없음
  //   → isUserCancel + isAdminCancel + isRejected + isExpiredPending으로 명시
  const isAnyCancelled = isUserCancel || isAdminCancel || isRejected || isExpiredPending

  const hasAny =
    (show('rejected')        && isRejected) ||
    (show('expired-pending') && isExpiredPending) ||
    (show('admin-cancel')    && isAdminCancel) ||
    (show('noshow')          && isNoshow) ||
    (show('user-cancel')     && isUserCancel && isOwner) ||
    // ← [P2 v7] pending 뱃지는 '자동취소되지 않은 진짜 승인 대기'만
    //   isExpiredPending이 status='pending' 상태도 커버하므로 중복 방지
    (show('pending')         && b.status === 'pending' && !b.autoCancelled) ||
    (show('approved')        && isApproved) ||
    // ← [v2.1] mine: 취소/거절/기한초과 상태에서는 표시 안 함 (뱃지 중복 방지)
    //   단, 노쇼는 예외 (생성자 박제 UX)
    (show('mine')            && isOwner && (!isAnyCancelled || isNoshow)) ||
    (show('active')          && isAct) ||
    (show('checkin-wait')    && nci) ||
    (show('checkin-done')    && b.checkedIn && isAct) ||
    (show('past')            && isPast) ||
    (show('early-end')       && b.earlyEnded) ||
    // ← [v2.1] countdown: 취소/거절/기한초과 상태에서는 카운트다운 의미 없음
    (show('countdown')       && !isAct && !isAnyCancelled && !b.autoCancelled && isToday && tl > 0 && tl <= 10)

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

      {/* ⑧ 내 예약 — sm 소형카드 제외, 취소/거절/기한초과 상태에서는 숨김 (노쇼는 예외) */}
      {/* ← [v2.1] !b.autoCancelled → !isAnyCancelled (User/Admin 취소도 숨김) */}
      {show('mine') && isOwner && (!isAnyCancelled || isNoshow) && size !== 'sm' && <C cls="chip-mine">내 예약</C>}

      {/* ⑨ 진행 중 */}
      {/* ← [v2.1] isAct가 이미 status='confirmed' 체크하므로 추가 조건 간소화 */}
      {show('active') && isAct && (
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
      {/* ← [v2.1] !b.autoCancelled → !isAnyCancelled 추가 (User/Admin 취소도 제외) */}
      {show('countdown') && !isAct && !isAnyCancelled && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <C cls="chip-countdown">{tl}분 후</C>
      )}
    </div>
  )
}
