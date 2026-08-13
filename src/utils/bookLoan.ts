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

// ─── 대여 시작 판정 SSOT (← [2026-07-23]) ───────────────────────────────────
//
// ★근본 원인 기록 — "대여했는데 대여자가 안 보이다가 오후에 보인다"
//
//   대여일은 KST 정오로 고정 저장한다(`${date}T12:00:00+09:00`).
//   그런데 "이 대여가 시작되었는가" 를 두 가지 기준으로 판정하고 있었다.
//
//     · 잠금(user_checkout_books / admin_checkout_books)
//         → KST **날짜** 비교  (v_req_kst <= v_today_kst)
//         → 오늘 날짜로 대여하면 시각과 무관하게 즉시 books.status='borrowed'
//     · 표시·취소·배치·알림 (프론트 4곳 + DB 3곳)
//         → 절대 **시각** 비교  (checkout_at <= now())
//         → KST 00:00~11:59 구간에는 아직 "시작 전"으로 판정
//
//   그래서 매일 오전에만 다음이 동시에 성립했다.
//     ① 카드는 '대여중'(books.status) 인데 대여자·반납기한 행이 통째로 누락
//     ② 마이페이지는 이미 시작된 대여를 '대여 예정' 으로 표시
//     ③ ★그 상태에서 취소하면 book_checkouts='cancelled' 인데
//        books.status='borrowed' 가 남아 영구 고착 (활성 대여가 없어 반납 버튼도 안 나옴)
//     ④ 09:00 배치가 정오 시작 건을 탈락시켜 시작일 알림이 하루 밀림
//
//   해결은 판정식을 하나로 합치는 것이고, 합칠 기준은 **잠금 쪽(KST 날짜)** 이다.
//   반대로 시각 기준으로 통일하면 "책은 잠겼는데 아직 시작 안 된" 구간이 남아
//   ③ 고착이 그대로 재현된다.
//
//   ※ DB 의 public.book_checkout_started() 와 반드시 같은 식이어야 한다.

/** timestamptz(ISO) / epoch → KST 'YYYY-MM-DD'. 한국은 서머타임이 없어 +9h 고정 */
export function kstDateStr(v: string | number | Date): string {
  const t = typeof v === 'number' ? v : new Date(v).getTime()
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * 대여가 시작되었는가 — 표시·취소·알림 전 경로의 유일한 판정식
 *
 * checkout_at 이 비어 있으면 '시작됨'으로 본다. 값이 없는 대여 건은
 * 즉시 대여(서버 default now())이므로 시작 전일 수 없다.
 */
export function hasCheckoutStarted(
  checkoutAt: string | null | undefined, now: Date = new Date(),
): boolean {
  if (!checkoutAt) return true
  return kstDateStr(checkoutAt) <= kstDateStr(now.getTime())
}

// ─── 연체 패널티 (← [2026-07-21]) ───────────────────────────────────────────
//
// 제재는 반납기한(due_at)이 아니라 "최대 대여 가능 기한"부터 센다.
// 한 권을 최대 14일(대여 7일 + 1회 연장 7일) 쓸 수 있는 것이 기존 정책이라,
// 연장을 안 쓴 사람이 9일째 반납했다면 원래 쓸 수 있던 기간 안이다.
//
//   연장 미사용 → effective_due = due_at + EXTEND_DAYS
//   연장 사용   → effective_due = due_at   (extend RPC 가 이미 +7일 해둠)
//
// 두 경로의 기준일이 같아지므로 "연장 버튼을 눌렀는지"로 제재가 갈리지 않는다.
// ※ 서버 book_effective_due() 와 반드시 같은 식이어야 한다.

/** 제재 발동 임계값(일). 서버 book_penalty_tier() 와 일치 */
export const PENALTY_TIER_DAYS = { warn: 3, mid: 7, permanent: 14 } as const

/** 제재 판정 기준일 */
export function effectiveDueDate(dueAt: string, extensionCount: number): Date {
  const d = new Date(dueAt)
  if ((extensionCount ?? 0) === 0) d.setDate(d.getDate() + EXTEND_DAYS)
  return d
}

/** effective_due 초과 일수 (KST 날짜 단위, 음수면 여유 있음) */
export function penaltyOverdueDays(
  dueAt: string, extensionCount: number, now: Date = new Date(),
): number {
  const eff = effectiveDueDate(dueAt, extensionCount)
  const e0 = new Date(eff.getFullYear(), eff.getMonth(), eff.getDate())
  const n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((n0.getTime() - e0.getTime()) / 86400000)
}

/**
 * 제재까지 남은 일수. 이미 제재 구간이면 0.
 *
 * 화면에 '연체중' 이 떠 있는데 제재는 아직 아닌 구간(due_at 초과 ~ 14일)이
 * 존재한다. 그 구간에서 사용자가 "왜 연체인데 빌려지지?" / "언제부터 막히지?"
 * 를 알 수 있어야 하므로 남은 일수를 노출한다.
 */
export function daysUntilPenalty(
  dueAt: string, extensionCount: number, now: Date = new Date(),
): number {
  return Math.max(0, PENALTY_TIER_DAYS.warn - penaltyOverdueDays(dueAt, extensionCount, now))
}

/** 제재 등급 라벨 */
export function penaltyTierLabel(tier: string | null | undefined): string {
  switch (tier) {
    case '7d':          return '7일 대여 제한'
    case '30d':         return '30일 대여 제한'
    case 'permanent':   return '영구 대여 제한'
    case 'overdue_now': return '연체 중 대여 제한'
    default:            return '대여 제한'
  }
}

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
  // ← [2026-07-23] 절대 시각 비교 → hasCheckoutStarted(KST 날짜) 위임.
  //   시각으로 비교하면 KST 오전 내내 이미 시작된 대여가 '대여 예정'으로 표시된다.
  return loan.status === 'active' && !hasCheckoutStarted(loan.checkout_at, now)
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
  if (!hasCheckoutStarted(loan.checkout_at, now)) return 'scheduled'   // ← [2026-07-23] SSOT 위임

  const d = daysUntilDue(loan.due_at, now)
  if (d < 0)               return 'overdue'
  if (d <= DUE_SOON_DAYS)  return 'due_soon'
  return 'active'
}

/**
 * 연장 판정에 실제로 필요한 필드만 뽑은 구조적 부분집합 (← [2026-07-30])
 *
 *   LibraryPage 의 activeCheckouts 행(BookCheckout)은 MyBookLoan 전체 형태가
 *   아니다(book 조인·신청 플로우 필드 없음). 카드/상세모달에서도 같은 판정식을
 *   쓰기 위해 시그니처를 필요한 4필드로 완화한다 — 판정식을 복제하면
 *   마이페이지와 도서관 화면의 연장 가능 여부가 갈라질 수 있다.
 *   MyBookLoan 은 이 타입에 그대로 대입 가능하므로 기존 호출부는 무변경.
 */
export type ExtendableLoan = Pick<MyBookLoan,
  'status' | 'checkout_at' | 'extension_count' | 'due_at'>

/**
 * 연장 가능 여부 — 서버 RPC 검증 조건과 동일하게 클라에서도 선판정
 *   (버튼 비활성화용. 최종 강제는 서버 RPC가 담당)
 *   조건: active · 미연장(count < 1) · 연체 7일 이내
 *
 * ← [2026-07-20] 정책 변경: "연체=무조건 불가" → "연체 7일까지 허용"
 *   서버 RPC(extend_book_checkout)의 OVERDUE_TOO_LONG 조건과 반드시 일치시킬 것.
 */
export function canExtend(loan: ExtendableLoan, now: Date = new Date()): boolean {
  if (loan.status !== 'active')                return false
  // ← [2026-07-20] 아직 시작하지 않은 예약은 연장 대상이 아니다.
  //   DB status 는 'active' 라 위 검사만으로는 걸러지지 않는다.
  if (!hasCheckoutStarted(loan.checkout_at, now)) return false          // ← [2026-07-23] SSOT 위임
  if (loan.extension_count >= MAX_EXTENSION)   return false
  // 연체일수 = -daysUntilDue. 이 값이 유예 한도를 넘으면 불가.
  if (-daysUntilDue(loan.due_at, now) > OVERDUE_EXTEND_GRACE_DAYS) return false
  return true
}

/** 연장 불가 사유 (버튼 라벨/툴팁용). 연장 가능하면 null */
export function extendBlockedReason(loan: ExtendableLoan, now: Date = new Date()): string | null {
  if (loan.status === 'pending')               return '승인 대기중'   // ← [2026-07-22]
  if (loan.status === 'rejected')              return '거절됨'        // ← [2026-07-22]
  if (loan.status === 'cancelled')             return '예약 취소'
  if (loan.status === 'returned')              return '반납완료'
  if (loan.status === 'lost')                  return '분실'
  if (loan.status !== 'active')                return '연장 불가'
  if (!hasCheckoutStarted(loan.checkout_at, now)) return '대여 시작 전'  // ← [2026-07-23] SSOT 위임
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
/** 'YYYY-MM-DD' + n일 (로컬 자정 산술 — KST 무밀림) */
export function addDaysKst(dateStr: string, n: number): string {
  const d = new Date(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 임의 구간 [startOn, dueOn] 이 구간 p 와 겹치는가.
 *  ← [2026-08-13] 어드민 기한 자유 설정 도입으로 "시작일 + 고정 7일" 전제가 깨져
 *    시작/기한을 각각 받는 형태로 일반화. 서버 EXCLUDE(tstzrange '[]', 양끝 포함)·
 *    admin_set_book_due 사전검사와 동일 경계. */
export function spanWouldConflict(
  startOn: string, dueOn: string,
  p: { start_on: string; due_on: string },
): boolean {
  return startOn <= p.due_on && dueOn >= p.start_on
}

/** 시작일 d 로 대여하면 기간 [d, d+borrowDays] 가 구간 p 와 겹치는가.
 *  ← [2026-07-30] 달력 비활성 판정 SSOT — 서버 EXCLUDE(tstzrange '[]', 양끝 포함) 와
 *    동일 경계. "시작일이 구간 안"만 보면 시작일은 밖인데 반납기한이 뒤 예약을
 *    침범하는 케이스(예: 예약 8/3~ 인데 7/30 시작 → 기한 8/6)를 놓친다.
 *  ← [2026-08-13] 판정식 복제 금지 — spanWouldConflict 로 위임 (동작 무변경). */
export function checkoutWouldConflict(
  startDate: string, borrowDays: number,
  p: { start_on: string; due_on: string },
): boolean {
  return spanWouldConflict(startDate, addDaysKst(startDate, borrowDays), p)
}

/** 'YYYY-MM-DD' → '8/2(일)' — 예약 구간 표시용 짧은 포맷.
 *  ← [2026-07-30] 예약 기간 공개 기능. 로컬 자정 분해 — new Date('YYYY-MM-DD')는
 *    UTC 자정 해석이라 KST에서 하루 밀린다 (DateRows 동일 규칙). */
export function fmtDateShortKo(dateStr: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr
  const d = new Date(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10))
  const yoil = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}(${yoil})`
}

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
