/**
 * OrgPeopleTable.tsx — ③ 인원 배치 · 표 보기 (설계서 §15.5 W6 대안 C, 2026-10-02 확정)
 *  - [2026-10-02 ORG 8-D] 신규. ③ 의 두 번째 보기(보드 ↔ 표). 행 = 카드(본·겸직·공석), 열 = 이름 · 직무 · 소속 단위(+단위장) · 직급 · FTE · 근무지 · 겸직 · 메모
 *    셀 편집 = 즉시 저장(updateOrgCard / setOrgCardJobs → 되돌리기 1건) · 소속 셀 = 단위 드롭다운(org_place_cards 1건) · 여러 행 선택 → 소속 일괄 변경(⌘K 피커, 한 트랜잭션)
 *    엑셀 붙여넣기('이름 · 소속' 두 열) → 매칭 미리보기 → 이동만 한 트랜잭션. 우측 미니 트리 = 인원 수 + 기준 조직도 대비 증감(변경 강조), 박스 클릭 = 소속 필터
 *    기준 조직도(②에서 고른 base) 와 비교: 사람의 기준 본 카드 단위 → prev_unit_id 로 이어진 현재 단위 ≠ 지금 단위 = '이동', 기준에 없음 = '신규'
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OrgCard, OrgFile, OrgJob, OrgRank, OrgUnit } from '../../types'
import type { OrgPlaceItem } from '../../lib/orgApi'
import { buildUnitTree, descendantIds, primaryJob, subtreeCounts, type OrgBadgeSpec, type OrgDepartedInfo, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgMiniTree, type OrgMiniMeta } from './OrgMiniTree'
import { OrgUnitPicker } from './OrgUnitPicker'
import { OG, btn, btnPri, btnDisabled } from './orgShared'
import { OrgStepHeader, stepShell, type StepHeaderProps } from './OrgStepHeader'
import type { CardPatch } from './OrgCardDrawer'

export type PeopleCellPatch = Pick<CardPatch, 'rank_id' | 'fte' | 'work_location' | 'memo'>
type ColKey = 'rank' | 'fte' | 'loc' | 'concurrent' | 'memo'
type SortKey = 'name' | 'job' | 'unit' | 'rank' | 'fte'

interface Props extends Omit<StepHeaderProps, 'file' | 'stepper'> {
  file:         OrgFile
  units:        OrgUnit[]
  cards:        OrgCard[]
  ranks:        OrgRank[]
  jobs:         OrgJob[]
  person:       (c: OrgCard) => OrgPersonView
  badge:        (c: OrgCard) => OrgBadgeSpec | null
  isHidden:     (c: OrgCard) => boolean
  departedOf:   (c: OrgCard) => OrgDepartedInfo
  base:         { units: OrgUnit[]; cards: OrgCard[] } | null
  baseFileName: string | null
  busy:         boolean
  stepper:      ReactNode
  onPatch:      (cardId: string, patch: PeopleCellPatch) => Promise<void>
  onPrimaryJob: (cardId: string, jobId: string | null) => Promise<void>
  onMove:       (items: OrgPlaceItem[]) => Promise<void>
  onCardClick:  (c: OrgCard) => void
  onOpenCanvas: (unitId?: string) => void
}

interface Row {
  card: OrgCard; name: string; unit: OrgUnit; order: number; job: OrgJob | null; rank: OrgRank | null
  hidden: boolean; departed: boolean; badge: OrgBadgeSpec | null; concurrent: string[]
  /** 기준 조직도의 이 사람 단위(이름) · 변경 종류 */
  baseUnitName: string | null; change: 'moved' | 'new' | null
}
interface PasteRow { line: number; name: string; unitText: string; card: OrgCard | null; cur: string | null; unit: OrgUnit | null; status: 'move' | 'same' | 'no-name' | 'dup-name' | 'no-unit' | 'dup-unit' | 'empty' }

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()
const cell: React.CSSProperties = { fontFamily: OG.font, fontSize: 12, padding: '3px 6px', border: `1px solid transparent`, borderRadius: 5, background: 'transparent', width: '100%', boxSizing: 'border-box', minWidth: 0 }
const cellSel: React.CSSProperties = { ...cell, cursor: 'pointer' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, color: OG.quiet, fontWeight: 500, padding: '6px 8px', borderBottom: `1px solid ${OG.line}`, background: '#FAFAFA', whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 }
const td: React.CSSProperties = { padding: '2px 4px', borderBottom: `1px solid #F3F4F6`, verticalAlign: 'middle', fontSize: 12.5 }

export function OrgPeopleTable(p: Props) {
  const { units, cards, editable, isHidden, base } = p
  const jobsMap = useMemo(() => new Map(p.jobs.map(j => [j.id, j])), [p.jobs])
  const ranksMap = useMemo(() => new Map(p.ranks.map(r => [r.id, r])), [p.ranks])
  const byId = useMemo(() => new Map(units.map(u => [u.id, u])), [units])
  const benchId = useMemo(() => units.find(u => u.kind === 'bench')?.id ?? null, [units])
  const countOf = useMemo(() => subtreeCounts(units, cards, isHidden), [units, cards, isHidden])

  // ── 트리 순서 · 단위 옵션 ──
  const { order, unitOpts } = useMemo(() => {
    const order = new Map<string, number>(); const opts: { value: string; label: string }[] = []
    const walk = (n: OrgUnitNode, depth: number) => { order.set(n.unit.id, order.size); opts.push({ value: n.unit.id, label: `${'  '.repeat(depth)}${n.unit.name}` }); n.children.forEach(c => walk(c, depth + 1)) }
    const roots = buildUnitTree(units); roots.filter(r => r.unit.kind !== 'bench').forEach(r => walk(r, 0))
    const bench = roots.find(r => r.unit.kind === 'bench'); bench?.children.forEach(r => walk(r, 0))
    if (bench) { order.set(bench.unit.id, order.size); opts.push({ value: bench.unit.id, label: '📥 보류 카드' }) }
    return { order, unitOpts: opts }
  }, [units])

  // ── 기준 조직도 비교 (사람 → 기준 단위 → prev_unit_id 로 이어진 현재 단위) ──
  const baseInfo = useMemo(() => {
    if (!base) return null
    const curByPrev = new Map<string, OrgUnit>(); for (const u of units) if (u.prev_unit_id) curByPrev.set(u.prev_unit_id, u)
    const baseUnit = new Map(base.units.map(u => [u.id, u]))
    const basePrimary = new Map<string, OrgCard>()
    for (const c of base.cards) if (c.is_primary !== false && !c.is_vacancy && !isHidden(c)) basePrimary.set(c.profile_id ?? `p:${c.person_id}`, c)
    const baseCounts = subtreeCounts(base.units, base.cards, isHidden)   // 현재 파일과 같은 숨김 규칙(퇴사 완료·수동 숨김) 으로 세야 증감이 맞다
    return { curByPrev, baseUnit, basePrimary, baseCounts }
  }, [base, units, isHidden])

  // ── 행 ──
  const rows = useMemo<Row[]>(() => {
    const byPerson = new Map<string, OrgCard[]>()
    for (const c of cards) { if (c.is_vacancy) continue; const k = c.profile_id ?? `p:${c.person_id}`; byPerson.set(k, [...(byPerson.get(k) ?? []), c]) }
    return cards.flatMap(c => {
      const unit = byId.get(c.unit_id); if (!unit) return []
      const pv = p.person(c); const k = c.profile_id ?? `p:${c.person_id}`
      const concurrent = c.is_vacancy ? [] : (byPerson.get(k) ?? []).filter(x => x.id !== c.id).map(x => byId.get(x.unit_id)?.name ?? '?')
      let baseUnitName: string | null = null, change: Row['change'] = null
      if (baseInfo && !c.is_vacancy && c.is_primary !== false) {
        const bc = baseInfo.basePrimary.get(k)
        if (!bc) change = 'new'
        else { const bu = baseInfo.baseUnit.get(bc.unit_id); baseUnitName = bu?.name ?? null; const succ = baseInfo.curByPrev.get(bc.unit_id); if (!succ || succ.id !== c.unit_id) change = 'moved' }
      }
      const d = p.departedOf(c)
      return [{ card: c, name: c.is_vacancy ? (c.display_name || '공석') : pv.name, unit, order: order.get(c.unit_id) ?? 9999, job: primaryJob(c, jobsMap), rank: c.rank_id ? ranksMap.get(c.rank_id) ?? null : null,
                hidden: isHidden(c), departed: d.departed, badge: p.badge(c), concurrent, baseUnitName, change }]
    })
  }, [cards, byId, order, jobsMap, ranksMap, baseInfo, isHidden])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 필터 · 정렬 ──
  const [unitFilter, setUnitFilter] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showVacancy, setShowVacancy] = useState(true)
  const [changedOnly, setChangedOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null)
  const [cols, setCols] = useState<Set<ColKey>>(() => new Set<ColKey>(['rank', 'fte', 'loc', 'concurrent', 'memo']))
  const [colMenu, setColMenu] = useState(false)
  const scope = useMemo(() => unitFilter ? new Set([unitFilter, ...descendantIds(unitFilter, units)]) : null, [unitFilter, units])
  const visible = useMemo(() => {
    const s = norm(q)
    const out = rows.filter(r => (!scope || scope.has(r.unit.id)) && (showHidden || !r.hidden) && (showVacancy || !r.card.is_vacancy) && (!changedOnly || r.change)
      && (!s || norm(r.name).includes(s) || norm(r.job?.code).includes(s) || norm(r.unit.name).includes(s) || norm(r.unit.code).includes(s) || norm(r.card.memo).includes(s)))
    const byUnitThenCard = (a: Row, b: Row) => a.order - b.order || (Number(b.card.is_unit_head) - Number(a.card.is_unit_head)) || a.card.sort_order - b.card.sort_order || a.name.localeCompare(b.name, 'ko')
    if (!sort) return out.sort(byUnitThenCard)
    const v = (r: Row): string | number => sort.key === 'name' ? r.name : sort.key === 'job' ? (r.job ? -r.job.level : 1e9) : sort.key === 'unit' ? r.order : sort.key === 'rank' ? (r.rank ? -r.rank.level : 1e9) : r.card.fte
    return out.sort((a, b) => { const x = v(a), y = v(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko'); return (c || byUnitThenCard(a, b)) * sort.dir })
  }, [rows, scope, q, showHidden, showVacancy, changedOnly, sort])
  const toggleSort = (key: SortKey) => setSort(s => !s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null)
  const sortMark = (key: SortKey) => sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''
  const changedCount = rows.filter(r => r.change && !r.hidden).length

  // ── 선택 · 일괄 소속 변경 ──
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => { setSel(prev => { const alive = new Set(cards.map(c => c.id)); const n = new Set([...prev].filter(id => alive.has(id))); return n.size === prev.size ? prev : n }) }, [cards])
  const toggle = (id: string) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allVisibleSel = visible.length > 0 && visible.every(r => sel.has(r.card.id))
  const [picker, setPicker] = useState(false)
  const moveTo = async (cardIds: string[], unitId: string) => { const items = cardIds.filter(id => cards.find(c => c.id === id)?.unit_id !== unitId).map(card_id => ({ unit_id: unitId, card_id })); if (!items.length) return; await p.onMove(items); setSel(new Set()) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K') && sel.size && editable) { e.preventDefault(); setPicker(true) } if (e.key === 'Escape' && sel.size && !picker) setSel(new Set()) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [sel.size, editable, picker])

  // ── 엑셀 붙여넣기 ──
  const [paste, setPaste] = useState<null | { text: string }>(null)
  const pasteRows = useMemo<PasteRow[]>(() => {
    if (!paste) return []
    const nameIdx = new Map<string, OrgCard[]>()
    for (const r of rows) if (!r.card.is_vacancy && r.card.is_primary !== false && !r.hidden) nameIdx.set(norm(r.name), [...(nameIdx.get(norm(r.name)) ?? []), r.card])
    const unitIdx = new Map<string, OrgUnit[]>()
    for (const u of units) { if (u.kind === 'bench') continue; for (const key of new Set([norm(u.name), norm(u.code)])) if (key) { const l = unitIdx.get(key) ?? []; if (!l.includes(u)) unitIdx.set(key, [...l, u]) } }
    const lines = paste.text.split(/\r?\n/)
    return lines.map((ln, i) => {
      const parts = (ln.includes('\t') ? ln.split('\t') : ln.split(/\s*[,|]\s*/)).map(s => s.trim())
      const name = parts[0] ?? '', unitText = parts[1] ?? ''
      const mk = (status: PasteRow['status'], card: OrgCard | null = null, unit: OrgUnit | null = null): PasteRow => ({ line: i + 1, name, unitText, card, cur: card ? (byId.get(card.unit_id)?.name ?? null) : null, unit, status })
      if (!name && !unitText) return mk('empty')
      if (i === 0 && /^(이름|name|성명)$/i.test(name)) return mk('empty')
      const cs = nameIdx.get(norm(name)) ?? []; if (cs.length === 0) return mk('no-name'); if (cs.length > 1) return mk('dup-name')
      const us = unitIdx.get(norm(unitText)) ?? []; if (us.length === 0) return mk('no-unit', cs[0]); if (us.length > 1) return mk('dup-unit', cs[0])
      return mk(cs[0].unit_id === us[0].id ? 'same' : 'move', cs[0], us[0])
    }).filter(r => r.status !== 'empty')
  }, [paste, rows, units, byId])
  const pasteMoves = pasteRows.filter(r => r.status === 'move')
  const applyPaste = async () => { if (!pasteMoves.length) return; await p.onMove(pasteMoves.map(r => ({ unit_id: r.unit!.id, card_id: r.card!.id }))); setPaste(null) }

  // ── 미니 트리 메타(인원 수 · 기준 대비 증감) ──
  const meta = (id: string): OrgMiniMeta | null => {
    const u = byId.get(id); if (!u || u.kind === 'bench') return null
    const count = countOf.get(id) ?? 0
    if (!baseInfo) return { count, delta: 0 }
    const prev = u.prev_unit_id ? (baseInfo.baseCounts.get(u.prev_unit_id) ?? 0) : 0
    return { count, delta: count - prev }
  }
  const total = countOf.get(units.find(u => !u.parent_unit_id && u.kind !== 'bench')?.id ?? '') ?? 0
  const baseTotal = baseInfo && base ? (baseInfo.baseCounts.get(base.units.find(u => !u.parent_unit_id && u.kind !== 'bench')?.id ?? '') ?? 0) : null

  const dis = !editable || p.busy
  const chipS = (on: boolean): React.CSSProperties => ({ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: `1px solid ${on ? OG.ink : OG.line}`, background: on ? OG.ink : '#fff', color: on ? '#fff' : OG.quiet, cursor: 'pointer', whiteSpace: 'nowrap' })
  const tag = (label: string, kind: 'ok' | 'warn' | 'blue' | 'neutral' | 'red', title?: string) => { const c = kind === 'ok' ? { background: '#ECFDF5', color: '#047857', borderColor: '#A7F3D0' } : kind === 'warn' ? { background: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' } : kind === 'blue' ? { background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' } : kind === 'red' ? { background: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' } : { background: '#fff', color: OG.quiet, borderColor: OG.line }; return <span title={title} style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap', marginLeft: 4, ...c }}>{label}</span> }
  const colLabel: Record<ColKey, string> = { rank: '직급', fte: 'FTE', loc: '근무지', concurrent: '겸직', memo: '메모' }

  return (
    <div style={stepShell}>
      <OrgStepHeader file={p.file} editable={editable} isSuper={p.isSuper} lockHolder={p.lockHolder} savedAt={p.savedAt} undo={p.undo} roster={p.roster} stepper={p.stepper} extra={p.extra}
                     onBack={p.onBack} onEditMeta={p.onEditMeta} onRoster={p.onRoster} onHistory={p.onHistory} onExport={p.onExport} onCopy={p.onCopy} onActivate={p.onActivate} onUndo={p.onUndo} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: 12 }}>
        {/* 좌: 인원 표 */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>인원 표</b><span style={{ fontSize: 11, color: OG.quiet }}>{visible.length}{visible.length !== rows.length ? ` / ${rows.length}` : ''} 행</span>
            <select value={unitFilter ?? ''} onChange={e => setUnitFilter(e.target.value || null)} style={{ ...cell, border: `1px solid ${OG.line}`, background: '#fff', width: 'auto', maxWidth: 220, padding: '4px 8px', fontSize: 11.5 }} title="소속 필터 — 하위 단위 포함">
              <option value="">소속: 전체</option>{unitOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 이름·직무·단위·메모" style={{ ...cell, border: `1px solid ${OG.line}`, background: '#fff', width: 170, padding: '4px 8px', fontSize: 11.5 }} />
            {baseInfo && <span style={chipS(changedOnly)} onClick={() => setChangedOnly(v => !v)} title="기준 조직도와 소속이 다르거나 기준에 없던 사람만">변경만 {changedCount}</span>}
            <span style={chipS(showVacancy)} onClick={() => setShowVacancy(v => !v)}>공석</span>
            <span style={chipS(showHidden)} onClick={() => setShowHidden(v => !v)}>숨김 포함</span>
            <span style={{ flex: 1 }} />
            <div style={{ position: 'relative' }}>
              <button style={btn} onClick={() => setColMenu(v => !v)}>열 설정 ▾</button>
              {colMenu && <div onMouseLeave={() => setColMenu(false)} style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 8, padding: 8, zIndex: 5, boxShadow: '0 6px 20px rgba(0,0,0,.1)', fontSize: 12, display: 'grid', gap: 4, minWidth: 120 }}>
                {(Object.keys(colLabel) as ColKey[]).map(k => <label key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={cols.has(k)} onChange={() => setCols(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })} />{colLabel[k]}</label>)}
              </div>}
            </div>
            <button style={{ ...btn, ...(dis ? btnDisabled : {}) }} disabled={dis} onClick={() => setPaste({ text: '' })} title="엑셀에서 복사한 '이름 · 소속' 두 열을 붙여넣어 매칭 미리보기 → 이동">엑셀 붙여넣기</button>
            <button style={{ ...btnPri, ...((dis || !sel.size) ? btnDisabled : {}) }} disabled={dis || !sel.size} onClick={() => setPicker(true)} title="선택한 행의 소속을 한 번에 변경 (⌘K)">선택 {sel.size} → 소속 일괄 변경…</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'auto' }}>
              <thead><tr>
                <th style={{ ...th, width: 28 }}><input type="checkbox" checked={allVisibleSel} onChange={() => setSel(allVisibleSel ? new Set() : new Set(visible.map(r => r.card.id)))} title="보이는 행 전체 선택" /></th>
                <th style={{ ...th, cursor: 'pointer' }} onClick={() => toggleSort('name')}>이름{sortMark('name')}</th>
                <th style={{ ...th, cursor: 'pointer', width: 110 }} onClick={() => toggleSort('job')}>직무{sortMark('job')}</th>
                <th style={{ ...th, cursor: 'pointer', minWidth: 220 }} onClick={() => toggleSort('unit')}>소속 단위{sortMark('unit')}</th>
                {cols.has('rank') && <th style={{ ...th, cursor: 'pointer', width: 100 }} onClick={() => toggleSort('rank')}>직급{sortMark('rank')}</th>}
                {cols.has('fte') && <th style={{ ...th, cursor: 'pointer', width: 64 }} onClick={() => toggleSort('fte')}>FTE{sortMark('fte')}</th>}
                {cols.has('loc') && <th style={{ ...th, width: 90 }}>근무지</th>}
                {cols.has('concurrent') && <th style={{ ...th, width: 140 }}>겸직</th>}
                {cols.has('memo') && <th style={th}>메모</th>}
              </tr></thead>
              <tbody>
                {visible.map(r => {
                  const c = r.card, on = sel.has(c.id)
                  const rowDis = dis || r.hidden
                  return (
                    <tr key={c.id} style={{ background: on ? '#EFF6FF' : r.change && baseInfo ? '#FFFDF5' : undefined, opacity: r.hidden ? 0.5 : 1 }}>
                      <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={on} onChange={() => toggle(c.id)} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <span onClick={() => p.onCardClick(c)} style={{ cursor: 'pointer', fontWeight: 500, textDecoration: r.departed ? 'line-through' : undefined, color: r.departed ? OG.faint : OG.ink }} title="카드 상세(단위장 지정 · 직무 · 겸직 · 상태)">{r.name}</span>
                        {c.is_vacancy && tag('공석', 'neutral')}{c.is_primary === false && tag('겸직', 'blue')}{r.hidden && tag('숨김', 'neutral')}
                        {r.badge && <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 999, marginLeft: 4, background: r.badge.bg, color: r.badge.color, whiteSpace: 'nowrap' }}>{r.badge.label}</span>}
                        {r.change === 'new' && baseInfo && tag('신규', 'ok', '기준 조직도에 없던 사람')}
                      </td>
                      <td style={td}>
                        <select value={r.job?.id ?? ''} disabled={rowDis} onChange={e => void p.onPrimaryJob(c.id, e.target.value || null)} style={cellSel} title="본 직무 — 겸직 직무는 카드 상세에서">
                          <option value="">—</option>{p.jobs.filter(j => j.is_active || j.id === r.job?.id).map(j => <option key={j.id} value={j.id}>{j.code}{j.label && j.label !== j.code ? ` — ${j.label}` : ''}</option>)}
                        </select>
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <select value={c.unit_id} disabled={rowDis} onChange={e => void moveTo([c.id], e.target.value)} style={{ ...cellSel, color: r.change === 'moved' ? OG.drop : OG.ink, fontWeight: r.change === 'moved' ? 500 : 400, flex: 1 }} title={r.change === 'moved' ? `기준: ${r.baseUnitName ?? '(없음)'} → 지금: ${r.unit.name}` : '소속 단위 변경 — 단위장·보고선은 해제되고 대상 단위 끝에 붙습니다 (되돌리기 1건)'}>
                            {unitOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          {c.is_unit_head && tag('단위장', 'neutral')}
                          {r.change === 'moved' && baseInfo && <span style={{ fontSize: 11, color: OG.faint, whiteSpace: 'nowrap' }}>({r.baseUnitName ?? '—'} →)</span>}
                        </div>
                      </td>
                      {cols.has('rank') && <td style={td}>
                        <select value={c.rank_id ?? ''} disabled={rowDis} onChange={e => void p.onPatch(c.id, { rank_id: e.target.value || null })} style={cellSel}>
                          <option value="">—</option>{p.ranks.filter(x => x.is_active || x.id === c.rank_id).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </select>
                      </td>}
                      {cols.has('fte') && <td style={td}>
                        <input key={`${c.id}:${c.fte}`} type="number" step={0.1} min={0} max={1} defaultValue={c.fte} disabled={rowDis} style={{ ...cell, width: 56 }}
                               onBlur={e => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== c.fte) void p.onPatch(c.id, { fte: v }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                      </td>}
                      {cols.has('loc') && <td style={td}>
                        <input key={`${c.id}:${c.work_location ?? ''}`} defaultValue={c.work_location ?? ''} placeholder="—" disabled={rowDis} style={cell}
                               onBlur={e => { const v = e.target.value.trim() || null; if (v !== (c.work_location ?? null)) void p.onPatch(c.id, { work_location: v }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                      </td>}
                      {cols.has('concurrent') && <td style={{ ...td, fontSize: 11.5, color: OG.quiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }} title={r.concurrent.join(' · ')}>{r.concurrent.length ? r.concurrent.join(' · ') : <span style={{ color: OG.faint }}>—</span>}</td>}
                      {cols.has('memo') && <td style={td}>
                        <input key={`${c.id}:${c.memo ?? ''}`} defaultValue={c.memo ?? ''} placeholder="—" disabled={rowDis} style={cell}
                               onBlur={e => { const v = e.target.value.trim() || null; if (v !== (c.memo ?? null)) void p.onPatch(c.id, { memo: v }) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
                      </td>}
                    </tr>
                  )
                })}
                {visible.length === 0 && <tr><td colSpan={9} style={{ padding: 20, fontSize: 12, color: OG.faint }}>{rows.length === 0 ? '카드가 없습니다 — 보드에서 인원 풀을 배치하세요.' : '필터에 맞는 행이 없습니다.'}</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '6px 12px', borderTop: `1px solid ${OG.lineSoft}`, fontSize: 11, color: OG.faint, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span>셀 편집 = 즉시 저장(되돌리기 1건) · 소속 셀 = 단위 드롭다운 · 여러 행 선택 → 소속 일괄 변경(한 트랜잭션) · 이름 클릭 = 카드 상세</span>
            {baseInfo && <span>기준 조직도: {p.baseFileName} — 파란 소속 = 이동, 신규 = 기준에 없던 사람</span>}
          </div>
        </div>

        {/* 우: 미리보기(트리) */}
        <div style={{ width: 380, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 13 }}>미리보기 (트리)</b>
            <span style={{ flex: 1 }} />
            {unitFilter && <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => setUnitFilter(null)}>필터 해제</button>}
            <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => p.onOpenCanvas(unitFilter ?? undefined)}>캔버스 →</button>
          </div>
          <div style={{ padding: '6px 12px', fontSize: 11.5, color: OG.quiet, borderBottom: `1px solid ${OG.lineSoft}`, lineHeight: 1.6 }}>
            배치 <b style={{ color: OG.ink }}>{total}명</b>{baseTotal !== null && <> · 기준 {baseTotal}명 ({total - baseTotal >= 0 ? '+' : ''}{total - baseTotal})</>}{baseInfo && <> · 변경 <b style={{ color: changedCount ? OG.amber : OG.ink }}>{changedCount}명</b></>}
            <div style={{ fontSize: 11, color: OG.faint }}>박스 = 하위 포함 인원{baseInfo ? ' · ↑↓ = 기준 조직도 대비 증감(노란 박스 = 변경)' : ''} · 클릭 = 소속 필터</div>
          </div>
          <MiniBox units={units} selected={unitFilter} onSelect={id => setUnitFilter(f => f === id ? null : id)} meta={meta} />
        </div>
      </div>
      {picker && <OrgUnitPicker units={units} title={`선택 ${sel.size}행 소속 일괄 변경 — 어느 단위로?`} countOf={countOf} onPick={id => { setPicker(false); void moveTo([...sel], id) }} onClose={() => setPicker(false)} />}
      {paste && <PasteModal text={paste.text} rows={pasteRows} moves={pasteMoves.length} busy={p.busy} onText={t => setPaste({ text: t })} onApply={applyPaste} onClose={() => setPaste(null)} />}
    </div>
  )
}

function MiniBox({ units, selected, onSelect, meta }: { units: OrgUnit[]; selected: string | null; onSelect: (id: string) => void; meta: (id: string) => OrgMiniMeta | null }) {
  const [size, setSize] = useState({ w: 356, h: 400 })
  const ref = (el: HTMLDivElement | null) => { if (!el) return; const r = el.getBoundingClientRect(); if (Math.abs(r.width - size.w) > 2 || Math.abs(r.height - size.h) > 2) setSize({ w: r.width, h: r.height }) }
  return <div ref={ref} style={{ flex: 1, minHeight: 0 }}><OrgMiniTree units={units} selected={selected} width={size.w} height={size.h} onSelect={onSelect} meta={meta} /></div>
}

const STATUS_LABEL: Record<PasteRow['status'], [string, 'ok' | 'neutral' | 'red' | 'warn']> = { move: ['이동', 'ok'], same: ['동일', 'neutral'], 'no-name': ['이름 없음', 'red'], 'dup-name': ['이름 중복', 'warn'], 'no-unit': ['단위 없음', 'red'], 'dup-unit': ['단위 중복', 'warn'], empty: ['', 'neutral'] }
function PasteModal({ text, rows, moves, busy, onText, onApply, onClose }: { text: string; rows: PasteRow[]; moves: number; busy: boolean; onText: (t: string) => void; onApply: () => void; onClose: () => void }) {
  const col = (k: 'ok' | 'neutral' | 'red' | 'warn') => k === 'ok' ? OG.green : k === 'red' ? OG.red : k === 'warn' ? OG.amber : OG.quiet
  const problems = rows.filter(r => r.status !== 'move' && r.status !== 'same').length
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 760, maxWidth: '94vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', fontFamily: OG.font, boxShadow: '0 12px 40px rgba(0,0,0,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${OG.lineSoft}`, fontSize: 13, fontWeight: 600 }}>엑셀 붙여넣기 — 이름 · 소속 단위</div>
        <div style={{ display: 'flex', gap: 12, padding: 12, minHeight: 0, flex: 1 }}>
          <div style={{ width: 260, flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea autoFocus value={text} onChange={e => onText(e.target.value)} placeholder={'엑셀에서 두 열(이름, 소속 단위 이름 또는 약칭)을 복사해 붙여넣기\n예)\n정혜임\tCTM2\n노상희\tCTM2'} style={{ flex: 1, minHeight: 240, fontFamily: OG.font, fontSize: 12, padding: 8, border: `1px solid ${OG.line}`, borderRadius: 8, resize: 'none' }} />
            <div style={{ fontSize: 11, color: OG.faint, lineHeight: 1.5 }}>탭·쉼표·| 구분 · 첫 줄이 '이름'이면 머리글로 무시 · 이름은 본 카드(공석·숨김 제외)와 정확히 일치해야 함 · 단위는 이름 또는 약칭</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 12, marginBottom: 6, display: 'flex', gap: 10 }}>
              <span>매칭 <b>{rows.length}</b>행</span><span style={{ color: OG.green }}>이동 {moves}</span><span style={{ color: OG.quiet }}>동일 {rows.filter(r => r.status === 'same').length}</span>{problems > 0 && <span style={{ color: OG.red }}>문제 {problems} (적용에서 제외)</span>}
            </div>
            <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${OG.lineSoft}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                <thead><tr>{['#', '이름', '소속(입력)', '지금', '→ 대상', '결과'].map(h => <th key={h} style={{ ...th, position: 'static' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map(r => { const [label, kind] = STATUS_LABEL[r.status]; return (
                    <tr key={r.line}>
                      <td style={{ ...td, color: OG.faint }}>{r.line}</td><td style={td}>{r.name}</td><td style={td}>{r.unitText}</td>
                      <td style={{ ...td, color: OG.quiet }}>{r.cur ?? '—'}</td>
                      <td style={{ ...td, fontWeight: r.status === 'move' ? 500 : 400 }}>{r.unit?.name ?? '—'}</td>
                      <td style={{ ...td, color: col(kind), whiteSpace: 'nowrap' }}>{label}</td>
                    </tr>) })}
                  {rows.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: OG.faint }}>붙여넣으면 여기에 매칭 결과가 나옵니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div style={{ padding: '10px 14px', borderTop: `1px solid ${OG.lineSoft}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn} onClick={onClose}>닫기</button>
          <button style={{ ...btnPri, ...((!moves || busy) ? btnDisabled : {}) }} disabled={!moves || busy} onClick={onApply} title="이동 행만 한 트랜잭션으로 적용 (되돌리기 1단계)">이동 {moves}건 적용</button>
        </div>
      </div>
    </div>
  )
}
