/**
 * RoomUtilizationCard.tsx — 요일별 가동률 (Figma 2662:7844, 389.33×364)
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규 생성
 *
 * 📐 Figma 1:1
 *   · 헤더 2662:7845  x16 y12  h51  (타이틀 22 + gap8 + 날짜행 21)
 *   · 표   2662:7947  x16 y130 w357.33 h218
 *       - 헤더행 h33 : 월 화 수 목 금 (5열 각 61.87, gap 12)
 *       - 데이터행 h37 × 5
 *
 * 📌 행의 의미 = **주차(week)**
 *   Figma 표에 행 라벨 컬럼이 없어 행이 무엇인지 명시돼 있지 않다.
 *   5행 × 월~금 5열이라는 형태상 "기간을 주 단위로 끊은 캘린더 히트맵"이 유일하게
 *   성립하는 해석이다(회의실이라면 회의실명 컬럼이 있어야 하는데 없다).
 *   고지 요구인 "가장 비어있는 요일 / 가장 바쁜 요일 / 빈틈없이 가동 중인지"에도 부합한다.
 *   ※ 행 라벨이 없으면 어느 주인지 읽을 수 없으므로 각 셀에 날짜 툴팁을 넣었다.
 *
 * 📌 계산은 전부 utils/roomUtilization.ts가 담당한다. 이 파일에 판정식은 없다.
 */
import { useState, useMemo } from 'react'
import { DashboardRangeRow } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import {
  calcUtilization, busiestIdleWeekday, usableMinutes,
  DAILY_USABLE_MIN, WEEKDAY_LABELS, eachDate, occupiesRoom,
} from '../../utils/roomUtilization'
import { isWorkday } from '../../data/holidays'
import { todayStr } from '../../utils/time'
import type { Room } from '../../types'

const FONT = "'Pretendard', -apple-system, sans-serif"
const MAX_WEEK_ROWS = 5   // ← Figma: 데이터행 5

function defaultFrom(): string {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

/** 셀 배경 — 가동률이 높을수록 진하게 (히트맵) */
function heat(rate: number | null): string {
  if (rate === null) return 'transparent'
  return `rgba(0,0,0,${(0.06 + Math.min(1, rate) * 0.74).toFixed(2)})`
}

export function RoomUtilizationCard({ rooms }: { rooms: Room[] }) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  const util = useMemo(
    () => calcUtilization(bookings, rooms, dateFrom, dateTo),
    [bookings, rooms, dateFrom, dateTo]
  )
  const { busiest, idle } = useMemo(() => busiestIdleWeekday(util), [util])

  // ── 주차 × 요일 히트맵 데이터 ────────────────────────────────────────────
  //   최근 MAX_WEEK_ROWS 주만 노출한다(Figma 5행). 기간이 길면 마지막 5주.
  const grid = useMemo(() => {
    const activeRooms = rooms.filter(r => r.is_active).length
    if (activeRooms === 0) return []

    // 날짜별 점유 분 (확정 예약 ∩ 가용 시간대)
    const usedByDate = new Map<string, number>()
    bookings.forEach(b => {
      if (!occupiesRoom(b)) return
      const d = b.start_at.slice(0, 10)
      if (!isWorkday(d)) return
      const m = usableMinutes(
        Number(b.start_at.slice(11, 13)) * 60 + Number(b.start_at.slice(14, 16)),
        Number(b.end_at.slice(11, 13))   * 60 + Number(b.end_at.slice(14, 16)),
      )
      if (m > 0) usedByDate.set(d, (usedByDate.get(d) ?? 0) + m)
    })

    // 주 단위로 묶기 (월요일 시작)
    const weeks = new Map<string, (string | null)[]>()   // 주 시작일 → [월,화,수,목,금] 날짜
    eachDate(dateFrom, dateTo).forEach(d => {
      const wd = new Date(d + 'T00:00:00').getDay()
      if (wd < 1 || wd > 5) return
      const monday = new Date(d + 'T00:00:00')
      monday.setDate(monday.getDate() - (wd - 1))
      const key = monday.toISOString().slice(0, 10)
      if (!weeks.has(key)) weeks.set(key, [null, null, null, null, null])
      weeks.get(key)![wd - 1] = d
    })

    return Array.from(weeks.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-MAX_WEEK_ROWS)
      .map(([weekStart, days]) => ({
        weekStart,
        cells: days.map(d => {
          if (!d) return { date: null, rate: null as number | null }
          if (!isWorkday(d)) return { date: d, rate: null as number | null }   // 휴무일 = 분모 없음
          const cap = activeRooms * DAILY_USABLE_MIN
          return { date: d, rate: cap > 0 ? (usedByDate.get(d) ?? 0) / cap : 0 }
        }),
      }))
  }, [bookings, rooms, dateFrom, dateTo])

  const pct = (r: number) => `${Math.round(r * 100)}%`

  return (
    <div style={{
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',
      height:        364,                       // ← Figma 2662:7844
      width:         '100%',
    }}>
      {/* ── 헤더 (Figma 2662:7845 h51 — 타이틀 22 + gap8 + 날짜행 21) ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
        <p style={{
          fontFamily:FONT, fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>요일별 가동률</p>
        <DashboardRangeRow
          from={dateFrom} to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 요약 한 줄 — 고지 요구 "가장 바쁜/한가한 요일" ────────────────── */}
      <div style={{ display:'flex', alignItems:'baseline', gap:8, width:'100%' }}>
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:28, lineHeight:1.4, color:'#111' }}>
          {loading ? '—' : pct(util.overall.rate)}
        </span>
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.5, color:'#AEB5C4' }}>
          {loading ? '' : `워킹데이 ${util.workdays}일 · 최다 ${busiest !== null ? WEEKDAY_LABELS[busiest] : '—'} / 최소 ${idle !== null ? WEEKDAY_LABELS[idle] : '—'}`}
        </span>
      </div>

      {/* ── 표 (Figma 2662:7947 — 헤더행 33 + 데이터행 37 × 5 = 218) ────── */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {/* 헤더행: 월~금 + 요일별 가동률 */}
        <div style={{ display:'flex', alignItems:'center', gap:12, height:33 }}>
          {WEEKDAY_LABELS.map((l, i) => (
            <div key={l} style={{ flex:1, minWidth:0, display:'flex', alignItems:'baseline', gap:4 }}>
              <span style={{ fontFamily:FONT, fontWeight:400, fontSize:12, lineHeight:1.4, color:'#AEB5C4' }}>{l}</span>
              <span style={{
                fontFamily:FONT, fontWeight:500, fontSize:11, lineHeight:1.4,
                color: i === busiest ? '#111' : i === idle ? '#DC2626' : '#697077',
              }}>{loading ? '' : pct(util.byWeekday[i].rate)}</span>
            </div>
          ))}
        </div>

        {/* 데이터행 — 주차별 히트맵 (5행 고정, 부족분은 빈 행) */}
        {grid.map(w => (
          <div key={w.weekStart} style={{ display:'flex', alignItems:'center', gap:12, height:37 }}>
            {w.cells.map((c, i) => (
              <div key={i}
                title={c.date ? `${c.date}${c.rate === null ? ' · 휴무' : ` · 가동률 ${pct(c.rate)}`}` : ''}
                style={{
                  flex:1, minWidth:0, height:25, borderRadius:6,
                  background: heat(c.rate),
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                <span style={{
                  fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.4,
                  color: c.rate === null ? '#CBD5E1' : c.rate > 0.45 ? '#fff' : '#111',
                }}>{c.date ? (c.rate === null ? '휴무' : pct(c.rate)) : ''}</span>
              </div>
            ))}
          </div>
        ))}
        {Array.from({ length: Math.max(0, MAX_WEEK_ROWS - grid.length) }).map((_, i) => (
          <div key={`empty-${i}`} style={{ height:37 }} />
        ))}
      </div>
    </div>
  )
}
