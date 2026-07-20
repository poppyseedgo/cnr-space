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
  return loan.status === 'active' && daysUntilDue(loan.due_at, now) < 0
}

/**
 * 화면 표시용 상태 파생
 *   returned / lost 는 DB status 그대로,
 *   active 는 due_at 기준으로 overdue / due_soon / active 로 세분화.
 */
export function loanDisplayStatus(loan: MyBookLoan, now: Date = new Date()): LoanDisplayStatus {
  if (loan.status === 'returned') return 'returned'
  if (loan.status === 'lost')     return 'lost'

  // status 가 'overdue' 로 저장된 경우도 연체로 취급
  if (loan.status === 'overdue')  return 'overdue'

  const d = daysUntilDue(loan.due_at, now)
  if (d < 0)               return 'overdue'
  if (d <= DUE_SOON_DAYS)  return 'due_soon'
  return 'active'
}

/**
 * 연장 가능 여부 — 서버 RPC 검증 조건과 동일하게 클라에서도 선판정
 *   (버튼 비활성화용. 최종 강제는 서버 RPC가 담당)
 *   조건: active · 미연장(count < 1) · 미연체
 */
export function canExtend(loan: MyBookLoan, now: Date = new Date()): boolean {
  if (loan.status !== 'active')                return false
  if (loan.extension_count >= MAX_EXTENSION)   return false
  if (daysUntilDue(loan.due_at, now) < 0)      return false
  return true
}

/** 연장 불가 사유 (버튼 라벨/툴팁용). 연장 가능하면 null */
export function extendBlockedReason(loan: MyBookLoan, now: Date = new Date()): string | null {
  if (loan.status === 'returned')              return '반납완료'
  if (loan.status === 'lost')                  return '분실'
  if (loan.status !== 'active')                return '연장 불가'
  if (daysUntilDue(loan.due_at, now) < 0)      return '연체·반납요망'
  if (loan.extension_count >= MAX_EXTENSION)   return '연장완료'
  return null
}

/** 'YYYY-MM-DD' 또는 ISO → 'M/D' 표시 */
export function fmtLoanDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
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
    case 'active':   return { bg: '#EFF6FF', color: '#1D4ED8', label: '대여중' }
    case 'due_soon': return { bg: '#FFF7ED', color: '#C2410C', label: '반납임박' }
    case 'overdue':  return { bg: '#FEF2F2', color: '#DC2626', label: '연체중' }
    case 'returned': return { bg: '#F1F5F9', color: '#475569', label: '반납완료' }
    case 'lost':     return { bg: '#F1F5F9', color: '#64748B', label: '분실' }
  }
}
