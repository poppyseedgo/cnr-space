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
    <div className="sk-wrap" style={{ padding: '20px 28px' }}>
      {/* 탭 + 날짜 네비 행 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <S w={80}  h={36} r={999} />
        <S w={60}  h={36} r={999} />
        <S w={60}  h={36} r={999} />
        <S h={36} r={999} />
      </div>

      {/* 타임라인 그리드 — 회의실명 + 시간 셀 × 4 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 헤더행: 비어있는 코너 + 시간 셀 */}
        <div style={{ display: 'flex', gap: 6 }}>
          <S w={100} h={44} r={8} />
          <S h={44} r={8} />
          <S h={44} r={8} />
          <S h={44} r={8} />
          <S h={44} r={8} />
        </div>
        {/* 회의실 행 × 3 */}
        {[0,1,2].map(i => (
          <div key={i} style={{ display: 'flex', gap: 6 }}>
            <S w={100} h={66} r={8} />
            <S h={66} r={8} />
            <S h={66} r={8} />
            <S h={66} r={8} />
            <S h={66} r={8} />
          </div>
        ))}
      </div>
    </div>
  )
}
