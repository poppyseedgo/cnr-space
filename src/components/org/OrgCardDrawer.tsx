/**
 * OrgCardDrawer.tsx — 드로어 C: 인사 카드 편집 (설계서 §6.3)
 *  - [2026-10-01 ORG Phase 4-A] 신규
 *  - [2026-10-01 ORG Phase 4-B] ④ 반납 체크리스트 아래 "시스템 잔여"(도서·자원·어드민 권한·회의실) — org_offboarding_system_check RPC
 *
 *  섹션(위→아래): ①프로필 헤더(live) ②배치(단위·직급·직무 복수·보고선·단위장·고용형태·근무지·FTE)
 *                 ③상태(활성 라벨 + 상태 변경 폼 — category 별 필수값) ④반납 체크리스트(퇴사예정일 때)
 *                 ⑤메모 ⑥이 사람의 변경 이력(접이식)
 *  저장: 필드 단위 즉시 저장(초안만). 부모가 updateOrgCard → 단건 재조회 → card prop 갱신 (낙관적 갱신 금지)
 *  상태 변경만 ConfirmDialog — profiles.employment_status 동기화(외부 영향) 때문
 *  Active·Archived 파일에서는 배치 섹션 읽기 전용, 상태 섹션은 사람 소속이라 편집 가능(org 역할)
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { AppUser, OrgCard, OrgJob, OrgOffboardingItem, OrgPersonStatus, OrgRank, OrgStatusType, OrgUnit, OrgEmploymentType } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { UserAvatar } from '../common/UserAvatar'
import { DateField } from '../common/DateField'
import { ConfirmDialog } from '../common/ConfirmDialog'
import {
  loadOffboardingItems, setOffboardingItem, loadOrgStatusHistory, loadOrgChangeLog, setOrgPersonStatus, endOrgPersonStatus,
  offboardingSystemCheck,   // ← [Phase 4-B]
  type OrgOffboardingTemplate, type OrgStatusPayload, type OrgChangeLogRow, type OrgSystemCheck,
} from '../../lib/orgApi'
import { ORG_EMPLOYMENT_TYPE_LABEL, orgErrorMessage, orgStatusBadge, type OrgPersonView } from '../../utils/orgStatus'
import { OG, Tag, btn, btnPri, btnDanger, btnDisabled, fmtWhen } from './orgShared'

export interface CardPatch {
  unit_id?: string; rank_id?: string | null; reports_to_card_id?: string | null; is_unit_head?: boolean
  employment_type?: OrgEmploymentType; work_location?: string | null; fte?: number; memo?: string | null; display_name?: string | null
}
interface Props {
  card:         OrgCard
  person:       OrgPersonView
  units:        OrgUnit[]
  cards:        OrgCard[]
  users:        AppUser[]
  ranks:        OrgRank[]
  jobs:         OrgJob[]
  statusTypes:  OrgStatusType[]
  templates:    OrgOffboardingTemplate[]
  status:       OrgPersonStatus | null
  editable:     boolean          // 배치 편집 가능(초안)
  currentUserId: string
  personName:   (c: OrgCard) => string
  onPatch:      (patch: CardPatch) => Promise<void>
  onSetJobs:    (jobIds: string[]) => Promise<void>
  onDelete:     () => void
  onStatusChanged: () => Promise<void>
  onClose:      () => void
  showToast:    (msg: string) => void
}

const row: CSSProperties = { display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: 10, minHeight: 32 }
const lab: CSSProperties = { fontSize: 11.5, color: OG.quiet }
const inp: CSSProperties = { width: '100%', padding: '6px 9px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 12.5, fontFamily: OG.font, boxSizing: 'border-box', background: '#fff' }
const sec = (t: string) => <div style={{ fontSize: 11, fontWeight: 700, color: OG.quiet, letterSpacing: 0.3, margin: '20px 0 8px', paddingBottom: 6, borderBottom: `1px solid ${OG.lineSoft}` }}>{t}</div>

export function OrgCardDrawer(p: Props) {
  const { card, person, units, cards, ranks, jobs, statusTypes, templates, status, editable, personName } = p
  const [entered, setEntered] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [p.onClose])  // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false)
  const [memo, setMemo] = useState(card.memo ?? '')
  const [loc, setLoc] = useState(card.work_location ?? '')
  const [dname, setDname] = useState(card.display_name ?? '')
  useEffect(() => { setMemo(card.memo ?? ''); setLoc(card.work_location ?? ''); setDname(card.display_name ?? '') }, [card.id, card.memo, card.work_location, card.display_name])
  const save = async (patch: CardPatch) => { setSaving(true); try { await p.onPatch(patch) } catch (e) { p.showToast(orgErrorMessage(e)) } finally { setSaving(false) } }

  // 단위 셀렉트 — 트리 순서 + 들여쓰기
  const unitOptions = useMemo(() => {
    const out: { id: string; label: string }[] = []
    const walk = (parent: string | null, depth: number) => units.filter(u => u.parent_unit_id === parent).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'))
      .forEach(u => { out.push({ id: u.id, label: `${'  '.repeat(depth)}${u.name}${u.code && u.code !== 'ROOT' && u.code !== u.name ? ` (${u.code})` : ''}` }); walk(u.id, depth + 1) })
    walk(null, 0); return out
  }, [units])
  const cardJobIds = useMemo(() => [...card.jobs].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order).map(j => j.job_id), [card.jobs])
  const [jobPick, setJobPick] = useState('')
  const addJob = async (id: string) => { if (!id || cardJobIds.includes(id)) return; setSaving(true); try { await p.onSetJobs([...cardJobIds, id]) } catch (e) { p.showToast(orgErrorMessage(e)) } finally { setSaving(false); setJobPick('') } }
  const removeJob = async (id: string) => { setSaving(true); try { await p.onSetJobs(cardJobIds.filter(x => x !== id)) } catch (e) { p.showToast(orgErrorMessage(e)) } finally { setSaving(false) } }
  const makePrimary = async (id: string) => { setSaving(true); try { await p.onSetJobs([id, ...cardJobIds.filter(x => x !== id)]) } catch (e) { p.showToast(orgErrorMessage(e)) } finally { setSaving(false) } }

  // ── 상태 ──
  const typeMap = useMemo(() => new Map(statusTypes.map(t => [t.code, t])), [statusTypes])
  const badge = orgStatusBadge(status, typeMap)
  const curType = status ? typeMap.get(status.status_code) : null
  const canStatus = !card.is_vacancy && (card.profile_id || card.person_id)
  const [stForm, setStForm] = useState<null | { code: string; start_on: string; end_on: string; return_on: string; departure_on: string; planned: string; note: string; applicable: Set<string> }>(null)
  const [confirmSt, setConfirmSt] = useState<null | { title: string; message: React.ReactNode; variant: 'warn' | 'danger' | 'neutral'; run: () => Promise<void> }>(null)
  const [busy, setBusy] = useState(false)
  const openStForm = () => setStForm({ code: statusTypes.find(t => t.is_active && (card.person_id ? t.category === 'hire_planned' : t.category !== 'hire_planned'))?.code ?? '', start_on: '', end_on: '', return_on: '', departure_on: '', planned: 'parental_leave', note: '', applicable: new Set() })
  const stType = stForm ? typeMap.get(stForm.code) : null
  const submitStatus = () => {
    if (!stForm || !stType) return
    const payload: OrgStatusPayload = { note: stForm.note || null }
    switch (stType.category) {
      case 'hire_planned':   payload.start_on = stForm.start_on || null; break
      case 'departing':      payload.departure_on = stForm.departure_on || null; payload.applicable_template_ids = [...stForm.applicable]; break
      case 'leave_planned':  payload.start_on = stForm.start_on || null; payload.return_on = stForm.return_on || null; payload.end_on = stForm.end_on || null; payload.planned_status_code = stForm.planned; break
      case 'leave':          payload.start_on = stForm.start_on || null; payload.end_on = stForm.end_on || null; payload.return_on = stForm.return_on || null; break
      case 'return_planned': payload.return_on = stForm.return_on || null; break
    }
    const sync = stType.category === 'departing' ? '퇴사예정(departing) + 예정일' : ['leave', 'return_planned'].includes(stType.category) ? '휴직(leave)' : '변경 없음'
    setConfirmSt({ title: `상태 등록 — ${stType.label}`, variant: 'warn',
      message: <>{person.name} 님에게 <b>{stType.label}</b> 상태를 등록합니다.<br />사용자 관리의 재직 상태(profiles.employment_status)도 함께 바뀝니다: <b>{sync}</b>.{status && <><br />기존 활성 상태 '{typeMap.get(status.status_code)?.label ?? status.status_code}' 는 종료됩니다.</>}</>,
      run: async () => { await setOrgPersonStatus(card.profile_id, card.person_id, stForm.code, payload); setStForm(null); await p.onStatusChanged(); p.showToast(`${stType.label} 상태를 등록했습니다.`) } })
  }
  const endStatus = () => {
    if (!status || !curType) return
    const after = curType.category === 'departing' ? '재직(active) 으로 복귀 — 퇴사 예정 철회' : ['leave', 'return_planned'].includes(curType.category) ? '복직(returned) — 30일 후 라벨 자동 소멸' : '변경 없음'
    setConfirmSt({ title: `상태 종료 — ${curType.label}`, variant: 'danger', message: <>'{curType.label}' 상태를 종료합니다. 재직 상태: <b>{after}</b>.</>,
      run: async () => { await endOrgPersonStatus(status.id, 'manual'); await p.onStatusChanged(); p.showToast('상태를 종료했습니다.') } })
  }
  const runConfirm = async () => { if (!confirmSt) return; setBusy(true); try { await confirmSt.run(); setConfirmSt(null) } catch (e) { p.showToast(orgErrorMessage(e)) } finally { setBusy(false) } }

  // ── 체크리스트 ──
  const [items, setItems] = useState<OrgOffboardingItem[]>([])
  useEffect(() => { if (status && curType?.category === 'departing') loadOffboardingItems(status.id).then(setItems).catch(() => setItems([])); else setItems([]) }, [status?.id, curType?.category])  // eslint-disable-line react-hooks/exhaustive-deps
  const toggleItem = async (it: OrgOffboardingItem, patch: { checked?: boolean; applicable?: boolean }) => {
    try { await setOffboardingItem(it.id, patch, p.currentUserId); setItems(await loadOffboardingItems(it.status_id)) } catch (e) { p.showToast(orgErrorMessage(e)) }
  }
  const applicableItems = items.filter(i => i.applicable)
  const doneCnt = applicableItems.filter(i => i.checked).length

  // ── [Phase 4-B] 시스템 잔여 확인 (도서 대출·자원 예약·어드민 권한·회의실 예약) — profile 이 있는 퇴사예정자만 ──
  const [sysCheck, setSysCheck] = useState<OrgSystemCheck | null | 'error'>(null)
  useEffect(() => {
    if (status && curType?.category === 'departing' && card.profile_id) {
      setSysCheck(null)
      offboardingSystemCheck(card.profile_id).then(setSysCheck).catch(() => setSysCheck('error'))
    } else setSysCheck(null)
  }, [status?.id, curType?.category, card.profile_id])
  const sysTotal = sysCheck && sysCheck !== 'error' ? sysCheck.book_count + sysCheck.resource_count + sysCheck.admin_role_count + sysCheck.future_room_bookings : 0

  // ── 이력 ──
  const [histOpen, setHistOpen] = useState(false)
  const [hist, setHist] = useState<{ statuses: OrgPersonStatus[]; logs: OrgChangeLogRow[] } | null>(null)
  useEffect(() => {
    if (!histOpen) return
    Promise.all([
      canStatus ? loadOrgStatusHistory(card.profile_id, card.person_id) : Promise.resolve([]),
      loadOrgChangeLog(card.file_id, 300).then(rows => rows.filter(r => r.target_id === card.id || (r.target_table === 'org_card_jobs' && (r.after?.card_id === card.id || r.before?.card_id === card.id)))),
    ]).then(([s, l]) => setHist({ statuses: s, logs: l })).catch(() => setHist({ statuses: [], logs: [] }))
  }, [histOpen, card.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const reportsOptions = cards.filter(c => c.id !== card.id && !c.is_vacancy).map(c => ({ id: c.id, label: `${personName(c)}${c.is_unit_head ? ' (단위장)' : ''}` })).sort((a, b) => a.label.localeCompare(b.label, 'ko'))
  const ro = !editable
  const dis = (s: CSSProperties = {}): CSSProperties => ro ? { ...s, background: '#F9FAFB', color: OG.quiet } : s
  const nameOf = (id: string | null) => p.users.find(u => u.user_id === id)?.name ?? (id ? '시스템' : '시스템')

  return (
    <ModalPortal>
      <div onClick={p.onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="인사 카드"
             style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(440px, 100vw)', background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)', padding: '20px 22px 32px', overflowY: 'auto', fontFamily: OG.font, fontSize: 13, color: OG.ink, transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>
          {/* 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {card.is_vacancy ? <div style={{ width: 44, height: 44, borderRadius: '50%', border: `1px dashed ${OG.faint}` }} /> : <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size={44} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              {card.is_vacancy
                ? <input value={dname} disabled={ro} onChange={e => setDname(e.target.value)} onBlur={() => dname !== (card.display_name ?? '') && save({ display_name: dname.trim() || '공석' })} style={{ ...inp, fontWeight: 600, fontSize: 15 }} placeholder="공석 표기" />
                : <div style={{ fontWeight: 600, fontSize: 16, textDecoration: person.departed ? 'line-through' : 'none' }}>{person.name}</div>}
              <div style={{ fontSize: 11.5, color: OG.quiet, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.email || (card.person_id ? '입사 예정자' : card.is_vacancy ? '공석(TO)' : '')}{person.departed && ' · 퇴사 완료'}</div>
            </div>
            {saving && <span style={{ fontSize: 11, color: OG.faint }}>저장 중…</span>}
            <button onClick={p.onClose} aria-label="닫기" style={{ ...btn, padding: '5px 7px' }}><X size={14} /></button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {person.departed && <Tag style={{ background: '#FEE2E2', borderColor: '#FECACA', color: '#991B1B' }}>퇴사 완료</Tag>}
            {badge && <Tag style={{ background: badge.bg, borderColor: badge.bg, color: badge.color }}>{badge.label}</Tag>}
            {card.employment_type !== 'regular' && <Tag>{ORG_EMPLOYMENT_TYPE_LABEL[card.employment_type]}</Tag>}
            {ro && <Tag kind="archived">배치 읽기 전용</Tag>}
          </div>

          {/* ② 배치 */}
          {sec('배치')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={row}><span style={lab}>소속 단위</span>
              <select disabled={ro} value={card.unit_id} onChange={e => save({ unit_id: e.target.value })} style={dis(inp)}>{unitOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div style={row}><span style={lab}>직급</span>
              <select disabled={ro} value={card.rank_id ?? ''} onChange={e => save({ rank_id: e.target.value || null })} style={dis(inp)}><option value="">(없음)</option>{ranks.filter(r => r.is_active || r.id === card.rank_id).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
            <div style={{ ...row, alignItems: 'start' }}><span style={{ ...lab, paddingTop: 7 }}>직무</span>
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {cardJobIds.map((id, i) => { const j = jobs.find(x => x.id === id); return (
                    <span key={id} title={i === 0 ? '대표 직무' : '클릭하면 대표로'} onClick={() => !ro && i > 0 && makePrimary(id)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, padding: '3px 8px', borderRadius: 999, border: `1px solid ${i === 0 ? OG.ink : OG.line}`, background: i === 0 ? OG.ink : '#fff', color: i === 0 ? '#fff' : OG.ink, cursor: ro || i === 0 ? 'default' : 'pointer' }}>
                      {j?.code ?? id}{i === 0 && <small style={{ opacity: .7 }}>대표</small>}
                      {!ro && <span onClick={e => { e.stopPropagation(); removeJob(id) }} style={{ cursor: 'pointer', opacity: .7 }}>×</span>}
                    </span>) })}
                  {cardJobIds.length === 0 && <span style={{ fontSize: 12, color: OG.faint }}>직무 없음</span>}
                </div>
                {!ro && <select value={jobPick} onChange={e => addJob(e.target.value)} style={inp}><option value="">+ 직무 추가 (겸직·직무대행)</option>{jobs.filter(j => j.is_active && !cardJobIds.includes(j.id)).map(j => <option key={j.id} value={j.id}>{j.code}{j.label !== j.code ? ` — ${j.label}` : ''}</option>)}</select>}
              </div></div>
            <div style={row}><span style={lab}>보고선</span>
              <select disabled={ro} value={card.reports_to_card_id ?? ''} onChange={e => save({ reports_to_card_id: e.target.value || null })} style={dis(inp)}><option value="">(없음)</option>{reportsOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div style={row}><span style={lab}>단위장</span>
              <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" disabled={ro || card.is_vacancy} checked={card.is_unit_head} onChange={e => save({ is_unit_head: e.target.checked })} /> 이 단위의 장</label></div>
            <div style={row}><span style={lab}>고용 형태</span>
              <select disabled={ro} value={card.employment_type} onChange={e => save({ employment_type: e.target.value as OrgEmploymentType })} style={dis(inp)}>{(Object.keys(ORG_EMPLOYMENT_TYPE_LABEL) as OrgEmploymentType[]).map(k => <option key={k} value={k}>{ORG_EMPLOYMENT_TYPE_LABEL[k]}</option>)}</select></div>
            <div style={row}><span style={lab}>근무지</span>
              <input disabled={ro} value={loc} placeholder="예: 부산" onChange={e => setLoc(e.target.value)} onBlur={() => loc !== (card.work_location ?? '') && save({ work_location: loc.trim() || null })} style={dis(inp)} /></div>
            <div style={row}><span style={lab}>FTE</span>
              <select disabled={ro} value={String(card.fte)} onChange={e => save({ fte: Number(e.target.value) })} style={dis(inp)}>{['1', '0.75', '0.5', '0.25'].map(v => <option key={v} value={v}>{v}</option>)}</select></div>
          </div>

          {/* ③ 상태 */}
          {canStatus && <>
            {sec('상태')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {badge ? <Tag style={{ background: badge.bg, borderColor: badge.bg, color: badge.color, fontSize: 12 }}>{badge.label}</Tag> : <span style={{ fontSize: 12.5, color: OG.quiet }}>재직 (라벨 없음)</span>}
              {status?.note && <span style={{ fontSize: 11.5, color: OG.quiet }}>— {status.note}</span>}
              <span style={{ flex: 1 }} />
              {!stForm && !person.departed && <button style={btn} onClick={openStForm}>상태 변경</button>}
              {status && !stForm && <button style={btnDanger} onClick={endStatus}>상태 종료</button>}
            </div>
            {status && <div style={{ fontSize: 11.5, color: OG.quiet, marginTop: 6 }}>
              {status.start_on && <span>시작 {status.start_on} </span>}{status.end_on && <span>· 종료 {status.end_on} </span>}{status.return_on && <span>· 복귀 예정 {status.return_on} </span>}
              <span>· 등록 {fmtWhen(status.created_at)} {nameOf(status.created_by)}</span>
            </div>}
            {stForm && stType && (
              <div style={{ marginTop: 10, border: `1px solid ${OG.line}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: '#FAFAFA' }}>
                <div style={row}><span style={lab}>상태</span>
                  <select value={stForm.code} onChange={e => setStForm({ ...stForm, code: e.target.value })} style={inp}>
                    {statusTypes.filter(t => t.is_active && (card.person_id ? t.category === 'hire_planned' : t.category !== 'hire_planned')).map(t => <option key={t.code} value={t.code}>{t.label}{!t.is_system ? ' (사용자 정의)' : ''}</option>)}
                  </select></div>
                {stType.category === 'hire_planned' && <div style={row}><span style={lab}>입사일 *</span><DateField value={stForm.start_on} onChange={d => setStForm({ ...stForm, start_on: d })} style={inp} /></div>}
                {stType.category === 'departing' && <>
                  <div style={row}><span style={lab}>퇴사일 *</span><DateField value={stForm.departure_on} onChange={d => setStForm({ ...stForm, departure_on: d })} style={inp} /></div>
                  <div style={{ fontSize: 11.5, color: OG.quiet }}>마지막 근무일. 익일 00:10 자동 퇴사 처리(process-scheduled-departures) — 예약·대여 강제 반납·권한 회수가 실행됩니다.</div>
                  {templates.filter(t => t.is_conditional).length > 0 && <div style={{ ...row, alignItems: 'start' }}><span style={{ ...lab, paddingTop: 2 }}>해당 항목</span>
                    <div>{templates.filter(t => t.is_conditional).map(t => <label key={t.id} style={{ display: 'flex', gap: 6, fontSize: 12.5, alignItems: 'center' }}><input type="checkbox" checked={stForm.applicable.has(t.id)} onChange={e => { const s = new Set(stForm.applicable); e.target.checked ? s.add(t.id) : s.delete(t.id); setStForm({ ...stForm, applicable: s }) }} /> {t.label} 사용 중{t.is_critical && <b style={{ color: OG.red, fontSize: 10.5 }}>중요</b>}</label>)}</div></div>}
                </>}
                {stType.category === 'leave_planned' && <>
                  <div style={row}><span style={lab}>예정 종류 *</span><select value={stForm.planned} onChange={e => setStForm({ ...stForm, planned: e.target.value })} style={inp}>{statusTypes.filter(t => t.category === 'leave' && t.is_active).map(t => <option key={t.code} value={t.code}>{t.label}</option>)}</select></div>
                  <div style={row}><span style={lab}>시작일 *</span><DateField value={stForm.start_on} onChange={d => setStForm({ ...stForm, start_on: d })} style={inp} /></div>
                  <div style={row}><span style={lab}>종료일</span><DateField value={stForm.end_on} onChange={d => setStForm({ ...stForm, end_on: d })} style={inp} /></div>
                  <div style={row}><span style={lab}>복귀 예정일</span><DateField value={stForm.return_on} onChange={d => setStForm({ ...stForm, return_on: d })} style={inp} /></div>
                  <div style={{ fontSize: 11.5, color: OG.quiet }}>시작일 도래 시 자동으로 예정 종류로 전환되고 재직 상태가 휴직으로 바뀝니다(매일 00:15).</div>
                </>}
                {stType.category === 'leave' && <>
                  <div style={row}><span style={lab}>시작일 *</span><DateField value={stForm.start_on} onChange={d => setStForm({ ...stForm, start_on: d })} style={inp} /></div>
                  <div style={row}><span style={lab}>종료일</span><DateField value={stForm.end_on} onChange={d => setStForm({ ...stForm, end_on: d })} style={inp} /></div>
                  <div style={row}><span style={lab}>복귀 예정일</span><DateField value={stForm.return_on} onChange={d => setStForm({ ...stForm, return_on: d })} style={inp} /></div>
                  <div style={{ fontSize: 11.5, color: OG.quiet }}>복귀 예정일 30일 전에 '복직예정'으로, 복귀일에 '복직'으로 자동 전환됩니다.</div>
                </>}
                {stType.category === 'return_planned' && <div style={row}><span style={lab}>복귀 예정일 *</span><DateField value={stForm.return_on} onChange={d => setStForm({ ...stForm, return_on: d })} style={inp} /></div>}
                <div style={row}><span style={lab}>메모</span><input value={stForm.note} onChange={e => setStForm({ ...stForm, note: e.target.value })} style={inp} placeholder="사유 등 (선택)" /></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button style={btn} onClick={() => setStForm(null)}>취소</button>
                  <button style={btnPri} onClick={submitStatus}>등록</button>
                </div>
              </div>
            )}
          </>}

          {/* ④ 반납 체크리스트 */}
          {status && curType?.category === 'departing' && <>
            {sec(`반납 체크리스트 ${doneCnt}/${applicableItems.length}`)}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(it => (
                <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, opacity: it.applicable ? 1 : .45 }}>
                  <input type="checkbox" checked={it.checked} disabled={!it.applicable} onChange={e => toggleItem(it, { checked: e.target.checked })} />
                  <span style={{ textDecoration: it.checked ? 'line-through' : 'none', color: it.is_critical && !it.checked && it.applicable ? OG.red : OG.ink, fontWeight: it.is_critical ? 600 : 400 }}>{it.label}{it.is_critical && ' ⚠'}</span>
                  {it.checked && it.checked_at && <small style={{ color: OG.quiet }}>{fmtWhen(it.checked_at)} {nameOf(it.checked_by)}</small>}
                  <span style={{ flex: 1 }} />
                  {templates.find(t => t.id === it.template_id)?.is_conditional && <label style={{ fontSize: 11, color: OG.quiet, display: 'flex', gap: 4 }}><input type="checkbox" checked={it.applicable} onChange={e => toggleItem(it, { applicable: e.target.checked, ...(e.target.checked ? {} : { checked: false }) })} />해당</label>}
                </div>
              ))}
              {items.length === 0 && <span style={{ fontSize: 12, color: OG.faint }}>항목 없음</span>}
            </div>

            {/* [Phase 4-B] 시스템 잔여 — 퇴사 실행(process_departure) 시 강제 회수되지만, 사전에 사람이 정리할 수 있도록 표시 */}
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: sysTotal > 0 ? '#FEF2F2' : '#F8FAFC', border: `1px solid ${sysTotal > 0 ? '#FECACA' : OG.line}` }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: sysTotal > 0 ? OG.red : OG.ink, marginBottom: 4 }}>
                시스템 잔여 {sysCheck === null ? (card.profile_id ? '확인 중…' : '— 프로필 없음(입사예정자)') : sysCheck === 'error' ? '— 조회 실패' : sysTotal === 0 ? '없음 ✓' : `${sysTotal}건`}
              </div>
              {sysCheck && sysCheck !== 'error' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
                  <SysRow label="도서 대출" n={sysCheck.book_count}>{sysCheck.books.map((b, i) => <small key={i} style={{ color: OG.quiet }}>{b.title} (반납 {b.due_at?.slice(0, 10)})</small>)}</SysRow>
                  <SysRow label="자원 예약(진행·예정)" n={sysCheck.resource_count}>{sysCheck.resources.map((r, i) => <small key={i} style={{ color: OG.quiet }}>{r.label} {r.start_at?.slice(0, 10)}~{r.end_at?.slice(0, 10)}</small>)}</SysRow>
                  <SysRow label="어드민 권한" n={sysCheck.admin_role_count}>{sysCheck.admin_roles.length > 0 && <small style={{ color: OG.quiet }}>{sysCheck.admin_roles.join(', ')}</small>}</SysRow>
                  <SysRow label="회의실 예약(예정)" n={sysCheck.future_room_bookings} />
                </div>
              )}
              <div style={{ fontSize: 11, color: OG.faint, marginTop: 4 }}>퇴사 실행 시 도서·자원·회의실 예약은 자동 해제되고 어드민 권한은 회수됩니다. 가능하면 사전에 정리하세요.</div>
            </div>
          </>}

          {/* ⑤ 메모 */}
          {sec('메모')}
          <textarea disabled={ro} value={memo} onChange={e => setMemo(e.target.value)} onBlur={() => memo !== (card.memo ?? '') && save({ memo: memo.trim() || null })} rows={3} style={{ ...dis(inp), resize: 'vertical' }} placeholder="카드 메모 (이 조직도 파일에만 저장)" />

          {/* ⑥ 이력 */}
          <div onClick={() => setHistOpen(o => !o)} style={{ fontSize: 11, fontWeight: 700, color: OG.quiet, margin: '20px 0 8px', paddingBottom: 6, borderBottom: `1px solid ${OG.lineSoft}`, cursor: 'pointer' }}>{histOpen ? '▾' : '▸'} 변경 이력</div>
          {histOpen && (
            <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {!hist && <span style={{ color: OG.faint }}>불러오는 중…</span>}
              {hist && hist.statuses.length > 0 && <div style={{ color: OG.quiet, fontSize: 11 }}>상태 이력</div>}
              {hist?.statuses.map(s => <div key={s.id} style={{ display: 'flex', gap: 8 }}><span style={{ color: OG.quiet, minWidth: 80 }}>{fmtWhen(s.created_at)}</span><span>{typeMap.get(s.status_code)?.label ?? s.status_code}</span>{s.ended_at && <span style={{ color: OG.faint }}>→ 종료 {fmtWhen(s.ended_at)} ({s.ended_reason})</span>}</div>)}
              {hist && hist.logs.length > 0 && <div style={{ color: OG.quiet, fontSize: 11, marginTop: 6 }}>카드 변경 (이 파일)</div>}
              {hist?.logs.slice(0, 30).map(l => <div key={l.id} style={{ display: 'flex', gap: 8 }}><span style={{ color: OG.quiet, minWidth: 80 }}>{fmtWhen(l.created_at)}</span><span style={{ minWidth: 52 }}>{nameOf(l.actor)}</span><span style={{ color: OG.quiet }}>{describeLog(l, units, ranks, jobs)}</span></div>)}
              {hist && hist.statuses.length === 0 && hist.logs.length === 0 && <span style={{ color: OG.faint }}>이력 없음</span>}
            </div>
          )}

          {editable && <div style={{ marginTop: 28, display: 'flex', justifyContent: 'flex-end' }}><button style={btnDanger} onClick={p.onDelete}>이 조직도에서 카드 제거</button></div>}
          {!editable && <div style={{ marginTop: 20, fontSize: 11.5, color: OG.faint }}>배치 편집은 초안 파일에서만 가능합니다. 상태·체크리스트는 사람 소속이라 어디서든 편집됩니다.</div>}
        </div>
      </div>
      {confirmSt && <ConfirmDialog title={confirmSt.title} message={confirmSt.message} variant={confirmSt.variant} confirmLabel="확인" loading={busy} onConfirm={runConfirm} onClose={() => !busy && setConfirmSt(null)} />}
    </ModalPortal>
  )
}

/** [Phase 4-B] 시스템 잔여 한 줄 */
function SysRow({ label, n, children }: { label: string; n: number; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={{ color: OG.quiet }}>{label}</span><b style={{ color: n > 0 ? OG.red : OG.ink }}>{n}</b></div>
      {n > 0 && children && <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 8 }}>{children}</div>}
    </div>
  )
}

/** 변경 로그 1건 → 한 줄 문장 (카드·직무 대상만) */
export function describeLog(l: OrgChangeLogRow, units: OrgUnit[], ranks: OrgRank[], jobs: OrgJob[]): string {
  const un = (id: string | null | undefined) => units.find(u => u.id === id)?.name ?? '?'
  if (l.target_table === 'org_card_jobs') {
    const j = jobs.find(x => x.id === (l.after?.job_id ?? l.before?.job_id))?.code ?? '?'
    return l.action === 'insert' ? `직무 추가 ${j}${l.after?.is_primary ? ' (대표)' : ''}` : l.action === 'delete' ? `직무 제거 ${j}` : `직무 변경 ${j}`
  }
  if (l.action === 'insert') return `카드 생성 → ${un(l.after?.unit_id)}`
  if (l.action === 'delete') return `카드 제거 (${un(l.before?.unit_id)})`
  const diffs: string[] = []
  const b = l.before ?? {}, a = l.after ?? {}
  if (b.unit_id !== a.unit_id) diffs.push(`소속 ${un(b.unit_id)} → ${un(a.unit_id)}`)
  if (b.rank_id !== a.rank_id) diffs.push(`직급 ${ranks.find(r => r.id === b.rank_id)?.label ?? '없음'} → ${ranks.find(r => r.id === a.rank_id)?.label ?? '없음'}`)
  if (b.is_unit_head !== a.is_unit_head) diffs.push(a.is_unit_head ? '단위장 지정' : '단위장 해제')
  if (b.reports_to_card_id !== a.reports_to_card_id) diffs.push('보고선 변경')
  if (b.employment_type !== a.employment_type) diffs.push(`고용형태 ${b.employment_type} → ${a.employment_type}`)
  if (b.work_location !== a.work_location) diffs.push(`근무지 ${b.work_location ?? '-'} → ${a.work_location ?? '-'}`)
  if (String(b.fte) !== String(a.fte)) diffs.push(`FTE ${b.fte} → ${a.fte}`)
  if (b.memo !== a.memo) diffs.push('메모 변경')
  if (b.display_name !== a.display_name) diffs.push('표기 변경')
  if (b.profile_id !== a.profile_id) diffs.push('입사예정자 → 프로필 연결')
  return diffs.join(', ') || '변경'
}
