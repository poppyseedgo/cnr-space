/**
 * OrgMiniTree.tsx — 단위 트리 전체 미니 미리보기 (SVG, 단위만 · 실시간) — 설계서 §15.5 W1 우측
 *  - [2026-10-02 ORG 8-A] 신규. 노드 캔버스 autoLayout 과 같은 규칙(부모는 자식 중앙 위, 형제 sort_order 순) 을 작은 박스로.
 *    선택 단위 + 하위 강조, 클릭 = 아웃라이너 선택. 폭에 맞춰 축소(최소 0.3배, 그 아래는 가로 스크롤)
 *  - [2026-10-02 ORG 8-D] meta(unitId) → 박스 안 인원 수·증감(기준 조직도 대비) 표시 + 변경 단위 강조 (W6 '변경 강조')
 */
import { useMemo } from 'react'
import type { OrgUnit } from '../../types'
import { buildUnitTree, descendantIds, type OrgUnitNode } from '../../utils/orgStatus'
import { OG } from './orgShared'

const BW = 76, BH = 18, GX = 6, GY = 22

interface Box { id: string; name: string; x: number; y: number; depth: number; parent: string | null; loose: boolean }

export interface OrgMiniMeta { count: number; delta: number }
export function OrgMiniTree({ units, selected, width, height, onSelect, meta }: { units: OrgUnit[]; selected: string | null; width: number; height: number; onSelect: (id: string) => void; meta?: (unitId: string) => OrgMiniMeta | null }) {
  const { boxes, w, h } = useMemo(() => {
    const roots = buildUnitTree(units)
    const bench = roots.find(r => r.unit.kind === 'bench')
    const main = roots.filter(r => r.unit.kind !== 'bench')
    const boxes: Box[] = []
    // 서브트리 폭(리프 수 기준) → x 배치
    const leafW = new Map<string, number>()
    const measure = (n: OrgUnitNode): number => { const w = n.children.length ? n.children.reduce((s, c) => s + measure(c), 0) : 1; leafW.set(n.unit.id, w); return w }
    const place = (n: OrgUnitNode, x0: number, depth: number, loose: boolean) => {
      const w = leafW.get(n.unit.id)! * (BW + GX)
      boxes.push({ id: n.unit.id, name: n.unit.name, x: x0 + w / 2 - BW / 2, y: depth * (BH + GY), depth, parent: n.unit.parent_unit_id, loose })
      let cx = x0
      for (const c of n.children) { place(c, cx, depth + 1, loose); cx += leafW.get(c.unit.id)! * (BW + GX) }
    }
    let x = 0
    for (const r of main) { measure(r); place(r, x, 0, false); x += leafW.get(r.unit.id)! * (BW + GX) + GX * 4 }
    // 연결 안 된 단위(보류 하위)는 오른쪽에 점선으로
    for (const r of bench?.children ?? []) { measure(r); place(r, x, 0, true); x += leafW.get(r.unit.id)! * (BW + GX) + GX * 4 }
    const w = Math.max(1, x - GX * 4), h = Math.max(1, (Math.max(0, ...boxes.map(b => b.depth)) + 1) * (BH + GY) - GY)
    return { boxes, w, h }
  }, [units])
  const hl = useMemo(() => selected ? new Set([selected, ...descendantIds(selected, units)]) : new Set<string>(), [selected, units])
  const pad = 10
  const scale = Math.max(0.7, Math.min(1, (width - pad * 2) / w, (height - pad * 2) / h))   // 0.7배 아래로는 줄이지 않고 가로 스크롤(글자 가독성)
  const byId = new Map(boxes.map(b => [b.id, b]))
  const svgW = Math.max(width, w * scale + pad * 2), svgH = Math.max(height, h * scale + pad * 2)
  const ox = (svgW - w * scale) / 2, oy = pad

  if (boxes.length === 0) return <div style={{ padding: 16, fontSize: 12, color: OG.faint, fontFamily: OG.font }}>단위 없음</div>
  return (
    <div style={{ width, height, overflow: 'auto' }}>
      <svg width={svgW} height={svgH} fontFamily={OG.font} aria-label="단위 트리 미리보기">
        <g transform={`translate(${ox} ${oy}) scale(${scale})`}>
          <g fill="none" stroke="#9CA3AF" strokeWidth={1 / scale}>
            {boxes.map(b => { const p = b.parent ? byId.get(b.parent) : null; if (!p) return null
              const x1 = p.x + BW / 2, y1 = p.y + BH, x2 = b.x + BW / 2, y2 = b.y, ym = y1 + GY / 2
              return <path key={b.id} d={`M${x1} ${y1} V${ym} H${x2} V${y2}`} stroke={hl.has(b.id) && hl.has(p.id) ? OG.drop : '#9CA3AF'} /> })}
          </g>
          {boxes.map(b => {
            const on = hl.has(b.id), sel = b.id === selected
            const m = meta?.(b.id) ?? null, changed = !!m && m.delta !== 0
            const maxLen = m ? 8 : 12
            return (
              <g key={b.id} onClick={() => onSelect(b.id)} style={{ cursor: 'pointer' }}>
                <rect x={b.x} y={b.y} width={BW} height={BH} rx={3} fill={on ? '#EFF6FF' : changed ? '#FFFBEB' : '#fff'} stroke={on ? OG.drop : changed ? OG.amber : b.loose ? OG.faint : '#C7CDD8'} strokeWidth={sel ? 2 / scale : 1 / scale} strokeDasharray={b.loose ? '3 2' : undefined} />
                <text x={b.x + (m ? 3 : BW / 2)} y={b.y + BH / 2 + 3} textAnchor={m ? 'start' : 'middle'} fontSize={9} fill={on ? '#1D4ED8' : OG.ink}>{b.name.length > maxLen ? b.name.slice(0, maxLen - 1) + '…' : b.name}</text>
                {m && <text x={b.x + BW - 3} y={b.y + BH / 2 + 3} textAnchor="end" fontSize={8} fill={m.delta > 0 ? OG.green : m.delta < 0 ? OG.red : OG.quiet}>{m.count}{m.delta > 0 ? `↑${m.delta}` : m.delta < 0 ? `↓${-m.delta}` : ''}</text>}
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
