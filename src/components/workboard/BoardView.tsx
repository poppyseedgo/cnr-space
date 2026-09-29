/**
 * BoardView.tsx — Work Space 보드(칸반) 뷰 (미리보기 승인분 2026-09-29)
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P3-A] 신규
 *
 * 열 4개 = wb_tasks.status 1:1 (todo / doing / done / hold — 고지 확정 라벨 할 일·진행 중·완료·보류)
 * 드래그 → 열 이동 = onMoveStatus(taskId, status). 저장·실패 복구는 부모(WorkboardPage)가 담당,
 *   여기는 드래그 시각 상태와 드롭 자리(파란 점선)만 그린다.
 * 완료 열: 최근 3건 + "완료 N건 더보기" (completed_at desc)
 * 필터(상단): 담당자 / 업무영역 / 마감 프리셋 / 반복 포함 — 상태는 부모가 소유(세션 상태, 해시 미저장)
 */

import { useMemo, useState } from 'react'
import type { WbTask, WbTaskStatus, WbWorkArea, WbMilestone } from '../../types'
import { TaskCard } from './TaskCard'
import { WB, WB_STATUSES, type WbPerson } from './wbShared'

interface Props {
  tasks:       WbTask[]              // 이미 필터 적용된 목록
  areas:       WbWorkArea[]
  milestones:  WbMilestone[]
  lookup:      (id: string | null | undefined) => WbPerson
  onOpenTask:  (task: WbTask) => void
  onNewTask:   (status: WbTaskStatus) => void
  onMoveStatus:(taskId: string, to: WbTaskStatus) => void
  movingId:    string | null          // 저장 진행 중인 카드 (드롭 후 응답 대기)
}

const DONE_VISIBLE = 3

export function BoardView({ tasks, areas, milestones, lookup, onOpenTask, onNewTask, onMoveStatus, movingId }: Props) {
  const [dragId, setDragId]     = useState<string | null>(null)
  const [overCol, setOverCol]   = useState<WbTaskStatus | null>(null)
  const [showAllDone, setShowAllDone] = useState(false)

  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const areaById  = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const msById    = useMemo(() => new Map(milestones.map(m => [m.id, m])), [milestones])

  const byStatus = useMemo(() => {
    const m: Record<WbTaskStatus, WbTask[]> = { todo: [], doing: [], done: [], hold: [] }
    for (const t of tasks) m[t.status].push(t)
    // 완료는 최근 완료순, 나머지는 마감 임박순(마감 없음은 뒤) → created_at desc
    m.done.sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
    const byDue = (a: WbTask, b: WbTask) => {
      if (a.due_at && b.due_at) return a.due_at.localeCompare(b.due_at)
      if (a.due_at) return -1
      if (b.due_at) return 1
      return b.created_at.localeCompare(a.created_at)
    }
    m.todo.sort(byDue); m.doing.sort(byDue); m.hold.sort(byDue)
    return m
  }, [tasks])

  const dragTask = dragId ? tasks.find(t => t.id === dragId) : null

  const onDrop = (to: WbTaskStatus) => (e: React.DragEvent) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/wb-task') || dragId
    setOverCol(null); setDragId(null)
    if (!id) return
    const t = tasks.find(x => x.id === id)
    if (!t || t.status === to) return
    onMoveStatus(id, to)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, alignItems: 'start', fontFamily: WB.font }}>
      {WB_STATUSES.map(col => {
        const list = byStatus[col.id]
        const visible = col.id === 'done' && !showAllDone ? list.slice(0, DONE_VISIBLE) : list
        const hiddenDone = col.id === 'done' ? list.length - visible.length : 0
        const isOver = overCol === col.id && dragTask && dragTask.status !== col.id
        return (
          <div key={col.id}
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overCol !== col.id) setOverCol(col.id) }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverCol(null) }}
            onDrop={onDrop(col.id)}
            style={{
              background: isOver ? '#E5EBF3' : WB.colBg, borderRadius: 12, padding: 10, minHeight: 640,
              transition: 'background 120ms ease',
              outline: isOver ? `2px dashed ${WB.accent}` : '2px dashed transparent', outlineOffset: -2,
            }}>
            {/* 헤더 */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px 10px', fontSize: 13, fontWeight: 700, color: WB.body }}>
              <span>{col.label}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: WB.muted, background: '#fff', borderRadius: 999, padding: '2px 8px' }}>{list.length}</span>
            </div>

            {visible.map(t => (
              <TaskCard key={t.id} task={t}
                area={areaById.get(t.area_id)} areaIndex={areaIndex.get(t.area_id) ?? 0}
                milestone={t.milestone_id ? msById.get(t.milestone_id) : undefined}
                lookup={lookup}
                dragging={dragId === t.id || movingId === t.id}
                onClick={() => { if (!dragId) onOpenTask(t) }}
                onDragStart={e => { e.dataTransfer.setData('text/wb-task', t.id); e.dataTransfer.effectAllowed = 'move'; setDragId(t.id) }}
                onDragEnd={() => { setDragId(null); setOverCol(null) }}
              />
            ))}

            {/* 드롭 자리 — 드래그 중이고 다른 열 위일 때 */}
            {isOver && (
              <div style={{ height: 88, marginBottom: 8, borderRadius: 10, border: `2px dashed ${WB.accent}`, background: WB.accentBg, opacity: 0.6 }} />
            )}

            {col.id === 'done' ? (
              hiddenDone > 0 || showAllDone ? (
                <button className="btn" onClick={() => setShowAllDone(v => !v)}
                  style={{ width: '100%', border: `1px solid ${WB.cardBorder}`, background: 'transparent', borderRadius: 10, padding: 10, color: WB.faint, fontSize: 12.5, fontWeight: 400, cursor: 'pointer' }}>
                  {showAllDone ? '접기' : `완료 ${hiddenDone}건 더보기`}
                </button>
              ) : null
            ) : (
              <button className="btn" onClick={() => onNewTask(col.id)}
                style={{ width: '100%', border: '1px dashed #CBD5E1', background: 'transparent', borderRadius: 10, padding: 10, color: WB.faint, fontSize: 12.5, fontWeight: 400, cursor: 'pointer' }}>
                + 업무 추가
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
