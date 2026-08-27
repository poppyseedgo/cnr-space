/**
 * resourceStatus.ts — 자원 예약·개체 파생 상태 SSOT
 *
 * 원칙: DB 는 상태를 저장하지 않는다 (items.status 는 관리 상태 3종만).
 *       "예약가능/사용중/연체" 는 confirmed 예약 + 현재 시각에서 매번 계산한다.
 *       (회의실 getRoomStatus, 도서 utils/bookLoan.ts 와 동일 원칙)
 *
 * ★ 두 축을 분리한다 (2026-08-27 개정 — 반납일 당일이 '연체'로 찍히던 사고)
 *   · 점유(occupancy)  = 시각 단위. occupied_until 이 SSOT (DB compute_occupancy, EXCLUDE 와 동일 값).
 *                        "다른 사람이 이 개체를 예약할 수 있는가" 를 결정한다.
 *   · 반납 기한(due)   = 날짜 단위(KST). return_due 가 SSOT.
 *                        "연체인가" 를 결정한다 — 점유가 끝났어도 반납일 당일까지는 연체가 아니다.
 *
 * 예약 판정식 (status='confirmed' 대상, today = KST 날짜)
 *   예정(upcoming)   now < start_at
 *   사용중(inuse)    start_at ≤ now  AND  return_due ≥ today  AND  미반납   ← 점유 끝 여부 무관 (반납 대기 흡수)
 *   연체(overdue)    return_due < today  AND  미반납
 *   반납완료         returned_at IS NOT NULL
 *   취소             status='cancelled'
 *
 * 개체 판정식 (카드·타임라인 열 헤더)
 *   점검중/폐기      items.status
 *   사용중           지금 점유 중인 예약이 있다 (isOccupying)
 *   연체             점유 중인 예약은 없고 연체 예약이 있다
 *   예약가능         그 외 — 사용중 예약이라도 점유가 끝났으면 타인 예약 가능 (EXCLUDE 와 정합)
 *
 * 표시처 전부가 이 파일의 함수만 쓴다 — 판정식 inline 재구현 금지.
 *   ResourcePage · ResourceTimelineView · ResourceCalendarView · ResourceBookingModal(resourceApi 연체 조회)
 *   ResourceBookingDetailModal · MyResourceBookings · ResourceAdminPanel
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 *  - [2026-08-26] occupiedUntilDay — 조기 반납 시 점유 끝(20260753) 표시 정합
 *  - [2026-08-27] 연체 판정을 occupied_until(시각) → return_due(KST 날짜) 로 분리. bookingDisplayStatus SSOT 승격
 */

import type { ResourceBooking, ResourceItem } from '../types/resource'
import { tsDate } from './time'

/** Date → KST 'YYYY-MM-DD' (브라우저 로컬 시간대 무관 — time.ts tsDate 규약) */
export function kstDay(d: Date): string { return tsDate(d.toISOString()) }

/** 카드에 표시하는 개체 파생 상태 */
export type ResourceDisplayStatus = 'available' | 'inuse' | 'overdue' | 'maintenance' | 'retired'
/** 예약 1건의 파생 상태 */
export type ResourceBookingDisplayStatus = 'upcoming' | 'inuse' | 'overdue' | 'returned' | 'cancelled'

/** 이 예약이 지금 개체를 점유 중인가 (start_at ≤ now < occupied_until) */
export function isOccupying(b: ResourceBooking, now: Date): boolean {
  if (b.status !== 'confirmed' || b.returned_at) return false
  return new Date(b.start_at) <= now && now < new Date(b.occupied_until)
}

/** 연체인가 — 반납일(KST 날짜)이 지났는데 반납 확인이 없다. 점유 끝 시각과 무관 */
export function isResourceOverdue(b: ResourceBooking, now: Date): boolean {
  if (b.status !== 'confirmed' || b.returned_at) return false
  return b.return_due < kstDay(now)
}

/** 예약 1건의 표시 상태 — 상세 모달·마이페이지·어드민 현황·타임라인 블록 공용 */
export function bookingDisplayStatus(b: ResourceBooking, now: Date): ResourceBookingDisplayStatus {
  if (b.status === 'cancelled') return 'cancelled'
  if (b.returned_at)            return 'returned'
  if (isResourceOverdue(b, now)) return 'overdue'
  return new Date(b.start_at) > now ? 'upcoming' : 'inuse'
}

/** 점유가 끝나는 KST 날짜 — 표시 계층은 return_due 로 점유일을 늘리지 않는다 (조기 반납 반영) */
export function occupiedUntilDay(b: ResourceBooking): string { return tsDate(b.occupied_until) }

/** 개체의 현재 홀더 예약 (점유중 우선, 없으면 연체 중 반납일이 가장 늦은 건) */
export function currentHolderBooking(
  bookings: ResourceBooking[], itemId: number, now: Date,
): ResourceBooking | null {
  const mine = bookings.filter(b => b.item_id === itemId)
  return mine.find(b => isOccupying(b, now))
    ?? mine.filter(b => isResourceOverdue(b, now))
           .sort((a, b) => b.return_due.localeCompare(a.return_due))[0]
    ?? null
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
