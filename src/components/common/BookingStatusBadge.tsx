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
  /** ← [피그마 180:534 신규] 'square' = BookingDetailModal 사각형 칩(radius 8) / 기본 'pill' */
  shape?:       'pill' | 'square'
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
  shape = 'pill',
}: BookingStatusBadgeProps) {
  const now     = nowMinutes()
  const isToday = tsDate(b.start_at) === todayStr()
  const sm      = tsMin(b.start_at)
  const em      = tsMin(b.end_at)

  // isAdminRoom prop 우선, 없으면 room.is_admin_only fallback
  const adminRoom = isAdminRoom ?? !!r?.is_admin_only

  // ── 취소 상태 판별 (상호 배타적, 우선순위 엄격) ──────────────────────
  //
  // ← [2026-04-19 P2 v7 판별 재설계] pending_expired 노쇼 오표시 버그 해결
  //
  //   배경:
  //     · P2 v6에서 pending_expired는 auto-cancel-bookings cron이 처리하며
  //       status='pending' → 'cancelled'로 최종 변경됨
  //     · 기존 판별 `isExpiredPending = status==='pending' && autoCancelled`은
  //       cron 처리 후 status='cancelled'가 되면 false → isNoshow로 오분류
  //     · 또한 사용자가 pending 수동 취소 시 isExpiredPending + isUserCancel
  //       둘 다 true가 되어 뱃지 중복 표시
  //
  //   해결 원칙:
  //     1. 우선순위 엄격화: 사용자 의도(user_cancel) > 거절/관리자 > 시스템 판별
  //     2. 시스템 취소(cancelled_by=system) 내부에서 '기한초과'와 '노쇼' 구분
  //        · 기한초과(pending_expired): 승인 대기 중 start_at 도래 전에 자동 취소
  //        · 노쇼(noshow):              체크인 없이 start_at + 10분 경과 시 자동 취소
  //     3. 판별 기준: status + start_at 시점 조합 (status만으로는 불충분)
  //        · status='pending'  → 무조건 기한초과 (승인 대기 상태의 system 취소)
  //        · status='cancelled' + now < start_at → 기한초과 (시작 전 system 취소)
  //        · status='cancelled' + now >= start_at + 10분 → 노쇼 (시작 후 미체크인)
  //        · 그 외 → 노쇼 폴백 (안전한 기본값)
  //
  //   배타성 보장:
  //     · isUserCancel이 true면 다른 system/admin 판별은 전부 false
  //     · isRejected가 true면 admin/expired/noshow 전부 false
  //     · expired와 noshow는 시간축으로 완전 분리 (한 건이 동시 해당 불가)

  const isRejected    = b.status === 'rejected'
  // ① 사용자 취소가 최우선 (사용자 의도가 가장 명확)
  const isUserCancel  = b.autoCancelled && b.cancelledBy === 'user'
  // ② 관리자 강제 취소 (거절과 구분)
  const isAdminCancel = b.autoCancelled && b.cancelledBy === 'admin'
                        && !isRejected && !isUserCancel
  // ③ 시스템 취소 (기한초과 vs 노쇼 분리)
  const isSystemCancel = b.autoCancelled && b.cancelledBy === 'system'
                         && !isRejected && !isUserCancel && !isAdminCancel
  // ③-1 기한초과: status='pending' 유지이거나, cancelled지만 start_at 도달 전
  //     · cron이 처리한 경우 status='cancelled' + start_at 근방 (보통 now~start_at+몇초)
  //     · 프론트가 선점한 경우 status='pending' + now는 start_at 전후
  //     · 핵심: cancelled_by='system'이면서 노쇼 시점(start_at+10분)에 도달 안 한 경우
  //  ← [2026-04-24 HOTFIX] isToday 가드 추가 (slotHelpers와 동일 원칙)
  //    tsMin()은 당일 자정 기준 분, nowMinutes()는 "오늘"의 분.
  //    두 값은 같은 날짜일 때만 의미 있는 비교.
  //    isToday=false(과거/미래 날짜)에서 `now < sm + 10` 비교하면,
  //    예: 어제 09:00(sm=540) 건을 오늘 01:40(now=100)에 조회 시
  //        100 < 550 = true로 오판정되어 "기한초과"로 표시됨 (실제로는 노쇼)
  //    해결: isToday일 때만 시간 비교, 아닐 때는 status만으로 판정.
  const isExpiredPending = isSystemCancel
                           && (b.status === 'pending' || (isToday && now < sm + 10))
  // ③-2 노쇼: start_at + 10분 경과 + status='cancelled' (또는 confirmed 단계 건)
  //     (또는 isToday=false인 과거 날짜의 status='confirmed' + system 취소 건)
  const isNoshow         = isSystemCancel && !isExpiredPending

  // ── 진행 상태 판별 ──────────────────────────────────────────────
  const isAct     = isToday && sm <= now && now < em && !b.autoCancelled && !b.earlyEnded
  const isApproved = adminRoom && b.status === 'confirmed' && !b.autoCancelled
  const nci       = isAct && !b.checkedIn
  const isFuture  = tsDate(b.start_at) > todayStr() || (isToday && sm > now)
  // ← [2026-04-23] 조기반납도 '사용완료'에 포함 (earlyEnded는 조기 사용완료의 서브셋)
  //   기존: !b.earlyEnded 제외 → 조기반납이면 사용완료 칩 안 나옴
  //   변경: 조기반납도 실제로 끝난 예약이므로 사용완료(isPast)에 포함
  //   결과: earlyEnded 예약은 "조기반납" 칩 + "사용완료" 칩 세트로 표시
  //   안전: isPast = !isAct && !isFuture 조건이 '시작 시간 지남'을 이미 보장
  //         미래 예약이 earlyEnded=true인 경우는 데이터 오염 — 방어 불필요
  const isPast    = !isAct && !isFuture && !b.autoCancelled
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
    // ← [P2 v7] pending 뱃지는 '자동취소되지 않은 진짜 승인 대기'만
    //   isExpiredPending이 status='pending' 상태도 커버하므로 중복 방지
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

  const sizeClass  = SIZE_CLASS[size]
  // ← [피그마 180:534] shape='square'면 chip--square modifier 자동 추가 (radius 8)
  const shapeClass = shape === 'square' ? 'chip--square' : ''
  const gap = size === 'xs' ? 3 : shape === 'square' ? 4 : 5 // ← [피그마] 사각칩은 gap 4

  const C = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
    <span className={`chip ${sizeClass} ${shapeClass} ${cls}`.trim().replace(/\s+/g, ' ')}>{children}</span>
  )

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* ← [피그마 180:534] 내 예약은 항상 맨 앞. sm 소형카드 제외, 노쇼(생성자 박제)도 표시 */}
      {show('mine') && isOwner && (!b.autoCancelled || isNoshow) && !isRejected && size !== 'sm' && <C cls="chip-mine">내 예약</C>}

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

      {/* ⑧ 진행 중 */}
      {show('active') && isAct && !b.autoCancelled && (
        <span className={`chip ${sizeClass} ${shapeClass}`.trim().replace(/\s+/g, ' ')} style={{ background: (r?.color ?? '#6366F1') + '18', color: r?.color ?? '#6366F1' }}>
          진행 중
        </span>
      )}

      {/* ⑨ 체크인 대기 / 완료 */}
      {show('checkin-wait') && nci && <C cls="chip-checkin-wait">체크인 대기</C>}
      {show('checkin-done') && b.checkedIn && isAct && <C cls="chip-success">체크인 완료</C>}

      {/* ⑩ 조기반납 — '사용완료'보다 먼저 (Figma 242:427 순서)
          ← [2026-04-23] 조기반납도 사용완료의 서브셋으로 처리됨
          · earlyEnded=true면 '조기반납' + '사용완료' 세트로 표시 */}
      {show('early-end') && b.earlyEnded && <C cls="chip-earlyend">조기반납</C>}

      {/* ⑪ 사용완료 (이전 '종료')
          ← [2026-04-23] 라벨 '종료' → '사용완료' 통일 (Figma 242:439 스펙)
          · isPast 조건에서 !earlyEnded 제외 → 조기반납도 사용완료에 포함 */}
      {show('past') && isPast && <C cls="chip-done">사용완료</C>}

      {/* ⑫ N분 후 카운트다운 */}
      {show('countdown') && !isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10 && (
        <C cls="chip-countdown">{tl}분 후</C>
      )}
    </div>
  )
}