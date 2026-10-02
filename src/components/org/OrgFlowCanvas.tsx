/**
 * OrgFlowCanvas.tsx — 노드 캔버스 (설계서 §14 · Phase 7). Supabase Schema Visualizer 식 자유 배치
 *  - [2026-10-02 ORG Phase 7-G] 끊긴 단위는 트리 '왼쪽' 열(루트 옆)에 배치 — 루트로 끌어 붙이기 거리 최소화 · 드래그 중 드롭 대상 노드 강조 · 자동 팬 속도 ↑ · 드래그 중 보류 카드 트레이 투명(onDragState)
 *  - [2026-10-02 ORG Phase 7-F] 배치 = 조직 트리와 같은 자체 트리 배치(부모 중앙 · 형제 sort_order · 자식 열은 부모 바로 아래, dagre 제거)
 *    · 정렬 고정(기본): 구조·높이가 바뀌면 자동 재배치. 노드 드래그 = 형제 사이에 끼우면 순서 변경(reorder), 다른 노드 위에 놓으면 상위 변경. 배치 저장 안 함
 *    · 자유 배치: 기존 동작(org_unit_layout 저장). 모드 전환 시 자유 배치 좌표는 보존
 *    · 카드 밀도: 전체 / 단위장 + 요약(기본, '구성원 n명' 클릭 = 그 노드만 펼침) / 이름만(한 줄 행)
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
  /** [7-F] 정렬 고정 모드에서 노드를 형제 사이에 끌어 놓음 = 순서 변경 (같은 부모의 형제 id 전체, 새 순서) */
  onReorderSiblings?: (ids: string[]) => void
}
export type FlowLayoutMode = 'locked' | 'free'
export type FlowCardMode = 'all' | 'summary' | 'names'

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
  /** [7-G] 드래그 중 드롭 대상(상위 변경) 노드 */
  dropTarget?:  string | null
  /** [7-F] 카드 밀도 + 요약 모드에서 개별 펼친 노드 */
  cardMode:     FlowCardMode
  openNodes:    Set<string>
  onToggleOpen: (unitId: string) => void
}
const Shared = createContext<FlowShared | null>(null)

interface Props extends Omit<FlowShared, 'totals' | 'inBench' | 'cardsByUnit' | 'cardMode' | 'openNodes' | 'onToggleOpen' | 'dropTarget'> {
  cardsByUnit:  Map<string, OrgCard[]>
  layout:       Map<string, { x: number; y: number }>
  onSaveLayout: (items: OrgLayoutItem[]) => void
  focusUnit?:   string | null
  focusTick?:   number
  actions?:     FlowActions
  /** [7-G] 노드 드래그 시작/종료 — OrgCanvas 가 트레이를 투명하게 */
  onDragState?: (dragging: boolean) => void
}
const GAP_X = 20, ROOT_GAP = 40, STEM2 = 56, LOOSE_GAP = 120   // OrgTree 와 같은 간격(형제 10+10, 루트 40, 부모→자식 STEM 28×2)

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

  // [7-F] 자동 정렬 = 조직 트리와 같은 배치. 부모를 자식 열 가운데 위에, 형제는 sort_order, 자식 열은 부모 바로 아래(실측 높이 + STEM×2). 연결 안 된 단위는 오른쪽 열
  const autoLayout = useCallback((only?: Set<string>): Node[] => {
    const cur = rf.getNodes(); const byId = new Map(cur.map(n => [n.id, n]))
    const size = (id: string) => { const n = byId.get(id); return { w: n?.measured?.width ?? NODE_W, h: n?.measured?.height ?? 120 } }
    const sortU = (a: OrgUnit, b: OrgUnit) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko')
    const kids = (id: string) => units.filter(u => u.parent_unit_id === id && byId.has(u.id)).sort(sortU)
    const widthOf = new Map<string, number>()
    const calcW = (id: string): number => { const ks = kids(id); const w = ks.length ? Math.max(NODE_W, ks.reduce((a, k) => a + calcW(k.id), 0) + GAP_X * (ks.length - 1)) : NODE_W; widthOf.set(id, w); return w }
    const pos = new Map<string, { x: number; y: number }>()
    const place = (id: string, x0: number, y: number) => {
      const w = widthOf.get(id)!; pos.set(id, { x: x0 + (w - NODE_W) / 2, y })
      let cx = x0; const cy = y + size(id).h + STEM2
      for (const k of kids(id)) { place(k.id, cx, cy); cx += widthOf.get(k.id)! + GAP_X }
    }
    const roots = units.filter(u => u.kind !== 'bench' && !u.parent_unit_id && byId.has(u.id)).sort(sortU)
    let x = 0
    for (const r of roots) { calcW(r.id); place(r.id, x, 0); x += widthOf.get(r.id)! + ROOT_GAP }
    const maxX = Math.max(0, x - ROOT_GAP)
    // 연결 안 된 단위(보류 루트 하위) — 각각 작은 트리로 오른쪽 열에 세로 나열
    // [7-G] 연결 안 된 단위 — 트리 왼쪽 열(x<0), 루트와 같은 높이부터 세로 나열: 루트로 끌어 붙이는 거리가 짧다. 각 끊긴 단위는 자기 하위를 거느린 작은 트리
    void maxX
    const loose = units.filter(u => inBench.has(u.id) && u.parent_unit_id && units.find(b => b.id === u.parent_unit_id)?.kind === 'bench' && byId.has(u.id)).sort(sortU)
    let ly = 0
    for (const l of loose) { const w = calcW(l.id); place(l.id, -(w + LOOSE_GAP), ly); let bottom = 0; const walk = (id: string) => { const q = pos.get(id)!; bottom = Math.max(bottom, q.y + size(id).h); kids(id).forEach(k => walk(k.id)) }; walk(l.id); ly = bottom + 24 }
    return cur.map(n => { const q = pos.get(n.id); return q && (!only || only.has(n.id)) ? { ...n, position: q } : n })
  }, [rf, units, inBench])

  const ready = useNodesInitialized()
  const [mode, setMode] = useState<FlowLayoutMode>('locked')
  const locked = mode === 'locked'
  const modeRef = useRef(mode); modeRef.current = mode
  const [cardMode, setCardMode] = useState<FlowCardMode>('summary')
  const [openNodes, setOpenNodes] = useState<Set<string>>(new Set())
  const onToggleOpen = useCallback((id: string) => setOpenNodes(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n }), [])
  const saveAll = useCallback((ns: Node[]) => { if (editable && modeRef.current === 'free') onSaveLayout(ns.map(n => ({ unit_id: n.id, x: n.position.x, y: n.position.y }))) }, [editable, onSaveLayout])
  const fitted = useRef(false)
  const relayout = useCallback((fit = false) => {
    const ns = autoLayout(); setNodes(ns)
    if (fit || !fitted.current) { fitted.current = true; window.setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1, duration: fit ? 300 : 0 }), 50) }
  }, [autoLayout, setNodes, rf])
  // 정렬 고정: 노드가 측정될 때마다(구조·카드 밀도·펼침 변화) 재배치. 자유 배치: 배치 없는 노드만 트리 자리로
  useEffect(() => {
    if (!ready) return
    if (locked) { relayout(); needLayout.current.clear(); return }
    if (needLayout.current.size === 0) return
    const pending = new Set(needLayout.current); needLayout.current.clear()
    const all = layoutRef.current.size === 0 || pending.size === rf.getNodes().length
    const ns = autoLayout(all ? undefined : pending); setNodes(ns); saveAll(all ? ns : ns.filter(n => pending.has(n.id)))
    if (!fitted.current) { fitted.current = true; window.setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1 }), 50) }
  }, [ready, units, locked, cardMode, autoLayout, saveAll, setNodes, rf, relayout])
  const onNodesChangeX: typeof onNodesChange = useCallback(changes => {
    onNodesChange(changes)
    if (modeRef.current === 'locked' && changes.some(c => c.type === 'dimensions' && (c as { dimensions?: unknown }).dimensions)) requestAnimationFrame(() => relayout())
  }, [onNodesChange, relayout])
  const switchMode = (m: FlowLayoutMode) => {
    setMode(m)
    if (m === 'free') { const saved = layoutRef.current; if (saved.size) setNodes(ns => ns.map(n => saved.has(n.id) ? { ...n, position: saved.get(n.id)! } : n)); else { const ns = rf.getNodes(); onSaveLayout(ns.map(n => ({ unit_id: n.id, x: n.position.x, y: n.position.y }))) } }
    else window.setTimeout(() => relayout(true), 0)
  }

  // [7-G] 드래그 중: 포인터(노드 헤더 중심) 아래의 다른 노드 = 상위 변경 대상 → 강조. 드래그 시작/종료를 바깥에 알림(트레이 투명)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const findTarget = useCallback((node: Node): Node | null => {
    const u = unitOf(node.id); if (!u) return null
    const w = node.measured?.width ?? NODE_W, h = node.measured?.height ?? 120
    const cx = node.position.x + w / 2, cy = node.position.y + Math.min(h, 60) / 2
    const desc = descendantIds(u.id, units)
    return rf.getNodes().find(n => n.id !== u.id && !desc.has(n.id) && !inBench.has(n.id) && (() => { const nw = n.measured?.width ?? NODE_W, nh = n.measured?.height ?? 120; return cx >= n.position.x && cx <= n.position.x + nw && cy >= n.position.y && cy <= n.position.y + nh })()) ?? null
  }, [unitOf, units, inBench, rf])
  const onDragStart = useCallback(() => { p.onDragState?.(true) }, [p])
  const onDrag = useCallback((_: unknown, node: Node) => { if (modeRef.current !== 'locked') return; const t = findTarget(node); const id = t && t.id !== unitOf(node.id)?.parent_unit_id ? t.id : null; setDropTarget(prev => prev === id ? prev : id) }, [findTarget, unitOf])

  // 드래그 종료: 자유 배치 = 저장 / 정렬 고정 = 다른 노드 위면 상위 변경, 아니면 형제 사이 순서 변경 → 재배치로 복귀
  const onDragStop = useCallback((_: unknown, node: Node, dragged: Node[]) => {
    p.onDragState?.(false); setDropTarget(null)
    if (modeRef.current === 'free') { saveAll(dragged); return }
    const u = unitOf(node.id); if (!u || !act) { relayout(); return }
    const w = node.measured?.width ?? NODE_W
    const cx = node.position.x + w / 2
    const target = findTarget(node)
    relayout()   // 드롭 위치에서 즉시 트리 자리로 복귀 (구조가 바뀌면 데이터 갱신 후 한 번 더 재배치, 실패해도 어긋난 채 남지 않음)
    if (target) { if (target.id !== u.parent_unit_id) act.onReparent(u.id, target.id); return }
    // 형제 슬롯: 같은 부모의 다른 형제 중심 x 와 비교
    const sib = units.filter(x => x.parent_unit_id === u.parent_unit_id && x.id !== u.id && x.kind !== 'bench').sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko'))
    const centers = sib.map(x => { const n = rf.getNode(x.id); return n ? n.position.x + (n.measured?.width ?? NODE_W) / 2 : Infinity })
    let idx = centers.findIndex(c => cx < c); if (idx < 0) idx = sib.length
    const ids = sib.map(x => x.id); ids.splice(idx, 0, u.id)
    const curOrder = [...sib.map(x => x.id)]; const curIdx = units.filter(x => x.parent_unit_id === u.parent_unit_id && x.kind !== 'bench').sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'ko')).findIndex(x => x.id === u.id)
    curOrder.splice(curIdx, 0, u.id)
    if (act.onReorderSiblings && ids.join() !== curOrder.join()) act.onReorderSiblings(ids)
  }, [saveAll, unitOf, act, units, rf, relayout, findTarget, p])
  const doAuto = () => { if (locked) { relayout(true); return } const ns = autoLayout(); setNodes(ns); saveAll(ns); window.setTimeout(() => rf.fitView({ padding: 0.1, maxZoom: 1, duration: 300 }), 50) }

  const shared: FlowShared = { ...p, totals, inBench, cardsByUnit, cardMode, openNodes, onToggleOpen, dropTarget }

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
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChangeX} onEdgesChange={onEdgesChange} onNodeDragStart={onDragStart} onNodeDrag={onDrag} onNodeDragStop={onDragStop} autoPanOnNodeDrag autoPanSpeed={28} onNodeDoubleClick={onNodeDoubleClick}
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
        <Panel position="top-left">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {editable && <button style={btn} onClick={doAuto} title={locked ? '트리 배치로 다시 정렬 + 화면 맞춤' : '트리 배치로 전체 재배치 (자유 배치 좌표 저장)'}>⟳ 자동 정렬</button>}
            {editable && <Seg value={mode} options={[['locked', '정렬 고정', '조직 트리와 같은 배치를 유지. 노드를 형제 사이에 끌어 놓으면 순서 변경, 다른 노드 위에 놓으면 상위 변경'], ['free', '자유 배치', '노드를 아무 데나 두고 저장(org_unit_layout)']]} onChange={v => switchMode(v as FlowLayoutMode)} />}
            <Seg value={cardMode} options={[['all', '카드: 전체', '구성원 카드 전부'], ['summary', '단위장 + 요약', "단위장 카드 + '구성원 n명' (클릭 = 그 노드만 펼침)"], ['names', '이름만', '한 줄 행(이름 · 직무)']]} onChange={v => { setCardMode(v as FlowCardMode); setOpenNodes(new Set()) }} />
          </div>
        </Panel>
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
                  outline: over || s.dropTarget === id ? `3px solid ${OG.drop}` : s.highlightUnit === id ? `2px solid ${OG.amber}` : 'none', outlineOffset: 2, fontFamily: OG.font, fontSize: 12.5,
                  transform: s.dropTarget === id ? 'scale(1.03)' : undefined, transition: 'transform 120ms' }}>
      <Handle type="target" position={Position.Top} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px solid ${OG.drop}`, opacity: s.editable ? 1 : 0 }} title="위 포트: 부모의 아래 포트에서 선을 끌어와 붙이면 상위 변경(연결 안 된 단위도 여기로 붙입니다)" />
      <div className="org-node-header" onClick={() => s.onToggle(id)}
           style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: isOpen && cards.length > 0 ? `1px solid ${OG.line}` : 'none', fontWeight: 600, cursor: s.editable ? 'grab' : 'pointer', userSelect: 'none', color: benchy ? OG.drop : OG.ink }}>
        <span style={{ color: OG.quiet, fontSize: 10 }}>{cards.length > 0 ? (isOpen ? '▾' : '▸') : '·'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.name}>{u.name}</span>
        {u.code && u.code !== 'ROOT' && u.code !== u.name && <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.line}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>{u.code}</span>}
        {benchy && <span style={{ fontSize: 10, color: OG.drop, border: `1px dashed ${OG.drop}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }} title="상위와 선이 끊긴 단위 — 부모 아래 포트에서 선을 끌어 붙이면 다시 연결">연결 안 됨</span>}
        <small style={{ color: OG.quiet, fontWeight: 400, marginLeft: 'auto', flexShrink: 0 }}>{total}</small>
      </div>
      {isOpen && cards.length > 0 && (() => {
        const head = cards.find(c => c.is_unit_head) ?? null
        const members = cards.filter(c => c !== head)
        const full = s.cardMode === 'all' || (s.cardMode === 'summary' && s.openNodes.has(id))
        const cardEl = (c: OrgCard) => {
          const r = c.rank_id ? s.ctx.ranks.get(c.rank_id) ?? null : null
          const pj = primaryJob(c, s.ctx.jobs)
          const jobs = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => s.ctx.jobs.get(j.job_id))].filter((x): x is OrgJob => !!x)
          return <OrgCardView card={c} person={s.ctx.person(c)} rank={r} jobs={jobs} badge={s.ctx.badge(c)} mismatch={s.ctx.mismatch(c)} dim={s.ctx.dim(c)}
                              concurrent={s.ctx.concurrent(c)} departedSince={s.ctx.departedSince(c)} hidden={s.ctx.hidden(c)}
                              selected={s.selectedCard === c.id} checked={s.selectedIds?.has(c.id)} draggable={s.editable} onClick={s.onCardClick} onDragStart={onCardDragStart} />
        }
        const rowEl = (c: OrgCard) => {   // [7-F] 이름만: 한 줄 행 (드래그·선택·클릭 동일)
          const pj = primaryJob(c, s.ctx.jobs); const pv = s.ctx.person(c); const checked = s.selectedIds?.has(c.id)
          return <div key={c.id} data-card-id={c.id} draggable={s.editable} onDragStart={e => onCardDragStart(e, c)} onClick={e => s.onCardClick(c, e)}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '3px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', opacity: s.ctx.dim(c) ? .35 : 1,
                               background: checked ? '#EFF6FF' : s.selectedCard === c.id ? '#F3F4F6' : 'transparent', outline: checked ? `1px solid ${OG.drop}` : 'none', textDecoration: pv.departed ? 'line-through' : 'none' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.is_vacancy ? `(공석) ${c.display_name ?? ''}` : pv.name}{c.is_primary === false ? <span style={{ color: '#3730A3', marginLeft: 4 }}>겸</span> : null}</span>
            <small style={{ color: OG.quiet, whiteSpace: 'nowrap' }}>{pj?.code ?? ''}</small>
          </div>
        }
        return (
          <div className="nodrag" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default' }}>
            {head && cardEl(head)}
            {members.length > 0 && s.cardMode === 'summary' && (
              <div onClick={() => s.onToggleOpen(id)} title={full ? '접기' : '이 노드만 펼치기'} style={{ fontSize: 11, color: OG.drop, cursor: 'pointer', padding: '2px 4px', userSelect: 'none' }}>{full ? '▾' : '▸'} 구성원 {members.filter(c => !c.is_vacancy && c.is_primary !== false && !s.ctx.hidden(c)).length}명{members.some(c => c.is_vacancy) ? ` · 공석 ${members.filter(c => c.is_vacancy).length}` : ''}{members.some(c => c.is_primary === false) ? ` · 겸직 ${members.filter(c => c.is_primary === false).length}` : ''}</div>
            )}
            {members.length > 0 && s.cardMode === 'names' && <div style={{ display: 'flex', flexDirection: 'column', gap: 1, borderTop: `1px dashed ${OG.line}`, paddingTop: 4 }}>{members.map(rowEl)}</div>}
            {members.length > 0 && full && (s.cardMode !== 'names') && (members.length > MAX_VISIBLE ? members.slice(0, MAX_VISIBLE) : members).map((c, i, arr) => {
              const r = c.rank_id ? s.ctx.ranks.get(c.rank_id) ?? null : null
              const prevC = i > 0 ? arr[i - 1] : null
              const tier = tierLabel(cardLevel(c, s.ctx.ranks, s.ctx.jobs), r)
              const prevTier = prevC ? tierLabel(cardLevel(prevC, s.ctx.ranks, s.ctx.jobs), prevC.rank_id ? s.ctx.ranks.get(prevC.rank_id) ?? null : null) : null
              const sep = i === 0 || prevTier !== tier
              return <div key={c.id}>{sep && <div style={{ fontSize: 10, color: OG.quiet, padding: '4px 0 6px 2px', borderTop: `1px dashed ${OG.line}`, marginTop: 2 }}>{tier}</div>}{cardEl(c)}</div>
            })}
            {full && members.length > MAX_VISIBLE && s.cardMode !== 'names' && <div style={{ fontSize: 11, color: OG.quiet, textAlign: 'center', padding: 4, border: `1px dashed ${OG.line}`, borderRadius: 6 }}>외 {members.length - MAX_VISIBLE}명 — 단위별 리스트에서 전체 보기</div>}
          </div>
        )
      })()}
      {!benchy && <Handle type="source" position={Position.Bottom} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px solid ${OG.drop}`, opacity: s.editable ? 1 : 0 }} title="아래 포트: 여기서 선을 끌어 다른 단위의 위 포트에 놓으면 그 단위가 하위가 됨" />}
      {benchy && <Handle type="source" position={Position.Bottom} isConnectable={s.editable} style={{ width: 10, height: 10, background: '#fff', border: `2px dashed ${OG.drop}`, opacity: s.editable ? 1 : 0 }} />}
    </div>
  )
})

function Seg({ value, options, onChange }: { value: string; options: [string, string, string?][]; onChange: (v: string) => void }) {
  return <div style={{ display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, overflow: 'hidden', fontSize: 11.5, background: '#fff' }}>
    {options.map(([v, label, title], i) => <div key={v} title={title} onClick={() => onChange(v)} style={{ padding: '5px 10px', cursor: 'pointer', background: value === v ? OG.ink : '#fff', color: value === v ? '#fff' : OG.quiet, borderLeft: i ? `1px solid ${OG.line}` : 'none', whiteSpace: 'nowrap' }}>{label}</div>)}
  </div>
}
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
