/**
 * OrgTree.tsx — 화면 B 본체: 조직 트리(top-down). 노드 = 단위(헤더 + 단위장 → 직급/직무 level 내림차순 카드 스택), 자식은 아래 가로 펼침
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.2 · 와이어프레임 docs/orgchart-wireframe-tree.html 확정 구조
 *  드래그(네이티브 HTML5 DnD, 초안 파일만):
 *    · 카드 → 다른 단위 노드 = 소속 변경
 *    · 단위 헤더 → 다른 단위 노드 = 상위 변경 (자기 자신·하위로는 불가 — descendantIds)
 *    · 미배치 패널의 사람 → 단위 노드 = 카드 생성
 *    · 접힌 노드 위에 600ms 머물면 자동 펼침
 *  표시 전용: 데이터·액션은 OrgCanvas/OrgAdminPanel 이 소유
 */
import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { OrgCard, OrgJob, OrgRank, OrgUnit } from '../../types'
import { cardLevel, descendantIds, primaryJob, sortCards, subtreeHeadcount, type OrgBadgeSpec, type OrgPersonView, type OrgUnitNode } from '../../utils/orgStatus'
import { OrgCardView } from './OrgCardView'
import { OG } from './orgShared'

export const DND = { card: 'text/org-card', unit: 'text/org-unit', profile: 'text/org-profile' } as const
const MAX_VISIBLE = 20
const STEM = 28

export interface TreeCardCtx {
  person:   (c: OrgCard) => OrgPersonView
  badge:    (c: OrgCard) => OrgBadgeSpec | null
  mismatch: (c: OrgCard) => boolean
  dim:      (c: OrgCard) => boolean
  ranks:    Map<string, OrgRank>
  jobs:     Map<string, OrgJob>
}
export interface TreeDropHandlers {
  onDropCard:    (cardId: string, unitId: string) => void
  onDropUnit:    (unitId: string, newParentId: string) => void
  onDropProfile: (profileId: string, unitId: string) => void
}
interface Props {
  roots:        OrgUnitNode[]
  units:        OrgUnit[]
  cardsByUnit:  Map<string, OrgCard[]>
  ctx:          TreeCardCtx
  editable:     boolean
  expanded:     Set<string>
  onToggle:     (unitId: string) => void
  selectedCard: string | null
  onCardClick:  (c: OrgCard) => void
  onUnitClick?: (u: OrgUnit) => void
  drop:         TreeDropHandlers
  zoom:         number
  highlightUnit?: string | null
}

export function OrgTree({ roots, units, cardsByUnit, ctx, editable, expanded, onToggle, selectedCard, onCardClick, onUnitClick, drop, zoom, highlightUnit }: Props) {
  const [dragging, setDragging] = useState<{ kind: 'card' | 'unit' | 'profile'; id: string; fromUnit?: string } | null>(null)
  const [overUnit, setOverUnit] = useState<string | null>(null)
  const blocked = useMemo(() => dragging?.kind === 'unit' ? new Set([dragging.id, ...descendantIds(dragging.id, units)]) : new Set<string>(), [dragging, units])
  const canDropOn = useCallback((unitId: string) => {
    if (!editable || !dragging) return false
    if (dragging.kind === 'card')    return dragging.fromUnit !== unitId
    if (dragging.kind === 'unit')    return !blocked.has(unitId) && units.find(u => u.id === dragging.id)?.parent_unit_id !== unitId
    return true
  }, [editable, dragging, blocked, units])

  const onCardDragStart = (e: DragEvent, c: OrgCard) => {
    e.dataTransfer.setData(DND.card, c.id); e.dataTransfer.effectAllowed = 'move'
    setDragging({ kind: 'card', id: c.id, fromUnit: c.unit_id })
  }
  const onUnitDragStart = (e: DragEvent, u: OrgUnit) => {
    e.dataTransfer.setData(DND.unit, u.id); e.dataTransfer.effectAllowed = 'move'
    setDragging({ kind: 'unit', id: u.id })
    e.stopPropagation()
  }
  const endDrag = () => { setDragging(null); setOverUnit(null) }

  // 외부(미배치 패널)에서 들어오는 드래그는 dataTransfer.types 로 판별
  const kindFromTypes = (e: DragEvent): 'card' | 'unit' | 'profile' | null =>
    e.dataTransfer.types.includes(DND.card) ? 'card' : e.dataTransfer.types.includes(DND.unit) ? 'unit' : e.dataTransfer.types.includes(DND.profile) ? 'profile' : null

  const hoverTimer = useRef<number | null>(null)
  const onDragOverUnit = (e: DragEvent, unitId: string) => {
    const k = kindFromTypes(e)
    if (!k || !editable) return
    if (k === 'profile' && !dragging) setDragging({ kind: 'profile', id: '' })
    if (!canDropOn(unitId) && k !== 'profile') return
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    if (overUnit !== unitId) {
      setOverUnit(unitId)
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
      if (!expanded.has(unitId)) hoverTimer.current = window.setTimeout(() => onToggle(unitId), 600)
    }
  }
  const onDropOnUnit = (e: DragEvent, unitId: string) => {
    e.preventDefault(); e.stopPropagation()
    const cardId = e.dataTransfer.getData(DND.card), uId = e.dataTransfer.getData(DND.unit), pId = e.dataTransfer.getData(DND.profile)
    if (cardId) { const c = [...cardsByUnit.values()].flat().find(x => x.id === cardId); if (c && c.unit_id !== unitId) drop.onDropCard(cardId, unitId) }
    else if (uId) { if (!blocked.has(unitId) && units.find(u => u.id === uId)?.parent_unit_id !== unitId) drop.onDropUnit(uId, unitId) }
    else if (pId) drop.onDropProfile(pId, unitId)
    endDrag()
  }

  const renderNode = (node: OrgUnitNode): ReactNode => {
    const u = node.unit
    const isOpen = expanded.has(u.id)
    const cards = sortCards(cardsByUnit.get(u.id) ?? [], ctx.ranks, ctx.jobs, c => ctx.person(c).name)
    const total = subtreeHeadcount(node, cardsByUnit)
    const over = overUnit === u.id && (dragging ? canDropOn(u.id) : false)
    const hasKids = node.children.length > 0 && isOpen
    const visible = cards.length > MAX_VISIBLE ? cards.slice(0, MAX_VISIBLE) : cards
    return (
      <div key={u.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div onDragOver={e => onDragOverUnit(e, u.id)} onDragLeave={() => setOverUnit(x => x === u.id ? null : x)} onDrop={e => onDropOnUnit(e, u.id)}
             style={{ width: OG.cardW, border: `1px solid ${node.depth <= 1 ? '#C7CDD8' : OG.line}`, borderRadius: 10, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.04)',
                      outline: over ? `2px solid ${OG.drop}` : highlightUnit === u.id ? `2px solid ${OG.amber}` : 'none', outlineOffset: 2 }}>
          <div draggable={editable} onDragStart={e => onUnitDragStart(e, u)} onDragEnd={endDrag}
               onClick={() => onToggle(u.id)} onDoubleClick={() => onUnitClick?.(u)}
               style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: isOpen && (cards.length > 0) ? `1px solid ${OG.line}` : 'none', fontWeight: 600, fontSize: 12.5, cursor: editable ? 'grab' : 'pointer', userSelect: 'none' }}>
            <span style={{ color: OG.quiet, fontSize: 10 }}>{node.children.length > 0 || cards.length > 0 ? (isOpen ? '▾' : '▸') : '·'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.name}>{u.name}</span>
            {u.code && u.code !== 'ROOT' && u.code !== u.name && <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.line}`, borderRadius: 4, padding: '0 4px', flexShrink: 0 }}>{u.code}</span>}
            <small style={{ color: OG.quiet, fontWeight: 400, marginLeft: 'auto', flexShrink: 0 }}>{total}</small>
          </div>
          {isOpen && cards.length > 0 && (
            <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {visible.map((c, i) => {
                const r = c.rank_id ? ctx.ranks.get(c.rank_id) ?? null : null
                const tier = tierLabel(cardLevel(c, ctx.ranks, ctx.jobs), r)
                const prevC = i > 0 ? visible[i - 1] : null
                const prevTier = prevC ? tierLabel(cardLevel(prevC, ctx.ranks, ctx.jobs), prevC.rank_id ? ctx.ranks.get(prevC.rank_id) ?? null : null) : null
                // 구분선: 구간(tier) 이 바뀔 때만 — level 숫자가 달라도 같은 구간이면 생략
                const sep = !!prevC && !c.is_unit_head && !prevC.is_unit_head && prevTier !== tier
                const pj = primaryJob(c, ctx.jobs)
                const jobs = [pj, ...c.jobs.filter(j => !j.is_primary).map(j => ctx.jobs.get(j.job_id))].filter((x): x is OrgJob => !!x)
                return (
                  <div key={c.id}>
                    {(sep || (!!prevC && prevC.is_unit_head && !c.is_unit_head)) && <div style={{ fontSize: 10, color: OG.quiet, padding: '4px 0 6px 2px', borderTop: `1px dashed ${OG.line}`, marginTop: 2 }}>{tier}</div>}
                    <OrgCardView card={c} person={ctx.person(c)} rank={r} jobs={jobs} badge={ctx.badge(c)} mismatch={ctx.mismatch(c)} dim={ctx.dim(c)}
                                 selected={selectedCard === c.id} draggable={editable} onClick={onCardClick} onDragStart={onCardDragStart} onDragEnd={endDrag} />
                  </div>
                )
              })}
              {cards.length > MAX_VISIBLE && <div style={{ fontSize: 11, color: OG.quiet, textAlign: 'center', padding: 4, border: `1px dashed ${OG.line}`, borderRadius: 6 }}>외 {cards.length - MAX_VISIBLE}명 — 단위별 리스트에서 전체 보기</div>}
            </div>
          )}
        </div>
        {hasKids && <div style={{ width: 0, height: STEM, borderLeft: `1.5px solid ${OG.faint}` }} />}
        {hasKids && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            {node.children.map((ch, i) => {
              const first = i === 0, last = i === node.children.length - 1, only = node.children.length === 1
              return (
                <div key={ch.unit.id} style={{ position: 'relative', padding: `${STEM}px 10px 0`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {/* 수평선: 첫째는 오른쪽 절반, 마지막은 왼쪽 절반, 중간은 전체 */}
                  {!only && <div style={{ position: 'absolute', top: 0, left: first ? '50%' : 0, right: last ? '50%' : 0, borderTop: `1.5px solid ${OG.faint}` }} />}
                  <div style={{ position: 'absolute', top: 0, left: '50%', height: STEM, borderLeft: `1.5px solid ${OG.faint}` }} />
                  {renderNode(ch)}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', display: 'flex', gap: 40, fontFamily: OG.font, width: 'max-content', margin: '0 auto' }}>  {/* margin auto — 컨테이너보다 넓어도 왼쪽이 잘리지 않음(justify center 는 overflow 시 왼쪽 클리핑) */}
      {roots.map(renderNode)}
    </div>
  )
}

/** 구분선 라벨 — 직급이 있으면 직급명, 없으면 직무 level 구간명 (초기값, 코드 관리에서 level 조정 시 함께 바뀜) */
function tierLabel(level: number, rank: OrgRank | null): string {
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
