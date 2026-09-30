/**
 * MyTasksView.tsx — Work Space '내 업무' (미리보기 승인분 2026-09-29)
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P3-B] 신규
 *
 * 대상 = 내가 담당자(assignee)인 업무. 보드와 같은 tasks 상태를 받아 필터만 한다 (추가 조회 0)
 * 버킷 5개(지연 · 오늘 · 이번 주 · 이후 · 마감 없음) — dueInfo/weekRange 판정 그대로, 각 버킷 마감 임박순, 빈 버킷 숨김
 * 행 앞 체크 = 완료(onSetStatus done) — 다이얼로그 없음, 토스트는 부모 핸들러가 낸다 (고지 확정)
 * 우측: 내 담당 업무영역(주·부 포함, 고지 확정) + 그 영역의 미완료 수(담당 여부 무관 — 책임 범위 조망) / 이번 주 완료
 */

import { useMemo } from 'react'
import type { WbTask, WbTaskStatus, WbWorkArea, WbMilestone } from '../../types'
import { WB, WB_STATUSES, WB_RRULE_LABEL, areaColor, checklistProgress, dueInfo, dueColor, kstDate, weekRange, fmtYmdShort, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

interface Props {
  tasks:       WbTask[]
  areas:       WbWorkArea[]
  milestones:  WbMilestone[]
  authUserId:  string
  lookup:      (id: string | null | undefined) => WbPerson
  onOpenTask:  (t: WbTask) => void
  onSetStatus: (id: string, s: WbTaskStatus) => void
  movingId:    string | null
  /** 상단 토글 상태 — 페이지 헤더(WorkboardPage)가 소유·렌더한다 (보드 필터와 같은 자리) */
  showDone:    boolean
  withRecur:   boolean
}

type Bucket = 'overdue' | 'today' | 'week' | 'later' | 'none'
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'overdue', label: '지연' }, { id: 'today', label: '오늘' }, { id: 'week', label: '이번 주' }, { id: 'later', label: '이후' }, { id: 'none', label: '마감 없음' },
]

/** 버킷 판정 — 완료 업무도 마감 기준으로 같은 버킷에 둔다(취소선). 지연은 미완료만 */
export function bucketOf(t: WbTask, today: string, weekEnd: string): Bucket {
  if (!t.due_at) return 'none'
  const ymd = kstDate(t.due_at)
  if (ymd < today) return t.status === 'done' ? 'later' : 'overdue'   // 완료된 과거 건은 '이후' 가 아니라 아래 sortKey 로 뒤에 감 — 표시상 지연 아님
  if (ymd === today) return 'today'
  if (ymd <= weekEnd) return 'week'
  return 'later'
}

export function MyTasksView({ tasks, areas, milestones, authUserId, lookup, onOpenTask, onSetStatus, movingId, showDone, withRecur }: Props) {
  const today = todayStr()
  const [weekStart, weekEnd] = weekRange(today)

  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const areaById  = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const msById    = useMemo(() => new Map(milestones.map(m => [m.id, m])), [milestones])

  const mine = useMemo(() => tasks.filter(t => t.assignee_ids.includes(authUserId) && (withRecur || !t.template_id)), [tasks, authUserId, withRecur])
  const open = useMemo(() => mine.filter(t => t.status !== 'done'), [mine])

  // 요약
  const stats = useMemo(() => {
    let overdue = 0, todayN = 0, week = 0, doing = 0
    for (const t of open) {
      if (t.status === 'doing') doing++
      if (!t.due_at) continue
      const ymd = kstDate(t.due_at)
      if (ymd < today) overdue++
      else if (ymd === today) todayN++
      if (ymd >= weekStart && ymd <= weekEnd) week++
    }
    return { overdue, todayN, week, doing, open: open.length }
  }, [open, today, weekStart, weekEnd])

  // 버킷 분류
  const buckets = useMemo(() => {
    const m: Record<Bucket, WbTask[]> = { overdue: [], today: [], week: [], later: [], none: [] }
    for (const t of showDone ? mine : open) m[bucketOf(t, today, weekEnd)].push(t)
    const byDue = (a: WbTask, b: WbTask) => {
      if (a.status === 'done' !== (b.status === 'done')) return a.status === 'done' ? 1 : -1   // 완료는 버킷 안에서 뒤로
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
      return b.created_at.localeCompare(a.created_at)
    }
    for (const k of Object.keys(m) as Bucket[]) m[k].sort(byDue)
    return m
  }, [mine, open, showDone, today, weekEnd])

  // 내 담당 업무영역 (주·부) + 영역 미완료 수 (담당 여부 무관)
  const myAreas = useMemo(() => areas
    .filter(a => a.is_active && (a.primary_owner_id === authUserId || a.backup_owner_id === authUserId))
    .map(a => ({ area: a, role: a.primary_owner_id === authUserId ? '주' : '부', openCount: tasks.filter(t => t.area_id === a.id && t.status !== 'done').length })),
  [areas, tasks, authUserId])

  const doneThisWeek = useMemo(() => mine.filter(t => t.status === 'done' && t.completed_at && kstDate(t.completed_at) >= weekStart && kstDate(t.completed_at) <= weekEnd)
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')), [mine, weekStart, weekEnd])

  const stat = (n: number, label: string, color?: string, sub?: string) => (
    <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, marginBottom: 6, color: color ?? WB.ink }}>{n}{sub && <span style={{ fontSize: 13, color: WB.muted, fontWeight: 500 }}> {sub}</span>}</div>
      <div style={{ fontSize: 12, color: WB.muted }}>{label}</div>
    </div>
  )
  return (
    <div style={{ fontFamily: WB.font }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 16, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {stat(stats.overdue, '지연', stats.overdue ? WB.dueWarn : undefined)}
            {stat(stats.todayN, '오늘 마감', stats.todayN ? WB.dueToday : undefined)}
            {stat(stats.week, '이번 주')}
            {stat(stats.doing, '진행 중 / 내 미완료', undefined, `/ ${stats.open}`)}
          </div>

          {mine.length === 0 && (
            <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 12, padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>
              내가 담당인 업무가 없습니다 — 보드에서 업무의 담당자에 나를 추가하면 여기에 모입니다
            </div>
          )}

          {BUCKETS.map(b => {
            const list = buckets[b.id]; if (list.length === 0) return null
            return (
              <div key={b.id} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: b.id === 'overdue' ? WB.dueWarn : WB.body, padding: '4px 4px 8px' }}>
                  {b.label}
                  <span style={{ fontSize: 11, color: WB.muted, background: '#fff', borderRadius: 999, padding: '2px 8px', border: `1px solid ${WB.cardBorder}`, fontWeight: 700 }}>{list.length}</span>
                </div>
                {list.map(t => {
                  const isDone = t.status === 'done'
                  const ac = areaColor(areaIndex.get(t.area_id) ?? 0)
                  const area = areaById.get(t.area_id)
                  const due = dueInfo(t.due_at, isDone)
                  const ck = checklistProgress(t.checklist)
                  const ms = t.milestone_id ? msById.get(t.milestone_id) : undefined
                  const busy = movingId === t.id
                  return (
                    <div key={t.id} onClick={() => onOpenTask(t)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, background: isDone ? WB.pageBg : '#fff', border: `1px solid ${isDone ? WB.colBg : WB.cardBorder}`, borderRadius: 10, padding: '10px 14px', marginBottom: 6, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
                      {/* 완료 체크 */}
                      <button className="btn" aria-label={isDone ? '완료 취소' : '완료'} disabled={busy}
                        onClick={e => { e.stopPropagation(); onSetStatus(t.id, isDone ? 'todo' : 'done') }}
                        style={{ width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${isDone ? WB.ink : '#CBD5E1'}`, background: isDone ? WB.ink : '#fff', flexShrink: 0, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11 }}>
                        {isDone ? '✓' : ''}
                      </button>
                      <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: ac.bg, color: ac.fg, whiteSpace: 'nowrap' }}>{area?.name ?? '-'}</span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: isDone ? '#9CA3AF' : WB.ink, textDecoration: isDone ? 'line-through' : 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                        {t.template_id && <span style={{ fontSize: 10, color: WB.muted, border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '1px 5px', fontWeight: 400, marginLeft: 6 }}>↻ {t.template_rrule ? WB_RRULE_LABEL[t.template_rrule] : '반복'}</span>}
                        {ms && <span style={{ fontSize: 10.5, color: '#7C3AED', background: '#F5F3FF', borderRadius: 4, padding: '1px 6px', fontWeight: 600, marginLeft: 6 }}>{ms.title}</span>}
                      </span>
                      {ck.total > 0 && <span style={{ fontSize: 11.5, color: WB.muted, whiteSpace: 'nowrap' }}>☑ {ck.done}/{ck.total}</span>}
                      <span style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 110, textAlign: 'right', color: due.tone === 'none' ? '#CBD5E1' : dueColor(due.tone), fontWeight: due.tone === 'normal' || due.tone === 'none' ? 400 : 600 }}>
                        {due.tone === 'none' ? '—' : due.label}
                      </span>
                      {/* 미니 상태 세그먼트 */}
                      <div style={{ display: 'flex', gap: 2, background: '#F3F4F8', borderRadius: 999, padding: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                        {WB_STATUSES.map(s => (
                          <button key={s.id} className="btn" disabled={busy || s.id === t.status} onClick={() => onSetStatus(t.id, s.id)}
                            style={{ padding: '4px 8px', borderRadius: 999, fontSize: 10.5, border: 'none', cursor: s.id === t.status ? 'default' : 'pointer', fontFamily: 'inherit',
                              background: s.id === t.status ? WB.ink : 'transparent', color: s.id === t.status ? '#fff' : WB.faint, fontWeight: s.id === t.status ? 600 : 400 }}>
                            {s.id === 'doing' ? '진행' : s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* 사이드 */}
        <div>
          <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>내 담당 업무영역</h3>
            <div style={{ fontSize: 12, color: WB.faint, marginBottom: 8 }}>분장표 기준 · 주/부 담당</div>
            {myAreas.length === 0 && <div style={{ fontSize: 12.5, color: WB.muted, padding: '10px 0' }}>담당으로 지정된 업무영역이 없습니다</div>}
            {myAreas.map(({ area, role, openCount }) => { const ac = areaColor(areaIndex.get(area.id) ?? 0); return (
              <div key={area.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderTop: `1px solid ${WB.line}`, fontSize: 13 }}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: ac.bg, color: ac.fg }}>{area.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 4, padding: '2px 6px', color: role === '주' ? WB.accent : WB.muted, background: role === '주' ? WB.accentBg : '#F1F5F9' }}>{role}</span>
                </span>
                <span style={{ color: WB.muted, fontSize: 12 }}>미완료 {openCount}</span>
              </div>
            )})}
          </div>
          <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 12, padding: 16, marginTop: 12 }}>
            <h3 style={{ margin: '0 0 4px', fontSize: 14 }}>이번 주 완료</h3>
            <div style={{ fontSize: 12, color: WB.faint, marginBottom: 8 }}>{fmtYmdShort(weekStart)} – {fmtYmdShort(weekEnd)} · {doneThisWeek.length}건</div>
            {doneThisWeek.length === 0 && <div style={{ fontSize: 12.5, color: WB.muted }}>아직 없음</div>}
            <div style={{ fontSize: 13, color: WB.muted, lineHeight: 1.9 }}>
              {doneThisWeek.slice(0, 8).map(t => <div key={t.id} style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => onOpenTask(t)}>✓ {t.title}</div>)}
              {doneThisWeek.length > 8 && <div style={{ color: WB.faint, fontSize: 12 }}>외 {doneThisWeek.length - 8}건</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
