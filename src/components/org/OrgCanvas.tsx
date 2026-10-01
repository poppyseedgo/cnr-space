/**
 * OrgCanvas.tsx — 화면 B: 파일 상세(헤더 + 좌측 패널 + 조직 트리/단위별 리스트 + 줌)
 *  - [2026-10-01 ORG Phase 7-C] 뷰 3종: 조직 트리(고정·자동 레이아웃) / 노드 캔버스(OrgFlowCanvas, 자유 배치·org_unit_layout) / 단위별 리스트. 패널 클릭·검색은 뷰에 맞게 이동
 *  - [2026-10-01 ORG Phase 6-b] 작업대 = 캔버스 우상단 플로팅 트레이(반투명·접기/펼치기·드롭 대상). 트리 끝 루트가 아니라 어디서든 끌어다 놓고 꺼내 붙인다
 *  - [2026-10-01 ORG] 줌: 트랙패드 핀치 / Ctrl·⌘ + 휠 = 확대·축소(30%~200%, 비passive 리스너로 브라우저 페이지 줌 차단) · 일반 휠 = 스크롤
 *  - [2026-10-01 ORG Phase 6] 다중 선택(선택 모드 토글 · Ctrl/⌘ 클릭 토글 · Shift 클릭 범위) + 하단 액션 바(작업대로 · 이동… · 새 단위로 분리… · 해제) · 되돌리기 버튼 · 작업대 노드 (설계서 §13)
 *  - [2026-10-01 ORG 5-C] 검색: 입력 즉시 첫 일치 카드로 스크롤(펼침 포함), Enter = 다음 일치, 'n/m' 표시
 *  - [2026-10-01 ORG 5-C] 전체화면(고정 오버레이 + 브라우저 fullscreen) · 기본 펼침 = 전체 · 패널 클릭 → 노드 스크롤 · 읽기 전용 더블클릭 피드백 · 단위 이동(상위로/하위로/이동…)
 *  - [2026-10-01 ORG Phase 5-B] 숨김 카드(수동/자동 7일) 기본 제외 + '숨김 n 보기' 토글 · 겸직 카드 태그(본 소속) · 헤드카운트 = 사람 수
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.2. 표시·인터랙션만, 데이터·저장은 OrgAdminPanel
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import type { AppUser, OrgCard, OrgFile, OrgJob, OrgRank, OrgRosterCheck, OrgStatusCategory, OrgStatusType, OrgUnit } from '../../types'
import { buildUnitTree, cardPersonKey, descendantIds, primaryJob, sortCards, type OrgBadgeSpec, type OrgDepartedInfo, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgTree, DND, type TreeDropHandlers } from './OrgTree'
import { OrgFlowCanvas, type OrgLayoutItem } from './OrgFlowCanvas'
import type { OrgUndoPeek } from '../../lib/orgApi'
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
  /** [5-C] 단위 이동 — 상위로(부모의 형제로) · 하위로(앞 형제 아래로) · 이동…(대상 선택) */
  onOutdentUnit?: (u: OrgUnit) => void
  onIndentUnit?:  (u: OrgUnit) => void
  onMoveUnitTo?:  (u: OrgUnit) => void
  /** [Phase 6] 대규모 개편 — 작업대 · 다중 이동 · 분리/합치기 · 되돌리기 */
  onToBench?:     (cardIds: string[]) => void
  onMoveCardsTo?: (cardIds: string[]) => void
  onSplitCards?:  (cardIds: string[]) => void
  onDetachUnit?:  (u: OrgUnit) => void
  onMergeUnit?:   (u: OrgUnit) => void
  onUndo?:        () => void
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
  /** [Phase 5-B] 퇴사 판정(자동 숨김 포함) — OrgAdminPanel 소유 */
  departedOf:   (c: OrgCard) => OrgDepartedInfo
  isHidden:     (c: OrgCard) => boolean
  /** [Phase 6] 되돌리기 가능 여부(org_undo_peek) — OrgAdminPanel 이 변경마다 갱신 */
  undo?:        OrgUndoPeek | null
  /** [Phase 7] 노드 캔버스 배치(org_unit_layout) + 저장 */
  layout?:      Map<string, { x: number; y: number }>
  onSaveLayout?: (items: OrgLayoutItem[]) => void
}

export function OrgCanvas(p: Props) {
  const { file, units, cards, ranks, jobs, statusTypes, person, badge, categoryOf, roster, editable, isSuper, lockHolder, savedAt, selectedCard, unassigned, departedOf, isHidden, undo } = p
  // [Phase 5-B] 숨김 카드는 기본 제외, 토글로 표시
  const [showHidden, setShowHidden] = useState(false)
  const hiddenCount = useMemo(() => cards.filter(isHidden).length, [cards, isHidden])
  const visibleCards = useMemo(() => showHidden ? cards : cards.filter(c => !isHidden(c)), [cards, showHidden, isHidden])
  const cardsByUnit = useMemo(() => { const m = new Map<string, OrgCard[]>(); for (const c of visibleCards) { if (!m.has(c.unit_id)) m.set(c.unit_id, []); m.get(c.unit_id)!.push(c) } return m }, [visibleCards])
  // [Phase 6-b] 작업대(kind=bench) 는 본 트리에서 빼고 우상단 플로팅 트레이로. 읽기 전용에서 비어 있으면 트레이도 숨김
  const allRoots = useMemo(() => buildUnitTree(units), [units])
  const roots = useMemo(() => allRoots.filter(n => n.unit.kind !== 'bench'), [allRoots])
  const benchNode = useMemo(() => allRoots.find(n => n.unit.kind === 'bench') ?? null, [allRoots])
  const benchCount = useMemo(() => benchNode ? (cardsByUnit.get(benchNode.unit.id)?.length ?? 0) + benchNode.children.length : 0, [benchNode, cardsByUnit])
  const benchIds = useMemo(() => benchNode ? new Set([benchNode.unit.id, ...descendantIds(benchNode.unit.id, units)]) : new Set<string>(), [benchNode, units])
  const [benchOpen, setBenchOpen] = useState(false)
  useEffect(() => { if (benchCount > 0) setBenchOpen(true) }, [benchCount > 0])   // eslint-disable-line react-hooks/exhaustive-deps  — 내용이 생기면 자동 펼침, 비면 알약으로
  const [benchOver, setBenchOver] = useState(false)
  // [Phase 5-B] 겸직: 사람 키 → 본 카드 단위명 / 겸직 카드 수
  const concurrentOf = useMemo(() => {
    const unitName = new Map(units.map(u => [u.id, u.name]))
    const home = new Map<string, string>(); const n = new Map<string, number>()
    for (const c of cards) { const k = cardPersonKey(c); if (!k) continue; if (c.is_primary !== false) home.set(k, unitName.get(c.unit_id) ?? ''); else n.set(k, (n.get(k) ?? 0) + 1) }
    return (c: OrgCard) => { const k = cardPersonKey(c); if (!k || c.is_vacancy) return null; return c.is_primary === false ? { kind: 'secondary' as const, homeUnit: home.get(k) ?? '?' } : { kind: 'primary' as const, n: n.get(k) ?? 0 } }
  }, [cards, units])
  const mismatchSet = useMemo(() => new Set((roster?.division_mismatch ?? []).map(x => x.card_id)), [roster])
  const ghostSet    = useMemo(() => new Set((roster?.ghosts ?? []).map(x => x.card_id)), [roster])
  const perUnit = (set: Set<string>) => { const m = new Map<string, number>(); for (const c of cards) if (set.has(c.id)) m.set(c.unit_id, (m.get(c.unit_id) ?? 0) + 1); return m }
  const mismatchByUnit = useMemo(() => perUnit(mismatchSet), [cards, mismatchSet])  // eslint-disable-line react-hooks/exhaustive-deps
  const ghostByUnit    = useMemo(() => perUnit(ghostSet), [cards, ghostSet])        // eslint-disable-line react-hooks/exhaustive-deps

  // 펼침 깊이 프리셋 — 엑셀 실측 계층: 회사(0) → 총괄본부(1) → 실/본부(2) → Division(3) → 팀그룹(4) → 팀(5). 기본 = 전체 펼침 (10/1 결정)
  const [depthPreset, setDepthPreset] = useState<2 | 4 | 99>(99)
  // [5-C] 전체화면: 고정 오버레이(앱 레이아웃 폭 제한 해제) + 가능하면 브라우저 fullscreen
  const [full, setFull] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const toggleFull = () => {
    const next = !full; setFull(next)
    try { if (next) rootRef.current?.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}) } catch { /* 미지원 브라우저 */ }
  }
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && full) setFull(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && full && !document.fullscreenElement) setFull(false) }
    document.addEventListener('fullscreenchange', onFs); window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('fullscreenchange', onFs); window.removeEventListener('keydown', onKey) }
  }, [full])
  useEffect(() => { document.body.style.overflow = full ? 'hidden' : ''; return () => { document.body.style.overflow = '' } }, [full])
  const [roHint, setRoHint] = useState(false)   // 읽기 전용에서 더블클릭 시 헤더 안내 강조
  const [view, setView] = useState<'tree' | 'flow' | 'list'>(editable ? 'flow' : 'tree')   // 초안 = 노드 캔버스, 읽기 전용 = 고정 트리
  const [focusTick, setFocusTick] = useState(0)
  const [filter, setFilter] = useState<OrgFilter>('all')
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(1)
  const ZOOM_MIN = 0.3, ZOOM_MAX = 2
  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(2)))
  // 트랙패드 핀치(브라우저가 ctrlKey 휠로 전달) · Ctrl/⌘ + 마우스 휠 = 줌. passive:false 여야 preventDefault 로 페이지 줌을 막는다
  useEffect(() => {
    const el = bodyRef.current; if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (view !== 'tree') return   // 노드 캔버스는 React Flow 가 줌 처리
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.0015))   // 핀치/휠 모두 비례 배율
      setZoom(z => clampZoom(z * factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [view])   // eslint-disable-line react-hooks/exhaustive-deps
  const [focusUnit, setFocusUnit] = useState<string | null>(null)

  // [5-C] 검색 → 일치 카드 목록(트리 순서) + 현재 인덱스. 입력 300ms 후 첫 일치로 스크롤, Enter 로 순환
  const [hitIdx, setHitIdx] = useState(0)
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase(); if (!s) return [] as OrgCard[]
    const order: OrgCard[] = []
    const walk = (n: OrgUnitNode) => { order.push(...(cardsByUnit.get(n.unit.id) ?? [])); n.children.forEach(walk) }
    allRoots.forEach(walk)   // 작업대 카드도 검색
    return order.filter(c => { const pv = person(c); const jt = c.jobs.map(j => jobs.get(j.job_id)?.code ?? '').join(' ').toLowerCase(); return pv.name.toLowerCase().includes(s) || (pv.azureName ?? '').toLowerCase().includes(s) || jt.includes(s) })
  }, [q, allRoots, cardsByUnit, person, jobs])
  const goHit = (i: number) => {
    const c = hits[i]; if (!c) return
    setHitIdx(i)
    const path: string[] = []; let cur = units.find(u => u.id === c.unit_id)
    while (cur) { path.push(cur.id); cur = cur.parent_unit_id ? units.find(u => u.id === cur!.parent_unit_id) : undefined }
    setExpanded(prev => new Set([...prev, ...path]))
    if (view === 'list') setView('tree')
    if (benchIds.has(c.unit_id)) setBenchOpen(true)
    if (view === 'flow' && !benchIds.has(c.unit_id)) { setFocusUnit(c.unit_id); setFocusTick(t => t + 1) }   // 노드 캔버스: 노드 가운데로(React Flow setCenter)
    let tries = 0
    const scroll = () => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-card-id="${c.id}"]`)
      if (el) { if (view !== 'flow' || benchIds.has(c.unit_id)) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); el.animate([{ boxShadow: `0 0 0 4px ${OG.amber}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1200 }) }
      else if (tries++ < 10) requestAnimationFrame(scroll)
    }
    window.setTimeout(() => requestAnimationFrame(scroll), view === 'flow' ? 450 : 0)
  }
  useEffect(() => { if (!q.trim()) { setHitIdx(0); return } const t = window.setTimeout(() => goHit(0), 300); return () => window.clearTimeout(t) }, [q, hits.length])  // eslint-disable-line react-hooks/exhaustive-deps
  const [panelOpen, setPanelOpen] = useState(true)   // [5-C] 좌측 패널 접기 — 캔버스 폭 확보
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    const s = new Set<string>()
    const walk = (n: OrgUnitNode) => { if (n.depth < depthPreset) s.add(n.unit.id); n.children.forEach(walk) }
    allRoots.forEach(walk)   // 작업대 하위 단위도 펼침 상태 관리
    setExpanded(s)
  }, [allRoots, depthPreset])
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // [Phase 6] 다중 선택 — 선택 모드(클릭 = 토글) 또는 Ctrl/⌘ 클릭 = 토글, Shift 클릭 = 같은 단위 스택 안 범위. 선택 카드를 끌면 묶음 전체 이동
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const anchor = useRef<string | null>(null)
  useEffect(() => { setSel(prev => { const alive = new Set(cards.map(c => c.id)); const n = new Set([...prev].filter(id => alive.has(id))); return n.size === prev.size ? prev : n }) }, [cards])
  useEffect(() => { if (!editable) { setSel(new Set()); setSelectMode(false) } }, [editable])
  const onCardClickX = (c: OrgCard, e: MouseEvent) => {
    const multi = editable && (selectMode || e.ctrlKey || e.metaKey || e.shiftKey)
    if (!multi) { p.onCardClick(c); return }
    setSel(prev => {
      const n = new Set(prev)
      if (e.shiftKey && anchor.current) {
        const a = cards.find(x => x.id === anchor.current)
        if (a && a.unit_id === c.unit_id) {
          const stack = sortCards(cardsByUnit.get(c.unit_id) ?? [], ranks, jobs, x => person(x).name).map(x => x.id)
          const i = stack.indexOf(a.id), j = stack.indexOf(c.id)
          if (i >= 0 && j >= 0) { for (const id of stack.slice(Math.min(i, j), Math.max(i, j) + 1)) n.add(id); return n }
        }
      }
      n.has(c.id) ? n.delete(c.id) : n.add(c.id)
      return n
    })
    anchor.current = c.id
  }
  const selIds = useMemo(() => [...sel], [sel])
  const selUnits = useMemo(() => new Set(cards.filter(c => sel.has(c.id)).map(c => c.unit_id)), [cards, sel])
  const selectUnitCards = (unitId: string) => setSel(prev => { const n = new Set(prev); for (const c of cardsByUnit.get(unitId) ?? []) n.add(c.id); return n })
  const clearSel = () => { setSel(new Set()); anchor.current = null }
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && sel.size) clearSel() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [sel.size])


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
    concurrent: concurrentOf,
    departedSince: (c: OrgCard) => { const d = departedOf(c); return d.departed && !person(c).departed ? d.since : null },
    hidden: isHidden,
  }), [person, badge, ranks, jobs, mismatchSet, filter, q, concurrentOf, departedOf, isHidden])  // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const m: Record<string, number> = { vacancy: visibleCards.filter(c => c.is_vacancy).length }
    for (const c of visibleCards) { if (c.is_primary === false) continue; const k = categoryOf(c); if (k) m[k] = (m[k] ?? 0) + 1 }
    return m
  }, [visibleCards, categoryOf])
  const catChips: { id: OrgFilter; label: string }[] = [
    { id: 'all', label: '전체' },
    ...(['hire_planned', 'departing', 'leave_planned', 'leave', 'return_planned'] as OrgStatusCategory[])
      .map(cat => ({ id: cat as OrgFilter, label: statusTypes.find(t => t.category === cat && t.is_system)?.label ?? cat })),
    { id: 'vacancy', label: '공석' },
  ]

  // 패널 클릭 → 해당 노드 펼치고 스크롤 ([5-C] 실제 스크롤 — data-unit-id 로 노드를 찾아 가운데로)
  const focusOn = (id: string) => {
    setFocusUnit(id); setFocusTick(t => t + 1); if (view === 'list') setView('tree')
    const path: string[] = []; let cur = units.find(u => u.id === id)
    while (cur?.parent_unit_id) { path.push(cur.parent_unit_id); cur = units.find(u => u.id === cur!.parent_unit_id) }
    setExpanded(prev => new Set([...prev, ...path, id]))
    if (benchIds.has(id)) setBenchOpen(true)
    if (view === 'flow' && !benchIds.has(id)) return   // 노드 캔버스가 focusUnit/focusTick 으로 가운데 이동
    let tries = 0
    const scroll = () => {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-unit-id="${id}"]`)
      if (el) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
      else if (tries++ < 10) requestAnimationFrame(scroll)   // 펼침 렌더 대기
    }
    requestAnimationFrame(scroll)
  }

  // [Phase 6-b] 트레이 전체가 드롭 대상 (접힌 알약 포함) — 카드/묶음/단위/미배치 사람 → 작업대
  const trayTypes = (e: DragEvent) => e.dataTransfer.types.some(t => t === DND.card || t === DND.cards || t === DND.unit || t === DND.profile)
  const onTrayDragOver = (e: DragEvent) => { if (!editable || !benchNode || !trayTypes(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!benchOver) setBenchOver(true); if (!benchOpen) setBenchOpen(true) }
  const onTrayDrop = (e: DragEvent) => {
    if (!editable || !benchNode) return
    e.preventDefault(); e.stopPropagation(); setBenchOver(false)
    const bid = benchNode.unit.id
    const many = e.dataTransfer.getData(DND.cards), cardId = e.dataTransfer.getData(DND.card), uId = e.dataTransfer.getData(DND.unit), pId = e.dataTransfer.getData(DND.profile)
    if (many && p.onDropCards) { let ids: string[] = []; try { ids = JSON.parse(many) } catch { ids = [] } ids = ids.filter(id => cards.find(c => c.id === id)?.unit_id !== bid); if (ids.length) p.onDropCards(ids, bid) }
    else if (cardId) { const c = cards.find(x => x.id === cardId); if (c && c.unit_id !== bid) p.onDropCard(cardId, bid) }
    else if (uId) { const u = units.find(x => x.id === uId); if (u && u.kind !== 'bench' && u.parent_unit_id !== bid) p.onDropUnit(uId, bid) }
    else if (pId) p.onDropProfile(pId, bid)
  }
  const showTray = !!benchNode && (editable || benchCount > 0)

  const rosterTotal = roster ? roster.missing_count + roster.ghost_count + roster.division_mismatch_count : 0
  const chip = (active: boolean): React.CSSProperties => ({ fontSize: 11.5, padding: '4px 10px', borderRadius: 999, border: `1px solid ${active ? OG.ink : OG.line}`, background: active ? OG.ink : '#fff', color: active ? '#fff' : OG.quiet, cursor: 'pointer', whiteSpace: 'nowrap' })

  return (
    <div ref={rootRef} style={full
      ? { fontFamily: OG.font, color: OG.ink, display: 'flex', flexDirection: 'column', position: 'fixed', inset: 0, zIndex: 950, height: '100vh', background: OG.pageBg, overflow: 'hidden' }
      : { fontFamily: OG.font, color: OG.ink, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)', minHeight: 640, background: OG.pageBg, border: `1px solid ${OG.line}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', height: 56, background: '#fff', borderBottom: `1px solid ${OG.line}`, flexShrink: 0 }}>
        <button style={btn} onClick={p.onBack}>← 목록</button>
        <h3 style={{ fontSize: 15, margin: 0, cursor: 'pointer' }} onClick={p.onEditMeta} title="이름·적용일·메모 편집">{file.name}</h3>
        <Tag kind={file.status}>{fileStatusLabel(file.status)}</Tag>
        <Tag>{file.effective_on ? `적용일 ${file.effective_on}` : '적용일 미정'}</Tag>
        {lockHolder && <span style={{ fontSize: 11.5, color: OG.amber }}>● {lockHolder} 편집 중</span>}
        <span style={{ flex: 1 }} />
        {editable && <span style={{ fontSize: 11.5, color: OG.quiet }}>{savedAt ? `자동 저장됨 ${fmtWhen(savedAt)}` : ''}</span>}
        {!editable && <span style={{ fontSize: 11.5, color: roHint ? '#fff' : OG.quiet, background: roHint ? OG.amber : 'transparent', padding: '2px 8px', borderRadius: 999, transition: 'all 200ms' }}>읽기 전용 — 수정하려면 복사{lockHolder ? '(또는 잠금 해제 대기)' : ''}</span>}
        {editable && p.onUndo && <button style={{ ...btn, ...(undo?.available ? {} : btnDisabled) }} disabled={!undo?.available} onClick={p.onUndo}
                 title={undo?.available ? `내 마지막 동작 되돌리기 (${undo.rows ?? 0}건 · ${undo.at ? fmtWhen(undo.at) : ''})` : undo?.conflict ? '그 뒤에 다른 사용자의 변경이 있어 되돌릴 수 없습니다' : '되돌릴 내 변경이 없습니다'}>↶ 되돌리기{undo?.available && undo.rows ? ` (${undo.rows})` : ''}</button>}
        <button style={{ ...btn, ...(full ? { background: OG.ink, color: '#fff', borderColor: OG.ink } : {}) }} onClick={toggleFull} title={full ? '전체화면 종료 (Esc)' : '전체화면 — 앱 레이아웃 폭 제한 없이 보기'}>{full ? '✕ 전체화면 종료' : '⛶ 전체화면'}</button>
        <button style={{ ...btn, ...(rosterTotal > 0 ? { borderColor: '#FDE68A', background: '#FFFBEB', color: '#92400E' } : {}) }} onClick={p.onRoster}>검증{roster ? ` (${rosterTotal})` : ''}</button>
        {p.onHistory && <button style={btn} onClick={p.onHistory}>히스토리</button>}
        {p.onExport  && <button style={btn} onClick={p.onExport}>내보내기</button>}
        <button style={btn} onClick={p.onCopy}>복사</button>
        {file.status === 'draft' && <button style={{ ...btnPri, ...(isSuper ? {} : btnDisabled) }} disabled={!isSuper} title={isSuper ? '' : '최고 관리자만 Active 지정'} onClick={p.onActivate}>Active 지정</button>}
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!panelOpen && <div onClick={() => setPanelOpen(true)} title="단위 패널 열기" style={{ width: 22, background: '#fff', borderRight: `1px solid ${OG.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: OG.quiet, fontSize: 11, writingMode: 'vertical-rl' }}>▶ 단위 패널</div>}
        {panelOpen && <OrgUnitPanel roots={roots} cardsByUnit={cardsByUnit} expanded={expanded} editable={editable} focusUnit={focusUnit} onFocusUnit={focusOn}
                      onAddUnit={p.onAddUnit} onRenameUnit={p.onRenameUnit} onDeleteUnit={p.onDeleteUnit} onMoveUnit={p.onMoveUnit} onAddVacancy={p.onAddVacancy} onAddPerson={p.onAddPerson}
                      onOutdentUnit={p.onOutdentUnit} onIndentUnit={p.onIndentUnit} onMoveUnitTo={p.onMoveUnitTo} onReparentUnit={p.onDropUnit} units={units} onCollapse={() => setPanelOpen(false)}
                      onDetachUnit={p.onDetachUnit} onMergeUnit={p.onMergeUnit}
                      unassigned={unassigned} mismatchByUnit={mismatchByUnit} ghostByUnit={ghostByUnit} isHidden={isHidden} />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* 필터 바 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 16px', background: '#fff', borderBottom: `1px solid ${OG.line}`, flexWrap: 'wrap', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && hits.length) goHit(e.shiftKey ? (hitIdx - 1 + hits.length) % hits.length : (hitIdx + 1) % hits.length); if (e.key === 'Escape') setQ('') }}
                     placeholder="이름·직무 검색 (Enter = 다음)" style={{ width: 220, padding: '6px 52px 6px 9px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 12.5, fontFamily: OG.font }} />
              {q.trim() && <span style={{ position: 'absolute', right: 8, top: 7, fontSize: 11, color: hits.length ? OG.quiet : OG.red }}>{hits.length ? `${hitIdx + 1}/${hits.length}` : '0건'}</span>}
            </div>
            {catChips.map(c => <span key={c.id} style={chip(filter === c.id)} onClick={() => setFilter(c.id)}>{c.label}{c.id !== 'all' && counts[c.id] ? ` ${counts[c.id]}` : ''}</span>)}
            {hiddenCount > 0 && <span style={chip(showHidden)} onClick={() => setShowHidden(v => !v)} title="퇴사일+7일 경과 또는 수동 숨김 카드">숨김 {hiddenCount}{showHidden ? ' 표시 중' : ''}</span>}
            {editable && <span style={{ ...chip(selectMode), borderColor: selectMode ? OG.drop : OG.line, background: selectMode ? OG.drop : '#fff' }} onClick={() => { setSelectMode(v => !v); if (selectMode) clearSel() }} title="켜면 카드 클릭 = 선택 토글. 꺼져 있어도 Ctrl/⌘ 클릭 = 토글, Shift 클릭 = 범위">☑ 선택 모드{sel.size ? ` ${sel.size}` : ''}</span>}
            <select value={depthPreset} onChange={e => setDepthPreset(Number(e.target.value) as 2 | 4 | 99)} style={{ fontSize: 11.5, padding: '5px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.quiet, fontFamily: OG.font }}>
              <option value={2}>펼침 깊이: 본부</option><option value={4}>펼침 깊이: Division</option><option value={99}>펼침 깊이: 전체</option>
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, overflow: 'hidden' }}>
              {(['flow', 'tree', 'list'] as const).map(v => <div key={v} onClick={() => setView(v)} title={v === 'flow' ? '자유 배치 — 개편 작업용 (배치 저장)' : v === 'tree' ? '고정 트리 — 자동 레이아웃, 보기·검토용' : ''} style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', background: view === v ? OG.ink : '#fff', color: view === v ? '#fff' : OG.quiet, borderLeft: v !== 'flow' ? `1px solid ${OG.line}` : 'none' }}>{v === 'flow' ? '노드 캔버스' : v === 'tree' ? '조직 트리' : '단위별 리스트'}</div>)}
            </div>
          </div>
          {/* 범례 */}
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: OG.quiet, padding: '8px 16px 0', flexWrap: 'wrap' }}>
            {statusTypes.filter(t => t.is_system).map(t => <span key={t.code}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: badgeBg(t.category) }} />{t.label}</span>)}
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: '#FEE2E2' }} />퇴사 완료</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: '#E5E7EB' }} />퇴사일 경과(+7일 후 자동 숨김)</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, background: '#EEF2FF', border: '1px solid #C7D2FE' }} />겸직 카드</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, marginRight: 4, verticalAlign: -1, border: `1px dashed ${OG.faint}` }} />공석(TO)</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 4, verticalAlign: -1, background: OG.amber }} />Azure Division 불일치</span>
            {editable && <span style={{ marginLeft: 'auto' }}>{view === 'flow' ? '헤더 드래그 = 노드 배치(저장) · 카드 드래그 = 소속 변경(선택 묶음 함께) · 휠/핀치 = 줌 · 배경 드래그 = 이동 · Shift+드래그 = 영역 선택 · 더블클릭 = 이름' : '노드 헤더 드래그 = 단위 이동 · 카드 드래그 = 소속 변경(선택 묶음은 함께) · 헤더 클릭 = 접기/펼침 · 더블클릭 = 이름'} · 🧰 우상단 작업대로 끌어다 떼어 두고, 다시 끌어 붙이기</span>}
          </div>
          {/* 본체 — 스크롤 영역 + [Phase 6-b] 우상단 플로팅 작업대 트레이 */}
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {view === 'flow' && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <OrgFlowCanvas ctx={ctx} units={units} cardsByUnit={cardsByUnit} editable={editable} expanded={expanded} onToggle={toggle} selectedCard={selectedCard} selectedIds={sel}
                             onCardClick={onCardClickX} onUnitClick={u => { if (editable) p.onRenameUnit(u); else { setRoHint(true); window.setTimeout(() => setRoHint(false), 1600) } }}
                             drop={{ onDropCard: p.onDropCard, onDropUnit: p.onDropUnit, onDropProfile: p.onDropProfile, onDropCards: p.onDropCards }}
                             layout={p.layout ?? new Map()} onSaveLayout={p.onSaveLayout ?? (() => {})} focusUnit={focusUnit} focusTick={focusTick} highlightUnit={focusUnit} />
            </div>
          )}
          <div ref={bodyRef} style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: '20px 40px 80px', display: view === 'flow' ? 'none' : 'block' }}>
            {view === 'tree'
              ? <OrgTree roots={roots} units={units} cardsByUnit={cardsByUnit} ctx={ctx} editable={editable} expanded={expanded} onToggle={toggle}
                         selectedCard={selectedCard} onCardClick={onCardClickX} onUnitClick={u => { if (editable) p.onRenameUnit(u); else { setRoHint(true); window.setTimeout(() => setRoHint(false), 1600) } }}
                         drop={{ onDropCard: p.onDropCard, onDropUnit: p.onDropUnit, onDropProfile: p.onDropProfile, onDropCards: p.onDropCards }} zoom={zoom} highlightUnit={focusUnit} selectedIds={sel} />
              : <ListView roots={roots} cardsByUnit={cardsByUnit} ctx={ctx} selectedCard={selectedCard} selectedIds={sel} onCardClick={onCardClickX} editable={editable} onAddVacancy={p.onAddVacancy} onAddPerson={p.onAddPerson} onSelectUnit={editable ? selectUnitCards : undefined} />}
          </div>
          {showTray && benchNode && (
            <div data-bench-tray onDragOver={onTrayDragOver} onDragLeave={() => setBenchOver(false)} onDrop={onTrayDrop}
                 style={{ position: 'absolute', right: 16, top: 12, zIndex: 6, maxWidth: benchOpen ? 'min(60%, 720px)' : undefined, maxHeight: 'calc(100% - 80px)', display: 'flex', flexDirection: 'column',
                          background: benchOver ? 'rgba(239,246,255,.97)' : 'rgba(255,255,255,.82)', backdropFilter: 'blur(6px)', border: `1.5px dashed ${OG.drop}`, borderRadius: 12,
                          boxShadow: benchOver ? `0 0 0 3px ${OG.drop}33, 0 8px 24px rgba(0,0,0,.12)` : '0 6px 20px rgba(0,0,0,.10)', opacity: benchOpen || benchOver ? 1 : .85, transition: 'opacity 150ms, box-shadow 150ms' }}
                 onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }} onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = benchOpen || benchOver ? '1' : '.85' }}>
              <div onClick={() => setBenchOpen(o => !o)} title={benchOpen ? '접기' : '펼치기'}
                   style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: OG.drop, userSelect: 'none', borderBottom: benchOpen ? `1px dashed ${OG.line}` : 'none' }}>
                <span>🧰 작업대</span>
                <span style={{ fontSize: 11, fontWeight: 500, color: OG.quiet }}>{benchCount ? `카드 ${cardsByUnit.get(benchNode.unit.id)?.length ?? 0}${benchNode.children.length ? ` · 단위 ${benchNode.children.length}` : ''}` : '비어 있음'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: OG.quiet }}>{benchOpen ? '▾' : '▸'}</span>
              </div>
              {benchOpen && (
                <div style={{ overflow: 'auto', padding: '10px 12px 12px' }}>
                  {benchCount === 0
                    ? <div style={{ fontSize: 11.5, color: OG.quiet, lineHeight: 1.6, maxWidth: 220 }}>{editable ? '카드·단위를 여기로 끌어다 놓거나, 선택 후 \'작업대로\'. 꺼낼 때는 여기서 조직 노드로 끌어다 놓으세요. Active 지정 전에 비워야 합니다.' : '비어 있음'}</div>
                    : <OrgTree roots={[benchNode]} units={units} cardsByUnit={cardsByUnit} ctx={ctx} editable={editable} expanded={expanded} onToggle={toggle}
                               selectedCard={selectedCard} onCardClick={onCardClickX} onUnitClick={u => editable && p.onRenameUnit(u)}
                               drop={{ onDropCard: p.onDropCard, onDropUnit: p.onDropUnit, onDropProfile: p.onDropProfile, onDropCards: p.onDropCards }} zoom={0.9} highlightUnit={focusUnit} selectedIds={sel} headless />}
                </div>
              )}
            </div>
          )}
          </div>
          {/* [Phase 6] 선택 액션 바 */}
          {editable && sel.size > 0 && (
            <div style={{ position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: OG.ink, color: '#fff', borderRadius: 10, boxShadow: '0 6px 20px rgba(0,0,0,.25)', fontSize: 12.5, zIndex: 5 }}>
              <b>{sel.size}장 선택</b><span style={{ color: '#9CA3AF' }}>· 단위 {selUnits.size}개</span>
              {p.onToBench && <button style={barBtn} onClick={() => p.onToBench!(selIds)} title="선택 카드를 작업대로 떼어 둡니다 (단위장·보고선 해제)">🧰 작업대로</button>}
              {p.onMoveCardsTo && <button style={barBtn} onClick={() => p.onMoveCardsTo!(selIds)} title="대상 단위를 골라 한 번에 이동">이동…</button>}
              {p.onSplitCards && <button style={barBtn} onClick={() => p.onSplitCards!(selIds)} title="선택 카드로 새 단위를 만듭니다">새 단위로 분리…</button>}
              <button style={{ ...barBtn, background: 'transparent', borderColor: '#4B5563' }} onClick={clearSel} title="Esc">해제</button>
            </div>
          )}
          {view === 'tree' && (
            <div style={{ position: 'absolute', right: 20, bottom: 20, display: 'flex', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', overflow: 'hidden', fontSize: 12 }}>
              {[['−', () => setZoom(z => clampZoom(z - 0.1))], [`${Math.round(zoom * 100)}%`, () => setZoom(1)], ['+', () => setZoom(z => clampZoom(z + 0.1))]].map(([l, fn], i) =>
                <div key={i} onClick={fn as () => void} title={i === 1 ? '클릭 = 100% · 트랙패드 핀치 또는 Ctrl/⌘ + 휠 = 확대·축소' : undefined} style={{ padding: '5px 10px', borderLeft: i ? `1px solid ${OG.line}` : 'none', cursor: 'pointer', minWidth: 36, textAlign: 'center' }}>{l as string}</div>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const barBtn: React.CSSProperties = { fontFamily: OG.font, fontSize: 12, padding: '5px 10px', border: '1px solid #374151', borderRadius: 6, background: '#374151', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }
function badgeBg(cat: OrgStatusCategory) { return cat === 'hire_planned' ? '#CCFBF1' : cat === 'departing' ? '#FEF3C7' : cat === 'return_planned' ? '#E0E7FF' : '#EDE9FE' }

/** 단위별 리스트(보조 뷰) — 단위 섹션 세로 나열, 직급/직무 level 행 */
function ListView({ roots, cardsByUnit, ctx, selectedCard, selectedIds, onCardClick, editable, onAddVacancy, onAddPerson, onSelectUnit }: { roots: OrgUnitNode[]; cardsByUnit: Map<string, OrgCard[]>; ctx: any; selectedCard: string | null; selectedIds?: Set<string>; onCardClick: (c: OrgCard, e: MouseEvent) => void; editable: boolean; onAddVacancy: (unitId: string) => void; onAddPerson?: (unitId: string) => void; onSelectUnit?: (unitId: string) => void }) {
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
            <h4 style={{ fontSize: 13.5, margin: '0 0 10px', display: 'flex', gap: 8, alignItems: 'center', color: n.unit.kind === 'bench' ? OG.drop : undefined }}>{n.unit.kind === 'bench' ? '🧰 작업대' : n.unit.name} <small style={{ color: OG.quiet, fontWeight: 400 }}>{cards.filter(c => !c.is_vacancy && c.is_primary !== false && !ctx.hidden(c)).length}명{cards.some(c => c.is_primary === false) ? ` (+겸직 ${cards.filter(c => c.is_primary === false).length})` : ''}</small>
              {head && <span style={{ marginLeft: 'auto', fontSize: 11, color: OG.quiet }}>단위장: {ctx.person(head).name}</span>}
              {editable && <button style={{ ...btn, fontSize: 10.5, padding: '2px 6px', marginLeft: head ? 8 : 'auto' }} onClick={() => onAddVacancy(n.unit.id)}>+ 공석</button>}
              {editable && onAddPerson && <button style={{ ...btn, fontSize: 10.5, padding: '2px 6px' }} onClick={() => onAddPerson(n.unit.id)}>+ 입사예정자</button>}
              {onSelectUnit && cards.length > 0 && <button style={{ ...btn, fontSize: 10.5, padding: '2px 6px' }} onClick={() => onSelectUnit(n.unit.id)} title="이 단위 카드 전체 선택">☑ 전체 선택</button>}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(212px, 1fr))', gap: 10 }}>
              {cards.map(c => {
                const r = c.rank_id ? ctx.ranks.get(c.rank_id) ?? null : null
                const pj = primaryJob(c, ctx.jobs)
                const jl = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => ctx.jobs.get(j.job_id))].filter(Boolean) as OrgJob[]
                return <OrgCardView key={c.id} card={c} person={ctx.person(c)} rank={r} jobs={jl} badge={ctx.badge(c)} mismatch={ctx.mismatch(c)} dim={ctx.dim(c)} concurrent={ctx.concurrent(c)} departedSince={ctx.departedSince(c)} hidden={ctx.hidden(c)} selected={selectedCard === c.id} checked={selectedIds?.has(c.id)} onClick={onCardClick} />
              })}
              {cards.length === 0 && <span style={{ color: OG.faint, fontSize: 12 }}>카드 없음 — 미배치 패널에서 드래그하거나 공석을 추가하세요</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
