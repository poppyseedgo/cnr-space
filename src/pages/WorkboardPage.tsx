/**
 * WorkboardPage.tsx — Work Space (WORKBOARD) · MS팀 업무보드
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-F] 사람 선택 통일 — members(wb_list_members) 1회 로드 → WbPersonPicker 로 담당자 필터·업무 담당자·주/부 담당.
 *      users(전 직원) 는 표시 룩업(퇴사·권한 회수자 이름)에만 쓴다. 담당자 필터는 멤버 ∪ 담당 이력자(하단 구분)
 *  - [2026-09-30 WORKBOARD P3-E] '마일스톤' 탭(MilestonesView + MilestoneDrawer) · '분장표' 탭 신설(AreasView) — 마지막 탭, 미리보기 승인분
 *      · 분장표 = 업무영역 관리를 별도 6번째 탭으로 승격(고지 확정). 삭제 없음·비활성화만. 순서 = wb_reorder_work_areas
 *      · 마일스톤 쓰기 = wb_upsert_milestone / wb_set_milestone_status / wb_delete_milestone(연결 0건만, HAS_LINKS)
 *      · 변경 후 단건 재조회(refreshMilestone / refreshArea) — SSOT 원칙 동일. 이력은 뷰가 지연 로드
 *      · 타임라인 마일스톤 바 클릭 → 마일스톤 탭으로 이동(선택 상태)
 *  - [2026-09-30 WORKBOARD P3-D] '일정' 탭 구현 — 월 그리드(MonthGridView) + 타임라인(TimelineView, 줌 주/월/분기 · 업무영역별/마일스톤별)
 *      · 타임라인 바 드래그 = wb_set_task_dates RPC(20260930 phase3d) → refreshTask. start_on 컬럼 신설
 *      · 툴바(모드·줌·그룹·기간 내비)는 페이지 헤더 아래 카드 상단에 — 회의실 CalendarShell 툴바와 같은 자리
 *  - [2026-09-30 WORKBOARD P3-C] '이슈보드' 탭 구현 (IssueBoardView + IssueDrawer, 미리보기 승인분)
 *      · issues 상태 신설(진입 시 tasks 와 함께 1회 로드, 최근 30일 + 미해결 전부). 상태 이동·필드 저장 = wb_upsert_issue
 *      · 업무로 전환 = wb_convert_issue_to_task RPC(20260930 phase3c) → 생성된 업무 refreshTask 로 tasks 에 합류
 *      · 빠른 등록 기본 심각도 medium(고지 확정). 전환·이슈 드로어에서 '업무 열기' → TaskDrawer 로 스위치
 *  - [2026-09-29 WORKBOARD P3-B] '내 업무' 탭 구현 (MyTasksView, 미리보기 승인분) + 상태 변경·삭제 성공 토스트(WB_TOAST)
 *  - [2026-09-29 WORKBOARD P3-A] 보드(칸반) + 상세 드로어 구현 (미리보기 승인분).
 *      · 탭 셸: 보드 / 일정 / 마일스톤 / 이슈보드 / 내 업무 — 보드만 구현, 나머지는 '준비 중' 패널(3-B~E 에서 순차 교체)
 *      · 데이터: 진입 시 areas·milestones·tasks 1회 로드(마스터 원칙). Realtime 없음 — 변경 후 단건 재조회(loadWbTaskById)
 *      · 상태 변경(드래그·드로어 세그먼트) = wb_set_task_status, 그 외 필드 = wb_upsert_task. 실패 시 토스트 + 원상 유지
 *      · 필터(담당자·업무영역·마감 프리셋·반복 포함)는 세션 상태 — 해시 저장 안 함
 *  - [2026-09-29 WORKBOARD P2] 임시 페이지 (라우팅·권한 게이트 검증용)
 *
 * 권한: App.tsx 가 canWorkboard 로 게이트. 이 컴포넌트는 판정하지 않는다
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCw } from 'lucide-react'
import type { AppUser, WbTask, WbTaskStatus, WbWorkArea, WbMilestone, WbTaskUpsertInput, WbIssue, WbIssueStatus, WbIssueSeverity, WbIssueUpsertInput, WbMilestoneStatus, WbMilestoneUpsertInput, WbWorkAreaUpsertInput, WbMember } from '../types'  // ← [P3-C] 이슈 타입 · [P3-E] 마일스톤·영역
import { BoardView } from '../components/workboard/BoardView'
import { TaskDrawer, type DrawerTask } from '../components/workboard/TaskDrawer'
import { WB, WB_TOAST, DUE_PRESETS, matchesDuePreset, useUserLookup, wbStatusLabel, type DuePreset } from '../components/workboard/wbShared'  // ← [2026-09-29 P3-B] WB_TOAST·wbStatusLabel
import { MyTasksView } from '../components/workboard/MyTasksView'  // ← [2026-09-29 P3-B] 내 업무
import { IssueBoardView } from '../components/workboard/IssueBoardView'  // ← [2026-09-30 P3-C] 이슈보드
import { TimelineView, type TimelineGroupBy } from '../components/workboard/TimelineView'  // ← [2026-09-30 P3-D]
import { MonthGridView } from '../components/workboard/MonthGridView'  // ← [2026-09-30 P3-D]
import { TIMELINE_ZOOMS, timelineRangeStart, timelineShift, timelineRangeEnd, fmtYmdShort, type TimelineZoom } from '../components/workboard/wbShared'  // ← [2026-09-30 P3-D]
import { ChevronLeft, ChevronRight } from 'lucide-react'  // ← [2026-09-30 P3-D] 일정 내비
import { IssueDrawer, type DrawerIssue } from '../components/workboard/IssueDrawer'  // ← [2026-09-30 P3-C]
import { WB_ISSUE_TOAST, WB_SEVERITIES, wbIssueStatusLabel } from '../components/workboard/wbShared'  // ← [2026-09-30 P3-C]
import {
  loadWbAreas, loadWbMilestones, loadWbTasks, loadWbTaskById, upsertWbTask, setWbTaskStatus, deleteWbTask, wbErrorMessage,
  loadWbIssues, loadWbIssueById, upsertWbIssue, convertWbIssueToTask, deleteWbIssue,   // ← [2026-09-30 P3-C]
  setWbTaskDates,   // ← [2026-09-30 P3-D]
} from '../lib/workboardApi'
import { todayStr } from '../utils/time'  // ← [2026-09-30 P3-C] 빠른 등록 occurred_on
import { MilestonesView } from '../components/workboard/MilestonesView'   // ← [2026-09-30 P3-E]
import { WbPersonPicker } from '../components/workboard/WbPersonPicker'   // ← [2026-09-30 P3-F]
import { MilestoneDrawer } from '../components/workboard/MilestoneDrawer' // ← [2026-09-30 P3-E]
import { AreasView, type AreaEditor } from '../components/workboard/AreasView'  // ← [2026-09-30 P3-E]
import { WB_MS_TOAST, WB_AREA_TOAST, wbMsStatusDef } from '../components/workboard/wbShared'  // ← [2026-09-30 P3-E]
import { loadWbMilestoneById, loadWbAreaById, upsertWbMilestone, setWbMilestoneStatus, deleteWbMilestone, upsertWbArea, reorderWbAreas, loadWbTemplateCounts, loadWbMembers } from '../lib/workboardApi'  // ← [2026-09-30 P3-E] · [P3-F] loadWbMembers

type WbTab = 'board' | 'calendar' | 'milestones' | 'issues' | 'areas' | 'mine'
const TABS: { id: WbTab; label: string }[] = [
  { id: 'board',      label: '보드' },
  { id: 'calendar',   label: '일정' },
  { id: 'milestones', label: '마일스톤' },
  { id: 'issues',     label: '이슈보드' },
  { id: 'areas',      label: '분장표' },     // ← [P3-E] 업무영역 = 업무분장표 (포스트잇 1번 항목 → 별도 탭, 고지 확정)
  { id: 'mine',       label: '내 업무' },
]

interface Props {
  users:      AppUser[]
  authUserId: string
  showToast:  (msg: string) => void
}

export function WorkboardPage({ users, authUserId, showToast }: Props) {
  const [tab, setTab] = useState<WbTab>('board')
  const [areas, setAreas]           = useState<WbWorkArea[]>([])
  const [milestones, setMilestones] = useState<WbMilestone[]>([])
  const [tasks, setTasks]           = useState<WbTask[]>([])
  const [loading, setLoading]       = useState(true)
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [members, setMembers]       = useState<WbMember[]>([])   // ← [P3-F] 사람 선택 풀
  const lookup = useUserLookup(users, members)

  // 필터
  const [fAssignee, setFAssignee] = useState<'all' | 'me' | string>('all')
  const [fArea, setFArea]         = useState<'all' | string>('all')
  const [fDue, setFDue]           = useState<DuePreset>('all')
  const [fRecur, setFRecur]       = useState(true)

  // 일정 (← [P3-D])
  const [calMode, setCalMode]   = useState<'grid' | 'timeline'>('timeline')
  const [calZoom, setCalZoom]   = useState<TimelineZoom>('month')
  const [calGroup, setCalGroup] = useState<TimelineGroupBy>('area')
  const [calAnchor, setCalAnchor] = useState<string>(todayStr())
  const calStart = calMode === 'grid' ? calAnchor.slice(0, 7) + '-01' : timelineRangeStart(calAnchor, calZoom)
  const calEnd   = calMode === 'grid' ? new Date(Date.UTC(Number(calAnchor.slice(0, 4)), Number(calAnchor.slice(5, 7)), 0)).toISOString().slice(0, 10) : timelineRangeEnd(calStart, calZoom)
  const calNav = (dir: 1 | -1) => setCalAnchor(a => calMode === 'grid' ? timelineShift(a, 'month', dir) : timelineShift(a, calZoom, dir))
  const calTitle = calMode === 'grid' || calZoom === 'month'
    ? `${calStart.slice(0, 4)}년 ${Number(calStart.slice(5, 7))}월`
    : calZoom === 'week' ? `${fmtYmdShort(calStart)} – ${fmtYmdShort(calEnd)}`
    : `${calStart.slice(0, 4)}년 ${Number(calStart.slice(5, 7))}월 – ${calEnd.slice(0, 4)}년 ${Number(calEnd.slice(5, 7))}월`

  // 내 업무 토글 (← [P3-B] 헤더 우측에 렌더하므로 페이지가 소유)
  const [mineShowDone, setMineShowDone] = useState(false)
  const [mineRecur, setMineRecur]       = useState(true)

  // 드로어
  const [drawer, setDrawer]   = useState<DrawerTask | null>(null)
  const [saving, setSaving]   = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)

  // ── 이슈 (← [P3-C]) ──
  const [issues, setIssues]           = useState<WbIssue[]>([])
  const [issueDrawer, setIssueDrawer] = useState<DrawerIssue | null>(null)
  const [issueMovingId, setIssueMovingId] = useState<string | null>(null)
  const [fSev, setFSev]   = useState<'all' | WbIssueSeverity>('all')
  const [fIssueMs, setFIssueMs] = useState<'all' | string>('all')
  const [fIssueDays, setFIssueDays] = useState<30 | 90 | 365>(30)

  // ── 마일스톤 · 분장표 (← [P3-E]) ──
  const [msSelected, setMsSelected]   = useState<string | null>(null)
  const [msShowClosed, setMsShowClosed] = useState(false)
  const [msDrawer, setMsDrawer]       = useState<{ open: true; milestone: WbMilestone | null } | null>(null)
  const [areaEditor, setAreaEditor]   = useState<AreaEditor>(null)
  const [areaShowInactive, setAreaShowInactive] = useState(false)
  const [templateCounts, setTemplateCounts] = useState<Map<string, number>>(new Map())
  const [wbBusy, setWbBusy]           = useState(false)   // 마일스톤·영역 RPC 진행 중 (버튼 잠금)

  const loadAll = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const [a, m, t, i, tc, mem] = await Promise.all([loadWbAreas(), loadWbMilestones(), loadWbTasks(), loadWbIssues(365), loadWbTemplateCounts(), loadWbMembers()])  // ← [P3-C] 이슈는 1년치 · [P3-E] 템플릿 수 · [P3-F] 멤버 풀
      setAreas(a); setMilestones(m); setTasks(t); setIssues(i); setTemplateCounts(tc); setMembers(mem)
    } catch (e) { setLoadError(wbErrorMessage(e, '데이터를 불러오지 못했습니다')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void loadAll() }, [loadAll])

  /** 단건 재조회로 목록·드로어 동기화 (SSOT = DB) */
  const refreshTask = useCallback(async (id: string): Promise<WbTask | null> => {
    const fresh = await loadWbTaskById(id)
    if (!fresh) { setTasks(prev => prev.filter(t => t.id !== id)); setDrawer(d => (d?.id === id ? null : d)); return null }
    setTasks(prev => prev.some(t => t.id === id) ? prev.map(t => t.id === id ? fresh : t) : [fresh, ...prev])
    setDrawer(d => (d?.id === id ? fresh : d))
    return fresh
  }, [])

  // ── 필터 적용 ──
  const filtered = useMemo(() => tasks.filter(t => {
    if (fAssignee === 'me' && !t.assignee_ids.includes(authUserId)) return false
    if (fAssignee !== 'all' && fAssignee !== 'me' && !t.assignee_ids.includes(fAssignee)) return false
    if (fArea !== 'all' && t.area_id !== fArea) return false
    if (!fRecur && t.template_id) return false
    if (tab === 'board' && !matchesDuePreset(t.due_at, fDue, t.status)) return false   // ← [P3-D] 마감 프리셋은 보드에서만 (일정 탭은 기간 자체가 축)
    return true
  }), [tasks, fAssignee, fArea, fDue, fRecur, authUserId, tab])

  // ← [P3-F] 담당자 필터 = 멤버(Picker 풀) ∪ 담당 이력만 있는 비멤버(하단 구분, 건수 표시)
  const assigneeExtras = useMemo(() => {
    const memberIds = new Set(members.map(m => m.user_id)); const cnt = new Map<string, number>()
    for (const t of tasks) for (const id of t.assignee_ids) if (!memberIds.has(id)) cnt.set(id, (cnt.get(id) ?? 0) + 1)
    return [...cnt.entries()].map(([id, n]) => ({ id, note: `${n}건` })).sort((a, b) => lookup(a.id).name.localeCompare(lookup(b.id).name, 'ko'))
  }, [tasks, members, lookup])

  // ── 핸들러 ──
  const openNew = (status: WbTaskStatus = 'todo', milestoneId: string | null = null) => {   // ← [P3-E] 마일스톤 미리 선택
    const now = new Date().toISOString()
    setDrawer({
      id: null, area_id: areas.find(a => a.is_active)?.id ?? '', milestone_id: milestoneId, template_id: null, period_key: null,
      title: '', description: null, status, priority: 'normal', due_at: null, start_on: null, checklist: [],
      created_by: authUserId, created_at: now, updated_at: now, completed_at: null, completed_by: null, assignee_ids: [],
    })
  }

  const handleSave = async (input: WbTaskUpsertInput) => {
    setSaving(true)
    try {
      const id = await upsertWbTask(input)
      const wasDraft = input.id === null
      let fresh = await refreshTask(id)
      if (wasDraft) {
        // 드래프트에서 만든 경우 시작 열이 todo 가 아니면 상태도 맞춘다 (보드 '+ 업무 추가' 열 기준)
        const startStatus = drawer?.status
        if (startStatus && startStatus !== 'todo') { await setWbTaskStatus(id, startStatus); fresh = await refreshTask(id) }
        // 드로어를 draft(id null) → 생성된 업무(existing 모드)로 교체 — refreshTask 의 id 매칭은 draft 를 못 잡는다
        if (fresh) setDrawer(fresh)
        showToast(WB_TOAST.created)
      }
    } catch (e) {
      if (input.id) await refreshTask(input.id).catch(() => {})   // 실패 → DB 상태로 폼 복구
      throw e
    } finally { setSaving(false) }
  }

  const handleSetStatus = async (id: string, status: WbTaskStatus) => {
    const prev = tasks.find(t => t.id === id)?.status
    setMovingId(id)
    try {
      await setWbTaskStatus(id, status)
      await refreshTask(id)
      showToast(status === 'done' ? WB_TOAST.completed : WB_TOAST.statusMoved(wbStatusLabel(status)))  // ← [P3-B] 완료 시점 토스트
    } catch (e) {
      showToast(wbErrorMessage(e, '상태 변경에 실패했습니다'))
      if (prev) setTasks(ts => ts.map(t => t.id === id ? { ...t, status: prev } : t))
      throw e
    } finally { setMovingId(null) }
  }

  /** ← [P3-D] 타임라인 드래그 — 날짜만 갱신 */
  const handleMoveDates = async (id: string, startOn: string | null, dueAt: string | null) => {
    const prev = tasks.find(t => t.id === id); if (!prev) return
    setMovingId(id)
    try {
      await setWbTaskDates(id, startOn, dueAt)
      await refreshTask(id)
      const from = prev.start_on ? `${fmtYmdShort(prev.start_on)}~` : ''
      const to = startOn ? `${fmtYmdShort(startOn)}~` : ''
      showToast(WB_TOAST.datesMoved(`${from}${prev.due_at ? fmtYmdShort(prev.due_at.slice(0, 10)) : '미정'}`, `${to}${dueAt ? fmtYmdShort(dueAt.slice(0, 10)) : '미정'}`))
    } catch (e) { showToast(wbErrorMessage(e, '일정 변경에 실패했습니다')) }
    finally { setMovingId(null) }
  }

  const handleDelete = async (id: string) => {
    const ok = await deleteWbTask(id)
    if (!ok) { showToast('할 일 상태의 업무만 삭제할 수 있습니다'); return }
    setTasks(prev => prev.filter(t => t.id !== id)); setDrawer(null); showToast(WB_TOAST.deleted)
  }

  // ── 이슈 핸들러 (← [P3-C]) ──
  const refreshIssue = useCallback(async (id: string): Promise<WbIssue | null> => {
    const fresh = await loadWbIssueById(id)
    if (!fresh) { setIssues(prev => prev.filter(i => i.id !== id)); setIssueDrawer(d => (d?.id === id ? null : d)); return null }
    setIssues(prev => prev.some(i => i.id === id) ? prev.map(i => i.id === id ? fresh : i) : [fresh, ...prev])
    setIssueDrawer(d => (d?.id === id ? fresh : d))
    return fresh
  }, [])

  const filteredIssues = useMemo(() => {
    const since = new Date(Date.now() - fIssueDays * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    return issues.filter(i => {
      if (fSev !== 'all' && i.severity !== fSev) return false
      if (fIssueMs !== 'all' && i.milestone_id !== fIssueMs) return false
      // 미해결은 기간 무관, 해결·보류만 기간 안
      if ((i.status === 'resolved' || i.status === 'wontfix') && i.occurred_on < since) return false
      return true
    })
  }, [issues, fSev, fIssueMs, fIssueDays])

  const openNewIssue = () => {
    const now = new Date().toISOString()
    setIssueDrawer({ id: null, task_id: null, milestone_id: null, converted_task_id: null, title: '', description: null, severity: 'medium', status: 'open',
      occurred_on: todayStr(), reporter_id: authUserId, resolved_at: null, resolved_by: null, created_at: now, updated_at: now })
  }

  const handleIssueSave = async (input: WbIssueUpsertInput) => {
    setSaving(true)
    try {
      const id = await upsertWbIssue(input)
      const fresh = await refreshIssue(id)
      if (input.id === null) { if (fresh) setIssueDrawer(fresh); showToast(WB_ISSUE_TOAST.created) }
    } catch (e) {
      if (input.id) await refreshIssue(input.id).catch(() => {})
      throw e
    } finally { setSaving(false) }
  }

  /** 빠른 등록 — 제목·심각도만, 나머지 RPC 기본값(open · KST 오늘 · reporter=auth.uid) */
  const handleQuickIssue = async (title: string, severity: WbIssueSeverity) => {
    try {
      const id = await upsertWbIssue({ id: null, title, description: null, severity, status: 'open', task_id: null, milestone_id: null, occurred_on: null })
      await refreshIssue(id)
      showToast(WB_ISSUE_TOAST.quickCreated(title))
    } catch (e) { showToast(wbErrorMessage(e, '이슈 등록에 실패했습니다')) }
  }

  const handleIssueMove = async (id: string, status: WbIssueStatus) => {
    const cur = issues.find(i => i.id === id); if (!cur) return
    setIssueMovingId(id)
    try {
      await upsertWbIssue({ id, title: cur.title, description: cur.description, severity: cur.severity, status, task_id: cur.task_id, milestone_id: cur.milestone_id, occurred_on: cur.occurred_on })
      await refreshIssue(id)
      showToast(status === 'resolved' ? WB_ISSUE_TOAST.resolved : WB_ISSUE_TOAST.statusMoved(wbIssueStatusLabel(status)))
    } catch (e) { showToast(wbErrorMessage(e, '상태 변경에 실패했습니다')) }
    finally { setIssueMovingId(null) }
  }

  const handleIssueConvert = async (issueId: string, areaId: string) => {
    setSaving(true)
    try {
      const { taskId } = await convertWbIssueToTask(issueId, areaId)
      await Promise.all([refreshIssue(issueId), refreshTask(taskId)])
      showToast(WB_ISSUE_TOAST.converted)
    } finally { setSaving(false) }
  }

  const handleIssueDelete = async (id: string) => {
    const ok = await deleteWbIssue(id)
    if (!ok) { showToast("'열림' 상태의 이슈만 삭제할 수 있습니다"); return }
    setIssues(prev => prev.filter(i => i.id !== id)); setIssueDrawer(null); showToast(WB_ISSUE_TOAST.deleted)
  }

  // ── 마일스톤 핸들러 (← [P3-E]) ──
  const refreshMilestone = useCallback(async (id: string): Promise<WbMilestone | null> => {
    const fresh = await loadWbMilestoneById(id)
    if (!fresh) { setMilestones(prev => prev.filter(m => m.id !== id)); setMsSelected(s => (s === id ? null : s)); return null }
    setMilestones(prev => prev.some(m => m.id === id) ? prev.map(m => m.id === id ? fresh : m) : [...prev, fresh])
    return fresh
  }, [])

  const handleMsSave = async (input: WbMilestoneUpsertInput) => {
    setSaving(true)
    try {
      const id = await upsertWbMilestone(input)
      await refreshMilestone(id)
      setMsDrawer(null); setMsSelected(id); setTab('milestones')
      showToast(input.id === null ? WB_MS_TOAST.created : WB_MS_TOAST.saved)
    } finally { setSaving(false) }
  }

  const handleMsStatus = async (id: string, status: WbMilestoneStatus) => {
    setWbBusy(true)
    try { await setWbMilestoneStatus(id, status); await refreshMilestone(id); showToast(WB_MS_TOAST.statusMoved(wbMsStatusDef(status).label)) }
    catch (e) { showToast(wbErrorMessage(e, '상태 변경에 실패했습니다')) }
    finally { setWbBusy(false) }
  }

  const handleMsDelete = async (id: string) => {
    setWbBusy(true)
    try { await deleteWbMilestone(id); setMilestones(prev => prev.filter(m => m.id !== id)); setMsSelected(null); showToast(WB_MS_TOAST.deleted) }
    catch (e) { showToast(wbErrorMessage(e, '삭제에 실패했습니다')) }
    finally { setWbBusy(false) }
  }

  /** 타임라인 마일스톤 바 → 마일스톤 탭 (선택 상태로) */
  const openMilestone = (m: WbMilestone) => { setMsSelected(m.id); if (m.status === 'done' || m.status === 'cancelled') setMsShowClosed(true); setTab('milestones') }

  // ── 업무영역(분장표) 핸들러 (← [P3-E]) ──
  const refreshArea = useCallback(async (id: string): Promise<WbWorkArea | null> => {
    const fresh = await loadWbAreaById(id)
    if (!fresh) { setAreas(prev => prev.filter(a => a.id !== id)); return null }
    // 순서(sort_order)가 바뀌었을 수 있으므로 병합 후 재정렬 — loadWbAreas 와 같은 키(sort_order, name)
    setAreas(prev => (prev.some(a => a.id === id) ? prev.map(a => a.id === id ? fresh : a) : [...prev, fresh]).sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name)))
    return fresh
  }, [])

  const handleAreaSave = async (input: WbWorkAreaUpsertInput) => {
    setWbBusy(true)
    try {
      const id = await upsertWbArea(input)
      await refreshArea(id)
      setAreaEditor({ mode: 'edit', id })
      showToast(input.id === null ? WB_AREA_TOAST.created(input.name) : WB_AREA_TOAST.saved(input.name))
    } finally { setWbBusy(false) }
  }

  const handleAreaToggle = async (a: WbWorkArea) => {
    const next = !a.is_active   // 토스트 문구는 호출 시점 값으로 고정 (await 뒤 참조 객체가 바뀌어도 무관)
    setWbBusy(true)
    try {
      await upsertWbArea({ id: a.id, name: a.name, description: a.description, primary_owner_id: a.primary_owner_id, backup_owner_id: a.backup_owner_id, sort_order: a.sort_order, is_active: next })
      await refreshArea(a.id)
      showToast(next ? WB_AREA_TOAST.activated(a.name) : WB_AREA_TOAST.deactivated(a.name))
    } catch (e) { showToast(wbErrorMessage(e, '변경에 실패했습니다')) }
    finally { setWbBusy(false) }
  }

  const handleAreaReorder = async (ids: string[]) => {
    setWbBusy(true)
    try { await reorderWbAreas(ids); setAreas(await loadWbAreas()); showToast(WB_AREA_TOAST.reordered) }   // 전체 재번호 → 전체 재조회 (색 인덱스도 함께 갱신)
    catch (e) { showToast(wbErrorMessage(e, '순서 변경에 실패했습니다')) }
    finally { setWbBusy(false) }
  }

  /** 이슈 드로어 → 업무 열기: 이슈 드로어 닫고 TaskDrawer 로 */
  const openTaskFromIssue = (taskId: string) => {
    const t = tasks.find(x => x.id === taskId)
    if (!t) { showToast('업무를 찾을 수 없습니다 (완료 90일 경과분은 보드에 없습니다)'); return }
    setIssueDrawer(null); setDrawer(t)
  }

  // ── 스타일 ──
  const chipSel: React.CSSProperties = {
    border: '1px solid #D1D7E1', background: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: WB.ink,
    fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
  }

  return (
    <div style={{ width: '100%', maxWidth: WB.pageMax, margin: '0 auto', padding: '24px 16px 40px', fontFamily: WB.font, color: WB.ink }}>
      {/* 상단 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, margin: 0, fontWeight: 700, letterSpacing: '0.3px' }}>Work Space</h1>
          <span style={{ fontSize: 11, fontWeight: 700, color: WB.accent, background: WB.accentBg, borderRadius: 999, padding: '3px 10px', letterSpacing: '0.6px' }}>MS</span>
          <div style={{ display: 'flex', gap: 4, background: '#F3F4F8', borderRadius: 999, padding: 4, marginLeft: 8 }}>
            {TABS.map(t => (
              <button key={t.id} className="btn" onClick={() => setTab(t.id)}
                style={{ padding: '10px 16px', borderRadius: 999, fontSize: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: tab === t.id ? WB.ink : '#fff', color: tab === t.id ? '#fff' : '#657487', fontWeight: tab === t.id ? 600 : 400 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'issues' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={fSev} onChange={e => setFSev(e.target.value as any)} style={{ ...chipSel, borderColor: fSev !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="심각도 필터">
              <option value="all">심각도 · 전체</option>
              {WB_SEVERITIES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={fIssueMs} onChange={e => setFIssueMs(e.target.value)} style={{ ...chipSel, borderColor: fIssueMs !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="마일스톤 필터">
              <option value="all">마일스톤 · 전체</option>
              {milestones.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
            <select value={fIssueDays} onChange={e => setFIssueDays(Number(e.target.value) as 30 | 90 | 365)} style={chipSel} aria-label="기간 필터">
              <option value={30}>기간 · 최근 30일</option>
              <option value={90}>기간 · 최근 90일</option>
              <option value={365}>기간 · 1년</option>
            </select>
            <button className="btn" onClick={openNewIssue} disabled={loading}
              style={{ background: WB.dueWarn, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
              + 이슈 등록
            </button>
          </div>
        )}
        {tab === 'milestones' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setMsShowClosed(v => !v)} style={{ ...chipSel, fontWeight: msShowClosed ? 600 : 400, borderColor: msShowClosed ? WB.ink : '#D1D7E1' }}>완료 포함</button>
            <button className="btn" onClick={() => setMsDrawer({ open: true, milestone: null })} disabled={loading}
              style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
              + 마일스톤 추가
            </button>
          </div>
        )}
        {tab === 'areas' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setAreaShowInactive(v => !v)} style={{ ...chipSel, fontWeight: areaShowInactive ? 600 : 400, borderColor: areaShowInactive ? WB.ink : '#D1D7E1' }}>비활성 포함</button>
            <button className="btn" onClick={() => setAreaEditor({ mode: 'new' })} disabled={loading}
              style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.5 : 1 }}>
              + 업무영역 추가
            </button>
          </div>
        )}
        {tab === 'mine' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setMineShowDone(false)} style={{ ...chipSel, fontWeight: !mineShowDone ? 600 : 400, borderColor: !mineShowDone ? WB.ink : '#D1D7E1' }}>미완료</button>
            <button className="btn" onClick={() => setMineShowDone(true)}  style={{ ...chipSel, fontWeight: mineShowDone ? 600 : 400, borderColor: mineShowDone ? WB.ink : '#D1D7E1' }}>완료 포함</button>
            <button className="btn" onClick={() => setMineRecur(v => !v)} title="반복 업무 포함/제외"
              style={{ ...chipSel, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, borderColor: mineRecur ? '#D1D7E1' : WB.ink, color: mineRecur ? WB.ink : WB.muted }}>
              <RotateCw size={13} /> 반복 {mineRecur ? '포함' : '제외'}
            </button>
          </div>
        )}
        {(tab === 'board' || tab === 'calendar') && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <WbPersonPicker mode="single" value={fAssignee === 'all' ? null : fAssignee === 'me' ? authUserId : fAssignee}
              onChange={id => setFAssignee(id === null ? 'all' : id === authUserId ? 'me' : id)}
              members={members} lookup={lookup} authUserId={authUserId} extras={assigneeExtras}
              allowAll={{ label: '전체', note: '필터 해제' }} placeholder="담당자 · 전체" ariaLabel="담당자 필터"
              style={{ minHeight: 38, width: 200, padding: '4px 10px', borderColor: fAssignee !== 'all' ? WB.ink : '#D1D7E1' }} />
            <select value={fArea} onChange={e => setFArea(e.target.value)} style={{ ...chipSel, borderColor: fArea !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="업무영역 필터">
              <option value="all">업무영역 · 전체</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {tab === 'board' && <select value={fDue} onChange={e => setFDue(e.target.value as DuePreset)} style={{ ...chipSel, borderColor: fDue !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="마감 필터">
              {DUE_PRESETS.map(p => <option key={p.id} value={p.id}>마감 · {p.label}</option>)}
            </select>}
            <button className="btn" onClick={() => setFRecur(v => !v)} title="반복 업무 포함/제외"
              style={{ ...chipSel, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, borderColor: fRecur ? '#D1D7E1' : WB.ink, color: fRecur ? WB.ink : WB.muted }}>
              <RotateCw size={13} /> 반복 {fRecur ? '포함' : '제외'}
            </button>
            <button className="btn" onClick={() => openNew('todo')} disabled={loading || areas.length === 0}
              style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: loading || areas.length === 0 ? 0.5 : 1 }}>
              + 업무 추가
            </button>
          </div>
        )}
      </div>

      {/* 본문 */}
      {loading ? (
        <div style={{ color: WB.muted, fontSize: 14, padding: 40, textAlign: 'center' }}>불러오는 중…</div>
      ) : loadError ? (
        <div style={{ color: '#B91C1C', fontSize: 14, padding: 40, textAlign: 'center' }}>{loadError} <button className="btn" onClick={() => void loadAll()} style={{ marginLeft: 8, textDecoration: 'underline', background: 'transparent', border: 'none', cursor: 'pointer', color: WB.ink }}>다시 시도</button></div>
      ) : tab === 'board' ? (
        <>
          {areas.length === 0 && (
            <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: '#92400E' }}>
              업무영역이 아직 없습니다 — 업무는 영역에 속해야 만들 수 있습니다.
              <button className="btn" onClick={() => { setTab('areas'); setAreaEditor({ mode: 'new' }) }} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#92400E', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>분장표 탭에서 추가 →</button>
            </div>
          )}
          <BoardView tasks={filtered} areas={areas} milestones={milestones} lookup={lookup}
            onOpenTask={t => setDrawer(t)} onNewTask={openNew} onMoveStatus={(id, to) => void handleSetStatus(id, to).catch(() => {})} movingId={movingId} />
        </>
      ) : tab === 'calendar' ? (
        <div>
          {/* 일정 툴바 — CalendarShell 툴바 자리·필 스타일 */}
          <div style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '12px 16px', borderBottom: `1px solid ${WB.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 2, background: '#F3F4F8', borderRadius: 999, padding: 3 }}>
                {([['grid', '월 그리드'], ['timeline', '타임라인']] as const).map(([id, label]) => (
                  <button key={id} className="btn" onClick={() => setCalMode(id)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: calMode === id ? WB.ink : 'transparent', color: calMode === id ? '#fff' : '#657487', fontWeight: calMode === id ? 600 : 400 }}>{label}</button>
                ))}
              </div>
              {calMode === 'timeline' && (
                <>
                  <div style={{ display: 'flex', gap: 2, background: '#F3F4F8', borderRadius: 999, padding: 3 }}>
                    {TIMELINE_ZOOMS.map(z => (
                      <button key={z.id} className="btn" onClick={() => setCalZoom(z.id)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: calZoom === z.id ? WB.ink : 'transparent', color: calZoom === z.id ? '#fff' : '#657487', fontWeight: calZoom === z.id ? 600 : 400 }}>{z.label}</button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 2, background: '#F3F4F8', borderRadius: 999, padding: 3 }}>
                    {([['area', '업무영역별'], ['milestone', '마일스톤별']] as const).map(([id, label]) => (
                      <button key={id} className="btn" onClick={() => setCalGroup(id)} style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12.5, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: calGroup === id ? WB.ink : 'transparent', color: calGroup === id ? '#fff' : '#657487', fontWeight: calGroup === id ? 600 : 400 }}>{label}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
              <button className="btn" onClick={() => calNav(-1)} aria-label="이전" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', display: 'flex', padding: 4 }}><ChevronLeft size={18} /></button>
              <span style={{ minWidth: 160, textAlign: 'center' }}>{calTitle}</span>
              <button className="btn" onClick={() => calNav(1)} aria-label="다음" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', display: 'flex', padding: 4 }}><ChevronRight size={18} /></button>
              <button className="btn" onClick={() => setCalAnchor(todayStr())} style={{ ...chipSel, padding: '5px 10px', fontSize: 12, fontWeight: 400, marginLeft: 4 }}>오늘</button>
            </div>
          </div>
          {calMode === 'grid' ? (
            <MonthGridView tasks={filtered} areas={areas} month={calStart} lookup={lookup} onOpenTask={t => setDrawer(t)} />
          ) : (
            <TimelineView tasks={filtered} areas={areas} milestones={milestones} lookup={lookup} rangeStart={calStart} zoom={calZoom} groupBy={calGroup}
              onOpenTask={t => setDrawer(t)} onMoveDates={handleMoveDates} movingId={movingId} onOpenMilestone={openMilestone} />
          )}
        </div>
      ) : tab === 'issues' ? (
        <IssueBoardView issues={filteredIssues} allIssues={issues} tasks={tasks} milestones={milestones} lookup={lookup}
          onOpenIssue={i => setIssueDrawer(i)} onQuickCreate={handleQuickIssue} onMoveStatus={(id, to) => void handleIssueMove(id, to)} movingId={issueMovingId} />
      ) : tab === 'milestones' ? (
        <MilestonesView milestones={milestones} tasks={tasks} issues={issues} areas={areas} lookup={lookup} showClosed={msShowClosed}
          selectedId={msSelected} onSelect={setMsSelected} onSetStatus={handleMsStatus} onEdit={m => setMsDrawer({ open: true, milestone: m })} onDelete={handleMsDelete}
          onAddTask={msId => openNew('todo', msId)} onOpenTask={t => setDrawer(t)} onOpenIssue={i => setIssueDrawer(i)} busy={wbBusy} />
      ) : tab === 'areas' ? (
        <AreasView areas={areas} tasks={tasks} templateCounts={templateCounts} members={members} authUserId={authUserId} lookup={lookup} showInactive={areaShowInactive}
          editor={areaEditor} onEditorChange={setAreaEditor} onSave={handleAreaSave} onToggleActive={handleAreaToggle} onReorder={handleAreaReorder} busy={wbBusy} />
      ) : tab === 'mine' ? (
        <MyTasksView tasks={tasks} areas={areas} milestones={milestones} authUserId={authUserId} lookup={lookup}
          onOpenTask={t => setDrawer(t)} onSetStatus={(id, s) => handleSetStatus(id, s).catch(() => {})} movingId={movingId}
          showDone={mineShowDone} withRecur={mineRecur} />
      ) : null}

      {msDrawer && (
        <MilestoneDrawer milestone={msDrawer.milestone} saving={saving} onClose={() => setMsDrawer(null)} onSave={handleMsSave} showToast={showToast} />
      )}
      {issueDrawer && (
        <IssueDrawer issue={issueDrawer} tasks={tasks} areas={areas} milestones={milestones} authUserId={authUserId} lookup={lookup}
          saving={saving} onClose={() => setIssueDrawer(null)} onSave={handleIssueSave} onConvert={handleIssueConvert} onOpenTask={openTaskFromIssue} onDelete={handleIssueDelete} showToast={showToast} />
      )}
      {drawer && (
        <TaskDrawer task={drawer} areas={areas} milestones={milestones} users={users} members={members} authUserId={authUserId} lookup={lookup}
          saving={saving} onClose={() => setDrawer(null)} onSave={handleSave} onSetStatus={handleSetStatus} onDelete={handleDelete} showToast={showToast} />
      )}
    </div>
  )
}
