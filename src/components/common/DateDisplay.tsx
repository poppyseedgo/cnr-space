/**
 * DateDisplay — 날짜 트리거 + DatePickerPopup wrapper
 *
 * ✅ 변경 이력
 *  - [2026-05-04 STEP 2] 신규 생성 — MY PAGE 재설계용
 *
 * 📌 Figma 1:1 반영 (node 449:1771)
 *  · 컨테이너: bg #fff, rounded 12, padding pl 12 pr 16 py 14, gap 6, h 52
 *  · 아이콘: calendar_today 24×24 (Icons.tsx에서 추출)
 *  · 날짜 텍스트: 16 Medium #111, leading normal
 *  · 요일 텍스트: 16 Medium #99A1AF, leading normal
 *  · 표시 형식: "2026년 4월 12일 수요일"
 *
 * 📌 사용 방식
 *   const [from, setFrom] = useState<string>(todayStr())
 *   <DateDisplay value={from} onChange={setFrom} max={to} />
 */

import { useState, useRef } from 'react'
import { CalendarTodayIcon } from './Icons'
import { DatePickerPopup } from './DatePickerPopup'
import { fmtDateFull, dateToObj, DAY_NAMES } from '../../utils/time'

// ─── Props ───────────────────────────────────────────────────────────────────
interface DateDisplayProps {
  value:    string                          // ← YYYY-MM-DD (빈 문자열 허용 — placeholder 표시)
  onChange: (newDate: string) => void
  min?:     string                          // ← 선택 가능 최소 (YYYY-MM-DD)
  max?:     string                          // ← 선택 가능 최대 (YYYY-MM-DD)
  placeholder?: string                      // ← 빈 값일 때 표시 텍스트 (기본 "날짜 선택")
}

// ─── Component ───────────────────────────────────────────────────────────────
export function DateDisplay({
  value, onChange, min, max,
  placeholder = '날짜 선택',
}: DateDisplayProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // ── 표시값 계산
  //   value 있음:   "2026년 4월 12일" + "수요일"
  //   value 없음:   placeholder만 표시, 요일 숨김
  const hasValue   = !!value
  const displayDate = hasValue ? fmtDateFull(value) : placeholder
  const displayDay  = hasValue
    ? `${DAY_NAMES[dateToObj(value).getDay()]}요일`     // ← Figma: "수요일" 풀네임
    : ''

  return (
    <>
      {/* ── 트리거 버튼 (Figma node 449:1771) ──────────────────────────── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          // ─── Figma 1:1 ───────────────────────────────────
          background:     '#fff',                       // ← Figma: bg white
          borderRadius:   12,                           // ← Figma: rounded 12
          padding:        '14px 16px 14px 12px',        // ← Figma: pt/pb 14, pl 12, pr 16
          height:         52,                           // ← Figma: h 52
          gap:            6,                            // ← Figma: gap 6
          // ─── 버튼 reset ──────────────────────────────────
          border:         'none',
          cursor:         'pointer',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          overflow:       'hidden',
          fontFamily:     'inherit',
          flexShrink:     0,
          // ─── 호버 미세 효과 (Figma 외 추가) ───────────────
          transition:     'box-shadow 0.15s',
          boxShadow:      open ? '0 0 0 1.5px #111' : 'none',  // ← 열려있을 때 outline 표시
        }}>
        {/* 캘린더 아이콘 */}
        <CalendarTodayIcon size={24}/>{/* ← Figma 추출 SVG (Icons.tsx) */}
        {/* 날짜 텍스트 */}
        <span style={{
          fontSize:   16,                               // ← Figma: 16
          fontWeight: 500,                              // ← Figma: Medium
          color:      hasValue ? '#111' : '#99A1AF',    // ← 빈 값일 땐 placeholder 회색
          lineHeight: 'normal',                         // ← Figma: leading normal
          whiteSpace: 'nowrap',
        }}>{displayDate}</span>
        {/* 요일 텍스트 (값이 있을 때만) */}
        {displayDay && (
          <span style={{
            fontSize:   16,                             // ← Figma: 16
            fontWeight: 500,                            // ← Figma: Medium
            color:      '#99A1AF',                      // ← Figma: #99A1AF
            lineHeight: 'normal',
            whiteSpace: 'nowrap',
          }}>{displayDay}</span>
        )}
      </button>

      {/* ── 팝업 (open 상태에서만 마운트 — 외부 닫힘 핸들러는 popup 자체가 관리) ── */}
      {open && (
        <DatePickerPopup
          value={value}
          onChange={d => { onChange(d); setOpen(false) }}  // ← 날짜 선택 즉시 닫기
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          min={min}
          max={max}
        />
      )}
    </>
  )
}
