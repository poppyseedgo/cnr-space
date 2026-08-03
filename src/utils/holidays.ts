/**
 * utils/holidays.ts — 공휴일 조회 SSOT (세션 캐시 + React hook)
 *
 * ✅ 변경 이력
 *  - [2026-08-03] 신규 — 법정 공휴일 표기 기능 (고지 확정: 표기만, 예약 차단 없음)
 *
 * 📌 설계
 *  - 모듈 레벨 캐시: 세션 중 1회만 로드 (holidays 테이블은 연 수십 행, 갱신 드묾)
 *  - 실패 시 빈 Map — 표기만 생략되고 달력 동작 무영향 (안전값 패턴)
 *  - DatePickerPopup / 캘린더 뷰가 useHolidayMap() 하나로 공유 —
 *    prop 배관 없이 컴포넌트 내부 통합이라 사용처 전 화면에 자동 적용
 */

import { useEffect, useState } from 'react'
import { loadHolidays } from '../lib/api'

/** 'YYYY-MM-DD' → { holiday?: 공휴일명, company?: 회사 이벤트명 }
 *  ← [2026-08-03] kind 확장 — 같은 날 공휴일+패밀리데이 공존 가능 (복합 PK) */
export interface DayInfo { holiday?: string; company?: string }
let cache: Map<string, DayInfo> | null = null
let inflight: Promise<Map<string, DayInfo>> | null = null

export async function ensureHolidayMap(): Promise<Map<string, DayInfo>> {
  if (cache) return cache
  if (!inflight) {
    inflight = loadHolidays()
      .then(rows => {
        const m = new Map<string, DayInfo>()
        for (const r of rows) {
          const info = m.get(r.holiday_date) ?? {}
          if (r.kind === 'company') info.company = r.name
          else info.holiday = r.name
          m.set(r.holiday_date, info)
        }
        cache = m
        return m
      })
      .catch(() => {
        // 실패는 캐시하지 않음 — 다음 화면 진입에서 재시도
        inflight = null
        return new Map<string, DayInfo>()
      })
  }
  return inflight
}

/** 관리자 수정 후 즉시 반영이 필요할 때 캐시 무효화 (Phase 3 어드민 탭에서 사용) */
export function invalidateHolidayCache() {
  cache = null
  inflight = null
}

/** 렌더링용 hook — 로드 전엔 빈 Map (표기만 잠시 생략) */
export function useHolidayMap(): Map<string, DayInfo> {
  const [map, setMap] = useState<Map<string, DayInfo>>(() => cache ?? new Map())
  useEffect(() => {
    let alive = true
    if (!cache) ensureHolidayMap().then(m => { if (alive) setMap(m) })
    return () => { alive = false }
  }, [])
  return map
}
