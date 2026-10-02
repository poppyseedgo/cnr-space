/**
 * OrgUnitPicker.tsx — 단위 피커(⌘K) — 검색 + ↑↓ Enter 로 멀리 있는 단위에도 즉시 배치 (설계서 §15.5 W3)
 *  - [2026-10-02 ORG 8-C] 신규. 이름·약칭·경로로 검색, 트리 순 정렬, 보류 영역은 '📥 보류 카드' 로 마지막
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrgUnit } from '../../types'
import { buildUnitTree, type OrgUnitNode } from '../../utils/orgStatus'
import { OG } from './orgShared'

interface Props { units: OrgUnit[]; title: string; countOf?: Map<string, number>; exclude?: Set<string>; onPick: (unitId: string) => void; onClose: () => void }

export function OrgUnitPicker({ units, title, countOf, exclude, onPick, onClose }: Props) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const all = useMemo(() => {
    const out: { id: string; name: string; path: string; code: string | null; bench: boolean }[] = []
    const walk = (n: OrgUnitNode, path: string[]) => { const p = [...path, n.unit.name]; out.push({ id: n.unit.id, name: n.unit.name, path: path.join(' › '), code: n.unit.code, bench: false }); n.children.forEach(c => walk(c, p)) }
    const roots = buildUnitTree(units)
    roots.filter(r => r.unit.kind !== 'bench').forEach(r => walk(r, []))
    const bench = roots.find(r => r.unit.kind === 'bench')
    if (bench) { bench.children.forEach(c => walk(c, ['연결 안 됨'])); out.push({ id: bench.unit.id, name: '📥 보류 카드', path: '', code: null, bench: true }) }
    return out.filter(x => !exclude?.has(x.id))
  }, [units, exclude])
  const hits = useMemo(() => { const s = q.trim().toLowerCase(); if (!s) return all; return all.filter(x => x.name.toLowerCase().includes(s) || (x.code ?? '').toLowerCase().includes(s) || x.path.toLowerCase().includes(s)) }, [all, q])
  useEffect(() => { setIdx(0) }, [q])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'nearest' }) }, [idx])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(hits.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[idx]; if (h) onPick(h.id) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 520, maxWidth: '92vw', fontFamily: OG.font, boxShadow: '0 12px 40px rgba(0,0,0,.18)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: `1px solid ${OG.lineSoft}`, fontSize: 12.5, fontWeight: 600 }}>{title}</div>
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="단위 이름 · 약칭 · 경로 검색 — ↑↓ 이동 · Enter 배치 · Esc 닫기"
               style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', border: 'none', borderBottom: `1px solid ${OG.lineSoft}`, fontSize: 13.5, fontFamily: OG.font, outline: 'none' }} />
        <div ref={listRef} style={{ maxHeight: 360, overflow: 'auto', padding: '6px 0' }}>
          {hits.map((h, i) => (
            <div key={h.id} data-i={i} onMouseEnter={() => setIdx(i)} onClick={() => onPick(h.id)}
                 style={{ padding: '6px 14px', cursor: 'pointer', background: i === idx ? '#EFF6FF' : 'transparent', display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5 }}>
              <span style={{ fontWeight: h.bench ? 600 : 500, color: h.bench ? OG.drop : OG.ink }}>{h.name}</span>
              {h.code && h.code !== 'ROOT' && <span style={{ fontSize: 11, color: OG.faint }}>{h.code}</span>}
              <span style={{ fontSize: 11, color: OG.faint, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.path}</span>
              {countOf && !h.bench && <span style={{ fontSize: 11, color: OG.faint }}>{countOf.get(h.id) ?? 0}명</span>}
            </div>
          ))}
          {hits.length === 0 && <div style={{ padding: 16, fontSize: 12, color: OG.faint }}>일치하는 단위가 없습니다.</div>}
        </div>
      </div>
    </div>
  )
}
