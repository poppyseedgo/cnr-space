/**
 * HeaderNav.tsx — 헤더 가운데 영역 네비게이션 (Nav pills / 홈으로 복귀 버튼)
 *
 * ✅ 변경 이력
 *  - [2026-05-15] 버튼 padding 비대칭 미세조정 (Figma 1:1)
 *      · 데스크탑: '10px 20px' → '10px 20px 10px 18px' (좌 20→18, 우 20 유지)
 *      · 의도: 아이콘이 좌측에 있어 좌측 여백을 살짝 줄여 시각 균형 보정
 *      · 모바일 padding은 변경 없음 (7px 10px 유지)
 *  - [2026-05-13 v7] 중앙 토글 Figma 572:468 1:1 재설계
 *      · 버튼 padding: 14/24 → 10/20 (좌우 24→20, 상하 14→10)
 *      · 아이콘 lucide Home/Calendar (14px) → custom SVG schedule/calendar (24px)
 *      · gap 6 (gap-1.5) → 8 (Figma px)
 *      · fontSize 15 → 15 (동일 유지) / fontWeight 500 → Pretendard Regular(400)
 *      · 비활성 텍스트 #2F394A (동일 유지)
 *      · 활성 시 calendar.svg stroke=white로 자연 처리, schedule.svg는 currentColor 동적 변경
 *      · 모바일은 기존 압축 사이즈 유지 (Figma는 데스크탑 기준만 제공)
 *      · sliding pill 메커니즘 그대로 유지
 *  - [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 4)
 *      · App.tsx L1534~1580 (~47줄 JSX) 통째 이동
 *      · view 분기 그대로: home/calendar → Nav pills, mypage/admin → "← 홈으로" 버튼
 *
 * Figma 사양 (572:468 — Nav pills 신버전):
 *  · 컨테이너: bg #F5F9FF (gradient 단색 해석) / border-radius 1000 / overflow hidden
 *  · 각 버튼: padding 10px 20px 10px 18px / gap 8px / 아이콘 24px + 텍스트 15px Pretendard leading 1.25
 *  · 비활성: bg 투명 (컨테이너색 통과) / color #2F394A
 *  · 활성  : bg #000 / color #fff / 아이콘 흰색
 *
 * "← 홈으로" 버튼 (mypage/admin 모드):
 *  · bg #F3F4F8 / color #64748B / padding 6/14 / radius 999 / fontSize 12 (변경 없음)
 *
 * Props:
 *  - view       : home | calendar | mypage | admin (활성 표시 + 분기)
 *  - onSetView  : 클릭 시 뷰 전환
 *  - isMobile   : 반응형
 *  - dark       : 다크 모드
 */

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react'  // ← [2026-05-07] pill용 훅 추가 (useLayoutEffect: 첫 페인트 깜빡임 방지)

interface HeaderNavProps {
  view: string;
  onSetView: (v: string) => void;
  isMobile: boolean;
  dark: boolean;
}

// ── 아이콘 (사용자 제공 SVG 1:1 + currentColor 처리로 활성/비활성 색상 통일) ──
// schedule.svg: mask 구조 그대로 + fill을 currentColor로 변경하여 button color 상속
// ← [2026-07-31] export + size prop — AppDrawer/AppFooter 가 동일 아이콘·명칭 공유 (고지 지시)
export const IcoSchedule = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <mask id="mask0_hdr_schedule" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="#D9D9D9"/>
    </mask>
    <g mask="url(#mask0_hdr_schedule)">
      <path d="M15.6462 16.3538L16.3538 15.6463L12.5 11.7918V7H11.5V12.2078L15.6462 16.3538ZM12.0033 21C10.7588 21 9.58867 20.7638 8.493 20.2915C7.3975 19.8192 6.4445 19.1782 5.634 18.3685C4.8235 17.5588 4.18192 16.6067 3.70925 15.512C3.23642 14.4175 3 13.2479 3 12.0033C3 10.7588 3.23617 9.58867 3.7085 8.493C4.18083 7.3975 4.82183 6.4445 5.6315 5.634C6.44117 4.8235 7.39333 4.18192 8.488 3.70925C9.5825 3.23642 10.7521 3 11.9967 3C13.2412 3 14.4113 3.23617 15.507 3.7085C16.6025 4.18083 17.5555 4.82183 18.366 5.6315C19.1765 6.44117 19.8181 7.39333 20.2908 8.488C20.7636 9.5825 21 10.7521 21 11.9967C21 13.2412 20.7638 14.4113 20.2915 15.507C19.8192 16.6025 19.1782 17.5555 18.3685 18.366C17.5588 19.1765 16.6067 19.8181 15.512 20.2908C14.4175 20.7636 13.2479 21 12.0033 21ZM12 20C14.2167 20 16.1042 19.2208 17.6625 17.6625C19.2208 16.1042 20 14.2167 20 12C20 9.78333 19.2208 7.89583 17.6625 6.3375C16.1042 4.77917 14.2167 4 12 4C9.78333 4 7.89583 4.77917 6.3375 6.3375C4.77917 7.89583 4 9.78333 4 12C4 14.2167 4.77917 16.1042 6.3375 17.6625C7.89583 19.2208 9.78333 20 12 20Z" fill="currentColor"/>
    </g>
  </svg>
)

// calendar.svg: stroke 라인 스타일 → stroke="currentColor"로 button color 상속
export const IcoCalendar = ({ size = 24 }: { size?: number }) => (  // ← [2026-07-31] export + size prop
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M15.5762 19.5H2L3.60596 12.5L4.40894 9M4.40894 9L5.21191 5.5H18.7881L22 19.5H15.5762M15.5762 19.5L17.1821 12.5L17.9851 9M18.7881 5.5L17.9851 9M17.9851 9H4.40894" stroke="currentColor"/>
  </svg>
)

export function HeaderNav({ view, onSetView, isMobile, dark }: HeaderNavProps) {
  // home/calendar 모드: Nav pills (2개 탭)
  // ── [2026-05-07] Sliding pill ───────────────────────────────────────────────
  // [2026-05-13 v7] 아이콘 lucide → custom SVG 교체
  const NAV_ITEMS = [
    { v: "home",     icon: <IcoSchedule />,  label: "실시간 현황", mLabel: "현황"   },
    { v: "calendar", icon: <IcoCalendar />,  label: "캘린더 뷰",   mLabel: "캘린더" },
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
            left: 0,                                                    // ← [2026-05-07 v3] left → translate3d (GPU 가속)
            width: pill.width,
            transform: `translate3d(${pill.left}px, 0, 0)`,             // ← [2026-05-07 v3] GPU composite layer
            background: dark ? "#F1F5F9" : "#000000",
            borderRadius: 1000,
            transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
            willChange: 'transform, width',                             // ← [2026-05-07 v3] composite layer 힌트
            zIndex: 0, pointerEvents: 'none',
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
          }} />
        )}
        {NAV_ITEMS.map(({ v, icon, label, mLabel }, i) => (
          <button
            key={v}
            ref={el => { btnRefs.current[i] = el }}                    // ← [2026-05-07] 버튼 ref 등록
            onClick={() => onSetView(v)}
            className="btn flex items-center whitespace-nowrap"        /* ← [2026-05-13 v7] gap-1.5 제거 - inline style gap으로 대체 */
            style={{
              position: 'relative', zIndex: 1,                         // ← [2026-05-07] pill 위에 텍스트
              gap: 8,                                                   /* ← [2026-05-13 v7] Figma 1:1 (6 → 8) */
              padding: isMobile ? "7px 10px" : "10px 20px 10px 18px",   /* ← [2026-05-15] 데스크탑 좌 padding 20→18 비대칭 (Figma 1:1) */
              fontSize: isMobile ? 11 : 15,
              fontWeight: 400,                                          /* ← [2026-05-13 v7] 500 → 400 (Pretendard Regular, Figma 1:1) */
              lineHeight: 1.25,                                         /* ← [2026-05-13 v7] Figma 1:1 (leading-[1.25]) */
              fontFamily: "'Pretendard', -apple-system, sans-serif",   /* ← [2026-05-13 v7] Pretendard 명시 */
              borderRadius: 1000,
              background: 'transparent',                                // ← [2026-05-07] pill이 배경 담당
              color: view===v
                ? (dark?"#111111":"#fff")
                : (dark?"#94A3B8":"#2F394A"),
              transition: 'color 0.22s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: 'none',
              WebkitTapHighlightColor: 'transparent',                    // ← [2026-05-07 v3] iOS 회색 박스 제거
              touchAction: 'manipulation',                                // ← [2026-05-07 v3] 300ms tap delay 제거
              userSelect: 'none',                                          // ← [2026-05-07 v3] 빠른 탭 시 텍스트 선택 차단
            }}>
            <span style={{ display: 'flex', alignItems: 'center', width: isMobile?16:24, height: isMobile?16:24 }}>{icon}</span>
            {!isMobile && label}
            {isMobile && mLabel}
          </button>
        ))}
      </div>
    );
  }

  // mypage/admin/library 모드: "← 홈으로" 버튼
  const pageLabel = view === "mypage" ? "My Page"
                  : view === "admin"   ? "Admin"
                  : view === "library" ? "도서관"
                  : view
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
      <button className="btn" onClick={()=>onSetView("home")}
        style={{background:"#F3F4F8",color:"#64748B",padding:"6px 14px",fontSize:12,borderRadius:999,
          display:"flex",alignItems:"center",gap:5}}>
        ← <span style={{fontWeight:600}}>{pageLabel}</span>에서 홈으로
      </button>
    </div>
  );
}
