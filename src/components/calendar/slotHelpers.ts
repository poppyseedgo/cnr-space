import { tsMin } from '../../utils/time'
import type { Booking } from '../../types'

/**
 * 캘린더 슬롯 공통 상태 계산
 * Weekly / Daily / Timeline / Monthly 네 뷰에서 동일하게 사용
 *
 * ✅ 변경 이력
 *  - [2026-04-23 HOTFIX] 캘린더 뷰에 취소 예약이 표시되는 버그 해결
 *     · 증상: '사용자 취소' 예약이 모든 캘린더 뷰(Daily/Weekly/Monthly/Timeline)에 표시됨
 *     · 원인: 필터 기준이 auto_cancelled=true 였는데, DB에 취소 예약 중 상당수가
 *             auto_cancelled=false로 저장되어 있음 (마이그레이션 데이터 29건 + 오염 8건)
 *             → '!b.autoCancelled'에서 "정상 예약"으로 오인되어 통과됨
 *     · 해결: 취소 판정 기준을 auto_cancelled → status='cancelled'로 변경
 *            · status는 결정적 상태값 — 취소/거절/확정/승인대기 판별의 진실 원천
 *            · auto_cancelled는 '어떻게 취소됐는지'의 부수 플래그 (신뢰하지 않음)
 *     · 추가: 캘린더 전 뷰 공통 필터 함수 isShownInCalendar 신설
 *            5개 뷰(Daily/Weekly/Monthly/Timeline-정상/Timeline-노쇼)에서 동일하게 호출
 *
 *  - [2026-04-19 P2 v7] pending_expired 노쇼 오판 해결 (판별 로직 통일)
 *     · 기존: `isNoshow = autoCancelled && cancelledBy==='system' && status!=='rejected'`
 *             → pending_expired(시스템 취소)도 노쇼로 오분류됨
 *     · 해결: BookingStatusBadge와 동일한 시간축 기반 판별로 통일
 *            · isExpiredPending: system 취소 + status='pending' OR 시작 후 10분 이내
 *            · isNoshow:        system 취소 + 시작 후 10분 경과 + !isExpiredPending
 *     · 단일 진실 원천: 캘린더 3뷰 + BookingStatusBadge 동일 판별 공유
 */

export interface SlotState {
  sm:               number    // start_at 분 단위
  em:               number    // end_at 분 단위
  isExpiredPending: boolean   // 기한초과 취소 (승인 기한 전/직후 system 취소)
  isNoshow:         boolean   // 노쇼 (시작 후 10분 경과 시 system 취소)
  isEnded:          boolean   // 조기 반납
  isAct:            boolean   // 진행 중
  nci:              boolean   // 진행 중 + 미체크인
  isMyBooking:      boolean
}

/**
 * 캘린더 뷰에 표시할 예약인지 판별 (공통 함수, 모든 뷰 사용)
 *
 * 공통 화면(캘린더)에서 보여야 하는 예약:
 *   · 활성 예약 (status='confirmed' 또는 'pending')
 *   · 노쇼 (system 취소 + 시작 후 10분 경과) → 박제 표시
 *
 * 제외되는 예약:
 *   · 사용자 취소 (status='cancelled' + cancelled_by='user')
 *   · 관리자 강제취소 (status='cancelled' + cancelled_by='admin')
 *   · 거절 (status='rejected')
 *   · 기한초과 (pending_expired: status='pending' + 시작 전 또는 직후 10분 이내 system 취소)
 *   · 데이터 오염 (status='cancelled' + cancelled_by=NULL 또는 기타) — 모두 안전하게 숨김
 *
 * 판정 기준: status (결정적) + cancelled_by (보조)
 *   · auto_cancelled 플래그는 의존하지 않음 (DB 데이터에 혼재된 상태)
 *
 * ← [2026-04-23 HOTFIX] 신설: 5개 캘린더 뷰(Daily/Weekly/Monthly/Timeline-일반/Timeline-노쇼)
 *     모두에서 이 함수를 사용해 판정 로직 통일
 */
export function isShownInCalendar(b: Booking, now: number, isToday: boolean): boolean {
  // ① 거절 → 제외 (auto_cancelled 값과 무관)
  if (b.status === 'rejected') return false

  // ② 취소된 예약 → cancelled_by로 분기
  if (b.status === 'cancelled') {
    // 시스템 취소가 아닌 모든 취소 (user/admin/NULL) → 제외
    if (b.cancelledBy !== 'system') return false
    // 시스템 취소 중에서는 노쇼만 박제 표시
    const st = getSlotState(b, now, isToday, '')
    return st.isNoshow
  }

  // ③ 활성 예약 (confirmed/pending) → 기한초과만 제외하고 표시
  const st = getSlotState(b, now, isToday, '')
  if (st.isExpiredPending) return false

  return true
}

/**
 * 일간 뷰에 표시할 예약인지 판별 (하위 호환용 wrapper)
 *
 * ← [2026-04-23] isShownInCalendar로 통합됨. 기존 호출처 유지 위해 wrapper로 남김.
 */
export function isShownInDailyView(b: Booking, now: number, isToday: boolean): boolean {
  return isShownInCalendar(b, now, isToday)
}

export function getSlotState(
  b: Booking,
  now: number,
  isToday: boolean,
  currentUser = ''
): SlotState {
  const sm = tsMin(b.start_at)
  const em = tsMin(b.end_at)

  // ── 시스템 취소 분리 (BookingStatusBadge P2 v7과 동일 로직) ──────
  const isRejected    = b.status === 'rejected'
  const isUserCancel  = b.autoCancelled && b.cancelledBy === 'user'
  const isAdminCancel = b.autoCancelled && b.cancelledBy === 'admin'
                        && !isRejected && !isUserCancel
  const isSystemCancel = b.autoCancelled && b.cancelledBy === 'system'
                         && !isRejected && !isUserCancel && !isAdminCancel
  // 기한초과: status='pending' 유지되거나, cancelled지만 start_at 도달 직후 (10분 이내)
  const isExpiredPending = isSystemCancel
                           && (b.status === 'pending' || now < sm + 10)
  // 노쇼: 그 외 시스템 취소 (start_at + 10분 경과 이후)
  const isNoshow         = isSystemCancel && !isExpiredPending

  const isEnded     = b.earlyEnded
  const isAct       = isToday && sm <= now && now < em
                      && !isNoshow && !isExpiredPending && !isEnded
  const nci         = isAct && !b.checkedIn
  const isMyBooking = !!currentUser && b.user === currentUser

  return { sm, em, isExpiredPending, isNoshow, isEnded, isAct, nci, isMyBooking }
}

/**
 * 슬롯 텍스트 색상 계산
 *
 * Weekly (dark bg on active):  active → 흰색, ended → 회색, default → room color
 * Daily  (항상 dark #111 bg):  active/normal → 흰색, noshow/expired/ended → 회색
 * Timeline (light bg):         isCan → 회색, default → borderCol
 *
 * ← [P2 v7] isExpiredPending도 noshow와 동일하게 흐릿하게 표시 (둘 다 '버려진' 예약)
 */
export function getSlotColors(opts: {
  variant:   'weekly' | 'daily' | 'timeline'
  isAct:     boolean
  isEnded:   boolean
  isNoshow?: boolean
  isExpiredPending?: boolean
  isCan?:    boolean
  roomColor?: string
  borderCol?: string
}) {
  const { variant, isAct, isEnded, isNoshow = false, isExpiredPending = false,
          isCan = false, roomColor = '#6366F1', borderCol = '#3B82F6' } = opts
  const isCancelledLike = isNoshow || isExpiredPending

  if (variant === 'weekly') {
    return {
      titleColor: isEnded ? '#94A3B8' : isAct ? '#fff' : roomColor,
      subColor:   isEnded ? '#CBD5E1' : isAct ? 'rgba(255,255,255,0.75)' : '#94A3B8',
    }
  }
  if (variant === 'daily') {
    // ← [2026-04-23 v3] 배경색 정책 재변경:
    //   · 진행 중(isAct): 배경 #111 (검정) → 텍스트 흰색
    //   · 그 외(미래/과거/조기반납/사용완료): 배경 #fff (흰색) → 텍스트 검정
    //   · noshow/expired: 흐린 회색 (별도 처리)
    //   호환: isAct가 최우선 판정, cancelled-like는 기존 로직 유지
    if (isAct) {
      return {
        titleColor: '#fff',
        subColor:   'rgba(255,255,255,0.75)',
      }
    }
    return {
      titleColor: isCancelledLike ? '#94A3B8' : '#000000',
      subColor:   isCancelledLike ? '#CBD5E1' : '#94A3B8',
    }
  }
  // timeline
  return {
    titleColor: isCan ? '#94A3B8' : isAct ? '#15803D' : '#1D4ED8',
    subColor:   isCan ? '#94A3B8' : '#64748B',
  }
}
