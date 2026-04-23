import { useState, useEffect, useRef } from 'react'
import { SlotContent } from '../calendar/SlotContent'
import { getSlotState, getSlotColors, isShownInDailyView, isShownInCalendar } from '../calendar/slotHelpers'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import {
  todayStr, nowMinutes, tsDate, tsMin, fmtTS,
  fmt2, DAY_NAMES, MONTH_NAMES, HOURS,
  dateToObj, objToStr, addDays, getWeekStart,
} from '../../utils/time'
import { FLOORS, getFloor } from '../../data/floors'
import type { Booking, Room } from '../../types'

// ── 툴바 아이콘 SVG (Figma 기준) ──────────────────────────────────────────────
const IcoBack = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M13.25 17.5L6 10.25L13.25 3L13.896 3.646L7.292 10.25L13.896 16.854L13.25 17.5Z" fill="#1c1b1f"/>
  </svg>
)
const IcoForward = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M6.646 17.5L6 16.854L12.604 10.25L6 3.646L6.646 3L13.896 10.25L6.646 17.5Z" fill="#1c1b1f"/>
  </svg>
)
const IcoChevronDown = ({ color = '#d0d0d0' }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M10 12.5L5 7.5L5.625 6.875L10 11.25L14.375 6.875L15 7.5L10 12.5Z" fill={color}/>
  </svg>
)
// 데이트피커 좌/우 화살표 (zip 파일 기준)
const IcoDpBack = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M7.4375 10.25L11.6875 6L12 6.3125L8.0625 10.25L12 14.1875L11.6875 14.5L7.4375 10.25Z" fill="#111111"/>
  </svg>
)
const IcoDpForward = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
    <path d="M12.5625 9.75L8.3125 14L8 13.6875L11.9375 9.75L8 5.8125L8.3125 5.5L12.5625 9.75Z" fill="#111111"/>
  </svg>
)
// ─────────────────────────────────────────────────────────────────────────────

// ─── [2026-04-23] 예약 가능 기간 정책 ────────────────────────────────────────
// 일반 사용자: 오늘 ~ 오늘+30일 범위만 예약 가능
// Admin: 30일 제한 없음, 단 '과거는 1분이라도 불가'
// 과거 차단:
//   · 어제까지는 모두 차단 (Admin 포함)
//   · 오늘 날짜의 이미 지나간 시각도 차단 (Admin 포함)
// BookingModal UI는 이미 막고 있으나, 캘린더 뷰에서 뚫려있는 문제 해결
const BOOKING_LIMIT_DAYS = 30

/** 날짜 문자열(YYYY-MM-DD)이 예약 가능 '날짜'인지 판정
 *  · 과거 날짜는 항상 false (Admin도 과거는 불가)
 *  · isAdmin=true면 오늘 이후는 무제한 (30일 제한 없음)
 *  · 일반 사용자는 오늘 ~ 오늘+30일 범위만 true
 *  용도: Monthly 뷰의 날짜 셀 판정
 */
function isDateBookable(ds: string, today: string, isAdmin: boolean): boolean {
  if (ds < today) return false                  // 과거 날짜: 모두 차단 (Admin 포함)
  if (isAdmin) return true                      // Admin: 오늘 이후 무제한
  // 일반 사용자: 30일 이내만
  const [ty, tm, td] = today.split('-').map(Number)
  const [dy, dm, dd] = ds.split('-').map(Number)
  const todayUTC = Date.UTC(ty, tm - 1, td)
  const dsUTC    = Date.UTC(dy, dm - 1, dd)
  const diffDays = Math.round((dsUTC - todayUTC) / (1000 * 60 * 60 * 24))
  return diffDays <= BOOKING_LIMIT_DAYS
}

/** 특정 날짜의 특정 '시간 슬롯'이 예약 가능한지 판정
 *  · isDateBookable 조건 + 오늘 날짜의 지나간 시각 추가 차단
 *  · 슬롯 시작 시각이 현재보다 과거면 차단 (Admin 포함, 1분이라도 과거 불가)
 *  용도: Daily/Weekly 뷰의 시간 슬롯 판정
 *
 *  @param ds       'YYYY-MM-DD'
 *  @param hour     0~23 (슬롯 시작 시)
 *  @param today    'YYYY-MM-DD' (todayStr())
 *  @param nowMin   오늘 기준 분 단위 현재 시각 (nowMinutes())
 *  @param isAdmin  관리자 여부
 */
function isSlotBookable(
  ds: string, hour: number, today: string, nowMin: number, isAdmin: boolean
): boolean {
  // 1) 날짜 단위 판정 먼저
  if (!isDateBookable(ds, today, isAdmin)) return false
  // 2) 오늘 날짜의 슬롯이면 시간도 체크
  //    슬롯 시작 시각(hour*60)이 현재 시각(nowMin) 이하면 과거 → 차단
  if (ds === today && hour * 60 <= nowMin) return false
  return true
}

// ─── CalendarShell ────────────────────────────────────────────────────────────
export function CalendarShell({
  bookings, rooms: roomsProp = [], selectedDate, setSelectedDate,
  calView, setCalView, onBookingClick, onNewBooking, onCheckIn,
  filterFloor, setFilterFloor, currentUser = '', isAdmin = false,
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
  const nowForCal  = nowMinutes()
  const todayForCal = todayStr()
  // ← [2026-04-23 HOTFIX] weekBks에 isShownInCalendar + 노쇼 제외 필터 추가
  //   기존: 날짜 범위만 필터링 → WeeklyView 내부에서 autoCancelled 체크 (누락 발생)
  //   변경: 공통 필터(isShownInCalendar)로 취소/거절/기한초과 건 미리 제거
  //   추가: Weekly 뷰는 활성 예약만 표시 (노쇼 박제 없음, 기존 설계 유지)
  const weekBks = filteredBks.filter(b => {
    const d = tsDate(b.start_at)
    if (d < weekStart || d > addDays(weekStart, 6)) return false
    const isToday = d === todayForCal
    if (!isShownInCalendar(b, nowForCal, isToday)) return false
    // Weekly는 활성 예약만 표시 (노쇼 박제 없음 - 기존 설계 유지)
    const st = getSlotState(b, nowForCal, isToday, '')
    return !st.isNoshow
  })
  // ← [P2 v7] 자체 판별 제거 → slotHelpers.isShownInDailyView 단일 진실 원천 사용
  //   기존: `!b.autoCancelled || (b.cancelledBy === 'system' && b.status !== 'rejected')`
  //   변경: 의미 있는 이름의 유틸 함수로 분리 (판별 규칙 변경 시 한 곳만 수정)
  //   hotfix: isShownInDailyView가 now/isToday를 받아 '노쇼만 박제'/'기한초과 제외' 분리
  //   [2026-04-23 HOTFIX] isShownInDailyView는 isShownInCalendar wrapper로 바뀜
  const dailyNow     = nowMinutes()
  const dailyIsToday = selectedDate === todayStr()
  const dailyBks = filteredBks.filter(b =>
    tsDate(b.start_at) === selectedDate && isShownInDailyView(b, dailyNow, dailyIsToday)
  )

  return (
    <div>
      {/* ── 툴바 ── */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl mb-4"
        style={{
          padding: '12px 18px', position: 'relative', zIndex: 50,
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          gap: 10, alignItems: 'center', height: isMobile ? 'auto' : 64,
        }}>

        {/* ── 좌: 뷰탭 ── */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 8 }}>
          <div style={{ display: 'flex', background: '#F3F4F8', borderRadius: 1000,
            padding: 2, gap: 2, flexShrink: 0, height: 40, alignItems: 'center' }}>
            {VIEWS.map(v => (
              <button key={v.id} className="btn" onClick={() => setCalView(v.id)}
                style={{
                  background: calView===v.id ? '#111111' : 'transparent',
                  color:      calView===v.id ? '#fff'    : '#657487',
                  padding: '10px 20px', borderRadius: 1000,
                  fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
                  fontFamily: "'Pretendard', -apple-system, sans-serif",
                  border: 'none', cursor: 'pointer', lineHeight: 1,
                }}>{v.label}</button>
            ))}
          </div>
        </div>

        {/* ── 중앙: 날짜 네비 ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <button className="btn" onClick={() => navigate(-1)}
            style={{ width: 20, height: 20, padding: 0, background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <IcoBack />
          </button>

          {/* 날짜 버튼 — 모든 뷰 공통, 항상 데이트피커 열림 */}
          <div ref={dpRef} style={{ position: 'relative', minWidth: 0 }}>
            <button className="btn"
              onClick={() => setShowDatePicker(v => !v)}
              style={{
                padding: '5px 14px', background: 'transparent', whiteSpace: 'nowrap',
                border: 'none',
                borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                height: 33, userSelect: 'none', WebkitUserSelect: 'none',
              }}>
              <span style={{ fontSize: 19, fontWeight: 500, color: '#111111',
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }}>
                {calView === 'daily'
                  ? (() => { const d = dateToObj(selectedDate); return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}일 ${DAY_NAMES[d.getDay()]}요일` })()
                  : navLabel()}
              </span>
            </button>
            {showDatePicker && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)',
                left: '50%', transform: 'translateX(-50%)',
                zIndex: 9999,
                background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
                boxShadow: '0 8px 32px rgba(0,0,0,0.12)', padding: 14, minWidth: 260,
              }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <button className="btn" onClick={e => { e.stopPropagation(); dpMonth === 0 ? (setDpYear(y => y-1), setDpMonth(11)) : setDpMonth(m => m-1) }}
                      style={{ background: 'none', border: 'none', padding: '4px 8px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M7.4375 10.25L11.6875 6L12 6.3125L8.0625 10.25L12 14.1875L11.6875 14.5L7.4375 10.25Z" fill="#111111"/></svg>
                    </button>
                    <span style={{ fontSize: 14, fontWeight:500, color: '#111111' }}>{dpYear}년 {MONTH_NAMES[dpMonth]}</span>
                    <button className="btn" onClick={e => { e.stopPropagation(); dpMonth === 11 ? (setDpYear(y => y+1), setDpMonth(0)) : setDpMonth(m => m+1) }}
                      style={{ background: 'none', border: 'none', padding: '4px 8px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M12.5625 9.75L8.3125 14L8 13.6875L11.9375 9.75L8 5.8125L8.3125 5.5L12.5625 9.75Z" fill="#111111"/></svg>
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
                    {DAY_NAMES.map((n, i) => (
                      <div key={n} style={{ textAlign: 'center', fontSize: 10, fontWeight:600, padding: '2px 0',
                        color: i===0 ? '#EF4444' : i===6 ? '#3B82F6' : '#94A3B8' }}>{n}</div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
                    {dpCells.map((day, idx) => {
                      if (!day) return <div key={`e${idx}`} />
                      const ds = `${dpYear}-${fmt2(dpMonth+1)}-${fmt2(day)}`
                      const isSel = ds === selectedDate, isToday2 = ds === today
                      const dow = (dpFirstDay + day - 1) % 7
                      // ← [2026-04-23] 데이트피커 클릭 차단 정책
                      //   · 과거 날짜: 시각 효과 없음, 클릭 가능 (과거 내역 조회)
                      //   · 30일 초과 날짜: 시각 구분(opacity 0.35) + 클릭 불가 (정책 엄격 반영)
                      //   · 현재~30일: 정상 클릭 가능
                      const bookable = isDateBookable(ds, today, isAdmin)
                      const isPastDate = ds < today
                      // 차단 대상 = 30일 초과 (과거는 조회 허용)
                      const blocked = !bookable && !isPastDate
                      const tooltipMsg = blocked ? '예약은 오늘부터 30일 이내만 가능합니다' : ''
                      return (
                        <div key={day}
                          onClick={() => { if (!blocked) { setSelectedDate(ds); setShowDatePicker(false) } }}
                          title={tooltipMsg}
                          style={{
                            textAlign: 'center', padding: '5px 2px', borderRadius: 6,
                            fontSize: 12, fontWeight: isSel||isToday2 ? 700 : 400,
                            cursor: blocked ? 'not-allowed' : 'pointer',
                            background: isSel ? '#111111' : isToday2 ? '#EFF6FF' : 'transparent',
                            color: isSel ? '#fff' : isToday2 ? '#3B82F6' : dow===0 ? '#EF4444' : dow===6 ? '#3B82F6' : '#374151',
                            opacity: !isSel && blocked ? 0.35 : 1,
                          }}
                          onMouseEnter={e => { if (!isSel && !blocked) (e.currentTarget as HTMLElement).style.background = '#F1F5F9' }}
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

          {/* arrow_forward_ios */}
          <button className="btn" onClick={() => navigate(1)}
            style={{ width: 20, height: 20, padding: 0, background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <IcoForward />
          </button>
          {/* 오늘 버튼 — datepicker 10px 옆에 위치 */}
          {selectedDate !== today && (
            <button className="btn"
              style={{ marginLeft: 10, padding: '4px 10px', fontSize: 11, fontWeight: 500,
                background: '#111111', color: '#fff', borderRadius: 999, border: 'none',
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => setSelectedDate(today)}>오늘</button>
          )}
        </div>

        {/* ── 우: 오늘버튼(조건) + 층 드롭다운 + 필터탭 ── */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          {/* 층 드롭다운 */}
          <div ref={floorDropRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button className="btn" onClick={() => setShowFloorDrop(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 999, border: 'none',
                fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                background: '#111111', color: '#fff', cursor: 'pointer', height: 32,
              }}>
              {currentFloorLabel}
              <svg width="9" height="5" viewBox="0 0 9 5" fill="none" xmlns="http://www.w3.org/2000/svg"
                style={{transform: showFloorDrop ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s'}}>
                <path d="M4.25 4.5625L0 0.3125L0.3125 0L4.25 3.9375L8.1875 0L8.5 0.3125L4.25 4.5625Z" fill="#d0d0d0"/>
              </svg>
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

          {/* ④ 전체예약/내예약 필터 — Figma: padding=0, h=32, gap=2 */}
          <div style={{ display: 'flex', background: '#F3F4F8', borderRadius: 1000,
            padding: 0, gap: 2, flexShrink: 0, height: 32, alignItems: 'center' }}>
            {([{ v: false, l: '전체 예약' }, { v: true, l: '내 예약' }] as const).map(({ v, l }) => (
              <button key={l} className="btn" onClick={() => setFilterMine(v)}
                style={{
                  background: filterMine===v ? '#111111' : 'transparent',
                  color:      filterMine===v ? '#fff'    : '#657487',
                  padding: '8px 16px', borderRadius: 10000, border: 'none',
                  fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                  fontFamily: "'Pretendard', -apple-system, sans-serif",
                  cursor: 'pointer', lineHeight: 1, height: 32,
                }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {calView === 'monthly' && <MonthlyView bookings={filteredBks} selectedDate={selectedDate} onDayClick={d => { setSelectedDate(d); setCalView('daily') }} onBookingClick={onBookingClick} rooms={allRooms} currentUser={currentUser} isAdmin={isAdmin} />}
      {calView === 'daily'   && <DailyView   bookings={dailyBks}  selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(rid, h) => onNewBooking(selectedDate, h, rid)} onCheckIn={onCheckIn} rooms={allRooms} currentUser={currentUser} isAdmin={isAdmin} />}
      {calView === 'weekly'  && <WeeklyView  bookings={weekBks}   selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(d, h) => onNewBooking(d, h, undefined)} rooms={allRooms} currentUser={currentUser} isAdmin={isAdmin} />}
    </div>
  )
}

// ─── Monthly View ─────────────────────────────────────────────────────────────
export function MonthlyView({ bookings, selectedDate, onDayClick, onBookingClick, rooms: mvRooms = [], currentUser = '', isAdmin = false }) {
  const d = dateToObj(selectedDate), year = d.getFullYear(), month = d.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const dim = new Date(year, month + 1, 0).getDate()
  const today = todayStr()
  const now = nowMinutes()  // ← [2026-04-23 HOTFIX] isShownInCalendar용
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= dim; i++) cells.push(i)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
        {DAY_NAMES.map((n, i) => (
          <div key={n} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight:600,
            color: i===0 ? '#EF4444' : i===6 ? '#3B82F6' : '#64748B' }}>{n}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(0,1fr))' }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} style={{ minHeight: 110, borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', background: '#FAFAFA', overflow: 'hidden' }} />
          const ds = `${year}-${fmt2(month+1)}-${fmt2(day)}`
          // ← [2026-04-23 HOTFIX] !b.autoCancelled → isShownInCalendar + 노쇼 제외
          //   기존: status='cancelled'+auto_cancelled=false 건이 통과되어 취소건 표시됨
          //   변경: 공통 필터로 취소/거절/기한초과 모두 정확히 제거
          //   유지: Monthly는 활성 예약만 표시 (노쇼 박제 없음 - 기존 설계 유지)
          //         노쇼 박제는 Daily/Timeline에만 표시 — Weekly/Monthly는 간결함 우선
          const isTodayCell = ds === today
          const dbs = bookings.filter(b => {
            if (tsDate(b.start_at) !== ds) return false
            if (!isShownInCalendar(b, now, isTodayCell)) return false
            // Monthly는 활성 예약만 표시 (노쇼 박제 없음)
            const st = getSlotState(b, now, isTodayCell, '')
            return !st.isNoshow
          })
          const isToday = ds === today, isSel = ds === selectedDate
          const dow = (firstDay + day - 1) % 7
          // ← [2026-04-23 v2] 예약 가능 기간 정책: 오늘 + 30일 (과거는 Admin도 예약 불가)
          //   · 과거 날짜: 일간뷰로 '조회' 이동 허용 (데이트피커와 일관성) — 예약은 BookingModal/DB 트리거에서 차단
          //   · 30일 초과: 완전 차단 (클릭 불가)
          //   · dimmed(시각 구분): 30일 초과만 (과거는 opacity 1 유지 — 기록 조회 UX)
          const bookable = isDateBookable(ds, today, isAdmin)
          const isPastDate = ds < today
          // ← [2026-04-23 BUGFIX] canNavigate: 클릭 허용 조건 (예약 가능 || 과거 조회)
          //   기존: `if (bookable)`만 허용 → 과거 기록 조회 불가 (데이트피커와 불일치)
          //   변경: 과거도 일간뷰 이동 허용. 30일 초과만 차단 유지
          const canNavigate = bookable || isPastDate
          const tooltipMsg = !bookable
            ? (isPastDate ? '과거 날짜는 예약할 수 없습니다 (조회만 가능)' : '예약은 오늘부터 30일 이내만 가능합니다')
            : ''
          const dimmed = !bookable && !isPastDate
          return (
            <div key={day} onClick={() => { if (canNavigate) onDayClick(ds) }}  // ← [2026-04-23 BUGFIX] bookable → canNavigate (과거 조회 허용)
              title={tooltipMsg}
              style={{
                minHeight: 110, borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9',
                padding: '7px 6px', cursor: canNavigate ? 'pointer' : 'not-allowed', overflow: 'hidden',  // ← [2026-04-23 BUGFIX] bookable → canNavigate
                background: dimmed ? '#F8FAFC' : isSel ? '#EEF2FF' : isToday ? '#F0FDF4' : '#fff',
                opacity: dimmed ? 0.5 : 1,
                transition: 'background 0.12s',
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 600 : 500,
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
export function DailyView({ bookings, selectedDate, onBlockClick, onEmptyClick, onCheckIn, rooms: dvRooms = [], currentUser = '', isAdmin = false }) {
  const isToday = selectedDate === todayStr(), now = nowMinutes()
  const CW = 160, RH = 80, LW = 224
  const rooms = (dvRooms as any[]).filter(r => r.is_active)
  const totalW = CW * HOURS.length
  // ← [2026-04-23] 예약 가능 기간 정책: 시간 슬롯 단위 판정 (아래 map 내부에서)
  //   오늘 날짜라도 지나간 시간은 차단 (Admin 포함, 1분이라도 과거 불가)
  const todayStrVal = todayStr()

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

        {/* 현재시간 인디케이터 — pill(헤더 하단) + dot + #FF393C 세로 라인 */}
        {isToday && nowLeft >= 0 && nowLeft <= totalW && (
          <div style={{ position: 'absolute', zIndex: 8, pointerEvents: 'none',
            top: 0, bottom: 0, left: LW + nowLeft, width: 0 }}>
            {/* pill — 헤더 하단(top:29px = 헤더 48px - pill 19px 절반) */}
            <div style={{ position: 'absolute', top: 29, left: '50%', transform: 'translateX(-50%)',
              height: 19, padding: '0 8px', background: '#FF393C', borderRadius: 24,
              display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', zIndex: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: '#fff' }}>
                {fmt2(Math.floor(now/60))}:{fmt2(now%60)}
              </span>
            </div>
            {/* dot — pill 바로 아래 (top:48) */}
            <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)',
              width: 10, height: 10, borderRadius: '50%',
              background: '#FF373B', border: '1.5px solid #fff', zIndex: 9 }} />
            {/* 세로 라인 — dot 아래부터 바닥까지 */}
            <div style={{ position: 'absolute', top: 53, bottom: 0, left: '50%',
              transform: 'translateX(-50%)', width: 2, background: '#FF393C' }} />
          </div>
        )}

        {/* 헤더: 시간축 */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 9, background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ width: LW, minWidth: LW, flexShrink: 0, borderRight: '1px solid #E2E8F0',
            padding: '10px 16px', fontSize: 11, fontWeight:600, color: '#94A3B8',
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
          // ← [2026-04-23 HOTFIX] !b.autoCancelled → isShownInCalendar + 노쇼 제외
          //   rBks: 일반 예약 슬롯 (활성 예약)
          //   rBksCancelled: 노쇼 박제 슬롯 (회색 대시 박스)
          //   두 그룹이 중복되지 않도록 rBks에서 노쇼는 제외
          const rBks = bookings.filter(b => {
            if (b.room_id !== room.room_id) return false
            if (!isShownInCalendar(b, now, isToday)) return false
            // 노쇼는 rBksCancelled에서 별도 렌더 → 여기서 제외
            const st = getSlotState(b, now, isToday, currentUser)
            return !st.isNoshow
          })
          // ← [P2 v7 hotfix] 노쇼만 박제 표시 — 기한초과는 제외 (일반 취소와 동일 처리)
          //   정책: 노쇼는 "이 시간에 노쇼 있었다"는 기록 목적이라 박제,
          //         기한초과는 "승인되지 않아 일어나지 않은 약속"이라 제외
          //   [2026-04-23 HOTFIX] autoCancelled 의존성 제거, isNoshow만 체크
          const rBksCancelled = bookings.filter(b => {
            if (b.room_id !== room.room_id) return false
            if (b.status === 'rejected') return false
            const st = getSlotState(b, now, isToday, currentUser)
            return st.isNoshow   // 노쇼만 포함 (기한초과/사용자취소 제외)
          })
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
                boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {dot && (
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                      background: dot === 'busy' ? '#EF4444' : '#22C55E',
                    }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight:600, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{room.room_name}</div>
                    <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{floor?.floor_name} · {room?.capacity}인</div>
                  </div>
                </div>
              </div>

              {/* 시간 셀 */}
              <div style={{ flex: 1, position: 'relative', height: RH, display: 'flex', overflow: 'hidden' }}>
                {HOURS.map(h => {
                  // ← [2026-04-23] 슬롯 단위 예약 가능성 판정
                  //   · 과거 날짜/시간 전체 차단 (Admin 포함) — 기능만 차단, 시각은 정상(opacity 1)
                  //   · 30일 초과는 일반 사용자만 차단 — 시각적 구분 필요 (opacity 0.4)
                  const slotBookable = isSlotBookable(selectedDate, h, todayStrVal, now, isAdmin)
                  const isPastSlot = selectedDate < todayStrVal || (selectedDate === todayStrVal && h * 60 <= now)
                  const tooltipMsg = !slotBookable
                    ? (isPastSlot ? '과거 시간은 예약할 수 없습니다' : '예약은 오늘부터 30일 이내만 가능합니다')
                    : ''
                  // 과거는 시각 효과 없이 클릭만 차단, 30일 초과만 흐리게
                  const dimmed = !slotBookable && !isPastSlot
                  return (
                    <div key={h} onClick={() => { if (slotBookable) onEmptyClick(room.room_id, h) }}
                      title={tooltipMsg}
                      style={{ width: CW, minWidth: CW, flexShrink: 0, borderRight: '1px solid #F1F5F9', cursor: slotBookable ? 'pointer' : 'not-allowed', position: 'relative', transition: 'background 0.1s', opacity: dimmed ? 0.4 : 1 }}
                      onMouseEnter={e => { if (slotBookable) (e.currentTarget as HTMLElement).style.background = 'rgba(30,41,59,0.04)' }}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '25%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px dashed #F1F5F9', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '75%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />
                    </div>
                  )
                })}

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

                {/* 노쇼 박제 슬롯 */}
                {/* ← [P2 v7 hotfix] 기한초과 분기 제거 — rBksCancelled가 이미 노쇼만 필터링함
                     · 정책: 노쇼는 박제 (이 시간에 노쇼 있었다는 기록 목적)
                     · 기한초과는 일반 취소와 동일하게 일간 뷰에서 사라짐
                     · tokens.css의 chip-noshow 색상 토큰 자동 적용 */}
                {rBksCancelled.map(b => {
                  const sm       = tsMin(b.start_at)
                  const left     = ((sm-7*60)/60)*CW+2
                  const width    = (15/60)*CW-4  // 15분 고정 폭 (원래 예약 시간 무시)
                  return (
                    <div key={b.id} onClick={e => { e.stopPropagation(); onBlockClick(b) }}
                      style={{ position: 'absolute', top: 6, bottom: 6, left, width,
                        background: '#F1F5F9', border: '1px dashed #D1D5DB', borderRadius: 5,
                        padding: '2px 5px', cursor: 'pointer', opacity: 0.5, overflow: 'hidden', zIndex: 1 }}>
                      <span className="chip chip--xs chip-noshow">노쇼</span>
                      {b.user && <span style={{ display: 'block', fontSize: 8, color: '#9CA3AF', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.user}</span>}
                    </div>
                  )
                })}

                {/* 예약 블록 */}
                {rBks.map(b => {
                  // ← [P2 v7] 자체 isNoshow 판별 제거 → slotHelpers.getSlotState 통일
                  //   기존: `isNoshow = autoCancelled && cancelledBy==='system' && status!=='rejected'`
                  //         → 시간축 분리 없어서 pending_expired도 noshow로 오분류됨
                  //   이 슬롯에 오는 건 !autoCancelled이라 실제론 둘 다 false이지만
                  //   변수명·의미·getSlotColors 인터페이스 일관성 위해 통일
                  const st = getSlotState(b, now, isToday, currentUser)
                  const { sm, em, isNoshow, isExpiredPending, isEnded, isAct, isMyBooking } = st
                  const left = ((sm-7*60)/60)*CW+2, width = Math.max(((em-sm)/60)*CW-4, 20)
                  const { titleColor, subColor } = getSlotColors({
                    variant: 'daily', isAct, isEnded, isNoshow, isExpiredPending
                  })
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
export function WeeklyView({ bookings, selectedDate, onBlockClick, onEmptyClick, rooms = [], currentUser = '', isAdmin = false }) {
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
      // ← [2026-04-23 HOTFIX] 상위 weekBks에서 isShownInCalendar + !isNoshow로 이미 필터링됨
      //   이 조건들은 방어적 중복 — autoCancelled가 true인 건이 여기 올 일은 없지만 유지
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
            background: '#fff', borderBottom: '1px solid #E2E8F0' }}>
            {/* 코너 */}
            <div style={{ width: TIME_W, minWidth: TIME_W, flexShrink: 0,
              boxShadow: 'inset -1px 0 0 #E2E8F0', position: 'sticky', left: 0,
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
                  padding: '8px 10px 0 0', textAlign: 'right', alignSelf: 'stretch',
                  fontSize: 11, fontWeight: 400, color: '#333333',
                  boxShadow: 'inset -1px 0 0 #E2E8F0',
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
                  // ← [2026-04-23] 슬롯 단위 예약 가능성 판정
                  //   · 과거는 기능만 차단 (opacity 1, cursor만 not-allowed)
                  //   · 30일 초과는 시각적 구분 (opacity 0.5 + 배경 회색)
                  const bookable = isSlotBookable(ds, h, today, now, isAdmin)
                  const isPastSlot = ds < today || (ds === today && h * 60 <= now)
                  const tooltipMsg = !bookable
                    ? (isPastSlot ? '과거 시간은 예약할 수 없습니다' : '예약은 오늘부터 30일 이내만 가능합니다')
                    : ''
                  const dimmed = !bookable && !isPastSlot
                  return (
                    <div key={ds}
                      onClick={() => { if (bookable) onEmptyClick(ds, h) }}
                      title={tooltipMsg}
                      style={{
                        flex: 1, minWidth: 0, padding: '4px 5px',
                        borderRight: i < days.length - 1 ? '1px solid #F1F5F9' : 'none',
                        cursor: bookable ? 'pointer' : 'not-allowed',
                        background: dimmed ? '#F8FAFC' : isToday2 ? '#FAFEFF' : 'transparent',
                        opacity: dimmed ? 0.5 : 1,
                        minHeight: HOUR_H, transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { if (bookable && visible.length === 0) (e.currentTarget as HTMLElement).style.background = isToday2 ? '#F0FEFF' : '#F8FAFC' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = dimmed ? '#F8FAFC' : isToday2 ? '#FAFEFF' : 'transparent' }}>
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


