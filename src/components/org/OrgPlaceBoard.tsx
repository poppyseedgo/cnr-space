/**
 * OrgPlaceBoard.tsx — ③ 인원 배치 (보드) — 설계서 §15.5 W3, 2026-10-02 확정
 *  - [2026-10-02 ORG 8-C] 신규. 좌 인원 풀(미배치 프로필 · 보류 카드 · 기준 파일에만 있는 입사예정자, org_place_suggest 가 풀+제안을 함께 줌)
 *    · 중앙 저장된 트리(OrgOutliner 구조 잠금, 드롭 대상 · 단위 클릭 = 아래에 인원 펼침 · 빈 단위/단위장 없는 단위 필터)
 *    · 우 선택 상세(배치 단위 · 제안 근거 · 검증 · 배치 버튼). ⌘K 단위 피커. 자동 배치 제안 '모두 승인'
 *    저장은 모두 OrgAdminPanel → org_place_cards(한 트랜잭션 = 되돌리기 1단계). 카드 상세는 기존 카드 드로어(onCardClick)
 */
import { useEffect, useMemo, useState, type DragEvent } from 'react'
import type { AppUser, OrgCard, OrgFile, OrgJob, OrgRank, OrgStatusCategory, OrgUnit } from '../../types'
import type { OrgPlaceItem, OrgPlaceSuggestion } from '../../lib/orgApi'
import { buildUnitTree, primaryJob, sortCards, subtreeCounts, type OrgBadgeSpec, type OrgDepartedInfo, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgOutliner } from './OrgOutliner'
import { OrgCardView } from './OrgCardView'
import { OrgUnitPicker } from './OrgUnitPicker'
import { DND } from './OrgTree'
import { OG, btn, btnPri, btnDisabled } from './orgShared'
import { OrgStepHeader, stepShell, type StepHeaderProps } from './OrgStepHeader'

export const DND_POOL = 'text/org-pool'
export interface PoolEntry { key: string; kind: 'profile' | 'card' | 'person'; profile_id: string | null; person_id: string | null; card_id: string | null; name: string; sub: string; dept: string | null; sugg: { unit_id: string; unit_name: string; reason: 'prev' | 'dept'; base_unit_name: string | null } | null; departing: boolean; hirePlanned: boolean }
type PoolFilter = 'all' | 'unplaced' | 'suggested' | 'bench' | 'hire' | 'departing'

interface Props extends Omit<StepHeaderProps, 'file' | 'stepper'> {
  file:          OrgFile
  units:         OrgUnit[]
  cards:         OrgCard[]
  users:         AppUser[]
  ranks:         Map<string, OrgRank>
  jobs:          Map<string, OrgJob>
  person:        (c: OrgCard) => OrgPersonView
  badge:         (c: OrgCard) => OrgBadgeSpec | null
  isHidden:      (c: OrgCard) => boolean
  departedOf:    (c: OrgCard) => OrgDepartedInfo
  profileStatus: (profileId: string) => OrgStatusCategory | null
  pool:          OrgPlaceSuggestion[] | null
  busy:          boolean
  stepper:       React.ReactNode
  baseFileName:  string | null
  onPlace:       (items: OrgPlaceItem[]) => Promise<void>
  onCardClick:   (c: OrgCard) => void
  onAddVacancy:  (unitId: string) => void
  onAddPerson:   (unitId: string) => void
  onOpenCanvas:  (unitId?: string) => void
}

export function OrgPlaceBoard(p: Props) {
  const { units, cards, users, jobs, pool, editable, isHidden } = p
  const benchId = useMemo(() => units.find(u => u.kind === 'bench')?.id ?? null, [units])
  const byId = useMemo(() => new Map(units.map(u => [u.id, u])), [units])
  const userById = useMemo(() => new Map(users.map(u => [u.user_id, u])), [users])
  const countOf = useMemo(() => subtreeCounts(units, cards, isHidden), [units, cards, isHidden])

  // ── 인원 풀 ──
  const entries = useMemo<PoolEntry[]>(() => (pool ?? []).map(s => {
    const kind: PoolEntry['kind'] = s.card_id ? 'card' : s.person_id ? 'person' : 'profile'
    const card = s.card_id ? cards.find(c => c.id === s.card_id) : null
    const jobCodes = card ? card.jobs.map(j => jobs.get(j.job_id)?.code).filter(Boolean).join('·') : ''
    const st = s.profile_id ? p.profileStatus(s.profile_id) : null
    const u = s.profile_id ? userById.get(s.profile_id) : null
    const sub = [kind === 'card' ? '보류 카드' : kind === 'person' ? '입사 예정' : null, jobCodes || null, s.dept ? `Azure: ${s.dept}` : null, u?.employment_status === 'departing' ? '퇴사 예정' : null].filter(Boolean).join(' · ')
    return { key: s.card_id ?? s.profile_id ?? s.person_id!, kind, profile_id: s.profile_id, person_id: s.person_id, card_id: s.card_id, name: s.name, sub, dept: s.dept,
             sugg: s.unit_id && s.reason ? { unit_id: s.unit_id, unit_name: s.unit_name ?? '', reason: s.reason, base_unit_name: s.base_unit_name } : null,
             departing: st === 'departing' || u?.employment_status === 'departing', hirePlanned: kind === 'person' || st === 'hire_planned' }
  }), [pool, cards, jobs, userById, p.profileStatus])   // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<PoolFilter>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => { setSel(prev => { const alive = new Set(entries.map(e => e.key)); const n = new Set([...prev].filter(k => alive.has(k))); return n.size === prev.size ? prev : n }) }, [entries])
  const counts = { all: entries.length, unplaced: entries.filter(e => e.kind === 'profile').length, suggested: entries.filter(e => e.sugg).length, bench: entries.filter(e => e.kind === 'card').length, hire: entries.filter(e => e.hirePlanned).length, departing: entries.filter(e => e.departing).length }
  const visible = entries.filter(e => (filter === 'all' || (filter === 'unplaced' && e.kind === 'profile') || (filter === 'suggested' && e.sugg) || (filter === 'bench' && e.kind === 'card') || (filter === 'hire' && e.hirePlanned) || (filter === 'departing' && e.departing))
    && (!q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()) || e.sub.toLowerCase().includes(q.trim().toLowerCase())))
  const selected = entries.filter(e => sel.has(e.key))
  const toggle = (k: string) => setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n })
  const itemsFor = (es: PoolEntry[], unitId: string): OrgPlaceItem[] => es.map(e => e.kind === 'card' ? { unit_id: unitId, card_id: e.card_id } : e.kind === 'person' ? { unit_id: unitId, person_id: e.person_id } : { unit_id: unitId, profile_id: e.profile_id })
  const placeTo = async (es: PoolEntry[], unitId: string) => { if (!editable || !es.length || p.busy) return; await p.onPlace(itemsFor(es, unitId)); setSel(new Set()) }
  const approveAll = () => { const es = entries.filter(e => e.sugg); if (!es.length) return; void p.onPlace(es.map(e => itemsFor([e], e.sugg!.unit_id)[0])) }

  // ── 트리 ──
  const [treeSel, setTreeSel] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(units.filter(u => u.kind !== 'bench').map(u => u.id)))
  const [treeQ, setTreeQ] = useState('')
  const [treeFilter, setTreeFilter] = useState<'all' | 'empty' | 'nohead'>('all')
  const headOf = (u: OrgUnit) => (u.head_card_id ? cards.find(c => c.id === u.head_card_id) : null) ?? cards.find(c => c.unit_id === u.id && c.is_unit_head && !isHidden(c)) ?? null
  const noHeadUnits = useMemo(() => units.filter(u => u.kind !== 'bench' && !headOf(u) && (countOf.get(u.id) ?? 0) > 0), [units, cards, countOf])   // eslint-disable-line react-hooks/exhaustive-deps
  const filterIds = useMemo(() => treeFilter === 'empty' ? new Set(units.filter(u => u.kind !== 'bench' && (countOf.get(u.id) ?? 0) === 0).map(u => u.id)) : treeFilter === 'nohead' ? new Set(noHeadUnits.map(u => u.id)) : null, [treeFilter, units, countOf, noHeadUnits])
  const setDepth = (d: number) => { const s = new Set<string>(); const walk = (n: OrgUnitNode) => { if (n.depth < d) s.add(n.unit.id); n.children.forEach(walk) }; buildUnitTree(units).forEach(walk); setExpanded(s) }
  const rowMeta = (u: OrgUnit) => {
    const h = headOf(u); const pj = h ? primaryJob(h, jobs) : null
    if (h) return <span style={{ fontSize: 11, color: OG.quiet, whiteSpace: 'nowrap' }}>{pj ? `${pj.code} ` : ''}{p.person(h).name}</span>
    if ((countOf.get(u.id) ?? 0) > 0 && u.kind !== 'bench') return <span style={{ fontSize: 11, color: OG.red, whiteSpace: 'nowrap' }}>단위장 없음</span>
    return null
  }
  const onExtDrop = (unitId: string, e: DragEvent) => {
    if (!editable) return
    const poolRaw = e.dataTransfer.getData(DND_POOL)
    if (poolRaw) { let keys: string[] = []; try { keys = JSON.parse(poolRaw) } catch { keys = [] } const es = entries.filter(x => keys.includes(x.key)); void placeTo(es, unitId); return }
    const many = e.dataTransfer.getData(DND.cards), one = e.dataTransfer.getData(DND.card)
    const ids = many ? (JSON.parse(many) as string[]) : one ? [one] : []
    const mv = ids.filter(id => cards.find(c => c.id === id)?.unit_id !== unitId)
    if (mv.length) void p.onPlace(mv.map(card_id => ({ unit_id: unitId, card_id })))
  }
  const onPoolDragStart = (e: DragEvent, entry: PoolEntry) => {
    const keys = sel.has(entry.key) ? [...sel] : [entry.key]
    e.dataTransfer.setData(DND_POOL, JSON.stringify(keys)); e.dataTransfer.effectAllowed = 'move'
  }
  // 선택 단위 인원
  const unit = treeSel ? byId.get(treeSel) ?? null : null
  const unitCards = useMemo(() => unit ? sortCards(cards.filter(c => c.unit_id === unit.id && !isHidden(c)), p.ranks, jobs, c => p.person(c).name) : [], [unit, cards, isHidden, p.ranks, jobs, p.person])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 우측: 배치 대상 ──
  const suggUnit = selected.length && selected.every(e => e.sugg && e.sugg.unit_id === selected[0].sugg!.unit_id) ? selected[0].sugg!.unit_id : null
  const [targetOverride, setTargetOverride] = useState<string | null>(null)
  useEffect(() => { setTargetOverride(null) }, [sel])
  const target = targetOverride ?? suggUnit ?? treeSel ?? null
  const targetUnit = target ? byId.get(target) ?? null : null
  const [picker, setPicker] = useState(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K') && selected.length && editable) { e.preventDefault(); setPicker(true) } if (e.key === 'Escape' && sel.size && !picker) setSel(new Set()) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [selected.length, editable, sel.size, picker])
  const unitOpts = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    const walk = (n: OrgUnitNode, depth: number) => { opts.push({ value: n.unit.id, label: `${'  '.repeat(depth)}${n.unit.name}` }); n.children.forEach(c => walk(c, depth + 1)) }
    const roots = buildUnitTree(units); roots.filter(r => r.unit.kind !== 'bench').forEach(r => walk(r, 0)); (roots.find(r => r.unit.kind === 'bench')?.children ?? []).forEach(r => walk(r, 0))
    if (benchId) opts.push({ value: benchId, label: '📥 보류 카드' })
    return opts
  }, [units, benchId])
  const placedTotal = countOf.get(units.find(u => !u.parent_unit_id && u.kind !== 'bench')?.id ?? '') ?? 0

  const chipS = (on: boolean): React.CSSProperties => ({ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, border: `1px solid ${on ? OG.ink : OG.line}`, background: on ? OG.ink : '#fff', color: on ? '#fff' : OG.quiet, cursor: 'pointer', whiteSpace: 'nowrap' })
  const tag = (label: string, kind: 'ok' | 'warn' | 'blue' | 'neutral') => { const c = kind === 'ok' ? { background: '#ECFDF5', color: '#047857', borderColor: '#A7F3D0' } : kind === 'warn' ? { background: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' } : kind === 'blue' ? { background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' } : { background: '#fff', color: OG.quiet, borderColor: OG.line }; return <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap', ...c }}>{label}</span> }
  const cellSel: React.CSSProperties = { fontFamily: OG.font, fontSize: 12.5, padding: '6px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', width: '100%', boxSizing: 'border-box' }
  const ctx = { person: p.person, badge: p.badge, ranks: p.ranks, jobs }

  return (
    <div style={stepShell}>
      <OrgStepHeader file={p.file} editable={editable} isSuper={p.isSuper} lockHolder={p.lockHolder} savedAt={p.savedAt} undo={p.undo} roster={p.roster} stepper={p.stepper} extra={p.extra}
                     onBack={p.onBack} onEditMeta={p.onEditMeta} onRoster={p.onRoster} onHistory={p.onHistory} onExport={p.onExport} onCopy={p.onCopy} onActivate={p.onActivate} onUndo={p.onUndo} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: 12 }}>
        {/* 좌: 인원 풀 */}
        <div style={{ width: 380, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 13 }}>인원 풀</b><span style={{ fontSize: 11, color: OG.quiet }}>{entries.length}</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 이름·직무·부서" style={{ ...cellSel, marginLeft: 'auto', width: 150, padding: '4px 8px', fontSize: 11.5 }} />
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '6px 8px', flexWrap: 'wrap', borderBottom: `1px solid ${OG.lineSoft}` }}>
            {([['all', '전체'], ['unplaced', '미배치'], ['suggested', '제안 있음'], ['bench', '보류'], ['hire', '입사 예정'], ['departing', '퇴사 예정']] as [PoolFilter, string][]).map(([k, l]) => <span key={k} style={chipS(filter === k)} onClick={() => setFilter(k)}>{l} {counts[k]}</span>)}
          </div>
          {counts.suggested > 0 && editable && (
            <div style={{ margin: '6px 8px', padding: '6px 10px', border: `2px dashed ${OG.drop}`, borderRadius: 8, background: '#EFF6FF66', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              ✨ <b>자동 배치 제안 {counts.suggested}명</b><span style={{ color: OG.quiet }}>— 승계 {entries.filter(e => e.sugg?.reason === 'prev').length} · Azure 부서 {entries.filter(e => e.sugg?.reason === 'dept').length}</span>
              <button style={{ ...btn, fontSize: 11, padding: '2px 8px', color: OG.drop, borderColor: '#BFDBFE', background: '#EFF6FF', ...(p.busy ? btnDisabled : {}) }} disabled={p.busy} onClick={approveAll} title="제안 전부를 한 번에 배치 (되돌리기 1단계)">모두 승인</button>
              <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => { setFilter('suggested'); setSel(new Set(entries.filter(e => e.sugg).map(e => e.key))) }}>검토…</button>
            </div>
          )}
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
            {!pool && <div style={{ padding: 16, fontSize: 12, color: OG.faint }}>불러오는 중…</div>}
            {pool && visible.length === 0 && <div style={{ padding: 16, fontSize: 12, color: OG.faint }}>{entries.length === 0 ? '배치할 사람이 없습니다 — 전원 배치됨.' : '필터에 맞는 사람이 없습니다.'}</div>}
            {visible.map(e => {
              const on = sel.has(e.key)
              return (
                <div key={e.key} draggable={editable} onDragStart={ev => onPoolDragStart(ev, e)} onClick={() => toggle(e.key)}
                     style={{ margin: '4px 8px', padding: '6px 8px', border: `1px solid ${on ? OG.drop : OG.line}`, borderRadius: 8, background: on ? '#EFF6FF' : '#fff', display: 'flex', alignItems: 'center', gap: 8, cursor: editable ? 'grab' : 'default', fontSize: 12 }}>
                  <span style={{ width: 12, height: 12, border: `1px solid ${on ? OG.drop : OG.faint}`, borderRadius: 3, background: on ? OG.drop : '#fff', flex: 'none' }} />
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#D1D5DB', flex: 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</div>
                    <div style={{ fontSize: 10.5, color: OG.quiet, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.sub}{e.sugg ? ` · 제안 → ${e.sugg.unit_name}` : ''}</div>
                  </div>
                  {e.sugg ? tag(e.sugg.reason === 'prev' ? '승계' : '부서', e.sugg.reason === 'prev' ? 'ok' : 'blue') : e.kind === 'card' ? tag('보류', 'neutral') : tag('미배치', 'warn')}
                </div>
              )
            })}
          </div>
          <div style={{ padding: '8px 10px', borderTop: `1px solid ${OG.lineSoft}`, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span>선택 <b>{selected.length}</b></span>
            <button style={{ ...btnPri, ...((!editable || !selected.length || p.busy) ? btnDisabled : {}) }} disabled={!editable || !selected.length || p.busy} onClick={() => setPicker(true)} title="단위 피커 — 검색해서 멀리 있는 단위에도 즉시 배치">배치… <kbd style={{ fontSize: 10, border: '1px solid #6B7280', borderRadius: 4, padding: '0 4px', marginLeft: 4 }}>⌘K</kbd></button>
            {benchId && <button style={{ ...btn, ...((!editable || !selected.some(e => e.kind !== 'card') || p.busy) ? btnDisabled : {}) }} disabled={!editable || !selected.some(e => e.kind !== 'card') || p.busy} onClick={() => placeTo(selected.filter(e => e.kind !== 'card'), benchId)} title="카드만 만들어 보류 카드에 둠(소속 미정)">📥 보류</button>}
            <button style={{ ...btn, marginLeft: 'auto' }} onClick={() => setSel(new Set())} disabled={!selected.length}>해제</button>
          </div>
        </div>

        {/* 중앙: 저장된 트리 + 선택 단위 인원 */}
        <div style={{ flex: 1, minWidth: 420, display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>조직 트리</b><span style={{ fontSize: 11, color: OG.quiet }}>{units.filter(u => u.kind !== 'bench').length} 단위 · 배치 {placedTotal}명</span>
            <span style={{ flex: 1 }} />
            <select onChange={e => setDepth(Number(e.target.value))} defaultValue={99} style={{ ...cellSel, width: 'auto', padding: '4px 8px', fontSize: 11.5 }}><option value={2}>펼침 깊이: 본부</option><option value={4}>펼침 깊이: Division</option><option value={99}>펼침 깊이: 전체</option></select>
            <span style={chipS(treeFilter === 'empty')} onClick={() => setTreeFilter(f => f === 'empty' ? 'all' : 'empty')}>빈 단위만</span>
            <span style={chipS(treeFilter === 'nohead')} onClick={() => setTreeFilter(f => f === 'nohead' ? 'all' : 'nohead')}>단위장 없는 단위 {noHeadUnits.length}</span>
            <input value={treeQ} onChange={e => setTreeQ(e.target.value)} placeholder="🔍 단위" style={{ ...cellSel, width: 120, padding: '4px 8px', fontSize: 11.5 }} />
          </div>
          <div style={{ flex: unit ? '1 1 55%' : 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <OrgOutliner units={units} countOf={countOf} selected={treeSel} onSelect={setTreeSel} editable={editable} structureLocked expanded={expanded} onToggle={id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} setExpanded={setExpanded}
                         query={treeQ} benchId={benchId} filterIds={filterIds} extTypes={[DND_POOL, DND.card, DND.cards]} onExtDrop={onExtDrop} rowMeta={rowMeta}
                         onRename={async () => {}} onCreate={async () => null} onPlace={async () => {}} onDuplicate={async () => {}} onDelete={() => {}} />
          </div>
          {unit && (
            <div style={{ flex: '1 1 45%', minHeight: 160, borderTop: `1px solid ${OG.line}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, borderBottom: `1px solid ${OG.lineSoft}` }}>
                <b style={{ whiteSpace: 'nowrap' }}>{unit.kind === 'bench' ? '📥 보류 카드' : unit.name}</b><span style={{ color: OG.quiet, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title="카드 클릭 = 상세(단위장 지정·직무·겸직) · 카드 드래그 = 다른 단위로">직속 {unitCards.filter(c => !c.is_vacancy && c.is_primary !== false).length}명 · 하위 포함 {countOf.get(unit.id) ?? 0}명 — 카드 클릭 = 상세 · 드래그 = 이동</span>
                <span style={{ flex: 1 }} />
                {editable && <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => p.onAddVacancy(unit.id)}>+ 공석 카드</button>}
                {editable && <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => p.onAddPerson(unit.id)}>+ 입사 예정자</button>}
                <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => p.onOpenCanvas(unit.id)}>캔버스에서 보기 →</button>
                <button style={{ ...btn, fontSize: 11, padding: '2px 8px' }} onClick={() => setTreeSel(null)} title="닫기">✕</button>
              </div>
              <div style={{ overflow: 'auto', padding: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}>
                {unitCards.map(c => { const r = c.rank_id ? p.ranks.get(c.rank_id) ?? null : null; const pj = primaryJob(c, jobs); const jl = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => jobs.get(j.job_id))].filter(Boolean) as OrgJob[]
                  return <OrgCardView key={c.id} card={c} person={ctx.person(c)} rank={r} jobs={jl} badge={ctx.badge(c)} mismatch={false} dim={false} concurrent={null} departedSince={p.departedOf(c).departed ? p.departedOf(c).since : null} hidden={false} selected={false}
                                      draggable={editable} onDragStart={(e, card) => { e.dataTransfer.setData(DND.card, card.id); e.dataTransfer.effectAllowed = 'move' }} onClick={card => p.onCardClick(card)} /> })}
                {unitCards.length === 0 && <span style={{ fontSize: 12, color: OG.faint }}>카드 없음 — 인원 풀에서 끌어오거나 공석을 추가하세요</span>}
              </div>
            </div>
          )}
        </div>

        {/* 우: 선택 상세 */}
        <div style={{ width: 340, flex: 'none', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'auto', fontSize: 12.5 }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', fontWeight: 600, fontSize: 13 }}>{selected.length ? `선택 ${selected.length}명` : '선택 없음'}</div>
          {selected.length === 0 ? (
            <div style={{ padding: 16, color: OG.quiet, lineHeight: 1.7 }}>왼쪽 인원 풀에서 사람을 선택(클릭·여러 명)하거나 트리의 단위로 끌어다 놓으세요.<br /><span style={{ color: OG.faint }}>⌘K = 단위 피커 · Esc = 선택 해제 · 자동 배치 제안은 '모두 승인' 또는 '검토…'</span>
              {p.baseFileName && <div style={{ marginTop: 10, fontSize: 11.5, color: OG.faint }}>승계 제안 기준: {p.baseFileName} (② 단위 바인드)</div>}</div>
          ) : (
            <>
              <Row label="배치 단위"><select value={target ?? ''} disabled={!editable} onChange={e => setTargetOverride(e.target.value || null)} style={cellSel}><option value="">(선택)</option>{unitOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                <div style={{ fontSize: 10.5, color: OG.faint, marginTop: 3 }}>{suggUnit && target === suggUnit ? '제안 단위가 기본 선택됨' : treeSel && target === treeSel ? '트리에서 선택한 단위' : '직접 선택'}</div></Row>
              <Row label="직무·직급"><div style={{ color: OG.quiet }}>{selected.some(e => e.kind === 'card') ? '보류 카드는 직무·직급·메모 유지' : '새 카드 — 직무는 배치 후 카드 상세에서'}</div></Row>
              <Sec>제안 근거</Sec>
              <div style={{ padding: '2px 12px 6px', color: '#4B5563', lineHeight: 1.6, fontSize: 11.5 }}>
                {selected.map(e => <div key={e.key}>{e.name} — {e.sugg ? (e.sugg.reason === 'prev' ? `${p.baseFileName ?? '기준 조직도'} ${e.sugg.base_unit_name ?? ''} → 바인드 승계 → ${e.sugg.unit_name}` : `Azure 부서 ${e.dept} ↔ ${e.sugg.unit_name}`) : <span style={{ color: OG.faint }}>제안 없음{e.dept ? ` (Azure: ${e.dept})` : ''}</span>}</div>)}
              </div>
              <Sec>검증</Sec>
              <div style={{ padding: '2px 12px 8px', lineHeight: 1.8, fontSize: 11.5 }}>
                <div><i style={dot('#059669')} />이 조직도에 중복 카드 없음 (풀 = 카드 없는 사람만)</div>
                {selected.filter(e => e.departing).length > 0 && <div><i style={dot('#D97706')} />퇴사 예정 {selected.filter(e => e.departing).length}명 — 배치 전에 퇴사일 확인</div>}
                {selected.filter(e => e.hirePlanned).length > 0 && <div><i style={dot('#0D9488')} />입사 예정 {selected.filter(e => e.hirePlanned).length}명</div>}
                {targetUnit && targetUnit.kind !== 'bench' && !headOf(targetUnit) && <div><i style={dot('#D97706')} />'{targetUnit.name}' 단위장 없음 — 배치 후 카드 상세에서 지정</div>}
                {targetUnit?.kind === 'bench' && <div><i style={dot('#D97706')} />보류 카드로 — Active 지정 전에 비워야 함</div>}
              </div>
              <div style={{ padding: '4px 12px 14px', display: 'flex', gap: 6 }}>
                <button style={{ ...btnPri, ...((!editable || !targetUnit || p.busy) ? btnDisabled : {}) }} disabled={!editable || !targetUnit || p.busy} onClick={() => targetUnit && placeTo(selected, targetUnit.id)}>{targetUnit ? `${targetUnit.kind === 'bench' ? '보류 카드' : targetUnit.name} 에 배치` : '단위를 선택하세요'}</button>
                <button style={btn} onClick={() => setSel(new Set())}>취소</button>
              </div>
            </>
          )}
          <div style={{ padding: '10px 12px', borderTop: `1px solid ${OG.lineSoft}`, fontSize: 11, color: OG.faint, lineHeight: 1.5, marginTop: 8 }}>이름·직무·직급·소속 일괄 편집은 상단 '표' 보기. 겸직 카드 추가·단위장 지정·숨김은 카드 상세(드로어).</div>
        </div>
      </div>
      {picker && <OrgUnitPicker units={units} title={`선택 ${selected.length}명 배치 — 어느 단위로?`} countOf={countOf} onPick={id => { setPicker(false); void placeTo(selected, id) }} onClose={() => setPicker(false)} />}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, padding: '6px 12px', alignItems: 'flex-start' }}><label style={{ width: 70, flex: 'none', color: OG.quiet, fontSize: 11.5, paddingTop: 7 }}>{label}</label><div style={{ flex: 1, minWidth: 0 }}>{children}</div></div>
}
function Sec({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '8px 12px 2px', fontSize: 11, color: OG.faint, letterSpacing: '.04em', borderTop: `1px solid #F3F4F6`, marginTop: 4 }}>{children}</div>
}
const dot = (c: string): React.CSSProperties => ({ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c, marginRight: 6, verticalAlign: 0 })
