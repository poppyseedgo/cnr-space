/**
 * 전역 Ripple — document에 pointerdown 리스너 하나로
 * className="btn" 인 모든 버튼에 자동 적용
 * App.tsx에서 한 번만 호출하면 됨
 */
export function initGlobalRipple() {
  const handler = (e: PointerEvent) => {
    const target = e.target as HTMLElement
    const btn = target.closest('.btn') as HTMLElement | null
    if (!btn || btn.hasAttribute('disabled')) return

    // scale 피드백
    btn.classList.add('pressed')

    // ripple 생성
    const rect = btn.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const size = Math.max(rect.width, rect.height) * 2

    const bg = getComputedStyle(btn).backgroundColor
    const isDark = isDarkBg(bg)

    const ripple = document.createElement('span')
    ripple.className = 'btn-ripple'
    ripple.style.cssText = `
      width:${size}px;height:${size}px;
      left:${x - size / 2}px;top:${y - size / 2}px;
      background:${isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.1)'};
    `
    btn.appendChild(ripple)
    setTimeout(() => ripple.remove(), 550)
  }

  const upHandler = (e: PointerEvent) => {
    const target = e.target as HTMLElement
    const btn = target.closest('.btn') as HTMLElement | null
    btn?.classList.remove('pressed')
  }

  document.addEventListener('pointerdown', handler)
  document.addEventListener('pointerup',     upHandler)
  document.addEventListener('pointercancel', upHandler)

  // cleanup용 반환
  return () => {
    document.removeEventListener('pointerdown', handler)
    document.removeEventListener('pointerup',   upHandler)
    document.removeEventListener('pointercancel', upHandler)
  }
}

function isDarkBg(rgb: string): boolean {
  const m = rgb.match(/\d+/g)
  if (!m || m.length < 3) return true
  const [r, g, b] = m.map(Number)
  return (0.299 * r + 0.587 * g + 0.114 * b) < 128
}
