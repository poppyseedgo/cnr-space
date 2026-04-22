import React from 'react'
import { Loader2 } from 'lucide-react'

// ─── 타입 ────────────────────────────────────────────────────────────────────
export type ButtonVariant =
  | 'primary'        // #111     / #fff     — 저장, 예약하기, 다음
  | 'success'        // #16A34A  / #fff     — 승인, 체크인
  | 'danger'         // #DC2626  / #fff     — 거절 확정, 강제취소 확정
  | 'danger-outline' // #FEF2F2  / #DC2626  — 거절, 예약취소, 강제취소
  | 'ghost'          // #F1F5F9  / #64748B  — 닫기, 취소, 돌아가기
  | 'secondary'      // #F8FAFC  / #64748B  — 수정, 삭제, CSV 내보내기
  | 'info-outline'   // #EFF6FF  / #1D4ED8  — 예약 변경

export type ButtonSize = 'sm' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:   ButtonVariant
  size?:      ButtonSize
  loading?:   boolean
  icon?:      React.ReactNode   // 좌측 아이콘
  flex?:      boolean           // flex:1 (modal-actions 안 균등 너비)
  fullWidth?: boolean           // width:100%
}

// ─── 스타일 맵 ───────────────────────────────────────────────────────────────
const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  'primary':       { background: '#111111', color: '#fff' },
  'success':       { background: '#16A34A', color: '#fff' },
  'danger':        { background: '#DC2626', color: '#fff' },
  'danger-outline':{ background: '#FEF2F2', color: '#DC2626' },
  'ghost':         { background: '#F1F5F9', color: '#64748B' },
  'secondary':     { background: '#F8FAFC', color: '#64748B' },
  'info-outline':  { background: '#EFF6FF', color: '#1D4ED8' },
}

const SIZE_STYLES: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '6px 12px',  fontSize: 12, fontWeight: 600, border: 0, borderRadius: 8  },
  // ← [피그마 반영] lg: height 56 / padding '16px 0' / radius 16 / 14px SemiBold (RoomModal 기준)
  lg: { padding: '16px 0',    fontSize: 14, fontWeight: 600, border: 0, borderRadius: 16, height: 56 },
}

// ─── Component ───────────────────────────────────────────────────────────────
export function Button({
  variant   = 'ghost',
  size      = 'lg',
  loading   = false,
  icon,
  flex,
  fullWidth,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {

  const baseStyle: React.CSSProperties = {
    border:      'none',
    cursor:      (disabled || loading) ? 'not-allowed' : 'pointer',
    opacity:     (disabled || loading) ? 0.45 : 1,
    display:     'inline-flex',
    alignItems:  'center',
    justifyContent: 'center',
    gap:         6,
    whiteSpace:  'nowrap',
    flexShrink:  0,
    transition:  'opacity .15s',
    ...(flex      && { flex: 1 }),
    ...(fullWidth && { width: '100%' }),
    ...VARIANT_STYLES[variant],
    ...SIZE_STYLES[size],
    ...style,
  }

  return (
    <button
      className="btn"
      disabled={disabled || loading}
      style={baseStyle}
      {...props}
    >
      {loading
        ? <Loader2 size={size === 'sm' ? 12 : 14} strokeWidth={1.8}
            style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }}/>
        : icon
      }
      {children}
    </button>
  )
}
