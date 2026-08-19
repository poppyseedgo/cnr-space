/**
 * ResourceCalendarView.tsx — 자원예약 월 캘린더뷰 (Phase 2B)
 *
 * 시안 확정 (2026-08-19):
 *  - 월 단위 조회 중심. 복수일 예약은 사용일~반납일 매일 표시(점유 가시화),
 *    연체는 반납일 다음날~오늘까지 이어서 표시
 *  - 전체/내 예약 토글
 *  - 데스크톱: 셀에 칩(최대 3 + n건) — 색: 사용일 파랑 / 점유 분홍 / 연체 빨강
 *  - 모바일: 점(최대 3) + 날짜 탭 시 하단 리스트 (데스크톱도 날짜 클릭 시 동일 리스트)
 *  - [이 날짜 타임라인 보기] → 부모 콜백으로 타임라인 전환
 *
 * 데이터: 표시 월이 바뀔 때 스스로 범위 로드 (loadResourceBookingsRange)
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2B)
 */

import { useEffect, useMemo, useState } from 'react'
import type { AppUser } from '../../types'
import type { ResourceBooking, ResourceItem } from '../../types/resource'
import { loadResourceBookingsRange } from '../../lib/resourceApi'
import { fmtDueShort, fmtTimeShort } from '../../utils/resourceStatus'

const FONT = "'Pretendard', -apple-system, sans-serif"

type DayMark = { b: ResourceBooking; kind: 'usage' | 'occupied' | 'overdue' }
const MARK_STYLE = {
  usage:    { bg: '#CBECFF', fg: '#111',    dot: '#60A5FA', label: '예약' },
  occupied: { bg: '#FCE7F3', fg: '#BE185D', dot: '#F472B6', label: '점유' },
  overdue:  { bg: '#FEE2E2', fg: '#B91C1C', dot: '#EF4444', label: '연체' },
} as const

interface Props {
  categoryItems: ResourceItem[]        // 선택 카테고리의 개체 (필터 기준)
  users:         AppUser[]
  authUserId:    string
  isMobile:      boolean
  onGoTimeline:  (date: string) => void
  showToast:     (m: string) => void
  reloadKey:     number
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function localDay(iso: string): string { return ymd(new Date(iso)) }

export function ResourceCalendarView({
  categoryItems, users, authUserId, isMobile, onGoTimeline, showToast, reloadKey,
}: Props) {
  const now = new Date()
  const [year, setYear]   = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())      // 0-based
  const [mineOnly, setMineOnly] = useState(false)
  const [selected, setSelected] = useState<string | null>(ymd(now))
  const [bookings, setBookings] = useState<ResourceBooking[]>([])

  useEffect(() => {
    let alive = true
    const from = new Date(year, month, -14)               // 이전 달 점유가 이번 달로 넘어오는 케이스
    const to   = new Date(year, month + 1, 1)
    loadResourceBookingsRange(from.toISOString(), to.toISOString())
      .then(bs => { if (alive) setBookings(bs) })
      .catch(e => showToast(e instanceof Error ? e.message : '예약을 불러오지 못했습니다.'))
    return () => { alive = false }
  }, [year, month, reloadKey, showToast])

  const itemIds = useMemo(() => new Set(categoryItems.map(i => i.id)), [categoryItems])
  const itemLabel = (id: number) => categoryItems.find(i => i.id === id)?.label ?? `#${id}`
  const nameOf = (b: ResourceBooking) => {
    const live = users.find(u => u.user_id === b.user_id)
    const name = live?.name ?? b.user_name ?? b.user_email
    const dept = live?.dept ?? b.user_dept
    return dept ? `${name} · ${dept}` : name
  }

  /** 날짜별 마크 — 사용일/점유일/연체일 확장 */
  const marksByDay = useMemo(() => {
    const map = new Map<string, DayMark[]>()
    const today = ymd(now)
    const push = (day: string, m: DayMark) => {
      const arr = map.get(day) ?? []
      arr.push(m); map.set(day, arr)
    }
    for (const b of bookings) {
      if (!itemIds.has(b.item_id)) continue
      if (mineOnly && b.user_id !== authUserId) continue
      const startDay = localDay(b.start_at)
      push(startDay, { b, kind: 'usage' })
      // 점유일: 사용일 다음날 ~ 반납일
      for (let d = new Date(`${startDay}T00:00:00`); ;) {
        d.setDate(d.getDate() + 1)
        const day = ymd(d)
        if (day > b.return_due) break
        push(day, { b, kind: 'occupied' })
      }
      // 연체일: 반납일 다음날 ~ 오늘
      if (!b.returned_at && now >= new Date(b.occupied_until)) {
        for (let d = new Date(`${b.return_due}T00:00:00`); ;) {
          d.setDate(d.getDate() + 1)
          const day = ymd(d)
          if (day > today) break
          push(day, { b, kind: 'overdue' })
        }
      }
    }
    return map
  }, [bookings, itemIds, mineOnly, authUserId, now])

  // 월 그리드 (월요일 시작)
  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const lead = (first.getDay() + 6) % 7                 // 월=0
    const out: { day: string | null; inMonth: boolean }[] = []
    for (let i = 0; i < lead; i++) out.push({ day: null, inMonth: false })
    const last = new Date(year, month + 1, 0).getDate()
    for (let d = 1; d <= last; d++) out.push({ day: ymd(new Date(year, month, d)), inMonth: true })
    while (out.length % 7 !== 0) out.push({ day: null, inMonth: false })
    return out
  }, [year, month])

  const move = (delta: number) => {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth()); setSelected(null)
  }

  const navBtn: React.CSSProperties = { background: '#fff', border: '1px solid #D1D7E1',
    borderRadius: 8, padding: '3px 9px', fontSize: 12, fontFamily: FONT, cursor: 'pointer' }
  const todayStr = ymd(now)
  const selMarks = selected ? (marksByDay.get(selected) ?? []) : []

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{year}년 {month + 1}월</span>
        <button style={navBtn} onClick={() => move(-1)} aria-label="이전 달">‹</button>
        <button style={navBtn} onClick={() => move(1)} aria-label="다음 달">›</button>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', background: '#fff', border: '1px solid #D1D7E1',
                       borderRadius: 8, overflow: 'hidden' }}>
          {[false, true].map(v => (
            <button key={String(v)} onClick={() => setMineOnly(v)}
              style={{ border: 'none', padding: '4px 12px', fontSize: 11, fontFamily: FONT, cursor: 'pointer',
                       background: mineOnly === v ? '#111' : 'transparent',
                       color: mineOnly === v ? '#fff' : '#111' }}>
              {v ? '내 예약' : '전체'}
            </button>
          ))}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                    background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
        {['월', '화', '수', '목', '금', '토', '일'].map((w, i) => (
          <div key={w} style={{ padding: 6, textAlign: 'center', fontSize: 11,
                                color: i >= 5 ? '#94A3B8' : '#64748B',
                                borderBottom: '1px solid #E2E8F0' }}>{w}</div>
        ))}
        {cells.map((c, i) => {
          const marks = c.day ? (marksByDay.get(c.day) ?? []) : []
          const isSel = c.day != null && c.day === selected
          const isToday = c.day === todayStr
          return (
            <div key={i}
              onClick={() => { if (c.day) setSelected(c.day) }}
              style={{ minHeight: isMobile ? 46 : 62, padding: 4, fontSize: 11, cursor: c.day ? 'pointer' : 'default',
                       borderRight: (i + 1) % 7 === 0 ? 'none' : '1px solid #F1F5F9',
                       borderTop: i >= 7 ? '1px solid #F1F5F9' : 'none',
                       background: isSel ? '#F1F5F9' : isToday ? '#F8FAFC' : '#fff',
                       color: (i % 7) >= 5 ? '#94A3B8' : '#111' }}>
              {c.day && <span style={{ fontWeight: isToday ? 600 : 400 }}>{Number(c.day.slice(8))}</span>}
              {isMobile ? (
                <div style={{ lineHeight: '8px', marginTop: 2 }}>
                  {marks.slice(0, 3).map((m, j) => (
                    <span key={j} style={{ color: MARK_STYLE[m.kind].dot, fontSize: 8, marginRight: 1 }}>●</span>
                  ))}
                </div>
              ) : (
                <>
                  {marks.slice(0, 3).map((m, j) => (
                    <div key={j} style={{ background: MARK_STYLE[m.kind].bg, color: MARK_STYLE[m.kind].fg,
                                          borderRadius: 5, padding: '1px 4px', marginTop: 2, fontSize: 10,
                                          overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {itemLabel(m.b.item_id)} {m.kind === 'usage'
                        ? nameOf(m.b).split(' · ')[0]
                        : MARK_STYLE[m.kind].label}
                    </div>
                  ))}
                  {marks.length > 3 && (
                    <div style={{ fontSize: 10, color: '#64748B', marginTop: 1 }}>+{marks.length - 3}건</div>)}
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* 선택 날짜 리스트 */}
      {selected && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{fmtDueShort(selected)}</span>
            <button style={{ ...navBtn, fontSize: 11 }} onClick={() => onGoTimeline(selected)}>
              이 날짜 타임라인 보기
            </button>
          </div>
          {selMarks.length === 0 ? (
            <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>이 날짜의 예약이 없습니다.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {selMarks.map((m, j) => (
                <div key={j} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8,
                                      padding: '6px 10px', fontSize: 12 }}>
                  <span style={{ background: MARK_STYLE[m.kind].bg, color: MARK_STYLE[m.kind].fg,
                                 borderRadius: 4, fontSize: 10, padding: '1px 5px', marginRight: 6 }}>
                    {m.kind === 'usage' ? '예약' : MARK_STYLE[m.kind].label}
                  </span>
                  {itemLabel(m.b.item_id)} · {nameOf(m.b)}{' '}
                  <span style={{ color: '#64748B' }}>
                    {m.kind === 'usage'
                      ? `${fmtTimeShort(m.b.start_at)}~${fmtTimeShort(m.b.end_at)}`
                      : `~${fmtDueShort(m.b.return_due)} 반납`}
                    {m.b.memo ? ` · ${m.b.memo}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
