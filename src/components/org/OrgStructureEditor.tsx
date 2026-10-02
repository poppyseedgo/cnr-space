/**
 * OrgStructureEditor.tsx — ① 구조 설계 화면 (설계서 §15.2 flow · §15.5 W1, 2026-10-02 확정)
 *  - [2026-10-02 ORG 8-A] 신규. 헤더(파일·스텝퍼·되돌리기·검증/히스토리/내보내기/복사/Active) + 좌 아웃라이너(OrgOutliner) + 중앙 단위 상세(OrgUnitDetail) + 우 미니 트리(OrgMiniTree)
 *    사람 카드는 다루지 않는다(인원수만). 저장은 OrgAdminPanel 의 RPC(org_place_unit · org_delete_unit · org_duplicate_unit · updateOrgUnit) — 모두 되돌리기 1단계
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OrgCard, OrgFile, OrgJob, OrgRank, OrgRosterCheck, OrgUnit } from '../../types'
import type { OrgUndoPeek, OrgUnitPatch } from '../../lib/orgApi'
import { buildUnitTree, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgOutliner, kbd, type OutlinerActions } from './OrgOutliner'
import { OrgUnitDetail } from './OrgUnitDetail'
import { OrgMiniTree } from './OrgMiniTree'
import { OG, Tag, btn, btnPri, btnDisabled, fileStatusLabel, fmtWhen } from './orgShared'

export interface StructureActions extends OutlinerActions {
  onPatchUnit: (id: string, patch: OrgUnitPatch) => Promise<void>
  onMerge:     (u: OrgUnit) => void
  onUndo:      () => void
}
interface Props extends StructureActions {
  file:       OrgFile
  units:      OrgUnit[]
  cards:      OrgCard[]
  jobs:       OrgJob[]
  ranks:      Map<string, OrgRank>
  person:     (c: OrgCard) => OrgPersonView
  isHidden:   (c: OrgCard) => boolean
  editable:   boolean
  isSuper:    boolean
  lockHolder: string | null
  savedAt:    string | null
  undo:       OrgUndoPeek | null
  roster:     OrgRosterCheck | null
  baseFileName: string | null
  stepper:    ReactNode
  onBack: () => void; onEditMeta: () => void; onRoster: () => void; onHistory: () => void; onExport: () => void; onCopy: () => void; onActivate: () => void
  onOpenCanvas: (unitId?: string) => void
}

export function OrgStructureEditor(p: Props) {
  const { file, units, cards, editable, isHidden } = p
  const benchId = useMemo(() => units.find(u => u.kind === 'bench')?.id ?? null, [units])
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(units.filter(u => u.kind !== 'bench').map(u => u.id)))   // 기본 전체 펼침
  const [createReq, setCreateReq] = useState<{ parentId: string; tick: number } | null>(null)
  useEffect(() => { if (selected && !units.some(u => u.id === selected)) setSelected(null) }, [units, selected])
  useEffect(() => { setExpanded(prev => { const n = new Set(prev); for (const u of units) if (!prev.has(u.id) && u.kind !== 'bench' && !units.some(x => x.id === u.parent_unit_id && !prev.has(x.id))) n.add(u.id); return n.size === prev.size ? prev : n }) }, [units])   // 새 단위는 펼침

  // 인원(하위 포함) — 본 카드·공석 제외·숨김 제외
  const { countOf, cardsByUnit } = useMemo(() => {
    const byUnit = new Map<string, OrgCard[]>()
    for (const c of cards) { if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []); byUnit.get(c.unit_id)!.push(c) }
    const countOf = new Map<string, number>()
    const walk = (n: OrgUnitNode): number => { const own = (byUnit.get(n.unit.id) ?? []).filter(c => !c.is_vacancy && c.is_primary !== false && !isHidden(c)).length; const t = own + n.children.reduce((s, c) => s + walk(c), 0); countOf.set(n.unit.id, t); return t }
    buildUnitTree(units).forEach(walk)
    return { countOf, cardsByUnit: byUnit }
  }, [units, cards, isHidden])
  const unit = selected ? units.find(u => u.id === selected) ?? null : null
  const head = unit?.head_card_id ? cards.find(c => c.id === unit.head_card_id) ?? null : null
  const headLabel = head ? `${p.person(head).name}${head.rank_id && p.ranks.get(head.rank_id) ? ` (${p.ranks.get(head.rank_id)!.label})` : ''}${head.is_primary === false ? ' · 겸직' : ''}` : null
  const people = useMemo(() => {
    if (!unit) return { total: 0, own: 0, concurrent: 0, vacancies: 0 }
    const ids = new Set<string>([unit.id]); const walk = (id: string) => units.filter(u => u.parent_unit_id === id).forEach(u => { ids.add(u.id); walk(u.id) }); walk(unit.id)
    const all = cards.filter(c => ids.has(c.unit_id) && !isHidden(c))
    return { total: countOf.get(unit.id) ?? 0, own: (cardsByUnit.get(unit.id) ?? []).filter(c => !c.is_vacancy && c.is_primary !== false && !isHidden(c)).length, concurrent: all.filter(c => c.is_primary === false).length, vacancies: all.filter(c => c.is_vacancy).length }
  }, [unit, units, cards, countOf, cardsByUnit, isHidden])
  const depth = useMemo(() => { let d = 0; const walk = (n: OrgUnitNode) => { d = Math.max(d, n.depth + 1); n.children.forEach(walk) }; buildUnitTree(units).filter(r => r.unit.kind !== 'bench').forEach(walk); return d }, [units])
  const nUnits = units.filter(u => u.kind !== 'bench').length
  const rosterTotal = p.roster ? p.roster.missing_count + p.roster.ghost_count + p.roster.division_mismatch_count : 0
  const expandAll = () => setExpanded(new Set(units.map(u => u.id)))
  const collapseAll = () => setExpanded(new Set(units.filter(u => !u.parent_unit_id || u.parent_unit_id === benchId).map(u => u.id)))

  return (
    <div style={{ fontFamily: OG.font, color: OG.ink, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 640, background: OG.pageBg, border: `1px solid ${OG.line}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* 헤더 — OrgCanvas 와 같은 구성 + 스텝퍼 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, background: '#fff', borderBottom: `1px solid ${OG.line}`, flexShrink: 0 }}>
        <button style={btn} onClick={p.onBack}>← 목록</button>
        <h3 style={{ fontSize: 15, margin: 0, cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={p.onEditMeta} title="이름·적용일·메모 편집">{file.name}</h3>
        <Tag kind={file.status}>{fileStatusLabel(file.status)}</Tag>
        {p.stepper}
        {p.lockHolder && <span style={{ fontSize: 11.5, color: OG.amber, whiteSpace: 'nowrap' }}>● {p.lockHolder} 편집 중</span>}
        <span style={{ flex: 1 }} />
        {editable && <span style={{ fontSize: 11.5, color: OG.quiet, whiteSpace: 'nowrap' }}>{p.savedAt ? `자동 저장됨 ${fmtWhen(p.savedAt)}` : ''}</span>}
        {!editable && <span style={{ fontSize: 11.5, color: OG.quiet }}>읽기 전용{p.lockHolder ? ' — 잠금 해제 대기 또는 복사' : ''}</span>}
        {editable && <button style={{ ...btn, ...(p.undo?.available ? {} : btnDisabled) }} disabled={!p.undo?.available} onClick={p.onUndo}
                 title={p.undo?.available ? `내 마지막 동작 되돌리기 (${p.undo.rows ?? 0}건 · ${p.undo.at ? fmtWhen(p.undo.at) : ''})` : p.undo?.conflict ? '그 뒤에 다른 사용자의 변경이 있어 되돌릴 수 없습니다' : '되돌릴 내 변경이 없습니다'}>↶ 되돌리기{p.undo?.available && p.undo.rows ? ` (${p.undo.rows})` : ''}</button>}
        <button style={{ ...btn, ...(rosterTotal > 0 ? { borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' } : {}) }} onClick={p.onRoster}>검증{p.roster ? ` (${rosterTotal})` : ''}</button>
        <button style={btn} onClick={p.onHistory}>히스토리</button>
        <button style={btn} onClick={p.onExport}>내보내기</button>
        <button style={btn} onClick={p.onCopy}>복사</button>
        {file.status === 'draft' && <button style={{ ...btnPri, ...(p.isSuper ? {} : btnDisabled) }} disabled={!p.isSuper} title={p.isSuper ? '' : '최고 관리자만 Active 지정'} onClick={p.onActivate}>Active 지정</button>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 12, padding: 12 }}>
        {/* 좌: 아웃라이너 */}
        <div style={{ width: 520, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ fontSize: 13 }}>조직 단위</b><span style={{ fontSize: 11, color: OG.quiet }}>{nUnits} · 깊이 {depth}</span>
            <span style={{ flex: 1 }} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 단위 이름·약칭" onKeyDown={e => { if (e.key === 'Escape') setQuery('') }}
                   style={{ fontFamily: OG.font, fontSize: 11.5, padding: '4px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, width: 150 }} />
            <button style={chipBtn} onClick={expandAll}>모두 펼침</button><button style={chipBtn} onClick={collapseAll}>모두 접기</button>
          </div>
          <OrgOutliner units={units} countOf={countOf} selected={selected} onSelect={setSelected} editable={editable} expanded={expanded} onToggle={id => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })} setExpanded={setExpanded}
                       query={query} benchId={benchId} createReq={createReq}
                       onRename={p.onRename} onCreate={p.onCreate} onPlace={p.onPlace} onDuplicate={p.onDuplicate} onDelete={p.onDelete} />
          {editable && <div style={{ padding: '6px 10px', borderTop: `1px solid ${OG.lineSoft}`, fontSize: 11, color: OG.quiet, display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center' }}>
            <span><kbd style={kbd}>↑↓</kbd> 이동</span><span><kbd style={kbd}>F2</kbd> 이름</span><span><kbd style={kbd}>Enter</kbd> 새 형제</span><span><kbd style={kbd}>⇧Enter</kbd> 새 하위</span><span><kbd style={kbd}>Tab</kbd>/<kbd style={kbd}>⇧Tab</kbd> 들여·내어쓰기</span><span><kbd style={kbd}>⌥↑↓</kbd> 순서</span><span><kbd style={kbd}>⌘D</kbd> 복제</span><span><kbd style={kbd}>Del</kbd> 삭제(카드→보류)</span><span>드래그: 위/아래 = 사이, 가운데 = 하위</span>
          </div>}
        </div>
        {/* 중앙: 상세 */}
        <div style={{ flex: 1, minWidth: 360, background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <OrgUnitDetail unit={unit} units={units} jobs={p.jobs} benchId={benchId} editable={editable} headLabel={headLabel} people={people} baseFileName={p.baseFileName}
                         onPatch={patch => unit ? p.onPatchUnit(unit.id, patch) : Promise.resolve()} onPlace={(pid, idx) => unit ? p.onPlace(unit.id, pid, idx) : Promise.resolve()}
                         onAddChild={() => unit && setCreateReq({ parentId: unit.id, tick: Date.now() })} onDuplicate={() => unit && p.onDuplicate(unit)} onMerge={() => unit && p.onMerge(unit)} onDelete={() => unit && p.onDelete(unit)}
                         onOpenCanvas={() => p.onOpenCanvas(unit?.id)} />
        </div>
        {/* 우: 미니 트리 */}
        <div style={{ width: 340, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center' }}>
            <b style={{ fontSize: 12.5 }}>미리보기 (트리)</b><span style={{ marginLeft: 'auto', fontSize: 11, color: OG.quiet }}>단위만 · 실시간</span>
          </div>
          <MiniBox selected={selected} units={units} onSelect={id => { setSelected(id); setExpanded(prev => { const n = new Set(prev); let cur = units.find(u => u.id === id); while (cur?.parent_unit_id) { n.add(cur.parent_unit_id); cur = units.find(u => u.id === cur!.parent_unit_id) } return n }) }} />
          <div style={{ padding: '8px 12px', borderTop: `1px solid ${OG.lineSoft}`, fontSize: 11, color: OG.quiet, lineHeight: 1.5 }}>선택 단위와 하위를 강조 · 클릭 = 아웃라이너 선택 · <span onClick={() => p.onOpenCanvas(unit?.id)} style={{ color: OG.drop, cursor: 'pointer' }}>캔버스 열기 →</span> (조직 트리 · 노드 캔버스 · 목록)</div>
        </div>
      </div>
    </div>
  )
}

/** 컨테이너 크기에 맞춰 미니 트리 렌더 */
function MiniBox({ units, selected, onSelect }: { units: OrgUnit[]; selected: string | null; onSelect: (id: string) => void }) {
  const [size, setSize] = useState({ w: 338, h: 400 })
  const ref = (el: HTMLDivElement | null) => { if (!el) return; const r = el.getBoundingClientRect(); if (Math.abs(r.width - size.w) > 2 || Math.abs(r.height - size.h) > 2) setSize({ w: r.width, h: r.height }) }
  return <div ref={ref} style={{ flex: 1, minHeight: 0 }}><OrgMiniTree units={units} selected={selected} width={size.w} height={size.h} onSelect={onSelect} /></div>
}
const chipBtn: React.CSSProperties = { ...btn, fontSize: 11, padding: '3px 8px', borderRadius: 999 }
