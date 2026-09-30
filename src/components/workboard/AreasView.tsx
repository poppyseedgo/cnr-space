/**
 * AreasView.tsx — Work Space '분장표' 탭 = 업무영역 관리 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-F] 주/부 담당 select → WbPersonPicker(single ×2, 상호 exclude). 풀 = members
 *  - [2026-09-30 WORKBOARD P3-E] 신규 — 표(순서 ▲▼ · 이름 · 설명 · 주/부 담당 · 열린 업무 · 반복 템플릿 · 활성) + 우측 편집 패널
 *      · 저장 = wb_upsert_work_area(이력 자동) · 순서 = wb_reorder_work_areas(전체 id 배열, 한 트랜잭션)
 *      · 활성 토글은 행에서 즉시 저장(토스트). 삭제 없음 — 비활성화 정책(고지 확정 2026-09-30)
 *      · 주·부 담당 동일 인물 금지: 클라 선차단 + RPC INVALID_OWNER_SAME
 *
 * 열린 업무 = todo·doing·hold 건수, 지연 포함이면 빨강. 반복 템플릿 수는 templateCounts(Phase 4 연결 전엔 0)
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ChevronUp, ChevronDown, Pencil } from 'lucide-react'
import type { WbWorkArea, WbWorkAreaUpsertInput, WbTask, WbActivity, WbMember } from '../../types'
import { UserAvatar } from '../common/UserAvatar'
import { WbPersonPicker } from './WbPersonPicker'  // ← [P3-F]
import { loadWbActivity, wbErrorMessage } from '../../lib/workboardApi'
import { WB, areaColor, kstDate, kstTime, fmtYmdShort, type WbPerson } from './wbShared'
import { todayStr } from '../../utils/time'

export type AreaEditor = { mode: 'edit'; id: string } | { mode: 'new' } | null

interface Props {
  areas:          WbWorkArea[]          // sort_order 순 (페이지가 로드한 그대로 — 색 인덱스 SSOT)
  tasks:          WbTask[]
  templateCounts: Map<string, number>
  members:        WbMember[]   // ← [P3-F] 선택 풀
  authUserId:     string
  lookup:         (id: string | null | undefined) => WbPerson
  showInactive:   boolean
  editor:         AreaEditor
  onEditorChange: (e: AreaEditor) => void
  onSave:         (input: WbWorkAreaUpsertInput) => Promise<void>
  onToggleActive: (a: WbWorkArea) => Promise<void>
  onReorder:      (ids: string[]) => Promise<void>
  busy:           boolean
}

const COLS = '44px 170px minmax(0,1fr) 120px 120px 84px 84px 56px 32px'
const LABEL: CSSProperties = { display: 'block', fontSize: 11.5, color: WB.muted, marginBottom: 5, fontWeight: 600 }
const INPUT: CSSProperties = { width: '100%', border: '1px solid #D1D7E1', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: WB.ink, background: '#fff' }

function Toggle({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick: () => void; label: string }) {
  return (
    <button className="btn" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={e => { e.stopPropagation(); onClick() }}
      style={{ width: 34, height: 20, borderRadius: 999, border: 'none', background: on ? WB.ink : '#CBD5E1', position: 'relative', cursor: disabled ? 'wait' : 'pointer', padding: 0, opacity: disabled ? .6 : 1, flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
    </button>
  )
}

export function AreasView({ areas, tasks, templateCounts, members, authUserId, lookup, showInactive, editor, onEditorChange, onSave, onToggleActive, onReorder, busy }: Props) {
  const today = todayStr()
  const areaIndex = useMemo(() => new Map(areas.map((a, i) => [a.id, i])), [areas])
  const rows = useMemo(() => areas.filter(a => showInactive || a.is_active), [areas, showInactive])
  const stats = useMemo(() => {
    const m = new Map<string, { open: number; total: number; overdue: number }>()
    for (const t of tasks) {
      const s = m.get(t.area_id) ?? { open: 0, total: 0, overdue: 0 }; s.total++
      if (t.status !== 'done') { s.open++; if (t.due_at && kstDate(t.due_at) < today) s.overdue++ }
      m.set(t.area_id, s)
    }
    return m
  }, [tasks, today])

  // 순서: 활성·비활성 전체를 한 배열로 — 비활성이 숨겨진 상태에서도 위치가 흔들리지 않게 전체 id 로 RPC 호출
  const move = (id: string, dir: -1 | 1) => {
    const ids = areas.map(a => a.id); const i = ids.indexOf(id); const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    void onReorder(ids)
  }

  const editing = editor?.mode === 'edit' ? areas.find(a => a.id === editor.id) ?? null : null
  const cell: CSSProperties = { display: 'grid', gridTemplateColumns: COLS, alignItems: 'center', padding: '11px 14px', borderBottom: `1px solid ${WB.line}`, fontSize: 13, gap: 10 }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 400px', gap: 14, alignItems: 'start', fontFamily: WB.font }}>
      <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ ...cell, background: '#F8FAFC', fontSize: 11.5, color: WB.muted, fontWeight: 600, padding: '10px 14px' }}>
          <span>순서</span><span>업무영역</span><span>설명</span><span>주 담당</span><span>부 담당</span><span>열린 업무</span><span>반복 템플릿</span><span>활성</span><span />
        </div>
        {rows.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>{areas.length === 0 ? '업무영역이 없습니다 — 우측에서 첫 영역을 추가하세요' : '활성 업무영역이 없습니다'}</div>}
        {rows.map(a => {
          const idx = areaIndex.get(a.id) ?? 0; const c = areaColor(idx); const st = stats.get(a.id) ?? { open: 0, total: 0, overdue: 0 }
          const p1 = a.primary_owner_id ? lookup(a.primary_owner_id) : null, p2 = a.backup_owner_id ? lookup(a.backup_owner_id) : null
          const cur = editor?.mode === 'edit' && editor.id === a.id
          return (
            <div key={a.id} data-area-row={a.id} onClick={() => onEditorChange({ mode: 'edit', id: a.id })}
              style={{ ...cell, cursor: 'pointer', background: cur ? '#F8FAFC' : '#fff', boxShadow: cur ? `inset 3px 0 0 ${WB.ink}` : 'none', opacity: a.is_active ? 1 : .55 }}>
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                <button className="btn" aria-label="위로" disabled={busy || idx === 0} onClick={e => { e.stopPropagation(); move(a.id, -1) }} style={{ border: 'none', background: 'transparent', padding: 0, cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#E2E8F0' : WB.faint, display: 'flex' }}><ChevronUp size={14} /></button>
                <button className="btn" aria-label="아래로" disabled={busy || idx === areas.length - 1} onClick={e => { e.stopPropagation(); move(a.id, 1) }} style={{ border: 'none', background: 'transparent', padding: 0, cursor: idx === areas.length - 1 ? 'default' : 'pointer', color: idx === areas.length - 1 ? '#E2E8F0' : WB.faint, display: 'flex' }}><ChevronDown size={14} /></button>
              </span>
              <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', textDecoration: a.is_active ? 'none' : 'line-through' }}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: a.is_active ? c.fg : '#94A3B8', flexShrink: 0 }} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              </span>
              <span style={{ color: WB.muted, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.description ?? ''}</span>
              <Person p={p1} /><Person p={p2} />
              <span style={{ fontWeight: 600, color: st.overdue > 0 ? WB.dueWarn : WB.ink }}>{st.open}<small style={{ color: WB.faint, fontWeight: 400, marginLeft: 3 }}>/ {st.total}</small></span>
              <span style={{ fontWeight: 600 }}>{templateCounts.get(a.id) ?? 0}</span>
              <Toggle on={a.is_active} disabled={busy} label={`${a.name} 활성`} onClick={() => void onToggleActive(a)} />
              <span style={{ color: cur ? WB.ink : WB.faint, display: 'flex' }}><Pencil size={13} /></span>
            </div>
          )
        })}
        <div style={{ padding: '10px 14px', fontSize: 12, color: WB.faint, background: '#FAFAFA' }}>
          활성 {areas.filter(a => a.is_active).length} · 비활성 {areas.filter(a => !a.is_active).length} · 순서는 ▲▼ 로 조정(즉시 저장) · 비활성 영역은 새 업무 선택지에서 숨겨지고 기존 업무는 유지됩니다
        </div>
      </div>

      {editor === null ? (
        <div style={{ background: '#fff', border: `1px dashed ${WB.cardBorder}`, borderRadius: 16, padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>행을 클릭해 편집하거나 "+ 업무영역 추가"</div>
      ) : editor.mode === 'edit' && !editing ? (
        <div style={{ background: '#fff', border: `1px dashed ${WB.cardBorder}`, borderRadius: 16, padding: 40, textAlign: 'center', color: WB.muted, fontSize: 13 }}>업무영역을 찾을 수 없습니다</div>
      ) : (
        <AreaEditorPanel key={editing?.id ?? '__new'} area={editing} areas={areas} members={members} authUserId={authUserId} lookup={lookup} busy={busy}
          onCancel={() => onEditorChange(null)} onSave={onSave} />
      )}
    </div>
  )
}

function Person({ p }: { p: WbPerson | null }) {
  if (!p) return <span style={{ color: '#CBD5E1', fontSize: 12.5 }}>— 없음</span>
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, overflow: 'hidden' }}>
      <UserAvatar name={p.name} avatarUrl={p.avatar_url} size={22} fontSize={9.5} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p.departed ? WB.faint : WB.ink }}>{p.name}{p.departed && ' (퇴사)'}</span>
    </span>
  )
}

function AreaEditorPanel({ area, areas, members, authUserId, lookup, busy, onCancel, onSave }: {
  area: WbWorkArea | null; areas: WbWorkArea[]; members: WbMember[]; authUserId: string; lookup: (id: string | null | undefined) => WbPerson; busy: boolean
  onCancel: () => void; onSave: (input: WbWorkAreaUpsertInput) => Promise<void>
}) {
  const isNew = area === null
  const [name, setName]   = useState(area?.name ?? '')
  const [desc, setDesc]   = useState(area?.description ?? '')
  const [p1, setP1]       = useState(area?.primary_owner_id ?? '')
  const [p2, setP2]       = useState(area?.backup_owner_id ?? '')
  const [active, setActive] = useState(area?.is_active ?? true)
  const [err, setErr]     = useState<string | null>(null)
  const [activity, setActivity] = useState<WbActivity[] | null>(null)
  useEffect(() => {
    if (!area?.id) return
    loadWbActivity('area', area.id).then(setActivity).catch(() => setActivity([]))
  }, [area?.id, area?.updated_at])

  const same = !!p1 && p1 === p2   // Picker exclude 로 UI에서 막지만, 방어적으로 유지 (RPC INVALID_OWNER_SAME 이 최종)
  const dirty = isNew || name.trim() !== area!.name || (desc.trim() || null) !== (area!.description ?? null) || (p1 || null) !== area!.primary_owner_id || (p2 || null) !== area!.backup_owner_id || active !== area!.is_active
  const canSave = name.trim().length > 0 && !same && dirty && !busy

  const submit = async () => {
    if (!canSave) return
    setErr(null)
    try {
      await onSave({ id: area?.id ?? null, name: name.trim(), description: desc.trim() || null, primary_owner_id: p1 || null, backup_owner_id: p2 || null,
        sort_order: area?.sort_order ?? (areas.length ? Math.max(...areas.map(a => a.sort_order)) + 1 : 1), is_active: active })
    } catch (e) { setErr(wbErrorMessage(e, '저장에 실패했습니다')) }
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${WB.cardBorder}`, borderRadius: 16, padding: '20px 22px' }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        {isNew ? '새 업무영역' : '업무영역 편집'}
        {area && <small style={{ fontSize: 11, color: WB.muted, fontWeight: 500, marginLeft: 'auto' }}>생성 {fmtYmdShort(kstDate(area.created_at))}{area.created_by ? ` · ${lookup(area.created_by).name}` : ''}</small>}
      </h3>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>이름</label>
        <input value={name} onChange={e => setName(e.target.value)} autoFocus={isNew} maxLength={60} placeholder="예: 비품 관리" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} style={INPUT} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={LABEL}>설명</label>
        <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="이 영역이 맡는 일의 범위" style={{ ...INPUT, resize: 'vertical', fontSize: 13, lineHeight: 1.5 }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label style={LABEL}>주 담당</label>
          <WbPersonPicker mode="single" value={p1 || null} onChange={id => setP1(id ?? '')} members={members} lookup={lookup} authUserId={authUserId}
            exclude={p2 ? [{ id: p2, label: '부 담당' }] : []} placeholder="이름 · 부서 검색" ariaLabel="주 담당" />
        </div>
        <div>
          <label style={LABEL}>부 담당</label>
          <WbPersonPicker mode="single" value={p2 || null} onChange={id => setP2(id ?? '')} members={members} lookup={lookup} authUserId={authUserId}
            exclude={p1 ? [{ id: p1, label: '주 담당' }] : []} placeholder="이름 · 부서 검색" ariaLabel="부 담당" />
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: same ? '#B91C1C' : '#B45309', background: same ? '#FEF2F2' : '#FFFBEB', border: `1px solid ${same ? '#FECACA' : '#FDE68A'}`, borderRadius: 8, padding: '8px 10px', marginBottom: 12, lineHeight: 1.5 }}>
        {same ? '주·부 담당은 같은 사람일 수 없습니다' : <>주·부 담당은 <b>책임자</b>이며 '내 업무 › 내 담당 업무영역' 집계 기준입니다. 건별 실행자는 각 업무의 담당자로 지정합니다.</>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, padding: '10px 12px', fontSize: 13, marginBottom: 12 }}>
        <div>활성<small style={{ display: 'block', color: WB.muted, fontSize: 11.5, marginTop: 2 }}>끄면 새 업무 등록 시 목록에서 숨겨집니다 (기존 업무·이력 유지)</small></div>
        <Toggle on={active} onClick={() => setActive(v => !v)} label="활성" />
      </div>
      {err && <div style={{ fontSize: 12, color: '#B91C1C', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel} style={{ border: '1px solid #D1D7E1', background: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 400, color: WB.ink }}>{isNew ? '취소' : '닫기'}</button>
        <button className="btn" onClick={() => void submit()} disabled={!canSave}
          style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : .5 }}>{isNew ? '추가' : '저장'}</button>
      </div>

      {area && (
        <div style={{ borderTop: `1px solid ${WB.line}`, marginTop: 16, paddingTop: 12, fontSize: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>이력</div>
          {activity === null && <div style={{ color: WB.faint }}>불러오는 중…</div>}
          {activity?.length === 0 && <div style={{ color: WB.faint }}>이력 없음</div>}
          {activity?.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 8, lineHeight: 1.8 }}>
              <span style={{ color: WB.body }}><b>{lookup(a.actor_id).name}</b> {describeAreaActivity(a, lookup)}</span>
              <span style={{ color: WB.faint, whiteSpace: 'nowrap', marginLeft: 'auto' }}>{fmtYmdShort(kstDate(a.created_at))} {kstTime(a.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const FIELD: Record<string, string> = { name: '이름', description: '설명', primary_owner_id: '주 담당', backup_owner_id: '부 담당', sort_order: '순서', is_active: '활성' }
function describeAreaActivity(a: WbActivity, lookup: (id: string | null | undefined) => WbPerson): string {
  const d = a.diff ?? {}
  const fmt = (k: string, v: any) => v === null || v === undefined || v === '' ? '없음' : k.endsWith('_id') ? lookup(v).name : k === 'is_active' ? (v ? '켜짐' : '꺼짐') : String(v).length > 30 ? String(v).slice(0, 30) + '…' : String(v)
  if (a.action === 'created') return '영역 생성'
  if (a.action === 'updated') return Object.entries(d).map(([k, v]: [string, any]) => `${FIELD[k] ?? k} ${fmt(k, v?.from)} → ${fmt(k, v?.to)}`).join(' / ')
  return a.action
}
