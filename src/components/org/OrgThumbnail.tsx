/**
 * OrgThumbnail.tsx — 조직 트리 썸네일 (SVG, 데이터에서 항상 생성 — 이미지 저장 없음)
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6.1. 상위 2단(루트 + 1단 자식) + 2단 자식은 작은 박스로
 */
import { useMemo } from 'react'
import type { OrgCard, OrgUnit } from '../../types'
import { buildUnitTree, subtreeHeadcount, type OrgUnitNode } from '../../utils/orgStatus'
import { OG } from './orgShared'

interface Props { units: OrgUnit[]; cards: OrgCard[]; width?: number; height?: number; compact?: boolean }

export function OrgThumbnail({ units, cards, width = 420, height = 230, compact = false }: Props) {
  const { roots, countOf } = useMemo(() => {
    const roots = buildUnitTree(units)
    const byUnit = new Map<string, OrgCard[]>()
    for (const c of cards) { if (!byUnit.has(c.unit_id)) byUnit.set(c.unit_id, []); byUnit.get(c.unit_id)!.push(c) }
    const countOf = (n: OrgUnitNode) => subtreeHeadcount(n, byUnit)
    return { roots, countOf }
  }, [units, cards])

  if (roots.length === 0) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><text x={width / 2} y={height / 2} textAnchor="middle" fontSize={11} fill={OG.faint} fontFamily={OG.font}>단위 없음</text></svg>
  }
  const root = roots[0]
  const level1 = root.children
  const bw = compact ? 60 : 100, bh = compact ? 18 : 30, gap = compact ? 6 : 12
  const l1W = Math.max(1, level1.length) * bw + Math.max(0, level1.length - 1) * gap
  const scale = l1W > width - 16 ? (width - 16) / l1W : 1
  const fs = compact ? 7 : 9
  const rootY = 8, l1Y = rootY + bh + (compact ? 14 : 22), l2Y = l1Y + bh * scale + (compact ? 10 : 18)
  const label = (n: OrgUnitNode) => (n.unit.code && n.unit.code !== 'ROOT' ? n.unit.code : n.unit.name)

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fontFamily={OG.font} fontSize={fs} aria-label="조직도 썸네일">
      {/* root */}
      <rect x={width / 2 - bw / 2} y={rootY} width={bw} height={bh} rx={4} fill="#fff" stroke="#C7CDD8" />
      <text x={width / 2} y={rootY + bh / 2 + (compact ? 2.5 : -1)} textAnchor="middle" fontWeight={600} fill={OG.ink}>{compact ? label(root) : root.unit.name.slice(0, 16)}</text>
      {!compact && <text x={width / 2} y={rootY + bh - 6} textAnchor="middle" fill={OG.quiet}>{countOf(root)}명</text>}
      {level1.length > 0 && <>
        <line x1={width / 2} y1={rootY + bh} x2={width / 2} y2={l1Y - 8} stroke="#9CA3AF" />
        <line x1={(width - l1W * scale) / 2 + (bw * scale) / 2} y1={l1Y - 8} x2={(width + l1W * scale) / 2 - (bw * scale) / 2} y2={l1Y - 8} stroke="#9CA3AF" />
      </>}
      {level1.map((n, i) => {
        const x = (width - l1W * scale) / 2 + i * (bw + gap) * scale
        const w = bw * scale, h = bh * scale
        const kids = n.children
        const kw = Math.max(8, (w - (kids.length - 1) * 2) / Math.max(1, kids.length))
        return (
          <g key={n.unit.id}>
            <line x1={x + w / 2} y1={l1Y - 8} x2={x + w / 2} y2={l1Y} stroke="#9CA3AF" />
            <rect x={x} y={l1Y} width={w} height={h} rx={3} fill="#fff" stroke="#C7CDD8" />
            <text x={x + w / 2} y={l1Y + h / 2 + 3} textAnchor="middle" fill={OG.ink} fontSize={Math.max(5, fs * scale)}>{label(n).slice(0, 12)} {countOf(n)}</text>
            {kids.length > 0 && l2Y + 12 < height && kids.slice(0, 8).map((k, j) => (
              <rect key={k.unit.id} x={x + j * (kw + 2)} y={l2Y} width={Math.min(kw, w)} height={compact ? 6 : 10} rx={2} fill="#fff" stroke={OG.lineSoft} />
            ))}
          </g>
        )
      })}
    </svg>
  )
}
