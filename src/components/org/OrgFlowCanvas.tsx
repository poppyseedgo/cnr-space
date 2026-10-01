/**
 * OrgFlowCanvas.tsx — 노드 캔버스 (설계서 §14 · Phase 7). Supabase Schema Visualizer 식 자유 배치
 *  - [2026-10-01 ORG Phase 7-C] 신규 — React Flow(@xyflow/react) + dagre
 *    · 단위 1개 = 노드 1개(헤더 = 드래그 핸들, 단위장 → 구성원 카드 스택, 기존 OrgCardView). 카드는 노드가 아님 — 노드 안에서 HTML5 DnD 로 소속 변경(선택 묶음 함께)
 *    · 상위→하위 직각 연결선(smoothstep). 작업대 하위 단위 = 점선 노드, 연결선 없음
 *    · 배치: org_unit_layout(파일별 x,y). 없으면 dagre 자동 정렬로 초기화 후 저장. 노드 드래그 종료·자동 정렬 시 onSaveLayout
 *    · 휠/핀치 = 줌(30~200%), 배경 드래그 = 팬, Shift+드래그 = 영역 선택, 미니맵, 화면 맞춤
 *    · 읽기 전용(Active·지난 파일): 드래그 불가, 팬·줌만
 *  표시·배치만 담당. 구조 저장은 OrgCanvas → OrgAdminPanel(기존 drop 핸들러 재사용)
 */
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Panel, Handle, Position, useNodesState, useEdgesState, useReactFlow, useNodesInitialized, type Node, type Edge, type NodeProps, type NodeMouseHandler } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { OrgCard, OrgJob, OrgUnit } from '../../types'
import { buildUnitTree, cardLevel, descendantIds, primaryJob, sortCards, subtreeHeadcount, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgCardView } from './OrgCardView'
import { DND, type TreeCardCtx, type TreeDropHandlers } from './OrgTree'
import { OG, btn } from './orgShared'

export interface OrgLayoutItem { unit_id: string; x: number; y: number }

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
  const [edges, setEdges] = useEdgesState<Edge>([])
  const nodeTypes = useMemo(() => ({ unit: UnitNode }), [])

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
        next.push({ id: u.id, type: 'unit', position: saved ?? { x: 0, y: 0 }, data: { unitId: u.id }, dragHandle: '.org-node-header', draggable: editable, selectable: true })
      }
      return next
    })
    setEdges(units.filter(u => u.kind !== 'bench' && u.parent_unit_id && !inBench.has(u.id)).map(u => ({
      id: `e-${u.id}`, source: u.parent_unit_id!, target: u.id, type: 'smoothstep', style: { stroke: '#9CA3AF', strokeWidth: 1.5 }, focusable: editable,
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

  return (
    <Shared.Provider value={shared}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={onDragStop} onNodeDoubleClick={onNodeDoubleClick}
                 nodesDraggable={editable} nodesConnectable={false} elementsSelectable selectionKeyCode="Shift" multiSelectionKeyCode={['Meta', 'Control']}
                 minZoom={0.3} maxZoom={2} zoomOnScroll zoomOnPinch panOnDrag panOnScroll={false} onMove={(_, v) => setZoomPct(Math.round(v.zoom * 100))}
                 proOptions={{ hideAttribution: true }} fitView fitViewOptions={{ padding: 0.1, maxZoom: 1 }} style={{ fontFamily: OG.font }} deleteKeyCode={null}>
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#D1D5DB" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={n => inBench.has(n.id) ? '#BFDBFE' : '#D1D5DB'} nodeStrokeWidth={0} style={{ width: 180, height: 110, border: `1px solid ${OG.line}`, borderRadius: 8 }} />
        <Panel position="bottom-left">
          <div style={{ display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden', fontSize: 12 }}>
            {[['−', () => rf.zoomOut({ duration: 150 })], [`${zoomPct}%`, () => rf.zoomTo(1, { duration: 200 })], ['+', () => rf.zoomIn({ duration: 150 })], ['⊡ 맞춤', () => rf.fitView({ padding: 0.1, maxZoom: 1, duration: 300 })]].map(([l, fn], i) =>
              <div key={i} onClick={fn as () => void} title={i === 1 ? '클릭 = 100% · 휠/핀치 = 줌 · 배경 드래그 = 이동 · Shift+드래그 = 영역 선택' : undefined} style={{ padding: '5px 10px', borderLeft: i ? `1px solid ${OG.line}` : 'none', cursor: 'pointer', minWidth: 36, textAlign: 'center' }}>{l as string}</div>)}
          </div>
        </Panel>
        {editable && <Panel position="top-left"><button style={btn} onClick={doAuto} title="dagre 트리 정렬로 전체 재배치 (저장됨)">⟳ 자동 정렬</button></Panel>}
      </ReactFlow>
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
      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 8, height: 8 }} />
      <div className="org-node-header" onClick={() => s.onToggle(id)}
           style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: isOpen && cards.length > 0 ? `1px solid ${OG.line}` : 'none', fontWeight: 600, cursor: s.editable ? 'grab' : 'pointer', userSelect: 'none', color: benchy ? OG.drop : OG.ink }}>
        <span style={{ color: OG.quiet, fontSize: 10 }}>{cards.length > 0 ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.name}>{u.name}</span>
        {u.code && u.code !== 'ROOT' && u.code !== u.name && <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.line}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>{u.code}</span>}
        {benchy && <span style={{ fontSize: 10, color: OG.drop, border: `1px dashed ${OG.drop}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>작업대</span>}
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
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 8, height: 8 }} />
    </div>
  )
})

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
