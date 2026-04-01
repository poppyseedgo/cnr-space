import { useCallback, useRef } from 'react'

/**
 * 모바일 우선 버튼 인터랙션 훅
 * onPointerDown/Up/Cancel → .pressed 클래스 토글
 * 터치·마우스·스타일러스 모두 대응
 */
export function usePressable() {
  const ref = useRef<HTMLElement>(null)

  const addPressed = useCallback(() => {
    ref.current?.classList.add('pressed')
  }, [])

  const removePressed = useCallback(() => {
    ref.current?.classList.remove('pressed')
  }, [])

  return {
    ref,
    onPointerDown:   addPressed,
    onPointerUp:     removePressed,
    onPointerCancel: removePressed,
    onPointerLeave:  removePressed,
  }
}
