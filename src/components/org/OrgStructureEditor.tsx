/**
 * OrgStructureEditor.tsx — ① 구조 설계 화면 (설계서 §15.2 flow · §15.5 W1, 2026-10-02 확정)
 *  - [2026-10-08 3컬럼 리사이즈] 좌·우 컬럼 폭 드래그 조절(B안 커스텀 핸들, 데모 확정) — 컬럼 사이 전체 높이
 *      핸들 2개(ColHandle), 좌/우 px state + clampCols(중앙 최소폭 확보), 더블클릭 = 기본값(520/340) 복귀,
 *      localStorage(COLW.KEY) 저장으로 새로고침 유지. 기존 컬럼 내용·로직 불변(마크업에 핸들만 삽입, gap → 핸들 폭 대체)
 *  - [2026-10-02 ORG 8-B] 헤더를 OrgStepHeader 로 분리(② 와 공용)
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
import { OG, btn } from './orgShared'
import { OrgStepHeader, stepShell } from './OrgStepHeader'

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
  const expandAll = () => setExpanded(new Set(units.map(u => u.id)))
  const collapseAll = () => setExpanded(new Set(units.filter(u => !u.parent_unit_id || u.parent_unit_id === benchId).map(u => u.id)))

  // ── [2026-10-08] 3컬럼 width 드래그 리사이즈 (B안) ──────────────────────────
  const [colW, setColW] = useState(loadCols)                                     // ← [2026-10-08] lazy init — localStorage 복원 + clamp
  const startColDrag = (side: 'l' | 'r') => (e: React.PointerEvent<HTMLDivElement>) => {   // ← [2026-10-08] 핸들 드래그 시작
    e.preventDefault()
    const h = e.currentTarget
    h.setPointerCapture(e.pointerId)
    const total = (h.parentElement?.getBoundingClientRect().width ?? window.innerWidth) - 24   // 행 padding 12*2 제외한 콘텐츠 폭
    const startX = e.clientX, start = { ...colW }
    let last = start
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - startX
      last = clampCols(side === 'l' ? start.l + d : start.l, side === 'r' ? start.r - d : start.r, total, side)   // 좌는 +d, 우는 -d(오른쪽 끌면 좁아짐) · 드래그한 쪽 우선 clamp
      setColW(last)
    }
    const up = (ev: PointerEvent) => {
      h.releasePointerCapture(ev.pointerId)
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up)
      saveCols(last)                                                             // 드래그 종료 시점 1회 저장
    }
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up)
  }
  const resetCols = () => { const c = { l: COLW.DEF_L, r: COLW.DEF_R }; setColW(c); saveCols(c) }   // ← [2026-10-08] 더블클릭 = 기본값 복귀

  return (
    <div style={stepShell}>
      <OrgStepHeader file={file} editable={editable} isSuper={p.isSuper} lockHolder={p.lockHolder} savedAt={p.savedAt} undo={p.undo} roster={p.roster} stepper={p.stepper}
                     onBack={p.onBack} onEditMeta={p.onEditMeta} onRoster={p.onRoster} onHistory={p.onHistory} onExport={p.onExport} onCopy={p.onCopy} onActivate={p.onActivate} onUndo={p.onUndo} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, padding: 12 }}>{/* ← [2026-10-08] gap 12 제거 — 핸들(폭 12)이 간격 역할 대체 */}
        {/* 좌: 아웃라이너 */}
        <div style={{ width: colW.l, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>{/* ← [2026-10-08] 520 고정 → colW.l */}
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
        <ColHandle onPointerDown={startColDrag('l')} onDoubleClick={resetCols} />{/* ← [2026-10-08] 좌|중 리사이즈 핸들 */}
        {/* 중앙: 상세 */}
        <div style={{ flex: 1, minWidth: COLW.MIN_C, background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>{/* ← [2026-10-08] minWidth 360 → COLW.MIN_C (SSOT) */}
          <OrgUnitDetail unit={unit} units={units} jobs={p.jobs} benchId={benchId} editable={editable} headLabel={headLabel} people={people} baseFileName={p.baseFileName}
                         onPatch={patch => unit ? p.onPatchUnit(unit.id, patch) : Promise.resolve()} onPlace={(pid, idx) => unit ? p.onPlace(unit.id, pid, idx) : Promise.resolve()}
                         onAddChild={() => unit && setCreateReq({ parentId: unit.id, tick: Date.now() })} onDuplicate={() => unit && p.onDuplicate(unit)} onMerge={() => unit && p.onMerge(unit)} onDelete={() => unit && p.onDelete(unit)}
                         onOpenCanvas={() => p.onOpenCanvas(unit?.id)} />
        </div>
        <ColHandle onPointerDown={startColDrag('r')} onDoubleClick={resetCols} />{/* ← [2026-10-08] 중|우 리사이즈 핸들 */}
        {/* 우: 미니 트리 */}
        <div style={{ width: colW.r, flex: 'none', display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>{/* ← [2026-10-08] 340 고정 → colW.r */}
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

// ── [2026-10-08] 3컬럼 리사이즈 헬퍼 — 폭 정책 SSOT ─────────────────────────
/** 기본값 = 기존 고정폭(520/340) 그대로. MIN_C 는 중앙 패널 minWidth 와 공유 */
const COLW = { DEF_L: 520, DEF_R: 340, MIN_L: 320, MIN_R: 240, MIN_C: 360, HANDLE: 12, KEY: 'org-structure-colw' } as const
/** 좌/우 폭을 [MIN, total − 반대쪽 − 중앙최소 − 핸들2개] 범위로 clamp — 중앙 최소폭 항상 확보.
 *  moved = 드래그한 쪽을 먼저 clamp — 반대쪽을 고정값으로 두고 계산해야 과대 드래그가 반대 컬럼을 밀어내지 않음(시뮬 케이스 4) */
function clampCols(l: number, r: number, total: number, moved: 'l' | 'r' = 'l'): { l: number; r: number } {
  const capL = () => { l = Math.min(Math.max(l, COLW.MIN_L), Math.max(COLW.MIN_L, total - r - COLW.MIN_C - COLW.HANDLE * 2)) }
  const capR = () => { r = Math.min(Math.max(r, COLW.MIN_R), Math.max(COLW.MIN_R, total - l - COLW.MIN_C - COLW.HANDLE * 2)) }
  if (moved === 'l') { capL(); capR() } else { capR(); capL() }   // ← [2026-10-08] 드래그한 쪽 우선
  return { l, r }
}
/** localStorage 복원(없거나 깨지면 기본값) — 저장 당시보다 좁은 창 대비 현재 창 폭으로 clamp */
function loadCols(): { l: number; r: number } {
  try {
    const s = JSON.parse(localStorage.getItem(COLW.KEY) || 'null')
    if (s && Number.isFinite(s.l) && Number.isFinite(s.r)) return clampCols(s.l, s.r, window.innerWidth - 24)
  } catch { /* 복원 실패 = 기본값 */ }
  return { l: COLW.DEF_L, r: COLW.DEF_R }
}
function saveCols(c: { l: number; r: number }) { try { localStorage.setItem(COLW.KEY, JSON.stringify(c)) } catch { /* 저장 실패 무해 */ } }
/** 컬럼 사이 전체 높이 드래그 핸들 — hover/드래그 시 파란 바 강조 */
function ColHandle({ onPointerDown, onDoubleClick }: { onPointerDown: React.PointerEventHandler<HTMLDivElement>; onDoubleClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
         title="드래그: 폭 조절 · 더블클릭: 기본값 복귀"
         style={{ width: COLW.HANDLE, flex: 'none', cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
      <div style={{ width: 3, height: hover ? 72 : 44, borderRadius: 2, background: hover ? OG.drop : '#D1D5DB', transition: 'background .12s ease, height .12s ease' }} />
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
