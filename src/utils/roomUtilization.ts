/**
 * roomUtilization.ts — 회의실 가동률 계산 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규 생성
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 📌 가동률 정의 (고지 확정 2026-07-23)
 *
 *   가동률 = (예약이 회의실을 점유한 시간) / (가용 시간)
 *
 *   · 분자 = status === 'confirmed' 인 예약이 **가용 시간대와 겹치는 분(minute)**
 *       - 취소(status='cancelled')·거절(status='rejected')은 방이 다시 열렸으므로 제외
 *       - 승인 대기(status='pending')는 결과 미확정이므로 제외
 *       - **노쇼는 포함한다.** 노쇼도 예약이 잡혀 있어 다른 사람이 그 시간을 못 썼다.
 *         (isNoshow는 status='confirmed'이므로 별도 분기 없이 자동 포함된다)
 *   · 분모 = 회의실 수 × 워킹데이 수 × 480분
 *
 *   ⚠ "실사용률(노쇼 제외)" / "선점률(취소 포함)" 지표는 만들지 않는다.
 *     고지 지시: 이 카드는 "가장 비어있는 요일 / 가장 바쁜 요일 / 회의실이 빈틈없이
 *     가동 중인지"를 보는 지표다. 노쇼·취소 분석은 목적별 세부 리스트가 담당한다.
 *
 * 📌 가용 시간대 (고지 확정)
 *   09:00~12:00(180분) + 13:00~18:00(300분) = 하루 480분
 *   ⚠ 기존 OPERATING_HOURS(7~19시)는 '시간대별 예약 분포' 카드의 표시 범위이며
 *     **별개 개념**이다. 절대 통합하지 말 것 — 통합하면 두 카드가 동시에 틀어진다.
 *
 * 📌 회의실 집합 (고지 확정)
 *   is_active === true 인 회의실 전부. is_admin_only(에메랄드)도 **포함**한다.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { isWorkday } from '../data/holidays'
import type { Booking, Room } from '../types'

/** 가용 시간대 — [시작분, 종료분) (자정 기준 분) */
export const USABLE_SLOTS: [number, number][] = [
  [9 * 60, 12 * 60],    // 09:00 ~ 12:00
  [13 * 60, 18 * 60],   // 13:00 ~ 18:00  (12~13시 점심 제외)
]

/** 하루 가용 분 = 480 */
export const DAILY_USABLE_MIN = USABLE_SLOTS.reduce((s, [a, b]) => s + (b - a), 0)

/** 요일 표기 (월~금만 사용) */
export const WEEKDAY_LABELS = ['월', '화', '수', '목', '금'] as const

/**
 * 예약 구간(분)과 가용 시간대의 교집합 분 수.
 *
 * 예약이 시업 전·종업 후·점심시간에 걸쳐 있으면 겹치는 부분만 세야 한다.
 * 예) 11:30~13:30 → 11:30~12:00(30) + 13:00~13:30(30) = 60분 (점심 60분 제외)
 */
export function usableMinutes(startMin: number, endMin: number): number {
  return USABLE_SLOTS.reduce(
    (sum, [a, b]) => sum + Math.max(0, Math.min(endMin, b) - Math.max(startMin, a)),
    0
  )
}

/** "YYYY-MM-DDThh:mm:ss+09:00" → 자정 기준 분 */
function toMin(iso: string): number {
  const t = iso.slice(11, 16)          // "hh:mm"
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
}

/** "YYYY-MM-DDThh:mm:ss+09:00" → "YYYY-MM-DD" */
function toDate(iso: string): string {
  return iso.slice(0, 10)
}

/** from~to 사이의 모든 날짜 문자열 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 가동률 집계에 포함되는 예약인가 — 확정 예약만 (노쇼 포함) */
export function occupiesRoom(b: Booking): boolean {
  return b.status === 'confirmed'
}

export interface UtilizationCell {
  /** 점유 분 */
  usedMin:  number
  /** 가용 분 */
  capMin:   number
  /** 0~1. capMin이 0이면 0 */
  rate:     number
}

function cell(usedMin: number, capMin: number): UtilizationCell {
  return { usedMin, capMin, rate: capMin > 0 ? usedMin / capMin : 0 }
}

export interface UtilizationResult {
  /** 기간 전체 가동률 */
  overall:    UtilizationCell
  /** 요일별 (월~금 5칸) */
  byWeekday:  UtilizationCell[]
  /** 회의실별 — rooms 입력 순서 유지 */
  byRoom:     { room: Room; util: UtilizationCell }[]
  /** 워킹데이 수 */
  workdays:   number
  /** 요일별 워킹데이 수 (월~금) */
  workdaysByWeekday: number[]
}

/**
 * 가동률 계산.
 *
 * @param bookings 기간 내 예약 (useBookingsByRange 결과 그대로)
 * @param rooms    회의실 목록 — is_active 필터는 이 함수가 직접 수행한다
 * @param from     YYYY-MM-DD
 * @param to       YYYY-MM-DD
 */
export function calcUtilization(
  bookings: Booking[],
  rooms: Room[],
  from: string,
  to: string
): UtilizationResult {
  const activeRooms = rooms.filter(r => r.is_active)   // ← is_admin_only는 제외하지 않음 (고지 확정)
  const roomCount   = activeRooms.length

  // ── 1. 워킹데이 집계 ────────────────────────────────────────────────────
  const workdays = eachDate(from, to).filter(isWorkday)
  const workdaysByWeekday = [0, 0, 0, 0, 0]            // 월~금
  workdays.forEach(d => {
    const wd = new Date(d + 'T00:00:00').getDay()      // 1=월 … 5=금
    if (wd >= 1 && wd <= 5) workdaysByWeekday[wd - 1]++
  })

  // ── 2. 점유 분 집계 ─────────────────────────────────────────────────────
  const usedByWeekday = [0, 0, 0, 0, 0]
  const usedByRoom    = new Map<number, number>()
  let usedTotal = 0

  bookings.forEach(b => {
    if (!occupiesRoom(b)) return
    const date = toDate(b.start_at)
    if (!isWorkday(date)) return                       // ← 주말·휴무일 예약은 분모에 없으므로 분자에서도 제외
    const wd = new Date(date + 'T00:00:00').getDay()
    if (wd < 1 || wd > 5) return

    const min = usableMinutes(toMin(b.start_at), toMin(b.end_at))
    if (min <= 0) return                               // 가용 시간대 밖 예약(예: 19~20시)은 0분

    usedTotal += min
    usedByWeekday[wd - 1] += min
    usedByRoom.set(b.room_id, (usedByRoom.get(b.room_id) ?? 0) + min)
  })

  // ── 3. 가용 분 계산 ─────────────────────────────────────────────────────
  const capTotal = roomCount * workdays.length * DAILY_USABLE_MIN

  return {
    overall: cell(usedTotal, capTotal),
    byWeekday: workdaysByWeekday.map((days, i) =>
      cell(usedByWeekday[i], roomCount * days * DAILY_USABLE_MIN)
    ),
    byRoom: activeRooms.map(r => ({
      room: r,
      util: cell(usedByRoom.get(r.room_id) ?? 0, workdays.length * DAILY_USABLE_MIN),
    })),
    workdays: workdays.length,
    workdaysByWeekday,
  }
}

/** 가장 바쁜 / 가장 한가한 요일 인덱스 (해당 요일 워킹데이가 0이면 후보에서 제외) */
export function busiestIdleWeekday(r: UtilizationResult): { busiest: number | null; idle: number | null } {
  const candidates = r.byWeekday
    .map((c, i) => ({ i, rate: c.rate, has: r.workdaysByWeekday[i] > 0 }))
    .filter(x => x.has)
  if (candidates.length === 0) return { busiest: null, idle: null }
  const busiest = candidates.reduce((m, x) => (x.rate > m.rate ? x : m))
  const idle    = candidates.reduce((m, x) => (x.rate < m.rate ? x : m))
  return { busiest: busiest.i, idle: idle.i }
}
