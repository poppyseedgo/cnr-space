/**
 * AdminSideNav — Admin 페이지 좌측 사이드 네비게이션
 *
 * ✅ 변경 이력
 *  - [2026-05-11 Phase 1] 아이콘 7종 추가 + 비활성 메뉴 2개 추가 (Figma node 541:3559 1:1)
 *    · 아이콘: insert_chart / check_circle / schedule / account_circle / dual_screen
 *              / asterisk / books (Material Symbols, 사용자 제공 SVG 1:1)
 *    · 비활성 신규 메뉴: 자원 관리 (asterisk) / 도서 관리 (books)
 *      → AdminTabId에는 미포함, 클릭 시 onTabChange 호출 안 됨, cursor not-allowed
 *    · 색상 보정 (Figma 1:1):
 *        - 비활성(클릭 가능) text: #657487 → #697077
 *        - 비활성(준비중) text:    #cdd3da
 *        - hover 배경: #FAFBFC → #F5F7F9 (page bg와 1단계 위로, Figma 토큰 정합)
 *    · padding 조정: '16px 20px' → '12px 20px' (24px 아이콘 + 12+12 = 48 = Figma h_48)
 *    · height 48 명시 (Figma 사양 보장, 컨텐츠 변화에도 흔들리지 않음)
 *    · 아이콘 ↔ 라벨 gap: 8 (Figma)
 *
 *  - [2026-05-06 Admin Phase A] 신규 생성 — Figma node 451:3522 1:1 반영
 *
 * 📌 Figma 사양 (node 541:3559)
 *  · 컨테이너: bg transparent (사용자 요청 유지) / flex column / gap 8 / width 160
 *  · 메뉴 항목 7개 (5 활성 + 2 비활성):
 *    - 활성 5: 대시보드 / 승인 관리 / 예약 관리 / 사용자 관리 / 회의실 관리
 *    - 비활성 2: 자원 관리 / 도서 관리 (text #cdd3da, cursor not-allowed)
 *  · 항목 스타일:
 *    - width 100% / height 48 / padding 12 20 (※ 아이콘 24 포함하여 정확히 48)
 *    - radius 9999 (pill) / 아이콘-라벨 gap 8
 *    - font Pretendard Medium 16 / line-height 16
 *    - 활성: bg #111 / text #fff (아이콘도 currentColor → 흰색)
 *    - 비활성(클릭): bg #fff / text #697077 (아이콘도 currentColor → #697077)
 *    - 비활성(준비중): bg #fff / text #cdd3da (아이콘도 currentColor → #cdd3da)
 *  · dot 4×4 (활성과 독립):
 *    - pendingCount > 0일 때 항목 라벨 옆 표시 (label + dot 가로 배치 / gap 2)
 *    - 현재 승인 관리에서만 사용
 *
 * 📌 타입 설계
 *  · AdminTabId (export, 5개): 실제 라우팅 가능한 탭만 — 외부 import 영향 0
 *  · MenuId (내부): AdminTabId | 'resources' | 'books' — 메뉴 정의용
 *  · 비활성 항목 클릭 시 onTabChange 미호출 → 라우팅 안전 (setTab 절대 비활성 id 못 받음)
 *
 * 📌 사용처
 *  - AdminPage 외곽 wrapper (Phase A 통합)
 *  - props로 activeTab, onTabChange, pendingCount 전달 받음
 */

import type { CSSProperties, ReactNode } from 'react'
import {
  InsertChartIcon,
  CheckCircleIcon,
  ScheduleIcon,
  AccountCircleIcon,
  DualScreenIcon,
  AsteriskIcon,
  BooksIcon,
  VisitorLogIcon,   // ← [2026-07-10] 방문 기록 메뉴 아이콘
  BellIcon,         // ← [2026-07-23] 알림 설정 메뉴 아이콘
  CampaignIcon,     // ← [2026-07-24] 공지 배너 메뉴 아이콘
  SmartToyIcon,     // ← [2026-07-27] KB 관리 메뉴 아이콘 (GA 챗봇 지식베이스)
  TvIcon,           // ← [2026-09-08] CANTEEN DP 메뉴 아이콘 (로비 디스플레이)
} from '../icons/AdminMenuIcons'

// ─── 활성 탭 ID (외부 export — 라우팅용) ────────────────────────────────────
//   ※ AdminPage.tsx의 TABS 배열·setTab과 동기화. 비활성 메뉴는 여기 포함 안 됨.
export type AdminTabId = 'dashboard' | 'approvals' | 'bookings' | 'users' | 'rooms' | 'visitors'
  | 'books'          // ← [2026-07-23] 도서 관리 활성화 (전사 오픈 후 어드민 개설)
  | 'notifications'  // ← [2026-07-23] 알림 설정 (채널 on/off + 관리자 수신자 지정)
  | 'notices'        // ← [2026-07-24] 공지 배너 (헤더 상단 한 줄 배너 관리)
  | 'kb'             // ← [2026-07-27] KB 관리 (GA 챗봇 지식베이스 kb_chunks 편집)
  | 'resources'      // ← [2026-08-19] 자원 관리 활성화 (Phase 3 — 2026-05-11 비활성 예고 자리)
  | 'canteen-dp'     // ← [2026-09-08] CANTEEN DP — 로비 디스플레이 공지 관리 (notice 역할 공유)

// ─── 메뉴 ID (내부 전용) ─────────────────────────────────────────────────────
//   · [2026-07-23] 도서 관리가 활성으로 전환되어 비활성은 'resources' 1개만 남았다.
//   · 비활성 id는 onTabChange로 절대 전달 안 됨 (disabled guard)
type MenuId = AdminTabId  // ← [2026-08-19] resources 활성화로 비활성 전용 id 소멸 — AdminTabId 와 동일

// ─── 메뉴 정의 (Figma 순서) ──────────────────────────────────────────────────
//   disabled: true → 클릭 무효, cursor not-allowed, text #cdd3da
interface MenuItem {
  id:        MenuId
  label:     string
  icon:      ReactNode
  disabled?: boolean
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'dashboard', label: '대시보드',    icon: <InsertChartIcon  /> },
  { id: 'approvals', label: '승인 관리',   icon: <CheckCircleIcon  /> },
  { id: 'bookings',  label: '예약 관리',   icon: <ScheduleIcon     /> },
  { id: 'users',     label: '사용자 관리', icon: <AccountCircleIcon/> },
  { id: 'rooms',     label: '회의실 관리', icon: <DualScreenIcon   /> },
  { id: 'visitors',  label: '방문 기록',   icon: <VisitorLogIcon   /> },  // ← [2026-07-10] 방문로그 관리
  // ← [2026-07-23] 도서 서비스 전사 오픈에 따라 활성화
  { id: 'books',     label: '도서 관리',   icon: <BooksIcon        /> },
  // ← [2026-07-23] 알림 설정 — 회의실·도서 전 알림의 채널 on/off 와 관리자 수신자 지정
  { id: 'notifications', label: '알림 설정', icon: <BellIcon       /> },
  // ← [2026-07-24] 공지 배너 — 헤더 상단 한 줄 배너(내용·색·게시기간)
  { id: 'notices',       label: '공지 배너', icon: <CampaignIcon   /> },
  // ← [2026-09-08] CANTEEN DP — 로비 디스플레이(쇼츠+공지 슬라이드) 이미지/GIF 관리. notice 역할 공유
  { id: 'canteen-dp',    label: 'CANTEEN DP', icon: <TvIcon        /> },
  // ← [2026-07-27] KB 관리 — GA 챗봇 지식베이스(kb_chunks) 청크 편집·JSON 내보내기
  { id: 'kb',            label: 'KB 관리',   icon: <SmartToyIcon   /> },
  // ← [2026-08-19] 자원 관리 활성화 (Phase 3) — 2026-05-11 비활성 예고 자리 그대로 오픈
  { id: 'resources', label: '자원 관리',   icon: <AsteriskIcon     /> },
]

// ─── Props ───────────────────────────────────────────────────────────────────
interface AdminSideNavProps {
  /** 현재 활성 탭 id */
  activeTab:    AdminTabId
  /** 탭 변경 콜백 — 활성 메뉴(AdminTabId)만 전달됨, 비활성은 호출 안 됨 */
  onTabChange:  (id: AdminTabId) => void
  /** 승인 대기 건수 — > 0 시 '승인 관리' 옆 dot 표시 */
  pendingCount: number
  /**
   * 표시할 탭 목록 (← [2026-07-24] 관리자 권한 Phase 1)
   *
   *   내 역할로 볼 수 있는 탭만 넘어온다. undefined 면 전부 표시(로딩 중·구버전 호출부).
   *   비활성 메뉴(resources 등)는 기존대로 disabled 로 남는다 — '권한이 없어서'와
   *   '아직 안 만들어서'는 다른 상태이므로 같은 방식으로 감추면 안 된다.
   */
  allowedTabs?: string[]
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AdminSideNav({ activeTab, onTabChange, pendingCount, allowedTabs }: AdminSideNavProps) {
  return (
    <nav
      role="navigation"
      aria-label="Admin 메뉴"
      style={{
        // ─── Figma 컨테이너 ───────────────────────────────────────
        background:   'transparent',          // ← [2026-05-06 사용자 요청] #F3F4F8 → transparent (유지)
        display:      'flex',
        flexDirection:'column',
        alignItems:   'flex-start',
        gap:          8,                       // ← Figma: gap 8
        width:        '100%',
      }}>
      {MENU_ITEMS.filter(item => !allowedTabs || item.disabled || allowedTabs.includes(item.id)).map(item => {
        const isDisabled = item.disabled === true                          // ← [2026-05-11] 비활성 가드
        const isActive   = !isDisabled && activeTab === item.id            // ← 비활성은 active 될 수 없음
        const showDot    = item.id === 'approvals' && pendingCount > 0     // ← 승인 관리만 dot

        return (
          <button
            key={item.id}
            type="button"
            // ─── [2026-05-11] 비활성 클릭 차단 ─────────────────────────
            //   · onClick 콜백 자체 미할당 → onTabChange 절대 호출 안 됨
            //   · disabled 속성 + aria-disabled — 접근성 + 키보드 포커스 차단
            onClick={isDisabled ? undefined : () => onTabChange(item.id as AdminTabId)}
            disabled={isDisabled}
            aria-disabled={isDisabled || undefined}
            aria-current={isActive ? 'page' : undefined}
            style={menuBtnStyle(isActive, isDisabled)}
            // ─── hover: 비활성/활성 외에만 ────────────────────────────
            onMouseEnter={e => {
              if (isDisabled || isActive) return
              ;(e.currentTarget as HTMLButtonElement).style.background = '#F5F7F9'  // ← page bg와 정합
            }}
            onMouseLeave={e => {
              if (isDisabled || isActive) return
              ;(e.currentTarget as HTMLButtonElement).style.background = '#fff'
            }}>
            {/* ── icon (24×24) + label container (gap 8 = Figma) ── */}
            <span style={{
              display:    'inline-flex',
              alignItems: 'center',
              gap:        8,                  // ← Figma: 아이콘-라벨 gap 8
              minWidth:   0,
            }}>
              {/* 아이콘 — fill="currentColor" 라 button color 그대로 흐름 */}
              <span style={{
                width:      24,
                height:     24,
                flexShrink: 0,
                display:    'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 0,                // ← SVG line-height 잔여 영역 제거
              }}>
                {item.icon}
              </span>

              {/* label + dot 가로 배치 (Figma node 466:1234 — gap 2) */}
              <span style={{
                display:    'inline-flex',
                alignItems: 'flex-start',
                gap:        2,                // ← Figma: label-dot gap 2
                minWidth:   0,
              }}>
                <span style={{
                  fontFamily: "'Pretendard', -apple-system, sans-serif",
                  fontWeight: 500,
                  fontSize:   16,
                  lineHeight: '16px',
                  whiteSpace: 'nowrap',
                  overflow:   'hidden',
                  textOverflow: 'ellipsis',
                }}>{item.label}</span>
                {showDot && (
                  <span aria-label={`${pendingCount}건 처리 대기`} style={{
                    width:        4,
                    height:       4,
                    borderRadius: '50%',
                    background:   '#FF5C5C',
                    flexShrink:   0,
                    marginTop:    2,
                  }}/>
                )}
              </span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

// ─── 메뉴 버튼 스타일 (활성/비활성/disabled) ─────────────────────────────────
//   ← [2026-05-11] 변경
//      · padding-y: 16 → 12 (24 아이콘 + 12+12 = 48 = Figma h_48 정확)
//      · height: 48 명시 (사양 보장)
//      · 비활성 text 색상: #657487 → #697077 (Figma 1:1)
//      · disabled: cursor not-allowed + text #cdd3da
function menuBtnStyle(isActive: boolean, isDisabled: boolean): CSSProperties {
  return {
    width:        '100%',
    height:       48,                        // ← Figma: h_48 명시 (아이콘 24 + py 12 = 48)
    padding:      '12px 20px',               // ← Figma: py 12 px 20 (※ 24 아이콘 포함)
    borderRadius: 9999,                      // ← Figma: rounded full
    border:       'none',
    cursor:       isDisabled ? 'not-allowed' : 'pointer',
    textAlign:    'left',
    display:      'flex',
    alignItems:   'center',
    overflow:     'hidden',
    transition:   'background 0.15s, color 0.15s',
    // 상태별 색상
    background:   isActive ? '#111' : '#fff',
    color:        isActive   ? '#fff'
                : isDisabled ? '#cdd3da'      // ← Figma: 준비중 #cdd3da
                :              '#697077',     // ← Figma: 클릭 가능 비활성 #697077 (보정)
  }
}
