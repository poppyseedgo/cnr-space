import React from 'react'

const S = ({ w, h, r = 12, style = {} }: { w?: string|number, h: number, r?: number, style?: React.CSSProperties }) => (
  <div className="sk-block" style={{
    width: w ?? '100%',
    height: h,
    borderRadius: r,
    background: '#EDF0F7',
    flexShrink: 0,
    ...style,
  }} />
)

export function HomeSkeleton() {
  return (
    <div className="sk-wrap" style={{ padding: '20px 28px' }}>
      {/* 상단 카드 3개 (오늘 내 예약 or 통계) */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <S w={180} h={150} r={16} />
        <S w={180} h={150} r={16} />
        <S w={200} h={150} r={16} />
      </div>

      {/* 필터 행: 층 pill × 3 + 검색 bar + 검색바2 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        <S w={52}  h={32} r={999} />
        <S w={40}  h={32} r={999} />
        <S w={40}  h={32} r={999} />
        <S w={360} h={32} r={999} />
        <S h={32} r={999} />
      </div>

      {/* 회의실 카드 3열 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <S h={390} r={20} />
        <S h={390} r={20} />
        <S h={390} r={20} />
      </div>
    </div>
  )
}
