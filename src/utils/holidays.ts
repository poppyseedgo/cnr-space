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
        // ← [2026-08-03 버그수정] 0행은 캐시하지 않는다.
        //   RLS(authenticated)는 세션 복원 '전' 요청에 에러가 아니라 0행을 반환하므로,
        //   앱 초기 마운트가 로그인 확립보다 빠르면 빈 Map 이 성공으로 영구 캐시되어
        //   라벨이 세션 내내 사라진다 (배포 후 미표시 사고의 근본 원인).
        //   시드 64행이 항상 존재하므로 실환경 0행 = 인증 전/비정상으로 간주해도 안전.
        if (m.size > 0) cache = m
        else inflight = null   // 다음 시도에서 재조회
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
    let timer: ReturnType<typeof setTimeout> | null = null
    if (!cache) {
      ensureHolidayMap().then(m => {
        if (!alive) return
        setMap(m)
        // ← [2026-08-03 버그수정] 빈 결과(인증 전 타이밍)면 2초 후 1회 재시도 —
        //   로그인 직후 첫 화면이 캘린더인 경우 마운트가 세션 확립보다 빠르다
        if (m.size === 0) {
          timer = setTimeout(() => {
            ensureHolidayMap().then(m2 => { if (alive && m2.size > 0) setMap(m2) })
          }, 2000)
        }
      })
    }
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])
  return map
}
