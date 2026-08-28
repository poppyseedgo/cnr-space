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
 * 데이터: ← [2026-08-26] 부모(ResourcePage)가 한 번 로드한 범위 예약을 props 로 받는다 (3뷰 공유·자체 쿼리 제거)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2B)
 *  - [2026-08-26] 세로 스택 레이아웃 — bookings props 화, 사용 블록 클릭 → 상세 모달(onBookingClick)
 *  - [2026-08-27] 헤더·띠·블록 색 판정을 utils/resourceStatus SSOT 로 이관 (반납일 당일 연체 오표기·과거 사용블록 파랑 수정), 점유 띠 = occupied_until 날짜
 *  - [2026-08-27] 반납 확인 전 무조건 점유 — 당일 건 사용시간 뒤 점유 띠, 반납 완료 건 이력 유지(반납 시각까지 띠)
 *  - [2026-08-28] '반납됨' 규칙 통일 — 반납 완료 띠 회색(이력)·복수일 분기에도 반납 시각 컷 적용, 범례 갱신
 */

import { useMemo } from 'react'
import type { AppUser } from '../../types'
import type { ResourceBooking, ResourceCategory, ResourceItem } from '../../types/resource'
import { bookingDisplayStatus, currentHolderBooking, fmtDueShort, fmtTimeShort, isResourceOverdue, kstDay, occupiedUntilDay } from '../../utils/resourceStatus'   // ← [2026-08-27] 판정식 SSOT
import { ResourceName } from './ResourceIcon'  // ← [2026-08-21] 카테고리 SVG 아이콘 공통 표기

const FONT = "'Pretendard', -apple-system, sans-serif"
const OVERDUE_STRIPE =
  'repeating-linear-gradient(45deg,#FEE2E2,#FEE2E2 6px,#fff 6px,#fff 12px)'

interface Props {
  category:  ResourceCategory
  items:     ResourceItem[]          // 선택 카테고리의 비폐기 개체
  users:     AppUser[]
  date:      string                  // 'YYYY-MM-DD' (KST)
  /** ← [2026-08-26] 부모가 로드한 범위 예약 (confirmed) */
  bookings:  ResourceBooking[]
  isMobile:  boolean
  onDateChange: (d: string) => void
  /** 빈 미래 슬롯 클릭 — 예약 모달 프리필 */
  onSlotClick: (item: ResourceItem, startHM: string) => void
  /** ← [2026-08-26] 사용·점유·연체 블록 클릭 — 상세 모달 */
  onBookingClick: (b: ResourceBooking) => void
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
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
  category, items, users, date, bookings, isMobile, onDateChange, onSlotClick, onBookingClick,
}: Props) {

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
  const today = kstDay(now)   // ← [2026-08-27] KST 날짜 (time.ts 규약)

  const nameOf = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    return live?.name ?? b.user_name ?? b.user_email
  }
  const deptOf = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    return live?.dept ?? b.user_dept ?? ''
  }

  /** 열 헤더 요약 — 개체 판정 SSOT(점유 우선, 없으면 연체). 개체 카드 뱃지와 동일 ← [2026-08-27] */
  const headSummary = (item: ResourceItem): { text: string; color: string } => {
    if (item.status === 'maintenance') return { text: '점검중', color: '#64748B' }
    const holder = currentHolderBooking(bookings, item.id, now)
    if (!holder) return { text: '예약가능', color: '#64748B' }
    return isResourceOverdue(holder, now)
      ? { text: `연체 · ${nameOf(holder)}`, color: '#B91C1C' }
      : { text: `사용중 · ${nameOf(holder)}`, color: '#BE185D' }
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
    const mine = bookings.filter(b => b.item_id === item.id && b.status === 'confirmed')   // ← [2026-08-27] 반납 완료 건도 이력·점유 띠(반납 시각까지) 표시

    // ① 사용시간 블록 (해당 날짜의 start~end 와 slot 겹침)
    const usage = mine.find(b => localDay(b.start_at) === date
      && new Date(b.start_at) < slotEnd && new Date(b.end_at) > slotStart)
    if (usage) return { kind: 'usage', b: usage, first: new Date(usage.start_at) >= slotStart || idx === 0 }

    // ② 점유 띠 — 반납 확인 전까지 점유 (고지 확정 2026-08-27)
    //    ← [2026-08-28] 당일·복수일 분기 통합: 반납 확인된 건은 어느 날짜든 반납 시각 슬롯에서 컷
    //    (구: 복수일 분기가 날짜만 비교해 반납 후에도 하루 종일 띠가 남던 버그)
    const occ = mine.find(b => {
      const useDay = localDay(b.start_at)
      if (useDay > date) return false
      if (useDay === date && new Date(b.end_at) > slotStart) return false   // 사용시간 구간은 ① usage 담당
      if (date > occupiedUntilDay(b)) return false                          // 미반납=반납일까지 / 반납됨=반납일(그날)까지
      if (b.returned_at && localDay(b.returned_at) === date
          && new Date(b.returned_at) <= slotStart) return false             // 반납 시각 이후 슬롯은 빈칸(예약 가능)
      return true
    })
    if (occ) return { kind: 'occupied', b: occ, first: idx === 0 || (localDay(occ.start_at) === date && new Date(occ.end_at) > new Date(slotStart.getTime() - step * 60000)) }

    // ③ 연체 띠: 반납일 < date ≤ 오늘, 연체(SSOT — 점유 중 && 반납일 KST 경과) ← [2026-08-27]
    const od = mine.find(b => b.return_due < date && date <= today && isResourceOverdue(b, now))
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
              nameOf={nameOf} deptOf={deptOf} rowH={rowH} onSlotClick={onSlotClick} onBookingClick={onBookingClick}
              maintenanceGuard={i => i.status === 'maintenance'} />
          ))}
        </div>
      </div>

      <p style={{ margin: '8px 0 0', fontSize: 11, color: '#64748B' }}>
        분홍 음영 = 반납 확인 전 점유 · 빗금 = 연체 · 회색 = 반납 완료 이력 · 빈 칸을 {isMobile ? '탭' : '클릭'}하면 그 시간으로 예약이 열리고, 예약 블록을 {isMobile ? '탭' : '클릭'}하면 상세가 열립니다
      </p>
    </div>
  )
}

/* 행 렌더 — grid 는 평평하게 이어 붙인다 (React.Fragment 로 셀 나열) */
function FragmentRow({ hm, idx, items, cellOf, nameOf, deptOf, rowH, onSlotClick, onBookingClick, maintenanceGuard }: {
  hm: string; idx: number; items: ResourceItem[]
  cellOf: (i: ResourceItem, hm: string, idx: number) => any
  nameOf: (b: ResourceBooking) => string
  deptOf: (b: ResourceBooking) => string
  rowH: number
  onSlotClick: (i: ResourceItem, hm: string) => void
  onBookingClick: (b: ResourceBooking) => void
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
          // ← [2026-08-27] 블록 색 = 예약 판정 SSOT (예정 파랑 / 사용중 분홍 / 연체 빨강) — 열 헤더·카드와 정합
          const st = bookingDisplayStatus(c.b, new Date())
          const bg = st === 'overdue' ? '#FEE2E2' : st === 'inuse' ? '#FCE7F3' : st === 'returned' ? '#E2E8F0' : '#CBECFF'
          const fg = st === 'overdue' ? '#B91C1C' : st === 'inuse' ? '#BE185D' : st === 'returned' ? '#64748B' : '#111'
          return (
            <div key={item.id} style={{ ...base, padding: 2, cursor: 'pointer' }} role="button"
                 onClick={() => onBookingClick(c.b)}>{/* ← [2026-08-26] 상세 모달 */}
              <div style={{ background: bg, color: fg,
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
        if (c.kind === 'occupied') {
          // ← [2026-08-28] '반납됨' 통일 — 반납 완료 건은 회색 이력, 미반납만 분홍 점유 (색 = 예약 상태 SSOT)
          const ret = !!c.b.returned_at
          return (
            <div key={item.id} role="button" onClick={() => onBookingClick(c.b)}
                 style={{ ...base, background: ret ? '#F1F5F9' : '#FDF2F8', padding: '2px 6px',
                          fontSize: 10, color: ret ? '#64748B' : '#BE185D', cursor: 'pointer' }}>
              {c.first && <>{nameOf(c.b)} · {ret ? `${fmtTimeShort(c.b.returned_at!)} 반납 확인` : `~${fmtDueShort(c.b.return_due)} 반납 점유`}</>}
            </div>
          )
        }
        if (c.kind === 'overdue')
          return (
            <div key={item.id} role="button" onClick={() => onBookingClick(c.b)}
                 style={{ ...base, background: OVERDUE_STRIPE, padding: '2px 6px',
                          fontSize: 10, color: '#B91C1C', cursor: 'pointer' }}>
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
