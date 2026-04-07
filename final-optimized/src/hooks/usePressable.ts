import { useCallback, useRef } from 'react'

/**
 * 버튼 인터랙션 훅 — B 타이밍(0.1s scale) + A Ripple 조합
 * 모바일(touch) + 데스크탑(mouse) 통합
 */
export function usePressable() {
  const ref = useRef<HTMLButtonElement>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current as HTMLElement | null
    if (!el) return

    // scale 피드백
    el.classList.add('pressed')

    // Ripple 생성
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = Math.max(rect.width, rect.height) * 2

    const ripple = document.createElement('span')
    ripple.className = 'btn-ripple'

    // ripple 색상: 어두운 배경이면 흰색, 밝은 배경이면 검정
    const bg = getComputedStyle(el).backgroundColor
    const isDark = isDarkColor(bg)
    ripple.style.cssText = `
      width:${size}px; height:${size}px;
      left:${x - size / 2}px; top:${y - size / 2}px;
      background: ${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.1)'};
    `
    el.appendChild(ripple)
    setTimeout(() => ripple.remove(), 550)
  }, [])

  const handlePointerUp = useCallback(() => {
    ;(ref.current as HTMLElement | null)?.classList.remove('pressed')
  }, [])

  return {
    ref,
    onPointerDown:   handlePointerDown,
    onPointerUp:     handlePointerUp,
    onPointerCancel: handlePointerUp,
    onPointerLeave:  handlePointerUp,
  }
}

/** rgb(r,g,b) 문자열 파싱 → 밝기 판단 */
function isDarkColor(rgb: string): boolean {
  const m = rgb.match(/\d+/g)
  if (!m || m.length < 3) return true
  const [r, g, b] = m.map(Number)
  // 상대 밝기 (W3C 기준)
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}
