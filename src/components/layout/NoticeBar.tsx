/**
 * NoticeBar.tsx — 헤더 상단 공지 배너
 *
 * ✅ 변경 이력
 *  - [2026-04-30] 신규: Figma node 410:6876 디자인 반영 (Header 위 공지 영역)
 *      · 디자인 스펙 (Figma 410:6876, 410:6877):
 *        - bg: #E6F2FF (기본값, Admin이 색 선택 가능)
 *        - padding: 10px 0 (위/아래 10px → 높이 약 41px)
 *        - text: Pretendard SemiBold 14px / line-height 1.5 / #1E1E1E
 *        - 가운데 정렬, X 버튼은 우측 absolute 배치 (16px 안쪽 마진)
 *      · 기능: X 버튼 클릭 시 위로 슬라이드 + fade out (300ms transition)
 *      · 세션 한정 dismiss: sessionStorage 키 `cnr_notice_dismissed_${id}`
 *        - id가 변경되면 자동 재표시 (Admin이 새 공지 등록 시 자동 노출)
 *      · 추후 Admin 연결: AnnouncementConfig 인터페이스 prop 수신
 *        - 현재 단계: App.tsx에서 mock 데이터 prop 전달
 *        - 추후 단계: Supabase announcements 테이블 fetch → prop 전달 (현 인터페이스 그대로 사용 가능)
 */

import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

// ── 공지 데이터 인터페이스 (추후 Supabase 테이블 컬럼과 1:1 매핑 예정) ─────
export interface AnnouncementConfig {
  id: string;          // 공지 ID — 변경 시 dismiss 초기화 트리거
  active: boolean;     // 활성화 여부 (Admin 토글)
  message: string;     // 공지 텍스트
  bgColor: string;     // 배경색 (예: #E6F2FF)
  textColor?: string;  // 텍스트 색상 (기본 #1E1E1E)
}

interface NoticeBarProps {
  announcement: AnnouncementConfig | null;
}

// 세션스토리지 키 prefix — 다른 키와 네임스페이스 분리
const SESSION_KEY_PREFIX = 'cnr_notice_dismissed_'

export const NoticeBar: React.FC<NoticeBarProps> = ({ announcement }) => {
  // dismissed=true → 애니메이션 시작 (transform/opacity 변경)
  // removed=true   → DOM에서 제거 (애니메이션 끝난 뒤)
  const [dismissed, setDismissed] = useState(false)
  const [removed, setRemoved] = useState(false)
  const lastIdRef = useRef<string | null>(null)

  // ── id 변경 감지 → dismiss 상태 초기화 + 세션스토리지 확인 ──────────────
  // Admin이 새 공지를 등록하면 id가 변경되어 사용자에게 다시 표시됨
  useEffect(() => {
    if (!announcement?.active) return

    if (lastIdRef.current !== announcement.id) {
      lastIdRef.current = announcement.id
      const isDismissed =
        typeof window !== 'undefined' &&
        sessionStorage.getItem(SESSION_KEY_PREFIX + announcement.id) === '1'
      setDismissed(isDismissed)
      setRemoved(isDismissed)
    }
  }, [announcement?.id, announcement?.active])

  // ── 렌더 가드 ──────────────────────────────────────────────────────────
  // 1) announcement 자체가 없거나
  // 2) Admin이 비활성화했거나
  // 3) 사용자가 X로 닫고 애니메이션이 끝났으면 → null
  if (!announcement || !announcement.active || removed) return null

  // ── X 버튼 핸들러: 슬라이드 + 페이드 → 300ms 후 DOM 제거 ───────────────
  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY_PREFIX + announcement.id, '1')
    setDismissed(true)
    setTimeout(() => setRemoved(true), 300)
  }

  return (
    <div
      role="status"
      style={{
        background: announcement.bgColor,
        color: announcement.textColor ?? '#1E1E1E',
        padding: '10px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        // ── 슬라이드 + 페이드 + maxHeight 동시 애니메이션 ─────────────────
        // maxHeight를 함께 줄여야 위 콘텐츠가 자연스럽게 따라올라감
        transform: dismissed ? 'translateY(-100%)' : 'translateY(0)',
        opacity: dismissed ? 0 : 1,
        maxHeight: dismissed ? 0 : 80,
        overflow: 'hidden',
        transition:
          'transform 300ms ease, opacity 300ms ease, max-height 300ms ease',
        fontFamily: 'Pretendard, sans-serif',
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,    // Pretendard SemiBold
          lineHeight: 1.5,
          padding: '0 48px',  // X 버튼과 텍스트 겹침 방지 (좌우 동일 여백)
          textAlign: 'center',
        }}
      >
        {announcement.message}
      </span>

      <button
        type="button"
        className="btn"
        onClick={handleDismiss}
        aria-label="공지 닫기"
        style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: announcement.textColor ?? '#1E1E1E',
          opacity: 0.6,
          borderRadius: 4,
          transition: 'opacity 150ms ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.6')}
      >
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  )
}
