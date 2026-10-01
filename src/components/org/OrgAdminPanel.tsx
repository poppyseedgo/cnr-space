/**
 * OrgAdminPanel.tsx — 어드민 '조직도' 탭 루트: 데이터 소유 + 갤러리(A) ↔ 캔버스(B) 전환 + 모든 저장 경로
 *  - [2026-10-01 ORG 5-C] 단위 이동(상위로/하위로/이동… 모달) · 재배치 시 형제 끝에 배치 · 전체화면/스크롤은 OrgCanvas
 *  - [2026-10-01 ORG Phase 5-B] 퇴사 판정·숨김(departedOf/isHidden) · 미배치에서 퇴사일 경과자 제외 · 겸직 카드 추가/승격 · 숨김 토글 · Excel 내보내기
 *  - [2026-10-01 ORG Phase 5] 조직도 표기 이름(org_display_names) 로드 · 드로어 편집 연결 · CSV Azure 이름 열
 *  - [2026-10-01 ORG Phase 4-B] 코드 관리 패널(E) · Active 전환 알림(send-notification org_activated) · 카드 CSV 내보내기
 *  - [2026-10-01 ORG Phase 4-A] 카드 드로어(C) · 히스토리/diff 드로어(D) · 입사예정자 카드 추가 · 카드 제거 연결
 *  - [2026-10-01 ORG Phase 3] 신규 — 설계서 §6
 *
 *  딥링크: #admin-org-{fileId} = 캔버스, #admin-tab-org = 갤러리 (AdminPage getTabFromHash 가 admin-org- 접두어를 org 탭으로 해석)
 *  저장: 구조 편집은 즉시 저장(초안) → 단건 재조회로 상태 반영(낙관적 갱신 금지). 실패는 orgErrorMessage 토스트
 *  잠금: 초안 진입 시 org_acquire_lock, 10분마다 갱신, 떠날 때 해제. 타인 잠금이면 읽기 전용 + super 는 강제 획득 버튼
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppUser, DepartedUser, OrgCard, OrgDisplayName, OrgFileSummary, OrgPersonStatus, OrgRosterCheck, OrgStatusCategory, OrgUnit } from '../../types'
import { loadDepartedUsers } from '../../lib/api'
import {
  loadOrgCodes, loadOrgFiles, loadOrgFileBundle, loadActiveOrgStatuses, createOrgFile, updateOrgFileMeta, deleteOrgFile,
  copyOrgFile, activateOrgFile, acquireOrgLock, releaseOrgLock, rosterCheck,
  insertOrgUnit, updateOrgUnit, deleteOrgUnit, reorderOrgUnits, insertOrgCard, updateOrgCard, deleteOrgCard, setOrgCardJobs, loadOrgCardById, loadOrgUnitById,
  loadOffboardingTemplates, insertOrgPerson, setOrgPersonStatus,
  notifyOrgActivated,   // ← [Phase 4-B]
  loadOrgDisplayNames, setOrgDisplayName,   // ← [Phase 5]
  setOrgCardHidden, swapOrgPrimaryCard,     // ← [Phase 5-B]
  type OrgCodes, type OrgFileBundle, type OrgOffboardingTemplate,
} from '../../lib/orgApi'
import { orgErrorMessage, orgPersonView, orgStatusBadge, orgExportRows, orgDepartedInfo, isCardHidden, todayKST, descendantIds, type OrgDepartedInfo } from '../../utils/orgStatus'
import { exportOrgExcel } from '../../utils/orgExcel'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { OrgGallery } from './OrgGallery'
import { OrgCanvas } from './OrgCanvas'
import { OrgPromptModal, type PromptField } from './OrgPromptModal'
import { OrgCardDrawer, type CardPatch } from './OrgCardDrawer'   // ← [Phase 4-A]
import { OrgHistoryDrawer } from './OrgHistoryDrawer'            // ← [Phase 4-A]
import { OrgCodesPanel } from './OrgCodesPanel'                  // ← [Phase 4-B]
import { OG } from './orgShared'

interface Props {
  users:         AppUser[]
  currentUserId: string
  isSuper:       boolean
  showToast:     (msg: string) => void
  isMobile:      boolean
}
const LOCK_REFRESH_MS = 10 * 60_000
const hashFileId = () => { const h = window.location.hash.replace('#', ''); return h.startsWith('admin-org-') ? h.slice('admin-org-'.length) : null }

export function OrgAdminPanel({ users, currentUserId, isSuper, showToast, isMobile }: Props) {
  const [codes, setCodes]       = useState<OrgCodes>({ ranks: [], jobs: [], statusTypes: [] })
  const [files, setFiles]       = useState<OrgFileSummary[]>([])
  const [statuses, setStatuses] = useState<OrgPersonStatus[]>([])
  const [departed, setDeparted] = useState<DepartedUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [fileId, setFileId]     = useState<string | null>(hashFileId)
  const [bundle, setBundle]     = useState<OrgFileBundle | null>(null)
  const [activeBundle, setActiveBundle] = useState<{ units: OrgUnit[]; cards: OrgCard[] } | null>(null)
  const [roster, setRoster]     = useState<OrgRosterCheck | null>(null)
  const [activeRoster, setActiveRoster] = useState<OrgRosterCheck | null>(null)
  const [lockHolder, setLockHolder] = useState<string | null>(null)
  const [editable, setEditable] = useState(false)
  const [savedAt, setSavedAt]   = useState<string | null>(null)
  const [selectedCard, setSelectedCard] = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [templates, setTemplates] = useState<OrgOffboardingTemplate[]>([])   // ← [Phase 4-A] 반납 템플릿
  const [history, setHistory]   = useState<null | { file: OrgFileBundle['file'] | null; tab: 'log' | 'diff' }>(null)   // ← [Phase 4-A] 드로어 D
  const [codesOpen, setCodesOpen] = useState(false)   // ← [Phase 4-B] 패널 E
  const [displayNames, setDisplayNames] = useState<Map<string, OrgDisplayName>>(new Map())   // ← [Phase 5]
  const myName = useMemo(() => users.find(u => u.user_id === currentUserId)?.name ?? '관리자', [users, currentUserId])
  const [modal, setModal]       = useState<null | { kind: 'new' } | { kind: 'copy'; src: OrgFileSummary | { id: string; name: string } } | { kind: 'meta' } | { kind: 'unit-new'; parentId: string | null } | { kind: 'unit-rename'; unit: OrgUnit } | { kind: 'unit-move'; unit: OrgUnit } | { kind: 'vacancy'; unitId: string } | { kind: 'person-new'; unitId: string }>(null)
  const [confirm, setConfirm]   = useState<null | { title: string; message: React.ReactNode; variant: 'danger' | 'warn' | 'neutral'; label: string; run: () => Promise<void> }>(null)

  const ranks = useMemo(() => new Map(codes.ranks.map(r => [r.id, r])), [codes.ranks])
  const jobs  = useMemo(() => new Map(codes.jobs.map(j => [j.id, j])), [codes.jobs])
  const statusTypeMap = useMemo(() => new Map(codes.statusTypes.map(t => [t.code, t])), [codes.statusTypes])
  const departedMap = useMemo(() => new Map(departed.map(d => [d.id, { name: d.name, avatar_url: d.avatar_url }])), [departed])
  const personsMap  = useMemo(() => new Map((bundle?.persons ?? []).map(p => [p.id, { name: p.name, email: p.email }])), [bundle])
  const statusBySubject = useMemo(() => { const m = new Map<string, OrgPersonStatus>(); for (const s of statuses) m.set(s.profile_id ?? `p:${s.person_id}`, s); return m }, [statuses])
  const statusOf   = useCallback((c: OrgCard) => statusBySubject.get(c.profile_id ?? `p:${c.person_id}`) ?? null, [statusBySubject])
  const person     = useCallback((c: OrgCard) => orgPersonView(c, users, personsMap, departedMap, displayNames), [users, personsMap, departedMap, displayNames])
  const badge      = useCallback((c: OrgCard) => orgStatusBadge(statusOf(c), statusTypeMap), [statusOf, statusTypeMap])
  const categoryOf = useCallback((c: OrgCard): OrgStatusCategory | null => { const s = statusOf(c); return s ? (statusTypeMap.get(s.status_code)?.category ?? null) : null }, [statusOf, statusTypeMap])
  // [Phase 5-B] 퇴사 판정 + 숨김 — 설계서 §12.2
  const departedAtMap = useMemo(() => new Map(departed.map(d => [d.id, d.departed_at])), [departed])
  const departedOf = useCallback((c: OrgCard): OrgDepartedInfo => orgDepartedInfo(c, person(c), statusOf(c), statusTypeMap, c.profile_id ? departedAtMap.get(c.profile_id) : null, todayKST()), [person, statusOf, statusTypeMap, departedAtMap])
  const isHidden   = useCallback((c: OrgCard) => isCardHidden(c, departedOf(c)), [departedOf])

  const fail = (e: unknown, fb?: string) => { console.error('[org]', e); showToast(orgErrorMessage(e, fb)) }

  // ── 초기 로드 ──
  const reloadFiles = useCallback(async () => {
    const fs = await loadOrgFiles(); setFiles(fs)
    const act = fs.find(f => f.status === 'active')
    if (act) {
      const [b, rc] = await Promise.all([loadOrgFileBundle(act.id), rosterCheck(act.id).catch(() => null)])
      setActiveBundle(b ? { units: b.units, cards: b.cards } : null); setActiveRoster(rc)
    } else { setActiveBundle(null); setActiveRoster(null) }
  }, [])
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const [c, s, d, t, dn] = await Promise.all([loadOrgCodes(), loadActiveOrgStatuses(), loadDepartedUsers(), loadOffboardingTemplates().catch(() => []), loadOrgDisplayNames().catch(() => new Map<string, OrgDisplayName>())])
        if (dead) return
        setCodes(c); setStatuses(s); setDeparted(d); setTemplates(t); setDisplayNames(dn)
        await reloadFiles()
      } catch (e) { fail(e, '조직도 데이터를 불러오지 못했습니다.') }
      finally { if (!dead) setLoading(false) }
    })()
    return () => { dead = true }
  }, [reloadFiles])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 해시 ↔ 상태 ──
  useEffect(() => { const h = () => setFileId(hashFileId()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [])
  const openFile = (id: string) => { window.location.hash = `admin-org-${id}` }
  const goGallery = () => { window.location.hash = 'admin-tab-org' }

  // ── 캔버스 진입: 번들 + 검증 + 잠금 ──
  const lockTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!fileId) { setBundle(null); setRoster(null); setEditable(false); setLockHolder(null); return }
    let dead = false
    ;(async () => {
      try {
        const b = await loadOrgFileBundle(fileId)
        if (dead) return
        if (!b) { showToast('조직도 파일을 찾을 수 없습니다.'); goGallery(); return }
        setBundle(b); setSelectedCard(null)
        rosterCheck(fileId).then(r => !dead && setRoster(r)).catch(() => {})
        if (b.file.status === 'draft') {
          try {
            await acquireOrgLock(fileId)
            if (dead) return
            setEditable(true); setLockHolder(null)
            lockTimer.current = window.setInterval(() => acquireOrgLock(fileId).catch(() => {}), LOCK_REFRESH_MS)
          } catch (e) {
            const msg = e instanceof Error ? e.message : ''
            if (msg.includes('ORG_FILE_LOCKED')) {
              const holder = users.find(u => u.user_id === b.file.lock_by)?.name ?? '다른 사용자'
              setEditable(false); setLockHolder(holder)
              showToast(`${holder} 님이 편집 중입니다 — 읽기 전용으로 엽니다.${isSuper ? ' (최고 관리자: 헤더에서 강제 획득 가능)' : ''}`)
            } else { fail(e); setEditable(false) }
          }
        } else { setEditable(false); setLockHolder(null) }
      } catch (e) { fail(e, '조직도를 불러오지 못했습니다.') }
    })()
    return () => {
      dead = true
      if (lockTimer.current) { window.clearInterval(lockTimer.current); lockTimer.current = null }
      releaseOrgLock(fileId).catch(() => {})
    }
  }, [fileId])   // eslint-disable-line react-hooks/exhaustive-deps

  // ── 단건 재조회 머지 ──
  const touch = () => setSavedAt(new Date().toISOString())
  const mergeCard = async (id: string) => { const c = await loadOrgCardById(id); setBundle(b => b ? { ...b, cards: c ? b.cards.map(x => x.id === id ? c : x).concat(b.cards.some(x => x.id === id) ? [] : [c]) : b.cards.filter(x => x.id !== id) } : b); touch() }
  const mergeUnit = async (id: string) => { const u = await loadOrgUnitById(id); setBundle(b => b ? { ...b, units: u ? (b.units.some(x => x.id === id) ? b.units.map(x => x.id === id ? u : x) : [...b.units, u]) : b.units.filter(x => x.id !== id) } : b); touch() }
  const refreshRoster = () => { if (fileId) rosterCheck(fileId).then(setRoster).catch(() => {}) }
  // ← [Phase 4-A] 카드 드로어 저장 경로 — 직접 쓰기 → 단건 재조회. 상태 변경은 RPC 후 활성 상태 전체 재로드(사람 소속)
  const selected = bundle?.cards.find(c => c.id === selectedCard) ?? null
  const onCardPatch = async (patch: CardPatch) => { if (!selected) return; await updateOrgCard(selected.id, patch); await mergeCard(selected.id); if (patch.unit_id) refreshRoster() }
  const onCardJobs = async (jobIds: string[]) => { if (!selected) return; await setOrgCardJobs(selected.id, jobIds); await mergeCard(selected.id) }
  const onStatusChanged = async () => { setStatuses(await loadActiveOrgStatuses()); refreshRoster() }
  const onCardDelete = () => { if (!selected) return; const nm = person(selected).name; setConfirm({ title: '카드 제거', message: <>'{nm}' 카드를 이 조직도에서 제거합니다. 사람 상태·이력은 남고, 미배치 패널로 돌아갑니다.</>, variant: 'danger', label: '제거',
    run: async () => { await deleteOrgCard(selected.id); setBundle(b => b ? { ...b, cards: b.cards.filter(c => c.id !== selected.id) } : b); setSelectedCard(null); touch(); refreshRoster() } }) }

  // ── [Phase 5-B] 겸직 카드 · 숨김 ──
  const onAddConcurrent = async (unitId: string) => {
    if (!selected || !bundle) return
    try { const c = await insertOrgCard({ file_id: bundle.file.id, unit_id: unitId, profile_id: selected.profile_id, person_id: selected.person_id, is_primary: false }); await mergeCard(c.id); showToast('겸직 카드를 추가했습니다.') } catch (e) { fail(e) }
  }
  const onSwapPrimary = async (cardId: string) => {
    if (!bundle) return
    try { await swapOrgPrimaryCard(cardId); const b = await loadOrgFileBundle(bundle.file.id); setBundle(b); touch(); showToast('본 카드를 바꿨습니다.') } catch (e) { fail(e) }
  }
  const onToggleHidden = async (c: OrgCard) => {
    try { await setOrgCardHidden(c.id, !c.hidden_at); await mergeCard(c.id); refreshRoster(); showToast(c.hidden_at ? '카드 숨김을 해제했습니다.' : '카드를 숨겼습니다 — Active 전환 시 자동 제거됩니다.') } catch (e) { fail(e) }
  }

  // ── 드래그 저장 ──
  const onDropCard = async (cardId: string, unitId: string) => { try { await updateOrgCard(cardId, { unit_id: unitId }); await mergeCard(cardId); refreshRoster() } catch (e) { fail(e) } }
  const onDropUnit = async (unitId: string, parentId: string | null) => {
    if (!bundle) return
    try {
      const sib = bundle.units.filter(u => u.parent_unit_id === parentId && u.id !== unitId)
      await updateOrgUnit(unitId, { parent_unit_id: parentId, sort_order: sib.length }); await mergeUnit(unitId)   // 새 부모의 형제 끝으로
    } catch (e) { fail(e) }
  }
  // [5-C] 상위로 = 부모의 형제로 (부모 바로 다음) · 하위로 = 앞 형제의 하위 끝 · 이동… = 모달에서 대상 선택
  const onOutdentUnit = async (u: OrgUnit) => {
    if (!bundle) return
    const parent = bundle.units.find(x => x.id === u.parent_unit_id); if (!parent || !parent.parent_unit_id) { showToast('최상위 바로 아래 단위는 더 올릴 수 없습니다.'); return }
    try {
      const sib = siblingsOf(parent).filter(x => x.id !== u.id)
      const i = sib.findIndex(x => x.id === parent.id)
      const ids = sib.map(x => x.id); ids.splice(i + 1, 0, u.id)
      await updateOrgUnit(u.id, { parent_unit_id: parent.parent_unit_id, sort_order: i + 1 })
      await reorderOrgUnits(ids); const b = await loadOrgFileBundle(bundle.file.id); setBundle(b); touch()
    } catch (e) { fail(e) }
  }
  const onIndentUnit = async (u: OrgUnit) => {
    const sib = siblingsOf(u); const i = sib.findIndex(x => x.id === u.id)
    if (i <= 0) { showToast('앞 형제가 없어 내릴 수 없습니다.'); return }
    await onDropUnit(u.id, sib[i - 1].id)
  }
  const onMoveUnitTo = (u: OrgUnit) => setModal({ kind: 'unit-move', unit: u })
  const onDropProfile = async (profileId: string, unitId: string) => {
    if (!bundle) return
    try { const c = await insertOrgCard({ file_id: bundle.file.id, unit_id: unitId, profile_id: profileId }); await mergeCard(c.id); refreshRoster() } catch (e) { fail(e) }
  }

  // ── 단위 편집 ──
  const siblingsOf = (u: OrgUnit) => (bundle?.units ?? []).filter(x => x.parent_unit_id === u.parent_unit_id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'))
  const onMoveUnit = async (u: OrgUnit, dir: -1 | 1) => {
    const sib = siblingsOf(u); const i = sib.findIndex(x => x.id === u.id); const j = i + dir
    if (i < 0 || j < 0 || j >= sib.length) return
    const ids = sib.map(x => x.id); [ids[i], ids[j]] = [ids[j], ids[i]]
    try { await reorderOrgUnits(ids); for (const id of ids) await mergeUnit(id) } catch (e) { fail(e) }
  }
  const onDeleteUnit = (u: OrgUnit) => setConfirm({ title: '단위 삭제', message: <>'{u.name}' 단위를 삭제합니다. 하위 단위·카드가 없을 때만 가능합니다.</>, variant: 'danger', label: '삭제',
    run: async () => { await deleteOrgUnit(u.id); setBundle(b => b ? { ...b, units: b.units.filter(x => x.id !== u.id) } : b); touch() } })

  // ── 갤러리 액션 ──
  const onActivate = (f: { id: string; name: string }, force = false) => setConfirm({
    title: force ? 'Active 강제 지정' : 'Active 지정', variant: 'warn', label: force ? '강제 지정' : 'Active 지정',
    message: <>'{f.name}' 을(를) 현재 조직도로 지정합니다. 기존 Active 는 Archived 로 내려가고 되돌릴 수 없습니다(복사해서 다시 지정은 가능). org 역할 보유자에게 인앱·이메일 알림이 갑니다.{force && <><br /><b style={{ color: OG.red }}>퇴사자 카드가 남아 있는 상태로 강제 전환합니다.</b></>}</>,
    run: async () => {
      try {
        const r = await activateOrgFile(f.id, force)
        notifyOrgActivated(r, myName)   // [Phase 4-B] 이메일+인앱 — Edge 가 담당, 실패해도 전환은 완료
        showToast(`Active 지정 완료 — 변경 ${r.diff_count}건 · 단위 ${r.units} · 카드 ${r.cards} · org 담당자에게 알림 발송`)
        await reloadFiles(); if (fileId === f.id) { const b = await loadOrgFileBundle(f.id); setBundle(b); setEditable(false) }
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (msg.includes('ORG_ACTIVATE_GHOSTS') && !force) { setConfirm(null); setTimeout(() => onActivate(f, true), 0); showToast('퇴사자 카드가 남아 있습니다 — 강제 지정 여부를 확인하세요.'); return }
        throw e
      }
    } })
  const onDelete = (f: OrgFileSummary) => setConfirm({ title: '초안 삭제', message: <>'{f.name}' 초안을 삭제합니다. 단위·카드가 함께 삭제되며 변경 로그는 남습니다.</>, variant: 'danger', label: '삭제',
    run: async () => { await deleteOrgFile(f.id); await reloadFiles(); if (fileId === f.id) goGallery() } })

  const runConfirm = async () => { if (!confirm) return; setBusy(true); try { await confirm.run(); setConfirm(null) } catch (e) { fail(e) } finally { setBusy(false) } }

  // ── [Phase 5-B] Excel 내보내기 (파일 단위) — 시트1 '조직도'(엑셀 원본과 같은 박스 레이아웃) · 시트2 '명단' ──
  const onExport = async (f: { id: string; name: string; effective_on?: string | null }) => {
    try {
      const b = (bundle && bundle.file.id === f.id) ? bundle : await loadOrgFileBundle(f.id)
      if (!b) { showToast('조직도 파일을 찾을 수 없습니다.'); return }
      const pm = new Map(b.persons.map(p => [p.id, { name: p.name, email: p.email }]))
      const pv = (c: OrgCard) => orgPersonView(c, users, pm, departedMap, displayNames)
      const hid = (c: OrgCard) => isCardHidden(c, orgDepartedInfo(c, pv(c), statusOf(c), statusTypeMap, c.profile_id ? departedAtMap.get(c.profile_id) : null))
      const rows = orgExportRows(b.units, b.cards, ranks, jobs, statusTypeMap, pv, statusOf, hid)
      const n = await exportOrgExcel({ file: b.file, units: b.units, cards: b.cards.filter(c => !hid(c)), ranks, jobs, person: pv, rows })
      showToast(`Excel 내보내기 — 조직도 시트 단위 ${n.units} · 명단 ${rows.length}행`)
    } catch (e) { fail(e, 'Excel 내보내기에 실패했습니다.') }
  }
  // ── [Phase 5] 조직도 표기 이름 저장 → 재조회 (사람 단위라 모든 파일에 즉시 반영)
  const onDisplayName = async (profileId: string, name: string) => { await setOrgDisplayName(profileId, name, currentUserId); setDisplayNames(await loadOrgDisplayNames()) }
  // ── [Phase 4-B] 코드 변경 후 재로드(직급·직무·상태코드·반납 템플릿) ──
  const reloadCodes = async () => { try { const [c, t] = await Promise.all([loadOrgCodes(), loadOffboardingTemplates()]); setCodes(c); setTemplates(t) } catch (e) { fail(e) } }

  // ── 모달 submit ──
  const submitModal = async (v: Record<string, string>) => {
    if (!modal) return
    setBusy(true)
    try {
      if (modal.kind === 'new') {
        if (v.source === 'copy') { const act = files.find(f => f.status === 'active'); if (!act) throw new Error('ORG_FILE_NOT_FOUND'); const r = await copyOrgFile(act.id, v.name, v.effective_on || null); await reloadFiles(); setModal(null); openFile(r.file_id); showToast(`복사 완료 — 단위 ${r.units} · 카드 ${r.cards}${r.missing_count ? ` · 미배치 ${r.missing_count}명` : ''}`) }
        else { const f = await createOrgFile(v.name, v.effective_on || null, currentUserId, v.root || 'C&R Research'); await reloadFiles(); setModal(null); openFile(f.id) }
      } else if (modal.kind === 'copy') {
        const r = await copyOrgFile(modal.src.id, v.name, v.effective_on || null); await reloadFiles(); setModal(null); openFile(r.file_id)
        showToast(`복사 완료 — 단위 ${r.units} · 카드 ${r.cards}${r.missing_count ? ` · 미배치 ${r.missing_count}명` : ''}${r.ghost_count ? ` · 퇴사자 카드 ${r.ghost_count}` : ''}`)
      } else if (modal.kind === 'meta' && bundle) {
        await updateOrgFileMeta(bundle.file.id, { name: v.name.trim(), effective_on: v.effective_on || null, memo: v.memo || null })
        setBundle(b => b ? { ...b, file: { ...b.file, name: v.name.trim(), effective_on: v.effective_on || null, memo: v.memo || null } } : b); setModal(null); touch(); reloadFiles()
      } else if (modal.kind === 'unit-new' && bundle) {
        const sib = bundle.units.filter(u => u.parent_unit_id === modal.parentId)
        const u = await insertOrgUnit({ file_id: bundle.file.id, parent_unit_id: modal.parentId, name: v.name.trim(), code: v.code.trim() || null, sort_order: sib.length })
        setBundle(b => b ? { ...b, units: [...b.units, u] } : b); setModal(null); touch()
      } else if (modal.kind === 'unit-move') {
        if (!v.target) throw new Error('대상 단위를 선택하세요.')
        await onDropUnit(modal.unit.id, v.target === '__root__' ? null : v.target); setModal(null)
      } else if (modal.kind === 'unit-rename') {
        await updateOrgUnit(modal.unit.id, { name: v.name.trim(), code: v.code.trim() || null, azure_division: v.azure_division.trim() || null }); await mergeUnit(modal.unit.id); setModal(null); refreshRoster()
      } else if (modal.kind === 'vacancy' && bundle) {
        const c = await insertOrgCard({ file_id: bundle.file.id, unit_id: modal.unitId, is_vacancy: true, display_name: v.name.trim() || '공석' }, v.job ? [v.job] : [])
        await mergeCard(c.id); setModal(null)
      } else if (modal.kind === 'person-new' && bundle) {   // ← [Phase 4-A] 입사예정자 = org_persons + 카드 + hire_planned 상태
        const pr = await insertOrgPerson({ name: v.name.trim(), email: v.email.trim() || null, planned_start_on: v.start_on || null, created_by: currentUserId })
        const c = await insertOrgCard({ file_id: bundle.file.id, unit_id: modal.unitId, person_id: pr.id }, v.job ? [v.job] : [])
        setBundle(b => b ? { ...b, persons: [...b.persons, pr] } : b)
        await mergeCard(c.id)
        if (v.start_on) { await setOrgPersonStatus(null, pr.id, 'hire_planned', { start_on: v.start_on }); await onStatusChanged() }
        setModal(null); setSelectedCard(c.id)
      }
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  // ── 미배치 ──
  const unassigned = useMemo(() => {
    if (!bundle) return []
    const placed = new Set(bundle.cards.map(c => c.profile_id).filter(Boolean))
    const today = todayKST()
    // [Phase 5-B] 퇴사 예정일이 지난 사람은 미배치가 아니라 퇴사자 (org_roster_check 와 동일 규칙)
    const gone = (u: AppUser) => {
      if (u.employment_status === 'departing' && u.departure_scheduled_on && u.departure_scheduled_on <= today) return true
      const st = statusBySubject.get(u.user_id); const cat = st ? statusTypeMap.get(st.status_code)?.category : null
      return cat === 'departing' && !!st?.end_on && st.end_on <= today
    }
    return users.filter(u => u.employee_id && !placed.has(u.user_id) && !gone(u)).sort((a, b) => (a.dept ?? '').localeCompare(b.dept ?? '') || a.name.localeCompare(b.name, 'ko'))
  }, [bundle, users])

  const showRoster = (r: OrgRosterCheck | null) => {
    if (!r) { showToast('검증 결과를 불러오는 중입니다.'); return }
    const names = (xs: { name?: string; departed_name?: string | null }[]) => xs.slice(0, 5).map(x => x.name ?? x.departed_name ?? '?').join(', ') + (xs.length > 5 ? ` 외 ${xs.length - 5}` : '')
    showToast(`로스터 누락 ${r.missing_count}${r.missing_count ? ` (${names(r.missing)})` : ''} · 유령 카드 ${r.ghost_count}${r.ghost_count ? ` (${names(r.ghosts)})` : ''} · Division 불일치 ${r.division_mismatch_count}${r.division_mismatch_count ? ` (${names(r.division_mismatch)})` : ''}`)
  }

  if (isMobile) return <div style={{ padding: 24, color: OG.quiet, fontFamily: OG.font, fontSize: 13 }}>조직도 편집은 데스크톱에서 이용해 주세요.</div>

  const jobOptions = [{ value: '', label: '(직무 없음)' }, ...codes.jobs.filter(j => j.is_active).map(j => ({ value: j.id, label: j.code }))]
  const modalEl = modal && (() => {
    if (modal.kind === 'new') {
      const hasActive = files.some(f => f.status === 'active')
      const fields: PromptField[] = [
        { key: 'name', label: '조직도 이름', required: true, placeholder: '예: 2026-11 조직개편(안)' },
        { key: 'effective_on', label: '적용일(발령일)', type: 'date', help: 'Active 지정 전까지는 비워 둘 수 있습니다' },
        { key: 'source', label: '시작', type: 'select', options: [...(hasActive ? [{ value: 'copy', label: '현재 Active 조직도 복사' }] : []), { value: 'empty', label: '빈 파일 (루트 단위 1개)' }] },
      ]
      return <OrgPromptModal title="새 조직도" fields={fields} initial={{ source: hasActive ? 'copy' : 'empty' }} confirmLabel="만들기" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    }
    if (modal.kind === 'copy') return <OrgPromptModal title={`복사 — ${modal.src.name}`} fields={[{ key: 'name', label: '새 이름', required: true }, { key: 'effective_on', label: '적용일', type: 'date' }]} initial={{ name: `${modal.src.name} (복사)` }} confirmLabel="복사" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    if (modal.kind === 'meta' && bundle) return <OrgPromptModal title="파일 정보" fields={[{ key: 'name', label: '이름', required: true }, { key: 'effective_on', label: '적용일', type: 'date' }, { key: 'memo', label: '메모' }]} initial={{ name: bundle.file.name, effective_on: bundle.file.effective_on ?? '', memo: bundle.file.memo ?? '' }} loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    if (modal.kind === 'unit-new') return <OrgPromptModal title={modal.parentId ? '하위 단위 추가' : '최상위 단위 추가'} fields={[{ key: 'name', label: '단위 이름', required: true }, { key: 'code', label: '약칭(code)', placeholder: '예: CO1-1 · 파일 안에서 유일' }]} confirmLabel="추가" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    if (modal.kind === 'unit-rename') return <OrgPromptModal title="단위 편집" fields={[{ key: 'name', label: '단위 이름', required: true }, { key: 'code', label: '약칭(code)' }, { key: 'azure_division', label: 'Azure Division 매핑', help: '교차검증용 — profiles.dept 와 비교할 값 (예: CO). 하위 단위는 가장 가까운 상위 값을 상속' }]} initial={{ name: modal.unit.name, code: modal.unit.code ?? '', azure_division: modal.unit.azure_division ?? '' }} loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    if (modal.kind === 'unit-move' && bundle) {
      const ex = new Set([modal.unit.id, ...descendantIds(modal.unit.id, bundle.units)])
      const opts: { value: string; label: string }[] = []
      const walk = (parent: string | null, depth: number) => bundle.units.filter(x => x.parent_unit_id === parent).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko'))
        .forEach(x => { if (!ex.has(x.id)) opts.push({ value: x.id, label: `${'\u00a0\u00a0'.repeat(depth)}${x.name}${x.id === modal.unit.parent_unit_id ? ' (현재 상위)' : ''}` }); walk(x.id, depth + 1) })
      walk(null, 0)
      return <OrgPromptModal title={`'${modal.unit.name}' 이동 — 어느 단위 아래로?`} fields={[{ key: 'target', label: '대상 단위', type: 'select', options: [{ value: '', label: '(선택)' }, ...opts], required: true, help: '선택한 단위의 하위 끝으로 들어갑니다. 하위 단위·카드는 함께 이동. 순서는 ↑↓ 로 조정' }]} confirmLabel="이동" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    }
    if (modal.kind === 'vacancy') return <OrgPromptModal title="공석(TO) 추가" fields={[{ key: 'name', label: '표기', placeholder: '예: 공석 · CRA' }, { key: 'job', label: '직무', type: 'select', options: jobOptions }]} confirmLabel="추가" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    if (modal.kind === 'person-new') return <OrgPromptModal title="입사 예정자 추가" fields={[{ key: 'name', label: '이름', required: true }, { key: 'email', label: '회사 이메일', placeholder: 'sync 시 이 이메일로 프로필을 자동 연결', help: '입사 후 Azure 계정이 생기면 sync-all-users 가 같은 이메일의 profile 과 자동 연결합니다' }, { key: 'start_on', label: '입사일', type: 'date', help: '입력하면 입사예정 상태가 함께 등록됩니다' }, { key: 'job', label: '직무', type: 'select', options: jobOptions }]} confirmLabel="추가" loading={busy} onConfirm={submitModal} onClose={() => setModal(null)} />
    return null
  })()

  return (
    <>
      {fileId && bundle ? (
        <OrgCanvas file={bundle.file} units={bundle.units} cards={bundle.cards} users={users} ranks={ranks} jobs={jobs} statusTypes={codes.statusTypes}
                   person={person} badge={badge} categoryOf={categoryOf} roster={roster} editable={editable} isSuper={isSuper} lockHolder={lockHolder} savedAt={savedAt}
                   selectedCard={selectedCard} unassigned={unassigned} departedOf={departedOf} isHidden={isHidden}
                   onBack={goGallery} onCopy={() => setModal({ kind: 'copy', src: bundle.file })} onActivate={() => onActivate(bundle.file)} onRoster={() => showRoster(roster)} onExport={() => onExport(bundle.file)}
                   onEditMeta={() => editable || bundle.file.status === 'active' ? setModal({ kind: 'meta' }) : showToast('지난 조직도는 수정할 수 없습니다.')}
                   onCardClick={c => setSelectedCard(c.id)}
                   onHistory={() => setHistory({ file: bundle.file, tab: 'log' })} onAddPerson={unitId => setModal({ kind: 'person-new', unitId })}
                   onAddUnit={parentId => setModal({ kind: 'unit-new', parentId })} onRenameUnit={u => setModal({ kind: 'unit-rename', unit: u })} onDeleteUnit={onDeleteUnit} onMoveUnit={onMoveUnit}
                   onAddVacancy={unitId => setModal({ kind: 'vacancy', unitId })} onOutdentUnit={onOutdentUnit} onIndentUnit={onIndentUnit} onMoveUnitTo={onMoveUnitTo}
                   onDropCard={onDropCard} onDropUnit={onDropUnit} onDropProfile={onDropProfile} />
      ) : fileId ? (
        <div style={{ padding: 40, color: OG.quiet, fontFamily: OG.font }}>불러오는 중…</div>
      ) : (
        <OrgGallery files={files} users={users} isSuper={isSuper} activeBundle={activeBundle} statuses={statuses} statusTypes={codes.statusTypes} roster={activeRoster} onRoster={() => showRoster(activeRoster)} loading={loading}
                    onOpen={f => openFile(f.id)} onCopy={f => setModal({ kind: 'copy', src: f })} onActivate={f => onActivate(f)} onDelete={onDelete} onNew={() => setModal({ kind: 'new' })}
                    onHistory={() => setHistory({ file: null, tab: 'log' })} onDiff={f => setHistory({ file: f, tab: 'diff' })}
                    onExport={onExport} onCodes={() => setCodesOpen(true)} />
      )}
      {modalEl}
      {selected && bundle && (
        <OrgCardDrawer card={selected} person={person(selected)} units={bundle.units} cards={bundle.cards} users={users} ranks={codes.ranks} jobs={codes.jobs} statusTypes={codes.statusTypes}
                       templates={templates} status={statusOf(selected)} editable={editable} currentUserId={currentUserId} personName={c => person(c).name}
                       onPatch={onCardPatch} onSetJobs={onCardJobs} onDelete={onCardDelete} onStatusChanged={onStatusChanged} onDisplayName={onDisplayName}
                       departedInfo={departedOf(selected)} onAddConcurrent={onAddConcurrent} onSwapPrimary={onSwapPrimary} onToggleHidden={() => onToggleHidden(selected)} onSelectCard={id => setSelectedCard(id)}
                       onClose={() => setSelectedCard(null)} showToast={showToast} />
      )}
      {history && (
        <OrgHistoryDrawer file={history.file} files={files} units={bundle?.units ?? activeBundle?.units ?? []} users={users} ranks={codes.ranks} jobs={codes.jobs} statusTypes={codes.statusTypes}
                          cardName={id => { const c = bundle?.cards.find(x => x.id === id) ?? activeBundle?.cards.find(x => x.id === id); return c ? person(c).name : '(제거된 카드)' }}
                          initialTab={history.tab} onClose={() => setHistory(null)} />
      )}
      {codesOpen && <OrgCodesPanel onClose={() => setCodesOpen(false)} onChanged={reloadCodes} showToast={showToast} initial={{ ranks: codes.ranks, jobs: codes.jobs, statusTypes: codes.statusTypes, templates }} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.label} variant={confirm.variant} loading={busy} onConfirm={runConfirm} onClose={() => !busy && setConfirm(null)} />}
    </>
  )
}
