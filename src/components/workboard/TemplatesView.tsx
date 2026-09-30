/**
 * TemplatesView.tsx — 분장표 탭 › '반복 업무' 세그먼트 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P4] 신규 — 실행 바(마지막 자동 생성 · 다음 실행 예정) + 템플릿 표(영역 · 업무 · 주기 · 다음 생성 · 기본 담당 · 체크 · 활성)
 *      · '다음 생성' 열은 wb_templates_next(DB) 결과 — 클라 계산 없음
 *      · 활성 토글 = 행에서 즉시 저장(onToggleActive → wb_upsert_task_template). 삭제 없음(비활성화)
 */

import { useMemo, type CSSProperties } from 'react'
import { Pencil, RotateCw } from 'lucide-react'
import type { WbTaskTemplate, WbWorkArea, WbTemplateDue, WbRecurringRun } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { WB, areaColor, rruleLabel, rruleDescribe, shiftedLabel, fmtYmdShort, kstDate, kstTime, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

interface Props {
  templates:      WbTaskTemplate[]
  areas:          WbWorkArea[]
  next:           Map<string, WbTemplateDue>
  lastRun:        WbRecurringRun | null
  lookup:         (id: string | null | undefined) => WbPerson
  showInactive:   boolean
  selectedId:     string | null
  onOpen:         (t: WbTaskTemplate) => void
  onToggleActive: (t: WbTaskTemplate) => Promise<void>
  busy:           boolean
}

const COLS = '140px minmax(0,1fr) 120px 150px 130px 56px 56px 28px'

export function TemplatesView({ templates, areas, next, lastRun, lookup, showInactive, selectedId, onOpen, onToggleActive, busy }: Props) {
  const today = todayStr()
  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const areaById  = useMemo(() => new Map(areas.map(a => [a.id, a])), [areas])
  const rows = useMemo(() => templates
    .filter(t => showInactive || t.is_active)
    .sort((a, b) => (areaIndex.get(a.area_id) ?? 0) - (areaIndex.get(b.area_id) ?? 0) || (next.get(a.id)?.due_on ?? '9999').localeCompare(next.get(b.id)?.due_on ?? '9999') || a.title.localeCompare(b.title, 'ko')),
    [templates, showInactive, areaIndex, next])
  const dueTomorrowOrToday = (d: string) => d === today ? '오늘' : d === addDays(today, 1) ? '내일' : null
  const upcoming = useMemo(() => [...next.values()].filter(n => n.due_on === addDays(today, 1)).length, [next, today])

  const cell: CSSProperties = { display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', padding: '11px 14px', borderBottom: `1px solid ${WB.line}`, fontSize: 13, gap: 10 }

  return (
    <div style={{ fontFamily: WB.font }}>
      {/* 실행 바 */}
      <div data-wb-runbar style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 12, padding: '10px 14px', fontSize: 12.5, marginBottom: 12, flexWrap: 'wrap' }}>
        <RotateCw size={13} style={{ color: WB.muted }} />
        {lastRun ? (
          <>
            <span>마지막 생성 <b>{fmtYmdShort(kstDate(lastRun.ran_at))} {kstTime(lastRun.ran_at)}</b></span>
            <span style={{ color: lastRun.created_count > 0 ? '#047857' : WB.muted, fontWeight: 700 }}>{lastRun.created_count}건 생성</span>
            <span style={{ color: WB.muted }}>· {lastRun.triggered_by ? `${lookup(lastRun.triggered_by).name} 수동` : '자동(00:00 KST)'} · 대상 아님 {lastRun.skipped_count}</span>
          </>
        ) : <span style={{ color: WB.muted }}>아직 자동 생성 실행 기록이 없습니다 — 매일 00:00 KST 에 실행됩니다</span>}
        <span style={{ marginLeft: 'auto', color: WB.muted }}>다음 실행 {fmtYmdShort(addDays(today, 1))} 00:00 → 예정 <b style={{ color: WB.ink }}>{upcoming}</b>건</span>
      </div>

      <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ ...cell, background: '#F8FAFC', fontSize: 11.5, color: WB.muted, fontWeight: 600, padding: '10px 14px' }}>
          <span>영역</span><span>업무</span><span>주기</span><span>다음 생성</span><span>기본 담당</span><span>체크</span><span>활성</span><span />
        </div>
        {rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>{templates.length === 0 ? '반복 업무가 없습니다 — 우측 상단 "+ 반복 업무 추가"' : '활성 반복 업무가 없습니다'}</div>}
        {rows.map(t => {
          const a = areaById.get(t.area_id); const c = areaColor(areaIndex.get(t.area_id) ?? 0); const n = next.get(t.id); const soon = n ? dueTomorrowOrToday(n.due_on) : null; const cur = t.id === selectedId
          return (
            <div key={t.id} data-wb-tpl={t.id} onClick={() => onOpen(t)} style={{ ...cell, cursor: 'pointer', background: cur ? '#F8FAFC' : '#fff', boxShadow: cur ? `inset 3px 0 0 ${WB.ink}` : 'none', opacity: t.is_active ? 1 : .5 }}>
              <span><span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.fg }}>{a?.name ?? '(삭제된 영역)'}</span></span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: 11.5, color: WB.muted, marginTop: 2 }}>{t.is_active ? rruleDescribe(t) : `${rruleDescribe(t)} — 비활성 (자동 생성 안 함)`}</div>
              </span>
              <span><span style={{ fontSize: 11, fontWeight: 700, border: `1px solid ${WB.cardBorder}`, borderRadius: 5, padding: '2px 7px', color: WB.body, whiteSpace: 'nowrap', display: 'inline-flex', gap: 4, alignItems: 'center' }}><RotateCw size={10} /> {rruleLabel(t)}</span></span>
              <span style={{ fontSize: 12.5 }}>
                {!t.is_active || !n ? <span style={{ color: WB.faint }}>—</span> : (
                  <>
                    <div style={{ color: soon ? WB.dueToday : WB.ink, fontWeight: soon ? 600 : 400 }}>{fmtYmdShort(n.due_on)}{soon && ` · ${soon}`}</div>
                    <div style={{ fontSize: 11, color: WB.faint }}>{n.period_key}{n.shifted && <span style={{ color: '#B45309' }}> · {shiftedLabel(n.shifted)}</span>}</div>
                  </>
                )}
              </span>
              <span style={{ display: 'flex' }}>
                {t.default_assignee_ids.length === 0 && <span style={{ color: '#CBD5E1', fontSize: 12.5 }}>— 없음</span>}
                {t.default_assignee_ids.slice(0, 3).map((id, i) => { const p = lookup(id); return <span key={id} style={{ marginLeft: i ? -6 : 0, border: '2px solid #fff', borderRadius: '50%' }}><UserAvatar name={p.name} avatarUrl={p.avatar_url} size={22} fontSize={9.5} /></span> })}
                {t.default_assignee_ids.length > 3 && <span style={{ fontSize: 11, color: WB.faint, alignSelf: 'center', marginLeft: 4 }}>+{t.default_assignee_ids.length - 3}</span>}
              </span>
              <span style={{ fontWeight: 600 }}>{t.checklist.length}</span>
              <button className="btn" role="switch" aria-checked={t.is_active} aria-label={`${t.title} 활성`} disabled={busy} onClick={e => { e.stopPropagation(); void onToggleActive(t) }}
                style={{ width: 34, height: 20, borderRadius: 999, border: 'none', background: t.is_active ? WB.ink : '#CBD5E1', position: 'relative', cursor: busy ? 'wait' : 'pointer', padding: 0, flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: t.is_active ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
              </button>
              <span style={{ color: cur ? WB.ink : WB.faint, display: 'flex' }}><Pencil size={13} /></span>
            </div>
          )
        })}
        <div style={{ padding: '10px 14px', fontSize: 12, color: WB.faint, background: '#FAFAFA' }}>
          활성 {templates.filter(t => t.is_active).length} · 비활성 {templates.filter(t => !t.is_active).length} · 생성된 업무는 보드 카드에 ↻ 표시 · 템플릿 수정은 <b>다음 생성분부터</b> 반영(이미 만들어진 업무는 그대로) · 삭제 없음 — 비활성화
        </div>
      </div>
    </div>
  )
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10)
}
