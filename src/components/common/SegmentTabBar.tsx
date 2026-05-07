/**
 * SegmentTabBar — 세그먼트 탭 + (옵션) 검색 + (옵션) CSV
 *
 * ✅ 변경 이력
 *  - [2026-05-07] 슬라이드 pill indicator 적용
 *    · 절대 포지션 pill이 탭 간 이동 시 left + width transition으로 슬라이딩
 *    · useRef로 각 버튼 실제 크기 측정 → 탭 라벨 길이 달라도 정확히 동작
 *    · ResizeObserver로 화면 크기 변경 시 indicator 위치 재계산
 *    · ready 플래그로 첫 측정 완료 전 pill 깜빡임 방지
 *  - [2026-05-07] roomFilterProps 옵션 추가 — MyPage 회의실 필터용 (Figma 488:363 우측 dropdown)
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

import { useState, useRef, useEffect, useCallback } from 'react'  // ← [2026-05-07] useCallback 추가
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

// ─── Room Filter Props (옵션) ─[2026-05-07]─────────────────────────────────
//   MyPage 회의실 필터용. CalendarShell의 dropdown과 동일한 구조 (Figma 487:859)
export interface RoomFilterRoom {
  room_id:    number
  room_name:  string
}
export interface RoomFilterProps {
  rooms:           RoomFilterRoom[]                    // 활성 회의실 목록
  selectedRoomId:  'ALL' | number                      // 'ALL' = 전체 회의실
  onRoomChange:    (id: 'ALL' | number) => void
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
  /** 회의실 필터 dropdown — 있으면 표시 [2026-05-07] (MyPage 전용) */
  roomFilterProps?: RoomFilterProps
}

// ─── Component ───────────────────────────────────────────────────────────────
export function SegmentTabBar<TTabId extends string = string>({
  tabs, activeTab, onTabChange,
  searchProps, onCsvClick, csvLabel = 'CSV',
  roomFilterProps,
}: SegmentTabBarProps<TTabId>) {
  // ── [2026-05-07] 회의실 dropdown 상태 (옵션) ──────────────────────────────
  const [showRoomDrop, setShowRoomDrop] = useState(false)
  const roomDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!roomFilterProps) return
    const h = (e: MouseEvent) => {
      if (roomDropRef.current && !roomDropRef.current.contains(e.target as Node)) setShowRoomDrop(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [roomFilterProps])

  const currentRoomLabel = roomFilterProps
    ? (roomFilterProps.selectedRoomId === 'ALL'
        ? '전체 회의실'
        : (roomFilterProps.rooms.find(r => r.room_id === roomFilterProps.selectedRoomId)?.room_name ?? '전체 회의실'))
    : ''

  // ── [2026-05-07] Sliding pill state ───────────────────────────────────────
  const tabRefs      = useRef<(HTMLButtonElement | null)[]>([])   // ← [2026-05-07] 각 버튼 DOM ref
  const containerRef = useRef<HTMLDivElement | null>(null)         // ← [2026-05-07] 탭 컨테이너 ref
  const [pill, setPill]   = useState({ left: 0, width: 0 })       // ← [2026-05-07] pill 위치/크기
  const [ready, setReady] = useState(false)                        // ← [2026-05-07] 첫 측정 완료 여부 (깜빡임 방지)

  /** 활성 탭 버튼 위치/크기 측정 → pill state 업데이트 */
  const measurePill = useCallback(() => {
    const activeIndex = tabs.findIndex(t => t.id === activeTab)
    const btn = tabRefs.current[activeIndex]
    if (!btn) return
    setPill({ left: btn.offsetLeft, width: btn.offsetWidth })      // ← [2026-05-07] 컨테이너 기준 offsetLeft
    setReady(true)
  }, [activeTab, tabs])

  // activeTab 변경 시 pill 이동
  useEffect(() => {
    measurePill()
  }, [measurePill])

  // 컨테이너 크기 변경 시 pill 재계산 (반응형 대응)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(measurePill)                     // ← [2026-05-07] ResizeObserver 재측정
    ro.observe(el)
    return () => ro.disconnect()
  }, [measurePill])

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 40,                                       // ← Figma: h 40
      gap: 16,
      flexWrap: 'wrap',                                  // ← 좁은 폭에서 줄바꿈
    }}>
      {/* 세그먼트 탭 컨테이너 (Figma node 451:3562) */}
      <div
        ref={containerRef}                               // ← [2026-05-07] ResizeObserver 대상
        style={{
          position: 'relative',                         // ← [2026-05-07] pill absolute 기준점
          display: 'flex', alignItems: 'flex-start', gap: 4,  // ← Figma: gap 4
          background: 'transparent',                    // ← [2026-05-06 사용자 요청] #F3F4F8 → transparent
          borderRadius: 9999,                            // ← Figma: rounded full
          overflow: 'hidden',
        }}>

        {/* Sliding pill indicator */}
        {ready && (                                      // ← [2026-05-07] 첫 측정 후 표시 (깜빡임 방지)
          <div style={{
            position: 'absolute',
            top: 0, bottom: 0,
            left: pill.left,                            // ← [2026-05-07] 측정된 left
            width: pill.width,                          // ← [2026-05-07] 측정된 width
            background: '#111',
            borderRadius: 9999,
            transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1), width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',  // ← [2026-05-07] 슬라이드 easing
            zIndex: 0,
            pointerEvents: 'none',
          }} />
        )}

        {tabs.map((t, i) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              ref={el => { tabRefs.current[i] = el }}  // ← [2026-05-07] 버튼별 ref 등록
              type="button"
              onClick={() => onTabChange(t.id)}
              style={{
                position: 'relative',                   // ← [2026-05-07] zIndex 적용
                zIndex: 1,                              // ← [2026-05-07] pill 위에 텍스트
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 16px',                   // ← Figma: py 12 px 16
                borderRadius: 9999,                     // ← Figma: rounded full
                border: 'none',
                fontFamily: 'inherit',
                fontSize: 14,                           // ← Figma: 14
                lineHeight: '16px',                     // ← Figma: leading 16
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: 'transparent',              // ← [2026-05-07] pill이 배경 담당
                color: active ? '#fff' : '#657487',     // ← Figma: 활성 white / 비활성 #657487
                transition: 'color 0.22s cubic-bezier(0.4, 0, 0.2, 1)',  // ← [2026-05-07] 색상 전환도 부드럽게
              }}>
              <span style={{ fontWeight: 500 }}>{t.label}</span>
              <span style={{ fontWeight: 400 }}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {/* 우측: 회의실 필터 + 검색 + CSV (Figma node 467:1244) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* ── [2026-05-07] 회의실 dropdown (옵션 — MyPage에만) ───────────────
             Figma 488:384: bg-#111 / pl-16 pr-12 py-12 / gap-4 / rounded-999 / 14 Regular #FFF
             dropdown 메뉴: Figma 487:859 1:1 */}
        {roomFilterProps && (
          <div ref={roomDropRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowRoomDrop(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                background: '#111', color: '#fff',
                paddingLeft: 16, paddingRight: 12, paddingTop: 10, paddingBottom: 10,  // ← [2026-05-07 v3] py 12→10 (사용자 요청)
                borderRadius: 999, border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 400,
                letterSpacing: 0.14, lineHeight: '16px', whiteSpace: 'nowrap',
              }}>
              {currentRoomLabel}
              {/* ← [2026-05-07 v2] Figma 1:1 새 arrow SVG (fill #D0D0D0) */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"
                style={{ transform: showRoomDrop ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <path d="M10.25 12.5625L6 8.3125L6.3125 8L10.25 11.9375L14.1875 8L14.5 8.3125L10.25 12.5625Z" fill="#D0D0D0"/>
              </svg>
            </button>

            {showRoomDrop && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 9999,
                background: '#fff', borderRadius: 16,
                boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                minWidth: 180, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* 첫 번째: 전체 회의실 (Figma MENU 1: pt-8 pb-4 px-8) */}
                <div style={{ paddingTop: 8, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 }}>
                  {(() => {
                    const isActive = roomFilterProps.selectedRoomId === 'ALL'
                    return (
                      <button
                        type="button"
                        onClick={() => { roomFilterProps.onRoomChange('ALL'); setShowRoomDrop(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', width: '100%',
                          paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                          borderRadius: 24, border: 'none', cursor: 'pointer',
                          background: isActive ? '#000' : 'transparent',
                          color:      isActive ? '#fff' : '#111',
                          fontFamily: 'inherit', fontSize: 12, fontWeight: 400,
                          letterSpacing: 0.12, lineHeight: 1.5, textAlign: 'left',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F3F4F8' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        전체 회의실
                      </button>
                    )
                  })()}
                </div>
                {/* 회의실 목록 (Figma MENU 2~17: px-8, 마지막은 pb-12) */}
                {roomFilterProps.rooms.map((r, i) => {
                  const isActive = roomFilterProps.selectedRoomId === r.room_id
                  const isLast   = i === roomFilterProps.rooms.length - 1
                  return (
                    <div key={r.room_id} style={{
                      paddingLeft: 8, paddingRight: 8,
                      paddingBottom: isLast ? 12 : 0,
                    }}>
                      <button
                        type="button"
                        onClick={() => { roomFilterProps.onRoomChange(r.room_id); setShowRoomDrop(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', width: '100%',
                          paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                          borderRadius: 24, border: 'none', cursor: 'pointer',
                          background: isActive ? '#000' : 'transparent',
                          color:      isActive ? '#fff' : '#111',
                          fontFamily: 'inherit', fontSize: 12, fontWeight: 400,
                          letterSpacing: 0.12, lineHeight: 1.5, textAlign: 'left',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#F3F4F8' }}
                        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                        {r.room_name}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

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
