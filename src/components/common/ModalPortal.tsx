import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * ModalPortal
 *
 * 모달을 document.body 직하에 렌더링해서 CSS transform stacking context 문제를 방지한다.
 *
 * 문제 원인:
 *   .anm 클래스의 `transform: translateY(10px)` 애니메이션이 새로운 containing block을 생성하면
 *   자식의 `position: fixed` 요소가 viewport가 아닌 해당 조상 기준으로 배치된다.
 *   → 리스트가 길 때 모달이 화면 밖(아래)에 렌더되는 현상 발생.
 *
 * 해결:
 *   createPortal로 modal DOM을 .anm 트리 밖(document.body)으로 빼낸다.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const elRef = useRef<HTMLDivElement | null>(null)

  if (!elRef.current) {
    elRef.current = document.createElement('div')
  }

  useEffect(() => {
    const el = elRef.current!
    document.body.appendChild(el)
    return () => { document.body.removeChild(el) }
  }, [])

  return createPortal(children, elRef.current)
}
