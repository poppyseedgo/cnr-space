/**
 * IconClose — 모달 닫기 버튼 공통 X 아이콘
 *
 * 피그마 파일: node 200:1107 (Modal_X_공통변경.svg)
 * 스펙:
 *  · size 20x20 (viewBox 0 0 20 20)
 *  · 얇은 X (path fill, stroke 없음)
 *  · 기본 color: #1C1B1F (피그마 원본)
 *  · color prop으로 커스텀 가능
 *
 * 사용처: RoomDetailModal, BookingModal, BookingDetailModal(DetailModal),
 *        ConfirmCancelModal, BookingDoneModal, RecurDoneModal
 *
 * 기존 lucide-react <X/> 아이콘 대체.
 */

interface IconCloseProps {
  size?: number
  color?: string
  className?: string
}

export function IconClose({ size = 20, color = '#1C1B1F', className }: IconCloseProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
      aria-hidden="true"
    >
      <path
        d="M5.33464 15.0846L4.91797 14.668L9.58464 10.0013L4.91797 5.33464L5.33464 4.91797L10.0013 9.58464L14.668 4.91797L15.0846 5.33464L10.418 10.0013L15.0846 14.668L14.668 15.0846L10.0013 10.418L5.33464 15.0846Z"
        fill={color}
      />
    </svg>
  )
}
