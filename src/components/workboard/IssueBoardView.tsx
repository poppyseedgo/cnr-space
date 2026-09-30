/**
 * IssueBoardView.tsx — Work Space 이슈보드 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-C] 신규
 *
 * 구조
 *  ① 오늘 발생 밴드 — occurred_on = KST 오늘인 이슈(상태 무관) + 빠른 등록 인풋(제목·심각도 → Enter)
 *  ② 상태 4열 = wb_issues.status 1:1 (open/in_progress/resolved/wontfix → 열림·진행 중·해결·보류, 고지 확정)
 *     드래그 이동 = onMoveStatus. 해결 열 최근 3건 + 더보기
 *  카드 좌측 색 띠 = 심각도. 🔗 연결 업무 / → 업무로 전환됨 / 마일스톤 / 보고자 아바타
 */

import { useMemo, useState, type CSSProperties } from 'react'
import type { WbIssue, WbIssueStatus, WbIssueSeverity, WbTask, WbMilestone } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { WB, WB_ISSUE_STATUSES, WB_SEVERITIES, WB_QUICK_ISSUE_SEVERITY, wbSeverityDef, wbIssueStatusLabel, fmtYmdShort, kstTime, kstDate, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

interface Props {
  issues:       WbIssue[]            // 필터 적용 후
  allIssues:    WbIssue[]            // 오늘 밴드는 필터 무관
  tasks:        WbTask[]
  milestones:   WbMilestone[]
  lookup:       (id: string | null | undefined) => WbPerson
  onOpenIssue:  (i: WbIssue) => void
  onQuickCreate:(title: string, severity: WbIssueSeverity) => Promise<void>
  onMoveStatus: (id: string, to: WbIssueStatus) => void
  movingId:     string | null
}

const RESOLVED_VISIBLE = 3

export function IssueBoardView({ issues, allIssues, tasks, milestones, lookup, onOpenIssue, onQuickCreate, onMoveStatus, movingId }: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<WbIssueStatus | null>(null)
  const [showAllResolved, setShowAllResolved] = useState(false)
  const [quick, setQuick] = useState('')
  const [quickSev, setQuickSev] = useState<WbIssueSeverity>(WB_QUICK_ISSUE_SEVERITY)
  const [quickBusy, setQuickBusy] = useState(false)
  const today = todayStr()

  const taskById = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks])
  const msById   = useMemo(() => new Map(milestones.map(m => [m.id, m])), [milestones])

  const todayIssues = useMemo(() => allIssues.filter(i => i.occurred_on === today).sort((a, b) => b.created_at.localeCompare(a.created_at)), [allIssues, today])

  const byStatus = useMemo(() => {
    const m: Record<WbIssueStatus, WbIssue[]> = { open: [], in_progress: [], resolved: [], wontfix: [] }
    for (const i of issues) m[i.status].push(i)
    const sevRank: Record<WbIssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const bySev = (a: WbIssue, b: WbIssue) => sevRank[a.severity] - sevRank[b.severity] || b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)
    m.open.sort(bySev); m.in_progress.sort(bySev); m.wontfix.sort(bySev)
    m.resolved.sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? ''))
    return m
  }, [issues])

  const submitQuick = async () => {
    const title = quick.trim(); if (!title || quickBusy) return
    setQuickBusy(true)
    try { await onQuickCreate(title, quickSev); setQuick(''); setQuickSev(WB_QUICK_ISSUE_SEVERITY) }
    finally { setQuickBusy(false) }
  }

  const dragIssue = dragId ? issues.find(i => i.id === dragId) : null
  const onDrop = (to: WbIssueStatus) => (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/wb-issue') || dragId
    setOverCol(null); setDragId(null)
    if (!id) return
    const i = issues.find(x => x.id === id)
    if (!i || i.status === to) return
    onMoveStatus(id, to)
  }

  const card = (i: WbIssue, opts: { inToday?: boolean; compact?: boolean } = {}) => {
    const sev = wbSeverityDef(i.severity)
    const linked = i.task_id ? taskById.get(i.task_id) : undefined
    const ms = i.milestone_id ? msById.get(i.milestone_id) : undefined
    const reporter = lookup(i.reporter_id)
    const isDone = i.status === 'resolved' || i.status === 'wontfix'
    const dragging = dragId === i.id || movingId === i.id
    const isToday = i.occurred_on === today
    const style: CSSProperties = {
      background: '#fff', border: `1px solid ${WB.cardBorder}`, borderLeft: `4px solid ${sev.bar}`, borderRadius: 10,
      padding: '12px 12px 10px', marginBottom: opts.inToday ? 0 : 8, cursor: opts.inToday ? 'pointer' : 'grab', userSelect: 'none',
      opacity: dragging ? 0.55 : isDone ? 0.85 : 1, transform: dragging ? 'rotate(1.5deg)' : 'none',
      boxShadow: dragging ? '0 12px 30px rgba(15,23,42,.18)' : 'none', transition: 'box-shadow 120ms ease, opacity 120ms ease',
    }
    return (
      <div key={i.id} draggable={!opts.inToday} role="button" tabIndex={0} style={style}
        onClick={() => { if (!dragId) onOpenIssue(i) }} onKeyDown={e => { if (e.key === 'Enter') onOpenIssue(i) }}
        onDragStart={e => { e.dataTransfer.setData('text/wb-issue', i.id); e.dataTransfer.effectAllowed = 'move'; setDragId(i.id) }}
        onDragEnd={() => { setDragId(null); setOverCol(null) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 10.5 }}>
          <span style={{ fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: sev.bg, color: sev.fg }}>{sev.label}</span>
          {opts.inToday && <span style={{ color: WB.faint }}>{wbIssueStatusLabel(i.status)}</span>}
          <span style={{ marginLeft: 'auto', color: isToday ? WB.dueWarn : WB.muted, fontWeight: isToday ? 700 : 400, whiteSpace: 'nowrap' }}>
            {isToday ? (opts.inToday ? `오늘 ${kstTime(i.created_at)}` : '오늘') : fmtYmdShort(i.occurred_on)}
            {i.status === 'resolved' && i.resolved_at && !isToday ? ' 해결' : ''}
          </span>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 10, color: isDone ? WB.muted : WB.ink, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{i.title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: WB.muted, flexWrap: 'wrap' }}>
          {i.converted_task_id ? (
            <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>→ 업무로 전환됨</span>
          ) : linked ? (
            <span title={linked.title} style={{ fontSize: 10.5, color: WB.body, background: '#F1F5F9', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>🔗 {linked.title}</span>
          ) : (
            <span style={{ color: '#CBD5E1' }}>연결 없음</span>
          )}
          {ms && <span style={{ fontSize: 10.5, color: '#7C3AED', background: '#F5F3FF', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{ms.title}</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }} title={reporter.name + (reporter.departed ? ' (퇴사)' : '')}>
            <UserAvatar name={reporter.name} avatarUrl={reporter.avatar_url} size={22} fontSize={9.5} />
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: WB.font }}>
      {/* ① 오늘 발생 */}
      <div style={{ background: '#fff', border: `1.5px solid ${WB.dueWarn}`, borderRadius: 12, padding: '14px 16px 10px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: WB.dueWarn, marginBottom: todayIssues.length ? 10 : 6 }}>
          오늘 발생
          <span style={{ background: WB.dueWarn, color: '#fff', borderRadius: 999, padding: '1px 8px', fontSize: 11 }}>{todayIssues.length}</span>
          <span style={{ color: WB.faint, fontWeight: 400, fontSize: 12, marginLeft: 4 }}>{fmtYmdShort(today)}</span>
        </div>
        {todayIssues.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 8 }}>
            {todayIssues.map(i => card(i, { inToday: true }))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#FEF2F2', borderRadius: 8, padding: '8px 10px', marginTop: 6 }}>
          <span style={{ fontSize: 13, color: WB.dueWarn, fontWeight: 700 }}>⚡</span>
          <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submitQuick() } }}
            placeholder="지금 발생한 이슈를 한 줄로 — Enter 로 바로 등록 (심각도 보통 · 오늘)" disabled={quickBusy}
            style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, fontFamily: 'inherit', outline: 'none', color: WB.ink }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {WB_SEVERITIES.map(s => (
              <button key={s.id} className="btn" title={s.label} onClick={() => setQuickSev(s.id)} aria-label={`심각도 ${s.label}`}
                style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #fff', background: s.bar, padding: 0, cursor: 'pointer',
                  boxShadow: quickSev === s.id ? `0 0 0 2px ${WB.ink}` : `0 0 0 1px ${WB.cardBorder}` }} />
            ))}
          </div>
          <button className="btn" onClick={() => void submitQuick()} disabled={quickBusy || !quick.trim()}
            style={{ background: WB.ink, color: '#fff', borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer', opacity: quickBusy || !quick.trim() ? 0.5 : 1 }}>
            등록
          </button>
        </div>
      </div>

      {/* ② 상태 4열 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, alignItems: 'start' }}>
        {WB_ISSUE_STATUSES.map(col => {
          const list = byStatus[col.id]
          const visible = col.id === 'resolved' && !showAllResolved ? list.slice(0, RESOLVED_VISIBLE) : list
          const hidden = col.id === 'resolved' ? list.length - visible.length : 0
          const isOver = overCol === col.id && dragIssue && dragIssue.status !== col.id
          return (
            <div key={col.id}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== col.id) setOverCol(col.id) }}
              onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(null) }}
              onDrop={onDrop(col.id)}
              style={{ background: isOver ? '#E5EBF3' : WB.colBg, borderRadius: 12, padding: 10, minHeight: 420, transition: 'background 120ms ease',
                outline: isOver ? `2px dashed ${WB.accent}` : '2px dashed transparent', outlineOffset: -2 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 10px', fontSize: 13, fontWeight: 700, color: WB.body }}>
                <span>{col.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: WB.muted, background: '#fff', borderRadius: 999, padding: '2px 8px' }}>{list.length}</span>
              </div>
              {visible.map(i => card(i))}
              {isOver && <div style={{ height: 88, marginBottom: 8, borderRadius: 10, border: `2px dashed ${WB.accent}`, background: WB.accentBg, opacity: 0.6 }} />}
              {col.id === 'resolved' && (hidden > 0 || showAllResolved) && (
                <button className="btn" onClick={() => setShowAllResolved(v => !v)}
                  style={{ width: '100%', border: `1px solid ${WB.cardBorder}`, background: 'transparent', borderRadius: 10, padding: 10, color: WB.faint, fontSize: 12.5, fontWeight: 400, cursor: 'pointer' }}>
                  {showAllResolved ? '접기' : `해결 ${hidden}건 더보기`}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
