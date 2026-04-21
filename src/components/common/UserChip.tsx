import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { UserAvatar } from './UserAvatar'
import type { AppUser } from '../../types'

interface UserChipProps {
  name:       string
  avatarUrl?: string | null
  variant?:   'sm' | 'md' | 'detail'
  isAdmin?:   boolean
  userInfo?:  AppUser
  /** variant='detail'에서 이름 뒤에 부서 표시 */
  showDept?:  boolean
  dept?:      string
}

/**
 * variant별 config
 * - sm       : 소형 칩 (AttendeeChip 내부 등)                 — 기존 유지
 * - md       : 중형 칩 (리스트뷰, BookingDoneModal 등)          — 기존 유지
 * - detail   : [2026-04-21 신규] BookingDetailModal 예약자/참석자 전용
 *              피그마 node 202:1178 (부서 포함) / 202:1184 (이름만)
 *              avatar 24, bg #000, text #E7E7E7, fs 12 Medium leading 1.3
 *              이름 14 Medium #111, 부서 11 Regular rgba(17,17,17,0.35)
 *              gap 7 (아바타-이름 사이), 이름-부서 gap 4
 */
const CONFIG = {
  sm:     { avatarSize: 20, fontSize: 12, gap: 5 },
  md:     { avatarSize: 28, fontSize: 14, gap: 5 },
  detail: { avatarSize: 24, fontSize: 14, gap: 7 },
}

export function UserChip({
  name, avatarUrl, variant = 'md', isAdmin = false, userInfo,
  showDept = false, dept,
}: UserChipProps) {
  const { avatarSize, fontSize, gap } = CONFIG[variant]
  const [open, setOpen] = useState(false)
  const canClick = !!userInfo

  // ← [2026-04-21] detail variant는 아바타 색상 고정 (피그마 스펙: #000 bg / #E7E7E7 text, Medium 500)
  //   sm/md는 기존 로직 유지 (isAdmin에 따라 #111/#E6F1FB 분기)
  const avatarBg    = variant === 'detail' ? '#000'    : (isAdmin ? '#111' : '#E6F1FB')
  const avatarColor = variant === 'detail' ? '#E7E7E7' : (isAdmin ? '#fff' : '#185FA5')
  const avatarFontSize   = variant === 'detail' ? 12  : undefined
  const avatarFontWeight = variant === 'detail' ? 500 : undefined

  return (
    <>
      <div
        onClick={canClick ? () => setOpen(true) : undefined}
        style={{ display:'inline-flex', alignItems:'center', gap, flexShrink:0, cursor: canClick ? 'pointer' : 'default' }}
      >
        <UserAvatar
          name={name}
          avatarUrl={avatarUrl ?? null}
          size={avatarSize}
          bgColor={avatarBg}
          textColor={avatarColor}
          fontSize={avatarFontSize}
          fontWeight={avatarFontWeight}
        />
        {/* ← [2026-04-21] detail variant: 이름 Medium + 부서 동일 줄 gap 4
               기존 sm/md variant: 이름만 렌더 */}
        {variant === 'detail' ? (
          <div style={{display:'inline-flex', alignItems:'center', gap:4, lineHeight:1.3, whiteSpace:'nowrap'}}>
            <span style={{fontSize:14, fontWeight:500, color:'#111'}}>{name}</span>
            {showDept && dept && (
              <span style={{fontSize:11, fontWeight:400, color:'rgba(17,17,17,0.35)'}}>{dept}</span>
            )}
          </div>
        ) : (
          <span style={{ fontSize, fontWeight:500, color:'var(--color-text-primary, #111)', whiteSpace:'nowrap' }}>
            {name}
          </span>
        )}
      </div>

      {canClick && open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position:'fixed', inset:0, zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(15,23,42,0.35)', backdropFilter:'blur(2px)' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:16, padding:'20px', width:260, boxShadow:'0 8px 32px rgba(0,0,0,0.16)', position:'relative' }}>
            <button onClick={() => setOpen(false)} style={{ position:'absolute', top:12, right:12, background:'#F1F5F9', border:'none', borderRadius:'50%', width:28, height:28, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#64748B' }}>
              <X size={13} strokeWidth={1.8} />
            </button>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <UserAvatar name={userInfo.name} avatarUrl={userInfo.avatar_url ?? null} size={44} bgColor="#3D88FF" />
              <div>
                <div style={{ fontSize:14, fontWeight:600, color:'#111', lineHeight:1.3 }}>{userInfo.name}</div>
                {userInfo.dept && <div style={{ fontSize:11, color:'#94A3B8', marginTop:3 }}>{userInfo.dept}</div>}
                <div style={{ fontSize:11, color:'#94A3B8', marginTop:3 }}>{userInfo.email}</div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
