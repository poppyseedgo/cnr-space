/**
 * MilestoneDrawer.tsx — 마일스톤 생성/편집 드로어 (제목 · 기간 · 설명)
 *
 * ✅ 변경 이력
 *  - [2026-09-30 WORKBOARD P3-E] 신규 — IssueDrawer 골격 재사용. 명시 저장(등록/저장 버튼) 한 가지 모드
 *      · 상태는 여기서 바꾸지 않는다 — MilestonesView 헤더 셀렉트(wb_set_milestone_status) 가 담당 (상태 이력 분리)
 *      · end < start 는 클라에서 먼저 막고(버튼 비활성 + 문구), 최종 판정은 RPC END_BEFORE_START
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { WbMilestone, WbMilestoneUpsertInput } from '../../types'
import { ModalPortal } from '../common/ModalPortal'
import { DateField } from '../common/DateField'
import { wbErrorMessage } from '../../lib/workboardApi'
import { WB, MS_COLOR, daysDiff, fmtYmdShort } from './wbShared'

interface Props {
  milestone: WbMilestone | null      // null = 새 마일스톤
  saving:    boolean
  onClose:   () => void
  onSave:    (input: WbMilestoneUpsertInput) => Promise<void>
  showToast: (msg: string) => void
}

const LABEL: CSSProperties = { display: 'block', fontSize: 11.5, color: WB.muted, marginBottom: 5, fontWeight: 600 }
const INPUT: CSSProperties = { width: '100%', border: '1px solid #D1D7E1', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', color: WB.ink, background: '#fff' }

export function MilestoneDrawer({ milestone, saving, onClose, onSave, showToast }: Props) {
  const isNew = milestone === null
  const [title, setTitle] = useState(milestone?.title ?? '')
  const [desc, setDesc]   = useState(milestone?.description ?? '')
  const [start, setStart] = useState(milestone?.start_on ?? '')
  const [end, setEnd]     = useState(milestone?.end_on ?? '')
  const [entered, setEntered] = useState(false)

  useEffect(() => { const t = requestAnimationFrame(() => setEntered(true)); return () => cancelAnimationFrame(t) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const rangeBad = !!start && !!end && end < start
  const canSave = title.trim().length > 0 && !rangeBad && !saving
  const days = start && end && !rangeBad ? daysDiff(start, end) + 1 : null

  const submit = async () => {
    if (!canSave) return
    try {
      await onSave({ id: milestone?.id ?? null, title: title.trim(), description: desc.trim() || null, start_on: start || null, end_on: end || null })
    } catch (e) { showToast(wbErrorMessage(e, '저장에 실패했습니다')) }
  }

  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1250, background: 'rgba(15,23,42,0.35)', opacity: entered ? 1 : 0, transition: 'opacity 160ms ease-out' }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label={isNew ? '새 마일스톤' : '마일스톤 편집'}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `min(${WB.drawerW}px, 100vw)`, background: '#fff', boxShadow: '-20px 0 60px rgba(15,23,42,.2)',
            padding: '22px 24px 32px', overflowY: 'auto', fontFamily: WB.font, fontSize: 13, color: WB.ink, borderLeft: `6px solid ${MS_COLOR.fg}`,
            transform: entered ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 220ms ease-out' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: MS_COLOR.bg, color: MS_COLOR.fg }}>마일스톤</span>
              {isNew && <span style={{ fontSize: 10.5, color: WB.accent, background: WB.accentBg, borderRadius: 4, padding: '1px 6px', fontWeight: 700 }}>새 마일스톤</span>}
              {saving && <span style={{ fontSize: 11, color: WB.faint }}>저장 중…</span>}
            </div>
            <button className="btn" onClick={onClose} aria-label="닫기" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: WB.faint, display: 'flex' }}><X size={18} /></button>
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL}>제목</label>
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="예: Q4 운영" maxLength={120}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} style={{ ...INPUT, fontSize: 16, fontWeight: 700 }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 6 }}>
            <div>
              <label style={LABEL}>시작일</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <DateField value={start} onChange={setStart} max={end || undefined} placeholder="미정" style={{ ...INPUT, padding: '7px 10px', fontSize: 13 }} />
                {start && <button className="btn" onClick={() => setStart('')} aria-label="시작일 해제" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', padding: 4, display: 'flex' }}><X size={12} /></button>}
              </div>
            </div>
            <div>
              <label style={LABEL}>종료일</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <DateField value={end} onChange={setEnd} min={start || undefined} placeholder="미정" style={{ ...INPUT, padding: '7px 10px', fontSize: 13 }} />
                {end && <button className="btn" onClick={() => setEnd('')} aria-label="종료일 해제" style={{ border: 'none', background: 'transparent', color: WB.faint, cursor: 'pointer', padding: 4, display: 'flex' }}><X size={12} /></button>}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: rangeBad ? WB.dueWarn : WB.faint, marginBottom: 14, minHeight: 16 }}>
            {rangeBad ? '종료일이 시작일보다 빠릅니다' : days !== null ? `${fmtYmdShort(start)} → ${fmtYmdShort(end)} · ${days}일` : '기간은 비워 둘 수 있습니다 (타임라인에는 기간이 있어야 표시)'}
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={LABEL}>설명</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={4} placeholder="목표 · 범위 · 완료 기준"
              style={{ ...INPUT, resize: 'vertical', lineHeight: 1.6, fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose} style={{ border: '1px solid #D1D7E1', background: '#fff', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 400, color: WB.ink }}>취소</button>
            <button className="btn" onClick={() => void submit()} disabled={!canSave}
              style={{ background: WB.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed', opacity: canSave ? 1 : 0.5 }}>
              {isNew ? '등록' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
