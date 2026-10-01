/**
 * OrgCanvas.tsx — 화면 B: 파일 상세(헤더 + 좌측 패널 + 조직 트리/단위별 리스트 + 줌)
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.2. 표시·인터랙션만, 데이터·저장은 OrgAdminPanel
 */
import { useEffect, useMemo, useState } from 'react'
import type { AppUser, OrgCard, OrgFile, OrgJob, OrgRank, OrgRosterCheck, OrgStatusCategory, OrgStatusType, OrgUnit } from '../../types'
import { buildUnitTree, primaryJob, sortCards, type OrgBadgeSpec, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgTree, type TreeDropHandlers } from './OrgTree'
import { OrgUnitPanel } from './OrgUnitPanel'
import { OrgCardView } from './OrgCardView'
import { OG, Tag, btn, btnPri, btnDisabled, fileStatusLabel, fmtWhen } from './orgShared'

export type OrgFilter = 'all' | OrgStatusCategory | 'vacancy'
export interface CanvasActions extends TreeDropHandlers {
  onBack:        () => void
  onCopy:        () => void
  onActivate:    () => void
  onHistory?:    () => void
  onExport?:     () => void
  onRoster:      () => void
  onEditMeta:    () => void
  onCardClick:   (c: OrgCard) => void
  onAddUnit:     (parentId: string | null) => void
  onRenameUnit:  (u: OrgUnit) => void
  onDeleteUnit:  (u: OrgUnit) => void
  onMoveUnit:    (u: OrgUnit, dir: -1 | 1) => void
  onAddVacancy:  (unitId: string) => void
  onAddPerson?:  (unitId: string) => void   // ← [Phase 4-A] 입사 예정자 카드
}
interface Props extends CanvasActions {
  file:         OrgFile
  units:        OrgUnit[]
  cards:        OrgCard[]
  users:        AppUser[]
  ranks:        Map<string, OrgRank>
  jobs:         Map<string, OrgJob>
  statusTypes:  OrgStatusType[]
  person:       (c: OrgCard) => OrgPersonView
  badge:        (c: OrgCard) => OrgBadgeSpec | null
  categoryOf:   (c: OrgCard) => OrgStatusCategory | null
  roster:       OrgRosterCheck | null
  editable:     boolean
  isSuper:      boolean
  lockHolder:   string | null       // 다른 사람이 잠금 중이면 이름
  savedAt:      string | null
  selectedCard: string | null
  unassigned:   AppUser[]
}

export function OrgCanvas(p: Props) {
  const { file, units, cards, ranks, jobs, statusTypes, person, badge, categoryOf, roster, editable, isSuper, lockHolder, savedAt, selectedCard, unassigned } = p
  const roots = useMemo(() => buildUnitTree(units), [units])
  const cardsByUnit = useMemo(() => { const m = new Map<string, OrgCard[]>(); for (const c of cards) { if (!m.has(c.unit_id)) m.set(c.unit_id, []); m.get(c.unit_id)!.push(c) } return m }, [cards])
  const mismatchSet = useMemo(() => new Set((roster?.division_mismatch ?? []).map(x => x.card_id)), [roster])
  const ghostSet    = useMemo(() => new Set((roster?.ghosts ?? []).map(x => x.card_id)), [roster])
  const perUnit = (set: Set<string>) => { const m = new Map<string, number>(); for (const c of cards) if (set.has(c.id)) m.set(c.unit_id, (m.get(c.unit_id) ?? 0) + 1); return m }
  const mismatchByUnit = useMemo(() => perUnit(mismatchSet), [cards, mismatchSet])  // eslint-disable-line react-hooks/exhaustive-deps
  const ghostByUnit    = useMemo(() => perUnit(ghostSet), [cards, ghostSet])        // eslint-disable-line react-hooks/exhaustive-deps

  // 펼침 깊이 프리셋 — 엑셀 실측 계층: 회사(0) → 총괄본부(1) → 실/본부(2) → Division(3) → 팀그룹(4) → 팀(5). 기본 = Division 까지 펼침(4)
  const [depthPreset, setDepthPreset] = useState<2 | 4 | 99>(4)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    const s = new Set<string>()
    const walk = (n: OrgUnitNode) => { if (n.depth < depthPreset) s.add(n.unit.id); n.children.forEach(walk) }
    roots.forEach(walk)
    setExpanded(s)
  }, [roots, depthPreset])
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const [view, setView] = useState<'tree' | 'list'>('tree')
  const [filter, setFilter] = useState<OrgFilter>('all')
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(1)
  const [focusUnit, setFocusUnit] = useState<string | null>(null)

  const matches = (c: OrgCard) => {
    const s = q.trim().toLowerCase()
    if (s) { const pv = person(c); const jt = c.jobs.map(j => jobs.get(j.job_id)?.code ?? '').join(' ').toLowerCase(); if (!pv.name.toLowerCase().includes(s) && !jt.includes(s)) return false }
    if (filter === 'all') return true
    if (filter === 'vacancy') return c.is_vacancy
    return categoryOf(c) === filter
  }
  const ctx = useMemo(() => ({
    person, badge, ranks, jobs,
    mismatch: (c: OrgCard) => mismatchSet.has(c.id),
    dim: (c: OrgCard) => !matches(c),
  }), [person, badge, ranks, jobs, mismatchSet, filter, q])  // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const m: Record<string, number> = { vacancy: cards.filter(c => c.is_vacancy).length }
    for (const c of cards) { const k = categoryOf(c); if (k) m[k] = (m[k] ?? 0) + 1 }
    return m
  }, [cards, categoryOf])
  const catChips: { id: OrgFilter; label: string }[] = [
    { id: 'all', label: '전체' },
    ...(['hire_planned', 'departing', 'leave_planned', 'leave', 'return_planned'] as OrgStatusCategory[])
      .map(cat => ({ id: cat as OrgFilter, label: statusTypes.find(t => t.category === cat && t.is_system)?.label ?? cat })),
    { id: 'vacancy', label: '공석' },
  ]

  // 패널 클릭 → 해당 노드 펼치고 스크롤
  const focusOn = (id: string) => {
    setFocusUnit(id)
    const path: string[] = []; let cur = units.find(u => u.id === id)
    while (cur?.parent_unit_id) { path.push(cur.parent_unit_id); cur = units.find(u => u.id === cur!.parent_unit_id) }
    setExpanded(prev => new Set([...prev, ...path, id]))
  }

  const rosterTotal = roster ? roster.missing_count + roster.ghost_count + roster.division_mismatch_count : 0
  const chip = (active: boolean): React.CSSProperties => ({ fontSize: 11.5, padding: '4px 10px', borderRadius: 999, border: `1px solid ${active ? OG.ink : OG.line}`, background: active ? OG.ink : '#fff', color: active ? '#fff' : OG.quiet, cursor: 'pointer', whiteSpace: 'nowrap' })

  return (
    <div style={{ fontFamily: OG.font, color: OG.ink, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 640, background: OG.pageBg, border: `1px solid ${OG.line}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, background: '#fff', borderBottom: `1px solid ${OG.line}`, flexShrink: 0 }}>
        <button style={btn} onClick={p.onBack}>← 목록</button>
        <h3 style={{ fontSize: 15, margin: 0, cursor: 'pointer' }} onClick={p.onEditMeta} title="이름·적용일·메모 편집">{file.name}</h3>
        <Tag kind={file.status}>{fileStatusLabel(file.status)}</Tag>
        <Tag>{file.effective_on ? `적용일 ${file.effective_on}` : '적용일 미정'}</Tag>
        {lockHolder && <span style={{ fontSize: 11.5, color: OG.amber }}>● {lockHolder} 편집 중</span>}
        <span style={{ flex: 1 }} />
        {editable && <span style={{ fontSize: 11.5, color: OG.quiet }}>{savedAt ? `자동 저장됨 ${fmtWhen(savedAt)}` : ''}</span>}
        {!editable && <span style={{ fontSize: 11.5, color: OG.quiet }}>읽기 전용 — 수정하려면 복사</span>}
        <button style={{ ...btn, ...(rosterTotal > 0 ? { borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' } : {}) }} onClick={p.onRoster}>검증{roster ? ` (${rosterTotal})` : ''}</button>
        {p.onHistory && <button style={btn} onClick={p.onHistory}>히스토리</button>}
        {p.onExport  && <button style={btn} onClick={p.onExport}>내보내기</button>}
        <button style={btn} onClick={p.onCopy}>복사</button>
        {file.status === 'draft' && <button style={{ ...btnPri, ...(isSuper ? {} : btnDisabled) }} disabled={!isSuper} title={isSuper ? '' : '최고 관리자만 Active 지정'} onClick={p.onActivate}>Active 지정</button>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <OrgUnitPanel roots={roots} cardsByUnit={cardsByUnit} expanded={expanded} editable={editable} focusUnit={focusUnit} onFocusUnit={focusOn}
                      onAddUnit={p.onAddUnit} onRenameUnit={p.onRenameUnit} onDeleteUnit={p.onDeleteUnit} onMoveUnit={p.onMoveUnit} onAddVacancy={p.onAddVacancy} onAddPerson={p.onAddPerson}
                      unassigned={unassigned} mismatchByUnit={mismatchByUnit} ghostByUnit={ghostByUnit} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* 필터 바 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', background: '#fff', borderBottom: `1px solid ${OG.line}`, flexWrap: 'wrap', flexShrink: 0 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름·직무 검색" style={{ width: 200, padding: '6px 9px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 12.5, fontFamily: OG.font }} />
            {catChips.map(c => <span key={c.id} style={chip(filter === c.id)} onClick={() => setFilter(c.id)}>{c.label}{c.id !== 'all' && counts[c.id] ? ` ${counts[c.id]}` : ''}</span>)}
            <select value={depthPreset} onChange={e => setDepthPreset(Number(e.target.value) as 2 | 4 | 99)} style={{ fontSize: 11.5, padding: '5px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.quiet, fontFamily: OG.font }}>
              <option value={2}>펼침 깊이: 본부</option><option value={4}>펼침 깊이: Division</option><option value={99}>펼침 깊이: 전체</option>
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, overflow: 'hidden' }}>
              {(['tree', 'list'] as const).map(v => <div key={v} onClick={() => setView(v)} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: view === v ? OG.ink : '#fff', color: view === v ? '#fff' : OG.quiet }}>{v === 'tree' ? '조직 트리' : '단위별 리스트'}</div>)}
            </div>
          </div>
          {/* 범례 */}
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: OG.quiet, padding: '8px 16px 0', flexWrap: 'wrap' }}>
            {statusTypes.filter(t => t.is_system).map(t => <span key={t.code}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: badgeBg(t.category) }} />{t.label}</span>)}
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: '#FEE2E2' }} />퇴사 완료</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, border: `1px dashed ${OG.faint}` }} />공석(TO)</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 4, verticalAlign: -1, background: OG.amber }} />Azure Division 불일치</span>
            {editable && <span style={{ marginLeft: 'auto' }}>노드 헤더 드래그 = 단위 이동 · 카드 드래그 = 소속 변경 · 헤더 클릭 = 접기/펼침 · 더블클릭 = 이름</span>}
          </div>
          {/* 본체 */}
          <div style={{ flex: 1, overflow: 'auto', padding: '20px 40px 80px' }}>
            {view === 'tree'
              ? <OrgTree roots={roots} units={units} cardsByUnit={cardsByUnit} ctx={ctx} editable={editable} expanded={expanded} onToggle={toggle}
                         selectedCard={selectedCard} onCardClick={p.onCardClick} onUnitClick={u => editable && p.onRenameUnit(u)}
                         drop={{ onDropCard: p.onDropCard, onDropUnit: p.onDropUnit, onDropProfile: p.onDropProfile }} zoom={zoom} highlightUnit={focusUnit} />
              : <ListView roots={roots} cardsByUnit={cardsByUnit} ctx={ctx} selectedCard={selectedCard} onCardClick={p.onCardClick} editable={editable} onAddVacancy={p.onAddVacancy} onAddPerson={p.onAddPerson} />}
          </div>
          {view === 'tree' && (
            <div style={{ position: 'absolute', right: 20, bottom: 20, display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden', fontSize: 12 }}>
              {[['−', () => setZoom(z => Math.max(0.5, +(z - 0.1).toFixed(2)))], [`${Math.round(zoom * 100)}%`, () => setZoom(1)], ['+', () => setZoom(z => Math.min(1.2, +(z + 0.1).toFixed(2)))]].map(([l, fn], i) =>
                <div key={i} onClick={fn as () => void} style={{ padding: '5px 10px', borderLeft: i ? `1px solid ${OG.line}` : 'none', cursor: 'pointer', minWidth: 36, textAlign: 'center' }}>{l as string}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function badgeBg(cat: OrgStatusCategory) { return cat === 'hire_planned' ? '#CCFBF1' : cat === 'departing' ? '#FEF3C7' : cat === 'return_planned' ? '#E0E7FF' : '#EDE9FE' }

/** 단위별 리스트(보조 뷰) — 단위 섹션 세로 나열, 직급/직무 level 행 */
function ListView({ roots, cardsByUnit, ctx, selectedCard, onCardClick, editable, onAddVacancy, onAddPerson }: { roots: OrgUnitNode[]; cardsByUnit: Map<string, OrgCard[]>; ctx: any; selectedCard: string | null; onCardClick: (c: OrgCard) => void; editable: boolean; onAddVacancy: (unitId: string) => void; onAddPerson?: (unitId: string) => void }) {
  const flat: OrgUnitNode[] = []
  const walk = (n: OrgUnitNode) => { flat.push(n); n.children.forEach(walk) }
  roots.forEach(walk)
  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {flat.map(n => {
        const cards = sortCards(cardsByUnit.get(n.unit.id) ?? [], ctx.ranks, ctx.jobs, (c: OrgCard) => ctx.person(c).name)
        if (cards.length === 0 && !editable) return null
        const head = cards.find(c => c.is_unit_head)
        return (
          <div key={n.unit.id} style={{ background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, padding: '14px 16px', marginBottom: 14, marginLeft: n.depth * 16 }}>
            <h4 style={{ fontSize: 13.5, margin: '0 0 10px', display: 'flex', gap: 8, alignItems: 'center' }}>{n.unit.name} <small style={{ color: OG.quiet, fontWeight: 400 }}>{cards.filter(c => !c.is_vacancy).length}명</small>
              {head && <span style={{ marginLeft: 'auto', fontSize: 11, color: OG.quiet }}>단위장: {ctx.person(head).name}</span>}
              {editable && <button style={{ ...btn, fontSize: 10.5, padding: '2px 6px', marginLeft: head ? 8 : 'auto' }} onClick={() => onAddVacancy(n.unit.id)}>+ 공석</button>}
              {editable && onAddPerson && <button style={{ ...btn, fontSize: 10.5, padding: '2px 6px' }} onClick={() => onAddPerson(n.unit.id)}>+ 입사예정자</button>}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))', gap: 10 }}>
              {cards.map(c => {
                const r = c.rank_id ? ctx.ranks.get(c.rank_id) ?? null : null
                const pj = primaryJob(c, ctx.jobs)
                const jl = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => ctx.jobs.get(j.job_id))].filter(Boolean) as OrgJob[]
                return <OrgCardView key={c.id} card={c} person={ctx.person(c)} rank={r} jobs={jl} badge={ctx.badge(c)} mismatch={ctx.mismatch(c)} dim={ctx.dim(c)} selected={selectedCard === c.id} onClick={onCardClick} />
              })}
              {cards.length === 0 && <span style={{ color: OG.faint, fontSize: 12 }}>카드 없음 — 미배치 패널에서 드래그하거나 공석을 추가하세요</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
