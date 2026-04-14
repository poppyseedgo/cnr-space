import { useState, useEffect, useRef } from 'react'
import { SlotContent } from '../calendar/SlotContent'
import { getSlotState, getSlotColors } from '../calendar/slotHelpers'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { Calendar } from 'lucide-react'
import {
  todayStr, nowMinutes, tsDate, tsMin, fmtTS,
  fmt2, DAY_NAMES, MONTH_NAMES, HOURS,
  dateToObj, objToStr, addDays, getWeekStart,
} from '../../utils/time'
import { FLOORS, getFloor } from '../../data/floors'
import type { Booking, Room } from '../../types'

// ─── CalendarShell ────────────────────────────────────────────────────────────
export function CalendarShell({
  bookings, rooms: roomsProp = [], selectedDate, setSelectedDate,
  calView, setCalView, onBookingClick, onNewBooking, onCheckIn,
  filterFloor, setFilterFloor, currentUser = '',
}) {
  const { isMobile } = useBreakpoint()
  const VIEWS = [{ id: 'daily', label: '일' }, { id: 'weekly', label: '주' }, { id: 'monthly', label: '월' }]

  const navigate = (dir: number) => {
    if (calView === 'monthly') {
      const d = dateToObj(selectedDate); d.setMonth(d.getMonth() + dir); setSelectedDate(objToStr(d))
    } else if (calView === 'weekly') {
      setSelectedDate(addDays(selectedDate, dir * 7))
    } else {
      setSelectedDate(addDays(selectedDate, dir))
    }
  }

  const navLabel = () => {
    const d = dateToObj(selectedDate)
    if (calView === 'monthly') return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]}`
    if (calView === 'weekly') {
      const ws = getWeekStart(selectedDate), we = addDays(ws, 6)
      const wsd = dateToObj(ws), wed = dateToObj(we)
      if (wsd.getMonth() === wed.getMonth())
        return `${wsd.getFullYear()}년 ${MONTH_NAMES[wsd.getMonth()]} ${wsd.getDate()}일 – ${wed.getDate()}일`
      return `${MONTH_NAMES[wsd.getMonth()]} ${wsd.getDate()}일 – ${MONTH_NAMES[wed.getMonth()]} ${wed.getDate()}일`
    }
    return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`
  }

  const allRooms = roomsProp
  const filteredRooms = filterFloor === 'ALL'
    ? allRooms.filter(r => r.is_active)
    : allRooms.filter(r => r.is_active && r.floor_id === parseInt(filterFloor))
  const floorFilteredBks = filterFloor === 'ALL'
    ? bookings
    : bookings.filter(b => filteredRooms.some(r => r.room_id === b.room_id))

  // ── DatePicker ──
  const [showDatePicker, setShowDatePicker] = useState(false)
  const [dpYear, setDpYear]   = useState(() => dateToObj(selectedDate).getFullYear())
  const [dpMonth, setDpMonth] = useState(() => dateToObj(selectedDate).getMonth())
  const dpRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (dpRef.current && !dpRef.current.contains(e.target as Node)) setShowDatePicker(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  useEffect(() => {
    const d = dateToObj(selectedDate); setDpYear(d.getFullYear()); setDpMonth(d.getMonth())
  }, [selectedDate])

  const today = todayStr()
  const dpFirstDay    = new Date(dpYear, dpMonth, 1).getDay()
  const dpDaysInMonth = new Date(dpYear, dpMonth + 1, 0).getDate()
  const dpCells: (number | null)[] = []
  for (let i = 0; i < dpFirstDay; i++) dpCells.push(null)
  for (let i = 1; i <= dpDaysInMonth; i++) dpCells.push(i)
  while (dpCells.length % 7 !== 0) dpCells.push(null)

  // ── 층 드롭다운 ──
  const [showFloorDrop, setShowFloorDrop] = useState(false)
  const floorDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (floorDropRef.current && !floorDropRef.current.contains(e.target as Node)) setShowFloorDrop(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const currentFloorLabel = filterFloor === 'ALL'
    ? '전체 층'
    : (FLOORS.find(f => f.floor_id === parseInt(filterFloor))?.floor_name ?? '전체 층')
  const [filterMine, setFilterMine] = useState(false)
  const filteredBks = filterMine ? floorFilteredBks.filter(b => b.user === currentUser) : floorFilteredBks

  // ── 뷰별 데이터 ──
  const weekStart = getWeekStart(selectedDate)
  const weekBks = filteredBks.filter(b => {
    const d = tsDate(b.start_at)
    return d >= weekStart && d <= addDays(weekStart, 6)
  })
  const dailyBks = filteredBks.filter(b =>
    tsDate(b.start_at) === selectedDate &&
    (!b.autoCancelled || (b.cancelledBy === 'system' && b.status !== 'rejected'))
  )

  return (
    <div>
      {/* ── 툴바 ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 mb-4"
        style={{
          padding: isMobile ? '10px 12px' : '12px 18px', position: 'relative', zIndex: 50,
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          gap: isMobile ? 8 : 10, alignItems: isMobile ? 'stretch' : 'center',
        }}>

        {/* ① 뷰 탭 — 맨 앞 */}
        <div className="flex dark:bg-slate-700 rounded-xl p-0.5 gap-0.5 flex-shrink-0" style={{ background: '#F3F4F8' }}>
          {VIEWS.map(v => (
            <button key={v.id} className="btn rounded-lg font-semibold" onClick={() => setCalView(v.id)}
              style={{
                background: calView===v.id ? '#111111' : 'transparent',
                color:      calView===v.id ? '#fff'    : '#64748B',
                padding: isMobile ? '6px 10px' : '7px 14px',
                fontSize: isMobile ? 11 : 12, whiteSpace: 'nowrap',
              }}>{v.label}</button>
          ))}
        </div>

        {/* ② 날짜 네비 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: isMobile ? 'none' : 1 }}>
          <button className="btn dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg flex-shrink-0"
            style={{ padding: '7px 12px', fontSize: 18, background: '#F3F4F8', lineHeight: 1 }}
            onClick={() => navigate(-1)}>‹</button>

          {calView === 'daily' ? (
            <div ref={dpRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <button className="btn dark:bg-slate-700 rounded-lg"
                onClick={() => setShowDatePicker(v => !v)}
                style={{
                  width: '100%', padding: '6px 12px', background: '#F3F4F8', whiteSpace: 'nowrap',
                  border: showDatePicker ? '1px solid #111111' : '1px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: isMobile ? 13 : 15, fontWeight: 600, color: '#111111' }}>
                  <Calendar size={14} strokeWidth={1.8} /> {selectedDate} ({DAY_NAMES[dateToObj(selectedDate).getDay()]})
                </span>
              </button>
              {showDatePicker && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 9999,
                  background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 14, minWidth: 260,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <button className="btn" onClick={e => { e.stopPropagation(); dpMonth === 0 ? (setDpYear(y => y-1), setDpMonth(11)) : setDpMonth(m => m-1) }}
                      style={{ background: 'none', color: '#111111', padding: '4px 10px', fontSize: 16 }}>‹</button>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111111' }}>{dpYear}년 {MONTH_NAMES[dpMonth]}</span>
                    <button className="btn" onClick={e => { e.stopPropagation(); dpMonth === 11 ? (setDpYear(y => y+1), setDpMonth(0)) : setDpMonth(m => m+1) }}
                      style={{ background: 'none', color: '#111111', padding: '4px 10px', fontSize: 16 }}>›</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
                    {DAY_NAMES.map((n, i) => (
                      <div key={n} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, padding: '2px 0',
                        color: i===0 ? '#EF4444' : i===6 ? '#3B82F6' : '#94A3B8' }}>{n}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                    {dpCells.map((day, idx) => {
                      if (!day) return <div key={`e${idx}`} />
                      const ds = `${dpYear}-${fmt2(dpMonth+1)}-${fmt2(day)}`
                      const isSel = ds === selectedDate, isToday2 = ds === today
                      const dow = (dpFirstDay + day - 1) % 7
                      return (
                        <div key={day} onClick={() => { setSelectedDate(ds); setShowDatePicker(false) }}
                          style={{
                            textAlign: 'center', padding: '5px 2px', borderRadius: 6,
                            fontSize: 12, fontWeight: isSel||isToday2 ? 700 : 400, cursor: 'pointer',
                            background: isSel ? '#111111' : isToday2 ? '#EFF6FF' : 'transparent',
                            color: isSel ? '#fff' : isToday2 ? '#3B82F6' : dow===0 ? '#EF4444' : dow===6 ? '#3B82F6' : '#374151',
                          }}
                          onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = '#F1F5F9' }}
                          onMouseLeave={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = isToday2 ? '#EFF6FF' : 'transparent' }}>
                          {day}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #F1F5F9', textAlign: 'center' }}>
                    <button className="btn" onClick={() => { setSelectedDate(today); setShowDatePicker(false) }}
                      style={{ background: '#111111', color: '#fff', padding: '5px 16px', fontSize: 11, borderRadius: 8 }}>오늘로 이동</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="font-semibold text-slate-900 dark:text-white whitespace-nowrap"
              style={{ fontSize: isMobile ? 13 : 15, flex: 1 }}>{navLabel()}</span>
          )}

          <button className="btn dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg flex-shrink-0"
            style={{ padding: '7px 12px', fontSize: 18, background: '#F3F4F8', lineHeight: 1 }}
            onClick={() => navigate(1)}>›</button>
          {selectedDate !== today && (
            <button className="btn rounded-lg flex-shrink-0"
              style={{ padding: '5px 10px', fontSize: 11, background: '#111111', color: '#fff' }}
              onClick={() => setSelectedDate(today)}>오늘</button>
          )}
        </div>

        {/* ③ 층 드롭다운 — 항상 블랙 (어떤 층이든 선택된 상태) */}
        <div ref={floorDropRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button className="btn rounded-xl font-semibold" onClick={() => setShowFloorDrop(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: isMobile ? '5px 10px' : '6px 14px',
              fontSize: isMobile ? 11 : 12, whiteSpace: 'nowrap',
              background: '#111111', color: '#fff',
            }}>
            {currentFloorLabel}
            <span style={{ fontSize: 9, opacity: 0.7 }}>{showFloorDrop ? '▲' : '▼'}</span>
          </button>
          {showFloorDrop && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 9999,
              background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
              boxShadow: '0 8px 24px rgba(0,0,0,0.10)', padding: 6, minWidth: 110,
            }}>
              {([{ id: 'ALL', label: '전체 층' }, ...FLOORS.map(f => ({ id: f.floor_id, label: f.floor_name }))] as { id: any; label: string }[]).map(f => {
                const isActive = filterFloor === (f.id === 'ALL' ? 'ALL' : f.id)
                return (
                  <button key={f.id} className="btn"
                    onClick={() => { setFilterFloor(f.id === 'ALL' ? 'ALL' : f.id); setShowFloorDrop(false) }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '8px 12px', fontSize: 12, borderRadius: 8,
                      background: isActive ? '#111111' : 'transparent',
                      color:      isActive ? '#fff'    : '#374151',
                    }}
                    onMouseEnter={e => { if (!isActive) (e.target as HTMLElement).style.background = '#F3F4F8' }}
                    onMouseLeave={e => { if (!isActive) (e.target as HTMLElement).style.background = 'transparent' }}>
                    {f.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ④ 전체예약/내예약 필터 */}
        <div className="flex dark:bg-slate-700 rounded-xl p-0.5 gap-0.5 flex-shrink-0" style={{ background: '#F3F4F8' }}>
          {([{ v: false, l: '전체 예약' }, { v: true, l: '내 예약' }] as const).map(({ v, l }) => (
            <button key={l} className="btn rounded-lg font-semibold" onClick={() => setFilterMine(v)}
              style={{
                background: filterMine===v ? '#111111' : 'transparent',
                color:      filterMine===v ? '#fff'    : '#64748B',
                padding: isMobile ? '5px 10px' : '6px 14px',
                fontSize: isMobile ? 11 : 12, whiteSpace: 'nowrap',
              }}>{l}</button>
          ))}
        </div>
      </div>

      {calView === 'monthly' && <MonthlyView bookings={filteredBks} selectedDate={selectedDate} onDayClick={d => { setSelectedDate(d); setCalView('daily') }} onBookingClick={onBookingClick} rooms={allRooms} currentUser={currentUser} />}
      {calView === 'daily'   && <DailyView   bookings={dailyBks}  selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(rid, h) => onNewBooking(selectedDate, h, rid)} onCheckIn={onCheckIn} rooms={allRooms} currentUser={currentUser} />}
      {calView === 'weekly'  && <WeeklyView  bookings={weekBks}   selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(d, h) => onNewBooking(d, h, undefined)} rooms={allRooms} currentUser={currentUser} />}
    </div>
  )
}

// ─── Monthly View ─────────────────────────────────────────────────────────────
export function MonthlyView({ bookings, selectedDate, onDayClick, onBookingClick, rooms: mvRooms = [], currentUser = '' }) {
  const d = dateToObj(selectedDate), year = d.getFullYear(), month = d.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const dim = new Date(year, month + 1, 0).getDate()
  const today = todayStr()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= dim; i++) cells.push(i)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
        {DAY_NAMES.map((n, i) => (
          <div key={n} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight: 700,
            color: i===0 ? '#EF4444' : i===6 ? '#3B82F6' : '#64748B' }}>{n}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} style={{ minHeight: 110, borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', background: '#FAFAFA', overflow: 'hidden' }} />
          const ds = `${year}-${fmt2(month+1)}-${fmt2(day)}`
          const dbs = bookings.filter(b => tsDate(b.start_at) === ds && !b.autoCancelled)
          const isToday = ds === today, isSel = ds === selectedDate
          const dow = (firstDay + day - 1) % 7
          return (
            <div key={day} onClick={() => onDayClick(ds)}
              style={{
                minHeight: 110, borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9',
                padding: '7px 6px', cursor: 'pointer', overflow: 'hidden',
                background: isSel ? '#EEF2FF' : isToday ? '#F0FDF4' : '#fff', transition: 'background 0.12s',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 800 : 500,
                  background: isToday ? '#111111' : 'transparent',
                  color: isToday ? '#fff' : dow===0 ? '#EF4444' : dow===6 ? '#3B82F6' : '#374151',
                }}>{day}</span>
                {dbs.length > 0 && <span style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>{dbs.length}건</span>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dbs.slice(0, 3).map(b => {
                  const r = (mvRooms as any[]).find(r => r.room_id === b.room_id)
                  if (!r) return null
                  const isMyBk = currentUser && b.user === currentUser
                  return (
                    <div key={b.id} onClick={e => { e.stopPropagation(); onBookingClick(b) }}
                      style={{
                        background: isMyBk ? r.color+'30' : r.color+'18',
                        borderLeft: isMyBk ? '3px solid #111' : `2px solid ${r.color}`,
                        borderRadius: 3, padding: '2px 5px', fontSize: 10, color: r.color,
                        fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', cursor: 'pointer',
                      }}>
                      {fmtTS(b.start_at)} {b.title}
                    </div>
                  )
                })}
                {dbs.length > 3 && <div style={{ fontSize: 9, color: '#94A3B8', paddingLeft: 3 }}>+{dbs.length-3}개</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Daily View ───────────────────────────────────────────────────────────────
export function DailyView({ bookings, selectedDate, onBlockClick, onEmptyClick, onCheckIn, rooms: dvRooms = [], currentUser = '' }) {
  const isToday = selectedDate === todayStr(), now = nowMinutes()
  const CW = 160, RH = 80, LW = 148
  const rooms = (dvRooms as any[]).filter(r => r.is_active)
  const totalW = CW * HOURS.length

  const nowLeft = isToday ? ((now - 7*60) / 60) * CW : 0
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollLeft = isToday ? Math.max(0, nowLeft - 120) : 0
  }, [selectedDate, isToday, nowLeft])

  // 회의실 현재 상태 dot (오늘만)
  const getRoomDot = (roomId: number): 'busy' | 'available' | null => {
    if (!isToday) return null
    const busy = bookings.some(b =>
      b.room_id === roomId && !b.autoCancelled && !b.earlyEnded &&
      tsMin(b.start_at) <= now && now < tsMin(b.end_at)
    )
    return busy ? 'busy' : 'available'
  }

  return (
    <div ref={scrollRef} style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflowX: 'auto', overflowY: 'visible' }}>
      <div style={{ minWidth: LW + totalW, position: 'relative' }}>

        {/* 현재 시간 세로선 */}
        {isToday && nowLeft >= 0 && (
          <div style={{ position: 'absolute', top: 48, bottom: 0, left: LW + nowLeft, width: 2, background: '#EF4444', zIndex: 8, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
              fontSize: 10, fontWeight: 700, color: '#EF4444', background: '#fff',
              padding: '2px 4px', borderRadius: 4, whiteSpace: 'nowrap' }}>
              {fmt2(Math.floor(now/60))}:{fmt2(now%60)}
            </div>
          </div>
        )}

        {/* 헤더: 시간축 */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 9, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ width: LW, minWidth: LW, flexShrink: 0, borderRight: '1px solid #E2E8F0',
            padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94A3B8',
            position: 'sticky', left: 0, zIndex: 9, background: '#F8FAFC' }}>회의실</div>
          {HOURS.map(h => (
            <div key={h} style={{ width: CW, minWidth: CW, textAlign: 'center', padding: '10px 0',
              fontSize: 11, fontWeight: 600, color: '#64748B',
              borderRight: '1px solid #E2E8F0', flexShrink: 0, background: '#F8FAFC' }}>
              {h < 12 ? `오전 ${h}` : h === 12 ? '정오' : `오후 ${h-12}`}시
            </div>
          ))}
        </div>

        {/* 바디: 회의실별 행 */}
        {rooms.map((room, ri) => {
          const floor = getFloor(room.floor_id)
          const rBks = bookings.filter(b => b.room_id === room.room_id && !b.autoCancelled)
          const rBksCancelled = bookings.filter(b =>
            b.room_id === room.room_id && b.autoCancelled &&
            b.cancelledBy === 'system' && b.status !== 'rejected'
          )
          const dot = getRoomDot(room.room_id)

          return (
            <div key={room.room_id}
              style={{ display: 'flex', borderBottom: ri < rooms.length-1 ? '1px solid #F1F5F9' : 'none',
                height: RH, minHeight: RH, maxHeight: RH, position: 'relative' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>

              {/* 회의실명 셀 (sticky left) */}
              <div style={{ width: LW, minWidth: LW, flexShrink: 0, borderRight: '1px solid #E2E8F0',
                padding: '0 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
                position: 'sticky', left: 0, background: '#fff', zIndex: 5,
                boxShadow: '2px 0 6px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {dot && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: dot === 'busy' ? '#EF4444' : '#22C55E',
                    }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.room_name}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{floor?.floor_name} · {room?.capacity}인</div>
                  </div>
                </div>
              </div>

              {/* 시간 셀 */}
              <div style={{ flex: 1, position: 'relative', height: RH, display: 'flex', overflow: 'hidden' }}>
                {HOURS.map(h => (
                  <div key={h} onClick={() => onEmptyClick(room.room_id, h)}
                    style={{ width: CW, minWidth: CW, flexShrink: 0, borderRight: '1px solid #F1F5F9', cursor: 'pointer', position: 'relative', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(30,41,59,0.04)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: '25%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px dashed #F1F5F9', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: '75%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />
                  </div>
                ))}

                {/* 현재 시간선 */}
                {isToday && (() => {
                  const left = ((now-7*60)/60)*CW
                  if (left < 0 || left > totalW) return null
                  return (
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left, width: 2, background: '#EF4444', zIndex: 5, pointerEvents: 'none' }}>
                      {ri === 0 && <div style={{ position: 'absolute', top: 4, left: -4, width: 10, height: 10, borderRadius: '50%', background: '#EF4444' }} />}
                    </div>
                  )
                })()}

                {/* 노쇼 슬롯 */}
                {rBksCancelled.map(b => {
                  const sm = tsMin(b.start_at), em = tsMin(b.end_at)
                  const left = ((sm-7*60)/60)*CW+2, width = Math.max(((em-sm)/60)*CW-4, 20)
                  return (
                    <div key={b.id} onClick={e => { e.stopPropagation(); onBlockClick(b) }}
                      style={{ position: 'absolute', top: 6, bottom: 6, left, width,
                        background: '#F1F5F9', border: '1px dashed #D1D5DB', borderRadius: 5,
                        padding: '2px 5px', cursor: 'pointer', opacity: 0.5, overflow: 'hidden', zIndex: 1 }}>
                      <span style={{ display: 'inline-block', background: '#FEF3C7', color: '#92400E',
                        fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 2 }}>노쇼</span>
                    </div>
                  )
                })}

                {/* 예약 블록 */}
                {rBks.map(b => {
                  const sm = tsMin(b.start_at), em = tsMin(b.end_at)
                  const left = ((sm-7*60)/60)*CW+2, width = Math.max(((em-sm)/60)*CW-4, 20)
                  const isNoshow = b.autoCancelled && b.cancelledBy === 'system' && b.status !== 'rejected'
                  const isEnded  = b.earlyEnded
                  const isAct    = isToday && sm <= now && now < em && !isNoshow && !isEnded
                  const { isMyBooking } = getSlotState(b, now, isToday, currentUser)
                  const { titleColor, subColor } = getSlotColors({ variant: 'daily', isAct, isEnded, isNoshow })
                  const slotRoom = (dvRooms as any[]).find(r => r.room_id === b.room_id)
                  return (
                    <div key={b.id} onClick={e => { e.stopPropagation(); onBlockClick(b) }}
                      style={{
                        position: 'absolute', top: 6, bottom: 6, left, width,
                        background: isNoshow ? '#F1F5F9' : isEnded ? '#E2E8F0' : '#111111',
                        border: `1.5px solid ${isNoshow?'#E2E8F0':isEnded?'#CBD5E1':isAct?'#000':'#334155'}`,
                        borderRadius: 8, padding: '5px 8px', cursor: 'pointer',
                        zIndex: isNoshow ? 1 : isAct ? 5 : 3, overflow: 'hidden',
                        boxShadow: isMyBooking&&!isNoshow&&!isEnded
                          ? '0 0 0 2px #fff, 0 0 0 3.5px #111, 0 2px 8px rgba(0,0,0,0.15)'
                          : isAct ? '0 0 0 2px #EF4444, 0 2px 8px rgba(0,0,0,0.2)'
                          : isNoshow||isEnded ? 'none' : '0 1px 4px rgba(0,0,0,0.15)',
                        opacity: isNoshow ? 0.45 : isEnded ? 0.55 : 1, transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { if (!isNoshow && !isEnded) (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none' }}>
                      <SlotContent booking={b} room={slotRoom} isAdminRoom={!!slotRoom?.is_admin_only} currentUser={currentUser}
                        titleColor={titleColor} subColor={subColor} gap={1.5} thirdLine={b.user} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Weekly View ──────────────────────────────────────────────────────────────
export function WeeklyView({ bookings, selectedDate, onBlockClick, onEmptyClick, rooms = [], currentUser = '' }) {
  const today     = todayStr()
  const now       = nowMinutes()
  const HOUR_H    = 140   // 1시간 행 높이 (Figma 스펙)
  const TIME_W    = 64    // 시간 레이블 열 너비

  const weekStart = getWeekStart(selectedDate)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const firstHour = HOURS[0]
  const nowPx = (now / 60 - firstHour) * HOUR_H
  const weekContainsToday = days.includes(today)

  const scrollRef = useRef<HTMLDivElement>(null)
  const todayColRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = Math.max(0, nowPx - 200)
  }, [weekStart])

  const getCellBks = (day: string, hour: number) =>
    bookings.filter(b => {
      if (tsDate(b.start_at) !== day) return false
      if (b.autoCancelled) return false
      if (b.status === 'rejected') return false
      return Math.floor(tsMin(b.start_at) / 60) === hour
    })

  const fmtAmPm = (ts: string) => {
    const m = tsMin(ts), h = Math.floor(m / 60), min = m % 60
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h < 12 ? '오전' : '오후'} ${h12}:${fmt2(min)}`
  }

  // 요일별 색상
  const dayColor = (dow: number, isToday2: boolean) => {
    if (dow === 0) return '#EF4444'
    if (dow === 6) return '#3B82F6'
    return '#333333'
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
      <div ref={scrollRef} style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 180px)', overflowX: 'auto' }}>
        <div style={{ minWidth: TIME_W + days.length * 140, position: 'relative' }}>

          {/* ── 요일 헤더 (sticky top) ── */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10,
            background: '#fff', borderBottom: '2px solid #E2E8F0' }}>
            {/* 코너 */}
            <div style={{ width: TIME_W, minWidth: TIME_W, flexShrink: 0,
              borderRight: '1px solid #E2E8F0', position: 'sticky', left: 0,
              zIndex: 11, background: '#fff' }} />
            {/* 요일 컬럼 */}
            {days.map((ds, i) => {
              const d      = dateToObj(ds)
              const dow    = d.getDay()
              const isToday2 = ds === today
              const color  = dayColor(dow, isToday2)
              const fw     = isToday2 ? 600 : 400
              return (
                <div key={ds} style={{
                  flex: 1, minWidth: 0, textAlign: 'center',
                  padding: '12px 4px 10px',
                  borderRight: i < days.length - 1 ? '1px solid #E2E8F0' : 'none',
                  background: isToday2 ? '#EFF6FF' : 'transparent',
                }}>
                  {/* 요일명: 토#3B82F6 / 일#EF4444 / 평일#333 / 오늘fw600 */}
                  <div style={{ fontSize: 12, fontWeight: fw, color, lineHeight: 1.5,
                    fontFamily: "'Pretendard', -apple-system, sans-serif" }}>
                    {['일','월','화','수','목','금','토'][dow]}
                  </div>
                  {/* N월 N일: 동일 색상 체계 */}
                  <div style={{ fontSize: 12, fontWeight: fw, color, marginTop: 3,
                    fontFamily: "'Pretendard', -apple-system, sans-serif" }}
                    ref={isToday2 ? todayColRef : undefined}>
                    {d.getMonth()+1}월 {d.getDate()}일
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── 그리드 바디 ── */}
          <div style={{ position: 'relative' }} id="weekly-body">
            {/* 현재시간 인디케이터 — flex 구조로 열과 동일하게 움직임 */}
            {weekContainsToday && nowPx >= 0 && nowPx <= HOURS.length * HOUR_H && (
              <div style={{
                position: 'absolute', left: 0, right: 0,
                top: nowPx - 9,   /* pill 높이(19px) 절반 중앙 정렬 */
                height: 19, zIndex: 8, pointerEvents: 'none',
                display: 'flex', alignItems: 'center',
              }}>
                {/* 시간 레이블 열: pill */}
                <div style={{ width: TIME_W, minWidth: TIME_W, flexShrink: 0,
                  display: 'flex', alignItems: 'center', paddingLeft: 4 }}>
                  <div style={{ height: 19, padding: '0 8px', background: '#FF393C',
                    borderRadius: 24, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>
                      {fmt2(Math.floor(now/60))}:{fmt2(now%60)}
                    </span>
                  </div>
                </div>
                {/* 요일 열: 각 열이 자기 영역의 라인을 직접 그림 → flex:1 변화에 자동 추적 */}
                {days.map((ds, i) => {
                  const isToday2 = ds === today
                  return (
                    <div key={ds} style={{ flex: 1, minWidth: 0, position: 'relative', height: 19,
                      borderRight: i < days.length - 1 ? '1px solid transparent' : 'none' }}>
                      {/* week line — 모든 열: #FFCACA 연한 라인 */}
                      <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 2, background: '#FFCACA' }} />
                      {/* today dot + line — 오늘 열만: #FF393C 진한 라인 + dot */}
                      {isToday2 && (
                        <>
                          <div style={{
                            position: 'absolute', left: -5, top: 4,
                            width: 10, height: 10, borderRadius: '50%',
                            background: '#FF373B', border: '1.5px solid #fff', zIndex: 4,
                          }} />
                          <div style={{ position: 'absolute', left: 0, right: 0, top: 8, height: 2, background: '#FF393C', zIndex: 3 }} />
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* 시간 행 */}
            {HOURS.map(h => (
              <div key={h} style={{ display: 'flex', borderBottom: '1px solid #F1F5F9', minHeight: HOUR_H }}>
                {/* 시간 레이블 (sticky left) */}
                <div style={{
                  width: TIME_W, minWidth: TIME_W, flexShrink: 0,
                  padding: '8px 10px 0 0', textAlign: 'right', alignSelf: 'flex-start',
                  fontSize: 11, fontWeight: 400, color: '#333333',
                  borderRight: '1px solid #E2E8F0',
                  position: 'sticky', left: 0, background: '#fff', zIndex: 5,
                }}>
                  {h < 12 ? `오전 ${h}시` : h === 12 ? '오후 12시' : `오후 ${h-12}시`}
                </div>

                {/* 요일 셀 */}
                {days.map((ds, i) => {
                  const isToday2 = ds === today
                  const cellBks  = getCellBks(ds, h)
                  const visible  = cellBks.slice(0, 5)
                  const overflow = cellBks.length - 5
                  return (
                    <div key={ds}
                      onClick={() => onEmptyClick(ds, h)}
                      style={{
                        flex: 1, minWidth: 0, padding: '4px 5px',
                        borderRight: i < days.length - 1 ? '1px solid #F1F5F9' : 'none',
                        cursor: 'pointer',
                        background: isToday2 ? '#FAFEFF' : 'transparent',
                        minHeight: HOUR_H, transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (visible.length === 0) (e.currentTarget as HTMLElement).style.background = isToday2 ? '#F0FEFF' : '#F8FAFC' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isToday2 ? '#FAFEFF' : 'transparent' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible.map(b => (
                          <div key={b.id}
                            onClick={e => { e.stopPropagation(); onBlockClick(b) }}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5,
                              height: 20, padding: '0 8px', borderRadius: 6,
                              background: isToday2 ? '#1F232A' : '#E7E7E7',
                              color:      isToday2 ? '#FFFFFF' : '#1F232A',
                              cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                            }}>
                            <span style={{ fontSize: 10, fontWeight: 400, flexShrink: 0, opacity: 0.7, whiteSpace: 'nowrap' }}>
                              {fmtAmPm(b.start_at)}
                            </span>
                            <span style={{ fontSize: 10, fontWeight: 500, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 1 }}>
                              {b.title}
                            </span>
                          </div>
                        ))}
                        {overflow > 0 && (
                          <div style={{ fontSize: 10, color: '#94A3B8', padding: '1px 6px', fontWeight: 600 }}>
                            +{overflow}개
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}


