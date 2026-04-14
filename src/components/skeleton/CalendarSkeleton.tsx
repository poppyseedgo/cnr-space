import React from 'react'

const S = ({ w, h, r = 8, style = {} }: { w?: string|number, h: number, r?: number, style?: React.CSSProperties }) => (
  <div className="sk-block" style={{
    width: w ?? '100%',
    height: h,
    borderRadius: r,
    background: '#EDF0F7',
    flexShrink: 0,
    ...style,
  }} />
)

export function CalendarSkeleton() {
  return (
    <div className="sk-wrap" style={{ padding: '20px 28px', maxWidth: 1400, margin: '0 auto' }}>
      {/* 툴바 skeleton — h=64, pill tabs */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16,
        background: '#fff', borderRadius: 16, padding: '12px 18px', height: 64 }}>
        <S w={160} h={40} r={999} />
        <S w={220} h={33} r={8}   />
        <div style={{ flex: 1 }} />
        <S w={88}  h={32} r={999} />
        <S w={148} h={36} r={999} />
      </div>

      {/* 일간뷰 skeleton — 회의실 컬럼(224px) + 시간 그리드 */}
      <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', border: '1px solid #E2E8F0' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', padding: '10px 16px', gap: 8 }}>
          <S w={224} h={20} r={4} />
          {[0,1,2,3,4].map(i => <S key={i} w={160} h={20} r={4} />)}
        </div>
        {/* 회의실 행 × 4 */}
        {[0,1,2,3].map(i => (
          <div key={i} style={{ display: 'flex', borderBottom: '1px solid #F1F5F9', height: 80 }}>
            <div style={{ width: 224, flexShrink: 0, padding: '0 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
              <S w={100} h={13} r={4} />
              <S w={70}  h={11} r={4} />
            </div>
            {[0,1,2,3,4].map(j => (
              <div key={j} style={{ flex: 1, padding: 8 }}>
                {i === 1 && j === 1 && <S h={56} r={8} />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
