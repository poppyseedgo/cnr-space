/**
 * bookLoan.ts — 마이페이지 '내 대여' 파생 상태 계산 (SSOT)
 *
 * [2026-07-18] 신규
 *
 * 설계 배경:
 *   DB의 book_checkouts.status 는 active / returned / overdue / lost 이지만,
 *   active → overdue 자동 전환 배치(pg_cron)가 아직 없다.
 *   따라서 "연체 여부"는 DB status 가 아니라 due_at 과 현재시각 비교로 판정하는 것이
 *   유일하게 정확하다. 이 파일이 표시 상태 판정의 SSOT.
 *
 *   LibraryPage 의 isOverdue(due_at < now) 와 동일 기준을 사용해
 *   관리자 화면과 사용자 화면의 연체 판정이 어긋나지 않게 한다.
 */

import type { MyBookLoan, LoanDisplayStatus } from '../types'

/** 반납임박으로 볼 잔여일수 임계값 (D-2 이내) */
export const DUE_SOON_DAYS = 2

/** 연장 시 늘어나는 일수 — DB RPC(extend_book_checkout)의 7일과 반드시 일치 */
export const EXTEND_DAYS = 7

/** 최대 연장 횟수 — DB CHECK(extension_count <= 1)와 일치 */
export const MAX_EXTENSION = 1

/**
 * 예약 가능 범위 — 오늘(KST) 기준 며칠 뒤까지 대여 시작일을 지정할 수 있는가.
 * ← [2026-07-21] 서버 user_checkout_books 의 c_reserve_days 와 반드시 일치.
 *   여기만 바꾸면 화면에서는 고를 수 있는데 저장만 실패한다.
 */
export const RESERVE_MAX_DAYS = 3

/**
 * 연체 상태에서 연장이 허용되는 최대 연체일수 (← [2026-07-20] 정책 변경)
 *
 * 정책: "연체 중에도 연장 가능. 단 연체일이 1회 연장 기일을 넘기면 불가"
 *
 * 근거 (임시방편이 아닌 구조적 이유):
 *   연장은 due_at + 7일이다. 연체 d일 시점에 연장하면 잔여일수는 (7 - d)가 된다.
 *   d > 7 이면 새 due_at 이 여전히 과거 → 연장하자마자 다시 연체 상태가 되어
 *   연장이라는 행위 자체가 무의미해진다. 따라서 상한은 EXTEND_DAYS 와
 *   같을 수밖에 없고, 별도 매직넘버를 두지 않고 EXTEND_DAYS 를 참조한다.
 *   (d === 7 은 새 반납일이 '오늘' — 잔여 0일이지만 허용이 정책)
 */
export const OVERDUE_EXTEND_GRACE_DAYS = EXTEND_DAYS

/**
 * 반납예정일까지 남은 일수 (자정 기준, 정수)
 *   0  = 오늘까지
 *   양수 = N일 남음
 *   음수 = N일 연체
 * 시:분:초를 제거하고 날짜 단위로 비교해 "오늘 자정 직전/직후" 오차를 없앤다.
 */
export function daysUntilDue(dueAt: string, now: Date = new Date()): number {
  const due = new Date(dueAt)
  const d0 = new Date(due.getFullYear(),  due.getMonth(),  due.getDate())
  const n0 = new Date(now.getFullYear(),  now.getMonth(),  now.getDate())
  return Math.round((d0.getTime() - n0.getTime()) / 86400000)
}

/** 연체 여부 (LibraryPage isOverdue 와 동일 기준: 예정일이 지났는가) */
export function isLoanOverdue(loan: MyBookLoan, now: Date = new Date()): boolean {
  // pending/rejected/cancelled 는 대여가 아니므로 연체 대상이 아니다 (← [2026-07-22])
  return loan.status === 'active' && daysUntilDue(loan.due_at, now) < 0
}

/**
 * 아직 시작하지 않은 예약인가 (← [2026-07-21])
 *   DB status 는 'active' 지만 checkout_at 이 미래인 건.
 *   승인 대기(pending)를 대체하는 개념이다.
 */
export function isScheduledLoan(loan: MyBookLoan, now: Date = new Date()): boolean {
  return loan.status === 'active' && !!loan.checkout_at && new Date(loan.checkout_at) > now
}

/**
 * 예약 취소 가능 여부 (← [2026-07-21])
 *   시작 전 본인 예약만. 이미 시작된 대여는 책이 나가 있으므로 취소가 아니라
 *   반납으로 처리해야 한다 — 서버 cancel_book_checkout 의 ALREADY_STARTED
 *   검증과 동일 조건이다.
 */
export function canCancelReservation(loan: MyBookLoan, now: Date = new Date()): boolean {
  return isScheduledLoan(loan, now)
}

/**
 * 화면 표시용 상태 파생
 *   returned / lost 는 DB status 그대로,
 *   active 는 due_at 기준으로 overdue / due_soon / active 로 세분화.
 */
export function loanDisplayStatus(loan: MyBookLoan, now: Date = new Date()): LoanDisplayStatus {
  // ← [2026-07-22] 신청/승인 플로우 상태는 due_at 과 무관하게 그대로 표시
  //   pending 은 아직 대여가 아니므로 D-day/연체 판정 대상이 아니다.
  if (loan.status === 'pending')   return 'pending'
  if (loan.status === 'rejected')  return 'rejected'
  if (loan.status === 'cancelled') return 'cancelled'
  if (loan.status === 'returned') return 'returned'
  if (loan.status === 'lost')     return 'lost'

  // status 가 'overdue' 로 저장된 경우도 연체로 취급
  if (loan.status === 'overdue')  return 'overdue'

  // ← [2026-07-20] 대여 예정 — 관리자가 미래 날짜로 등록(예약)한 건.
  //   DB status 는 'active' 지만 아직 시작 전이라 "대여중"으로 보이면 안 된다.
  //   반납기한도 미래이므로 D-day/연체 판정보다 먼저 걸러야 한다.
  if (loan.checkout_at && new Date(loan.checkout_at) > now) return 'scheduled'

  const d = daysUntilDue(loan.due_at, now)
  if (d < 0)               return 'overdue'
  if (d <= DUE_SOON_DAYS)  return 'due_soon'
  return 'active'
}

/**
 * 연장 가능 여부 — 서버 RPC 검증 조건과 동일하게 클라에서도 선판정
 *   (버튼 비활성화용. 최종 강제는 서버 RPC가 담당)
 *   조건: active · 미연장(count < 1) · 연체 7일 이내
 *
 * ← [2026-07-20] 정책 변경: "연체=무조건 불가" → "연체 7일까지 허용"
 *   서버 RPC(extend_book_checkout)의 OVERDUE_TOO_LONG 조건과 반드시 일치시킬 것.
 */
export function canExtend(loan: MyBookLoan, now: Date = new Date()): boolean {
  if (loan.status !== 'active')                return false
  // ← [2026-07-20] 아직 시작하지 않은 예약은 연장 대상이 아니다.
  //   DB status 는 'active' 라 위 검사만으로는 걸러지지 않는다.
  if (loan.checkout_at && new Date(loan.checkout_at) > now) return false
  if (loan.extension_count >= MAX_EXTENSION)   return false
  // 연체일수 = -daysUntilDue. 이 값이 유예 한도를 넘으면 불가.
  if (-daysUntilDue(loan.due_at, now) > OVERDUE_EXTEND_GRACE_DAYS) return false
  return true
}

/** 연장 불가 사유 (버튼 라벨/툴팁용). 연장 가능하면 null */
export function extendBlockedReason(loan: MyBookLoan, now: Date = new Date()): string | null {
  if (loan.status === 'pending')               return '승인 대기중'   // ← [2026-07-22]
  if (loan.status === 'rejected')              return '거절됨'        // ← [2026-07-22]
  if (loan.status === 'cancelled')             return '예약 취소'
  if (loan.status === 'returned')              return '반납완료'
  if (loan.status === 'lost')                  return '분실'
  if (loan.status !== 'active')                return '연장 불가'
  if (loan.checkout_at && new Date(loan.checkout_at) > now) return '대여 시작 전'
  // ← [2026-07-20] 연장완료 판정을 연체 판정보다 앞으로 이동.
  //   연체이면서 이미 연장한 건은 "연장완료"가 더 정확한 사유다.
  if (loan.extension_count >= MAX_EXTENSION)   return '연장완료'
  if (-daysUntilDue(loan.due_at, now) > OVERDUE_EXTEND_GRACE_DAYS) return '연체·반납요망'
  return null
}

/** 'YYYY-MM-DD' 또는 ISO → 'M/D' 표시 */
export function fmtLoanDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// ─── 반납기한 표기 SSOT (← [2026-07-20]) ─────────────────────────────────────
//
// 정책: 반납일은 "그 날 반납"이 아니라 "대여일 기준 7일 이내 반납"이다.
//   따라서 화면·알림 어디서도 "반납예정 7/27" 처럼 시점으로 표기하지 않고
//   "2026년 7월 27일 월요일 이내 반납" 처럼 기한으로 표기한다.
//
// 이 파일에 모아두는 이유:
//   기존에 날짜 포맷이 bookModalShared(fmtFullDate) / LibraryPage(formatDue) /
//   MyBookLoans(fmtLoanDate) 세 곳에 흩어져 있어 문구 정책이 바뀔 때마다
//   누락이 발생했다. 표기 규칙을 한 곳으로 모아 SSOT로 둔다.
//
// ※ Edge Function(_shared/email-templates.ts, notification-inapp.ts)은
//   Deno 런타임이라 이 파일을 import 할 수 없다. 그쪽에도 동일 포맷이 존재하며,
//   문구를 바꿀 때는 반드시 양쪽을 함께 수정해야 한다.

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토']

/** Date | ISO | 'YYYY-MM-DD' → Date (문자열 날짜는 로컬 자정으로 파싱) */
function toDate(v: Date | string): Date {
  if (v instanceof Date) return v
  // 'YYYY-MM-DD' 를 new Date() 에 그대로 넣으면 UTC 자정으로 파싱되어
  // KST(+9) 환경에서 날짜가 하루 밀린다. 명시적으로 로컬 자정으로 만든다.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  return new Date(v)
}

/** '2026년 7월 27일 월요일' */
export function fmtDueFullKo(v: Date | string): string {
  const d = toDate(v)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS_KO[d.getDay()]}요일`
}

/** '7월 27일(월)' — 카드/테이블 등 좁은 영역용 */
export function fmtDueShortKo(v: Date | string): string {
  const d = toDate(v)
  return `${d.getMonth() + 1}월 ${d.getDate()}일(${WEEKDAYS_KO[d.getDay()]})`
}

/** '2026년 7월 27일 월요일 이내 반납하세요' — 안내 문구 전문 */
export function dueNoticeFull(v: Date | string): string {
  return `${fmtDueFullKo(v)} 이내 반납하세요`
}

/** '7월 27일(월) 이내 반납' — 좁은 영역용 축약 안내 */
export function dueNoticeShort(v: Date | string): string {
  return `${fmtDueShortKo(v)} 이내 반납`
}

/** 대여일 → 반납기한 Date (대여일 + EXTEND_DAYS) */
export function dueDateFrom(checkoutAt: Date | string, days: number = EXTEND_DAYS): Date {
  const d = toDate(checkoutAt)
  const due = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  due.setDate(due.getDate() + days)
  return due
}

/** D-day 라벨: 'D-3' / 'D-day' / '3일 연체' */
export function ddayLabel(dueAt: string, now: Date = new Date()): string {
  const d = daysUntilDue(dueAt, now)
  if (d < 0)  return `${Math.abs(d)}일 연체`
  if (d === 0) return 'D-day'
  return `D-${d}`
}

/** 연장 시 새 반납예정일 (확인 모달 안내용) — 서버 계산과 동일하게 +7일 */
export function previewExtendedDue(dueAt: string): string {
  const d = new Date(dueAt)
  d.setDate(d.getDate() + EXTEND_DAYS)
  return d.toISOString()
}

/** 표시 상태별 뱃지 색상/라벨 (기존 LibraryPage 토큰 체계와 동일 계열) */
export function loanStatusStyle(s: LoanDisplayStatus): { bg: string; color: string; label: string } {
  switch (s) {
    // ← [2026-07-21] pending/rejected 는 폐지된 승인 플로우의 과거 이력 전용
    case 'pending':   return { bg: '#FEF3C7', color: '#B45309', label: '승인 대기중' }
    case 'rejected':  return { bg: '#FEF2F2', color: '#DC2626', label: '거절됨' }
    case 'cancelled': return { bg: '#F1F5F9', color: '#64748B', label: '예약 취소' }
    // 예약(미래 시작)의 정식 표시 상태 — 승인 대기 자리를 대체한다
    case 'scheduled': return { bg: '#EEF2FF', color: '#4338CA', label: '대여 예정' }
    case 'active':   return { bg: '#EFF6FF', color: '#1D4ED8', label: '대여중' }
    case 'due_soon': return { bg: '#FFF7ED', color: '#C2410C', label: '반납임박' }
    case 'overdue':  return { bg: '#FEF2F2', color: '#DC2626', label: '연체중' }
    case 'returned': return { bg: '#F1F5F9', color: '#475569', label: '반납완료' }
    case 'lost':     return { bg: '#F1F5F9', color: '#64748B', label: '분실' }
  }
}
