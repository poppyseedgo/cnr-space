/**
 * SegmentTabBar — 세그먼트 탭 + (옵션) 검색 + (옵션) CSV
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase B] 신규 — MyBookingTable에서 추출, Admin 검색 input 옵션 추가
 *
 * 📌 사용 정책
 *  · controlled 컴포넌트 — activeTab/searchValue는 부모가 관리
 *  · 탭 정의는 props로 (도메인별 다름)
 *  · 검색 input: searchProps prop 있을 때만 표시 (Admin에만 사용)
 *  · CSV 버튼: onCsvClick prop 있을 때만 표시
 *
 * 📌 Figma 사양 (node 449:1774 / 451:3561)
 *  · h 40 / justify-content space-between
 *  · 좌측: 세그먼트 컨테이너
 *    - bg #F3F4F8 / rounded full / gap 4 / overflow hidden
 *    - 탭: padding 12×16 / 14 / 활성 #111 white / 비활성 #fff #657487
 *  · 우측: 검색 input (옵션) + CSV 버튼
 *    - 검색: rounded full / w 226 / SearchIcon 24 + placeholder
 *    - CSV: bg #fff / rounded full / padding 12×16 / 14 Medium #A5B3C4
 */

import { SearchIcon } from './Icons'

// ─── Tab 정의 ────────────────────────────────────────────────────────────────
export interface TabDef<TTabId extends string = string> {
  id:    TTabId
  label: string
  count: number
}

// ─── Search Props (옵션) ─────────────────────────────────────────────────────
export interface SearchProps {
  value:       string
  onChange:    (v: string) => void
  placeholder: string
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface SegmentTabBarProps<TTabId extends string = string> {
  tabs:         TabDef<TTabId>[]
  activeTab:    TTabId
  onTabChange:  (id: TTabId) => void
  /** 검색 input — 있으면 표시 (Admin에만) */
  searchProps?: SearchProps
  /** CSV 버튼 — 있으면 표시 */
  onCsvClick?:  () => void
  csvLabel?:    string  // 기본 'CSV'
}

// ─── Component ───────────────────────────────────────────────────────────────
export function SegmentTabBar<TTabId extends string = string>({
  tabs, activeTab, onTabChange,
  searchProps, onCsvClick, csvLabel = 'CSV',
}: SegmentTabBarProps<TTabId>) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 40,                                       // ← Figma: h 40
      gap: 16,
      flexWrap: 'wrap',                                  // ← 좁은 폭에서 줄바꿈
    }}>
      {/* 세그먼트 탭 컨테이너 (Figma node 451:3562) */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 4,  // ← Figma: gap 4
        background: '#F3F4F8',                              // ← Figma: bg #F3F4F8
        borderRadius: 9999,                                  // ← Figma: rounded full
        overflow: 'hidden',
      }}>
        {tabs.map(t => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 16px',                          // ← Figma: py 12 px 16
                borderRadius: 9999,                             // ← Figma: rounded full
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 14,                                   // ← Figma: 14
                lineHeight: '16px',                             // ← Figma: leading 16
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: active ? '#111'   : '#fff',         // ← Figma: 활성 #111 / 비활성 #fff
                color:      active ? '#fff'   : '#657487',      // ← Figma: 활성 white / 비활성 #657487
                transition: 'background 0.15s, color 0.15s',
              }}>
              <span style={{ fontWeight: 500 }}>{t.label}</span>
              <span style={{ fontWeight: 400 }}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {/* 우측: 검색 + CSV (Figma node 467:1244) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* 검색 input (옵션 — Admin에만) */}
        {searchProps && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fff',
            borderRadius: 9999,
            padding: '8px 16px 8px 12px',                    // ← Figma 467:1244: py 8 + 좌측 12, 우측 16
            width: 226,                                       // ← Figma: w 226
            height: 40,
          }}>
            <SearchIcon size={24}/>
            <input
              type="text"
              value={searchProps.value}
              onChange={e => searchProps.onChange(e.target.value)}
              placeholder={searchProps.placeholder}
              style={{
                flex: 1, minWidth: 0,
                border: 'none', outline: 'none', background: 'transparent',
                fontFamily: 'inherit',
                fontSize: 14, fontWeight: 400,
                color: '#111',
                lineHeight: '16px',
              }}
            />
          </div>
        )}

        {/* CSV 버튼 (옵션) */}
        {onCsvClick && (
          <button
            type="button"
            onClick={() => onCsvClick()}
            style={{
              background: '#fff',                              // ← Figma: bg #fff
              borderRadius: 9999,                               // ← Figma: rounded full
              padding: '12px 16px',                             // ← Figma: py 12 px 16
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 14, fontWeight: 500,                    // ← Figma: 14 Medium
              color: '#A5B3C4',                                 // ← Figma: #A5B3C4
              lineHeight: '16px',
              whiteSpace: 'nowrap',
            }}>{csvLabel}</button>
        )}
      </div>
    </div>
  )
}
