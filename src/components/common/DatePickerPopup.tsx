/**
 * DatePickerPopup — 커스텀 캘린더 날짜 선택 팝업 (Portal 기반)
 *
 * ✅ 변경 이력
 *  - [2026-05-04 STEP 2] 신규 생성 — MY PAGE 재설계용 Date Picker
 *
 * 📌 설계 원칙 (근본 원인 해결)
 *  1. React Portal — document.body에 렌더 (부모 overflow 잘림 방지)
 *  2. anchorRef.getBoundingClientRect()로 트리거 요소 화면 좌표 추적
 *  3. 화면 경계 auto-flip — 아래로 안 들어가면 위로, 오른쪽 짤리면 왼쪽으로
 *  4. 외부 클릭 / ESC / 스크롤 시 자동 닫기 (anchor 요소 자체 클릭은 제외 — 이중 토글 방지)
 *  5. 한국 캘린더 관례 — 일요일 #FF6969 / 토요일 #3B82F6 / 평일 #111
 *
 * 📌 사용 방식
 *   const ref = useRef<HTMLButtonElement>(null);
 *   const [open, setOpen] = useState(false);
 *   <button ref={ref} onClick={() => setOpen(o => !o)}>...</button>
 *   {open && (
 *     <DatePickerPopup
 *       value={dateStr}
 *       onChange={(d) => { setDate(d); setOpen(false); }}
 *       onClose={() => setOpen(false)}
 *       anchorRef={ref}
 *     />
 *   )}
 */

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  dateToObj, objToStr, todayStr,
  DAY_NAMES, MONTH_NAMES,
} from '../../utils/time'
import { ChevronBackwardIcon, ChevronForwardIcon } from './Icons'

// ─── 상수 ────────────────────────────────────────────────────────────────────
const POPUP_WIDTH      = 320  // ← popup 고정 폭 (위치 계산용)
const POPUP_MAX_HEIGHT = 360  // ← popup 대략 높이 (auto-flip 판정용 — 6주 + 헤더 + 요일헤더)
const POPUP_GAP        = 8   // ← 트리거-popup 간격
const VIEWPORT_MARGIN  = 8   // ← 화면 가장자리 안전 여백

// ─── Props ───────────────────────────────────────────────────────────────────
interface DatePickerPopupProps {
  value:      string                                       // ← 현재 선택값 (YYYY-MM-DD, 빈 문자열 허용)
  onChange:   (newDate: string) => void                    // ← 날짜 선택 콜백
  onClose:    () => void                                   // ← 팝업 닫기 콜백
  anchorRef:  React.RefObject<HTMLElement | null>          // ← 트리거 요소 ref (위치 기준 + 외부클릭 제외)
  min?:       string                                       // ← 선택 가능 최소 날짜 (YYYY-MM-DD)
  max?:       string                                       // ← 선택 가능 최대 날짜 (YYYY-MM-DD)
}

// ─── Component ───────────────────────────────────────────────────────────────
export function DatePickerPopup({
  value, onChange, onClose, anchorRef, min, max,
}: DatePickerPopupProps) {

  // ── popup DOM ref (외부 클릭 판정용)
  const popupRef = useRef<HTMLDivElement>(null)

  // ── 보여주는 월/년 — value가 있으면 그 달, 없으면 오늘
  const initial = value || todayStr()
  const initDate = dateToObj(initial)
  const [viewYear,  setViewYear]  = useState(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState(initDate.getMonth())  // 0~11

  // ── popup 위치 (anchor 기준 화면 좌표)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  // ── 위치 계산 (마운트 시 1회 + resize 시 재계산)
  //    스크롤 중에는 닫는 정책이라 scroll 이벤트는 onClose로 따로 처리
  useLayoutEffect(() => {
    const calc = () => {
      const a = anchorRef.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      // 기본: 트리거 아래 + 좌측 정렬
      let top  = r.bottom + POPUP_GAP
      let left = r.left

      // 아래로 안 들어가면 위로 flip
      if (top + POPUP_MAX_HEIGHT > vh - VIEWPORT_MARGIN) {
        const flipTop = r.top - POPUP_MAX_HEIGHT - POPUP_GAP
        if (flipTop >= VIEWPORT_MARGIN) top = flipTop  // ← 위로도 안 들어가면 그냥 아래 유지
      }
      // 오른쪽 짤리면 트리거 우측 끝에 맞춤
      if (left + POPUP_WIDTH > vw - VIEWPORT_MARGIN) {
        left = r.right - POPUP_WIDTH
      }
      // 안전 마진
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
      if (top  < VIEWPORT_MARGIN) top  = VIEWPORT_MARGIN

      setPos({ top, left })
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [anchorRef])

  // ── 외부 클릭 / ESC / 스크롤 시 자동 닫기
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node
      // popup 내부 클릭 → 무시
      if (popupRef.current && popupRef.current.contains(t)) return
      // anchor(트리거) 클릭 → 무시 (트리거의 onClick이 토글 처리하므로 여기서 close 호출 X — 이중 토글 방지)
      if (anchorRef.current && anchorRef.current.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()  // ← 스크롤 시 닫기 (위치 어긋남 방지 — 근본 해결)

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)  // capture: 어떤 컨테이너 스크롤이든 감지
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose, anchorRef])

  // ── 캘린더 그리드 (6주 × 7일 = 42셀)
  //    이전달 채움 + 이번달 + 다음달 채움
  const cells = useMemo(() => {
    const firstDay   = new Date(viewYear, viewMonth, 1)
    const lastDay    = new Date(viewYear, viewMonth + 1, 0)
    const firstDow   = firstDay.getDay()                // 0=일
    const daysInMo   = lastDay.getDate()
    const prevLastD  = new Date(viewYear, viewMonth, 0).getDate()

    const arr: Array<{ date: Date; isCurrent: boolean }> = []
    // 이전 달 채움 (firstDow 만큼)
    for (let i = firstDow - 1; i >= 0; i--) {
      arr.push({ date: new Date(viewYear, viewMonth - 1, prevLastD - i), isCurrent: false })
    }
    // 이번 달
    for (let d = 1; d <= daysInMo; d++) {
      arr.push({ date: new Date(viewYear, viewMonth, d), isCurrent: true })
    }
    // 다음 달 (총 42칸)
    let next = 1
    while (arr.length < 42) {
      arr.push({ date: new Date(viewYear, viewMonth + 1, next++), isCurrent: false })
    }
    return arr
  }, [viewYear, viewMonth])

  const today    = todayStr()
  const selected = value

  // ── 월 네비
  const goPrev = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else                 { setViewMonth(m => m - 1) }
  }
  const goNext = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else                  { setViewMonth(m => m + 1) }
  }

  // ── 날짜 클릭 (min/max 가드)
  const onCellClick = (d: Date) => {
    const s = objToStr(d)
    if (min && s < min) return
    if (max && s > max) return
    onChange(s)
  }

  // ── 위치가 아직 계산 안 됐으면 invisible (FOUC 방지)
  if (!pos) return null

  return createPortal(
    <div
      ref={popupRef}
      role="dialog"
      aria-label="날짜 선택"
      style={{
        position:     'fixed',
        top:          pos.top,
        left:         pos.left,
        width:        POPUP_WIDTH,
        background:   '#fff',
        borderRadius: 12,
        padding:      16,
        boxShadow:    '0 8px 24px rgba(0, 0, 0, 0.12)',
        border:       '1px solid #F1F5F9',
        zIndex:       9999,                              // ← 모달/드롭다운 위 (다른 z-index 충돌 방지)
        fontFamily:   'inherit',
      }}>

      {/* ── 헤더: < 2026년 4월 > ───────────────────────────── */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        marginBottom: 12,
      }}>
        <button type="button" onClick={goPrev} style={navBtnStyle}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
          aria-label="이전 달">
          <ChevronBackwardIcon size={20}/>
        </button>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#111' }}>
          {viewYear}년 {MONTH_NAMES[viewMonth]}
        </div>
        <button type="button" onClick={goNext} style={navBtnStyle}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
          aria-label="다음 달">
          <ChevronForwardIcon size={20}/>
        </button>
      </div>

      {/* ── 요일 헤더: 일~토 ───────────────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4,
        marginBottom: 4,
      }}>
        {DAY_NAMES.map((day, i) => (
          <div key={day} style={{
            fontSize: 12, fontWeight: 500,
            // ← 한국 관례: 일=빨강(노쇼 색 토큰 통일) / 토=파랑 / 평일=#94A3B8
            color: i === 0 ? '#FF6969' : i === 6 ? '#3B82F6' : '#94A3B8',
            textAlign: 'center', height: 32, lineHeight: '32px',
          }}>{day}</div>
        ))}
      </div>

      {/* ── 날짜 셀 그리드 (6주 × 7일) ────────────────────── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4,
      }}>
        {cells.map((cell, i) => {
          const dateStr   = objToStr(cell.date)
          const isSel     = dateStr === selected
          const isToday   = dateStr === today
          const dow       = cell.date.getDay()
          const disabled  = (!!min && dateStr < min) || (!!max && dateStr > max)

          // ← 색상 우선순위: 선택됨(white) > 비활성(#CBD5E1) > 다른달(#CBD5E1) > 일(빨강)/토(파랑)/평일(#111)
          const textColor =
            isSel                  ? '#fff'
            : disabled             ? '#CBD5E1'
            : !cell.isCurrent      ? '#CBD5E1'
            : dow === 0            ? '#FF6969'
            : dow === 6            ? '#3B82F6'
            : '#111'

          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              onClick={() => onCellClick(cell.date)}
              style={{
                height: 36, borderRadius: 999,
                border: 'none',
                cursor: disabled ? 'default' : 'pointer',
                background: isSel ? '#111' : 'transparent',
                color: textColor,
                fontSize: 14,
                fontWeight: isToday ? 700 : 500,         // ← 오늘은 굵게
                position: 'relative',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
                padding: 0,
              }}
              onMouseEnter={e => {
                if (!isSel && !disabled) {
                  (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC'
                }
              }}
              onMouseLeave={e => {
                if (!isSel) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}>
              {cell.date.getDate()}
              {/* 오늘 표시 점 (선택되지 않았을 때만) */}
              {isToday && !isSel && (
                <span style={{
                  position: 'absolute',
                  bottom: 4, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: '50%',
                  background: cell.isCurrent ? '#111' : '#CBD5E1',
                }}/>
              )}
            </button>
          )
        })}
      </div>
    </div>,
    document.body
  )
}

// ─── 스타일 헬퍼 ─────────────────────────────────────────────────────────────
const navBtnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 8, border: 'none',
  background: 'transparent', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s',
  padding: 0,
}
