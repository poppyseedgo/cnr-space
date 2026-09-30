/**
 * MilestonesView.tsx — Work Space '마일스톤' 탭 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-E] 신규 — 좌측 목록(진행 중 → 예정 → 완료·취소, 기본 완료 숨김) + 우측 상세
 *      · 진행률 = 연결 업무 중 완료 / 전체(보류 포함). D-day 는 진행 중 = end_on, 예정 = start_on 기준 (milestoneDday)
 *      · 상세: 지표 4 → 연결 업무 표(완료 접힘) → 연결 이슈 표 → 이력(activity_log target_type='milestone')
 *      · 상태 셀렉트 즉시 변경(onSetStatus) · ✎ 편집(onEdit → MilestoneDrawer) · 삭제는 연결 0건일 때만(onDelete, HAS_LINKS 는 RPC 가 최종 판정)
 *      · "+ 이 마일스톤에 업무 추가" → onAddTask(msId) — 마일스톤이 미리 선택된 TaskDrawer
 *
 * 데이터는 페이지가 소유(tasks·issues 는 이미 로드된 것 재사용). 이력만 이 컴포넌트가 단건 지연 로드
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Pencil, Trash2, Plus } from 'lucide-react'
import type { WbMilestone, WbMilestoneStatus, WbTask, WbIssue, WbWorkArea, WbActivity } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { loadWbActivity } from '../../lib/workboardApi'
import { WB, WB_MS_STATUSES, wbMsStatusDef, wbStatusLabel, wbIssueStatusLabel, wbSeverityDef, areaColor, dueInfo, dueColor,
  milestoneProgress, milestoneDday, milestoneElapsedPct, fmtYmdShort, kstDate, kstTime, daysDiff, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

interface Props {
  milestones:  WbMilestone[]
  tasks:       WbTask[]
  issues:      WbIssue[]
  areas:       WbWorkArea[]
  lookup:      (id: string | null | undefined) => WbPerson
  showClosed:  boolean
  selectedId:  string | null
  onSelect:    (id: string) => void
  onSetStatus: (id: string, status: WbMilestoneStatus) => Promise<void>
  onEdit:      (m: WbMilestone) => void
  onDelete:    (id: string) => Promise<void>
  onAddTask:   (msId: string) => void
  onOpenTask:  (t: WbTask) => void
  onOpenIssue: (i: WbIssue) => void
  busy:        boolean
}

const pill = (bg: string, fg: string): CSSProperties => ({ fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color: fg, whiteSpace: 'nowrap' })
const statusPill = (s: WbTask['status']): CSSProperties => {
  const m: Record<WbTask['status'], [string, string]> = { todo: ['#F1F5F9', '#475569'], doing: ['#EAF2FF', '#1E6FE8'], done: ['#ECFDF5', '#047857'], hold: ['#FFF7ED', '#C2410C'] }
  return { ...pill(m[s][0], m[s][1]), borderRadius: 5, textAlign: 'center', display: 'inline-block', minWidth: 52 }
}
const issuePill = (s: WbIssue['status']): CSSProperties => {
  const m: Record<WbIssue['status'], [string, string]> = { open: ['#FEE2E2', '#B91C1C'], in_progress: ['#EAF2FF', '#1E6FE8'], resolved: ['#ECFDF5', '#047857'], wontfix: ['#F3F4F6', '#9CA3AF'] }
  return { ...pill(m[s][0], m[s][1]), borderRadius: 5, textAlign: 'center', display: 'inline-block', minWidth: 52 }
}
const toneColor = (t: 'warn' | 'today' | 'normal' | 'muted') => t === 'warn' ? WB.dueWarn : t === 'today' ? WB.dueToday : t === 'normal' ? WB.body : WB.muted
const iconBtn: CSSProperties = { width: 32, height: 32, border: '1px solid #D1D7E1', borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: WB.body, padding: 0 }

export function MilestonesView({ milestones, tasks, issues, areas, lookup, showClosed, selectedId, onSelect, onSetStatus, onEdit, onDelete, onAddTask, onOpenTask, onOpenIssue, busy }: Props) {
  const today = todayStr()
  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const areaById  = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const progress  = useMemo(() => new Map(milestones.map(m => [m.id, milestoneProgress(m.id, tasks, issues, today)])), [milestones, tasks, issues, today])

  // 목록: 상태 순(카탈로그 순) → 기간 시작 오름차순. 완료·취소는 토글
  const groups = useMemo(() => WB_MS_STATUSES
    .filter(s => showClosed || !s.closed)
    .map(s => ({ def: s, items: milestones.filter(m => m.status === s.id).sort((a, b) => (a.start_on ?? '9999').localeCompare(b.start_on ?? '9999') || a.title.localeCompare(b.title, 'ko')) }))
    .filter(g => g.items.length > 0), [milestones, showClosed])

  const selected = milestones.find(m => m.id === selectedId) ?? null
  const [activity, setActivity] = useState<WbActivity[] | null>(null)
  const [showDoneTasks, setShowDoneTasks] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => {
    setShowDoneTasks(false); setActivity(null)
    if (!selected?.id) return
    const id = selected.id
    loadWbActivity('milestone', id).then(setActivity).catch(() => setActivity([]))
  }, [selected?.id, selected?.updated_at])

  const sel = selected ? progress.get(selected.id)! : null
  const selTasks = useMemo(() => selected ? tasks.filter(t => t.milestone_id === selected.id).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999')) : [], [tasks, selected])
  const selIssues = useMemo(() => selected ? issues.filter(i => i.milestone_id === selected.id).sort((a, b) => (a.status === 'resolved' || a.status === 'wontfix' ? 1 : 0) - (b.status === 'resolved' || b.status === 'wontfix' ? 1 : 0) || b.occurred_on.localeCompare(a.occurred_on)) : [], [issues, selected])
  const doneCount = selTasks.filter(t => t.status === 'done').length
  const visibleTasks = showDoneTasks ? selTasks : selTasks.filter(t => t.status !== 'done')
  const canDelete = !!sel && sel.total === 0 && sel.issues === 0

  const row: CSSProperties = { display: 'grid', gridTemplateColumns: '78px minmax(0,1fr) 120px 40px', alignItems: 'center', padding: '9px 12px', borderBottom: `1px solid ${WB.line}`, fontSize: 13, gap: 10, cursor: 'pointer' }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '440px minmax(0,1fr)', gap: 14, alignItems: 'start', fontFamily: WB.font }}>
      {/* 목록 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {groups.length === 0 && (
          <div style={{ background: '#fff', border: `1px dashed ${WB.cardBorder}`, borderRadius: 12, padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>
            {milestones.length === 0 ? '마일스톤이 없습니다 — 우측 상단 "+ 마일스톤 추가"' : '진행 중·예정 마일스톤이 없습니다 — "완료 포함"으로 지난 것을 봅니다'}
          </div>
        )}
        {groups.map(g => (
          <div key={g.def.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: WB.muted, letterSpacing: '.4px', padding: '8px 4px 2px' }}>{g.def.label} · {g.items.length}</div>
            {g.items.map(m => {
              const p = progress.get(m.id)!; const dd = milestoneDday(m, today); const cur = m.id === selectedId; const closed = g.def.closed
              return (
                <div key={m.id} onClick={() => onSelect(m.id)} data-ms-card={m.id}
                  style={{ background: '#fff', border: `1px solid ${cur ? WB.ink : WB.cardBorder}`, boxShadow: cur ? `0 0 0 1px ${WB.ink}` : 'none', borderRadius: 12, padding: '14px 14px 12px', cursor: 'pointer', opacity: closed ? .65 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={pill(g.def.bg, g.def.fg)}>{g.def.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: dd.tone === 'muted' ? 500 : 600, color: toneColor(dd.tone) }}>{dd.label}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>{m.title}</div>
                  <div style={{ fontSize: 12, color: WB.muted, marginBottom: 10 }}>{rangeLabel(m)}</div>
                  <div style={{ height: 6, background: WB.colBg, borderRadius: 999, overflow: 'hidden' }}><div style={{ width: `${p.pct}%`, height: '100%', background: m.status === 'done' ? '#047857' : WB.ink, borderRadius: 999 }} /></div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, fontSize: 11.5, color: WB.muted }}>
                    <span>업무 <b style={{ color: WB.ink }}>{p.done}/{p.total}</b>{p.total > 0 && ` · ${p.pct}%`}</span>
                    {p.overdue > 0 && <span style={{ color: WB.dueWarn, fontWeight: 600 }}>지연 {p.overdue}</span>}
                    {p.openIssues > 0 && <span style={{ color: '#B45309', fontWeight: 600 }}>열린 이슈 {p.openIssues}</span>}
                    {p.total === 0 && p.issues === 0 && !closed && <span style={{ color: WB.faint }}>연결 없음 · 삭제 가능</span>}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* 상세 */}
      <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 16, padding: '22px 24px', minHeight: 600 }}>
        {!selected || !sel ? (
          <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WB.muted, fontSize: 13 }}>왼쪽에서 마일스톤을 선택하세요</div>
        ) : (() => {
          const def = wbMsStatusDef(selected.status); const elapsed = milestoneElapsedPct(selected, today); const dd = milestoneDday(selected, today)
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
                <h2 style={{ fontSize: 20, margin: 0, fontWeight: 700, flex: 1, lineHeight: 1.3 }}>{selected.title}</h2>
                <select value={selected.status} disabled={busy} onChange={e => void onSetStatus(selected.id, e.target.value as WbMilestoneStatus)} aria-label="마일스톤 상태"
                  style={{ border: '1px solid #D1D7E1', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', fontWeight: 700, background: def.bg, color: def.fg, cursor: 'pointer' }}>
                  {WB_MS_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button className="btn" onClick={() => onEdit(selected)} title="편집" aria-label="편집" style={iconBtn}><Pencil size={14} /></button>
                <button className="btn" onClick={() => { if (canDelete) setConfirmDel(true) }} disabled={!canDelete} title={canDelete ? '삭제' : '연결된 업무·이슈가 있어 삭제할 수 없습니다 — 취소 상태로 종료'} aria-label="삭제"
                  style={{ ...iconBtn, color: canDelete ? WB.dueWarn : '#CBD5E1', cursor: canDelete ? 'pointer' : 'not-allowed' }}><Trash2 size={14} /></button>
              </div>
              <div style={{ fontSize: 13, color: WB.muted, marginBottom: 14 }}>
                <b style={{ color: WB.ink }}>{rangeLabel(selected)}</b>
                {selected.status === 'active' && <> · <b style={{ color: toneColor(dd.tone) }}>{dd.label}</b>{elapsed !== null && ` · 경과 ${elapsed}%`}</>}
                {selected.status === 'planned' && <> · {dd.label}</>}
              </div>
              {selected.description && <div style={{ fontSize: 13.5, color: WB.body, lineHeight: 1.7, background: '#F8FAFC', borderRadius: 10, padding: '12px 14px', marginBottom: 18, whiteSpace: 'pre-wrap', wordBreak: 'keep-all' }}>{selected.description}</div>}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
                <Stat label="진행률" value={`${sel.pct}%`} sub={`${sel.done} / ${sel.total}`} bar={sel.pct} />
                <Stat label="진행 중" value={String(sel.doing)} sub="건" />
                <Stat label="지연" value={String(sel.overdue)} sub="건" color={sel.overdue > 0 ? WB.dueWarn : undefined} />
                <Stat label="열린 이슈" value={String(sel.openIssues)} sub={`/ ${sel.issues}`} color={sel.openIssues > 0 ? '#B45309' : undefined} />
              </div>

              {/* 업무 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
                <b style={{ fontSize: 14 }}>업무 {sel.total}</b>
                <button className="btn" onClick={() => onAddTask(selected.id)} style={{ border: 'none', background: 'transparent', color: WB.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}><Plus size={13} /> 이 마일스톤에 업무 추가</button>
              </div>
              <div style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ ...row, cursor: 'default', background: '#F8FAFC', fontSize: 11.5, color: WB.muted, fontWeight: 600 }}><span>상태</span><span>업무</span><span>마감</span><span>담당</span></div>
                {visibleTasks.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: WB.faint, textAlign: 'center' }}>{sel.total === 0 ? '연결된 업무가 없습니다' : '미완료 업무가 없습니다'}</div>}
                {visibleTasks.map(t => {
                  const a = areaById.get(t.area_id); const c = areaColor(areaIndex.get(t.area_id) ?? 0); const di = dueInfo(t.due_at, t.status === 'done'); const p = lookup(t.assignee_ids[0]); const done = t.status === 'done'
                  return (
                    <div key={t.id} style={row} onClick={() => onOpenTask(t)}>
                      <span style={statusPill(t.status)}>{wbStatusLabel(t.status)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: done ? '#9CA3AF' : WB.ink, textDecoration: done ? 'line-through' : 'none' }}>
                        {a && <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.fg, marginRight: 6 }}>{a.name}</span>}
                        {t.title}{t.template_id && <span style={{ fontSize: 10, color: WB.muted, border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '0 4px', marginLeft: 6 }}>↻</span>}
                      </span>
                      <span style={{ fontSize: 12, color: done ? WB.faint : dueColor(di.tone), fontWeight: di.tone === 'warn' || di.tone === 'over' || di.tone === 'today' ? 600 : 400 }}>
                        {done ? (t.completed_at ? `✓ ${fmtYmdShort(kstDate(t.completed_at))}` : '완료') : t.start_on && t.due_at ? `${fmtYmdShort(t.start_on)} → ${fmtYmdShort(kstDate(t.due_at))}` : di.label}
                      </span>
                      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>{t.assignee_ids.length > 0 && <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={22} fontSize={9.5} />}</span>
                    </div>
                  )
                })}
                {doneCount > 0 && (
                  <button className="btn" onClick={() => setShowDoneTasks(v => !v)} style={{ width: '100%', border: 'none', background: '#fff', padding: '9px 12px', fontSize: 12, color: WB.muted, cursor: 'pointer', fontWeight: 400, fontFamily: 'inherit' }}>
                    {showDoneTasks ? '완료 접기 ▴' : `완료 ${doneCount}건 더 보기 ▾`}
                  </button>
                )}
              </div>

              {/* 이슈 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 0 8px' }}>
                <b style={{ fontSize: 14 }}>이슈 {sel.issues}</b>
                {sel.issues > 0 && <span style={{ fontSize: 12, color: WB.muted }}>열림 {sel.openIssues} · 종결 {sel.issues - sel.openIssues}</span>}
              </div>
              <div style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 10, overflow: 'hidden' }}>
                {selIssues.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: WB.faint, textAlign: 'center' }}>연결된 이슈가 없습니다</div>}
                {selIssues.map(i => {
                  const sv = wbSeverityDef(i.severity); const closed = i.status === 'resolved' || i.status === 'wontfix'; const p = lookup(i.reporter_id)
                  return (
                    <div key={i.id} style={row} onClick={() => onOpenIssue(i)}>
                      <span style={issuePill(i.status)}>{wbIssueStatusLabel(i.status)}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: closed ? '#9CA3AF' : WB.ink, textDecoration: closed ? 'line-through' : 'none' }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: sv.bg, color: sv.fg, marginRight: 6 }}>{sv.label}</span>{i.title}
                      </span>
                      <span style={{ fontSize: 12, color: WB.muted }}>{fmtYmdShort(i.occurred_on)} 발생</span>
                      <span style={{ display: 'flex', justifyContent: 'flex-end' }}><UserAvatar name={p.name} avatarUrl={p.avatar_url} size={22} fontSize={9.5} /></span>
                    </div>
                  )
                })}
              </div>

              {/* 이력 */}
              <div style={{ margin: '18px 0 8px' }}><b style={{ fontSize: 14 }}>이력</b></div>
              <div style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
                {activity === null && <div style={{ color: WB.faint, fontSize: 12 }}>불러오는 중…</div>}
                {activity?.length === 0 && <div style={{ color: WB.faint, fontSize: 12 }}>이력 없음 (3-E 이전에 만든 마일스톤은 생성 이력이 없습니다)</div>}
                {activity?.map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: WB.body }}><b>{lookup(a.actor_id).name}</b> {describeMsActivity(a)}</span>
                    <span style={{ color: WB.faint, whiteSpace: 'nowrap', marginLeft: 'auto' }}>{fmtYmdShort(kstDate(a.created_at))} {kstTime(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </>
          )
        })()}
      </div>

      {confirmDel && selected && (
        <ConfirmDialog title="마일스톤 삭제" variant="danger" confirmLabel="삭제"
          message={<>"{selected.title}" 을(를) 삭제합니다. 이력도 함께 사라지며 되돌릴 수 없습니다.</>}
          onClose={() => setConfirmDel(false)}
          onConfirm={() => { const id = selected.id; setConfirmDel(false); void onDelete(id) }} />
      )}
    </div>
  )
}

function Stat({ label, value, sub, bar, color }: { label: string; value: string; sub?: string; bar?: number; color?: string }) {
  return (
    <div style={{ border: `1px solid ${WB.cardBorder}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, color: WB.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? WB.ink }}>{value}{sub && <small style={{ fontSize: 12, color: WB.muted, fontWeight: 500, marginLeft: 4 }}>{sub}</small>}</div>
      {bar !== undefined && <div style={{ height: 6, background: WB.colBg, borderRadius: 999, overflow: 'hidden', marginTop: 8 }}><div style={{ width: `${bar}%`, height: '100%', background: WB.ink, borderRadius: 999 }} /></div>}
    </div>
  )
}

export function rangeLabel(m: WbMilestone): string {
  if (m.start_on && m.end_on) return `${fmtYmdShort(m.start_on)} → ${fmtYmdShort(m.end_on)} · ${daysDiff(m.start_on, m.end_on) + 1}일`
  if (m.start_on) return `${fmtYmdShort(m.start_on)} 시작 · 종료 미정`
  if (m.end_on) return `${fmtYmdShort(m.end_on)} 마감`
  return '기간 미정'
}

const FIELD: Record<string, string> = { title: '제목', description: '설명', start_on: '시작일', end_on: '종료일', status: '상태' }
const fmtV = (k: string, v: any): string => {
  if (v === null || v === undefined || v === '') return '없음'
  if (k === 'status') return wbMsStatusDef(v).label
  if (k === 'start_on' || k === 'end_on') return fmtYmdShort(v)
  return String(v).length > 40 ? String(v).slice(0, 40) + '…' : String(v)
}
function describeMsActivity(a: WbActivity): string {
  const d = a.diff ?? {}
  switch (a.action) {
    case 'created': return '마일스톤 생성'
    case 'status':
    case 'updated': return Object.entries(d).map(([k, v]: [string, any]) => `${FIELD[k] ?? k} ${fmtV(k, v?.from)} → ${fmtV(k, v?.to)}`).join(' / ')
    default:        return a.action
  }
}
