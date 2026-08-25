// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-08-25] 신규 — 월간뷰 "+N건 더보기" 팝오버
//
//   배경: 월간뷰 날짜 셀은 overflow:hidden(셀 내부 스크롤 금지 설계)이라, 노출 한도를 넘는
//         예약에 접근할 진입점이 "+N개" 텍스트뿐이었는데 그 텍스트마저 셀 하단에서 잘려
//         나머지 예약을 볼 방법이 없었음. 셀은 "더보기" 칩만 노출하고, 전체 목록은 이 팝오버가 담당.
//
//   스펙:
//     · Portal(document.body) + position:fixed, 셀 anchorRect 기준 좌상단 정렬
//     · 폭 = max(anchor 폭, 300), 뷰포트 우/하단 침범 시 좌/상으로 클램프·플립
//     · 헤더: "9월 1일 (화)" + "17건" / 본문: CalendarCompactCard 전체 목록(내부 스크롤, 최대 320px)
//     · 푸터: [일간 뷰로 이동] [닫기]
//     · 닫힘: 외부 클릭(mousedown) / Esc / 창 리사이즈 / 팝오버 밖 스크롤 (내부 목록 스크롤은 유지)
// [2026-08-25 v2] 내부 목록 스크롤 시 닫히던 결함 수정 — scroll 리스너에서 target ∈ 팝오버면 무시
//     · 카드 클릭 → onBookingClick(기존 DetailModal 경로) 후 닫힘. 로직·API 무변경, 표시 전용
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Booking } from '../../types'
import { CalendarCompactCard } from './CalendarCompactCard'
import { dateToObj, DAY_NAMES } from '../../utils/time'

export interface MonthlyDayPopoverProps {
  /** YYYY-MM-DD */
  date: string
  bookings: Booking[]
  isToday: boolean
  /** 셀의 getBoundingClientRect() 스냅샷 */
  anchorRect: { top: number; left: number; width: number; height: number }
  onBookingClick: (b: Booking) => void
  onGoDaily: (date: string) => void
  onClose: () => void
}

const POP_MIN_W = 300
const LIST_MAX_H = 320
const VIEWPORT_PAD = 12

function fmtHeader(ds: string): string {
  const d = dateToObj(ds)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`
}

export function MonthlyDayPopover({
  date, bookings, isToday, anchorRect, onBookingClick, onGoDaily, onClose,
}: MonthlyDayPopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: anchorRect.top, left: anchorRect.left })
  const width = Math.max(anchorRect.width, POP_MIN_W)

  // 실제 렌더 높이로 뷰포트 클램프 (우측/하단 침범 시 좌/상으로 이동)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const h = el.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let left = anchorRect.left
    let top  = anchorRect.top
    if (left + width > vw - VIEWPORT_PAD) left = Math.max(VIEWPORT_PAD, vw - VIEWPORT_PAD - width)
    if (top + h > vh - VIEWPORT_PAD) {
      const above = anchorRect.top + anchorRect.height - h            // 셀 하단 기준 위로 정렬
      top = above >= VIEWPORT_PAD ? above : Math.max(VIEWPORT_PAD, vh - VIEWPORT_PAD - h)
    }
    setPos({ top, left })
  }, [anchorRect, width, bookings.length])

  // 외부 클릭 / Esc / 리사이즈·스크롤 → 닫기
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onResize = () => onClose()
    // ← [2026-08-25 v2 FIX] 캡처 단계 scroll 리스너가 팝오버 내부 목록 스크롤까지 잡아 즉시 닫히던 결함
    //   · 내부 스크롤(target이 팝오버 안) → 무시 / 외부(페이지·컨테이너) 스크롤 → 앵커가 어긋나므로 닫기
    const onScroll = (e: Event) => {
      const t = e.target as Node | null
      if (t && boxRef.current && boxRef.current.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`${fmtHeader(date)} 예약 ${bookings.length}건`}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 1000,
        background: '#fff', borderRadius: 12, border: '1px solid #E2E8F0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08)',
        padding: '10px 12px 12px', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{fmtHeader(date)}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8' }}>{bookings.length}건</span>
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        maxHeight: LIST_MAX_H, overflowY: 'auto', overscrollBehavior: 'contain',
      }}>
        {bookings.map(b => (
          <CalendarCompactCard
            key={b.id}
            booking={b}
            isToday={isToday}
            onClick={e => { e.stopPropagation(); onClose(); onBookingClick(b) }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => { onClose(); onGoDaily(date) }}
          style={{
            flex: 1, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
            fontSize: 12, fontWeight: 500, color: '#111111', cursor: 'pointer',
          }}
        >일간 뷰로 이동</button>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          style={{
            width: 30, height: 30, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff',
            fontSize: 14, color: '#64748B', cursor: 'pointer', lineHeight: 1,
          }}
        >×</button>
      </div>
    </div>,
    document.body,
  )
}
