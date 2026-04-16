import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { UserAvatar } from './UserAvatar'
import type { AppUser } from '../../types'

interface UserChipProps {
  name:       string
  avatarUrl?: string | null
  variant?:   'sm' | 'md'
  isAdmin?:   boolean
  userInfo?:  AppUser
}

const CONFIG = {
  sm: { avatarSize: 20, fontSize: 12, gap: 5 },
  md: { avatarSize: 28, fontSize: 14, gap: 5 },
}

export function UserChip({ name, avatarUrl, variant = 'md', isAdmin = false, userInfo }: UserChipProps) {
  const { avatarSize, fontSize, gap } = CONFIG[variant]
  const [open, setOpen] = useState(false)
  const canClick = !!userInfo

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
          bgColor={isAdmin ? '#111' : '#E6F1FB'}
          textColor={isAdmin ? '#fff' : '#185FA5'}
        />
        <span style={{ fontSize, fontWeight:500, color:'var(--color-text-primary, #111)', whiteSpace:'nowrap' }}>
          {name}
        </span>
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
