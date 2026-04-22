import React from 'react'

/**
 * ModalCloseButton — 모달 전용 닫기(X) 버튼 공통 컴포넌트
 *
 * ✅ 피그마(2026-04-22) 기준:
 *   - 버튼: 32×32 원형, 기본 배경 transparent, hover 시 #F1F5F9
 *   - 아이콘: 20×20 SVG, path 기반(얇은 1px 굵기), fill #1C1B1F
 *   - lucide-react <X>의 stroke 방식과 달리 fill path로 렌더 → 시각 일관성 위해 SVG 내재화
 *
 * 사용처: RoomDetailModal, BookingDetailModal, BookingModal,
 *        ConfirmCancelModal, AdminPage 회의실 편집 모달, UserChip 상세 모달
 *
 * 검색창 clear / 갤러리 이미지 삭제 / chip 제거 등 '모달 닫기가 아닌 X'는 제외.
 */
interface ModalCloseButtonProps {
  onClick:   () => void
  disabled?: boolean
  /** 접근성 라벨 (기본 '닫기') */
  ariaLabel?: string
  /** 버튼 외부 마진/정렬 override용 */
  style?:    React.CSSProperties
  /** 아이콘/버튼 사이즈 — sm(28×28 / 아이콘 16) | md(32×32 / 아이콘 20, 기본) */
  size?:     'sm' | 'md'
}

const SIZE_CONFIG = {
  sm: { btn: 28, icon: 16 },
  md: { btn: 32, icon: 20 },
} as const

export function ModalCloseButton({
  onClick,
  disabled = false,
  ariaLabel = '닫기',
  style,
  size = 'md',
}: ModalCloseButtonProps) {
  const { btn, icon } = SIZE_CONFIG[size]

  return (
    <button
      type="button"
      className="btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      onMouseEnter={e => {
        if (!disabled) (e.currentTarget as HTMLElement).style.background = '#F1F5F9'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
      style={{
        width: btn,
        height: btn,
        borderRadius: '50%',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .15s',
        padding: 0,
        ...style,
      }}
    >
      {/* ← 피그마 원본 SVG path (Material Icons style close) */}
      <svg width={icon} height={icon} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <mask id={`mcb-mask-${size}`} style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="#D9D9D9" />
        </mask>
        <g mask={`url(#mcb-mask-${size})`}>
          <path
            d="M5.33464 15.0846L4.91797 14.668L9.58464 10.0013L4.91797 5.33464L5.33464 4.91797L10.0013 9.58464L14.668 4.91797L15.0846 5.33464L10.418 10.0013L15.0846 14.668L14.668 15.0846L10.0013 10.418L5.33464 15.0846Z"
            fill="#1C1B1F"
          />
        </g>
      </svg>
    </button>
  )
}
