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
  calcUtilization, busiestIdleWeekday, buildUtilizationGrid,
  WEEKDAY_LABELS, ROW_BUCKET_LABEL,
} from '../../utils/roomUtilization'
import { todayStr } from '../../utils/time'
import type { Room } from '../../types'

const FONT = "'Pretendard', -apple-system, sans-serif"
const MAX_ROWS = 5        // ← Figma: 데이터행 5 (행 수는 고정, 행이 담는 기간을 늘려 대응)
const ROW_LABEL_W = 34    // ← [2026-07-23] 행 라벨 컬럼 — 행 단위가 기간마다 달라져 라벨 없이는 읽을 수 없다

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

  // ── 구간 × 요일 히트맵 ───────────────────────────────────────────────
  //   ← [2026-07-23 버그수정] 기존엔 주 단위로 끊고 `.slice(-5)`로 마지막 5주만 잘랐다.
  //     모든 프리셋의 종료일이 '오늘'이라 한 달·3개월·전체가 전부 같은 5주를 보여줬고,
  //     헤더 숫자만 바뀌어 "숫자와 그림이 서로 다른 기간을 말하는" 상태였다.
  //     이제 행을 자르지 않고 **행 단위를 키워**(주→월→분기→연) 항상 기간 전체를 덮는다.
  const { bucket, rows: grid } = useMemo(
    () => buildUtilizationGrid(bookings, rooms, dateFrom, dateTo, MAX_ROWS),
    [bookings, rooms, dateFrom, dateTo]
  )

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
        {/* ← [2026-07-23] 산정 기준을 카드에 명시한다.
              옆 카드(시간대별 예약 분포)가 "운영시간 오전 7시 부터 오후 7시"를 표기하고 있어
              같은 행에 놓이면 가동률도 7~19시 기준으로 오인된다. 기준을 눈에 보이게 박아둔다. */}
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.5, color:'#AEB5C4' }}>
          {loading ? '' : `09–18시 · 점심 제외 (8h) · 워킹데이 ${util.workdays}일 · 최다 ${busiest !== null ? WEEKDAY_LABELS[busiest] : '—'} / 최소 ${idle !== null ? WEEKDAY_LABELS[idle] : '—'}`}
        </span>
      </div>

      {/* ── 표 (Figma 2662:7947 — 헤더행 33 + 데이터행 37 × 5 = 218) ────── */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {/* 헤더행: 월~금 + 요일별 가동률 */}
        <div style={{ display:'flex', alignItems:'center', gap:8, height:33 }}>
          {/* ← [2026-07-23] 행 단위 표기 (주별/월별/분기별/연별) */}
          <div style={{ width:ROW_LABEL_W, flexShrink:0 }}>
            <span style={{ fontFamily:FONT, fontWeight:500, fontSize:9, lineHeight:1.4, color:'#CBD5E1' }}>
              {loading ? '' : ROW_BUCKET_LABEL[bucket]}
            </span>
          </div>
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
        {grid.map(row => (
          <div key={row.key} style={{ display:'flex', alignItems:'center', gap:8, height:37 }}>
            <div style={{ width:ROW_LABEL_W, flexShrink:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:400, fontSize:10, lineHeight:1.4, color:'#AEB5C4',
                whiteSpace:'nowrap',
              }}>{row.label}</span>
            </div>
            {row.cells.map((c, i) => (
              <div key={i}
                title={`${row.label} ${WEEKDAY_LABELS[i]}요일 · ${c.workdays === 0 ? '워킹데이 없음' : `가동률 ${pct(c.rate ?? 0)} (${c.workdays}일 평균)`}`}
                style={{
                  flex:1, minWidth:0, height:25, borderRadius:6,
                  background: heat(c.rate),
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}>
                <span style={{
                  fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.4,
                  color: c.rate === null ? '#CBD5E1' : c.rate > 0.45 ? '#fff' : '#111',
                }}>{c.rate === null ? '—' : pct(c.rate)}</span>
              </div>
            ))}
          </div>
        ))}
        {Array.from({ length: Math.max(0, MAX_ROWS - grid.length) }).map((_, i) => (
          <div key={`empty-${i}`} style={{ height:37 }} />
        ))}
      </div>
    </div>
  )
}
