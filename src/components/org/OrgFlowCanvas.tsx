/**
 * OrgFlowCanvas.tsx — 노드 캔버스 (설계서 §14 · Phase 7). Supabase Schema Visualizer 식 자유 배치
 *  - [2026-10-01 ORG Phase 7-E] 작업대 개념 제거 — 끊긴 단위 = '연결 안 됨' 점선 노드(DB 는 parent=보류 루트 그대로), 메뉴 '떼어내기 → 작업대' → '선 끊기'
 *  - [2026-10-01 ORG Phase 7-D] 선 끌어 연결 = 상위 변경(부모 아래 포트 → 자식 위 포트, 순환·자기자신 거부) · 선 끝을 끌어 다른 부모로(reconnect) · 허공에 놓거나 선택 후 Delete / ✕ = 끊기 → 작업대
 *    · Shift+드래그 영역 선택 → 상단 묶음 액션(떼어내기 n · 합치기… · 해제) · 우클릭 메뉴(노드: 이름·하위·합치기·떼어내기/붙이기·카드 전체 선택·삭제, 선: 끊기)
 *  - [2026-10-01 ORG Phase 7-C] 신규 — React Flow(@xyflow/react) + dagre
 *    · 단위 1개 = 노드 1개(헤더 = 드래그 핸들, 단위장 → 구성원 카드 스택, 기존 OrgCardView). 카드는 노드가 아님 — 노드 안에서 HTML5 DnD 로 소속 변경(선택 묶음 함께)
 *    · 상위→하위 직각 연결선(smoothstep). 작업대 하위 단위 = 점선 노드, 연결선 없음
 *    · 배치: org_unit_layout(파일별 x,y). 없으면 dagre 자동 정렬로 초기화 후 저장. 노드 드래그 종료·자동 정렬 시 onSaveLayout
 *    · 휠/핀치 = 줌(30~200%), 배경 드래그 = 팬, Shift+드래그 = 영역 선택, 미니맵, 화면 맞춤
 *    · 읽기 전용(Active·지난 파일): 드래그 불가, 팬·줌만
 *  표시·배치만 담당. 구조 저장은 OrgCanvas → OrgAdminPanel(기존 drop 핸들러 재사용)
 */
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Panel, Handle, Position, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useNodesState, useEdgesState, useReactFlow, useNodesInitialized, useStore, type Node, type Edge, type NodeProps, type EdgeProps, type NodeMouseHandler, type EdgeMouseHandler, type Connection, type OnSelectionChangeFunc, type IsValidConnection } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { OrgCard, OrgJob, OrgUnit } from '../../types'
import { buildUnitTree, cardLevel, descendantIds, primaryJob, sortCards, subtreeHeadcount, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgCardView } from './OrgCardView'
import { DND, type TreeCardCtx, type TreeDropHandlers } from './OrgTree'
import { OG, btn, btnDisabled } from './orgShared'

export interface OrgLayoutItem { unit_id: string; x: number; y: number }
/** [7-D] 구조 액션 — OrgCanvas 가 OrgAdminPanel 핸들러를 그대로 넘긴다 */
export interface FlowActions {
  onReparent:    (unitId: string, newParentId: string) => void   // 선 연결/재연결
  onDetachUnit?: (u: OrgUnit) => void                            // 선 끊기 → 작업대
  onRenameUnit?: (u: OrgUnit) => void
  onAddUnit?:    (parentId: string) => void
  onMergeUnit?:  (u: OrgUnit) => void
  onMoveUnitTo?: (u: OrgUnit) => void
  onDeleteUnit?: (u: OrgUnit) => void
  onSelectUnitCards?: (unitId: string) => void
}

interface FlowShared {
  ctx:          TreeCardCtx
  units:        OrgUnit[]
  cardsByUnit:  Map<string, OrgCard[]>
  totals:       Map<string, number>
  inBench:      Set<string>
  editable:     boolean
  expanded:     Set<string>
  onToggle:     (unitId: string) => void
  selectedCard: string | null
  selectedIds?: Set<string>
  onCardClick:  (c: OrgCard, e: MouseEvent) => void
  onUnitClick?: (u: OrgUnit) => void
  drop:         TreeDropHandlers
  highlightUnit?: string | null
}
const Shared = createContext<FlowShared | null>(null)

interface Props extends Omit<FlowShared, 'totals' | 'inBench' | 'cardsByUnit'> {
  cardsByUnit:  Map<string, OrgCard[]>
  layout:       Map<string, { x: number; y: number }>
  onSaveLayout: (items: OrgLayoutItem[]) => void
  focusUnit?:   string | null
  focusTick?:   number
  actions?:     FlowActions
}

const NODE_W = OG.cardW
const MAX_VISIBLE = 30

export function OrgFlowCanvas(p: Props) {
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>
}

function Inner(p: Props) {
  const { units, cardsByUnit, layout, onSaveLayout, editable, focusUnit, focusTick } = p
  const rf = useReactFlow()
  const bench = useMemo(() => units.find(u => u.kind === 'bench') ?? null, [units])
  const inBench = useMemo(() => bench ? new Set([bench.id, ...descendantIds(bench.id, units)]) : new Set<string>(), [bench, units])
  const totals = useMemo(() => {
    const m = new Map<string, number>()
    const walk = (n: OrgUnitNode) => { m.set(n.unit.id, subtreeHeadcount(n, cardsByUnit, p.ctx.hidden)); n.children.forEach(walk) }
    buildUnitTree(units).forEach(walk); return m
  }, [units, cardsByUnit, p.ctx.hidden])
  const shared: FlowShared = { ...p, totals, inBench, cardsByUnit }

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const nodeTypes = useMemo(() => ({ unit: UnitNode }), [])
  const edgeTypes = useMemo(() => ({ org: OrgEdge }), [])
  const act = p.actions
  const unitOf = useCallback((id: string) => units.find(u => u.id === id), [units])

  // 단위 → 노드 (위치: 현재 노드 상태 > 저장된 배치 > 미정(자동 정렬 대상))
  const needLayout = useRef<Set<string>>(new Set())
  const layoutRef = useRef(layout); layoutRef.current = layout   // 배치 맵은 ref 로 — 맵 객체가 바뀌어도 노드를 다시 만들지 않는다
  useEffect(() => {
    const layout = layoutRef.current
    setNodes(prev => {
      const pos = new Map(prev.map(n => [n.id, n.position]))
      const next: Node[] = []
      for (const u of units) {
        if (u.kind === 'bench') continue
        const saved = pos.get(u.id) ?? layout.get(u.id)
        if (!saved) needLayout.current.add(u.id)
        next.push({ id: u.id, type: 'unit', position: saved ?? { x: 0, y: 0 }, data: { unitId: u.id }, dragHandle: '.org-node-header', draggable: editable, selectable: true, deletable: false, connectable: editable })
      }
      return next
    })
    setEdges(units.filter(u => u.kind !== 'bench' && u.parent_unit_id && !inBench.has(u.id)).map(u => ({
      id: `e-${u.id}`, source: u.parent_unit_id!, target: u.id, type: 'org', style: { stroke: '#9CA3AF', strokeWidth: 1.5 }, focusable: editable, deletable: editable, reconnectable: editable, data: { editable },
    })))
  }, [units, inBench, editable, setNodes, setEdges])

  // 자동 정렬 — dagre(TB), 실측 크기. 작업대 단위는 오른쪽 열에 세로 나열
  const autoLayout = useCallback((only?: Set<string>): Node[] => {
    const cur = rf.getNodes()
    const size = (n: Node) => ({ w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? 120 })
    const g = new dagre.graphlib.Graph(); g.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 20, marginy: 20 }); g.setDefaultEdgeLabel(() => ({}))
    const org = cur.filter(n => !inBench.has(n.id))
    for (const n of org) { const s = size(n); g.setNode(n.id, { width: s.w, height: s.h }) }
    for (const u of units) if (u.parent_unit_id && !inBench.has(u.id) && g.hasNode(u.id) && g.hasNode(u.parent_unit_id)) g.setEdge(u.parent_unit_id, u.id)
    dagre.layout(g)
    let maxX = 0
    const out = cur.map(n => {
      if (!g.hasNode(n.id)) return n
      const d = g.node(n.id); const s = size(n)
      const x = d.x - s.w / 2, y = d.y - s.h / 2; maxX = Math.max(maxX, x + s.w)
      return (!only || only.has(n.id)) ? { ...n, position: { x, y } } : n
    })
    let by = 20
    for (const n of out) {
      if (!inBench.has(n.id)) continue
      if (!only || only.has(n.id)) { n.position = { x: maxX + 120, y: by } }
      by += size(n).h + 24
    }
    return out
  }, [rf, units, inBench])

  const ready = useNodesInitialized()
  const saveAll = useCallback((ns: Node[]) => { if (editable) onSaveLayout(ns.map(n => ({ unit_id: n.id, x: n.position.x, y: n.position.y }))) }, [editable, onSaveLayout])
  useEffect(() => {
    if (!ready || needLayout.current.size === 0) return
    const pending = new Set(needLayout.current); needLayout.current.clear()
    const all = layoutRef.current.size === 0 || pending.size === rf.getNodes().length
    const ns = autoLayout(all ? undefined : pending)
    setNodes(ns)
    saveAll(all ? ns : ns.filter(n => pending.has(n.id)))
    window.setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1 }), 50)
  }, [ready, units, autoLayout, saveAll, setNodes, rf])

  const onDragStop = useCallback((_: unknown, __: Node, dragged: Node[]) => saveAll(dragged), [saveAll])
  const doAuto = () => { const ns = autoLayout(); setNodes(ns); saveAll(ns); window.setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1, duration: 300 }), 50) }

  // 패널 클릭·검색 → 해당 노드 가운데로 (줌 유지)
  useEffect(() => {
    if (!focusUnit) return
    const n = rf.getNode(focusUnit); if (!n) return
    const w = n.measured?.width ?? NODE_W, h = n.measured?.height ?? 120
    rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: rf.getZoom(), duration: 400 })
  }, [focusUnit, focusTick])   // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeDoubleClick: NodeMouseHandler = (_, n) => { const u = units.find(x => x.id === n.id); if (u) p.onUnitClick?.(u) }
  const [zoomPct, setZoomPct] = useState(100)

  // ── [7-D] 선 연결 = 상위 변경. source(부모 아래 포트) → target(자식 위 포트). 자기 자신·자기 하위로는 불가(ORG_UNIT_CYCLE 과 동일 규칙)
  const isValid: IsValidConnection = useCallback(c => {
    if (!editable || !c.source || !c.target || c.source === c.target) return false
    if (descendantIds(c.target, units).has(c.source)) return false
    return unitOf(c.target)?.parent_unit_id !== c.source
  }, [editable, units, unitOf])
  const onConnect = useCallback((c: Connection) => { if (isValid(c) && act) act.onReparent(c.target, c.source) }, [isValid, act])
  const reconnected = useRef(false)
  const onReconnect = useCallback((old: Edge, c: Connection) => { reconnected.current = true; if (c.target === old.target && isValid(c) && act) act.onReparent(c.target, c.source) }, [isValid, act])
  const onReconnectStart = useCallback(() => { reconnected.current = false }, [])
  const onReconnectEnd = useCallback((_: unknown, edge: Edge) => { if (!reconnected.current && act?.onDetachUnit) { const u = unitOf(edge.target); if (u && !inBench.has(u.id)) act.onDetachUnit(u) } reconnected.current = true }, [act, unitOf, inBench])
  const onEdgesDelete = useCallback((es: Edge[]) => { if (!act?.onDetachUnit) return; for (const e of es) { const u = unitOf(e.target); if (u && !inBench.has(u.id)) act.onDetachUnit(u) } }, [act, unitOf, inBench])

  // ── [7-D] 영역 선택 → 묶음 액션
  const [selNodes, setSelNodes] = useState<string[]>([])
  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: ns }) => setSelNodes(ns.map(n => n.id)), [])
  const topLevelSel = useMemo(() => { const set = new Set(selNodes); return selNodes.filter(id => { const u = unitOf(id); return u && !inBench.has(id) && !(u.parent_unit_id && set.has(u.parent_unit_id)) }) }, [selNodes, unitOf, inBench])
  const detachSel = () => { if (!act?.onDetachUnit) return; for (const id of topLevelSel) { const u = unitOf(id); if (u) act.onDetachUnit(u) } }
  const clearSel = () => setNodes(ns => ns.map(n => n.selected ? { ...n, selected: false } : n))

  // ── [7-D] 우클릭 메뉴 (노드 / 선)
  const [menu, setMenu] = useState<null | { x: number; y: number; unit?: OrgUnit; edge?: Edge }>(null)
  const onNodeContextMenu: NodeMouseHandler = (e, n) => { e.preventDefault(); if (!editable) return; const u = unitOf(n.id); if (u) setMenu({ x: e.clientX, y: e.clientY, unit: u }) }
  const onEdgeContextMenu: EdgeMouseHandler = (e, edge) => { e.preventDefault(); if (!editable) return; setMenu({ x: e.clientX, y: e.clientY, edge }) }
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener('click', close); window.addEventListener('keydown', close); return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', close) } }, [menu])
  const menuItems = (): { label: string; run: () => void; danger?: boolean; disabled?: boolean; title?: string }[] => {
    if (!menu || !act) return []
    if (menu.edge) { const u = unitOf(menu.edge.target); return [{ label: '✕ 선 끊기', run: () => u && act.onDetachUnit?.(u), danger: true }] }
    const u = menu.unit!; const benchy = inBench.has(u.id)
    const kids = units.filter(x => x.parent_unit_id === u.id).length, ncards = (cardsByUnit.get(u.id)?.length ?? 0)
    return [
      { label: '이름·약칭', run: () => act.onRenameUnit?.(u) },
      { label: '+ 하위 단위', run: () => act.onAddUnit?.(u.id) },
      { label: '합치기…', run: () => act.onMergeUnit?.(u), disabled: !act.onMergeUnit },
      benchy ? { label: '조직에 붙이기…', run: () => act.onMoveUnitTo?.(u) } : { label: '선 끊기', run: () => act.onDetachUnit?.(u), disabled: !u.parent_unit_id, title: !u.parent_unit_id ? '최상위 단위는 끊을 수 없음' : '상위와의 선을 끊습니다 — 하위·카드째 연결 안 된 단위로 남음' },
      { label: '이 단위 카드 전체 선택', run: () => act.onSelectUnitCards?.(u.id), disabled: ncards === 0 },
      { label: '삭제', run: () => act.onDeleteUnit?.(u), danger: true, disabled: kids > 0 || ncards > 0, title: kids > 0 ? '하위 단위가 있어 삭제 불가' : ncards > 0 ? '카드가 있어 삭제 불가' : undefined },
    ]
  }

  return (
    <Shared.Provider value={shared}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeDragStop={onDragStop} onNodeDoubleClick={onNodeDoubleClick}
                 nodesDraggable={editable} nodesConnectable={editable} elementsSelectable selectionKeyCode="Shift" multiSelectionKeyCode={['Meta', 'Control']}
                 onConnect={onConnect} isValidConnection={isValid} onReconnect={onReconnect} onReconnectStart={onReconnectStart} onReconnectEnd={onReconnectEnd} edgesReconnectable={editable}
                 onEdgesDelete={onEdgesDelete} deleteKeyCode={editable ? ['Delete', 'Backspace'] : null} onSelectionChange={onSelectionChange}
                 onNodeContextMenu={onNodeContextMenu} onEdgeContextMenu={onEdgeContextMenu} onPaneContextMenu={e => e.preventDefault()}
                 connectionLineStyle={{ stroke: OG.drop, strokeWidth: 2 }} connectionRadius={28}
                 minZoom={0.3} maxZoom={2} zoomOnScroll zoomOnPinch panOnDrag panOnScroll={false} onMove={(_, v) => setZoomPct(Math.round(v.zoom * 100))}
                 proOptions={{ hideAttribution: true }} fitView fitViewOptions={{ padding: 0.1, maxZoom: 1 }} style={{ fontFamily: OG.font }}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#D1D5DB" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={n => inBench.has(n.id) ? '#BFDBFE' : '#D1D5DB'} nodeStrokeWidth={0} style={{ width: 180, height: 110, border: `1px solid ${OG.line}`, borderRadius: 8 }} />
        <Panel position="bottom-left">
          <div style={{ display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden', fontSize: 12 }}>
            {[['−', () => rf.zoomOut({ duration: 150 })], [`${zoomPct}%`, () => rf.zoomTo(1, { duration: 200 })], ['+', () => rf.zoomIn({ duration: 150 })], ['⊡ 맞춤', () => rf.fitView({ padding: 0.1, maxZoom: 1, duration: 300 })]].map(([l, fn], i) =>
              <div key={i} onClick={fn as () => void} title={i === 1 ? '클릭 = 100% · 휠/핀치 = 줌 · 배경 드래그 = 이동 · Shift+드래그 = 영역 선택' : undefined} style={{ padding: '5px 10px', borderLeft: i ? `1px solid ${OG.line}` : 'none', cursor: 'pointer', minWidth: 36, textAlign: 'center' }}>{l as string}</div>)}
          </div>
        </Panel>
        {editable && <Panel position="top-left"><button style={btn} onClick={doAuto} title="dagre 트리 정렬로 전체 재배치 (저장됨)">⟳ 자동 정렬</button></Panel>}
        {editable && selNodes.length > 0 && (
          <Panel position="top-center">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: OG.ink, color: '#fff', borderRadius: 8, fontSize: 12.5, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }}>
              <b>단위 {selNodes.length}개 선택</b>
              {act?.onDetachUnit && <button style={{ ...barBtn, ...(topLevelSel.length ? {} : btnDisabled) }} disabled={!topLevelSel.length} onClick={detachSel} title={`선택 중 최상위 ${topLevelSel.length}개의 상위 선을 끊습니다(하위는 따라감) — 한 단위에 되돌리기 1단계`}>선 끊기 {topLevelSel.length}</button>}
              {selNodes.length === 1 && act?.onMergeUnit && <button style={barBtn} onClick={() => { const u = unitOf(selNodes[0]); if (u) act.onMergeUnit!(u) }}>합치기…</button>}
              <button style={{ ...barBtn, background: 'transparent', borderColor: '#4B5563' }} onClick={clearSel}>해제</button>
            </div>
          </Panel>
        )}
      </ReactFlow>
      {menu && (
        <div style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000, background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.14)', fontSize: 12.5, minWidth: 170, padding: 4, fontFamily: OG.font }} onClick={e => e.stopPropagation()}>
          {menu.unit && <div style={{ padding: '6px 10px', fontSize: 11, color: OG.quiet, borderBottom: `1px solid ${OG.lineSoft}`, marginBottom: 2 }}>{menu.unit.name}</div>}
          {menuItems().map((it, i) => <div key={i} title={it.title} onClick={() => { if (it.disabled) return; setMenu(null); it.run() }}
            style={{ padding: '7px 10px', borderRadius: 6, cursor: it.disabled ? 'not-allowed' : 'pointer', color: it.disabled ? OG.faint : it.danger ? OG.red : OG.ink }}
            onMouseEnter={e => { if (!it.disabled) (e.currentTarget as HTMLDivElement).style.background = '#F3F4F6' }} onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>{it.label}</div>)}
        </div>
      )}
    </Shared.Provider>
  )
}

/** 단위 노드 — OrgTree.renderNode 의 노드 프레임과 같은 모양. 헤더만 드래그 핸들, 카드 영역은 nodrag(HTML5 카드 DnD) */
const UnitNode = memo(function UnitNode({ id, selected }: NodeProps) {
  const s = useContext(Shared)!
  const u = s.units.find(x => x.id === id)!
  const [over, setOver] = useState(false)
  const cards = sortCards(s.cardsByUnit.get(id) ?? [], s.ctx.ranks, s.ctx.jobs, c => s.ctx.person(c).name)
  const isOpen = s.expanded.has(id)
  const total = s.totals.get(id) ?? 0
  const benchy = s.inBench.has(id)
  const visible = cards.length > MAX_VISIBLE ? cards.slice(0, MAX_VISIBLE) : cards
  const depth = useMemo(() => { let d = 0, cur: OrgUnit | undefined = u; while (cur?.parent_unit_id) { d++; cur = s.units.find(x => x.id === cur!.parent_unit_id) } return d }, [u, s.units])

  const types = (e: DragEvent) => e.dataTransfer.types
  const onDragOver = (e: DragEvent) => {
    if (!s.editable) return
    const t = types(e); if (!(t.includes(DND.card) || t.includes(DND.cards) || t.includes(DND.profile))) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over) setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setOver(false)
    const many = e.dataTransfer.getData(DND.cards), cardId = e.dataTransfer.getData(DND.card), pId = e.dataTransfer.getData(DND.profile)
    const all = [...s.cardsByUnit.values()].flat()
    if (many && s.drop.onDropCards) { let ids: string[] = []; try { ids = JSON.parse(many) } catch { ids = [] } ids = ids.filter(x => all.find(c => c.id === x)?.unit_id !== id); if (ids.length) s.drop.onDropCards(ids, id) }
    else if (cardId) { const c = all.find(x => x.id === cardId); if (c && c.unit_id !== id) s.drop.onDropCard(cardId, id) }
    else if (pId) s.drop.onDropProfile(pId, id)
  }
  const onCardDragStart = (e: DragEvent, c: OrgCard) => {
    e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'
    if (s.selectedIds && s.selectedIds.has(c.id) && s.selectedIds.size > 1 && s.drop.onDropCards) { e.dataTransfer.setData(DND.cards, JSON.stringify([...s.selectedIds])); e.dataTransfer.setData(DND.card, c.id); return }
    e.dataTransfer.setData(DND.card, c.id)
  }

  return (
    <div data-unit-id={id} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}
         style={{ width: NODE_W, background: benchy ? '#F8FAFF' : '#fff', border: benchy ? `1.5px dashed ${OG.drop}` : `1px solid ${depth <= 1 ? '#C7CDD8' : OG.line}`, borderRadius: 10, boxShadow: selected ? `0 0 0 2px ${OG.drop}` : '0 1px 2px rgba(0,0,0,.05)',
                  outline: over ? `2px solid ${OG.drop}` : s.highlightUnit === id ? `2px solid ${OG.amber}` : 'none', outlineOffset: 2, fontFamily: OG.font, fontSize: 12.5 }}>
      <Handle type="target" position={Position.Top} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px solid ${OG.drop}`, opacity: s.editable ? 1 : 0 }} title="위 포트: 부모의 아래 포트에서 선을 끌어와 붙이면 상위 변경(연결 안 된 단위도 여기로 붙입니다)" />
      <div className="org-node-header" onClick={() => s.onToggle(id)}
           style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: isOpen && cards.length > 0 ? `1px solid ${OG.line}` : 'none', fontWeight: 600, cursor: s.editable ? 'grab' : 'pointer', userSelect: 'none', color: benchy ? OG.drop : OG.ink }}>
        <span style={{ color: OG.quiet, fontSize: 10 }}>{cards.length > 0 ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.name}>{u.name}</span>
        {u.code && u.code !== 'ROOT' && u.code !== u.name && <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.line}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>{u.code}</span>}
        {benchy && <span style={{ fontSize: 10, color: OG.drop, border: `1px dashed ${OG.drop}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }} title="상위와 선이 끊긴 단위 — 부모 아래 포트에서 선을 끌어 붙이면 다시 연결">연결 안 됨</span>}
        <small style={{ color: OG.quiet, fontWeight: 400, marginLeft: 'auto', flexShrink: 0 }}>{total}</small>
      </div>
      {isOpen && cards.length > 0 && (
        <div className="nodrag" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default' }}>
          {visible.map((c, i) => {
            const r = c.rank_id ? s.ctx.ranks.get(c.rank_id) ?? null : null
            const prevC = i > 0 ? visible[i - 1] : null
            const tier = tierLabel(cardLevel(c, s.ctx.ranks, s.ctx.jobs), r)
            const prevTier = prevC ? tierLabel(cardLevel(prevC, s.ctx.ranks, s.ctx.jobs), prevC.rank_id ? s.ctx.ranks.get(prevC.rank_id) ?? null : null) : null
            const sep = !!prevC && !c.is_unit_head && !prevC.is_unit_head && prevTier !== tier
            const pj = primaryJob(c, s.ctx.jobs)
            const jobs = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => s.ctx.jobs.get(j.job_id))].filter((x): x is OrgJob => !!x)
            return (
              <div key={c.id}>
                {(sep || (!!prevC && prevC.is_unit_head && !c.is_unit_head)) && <div style={{ fontSize: 10, color: OG.quiet, padding: '4px 0 6px 2px', borderTop: `1px dashed ${OG.line}`, marginTop: 2 }}>{tier}</div>}
                <OrgCardView card={c} person={s.ctx.person(c)} rank={r} jobs={jobs} badge={s.ctx.badge(c)} mismatch={s.ctx.mismatch(c)} dim={s.ctx.dim(c)}
                             concurrent={s.ctx.concurrent(c)} departedSince={s.ctx.departedSince(c)} hidden={s.ctx.hidden(c)}
                             selected={s.selectedCard === c.id} checked={s.selectedIds?.has(c.id)} draggable={s.editable} onClick={s.onCardClick} onDragStart={onCardDragStart} />
              </div>
            )
          })}
          {cards.length > MAX_VISIBLE && <div style={{ fontSize: 11, color: OG.quiet, textAlign: 'center', padding: 4, border: `1px dashed ${OG.line}`, borderRadius: 6 }}>외 {cards.length - MAX_VISIBLE}명 — 단위별 리스트에서 전체 보기</div>}
        </div>
      )}
      {!benchy && <Handle type="source" position={Position.Bottom} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px solid ${OG.drop}`, opacity: s.editable ? 1 : 0 }} title="아래 포트: 여기서 선을 끌어 다른 단위의 위 포트에 놓으면 그 단위가 하위가 됨" />}
      {benchy && <Handle type="source" position={Position.Bottom} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px dashed ${OG.drop}`, opacity: s.editable ? 1 : 0 }} />}
    </div>
  )
})

const barBtn: React.CSSProperties = { fontFamily: OG.font, fontSize: 12, padding: '4px 10px', border: '1px solid #374151', borderRadius: 6, background: '#374151', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }

/** 직각 연결선 + 선택 시 중앙 ✕(끊기 → 작업대) */
function OrgEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, data }: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 6 })
  const { deleteElements } = useReactFlow()
  const editable = !!(data as { editable?: boolean } | undefined)?.editable
  const onlyThis = useStore(st => st.edges.filter(e => e.selected).length === 1 && !st.nodes.some(n => n.selected))   // 영역 선택으로 여러 선이 같이 잡혔을 땐 ✕ 숨김
  return (
    <>
      <BaseEdge id={id} path={path} style={{ ...style, stroke: selected ? OG.drop : (style?.stroke as string), strokeWidth: selected ? 2 : 1.5 }} interactionWidth={16} />
      {editable && selected && onlyThis && (
        <EdgeLabelRenderer>
          <button className="nodrag nopan" onClick={() => deleteElements({ edges: [{ id }] })} title="선 끊기 — 하위 단위는 연결 안 된 상태로 남습니다 (Delete 키와 동일)"
                  style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, pointerEvents: 'all', fontSize: 11, padding: '2px 8px', borderRadius: 999, border: `1px solid ${OG.red}`, background: '#fff', color: OG.red, cursor: 'pointer', fontFamily: OG.font }}>✕ 끊기</button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

function tierLabel(level: number, rank: { label: string } | null): string {
  if (rank) return rank.label
  if (level >= 95) return 'C-level'
  if (level >= 80) return 'Head'
  if (level >= 70) return 'Manager'
  if (level >= 60) return 'Principal'
  if (level >= 50) return 'Senior'
  if (level >= 41) return 'Level II / I'
  if (level >= 40) return 'Associate'
  return 'Intern'
}
