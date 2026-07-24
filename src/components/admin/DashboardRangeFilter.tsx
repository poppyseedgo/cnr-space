/**
 * DashboardRangeFilter.tsx — 어드민 대시보드 카드 헤더 공통 날짜 필터
 *
 * ✅ 변경 이력
 *  - [2026-07-23 대시보드 개편 Phase 1] 신규 생성 (Figma node 551:3316)
 *    · 사유: Figma 전 위젯 헤더가 "날짜범위 텍스트 + 프리셋 pill 3종(한 달/3개월/전체)" 로 통일됨.
 *            기존에는 AdminPage.tsx 내부에 SmallDateTrigger가 정의되어 6개 위젯이 각자 인라인으로
 *            <SmallDateTrigger/> × 2 + ⎯ 를 조립하고 있었음 → 프리셋 추가 시 6곳 중복 수정 필요.
 *    · 조치: SmallDateTrigger를 AdminPage.tsx에서 이 파일로 이동(로직 1:1 무변경) 하고,
 *            헤더 한 줄 전체를 DashboardRangeRow 하나로 캡슐화 → 위젯은 from/to/onChange만 넘김.
 *    · SmallDateTrigger를 AdminPage에서 export 하지 않고 "이동"한 이유:
 *            AdminPage → 이 파일 → AdminPage 로 순환 참조가 생기기 때문.
 *            이 파일의 의존은 DatePickerPopup(공통) 하나뿐이라 순환이 발생하지 않음.
 *
 * 📐 Figma 1:1 사양 (node 551:3316 / Frame 48096364)
 *  · 행 전체: h 21, 좌우 space-between
 *  · 좌측 날짜 블록(Frame 48096013): "2026-04-27" ⎯ "2026-05-11", gap 4, 12px/#AEB5C4
 *  · 우측 pill 블록(Frame 48096363): w 125, gap 4
 *      - "한 달"  StatusBadge-XS 38×21
 *      - "3개월"  StatusBadge-XS 43×21
 *      - "전체"   StatusBadge-XS 36×21
 *  · 활성 pill = 배경 #111 / 글자 #fff, 비활성 = 배경 #F4F6FA / 글자 #697077
 */
import { useState, useRef, useEffect } from 'react'
import { DatePickerPopup } from '../common/DatePickerPopup'
import { todayStr } from '../../utils/time'

// ─── 공통 폰트 스택 (AdminPage 카드와 동일) ──────────────────────────────────
const FONT = "'Pretendard', -apple-system, sans-serif"

/**
 * '전체' 프리셋의 시작일.
 * C&R Space 예약 데이터는 2026-03 정식 오픈 이후에만 존재하므로 그 이전 날짜면 무엇이든
 * "전체"와 동일한 결과를 낸다. 임의의 매직값을 코드 곳곳에 흩뿌리지 않기 위해 상수로 고정한다.
 * ※ 과거 데이터 이관 등으로 더 오래된 예약이 생기면 이 값만 앞당기면 된다.
 */
// ═══════════════════════════════════════════════════════════════════════════
//  카드 → 드로어 기간 인계 (← [2026-07-24])
//
//  ★ 배경
//    카드마다 자기 조회 기간(dateFrom/dateTo)을 따로 들고 있는데, 카드를 클릭해
//    열리는 DetailDrawer 는 항상 기본값(−29일 ~ 오늘)으로 열렸다.
//    카드 기본값도 −29일이라 평소엔 우연히 일치했지만, '3개월'로 바꿔 86% 를 보고
//    클릭하면 드로어는 한 달치를 보여준다 → 같은 화면 안에서 숫자가 어긋난다.
//
//  ★ 방식
//    카드는 기간이 바뀔 때마다 상위로 알리기만 한다(보고). 드로어를 여는 주체는
//    여전히 AdminPage 의 래퍼 onClick 이고, 클릭 시점에 마지막으로 보고된 값을 쓴다.
//    카드가 직접 드로어를 열게 바꾸지 않은 이유: 12개 카드가 전부 클릭 주체가 되면
//    래퍼의 hover·클릭 영역과 이중으로 얽혀 기존 동작이 흔들린다.
// ═══════════════════════════════════════════════════════════════════════════

export interface CardRange { from: string; to: string }

/** 대시보드 카드 공통 prop — 자기 조회 기간을 상위에 보고한다 */
export interface CardRangeReporter {
  onRangeChange?: (r: CardRange) => void
}

/**
 * 카드의 현재 기간을 상위로 보고한다. 마운트 직후 1회 + 기간 변경 시마다.
 *
 * ※ onRangeChange 를 의존성에 넣지 않는다 — 호출부가 인라인 화살표 함수를 넘기면
 *   매 렌더마다 새 참조가 되어 무한 루프가 된다. 보고 시점을 결정하는 것은
 *   어디까지나 from/to 값이다.
 */
export function useReportRange(from: string, to: string, onRangeChange?: (r: CardRange) => void) {
  useEffect(() => { onRangeChange?.({ from, to }) }, [from, to])   // eslint-disable-line react-hooks/exhaustive-deps
}

export const ALL_TIME_FROM = '2026-01-01'

// ─── 프리셋 정의 ──────────────────────────────────────────────────────────────
//   offsetDays = "오늘 포함 N일"이 되도록 한 offset (한 달=30일 → -29)
//   [2026-07-23 Phase 2 수정] 프리셋을 고정 배열 → "세트" 개념으로 확장.
//     사유: Figma 갱신으로 '최근 생성된 예약' 카드만 오늘/일주일/한 달 3종을 쓴다.
//           고정 배열이면 카드마다 프리셋 UI를 따로 만들어야 하고, pill 스타일·
//           활성 판정 로직이 두 벌이 되어 한쪽만 수정되는 사고가 난다.
export type RangePresetId = '1m' | '3m' | 'all' | 'today' | '1w'

export interface RangePreset { id: RangePresetId; label: string; width: number; offsetDays: number | null }

/** 기본 세트 — 통계 위젯 8종 공용 (Figma StatusBadge-XS 38/43/36) */
export const RANGE_PRESETS: RangePreset[] = [
  { id:'1m',  label:'한 달',  width:38, offsetDays:-29  },
  { id:'3m',  label:'3개월',  width:43, offsetDays:-89  },
  { id:'all', label:'전체',   width:36, offsetDays:null },   // ← offsetDays null = ALL_TIME_FROM
]

/** '최근 생성된 예약' 전용 세트 (Figma 2646:7652 — 36/45/38) */
export const RANGE_PRESETS_RECENT: RangePreset[] = [
  { id:'today', label:'오늘',   width:36, offsetDays:0   },
  { id:'1w',    label:'일주일', width:45, offsetDays:-6  },
  { id:'1m',    label:'한 달',  width:38, offsetDays:-29 },
]

/** base 날짜(YYYY-MM-DD)에 days를 더한 날짜 문자열 — AdminPage.addDaysStr와 동일 로직 */
function addDaysStr(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 프리셋 id → [from, to] 계산 (to는 항상 오늘) */
export function presetRange(id: RangePresetId, presets: RangePreset[] = RANGE_PRESETS): { from: string; to: string } {
  const to = todayStr()
  const p  = presets.find(x => x.id === id) ?? RANGE_PRESETS.find(x => x.id === id)!
  return { from: p.offsetDays === null ? ALL_TIME_FROM : addDaysStr(to, p.offsetDays), to }
}

/**
 * 현재 from/to 가 어떤 프리셋과 일치하는지 역판정.
 * 사용자가 SmallDateTrigger로 임의 날짜를 고르면 어떤 pill도 활성화되지 않는다(null).
 * ※ 활성 pill을 별도 state로 들고 있으면 날짜 직접 변경과 이중 진실이 되므로,
 *   프리셋 활성 여부는 반드시 from/to에서 파생시킨다(저장하지 않는다).
 */
export function presetIdOf(from: string, to: string, presets: RangePreset[] = RANGE_PRESETS): RangePresetId | null {
  if (to !== todayStr()) return null

  // ← [2026-07-23] 'all'이 세트에 있으면 반드시 먼저 판정한다.
  //   시뮬레이션에서 발견한 실제 충돌: 오늘이 ALL_TIME_FROM + 89일인 날(예 2026-03-31)에는
  //   '3개월'의 시작일이 ALL_TIME_FROM과 정확히 같아진다. 배열 순서대로 돌리면
  //   사용자가 '전체'를 눌렀는데 '3개월' pill이 켜지는 오표시가 발생한다.
  //   반대로 'all'을 먼저 판정하면 두 범위가 겹치는 날에 '전체'로 표시되는데,
  //   이 경우 조회 결과가 실제로 동일하므로 표시가 어긋나지 않는다.
  const hasAll = presets.some(p => p.id === 'all')
  if (hasAll && from <= ALL_TIME_FROM) return 'all'

  for (const p of presets) {
    if (p.id === 'all') continue
    const r = presetRange(p.id, presets)
    if (r.from === from && r.to === to) return p.id
  }
  return null
}

// ─── SmallDateTrigger — 카드 헤더용 inline 날짜 picker trigger ──────────────
//   [2026-07-23] AdminPage.tsx L1085~1136 에서 이 파일로 이동 (로직·스타일 1:1 무변경)
//   Figma 1:1: 단순 텍스트만 표시 (예: "2026-04-11"), 클릭 시 DatePickerPopup 띄움
//   DateDisplay는 h 48이라 카드 헤더에 너무 큼 → 텍스트만 있는 작은 버전 별도
export interface SmallDateTriggerProps {
  value:    string                                    // ← YYYY-MM-DD
  onChange: (newDate: string) => void
  min?:     string
  max?:     string
}

export function SmallDateTrigger({ value, onChange, min, max }: SmallDateTriggerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        // ← [2026-05-26 Dashboard 카드 클릭 활성화] e.stopPropagation 추가
        //   사유: AdminDashboard에서 카드 wrapper에 onClick 적용 시 SmallDateTrigger의
        //         button click이 wrapper로 bubble-up되어 DetailDrawer가 잘못 열림.
        //         이 한 줄로 위젯 카드의 SmallDateTrigger 충돌 모두 해결.
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        style={{
          // ── Figma: 텍스트만 표시, button reset ──
          background: 'transparent',
          border:     'none',
          padding:    0,
          margin:     0,
          cursor:     'pointer',
          // ── Figma: Pretendard Regular 12 / lh 1.5 / #AEB5C4 ──
          fontFamily: FONT,
          fontWeight: 400,
          fontSize:   12,
          lineHeight: 1.5,
          color:      '#AEB5C4',
          // hover 시 살짝 진한 색 (인터랙션 가능 명시)
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#697077'}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#AEB5C4'}>
        {value}
      </button>
      {open && (
        <DatePickerPopup
          value={value}
          onChange={d => { onChange(d); setOpen(false) }}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          min={min}
          max={max}
        />
      )}
    </>
  )
}

// ─── RangePresetPills — 한 달 / 3개월 / 전체 ────────────────────────────────
interface RangePresetPillsProps {
  activeId: RangePresetId | null
  onPick:   (id: RangePresetId) => void
  presets:  RangePreset[]
}

function RangePresetPills({ activeId, onPick, presets }: RangePresetPillsProps) {
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
      {presets.map(p => {
        const active = p.id === activeId
        return (
          <button
            key={p.id}
            type="button"
            // ← 카드 wrapper onClick(DetailDrawer)으로 bubble-up 차단 — SmallDateTrigger와 동일 사유
            onClick={(e) => { e.stopPropagation(); onPick(p.id) }}
            style={{
              // ── Figma StatusBadge-XS 1:1 (2026-07-23 갱신본 2646:7518~7523) ──
              //   활성 : bg rgba(0,0,0,0.9) + 1px solid #000 + 흰 글씨
              //   비활성: bg rgba(255,255,255,0.9) + 1px solid #000 + #1E1E1E
              //   ← 기존(#111 / #F4F6FA 무테두리)에서 변경. Figma가 테두리 있는 형태로 통일됨.
              //   width 고정을 버리고 padding 기반으로 바꾼 이유: 라벨 길이가 세트마다 달라
              //   ('오늘' vs '일주일') 고정 폭이면 글자가 잘리거나 여백이 뜬다.
              minWidth:     p.width,
              height:       21,
              borderRadius: 24,
              border:       '1px solid #000',
              padding:      '2px 8px',
              cursor:       'pointer',
              display:      'inline-flex',
              alignItems:   'center',
              justifyContent:'center',
              fontFamily:   FONT,
              fontWeight:   400,
              fontSize:     11,
              lineHeight:   1.5,
              letterSpacing:'0.11px',
              whiteSpace:   'nowrap',
              background:   active ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)',
              color:        active ? '#fff'            : '#1E1E1E',
              transition:   'background 0.15s, color 0.15s',
            }}>
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── DashboardRangeRow — 카드 헤더 날짜 한 줄 (좌: 날짜범위 / 우: 프리셋 pill) ──
interface DashboardRangeRowProps {
  from:     string
  to:       string
  onChange: (next: { from: string; to: string }) => void
  /** 프리셋 세트 — 생략 시 기본(한 달/3개월/전체). '최근 생성된 예약'만 RANGE_PRESETS_RECENT 사용 */
  presets?: RangePreset[]
}

export function DashboardRangeRow({ from, to, onChange, presets = RANGE_PRESETS }: DashboardRangeRowProps) {
  const activeId = presetIdOf(from, to, presets)
  return (
    <div style={{
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',   // ← Figma: 좌 날짜 / 우 pill
      width:          '100%',
      height:         21,                // ← Figma: Frame 48096364 h 21
    }}>
      {/* 좌: 날짜 범위 (SmallDateTrigger × 2 + ⎯) — 기존 동작 그대로 보존 */}
      <div style={{ display:'flex', gap:4, alignItems:'center' }}>
        <SmallDateTrigger value={from} onChange={d => onChange({ from: d, to })} max={to} />
        <span style={{
          fontFamily: FONT,
          fontWeight: 400, fontSize: 12, lineHeight: 1.5, color: '#AEB5C4',
        }}>⎯</span>
        <SmallDateTrigger value={to} onChange={d => onChange({ from, to: d })} min={from} max={todayStr()} />
      </div>

      {/* 우: 프리셋 pill 3종 */}
      <RangePresetPills activeId={activeId} presets={presets} onPick={id => onChange(presetRange(id, presets))} />
    </div>
  )
}
