/**
 * DateField — 전역 공통 날짜 입력 필드 (트리거 + DatePickerPopup)
 *
 * ✅ 변경 이력
 *  - [2026-08-03] 신규 — DatePicker 전수 검사 후속. native <input type="date"> 15곳을
 *      이 컴포넌트로 치환한다 (브라우저 제각각 UI + 공휴일 미표기 문제의 근본 해결).
 *
 * 📌 역할 구분 (전수 검사 결론)
 *  - DateField: 폼/필터의 단일 날짜 입력 (본 컴포넌트 — native input 대체)
 *  - DateDisplay + DateRangeFilter: 어드민 기간 필터 (기존 공통 — 이미 DatePickerPopup)
 *  - DateRows: 도서 대여 모달 (기존 공통)
 *  - CalendarShell 미니피커 / BookingModal 달력: 정책 내장 자체 구현 — 유지하되
 *    공휴일 표기 규칙만 통일 (완전 치환은 정책 로직 리스크 대비 이득 낮음)
 *
 * 📌 DatePickerPopup 을 쓰므로 공휴일 빨강·토 파랑·일 빨강·회사 이벤트 도트가
 *    자동 적용된다 — 표기 규칙의 SSOT 는 DatePickerPopup 하나.
 */

import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { DatePickerPopup } from './DatePickerPopup'

interface DateFieldProps {
  value:       string                      // 'YYYY-MM-DD' ('' 허용)
  onChange:    (d: string) => void
  min?:        string
  max?:        string
  placeholder?: string
  disabled?:   boolean
  /** 기존 native input 의 인라인 스타일을 그대로 넘겨 레이아웃 보존 */
  style?:      CSSProperties
  ariaLabel?:  string
}

export function DateField({
  value, onChange, min, max, placeholder = '날짜 선택', disabled = false, style, ariaLabel,
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel ?? placeholder}
        onClick={() => setOpen(o => !o)}
        style={{
          // native input 과 유사한 기본형 — 사용처가 style 로 덮어써 레이아웃 보존
          display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px', borderRadius: 10, border: '1px solid #E2E8F0',
          background: disabled ? '#F1F5F9' : '#FFFFFF',
          fontSize: 13, fontFamily: 'inherit', textAlign: 'left',
          color: value ? '#111111' : '#94A3B8',
          cursor: disabled ? 'default' : 'pointer',
          ...style,
        }}>
        <span>{value || placeholder}</span>
        {/* 달력 글리프 — 프로젝트 캘린더 아이콘 톤 (stroke currentColor 상속) */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden
          style={{ flexShrink: 0, color: '#94A3B8' }}>
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 9H21" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 3V6M16 3V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <DatePickerPopup
          value={value || undefined}
          min={min}
          max={max}
          anchorRef={anchorRef}
          onChange={d => { onChange(d); setOpen(false) }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
