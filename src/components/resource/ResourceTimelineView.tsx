/**
 * ResourceTimelineView.tsx — 자원예약 타임라인뷰 (Phase 2B)
 *
 * 시안 확정 (2026-08-19):
 *  - 일 단위. 열=개체(헤더에 라벨+현재 상태·대여자), 세로=카테고리 운영시간 × slot_step
 *  - 사용시간 = 색 블록(예약중 파랑/사용중 분홍, 시작 slot 에 라벨)
 *  - 복수일 점유(사용일 다음날~반납일) = 하루 전체 분홍 음영 띠
 *  - 연체 점유(반납일 경과~오늘) = 빗금 띠
 *  - 빈 미래 슬롯 클릭 → 개체·날짜·시작시간 프리필 예약 모달 (부모 콜백)
 *  - 모바일: 시간축 열 sticky + 개체 열(108px) 가로 스와이프 / 데스크톱 열 유동(min 140px)
 *
 * 데이터: 표시 날짜가 바뀔 때 스스로 범위 로드 (loadResourceBookingsRange)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2B)
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppUser } from '../../types'
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../../types/resource'
import { loadResourceBookingsRange } from '../../lib/resourceApi'
import { fmtDueShort, fmtTimeShort } from '../../utils/resourceStatus'
import { ResourceName } from './ResourceIcon'  // ← [2026-08-21] 카테고리 SVG 아이콘 공통 표기

const FONT = "'Pretendard', -apple-system, sans-serif"
const OVERDUE_STRIPE =
  'repeating-linear-gradient(45deg,#FEE2E2,#FEE2E2 6px,#fff 6px,#fff 12px)'

interface Props {
  category:  ResourceCategory
  items:     ResourceItem[]          // 선택 카테고리의 비폐기 개체
  users:     AppUser[]
  date:      string                  // 'YYYY-MM-DD' (KST)
  isMobile:  boolean
  onDateChange: (d: string) => void
  /** 빈 미래 슬롯 클릭 — 예약 모달 프리필 */
  onSlotClick: (item: ResourceItem, startHM: string) => void
  showToast: (m: string) => void
  /** 리로드 트리거 — 예약 생성 후 부모가 증가시켜 재조회 유도 */
  reloadKey: number
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const DOW = ['일', '월', '화', '수', '목', '금', '토']
function fmtHeader(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${m}월 ${d}일 (${DOW[new Date(y, m - 1, d).getDay()]})`
}
/** 로컬(KST) 자정 Date */
function atLocal(ymd: string, hm = '00:00'): Date { return new Date(`${ymd}T${hm}:00`) }
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function ResourceTimelineView({
  category, items, users, date, isMobile, onDateChange, onSlotClick, showToast, reloadKey,
}: Props) {
  const [bookings, setBookings] = useState<ResourceBooking[]>([])

  useEffect(() => {
    let alive = true
    // 연체 띠가 과거 예약에서 나오므로 앞뒤 여유 14일 로드
    loadResourceBookingsRange(
      atLocal(shiftDate(date, -14)).toISOString(),
      atLocal(shiftDate(date, 1)).toISOString(),
    ).then(bs => { if (alive) setBookings(bs) })
      .catch(e => showToast(e instanceof Error ? e.message : '예약을 불러오지 못했습니다.'))
    return () => { alive = false }
  }, [date, reloadKey, showToast])

  const step  = category.slot_step_minutes
  const slots = useMemo(() => {
    const [oh, om] = category.open_time.slice(0, 5).split(':').map(Number)
    const [ch, cm] = category.close_time.slice(0, 5).split(':').map(Number)
    const out: string[] = []
    for (let t = oh * 60 + om; t < ch * 60 + cm; t += step)
      out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    return out
  }, [category, step])

  const now = new Date()
  const today = todayStr()

  const nameOf = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    return live?.name ?? b.user_name ?? b.user_email
  }
  const deptOf = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    return live?.dept ?? b.user_dept ?? ''
  }

  /** 열 헤더 요약 — 오늘 기준 홀더 */
  const headSummary = (item: ResourceItem): { text: string; color: string } => {
    if (item.status === 'maintenance') return { text: '점검중', color: '#64748B' }
    const holder = bookings.find(b => b.item_id === item.id && !b.returned_at
      && new Date(b.start_at) <= now && now < new Date(b.occupied_until))
    if (holder) return { text: `사용중 · ${nameOf(holder)}`, color: '#BE185D' }
    const overdue = bookings.find(b => b.item_id === item.id && !b.returned_at
      && now >= new Date(b.occupied_until))
    if (overdue) return { text: `연체 · ${nameOf(overdue)}`, color: '#B91C1C' }
    return { text: '예약가능', color: '#64748B' }
  }

  /** 표시 날짜의 셀 상태 계산 */
  type Cell =
    | { kind: 'empty'; past: boolean }
    | { kind: 'usage'; b: ResourceBooking; first: boolean }
    | { kind: 'occupied'; b: ResourceBooking; first: boolean }   // 반납 대기 풀데이
    | { kind: 'overdue'; b: ResourceBooking; first: boolean }    // 연체 풀데이 빗금
  const cellOf = (item: ResourceItem, hm: string, idx: number): Cell => {
    const slotStart = atLocal(date, hm)
    const slotEnd   = new Date(slotStart.getTime() + step * 60000)
    const mine = bookings.filter(b => b.item_id === item.id && !b.returned_at)

    // ① 사용시간 블록 (해당 날짜의 start~end 와 slot 겹침)
    const usage = mine.find(b => localDay(b.start_at) === date
      && new Date(b.start_at) < slotEnd && new Date(b.end_at) > slotStart)
    if (usage) return { kind: 'usage', b: usage, first: new Date(usage.start_at) >= slotStart || idx === 0 }

    // ② 복수일 점유 띠: 사용일 < date ≤ 반납일
    const occ = mine.find(b => localDay(b.start_at) < date && date <= b.return_due)
    if (occ) return { kind: 'occupied', b: occ, first: idx === 0 }

    // ③ 연체 띠: 반납일 < date ≤ 오늘, 미반납
    const od = mine.find(b => b.return_due < date && date <= today
      && now >= new Date(b.occupied_until))
    if (od) return { kind: 'overdue', b: od, first: idx === 0 }

    return { kind: 'empty', past: slotStart <= now }
  }

  const colW = isMobile ? 108 : 'minmax(140px, 1fr)'
  const rowH = 34
  const navBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D1D7E1',
    borderRadius: 8, padding: '4px 10px', fontSize: 12, fontFamily: FONT, cursor: 'pointer' }

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button style={navBtn} onClick={() => onDateChange(shiftDate(date, -1))} aria-label="이전 날짜">‹</button>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{fmtHeader(date)}</span>
        <button style={navBtn} onClick={() => onDateChange(shiftDate(date, 1))} aria-label="다음 날짜">›</button>
        {date !== today && <button style={{ ...navBtn, fontSize: 11 }} onClick={() => onDateChange(today)}>오늘</button>}
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10, background: '#fff' }}>
        <div style={{ display: 'grid',
                      gridTemplateColumns: `44px repeat(${items.length}, ${typeof colW === 'number' ? `${colW}px` : colW})`,
                      minWidth: isMobile ? 44 + items.length * 108 : undefined }}>
          {/* 헤더 행 */}
          <div style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 2,
                        borderBottom: '1px solid #E2E8F0' }} />
          {items.map(i => {
            const s = headSummary(i)
            return (
              <div key={`h${i.id}`}
                style={{ padding: '8px 4px', textAlign: 'center', borderBottom: '1px solid #E2E8F0',
                         borderLeft: '1px solid #F1F5F9' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  <ResourceName icon={category.icon} size={13}>{i.label}</ResourceName>{/* ← [2026-08-21] 아이콘 */}
                </div>
                <div style={{ fontSize: 11, color: s.color }}>{s.text}</div>
              </div>
            )
          })}

          {/* 슬롯 행 */}
          {slots.map((hm, idx) => (
            <FragmentRow key={hm} hm={hm} idx={idx} items={items} cellOf={cellOf}
              nameOf={nameOf} deptOf={deptOf} rowH={rowH} onSlotClick={onSlotClick}
              maintenanceGuard={i => i.status === 'maintenance'} />
          ))}
        </div>
      </div>

      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>
        분홍 음영 = 반납일까지 점유 · 빗금 = 연체 점유 · 빈 칸을 {isMobile ? '탭' : '클릭'}하면 그 시간으로 예약이 열립니다
      </p>
    </div>
  )
}

/* 행 렌더 — grid 는 평평하게 이어 붙인다 (React.Fragment 로 셀 나열) */
function FragmentRow({ hm, idx, items, cellOf, nameOf, deptOf, rowH, onSlotClick, maintenanceGuard }: {
  hm: string; idx: number; items: ResourceItem[]
  cellOf: (i: ResourceItem, hm: string, idx: number) => any
  nameOf: (b: ResourceBooking) => string
  deptOf: (b: ResourceBooking) => string
  rowH: number
  onSlotClick: (i: ResourceItem, hm: string) => void
  maintenanceGuard: (i: ResourceItem) => boolean
}) {
  const base: React.CSSProperties = { borderLeft: '1px solid #F1F5F9',
    borderTop: idx === 0 ? 'none' : '1px solid #F8FAFC', height: rowH, boxSizing: 'border-box' }
  return (
    <>
      <div style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 2,
                    padding: '2px 6px', color: '#94A3B8', fontSize: 10,
                    borderTop: idx === 0 ? 'none' : '1px solid #F8FAFC' }}>{hm}</div>
      {items.map(item => {
        if (maintenanceGuard(item))
          return <div key={item.id} style={{ ...base, background: '#F1F5F9' }} />
        const c = cellOf(item, hm, idx)
        if (c.kind === 'usage') {
          const inuse = new Date(c.b.start_at) <= new Date() && new Date() < new Date(c.b.end_at)
          return (
            <div key={item.id} style={{ ...base, padding: 2 }}>
              <div style={{ background: inuse ? '#FCE7F3' : '#CBECFF',
                            color: inuse ? '#BE185D' : '#111',
                            borderRadius: 6, height: '100%', boxSizing: 'border-box',
                            padding: '3px 6px', fontSize: 10, overflow: 'hidden' }}>
                {c.first && <>
                  {nameOf(c.b)}{deptOf(c.b) ? ` · ${deptOf(c.b)}` : ''}<br />
                  {fmtTimeShort(c.b.start_at)}~{fmtTimeShort(c.b.end_at)}
                  {c.b.return_due !== c.b.start_at.slice(0, 10) && <> · ~{fmtDueShort(c.b.return_due)} 반납</>}
                </>}
              </div>
            </div>
          )
        }
        if (c.kind === 'occupied')
          return (
            <div key={item.id} style={{ ...base, background: '#FDF2F8', padding: '2px 6px',
                                        fontSize: 10, color: '#BE185D' }}>
              {c.first && <>{nameOf(c.b)} · ~{fmtDueShort(c.b.return_due)} 반납 점유</>}
            </div>
          )
        if (c.kind === 'overdue')
          return (
            <div key={item.id} style={{ ...base, background: OVERDUE_STRIPE, padding: '2px 6px',
                                        fontSize: 10, color: '#B91C1C' }}>
              {c.first && <>{nameOf(c.b)} · {fmtDueShort(c.b.return_due)} 반납 연체</>}
            </div>
          )
        // empty
        return (
          <div key={item.id}
            role={c.past ? undefined : 'button'}
            onClick={() => { if (!c.past) onSlotClick(item, hm) }}
            style={{ ...base, cursor: c.past ? 'default' : 'pointer',
                     background: c.past ? '#FAFAFA' : '#fff' }}
            onMouseEnter={e => { if (!c.past) (e.currentTarget as HTMLElement).style.background = '#F5F9FF' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = c.past ? '#FAFAFA' : '#fff' }}
          />
        )
      })}
    </>
  )
}
