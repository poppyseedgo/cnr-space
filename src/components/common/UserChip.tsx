import { useState } from 'react'
import { createPortal } from 'react-dom'
import { UserAvatar } from './UserAvatar'
import { ModalCloseButton } from './ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화
import type { AppUser } from '../../types'

interface UserChipProps {
  name:       string
  avatarUrl?: string | null
  variant?:   'sm' | 'md'
  isAdmin?:   boolean
  userInfo?:  AppUser
  /** ← [피그마 180:534 신규] 이름 옆 부서 표시 (예약자 행 전용) */
  dept?:      string
}

/**
 * UserChip
 * - 아바타(원형) + 이름 표기
 * - dept 있으면 이름 뒤에 연한 부서명 노출 (예약자 섹션)
 * - userInfo 있으면 클릭 시 상세 모달
 *
 * ← [피그마 180:534 반영]
 *   · md: avatar 24(기존 28) / gap 7(기존 5) / name 14px Medium / line-height 1.3
 *   · sm: avatar 20 / gap 5 / name 12px Medium (기존 유지)
 *   · bgColor/textColor 하드코딩 제거 → UserAvatar 기본값(#000/#E7E7E7) 사용
 *
 * ← [2026-05-19 스타일 업데이트] 사용자 정보 팝오버 모달
 *   · 컨테이너 borderRadius 16 → 24
 *   · 컨테이너 padding 16px → 12px
 *   · 내부 UserAvatar borderRadius '50%'(기본) → 16 (정사각 라운드)
 *   · 내부 UserAvatar border 추가: 1px solid #f7f9fa
 */
const CONFIG = {
  sm: { avatarSize: 20, fontSize: 12, gap: 5 },
  md: { avatarSize: 24, fontSize: 14, gap: 7 }, // ← [피그마] 28→24, 5→7
}

export function UserChip({ name, avatarUrl, variant = 'md', isAdmin = false, userInfo, dept }: UserChipProps) {
  const { avatarSize, fontSize, gap } = CONFIG[variant]
  const [open, setOpen] = useState(false)
  const canClick = !!userInfo

  return (
    <>
      <div
        onClick={canClick ? () => setOpen(true) : undefined}
        style={{ display:'inline-flex', alignItems:'center', gap, flexShrink:0, cursor: canClick ? 'pointer' : 'default' }}
      >
        {/* ← [피그마] bgColor/textColor 하드코딩 제거, UserAvatar 기본값(#000/#E7E7E7) 사용.
            isAdmin 플래그는 하위호환 유지하되 의미 없는 값이 되므로 무시 */}
        <UserAvatar
          name={name}
          avatarUrl={avatarUrl ?? null}
          size={avatarSize}
        />
        {/* ← [피그마] 이름+부서 평행 배치 (dept 있을 때만) */}
        <span style={{ display:'inline-flex', alignItems:'center', gap:4, lineHeight:1.3, whiteSpace:'nowrap' }}>
          <span style={{ fontSize, fontWeight:500, color:'var(--color-text-primary, #111)' }}>
            {name}
          </span>
          {dept && (
            <span style={{ fontSize:11, fontWeight:400, color:'rgba(17,17,17,0.35)' }}>
              {dept}
            </span>
          )}
        </span>
      </div>

      {canClick && open && createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{ position:'fixed', inset:0, zIndex:9000, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(15,23,42,0.35)', backdropFilter:'blur(2px)' }}
        >
          {/* ← [2026-05-04 핫픽스 v16] 사용자 지정값 적용
                · 컨테이너: padding 20→16, width 260→320 (나머지 속성 이미 일치)
                · 내부 UserAvatar: size 44→72, fontSize 24, fontWeight 300
              ← [2026-05-19 스타일 업데이트]
                · 컨테이너 borderRadius 16→24, padding 16px→12px
                · 내부 UserAvatar borderRadius 16 (정사각 라운드)
                · 내부 UserAvatar border 1px solid #f7f9fa */}
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:24, padding:'12px', width:320, boxShadow:'0 8px 32px rgba(0,0,0,0.16)', position:'relative' }}> {/* ← [2026-05-19] borderRadius 16→24, padding 16px→12px */}
            {/* ← [피그마 2026-04-22] ModalCloseButton sm (28×28) 공통화 */}
            <ModalCloseButton onClick={() => setOpen(false)} size="sm" style={{ position:'absolute', top:12, right:12 }} />
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <UserAvatar
                name={userInfo.name}
                avatarUrl={userInfo.avatar_url ?? null}
                size={72}                          /* ← [핫픽스 v16] 44 → 72 */
                fontSize={24}                      /* ← [핫픽스 v16] 자동 환산(36) → 24 명시 */
                fontWeight={300}                   /* ← [핫픽스 v16] 500 → 300 (Light) */
                borderRadius={16}                  /* ← [2026-05-19] 50%(원형) → 16(정사각 라운드) */
                border="1px solid #f7f9fa"         /* ← [2026-05-19] 테두리 추가 */
              />
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
