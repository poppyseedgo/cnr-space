/**
 * resourceStatus.ts — 자원 예약·개체 파생 상태 SSOT
 *
 * 원칙: DB 는 상태를 저장하지 않는다 (items.status 는 관리 상태 3종만).
 *       "예약가능/사용중/연체" 는 confirmed 예약 + 현재 시각에서 매번 계산한다.
 *       (회의실 getRoomStatus, 도서 utils/bookLoan.ts 와 동일 원칙)
 *
 * ★ 원칙 (2026-08-27 고지 확정)
 *   실물 점유 = 시작 후 ~ 관리자 [반납 확인] 까지. 시각·반납일과 무관하게 반납 확인 전엔 계속 점유다.
 *   반납일(KST 날짜)이 지나도록 점유 중이면 연체. 반납일 당일까지는 사용중.
 *
 *   · 점유(isOccupying) = confirmed AND 미반납 AND start_at ≤ now   ← 상한 없음
 *   · 연체(isResourceOverdue) = 점유 중 AND return_due < today(KST)
 *   · occupied_until 은 DB EXCLUDE 의 "예약 가능 범위" 계산값(시작~반납일 19:00, 조기 반납이면 반납 시각)이다.
 *     표시 판정에는 쓰지 않는다 — 반납 확인 전 점유는 그 값을 넘어서도 계속된다. 타임라인·캘린더 띠의 끝 날짜에만 쓴다.
 *
 * 예약 판정식 (status='confirmed' 대상, today = KST 날짜)
 *   예정(upcoming)   now < start_at
 *   사용중(inuse)    start_at ≤ now  AND  return_due ≥ today  AND  미반납
 *   연체(overdue)    start_at ≤ now  AND  return_due < today  AND  미반납
 *   반납완료         returned_at IS NOT NULL
 *   취소             status='cancelled'
 *
 * 개체 판정식 (카드·타임라인 열 헤더) — 홀더 = 미반납 시작 건 중 가장 먼저 시작한 것(실물을 쥔 사람)
 *   점검중/폐기      items.status
 *   연체             홀더가 연체
 *   사용중           홀더가 사용중
 *   예약가능         홀더 없음
 *
 * 표시처 전부가 이 파일의 함수만 쓴다 — 판정식 inline 재구현 금지.
 *   ResourcePage · ResourceTimelineView · ResourceCalendarView · ResourceBookingModal(resourceApi 연체 조회)
 *   ResourceBookingDetailModal · MyResourceBookings · ResourceAdminPanel
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 *  - [2026-08-26] occupiedUntilDay — 조기 반납 시 점유 끝(20260753) 표시 정합
 *  - [2026-08-27] 연체 판정을 occupied_until(시각) → return_due(KST 날짜) 로 분리. bookingDisplayStatus SSOT 승격
 *  - [2026-08-27] 점유 상한 제거 — 반납 확인 전엔 무조건 점유 (고지 확정). 홀더 = 가장 먼저 시작한 미반납 건
 */

import type { ResourceBooking, ResourceItem } from '../types/resource'
import { tsDate } from './time'

/** Date → KST 'YYYY-MM-DD' (브라우저 로컬 시간대 무관 — time.ts tsDate 규약) */
export function kstDay(d: Date): string { return tsDate(d.toISOString()) }

/** 카드에 표시하는 개체 파생 상태 */
export type ResourceDisplayStatus = 'available' | 'inuse' | 'overdue' | 'maintenance' | 'retired'
/** 예약 1건의 파생 상태 */
export type ResourceBookingDisplayStatus = 'upcoming' | 'inuse' | 'overdue' | 'returned' | 'cancelled'

/** 이 예약이 지금 개체를 점유 중인가 — 시작 후 미반납이면 반납 확인 전까지 무조건 점유 (상한 없음) */
export function isOccupying(b: ResourceBooking, now: Date): boolean {
  if (b.status !== 'confirmed' || b.returned_at) return false
  return new Date(b.start_at) <= now
}

/** 연체인가 — 점유 중인데 반납일(KST 날짜)이 지났다 */
export function isResourceOverdue(b: ResourceBooking, now: Date): boolean {
  return isOccupying(b, now) && b.return_due < kstDay(now)
}

/** 예약 1건의 표시 상태 — 상세 모달·마이페이지·어드민 현황·타임라인 블록 공용 */
export function bookingDisplayStatus(b: ResourceBooking, now: Date): ResourceBookingDisplayStatus {
  if (b.status === 'cancelled') return 'cancelled'
  if (b.returned_at)            return 'returned'
  if (isResourceOverdue(b, now)) return 'overdue'
  return new Date(b.start_at) > now ? 'upcoming' : 'inuse'
}

/** 점유 띠가 끝나는 KST 날짜 — 반납 확인됐으면 그 날, 아니면 반납일 (타임라인·캘린더 띠 전용) */
export function occupiedUntilDay(b: ResourceBooking): string {
  return b.returned_at ? tsDate(b.returned_at) : b.return_due
}

/** 개체의 현재 홀더 예약 — 점유 중(미반납·시작 후) 건 가운데 가장 먼저 시작한 것 = 실물을 쥔 사람 */
export function currentHolderBooking(
  bookings: ResourceBooking[], itemId: number, now: Date,
): ResourceBooking | null {
  return bookings
    .filter(b => b.item_id === itemId && isOccupying(b, now))
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
}

/** 카드 뱃지용 개체 파생 상태 */
export function deriveItemStatus(
  item: ResourceItem, bookings: ResourceBooking[], now: Date,
): ResourceDisplayStatus {
  if (item.status === 'maintenance') return 'maintenance'
  if (item.status === 'retired')     return 'retired'
  const holder = currentHolderBooking(bookings, item.id, now)
  if (!holder) return 'available'
  return isResourceOverdue(holder, now) ? 'overdue' : 'inuse'
}

/** 개체의 다음(미래) 확정 예약 — "오늘 14:00~16:00 예약 있음" 표기용 */
export function nextBooking(
  bookings: ResourceBooking[], itemId: number, now: Date,
): ResourceBooking | null {
  return bookings
    .filter(b => b.item_id === itemId && b.status === 'confirmed' && new Date(b.start_at) > now)
    .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']

/** 'YYYY-MM-DD' → '8/21(금)' */
export function fmtDueShort(due: string): string {
  const [y, m, d] = due.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${m}/${d}(${DOW[dt.getDay()]})`
}

/** ISO → 'H:MM' (로컬=KST 전제, 사내 서비스 관례) */
export function fmtTimeShort(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
