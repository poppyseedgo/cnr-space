/**
 * TimelineView.tsx — Work Space 일정 · 타임라인(간트) 모드 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-D] 신규
 *
 * 구조: 좌 300px 고정 라벨 열(그룹 헤더 + 업무 행) · 우 시간축(줌 주/월/분기 — 열 폭만 다르고 구조 동일 → 주 뷰 = 주 줌)
 * 그룹: 업무영역별(기본, 고지 확정) / 마일스톤별. 그룹 헤더에 마일스톤 기간 바(end_on ◆ 게이트)
 * 바 = start_on~due(영역 색) · ◆ = 마감만 · 완료 반투명+취소선 · 지연 빨간 아웃라인 · 오늘 선 · 공휴일 열 음영(useHolidayMap)
 * 드래그(고지 확정 — 3-D 포함):
 *   · 바 본체 드래그 = 기간 이동(길이 유지)   · 좌/우 가장자리 = 시작/마감 개별 변경   · ◆ 드래그 = 마감 이동
 *   · pointer 이벤트 + setPointerCapture. 드래그 중엔 로컬 프리뷰, pointerup 에 onMoveDates(id, start, dueAt) 1회 호출
 *   · 날짜 스냅 = 1일. 마감 시각은 기존 due_at 의 KST 시각 유지(없으면 18:00)
 *   · 5px 미만 이동은 클릭으로 간주 → onOpenTask
 * 범위 밖 업무(마감·시작 모두 표시 범위 밖)는 행 자체 숨김. 마감·시작 둘 다 없는 업무는 하단 '일정 미정' 트레이
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { WbTask, WbWorkArea, WbMilestone } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { useHolidayMap } from '../../utils/holidays'
import { todayStr } from '../../utils/time'
import {
  WB, TL, TIMELINE_ZOOMS, areaColor, kstDate, kstTime, fmtYmdShort, addDaysYmd, daysDiff, timelineRangeEnd,
  checklistProgress, type TimelineZoom, type WbPerson,
} from './wbShared'

export type TimelineGroupBy = 'area' | 'milestone'

interface Props {
  tasks:       WbTask[]           // 필터 적용 후
  areas:       WbWorkArea[]
  milestones:  WbMilestone[]
  lookup:      (id: string | null | undefined) => WbPerson
  rangeStart:  string             // 'YYYY-MM-DD' (줌에 맞춰 정규화된 값 — 부모가 timelineRangeStart 로 계산)
  zoom:        TimelineZoom
  groupBy:     TimelineGroupBy
  onOpenTask:  (t: WbTask) => void
  onMoveDates: (id: string, startOn: string | null, dueAt: string | null) => Promise<void>
  movingId:    string | null
}

type DragMode = 'move' | 'start' | 'end' | 'point'
interface DragState { id: string; mode: DragMode; originX: number; startOn: string | null; dueYmd: string | null; dx: number }

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const DEFAULT_TIME = '18:00'
function toDueAt(ymd: string, hm: string) { return new Date(`${ymd}T${hm}:00+09:00`).toISOString() }

export function TimelineView({ tasks, areas, milestones, lookup, rangeStart, zoom, groupBy, onOpenTask, onMoveDates, movingId }: Props) {
  const holidayMap = useHolidayMap()
  const today = todayStr()
  const rangeEnd = timelineRangeEnd(rangeStart, zoom)
  const totalDays = daysDiff(rangeStart, rangeEnd) + 1
  const bodyRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const areaById  = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const msById    = useMemo(() => new Map(milestones.map(m => [m.id, m])), [milestones])

  // ── 날짜 ↔ px ──
  const pxPerDay = () => (bodyRef.current?.clientWidth ?? 1000) / totalDays
  const dayX = (ymd: string) => (daysDiff(rangeStart, ymd) / totalDays) * 100        // %
  const inRange = (ymd: string) => ymd >= rangeStart && ymd <= rangeEnd

  // ── 그룹 구성 ──
  const groups = useMemo(() => {
    const visible = tasks.filter(t => {
      const s = t.start_on, d = t.due_at ? kstDate(t.due_at) : null
      if (!s && !d) return false
      const a = s ?? d!, b = d ?? s!
      return !(b < rangeStart || a > rangeEnd)
    })
    const sortT = (a: WbTask, b: WbTask) => {
      const ka = a.start_on ?? (a.due_at ? kstDate(a.due_at) : ''), kb = b.start_on ?? (b.due_at ? kstDate(b.due_at) : '')
      return ka.localeCompare(kb) || a.created_at.localeCompare(b.created_at)
    }
    if (groupBy === 'area') {
      return areas.filter(a => a.is_active || visible.some(t => t.area_id === a.id)).map(a => ({
        key: a.id, label: a.name, color: areaColor(areaIndex.get(a.id) ?? 0),
        sub: [a.primary_owner_id ? `주 ${lookup(a.primary_owner_id).name}` : '', a.backup_owner_id ? `부 ${lookup(a.backup_owner_id).name}` : ''].filter(Boolean).join(' · '),
        milestone: undefined as WbMilestone | undefined,
        tasks: visible.filter(t => t.area_id === a.id).sort(sortT),
      })).filter(g => g.tasks.length > 0)
    }
    const list = milestones.filter(m => m.status !== 'cancelled').map(m => ({
      key: m.id, label: m.title, color: { bg: '#F5F3FF', fg: '#7C3AED' }, sub: m.start_on && m.end_on ? `${fmtYmdShort(m.start_on)} – ${fmtYmdShort(m.end_on)}` : '',
      milestone: m, tasks: visible.filter(t => t.milestone_id === m.id).sort(sortT),
    }))
    const none = visible.filter(t => !t.milestone_id || !msById.has(t.milestone_id)).sort(sortT)
    if (none.length) list.push({ key: '__none', label: '마일스톤 없음', color: { bg: '#F1F5F9', fg: '#64748B' }, sub: '', milestone: undefined, tasks: none })
    return list.filter(g => g.tasks.length > 0 || (g.milestone && g.milestone.start_on && g.milestone.end_on && !(g.milestone.end_on < rangeStart || g.milestone.start_on > rangeEnd)))
  }, [tasks, areas, milestones, groupBy, rangeStart, rangeEnd, areaIndex, msById, lookup])

  const undated = useMemo(() => tasks.filter(t => !t.start_on && !t.due_at && t.status !== 'done'), [tasks])

  // ── 축 헤더 ──
  const axis = useMemo(() => {
    const out: { label: string; x: number; w: number; weekend?: boolean; holiday?: string; isToday?: boolean }[] = []
    if (zoom === 'week') {
      for (let i = 0; i < 7; i++) {
        const d = addDaysYmd(rangeStart, i); const dow = new Date(d + 'T00:00:00Z').getUTCDay()
        const h = holidayMap.get(d)
        out.push({ label: `${d.slice(5).replace('-', '/')}(${DOW[dow]})`, x: (i / 7) * 100, w: 100 / 7, weekend: dow === 0 || dow === 6, holiday: h?.holiday, isToday: d === today })
      }
    } else if (zoom === 'month') {
      // 주 단위 열 (월요일 시작), 일 눈금은 배경
      let cur = rangeStart
      while (cur <= rangeEnd) {
        const dow = new Date(cur + 'T00:00:00Z').getUTCDay(); const toMon = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow
        const next = addDaysYmd(cur, toMon === 0 ? 7 : toMon)
        const end = next > rangeEnd ? addDaysYmd(rangeEnd, 1) : next
        out.push({ label: `${cur.slice(5).replace('-', '/')} 주`, x: dayX(cur), w: (daysDiff(cur, end) / totalDays) * 100 })
        cur = end
      }
    } else {
      let cur = rangeStart
      while (cur <= rangeEnd) {
        const [y, m] = cur.split('-').map(Number)
        const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
        const end = next > rangeEnd ? addDaysYmd(rangeEnd, 1) : next
        out.push({ label: `${m}월`, x: dayX(cur), w: (daysDiff(cur, end) / totalDays) * 100 })
        cur = end
      }
    }
    return out
  }, [zoom, rangeStart, rangeEnd, totalDays, holidayMap, today])  // eslint-disable-line react-hooks/exhaustive-deps

  // 공휴일·주말 음영 (월/분기 줌에서만 — 주 줌은 헤더 셀 자체가 표시)
  const shades = useMemo(() => {
    if (zoom === 'week') return []
    const out: { x: number; w: number; title?: string }[] = []
    for (let i = 0; i < totalDays; i++) {
      const d = addDaysYmd(rangeStart, i); const dow = new Date(d + 'T00:00:00Z').getUTCDay(); const h = holidayMap.get(d)
      if (dow === 0 || dow === 6 || h?.holiday) out.push({ x: (i / totalDays) * 100, w: 100 / totalDays, title: h?.holiday })
    }
    return out
  }, [zoom, rangeStart, totalDays, holidayMap])

  // ── 드래그 ──
  const onPointerDown = (t: WbTask, mode: DragMode) => (e: React.PointerEvent) => {
    if (t.status === 'done' || movingId) return
    e.preventDefault(); e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: t.id, mode, originX: e.clientX, startOn: t.start_on, dueYmd: t.due_at ? kstDate(t.due_at) : null, dx: 0 })
  }
  const onPointerMove = (e: React.PointerEvent) => { if (drag) setDrag(d => d && { ...d, dx: e.clientX - d.originX }) }
  const onPointerUp = (t: WbTask) => (e: React.PointerEvent) => {
    if (!drag || drag.id !== t.id) return
    const d = drag; setDrag(null)
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (Math.abs(d.dx) < 5) { onOpenTask(t); return }
    const { startOn, dueYmd } = previewDates(d)
    if (startOn === d.startOn && dueYmd === d.dueYmd) return
    const hm = t.due_at ? kstTime(t.due_at) : DEFAULT_TIME
    void onMoveDates(t.id, startOn, dueYmd ? toDueAt(dueYmd, hm) : null)
  }
  /** 드래그 dx → 스냅된 날짜 */
  const previewDates = useCallback((d: DragState): { startOn: string | null; dueYmd: string | null } => {
    const shift = Math.round(d.dx / pxPerDay())
    if (shift === 0) return { startOn: d.startOn, dueYmd: d.dueYmd }
    const sh = (v: string | null) => (v ? addDaysYmd(v, shift) : null)
    switch (d.mode) {
      case 'move':  return { startOn: sh(d.startOn), dueYmd: sh(d.dueYmd) }
      case 'point': return { startOn: d.startOn, dueYmd: sh(d.dueYmd) }
      case 'start': { const s = sh(d.startOn)!; return { startOn: d.dueYmd && s > d.dueYmd ? d.dueYmd : s, dueYmd: d.dueYmd } }
      case 'end':   { const e = sh(d.dueYmd)!; return { startOn: d.startOn, dueYmd: d.startOn && e < d.startOn ? d.startOn : e } }
    }
  }, [totalDays])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── 렌더 ──
  const cell = (h: number, extra?: CSSProperties): CSSProperties => ({ height: h, borderBottom: `1px solid ${WB.line}`, position: 'relative', ...extra })
  const renderTask = (t: WbTask, color: { bg: string; fg: string }) => {
    const isDone = t.status === 'done'
    const dragging = drag?.id === t.id
    const { startOn, dueYmd } = dragging ? previewDates(drag!) : { startOn: t.start_on, dueYmd: t.due_at ? kstDate(t.due_at) : null }
    const overdue = !isDone && dueYmd !== null && dueYmd < today
    const busy = movingId === t.id
    const s = startOn ?? dueYmd!, e = dueYmd ?? startOn!
    const clampedS = s < rangeStart ? rangeStart : s, clampedE = e > rangeEnd ? rangeEnd : e
    const left = dayX(clampedS), width = ((daysDiff(clampedS, clampedE) + 1) / totalDays) * 100
    const common: CSSProperties = { position: 'absolute', cursor: isDone ? 'pointer' : 'grab', opacity: busy ? 0.5 : isDone ? 0.45 : 1, zIndex: dragging ? 5 : 1, touchAction: 'none', userSelect: 'none' }
    const label = startOn && dueYmd ? `${fmtYmdShort(startOn).replace(/\(.\)/, '')}–${fmtYmdShort(dueYmd).replace(/\(.\)/, '')}` : dueYmd ? `${fmtYmdShort(dueYmd)} 마감` : `${fmtYmdShort(startOn!)} 시작`
    if (!startOn) {
      // 마감만: ◆ + 라벨
      return (
        <div key={t.id} style={cell(TL.rowH)} onPointerMove={onPointerMove}>
          <div onPointerDown={onPointerDown(t, 'point')} onPointerUp={onPointerUp(t)} title={t.title}
            style={{ ...common, left: `calc(${left}% - 2px)`, top: 14, width: 16, height: 16, transform: 'rotate(45deg)', borderRadius: 3, background: color.fg, outline: overdue ? '2px solid #DC2626' : 'none', outlineOffset: 1 }} />
          <span style={{ position: 'absolute', left: `calc(${left}% + 20px)`, top: 14, fontSize: 11, color: overdue ? WB.dueWarn : WB.muted, fontWeight: overdue ? 600 : 400, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {overdue ? `D+${daysDiff(dueYmd!, today)} · ` : ''}{label}{checklistProgress(t.checklist).total ? ` · ☑ ${checklistProgress(t.checklist).done}/${checklistProgress(t.checklist).total}` : ''}
          </span>
        </div>
      )
    }
    return (
      <div key={t.id} style={cell(TL.rowH)} onPointerMove={onPointerMove}>
        <div onPointerDown={onPointerDown(t, 'move')} onPointerUp={onPointerUp(t)} title={`${t.title} · ${label}`}
          style={{ ...common, left: `${left}%`, width: `${width}%`, top: (TL.rowH - TL.barH) / 2, height: TL.barH, background: color.fg, borderRadius: 6, color: '#fff', fontSize: 11, fontWeight: 600,
            display: 'flex', alignItems: 'center', padding: '0 8px', whiteSpace: 'nowrap', overflow: 'hidden', outline: overdue ? '2px solid #DC2626' : 'none', outlineOffset: 1,
            borderLeft: s < rangeStart ? '3px dotted rgba(255,255,255,.7)' : 'none', borderRight: e > rangeEnd ? '3px dotted rgba(255,255,255,.7)' : 'none',
            textDecoration: isDone ? 'line-through' : 'none', boxShadow: dragging ? '0 8px 20px rgba(15,23,42,.25)' : 'none' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dragging ? label : t.title}</span>
          {!isDone && (
            <>
              <div onPointerDown={onPointerDown(t, 'start')} onPointerUp={onPointerUp(t)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
              <div onPointerDown={onPointerDown(t, 'end')} onPointerUp={onPointerUp(t)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
            </>
          )}
        </div>
      </div>
    )
  }

  const todayX = inRange(today) ? dayX(today) : null

  return (
    <div style={{ fontFamily: WB.font }}>
      <div style={{ background: '#fff', borderRadius: '0 0 20px 20px', overflow: 'hidden', display: 'grid', gridTemplateColumns: `${TL.labelW}px minmax(0, 1fr)` }}>
        {/* 라벨 열 */}
        <div style={{ borderRight: `1px solid ${WB.cardBorder}` }}>
          <div style={{ height: TL.headerH, borderBottom: `1px solid ${WB.cardBorder}`, display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 12, fontWeight: 600, color: '#64748B' }}>업무</div>
          {groups.map(g => (
            <div key={g.key}>
              <div style={{ height: TL.groupH, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, background: '#F8FAFC', borderBottom: `1px solid ${WB.line}`, fontSize: 12 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: g.color.bg, color: g.color.fg, whiteSpace: 'nowrap' }}>{g.label}</span>
                <span style={{ color: WB.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.sub}{g.sub ? ' · ' : ''}미완료 {g.tasks.filter(t => t.status !== 'done').length}</span>
              </div>
              {g.tasks.map(t => { const p = lookup(t.assignee_ids[0]); return (
                <div key={t.id} onClick={() => onOpenTask(t)} style={{ height: TL.rowH, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, borderBottom: `1px solid ${WB.line}`, fontSize: 13, cursor: 'pointer' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: t.status === 'done' ? '#9CA3AF' : WB.ink, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                    {t.title}{t.template_id && <span style={{ fontSize: 10, color: WB.muted, border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>↻</span>}
                  </span>
                  {t.assignee_ids.length > 0 && <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }} title={t.assignee_ids.map(id => lookup(id).name).join(', ')}>
                    <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={20} fontSize={9} />{t.assignee_ids.length > 1 && <span style={{ fontSize: 10, color: WB.faint, marginLeft: 2, alignSelf: 'center' }}>+{t.assignee_ids.length - 1}</span>}
                  </span>}
                </div>
              )})}
            </div>
          ))}
          {groups.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>이 기간에 일정이 잡힌 업무가 없습니다</div>}
        </div>

        {/* 시간축 */}
        <div style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ height: TL.headerH, borderBottom: `1px solid ${WB.cardBorder}`, position: 'relative' }}>
            {axis.map((a, i) => (
              <div key={i} style={{ position: 'absolute', left: `${a.x}%`, width: `${a.w}%`, top: 0, bottom: 0, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: 12, fontWeight: 600, borderRight: `1px solid ${WB.line}`, whiteSpace: 'nowrap', overflow: 'hidden',
                color: a.holiday ? '#EF4444' : a.isToday ? WB.ink : a.weekend ? '#94A3B8' : '#64748B', background: a.isToday ? '#FEF2F2' : a.holiday || a.weekend ? '#FAFAFA' : 'transparent' }}>
                {a.label}{a.holiday && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500 }}>{a.holiday}</span>}
              </div>
            ))}
          </div>
          <div ref={bodyRef} style={{ position: 'relative' }}>
            {/* 배경: 음영 · 축 구분선 · 오늘 */}
            {shades.map((s, i) => <div key={'s' + i} title={s.title} style={{ position: 'absolute', left: `${s.x}%`, width: `${s.w}%`, top: 0, bottom: 0, background: s.title ? '#FEF2F2' : '#FAFAFA', pointerEvents: 'none' }} />)}
            {axis.map((a, i) => i > 0 && <div key={'v' + i} style={{ position: 'absolute', left: `${a.x}%`, top: 0, bottom: 0, borderLeft: `1px solid ${WB.line}`, pointerEvents: 'none' }} />)}
            {zoom === 'week' && axis.map((a, i) => a.isToday && <div key={'t' + i} style={{ position: 'absolute', left: `${a.x}%`, width: `${a.w}%`, top: 0, bottom: 0, background: '#FEF2F2', opacity: .5, pointerEvents: 'none' }} />)}
            {todayX !== null && (
              <div style={{ position: 'absolute', left: `${todayX}%`, top: 0, bottom: 0, borderLeft: '2px solid #EF4444', zIndex: 3, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', top: 6, left: 6, fontSize: 11, fontWeight: 700, color: '#EF4444', whiteSpace: 'nowrap' }}>오늘 {today.slice(5).replace('-', '/')}</span>
              </div>
            )}

            {groups.map(g => {
              // 그룹 헤더: 영역별이면 소속 마일스톤 바(가장 이른 1개)… 단순화: 마일스톤별 모드에서만 기간 바
              const ms = g.milestone
              const msIn = ms && ms.start_on && ms.end_on && !(ms.end_on < rangeStart || ms.start_on > rangeEnd)
              return (
                <div key={g.key}>
                  <div style={cell(TL.groupH, { background: '#F8FAFC' })}>
                    {msIn && ms && (() => {
                      const s = ms.start_on! < rangeStart ? rangeStart : ms.start_on!, e = ms.end_on! > rangeEnd ? rangeEnd : ms.end_on!
                      return (
                        <div style={{ position: 'absolute', left: `${dayX(s)}%`, width: `${((daysDiff(s, e) + 1) / totalDays) * 100}%`, top: (TL.groupH - TL.msBarH) / 2, height: TL.msBarH, borderRadius: 999, border: '1.5px solid #7C3AED', background: '#F5F3FF', fontSize: 10.5, color: '#7C3AED', fontWeight: 700, display: 'flex', alignItems: 'center', padding: '0 10px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                          ◆ {ms.title} · {fmtYmdShort(ms.start_on!)} – {fmtYmdShort(ms.end_on!)}
                        </div>
                      )
                    })()}
                  </div>
                  {g.tasks.map(t => renderTask(t, groupBy === 'area' ? g.color : areaColor(areaIndex.get(t.area_id) ?? 0)))}
                </div>
              )
            })}
            {groups.length === 0 && <div style={{ height: 120 }} />}
          </div>
        </div>
      </div>

      {/* 일정 미정 트레이 */}
      {undated.length > 0 && (
        <div style={{ marginTop: 12, background: '#fff', border: `1px dashed ${WB.cardBorder}`, borderRadius: 12, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ color: WB.muted, fontWeight: 600, marginRight: 4 }}>일정 미정 {undated.length}</span>
          {undated.slice(0, 12).map(t => { const c = areaColor(areaIndex.get(t.area_id) ?? 0); return (
            <button key={t.id} className="btn" onClick={() => onOpenTask(t)} style={{ border: `1px solid ${WB.cardBorder}`, background: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 400, cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center', fontFamily: 'inherit' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.fg }} />{t.title.length > 22 ? t.title.slice(0, 22) + '…' : t.title}
            </button>
          )})}
          {undated.length > 12 && <span style={{ color: WB.faint }}>외 {undated.length - 12}</span>}
        </div>
      )}

      {/* 범례 */}
      <div style={{ display: 'flex', gap: 16, padding: '10px 4px', fontSize: 12, color: WB.muted, flexWrap: 'wrap' }}>
        <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#7E22CE', marginRight: 6, verticalAlign: -1 }} />기간 업무 (시작–마감) · 드래그로 이동, 가장자리로 기간 조정</span>
        <span><i style={{ display: 'inline-block', width: 10, height: 10, transform: 'rotate(45deg)', background: '#64748B', borderRadius: 2, marginRight: 8 }} />마감만 · 드래그로 마감 이동</span>
        <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, border: '1.5px solid #7C3AED', background: '#F5F3FF', marginRight: 6, verticalAlign: -1 }} />마일스톤 기간</span>
        <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#FEF2F2', border: `1px solid ${WB.cardBorder}`, marginRight: 6, verticalAlign: -1 }} />공휴일</span>
        <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, outline: '2px solid #DC2626', outlineOffset: -1, marginRight: 6, verticalAlign: -1 }} />지연</span>
        <span style={{ color: '#EF4444' }}>│ 오늘</span>
      </div>
    </div>
  )
}
