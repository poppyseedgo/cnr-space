import React from 'react'

const S = ({ w, h, r = 8, style = {} }: { w?: string|number, h: number, r?: number, style?: React.CSSProperties }) => (
  <div className="sk-block" style={{ width: w ?? '100%', height: h, borderRadius: r, flexShrink: 0, ...style }}/>
)

export function MyPageSkeleton() {
  return (
    <div className="sk-wrap" style={{ padding: '28px 24px', maxWidth: 960, margin: '0 auto' }}>
      {/* 프로필 카드 — 아바타 + 이름/부서 + 스탯 3개 */}
      <div style={{ background: '#fff', borderRadius: 16, padding: '24px 28px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 20 }}>
        <S w={56} h={56} r={999} style={{ flexShrink: 0 }}/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <S w={120} h={18} r={6}/>
          <S w={80}  h={13} r={6}/>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <S w={72} h={48} r={10}/>
          <S w={72} h={48} r={10}/>
          <S w={72} h={48} r={10}/>
        </div>
      </div>
    </div>
  )
}
