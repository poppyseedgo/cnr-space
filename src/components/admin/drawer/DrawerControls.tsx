/**
 * DrawerControls.tsx — 드로어 조작부 공통 컴포넌트
 *   · DrawerRangeFilter — 날짜 조회 상태 표시 + 프리셋
 *   · DrawerStatChips   — 상태별 건수·비율 칩
 *   · DrawerCsvButton   — CSV 내보내기
 *   · DrawerPagination  — 페이지 이동
 *
 * [2026-07-24] 신규 · Figma 2669:11478 / 2669:11326 / 2669:10835
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 날짜 조회 상태를 어떻게 보여줄 것인가 (고지 지적 사항)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   기존 드로어는 조회 기간을 **세 군데**에 나눠 보여주고 있었다.
 *     · 좌측 DateRangePicker 버튼 라벨 ("30일" 같은 프리셋 이름)
 *     · 우측 회색 작은 글씨 ("2026-06-25 ~ 2026-07-24")
 *     · 'bookings' 타입에서만 나오는 생성일/회의 날짜 모드 토글
 *   같은 정보가 형태만 바꿔 세 번 나오는데, 정작 **"무슨 요일인지"** 는 어디에도 없었다.
 *   회의실 예약은 요일이 곧 의미(월요일 정례회의, 금요일 몰림)인데도.
 *
 *   Figma 안은 이걸 한 덩어리로 합친다.
 *     [🗓 2026년 5월 1일 수요일 ⎯ 2026년 5월 31일 목요일 ⌄] [이번 달][3개월][6개월][1년]
 *   · 날짜와 요일을 같이 적어 "지금 무엇을 보고 있는가"가 한 줄로 끝난다
 *   · 요일은 흐린 색(#A9B9D5)이라 날짜를 방해하지 않는다
 *   · 프리셋은 현재 선택된 것만 검게 채워 상태를 드러낸다
 *   · ⌄ 를 누르면 직접 날짜 지정 — 표시와 편집 진입점이 같은 자리
 */

import { useState, useRef, useEffect } from 'react'
import { DatePickerPopup } from '../../common/DatePickerPopup'
import { DT } from './DrawerShell'
import { IcoCalendarToday, IcoArrowDown, IcoDownload, IcoChevronBackward, IcoChevronForward } from './DrawerIcons'

// ═══════════════════════════════════════════════════════════════════════════
//  1. 날짜 조회 상태 + 프리셋
// ═══════════════════════════════════════════════════════════════════════════

const WD = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

/** 'YYYY-MM-DD' → { date: '2026년 5월 1일', weekday: '수요일' } */
function fmtKo(s: string): { date: string; weekday: string } {
  if (!s) return { date: '—', weekday: '' }
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)                    // 로컬 파싱 — TZ 무관
  return { date: `${y}년 ${m}월 ${d}일`, weekday: WD[dt.getDay()] }
}

export interface DrawerPreset { id: string; label: string }

interface RangeProps {
  from:      string
  to:        string
  onChange:  (r: { from: string; to: string }) => void
  presets:   DrawerPreset[]
  /** 현재 활성 프리셋 id. from/to 에서 파생해 넘긴다(state 로 들고 있으면 이중 진실) */
  activeId:  string | null
  onPreset:  (id: string) => void
}

export function DrawerRangeFilter({ from, to, onChange, presets, activeId, onPreset }: RangeProps) {
  const [open, setOpen] = useState<'from' | 'to' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const f = fmtKo(from), t = fmtKo(to)

  const dateText = (v: string) => (
    <span style={{ fontFamily: DT.font, fontWeight: 400, fontSize: 14, color: '#111', whiteSpace: 'nowrap' }}>{v}</span>
  )
  const wdText = (v: string) => (
    <span style={{ fontFamily: DT.font, fontWeight: 400, fontSize: 14, color: DT.muted, whiteSpace: 'nowrap' }}>{v}</span>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {/* ── 조회 상태 표시 (클릭 = 직접 지정) ── */}
      <div ref={ref} style={{ position: 'relative' }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: 12,
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'default',
        }}>
          <IcoCalendarToday />
          <button className="btn" onClick={() => setOpen(o => o === 'from' ? null : 'from')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
            {dateText(f.date)}{wdText(f.weekday)}
          </button>
          <span style={{ fontFamily: DT.font, fontWeight: 500, fontSize: 12, color: '#111' }}>⎯</span>
          <button className="btn" onClick={() => setOpen(o => o === 'to' ? null : 'to')}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
            {dateText(t.date)}{wdText(t.weekday)}
          </button>
          <button className="btn" onClick={() => setOpen(o => o ? null : 'from')} aria-label="기간 직접 지정"
            style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', cursor: 'pointer' }}>
            <IcoArrowDown />
          </button>
        </div>
        {open && (
          <DatePickerPopup
            value={open === 'from' ? from : to}
            min={open === 'to' ? from : undefined}
            max={open === 'from' ? to : undefined}
            anchorRef={ref}
            onChange={v => {
              onChange(open === 'from' ? { from: v, to } : { from, to: v })
              setOpen(null)
            }}
            onClose={() => setOpen(null)}
          />
        )}
      </div>

      {/* ── 프리셋 ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {presets.map(p => {
          const on = activeId === p.id
          return (
            <button key={p.id} className="btn" onClick={() => onPreset(p.id)}
              style={{
                height: 42, padding: '12px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: on ? '#111' : '#fff',
                color:      on ? '#fff' : DT.subText,
                fontFamily: DT.font, fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap',
              }}>{p.label}</button>
          )
        })}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. 상태 칩
// ═══════════════════════════════════════════════════════════════════════════

export interface DrawerChip {
  /** null = '전체' */
  key:   string | null
  label: string
  count: number
  /** 비율(0~100). '전체' 칩은 생략 */
  pct?:  number
  /** 비율 글자색 — Figma: 사용완료 #067EFF / 노쇼 #FF1010 / 그 외 #000 */
  pctColor?: string
}

export function DrawerStatChips({ chips, activeKey, onPick }: {
  chips: DrawerChip[]
  activeKey: string | null
  onPick: (k: string | null) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {chips.map(c => {
        const on = activeKey === c.key
        return (
          <button key={c.key ?? '__all'} className="btn" onClick={() => onPick(on ? null : c.key)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '12px 16px', borderRadius: 10000, border: 'none', cursor: 'pointer',
              background: on ? '#111' : '#fff',
              fontFamily: DT.font, fontSize: 14, lineHeight: '16px', whiteSpace: 'nowrap',
            }}>
            <span style={{ fontWeight: 500, color: on ? '#fff' : '#657487' }}>{c.label}</span>
            <span style={{ fontWeight: 400, color: on ? '#fff' : '#111' }}>{c.count}건</span>
            {c.pct !== undefined && (
              <span style={{ fontWeight: 400, color: on ? '#fff' : (c.pctColor ?? '#000') }}>
                {c.pct.toFixed(1)}%
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. CSV 버튼
// ═══════════════════════════════════════════════════════════════════════════

export function DrawerCsvButton({ onClick, label = 'CSV download' }: { onClick: () => void; label?: string }) {
  return (
    <button className="btn" onClick={onClick}
      style={{
        height: 40, background: '#E2E2E2', borderRadius: 999, border: 'none', cursor: 'pointer',
        padding: '12px 12px 12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        flexShrink: 0,
      }}>
      <span style={{
        fontFamily: DT.font, fontWeight: 400, fontSize: 14, lineHeight: '16px',
        letterSpacing: '0.14px', color: '#787878', whiteSpace: 'nowrap',
      }}>{label}</span>
      <IcoDownload />
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. 페이지네이션
// ═══════════════════════════════════════════════════════════════════════════

export function DrawerPagination({ page, pages, onChange }: {
  page: number; pages: number; onChange: (p: number) => void
}) {
  if (pages <= 1) return null
  // 최대 5개 번호. 현재 페이지를 가운데 두되 양 끝에서는 밀지 않는다.
  const win = 5
  const start = Math.max(1, Math.min(page - Math.floor(win / 2), pages - win + 1))
  const nums = Array.from({ length: Math.min(win, pages) }, (_, i) => start + i)

  const navBtn = (dis: boolean, onClick: () => void, children: React.ReactNode, label: string) => (
    <button className="btn" onClick={onClick} disabled={dis} aria-label={label}
      style={{
        width: 32, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent', border: 'none', cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.3 : 1,
      }}>{children}</button>
  )

  return (
    <div style={{ height: 78, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {navBtn(page === 1, () => onChange(page - 1), <IcoChevronBackward />, '이전 페이지')}
      {nums.map(n => (
        <button key={n} className="btn" onClick={() => onChange(n)}
          style={{
            width: 32, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: n === page ? '#111' : 'transparent',
            color:      n === page ? '#fff' : DT.subText,
            fontFamily: DT.font, fontWeight: n === page ? 600 : 400, fontSize: 14,
          }}>{n}</button>
      ))}
      {navBtn(page === pages, () => onChange(page + 1), <IcoChevronForward />, '다음 페이지')}
    </div>
  )
}
