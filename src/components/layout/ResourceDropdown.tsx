/**
 * ResourceDropdown.tsx — 헤더 우측 "자원 예약" 드롭다운 (기능 비활성화 placeholder)
 *
 * ✅ 변경 이력
 *  - [2026-05-13 v12] open 상태에서도 hover와 동일 배경 유지 (사용자 피드백)
 *      · background 조건: `hover` → `open || hover`
 *      · 드롭다운 열려있는 동안 트리거 버튼이 active 상태임을 시각적으로 표시
 *      · 같은 #F5F9FF 색으로 hover/open 시각 일관성 유지
 *  - [2026-05-13 v11] 트리거 버튼 Figma 1:1 + hover 배경 + 아이콘 교차 애니메이션
 *      · padding: '10px 20px' → '10px 12px 10px 16px' (Figma 572:474 비대칭 1:1)
 *        좌측 아이콘 24px / 우측 화살표 20px 시각 무게 차이 반영
 *      · hover/active 시 background #F5F9FF (Figma bg-[#f5f9ff] 1:1)
 *        + 마운스/터치 모두 대응 (mouseenter/leave + touchstart/end + click 후 일정시간 유지)
 *      · 좌측 아이콘 자동 교차 애니메이션: ZOOM → 포인터 → 도서 → ZOOM ...
 *        - 4초 주기, 스케일+페이드 (0.5s cubic-bezier)
 *        - 드롭다운 열림 중에는 일시정지 (현재 표시 아이콘 고정)
 *        - position:absolute 3개 레이어, active 클래스 교차
 *  - [2026-05-13 v10] opacity 0.35 → 1 복원 (사용자 피드백)
 *      · v8에서 비활성 시각화 목적 0.35 적용했던 것을 다시 100%로
 *      · 기능 onClick은 여전히 미연결 — 시각적 비활성 표시만 해제 (placeholder UI는 유지)
 *  - [2026-05-13 v9] 포인터 아이콘 SVG 재교체 (사용자 재제공)
 *      · path 구조 변경: 2 path → 3 path (그라데이션 + 흰 fill + 검정 outline 레이어)
 *      · React 호환 처리: stop-color/stop-opacity → stopColor/stopOpacity (camelCase)
 *      · gradient ID는 기존(paint0_lin_resource_pointer) 유지로 collision 방지
 *  - [2026-05-13 v8] 화살표 이펙트 + opacity 35% (사용자 피드백)
 *      · 트리거 화살표: 정적 인라인 컴포넌트 → SegmentTabBar(전체 회의실)와 동일 이펙트
 *        (path/fill #D0D0D0 / transition transform 0.2s / open 시 rotate 180deg)
 *      · 최외각 wrapper에 opacity 0.35 적용
 *        → 트리거 + 드롭다운 메뉴 모두 한 번에 처리 (CSS opacity는 descendant에 상속,
 *          position:absolute 자식인 드롭다운 메뉴에도 동일 적용됨)
 *      · 비활성 시각화만 — 클릭 동작은 그대로 (트리거 열림/닫힘은 작동)
 *  - [2026-05-13 v7] 신규 생성 (Figma 572:462)
 *      · 헤더 우측 영역에 "자원 예약" 드롭다운 메뉴 추가
 *      · 메뉴 3종: ZOOM 예약 / 포인터 대여 / 도서 대여
 *      · ⚠️ 메뉴 항목 클릭 기능은 추후 구현 — 현재는 시각적 placeholder만
 *        (외부 클릭으로 드롭다운 close는 작동, 항목 클릭은 onClick 미연결)
 *      · NotificationBell / ProfileDropdown 패턴 따라 자기완결적 컴포넌트 (자체 state/ref/외부클릭 effect)
 *
 * Figma 정확 반영 사양 (572:462):
 *  · 트리거 버튼 (Figma 572:474):
 *      padding 10px 20px / gap 8px / border-radius 100px / 투명 배경
 *      └ 좌측: 아이콘 24px (zoom 모양, Frame48096294) + gap 4px + 텍스트 "자원 예약"
 *      └ 텍스트: Pretendard Regular 15px / leading 1.25 / color #2F394A
 *      └ 우측: keyboard_arrow_down 20px
 *  · 드롭다운 메뉴 (Figma 572:508):
 *      width 200px / border-radius 16px / 배경 #FFFFFF / shadow
 *      절대 위치 (트리거 버튼 아래)
 *  · 각 메뉴 항목 (Figma 572:509/515/539):
 *      padding 10px 12px / 하단 border #F9FCFF 1px / overflow-clip
 *      아이콘 24px + gap 6px + 텍스트 14px (#111, leading 1.5, tracking 0.14px)
 *      메뉴 3종 순서: ZOOM 예약 → 포인터 대여 → 도서 대여
 *
 * Props:
 *  - dark    : 다크 모드 (현재 라이트 모드 기준 디자인)
 */

import { useState, useEffect, useRef } from 'react'

interface ResourceDropdownProps {
  dark: boolean;
}

// ── 아이콘 SVG (사용자 제공 1:1) ───────────────────────────────────────────────
// zoom.svg: ZOOM 예약 + 자원 예약 트리거 (Figma Frame48096294 동일 노드)
const IcoZoom = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <mask id="path-1-inside-1_zoom" fill="white">
      <path d="M15.0898 6.05469C15.366 6.05469 15.5898 6.27855 15.5898 6.55469V9.5498L19.2168 7.05762C19.5486 6.82959 20 7.06723 20 7.46973V16.5264C19.9998 16.9287 19.5485 17.1663 19.2168 16.9385L15.5898 14.4453V17.9404H4.2041C3.92796 17.9404 3.7041 17.7166 3.7041 17.4404V6.55469C3.7041 6.27855 3.92796 6.05469 4.2041 6.05469H15.0898Z"/>
    </mask>
    <path d="M15.5898 9.5498H14.5898V11.4503L16.1562 10.374L15.5898 9.5498ZM19.2168 7.05762L19.7831 7.8818L19.7831 7.88178L19.2168 7.05762ZM20 7.46973H21V7.46973L20 7.46973ZM20 16.5264L21 16.5269V16.5264H20ZM19.2168 16.9385L18.6503 17.7626L18.6507 17.7628L19.2168 16.9385ZM15.5898 14.4453L16.1563 13.6212L14.5898 12.5444V14.4453H15.5898ZM15.5898 17.9404V18.9404H16.5898V17.9404H15.5898ZM4.2041 6.05469V5.05469H4.2041L4.2041 6.05469ZM15.0898 6.05469V7.05469C14.8137 7.05469 14.5898 6.83083 14.5898 6.55469H15.5898H16.5898C16.5898 5.72626 15.9183 5.05469 15.0898 5.05469V6.05469ZM15.5898 6.55469H14.5898V9.5498H15.5898H16.5898V6.55469H15.5898ZM15.5898 9.5498L16.1562 10.374L19.7831 7.8818L19.2168 7.05762L18.6505 6.23343L15.0235 8.72562L15.5898 9.5498ZM19.2168 7.05762L19.7831 7.88178C19.4512 8.10987 19 7.87205 19 7.46973L20 7.46973L21 7.46973C21 6.2624 19.646 5.54932 18.6504 6.23345L19.2168 7.05762ZM20 7.46973H19V16.5264H20H21V7.46973H20ZM20 16.5264L19 16.5258C19.0002 16.1242 19.4506 15.8859 19.7829 16.1142L19.2168 16.9385L18.6507 17.7628C19.6464 18.4467 20.9994 17.7331 21 16.5269L20 16.5264ZM19.2168 16.9385L19.7833 16.1144L16.1563 13.6212L15.5898 14.4453L15.0234 15.2694L18.6503 17.7626L19.2168 16.9385ZM15.5898 14.4453H14.5898V17.9404H15.5898H16.5898V14.4453H15.5898ZM15.5898 17.9404V16.9404H4.2041V17.9404V18.9404H15.5898V17.9404ZM4.2041 17.9404V16.9404C4.48024 16.9404 4.7041 17.1643 4.7041 17.4404H3.7041H2.7041C2.7041 18.2689 3.37567 18.9404 4.2041 18.9404V17.9404ZM3.7041 17.4404H4.7041V6.55469H3.7041H2.7041V17.4404H3.7041ZM3.7041 6.55469H4.7041C4.7041 6.83083 4.48024 7.05469 4.2041 7.05469L4.2041 6.05469L4.2041 5.05469C3.37567 5.05469 2.7041 5.72626 2.7041 6.55469H3.7041ZM4.2041 6.05469V7.05469H15.0898V6.05469V5.05469H4.2041V6.05469Z" fill="#1C1B1F" mask="url(#path-1-inside-1_zoom)"/>
  </svg>
)

// pointer.svg: 포인터 대여 (그라데이션 포함) [2026-05-13 v9] 사용자 제공 새 SVG로 교체
const IcoPointer = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M21.9873 6.71281C20.8089 4.67186 19.1141 2.97704 17.0732 1.79869C15.0322 0.620348 12.717 2.9302e-07 10.3604 0L10.3604 13.4256L21.9873 6.71281Z" fill="url(#paint0_lin_resource_pointer)"/>
    <path d="M11.0554 6.85101L15.7061 9.53614L13.3567 13.6056L7.65077 23.4885L3 20.8033L8.70589 10.9204L11.0554 6.85101Z" fill="white"/>
    <path d="M15.7061 9.53614L7.65077 23.4885L3 20.8033L11.0554 6.85101L15.7061 9.53614ZM9.82179 10.9876L12.7404 12.6727L14.34 9.9021L11.4214 8.21704L9.82179 10.9876ZM4.36623 20.437L7.28483 22.122L12.2404 13.5387L9.32179 11.8537L4.36623 20.437Z" fill="black"/>
    <defs>
      <linearGradient id="paint0_lin_resource_pointer" x1="16.6857" y1="2.46997" x2="3.64759" y2="25.0526" gradientUnits="userSpaceOnUse">
        <stop stopColor="#737373" stopOpacity="0"/>
        <stop offset="0.560639" stopColor="#D9D9D9"/>
      </linearGradient>
    </defs>
  </svg>
)

// book_4.svg: 도서 대여
const IcoBook = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <mask id="mask0_book_resource" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
      <rect width="24" height="24" fill="#D9D9D9"/>
    </mask>
    <g mask="url(#mask0_book_resource)">
      <path d="M6.23075 21C5.61108 21 5.08442 20.7868 4.65075 20.3605C4.21692 19.9343 4 19.4167 4 18.8077V5.23075C4 4.61108 4.21692 4.08442 4.65075 3.65075C5.08442 3.21692 5.61108 3 6.23075 3H16.6155V17.6155H6.23075C5.89608 17.6155 5.60733 17.7294 5.3645 17.9572C5.1215 18.1851 5 18.4674 5 18.8042C5 19.1411 5.1215 19.4246 5.3645 19.6548C5.60733 19.8849 5.89608 20 6.23075 20H19V5H20V21H6.23075ZM8.3845 16.6155H15.6155V4H8.3845V16.6155ZM7.3845 16.6155V4H6.23075C5.88208 4 5.58975 4.1215 5.35375 4.3645C5.11792 4.60733 5 4.89608 5 5.23075V17.0212C5.1795 16.9071 5.37075 16.8109 5.57375 16.7327C5.77675 16.6546 5.99575 16.6155 6.23075 16.6155H7.3845Z" fill="#1C1B1F"/>
    </g>
  </svg>
)

// keyboard_arrow_down: 트리거 버튼 내부에 직접 인라인 SVG로 작성 (open 상태에 따라 rotate)
// [2026-05-13 v8] 인라인 컴포넌트 제거 — open 상태 동적 활용 위해 트리거 JSX 내부로 이동
//   참고 SegmentTabBar L153~156 (전체 회의실 드롭다운과 동일 이펙트)

export function ResourceDropdown({ dark }: ResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)                                  // ← [2026-05-13 v11] hover 배경 변화 (마우스 + 터치 통합)
  const [iconIdx, setIconIdx] = useState(0)                                  // ← [2026-05-13 v11] 좌측 아이콘 교차 (0:zoom 1:pointer 2:book)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 드롭다운 닫기 (자기완결적)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // ── [2026-05-13 v11] 좌측 아이콘 자동 교차 (4초 주기) ──
  //   · 드롭다운 열림 중에는 멈춤 (현재 표시 아이콘 고정 → 메뉴와 시각적 일관성)
  //   · setInterval 1개만 사용 (cleanup 자동)
  useEffect(() => {
    if (open) return                                                          // 드롭다운 열림 중에는 일시정지
    const id = window.setInterval(() => {
      setIconIdx(i => (i + 1) % 3)
    }, 4000)
    return () => window.clearInterval(id)
  }, [open])

  // 메뉴 항목 정의 — 기능은 추후 구현 (onClick 미연결, e.preventDefault)
  const MENU_ITEMS: { key: string; icon: JSX.Element; label: string }[] = [
    { key: 'zoom',    icon: <IcoZoom />,    label: 'ZOOM 예약' },
    { key: 'pointer', icon: <IcoPointer />, label: '포인터 대여' },
    { key: 'book',    icon: <IcoBook />,    label: '도서 대여' },
  ]

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0, opacity: 1 }}>  {/* ← [2026-05-13 v10] opacity 0.35 → 1 (100%, 시각적 비활성화 해제) - 기능은 여전히 onClick 미연결 */}
      {/* 트리거 버튼 — Figma 572:474 1:1 ([2026-05-13 v11]) */}
      <button
        className="btn"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setHover(true)}                                   /* ← [v11] hover 배경 */
        onMouseLeave={() => setHover(false)}
        onTouchStart={() => setHover(true)}                                   /* ← [v11] 터치 시작 - 모바일 active 효과 */
        onTouchEnd={() => setHover(false)}
        onTouchCancel={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8,
          padding: '10px 12px 10px 16px',                                     /* ← [v11] Figma 1:1: pl-16 pr-12 py-10 (비대칭, 좌측 아이콘 24px 시각 무게 보정) */
          borderRadius: 100, border: 'none',
          background: (open || hover) ? '#F5F9FF' : 'transparent',             /* ← [v12] open 상태에서도 hover와 동일 배경 유지 (사용자 피드백) / [v11] hover/touch 시 #F5F9FF */
          transition: 'background 0.18s ease',                                 /* ← [v11] 부드러운 전환 */
          cursor: 'pointer',
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {/* 좌측: 아이콘(교차 슬롯) + 라벨 (gap 4) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* ── [v11] 아이콘 교차 슬롯 ──
              · 24×24 고정 컨테이너에 3개 SVG를 position:absolute로 겹쳐 둠
              · active 1개만 opacity 1 + scale 1, 나머지는 opacity 0 + scale 0.4
              · transition 0.5s cubic-bezier로 스케일+페이드 효과 */}
          <div style={{ position: 'relative', width: 24, height: 24, flexShrink: 0 }}>
            {[<IcoZoom key="z" />, <IcoPointer key="p" />, <IcoBook key="b" />].map((ico, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute', top: 0, left: 0, width: 24, height: 24,
                  opacity: iconIdx === i ? 1 : 0,
                  transform: iconIdx === i ? 'scale(1)' : 'scale(0.4)',
                  transition: 'opacity 0.5s ease, transform 0.5s cubic-bezier(0.4,0,0.2,1)',
                  willChange: 'opacity, transform',
                }}
                aria-hidden={iconIdx !== i}
              >
                {ico}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
            <span style={{
              fontSize: 15, fontWeight: 400, lineHeight: 1.25,
              color: dark ? '#E2E8F0' : '#2F394A',
              whiteSpace: 'nowrap',
              fontFamily: "'Pretendard', -apple-system, sans-serif",
              userSelect: 'none',
            }}>자원 예약</span>
          </div>
        </div>
        {/* 우측: 아래 화살표 — [2026-05-13 v8] SegmentTabBar(전체 회의실)와 동일 이펙트 1:1
            (path/fill #D0D0D0 / transition transform 0.2s / open 시 rotate 180deg) */}
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M10.25 12.5625L6 8.3125L6.3125 8L10.25 11.9375L14.1875 8L14.5 8.3125L10.25 12.5625Z" fill="#D0D0D0"/>
        </svg>
      </button>

      {/* 드롭다운 메뉴 — Figma 572:508 */}
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            width: 200,
            background: '#FFFFFF',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',  // ← 시각적 분리용 (Figma에서 미세 그림자)
            display: 'flex', flexDirection: 'column',
            zIndex: 9999,
          }}
        >
          {MENU_ITEMS.map((item, i) => {
            const isLast = i === MENU_ITEMS.length - 1
            return (
              <div
                key={item.key}
                role="menuitem"
                aria-disabled="true"                                   /* ← 기능 미작동 명시 */
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  padding: '10px 12px',
                  borderBottom: isLast ? 'none' : '1px solid #F9FCFF', /* Figma 1:1 */
                  overflow: 'hidden',
                  cursor: 'default',                                    /* ← 기능 비활성화 - 손가락 커서 X */
                }}
                /* ⚠️ onClick 미연결 — 추후 기능 구현 시 연결 */
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {item.icon}
                  <span style={{
                    fontSize: 14, fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.14px',
                    color: '#111',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    fontFamily: "'Pretendard', -apple-system, sans-serif",
                    userSelect: 'none',
                  }}>{item.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
