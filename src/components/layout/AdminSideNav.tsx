/**
 * AdminSideNav — Admin 페이지 좌측 사이드 네비게이션
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase A] 신규 생성 — Figma node 451:3522 1:1 반영
 *
 * 📌 Figma 사양 (node 451:3522 / 451:3523~451:3533)
 *  · 컨테이너: bg #F3F4F8 / flex column / gap 8 / width 160 (외부 지정)
 *  · 메뉴 항목 5개:
 *    - 대시보드 / 승인 관리 / 예약 관리 / 사용자 관리 / 회의실 관리
 *  · 항목 스타일:
 *    - width 100% / height 48 / padding 16 20 / radius 9999 (pill)
 *    - font Pretendard Medium 16 / line-height 16
 *    - 비활성: bg #fff / text #657487
 *    - 활성: bg #111 / text #fff
 *  · dot 4×4 (활성과 독립):
 *    - pendingCount > 0일 때 항목 라벨 옆 표시 (label + dot 가로 배치 / gap 2)
 *    - "처리할 항목 있음" 알림 표시 — 현재 승인 관리에서만 사용
 *
 * 📌 사용처
 *  - AdminPage 외곽 wrapper (Phase A 통합)
 *  - props로 activeTab, onTabChange, pendingCount 전달 받음
 */

import type { CSSProperties } from 'react'

// ─── 메뉴 정의 (Figma 순서) ──────────────────────────────────────────────────
//   id는 기존 AdminPage activeTab과 동일 ('dashboard'/'approvals'/'bookings'/'users'/'rooms')
export type AdminTabId = 'dashboard' | 'approvals' | 'bookings' | 'users' | 'rooms'

const MENU_ITEMS: Array<{ id: AdminTabId; label: string }> = [
  { id: 'dashboard',  label: '대시보드' },
  { id: 'approvals',  label: '승인 관리' },
  { id: 'bookings',   label: '예약 관리' },
  { id: 'users',      label: '사용자 관리' },
  { id: 'rooms',      label: '회의실 관리' },
]

// ─── Props ───────────────────────────────────────────────────────────────────
interface AdminSideNavProps {
  /** 현재 활성 탭 id */
  activeTab:    AdminTabId
  /** 탭 변경 콜백 */
  onTabChange:  (id: AdminTabId) => void
  /** 승인 대기 건수 — > 0 시 '승인 관리' 옆 dot 표시 */
  pendingCount: number
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AdminSideNav({ activeTab, onTabChange, pendingCount }: AdminSideNavProps) {
  return (
    <nav
      role="navigation"
      aria-label="Admin 메뉴"
      style={{
        // ─── Figma 컨테이너 ───────────────────────────────────────
        background:   '#F3F4F8',                      // ← Figma: bg #F3F4F8
        display:      'flex',
        flexDirection:'column',
        alignItems:   'flex-start',
        gap:          8,                               // ← Figma: gap 8
        // 외부 width는 부모(AdminPage wrapper)에서 160 지정. 자체는 100% 채움
        width:        '100%',
      }}>
      {MENU_ITEMS.map(item => {
        const isActive = activeTab === item.id
        // dot 표시 조건: 승인 관리 항목 + pendingCount > 0
        //   (Figma 디자인은 승인 관리에만 dot 적용 → 다른 항목은 dot 없음)
        const showDot  = item.id === 'approvals' && pendingCount > 0
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            aria-current={isActive ? 'page' : undefined}
            style={menuBtnStyle(isActive)}
            onMouseEnter={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#FAFBFC'
            }}
            onMouseLeave={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#fff'
            }}>
            {/* label + dot 가로 배치 (Figma node 466:1234 — gap 2) */}
            <span style={{
              display:    'inline-flex',
              alignItems: 'flex-start',
              gap:        2,                            // ← Figma: gap 2
            }}>
              <span style={{
                // ← Figma: Pretendard Medium 16 / leading 1.2 / nowrap
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                fontWeight: 500,
                fontSize:   16,
                lineHeight: '16px',
                whiteSpace: 'nowrap',
                overflow:   'hidden',
                textOverflow: 'ellipsis',
              }}>{item.label}</span>
              {showDot && (
                // ← Figma: 4×4 ellipse, 위치는 라벨 옆 위쪽 (gap 2 기준)
                //   알림 dot 색상: 빨강(#FF5C5C) — 처리 대기 = 주의 환기
                <span aria-label={`${pendingCount}건 처리 대기`} style={{
                  width:        4,
                  height:       4,
                  borderRadius: '50%',
                  background:   '#FF5C5C',
                  flexShrink:   0,
                  marginTop:    2,                      // ← 라벨 baseline에 맞춰 살짝 내림
                }}/>
              )}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ─── 메뉴 버튼 스타일 (활성/비활성) ───────────────────────────────────────
function menuBtnStyle(isActive: boolean): CSSProperties {
  return {
    // ── Figma 1:1 ─────────────────────────────────────────
    width:        '100%',
    padding:      '16px 20px',                   // ← Figma: py 16 px 20
    borderRadius: 9999,                          // ← Figma: rounded full
    border:       'none',
    cursor:       'pointer',
    textAlign:    'left',
    display:      'flex',
    alignItems:   'center',
    overflow:     'hidden',
    transition:   'background 0.15s, color 0.15s',
    // ── 상태별 ───────────────────────────────────────────
    background:   isActive ? '#111' : '#fff',
    color:        isActive ? '#fff' : '#657487',
  }
}
