/**
 * DrawerIcons.tsx — DetailDrawer 전용 아이콘 (Figma 2669:10902 내보내기 그대로)
 *
 * [2026-07-24] 신규
 *
 * ★ 임의로 그리지 않았다
 *   8개 전부 Figma download_assets 로 내려받은 SVG 의 path d 값을 **한 글자도 바꾸지 않고**
 *   옮겼다. Material Symbols 계열이라 얼핏 비슷한 아이콘을 손으로 그리면 굵기·모서리·
 *   광학 중심이 미묘하게 어긋나는데, 같은 화면에 Figma 아이콘과 섞이면 바로 티가 난다.
 *
 * ★ 색상만 currentColor 로 뺐다
 *   Figma 내보내기는 fill 이 하드코딩(#1C1B1F, #92A0BC …)돼 있다. 그대로 두면
 *   호버·비활성 상태에서 색을 못 바꾼다. 기본값을 Figma 색으로 유지하되
 *   호출부가 color 로 덮을 수 있게 currentColor 를 쓴다.
 *   → 렌더 결과는 기본 상태에서 Figma 와 동일, 상태 변화만 추가로 가능.
 *
 * ★ viewBox 와 기본 size 는 Figma 원본 그대로다
 *   close/arrow_left_alt/download/chevron 계열 = 24, calendar_today/keyboard_arrow_down/
 *   sync_alt = 20. 하나로 통일하면 획 굵기가 달라 보인다.
 */

interface IconProps {
  /** 렌더 크기(px). 기본값은 Figma 원본 크기 */
  size?:  number
  /** 기본값은 Figma 원본 색 */
  color?: string
  style?: React.CSSProperties
}

const base = (size: number, style?: React.CSSProperties): React.CSSProperties => ({
  display: 'block', width: size, height: size, flexShrink: 0, ...style,
})

/** close — Figma 2679:11503 (24×24) */
export function IcoClose({ size = 24, color = '#1C1B1F', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M6.40039 18.1004L5.90039 17.6004L11.5004 12.0004L5.90039 6.40039L6.40039 5.90039L12.0004 11.5004L17.6004 5.90039L18.1004 6.40039L12.5004 12.0004L18.1004 17.6004L17.6004 18.1004L12.0004 12.5004L6.40039 18.1004Z" fill={color} />
    </svg>
  )
}

/** arrow_left_alt — Figma 2669:11404 (24×24) · '전체 보기' 되돌아가기 */
export function IcoArrowLeftAlt({ size = 24, color = '#1C1B1F', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M9.875 17.1L4.775 12L9.875 6.9L10.375 7.4L6.125 11.65H19.225V12.35H6.125L10.375 16.6L9.875 17.1Z" fill={color} />
    </svg>
  )
}

/** calendar_today — Figma 2669:11480 (20×20) · 날짜 범위 앞 */
export function IcoCalendarToday({ size = 20, color = '#566277', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M14.6663 3.33333C15.7709 3.33333 16.6663 4.22876 16.6663 5.33333V14.6663C16.6663 15.7709 15.7709 16.6663 14.6663 16.6663H5.33333L5.12923 16.6566C4.12052 16.5543 3.33333 15.702 3.33333 14.6663V5.33333C3.33333 4.22876 4.22876 3.33333 5.33333 3.33333H14.6663ZM4.33333 8.41634V14.6663C4.33333 15.2186 4.78105 15.6663 5.33333 15.6663H14.6663C15.2186 15.6663 15.6663 15.2186 15.6663 14.6663V8.41634H4.33333ZM5.33333 4.33333C4.78105 4.33333 4.33333 4.78105 4.33333 5.33333V7.41634H15.6663V5.33333C15.6663 4.78105 15.2186 4.33333 14.6663 4.33333H5.33333Z" fill={color} />
    </svg>
  )
}

/** keyboard_arrow_down — Figma 2669:11490 (20×20) · 날짜 피커 열기 */
export function IcoArrowDown({ size = 20, color = '#858585', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M10.25 12.5625L6 8.3125L6.3125 8L10.25 11.9375L14.1875 8L14.5 8.3125L10.25 12.5625Z" fill={color} />
    </svg>
  )
}

/** download — Figma 2669:11428 (24×24) · CSV */
export function IcoDownload({ size = 24, color = '#787878', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M12 15.45L8.9 12.35L9.4 11.85L11.65 14.1V5.3H12.35V14.1L14.6 11.85L15.1 12.35L12 15.45ZM6.8 18.7C6.36667 18.7 6.00833 18.5583 5.725 18.275C5.44167 17.9917 5.3 17.6333 5.3 17.2V14.95H6V17.2C6 17.4 6.08333 17.5833 6.25 17.75C6.41667 17.9167 6.6 18 6.8 18H17.2C17.4 18 17.5833 17.9167 17.75 17.75C17.9167 17.5833 18 17.4 18 17.2V14.95H18.7V17.2C18.7 17.6333 18.5583 17.9917 18.275 18.275C17.9917 18.5583 17.6333 18.7 17.2 18.7H6.8Z" fill={color} />
    </svg>
  )
}

/**
 * sync_alt — Figma 2669:11465 (20×20) · 컬럼 정렬
 *
 * ※ Figma 에서 이 아이콘은 `rotate-90` 이 걸린 상태로 배치돼 있다(좌우 화살표 → 상하).
 *   래퍼에서 회전시키지 않고 여기서 transform 을 갖고 있게 한다 —
 *   회전을 잊은 채 배치하면 정렬 아이콘이 가로 화살표로 나와 의미가 뒤집힌다.
 */
export function IcoSortAlt({ size = 20, color = '#92A0BC', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none"
      style={{ ...base(size, style), transform: 'rotate(90deg)' }} aria-hidden="true">
      <path d="M6.08979 16.9231L2.5 13.3333L6.08979 9.74354L6.68437 10.3333L4.10104 12.9167H16.6667V13.75H4.10104L6.68437 16.3333L6.08979 16.9231ZM13.9102 10.2565L13.3156 9.66667L15.899 7.08333H3.33333V6.25H15.899L13.3156 3.66667L13.9102 3.07687L17.5 6.66667L13.9102 10.2565Z" fill={color} />
    </svg>
  )
}

/** chevron_backward — Figma 2669:10837 (24×24) · 이전 페이지 */
export function IcoChevronBackward({ size = 24, color = '#64748B', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M14 17.1L8.9 12L14 6.9L14.5 7.4L9.9 12L14.5 16.6L14 17.1Z" fill={color} />
    </svg>
  )
}

/** chevron_forward — Figma 2669:10851 (24×24) · 다음 페이지 */
export function IcoChevronForward({ size = 24, color = '#111111', style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={base(size, style)} aria-hidden="true">
      <path d="M13.5 12L8.9 7.4L9.4 6.9L14.5 12L9.4 17.1L8.9 16.6L13.5 12Z" fill={color} />
    </svg>
  )
}
