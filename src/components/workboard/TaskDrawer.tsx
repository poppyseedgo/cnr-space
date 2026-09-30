/**
 * TaskDrawer.tsx — Work Space 업무 상세 드로어 (미리보기 승인분 2026-09-29)
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P3-B] 모든 액션 완료 시 토스트 (WB_TOAST SSOT, 고지 지시) — save(patch, toast) 시그니처
 *  - [2026-09-29 WORKBOARD P3-A] 신규
 *
 * 두 모드
 *  · draft  (task.id === null) — '+ 업무 추가'. 제목·영역 입력 후 [만들기] 명시 저장 (빈 초안은 저장할 게 없어 자동저장 불가)
 *  · existing                  — 필드 변경 즉시 onSave(input) (저장 버튼 없음). 제목·설명은 blur 시.
 *    저장은 부모가 RPC → 단건 재조회 → 갱신된 task 를 prop 으로 내려준다 (낙관적 갱신 금지 원칙).
 *    응답 오기 전 폼은 로컬 값 유지, 실패하면 부모가 이전 task 를 다시 내려 자연 복구
 * 상태 변경은 별도 RPC(onSetStatus) — 보드 드래그와 동일 경로
 * 삭제: todo 만 (RLS 와 일치). 아니면 '보류로 전환' 안내
 * 하단: 댓글(wb_comments 직접) / 변경 이력(wb_activity_log → 문장 렌더)
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X, MoreHorizontal, Trash2, Plus } from 'lucide-react'
import type { AppUser, WbTask, WbTaskStatus, WbTaskPriority, WbWorkArea, WbMilestone, WbChecklistItem, WbComment, WbActivity, WbTaskUpsertInput } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { UserAvatar } from '../common/UserAvatar'
import { DateField } from '../common/DateField'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { loadWbComments, loadWbActivity, insertWbComment, deleteWbComment, wbErrorMessage } from '../../lib/workboardApi'
import {
  WB, WB_STATUSES, WB_PRIORITIES, WB_RRULE_LABEL, WB_TOAST, areaColor, checklistProgress, newChecklistId,
  dueInfo, dueColor, kstDate, kstTime, fmtYmdShort, wbStatusLabel, wbPriorityDef, type WbPerson,
} from './wbShared'  // ← [2026-09-29 P3-B] WB_TOAST — 액션별 완료 토스트

/** draft 는 id 만 null 인 WbTask 형태로 부모가 만들어 넘긴다 */
export type DrawerTask = Omit<WbTask, 'id'> & { id: string | null }

interface Props {
  task:        DrawerTask
  areas:       WbWorkArea[]
  milestones:  WbMilestone[]
  users:       AppUser[]
  authUserId:  string
  lookup:      (id: string | null | undefined) => WbPerson
  saving:      boolean
  onClose:     () => void
  onSave:      (input: WbTaskUpsertInput) => Promise<void>
  onSetStatus: (id: string, status: WbTaskStatus) => Promise<void>
  onDelete:    (id: string) => Promise<void>
  showToast:   (msg: string) => void
}

const LABEL: CSSProperties = { color: WB.faint, fontSize: 13 }
const chip = (on: boolean, extra?: CSSProperties): CSSProperties => ({
  border: `1px solid ${on ? WB.ink : '#D1D7E1'}`, background: '#fff', borderRadius: 8, padding: '4px 10px',
  fontSize: 12, color: WB.ink, cursor: 'pointer', fontWeight: on ? 600 : 400, display: 'inline-flex', alignItems: 'center', gap: 6, ...extra,
})
const seg = (on: boolean): CSSProperties => ({
  padding: '6px 12px', borderRadius: 999, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  background: on ? WB.ink : '#fff', color: on ? '#fff' : '#657487', fontWeight: on ? 600 : 400,
})

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const DEFAULT_TIME = '18:00'
function toDueAt(ymd: string, hm: string): string { return new Date(`${ymd}T${hm}:00+09:00`).toISOString() }

export function TaskDrawer({ task, areas, milestones, users, authUserId, lookup, saving, onClose, onSave, onSetStatus, onDelete, showToast }: Props) {
  const isDraft = task.id === null
  // ── 로컬 폼 (existing 은 task 변경마다 재동기화) ──
  const [title, setTitle]       = useState(task.title)
  const [desc, setDesc]         = useState(task.description ?? '')
  const [areaId, setAreaId]     = useState(task.area_id)
  const [msId, setMsId]         = useState<string | null>(task.milestone_id)
  const [priority, setPriority] = useState<WbTaskPriority>(task.priority)
  const [dueYmd, setDueYmd]     = useState(task.due_at ? kstDate(task.due_at) : '')
  const [dueHm, setDueHm]       = useState(task.due_at ? kstTime(task.due_at) : DEFAULT_TIME)
  const [checklist, setChecklist] = useState<WbChecklistItem[]>(task.checklist)
  const [assignees, setAssignees] = useState<string[]>(task.assignee_ids)
  useEffect(() => {
    setTitle(task.title); setDesc(task.description ?? ''); setAreaId(task.area_id); setMsId(task.milestone_id)
    setPriority(task.priority); setDueYmd(task.due_at ? kstDate(task.due_at) : ''); setDueHm(task.due_at ? kstTime(task.due_at) : DEFAULT_TIME)
    setChecklist(task.checklist); setAssignees(task.assignee_ids)
  }, [task.id, task.updated_at])  // eslint-disable-line react-hooks/exhaustive-deps

  const [newItem, setNewItem]   = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQ, setPickerQ]   = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [tab, setTab]           = useState<'comments' | 'activity'>('comments')
  const [comments, setComments] = useState<WbComment[] | null>(null)
  const [activity, setActivity] = useState<WbActivity[] | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [entered, setEntered]   = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  // 댓글·이력 로드 (existing 만)
  useEffect(() => {
    if (!task.id) return
    const id = task.id
    loadWbComments('task', id).then(setComments).catch(() => setComments([]))
    loadWbActivity('task', id).then(setActivity).catch(() => setActivity([]))
  }, [task.id, task.updated_at])
  useEffect(() => {
    if (!pickerOpen) return
    const h = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [pickerOpen])

  const area = areas.find(a => a.id === areaId)
  const areaIdx = Math.max(0, areas.findIndex(a => a.id === areaId))
  const ms = msId ? milestones.find(m => m.id === msId) : undefined
  const ck = checklistProgress(checklist)
  const due = dueInfo(dueYmd ? toDueAt(dueYmd, dueHm) : null, task.status === 'done')

  // ── 저장 ──
  const buildInput = (patch: Partial<WbTaskUpsertInput> = {}): WbTaskUpsertInput => ({
    id: task.id, area_id: areaId, title: title.trim(), description: desc.trim() || null, priority,
    due_at: dueYmd ? toDueAt(dueYmd, dueHm) : null, milestone_id: msId, checklist, assignee_ids: assignees, ...patch,
  })
  const save = async (patch: Partial<WbTaskUpsertInput> = {}, toast?: string) => {
    if (isDraft) return                    // draft 는 [만들기] 로만
    try { await onSave(buildInput(patch)); if (toast) showToast(toast) } catch (e) { showToast(wbErrorMessage(e)) }
  }
  const create = async () => {
    if (!title.trim()) { showToast('제목을 입력해 주세요'); return }
    if (!areaId) { showToast('업무영역을 선택해 주세요'); return }
    try { await onSave(buildInput()) } catch (e) { showToast(wbErrorMessage(e)) }
  }

  // ── 체크리스트 ──
  const toggleItem = (id: string) => {
    const cur = checklist.find(i => i.id === id); if (!cur) return
    const next = checklist.map(i => i.id === id ? { ...i, done: !i.done } : i); setChecklist(next)
    void save({ checklist: next }, cur.done ? WB_TOAST.checkUndone(cur.text) : WB_TOAST.checkDone(cur.text))
  }
  const removeItem = (id: string) => { const next = checklist.filter(i => i.id !== id); setChecklist(next); void save({ checklist: next }, WB_TOAST.checkRemoved) }
  const addItem = () => {
    const text = newItem.trim(); if (!text) return
    const next = [...checklist, { id: newChecklistId(), text, done: false }]
    setChecklist(next); setNewItem(''); void save({ checklist: next }, WB_TOAST.checkAdded)
  }

  // ── 담당자 ──
  const candidates = useMemo(() => {
    const q = pickerQ.trim().toLowerCase()
    return users.filter(u => !assignees.includes(u.user_id) && (!q || u.name.toLowerCase().includes(q) || (u.dept ?? '').toLowerCase().includes(q))).slice(0, 8)
  }, [users, assignees, pickerQ])
  const addAssignee = (id: string) => { const next = [...assignees, id]; setAssignees(next); setPickerOpen(false); setPickerQ(''); void save({ assignee_ids: next }, WB_TOAST.assigneeAdded(lookup(id).name)) }
  const removeAssignee = (id: string) => { const next = assignees.filter(x => x !== id); setAssignees(next); void save({ assignee_ids: next }, WB_TOAST.assigneeRemoved(lookup(id).name)) }

  // ── 댓글 ──
  const submitComment = async () => {
    const body = commentBody.trim(); if (!body || !task.id) return
    try {
      const c = await insertWbComment('task', task.id, body)
      setComments(prev => [...(prev ?? []), c]); setCommentBody(''); showToast(WB_TOAST.commentAdded)
    } catch (e) { showToast(wbErrorMessage(e, '댓글 등록에 실패했습니다')) }
  }
  const removeComment = async (id: string) => {
    try { const ok = await deleteWbComment(id); if (ok) { setComments(prev => (prev ?? []).filter(c => c.id !== id)); showToast(WB_TOAST.commentRemoved) } else showToast('본인 댓글만 삭제할 수 있습니다') }
    catch (e) { showToast(wbErrorMessage(e, '댓글 삭제에 실패했습니다')) }
  }

  // ── 삭제 ──
  const canDelete = !isDraft && task.status === 'todo'
  const askDelete = () => {
    setMenuOpen(false)
    if (!canDelete) { showToast('할 일 상태의 업무만 삭제할 수 있습니다 — 보류로 전환해 두세요'); return }
    setConfirmDel(true)
  }

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="업무 상세"
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${WB.drawerW}px, 100vw)`, background: '#fff',
            boxShadow: '-20px 0 60px rgba(15,23,42,.2)', padding: '22px 24px 32px', overflowY: 'auto',
            fontFamily: WB.font, fontSize: 13, color: WB.ink,
            transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out',
          }}>

          {/* 헤더 칩 + 액션 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {area && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: areaColor(areaIdx).bg, color: areaColor(areaIdx).fg }}>{area.name}</span>}
              {task.template_id && <span style={{ fontSize: 10, color: WB.muted, border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '1px 5px' }}>↻ {task.template_rrule ? WB_RRULE_LABEL[task.template_rrule] : '반복'}{task.period_key ? ` · ${task.period_key}` : ''}</span>}
              {ms && <span style={{ fontSize: 10.5, color: '#7C3AED', background: '#F5F3FF', borderRadius: 4, padding: '1px 6px' }}>{ms.title}</span>}
              {isDraft && <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>새 업무</span>}
              {saving && <span style={{ fontSize: 11, color: WB.faint }}>저장 중…</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
              {!isDraft && (
                <button className="btn" onClick={() => setMenuOpen(v => !v)} aria-label="더보기" style={{ ...chip(false, { padding: '5px 8px' }) }}><MoreHorizontal size={14} /></button>
              )}
              {menuOpen && (
                <div style={{ position: 'absolute', top: 32, right: 36, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,.12)', padding: 4, zIndex: 2, minWidth: 160 }}>
                  <button className="btn" onClick={askDelete}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 400, color: canDelete ? '#DC2626' : WB.faint, cursor: 'pointer' }}>
                    <Trash2 size={13} /> 삭제{!canDelete && <span style={{ marginLeft: 'auto', fontSize: 10 }}>할 일만</span>}
                  </button>
                </div>
              )}
              <button className="btn" onClick={onClose} aria-label="닫기" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: WB.faint, display: 'flex' }}><X size={18} /></button>
            </div>
          </div>

          {/* 제목 */}
          <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (!isDraft && title.trim() && title !== task.title) void save({ title: title.trim() }, WB_TOAST.titleSaved); else if (!isDraft) setTitle(task.title) }}
            placeholder="업무 제목" rows={2} autoFocus={isDraft}
            style={{ width: '100%', fontSize: 19, fontWeight: 700, lineHeight: 1.35, border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', color: WB.ink, padding: 0, marginBottom: 14, background: 'transparent' }} />

          {/* 필드 그리드 */}
          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 10, columnGap: 8, alignItems: 'center', marginBottom: 16, color: WB.body }}>
            <span style={LABEL}>상태</span>
            <div style={{ display: 'inline-flex', gap: 4, background: '#F3F4F8', borderRadius: 999, padding: 3, width: 'fit-content' }}>
              {WB_STATUSES.map(s => (
                <button key={s.id} className="btn" disabled={isDraft} style={{ ...seg(task.status === s.id), opacity: isDraft && task.status !== s.id ? 0.5 : 1 }}
                  onClick={() => { if (!isDraft && task.id && s.id !== task.status) void onSetStatus(task.id, s.id).catch(e => showToast(wbErrorMessage(e))) }}>
                  {s.label}
                </button>
              ))}
            </div>

            <span style={LABEL}>담당자</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', position: 'relative' }} ref={pickerRef}>
              {assignees.map(id => { const p = lookup(id); return (
                <span key={id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', border: `1px solid ${WB.cardBorder}`, borderRadius: 999, padding: '3px 8px 3px 4px', opacity: p.departed ? 0.6 : 1 }}>
                  <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={20} fontSize={9} />
                  {p.name}{p.departed && <span style={{ fontSize: 10, color: WB.faint }}>퇴사</span>}
                  <button className="btn" onClick={() => removeAssignee(id)} aria-label="담당 제외" style={{ border: 'none', background: 'transparent', padding: 0, color: WB.faint, cursor: 'pointer', display: 'flex' }}><X size={12} /></button>
                </span>
              )})}
              <button className="btn" onClick={() => setPickerOpen(v => !v)} style={chip(false, { color: WB.faint, fontWeight: 400 })}><Plus size={12} /> 추가</button>
              {pickerOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 280, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,.14)', padding: 8, zIndex: 3 }}>
                  <input autoFocus value={pickerQ} onChange={e => setPickerQ(e.target.value)} placeholder="이름·부서 검색"
                    style={{ width: '100%', border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', marginBottom: 6 }} />
                  {candidates.length === 0 && <div style={{ padding: 8, fontSize: 12, color: WB.faint }}>검색 결과 없음</div>}
                  {candidates.map(u => (
                    <button key={u.user_id} className="btn" onClick={() => addAssignee(u.user_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '6px 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 400, color: WB.ink, cursor: 'pointer', textAlign: 'left' }}>
                      <UserAvatar name={u.name} avatarUrl={u.avatar_url} size={22} fontSize={9.5} />
                      <span>{u.name}</span><span style={{ color: WB.faint, fontSize: 11 }}>{u.dept}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span style={LABEL}>마감</span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <DateField value={dueYmd} onChange={d => { setDueYmd(d); void save({ due_at: d ? toDueAt(d, dueHm) : null }, d ? WB_TOAST.dueSaved(`${fmtYmdShort(d)} ${dueHm}`) : WB_TOAST.dueCleared) }} placeholder="날짜 선택"
                style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 10px', fontSize: 12.5, background: '#fff', fontFamily: 'inherit' }} />
              {dueYmd && (
                <>
                  <select value={dueHm} onChange={e => { setDueHm(e.target.value); void save({ due_at: toDueAt(dueYmd, e.target.value) }, WB_TOAST.dueSaved(`${fmtYmdShort(dueYmd)} ${e.target.value}`)) }}
                    style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }}>
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <span style={{ color: dueColor(due.tone), fontWeight: due.tone === 'normal' ? 400 : 600, fontSize: 12.5 }}>{due.label}</span>
                  <button className="btn" onClick={() => { setDueYmd(''); void save({ due_at: null }, WB_TOAST.dueCleared) }} aria-label="마감 해제" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', display: 'flex', padding: 2 }}><X size={12} /></button>
                </>
              )}
            </div>

            <span style={LABEL}>우선순위</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {WB_PRIORITIES.map(p => (
                <button key={p.id} className="btn" onClick={() => { setPriority(p.id); void save({ priority: p.id }, WB_TOAST.prioritySaved(p.label)) }} style={chip(priority === p.id)}>
                  {priority === p.id && <span style={{ width: 8, height: 8, borderRadius: '50%', background: wbPriorityDef(p.id).dot, display: 'inline-block' }} />}{p.label}
                </button>
              ))}
            </div>

            <span style={LABEL}>업무영역</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select value={areaId} onChange={e => { setAreaId(e.target.value); void save({ area_id: e.target.value }, WB_TOAST.areaSaved(areas.find(a => a.id === e.target.value)?.name ?? '')) }}
                style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: '#fff', minWidth: 140 }}>
                {!areaId && <option value="">영역 선택</option>}
                {areas.filter(a => a.is_active || a.id === areaId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {area && (area.primary_owner_id || area.backup_owner_id) && (
                <span style={{ color: WB.faint, fontSize: 12 }}>
                  {area.primary_owner_id ? `주 ${lookup(area.primary_owner_id).name}` : ''}{area.primary_owner_id && area.backup_owner_id ? ' · ' : ''}{area.backup_owner_id ? `부 ${lookup(area.backup_owner_id).name}` : ''}
                </span>
              )}
            </div>

            <span style={LABEL}>마일스톤</span>
            <div>
              <select value={msId ?? ''} onChange={e => { const v = e.target.value || null; setMsId(v); void save({ milestone_id: v }, WB_TOAST.msSaved(v ? milestones.find(m => m.id === v)?.title ?? null : null)) }}
                style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: '#fff', minWidth: 140 }}>
                <option value="">없음</option>
                {milestones.filter(m => m.status !== 'cancelled' && (m.status !== 'done' || m.id === msId)).map(m => (
                  <option key={m.id} value={m.id}>{m.title}{m.start_on && m.end_on ? ` (${fmtYmdShort(m.start_on)} – ${fmtYmdShort(m.end_on)})` : ''}</option>
                ))}
              </select>
            </div>
          </div>

          {isDraft && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={onClose} style={chip(false, { padding: '9px 14px', fontSize: 13 })}>취소</button>
              <button className="btn" onClick={create} disabled={saving} style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>만들기</button>
            </div>
          )}

          {/* 체크리스트 */}
          <div style={{ borderTop: `1px solid ${WB.line}`, paddingTop: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><b>체크리스트</b><span style={{ color: WB.faint }}>{ck.done} / {ck.total}</span></div>
            {ck.total > 0 && (
              <div style={{ height: 6, background: WB.line, borderRadius: 3, marginBottom: 10 }}>
                <div style={{ width: `${Math.round(ck.done / ck.total * 100)}%`, height: 6, background: WB.ink, borderRadius: 3, transition: 'width 160ms ease' }} />
              </div>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {checklist.map(item => (
                <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={item.done} onChange={() => toggleItem(item.id)} />
                  <span style={{ flex: 1, color: item.done ? '#9CA3AF' : WB.ink, textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                  <button className="btn" onClick={e => { e.preventDefault(); removeItem(item.id) }} aria-label="항목 삭제" style={{ border: 'none', background: 'transparent', color: '#CBD5E1', cursor: 'pointer', display: 'flex', padding: 2 }}><X size={12} /></button>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
                  placeholder="+ 항목 추가 (Enter)" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', color: WB.ink, padding: '4px 0', background: 'transparent' }} />
              </div>
            </div>
          </div>

          {/* 설명 */}
          <div style={{ borderTop: `1px solid ${WB.line}`, paddingTop: 14, marginBottom: 14 }}>
            <b>설명</b>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => { if (!isDraft && (desc.trim() || null) !== (task.description ?? null)) void save({ description: desc.trim() || null }, WB_TOAST.descSaved) }}
              placeholder="메모·맥락·거래처 등" rows={3}
              style={{ width: '100%', marginTop: 6, border: 'none', outline: 'none', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, color: WB.body, padding: 0, background: 'transparent' }} />
          </div>

          {/* 댓글 / 이력 */}
          {!isDraft && (
            <div style={{ borderTop: `1px solid ${WB.line}`, paddingTop: 14 }}>
              <div style={{ display: 'inline-flex', gap: 4, background: '#F3F4F8', borderRadius: 999, padding: 3, marginBottom: 10 }}>
                <button className="btn" style={seg(tab === 'comments')} onClick={() => setTab('comments')}>댓글 {comments?.length ?? ''}</button>
                <button className="btn" style={seg(tab === 'activity')} onClick={() => setTab('activity')}>변경 이력 {activity?.length ?? ''}</button>
              </div>

              {tab === 'comments' && (
                <>
                  {comments === null && <div style={{ color: WB.faint, fontSize: 12 }}>불러오는 중…</div>}
                  {comments?.map(c => { const p = lookup(c.author_id); return (
                    <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={26} fontSize={10.5} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12 }}><b>{p.name}</b> <span style={{ color: WB.faint }}>{fmtYmdShort(kstDate(c.created_at))} {kstTime(c.created_at)}</span>
                          {c.author_id === authUserId && <button className="btn" onClick={() => removeComment(c.id)} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: WB.faint, fontSize: 11, cursor: 'pointer', fontWeight: 400, padding: 0 }}>삭제</button>}
                        </div>
                        <div style={{ color: WB.body, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{c.body}</div>
                      </div>
                    </div>
                  )})}
                  <div style={{ display: 'flex', gap: 6, border: `1px solid #D1D7E1`, borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
                    <input value={commentBody} onChange={e => setCommentBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitComment() } }}
                      placeholder="댓글 입력…" style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', color: WB.ink, background: 'transparent' }} />
                    <button className="btn" onClick={() => void submitComment()} style={{ border: 'none', background: 'transparent', color: WB.ink, fontWeight: 600, fontSize: 13, cursor: 'pointer', padding: 0 }}>등록</button>
                  </div>
                </>
              )}

              {tab === 'activity' && (
                <div style={{ display: 'grid', gap: 8 }}>
                  {activity === null && <div style={{ color: WB.faint, fontSize: 12 }}>불러오는 중…</div>}
                  {activity?.length === 0 && <div style={{ color: WB.faint, fontSize: 12 }}>이력 없음</div>}
                  {activity?.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
                      <span style={{ color: WB.faint, whiteSpace: 'nowrap', minWidth: 96 }}>{fmtYmdShort(kstDate(a.created_at))} {kstTime(a.created_at)}</span>
                      <span style={{ color: WB.body }}><b>{lookup(a.actor_id).name}</b> {describeActivity(a, lookup, areas, milestones)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmDel && task.id && (
        <ConfirmDialog title="업무 삭제" variant="danger" confirmLabel="삭제"
          message={<>"{task.title}" 을(를) 삭제합니다. 댓글·이력도 함께 사라지며 되돌릴 수 없습니다.</>}
          onClose={() => setConfirmDel(false)}
          onConfirm={() => { const id = task.id!; setConfirmDel(false); void onDelete(id).catch(e => showToast(wbErrorMessage(e, '삭제에 실패했습니다'))) }} />
      )}
    </ModalPortal>
  )
}

// ─── 변경 이력 → 문장 ────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  title: '제목', description: '설명', priority: '우선순위', due_at: '마감', area_id: '업무영역', milestone_id: '마일스톤', checklist: '체크리스트',
}
function fmtVal(key: string, v: any, lookup: (id: any) => WbPerson, areas: WbWorkArea[], milestones: WbMilestone[]): string {
  if (v === null || v === undefined || v === '') return '없음'
  switch (key) {
    case 'due_at':       return `${fmtYmdShort(kstDate(v))} ${kstTime(v)}`
    case 'priority':     return wbPriorityDef(v).label
    case 'area_id':      return areas.find(a => a.id === v)?.name ?? '(삭제된 영역)'
    case 'milestone_id': return milestones.find(m => m.id === v)?.title ?? '(삭제된 마일스톤)'
    case 'checklist':    { const p = checklistProgress(Array.isArray(v) ? v : []); return `${p.done}/${p.total}` }
    default:             return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)
  }
}
function describeActivity(a: WbActivity, lookup: (id: any) => WbPerson, areas: WbWorkArea[], milestones: WbMilestone[]): string {
  const d = a.diff ?? {}
  switch (a.action) {
    case 'created':   return '업무를 만들었습니다'
    case 'status':    return `상태: ${wbStatusLabel(d.from)} → ${wbStatusLabel(d.to)}`
    case 'assignees': {
      const add = (d.added ?? []).map((id: string) => lookup(id).name), rem = (d.removed ?? []).map((id: string) => lookup(id).name)
      return [add.length ? `담당 추가 ${add.join('·')}` : '', rem.length ? `담당 제외 ${rem.join('·')}` : ''].filter(Boolean).join(', ')
    }
    case 'updated':   return Object.entries(d).map(([k, v]: [string, any]) => `${FIELD_LABEL[k] ?? k}: ${fmtVal(k, v?.from, lookup, areas, milestones)} → ${fmtVal(k, v?.to, lookup, areas, milestones)}`).join(' / ')
    default:          return a.action
  }
}
