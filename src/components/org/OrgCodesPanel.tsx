/**
 * OrgCodesPanel.tsx — 코드 관리 (직급 · 직무 · 상태 코드 · 반납 템플릿)
 *  - [2026-10-01 ORG Phase 4-B] 신규 — 설계서 §5.3·§5.4·§5.5. 직접 쓰기(RLS org 전체 쓰기), 시스템 상태코드는 DB 트리거가 code·category 변경·삭제를 막는다
 *  행 단위 편집 → 저장 명시(코드 테이블은 오타 1개가 전 카드 정렬을 바꾼다). 삭제 대신 is_active=false 권장(카드가 참조 중이면 FK 로 실패)
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { OrgJob, OrgRank, OrgStatusCategory, OrgStatusType } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { loadOrgCodes, loadAllOffboardingTemplates, upsertOrgRank, upsertOrgJob, upsertOrgStatusType, deleteOrgStatusType, upsertOffboardingTemplate, type OrgOffboardingTemplate } from '../../lib/orgApi'
import { orgErrorMessage } from '../../utils/orgStatus'
import { OG, Tag, btn, btnPri, btnDanger, btnDisabled } from './orgShared'

type TabId = 'ranks' | 'jobs' | 'status' | 'templates'
const CATS: { id: OrgStatusCategory; label: string; hint: string }[] = [
  { id: 'hire_planned', label: '입사예정', hint: '입사 예정자 전용 · profiles 미반영' },
  { id: 'departing', label: '퇴사예정', hint: 'profiles departing + 퇴사일 · 반납 체크리스트' },
  { id: 'leave_planned', label: '휴직예정', hint: '시작일 도래 시 예정 종류로 자동 전환' },
  { id: 'leave', label: '휴직류', hint: 'profiles leave · 복귀 D-30 복직예정 자동' },
  { id: 'return_planned', label: '복직예정', hint: '복귀일 도래 시 복직(returned) 자동' },
]
interface Props {
  onClose:   () => void
  onChanged: () => void
  showToast: (m: string) => void
  /** 부모(OrgAdminPanel)가 이미 들고 있는 코드 — 첫 렌더를 빈 화면 없이 띄우기 위한 초기값. 반납 템플릿은 비활성 포함 전체를 다시 읽는다 */
  initial?:  { ranks: OrgRank[]; jobs: OrgJob[]; statusTypes: OrgStatusType[]; templates: OrgOffboardingTemplate[] }
}

const inp: CSSProperties = { padding: '5px 8px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 12.5, fontFamily: OG.font, boxSizing: 'border-box', width: '100%', background: '#fff' }
const th: CSSProperties = { textAlign: 'left', fontSize: 11, color: OG.quiet, fontWeight: 500, padding: '6px 8px', borderBottom: `1px solid ${OG.line}` }
const td: CSSProperties = { padding: '5px 8px', borderBottom: `1px solid ${OG.lineSoft}`, verticalAlign: 'middle' }

export function OrgCodesPanel({ onClose, onChanged, showToast, initial }: Props) {
  const [entered, setEntered] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  const [tab, setTab] = useState<TabId>('jobs')
  const [ranks, setRanks] = useState<OrgRank[]>(initial?.ranks ?? []); const [jobs, setJobs] = useState<OrgJob[]>(initial?.jobs ?? []); const [types, setTypes] = useState<OrgStatusType[]>(initial?.statusTypes ?? []); const [tpls, setTpls] = useState<OrgOffboardingTemplate[]>(initial?.templates ?? [])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<null | { title: string; message: string; run: () => Promise<void> }>(null)
  const reload = async () => { const [c, t] = await Promise.all([loadOrgCodes(), loadAllOffboardingTemplates()]); setRanks(c.ranks); setJobs(c.jobs); setTypes(c.statusTypes); setTpls(t) }
  useEffect(() => {
    if (initial) loadAllOffboardingTemplates().then(setTpls).catch(() => { /* 초기값(활성만) 유지 */ })
    else reload().catch(e => showToast(orgErrorMessage(e)))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<void>, ok: string) => { setBusy(true); try { await fn(); await reload(); onChanged(); showToast(ok) } catch (e) { showToast(orgErrorMessage(e, '저장에 실패했습니다. 카드가 참조 중인 코드는 삭제할 수 없습니다 — 비활성으로 두세요.')) } finally { setBusy(false) } }

  const tabs: { id: TabId; label: string; n: number }[] = [{ id: 'jobs', label: '직무', n: jobs.length }, { id: 'ranks', label: '직급', n: ranks.length }, { id: 'status', label: '상태 코드', n: types.length }, { id: 'templates', label: '반납 템플릿', n: tpls.length }]
  const s = q.trim().toLowerCase()

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="코드 관리"
             style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(860px, 100vw)', background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)', padding: '20px 24px 32px', overflowY: 'auto', fontFamily: OG.font, fontSize: 13, color: OG.ink, transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>코드 관리</h3>
            <span style={{ fontSize: 11.5, color: OG.quiet }}>변경은 모든 조직도 파일에 즉시 반영됩니다 (level = hierarchy 정렬 기준)</span>
            <span style={{ flex: 1 }} />
            {busy && <span style={{ fontSize: 11, color: OG.faint }}>저장 중…</span>}
            <button onClick={onClose} aria-label="닫기" style={{ ...btn, padding: '5px 7px' }}><X size={14} /></button>
          </div>
          <div style={{ display: 'flex', borderBottom: `1px solid ${OG.line}`, marginBottom: 12, alignItems: 'center' }}>
            {tabs.map(t => <div key={t.id} onClick={() => { setTab(t.id); setQ('') }} style={{ padding: '8px 14px', fontSize: 12.5, cursor: 'pointer', color: tab === t.id ? OG.ink : OG.quiet, fontWeight: tab === t.id ? 600 : 400, boxShadow: tab === t.id ? `inset 0 -2px ${OG.ink}` : 'none' }}>{t.label} <Tag>{t.n}</Tag></div>)}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="검색" style={{ ...inp, width: 180, marginLeft: 'auto' }} />
          </div>
          {tab === 'jobs'      && <JobsTab rows={jobs.filter(j => !s || j.code.toLowerCase().includes(s) || j.label.toLowerCase().includes(s) || j.aliases.some(a => a.toLowerCase().includes(s)))} busy={busy} onSave={j => run(async () => { await upsertOrgJob(j) }, '직무를 저장했습니다.')} />}
          {tab === 'ranks'     && <RanksTab rows={ranks.filter(r => !s || r.code.includes(s) || r.label.includes(s))} busy={busy} onSave={r => run(async () => { await upsertOrgRank(r) }, '직급을 저장했습니다.')} />}
          {tab === 'status'    && <StatusTab rows={types} busy={busy} onSave={(t, isNew) => run(async () => { await upsertOrgStatusType(t, isNew) }, '상태 코드를 저장했습니다.')}
                                      onDelete={t => setConfirm({ title: '상태 코드 삭제', message: `'${t.label}'(${t.code}) 를 삭제합니다. 이력이 참조 중이면 실패합니다 — 그 경우 비활성으로 두세요.`, run: async () => { await deleteOrgStatusType(t.code); await reload(); onChanged() } })} />}
          {tab === 'templates' && <TemplatesTab rows={tpls} busy={busy} onSave={t => run(async () => { await upsertOffboardingTemplate(t) }, '반납 템플릿을 저장했습니다.')} />}
        </div>
      </div>
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} variant="danger" confirmLabel="삭제" loading={busy} onConfirm={async () => { setBusy(true); try { await confirm.run(); setConfirm(null); showToast('삭제했습니다.') } catch (e) { showToast(orgErrorMessage(e, '삭제할 수 없습니다 — 이력이 참조 중입니다. 비활성으로 두세요.')) } finally { setBusy(false) } }} onClose={() => !busy && setConfirm(null)} />}
    </ModalPortal>
  )
}

/** 행 편집 공용 — draft 상태를 들고 '저장' 명시. 새 행은 맨 위 */
function useDraft<T extends { id?: string }>(rows: T[], empty: T) {
  const [drafts, setDrafts] = useState<Record<string, T>>({})
  const [adding, setAdding] = useState<T | null>(null)
  const key = (r: T) => r.id ?? ''
  const get = (r: T) => drafts[key(r)] ?? r
  const set = (r: T, patch: Partial<T>) => setDrafts(d => ({ ...d, [key(r)]: { ...get(r), ...patch } }))
  const dirty = (r: T) => JSON.stringify(get(r)) !== JSON.stringify(r)
  const reset = (r: T) => setDrafts(d => { const n = { ...d }; delete n[key(r)]; return n })
  useEffect(() => { setDrafts({}) }, [rows])
  return { get, set, dirty, reset, adding, setAdding, empty }
}

function JobsTab({ rows, busy, onSave }: { rows: OrgJob[]; busy: boolean; onSave: (j: OrgJob) => void }) {
  const d = useDraft<OrgJob>(rows, { id: '', code: '', label: '', level: 40, aliases: [], sort_order: 0, is_active: true } as OrgJob)
  const row = (r: OrgJob, isNew = false) => {
    const v = isNew ? d.adding! : d.get(r)
    const setv = (patch: Partial<OrgJob>) => isNew ? d.setAdding({ ...v, ...patch }) : d.set(r, patch)
    return (
      <tr key={isNew ? '__new' : r.id} style={{ background: isNew ? '#F0FDF4' : 'transparent', opacity: v.is_active ? 1 : .55 }}>
        <td style={{ ...td, width: 120 }}><input value={v.code} onChange={e => setv({ code: e.target.value })} style={inp} placeholder="약어" /></td>
        <td style={td}><input value={v.label} onChange={e => setv({ label: e.target.value })} style={inp} placeholder="표시명" /></td>
        <td style={{ ...td, width: 70 }}><input type="number" value={v.level} onChange={e => setv({ level: Number(e.target.value) })} style={inp} /></td>
        <td style={td}><input value={v.aliases.join(', ')} onChange={e => setv({ aliases: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} style={inp} placeholder="엑셀 표기 변형 (쉼표)" /></td>
        <td style={{ ...td, width: 60 }}><input type="number" value={v.sort_order} onChange={e => setv({ sort_order: Number(e.target.value) })} style={inp} /></td>
        <td style={{ ...td, width: 50, textAlign: 'center' }}><input type="checkbox" checked={v.is_active} onChange={e => setv({ is_active: e.target.checked })} /></td>
        <td style={{ ...td, width: 110, whiteSpace: 'nowrap' }}>
          {isNew ? <><button style={{ ...btnPri, ...(v.code && v.label ? {} : btnDisabled) }} disabled={busy || !v.code || !v.label} onClick={() => { onSave({ ...v, id: undefined as any }); d.setAdding(null) }}>추가</button> <button style={btn} onClick={() => d.setAdding(null)}>취소</button></>
                 : d.dirty(r) ? <><button style={btnPri} disabled={busy} onClick={() => onSave(v)}>저장</button> <button style={btn} onClick={() => d.reset(r)}>되돌리기</button></> : null}
        </td>
      </tr>)
  }
  return <>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 11.5, color: OG.quiet }}>level 안내 — 95 C-level · 80 Head · 70 Manager · 60 Principal · 50 Senior · 42 II · 41 I · 40 일반 · 10 인턴 (직급이 있으면 직급 level 이 우선)</span>
      <span style={{ flex: 1 }} />{!d.adding && <button style={btn} onClick={() => d.setAdding({ ...d.empty })}>+ 직무 추가</button>}
    </div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{['약어(code)', '표시명', 'level', '별칭', '순서', '활성', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{d.adding && row(d.adding, true)}{rows.map(r => row(r))}</tbody>
    </table>
  </>
}

function RanksTab({ rows, busy, onSave }: { rows: OrgRank[]; busy: boolean; onSave: (r: OrgRank) => void }) {
  const d = useDraft<OrgRank>(rows, { id: '', code: '', label: '', level: 0, sort_order: 0, is_active: true } as OrgRank)
  const row = (r: OrgRank, isNew = false) => {
    const v = isNew ? d.adding! : d.get(r)
    const setv = (patch: Partial<OrgRank>) => isNew ? d.setAdding({ ...v, ...patch }) : d.set(r, patch)
    return (
      <tr key={isNew ? '__new' : r.id} style={{ background: isNew ? '#F0FDF4' : 'transparent', opacity: v.is_active ? 1 : .55 }}>
        <td style={{ ...td, width: 160 }}><input value={v.code} onChange={e => setv({ code: e.target.value })} style={inp} placeholder="영문 코드" /></td>
        <td style={td}><input value={v.label} onChange={e => setv({ label: e.target.value })} style={inp} placeholder="직급명" /></td>
        <td style={{ ...td, width: 80 }}><input type="number" value={v.level} onChange={e => setv({ level: Number(e.target.value) })} style={inp} /></td>
        <td style={{ ...td, width: 70 }}><input type="number" value={v.sort_order} onChange={e => setv({ sort_order: Number(e.target.value) })} style={inp} /></td>
        <td style={{ ...td, width: 50, textAlign: 'center' }}><input type="checkbox" checked={v.is_active} onChange={e => setv({ is_active: e.target.checked })} /></td>
        <td style={{ ...td, width: 110, whiteSpace: 'nowrap' }}>
          {isNew ? <><button style={{ ...btnPri, ...(v.code && v.label ? {} : btnDisabled) }} disabled={busy || !v.code || !v.label} onClick={() => { onSave({ ...v, id: undefined as any }); d.setAdding(null) }}>추가</button> <button style={btn} onClick={() => d.setAdding(null)}>취소</button></>
                 : d.dirty(r) ? <><button style={btnPri} disabled={busy} onClick={() => onSave(v)}>저장</button> <button style={btn} onClick={() => d.reset(r)}>되돌리기</button></> : null}
        </td>
      </tr>)
  }
  return <>
    <div style={{ display: 'flex', marginBottom: 8 }}><span style={{ fontSize: 11.5, color: OG.quiet }}>직급은 임원 등 보유자만 지정 — level 이 클수록 위. 직급이 있는 카드는 직무 level 보다 항상 위에 정렬됩니다.</span><span style={{ flex: 1 }} />{!d.adding && <button style={btn} onClick={() => d.setAdding({ ...d.empty })}>+ 직급 추가</button>}</div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['코드', '직급명', 'level', '순서', '활성', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{d.adding && row(d.adding, true)}{rows.map(r => row(r))}</tbody></table>
  </>
}

function StatusTab({ rows, busy, onSave, onDelete }: { rows: OrgStatusType[]; busy: boolean; onSave: (t: OrgStatusType, isNew: boolean) => void; onDelete: (t: OrgStatusType) => void }) {
  const [drafts, setDrafts] = useState<Record<string, OrgStatusType>>({})
  const [adding, setAdding] = useState<OrgStatusType | null>(null)
  useEffect(() => setDrafts({}), [rows])
  const get = (r: OrgStatusType) => drafts[r.code] ?? r
  const dirty = (r: OrgStatusType) => JSON.stringify(get(r)) !== JSON.stringify(r)
  const row = (r: OrgStatusType, isNew = false) => {
    const v = isNew ? adding! : get(r)
    const setv = (patch: Partial<OrgStatusType>) => isNew ? setAdding({ ...v, ...patch }) : setDrafts(d => ({ ...d, [r.code]: { ...v, ...patch } }))
    return (
      <tr key={isNew ? '__new' : r.code} style={{ background: isNew ? '#F0FDF4' : 'transparent', opacity: v.is_active ? 1 : .55 }}>
        <td style={{ ...td, width: 150 }}>{isNew ? <input value={v.code} onChange={e => setv({ code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} style={inp} placeholder="영문 소문자_" /> : <code style={{ fontSize: 12 }}>{r.code}</code>}</td>
        <td style={td}><input value={v.label} onChange={e => setv({ label: e.target.value })} style={inp} /></td>
        <td style={{ ...td, width: 150 }}>{r.is_system && !isNew ? <span>{CATS.find(c => c.id === v.category)?.label}</span> : <select value={v.category} onChange={e => setv({ category: e.target.value as OrgStatusCategory })} style={inp}>{CATS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select>}</td>
        <td style={{ ...td, width: 70 }}><input type="number" value={v.sort_order} onChange={e => setv({ sort_order: Number(e.target.value) })} style={inp} /></td>
        <td style={{ ...td, width: 50, textAlign: 'center' }}><input type="checkbox" checked={v.is_active} onChange={e => setv({ is_active: e.target.checked })} /></td>
        <td style={{ ...td, width: 60 }}>{r.is_system && !isNew ? <Tag>시스템</Tag> : <Tag kind="draft">사용자</Tag>}</td>
        <td style={{ ...td, width: 150, whiteSpace: 'nowrap' }}>
          {isNew ? <><button style={{ ...btnPri, ...(v.code && v.label ? {} : btnDisabled) }} disabled={busy || !v.code || !v.label} onClick={() => { onSave(v, true); setAdding(null) }}>추가</button> <button style={btn} onClick={() => setAdding(null)}>취소</button></>
                 : <>{dirty(r) && <button style={btnPri} disabled={busy} onClick={() => onSave(v, false)}>저장</button>} {!r.is_system && <button style={btnDanger} disabled={busy} onClick={() => onDelete(r)}>삭제</button>}</>}
        </td>
      </tr>)
  }
  return <>
    <div style={{ fontSize: 11.5, color: OG.quiet, marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>{CATS.map(c => <span key={c.id}><b>{c.label}</b> — {c.hint}</span>)}</div>
    <div style={{ display: 'flex', marginBottom: 8 }}><span style={{ fontSize: 11.5, color: OG.quiet }}>시스템 7종은 code·분류 고정(삭제 불가). 새 코드는 분류를 골라야 동기화·자동 전환 규칙을 상속합니다.</span><span style={{ flex: 1 }} />{!adding && <button style={btn} onClick={() => setAdding({ code: '', label: '', category: 'leave', color: 'violet', sort_order: 100, is_system: false, is_active: true })}>+ 상태 코드 추가</button>}</div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['code', '표시명', '분류', '순서', '활성', '구분', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{adding && row(adding, true)}{rows.map(r => row(r))}</tbody></table>
  </>
}

function TemplatesTab({ rows, busy, onSave }: { rows: OrgOffboardingTemplate[]; busy: boolean; onSave: (t: OrgOffboardingTemplate) => void }) {
  const d = useDraft<OrgOffboardingTemplate>(rows, { id: '', label: '', is_conditional: false, is_critical: false, sort_order: 0, is_active: true } as OrgOffboardingTemplate)
  const row = (r: OrgOffboardingTemplate, isNew = false) => {
    const v = isNew ? d.adding! : d.get(r)
    const setv = (patch: Partial<OrgOffboardingTemplate>) => isNew ? d.setAdding({ ...v, ...patch }) : d.set(r, patch)
    return (
      <tr key={isNew ? '__new' : r.id} style={{ background: isNew ? '#F0FDF4' : 'transparent', opacity: v.is_active ? 1 : .55 }}>
        <td style={td}><input value={v.label} onChange={e => setv({ label: e.target.value })} style={inp} placeholder="반납 항목" /></td>
        <td style={{ ...td, width: 110, textAlign: 'center' }}><input type="checkbox" checked={v.is_conditional} onChange={e => setv({ is_conditional: e.target.checked })} /></td>
        <td style={{ ...td, width: 70, textAlign: 'center' }}><input type="checkbox" checked={v.is_critical} onChange={e => setv({ is_critical: e.target.checked })} /></td>
        <td style={{ ...td, width: 70 }}><input type="number" value={v.sort_order} onChange={e => setv({ sort_order: Number(e.target.value) })} style={inp} /></td>
        <td style={{ ...td, width: 50, textAlign: 'center' }}><input type="checkbox" checked={v.is_active} onChange={e => setv({ is_active: e.target.checked })} /></td>
        <td style={{ ...td, width: 110, whiteSpace: 'nowrap' }}>
          {isNew ? <><button style={{ ...btnPri, ...(v.label ? {} : btnDisabled) }} disabled={busy || !v.label} onClick={() => { onSave({ ...v, id: undefined as any }); d.setAdding(null) }}>추가</button> <button style={btn} onClick={() => d.setAdding(null)}>취소</button></>
                 : d.dirty(r) ? <><button style={btnPri} disabled={busy} onClick={() => onSave(v)}>저장</button> <button style={btn} onClick={() => d.reset(r)}>되돌리기</button></> : null}
        </td>
      </tr>)
  }
  return <>
    <div style={{ display: 'flex', marginBottom: 8 }}><span style={{ fontSize: 11.5, color: OG.quiet }}>퇴사예정 등록 시점에 활성 항목이 복제됩니다. 이미 등록된 체크리스트에는 소급되지 않습니다. 조건부 = 해당자만(등록 시 선택), 중요 = 미반납 시 빨강 강조.</span><span style={{ flex: 1 }} />{!d.adding && <button style={btn} onClick={() => d.setAdding({ ...d.empty, sort_order: (rows[rows.length - 1]?.sort_order ?? 0) + 10 })}>+ 항목 추가</button>}</div>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['항목', '조건부(해당자만)', '중요', '순서', '활성', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{d.adding && row(d.adding, true)}{rows.map(r => row(r))}</tbody></table>
  </>
}
