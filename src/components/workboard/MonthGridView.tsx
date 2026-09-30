/**
 * MonthGridView.tsx — Work Space 일정 · 월 그리드 모드
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-D] 신규 — CalendarShell MonthlyView 의 **부품** 재사용 (고지 확정):
 *      useHolidayMap · 그리드 치수(셀 padding 7 / border 1 / 헤더 24+5) · 요일 색(일 빨강·토 파랑) · 6주 균등 행 · ResizeObserver 로 보이는 칩 수 산정.
 *      Booking 의존 없음 — 셀 내용은 업무 칩(영역 색 + 제목), 넘치면 "+N건 더보기" → 팝오버(당일 전체 목록)
 *
 * 셀에 놓이는 기준 = due_at 의 KST 날짜 (기간 업무도 마감일 셀에 1회 — 기간 표현은 타임라인 모드가 담당)
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { WbTask, WbWorkArea } from '../../types'
import { useHolidayMap } from '../../utils/holidays'
import { todayStr } from '../../utils/time'
import { WB, areaColor, kstDate, fmtYmdShort, type WbPerson } from './wbShared'

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
const CELL_PAD_Y = 7 * 2, CELL_BORDER = 1, HEADER_H = 24 + 5, CHIP_H = 20, CHIP_GAP = 3, MORE_H = 18

interface Props {
  tasks:      WbTask[]
  areas:      WbWorkArea[]
  month:      string           // 'YYYY-MM-01'
  lookup:     (id: string | null | undefined) => WbPerson
  onOpenTask: (t: WbTask) => void
}

export function calcVisible(listH: number, total: number): { visible: number; more: number } {
  const per = CHIP_H + CHIP_GAP
  const fitAll = Math.floor((listH + CHIP_GAP) / per)
  if (total <= fitAll) return { visible: total, more: 0 }
  const withMore = Math.max(0, Math.floor((listH - MORE_H - CHIP_GAP + CHIP_GAP) / per))
  return { visible: withMore, more: total - withMore }
}

export function MonthGridView({ tasks, areas, month, lookup, onOpenTask }: Props) {
  const holidayMap = useHolidayMap()
  const today = todayStr()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [listH, setListH] = useState(0)
  const [popover, setPopover] = useState<{ ds: string; rect: DOMRect } | null>(null)
  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])

  const [y, m] = month.split('-').map(Number)
  const firstDay = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= dim; i++) cells.push(i)
  while (cells.length % 7 !== 0) cells.push(null)
  const rowCount = cells.length / 7

  useLayoutEffect(() => {
    const el = bodyRef.current; if (!el) return
    const measure = () => setListH(Math.max(0, Math.floor(el.clientHeight / rowCount - CELL_PAD_Y - CELL_BORDER - HEADER_H)))
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect()
  }, [rowCount])
  useEffect(() => { setPopover(null) }, [month])
  useEffect(() => {
    if (!popover) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopover(null) }
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-wb-popover]')) setPopover(null) }
    window.addEventListener('keydown', onKey); document.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [popover])

  const byDay = useMemo(() => {
    const map = new Map<string, WbTask[]>()
    for (const t of tasks) { if (!t.due_at) continue; const d = kstDate(t.due_at); if (!map.has(d)) map.set(d, []); map.get(d)!.push(t) }
    for (const list of map.values()) list.sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.due_at!.localeCompare(b.due_at!))
    return map
  }, [tasks])

  const chip = (t: WbTask, full = false): CSSProperties => {
    const c = areaColor(areaIndex.get(t.area_id) ?? 0); const done = t.status === 'done'
    return { height: CHIP_H, borderRadius: 5, padding: '0 6px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer',
      background: done ? '#F1F5F9' : c.bg, color: done ? '#9CA3AF' : c.fg, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginBottom: full ? 4 : CHIP_GAP }
  }

  return (
    <div style={{ background: '#fff', borderRadius: '0 0 20px 20px', overflow: 'hidden', height: 'calc(100vh - 300px)', minHeight: 560, display: 'flex', flexDirection: 'column', fontFamily: WB.font }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: `1px solid ${WB.cardBorder}`, flexShrink: 0 }}>
        {DAY_NAMES.map((n, i) => <div key={n} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight: 600, color: i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : '#64748B' }}>{n}</div>)}
      </div>
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))', gridAutoRows: 'minmax(0, 1fr)' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} style={{ borderRight: `1px solid ${WB.line}`, borderBottom: `1px solid ${WB.line}`, background: '#FAFAFA' }} />
          const ds = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dow = idx % 7; const h = holidayMap.get(ds); const isToday = ds === today
          const list = byDay.get(ds) ?? []
          const { visible, more } = calcVisible(listH, list.length)
          const dateColor = h?.holiday || dow === 0 ? '#EF4444' : dow === 6 ? '#3B82F6' : WB.ink
          return (
            <div key={ds} style={{ padding: '7px 6px', borderRight: `1px solid ${WB.line}`, borderBottom: `1px solid ${WB.line}`, overflow: 'hidden', background: h?.holiday ? '#FFF7F7' : 'transparent' }}>
              <div style={{ height: 24, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: isToday ? 700 : 500, background: isToday ? WB.ink : 'transparent', color: isToday ? '#fff' : dateColor }}>{day}</span>
                {h?.holiday && <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.holiday}</span>}
                {!h?.holiday && h?.company && <span style={{ fontSize: 10, color: WB.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.company}</span>}
              </div>
              {list.slice(0, visible).map(t => (
                <div key={t.id} style={chip(t)} onClick={() => onOpenTask(t)} title={t.title}>
                  {t.template_id && <span style={{ opacity: .7 }}>↻</span>}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                </div>
              ))}
              {more > 0 && (
                <button className="btn" onClick={e => setPopover({ ds, rect: (e.currentTarget.closest('[data-cell]') ?? e.currentTarget).getBoundingClientRect() })} data-cell
                  style={{ height: MORE_H, fontSize: 11, color: WB.accent, background: WB.accentBg, borderRadius: 4, border: 'none', padding: '0 6px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
                  +{more}건 더보기
                </button>
              )}
            </div>
          )
        })}
      </div>

      {popover && (() => {
        const list = byDay.get(popover.ds) ?? []
        const W = 320, PAD = 12; const vw = window.innerWidth, vh = window.innerHeight
        let left = popover.rect.left, top = popover.rect.top + 28
        if (left + W > vw - PAD) left = Math.max(PAD, vw - PAD - W)
        const maxH = Math.min(380, vh - top - PAD); if (maxH < 200) top = Math.max(PAD, vh - PAD - 380)
        return (
          <div data-wb-popover style={{ position: 'fixed', left, top, width: W, maxHeight: 380, background: '#fff', borderRadius: 12, boxShadow: '0 16px 40px rgba(15,23,42,.18)', border: `1px solid ${WB.cardBorder}`, zIndex: 1200, display: 'flex', flexDirection: 'column', fontFamily: WB.font }}>
            <div style={{ padding: '12px 14px 8px', fontSize: 13, fontWeight: 700, borderBottom: `1px solid ${WB.line}`, display: 'flex', justifyContent: 'space-between' }}>
              <span>{fmtYmdShort(popover.ds)} · {list.length}건</span>
              <button className="btn" onClick={() => setPopover(null)} style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: 10 }}>
              {list.map(t => (
                <div key={t.id} style={chip(t, true)} onClick={() => { setPopover(null); onOpenTask(t) }}>
                  {t.template_id && <span style={{ opacity: .7 }}>↻</span>}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{t.title}</span>
                  {t.assignee_ids[0] && <span style={{ fontSize: 10, opacity: .8 }}>{lookup(t.assignee_ids[0]).name}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
