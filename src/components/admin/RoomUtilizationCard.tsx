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
import { DashboardRangeRow, useReportRange, type CardRangeReporter } from './DashboardRangeFilter'
import { useBookingsByRange } from './useBookingsByRange'
import {
  calcUtilization, busiestIdleWeekday, buildUtilizationGrid,
  WEEKDAY_LABELS, ROW_BUCKET_LABEL,
} from '../../utils/roomUtilization'
import { todayStr, addDays } from '../../utils/time'
import type { Room } from '../../types'

const FONT = "'Pretendard', -apple-system, sans-serif"
const MAX_ROWS = 5        // ← Figma: 데이터행 5 (행 수는 고정, 행이 담는 기간을 늘려 대응)
const ROW_LABEL_W = 34    // ← [2026-07-23] 행 라벨 컬럼 — 행 단위가 기간마다 달라져 라벨 없이는 읽을 수 없다

/**
 * 기본 기간 시작일 = 오늘 −29일 (오늘 포함 30일)
 *
 * ⚠ [2026-07-24 #4] utils/time.addDays 로 교체.
 *   기존 구현은 `new Date(todayStr()+'T00:00:00')`(로컬 파싱) 뒤
 *   `.toISOString().slice(0,10)`(UTC 포맷)이라 KST(UTC+9)에서 **하루가 밀렸다**.
 *   그 결과 이 카드들만 6/24 부터, 나머지 카드는 6/25 부터 조회해
 *   워킹데이 수와 분모가 달라졌다. addDays 는 로컬 파싱·로컬 포맷이라
 *   어느 타임존에서도 달력 그대로 계산된다.
 */
function defaultFrom(): string {
  return addDays(todayStr(), -29)
}

/** 셀 배경 — 가동률이 높을수록 진하게 (히트맵) */
function heat(rate: number | null): string {
  if (rate === null) return 'transparent'
  return `rgba(0,0,0,${(0.06 + Math.min(1, rate) * 0.74).toFixed(2)})`
}

export function RoomUtilizationCard({ rooms, onRangeChange }: { rooms: Room[] } & CardRangeReporter) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

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
      // ← [2026-07-24 #7] 하한 364 → 457 — 옆 '예약 많은 회의실'(Figma 2680:11508)과
      //   같은 행에 놓이므로 하한을 맞춰야 둘 중 하나만 먼저 늘어나는 일이 없다.
      minHeight:     457,
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

      {/* ── 요약 한 줄 — 전체 평균 + 산정 기준 ───────────────────────────
            ★ [2026-07-24 #5] 전체 평균(overall)은 **이 카드에만** 둔다 — 고지 결정.

              이 값은 원래 '회의실별 가동률' 카드에도 같이 떠 있었다. 같은 총량을
              요일로 자르느냐 회의실로 자르느냐의 차이일 뿐이라 두 값은 반드시 같은데
              (요일별 합 = 회의실별 합 = 전체), 화면에는 같은 %가 나란히 두 번 뜨니
              "왜 두 지표가 똑같지?" 로 읽혀 수치 신뢰를 떨어뜨렸다.
              라벨로 설명하는 대신 **한쪽에서 지워** 중복 자체를 없앴다.
              요일별에 남긴 이유: 요일 표는 5개 요일의 평균선 역할을 할 기준값이
              필요하지만, 회의실별은 막대 길이 비교만으로 충분하다.

            ← [2026-07-23] 산정 기준을 카드에 명시한다.
              옆 카드(시간대별 예약 분포)가 "운영시간 오전 7시 부터 오후 7시"를 표기하고 있어
              같은 행에 놓이면 가동률도 7~19시 기준으로 오인된다. 기준을 눈에 보이게 박아둔다. */}
      <div style={{ display:'flex', alignItems:'baseline', gap:8, width:'100%' }}>
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:28, lineHeight:1.4, color:'#111' }}>
          {loading ? '—' : pct(util.overall.rate)}
        </span>
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.5, color:'#AEB5C4' }}>
          {loading ? '' : `전체 평균 · 09–18시 점심 제외 (8h) · 워킹데이 ${util.workdays}일 · 최다 ${busiest !== null ? WEEKDAY_LABELS[busiest] : '—'} / 최소 ${idle !== null ? WEEKDAY_LABELS[idle] : '—'}`}
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

// ════════════════════════════════════════════════════════════════════════════
//  회의실별 가동률 (Figma 2662:7844, 389.33×364)
//
//  [2026-07-23] Figma 본문이 비어 있고 "클로드 추천"만 있어 아래 방침으로 설계했다.
//
//  📌 옆 카드 '예약 많은 회의실'과 무엇이 다른가
//    · 예약 많은 회의실 = **건수** 순위. 30분 회의 10건이 3시간 회의 2건보다 위로 온다.
//    · 회의실별 가동률  = **시간 점유율**. 실제로 그 방이 얼마나 채워졌는지를 본다.
//    두 카드가 나란히 놓이므로 시각 언어를 일부러 다르게 했다:
//    건수 카드는 순위별 회색 그라데이션, 가동률 카드는 **막대 길이 자체가 값**이다.
//    (그라데이션은 순위를 뜻할 뿐 값이 아니라 가동률에는 부적절하다)
//
//  📌 계산은 utils/roomUtilization.calcUtilization().byRoom 을 그대로 쓴다.
//    요일별 가동률 카드와 **같은 함수**이므로 두 카드의 숫자가 구조적으로 일치한다.
// ════════════════════════════════════════════════════════════════════════════

// ← [2026-07-24 #7] 행 높이 고정 폐기 — Graph 블록을 flex 로 채운다 (Figma 2680:11523)
/** Graph 블록 최소 높이 — 9행 × 30.22 + 8 × 1px gap */
const UTIL_GRAPH_MIN_H = 280
/** 우측 값 칸 폭 + 막대와의 간격 (Figma: 값칸 35 + 여백 19.33 ≒ 54) */
const UTIL_VALUE_RESERVE = 54

export function RoomUtilizationByRoomCard({ rooms, onRangeChange }: { rooms: Room[] } & CardRangeReporter) {
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom)
  const [dateTo,   setDateTo]   = useState<string>(todayStr)
  // ← [2026-07-24] 이 카드의 조회 기간을 상위로 보고 → 클릭 시 드로어가 같은 기간으로 열린다
  useReportRange(dateFrom, dateTo, onRangeChange)

  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  const util = useMemo(
    () => calcUtilization(bookings, rooms, dateFrom, dateTo),
    [bookings, rooms, dateFrom, dateTo]
  )
  // 가동률 내림차순 — "어느 방이 포화이고 어느 방이 노는가"가 이 카드의 질문이다
  const rows = useMemo(
    () => [...util.byRoom].sort((a, b) => b.util.rate - a.util.rate),
    [util]
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
      // ← [2026-07-24 #7] 하한 364 → 457 — 옆 '예약 많은 회의실'(Figma 2680:11508)과
      //   같은 행에 놓이므로 하한을 맞춰야 둘 중 하나만 먼저 늘어나는 일이 없다.
      minHeight:     457,
      width:         '100%',
    }}>
      {/* ── 헤더 (Figma 2662:7845 h51 — 타이틀 22 + gap8 + 날짜행 21) ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, width:'100%' }}>
        <p style={{
          fontFamily:FONT, fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>회의실별 가동률</p>
        <DashboardRangeRow
          from={dateFrom} to={dateTo}
          onChange={r => { setDateFrom(r.from); setDateTo(r.to) }}
        />
      </div>

      {/* ── 산정 기준 한 줄 ──────────────────────────────────────────────
            ★ [2026-07-24 #5] 전체 평균 % 를 뺐다 — 고지 결정.
              옆 '요일별 가동률' 카드와 값이 반드시 같아(같은 overall) 화면에
              같은 숫자가 두 번 뜨는 문제가 있었다. 이 카드는 막대 길이로
              회의실 간 비교를 하는 카드라 기준값이 없어도 읽힌다.

            ※ 산정 기준 문구는 **남긴다**. 숫자와 함께 지우면, 옆 카드
              '시간대별 예약 분포'의 "운영시간 오전 7시 부터 오후 7시" 표기 때문에
              이 카드도 7~19시 기준으로 오인된다(원래 이 문구를 넣은 이유).
              워킹데이 수가 남아 있어 이 카드가 어느 기간을 보고 있는지도 드러난다. */}
      <div style={{ display:'flex', alignItems:'baseline', width:'100%' }}>
        <span style={{ fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.5, color:'#AEB5C4' }}>
          {loading ? '' : `09–18시 · 점심 제외 (8h) · 워킹데이 ${util.workdays}일`}
        </span>
      </div>

      {/* ── 회의실별 막대 (← [2026-07-24 #7] Figma 2680:11523 문법으로 통일) ──
            막대 폭 = 가동률. 값이 0인 방도 행을 지우지 않는다 — "안 쓰이는 방"이 곧 정보.

            ★ 무엇을 바꿨나
              · mixBlendMode difference 폐기 — 채움색 #111 위에서는 잘 보였지만
                막대가 짧아 라벨이 트랙(#F4F5FB) 위로 넘어가면 대비가 무너졌고,
                실제 화면에서 8·9위 행의 값이 사라졌다. 값을 **막대 밖 우측**으로 빼
                어떤 폭에서도 읽히게 한다(옆 '예약 많은 회의실' 카드와 같은 배치).
              · 행 높이 고정(26) → Graph 블록 flex:1 + 행 flex:1 균등 분배.
                카드가 늘어나면 행도 같이 늘어나 카드 아래에 빈 공간이 남지 않는다.
              · 행 간격 2 → 1 (Figma). 넓히면 9행이 리스트처럼 끊겨 길이 비교가 어렵다. */}
      <div style={{
        display:'flex', flexDirection:'column', gap:1, width:'100%',
        flex:1, minHeight:UTIL_GRAPH_MIN_H,
      }}>
        {rows.length === 0 ? (
          <div style={{
            padding:'40px 0', textAlign:'center',
            fontFamily:FONT, fontSize:11, color:'#CBD5E1',
          }}>{loading ? '로딩 중…' : '회의실 데이터 없음'}</div>
        ) : rows.map(({ room, util: u }) => (
          <div key={room.room_id}
            title={`${room.room_name} · 가동률 ${pct(u.rate)} (점유 ${Math.round(u.usedMin / 60)}시간 / 가용 ${Math.round(u.capMin / 60)}시간)`}
            style={{
              flex:'1 0 0', minHeight:0, width:'100%',
              background:'#F4F5FB', borderRadius:1, overflow:'hidden',
              display:'flex', alignItems:'center', justifyContent:'space-between',
              fontFamily:FONT, fontWeight:400, fontSize:11, lineHeight:1.25, letterSpacing:'0.11px',
            }}>
            {/* 채움 막대 — 폭이 곧 값. 우측 값 칸(54px)을 뺀 폭에 비율을 곱한다 */}
            <div style={{
              width:`calc((100% - ${UTIL_VALUE_RESERVE}px) * ${Math.min(1, u.rate)})`,
              height:'100%', minWidth: u.rate > 0 ? 2 : 0,
              background:'#111', display:'flex', alignItems:'center',
              padding:'0 12px', boxSizing:'border-box', transition:'width 0.4s ease',
            }}>
              <span style={{
                color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>{room.room_name}</span>
            </div>
            <span style={{ padding:'0 8px', color:'#4A4A4A', flexShrink:0 }}>
              {loading ? '' : pct(u.rate)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
