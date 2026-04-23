// ─── 변경 이력 ─────────────────────────────────────────────────────────────
// [2026-04-23] 신규 — 차단된 UI 영역에 마우스 따라다니는 커스텀 툴팁 제공
//   배경: 기존 브라우저 기본 `title` 속성 툴팁은 0.5초 딜레이 + 스타일 커스텀 불가
//         `cursor: not-allowed`의 OS 강제 금지 아이콘이 UX 저해
//   해결: Portal 기반 커스텀 툴팁 (X 아이콘 + 메시지) + 마우스 위치 추적
//   사용처: CalendarShell의 4개 지점 (데이트피커/Monthly/Daily/Weekly)
// ──────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'

interface TooltipState {
  message: string
  x: number
  y: number
}

// 툴팁 표시 상수 (뷰포트 경계 보정용 대략치)
const TOOLTIP_MAX_W = 280  // 가로 최대 추정치
const TOOLTIP_H     = 28   // 세로 추정치
const OFFSET        = 14   // 커서 우측·하단 오프셋

/** 뷰포트 경계 보정: 우측·하단이 잘릴 경우 반대편으로 붙임 */
function calcPosition(e: ReactMouseEvent, message: string): TooltipState {
  let x = e.clientX + OFFSET
  let y = e.clientY + OFFSET
  if (x + TOOLTIP_MAX_W > window.innerWidth - 8) {
    x = e.clientX - TOOLTIP_MAX_W - OFFSET  // 우측 경계 넘으면 좌측 배치
  }
  if (y + TOOLTIP_H > window.innerHeight - 8) {
    y = e.clientY - TOOLTIP_H - OFFSET      // 하단 경계 넘으면 상단 배치
  }
  return { message, x, y }
}

/**
 * 차단된 UI 요소용 마우스 추적 커스텀 툴팁 훅.
 *
 * 사용법:
 *   const { getHandlers, tooltipNode } = useBlockedTooltip()
 *   ...
 *   <div {...getHandlers({ blocked: !canNavigate, message: '...' })}>...</div>
 *   {tooltipNode}   // 컴포넌트 return 최하단에 1회 렌더
 *
 * 기존 onMouseEnter/Leave와 병합이 필요한 경우 수동 합성:
 *   const h = getHandlers({ blocked, message })
 *   onMouseEnter={e => { h.onMouseEnter(e); /* 기존 로직 *\/ }}
 *   onMouseMove={h.onMouseMove}
 *   onMouseLeave={e => { h.onMouseLeave(); /* 기존 로직 *\/ }}
 */
export function useBlockedTooltip() {
  const [state, setState] = useState<TooltipState | null>(null)

  // getHandlers: blocked=true일 때만 mousemove로 위치 갱신, leave 시 제거
  const getHandlers = useCallback(
    ({ blocked, message }: { blocked: boolean; message: string }) => ({
      onMouseEnter: (e: ReactMouseEvent) => {
        if (blocked) setState(calcPosition(e, message))
      },
      onMouseMove: (e: ReactMouseEvent) => {
        if (blocked) setState(calcPosition(e, message))
      },
      onMouseLeave: () => setState(null),
    }),
    []
  )

  // tooltipNode: Portal로 document.body 직계 렌더 (z-index 간섭 회피)
  const tooltipNode: ReactNode = useMemo(() => {
    if (!state) return null
    // SSR 가드 (Vite SPA에서는 불필요하지만 방어적)
    if (typeof document === 'undefined') return null
    return createPortal(
      <div
        role="tooltip"
        style={{
          position: 'fixed',
          top: state.y,
          left: state.x,
          zIndex: 99999,
          pointerEvents: 'none',       // 툴팁이 hover 이벤트 가로채지 않도록
          background: 'rgba(17,17,17,0.92)',
          color: '#fff',
          padding: '6px 10px',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 500,
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          whiteSpace: 'nowrap',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* ⊗ X 아이콘 — 원 안에 X */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="6" cy="6" r="5" stroke="#fff" strokeWidth="1" />
          <path d="M4 4 L 8 8 M 8 4 L 4 8" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <span>{state.message}</span>
      </div>,
      document.body
    )
  }, [state])

  return { getHandlers, tooltipNode }
}
