/**
 * MeetingPurposeCard.tsx — 위젯 ⑨ 회의실 사용 목적 AI 분석 (Figma 551:3548, 592×504)
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 3] 신규 생성
 *
 * 📐 Figma 1:1 좌표
 *   · 헤더  Frame 48096012  x16 y12    h45   (타이틀 22 + gap2 + 날짜행 21)
 *   · 버블  Frame 48096366  x16 y89.5  450×140  (원 5개, 세로 중앙선 y=70 정렬)
 *   · 표    Frame 48096360  x16 y262   560×218  (헤더행 33 + 데이터행 37 × 5)
 *   → pt12 + 45 + 32.5 + 140 + 32.5 + 218 + pb24 = 504 (space-between로 gap 자동 산출)
 *
 * 📌 Figma가 5개만 표시하므로 카드도 상위 5개만 보여준다(표 218px = 정확히 5행).
 *    전체 10분류는 카드 클릭 → DetailDrawer(type='purpose')에서 확인한다.
 *
 * 📌 분류·집계는 전부 utils/meetingPurpose.ts가 담당한다.
 *    이 파일에는 판정식이 존재하지 않는다 — DetailDrawer도 같은 함수를 쓰므로
 *    카드 숫자와 드로어 숫자가 구조적으로 일치한다.
 */
import { useState, useMemo } from 'react'
import { DashboardRangeRow } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import { aggregatePurposes, bubbleDiameters } from '../../utils/meetingPurpose'
import { todayStr } from '../../utils/time'

const FONT = "'Pretendard', -apple-system, sans-serif"

// 상위 N개만 카드에 노출 (Figma 표 218px = 헤더33 + 37×5)
const TOP_N = 5

// Figma 버블 컨테이너 사양
const BUBBLE_BOX_H = 140
const BUBBLE_MAX_D = 140
const BUBBLE_MIN_D = 44
const BUBBLE_MAX_W = 450

function defaultFrom(): string {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

export function MeetingPurposeCard() {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  const all  = useMemo(() => aggregatePurposes(bookings), [bookings])
  const top  = useMemo(() => all.slice(0, TOP_N), [all])
  const dias = useMemo(
    () => bubbleDiameters(top.map(r => r.count), BUBBLE_MAX_D, BUBBLE_MIN_D, BUBBLE_MAX_W),
    [top]
  )

  return (
    <div style={{
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 24px 16px',   // ← Figma: pt12 px16 pb24
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',          // ← 헤더/버블/표 사이 32.5px가 자동 산출됨
      height:        504,
      width:         '100%',
      overflow:      'hidden',
    }}>
      {/* ── 헤더 (gap 2 — 다른 위젯과 동일) ─────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily: FONT,
          fontWeight: 500, fontSize: 16, lineHeight: 1.4, color: '#111', margin: 0,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>회의실 사용 목적 AI 분석</p>
        <DashboardRangeRow
          from={dateFrom}
          to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 버블 차트 (Figma 2646:7629 — 450×140, 세로 중앙선 정렬) ──
            · 원 면적이 건수에 비례 (utils/meetingPurpose.bubbleDiameters)
            · Figma는 원들을 가로로 이어 붙인다 (지름 합 = 컨테이너 폭) */}
      <div style={{
        display:    'flex',
        alignItems: 'center',                  // ← Figma: 모든 원의 중심이 y=70 한 선에 정렬
        height:     BUBBLE_BOX_H,
        maxWidth:   BUBBLE_MAX_W,
        width:      '100%',
      }}>
        {top.length === 0 ? (
          <span style={{ fontFamily: FONT, fontSize: 12, color: '#CBD5E1' }}>
            {loading ? '로딩 중…' : '데이터 없음'}
          </span>
        ) : top.map((r, i) => {
          const d = dias[i]
          // 원이 작아질수록 폰트도 줄인다 (라벨이 원 밖으로 넘치지 않도록)
          const fs = Math.max(9, Math.min(12, Math.round(d / 11)))
          return (
            <div key={r.code}
              title={`${r.label} ${r.count}건 (${(r.ratio * 100).toFixed(1)}%)`}
              style={{
                width: d, height: d, flexShrink: 0,
                borderRadius: '50%',
                background: '#111',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
              <span style={{
                fontFamily: FONT,
                fontWeight: 400, fontSize: fs, lineHeight: 1.4, color: '#fff',
                textAlign: 'center', padding: '0 4px',
                wordBreak: 'keep-all',
              }}>{r.short}</span>
            </div>
          )
        })}
      </div>

      {/* ── 목적별 표 (Figma 2646:7551 — 헤더행 33 + 데이터행 37 × 5 = 218) ── */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {/* 헤더행 h33 */}
        <div style={{ display:'flex', alignItems:'center', height:33 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ fontFamily:FONT, fontWeight:400, fontSize:12, lineHeight:1.4, color:'#AEB5C4' }}>회의 목적</span>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ fontFamily:FONT, fontWeight:400, fontSize:12, lineHeight:1.4, color:'#AEB5C4' }}>건 수 및 비율</span>
          </div>
        </div>

        {/* 데이터행 h37 × 5 — 데이터가 5개 미만이면 placeholder로 채워 카드 높이를 고정 */}
        {top.map(r => (
          <div key={r.code} style={{ display:'flex', alignItems:'center', height:37 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:400, fontSize:14, lineHeight:1.5, color:'#111',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'block',
              }}>{r.label}</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontFamily:FONT, fontWeight:400, fontSize:14, lineHeight:1.5, color:'#111' }}>
                {r.count}건 · {(r.ratio * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        ))}
        {Array.from({ length: Math.max(0, TOP_N - top.length) }).map((_, i) => (
          <div key={`empty-${i}`} style={{ display:'flex', alignItems:'center', height:37 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontFamily:FONT, fontSize:14, color:'#CBD5E1' }}>—</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{ fontFamily:FONT, fontSize:14, color:'#CBD5E1' }}>0건 · 0.0%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
