/**
 * OrgUnitDetail.tsx — ① 구조 설계 우측 '단위 상세' 패널 — 설계서 §15.5 W1
 *  - [2026-10-02 ORG 8-A] 신규. 이름·약칭·유형·상위 단위(검색 선택 = 드래그 없이 이동)·순서·단위장 포지션·현재 단위장(읽기)·바인드 요약(읽기)·하위 구성·인원·메모
 *    텍스트는 blur 시, 선택은 즉시 저장(모두 되돌리기 가능). 포커스 중인 필드는 외부 갱신(되돌리기 등)으로 덮어쓰지 않음
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { OrgJob, OrgUnit } from '../../types'
import type { OrgUnitPatch } from '../../lib/orgApi'
import { descendantIds } from '../../utils/orgStatus'
import { OG, ORG_UNIT_TYPES, btn, btnDanger } from './orgShared'

interface Props {
  unit:       OrgUnit | null
  units:      OrgUnit[]
  jobs:       OrgJob[]
  benchId:    string | null
  editable:   boolean
  headLabel:  string | null                      // 현재 단위장 카드 표시(이름 · 직급), 없으면 null
  people:     { total: number; own: number; concurrent: number; vacancies: number }
  baseFileName: string | null                    // 바인드 기준(활성 조직도) — 8-B 전까지 읽기 전용 안내
  onPatch:    (patch: OrgUnitPatch) => Promise<void>
  onPlace:    (parentId: string | null, index: number | null) => Promise<void>
  onAddChild: () => void
  onDuplicate: () => void
  onMerge:    () => void
  onDelete:   () => void
  onOpenCanvas: () => void
}

export function OrgUnitDetail(p: Props) {
  const { unit, units, jobs, benchId, editable } = p
  const [form, setForm] = useState({ name: '', code: '', azure_division: '', memo: '' })
  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (!unit) return
    setForm(f => {
      const next = { name: unit.name, code: unit.code ?? '', azure_division: unit.azure_division ?? '', memo: unit.memo ?? '' }
      if (focused.current) (next as any)[focused.current] = (f as any)[focused.current]   // 입력 중 필드는 유지
      return next
    })
  }, [unit])

  const siblings = useMemo(() => unit ? units.filter(u => u.parent_unit_id === unit.parent_unit_id && u.kind !== 'bench').sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko')) : [], [unit, units])
  const idx = unit ? siblings.findIndex(u => u.id === unit.id) : -1
  const children = useMemo(() => unit ? units.filter(u => u.parent_unit_id === unit.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko')) : [], [unit, units])
  const parent = unit?.parent_unit_id ? units.find(u => u.id === unit.parent_unit_id) ?? null : null
  const isLoose = !!unit && unit.parent_unit_id === benchId
  // 상위 단위 선택지(들여쓰기 트리) — 자기·하위 제외. 보류(연결 안 됨) 와 최상위도 선택 가능
  const parentOpts = useMemo(() => {
    if (!unit) return []
    const ex = new Set([unit.id, ...descendantIds(unit.id, units)])
    const opts: { value: string; label: string }[] = [{ value: '', label: '(최상위 — 상위 없음)' }]
    const walk = (pid: string | null, depth: number) => units.filter(x => x.parent_unit_id === pid && x.kind !== 'bench').sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'))
      .forEach(x => { if (ex.has(x.id)) return; opts.push({ value: x.id, label: `${'  '.repeat(depth)}${x.name}${x.unit_type ? ` · ${x.unit_type}` : ''}` }); walk(x.id, depth + 1) })
    walk(null, 0)
    if (benchId) opts.push({ value: benchId, label: '⚡ 연결 안 됨 (상위 선 끊기)' })
    return opts
  }, [unit, units, benchId])

  if (!unit) return (
    <div style={{ padding: 24, fontSize: 12.5, color: OG.quiet, fontFamily: OG.font, lineHeight: 1.7 }}>
      왼쪽 아웃라이너에서 단위를 선택하면 상세가 여기에 표시됩니다.<br />
      <span style={{ color: OG.faint }}>↑↓ 이동 · F2 이름 · Enter 새 형제 · ⇧Enter 새 하위 · Tab/⇧Tab 들여·내어쓰기 · ⌥↑↓ 순서 · ⌘D 복제 · Del 삭제</span>
    </div>
  )

  const commitText = (k: 'name' | 'code' | 'azure_division' | 'memo') => {
    focused.current = null
    const v = form[k].trim()
    const cur = (k === 'name' ? unit.name : k === 'code' ? unit.code : k === 'azure_division' ? unit.azure_division : unit.memo) ?? ''
    if (k === 'name' && !v) { setForm(f => ({ ...f, name: unit.name })); return }
    if (v !== cur) p.onPatch({ [k]: k === 'name' ? v : (v || null) } as OrgUnitPatch)
  }
  const inp = (k: 'name' | 'code' | 'azure_division', placeholder?: string) => (
    <input value={form[k]} disabled={!editable} placeholder={placeholder} onFocus={() => { focused.current = k }} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} onBlur={() => commitText(k)}
           onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setForm(f => ({ ...f, [k]: (k === 'name' ? unit.name : k === 'code' ? unit.code : unit.azure_division) ?? '' })); focused.current = null } }}
           style={input} />
  )
  const sel = (value: string, opts: { value: string; label: string }[], onChange: (v: string) => void) => (
    <select value={value} disabled={!editable} onChange={e => onChange(e.target.value)} style={input}>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  )
  const headJob = unit.head_job_id ? jobs.find(j => j.id === unit.head_job_id) : null
  const byType = children.reduce<Record<string, number>>((m, c) => { const k = c.unit_type ?? '유형 없음'; m[k] = (m[k] ?? 0) + 1; return m }, {})

  return (
    <div style={{ fontFamily: OG.font, fontSize: 12.5, color: OG.ink, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 6 }}>
        <b style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>단위 상세 — {unit.name}</b>
        {editable && <>
          <button style={small} onClick={p.onAddChild} title="이 단위 아래에 새 단위 (⇧Enter)">+ 하위 단위</button>
          <button style={small} onClick={p.onDuplicate} title="같은 층 바로 뒤에 복제 — 하위·카드 제외 (⌘D)">복제</button>
          <button style={small} onClick={p.onMerge} title="이 단위의 카드·하위를 다른 단위로 합치고 이 단위는 삭제">합치기…</button>
          <button style={{ ...small, ...btnDanger }} onClick={p.onDelete} title="하위 단위가 없을 때만. 카드는 보류 카드로 (Del)">삭제</button>
        </>}
      </div>
      <div style={{ overflow: 'auto', flex: 1 }}>
        <Row label="이름">{inp('name')}</Row>
        <Row label="약칭(code)">{inp('code', '파일 안에서 유일 · 버전 간 같은 단위 식별(바인드)')}</Row>
        <Row label="유형">{sel(unit.unit_type ?? '', [{ value: '', label: '(없음)' }, ...ORG_UNIT_TYPES.map(t => ({ value: t, label: t }))], v => p.onPatch({ unit_type: v || null }))}</Row>
        <Row label="상위 단위">{sel(isLoose ? (benchId ?? '') : (unit.parent_unit_id ?? ''), parentOpts, v => { const target = v || null; if (target !== unit.parent_unit_id) p.onPlace(target, null) })}
          <div style={help}>드래그 대신 여기서 선택 — 멀리 떨어진 단위로도 바로 이동(하위·카드 함께). 선택한 단위의 하위 끝으로 들어갑니다</div></Row>
        <Row label="순서">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...input, flex: 'none', width: 'auto', background: '#F9FAFB', color: OG.quiet }}>{idx + 1} / {siblings.length}{idx > 0 ? ` (${siblings[idx - 1].name} 다음)` : ''}</span>
            <button style={small} disabled={!editable || idx <= 0} onClick={() => p.onPlace(unit.parent_unit_id, idx - 1)} title="⌥↑">▲</button>
            <button style={small} disabled={!editable || idx < 0 || idx >= siblings.length - 1} onClick={() => p.onPlace(unit.parent_unit_id, idx + 1)} title="⌥↓">▼</button>
          </div>
        </Row>
        <Sec>단위장 포지션</Sec>
        <Row label="포지션 직무">{sel(unit.head_job_id ?? '', [{ value: '', label: '(미정)' }, ...jobs.filter(j => j.is_active || j.id === unit.head_job_id).map(j => ({ value: j.id, label: `${j.code} — ${j.label}` }))], v => p.onPatch({ head_job_id: v || null }))}
          <div style={help}>이 자리의 직무(사람과 무관). 단위장 카드가 없으면 ③ 인원 배치·④ 검토에서 '단위장 공석'으로 표시</div></Row>
        <Row label="현재 단위장"><div style={{ ...input, background: '#F9FAFB', color: p.headLabel ? OG.ink : OG.faint }}>{p.headLabel ?? (headJob ? `공석 — ${headJob.code}` : '없음')} <span style={{ color: OG.faint, fontSize: 11 }}>· 카드는 캔버스에서 변경</span></div></Row>
        <Sec>바인드 <span style={{ fontWeight: 400 }}>— ② 단위 바인드 화면에서 일괄 편집(준비 중)</span></Sec>
        <Row label="이전 조직도"><div style={{ ...input, background: '#F9FAFB', color: OG.faint }}>{p.baseFileName ? `${p.baseFileName} · 승계 매칭은 ②에서` : '활성 조직도 없음 — 첫 조직도'}</div></Row>
        <Row label="Azure 부서">{inp('azure_division', '예: CO — profiles.dept 와 교차검증 (하위는 상위 값 상속)')}</Row>
        <Sec>하위 구성</Sec>
        <Row label="하위 단위"><div style={{ ...input, background: '#F9FAFB', color: children.length ? OG.ink : OG.faint, whiteSpace: 'normal', lineHeight: 1.5 }}>
          {children.length ? <>{Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(' · ')} — {children.map(c => c.name).join(' · ')}</> : '없음'}</div></Row>
        <Row label="인원"><div style={{ ...input, background: '#F9FAFB' }}>
          {p.people.total}명 <span style={{ color: OG.quiet }}>(직속 {p.people.own} · 겸직 {p.people.concurrent} · 공석 {p.people.vacancies})</span>
          <span onClick={p.onOpenCanvas} style={{ color: OG.drop, cursor: 'pointer', marginLeft: 8 }}>캔버스에서 보기 →</span></div></Row>
        <Sec>메모</Sec>
        <div style={{ padding: '4px 12px 12px' }}>
          <textarea value={form.memo} disabled={!editable} placeholder="개편 사유, 참고…" onFocus={() => { focused.current = 'memo' }} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} onBlur={() => commitText('memo')}
                    style={{ ...input, minHeight: 64, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
        </div>
        <div style={{ padding: '0 12px 14px', fontSize: 11, color: OG.faint }}>{editable ? '각 필드는 즉시 저장되고 되돌리기(↶) 할 수 있습니다.' : '읽기 전용'}{parent ? ` · 상위: ${parent.kind === 'bench' ? '연결 안 됨' : parent.name}` : ''}</div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, padding: '5px 12px', alignItems: 'flex-start' }}><label style={{ width: 86, flex: 'none', color: OG.quiet, fontSize: 11.5, paddingTop: 7 }}>{label}</label><div style={{ flex: 1, minWidth: 0 }}>{children}</div></div>
}
function Sec({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '8px 12px 2px', fontSize: 11, color: OG.faint, letterSpacing: '.04em', borderTop: `1px solid #F3F4F6`, marginTop: 4 }}>{children}</div>
}
const input: React.CSSProperties = { fontFamily: OG.font, fontSize: 12.5, padding: '6px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.ink, width: '100%', boxSizing: 'border-box', display: 'block' }
const help: React.CSSProperties = { fontSize: 10.5, color: OG.faint, marginTop: 3, lineHeight: 1.4 }
const small: React.CSSProperties = { ...btn, fontSize: 11, padding: '3px 8px' }
