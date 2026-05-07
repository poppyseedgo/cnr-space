/**
 * HeaderNav.tsx — 헤더 가운데 영역 네비게이션 (Nav pills / 홈으로 복귀 버튼)
 *
 * ✅ 변경 이력
 *  - [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 4)
 *      · App.tsx L1534~1580 (~47줄 JSX) 통째 이동
 *      · view 분기 그대로: home/calendar → Nav pills, mypage/admin → "← 홈으로" 버튼
 *      · 동작 로직 무수정 (시각 동일)
 *
 * Figma 사양 (Nav pills 410:6865):
 *  · 컨테이너: bg #F5F9FF / border-radius 1000 / gap 0 / padding 0
 *  · 비활성 (410:6866/6868): padding 14px 24px / Pretendard Medium 15px / color #2F394A
 *  · 활성   (410:6869/6870): padding 14px 24px / Medium 15px / color #fff / bg #000 / shadow
 *  · 모바일: padding 7/10 + 11px (텍스트 압축 — "현황"/"캘린더")
 *
 * "← 홈으로" 버튼 (mypage/admin 모드):
 *  · bg #F3F4F8 / color #64748B / padding 6/14 / radius 999 / fontSize 12
 *
 * Props:
 *  - view       : home | calendar | mypage | admin (활성 표시 + 분기)
 *  - onSetView  : 클릭 시 뷰 전환
 *  - isMobile   : 반응형
 *  - dark       : 다크 모드
 */

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'  // ← [2026-05-07] pill용 훅 추가 (useLayoutEffect: 첫 페인트 깜빡임 방지)
import { Calendar, Home } from 'lucide-react'

interface HeaderNavProps {
  view: string;
  onSetView: (v: string) => void;
  isMobile: boolean;
  dark: boolean;
}

export function HeaderNav({ view, onSetView, isMobile, dark }: HeaderNavProps) {
  // home/calendar 모드: Nav pills (2개 탭)
  // ── [2026-05-07] Sliding pill ───────────────────────────────────────────────
  const NAV_ITEMS = [
    { v: "home",     icon: <Home size={14} strokeWidth={1.8}/>,     label: "실시간 현황", mLabel: "현황"   },
    { v: "calendar", icon: <Calendar size={14} strokeWidth={1.8}/>, label: "캘린더 뷰",  mLabel: "캘린더" },
  ]
  const btnRefs      = useRef<(HTMLButtonElement | null)[]>([])       // ← [2026-05-07] 버튼 ref
  const containerRef = useRef<HTMLDivElement | null>(null)             // ← [2026-05-07] 컨테이너 ref
  const [pill, setPill]   = useState({ left: 0, width: 0 })           // ← [2026-05-07] pill 위치/크기
  const [ready, setReady] = useState(false)                            // ← [2026-05-07] 첫 측정 완료 여부
  const measure = useCallback(() => {
    const i = NAV_ITEMS.findIndex(it => it.v === view)
    const btn = btnRefs.current[i]
    if (!btn) return
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth })          // ← [2026-05-07] offsetLeft 기준
    setReady(true)
  }, [view])  // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { measure() }, [measure])  // ← [2026-05-07 v2] useEffect→useLayoutEffect: 첫 페인트 전 동기 측정으로 깜빡임 제거
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(measure)                             // ← [2026-05-07] 반응형 재측정
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure])

  if (view === "home" || view === "calendar") {
    return (
      <div
        ref={containerRef}                                              // ← [2026-05-07] ResizeObserver 대상
        className="flex dark:bg-slate-700"
        style={{
          position: 'relative',                                         // ← [2026-05-07] pill absolute 기준점
          background: dark ? undefined : "#F5F9FF",
          borderRadius: 1000,
          padding: 0,
          gap: 0,
          overflow: 'hidden',
        }}>
        {/* Sliding pill */}
        {ready && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: pill.left, width: pill.width,                        // ← [2026-05-07] 측정값 적용
            background: dark ? "#F1F5F9" : "#000000",
            borderRadius: 1000,
            transition: 'left 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
            zIndex: 0, pointerEvents: 'none',
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }} />
        )}
        {NAV_ITEMS.map(({ v, icon, label, mLabel }, i) => (
          <button
            key={v}
            ref={el => { btnRefs.current[i] = el }}                    // ← [2026-05-07] 버튼 ref 등록
            onClick={() => onSetView(v)}
            className="btn flex items-center gap-1.5 whitespace-nowrap"
            style={{
              position: 'relative', zIndex: 1,                         // ← [2026-05-07] pill 위에 텍스트
              padding: isMobile ? "7px 10px" : "14px 24px",
              fontSize: isMobile ? 11 : 15,
              fontWeight: 500,
              borderRadius: 1000,
              background: 'transparent',                                // ← [2026-05-07] pill이 배경 담당
              color: view===v
                ? (dark?"#111111":"#fff")
                : (dark?"#94A3B8":"#2F394A"),
              transition: 'color 0.22s cubic-bezier(0.4,0,0.2,1)',    // ← [2026-05-07] 색상도 부드럽게
              boxShadow: 'none',
            }}>
            <span style={{fontSize: isMobile?13:14}}>{icon}</span>
            {!isMobile && label}
            {isMobile && mLabel}
          </button>
        ))}
      </div>
    );
  }

  // mypage/admin 모드: "← 홈으로" 버튼
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
      <button className="btn" onClick={()=>onSetView("home")}
        style={{background:"#F3F4F8",color:"#64748B",padding:"6px 14px",fontSize:12,borderRadius:999,
          display:"flex",alignItems:"center",gap:5}}>
        ← <span style={{fontWeight:600}}>{view==="mypage"?"My Page":"Admin"}</span>에서 홈으로
      </button>
    </div>
  );
}
