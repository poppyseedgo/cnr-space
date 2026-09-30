/**
 * IssueDrawer.tsx — Work Space 이슈 상세 드로어 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-C] 신규 — TaskDrawer 골격 재사용, 필드만 이슈용
 *
 * 모드: draft(id null, [등록] 명시 저장) / existing(필드 즉시 저장 = onSave, 토스트 WB_ISSUE_TOAST)
 * '업무로 전환': onConvert(issueId, areaId) — RPC wb_convert_issue_to_task. 전환 후 버튼은 '→ 업무 열기'
 * 삭제: open 만 (RLS 일치)
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X, MoreHorizontal, Trash2, ArrowRight } from 'lucide-react'
import type { WbIssue, WbIssueStatus, WbIssueSeverity, WbTask, WbWorkArea, WbMilestone, WbComment, WbActivity, WbIssueUpsertInput } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { UserAvatar } from '../common/UserAvatar'
import { DateField } from '../common/DateField'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { loadWbComments, loadWbActivity, insertWbComment, deleteWbComment, wbErrorMessage } from '../../lib/workboardApi'
import { WB, WB_ISSUE_STATUSES, WB_SEVERITIES, WB_ISSUE_TOAST, WB_TOAST, wbSeverityDef, wbIssueStatusLabel, kstDate, kstTime, fmtYmdShort, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

export type DrawerIssue = Omit<WbIssue, 'id'> & { id: string | null }

interface Props {
  issue:       DrawerIssue
  tasks:       WbTask[]
  areas:       WbWorkArea[]
  milestones:  WbMilestone[]
  authUserId:  string
  lookup:      (id: string | null | undefined) => WbPerson
  saving:      boolean
  onClose:     () => void
  onSave:      (input: WbIssueUpsertInput) => Promise<void>
  onConvert:   (issueId: string, areaId: string) => Promise<void>
  onOpenTask:  (taskId: string) => void
  onDelete:    (id: string) => Promise<void>
  showToast:   (msg: string) => void
}

const LABEL: CSSProperties = { color: WB.faint, fontSize: 13 }
const chip = (on: boolean, extra?: CSSProperties): CSSProperties => ({
  border: `1px solid ${on ? WB.ink : '#D1D7E1'}`, background: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: WB.ink,
  cursor: 'pointer', fontWeight: on ? 600 : 400, display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', ...extra,
})
const seg = (on: boolean): CSSProperties => ({
  padding: '6px 12px', borderRadius: 999, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
  background: on ? WB.ink : '#fff', color: on ? '#fff' : '#657487', fontWeight: on ? 600 : 400,
})
const selectStyle: CSSProperties = { border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 8px', fontSize: 12.5, fontFamily: 'inherit', background: '#fff', minWidth: 140, maxWidth: 320 }

export function IssueDrawer({ issue, tasks, areas, milestones, authUserId, lookup, saving, onClose, onSave, onConvert, onOpenTask, onDelete, showToast }: Props) {
  const isDraft = issue.id === null
  const [title, setTitle]       = useState(issue.title)
  const [desc, setDesc]         = useState(issue.description ?? '')
  const [severity, setSeverity] = useState<WbIssueSeverity>(issue.severity)
  const [taskId, setTaskId]     = useState<string | null>(issue.task_id)
  const [msId, setMsId]         = useState<string | null>(issue.milestone_id)
  const [occurred, setOccurred] = useState(issue.occurred_on)
  useEffect(() => {
    setTitle(issue.title); setDesc(issue.description ?? ''); setSeverity(issue.severity); setTaskId(issue.task_id); setMsId(issue.milestone_id); setOccurred(issue.occurred_on)
  }, [issue.id, issue.updated_at])  // eslint-disable-line react-hooks/exhaustive-deps

  const [menuOpen, setMenuOpen]     = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [convertArea, setConvertArea] = useState<string>('')
  const [convertOpen, setConvertOpen] = useState(false)
  const [tab, setTab]               = useState<'comments' | 'activity'>('comments')
  const [comments, setComments]     = useState<WbComment[] | null>(null)
  const [activity, setActivity]     = useState<WbActivity[] | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [entered, setEntered]       = useState(false)
  const [taskQ, setTaskQ]           = useState('')
  const [taskPickOpen, setTaskPickOpen] = useState(false)
  const taskPickRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  useEffect(() => {
    if (!issue.id) return
    const id = issue.id
    loadWbComments('issue', id).then(setComments).catch(() => setComments([]))
    loadWbActivity('issue', id).then(setActivity).catch(() => setActivity([]))
  }, [issue.id, issue.updated_at])
  useEffect(() => {
    if (!taskPickOpen) return
    const h = (e: MouseEvent) => { if (taskPickRef.current && !taskPickRef.current.contains(e.target as Node)) setTaskPickOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [taskPickOpen])

  const sev = wbSeverityDef(severity)
  const linked = taskId ? tasks.find(t => t.id === taskId) : undefined
  const converted = issue.converted_task_id ? tasks.find(t => t.id === issue.converted_task_id) : undefined
  const taskCandidates = useMemo(() => {
    const q = taskQ.trim().toLowerCase()
    return tasks.filter(t => t.status !== 'done' && t.id !== taskId && (!q || t.title.toLowerCase().includes(q))).slice(0, 8)
  }, [tasks, taskQ, taskId])

  const buildInput = (patch: Partial<WbIssueUpsertInput> = {}): WbIssueUpsertInput => ({
    id: issue.id, title: title.trim(), description: desc.trim() || null, severity, status: issue.status,
    task_id: taskId, milestone_id: msId, occurred_on: occurred || null, ...patch,
  })
  const save = async (patch: Partial<WbIssueUpsertInput> = {}, toast?: string) => {
    if (isDraft) return
    try { await onSave(buildInput(patch)); if (toast) showToast(toast) } catch (e) { showToast(wbErrorMessage(e)) }
  }
  const create = async () => {
    if (!title.trim()) { showToast('제목을 입력해 주세요'); return }
    try { await onSave(buildInput()) } catch (e) { showToast(wbErrorMessage(e)) }
  }
  const setStatus = (s: WbIssueStatus) => {
    if (isDraft || s === issue.status) return
    void save({ status: s }, s === 'resolved' ? WB_ISSUE_TOAST.resolved : WB_ISSUE_TOAST.statusMoved(wbIssueStatusLabel(s)))
  }

  const submitComment = async () => {
    const body = commentBody.trim(); if (!body || !issue.id) return
    try { const c = await insertWbComment('issue', issue.id, body); setComments(prev => [...(prev ?? []), c]); setCommentBody(''); showToast(WB_TOAST.commentAdded) }
    catch (e) { showToast(wbErrorMessage(e, '댓글 등록에 실패했습니다')) }
  }
  const removeComment = async (id: string) => {
    try { const ok = await deleteWbComment(id); if (ok) { setComments(prev => (prev ?? []).filter(c => c.id !== id)); showToast(WB_TOAST.commentRemoved) } else showToast('본인 댓글만 삭제할 수 있습니다') }
    catch (e) { showToast(wbErrorMessage(e, '댓글 삭제에 실패했습니다')) }
  }

  const canDelete = !isDraft && issue.status === 'open'
  const askDelete = () => { setMenuOpen(false); if (!canDelete) { showToast("'열림' 상태의 이슈만 삭제할 수 있습니다 — 보류로 전환해 두세요"); return } setConfirmDel(true) }

  const doConvert = async () => {
    if (!issue.id || !convertArea) { showToast('업무영역을 선택해 주세요'); return }
    try { await onConvert(issue.id, convertArea); setConvertOpen(false) } catch (e) { showToast(wbErrorMessage(e, '전환에 실패했습니다')) }
  }

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label="이슈 상세"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${WB.drawerW}px, 100vw)`, background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)',
            padding: '22px 24px 32px', overflowY: 'auto', fontFamily: WB.font, fontSize: 13, color: WB.ink, borderLeft: `6px solid ${sev.bar}`,
            transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>

          {/* 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: sev.bg, color: sev.fg }}>{sev.label}</span>
              <span style={{ fontSize: 10.5, color: WB.muted }}>이슈</span>
              {isDraft && <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>새 이슈</span>}
              {issue.converted_task_id && <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px' }}>→ 업무로 전환됨</span>}
              {saving && <span style={{ fontSize: 11, color: WB.faint }}>저장 중…</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative' }}>
              {!isDraft && <button className="btn" onClick={() => setMenuOpen(v => !v)} aria-label="더보기" style={chip(false, { padding: '5px 8px' })}><MoreHorizontal size={14} /></button>}
              {menuOpen && (
                <div style={{ position: 'absolute', top: 32, right: 36, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,.12)', padding: 4, zIndex: 2, minWidth: 160 }}>
                  <button className="btn" onClick={askDelete} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '8px 10px', borderRadius: 6, fontSize: 12.5, fontWeight: 400, color: canDelete ? '#DC2626' : WB.faint, cursor: 'pointer' }}>
                    <Trash2 size={13} /> 삭제{!canDelete && <span style={{ marginLeft: 'auto', fontSize: 10 }}>열림만</span>}
                  </button>
                </div>
              )}
              <button className="btn" onClick={onClose} aria-label="닫기" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: WB.faint, display: 'flex' }}><X size={18} /></button>
            </div>
          </div>

          <textarea value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { if (!isDraft && title.trim() && title !== issue.title) void save({ title: title.trim() }, WB_ISSUE_TOAST.titleSaved); else if (!isDraft) setTitle(issue.title) }}
            placeholder="무슨 일이 생겼나요?" rows={2} autoFocus={isDraft}
            style={{ width: '100%', fontSize: 19, fontWeight: 700, lineHeight: 1.35, border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', color: WB.ink, padding: 0, marginBottom: 14, background: 'transparent' }} />

          <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', rowGap: 10, columnGap: 8, alignItems: 'center', marginBottom: 16, color: WB.body }}>
            <span style={LABEL}>심각도</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {WB_SEVERITIES.map(s => (
                <button key={s.id} className="btn" onClick={() => { setSeverity(s.id); void save({ severity: s.id }, WB_ISSUE_TOAST.severitySaved(s.label)) }} style={chip(severity === s.id)}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.bar, display: 'inline-block' }} />{s.label}
                </button>
              ))}
            </div>

            <span style={LABEL}>상태</span>
            <div style={{ display: 'inline-flex', gap: 4, background: '#F3F4F8', borderRadius: 999, padding: 3, width: 'fit-content' }}>
              {WB_ISSUE_STATUSES.map(s => (
                <button key={s.id} className="btn" disabled={isDraft} onClick={() => setStatus(s.id)} style={{ ...seg(issue.status === s.id), opacity: isDraft && issue.status !== s.id ? 0.5 : 1 }}>{s.label}</button>
              ))}
            </div>

            <span style={LABEL}>발생일</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <DateField value={occurred} max={todayStr()} onChange={d => { if (!d) return; setOccurred(d); void save({ occurred_on: d }, WB_ISSUE_TOAST.occurredSaved(fmtYmdShort(d))) }}
                style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '5px 10px', fontSize: 12.5, background: '#fff', fontFamily: 'inherit' }} />
              {!isDraft && <span style={{ fontSize: 12, color: WB.faint }}>보고 {lookup(issue.reporter_id).name} · {fmtYmdShort(kstDate(issue.created_at))} {kstTime(issue.created_at)}</span>}
            </div>

            <span style={LABEL}>연결 업무</span>
            <div style={{ position: 'relative' }} ref={taskPickRef}>
              {linked ? (
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '4px 8px', fontSize: 12.5, maxWidth: '100%' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#CBD5E1' }} onClick={() => onOpenTask(linked.id)}>🔗 {linked.title}</span>
                  <button className="btn" onClick={() => { setTaskId(null); void save({ task_id: null }, WB_ISSUE_TOAST.taskLinked(null)) }} aria-label="연결 해제" style={{ border: 'none', background: 'transparent', padding: 0, color: WB.faint, cursor: 'pointer', display: 'flex' }}><X size={12} /></button>
                </span>
              ) : (
                <button className="btn" onClick={() => setTaskPickOpen(v => !v)} style={chip(false, { color: WB.faint, fontWeight: 400 })}>+ 업무 연결</button>
              )}
              {taskPickOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 340, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, boxShadow: '0 12px 32px rgba(15,23,42,.14)', padding: 8, zIndex: 3 }}>
                  <input autoFocus value={taskQ} onChange={e => setTaskQ(e.target.value)} placeholder="업무 제목 검색" style={{ width: '100%', border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', marginBottom: 6 }} />
                  {taskCandidates.length === 0 && <div style={{ padding: 8, fontSize: 12, color: WB.faint }}>미완료 업무 없음</div>}
                  {taskCandidates.map(t => (
                    <button key={t.id} className="btn" onClick={() => { setTaskId(t.id); setTaskPickOpen(false); setTaskQ(''); void save({ task_id: t.id }, WB_ISSUE_TOAST.taskLinked(t.title)) }}
                      style={{ display: 'block', width: '100%', border: 'none', background: 'transparent', padding: '6px 8px', borderRadius: 6, fontSize: 12.5, fontWeight: 400, color: WB.ink, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <span style={LABEL}>마일스톤</span>
            <div>
              <select value={msId ?? ''} onChange={e => { const v = e.target.value || null; setMsId(v); void save({ milestone_id: v }, WB_ISSUE_TOAST.msSaved(v ? milestones.find(m => m.id === v)?.title ?? null : null)) }} style={selectStyle}>
                <option value="">없음</option>
                {milestones.filter(m => m.status !== 'cancelled' && (m.status !== 'done' || m.id === msId)).map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
            </div>
          </div>

          {isDraft ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={onClose} style={chip(false, { padding: '9px 14px', fontSize: 13 })}>취소</button>
              <button className="btn" onClick={create} disabled={saving} style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>등록</button>
            </div>
          ) : (
            /* 업무로 전환 */
            <div style={{ background: WB.pageBg, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              {converted ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: WB.muted }}>업무로 전환됨</span>
                  <button className="btn" onClick={() => onOpenTask(converted.id)} style={chip(true, { marginLeft: 'auto' })}>→ 업무 열기 <span style={{ color: WB.muted, fontWeight: 400, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{converted.title}</span></button>
                </div>
              ) : !convertOpen ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: WB.muted }}>대응 업무가 필요하면 이 이슈로 업무를 만듭니다 (제목·설명·마일스톤 복사, 담당 = 보고자)</span>
                  <button className="btn" onClick={() => { setConvertOpen(true); if (!convertArea && areas.length) setConvertArea(areas.find(a => a.is_active)?.id ?? '') }} style={{ ...chip(true, { marginLeft: 'auto', whiteSpace: 'nowrap' }), background: WB.ink, color: '#fff' }}>
                    <ArrowRight size={13} /> 업무로 전환
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5 }}>업무영역</span>
                  <select value={convertArea} onChange={e => setConvertArea(e.target.value)} style={selectStyle}>
                    <option value="">선택</option>
                    {areas.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button className="btn" onClick={() => void doConvert()} disabled={saving || !convertArea} style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: saving || !convertArea ? 0.5 : 1 }}>전환</button>
                  <button className="btn" onClick={() => setConvertOpen(false)} style={chip(false)}>취소</button>
                </div>
              )}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${WB.line}`, paddingTop: 14, marginBottom: 14 }}>
            <b>설명</b>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} onBlur={() => { if (!isDraft && (desc.trim() || null) !== (issue.description ?? null)) void save({ description: desc.trim() || null }, WB_ISSUE_TOAST.descSaved) }}
              placeholder="상황·영향 범위·임시 조치" rows={3}
              style={{ width: '100%', marginTop: 6, border: 'none', outline: 'none', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6, color: WB.body, padding: 0, background: 'transparent' }} />
          </div>

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
                  <div style={{ display: 'flex', gap: 6, border: '1px solid #D1D7E1', borderRadius: 8, padding: '8px 12px', marginTop: 4 }}>
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
                      <span style={{ color: WB.body }}><b>{lookup(a.actor_id).name}</b> {describeIssueActivity(a, tasks, milestones)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmDel && issue.id && (
        <ConfirmDialog title="이슈 삭제" variant="danger" confirmLabel="삭제"
          message={<>"{issue.title}" 을(를) 삭제합니다. 댓글·이력도 함께 사라지며 되돌릴 수 없습니다.</>}
          onClose={() => setConfirmDel(false)}
          onConfirm={() => { const id = issue.id!; setConfirmDel(false); void onDelete(id).catch(e => showToast(wbErrorMessage(e, '삭제에 실패했습니다'))) }} />
      )}
    </ModalPortal>
  )
}

const FIELD: Record<string, string> = { title: '제목', description: '설명', severity: '심각도', status: '상태', task_id: '연결 업무', milestone_id: '마일스톤', occurred_on: '발생일' }
function fmtV(k: string, v: any, tasks: WbTask[], milestones: WbMilestone[]): string {
  if (v === null || v === undefined || v === '') return '없음'
  switch (k) {
    case 'severity':     return wbSeverityDef(v).label
    case 'status':       return wbIssueStatusLabel(v)
    case 'task_id':      return tasks.find(t => t.id === v)?.title ?? '(삭제된 업무)'
    case 'milestone_id': return milestones.find(m => m.id === v)?.title ?? '(삭제된 마일스톤)'
    case 'occurred_on':  return fmtYmdShort(v)
    default:             return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)
  }
}
function describeIssueActivity(a: WbActivity, tasks: WbTask[], milestones: WbMilestone[]): string {
  const d = a.diff ?? {}
  switch (a.action) {
    case 'created':   return '이슈를 등록했습니다'
    case 'converted': return `업무로 전환 — ${tasks.find(t => t.id === d.task_id)?.title ?? '(업무)'}`
    case 'status':
    case 'updated':   return Object.entries(d).map(([k, v]: [string, any]) => `${FIELD[k] ?? k}: ${fmtV(k, v?.from, tasks, milestones)} → ${fmtV(k, v?.to, tasks, milestones)}`).join(' / ')
    default:          return a.action
  }
}
