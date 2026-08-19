/**
 * resourceStatus.ts — 자원 개체 표시 상태 파생 SSOT (Phase 2A)
 *
 * 원칙: DB 는 상태를 저장하지 않는다 (items.status 는 관리 상태 3종만).
 *       "예약가능/사용중/연체" 는 confirmed 예약 + 현재 시각에서 매번 계산한다.
 *       (회의실 getRoomStatus, 도서 utils/bookLoan.ts 와 동일 원칙)
 *
 * 연체 정의(설계서 §5): status='confirmed' AND returned_at IS NULL AND now > occupied_until
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 */

import type { ResourceBooking, ResourceItem } from '../types/resource'

/** 카드에 표시하는 파생 상태 */
export type ResourceDisplayStatus = 'available' | 'inuse' | 'overdue' | 'maintenance' | 'retired'

/** 이 예약이 지금 개체를 점유 중인가 (사용시간~반납 점유구간 안) */
export function isOccupying(b: ResourceBooking, now: Date): boolean {
  if (b.status !== 'confirmed' || b.returned_at) return false
  return new Date(b.start_at) <= now && now < new Date(b.occupied_until)
}

/** 연체인가 — 점유구간이 끝났는데 반납 확인이 없다 */
export function isResourceOverdue(b: ResourceBooking, now: Date): boolean {
  if (b.status !== 'confirmed' || b.returned_at) return false
  return now >= new Date(b.occupied_until)
}

/** 개체의 현재 홀더 예약 (점유중 우선, 없으면 연체 중 가장 최근) */
export function currentHolderBooking(
  bookings: ResourceBooking[], itemId: number, now: Date,
): ResourceBooking | null {
  const mine = bookings.filter(b => b.item_id === itemId)
  return mine.find(b => isOccupying(b, now))
    ?? mine.filter(b => isResourceOverdue(b, now))
           .sort((a, b) => b.occupied_until.localeCompare(a.occupied_until))[0]
    ?? null
}

/** 카드 뱃지용 파생 상태 */
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
