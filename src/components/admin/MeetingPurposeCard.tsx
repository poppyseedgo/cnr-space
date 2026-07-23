/**
 * MeetingPurposeCard.tsx — 위젯 ⑨ 회의실 사용 목적 AI 분석 (Figma 551:3548)
 *
 * ✅ 변경 이력
 *  - [2026-07-23 Phase 3] 신규 생성 — 버블 차트 5개 + 표 5행 (592폭)
 *  - [2026-07-23 Phase 3 수정] Figma 갱신 반영 — 전면 재작성
 *    · 버블 차트 → **가로 100% 스택 바**(h40). 세그먼트 폭이 비율에 비례하고
 *      안에 "라벨 N%"를 흰 글씨로 표기, 투명도가 순위별로 옅어진다.
 *    · 표 2컬럼(회의 목적 / 건 수 및 비율) → **3컬럼(회의 목적 / 건 수 / %)**
 *    · 상위 5개만 → **10분류 전부 노출** (고지 지시)
 *    · 카드 폭 592 → **1200 풀폭**, 높이 고정 504 → 내용 기반 auto
 *    · 스택 바 세그먼트·표 행 클릭 → 그 분류의 개별 예약 목록으로 드릴다운 (고지 요청)
 *
 * 📌 분류·집계는 utils/meetingPurpose.ts가 단독 담당한다.
 *    이 파일에 판정식은 없다 — DetailDrawer도 같은 함수를 쓰므로 숫자가 구조적으로 일치한다.
 */
import { useState, useMemo } from 'react'
import { DashboardRangeRow } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import { aggregatePurposes, segmentAlpha, type PurposeCode } from '../../utils/meetingPurpose'
import { todayStr } from '../../utils/time'

const FONT = "'Pretendard', -apple-system, sans-serif"

// Figma 2646:7629 — 스택 바 높이
const BAR_H = 40

function defaultFrom(): string {
  const d = new Date(todayStr() + 'T00:00:00')
  d.setDate(d.getDate() - 29)
  return d.toISOString().slice(0, 10)
}

export function MeetingPurposeCard({ onPickPurpose }: {
  /** 분류 하나 선택 → 그 분류의 개별 예약 목록으로 드릴다운 (AdminPage가 DetailDrawer를 연다) */
  onPickPurpose?: (code: PurposeCode) => void
}) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ← [2026-07-23] slice(0,5) 제거 — 10분류 전부 노출 (고지 지시)
  const rows = useMemo(() => aggregatePurposes(bookings), [bookings])

  const pick = (e: React.MouseEvent, code: PurposeCode) => {
    e.stopPropagation()          // ← 카드 wrapper의 DetailDrawer 오픈과 충돌 방지
    onPickPurpose?.(code)
  }

  return (
    <div style={{
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 24px 16px',   // ← Figma: pt12 px16 pb24
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      gap:           24,                       // ← Figma: gap 24 (헤더 / 바 / 표)
      width:         '100%',
      // ← [2026-07-23] height 고정(504) 제거. 표 높이는 행 수로 정해진다.
    }}>
      {/* ── 헤더 (Figma 551:3549 — 타이틀 22 + gap8 + 날짜행 21) ─────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
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

      {/* ── 가로 100% 스택 바 (Figma 2646:7629 — h40) ──────────────────────
            · 세그먼트 폭 = flexGrow에 비율을 그대로 넣어 100%를 정확히 분할한다.
              px로 계산해 나누면 반올림 오차가 누적돼 마지막 세그먼트가 삐져나온다.
            · 비율이 작은 분류는 라벨이 잘린다 — 폭 자체가 정보이므로 억지로 늘리지 않고,
              정확한 값은 아래 표(10행 전부)와 hover 툴팁에서 확인한다. */}
      <div style={{ display:'flex', alignItems:'center', height:BAR_H, width:'100%', overflow:'hidden' }}>
        {rows.length === 0 ? (
          <div style={{
            flex:1, height:'100%', display:'flex', alignItems:'center', justifyContent:'center',
            background:'#F6F7FA', fontFamily:FONT, fontSize:12, color:'#CBD5E1',
          }}>{loading ? '로딩 중…' : '데이터 없음'}</div>
        ) : rows.map((r, i) => (
          <div
            key={r.code}
            onClick={(e) => pick(e, r.code)}
            title={`${r.label} ${r.count}건 (${(r.ratio * 100).toFixed(1)}%)`}
            style={{
              flexGrow:   r.ratio,          // ← 비율 그대로 = 100% 정확 분할
              flexBasis:  0,
              minWidth:   0,
              height:     '100%',
              display:    'flex',
              alignItems: 'center',
              padding:    '2px 12px',
              background: `rgba(0,0,0,${segmentAlpha(i, rows.length).toFixed(2)})`,
              cursor:     'pointer',
              overflow:   'hidden',
            }}>
            <span style={{
              fontFamily: FONT,
              fontWeight: 400, fontSize: 12, lineHeight: 1.5, color: '#fff',
              letterSpacing: '0.12px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{r.short} {(r.ratio * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>

      {/* ── 목적별 표 (Figma 2646:7551 — 3컬럼 · 10행 전부) ────────────────
            행 클릭 → 그 분류의 개별 예약 목록(회의 제목·예약자·날짜)으로 드릴다운 */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {/* 헤더행 — Figma: Medium 11 / #9CA3AF / py8 */}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', width:'100%' }}>
          {['회의 목적','건 수','%'].map(l => (
            <div key={l} style={{ flex:1, minWidth:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:500, fontSize:11, lineHeight:1.5, color:'#9CA3AF',
              }}>{l}</span>
            </div>
          ))}
        </div>

        {rows.length === 0 ? (
          <div style={{
            padding:'24px 0', textAlign:'center',
            fontFamily:FONT, fontSize:12, color:'#CBD5E1',
          }}>{loading ? '로딩 중…' : '해당 기간에 예약이 없습니다'}</div>
        ) : rows.map(r => (
          <div
            key={r.code}
            onClick={(e) => pick(e, r.code)}
            style={{
              display:'flex', alignItems:'center', gap:12, padding:'8px 0', width:'100%',
              borderTop:'1px solid #FAFBFF',   // ← Figma: 데이터 행마다 border-t
              cursor:'pointer',
              transition:'background 0.15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FAFBFF' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:400, fontSize:14, lineHeight:1.5, color:'#000',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', display:'block',
              }}>{r.label}</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:400, fontSize:13, lineHeight:1.5, color:'#000',
              }}>{r.count} 건</span>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <span style={{
                fontFamily:FONT, fontWeight:400, fontSize:13, lineHeight:1.5, color:'#000',
              }}>{(r.ratio * 100).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
