/**
 * TaskCard.tsx — Work Space 보드 카드 (미리보기 승인분 2026-09-29)
 *
 * ✅ 변경 이력
 *  - [2026-09-29 WORKBOARD P3-A] 신규
 *
 * 구성: [영역 칩][↻ 반복][우선순위 점] / 제목 / [마감][☑ n/m][마일스톤] … [담당자 아바타]
 * 완료 카드: 제목 취소선 + "✓ 완료일 · 완료자", 마감 강조 해제
 * 드래그: HTML5 DnD — dataTransfer 에 task id. 시각 상태(dragging)는 부모가 내려준다
 */

import type { CSSProperties } from 'react'
import type { WbTask, WbWorkArea, WbMilestone } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { WB, WB_RRULE_LABEL, areaColor, checklistProgress, dueColor, dueInfo, kstDate, fmtYmdShort, wbPriorityDef, type WbPerson } from './wbShared'

interface Props {
  task:       WbTask
  area:       WbWorkArea | undefined
  areaIndex:  number
  milestone:  WbMilestone | undefined
  lookup:     (id: string | null | undefined) => WbPerson
  dragging:   boolean
  onClick:    () => void
  onDragStart:(e: React.DragEvent) => void
  onDragEnd:  () => void
}

export function TaskCard({ task, area, areaIndex, milestone, lookup, dragging, onClick, onDragStart, onDragEnd }: Props) {
  const isDone = task.status === 'done'
  const ac = areaColor(areaIndex)
  const pr = wbPriorityDef(task.priority)
  const due = dueInfo(task.due_at, isDone)
  const ck = checklistProgress(task.checklist)
  const assignees = task.assignee_ids.map(lookup)

  const root: CSSProperties = {
    background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 10,
    padding: '12px 12px 10px', marginBottom: 8, cursor: 'grab', position: 'relative',
    fontFamily: WB.font, userSelect: 'none',
    opacity: dragging ? 0.55 : 1,
    transform: dragging ? 'rotate(1.5deg)' : 'none',
    boxShadow: dragging ? '0 12px 30px rgba(15,23,42,.18)' : 'none',
    borderStyle: dragging ? 'dashed' : 'solid',
    transition: 'box-shadow 120ms ease, opacity 120ms ease',
  }

  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onClick} style={root}
      role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onClick() }}>
      {/* 1행: 영역 · 반복 · 우선순위 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: ac.bg, color: ac.fg, whiteSpace: 'nowrap' }}>
          {area?.name ?? '영역 없음'}
        </span>
        {task.template_id && (
          <span style={{ fontSize: 10, color: WB.muted, border: `1px solid ${WB.cardBorder}`, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
            ↻ {task.template_rrule ? WB_RRULE_LABEL[task.template_rrule] : '반복'}
          </span>
        )}
        {!isDone && <span title={pr.label} style={{ width: 8, height: 8, borderRadius: '50%', marginLeft: 'auto', background: pr.dot, flexShrink: 0 }} />}
      </div>

      {/* 제목 */}
      <div style={{
        fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 10, color: isDone ? WB.muted : WB.ink,
        textDecoration: isDone ? 'line-through' : 'none', textDecorationColor: '#CBD5E1',
        wordBreak: 'keep-all', overflowWrap: 'anywhere',
      }}>{task.title}</div>

      {/* 메타 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: WB.muted, flexWrap: 'wrap' }}>
        {isDone ? (
          <span>✓ {task.completed_at ? fmtYmdShort(kstDate(task.completed_at)) : ''}{task.completed_by ? ` · ${lookup(task.completed_by).name}` : ''}</span>
        ) : (
          <>
            {due.tone !== 'none' && (
              <span style={{ color: dueColor(due.tone), fontWeight: due.tone === 'normal' ? 400 : 600, whiteSpace: 'nowrap' }}>
                📅 {due.label}
              </span>
            )}
            {ck.total > 0 && <span style={{ whiteSpace: 'nowrap' }}>☑ {ck.done}/{ck.total}</span>}
            {milestone && (
              <span style={{ fontSize: 10.5, color: '#7C3AED', background: '#F5F3FF', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{milestone.title}</span>
            )}
            {task.status === 'hold' && due.tone === 'none' && <span style={{ color: WB.faint }}>보류</span>}
          </>
        )}
        {assignees.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
            {assignees.slice(0, 4).map(p => (
              <span key={p.id} title={p.name + (p.departed ? ' (퇴사)' : '')} style={{ marginLeft: -6, borderRadius: '50%', border: '2px solid #fff', display: 'flex', opacity: p.departed ? 0.55 : 1 }}>
                <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={22} fontSize={9.5} />
              </span>
            ))}
            {assignees.length > 4 && <span style={{ marginLeft: 2, fontSize: 10, color: WB.faint, alignSelf: 'center' }}>+{assignees.length - 4}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
