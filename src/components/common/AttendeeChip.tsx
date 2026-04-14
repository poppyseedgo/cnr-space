import { createPortal } from 'react-dom'
import { useState } from 'react'
import { UserAvatar } from './UserAvatar'
import type { AppUser } from '../../types'

interface AttendeeChipProps {
  name:        string
  avatarUrl?:  string | null
  dept?:       string        // 내부 보관용 (표시 안 함)
  userInfo?:   AppUser       // 있으면 클릭 시 사용자 정보 모달
  onRemove?:   () => void    // 있으면 X 버튼 (BookingModal 전용)
  avatarSize?: number        // default 18
}

/**
 * AttendeeChip
 * 참석자 pill 형태 공통 컴포넌트
 * [아바타] 이름  [X]
 *
 * - onRemove 없으면 읽기 전용 (DetailModal, BookingDoneModal)
 * - onRemove 있으면 제거 버튼 표시 (BookingModal)
 * - userInfo 있으면 칩 클릭 시 사용자 정보 미니 모달
 */
export function AttendeeChip({ name, avatarUrl, userInfo, onRemove, avatarSize = 18 }: AttendeeChipProps) {
  const [open, setOpen] = useState(false)

  const canShowInfo = !!userInfo && !onRemove

  return (
    <>
      <div
        onClick={canShowInfo ? () => setOpen(true) : undefined}
        style={{
          display:      'inline-flex',
          alignItems:   'center',
          gap:          5,
          background:   '#EEF2FF',
          color:        '#000',
          fontSize:     11,
          fontWeight:   600,
          padding:      '4px 10px 4px 6px',
          borderRadius: 999,
          cursor:       canShowInfo ? 'pointer' : 'default',
        }}
      >
        <UserAvatar name={name} avatarUrl={avatarUrl ?? null} size={avatarSize} bgColor="#3D88FF" />
        <span>{name}</span>
        {onRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove() }}
            style={{
              background:  'none',
              border:      'none',
              cursor:      'pointer',
              color:       '#CBD5E1',
              lineHeight:  1,
              padding:     0,
              marginLeft:  2,
              display:     'flex',
              alignItems:  'center',
            }}
          >
            <span className="material-symbols-outlined" style={{fontSize:10}}>close</span>
          </button>
        )}
      </div>

      {/* 사용자 정보 미니 모달 */}
      {canShowInfo && open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position:       'fixed',
            inset:          0,
            zIndex:         9000,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            background:     'rgba(15,23,42,0.35)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:   '#fff',
              borderRadius: 16,
              padding:      '20px 20px 20px',
              width:        260,
              boxShadow:    '0 8px 32px rgba(0,0,0,0.16)',
              position:     'relative',
            }}
          >
            {/* 닫기 버튼 */}
            <button
              onClick={() => setOpen(false)}
              style={{
                position:       'absolute',
                top:            12,
                right:          12,
                background:     '#F1F5F9',
                border:         'none',
                borderRadius:   '50%',
                width:          28,
                height:         28,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                cursor:         'pointer',
                color:          '#64748B',
              }}
            >
              <span className="material-symbols-outlined" style={{fontSize:13}}>close</span>
            </button>

            {/* 프로필 영역 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <UserAvatar
                name={userInfo.name}
                avatarUrl={userInfo.avatar_url ?? null}
                size={44}
                bgColor="#3D88FF"
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', lineHeight: 1.3 }}>
                  {userInfo.name}
                </div>
                {userInfo.dept && (
                  <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                    {userInfo.dept}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 3 }}>
                  {userInfo.email}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
