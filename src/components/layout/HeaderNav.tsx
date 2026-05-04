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

import React from 'react'
import { Calendar, Home } from 'lucide-react'

interface HeaderNavProps {
  view: string;
  onSetView: (v: string) => void;
  isMobile: boolean;
  dark: boolean;
}

export function HeaderNav({ view, onSetView, isMobile, dark }: HeaderNavProps) {
  // home/calendar 모드: Nav pills (2개 탭)
  if (view === "home" || view === "calendar") {
    return (
      <div className="flex dark:bg-slate-700"
        style={{
          background: dark ? undefined : "#F5F9FF",
          borderRadius: 1000,
          padding: 0,
          gap: 0,
        }}>
        {([
          ["home",       <Home size={14} strokeWidth={1.8}/>,     "실시간 현황", "현황"]    as const,
          ["calendar",   <Calendar size={14} strokeWidth={1.8}/>,  "캘린더 뷰",  "캘린더"]  as const,
        ] as [string, React.ReactElement, string, string][]).map(([v,icon,label,mLabel])=>(
          <button key={v} onClick={()=>onSetView(v)}
            className="btn flex items-center gap-1.5 transition-all whitespace-nowrap"
            style={{
              // ── [2026-04-30 사용자 요청] padding 활성/비활성 통일 14px 24px
              padding: isMobile ? "7px 10px" : "14px 24px",
              fontSize: isMobile ? 11 : 15,
              // ── [이전] 활성/비활성 모두 500으로 통일
              fontWeight: 500,
              borderRadius: 1000,
              background: view===v ? (dark?"#F1F5F9":"#000000") : "transparent",
              color: view===v
                ? (dark?"#111111":"#fff")
                : (dark?"#94A3B8":"#2F394A"),     // ← [2026-04-30] 비활성 색 #808899 → #2F394A (rgb 47 57 74) 더 진하게
              boxShadow: view===v ? "0 2px 8px rgba(0,0,0,0.18)" : "none",
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
