/**
 * bookModalShared.tsx — 도서 대여 등록/신청 모달 공용 토큰 & 필드 컴포넌트
 *
 * [2026-07-22] 신규
 *
 * Figma: fMv9JLNlNybDBYUnJDCTrq
 *   · 1335:820  Admin 대여 등록 (책 선택 진입)
 *   · 1335:994  Admin 대여 등록 (책 미선택 진입)
 *   · 1336:1079 사용자 대여하기 (구 "대여 신청" — [2026-07-21] 승인 폐지)
 *
 * 세 화면의 레이아웃·토큰이 동일하므로 여기에 모아 SSOT로 둔다.
 * (Figma에서 공통 컴포넌트가 바뀌면 이 파일만 고치면 됨)
 */

import { useState, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { fmtDueFullKo, dueNoticeFull, dueDateFrom } from '../../utils/bookLoan'
import { DatePickerPopup } from '../common/DatePickerPopup'

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

// ── 대여일/반납기한 표시 ─────────────────────────────────────────────────────
//
// ← [2026-07-20] 문구 정책 변경
//   반납일은 "그 날 반납"이 아니라 "대여일 기준 7일 이내 반납"이므로
//   시점 표기("2026년 7월 27일 월요일")를 기한 표기로 바꾼다.
//   라벨도 '반납일' → '반납기한'.
//
//   날짜 포맷은 utils/bookLoan.ts 로 일원화했다. 기존 fmtFullDate 는
//   외부 호출부 호환을 위해 재수출만 유지한다.

export { fmtDueFullKo as fmtFullDate } from '../../utils/bookLoan'

/**
 * 대여일 / 반납기한 2행.
 *
 * ← [2026-07-20] 대여일 선택 지원
 *   value/onChange 를 주면 대여일이 편집 가능해지고, 없으면 기존처럼
 *   오늘 날짜를 표시만 한다(사용자 신청 모달은 승인 시점 기준이라 편집 불가).
 *
 *   반납기한은 항상 **선택한 대여일 + borrowDays** 로 다시 계산된다.
 *   서버 RPC(admin_checkout_books)가 v_checkout + 7일로 저장하므로
 *   화면과 DB 가 같은 규칙을 쓴다.
 */
export function DateRows({
  borrowDays, noteText, value, onChange, min, max, isDateDisabled,
}: {
  borrowDays: number
  noteText?:  string
  /** 'YYYY-MM-DD'. 주어지면 편집 모드 */
  value?:     string
  onChange?:  (next: string) => void
  min?:       string
  max?:       string
  /** ← [2026-07-30] 예약 구간 등 임의 날짜 비활성 — DatePickerPopup 통과 */
  isDateDisabled?: (dateStr: string) => boolean
}) {
  const editable = !!onChange
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 편집 모드면 선택값, 아니면 오늘. 'YYYY-MM-DD' 는 로컬 자정으로 만든다
  // (new Date('YYYY-MM-DD') 는 UTC 자정이라 KST 에서 하루 밀린다).
  const start = editable && value
    ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10))
    : new Date()
  const due   = dueDateFrom(start, borrowDays)

  return (
    <>
      <Field label="대여일" required>
        {editable ? (
          <>
            <button
              ref={anchorRef}
              type="button"
              onClick={() => setPickerOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'transparent', border: 'none', padding: 0,
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 16, fontWeight: 500, color: BM.valueColor,
                borderBottom: '1px dashed #CBD5E1',
              }}>
              {fmtDueFullKo(start)}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="#94A3B8" strokeWidth="2" aria-hidden>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </button>
            {pickerOpen && (
              <DatePickerPopup
                value={value ?? ''}
                onChange={next => { onChange?.(next); setPickerOpen(false) }}
                onClose={() => setPickerOpen(false)}
                anchorRef={anchorRef}
                min={min}
                max={max}
                isDateDisabled={isDateDisabled}
              />
            )}
          </>
        ) : (
          <span style={{ fontSize: 16, fontWeight: 500, color: BM.valueColor }}>
            {fmtDueFullKo(start)}
          </span>
        )}
      </Field>
      <Field label="반납기한" required>
        <div>
          <span style={{ fontSize: 16, fontWeight: 500, color: BM.valueColor }}>
            {dueNoticeFull(due)}
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
