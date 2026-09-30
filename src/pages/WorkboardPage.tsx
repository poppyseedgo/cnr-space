/**
 * WorkboardPage.tsx — Work Space (WORKBOARD) · MS팀 업무보드
 *
 * ✅ 변경 이력
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
import type { AppUser, WbTask, WbTaskStatus, WbWorkArea, WbMilestone, WbTaskUpsertInput } from '../types'
import { BoardView } from '../components/workboard/BoardView'
import { TaskDrawer, type DrawerTask } from '../components/workboard/TaskDrawer'
import { WB, WB_TOAST, DUE_PRESETS, matchesDuePreset, useUserLookup, wbStatusLabel, type DuePreset } from '../components/workboard/wbShared'  // ← [2026-09-29 P3-B] WB_TOAST·wbStatusLabel
import { MyTasksView } from '../components/workboard/MyTasksView'  // ← [2026-09-29 P3-B] 내 업무
import {
  loadWbAreas, loadWbMilestones, loadWbTasks, loadWbTaskById, upsertWbTask, setWbTaskStatus, deleteWbTask, wbErrorMessage,
} from '../lib/workboardApi'

type WbTab = 'board' | 'calendar' | 'milestones' | 'issues' | 'mine'
const TABS: { id: WbTab; label: string }[] = [
  { id: 'board',      label: '보드' },
  { id: 'calendar',   label: '일정' },
  { id: 'milestones', label: '마일스톤' },
  { id: 'issues',     label: '이슈보드' },
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
  const lookup = useUserLookup(users)

  // 필터
  const [fAssignee, setFAssignee] = useState<'all' | 'me' | string>('all')
  const [fArea, setFArea]         = useState<'all' | string>('all')
  const [fDue, setFDue]           = useState<DuePreset>('all')
  const [fRecur, setFRecur]       = useState(true)

  // 내 업무 토글 (← [P3-B] 헤더 우측에 렌더하므로 페이지가 소유)
  const [mineShowDone, setMineShowDone] = useState(false)
  const [mineRecur, setMineRecur]       = useState(true)

  // 드로어
  const [drawer, setDrawer]   = useState<DrawerTask | null>(null)
  const [saving, setSaving]   = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true); setLoadError(null)
    try {
      const [a, m, t] = await Promise.all([loadWbAreas(), loadWbMilestones(), loadWbTasks()])
      setAreas(a); setMilestones(m); setTasks(t)
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
    if (!matchesDuePreset(t.due_at, fDue, t.status)) return false
    return true
  }), [tasks, fAssignee, fArea, fDue, fRecur, authUserId])

  // 담당자 필터 후보 = 업무에 한 번이라도 태깅된 사람 (팀원 목록 대용)
  const assigneeOptions = useMemo(() => {
    const ids = new Set<string>(); for (const t of tasks) for (const id of t.assignee_ids) ids.add(id)
    return [...ids].map(id => ({ id, name: lookup(id).name })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [tasks, lookup])

  // ── 핸들러 ──
  const openNew = (status: WbTaskStatus = 'todo') => {
    const now = new Date().toISOString()
    setDrawer({
      id: null, area_id: areas.find(a => a.is_active)?.id ?? '', milestone_id: null, template_id: null, period_key: null,
      title: '', description: null, status, priority: 'normal', due_at: null, checklist: [],
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

  const handleDelete = async (id: string) => {
    const ok = await deleteWbTask(id)
    if (!ok) { showToast('할 일 상태의 업무만 삭제할 수 있습니다'); return }
    setTasks(prev => prev.filter(t => t.id !== id)); setDrawer(null); showToast(WB_TOAST.deleted)
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
        {tab === 'board' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={fAssignee} onChange={e => setFAssignee(e.target.value)} style={{ ...chipSel, borderColor: fAssignee !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="담당자 필터">
              <option value="all">담당자 · 전체</option>
              <option value="me">담당자 · 나</option>
              {assigneeOptions.filter(o => o.id !== authUserId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={fArea} onChange={e => setFArea(e.target.value)} style={{ ...chipSel, borderColor: fArea !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="업무영역 필터">
              <option value="all">업무영역 · 전체</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <select value={fDue} onChange={e => setFDue(e.target.value as DuePreset)} style={{ ...chipSel, borderColor: fDue !== 'all' ? WB.ink : '#D1D7E1' }} aria-label="마감 필터">
              {DUE_PRESETS.map(p => <option key={p.id} value={p.id}>마감 · {p.label}</option>)}
            </select>
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
              업무영역이 아직 없습니다 — 업무는 영역에 속해야 만들 수 있습니다. 업무영역 관리는 3-C(마일스톤·분장표 탭)에서 열립니다.
            </div>
          )}
          <BoardView tasks={filtered} areas={areas} milestones={milestones} lookup={lookup}
            onOpenTask={t => setDrawer(t)} onNewTask={openNew} onMoveStatus={(id, to) => void handleSetStatus(id, to).catch(() => {})} movingId={movingId} />
        </>
      ) : tab === 'mine' ? (
        <MyTasksView tasks={tasks} areas={areas} milestones={milestones} authUserId={authUserId} lookup={lookup}
          onOpenTask={t => setDrawer(t)} onSetStatus={(id, s) => handleSetStatus(id, s).catch(() => {})} movingId={movingId}
          showDone={mineShowDone} withRecur={mineRecur} />
      ) : (
        <div style={{ minHeight: 420, borderRadius: 12, background: WB.pageBg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: WB.muted, fontSize: 13 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: WB.accent, background: WB.accentBg, borderRadius: 999, padding: '3px 10px' }}>준비 중</span>
          <div>{TABS.find(t => t.id === tab)?.label} 탭은 다음 Phase 에서 열립니다</div>
        </div>
      )}

      {drawer && (
        <TaskDrawer task={drawer} areas={areas} milestones={milestones} users={users} authUserId={authUserId} lookup={lookup}
          saving={saving} onClose={() => setDrawer(null)} onSave={handleSave} onSetStatus={handleSetStatus} onDelete={handleDelete} showToast={showToast} />
      )}
    </div>
  )
}
