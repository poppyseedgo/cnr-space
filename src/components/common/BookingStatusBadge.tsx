import type { Booking, Room } from '../../types'
import { tsDate, tsMin, todayStr, nowMinutes } from '../../utils/time'
import { isBooker } from '../../utils/bookingOwnership'  // ← [2026-04-24 P4-B] isOwner를 isBooker(UUID/email)로 교체

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
 *  - [2026-04-30 다이아몬드 hotfix] isExpiredPending에 room_id=3 가드 추가
 *    · 증상: 다이아몬드 룸 예약이 stale state 사고로 cancelledBy='system' 마킹되면
 *            "기한초과 취소" 칩이 오표시됨 (audit_log로 다수 케이스 확인)
 *    · 원인: BookingStatusBadge의 isExpiredPending 공식에 room_id 가드 부재
 *    · 해결: && b.room_id === 3 한 줄 추가 (pending_expired는 Emerald 전용 — 메모리 표준)
 *    · 짝 배포: 없음 (단일 파일 변경)
 *    · 후속 (대기): BookingStatusBadge isExpiredPending 공식을 slotHelpers.ts와 통일
 *                  (단일 진실 원천 — 별도 정책 결정 후 진행 예정)
 *
 *  - [2026-04-24 P7-A] isOwner fallback 제거 — 이름 비교 코드 완전 삭제
 *    · 호출부 4곳 (MyPage/HomeView/BookingListTable/DetailModal 경유 DetailModalStatusBadge)
 *      모두 currentUserId/Email 전달 완료 확인 → fallback 불필요
 *    · 원칙 달성: 판정 로직에서 b.user === currentUser 이름 비교 0건
 *    · currentUser prop은 인터페이스 레벨 @deprecated로 유지 (호출부 호환성)
 *    · 짝 배포: DetailModalStatusBadge + 호출부 4곳 currentUser prop 전달 제거
 *
 *  - [2026-04-24 P4-B] "내 예약" 뱃지 판정 이름 비교 → UUID/email 기반 (isBooker)
 *    · 배경: 팀즈/Azure AD 이름 변경 후 '내 예약' 뱃지 사라지는 버그
 *    · 원인: isOwner = b.user === currentUser (이름 snapshot 비교)
 *    · 해결: isBooker(b, currentUserId, currentUserEmail) — UUID OR email 이중 복원
 *    · 추가 prop: currentUserId?, currentUserEmail? (기존 currentUser prop은 Deprecated)
 *    · 호환성: 기존 currentUser prop 유지 (제거하면 호출부 일괄 수정 필요)
 *              → 새 prop 있으면 isBooker, 없으면 기존 이름 비교 fallback
 *              → P4-B-3로 모든 호출부 전환 완료되면 다음 배포에서 fallback 제거 예정
 *    · 짝 배포: DetailModalStatusBadge 래퍼 + MyPage/HomeView/DetailModal/BookingListTable 호출부
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
  /** @deprecated P4-B-3 이후 제거 예정. 대신 currentUserId + currentUserEmail 사용 */
  currentUser?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 UUID (authUser.user_id) */
  currentUserId?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 이메일 (authUser.email) */
  currentUserEmail?: string
  /** md = DetailModal·ListView / sm = 소형카드 / xs = 캘린더 슬롯 */
  size?:        'md' | 'sm' | 'xs'
  /** 지정 시 해당 타입의 뱃지만 렌더. 미지정 시 전체 자동 판별. */
  only?:        BadgeType[]
  /** ← [피그마 180:534 신규] 'square' = BookingDetailModal 사각형 칩(radius 8) / 기본 'pill' */
  shape?:       'pill' | 'square'
  /** ← [Figma UI갱신 2026-04-29] 소형 카드용 표시 칩 수 상한 (기본: 제한 없음)
   *    · 우선순위 순서대로 chipList 수집 후 slice(0, maxChips) 처리
   *    · 뱃지 순서: rejected > expired-pending > admin-cancel > noshow > user-cancel
   *               > pending > approved > active > checkin-wait > checkin-done
   *               > early-end > past > countdown */
  maxChips?:    number
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
  currentUserId = '',      // ← [2026-04-24 P4-B]
  currentUserEmail = '',   // ← [2026-04-24 P4-B]
  size = 'md',
  only,
  shape = 'pill',
  maxChips,                // ← [Figma UI갱신 2026-04-29] 소형 카드 1칩 제한용
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
  //  ← [2026-04-30 다이아몬드 hotfix] room_id=3 가드 추가
  //    배경: stale state 사고로 다이아몬드(room_id≠3) 예약이 React state에서
  //          cancelledBy='system' 마킹된 케이스에서 "기한초과 취소" 칩 오표시 발생.
  //          (audit_log로 확인 — 2026-04-30 06:11 다수 발생)
  //    원칙: pending_expired는 Emerald 전용(메모리 표준). slotHelpers.ts L119와 일관.
  //    단일 진실 원천: BookingStatusBadge와 slotHelpers의 isExpiredPending 공식 자체는
  //                   여전히 다름(별도 통일 작업 대기). 본 hotfix는 room_id 가드만 보강.
  const isExpiredPending = isSystemCancel
                           && b.room_id === 3                                       // ← [2026-04-30] Emerald 전용 가드
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
  // ← [2026-04-24 P7-A] isOwner 판정 fallback 제거 — 이름 비교 0건 원칙 달성
  //   기존(P4-B): (currentUserId || currentUserEmail) ? isBooker(...) : (b.user === currentUser)
  //                ↑ 호환성 위해 이름 비교 fallback 유지
  //   변경(P7-A): isBooker(...) 단일 경로
  //                ↑ 호출부 4곳(MyPage/HomeView/BookingListTable/DetailModal) 모두
  //                  currentUserId/Email 전달 완료 확인됨 → fallback 불필요
  //   원칙: "이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식" (UUID OR email 이중 복원)
  //   주의: currentUser prop은 인터페이스 레벨에서 유지 (@deprecated), 내부 로직에서 참조 안 함
  const isOwner = isBooker(b, currentUserId, currentUserEmail)

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

  // ← [Figma UI갱신 2026-04-29] 칩을 배열로 수집 → maxChips로 slice 가능하게 변경
  //   · 기존: 각 칩을 JSX 조건부 렌더로 직렬 나열 → maxChips 지원 불가
  //   · 변경: chipList 배열에 push → slice(0, maxChips) 후 렌더
  //   · 판정 조건 완전 동일 (공식 변경 없음, 렌더 방식만 변경)
  //   · 뱃지 순서 정책 (소형 카드 우선순위 기준):
  //     mine → rejected → expired-pending → admin-cancel → noshow → user-cancel
  //     → pending → approved → active → checkin-wait → checkin-done
  //     → early-end → past → countdown
  const chipList: React.ReactNode[] = []

  // ← [피그마 180:534] 내 예약은 항상 맨 앞. sm 소형카드 제외, 노쇼(생성자 박제)도 표시
  if (show('mine') && isOwner && (!b.autoCancelled || isNoshow) && !isRejected && size !== 'sm')
    chipList.push(<C key="mine" cls="chip-mine">내 예약</C>)
  // ① 거절됨 — 최우선, 단독 표시
  if (show('rejected') && isRejected)
    chipList.push(<C key="rejected" cls="chip-rejected">거절됨</C>)
  // ② 기한초과 취소 (pending + autoCancelled)
  if (show('expired-pending') && isExpiredPending)
    chipList.push(<C key="expired" cls="chip-expired">기한초과 취소</C>)
  // ③ 관리자 강제취소 (rejected 제외)
  if (show('admin-cancel') && isAdminCancel)
    chipList.push(<C key="admin" cls="chip-admin">관리자 강제취소</C>)
  // ④ 노쇼 (system 자동취소)
  if (show('noshow') && isNoshow)
    chipList.push(<C key="noshow" cls="chip-noshow">노쇼</C>)
  // ⑤ 사용자 직접 취소 — 본인 컨텍스트(MyPage)에서만
  if (show('user-cancel') && isUserCancel && isOwner)
    chipList.push(<C key="usercancel" cls="chip-neutral">취소됨</C>)
  // ⑥ 승인 대기
  if (show('pending') && b.status === 'pending' && !b.autoCancelled)
    chipList.push(<C key="pending" cls="chip-pending">승인 대기</C>)
  // ⑦ 승인완료
  if (show('approved') && isApproved)
    chipList.push(<C key="approved" cls="chip-approved">승인완료</C>)
  // ⑧ 진행 중 (room color 동적 적용)
  if (show('active') && isAct && !b.autoCancelled)
    chipList.push(
      <span key="active" className={`chip ${sizeClass} ${shapeClass}`.trim().replace(/\s+/g, ' ')}
        style={{ background: (r?.color ?? '#6366F1') + '18', color: r?.color ?? '#6366F1' }}>
        진행 중
      </span>
    )
  // ⑨ 체크인 대기 / 완료
  if (show('checkin-wait') && nci)
    chipList.push(<C key="checkin-wait" cls="chip-checkin-wait">체크인 대기</C>)
  if (show('checkin-done') && b.checkedIn && isAct)
    chipList.push(<C key="checkin-done" cls="chip-success">체크인 완료</C>)
  // ⑩ 조기반납 — '사용완료'보다 먼저 (Figma 242:427 순서)
  //    ← [2026-04-23] earlyEnded=true면 '조기반납' + '사용완료' 세트로 표시
  if (show('early-end') && b.earlyEnded)
    chipList.push(<C key="early-end" cls="chip-earlyend">조기반납</C>)
  // ⑪ 사용완료 ← [2026-04-23] 라벨 '종료' → '사용완료', !earlyEnded 제외
  if (show('past') && isPast)
    chipList.push(<C key="past" cls="chip-done">사용완료</C>)
  // ⑫ N분 후 카운트다운
  if (show('countdown') && !isAct && !b.autoCancelled && isToday && tl > 0 && tl <= 10)
    chipList.push(<C key="countdown" cls="chip-countdown">{tl}분 후</C>)

  // ← [Figma UI갱신] maxChips 미지정 시 전체 표시, 지정 시 상위 N개만
  const visibleChips = maxChips !== undefined ? chipList.slice(0, maxChips) : chipList

  return (
    <div style={{ display: 'inline-flex', gap, flexWrap: 'wrap', alignItems: 'center' }}>
      {visibleChips}
    </div>
  )
}