/**
 * AppDrawer.tsx — 전역 사이드 드로어 내비게이션 (헤더 햄버거 트리거)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 서비스 확장 대응 IA 개편 (고지 확정)
 *      · IA: '회의실 예약'이 상위 — 현황(home)·캘린더(calendar)는 그 하위 뷰
 *      · 도서관 / 마이페이지 / 어드민(권한자만 — 권한 없는 메뉴는 숨김 원칙)
 *      · 준비중 5종 명시: Q&A · 핫픽스 및 릴리즈 노트 · C&R 챗봇 · 포인터 예약 · 자리 예약
 *        (ZOOM 관련은 전부 삭제 — ResourceDropdown 폐기와 함께 종결)
 *  - [2026-08-03] 'Release Note + Hotfix' 정식 오픈 (고지 확정 타이틀) —
 *      준비중 목록에서 제거하고 서비스 섹션 정식 메뉴로 승격 (view 'release-notes').
 *      UPCOMING_SERVICES 는 4종으로 축소 — 푸터 준비중 목록도 SSOT 공유라 자동 반영.
 *      · 외부 서비스는 드로어에 없음 — ESG 는 푸터 전용 (고지 확정)
 *      · 모바일 도서관 진입 부재 문제(ResourceDropdown 데스크탑 전용)의 근본 해결 —
 *        전 해상도 공통 단일 내비. 같은 목적지 메뉴 2벌 금지 원칙.
 *
 * 📌 UI 확정 스펙
 *      패널 좌측 슬라이드 320px(모바일 min(84vw,320)) / 오버레이 rgba(15,23,42,.55)+blur
 *      / 220ms ease-out / ESC·오버레이·항목 선택 시 닫힘 / body scroll lock
 *      / 드로어는 다크모드에서도 라이트 고정(모달류 관례) / 활성 = #111 필 + 흰 글자
 */

import { useEffect, useState } from 'react'
import { X, UserCircle, Settings,
  MessageCircleQuestion, FileText, Bot, Armchair } from 'lucide-react'
// ← [2026-07-31] 헤더 필 네비와 동일 아이콘·명칭 (IcoSchedule=실시간 현황 / IcoCalendar=캘린더 뷰)
import { IcoSchedule, IcoCalendar } from './HeaderNav'
import { ModalPortal } from '../common/ModalPortal'
// ← [2026-07-31] 자원 예약 드롭다운과 동일 아이콘 공유 (고지 지시 — 포인터/도서)
import { IcoPointer, IcoBook } from './ResourceDropdown'
import { BrandLogo } from './BrandLogo' // ← [2026-07-31] 헤더 워드마크 동일 적용

interface AppDrawerProps {
  open:      boolean
  view:      string
  isAdmin:   boolean
  isMobile:  boolean
  onSetView: (v: string) => void
  onClose:   () => void
}

/** 준비중 서비스 — 순서 고정. 링크 아님, 로드맵 커뮤니케이션용 노출
 *  ← [2026-08-03] '핫픽스 및 릴리즈 노트' 정식 오픈으로 제거 (5종 → 4종) */
export const UPCOMING_SERVICES = [
  { label: 'Q&A',                icon: MessageCircleQuestion },
  { label: 'C&R 챗봇',           icon: Bot },
  { label: '자리 예약',           icon: Armchair },
] as const

export function AppDrawer({ open, view, isAdmin, isMobile, onSetView, onClose }: AppDrawerProps) {
  // 슬라이드 애니메이션 — 마운트 다음 프레임에 in 상태로 전환
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) { setEntered(false); return }
    const t = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(t)
  }, [open])

  // ESC 닫기 + body scroll lock (기존 모달 관례)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null

  const go = (v: string) => { onSetView(v); onClose() }

  const itemStyle = (active: boolean, disabled = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
    padding: '10px 12px', borderRadius: 10, border: 'none', textAlign: 'left',
    fontSize: 14, fontWeight: active ? 600 : 500, fontFamily: 'inherit',
    background: active ? '#111111' : 'transparent',
    color: disabled ? '#CDD3DA' : active ? '#FFFFFF' : '#111111',  // 비활성 = AdminSideNav disabled 관례
    cursor: disabled ? 'default' : 'pointer',
  })
  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.6px',
    padding: '6px 12px 4px',
  }

  return (
    <ModalPortal>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1300,
          background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)',
          opacity: entered ? 1 : 0, transition: 'opacity 180ms ease-out',
        }}>
        {/* 패널 */}
        <div
          onClick={e => e.stopPropagation()}
          role="navigation" aria-label="전체 메뉴"
          style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: isMobile ? 'min(84vw, 320px)' : 320,
            background: '#FFFFFF', borderRight: '1px solid #F1F5F9',
            transform: entered ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 220ms ease-out',
            display: 'flex', flexDirection: 'column',
          }}>

          {/* 헤더: 워드마크 + 닫기 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 16px 12px 20px', borderBottom: '1px solid #F8FAFC' }}>
            <span style={{ color: '#111', display: 'flex' }}>
              <BrandLogo variant="desktop" /> {/* ← [2026-07-31] 헤더 로고 그대로 (currentColor=#111) */}
            </span>
            <button className="btn" onClick={onClose} aria-label="메뉴 닫기"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 6, color: '#94A3B8', display: 'flex' }}>
              <X size={18} strokeWidth={2} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px 16px' }}>
            {/* ── 회의실 예약 (상위) — 현황·캘린더는 하위 뷰 (고지 확정 IA) ── */}
            <div style={sectionLabel}>회의실 예약</div>
            <button className="btn" style={itemStyle(view === 'home')} onClick={() => go('home')}>
              <IcoSchedule size={18} /> 실시간 현황 {/* ← [2026-07-31] 헤더 필과 동일 명칭·SVG */}
            </button>
            <button className="btn" style={itemStyle(view === 'calendar')} onClick={() => go('calendar')}>
              <IcoCalendar size={18} /> 캘린더 뷰
            </button>

            {/* ── 서비스 ── */}
            <div style={{ ...sectionLabel, marginTop: 14 }}>서비스</div>
            {/* ← [2026-08-19 고지 지시] 서비스 순서: 자원예약 → 도서관 → 마이페이지 → Release Note → 어드민 */}
            <button className="btn" style={itemStyle(view === 'resources')} onClick={() => go('resources')}>
              <IcoPointer />
              자원예약
            </button>
            <button className="btn" style={itemStyle(view === 'library')} onClick={() => go('library')}>
              <IcoBook size={18} /> 도서관 {/* ← [2026-07-31] 자원 드롭다운 동일 SVG */}
            </button>
            <button className="btn" style={itemStyle(view === 'mypage')} onClick={() => go('mypage')}>
              <UserCircle size={17} strokeWidth={1.8} /> 마이페이지
            </button>
            {/* ← [2026-08-03] 준비중에서 정식 승격 — 타이틀 'Release Note + Hotfix' (고지 확정) */}
            <button className="btn" style={itemStyle(view === 'release-notes')} onClick={() => go('release-notes')}>
              <FileText size={17} strokeWidth={1.8} /> Release Note + Hotfix
            </button>
            {/* 어드민 — 권한자에게만 노출 (권한 없는 메뉴는 비활성이 아니라 숨김 원칙) */}
            {isAdmin && (
              <button className="btn" style={itemStyle(view === 'admin')} onClick={() => go('admin')}>
                <Settings size={17} strokeWidth={1.8} /> 어드민
              </button>
            )}

            {/* ── 준비중 — 고지 확정 5종. '권한 없음(숨김)'과 달리 '미구현'은 보여준다
                  (AdminSideNav 의 disabled 노출 관례와 동일한 구분) ── */}
            <div style={{ ...sectionLabel, marginTop: 14, borderTop: '1px solid #F8FAFC', paddingTop: 12 }}>
              준비중
            </div>
            {UPCOMING_SERVICES.map(({ label, icon: Icon }) => (
              <div key={label} style={itemStyle(false, true)} aria-disabled="true">
                <Icon size={17} /> {label}   {/* ← [2026-07-31] strokeWidth 제거 — 커스텀 SVG 혼용 (lucide 는 기본값 사용) */}
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: '#94A3B8',
                  border: '1px solid #E2E8F0', borderRadius: 999, padding: '1px 7px' }}>
                  준비중
                </span>
              </div>
            ))}
          </div>

          {/* 하단 — 서비스명 (고지 확정 표기) */}
          <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #F8FAFC', fontSize: 11, color: '#94A3B8', lineHeight: 1.6 }}>
            SPACE — C&amp;R Research 사내 예약 플랫폼
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
