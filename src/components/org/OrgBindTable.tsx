/**
 * OrgBindTable.tsx — ② 단위 바인드 화면 (설계서 §15.4 B1·B2·B3, §15.5 W2, 2026-10-02 확정)
 *  - [2026-10-02 ORG 8-B] 신규. 표 한 장: 새 단위(트리 순) | 이전(기준) 조직도 단위 → 승계 인원 | Azure 부서(일치/불일치) | 단위장 포지션 | 상태(확인 필요/확인됨)
 *    자동 매칭(org_bind_suggest) 제안은 칩으로 — 클릭하면 적용. 셀 편집은 즉시 저장(org_bind_apply, 되돌리기 1단계). '자동 매칭 다시 실행' = 미연결 행 일괄
 *    하단: 승계 인원 합계 · 미승계 단위(이전 조직도에만 있음) · 이전 조직도에만 있는 인원(③ 인원 풀로) · Azure 프로필 미배치
 *  - [2026-10-02 ORG 8-C] 하단 '③ 인원 배치 →' 활성(onNext)
 */
import { useMemo, useState } from 'react'
import type { AppUser, OrgCard, OrgFile, OrgFileSummary, OrgJob, OrgRosterCheck, OrgUnit } from '../../types'
import type { OrgBindItem, OrgBindSuggestion, OrgUndoPeek } from '../../lib/orgApi'
import { buildUnitTree, type OrgUnitNode } from '../../utils/orgStatus'
import { OG, btn, btnPri, btnDisabled } from './orgShared'
import { OrgStepHeader, stepShell, type StepHeaderProps } from './OrgStepHeader'

export interface BindRow { u: OrgUnit; depth: number; loose: boolean; prevUnit: OrgUnit | null; inherit: number; effDiv: string | null; match: number; mismatch: number; parentMismatch: boolean; sugg: OrgBindSuggestion | null; isNew: boolean; noHead: boolean; needs: boolean; checked: boolean }
interface Props extends Omit<StepHeaderProps, 'file' | 'stepper'> {
  file:        OrgFile
  units:       OrgUnit[]
  cards:       OrgCard[]
  users:       AppUser[]
  jobs:        OrgJob[]
  files:       OrgFileSummary[]
  baseFileId:  string | null
  onBaseChange: (id: string | null) => void
  base:        { units: OrgUnit[]; cards: OrgCard[] } | null
  suggestions: OrgBindSuggestion[] | null
  busy:        boolean
  roster:      OrgRosterCheck | null
  undo:        OrgUndoPeek | null
  stepper:     React.ReactNode
  onApply:     (items: OrgBindItem[]) => Promise<void>
  onAutoMatch: () => void
  onNext:      () => void   // [8-C] ③ 인원 배치로
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase()

export function OrgBindTable(p: Props) {
  const { units, cards, users, jobs, base, suggestions, editable } = p
  const [onlyNeeds, setOnlyNeeds] = useState(false)
  const [q, setQ] = useState('')
  const [divDraft, setDivDraft] = useState<Record<string, string>>({})
  const userDept = useMemo(() => new Map(users.map(u => [u.user_id, u.dept ?? ''])), [users])
  const userIds = useMemo(() => new Set(users.map(u => u.user_id)), [users])
  const byId = useMemo(() => new Map(units.map(u => [u.id, u])), [units])
  const baseById = useMemo(() => new Map((base?.units ?? []).map(u => [u.id, u])), [base])
  const suggById = useMemo(() => new Map((suggestions ?? []).map(s => [s.unit_id, s])), [suggestions])

  // 기준 파일 단위별 승계 인원(본 카드·공석/숨김 제외·재직 프로필만)
  const inheritOf = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of base?.cards ?? []) if (c.is_primary !== false && !c.is_vacancy && !c.hidden_at && c.profile_id && userIds.has(c.profile_id)) { if (!m.has(c.unit_id)) m.set(c.unit_id, new Set()); m.get(c.unit_id)!.add(c.profile_id) }
    return m
  }, [base, userIds])
  // 이 파일: 단위별 하위 포함 인원(프로필 있는 본 카드)
  const subtreePeople = useMemo(() => {
    const kids = new Map<string | null, OrgUnit[]>(); for (const u of units) { const k = u.parent_unit_id ?? null; if (!kids.has(k)) kids.set(k, []); kids.get(k)!.push(u) }
    const own = new Map<string, string[]>(); for (const c of cards) if (c.is_primary !== false && !c.is_vacancy && !c.hidden_at && c.profile_id) { if (!own.has(c.unit_id)) own.set(c.unit_id, []); own.get(c.unit_id)!.push(c.profile_id) }
    const out = new Map<string, string[]>()
    const walk = (id: string): string[] => { const acc = [...(own.get(id) ?? [])]; for (const k of kids.get(id) ?? []) acc.push(...walk(k.id)); out.set(id, acc); return acc }
    for (const u of units) if (!u.parent_unit_id) walk(u.id)
    return out
  }, [units, cards])
  const effDivOf = (u: OrgUnit): string | null => { let cur: OrgUnit | undefined = u; while (cur) { if (cur.azure_division) return cur.azure_division; cur = cur.parent_unit_id ? byId.get(cur.parent_unit_id) : undefined } return null }

  const rows = useMemo<BindRow[]>(() => {
    const roots = buildUnitTree(units); const bench = roots.find(r => r.unit.kind === 'bench')
    const out: BindRow[] = []
    const walk = (n: OrgUnitNode, depth: number, loose: boolean) => {
      const u = n.unit
      const prevUnit = u.prev_unit_id ? baseById.get(u.prev_unit_id) ?? null : null
      const eff = effDivOf(u); const people = subtreePeople.get(u.id) ?? []
      const match = eff ? people.filter(pid => norm(userDept.get(pid)) === norm(eff)).length : 0
      const mismatch = eff ? people.length - match : 0
      const parentEff = u.parent_unit_id ? effDivOf(byId.get(u.parent_unit_id)!) : null
      const parentMismatch = !!(u.azure_division && parentEff && norm(u.azure_division) !== norm(parentEff))
      const isNew = !u.prev_unit_id, noHead = !u.head_job_id, checked = !!u.bind_checked_at
      out.push({ u, depth, loose, prevUnit, inherit: u.prev_unit_id ? (inheritOf.get(u.prev_unit_id)?.size ?? 0) : 0, effDiv: eff, match, mismatch, parentMismatch, sugg: suggById.get(u.id) ?? null, isNew, noHead, needs: (isNew || mismatch > 0 || parentMismatch) && !checked, checked })   // 포지션 미정은 안내만(확인 필요 아님)
      n.children.forEach(c => walk(c, depth + 1, loose))
    }
    roots.filter(r => r.unit.kind !== 'bench').forEach(r => walk(r, 0, false))
    ;(bench?.children ?? []).forEach(r => walk(r, 0, true))
    return out
  }, [units, baseById, subtreePeople, userDept, inheritOf, suggById])   // eslint-disable-line react-hooks/exhaustive-deps

  const baseOpts = useMemo(() => {
    if (!base) return [] as { value: string; label: string }[]
    const opts: { value: string; label: string }[] = []
    const roots = buildUnitTree(base.units)
    const walk = (n: OrgUnitNode, depth: number) => { opts.push({ value: n.unit.id, label: `${'  '.repeat(depth)}${n.unit.name}${n.unit.code && n.unit.code !== 'ROOT' ? ` · ${n.unit.code}` : ''} (${inheritOf.get(n.unit.id)?.size ?? 0})` }); n.children.forEach(c => walk(c, depth + 1)) }
    roots.filter(r => r.unit.kind !== 'bench').forEach(r => walk(r, 0)); (roots.find(r => r.unit.kind === 'bench')?.children ?? []).forEach(r => walk(r, 0))
    return opts
  }, [base, inheritOf])

  // 집계
  const boundPrev = useMemo(() => new Set(units.map(u => u.prev_unit_id).filter((x): x is string => !!x)), [units])
  const inheritTotal = useMemo(() => { const s = new Set<string>(); for (const id of boundPrev) for (const pid of inheritOf.get(id) ?? []) s.add(pid); return s.size }, [boundPrev, inheritOf])
  const unboundBase = useMemo(() => (base?.units ?? []).filter(u => u.kind !== 'bench' && !boundPrev.has(u.id)), [base, boundPrev])
  const onlyInBasePeople = useMemo(() => { const s = new Set<string>(); for (const u of unboundBase) for (const pid of inheritOf.get(u.id) ?? []) s.add(pid); return s.size }, [unboundBase, inheritOf])
  const needsCount = rows.filter(r => r.needs).length, autoCount = rows.filter(r => r.u.prev_unit_id).length
  const visible = rows.filter(r => (!onlyNeeds || r.needs) && (!q.trim() || r.u.name.toLowerCase().includes(q.trim().toLowerCase()) || (r.u.code ?? '').toLowerCase().includes(q.trim().toLowerCase())))
  const autoApplicable = rows.filter(r => r.sugg && ((!r.u.prev_unit_id && r.sugg.prev_unit_id) || (!r.u.azure_division && r.sugg.suggested_division) || (!r.u.head_job_id && r.sugg.suggested_head_job_id))).length

  const apply = (item: OrgBindItem) => { if (editable && !p.busy) void p.onApply([item]) }
  const chip = (label: string, kind: 'ok' | 'warn' | 'red' | 'blue' | 'neutral' = 'neutral', title?: string, onClick?: () => void): React.ReactNode => {
    const c = kind === 'ok' ? { background: '#ECFDF5', color: '#047857', borderColor: '#A7F3D0' } : kind === 'warn' ? { background: '#FFFBEB', color: '#B45309', borderColor: '#FDE68A' } : kind === 'red' ? { background: '#FEF2F2', color: '#B91C1C', borderColor: '#FECACA' } : kind === 'blue' ? { background: '#EFF6FF', color: '#1D4ED8', borderColor: '#BFDBFE' } : { background: '#fff', color: OG.quiet, borderColor: OG.line }
    return <span onClick={onClick} title={title} style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 999, border: '1px solid', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', ...c }}>{label}</span>
  }
  const sel = (value: string, opts: { value: string; label: string }[], onChange: (v: string) => void, title?: string) => (
    <select value={value} disabled={!editable || p.busy} onChange={e => onChange(e.target.value)} title={title} style={{ ...cell, maxWidth: 260 }}>{opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  )
  const jobOpts = [{ value: '', label: '— 포지션 미정' }, ...jobs.filter(j => j.is_active).map(j => ({ value: j.id, label: `${j.code} — ${j.label}` }))]

  return (
    <div style={stepShell}>
      <OrgStepHeader file={p.file} editable={editable} isSuper={p.isSuper} lockHolder={p.lockHolder} savedAt={p.savedAt} undo={p.undo} roster={p.roster} stepper={p.stepper}
                     onBack={p.onBack} onEditMeta={p.onEditMeta} onRoster={p.onRoster} onHistory={p.onHistory} onExport={p.onExport} onCopy={p.onCopy} onActivate={p.onActivate} onUndo={p.onUndo} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', margin: 12, background: '#fff', border: `1px solid ${OG.line}`, borderRadius: 10, overflow: 'hidden' }}>
        {/* 툴바 */}
        <div style={{ padding: '8px 12px', borderBottom: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 13 }}>단위 바인드</b>
          <span style={{ fontSize: 11, color: OG.quiet }}>{rows.length} 단위 · 연결 {autoCount} · <span style={{ color: needsCount ? OG.amber : OG.quiet }}>확인 필요 {needsCount}</span></span>
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 11.5, color: OG.quiet, display: 'flex', alignItems: 'center', gap: 6 }}>기준:
            <select value={p.baseFileId ?? ''} onChange={e => p.onBaseChange(e.target.value || null)} style={{ ...cell, width: 'auto' }}>
              <option value="">(기준 조직도 선택)</option>
              {p.files.filter(f => f.id !== p.file.id).map(f => <option key={f.id} value={f.id}>{f.name}{f.status === 'active' ? ' (활성)' : f.status === 'archived' ? ' (지난)' : ''}</option>)}
            </select>
          </label>
          <button style={{ ...btn, color: OG.drop, borderColor: '#BFDBFE', background: '#EFF6FF', ...((!editable || !suggestions || autoApplicable === 0 || p.busy) ? btnDisabled : {}) }} disabled={!editable || !suggestions || autoApplicable === 0 || p.busy} onClick={p.onAutoMatch}
                  title="미연결 단위에 제안(약칭 → 이름 경로 → 이름)을 한 번에 적용 — 되돌리기 1단계">자동 매칭 적용{autoApplicable ? ` (${autoApplicable})` : ''}</button>
          <button style={{ ...btn, ...(onlyNeeds ? { background: OG.ink, color: '#fff', borderColor: OG.ink } : {}) }} onClick={() => setOnlyNeeds(v => !v)}>확인 필요만</button>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 단위" style={{ ...cell, width: 140 }} />
        </div>
        {!p.baseFileId && <div style={{ padding: 16, fontSize: 12.5, color: OG.quiet }}>기준(이전) 조직도를 선택하면 승계 매칭을 제안합니다. 활성 조직도를 복사해 만든 초안은 이미 전부 연결돼 있습니다.</div>}
        {/* 표 */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ position: 'sticky', top: 0, background: '#FAFAFA', zIndex: 1 }}>
              <tr>{['새 단위 (트리 순)', '이전 조직도 단위 → 승계 인원', 'Azure 부서 (profiles.dept)', '단위장 포지션', '상태'].map((h, i) => <th key={h} style={{ ...th, width: [280, 320, 300, 230, undefined][i] }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const u = r.u, s = r.sugg
                const div = divDraft[u.id] ?? (u.azure_division ?? '')
                return (
                  <tr key={u.id} style={{ background: r.needs ? '#FFFDF5' : 'transparent' }}>
                    <td style={{ ...td, paddingLeft: 10 + r.depth * 14 }}>
                      <span style={{ fontWeight: r.depth === 0 ? 600 : 400, color: r.loose ? OG.quiet : OG.ink, borderBottom: r.loose ? `1px dashed ${OG.faint}` : 'none' }}>{u.name}</span>
                      {u.unit_type && <span style={{ fontSize: 10, color: OG.quiet, border: `1px solid ${OG.lineSoft}`, borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>{u.unit_type}</span>}
                      {r.isNew && !r.loose && <span style={{ marginLeft: 6 }}>{chip('신설', 'blue', '승계할 이전 단위가 없음')}</span>}
                      {r.loose && <span style={{ marginLeft: 6 }}>{chip('연결 안 됨', 'warn', '상위 선이 끊긴 단위 — ① 구조 설계에서 붙이세요')}</span>}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {sel(u.prev_unit_id ?? '', [{ value: '', label: '(없음 — 신설)' }, ...baseOpts], v => apply({ unit_id: u.id, prev_unit_id: v || null }), '이 단위가 이어받는 이전 조직도 단위 — ③ 인원 배치에서 승계 자동 제안')}
                        {u.prev_unit_id ? <span style={{ fontSize: 11.5, color: OG.quiet, whiteSpace: 'nowrap' }}>· 승계 <b style={{ color: OG.ink }}>{r.inherit}</b>명</span> : null}
                        {!u.prev_unit_id && s?.prev_unit_id && baseById.get(s.prev_unit_id) && chip(`제안: ${baseById.get(s.prev_unit_id)!.name} (${s.method === 'code' ? '약칭' : s.method === 'path' ? '경로' : '이름'} 일치 · ${inheritOf.get(s.prev_unit_id)?.size ?? 0}명)`, 'blue', '클릭하면 적용', editable ? () => apply({ unit_id: u.id, prev_unit_id: s.prev_unit_id }) : undefined)}
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <input value={div} disabled={!editable || p.busy} placeholder={r.effDiv ? `(상속: ${r.effDiv})` : '예: CO'} list="org-dept-list"
                               onChange={e => setDivDraft(d => ({ ...d, [u.id]: e.target.value }))}
                               onBlur={() => { const v = div.trim(); setDivDraft(d => { const n = { ...d }; delete n[u.id]; return n }); if (v !== (u.azure_division ?? '')) apply({ unit_id: u.id, azure_division: v || null }) }}
                               onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} style={{ ...cell, width: 120 }} />
                        {r.effDiv && (r.match + r.mismatch > 0) && <>{chip(`일치 ${r.match}`, 'ok')}{r.mismatch > 0 && chip(`불일치 ${r.mismatch}`, 'warn', '하위 포함 인원 중 profiles.dept 가 다른 사람 수')}</>}
                        {r.parentMismatch && chip('상위와 불일치', 'warn', '상위 단위의 Azure 부서와 다름 — 이동한 단위면 정상, 아니면 확인')}
                        {!u.azure_division && s?.suggested_division && chip(`제안: ${s.suggested_division} (${s.division_n}명)`, 'blue', '하위 포함 인원의 최빈 부서 — 클릭하면 적용', editable ? () => apply({ unit_id: u.id, azure_division: s.suggested_division }) : undefined)}
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {sel(u.head_job_id ?? '', jobOpts, v => apply({ unit_id: u.id, head_job_id: v || null }))}
                        {!u.head_job_id && s?.suggested_head_job_id && jobs.find(j => j.id === s.suggested_head_job_id) && chip(`제안: ${jobs.find(j => j.id === s.suggested_head_job_id)!.code}`, 'blue', '현재/이전 단위장 카드의 대표 직무 — 클릭하면 적용', editable ? () => apply({ unit_id: u.id, head_job_id: s.suggested_head_job_id }) : undefined)}
                        {!u.head_job_id && !s?.suggested_head_job_id && chip('미정', 'neutral', '단위장 포지션 직무 — ③ 인원 배치·④ 검토에서 공석 표시에 쓰임')}
                      </div>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {r.checked ? chip('확인됨', 'ok') : r.needs ? chip('확인 필요', 'warn') : chip(u.prev_unit_id ? '연결' : '—', 'neutral')}
                        {editable && <label style={{ fontSize: 11, color: OG.quiet, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={r.checked} disabled={p.busy} onChange={e => apply({ unit_id: u.id, checked: e.target.checked })} /> 확인</label>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {visible.length === 0 && <tr><td colSpan={5} style={{ ...td, color: OG.faint, textAlign: 'center', padding: 24 }}>{onlyNeeds ? '확인 필요한 단위가 없습니다.' : '단위가 없습니다.'}</td></tr>}
            </tbody>
          </table>
          <datalist id="org-dept-list">{[...new Set(users.map(u => u.dept).filter(Boolean))].sort().map(d => <option key={d} value={d!} />)}</datalist>
        </div>
        {/* 하단 집계 */}
        <div style={{ padding: '8px 12px', borderTop: `1px solid ${OG.lineSoft}`, background: '#FAFAFA', display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: OG.quiet, flexWrap: 'wrap' }}>
          <span>승계 인원 합계 <b style={{ color: OG.ink }}>{inheritTotal}</b></span>
          <span title={unboundBase.slice(0, 20).map(u => u.name).join(', ')}>미승계 단위(이전 조직도에만) <b style={{ color: unboundBase.length ? OG.amber : OG.ink }}>{unboundBase.length}</b></span>
          <span>이전 조직도에만 있는 인원 <b style={{ color: onlyInBasePeople ? OG.amber : OG.ink }}>{onlyInBasePeople}</b> → ③ 인원 풀로</span>
          <span>Azure 프로필 미배치 <b style={{ color: p.roster?.missing_count ? OG.amber : OG.ink }}>{p.roster?.missing_count ?? '–'}</b></span>
          <span style={{ flex: 1 }} />
          <button style={btnPri} onClick={p.onNext} title="③ 인원 배치 — 승계·Azure 부서 기준으로 미배치 인원을 단위에 배치">③ 인원 배치 →</button>
        </div>
      </div>
    </div>
  )
}
const th: React.CSSProperties = { fontWeight: 600, color: OG.quiet, textAlign: 'left', padding: '7px 10px', borderBottom: `1px solid ${OG.lineSoft}`, fontSize: 11, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '5px 10px', borderBottom: `1px solid #F3F4F6`, verticalAlign: 'middle' }
const cell: React.CSSProperties = { fontFamily: OG.font, fontSize: 12, padding: '4px 7px', border: `1px solid ${OG.line}`, borderRadius: 6, background: '#fff', color: OG.ink, width: '100%', boxSizing: 'border-box' }
