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

export function MyPageSkeleton() {
  return (
    <div className="sk-wrap" style={{ padding: '20px 28px', maxWidth: 960, margin: '0 auto' }}>
      {/* 프로필 카드 */}
      <S h={120} r={16} style={{ marginBottom: 20 }} />
      {/* 기간 조회 섹션 */}
      <S h={220} r={16} style={{ marginBottom: 20 }} />
      {/* 월별 통계 섹션 */}
      <S h={280} r={16} />
    </div>
  )
}
