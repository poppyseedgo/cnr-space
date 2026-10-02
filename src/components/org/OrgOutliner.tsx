/**
 * OrgOutliner.tsx — ① 구조 설계 좌측 아웃라이너 (단위만, 카드 없음) — 설계서 §15.5 W1
 *  - [2026-10-02 ORG 8-C] structureLocked(③ 인원 배치용 읽기 트리) · extTypes/onExtDrop(인원 풀·카드 드롭) · rowMeta · filterIds
 *  - [2026-10-02 ORG 8-A] 신규. 접기/펼침 · 인라인 이름(F2/더블클릭) · 인라인 새 단위(Enter = 형제, ⇧Enter = 하위, 끝 유령 행) · 키보드 ↑↓ ←→ ·
 *    Tab/⇧Tab 들여·내어쓰기 · ⌥↑↓ 순서 · ⌘D 복제 · Del 삭제 · 드래그(위/아래 = 형제 사이, 가운데 = 하위 끝) · 검색(일치 경로만)
 *    저장은 모두 부모(OrgStructureEditor → OrgAdminPanel) 의 RPC 로. 여기는 표시·입력만
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { OrgUnit } from '../../types'
import { buildUnitTree, descendantIds, type OrgUnitNode } from '../../utils/orgStatus'
import { OG } from './orgShared'

export interface OutlinerRow { u: OrgUnit; depth: number; hasKids: boolean; loose: boolean; parentId: string | null; index: number; nSib: number }
export interface OutlinerActions {
  onRename:    (id: string, name: string) => Promise<void>
  onCreate:    (parentId: string | null, name: string, index: number | null) => Promise<OrgUnit | null>
  onPlace:     (id: string, parentId: string | null, index: number | null) => Promise<void>
  onDuplicate: (u: OrgUnit) => Promise<void>
  onDelete:    (u: OrgUnit) => void
}
interface Props extends OutlinerActions {
  units:     OrgUnit[]
  countOf:   Map<string, number>
  selected:  string | null
  onSelect:  (id: string | null) => void
  editable:  boolean
  expanded:  Set<string>
  onToggle:  (id: string) => void
  setExpanded: (f: (prev: Set<string>) => Set<string>) => void
  query:     string
  benchId:   string | null
  /** 상세 패널 '+ 하위 단위' → 인라인 생성 행 열기 */
  createReq?: { parentId: string; tick: number } | null
  /** [8-C] 구조 잠금 — 선택·펼침·검색만. 이름/생성/이동/삭제 키·단위 드래그 비활성 (③ 인원 배치의 저장된 트리) */
  structureLocked?: boolean
  /** [8-C] 외부 드롭(인원 풀 항목·카드) — 이 타입들이 오면 행을 드롭 대상으로 */
  extTypes?: string[]
  onExtDrop?: (unitId: string, e: DragEvent) => void
  /** [8-C] 행 오른쪽 추가 표시(단위장 이름 등) · 표시할 행 제한(필터, 조상 포함해서 넘길 것) */
  rowMeta?: (u: OrgUnit) => React.ReactNode
  filterIds?: Set<string> | null
}
const DND_OUTLINE = 'application/x-org-outline'
const ROW_H = 26

export function OrgOutliner(p: Props) {
  const { units, countOf, selected, onSelect, expanded, onToggle, setExpanded, query, benchId, structureLocked, extTypes, filterIds } = p
  const editable = p.editable && !structureLocked   // 구조 편집 가능 여부(잠금이면 false)
  const [editing, setEditing]   = useState<{ id: string; value: string } | null>(null)
  const [creating, setCreating] = useState<{ parentId: string | null; index: number | null; afterId: string | null; depth: number; value: string } | null>(null)
  const [dragId, setDragId]     = useState<string | null>(null)
  const [over, setOver]         = useState<{ id: string; zone: 'before' | 'after' | 'into' } | null>(null)
  const [busy, setBusy]         = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 트리 → 보이는 행(키보드 탐색용 평면 목록) + 렌더용 트리. 검색 중엔 일치 단위 + 조상만(모두 펼침)
  const { rows, byId, main, loose, keep } = useMemo(() => {
    const roots = buildUnitTree(units)
    const bench = roots.find(r => r.unit.kind === 'bench')
    const main = roots.filter(r => r.unit.kind !== 'bench')
    const loose = bench?.children ?? []
    const q = query.trim().toLowerCase()
    const keep = new Set<string>()
    if (q || filterIds) {
      const parent = new Map(units.map(u => [u.id, u.parent_unit_id]))
      for (const u of units) if (u.kind !== 'bench' && (!filterIds || filterIds.has(u.id)) && (!q || u.name.toLowerCase().includes(q) || (u.code ?? '').toLowerCase().includes(q))) { let cur: string | null = u.id; while (cur) { keep.add(cur); cur = parent.get(cur) ?? null } }
    }
    const rows: OutlinerRow[] = []
    const walk = (n: OrgUnitNode, depth: number, isLoose: boolean, parentId: string | null, index: number, nSib: number) => {
      if ((q || filterIds) && !keep.has(n.unit.id)) return
      rows.push({ u: n.unit, depth, hasKids: n.children.length > 0, loose: isLoose, parentId, index, nSib })
      if (q || filterIds || expanded.has(n.unit.id)) n.children.forEach((c, i) => walk(c, depth + 1, isLoose, n.unit.id, i, n.children.length))
    }
    main.forEach((r, i) => walk(r, 0, false, null, i, main.length))
    loose.forEach((r, i) => walk(r, 0, true, bench!.unit.id, i, loose.length))
    return { rows, byId: new Map(units.map(u => [u.id, u])), main, loose, keep }
  }, [units, expanded, query, filterIds])

  // 선택 행 보이게 스크롤
  useEffect(() => { if (!selected) return; const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${selected}"]`); el?.scrollIntoView({ block: 'nearest' }) }, [selected])
  useEffect(() => { if (editing || creating) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing?.id, creating?.afterId, creating?.parentId])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.createReq && editable) { setEditing(null); setExpanded(prev => new Set([...prev, p.createReq!.parentId])); setCreating({ parentId: p.createReq.parentId, index: null, afterId: null, depth: 0, value: '' }) } }, [p.createReq?.tick])   // eslint-disable-line react-hooks/exhaustive-deps

  const rowOf = (id: string | null) => rows.find(r => r.u.id === id) ?? null
  const siblingIds = (parentId: string | null) => units.filter(u => u.parent_unit_id === parentId && u.kind !== 'bench').sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko')).map(u => u.id)
  const expandPath = (id: string) => { const path: string[] = []; let cur = byId.get(id); while (cur?.parent_unit_id) { path.push(cur.parent_unit_id); cur = byId.get(cur.parent_unit_id) } setExpanded(prev => new Set([...prev, ...path])) }
  const run = async (f: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await f() } finally { setBusy(false) } }

  // ── 편집 동작 ──
  const startRename = (r: OutlinerRow) => { if (!editable) return; setCreating(null); setEditing({ id: r.u.id, value: r.u.name }) }
  const commitRename = () => { if (!editing) return; const e = editing; setEditing(null); const v = e.value.trim(); if (v && v !== byId.get(e.id)?.name) run(() => p.onRename(e.id, v)) }
  const startCreate = (parentId: string | null, index: number | null, afterId: string | null, depth: number) => { if (!editable) return; setEditing(null); if (parentId) setExpanded(prev => new Set([...prev, parentId])); setCreating({ parentId, index, afterId, depth, value: '' }) }
  const commitCreate = () => {
    if (!creating) return
    const c = creating; const v = c.value.trim(); setCreating(null)
    if (!v) return
    run(async () => { const u = await p.onCreate(c.parentId, v, c.index); if (u) { onSelect(u.id); if (c.parentId) expandPath(u.id) } })
  }
  const indent = (r: OutlinerRow) => { const sib = siblingIds(r.parentId); const i = sib.indexOf(r.u.id); if (i <= 0) return; const prev = sib[i - 1]; setExpanded(s => new Set([...s, prev])); run(() => p.onPlace(r.u.id, prev, null)) }
  const outdent = (r: OutlinerRow) => {
    const parent = r.parentId ? byId.get(r.parentId) : null
    if (!parent || parent.kind === 'bench') return   // 루트 층·연결 안 된 루트는 더 못 올림
    const gp = parent.parent_unit_id ?? null
    const sib = siblingIds(gp); const i = sib.indexOf(parent.id)
    run(() => p.onPlace(r.u.id, gp, i + 1))
  }
  const reorder = (r: OutlinerRow, dir: -1 | 1) => { const j = r.index + dir; if (j < 0 || j >= r.nSib) return; run(() => p.onPlace(r.u.id, r.parentId, j)) }

  // ── 키보드 ──
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || creating) return
    const i = rows.findIndex(r => r.u.id === selected)
    const r = i >= 0 ? rows[i] : null
    const k = e.key
    if (e.altKey && r && editable && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); reorder(r, k === 'ArrowUp' ? -1 : 1); return }   // ⌥↑↓ 순서 — 이동보다 먼저
    if (k === 'ArrowDown') { e.preventDefault(); const n = rows[Math.min(rows.length - 1, i + 1)]; if (n) onSelect(n.u.id); return }
    if (k === 'ArrowUp')   { e.preventDefault(); const n = rows[Math.max(0, i - 1)]; if (n) onSelect(n.u.id); return }
    if (!r) return
    if (k === 'ArrowRight') { e.preventDefault(); if (r.hasKids && !expanded.has(r.u.id)) onToggle(r.u.id); else if (r.hasKids) { const n = rows[i + 1]; if (n) onSelect(n.u.id) } return }
    if (k === 'ArrowLeft')  { e.preventDefault(); if (r.hasKids && expanded.has(r.u.id)) onToggle(r.u.id); else if (r.parentId && r.parentId !== benchId) onSelect(r.parentId); return }
    if (!editable) return
    if (k === 'F2') { e.preventDefault(); startRename(r); return }
    if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) startCreate(r.u.id, null, null, r.depth + 1); else startCreate(r.parentId, r.index + 1, r.u.id, r.depth); return }
    if (k === 'Tab') { e.preventDefault(); e.shiftKey ? outdent(r) : indent(r); return }
    if ((e.metaKey || e.ctrlKey) && (k === 'd' || k === 'D')) { e.preventDefault(); run(() => p.onDuplicate(r.u)); return }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); p.onDelete(r.u); return }
  }

  // ── 드래그 ──
  const onDragStart = (e: DragEvent, r: OutlinerRow) => { if (!editable || editing) { e.preventDefault(); return } e.dataTransfer.setData(DND_OUTLINE, r.u.id); e.dataTransfer.effectAllowed = 'move'; setDragId(r.u.id) }
  const isExt = (e: DragEvent) => !!extTypes?.length && e.dataTransfer.types.some(t => extTypes.includes(t))
  const onDragOver = (e: DragEvent, r: OutlinerRow) => {
    if (isExt(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (!over || over.id !== r.u.id || over.zone !== 'into') setOver({ id: r.u.id, zone: 'into' }); return }   // [8-C] 외부 항목은 항상 '하위로'
    if (!dragId || dragId === r.u.id) return
    const desc = descendantIds(dragId, units); if (desc.has(r.u.id)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); const y = (e.clientY - rect.top) / rect.height
    const zone = y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into'
    if (!over || over.id !== r.u.id || over.zone !== zone) setOver({ id: r.u.id, zone })
  }
  const onDrop = (e: DragEvent, r: OutlinerRow) => {
    if (isExt(e)) { e.preventDefault(); e.stopPropagation(); setOver(null); p.onExtDrop?.(r.u.id, e); return }   // [8-C]
    e.preventDefault(); const id = e.dataTransfer.getData(DND_OUTLINE) || dragId; const z = over?.id === r.u.id ? over.zone : 'into'; setOver(null); setDragId(null)
    if (!id || id === r.u.id) return
    const d = rowOf(id) ?? { parentId: byId.get(id)?.parent_unit_id ?? null, index: siblingIds(byId.get(id)?.parent_unit_id ?? null).indexOf(id) }
    if (z === 'into') { setExpanded(s => new Set([...s, r.u.id])); run(() => p.onPlace(id, r.u.id, null)); return }
    const same = d.parentId === r.parentId && d.index < r.index
    const idx = (z === 'before' ? r.index : r.index + 1) - (same ? 1 : 0)
    run(() => p.onPlace(id, r.parentId, idx))
  }
  const onDragEnd = () => { setDragId(null); setOver(null) }

  // ── 렌더 ──
  const typeTag = (t?: string | null) => t ? <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.lineSoft}`, borderRadius: 4, padding: '0 4px', lineHeight: '14px', whiteSpace: 'nowrap' }}>{t}</span> : null
  const input = (value: string, onChange: (v: string) => void, onCommit: () => void, onCancel: () => void) => (
    <input ref={inputRef} value={value} onChange={e => onChange(e.target.value)} onBlur={onCommit}
           onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') onCommit(); if (e.key === 'Escape') onCancel() }}
           style={{ flex: 1, fontFamily: OG.font, fontSize: 12.5, padding: '2px 6px', border: `1px solid ${OG.drop}`, borderRadius: 4, outline: 'none', minWidth: 0 }} />
  )
  const ghost = (parentId: string, depth: number) => editable && !query && (
    <div key={`ghost-${parentId}`} onClick={() => startCreate(parentId, null, null, depth)}
         style={{ height: ROW_H, display: 'flex', alignItems: 'center', paddingLeft: 10 + depth * 18 + 20, fontSize: 11.5, color: OG.drop, cursor: 'text', opacity: .75 }}>
      + 새 하위 단위… <kbd style={kbd}>⇧Enter</kbd>
    </div>
  )

  const q = query.trim()
  const renderNode = (n: OrgUnitNode, depth: number, isLoose: boolean, parentId: string | null, index: number, nSib: number): React.ReactNode[] => {
    if ((q || filterIds) && !keep.has(n.unit.id)) return []
    const r: OutlinerRow = { u: n.unit, depth, hasKids: n.children.length > 0, loose: isLoose, parentId, index, nSib }
    const open = r.hasKids && (expanded.has(r.u.id) || !!q || !!filterIds)
    const sel = r.u.id === selected, isEd = editing?.id === r.u.id, ov = over?.id === r.u.id ? over.zone : null, dragging = dragId === r.u.id
    const out: React.ReactNode[] = [
      <div key={r.u.id} data-row={r.u.id} draggable={editable && !isEd} onDragStart={e => onDragStart(e, r)} onDragOver={e => onDragOver(e, r)} onDragLeave={() => over?.id === r.u.id && setOver(null)} onDrop={e => onDrop(e, r)} onDragEnd={onDragEnd}
           onClick={() => onSelect(r.u.id)} onDoubleClick={() => startRename(r)}
           style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 10 + r.depth * 18, paddingRight: 10, fontSize: 12.5, cursor: 'default', userSelect: 'none', position: 'relative',
                    background: ov === 'into' ? '#EFF6FF' : sel ? '#EFF6FF' : 'transparent', outline: ov === 'into' ? `2px dashed ${OG.drop}` : sel ? `1px solid #BFDBFE` : 'none', outlineOffset: -2, opacity: dragging ? .4 : 1,
                    color: r.loose ? OG.quiet : OG.ink, boxShadow: ov === 'before' ? `inset 0 2px 0 ${OG.drop}` : ov === 'after' ? `inset 0 -2px 0 ${OG.drop}` : 'none' }}>
        <span onClick={e => { e.stopPropagation(); if (r.hasKids) onToggle(r.u.id) }} style={{ width: 14, textAlign: 'center', color: OG.faint, fontSize: 10, cursor: r.hasKids ? 'pointer' : 'default' }}>{r.hasKids ? (open ? '−' : '+') : '·'}</span>
        {isEd ? input(editing!.value, v => setEditing({ id: r.u.id, value: v }), commitRename, () => setEditing(null))
              : <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.depth === 0 && !r.loose ? 600 : 400, borderBottom: r.loose && r.depth === 0 ? `1px dashed ${OG.faint}` : 'none' }}>{r.u.name}{r.u.code && r.u.code !== 'ROOT' ? <span style={{ color: OG.faint, fontSize: 11, marginLeft: 6 }}>{r.u.code}</span> : null}</span>}
        {typeTag(r.u.unit_type)}
        {p.rowMeta?.(r.u)}
        <span style={{ fontSize: 11, color: OG.faint, minWidth: 28, textAlign: 'right' }} title="인원(하위 포함, 본 카드·숨김 제외)">{countOf.get(r.u.id) ?? 0}</span>
      </div>,
    ]
    if (open) n.children.forEach((c, i) => out.push(...renderNode(c, depth + 1, isLoose, r.u.id, i, n.children.length)))
    if (creating && creating.afterId === null && creating.parentId === r.u.id) out.push(newRow(depth + 1))   // 새 하위(끝)
    else if (open && editable && !q && sel) out.push(ghost(r.u.id, depth))   // 유령 행은 선택 단위에만 (화면 소음 방지) — 다른 단위는 ⇧Enter 또는 상세 '+ 하위 단위'
    if (creating && creating.afterId === r.u.id) out.push(newRow(depth))   // 새 형제(이 행 다음)
    return out
  }
  const out: React.ReactNode[] = []
  main.forEach((r, i) => out.push(...renderNode(r, 0, false, null, i, main.length)))
  if (loose.length) {
    out.push(<div key="loose-h" style={{ margin: '8px 10px 2px', paddingTop: 8, borderTop: `1px dashed ${OG.line}`, fontSize: 11, color: OG.quiet }}>⚡ 연결 안 된 단위 {loose.length} — 상위 선이 끊긴 단위. 트리로 끌어 붙이거나(또는 상세 패널 '상위 단위') 삭제</div>)
    loose.forEach((r, i) => out.push(...renderNode(r, 0, true, benchId, i, loose.length)))
  }
  if (creating && creating.afterId === null && creating.parentId === null) out.push(newRow(0))
  function newRow(depth: number) {
    return (
      <div key="new-row" style={{ height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 10 + depth * 18, paddingRight: 10 }}>
        <span style={{ width: 14, textAlign: 'center', color: OG.drop, fontSize: 10 }}>+</span>
        {input(creating!.value, v => setCreating(c => c && { ...c, value: v }), commitCreate, () => setCreating(null))}
        <span style={{ fontSize: 10.5, color: OG.faint, whiteSpace: 'nowrap' }}>Enter 저장 · Esc 취소</span>
      </div>
    )
  }

  return (
    <div ref={listRef} tabIndex={0} onKeyDown={onKey} style={{ outline: 'none', flex: 1, overflow: 'auto', padding: '6px 0', fontFamily: OG.font }} aria-label="조직 단위 아웃라이너">
      {rows.length === 0 && <div style={{ padding: 16, fontSize: 12, color: OG.faint }}>{query ? '일치하는 단위가 없습니다.' : '단위가 없습니다.'}</div>}
      {out}
    </div>
  )
}

export const kbd: React.CSSProperties = { fontSize: 10, border: `1px solid #D1D5DB`, borderBottomWidth: 2, borderRadius: 4, padding: '0 4px', background: '#fff', color: '#374151', marginLeft: 4, fontFamily: OG.font }
