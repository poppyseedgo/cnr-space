/**
 * ProfileDropdown.tsx — 헤더 우측 사용자 프로필 + 드롭다운 메뉴
 *
 * ✅ 변경 이력
 *  - [2026-05-04] App.tsx에서 분리 (Phase 1+2 Step 2)
 *      · App.tsx L1698~1837 (140줄 JSX) + L430~431 (state/ref) + L634 (외부클릭 분할) 통합 이동
 *      · 자체 ref + 자체 외부클릭 useEffect 보유 → 자기완결적 컴포넌트
 *      · 동작 로직 무수정 (시각/인터랙션 동일)
 *
 * Figma 정확 반영 사양 (이전 [2026-05-04] 작업과 동일):
 *  · 프로필 버튼 (Figma 410:6871):
 *      bg #F6F9FF / padding 2px 10px 2px 2px / gap 8px / border-radius 1000 / border 없음
 *      아바타 32×32 #CBECFF / 이름 15 Medium #1E1E1E / 부서 13 Regular #A4B2BF max-w 100 ellipsis
 *      모바일은 4px 패딩 + 텍스트 미표시
 *  · 드롭다운 (Figma 445:535 일반사용자 / 445:377 관리자):
 *      width 200 / radius 16 / shadow 0 8px 32px rgba(0,0,0,0.12)
 *      ModalHeader: padding 12 / 이름 14 Medium #111 / 부서 14 Regular #96A0B3 ellipsis
 *      메뉴: padding 8/12 / 텍스트 14 Medium #111 letter-spacing 0.14px / 아이콘 size 20
 *      로그아웃: 색상 #99A1AF (회색)
 *
 * Props (인증/모드/액션은 모두 부모 위임):
 *  - currentUser, currentDept, avatarUrl  → 표시
 *  - isAdmin, isMobile, dark, view        → 권한·반응형·테마·활성 메뉴
 *  - onSetView, onLogout                  → 액션 콜백
 */

import { useState, useEffect, useRef } from 'react'
import { LayoutDashboard, LogOut, UserCircle } from 'lucide-react'
import { UserAvatar } from '../common/UserAvatar'

interface ProfileDropdownProps {
  // 표시
  currentUser: string;
  currentDept: string;
  avatarUrl?: string | null;
  // 권한/모드
  isAdmin: boolean;
  isMobile: boolean;
  dark: boolean;
  view: string;                         // 활성 메뉴 하이라이트용 (mypage/admin)
  // 액션
  onSetView: (v: string) => void;
  onLogout: () => void;
}

export function ProfileDropdown({
  currentUser,
  currentDept,
  avatarUrl,
  isAdmin,
  isMobile,
  dark,
  view,
  onSetView,
  onLogout,
}: ProfileDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기 (자기완결적 — 부모와 무관하게 작동)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div ref={dropdownRef} style={{position:"relative"}}>
      {/* Figma 410:6871: bg #F6F9FF / padding 2px 10px 2px 2px / gap 8px / border-radius 1000 / border 없음
          아바타: 32×32 #CBECFF / 이름 14 SemiBold #1E1E1E / 부서 13 Regular #A4B2BF max-w 100 ellipsis
          모바일은 기존 4px 패딩 유지 (텍스트 미표시) */}
      <button className="btn flex items-center flex-shrink-0"
        onClick={()=>setShowDropdown(v=>!v)}
        style={{
          padding: isMobile ? "4px 4px" : "2px 10px 2px 2px",
          gap: 8,
          borderRadius: 1000,
          background: dark ? "rgba(255,255,255,0.05)" : "#F6F9FF",
          border: "none",
          cursor:"pointer",
        }}>
        <UserAvatar
          name={currentUser}
          avatarUrl={avatarUrl}
          size={isMobile ? 28 : 32}
          bgColor="#CBECFF"
          textColor="#1E1E1E"
          fontWeight={400}    // ← [2026-04-30] 헤더 프로필 아바타만 400 (기본 500 override)
        />
        {!isMobile && (
          <>
            <span style={{
              fontSize: 15,
              fontWeight: 500,        // ← [2026-04-30] 600 → 500 (Pretendard Medium)
              lineHeight: 1.5,
              color: dark ? "#fff" : "#1E1E1E",
              whiteSpace: "nowrap",
            }}>
              {currentUser}
            </span>
            <span style={{
              fontSize: 13,
              fontWeight: 400,        // Pretendard Regular
              lineHeight: 1.5,
              color: dark ? "#94A3B8" : "#A4B2BF",
              maxWidth: 100,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {currentDept}
            </span>
          </>
        )}
      </button>

      {/* 드롭다운 메뉴
          [2026-05-04] Figma 445:535(일반사용자) / 445:377(관리자) 정확 반영
          · 컨테이너: width 200 / radius 16 / border 제거 / shadow 유지
          · ModalHeader: padding 12 / 이름 14 Medium #111 / 부서 14 Regular #96A0B3 ellipsis / gap 2
          · Dropdown contents: padding 4px 0 / 메뉴 padding 8px 12px / 텍스트 14 Medium #111 letter-spacing 0.14px
          · Modal Bottom (로그아웃): 외부 padding 8px 12px / 내부 padding 4px 0 / 색상 #99A1AF (회색, 기존 빨강에서 변경)
          · 아이콘: User → UserCircle, Settings → LayoutDashboard, LogOut 유지 / size 20 strokeWidth 1.5
          · 메뉴 라벨: "My Page"→"MY PAGE", "Admin"→"ADMIN" (Figma 정확 표기) */}
      {showDropdown && (
        <div className="anm" style={{
          position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:200,
          background:"#fff",
          borderRadius:16,
          boxShadow:"0 8px 32px rgba(0,0,0,0.12)",
          overflow:"hidden",
          width:200,
        }}>
          {/* ModalHeader (사용자 정보) — Figma 445:536 / 445:423 */}
          <div style={{
            padding:12,
            borderBottom:"1px solid #F1F5F9",
            display:"flex", flexDirection:"column", gap:2,
          }}>
            <div style={{
              fontSize:14, fontWeight:500, lineHeight:1.5, color:"#111",
              whiteSpace:"nowrap",
            }}>{currentUser}</div>
            <div style={{
              fontSize:14, fontWeight:400, lineHeight:1.5, color:"#96A0B3",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>{currentDept}</div>
          </div>
          {/* Dropdown contents (메뉴 항목) — Figma 445:539 / 445:378 */}
          <div style={{padding:"4px 0", background:"#fff"}}>
            <button className="btn" onClick={()=>{onSetView("mypage");setShowDropdown(false);}}
              style={{
                width:"100%", textAlign:"left",
                padding:"12px",  // ← [2026-05-06] 8px 12px → 12px
                fontSize:14, fontWeight:400, lineHeight:1.5,  // ← [2026-05-06] 500 → 400
                letterSpacing:"0.5px",  // ← [2026-05-06] 0.14px → 0.5px
                background:view==="mypage"?"#F8FAFC":"transparent",
                color:"#111",
                display:"flex", alignItems:"center", gap:8,
                border:"none", cursor:"pointer",
              }}
              onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
              onMouseLeave={e=>e.currentTarget.style.background=view==="mypage"?"#F8FAFC":"transparent"}>
              <UserCircle size={20} strokeWidth={1.5}/>
              MY PAGE
            </button>
            {isAdmin && (
              <button className="btn" onClick={()=>{onSetView("admin");setShowDropdown(false);}}
                style={{
                  width:"100%", textAlign:"left",
                  padding:"12px",  // ← [2026-05-06] 8px 12px → 12px
                  fontSize:14, fontWeight:400, lineHeight:1.5,  // ← [2026-05-06] 500 → 400
                  letterSpacing:"0.5px",  // ← [2026-05-06] 0.14px → 0.5px
                  background:view==="admin"?"#F8FAFC":"transparent",
                  color:"#111",
                  display:"flex", alignItems:"center", gap:8,
                  border:"none", cursor:"pointer",
                }}
                onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                onMouseLeave={e=>e.currentTarget.style.background=view==="admin"?"#F8FAFC":"transparent"}>
                <LayoutDashboard size={20} strokeWidth={1.5}/>
                ADMIN
              </button>
            )}
          </div>
          {/* Modal Bottom (로그아웃) — Figma 445:552 / 445:430 */}
          <div style={{
            borderTop:"1px solid #F1F5F9",
            padding:"8px 12px",
          }}>
            <button className="btn" onClick={()=>{onLogout();setShowDropdown(false);}}
              style={{
                width:"100%", textAlign:"left",
                padding:"4px 0",
                fontSize:14, fontWeight:400, lineHeight:1.5,  // ← [2026-05-06] 500 → 400
                color:"#99A1AF",
                background:"transparent",
                display:"flex", alignItems:"center", gap:8,
                border:"none", cursor:"pointer",
              }}>
              <LogOut size={20} strokeWidth={1.5}/>
              로그아웃
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
