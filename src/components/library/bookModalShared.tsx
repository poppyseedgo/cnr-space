/**
 * bookModalShared.tsx — 도서 대여 등록/신청 모달 공용 토큰 & 필드 컴포넌트
 *
 * [2026-07-22] 신규
 *
 * Figma: fMv9JLNlNybDBYUnJDCTrq
 *   · 1335:820  Admin 대여 등록 (책 선택 진입)
 *   · 1335:994  Admin 대여 등록 (책 미선택 진입)
 *   · 1336:1079 사용자 대여 신청
 *
 * 세 화면의 레이아웃·토큰이 동일하므로 여기에 모아 SSOT로 둔다.
 * (Figma에서 공통 컴포넌트가 바뀌면 이 파일만 고치면 됨)
 */

import type { CSSProperties, ReactNode } from 'react'

// ── Figma 토큰 ───────────────────────────────────────────────────────────────
export const BM = {
  width:        462,
  radius:       24,
  labelWidth:   92,
  valueWidth:   338,
  fieldBorder:  '#F6FAFF',
  labelColor:   '#96A0B3',
  valueColor:   '#111',
  placeholder:  '#C7CFDC',
  memoPlaceholder: '#D1D7E1',
  counterColor: '#D1D9E7',
  requiredDot:  '#FF6B35',
  btnCancelBg:  '#F1F5F9',
  btnCancelTx:  '#64748B',
  btnPrimaryBg: '#111',
} as const

export const OVERLAY: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
}

export const SHEET: CSSProperties = {
  width: '100%', maxWidth: BM.width, background: '#fff',
  borderRadius: BM.radius, overflow: 'hidden',
  display: 'flex', flexDirection: 'column', maxHeight: '90vh',
}

// ── 모달 헤더 (Figma ModalHeader) ────────────────────────────────────────────
export function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '16px 20px', background: '#fff', flexShrink: 0,
    }}>
      <div style={{ fontSize: 24, fontWeight: 500, color: '#111', lineHeight: 1.5 }}>
        {title}
      </div>
      <button
        onClick={onClose}
        aria-label="닫기"
        style={{
          width: 32, height: 32, borderRadius: 9999, border: 'none', background: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          fontSize: 18, color: '#111', lineHeight: 1, padding: 0,
        }}
      >✕</button>
    </div>
  )
}

// ── 필드 행 (라벨 92 + 값 338, 하단 보더) ────────────────────────────────────
export function Field({
  label, required = false, children, align = 'center', minHeight,
}: {
  label: string
  required?: boolean
  children: ReactNode
  align?: 'center' | 'flex-start'
  minHeight?: number
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', padding: '16px 0',
      borderBottom: `1px solid ${BM.fieldBorder}`, width: '100%',
    }}>
      <div style={{ width: BM.labelWidth, flexShrink: 0, display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: BM.labelColor, lineHeight: 1.5 }}>
          {label}
        </span>
        {required && (
          <span style={{
            width: 4, height: 4, borderRadius: '50%',
            background: BM.requiredDot, marginTop: 4, flexShrink: 0,
          }} />
        )}
      </div>
      <div style={{
        flex: 1, minWidth: 0, display: 'flex', alignItems: align,
        minHeight: minHeight ?? undefined,
      }}>
        {children}
      </div>
    </div>
  )
}

// ── 하단 버튼 영역 (Figma Modal Bottom) ──────────────────────────────────────
export function ModalFooter({
  confirmLabel, onCancel, onConfirm, disabled, loading, hint,
}: {
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  disabled?: boolean
  loading?: boolean
  hint?: string | null
}) {
  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${BM.fieldBorder}` }}>
      {hint && (
        <div style={{ padding: '8px 12px 0', fontSize: 12, color: '#DC2626', textAlign: 'center' }}>
          {hint}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: 8 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, height: 56, borderRadius: 16, border: 'none',
            background: BM.btnCancelBg, color: BM.btnCancelTx,
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >취소</button>
        <button
          onClick={onConfirm}
          disabled={disabled || loading}
          style={{
            flex: 1, height: 56, borderRadius: 16, border: 'none',
            background: (disabled || loading) ? '#CBD5E1' : BM.btnPrimaryBg,
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: (disabled || loading) ? 'not-allowed' : 'pointer',
          }}
        >{loading ? '처리중...' : confirmLabel}</button>
      </div>
    </div>
  )
}

// ── 메모 필드 (0/100 카운터) ─────────────────────────────────────────────────
export const MEMO_MAX = 100

export function MemoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="메모" align="flex-start" minHeight={72}>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <textarea
          value={value}
          maxLength={MEMO_MAX}
          onChange={e => onChange(e.target.value)}
          placeholder="특이사항 등 입력"
          style={{
            flex: 1, minHeight: 72, border: 'none', outline: 'none', resize: 'none',
            fontSize: 16, fontWeight: 500, color: BM.valueColor, lineHeight: 1.5,
            background: 'transparent', fontFamily: 'inherit',
          }}
        />
        <span style={{ fontSize: 10, color: BM.counterColor, flexShrink: 0, paddingTop: 4 }}>
          {value.length}/{MEMO_MAX}
        </span>
      </div>
    </Field>
  )
}

// ── 대여일/반납일 표시 ───────────────────────────────────────────────────────
const DAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 'YYYY년 M월 D일 요일' (Figma 표기) */
export function fmtFullDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DAYS[d.getDay()]}요일`
}

export function DateRows({ borrowDays, noteText }: { borrowDays: number; noteText?: string }) {
  const start = new Date()
  const due   = new Date()
  due.setDate(due.getDate() + borrowDays)
  return (
    <>
      <Field label="대여일" required>
        <span style={{ fontSize: 16, fontWeight: 500, color: BM.valueColor }}>
          {fmtFullDate(start)}
        </span>
      </Field>
      <Field label="반납일" required>
        <div>
          <span style={{ fontSize: 16, fontWeight: 500, color: BM.valueColor }}>
            {fmtFullDate(due)}
          </span>
          {noteText && (
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{noteText}</div>
          )}
        </div>
      </Field>
    </>
  )
}

// ── 사용자 아바타 chip (Figma 1336:1139) ─────────────────────────────────────
export function UserChipRow({
  name, dept, avatarUrl, onRemove,
}: {
  name: string
  dept?: string | null
  avatarUrl?: string | null
  onRemove?: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
      <div style={{
        width: 24, height: 24, borderRadius: 1000, background: '#000', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 12, fontWeight: 500, color: '#E7E7E7', lineHeight: 1.3 }}>
              {name?.charAt(0) ?? '?'}
            </span>}
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: '#111', lineHeight: 1.3 }}>{name}</span>
        {dept && (
          <span style={{ fontSize: 11, color: 'rgba(17,17,17,0.35)', lineHeight: 1.3 }}>{dept}</span>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="대여자 삭제"
          style={{
            marginLeft: 4, border: 'none', background: 'transparent', cursor: 'pointer',
            color: '#94A3B8', fontSize: 13, padding: 2, lineHeight: 1,
          }}
        >✕</button>
      )}
    </div>
  )
}

// ── 검색 인풋 (밑줄형, Figma 참석자 검색 패턴) ───────────────────────────────
export function SearchInput({
  value, onChange, placeholder, onFocus, onBlur, onKeyDown, autoFocus, big,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  autoFocus?: boolean
  big?: boolean          // 책 필드는 20px (Figma)
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onChange={e => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className="bm-book-input"
      style={{
        width: '100%', border: 'none', outline: 'none', background: 'transparent',
        fontSize: big ? 20 : 16, fontWeight: 500, color: BM.valueColor,
        lineHeight: 1.5, padding: 0, fontFamily: 'inherit',
      }}
    />
  )
}

// ── 검색 결과 드롭다운 ───────────────────────────────────────────────────────
export function Suggestions({ children }: { children: ReactNode }) {
  return (
    <div style={{
      marginTop: 8, border: '1px solid #E2E8F0', borderRadius: 10,
      overflow: 'hidden', maxHeight: 220, overflowY: 'auto', background: '#fff',
    }}>
      {children}
    </div>
  )
}

export function SuggestionRow({
  disabled, onClick, left, right, highlighted,
}: {
  disabled?: boolean
  onClick: () => void
  left: ReactNode
  right?: ReactNode
  highlighted?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none',
        borderBottom: '1px solid #F1F5F9',
        background: highlighted ? '#F8FAFC' : '#fff',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}
    >
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>{left}</span>
      {right}
    </button>
  )
}
