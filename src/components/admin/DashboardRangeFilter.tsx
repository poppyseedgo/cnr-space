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
import { useState, useRef } from 'react'
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
export const ALL_TIME_FROM = '2026-01-01'

// ─── 프리셋 정의 ──────────────────────────────────────────────────────────────
//   days = "오늘 포함 N일" 이 되도록 offset 값 (한 달=30일 → -29)
export type RangePresetId = '1m' | '3m' | 'all'

export const RANGE_PRESETS: { id: RangePresetId; label: string; width: number; offsetDays: number | null }[] = [
  { id: '1m',  label: '한 달',  width: 38, offsetDays: -29  },  // ← Figma: 38×21
  { id: '3m',  label: '3개월',  width: 43, offsetDays: -89  },  // ← Figma: 43×21
  { id: 'all', label: '전체',   width: 36, offsetDays: null },  // ← Figma: 36×21 (offsetDays null = ALL_TIME_FROM)
]

/** base 날짜(YYYY-MM-DD)에 days를 더한 날짜 문자열 — AdminPage.addDaysStr와 동일 로직 */
function addDaysStr(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 프리셋 id → [from, to] 계산 (to는 항상 오늘) */
export function presetRange(id: RangePresetId): { from: string; to: string } {
  const to = todayStr()
  const p  = RANGE_PRESETS.find(x => x.id === id)!
  return { from: p.offsetDays === null ? ALL_TIME_FROM : addDaysStr(to, p.offsetDays), to }
}

/**
 * 현재 from/to 가 어떤 프리셋과 일치하는지 역판정.
 * 사용자가 SmallDateTrigger로 임의 날짜를 고르면 어떤 pill도 활성화되지 않는다(null).
 * ※ 활성 pill을 별도 state로 들고 있으면 날짜 직접 변경과 이중 진실이 되므로,
 *   프리셋 활성 여부는 반드시 from/to에서 파생시킨다(저장하지 않는다).
 */
export function presetIdOf(from: string, to: string): RangePresetId | null {
  if (to !== todayStr()) return null

  // ← [2026-07-23] 'all'을 반드시 먼저 판정한다.
  //   시뮬레이션에서 발견한 실제 충돌: 오늘이 ALL_TIME_FROM + 89일인 날(예 2026-03-31)에는
  //   '3개월'의 시작일이 ALL_TIME_FROM과 정확히 같아진다. RANGE_PRESETS 배열 순서대로 돌리면
  //   사용자가 '전체'를 눌렀는데 '3개월' pill이 켜지는 오표시가 발생한다.
  //   반대로 'all'을 먼저 판정하면 두 범위가 겹치는 날에 '전체'로 표시되는데,
  //   이 경우 조회 결과가 실제로 동일하므로 표시가 어긋나지 않는다.
  if (from <= ALL_TIME_FROM) return 'all'

  for (const p of RANGE_PRESETS) {
    if (p.id === 'all') continue
    const r = presetRange(p.id)
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
}

function RangePresetPills({ activeId, onPick }: RangePresetPillsProps) {
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
      {RANGE_PRESETS.map(p => {
        const active = p.id === activeId
        return (
          <button
            key={p.id}
            type="button"
            // ← 카드 wrapper onClick(DetailDrawer)으로 bubble-up 차단 — SmallDateTrigger와 동일 사유
            onClick={(e) => { e.stopPropagation(); onPick(p.id) }}
            style={{
              // ── Figma StatusBadge-XS 1:1 ──
              width:        p.width,
              height:       21,
              borderRadius: 999,
              border:       'none',
              padding:      0,
              cursor:       'pointer',
              display:      'inline-flex',
              alignItems:   'center',
              justifyContent:'center',
              fontFamily:   FONT,
              fontWeight:   400,
              fontSize:     12,
              lineHeight:   1.4,
              background:   active ? '#111'  : '#F4F6FA',
              color:        active ? '#fff'  : '#697077',
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
}

export function DashboardRangeRow({ from, to, onChange }: DashboardRangeRowProps) {
  const activeId = presetIdOf(from, to)
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
      <RangePresetPills activeId={activeId} onPick={id => onChange(presetRange(id))} />
    </div>
  )
}
