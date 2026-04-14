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
    <div className="sk-wrap" style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>

      {/* ── 행2: 오늘 예약 카드 × 3 (좌측 정렬, 고정 너비) ── */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <S w={200} h={160} r={18} />
        <S w={200} h={160} r={18} />
        <S w={200} h={160} r={18} />
      </div>

      {/* ── 행3: 층 필터 pill × 3 + 서치바 × 2 + 소형 pill ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
        {/* 층 필터 pills */}
        <S w={64}  h={32} r={999} />
        <S w={52}  h={32} r={999} />
        <S w={56}  h={32} r={999} />
        {/* 검색 바 (flex:1) */}
        <S h={32} r={999} style={{ flex: 1 }} />
        {/* 두 번째 바 (flex:1) */}
        <S h={32} r={999} style={{ flex: 1 }} />
        {/* 우측 소형 pill */}
        <S w={80} h={32} r={999} />
      </div>

      {/* ── 행4: 회의실 카드 3열 (full width) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        <S h={420} r={20} />
        <S h={420} r={20} />
        <S h={420} r={20} />
      </div>

    </div>
  )
}
