/**
 * timeSeries.ts — 기간 길이에 따라 자동으로 단위를 바꾸는 시계열 집계
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규 생성 — "노쇼 현황 기간 선택 시 그래프가 사라지는" 버그의 근본 수정
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🐞 버그 원인
 *   기존 차트는 **일 단위 막대 고정**이었다.
 *     · '3개월'  → 90개 막대를 357px에 그림 → 막대 폭 2.5px (사실상 판독 불가)
 *     · '전체'   → 200개 이상 → 폭 0.7px (보이지 않음)
 *     · 1년 초과 → `diffDays > 365` 가드에 걸려 빈 배열 → **그래프 자체가 사라짐**
 *
 * 🔧 근본 수정
 *   막대 개수를 화면이 감당할 수 있는 범위로 유지하도록 **집계 단위를 자동 전환**한다.
 *   기간이 늘어나도 막대 수가 폭발하지 않으므로 가드(365일 컷)가 필요 없어지고,
 *   어떤 기간을 골라도 항상 읽히는 그래프가 나온다.
 *
 *     ~ 31일  : 일 단위   (최대 31개)
 *     ~ 120일 : 주 단위   (최대 18개, 월요일 시작)
 *     그 이상 : 월 단위   (기간이 3년이어도 36개)
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Bucket = 'day' | 'week' | 'month'

/** 기간 길이(일) → 집계 단위 */
export function pickBucket(diffDays: number): Bucket {
  if (diffDays <= 31)  return 'day'
  if (diffDays <= 120) return 'week'
  return 'month'
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  day: '일별', week: '주별', month: '월별',
}

function addDays(base: string, n: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 그 날짜가 속한 버킷의 키(시작일) */
export function bucketKeyOf(date: string, bucket: Bucket): string {
  if (bucket === 'day') return date
  if (bucket === 'month') return date.slice(0, 7) + '-01'
  // week — 월요일 시작
  const d = new Date(date + 'T00:00:00')
  const dow = d.getDay()                     // 0=일
  const back = dow === 0 ? 6 : dow - 1       // 일요일은 6일 전 월요일
  d.setDate(d.getDate() - back)
  return d.toISOString().slice(0, 10)
}

/** 버킷 표시 라벨 */
export function bucketLabel(key: string, bucket: Bucket): string {
  const [y, m, d] = key.split('-')
  if (bucket === 'month') return `${Number(m)}월`
  if (bucket === 'week')  return `${Number(m)}/${Number(d)}~`
  return `${Number(m)}/${Number(d)}`
}

export interface SeriesPoint<T> {
  /** 버킷 시작일 (YYYY-MM-DD) */
  key:   string
  label: string
  /** 이 버킷에 속한 날짜들 */
  dates: string[]
  value: T
}

/**
 * from~to를 버킷 단위로 끊고, 각 버킷을 reducer로 집계한다.
 * 데이터가 없는 버킷도 **빠뜨리지 않는다** — 빠뜨리면 x축 간격이 왜곡된다.
 */
export function buildSeries<T>(
  from: string,
  to: string,
  reduce: (dates: string[]) => T
): { bucket: Bucket; points: SeriesPoint<T>[] } {
  const diffDays = Math.round(
    (new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000
  ) + 1
  if (diffDays <= 0) return { bucket: 'day', points: [] }

  const bucket = pickBucket(diffDays)
  const map = new Map<string, string[]>()

  for (let i = 0; i < diffDays; i++) {
    const date = addDays(from, i)
    const key  = bucketKeyOf(date, bucket)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(date)
  }

  const points = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, dates]) => ({ key, label: bucketLabel(key, bucket), dates, value: reduce(dates) }))

  return { bucket, points }
}
