/**
 * AppFooter.tsx — 전역 서비스 푸터 (전 서비스 나열)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 기존 저작권 한 줄 푸터를 서비스 안내 푸터로 교체 (고지 확정)
 *      · 브랜드: "SPACE — C&R Research 사내 예약 플랫폼" (확정 표기) + space@cnrres.com
 *      · SPACE 컬럼: 회의실 예약(현황·캘린더) / 도서관 / 마이페이지 + 준비중 5종(비링크+배지)
 *      · CNR 서비스 컬럼: CNR ESG 만 (업무가이드 제외 — 고지 확정)
 *      · 내부 링크는 onSetView 재사용(SPA 이동), 외부는 새 탭 + rel=noopener
 *      · 데스크탑 3컬럼 / 모바일 세로 스택 (항목 적어 아코디언 불요)
 */

import { UPCOMING_SERVICES } from './AppDrawer'
import { BrandLogo } from './BrandLogo' // ← [2026-07-31] 헤더 워드마크 SSOT

interface AppFooterProps {
  isMobile:  boolean
  onSetView: (v: string) => void
}

export function AppFooter({ isMobile, onSetView }: AppFooterProps) {
  const linkStyle: React.CSSProperties = {
    display: 'block', background: 'none', border: 'none', padding: 0, textAlign: 'left',
    fontSize: 12, color: '#64748B', cursor: 'pointer', lineHeight: 2, fontFamily: 'inherit',
  }
  const colLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.6px', marginBottom: 8,
  }

  return (
    <footer style={{ borderTop: '1px solid #F1F5F9', marginTop: 160, background: '#FFFFFF' }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        padding: isMobile ? '28px 20px 18px' : '36px 28px 20px',
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1.3fr 1fr 1fr',
        gap: isMobile ? 24 : 32,
      }}>
        {/* 브랜드 */}
        <div>
          <div style={{ color: '#111', marginBottom: 10, display: 'flex' }}>
            <BrandLogo variant="desktop" /> {/* ← [2026-07-31] 헤더 로고 그대로 적용 (고지 지시) */}
          </div>
          <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.8 }}>
            C&amp;R Research 사내 예약 플랫폼
            <br />
            <a href="mailto:space@cnrres.com" style={{ color: '#64748B', textDecoration: 'none' }}>
              space@cnrres.com
            </a>
          </div>
        </div>

        {/* SPACE 서비스 */}
        <div>
          <div style={colLabel}>SPACE</div>
          {/* ← [2026-07-31] 헤더 필 네비와 동일 명칭 (실시간 현황 / 캘린더 뷰) */}
          <button className="btn" style={linkStyle} onClick={() => onSetView('home')}>실시간 현황</button>
          <button className="btn" style={linkStyle} onClick={() => onSetView('calendar')}>캘린더 뷰</button>
          <button className="btn" style={linkStyle} onClick={() => onSetView('library')}>도서관</button>
          <button className="btn" style={linkStyle} onClick={() => onSetView('mypage')}>마이페이지</button>
          {/* 준비중 — 드로어와 동일 목록(SSOT: AppDrawer.UPCOMING_SERVICES), 비링크 */}
          {UPCOMING_SERVICES.map(({ label }) => (
            <div key={label} style={{ ...linkStyle, cursor: 'default', color: '#CBD5E1' }}>
              {label} <span style={{ fontSize: 10 }}>· 준비중</span>
            </div>
          ))}
        </div>

        {/* CNR 서비스 — ESG 만 (고지 확정) */}
        <div>
          <div style={colLabel}>CNR 서비스</div>
          <a href="https://esg.cnrres.store" target="_blank" rel="noopener noreferrer"
            style={{ ...linkStyle, textDecoration: 'none' }}>
            CNR ESG ↗
          </a>
        </div>
      </div>

      <div style={{
        maxWidth: 1400, margin: '0 auto', borderTop: '1px solid #F8FAFC',
        padding: isMobile ? '12px 20px 16px' : '14px 28px 18px',
        fontSize: 11, color: '#94A3B8', letterSpacing: '0.2px',
      }}>
        © {new Date().getFullYear()} CNR Research. All rights reserved.
      </div>
    </footer>
  )
}
