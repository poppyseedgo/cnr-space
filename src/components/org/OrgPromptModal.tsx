/**
 * OrgPromptModal.tsx — 조직도 소형 입력 모달 (파일 이름·적용일 / 단위 이름·약칭 / 복사)
 *  - [2026-10-01 ORG Phase 3] 신규
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ModalPortal } from '../common/ModalPortal'
import { DateField } from '../common/DateField'
import { OG, btn, btnPri, btnDisabled } from './orgShared'

export interface PromptField { key: string; label: string; type?: 'text' | 'date' | 'select'; placeholder?: string; required?: boolean; options?: { value: string; label: string }[]; help?: string }
interface Props {
  title:    string
  fields:   PromptField[]
  initial?: Record<string, string>
  confirmLabel?: string
  extra?:   ReactNode
  loading?: boolean
  onConfirm: (values: Record<string, string>) => void
  onClose:   () => void
}
export function OrgPromptModal({ title, fields, initial = {}, confirmLabel = '저장', extra, loading, onConfirm, onClose }: Props) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, initial[f.key] ?? ''])))
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [onClose])
  const ok = fields.every(f => !f.required || (v[f.key] ?? '').trim().length > 0)
  const input: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `1px solid ${OG.line}`, borderRadius: 6, fontSize: 13, fontFamily: OG.font, boxSizing: 'border-box' }
  return (
    <ModalPortal>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: 420, maxWidth: '92vw', padding: 22, fontFamily: OG.font, boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>{title}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map(f => (
              <label key={f.key} style={{ fontSize: 12, color: OG.quiet, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span>{f.label}{f.required && <span style={{ color: OG.red }}> *</span>}</span>
                {f.type === 'date'
                  ? <DateField value={v[f.key]} onChange={d => setV(s => ({ ...s, [f.key]: d }))} placeholder={f.placeholder ?? '날짜 선택'} style={input} />
                  : f.type === 'select'
                    ? <select value={v[f.key]} onChange={e => setV(s => ({ ...s, [f.key]: e.target.value }))} style={input}>{(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                    : <input autoFocus={f === fields[0]} value={v[f.key]} placeholder={f.placeholder} onChange={e => setV(s => ({ ...s, [f.key]: e.target.value }))} style={input}
                             onKeyDown={e => { if (e.key === 'Enter' && ok && !loading) onConfirm(v) }} />}
                {f.help && <span style={{ fontSize: 11, color: OG.faint }}>{f.help}</span>}
              </label>
            ))}
            {extra}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button style={btn} onClick={onClose} disabled={loading}>취소</button>
            <button style={{ ...btnPri, ...(ok && !loading ? {} : btnDisabled) }} disabled={!ok || loading} onClick={() => onConfirm(v)}>{loading ? '처리 중…' : confirmLabel}</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
