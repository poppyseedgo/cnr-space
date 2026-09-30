/**
 * TemplateDrawer.tsx — 반복 업무 템플릿 생성/편집 드로어 (미리보기 승인분 2026-09-30)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P4] 신규 — 영역 · 제목 · 주기(매일/주간+요일/월간+일·말일) · 비영업일 건너뜀 · 다음 생성 미리보기 4회 ·
 *      기본 담당자(WbPersonPicker multi) · 체크리스트 · 설명 · 활성 · 이력. 명시 저장(등록/저장)
 *      · 미리보기는 DB wb_template_preview 호출(디바운스) — 규칙을 클라에서 재구현하지 않는다(SSOT 1벌)
 *      · 저장은 wb_upsert_task_template. 템플릿 수정은 다음 생성분부터 반영(이미 만들어진 업무 불변)
 *      · '이번 주기 지금 생성' = 저장 후 wb_generate_recurring_now (오늘분 전체 멱등 생성) — 페이지 onGenerateNow
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { X, Plus, RotateCw } from 'lucide-react'
import type { WbTaskTemplate, WbTemplateUpsertInput, WbWorkArea, WbMember, WbRrule, WbActivity, WbTemplateDue } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { WbPersonPicker } from './WbPersonPicker'
import { previewWbTemplate, loadWbActivity, wbErrorMessage } from '../../lib/workboardApi'
import { WB, WB_WEEKDAYS, WB_RRULE_LABEL, areaColor, fmtYmdShort, kstDate, kstTime, newChecklistId, shiftedLabel, type WbPerson } from './wbShared'

interface Props {
  template:   WbTaskTemplate | null    // null = 새 템플릿
  areas:      WbWorkArea[]
  members:    WbMember[]
  authUserId: string
  lookup:     (id: string | null | undefined) => WbPerson
  saving:     boolean
  onClose:    () => void
  onSave:     (input: WbTemplateUpsertInput) => Promise<void>
  onGenerateNow?: () => Promise<void>     // 기존 템플릿에서만 노출
  showToast:  (msg: string) => void
}

const LABEL: CSSProperties = { display: 'block', fontSize: 11.5, color: WB.muted, marginBottom: 5, fontWeight: 600 }
const INPUT: CSSProperties = { width: '100%', border: '1px solid #D1D7E1', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: WB.ink, background: '#fff' }
const seg = (on: boolean): CSSProperties => ({ padding: '6px 12px', borderRadius: 999, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: on ? WB.ink : '#fff', color: on ? '#fff' : '#657487', fontWeight: on ? 600 : 400 })

export function TemplateDrawer({ template, areas, members, authUserId, lookup, saving, onClose, onSave, onGenerateNow, showToast }: Props) {
  const isNew = template === null
  const [areaId, setAreaId]   = useState(template?.area_id ?? areas.find(a => a.is_active)?.id ?? '')
  const [title, setTitle]     = useState(template?.title ?? '')
  const [desc, setDesc]       = useState(template?.description ?? '')
  const [rrule, setRrule]     = useState<WbRrule>(template?.rrule ?? 'weekly')
  const [weekday, setWeekday] = useState<number>(template?.weekday ?? 1)
  const [monthDay, setMonthDay] = useState<number>(template?.month_day ?? 1)
  const [skip, setSkip]       = useState(template?.skip_non_workdays ?? true)
  const [assignees, setAssignees] = useState<string[]>(template?.default_assignee_ids ?? [])
  const [checklist, setChecklist] = useState<{ id: string; text: string }[]>(template?.checklist ?? [])
  const [newItem, setNewItem] = useState('')
  const [active, setActive]   = useState(template?.is_active ?? true)
  const [preview, setPreview] = useState<WbTemplateDue[] | null>(null)
  const [activity, setActivity] = useState<WbActivity[] | null>(null)
  const [entered, setEntered] = useState(false)
  const previewSeq = useRef(0)

  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  useEffect(() => {
    if (!template?.id) return
    loadWbActivity('template', template.id).then(setActivity).catch(() => setActivity([]))
  }, [template?.id, template?.updated_at])
  // 미리보기 — 주기 파라미터 바뀔 때 디바운스 250ms 로 DB 호출
  useEffect(() => {
    const seq = ++previewSeq.current; setPreview(null)
    const t = setTimeout(() => {
      previewWbTemplate(rrule, rrule === 'weekly' ? weekday : null, rrule === 'monthly' ? monthDay : null, skip, 4)
        .then(r => { if (seq === previewSeq.current) setPreview(r) })
        .catch(() => { if (seq === previewSeq.current) setPreview([]) })
    }, 250)
    return () => clearTimeout(t)
  }, [rrule, weekday, monthDay, skip])

  const area = areas.find(a => a.id === areaId); const aIdx = Math.max(0, areas.findIndex(a => a.id === areaId)); const ac = areaColor(aIdx)
  const canSave = title.trim().length > 0 && !!areaId && !saving
  const buildInput = (): WbTemplateUpsertInput => ({
    id: template?.id ?? null, area_id: areaId, title: title.trim(), description: desc.trim() || null, checklist,
    rrule, weekday: rrule === 'weekly' ? weekday : null, month_day: rrule === 'monthly' ? monthDay : null,
    skip_non_workdays: skip, default_assignee_ids: assignees, is_active: active,
  })
  const submit = async () => { if (!canSave) return; try { await onSave(buildInput()) } catch (e) { showToast(wbErrorMessage(e, '저장에 실패했습니다')) } }
  const addItem = () => { const t = newItem.trim(); if (!t) return; setChecklist(c => [...c, { id: newChecklistId(), text: t }]); setNewItem('') }
  const dirty = useMemo(() => isNew || JSON.stringify(buildInput()) !== JSON.stringify({ id: template!.id, area_id: template!.area_id, title: template!.title, description: template!.description, checklist: template!.checklist, rrule: template!.rrule, weekday: template!.weekday, month_day: template!.month_day, skip_non_workdays: template!.skip_non_workdays, default_assignee_ids: template!.default_assignee_ids, is_active: template!.is_active }), [isNew, template, areaId, title, desc, checklist, rrule, weekday, monthDay, skip, assignees, active])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label={isNew ? '새 반복 업무' : '반복 업무 편집'}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${WB.drawerW}px, 100vw)`, background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)',
            padding: '22px 24px 32px', overflowY: 'auto', fontFamily: WB.font, fontSize: 13, color: WB.ink, borderLeft: '6px solid #64748B',
            transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, border: `1px solid ${WB.cardBorder}`, borderRadius: 5, padding: '2px 7px', color: WB.body, display: 'inline-flex', gap: 4, alignItems: 'center' }}><RotateCw size={11} /> 반복 업무</span>
              <span style={{ fontSize: 10.5, color: WB.muted }}>템플릿</span>
              {isNew && <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>새 반복 업무</span>}
              {saving && <span style={{ fontSize: 11, color: WB.faint }}>저장 중…</span>}
            </div>
            <button className="btn" onClick={onClose} aria-label="닫기" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: WB.faint, display: 'flex' }}><X size={18} /></button>
          </div>

          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus={isNew} placeholder="반복 업무 제목" maxLength={120} aria-label="제목"
            style={{ ...INPUT, border: 'none', padding: '0 0 10px', fontSize: 17, fontWeight: 700 }} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={LABEL}>업무영역</label>
              <select value={areaId} onChange={e => setAreaId(e.target.value)} aria-label="업무영역" style={{ ...INPUT, padding: '8px 10px', fontSize: 13, cursor: 'pointer', background: area ? ac.bg : '#fff', color: area ? ac.fg : WB.ink, fontWeight: 600 }}>
                {areas.filter(a => a.is_active || a.id === areaId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label style={LABEL}>주기</label>
              <div style={{ display: 'inline-flex', gap: 4, background: '#F3F4F8', borderRadius: 999, padding: 3 }}>
                {(['daily', 'weekly', 'monthly'] as WbRrule[]).map(r => <button key={r} className="btn" onClick={() => setRrule(r)} style={seg(rrule === r)}>{WB_RRULE_LABEL[r]}</button>)}
              </div>
            </div>
          </div>

          {rrule === 'weekly' && (
            <div style={{ marginBottom: 12 }}>
              <label style={LABEL}>매주</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {WB_WEEKDAYS.map((d, i) => (
                  <button key={d} className="btn" onClick={() => setWeekday(i)} aria-label={`${d}요일`} aria-pressed={weekday === i}
                    style={{ width: 36, height: 32, border: `1px solid ${weekday === i ? WB.ink : '#D1D7E1'}`, borderRadius: 8, background: weekday === i ? WB.ink : '#fff', color: weekday === i ? '#fff' : i === 0 ? '#EF4444' : i === 6 ? '#3B82F6' : WB.ink, fontSize: 12.5, fontWeight: weekday === i ? 700 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>{d}</button>
                ))}
              </div>
            </div>
          )}
          {rrule === 'monthly' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={LABEL}>매월</label>
                <select value={monthDay} onChange={e => setMonthDay(Number(e.target.value))} aria-label="매월 일" style={{ ...INPUT, padding: '8px 10px', fontSize: 13, cursor: 'pointer' }}>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}일</option>)}
                  <option value={31}>말일</option>
                </select>
              </div>
              <div style={{ alignSelf: 'end', fontSize: 11.5, color: WB.muted, border: `1px dashed ${WB.cardBorder}`, borderRadius: 8, padding: '8px 10px', lineHeight: 1.4 }}>
                {monthDay === 31 ? '말일 = 그 달 마지막 날 (28~31일 자동)' : monthDay >= 29 ? `${monthDay}일이 없는 달은 말일로 당겨집니다` : '매월 같은 날에 생성'}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
            <div>비영업일 건너뜀<small style={{ display: 'block', color: WB.muted, fontSize: 11.5, marginTop: 2 }}>{rrule === 'daily' ? '토·일·공휴일에는 만들지 않음' : rrule === 'weekly' ? '토·일·공휴일이면 다음 영업일 (주를 넘기면 이전 영업일)' : '토·일·공휴일이면 다음 영업일 (월을 넘기면 이전 영업일)'}</small></div>
            <button className="btn" role="switch" aria-checked={skip} aria-label="비영업일 건너뜀" onClick={() => setSkip(v => !v)}
              style={{ width: 34, height: 20, borderRadius: 999, border: 'none', background: skip ? WB.ink : '#CBD5E1', position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 2, left: skip ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
            </button>
          </div>

          <div data-wb-preview style={{ background: '#F8FAFC', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: WB.body, marginBottom: 14, lineHeight: 1.7 }}>
            <b style={{ color: WB.ink }}>다음 생성 미리보기</b>{' — '}
            {preview === null ? <span style={{ color: WB.faint }}>계산 중…</span>
              : preview.length === 0 ? <span style={{ color: WB.faint }}>생성일 없음</span>
              : preview.map((p, i) => <span key={p.period_key}>{i > 0 && ' · '}{fmtYmdShort(p.due_on)}{p.shifted && <span style={{ color: '#B45309', fontWeight: 600 }}> ({shiftedLabel(p.shifted)})</span>}</span>)}
            <div style={{ color: WB.faint, fontSize: 11.5 }}>마감 18:00 · 매일 00:00 자동 생성 · 이미 만들어진 업무는 바뀌지 않음</div>
          </div>

          <label style={LABEL}>기본 담당자</label>
          <div style={{ marginBottom: 12 }}>
            <WbPersonPicker mode="multi" value={assignees} onChange={ids => setAssignees(ids)} members={members} lookup={lookup} authUserId={authUserId} placeholder="+ 담당자 · 이름·부서 검색" ariaLabel="기본 담당자" />
          </div>

          <label style={LABEL}>체크리스트 <span style={{ fontWeight: 400 }}>(생성 시 미완료 상태로 복사)</span></label>
          <div style={{ marginBottom: 12 }}>
            {checklist.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${WB.cardBorder}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, marginBottom: 6, color: WB.body }}>
                <span style={{ color: '#CBD5E1' }}>☐</span><span style={{ flex: 1 }}>{c.text}</span>
                <button className="btn" onClick={() => setChecklist(l => l.filter(x => x.id !== c.id))} aria-label="항목 삭제" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', padding: 0, display: 'flex' }}><X size={12} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6, border: `1px dashed ${WB.cardBorder}`, borderRadius: 8, padding: '6px 10px' }}>
              <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }} placeholder="+ 항목 추가" aria-label="체크리스트 항목"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12.5, fontFamily: 'inherit', background: 'transparent', color: WB.ink }} />
              <button className="btn" onClick={addItem} style={{ border: 'none', background: 'transparent', color: WB.ink, cursor: 'pointer', padding: 0, display: 'flex' }}><Plus size={14} /></button>
            </div>
          </div>

          <label style={LABEL}>설명</label>
          <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={3} placeholder="생성되는 업무의 설명으로 복사됩니다" style={{ ...INPUT, resize: 'vertical', fontSize: 13, lineHeight: 1.5, marginBottom: 12 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: `1px solid ${WB.cardBorder}`, borderRadius: 10, padding: '10px 12px', marginBottom: 16 }}>
            <div>활성<small style={{ display: 'block', color: WB.muted, fontSize: 11.5, marginTop: 2 }}>끄면 자동 생성이 멈춥니다 (이미 생성된 업무는 유지)</small></div>
            <button className="btn" role="switch" aria-checked={active} aria-label="활성" onClick={() => setActive(v => !v)}
              style={{ width: 34, height: 20, borderRadius: 999, border: 'none', background: active ? WB.ink : '#CBD5E1', position: 'relative', cursor: 'pointer', padding: 0, flexShrink: 0 }}>
              <span style={{ position: 'absolute', top: 2, left: active ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 120ms' }} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose} style={{ border: '1px solid #D1D7E1', background: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 400, color: WB.ink }}>{isNew ? '취소' : '닫기'}</button>
            {!isNew && onGenerateNow && (
              <button className="btn" onClick={() => void onGenerateNow()} disabled={saving || dirty} title={dirty ? '먼저 저장하세요' : '오늘(KST) 기준 생성 — 멱등'}
                style={{ border: '1px solid #D1D7E1', background: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: saving || dirty ? 'not-allowed' : 'pointer', fontWeight: 600, color: WB.ink, opacity: saving || dirty ? .5 : 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                <RotateCw size={13} /> 오늘분 지금 생성
              </button>
            )}
            <button className="btn" onClick={() => void submit()} disabled={!canSave || !dirty}
              style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: canSave && dirty ? 'pointer' : 'not-allowed', opacity: canSave && dirty ? 1 : .5 }}>
              {isNew ? '등록' : '저장'}
            </button>
          </div>

          {!isNew && (
            <div style={{ borderTop: `1px solid ${WB.line}`, marginTop: 16, paddingTop: 12, fontSize: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>이력</div>
              {activity === null && <div style={{ color: WB.faint }}>불러오는 중…</div>}
              {activity?.length === 0 && <div style={{ color: WB.faint }}>이력 없음</div>}
              {activity?.map(a => (
                <div key={a.id} style={{ display: 'flex', gap: 8, lineHeight: 1.8 }}>
                  <span style={{ color: WB.body }}><b>{lookup(a.actor_id).name}</b> {describeTplActivity(a, areas, lookup)}</span>
                  <span style={{ color: WB.faint, whiteSpace: 'nowrap', marginLeft: 'auto' }}>{fmtYmdShort(kstDate(a.created_at))} {kstTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

const FIELD: Record<string, string> = { area_id: '업무영역', title: '제목', description: '설명', checklist: '체크리스트', rrule: '주기', weekday: '요일', month_day: '일', skip_non_workdays: '비영업일 건너뜀', default_assignee_ids: '기본 담당', is_active: '활성' }
function describeTplActivity(a: WbActivity, areas: WbWorkArea[], lookup: (id: string | null | undefined) => WbPerson): string {
  const d = a.diff ?? {}
  const fmt = (k: string, v: any): string => {
    if (v === null || v === undefined || v === '') return '없음'
    if (k === 'area_id') return areas.find(x => x.id === v)?.name ?? '(삭제된 영역)'
    if (k === 'rrule') return WB_RRULE_LABEL[v as WbRrule] ?? String(v)
    if (k === 'weekday') return WB_WEEKDAYS[v] ?? String(v)
    if (k === 'month_day') return v === 31 ? '말일' : `${v}일`
    if (k === 'default_assignee_ids') return Array.isArray(v) && v.length ? v.map((id: string) => lookup(id).name).join(', ') : '없음'
    if (k === 'checklist') return `${Array.isArray(v) ? v.length : 0}항목`
    if (typeof v === 'boolean') return v ? '켜짐' : '꺼짐'
    return String(v).length > 30 ? String(v).slice(0, 30) + '…' : String(v)
  }
  if (a.action === 'created') return '템플릿 생성'
  if (a.action === 'updated') return Object.entries(d).map(([k, v]: [string, any]) => `${FIELD[k] ?? k} ${fmt(k, v?.from)} → ${fmt(k, v?.to)}`).join(' / ')
  return a.action
}
