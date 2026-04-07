import { useState, useEffect, useRef } from 'react'

function useWindowWidth() {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  )
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const h = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setW(window.innerWidth), 100)
    }
    window.addEventListener('resize', h)
    return () => {
      window.removeEventListener('resize', h)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])
  return w
}

export function useBreakpoint() {
  const w = useWindowWidth()
  return {
    isMobile:  w < 768,   // 태블릿 포함 (768px 미만)
    isTablet:  w >= 768 && w < 1024,
    isDesktop: w >= 1024,
    width: w,
  }
}

export function useVisualViewport() {
  const getH   = () => window.visualViewport ? window.visualViewport.height  : window.innerHeight
  const getOff = () => window.visualViewport ? window.visualViewport.offsetTop : 0
  const [vh,  setVh]  = useState(getH)
  const [off, setOff] = useState(getOff)
  useEffect(() => {
    const vv = window.visualViewport
    const update = () => { setVh(getH()); setOff(getOff()) }
    if (vv) { vv.addEventListener('resize', update); vv.addEventListener('scroll', update) }
    window.addEventListener('resize', update)
    return () => {
      if (vv) { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
      window.removeEventListener('resize', update)
    }
  }, [])
  return { vh, off }
}
