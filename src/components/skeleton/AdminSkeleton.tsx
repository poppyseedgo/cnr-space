import React from 'react'

const S = ({ w, h, r = 12, style = {} }: { w?: string|number, h: number, r?: number, style?: React.CSSProperties }) => (
  <div className="sk-block" style={{ width: w ?? '100%', height: h, borderRadius: r, flexShrink: 0, ...style }}/>
)

export function AdminSkeleton() {
  return (
    <div className="sk-wrap" style={{ padding: '20px 24px', maxWidth: 1200, margin: '0 auto' }}>

      {/* 탭 메뉴 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {[100, 88, 88, 96, 96].map((w, i) => (
          <S key={i} w={w} h={38} r={999} />
        ))}
      </div>

      {/* 날짜 필터 바 */}
      <S h={52} r={14} style={{ marginBottom: 12 }} />

      {/* KPI 카드 3개 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <S h={100} r={16} />
        <S h={100} r={16} />
        <S h={100} r={16} />
      </div>

      {/* 차트 행 1: 2열 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <S h={320} r={16} />
        <S h={320} r={16} />
      </div>

      {/* 차트 행 2: 2열 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <S h={240} r={16} />
        <S h={240} r={16} />
      </div>

      {/* 예약 추이 (full width) */}
      <S h={220} r={16} />

    </div>
  )
}
