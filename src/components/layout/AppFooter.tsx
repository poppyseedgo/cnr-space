/**
 * AppFooter.tsx — 서비스 사이트맵 푸터 (Figma 3134:986 전면 재작성)
 *
 * ✅ 변경 이력
 *  - [2026-10-06 ADMIN-GATE] '관리자 페이지' 링크를 관리자(isAdmin)에게만 노출
 *      · 8/20 재작성 때 권한 조건 없이 전 직원에게 노출돼 일반 사용자가 어드민 화면에 진입한 경로(10/6 사고)
 *      · isAdmin prop 신설 — ProfileDropdown·AppDrawer 의 관리자 메뉴와 같은 기준(profiles.role='ADMIN')
 *      · 관리자 화면은 변화 없음. 일반 사용자는 '기타 서비스' 에 공지사항·Release Note 2개만 보인다
 *  - [2026-07-30] 최초 작성 (서비스 나열형)
 *  - [2026-08-19] sticky footer 대응 — marginTop 160 제거 (간격은 App 스페이서 단일 책임)
 *  - [2026-08-19] Figma 3134:986 신규 디자인 전면 재작성 (고지 확정, 미리보기 승인)
 *      · 좌: C&R SPACE 워드마크 + 담당자 블록 (라벨 #75C1FF / 이름 #111, 14px)
 *      · 우: SPACE 헤더(Instrument Sans Medium 28px + arrow_outward 32px ↘=rotate90)
 *            섹션 행 — 라벨 Pretendard Medium 20px w200 · 링크 Regular 16px, gap 64,
 *            행 py24 pr24 border-b #EFF4FF, 링크 세로 gap 20,
 *            회의실·자원 묶음 ↔ 마이페이지·도서 묶음 사이 gap 32 (Figma 3143:7700)
 *      · C&R Chatbot 행 — Instrument Sans Medium 20px + arrow_outward 24px ↗,
 *            링크 미정: 회색 처리 + '예정' 라벨 (고지 확정)
 *      · 마이페이지 하위 4링크는 탭 정확 이동 — onGoMyPage(tab) 신설
 *        (노쇼 현황은 마이페이지 상단 노쇼 카드가 첫 화면이라 room 탭으로 이동)
 *      · 기존 카피라이트 행·CNR ESG 외부 링크는 새 디자인에 없어 제거
 *      · Instrument Sans 는 index.html 에서 로드 (400/500)
 */

import type { CSSProperties } from 'react'

const FONT    = "'Pretendard', -apple-system, sans-serif"
const FONT_EN = "'Instrument Sans', 'Pretendard', sans-serif"
const DIVIDER = '1px solid #EFF4FF'
const LABEL_BLUE = '#75C1FF'

/* arrow_outward — Figma 원본 SVG (Material). 32px 헤더용은 rotate(90deg)로 ↘ */
function IcoArrowOutward({ size }: { size: number }) {
  return size >= 32 ? (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M8.25133 23.0513L7.33333 22.1333L20.7743 8.66667H8.38467V7.33333H23.0513V22H21.718V9.61033L8.25133 23.0513Z" fill="#1C1B1F" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6.18848 17.2884L5.49998 16.5999L15.5807 6.49994H6.28848V5.49994H17.2885V16.4999H16.2885V7.20769L6.18848 17.2884Z" fill="#1C1B1F" />
    </svg>
  )
}

interface AppFooterProps {
  isMobile:   boolean
  /** ← [2026-10-06 ADMIN-GATE] 관리자 여부 — '관리자 페이지' 링크 노출 조건 */
  isAdmin:    boolean
  onSetView:  (v: string) => void
  /** 마이페이지 특정 탭으로 이동 (노쇼/회의실=room · 자원=resource · 도서=book) */
  onGoMyPage: (tab: 'room' | 'book' | 'resource') => void
}

interface FooterLink { label: string; go: () => void }
interface FooterSection { title: string; links: FooterLink[] }

export function AppFooter({ isMobile, isAdmin, onSetView, onGoMyPage }: AppFooterProps) {  // ← [2026-10-06 ADMIN-GATE] isAdmin 추가
  /* 담당자 블록 — Figma 3136:7675~ */
  const CONTACTS: { role: string; names: string[] }[] = [
    { role: 'Super Admin',              names: ['김기남', '송보람'] },
    { role: '사용 기능 및 노쇼 해제 관련 문의', names: ['고현정'] },   // ← [2026-08-20] Figma 문구 갱신 ('해제' 추가)
    { role: '에메랄드룸 예약 승인',        names: ['김수빈', '송지나'] },
    { role: '도서 관리',                 names: ['박찬희'] },
  ]

  /* 섹션 정의 — 링크는 SPA 뷰 이동 (onSetView / onGoMyPage) */
  const GROUP_1: FooterSection[] = [
    { title: '회의실 실시간 예약', links: [
      { label: '회의실 실시간 현황', go: () => onSetView('home') },
      { label: '캘린더 타임라인 뷰', go: () => onSetView('calendar') },
    ]},
    { title: '자원 예약', links: [
      { label: '포인터 예약',    go: () => onSetView('resources') },
      { label: '기타 자원 예약', go: () => onSetView('resources') },
    ]},
  ]
  const GROUP_2: FooterSection[] = [
    // ← [2026-08-20] Figma 갱신 — 도서예약이 마이 페이지 앞 (3143:7699 순서)
    { title: '도서예약', links: [
      { label: '이 달의 신규 도서', go: () => onSetView('library') },
    ]},
    { title: '마이 페이지', links: [
      { label: '노쇼 현황',        go: () => onGoMyPage('room') },     // 상단 노쇼 카드가 첫 화면
      { label: '회의실 예약 현황', go: () => onGoMyPage('room') },
      { label: '자원 예약 현황',   go: () => onGoMyPage('resource') },
      { label: '도서 예약 현황',   go: () => onGoMyPage('book') },
    ]},
  ]
  const ETC: FooterSection = {
    title: '기타 서비스', links: [
      { label: '공지사항',      go: () => onSetView('announcements') },
      { label: 'Release Note',  go: () => onSetView('release-notes') },
      ...(isAdmin ? [{ label: '관리자 페이지', go: () => onSetView('admin') }] : []),  // ← [2026-10-06 ADMIN-GATE] 관리자에게만 노출
    ],
  }

  const linkBtn: CSSProperties = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: FONT, fontSize: 16, fontWeight: 400, lineHeight: 1.2, color: '#111',
    // ↑ fontWeight 400 명시 — 전역 .btn 이 600 을 강제해 링크가 두껍게 렌더되던 문제 정정 (Figma Regular)
    width: 280, textAlign: 'left',
  }
  const sectionTitle: CSSProperties = {
    fontFamily: FONT, fontSize: 20, fontWeight: 500, lineHeight: 1.2, color: '#111',
    width: isMobile ? 'auto' : 200, flexShrink: 0, margin: 0,
  }
  const row: CSSProperties = {
    display: 'flex', flexDirection: isMobile ? 'column' : 'row',
    gap: isMobile ? 12 : 64, alignItems: 'flex-start',
    padding: '24px 24px 24px 0', borderBottom: DIVIDER, width: '100%',
    boxSizing: 'border-box',
  }

  const renderSection = (sec: FooterSection) => (
    <div key={sec.title} style={row}>
      <p style={sectionTitle}>{sec.title}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {sec.links.map(l => (
          <button key={l.label} className="btn" style={linkBtn} onClick={l.go}>{l.label}</button>
        ))}
      </div>
    </div>
  )

  return (
    <footer style={{ background: '#FFFFFF', borderTop: DIVIDER }}>
      <div style={{
        padding: isMobile ? '32px 20px 48px' : '32px 32px 48px',
        display: 'flex', flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 40 : 100, alignItems: 'flex-start',
        maxWidth: 1440, margin: '0 auto', boxSizing: 'border-box',
      }}>
        {/* ── 좌: 워드마크 + 담당자 (Figma 3134:1059) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flexShrink: 0 }}>
          <p style={{ fontFamily: FONT_EN, fontSize: 20, fontWeight: 400, lineHeight: 1.2, color: '#111', margin: 0 }}>
            C&R SPACE
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, lineHeight: 1.2 }}>
            <p style={{ fontFamily: FONT, color: '#111', letterSpacing: 0.14, margin: 0 }}>
              씨엔알리서치 사내 예약 플랫폼
            </p>
            {CONTACTS.map(c => (
              <p key={c.role} style={{ display: 'flex', gap: 8, fontFamily: FONT, margin: 0, flexWrap: 'wrap' }}>
                <span style={{ color: LABEL_BLUE }}>{c.role}</span>
                {c.names.map(n => <span key={n} style={{ color: '#111', letterSpacing: 0.14 }}>{n}</span>)}
              </p>
            ))}
          </div>
        </div>

        {/* ── 우: SPACE 사이트맵 (Figma 3134:999) ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', width: '100%' }}>
          {/* 헤더 — SPACE + ↘ (arrow_outward rotate 90) */}
          <button className="btn" onClick={() => onSetView('home')}
            style={{ background: 'none', border: 'none', padding: '0 24px 48px 0', cursor: 'pointer',
                     display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'stretch',
                     borderBottom: DIVIDER, width: '100%', boxSizing: 'border-box' }}>
            <span style={{ fontFamily: FONT_EN, fontSize: 28, fontWeight: 500, letterSpacing: 0.56, lineHeight: 1.2, color: '#111' }}>
              SPACE
            </span>
            <span style={{ display: 'flex', transform: 'rotate(90deg)' }}><IcoArrowOutward size={32} /></span>
          </button>

          {/* 섹션 — 회의실 · 자원 · 도서 · 마이페이지 (← [2026-08-20] Figma 갱신: 그룹 간 32 간격 제거, 행 py24 일관) */}
          <div>{GROUP_1.map(renderSection)}{GROUP_2.map(renderSection)}</div>

          {/* C&R Chatbot — 링크 미정: 회색 + '예정' (고지 확정) */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center',
                        padding: '24px 24px 24px 0', borderBottom: DIVIDER }}>
            <span style={{ fontFamily: FONT_EN, fontSize: 20, fontWeight: 500, lineHeight: 1.2,
                           color: '#B0B8C1' /* 회색 처리 — 오픈 시 #111 + 링크 연결 */ }}>
              C&R Chatbot
            </span>
            <span style={{ display: 'flex', opacity: 0.35 }}><IcoArrowOutward size={24} /></span>
            <span style={{ fontFamily: FONT, fontSize: 11, color: '#B0B8C1', background: '#F1F5F9',
                           borderRadius: 6, padding: '2px 6px', marginLeft: 2 }}>예정</span>
          </div>

          {/* 기타 서비스 */}
          {renderSection(ETC)}
        </div>
      </div>
    </footer>
  )
}
