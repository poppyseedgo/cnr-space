/**
 * useBookingsByRange.ts — 대시보드 위젯 공용 기간 조회 훅
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 2] AdminPage.tsx에서 이 파일로 이동 (로직 1:1 무변경)
 *    · 사유: 신규 위젯(사용자 예약 순위 / 사용자 누적 노쇼)이 별도 파일로 분리되면서
 *            이 훅이 필요해졌는데, AdminPage에서 export하면
 *            AdminPage → DashboardUserCards → AdminPage 순환 참조가 된다.
 *            이 파일의 의존은 lib/api.ts 하나뿐이라 이동이 정답.
 *    · 캐시 dedupe 동작·60초 만료·cancelled 가드 전부 기존 그대로.
 */
import { useState, useEffect } from 'react'
import { loadBookingsByRange } from '../../lib/api'
import type { Booking } from '../../types'

// ─── Booking range fetch cache (dedupe) ─────────────────────────────────────
//   목적: 여러 위젯이 동시에 같은 range로 fetch 호출 → 1번만 실제 fetch
//   동작: module-level Map에 in-flight Promise 저장, 동일 key 요청은 같은 Promise 반환
//   만료: 60초 후 자동 제거 (stale 방지)
//   주의: 이후 위젯 데이터 mutation 발생 시 invalidate 필요 — 현재는 read-only 대시보드라 안전
const bookingRangeCache = new Map<string, Promise<Booking[]>>()

export function fetchBookingsRangeCached(from: string, to: string): Promise<Booking[]> {
  const key = `${from}|${to}`
  const existing = bookingRangeCache.get(key)
  if (existing) return existing
  const promise = loadBookingsByRange(from, to)
  bookingRangeCache.set(key, promise)
  // 60초 후 자동 만료 (동일 range 추가 fetch 시 fresh data)
  setTimeout(() => bookingRangeCache.delete(key), 60_000)
  return promise
}

export function useBookingsByRange(dateFrom: string, dateTo: string) {
  const [data,    setData]    = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchBookingsRangeCached(dateFrom, dateTo)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => console.error('[useBookingsByRange] fetch failed', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  return { data, loading }
}
