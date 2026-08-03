/**
 * CalendarShell.tsx — 캘린더 뷰 (Daily / Weekly / Monthly)
 *
 * ✅ 변경 이력
 *  - [2026-06-10] DailyView '일' 뷰 타임라인 좌/우 스크롤 화살표 추가 (Figma 1308:611 / 1308:615)
 *    · 추가: IcoTimelineLeft / IcoTimelineRight 인라인 SVG (업로드 arrow.svg / arrow_back.svg, fill #C7C7C7)
 *    · 추가: scrollRef div를 position:relative wrapper로 감싸고 화살표 2개를 absolute 고정
 *      (스크롤 컨테이너 내부에 두면 콘텐츠와 함께 스크롤되는 문제 → wrapper 형제로 분리)
 *    · 화살표 스펙: 48×48, borderRadius 100, bg rgba(255,255,255,0.65), border 1px #F1F1F1,  ← [2026-06-10] 박스 40→48, bg 0.1→0.65
 *      backdrop-filter blur(10px) (반투명 글래스), 내부 20×20 아이콘(fill #d0d3d7) 정중앙  ← [2026-06-10] 아이콘 16→20, #C7C7C7→#d0d3d7
 *    · 위치: 좌 left=200 / 우 right=-20, 둘 다 top:47% (translateY -50%) — 사용자 위치 조정
 *    · 기능: scrollBy(가시 타임라인폭×0.8, 최소 CW, behavior smooth) — 회의실명 컬럼(LW) 제외 폭 기준
 *    · 표시: canLeft/canRight 상태(scrollLeft·clientWidth·scrollWidth)로 좌/우 끝 도달 시 해당 화살표 fade-out
 *      (onScroll + ResizeObserver + window resize + 초기 스크롤 설정 직후 갱신)
 *    · UI/표시 로직 추가만 — 기존 예약/슬롯/현재시각 인디케이터 로직·props·API 무변경
 *  - [2026-05-13 v6] Date Display fontSize 되돌림 (사용자 피드백)
 *    · fontSize: 21 → 20 (v3에서 20→21 변경했던 것을 되돌림)
 *    · fontWeight 400은 그대로 유지 (사용자 명시 지시 없음)
 *    · UI-only (로직/props/API 무변경)
 *  - [2026-05-13 v5] 캘린더 뷰 쉘 외곽 border-radius 변경 (사용자 피드백)
 *    · 3개 view(MonthlyView/DailyView/WeeklyView) 외곽 borderRadius: 16 → 20
 *    · 회의실 드롭다운 팝업의 borderRadius:16 (L567)은 외곽 쉘이 아니므로 미변경
 *    · UI-only (로직/props/API 무변경)
 *  - [2026-05-13 v4] 캘린더 뷰 쉘 외곽 border 색상 변경 (사용자 피드백)
 *    · 3개 view(MonthlyView/DailyView/WeeklyView) 외곽 border: '#E2E8F0' → '#FFFFFF'
 *      (border 자체는 1px 유지 → 사용자가 명시한 rgb(255,255,255) 1:1 적용,
 *       border:none 사용 안 함 — 1px 공간 유지하여 view 전환 시 레이아웃 jump 방지)
 *    · 일관성: 세 view 모두 동일한 외곽 패턴이라 3곳 모두 변경
 *    · UI-only (로직/props/API 무변경)
 *  - [2026-05-13 v3] 툴바 하단 간격 + 날짜 폰트 조정 (사용자 피드백)
 *    · Toolbar wrapper className: 'mb-4' → 'mb-1' (margin-bottom 1rem → 0.25rem)
 *      → 사용자 표현 "padding-bottom" = Chrome DevTools에서 보라색으로 표시된 margin 영역
 *      → 실제 클래스는 Tailwind margin-bottom (mb-4 = 16px → mb-1 = 4px)
 *    · Date Display 텍스트: fontSize 20 → 21, fontWeight 500 → 400
 *      (캘린더 뷰 모든 모드 — daily/weekly/monthly 공통 span 한 곳)
 *    · UI-only (로직/props/API 무변경)
 *  - [2026-05-13 v2] 탭 토글 배경 흰색 + 우측 영역 높이 정확 일치 (사용자 피드백)
 *    · 좌측 View Tabs(일/주/월) 컨테이너 bg: '#F3F4F8' → '#FFFFFF'
 *    · 우측 View Tabs(전체예약/내예약) 컨테이너 bg: '#F3F4F8' → '#FFFFFF'
 *    · 우측 View Tabs 컨테이너 padding 2 → 0, gap 2 → 0
 *      → active 검정 pill 외곽 32px → 36px (회의실 dropdown 외곽 36과 정확 일치)
 *    · sliding pill top/bottom 2 → 0 (컨테이너 padding 0 동기화)
 *    · 페이지 wrapper(App.tsx)는 view별 분기 별도 처리됨 — 캘린더만 padding 20px 28px
 *    · UI-only (로직/props/API 무변경)
 *  - [2026-05-13] 툴바 UI 미세 조정 (Figma 586:647)
 *    · 외부 Toolbar wrapper: bg-white 제거(투명), padding 좌우 0 (12px 18px → 12px 0)
 *    · Date picker 트리거 버튼: background '#fff' → 'transparent' (투명)
 *    · Date Nav 좌/우 화살표 아이콘: 20×20 → 16×16
 *      (IcoBack/IcoForward SVG size + 버튼 컨테이너 width/height 모두 16)
 *    · 우측 회의실 dropdown: padding 14/7/7/7 → 16/8/8/8, height 32 → 36
 *    · 우측 View Tabs(전체예약/내예약): 컨테이너 + 버튼 height 32 → 36, lineHeight 1 → '16px'
 *    · UI-only 변경 (로직/props/API 무변경)
 *  - [2026-05-07] 툴바 재설계 + 회의실 필터로 교체 (Figma 396:3716)
 *    · props: filterFloor → filterRoomId (값 'ALL' | room_id로 의미 변경)
 *    · 좌/중/우 3구역 flex justify-between 구조 (외부 wrapper flex-1 + 내부 justify-between)
 *    · 중앙 Date Nav를 w=420px 고정폭 박스로 — Today 버튼 추가/제거 시 Date Display 위치 불변
 *    · Today 버튼: Date Nav 내부 absolute (left=358.5, top=3) — Figma 487:976 1:1
 *    · 우측: 층 dropdown 제거 → 회의실 dropdown으로 교체 (Figma 487:859 1:1)
 *    · filteredRooms 로직: floor_id 매칭 → room_id 직접 매칭으로 변경
 *  - [2026-04-27] 캘린더 슬롯 클릭 기본 시간 1시간 → 15분 (BookingModal과 동기화)
 *      · 사용자 보고: "캘린더 뷰의 슬롯 클릭해서 예약모달 진입할 때 1시간으로 설정됨, 15분이어야"
 *      · 원인: CalendarShell.tsx 2곳에서 +60 잔존 (BookingModal은 5곳 모두 +15 동기화 완료된 상태)
 *      · 변경 위치 (2곳):
 *        1) L444 WeeklyView 호출 — onEmptyClick: h*60, (h+1)*60 → h*60, h*60 + 15
 *           · Weekly 슬롯은 시간 단위 박스지만 클릭 시 모달 진입 후 기본 시간 15분
 *        2) L818 DailyView 슬롯 클릭 핸들러 — clickedMin + 60 → clickedMin + 15
 *           · 사용자 보고 케이스 정확 매칭 (15분 단위 클릭)
 *      · 영향: BookingModal의 onSubmit/onUpdate 등 검증 로직 무영향 (prefill 값만 변경)
 *      · 동기화 완료 후: BookingModal 5곳 + CalendarShell 2곳 = 총 7곳 모두 +15 통일
 */
import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'  // ← [2026-05-07] sliding pill 훅
import { useHolidayMap } from '../../utils/holidays' // ← [2026-08-03] 공휴일·회사 이벤트 표기 (모듈 캐시 — 뷰별 hook 호출 무비용)
import { CalendarSlotCard } from '../calendar/CalendarSlotCard'  // ← [2026-04-23] Daily 뷰 슬롯 전용 카드 (구 SlotContent 대체)
import { CalendarCompactCard } from '../calendar/CalendarCompactCard'  // ← [2026-04-24] Weekly/Monthly 공용 컴팩트 카드
import { getSlotState, isShownInDailyView, isShownInCalendar } from '../calendar/slotHelpers'
import { isBooker } from '../../utils/bookingOwnership'  // ← [2026-04-24 P5] filterMine 필터 UUID/email OR 판정
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useBlockedTooltip } from '../../hooks/useBlockedTooltip'  // ← [2026-04-23] 차단 영역 마우스 추적 툴팁
import {
  todayStr, nowMinutes, tsDate, tsMin, fmtTS,
  fmt2, DAY_NAMES, MONTH_NAMES, HOURS,
  dateToObj, objToStr, addDays, getWeekStart,
} from '../../utils/time'
// ← [2026-05-07] 회의실 필터로 교체되며 FLOORS 미사용. getFloor만 DailyView에서 사용.
import { getFloor } from '../../data/floors'
import type { Booking, Room } from '../../types'

// ── 툴바 아이콘 SVG (Figma 기준) ──────────────────────────────────────────────
const IcoBack = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">{/* ← [2026-05-13] 20→16 (Figma 586:657) */}
    <path d="M13.25 17.5L6 10.25L13.25 3L13.896 3.646L7.292 10.25L13.896 16.854L13.25 17.5Z" fill="#1c1b1f"/>
  </svg>
)
const IcoForward = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none">{/* ← [2026-05-13] 20→16 (Figma 586:662) */}
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
// ← [2026-06-10] DailyView 타임라인 좌/우 스크롤 화살표 (업로드 arrow.svg / arrow_back.svg, Figma 1308:612 / 1308:616)
//   · 16×16 viewBox, fill #C7C7C7 (옅은 그레이) — 원본 mask는 16×16 전체 영역이라 시각 영향 없어 path만 사용
const IcoTimelineLeft = () => (                                                    // ← [2026-06-10] 좌측 '<' (arrow.svg)
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">{/* ← [2026-06-10] 크기 16→20 (viewBox 유지, 1.25배 스케일) */}
    <path d="M10.6663 14.063L4.59961 7.99635L10.6663 1.92969L11.2329 2.49635L5.73294 7.99635L11.2329 13.4964L10.6663 14.063Z" fill="#d0d3d7"/>{/* ← [2026-06-10] fill #C7C7C7→#d0d3d7 */}
  </svg>
)
const IcoTimelineRight = () => (                                                   // ← [2026-06-10] 우측 '>' (arrow_back.svg)
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">{/* ← [2026-06-10] 크기 16→20 (viewBox 유지, 1.25배 스케일) */}
    <path d="M5.33372 1.93698L11.4004 8.00365L5.33373 14.0703L4.76706 13.5036L10.2671 8.00365L4.76706 2.50365L5.33372 1.93698Z" fill="#d0d3d7"/>{/* ← [2026-06-10] fill #C7C7C7→#d0d3d7 */}
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

/** 특정 날짜의 '시간 블록(1시간)'이 예약 가능한지 판정
 *  · isDateBookable 조건 + 블록 내 마지막 15분 슬롯(h:45)이 미래인 경우만 허용
 *  · 용도: Daily/Weekly 뷰의 시간 블록 hover/cursor/툴팁 판정 (블록 단위 시각 피드백)
 *
 *  ← [2026-04-24] 15분 단위 클릭 지원으로 판정 기준 변경
 *     기존: hour*60 <= nowMin → 10:00 <= 10:10 이므로 10시 블록 전체 차단 (버그)
 *     변경: (hour+1)*60 - 15 <= nowMin → 블록의 마지막 15분 슬롯(h:45)이 과거여야 블록 차단
 *     효과: 10:10 현재 → 10시 블록의 10:15/10:30/10:45 슬롯은 아직 미래 → 블록 클릭 허용
 *          (실제 클릭 시 서브 슬롯 판정은 isQuarterBookable이 담당)
 *
 *  @param ds       'YYYY-MM-DD'
 *  @param hour     0~23 (블록 시작 시)
 *  @param today    'YYYY-MM-DD' (todayStr())
 *  @param nowMin   오늘 기준 분 단위 현재 시각 (nowMinutes())
 *  @param isAdmin  관리자 여부
 */
function isSlotBookable(
  ds: string, hour: number, today: string, nowMin: number, isAdmin: boolean
): boolean {
  // 1) 날짜 단위 판정 먼저
  if (!isDateBookable(ds, today, isAdmin)) return false
  // 2) 오늘 날짜의 블록이면 마지막 15분 슬롯(h:45) 기준으로 체크
  //    (hour+1)*60 - 15 = h:45 시작 분. 이 값이 nowMin 이하면 블록 내 모든 슬롯이 과거
  if (ds === today && (hour + 1) * 60 - 15 <= nowMin) return false   // ← [2026-04-24] 블록 단위 판정
  return true
}

/** 블록 내 '15분 슬롯' 단위 예약 가능성 판정 (Daily 뷰 서브 슬롯용)
 *  · clickedMin이 업무시간·30일·과거 조건을 모두 통과해야 true
 *  · 과거 판정: 슬롯 시작 시각(clickedMin) ≤ 현재(nowMin) 이면 차단 (Admin 포함 1분이라도 과거 불가)
 *  · 용도: DailyView onClick 내에서 quarter 좌표로 계산된 clickedMin 검증
 *
 *  ← [2026-04-24] 신규 — 시간 블록 내 15분 단위 클릭 지원
 *     예: 10:10 현재, 10시 블록에서 offsetX=60px 클릭 → quarter=1 → clickedMin=615 (10:15)
 *         → isQuarterBookable 통과 → BookingModal 프리필
 */
function isQuarterBookable(
  ds: string, clickedMin: number, today: string, nowMin: number, isAdmin: boolean
): boolean {
  if (!isDateBookable(ds, today, isAdmin)) return false
  if (ds === today && clickedMin <= nowMin) return false
  return true
}

// ─── CalendarShell ────────────────────────────────────────────────────────────
// ✅ 변경 이력
//   - [2026-04-24 P5] "내 예약만" 필터 및 Daily 슬롯 이름/뱃지 판정을 이름 비교 → UUID/email로 전환
//     · 시그니처 확장: currentUserId, currentUserEmail, users prop 추가
//     · L190 filterMine 필터: b.user === currentUser → isBooker(b, currentUserId, currentUserEmail)
//     · CalendarSlotCard 호출 2곳(노쇼 박제 + 일반 예약): currentUserId/Email/users 전달
//     · 기존 currentUser prop 유지 (호환성) — 내부 판정은 UUID/email 기반
//     · 원칙: 이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식
export function CalendarShell({
  bookings, rooms: roomsProp = [], selectedDate, setSelectedDate,
  calView, setCalView, onBookingClick, onNewBooking, onCheckIn,
  // ← [2026-05-07] filterFloor → filterRoomId 변경 (값: 'ALL' | room_id)
  filterRoomId, setFilterRoomId, currentUser = '',
  currentUserId = '',       // ← [2026-04-24 P5]
  currentUserEmail = '',    // ← [2026-04-24 P5]
  users = [],               // ← [2026-04-24 P5] 예약자 이름 live 조회용 (CalendarSlotCard로 전달)
  isAdmin = false,
}) {
  const holidayMap = useHolidayMap()   // ← [2026-08-03] 'YYYY-MM-DD' → { holiday?, company? }
  const { isMobile } = useBreakpoint()
  // ← [2026-04-23] 데이트피커 차단 셀용 커스텀 툴팁
  const { getHandlers: getDpTooltipHandlers, tooltipNode: dpTooltipNode } = useBlockedTooltip()
  const VIEWS = [{ id: 'daily', label: '일' }, { id: 'weekly', label: '주' }, { id: 'monthly', label: '월' }]

  // ── [2026-05-07] VIEWS toggle sliding pill ───────────────────────────────
  const viewBtnRefs      = useRef<(HTMLButtonElement | null)[]>([])
  const viewContainerRef = useRef<HTMLDivElement | null>(null)
  const [viewPill, setViewPill]   = useState({ left: 0, width: 0 })
  const [viewReady, setViewReady] = useState(false)
  const measureViewPill = useCallback(() => {
    const i = VIEWS.findIndex(v => v.id === calView)
    const btn = viewBtnRefs.current[i]
    if (!btn) return
    setViewPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    setViewReady(true)
  }, [calView])  // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { measureViewPill() }, [measureViewPill])
  useEffect(() => {
    const el = viewContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(measureViewPill)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureViewPill])

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
  // ── [2026-05-07] 회의실 필터로 교체 — filterRoomId === 'ALL' | room_id
  //   filteredRooms: 'ALL'이면 활성 전부, 아니면 해당 회의실 1개만
  //   roomFilteredBks: 'ALL'이면 전부, 아니면 room_id 일치만
  const filteredRooms = filterRoomId === 'ALL'
    ? allRooms.filter(r => r.is_active)
    : allRooms.filter(r => r.is_active && r.room_id === filterRoomId)
  const roomFilteredBks = filterRoomId === 'ALL'
    ? bookings
    : bookings.filter(b => b.room_id === filterRoomId)

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

  // ── [2026-05-07] 회의실 드롭다운 (구 층 드롭다운 교체) ──
  const [showRoomDrop, setShowRoomDrop] = useState(false)
  const roomDropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (roomDropRef.current && !roomDropRef.current.contains(e.target as Node)) setShowRoomDrop(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const activeRooms = allRooms.filter(r => r.is_active)
  const currentRoomLabel = filterRoomId === 'ALL'
    ? '전체 회의실'
    : (activeRooms.find(r => r.room_id === filterRoomId)?.room_name ?? '전체 회의실')
  const [filterMine, setFilterMine] = useState(false)

  // ── [2026-05-07] filterMine toggle sliding pill ──────────────────────────
  //    filterMine 선언 직후에 위치 (hoisting)
  const FILTER_ITEMS = [{ v: false, l: '전체 예약' }, { v: true, l: '내 예약' }] as const
  const filterBtnRefs      = useRef<(HTMLButtonElement | null)[]>([])
  const filterContainerRef = useRef<HTMLDivElement | null>(null)
  const [filterPill, setFilterPill]   = useState({ left: 0, width: 0 })
  const [filterReady, setFilterReady] = useState(false)
  const measureFilterPill = useCallback(() => {
    const i = filterMine ? 1 : 0
    const btn = filterBtnRefs.current[i]
    if (!btn) return
    setFilterPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    setFilterReady(true)
  }, [filterMine])
  useLayoutEffect(() => { measureFilterPill() }, [measureFilterPill])
  useEffect(() => {
    const el = filterContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(measureFilterPill)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measureFilterPill])
  // ← [2026-04-24 P5] filterMine 필터 이름 비교 → isBooker(UUID OR email)
  //   기존: floorFilteredBks.filter(b => b.user === currentUser) — 이름 변경 시 매칭 실패
  //   변경: isBooker 헬퍼 — 이름 변경에도 본인 예약 정확히 필터링
  const filteredBks = filterMine
    ? roomFilteredBks.filter(b => isBooker(b, currentUserId, currentUserEmail))
    : roomFilteredBks

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
      {/* ── 툴바 ── [2026-05-07] Figma 396:3716 1:1 재설계
           외부: padding 12 18 / rounded 16 / h 64 / flex items-center
           내부 wrapper(데스크탑): flex-1 + flex justify-between
             → 좌/중/우 3개 자식이 양 끝 + 중앙에 자동 분배
             → 중앙 Date Nav가 w=420 고정폭이라 좌/우 무엇이 바뀌어도 위치 불변
           [2026-05-13] bg-white 제거(투명), 좌우 padding 삭제 (Figma 586:647) */}
      <div className="rounded-2xl mb-1"                                              /* ← [2026-05-13 v3] 'mb-4' → 'mb-1' (margin-bottom 1rem → 0.25rem, 사용자 피드백) */
        style={{
          padding: '12px 0', position: 'relative', zIndex: 50,                  // ← [2026-05-13] '12px 18px' → '12px 0' (좌우 padding 삭제, Figma 586:647)
          display: 'flex', flexDirection: isMobile ? 'column' : 'row',
          gap: 10,
          alignItems: 'center',
          justifyContent: isMobile ? 'flex-start' : 'space-between',
          height: isMobile ? 'auto' : 64,
        }}>

        {/* ── 좌: 뷰탭 (Figma 396:3727) ──
             bg #f3f4f8 / p 2 / gap 2 / rounded 1000 / 각 tab px 20 py 10 / 14 Medium */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <div
            ref={viewContainerRef}
            style={{
              position: 'relative',
              display: 'flex', background: '#FFFFFF', borderRadius: 1000,    /* ← [2026-05-13] '#F3F4F8' → '#FFFFFF' (탭 토글 배경 흰색) */
              padding: 2, gap: 2, flexShrink: 0, height: 40, alignItems: 'center',
              overflow: 'hidden',
            }}>
            {viewReady && (
              <div style={{
                position: 'absolute', top: 2, bottom: 2,
                left: 0,                                              // ← [2026-05-07 v3] translate3d 사용
                width: viewPill.width,
                transform: `translate3d(${viewPill.left}px, 0, 0)`,   // ← [2026-05-07 v3] GPU 가속
                background: '#111111', borderRadius: 1000,
                transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
                willChange: 'transform, width',                       // ← [2026-05-07 v3] composite layer 힌트
                zIndex: 0, pointerEvents: 'none',
              }} />
            )}
            {VIEWS.map((v, i) => (
              <button
                key={v.id}
                ref={el => { viewBtnRefs.current[i] = el }}
                className="btn"
                onClick={() => setCalView(v.id)}
                style={{
                  position: 'relative', zIndex: 1,
                  background: 'transparent',
                  color: calView===v.id ? '#fff' : '#657487',
                  padding: '10px 20px', borderRadius: 1000,
                  fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
                  fontFamily: "'Pretendard', -apple-system, sans-serif",
                  border: 'none', cursor: 'pointer', lineHeight: 1,
                  transition: 'color 0.22s cubic-bezier(0.4,0,0.2,1)',
                  WebkitTapHighlightColor: 'transparent',              // ← [2026-05-07 v3] iOS 회색 박스 제거
                  touchAction: 'manipulation',                          // ← [2026-05-07 v3] 300ms tap delay 제거
                  userSelect: 'none',                                    // ← [2026-05-07 v3] 텍스트 선택 차단
                }}>{v.label}</button>
            ))}
          </div>
        </div>

        {/* ── 중앙: Date Nav (Figma 487:968) ──
             [2026-05-07 v4] desktop: position absolute + left 50% / translateX(-50%)
               → 좌/우 영역 폭과 무관하게 wrapper 정중앙(=화면 정중앙=헤더 중앙) 고정
               → Today 버튼은 Date Nav 내부 absolute이므로 그대로 작동
             mobile: 기존처럼 inline (column 레이아웃) */}
        {/* ← [2026-08-03] 공휴일·이벤트 라벨 병기로 타이틀 폭이 가변 → absolute Today(left 358.5)와
             겹침 발생. 고지 확정: Today 를 타이틀 '아래 가운데'로 — 버튼만 박스 밖 하단(top:100%)에
             매달아 타이틀 수직 리듬은 기존 그대로 보존. 고정폭 420 → minWidth 420 (긴 라벨 수용) */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minWidth: isMobile ? 0 : 420, width: isMobile ? 'auto' : 'max-content',
          position: isMobile ? 'relative' : 'absolute',
          ...(isMobile ? {} : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
          flexShrink: 0,
        }}>
          <button className="btn" onClick={() => navigate(-1)}
            style={{ width: 16, height: 16, padding: 0, background: 'none', border: 'none',  /* ← [2026-05-13] 20→16 (Figma 586:657) */
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <IcoBack />
          </button>

          {/* 날짜 버튼 (Figma 487:971) — 모든 뷰 공통, 항상 데이트피커 열림
               px 14 py 5 / rounded 8 / 20 Medium #111 / bg-white */}
          <div ref={dpRef} style={{ position: 'relative', minWidth: 0 }}>
            <button className="btn"
              onClick={() => setShowDatePicker(v => !v)}
              style={{
                padding: '5px 14px', background: 'transparent', whiteSpace: 'nowrap',  /* ← [2026-05-13] '#fff' → 'transparent' (Figma 586:660) */
                border: 'none',
                borderRadius: 8, display: 'flex', alignItems: 'center', cursor: 'pointer',
                userSelect: 'none', WebkitUserSelect: 'none',
              }}>
              <span style={{ fontSize: 20, fontWeight: 400, color: '#111',                /* ← [2026-05-13 v6] fontSize 21→20 되돌림 / [v3] fontWeight 500→400 유지 */
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none' }}>
                {calView === 'daily'
                  ? (() => { const d = dateToObj(selectedDate)
                      const di = holidayMap.get(selectedDate)
                      const tag = [di?.holiday, di?.company].filter(Boolean).join(' · ')
                      return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}일 ${DAY_NAMES[d.getDay()]}요일${tag ? ` · ${tag}` : ''}` })()  /* ← [2026-08-03] 공휴일·이벤트 병기 */
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
                      // ← [2026-04-23] 훅 핸들러를 변수로 받아 기존 hover 효과와 수동 합성
                      const dpH = getDpTooltipHandlers({ blocked, message: tooltipMsg })
                      return (
                        <div key={day}
                          onClick={() => { if (!blocked) { setSelectedDate(ds); setShowDatePicker(false) } }}
                          aria-label={blocked ? tooltipMsg : undefined}                 // ← [2026-04-23] 접근성: 스크린리더용
                          title={[holidayMap.get(ds)?.holiday, holidayMap.get(ds)?.company].filter(Boolean).join(' · ') || undefined}  /* ← [2026-08-03] */
                          style={{
                            textAlign: 'center', padding: '5px 2px', borderRadius: 6,
                            fontSize: 12, fontWeight: isSel||isToday2 ? 700 : 400,
                            cursor: blocked ? 'default' : 'pointer',                    // ← [2026-04-23] not-allowed → default (OS 금지 아이콘 제거)
                            background: isSel ? '#111111' : isToday2 ? '#EFF6FF' : 'transparent',
                            // ← [2026-08-03] 공휴일 빨강 우선 (선택/오늘 다음 순위)
                            color: isSel ? '#fff' : isToday2 ? '#3B82F6'
                              : holidayMap.get(ds)?.holiday ? '#EF4444'
                              : dow===0 ? '#EF4444' : dow===6 ? '#3B82F6' : '#374151',
                            opacity: !isSel && blocked ? 0.35 : 1,
                          }}
                          onMouseEnter={e => { dpH.onMouseEnter(e); if (!isSel && !blocked) (e.currentTarget as HTMLElement).style.background = '#F1F5F9' }}  // ← [2026-04-23] 훅 핸들러 합성
                          onMouseMove={dpH.onMouseMove}                                                                                                        // ← [2026-04-23] 훅: 마우스 추적
                          onMouseLeave={e => { dpH.onMouseLeave(); if (!isSel) (e.currentTarget as HTMLElement).style.background = isToday2 ? '#EFF6FF' : 'transparent' }}>
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
            style={{ width: 16, height: 16, padding: 0, background: 'none', border: 'none',  /* ← [2026-05-13] 20→16 (Figma 586:662) */
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <IcoForward />
          </button>

          {/* ── Today 버튼 — ← [2026-08-03] absolute(left 358.5 고정좌표) → 박스 하단 중앙(top:100%).
               라벨 병기로 타이틀 폭이 가변이 되어 고정 좌표가 겹침을 유발했음 (고지 확정: 아래 가운데) */}
          {selectedDate !== today && (
            <button className="btn"
              onClick={() => setSelectedDate(today)}
              style={{
                ...(isMobile
                  ? { marginLeft: 10 }
                  : { position: 'absolute', top: 'calc(100% + 2px)', left: '50%', transform: 'translateX(-50%)' }
                ),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '4px 10px',
                background: 'transparent',
                border: '1px solid #000',
                borderRadius: 24,
                fontSize: 12, fontWeight: 500, lineHeight: '16px',
                color: '#000',
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>Today</button>
          )}
        </div>

        {/* ── 우: 회의실 dropdown + 전체예약/내예약 (Figma 396:3734) ──
             gap 10 / 회의실 dropdown bg-#111 h=32 + View Tabs h=32 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* 회의실 dropdown (Figma 479:3302 + 487:859) [2026-05-07 — 층 dropdown 교체] */}
          <div ref={roomDropRef} style={{ position: 'relative', flexShrink: 0 }}>
            <button className="btn" onClick={() => setShowRoomDrop(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                paddingLeft: 16, paddingRight: 8, paddingTop: 8, paddingBottom: 8,   /* ← [2026-05-13] 14/7/7/7 → 16/8/8/8 (Figma 586:668) */
                borderRadius: 999, border: 'none',
                fontSize: 13, fontWeight: 400,
                letterSpacing: 0.13, lineHeight: '16px', whiteSpace: 'nowrap',
                fontFamily: "'Pretendard', -apple-system, sans-serif",
                background: '#111', color: '#fff', cursor: 'pointer', height: 36,    /* ← [2026-05-13] 32→36 (Figma 586:668 자연 높이) */
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
                {/* MENU 1: 전체 회의실 (Figma 487:861) — pt 8 pb 4 px 8 */}
                <div style={{ paddingTop: 8, paddingBottom: 4, paddingLeft: 8, paddingRight: 8 }}>
                  {(() => {
                    const isActive = filterRoomId === 'ALL'
                    return (
                      <button className="btn"
                        onClick={() => { setFilterRoomId('ALL'); setShowRoomDrop(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', width: '100%',
                          paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                          borderRadius: 24, border: 'none', cursor: 'pointer',
                          background: isActive ? '#000' : 'transparent',
                          color:      isActive ? '#fff' : '#111',
                          fontFamily: "'Pretendard', -apple-system, sans-serif",
                          fontSize: 12, fontWeight: 400,
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
                {/* MENU 2~N: 회의실 목록 (Figma 487:867~) — px 8, 마지막은 pb 12 */}
                {activeRooms.map((r, i) => {
                  const isActive = filterRoomId === r.room_id
                  const isLast   = i === activeRooms.length - 1
                  return (
                    <div key={r.room_id} style={{
                      paddingLeft: 8, paddingRight: 8,
                      paddingBottom: isLast ? 12 : 0,
                    }}>
                      <button className="btn"
                        onClick={() => { setFilterRoomId(r.room_id); setShowRoomDrop(false) }}
                        style={{
                          display: 'flex', alignItems: 'center', width: '100%',
                          paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8,
                          borderRadius: 24, border: 'none', cursor: 'pointer',
                          background: isActive ? '#000' : 'transparent',
                          color:      isActive ? '#fff' : '#111',
                          fontFamily: "'Pretendard', -apple-system, sans-serif",
                          fontSize: 12, fontWeight: 400,
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

          {/* 전체예약/내예약 필터 — Figma 396:3740: bg-#f3f4f8 / p 2 / gap 2 / h 32 */}
          <div
            ref={filterContainerRef}
            style={{
              position: 'relative',
              display: 'flex', background: '#FFFFFF', borderRadius: 1000,                /* ← [2026-05-13] '#F3F4F8' → '#FFFFFF' (탭 토글 배경 흰색) */
              padding: 0, gap: 0, flexShrink: 0, height: 36, alignItems: 'center',       /* ← [2026-05-13] padding 2→0, gap 2→0 (회의실 dropdown 외곽 36px와 active pill 외곽 일치) */
              overflow: 'hidden',
            }}>
            {filterReady && (
              <div style={{
                position: 'absolute', top: 0, bottom: 0,                                /* ← [2026-05-13] 2→0 (컨테이너 padding 0과 동기화 - pill 외곽 36px) */
                left: 0,                                              // ← [2026-05-07 v3] translate3d 사용
                width: filterPill.width,
                transform: `translate3d(${filterPill.left}px, 0, 0)`, // ← [2026-05-07 v3] GPU 가속
                background: '#111111', borderRadius: 10000,
                transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), width 0.22s cubic-bezier(0.4,0,0.2,1)',
                willChange: 'transform, width',                       // ← [2026-05-07 v3] composite layer 힌트
                zIndex: 0, pointerEvents: 'none',
              }} />
            )}
            {FILTER_ITEMS.map(({ v, l }, i) => (
              <button
                key={l}
                ref={el => { filterBtnRefs.current[i] = el }}
                className="btn"
                onClick={() => setFilterMine(v)}
                style={{
                  position: 'relative', zIndex: 1,
                  background: 'transparent',
                  color: filterMine===v ? '#fff' : '#657487',
                  padding: '8px 16px', borderRadius: 10000, border: 'none',
                  fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
                  fontFamily: "'Pretendard', -apple-system, sans-serif",
                  cursor: 'pointer', lineHeight: '16px', height: 36,                 /* ← [2026-05-13] lineHeight 1→'16px', height 32→36 (Figma 586:673~676) */
                  WebkitTapHighlightColor: 'transparent',              // ← [2026-05-07 v3] iOS 회색 박스 제거
                  touchAction: 'manipulation',                          // ← [2026-05-07 v3] 300ms tap delay 제거
                  userSelect: 'none',                                    // ← [2026-05-07 v3] 텍스트 선택 차단
                }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {calView === 'monthly' && <MonthlyView bookings={filteredBks} selectedDate={selectedDate} onDayClick={d => { setSelectedDate(d); setCalView('daily') }} onBookingClick={onBookingClick} rooms={allRooms} currentUser={currentUser} isAdmin={isAdmin} />}
      {/* ← [2026-04-24] onEmptyClick 시그니처 변경: (rid, h) → (rid, startMin, endMin) — 15분 단위 클릭 지원 */}
      {calView === 'daily'   && <DailyView   bookings={dailyBks}  selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(rid, startMin, endMin) => onNewBooking(selectedDate, rid, startMin, endMin)} onCheckIn={onCheckIn} rooms={allRooms} currentUser={currentUser} currentUserId={currentUserId} currentUserEmail={currentUserEmail} users={users} isAdmin={isAdmin} />}{/* ← [2026-04-24 P5 FIX] DailyView 호출에 currentUserId/Email/users 전달 */}
      {/* ← [2026-04-27] 60→15: Weekly 슬롯도 기본 15분 프리필 (BookingModal/DailyView와 동기화) */}
      {/*   Weekly 슬롯은 시간 단위(1시간 박스)지만, 클릭 시 모달 진입 후 기본 시간은 15분 */}
      {calView === 'weekly'  && <WeeklyView  bookings={weekBks}   selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(d, h) => onNewBooking(d, undefined, h*60, h*60 + 15)} rooms={allRooms} currentUser={currentUser} isAdmin={isAdmin} />}
      {dpTooltipNode /* ← [2026-04-23] 데이트피커 차단 셀용 커스텀 툴팁 Portal 렌더 */}
    </div>
  )
}

// ─── Monthly View ─────────────────────────────────────────────────────────────
export function MonthlyView({ bookings, selectedDate, onDayClick, onBookingClick, rooms: mvRooms = [], currentUser = '', isAdmin = false }) {
  const holidayMap = useHolidayMap()   // ← [2026-08-03] 셀 공휴일·이벤트 라벨
  const d = dateToObj(selectedDate), year = d.getFullYear(), month = d.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const dim = new Date(year, month + 1, 0).getDate()
  const today = todayStr()
  const now = nowMinutes()  // ← [2026-04-23 HOTFIX] isShownInCalendar용
  // ← [2026-04-23] Monthly 뷰 차단 셀용 커스텀 툴팁
  const { getHandlers: getMonthlyTooltipHandlers, tooltipNode: monthlyTooltipNode } = useBlockedTooltip()
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let i = 1; i <= dim; i++) cells.push(i)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    // ← [2026-04-24 v2] Monthly 뷰 full height 적용
    //   · height: calc(100vh - 220px)로 상단 헤더/툴바 제외한 나머지 전체 차지
    //   · min-height 560: 6주 월(최대)에서 각 행 최소 ~90px 확보
    //   · grid rows를 auto(헤더) + 1fr repeat(6)으로 분할해 본체 행이 세로 공간 균등 차지
    <div style={{
      background: '#fff', borderRadius: 20, border: '1px solid #FFFFFF', overflow: 'hidden',  /* ← [2026-05-13 v5] borderRadius 16→20 / [v4] border '#E2E8F0' → '#FFFFFF' (캘린더 쉘 외곽, MonthlyView) */
      height: 'calc(100vh - 220px)', minHeight: 560,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ← [2026-04-24] 요일 헤더 배경 #F8FAFC → #FFF */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: '#fff', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
        {DAY_NAMES.map((n, i) => (
          <div key={n} style={{ padding: '10px 0', textAlign: 'center', fontSize: 12, fontWeight:600,
            color: i===0 ? '#EF4444' : i===6 ? '#3B82F6' : '#64748B' }}>{n}</div>
        ))}
      </div>
      {/* ← [2026-04-24] 본체 grid: flex 1로 남은 세로 공간 전체 차지 + rows 균등 분할 */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(7,minmax(0,1fr))',
        gridAutoRows: 'minmax(0, 1fr)',  // 모든 행이 남은 공간 균등 분할
      }}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`e${idx}`} style={{ borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9', background: '#FAFAFA', overflow: 'hidden' }} />
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
          // ← [2026-04-23] 차단 셀(30일 초과)에만 커스텀 툴팁 — blocked=dimmed
          const mtH = getMonthlyTooltipHandlers({ blocked: dimmed, message: tooltipMsg })
          return (
            <div key={day} onClick={() => { if (canNavigate) onDayClick(ds) }}
              aria-label={!canNavigate ? tooltipMsg : undefined}   // ← [2026-04-23] 접근성: 스크린리더용
              onMouseEnter={mtH.onMouseEnter}                       // ← [2026-04-23] 커스텀 툴팁: 진입
              onMouseMove={mtH.onMouseMove}                         // ← [2026-04-23] 커스텀 툴팁: 이동
              onMouseLeave={mtH.onMouseLeave}                       // ← [2026-04-23] 커스텀 툴팁: 이탈
              style={{
                // ← [2026-04-24] minHeight 110 제거 (grid rows가 관리)
                //     flex column으로 헤더 + 예약 리스트 분리
                borderRight: '1px solid #F1F5F9', borderBottom: '1px solid #F1F5F9',
                padding: '7px 6px',
                cursor: dimmed ? 'default' : (canNavigate ? 'pointer' : 'default'),
                overflow: 'hidden',
                background: dimmed ? '#F8FAFC' : isSel ? '#EEF2FF' : isToday ? '#F0FDF4' : '#fff',
                opacity: dimmed ? 0.5 : 1,
                transition: 'background 0.12s',
                display: 'flex', flexDirection: 'column', minHeight: 0,
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5, flexShrink: 0 }}>
                <span style={{
                  width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: '50%', fontSize: 12, fontWeight: isToday ? 600 : 500,
                  background: isToday ? '#111111' : 'transparent',
                  // ← [2026-08-03] 공휴일 빨강 우선 (오늘 원형 배지는 유지)
                  color: isToday ? '#fff' : holidayMap.get(ds)?.holiday ? '#EF4444'
                    : dow===0 ? '#EF4444' : dow===6 ? '#3B82F6' : '#374151',
                }}>{day}</span>
                {/* ← [2026-08-03] 셀 라벨 — 공휴일명 빨강 / 이벤트명 보라, 좁은 셀이라 ellipsis */}
                {(holidayMap.get(ds)?.holiday || holidayMap.get(ds)?.company) && (
                  <span style={{
                    flex: 1, minWidth: 0, marginLeft: 4, fontSize: 9, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: holidayMap.get(ds)?.holiday ? '#EF4444' : '#8B5CF6',
                  }}
                    title={[holidayMap.get(ds)?.holiday, holidayMap.get(ds)?.company].filter(Boolean).join(' · ')}>
                    {[holidayMap.get(ds)?.holiday, holidayMap.get(ds)?.company].filter(Boolean).join(' · ')}
                  </span>
                )}
                {dbs.length > 0 && <span style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>{dbs.length}건</span>}
              </div>
              {/* ← [2026-04-24] 예약 리스트: flex-1 + overflow-hidden
                   · 셀 높이에 들어갈 수 있는 만큼만 노출, 초과분은 +N개로 표시
                   · 주간뷰와 동일한 CompactCard 스타일 사용 (isToday 기반 검정/회색 테마)
                   ← [2026-04-24 v2] 노출 카드 수 3 → 4 (6주 월에서도 거의 다 보이도록) */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                {dbs.slice(0, 4).map(b => (
                  <CalendarCompactCard
                    key={b.id}
                    booking={b}
                    isToday={isToday}
                    onClick={e => { e.stopPropagation(); onBookingClick(b) }}
                  />
                ))}
                {dbs.length > 4 && <div style={{ fontSize: 9, color: '#94A3B8', paddingLeft: 3, flexShrink: 0 }}>+{dbs.length-4}개</div>}
              </div>
            </div>
          )
        })}
      </div>
      {monthlyTooltipNode /* ← [2026-04-23] Monthly 차단 셀용 커스텀 툴팁 Portal 렌더 */}
    </div>
  )
}

// ─── Daily View ───────────────────────────────────────────────────────────────
// ← [2026-04-24 P5 FIX] DailyView 시그니처에 P5 prop 3개 추가
//   · 원인: CalendarShell 함수는 prop 받지만, 그 안에서 호출되는 DailyView 별도 함수라 자체 시그니처 필요
//   · 사용처: L853/854 CalendarSlotCard 호출, L872 getSlotState 호출, L886/887 CalendarSlotCard 호출
export function DailyView({ bookings, selectedDate, onBlockClick, onEmptyClick, onCheckIn, rooms: dvRooms = [], currentUser = '', currentUserId = '', currentUserEmail = '', users = [], isAdmin = false }) {
  const isToday = selectedDate === todayStr(), now = nowMinutes()
  // ← [2026-04-23] Figma 재설계: 슬롯 사이즈 확대
  //   · CW 160 → 200 (예약 슬롯 가로 공간 확보, 제목 더 길게 노출)
  //   · RH 80 → 92 (슬롯 세로 공간 확대, 제목/시간/예약자 3줄 + 칩 row 여유)
  //   · LW 224 (좌측 회의실명 컬럼 너비는 유지)
  // ← [2026-05-06 핫픽스 v18] RH 92 → 86 (사용자 요청, 셀 컴팩트화)
  //   · 단일 진실 원천: 외곽 row(L735) + 내부 셀(L779) 모두 자동 동기화
  //   · 이벤트 박스(L878 positionStyle): top:3 bottom:4 절대값 사용 → RH 변경 자동 적응 ✅
  //   · 시간 인디케이터/헤더 등 raw magic number 사용처 0건 → 부작용 없음
  // ← [2026-05-06 v19] RH 86 → 92 (사용자 재요청, 다시 확대 — 86이 너무 컴팩트)
  // ← [2026-05-06 v20] RH 92 → 88 (92와 86 중간값으로 미세 조정)
  const CW = 200, RH = 88, LW = 224
  const rooms = (dvRooms as any[]).filter(r => r.is_active)
  const totalW = CW * HOURS.length
  // ← [2026-04-23] 예약 가능 기간 정책: 시간 슬롯 단위 판정 (아래 map 내부에서)
  //   오늘 날짜라도 지나간 시간은 차단 (Admin 포함, 1분이라도 과거 불가)
  const todayStrVal = todayStr()
  // ← [2026-04-23] Daily 뷰 차단 슬롯용 커스텀 툴팁
  const { getHandlers: getDailyTooltipHandlers, tooltipNode: dailyTooltipNode } = useBlockedTooltip()

  // ─── [2026-04-23] "15분 단위 올림" 규칙 ────────────────────────────────
  // 예약은 15분 간격으로만 생성 가능 → 슬롯 폭도 15분 단위로 정렬
  //   · 실제 점유 시간 n분 → 슬롯 폭 = Math.ceil(n / 15) * 15 분
  //   · 최소 15분 폭 보장 (n < 15분인 경우도 15분 슬롯으로 표시)
  //
  // 적용 대상:
  //   · 노쇼 박제 슬롯: 시점에 관계없이 15분 폭 고정 (기존 동작과 동일)
  //   · 조기반납 슬롯: 실제 종료 시각 기준으로 15분 올림
  //     예) 1시간 3분 사용 → 75분 폭 / 1시간 18분 → 90분 폭 / 55분 → 60분 폭
  //   · 일반 예약 슬롯: 정상 예약은 애초에 15분 단위로 생성되므로 영향 없음
  //     (보수적으로 전 케이스에 적용해도 결과 동일 — 회귀 방지 장치)
  const QUANTIZE_MIN = 15
  const quantizeMin = (n: number) => Math.max(QUANTIZE_MIN, Math.ceil(n / QUANTIZE_MIN) * QUANTIZE_MIN)
  // 분 → 슬롯 폭(px) 변환 (여백 14 차감은 호출부에서 처리)
  const minToPx = (n: number) => (n / 60) * CW

  // ── [2026-04-24] 현재시간 인디케이터 전용 precise now (소수점 분)
  //   목적: 빨간 라인이 1분 단위로 뚝뚝 점프하는 현상 제거.
  //   전략: App 전역 tick은 10초 유지(성능 영향 없음). 이 뷰에서만 1초마다
  //        소수점 분 값을 갱신하여 인디케이터 위치 계산에 사용.
  //   범위: preciseNowMin은 오직 nowLeft(빨간 라인 left)에만 영향.
  //        예약 판정·pill 텍스트·스크롤 초기값 등 나머지는 기존 now(정수분) 그대로.
  //   보간: 인디케이터 컨테이너에 transition: left 1s linear 부여 →
  //        1초 단위 샘플 사이도 CSS가 자연스럽게 보간.
  const [preciseNowMin, setPreciseNowMin] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
  })
  useEffect(() => {
    if (!isToday) return
    const iv = setInterval(() => {
      const d = new Date()
      setPreciseNowMin(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60)
    }, 1000)
    return () => clearInterval(iv)
  }, [isToday])

  // ← [2026-04-24] nowLeft는 preciseNowMin 기반 (소수점 분) → 매 초 부드럽게 이동
  //   기존: now(정수분) 기반 → 1분마다 픽셀 단위 점프
  const nowLeft = isToday ? ((preciseNowMin - 7*60) / 60) * CW : 0
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!scrollRef.current) return
    // ← [2026-04-24] 초기 스크롤 여백 120px → CW(200px) = 1시간.
    //   현재 시간 빨간 라인 왼쪽에 '바로 직전 1시간 블록'이 완전히 보이도록 여유 확보.
    //   기존 120px은 약 36분 여유만 줘서 현재 시간이 화면 왼쪽에 너무 붙어 답답했음.
    //   ← [2026-04-24 추가] selectedDate 변경 또는 today 전환 시점에만 초기화.
    //   preciseNowMin은 deps에서 제거 — 매 초 스크롤이 리셋되는 걸 방지.
    const initialNowLeft = isToday ? ((now - 7*60) / 60) * CW : 0
    scrollRef.current.scrollLeft = isToday ? Math.max(0, initialNowLeft - CW) : 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isToday])

  // ─── [2026-06-10] 타임라인 좌/우 스크롤 화살표 ──────────────────────────────
  //   · 표시 판정: 실제 스크롤 가능 여부(scrollLeft·clientWidth·scrollWidth) — 끝 도달 시 fade-out
  //   · 스크롤량: 가시 타임라인폭(clientWidth - 회의실명 컬럼 LW)의 0.8배, 최소 CW(1시간), smooth
  const [canLeft, setCanLeft]   = useState(false)                    // ← [2026-06-10] 왼쪽으로 더 스크롤 가능?
  const [canRight, setCanRight] = useState(false)                    // ← [2026-06-10] 오른쪽으로 더 스크롤 가능?
  const updateArrows = useCallback(() => {                           // ← [2026-06-10] 양끝 도달 여부 갱신
    const el = scrollRef.current                                     // ← [2026-06-10]
    if (!el) { setCanLeft(false); setCanRight(false); return }       // ← [2026-06-10]
    setCanLeft(el.scrollLeft > 1)                                    // ← [2026-06-10] 0 초과면 왼쪽 여지 있음(±1px 오차 허용)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1) // ← [2026-06-10] 오른쪽 끝 미도달
  }, [])                                                             // ← [2026-06-10]
  const scrollTimeline = useCallback((dir: 1 | -1) => {              // ← [2026-06-10] dir: -1 왼쪽 / +1 오른쪽
    const el = scrollRef.current                                     // ← [2026-06-10]
    if (!el) return                                                  // ← [2026-06-10]
    const visibleTimelineW = Math.max(0, el.clientWidth - LW)        // ← [2026-06-10] sticky 회의실명 컬럼 제외 가시폭
    const amount = Math.max(CW, visibleTimelineW * 0.8)              // ← [2026-06-10] 80% 이동(약간 겹침), 최소 1시간
    el.scrollBy({ left: dir * amount, behavior: 'smooth' })          // ← [2026-06-10] 부드럽게 스크롤
  }, [])                                                             // ← [2026-06-10]
  useEffect(() => {                                                  // ← [2026-06-10] 마운트/리사이즈/날짜변경 시 화살표 표시 갱신
    updateArrows()                                                   // ← [2026-06-10] 초기 1회 (초기 스크롤 effect 직후 실행 — 선언 순서 보장)
    const el = scrollRef.current                                     // ← [2026-06-10]
    if (!el) return                                                  // ← [2026-06-10]
    const ro = new ResizeObserver(() => updateArrows())              // ← [2026-06-10] 컨테이너 크기 변화 감지
    ro.observe(el)                                                   // ← [2026-06-10]
    window.addEventListener('resize', updateArrows)                  // ← [2026-06-10]
    return () => { ro.disconnect(); window.removeEventListener('resize', updateArrows) } // ← [2026-06-10]
  }, [updateArrows, selectedDate])                                   // ← [2026-06-10] 날짜 변경 시 재평가

  // ← [2026-04-23] getRoomDot 함수 완전 삭제 — 회의실 상태 dot 표시 불필요 (요청)

  return (
    <div style={{ position: 'relative' }}>{/* ← [2026-06-10] 화살표 뷰포트 고정용 relative wrapper — scrollRef(가로 스크롤) 콘텐츠와 분리 */}
    <div ref={scrollRef} onScroll={updateArrows} style={{ background: '#fff', borderRadius: 20, border: '1px solid #FFFFFF', overflowX: 'auto', overflowY: 'visible' }}>{/* ← [2026-05-13 v5] borderRadius 16→20 / [v4] border '#E2E8F0' → '#FFFFFF' (캘린더 쉘 외곽, DailyView) ← [2026-06-10] onScroll로 화살표 표시 갱신 */}
      <div style={{ minWidth: LW + totalW, position: 'relative' }}>

        {/* 현재시간 인디케이터 — dot(헤더 하단 경계선) + 세로 라인만
             ← [2026-04-24 최종] pill 제거 (헤더 시간 라벨 가림 문제 해결)
                · pill 없음: 헤더 시간 라벨(정오시/오후 1시 등) 가독성 회복
                · dot  top:38 (헤더 하단 경계선 위)
                · line top:48 (헤더 바로 아래부터 바닥까지 관통)
             ← 컨테이너 zIndex 10: dot이 헤더(9) 위에 떠야 하므로 유지
             ← transition: left 1s linear + preciseNowMin 기반 부드러운 이동 */}
        {isToday && nowLeft >= 0 && nowLeft <= totalW && (
          <div style={{ position: 'absolute', zIndex: 10, pointerEvents: 'none',
            top: 0, bottom: 0, left: LW + nowLeft, width: 0,
            transition: 'left 1s linear', willChange: 'left' }}>
            {/* dot — 헤더 하단 경계선 위(top:38) */}
            <div style={{ position: 'absolute', top: 38, left: '50%', transform: 'translateX(-50%)',
              width: 10, height: 10, borderRadius: '50%',
              background: '#FF373B', border: '1.5px solid #fff', zIndex: 9 }} />
            {/* 세로 라인 — 헤더 바로 아래(top:48)부터 바닥까지 관통 */}
            <div style={{ position: 'absolute', top: 48, bottom: 0, left: '50%',
              transform: 'translateX(-50%)', width: 2, background: '#FF393C' }} />
          </div>
        )}

        {/* 헤더: 시간축
            ← [2026-04-23 v9] 스타일 조정:
            · 배경 #F8FAFC → #FFF
            · 폰트 크기 11 → 12
            · 폰트 두께 600 → 500 */}
        <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 9, background: '#FFF', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ width: LW, minWidth: LW, flexShrink: 0, borderRight: '1px solid #E2E8F0',
            padding: '10px 16px', fontSize: 12, fontWeight: 500, color: '#94A3B8',
            position: 'sticky', left: 0, zIndex: 9, background: '#FFF' }}>회의실</div>
          {HOURS.map(h => (
            <div key={h} style={{ width: CW, minWidth: CW, textAlign: 'center', padding: '10px 0',
              fontSize: 12, fontWeight: 500, color: '#64748B',
              borderRight: '1px solid #E2E8F0', flexShrink: 0, background: '#FFF' }}>
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
          // ← [2026-04-23] dot 변수 삭제 (getRoomDot 함수 제거와 함께)

          return (
            <div key={room.room_id}
              style={{ display: 'flex', borderBottom: ri < rooms.length-1 ? '1px solid #F1F5F9' : 'none',
                height: RH, minHeight: RH, maxHeight: RH, position: 'relative' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFAFA'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>

              {/* 회의실명 셀 (sticky left)
                  ← [2026-04-23 v13 Figma 243:612] 스펙 반영:
                  · padding: 12 (전방향)
                  · 이름: 15px Medium + letterSpacing 0.45 + leading-none
                  · 층/인원: 10px Regular + leading-none
                  · 이름-층 gap: 6
                  ← [2026-04-23 v14] 추가 변경:
                  · justify-content: center → flex-start (위에서부터 정렬)
                  · 상태 dot(초록/빨강) 완전 제거 — 이에 따라 flex wrapper 불필요 */}
              <div style={{ width: LW, minWidth: LW, flexShrink: 0, borderRight: '1px solid #E2E8F0',
                padding: 12,
                display: 'flex', flexDirection: 'column',
                justifyContent: 'flex-start',                       // ← [v14] center → flex-start
                position: 'sticky', left: 0, background: '#fff', zIndex: 11,
                // ← [2026-04-24 HOTFIX v2] z-index 6 → 11
                //   근본 원인: 인디케이터 컨테이너(zIndex:10)가 sticky 회의실명(6)보다 위라
                //   가로 스크롤 시 인디케이터가 회의실명 영역 위를 침범해 그려짐.
                //   해결: room-label을 11로 올려 인디케이터(10), 헤더(9), 예약 카드(5) 모두 위에 배치.
                //   히스토리:
                //     · 5 → 6: 예약 카드(zIndex:5) 동률 충돌 해소 (2026-04-24 1차)
                //     · 6 → 11: 인디케이터(10) 침범 해소 (2026-04-24 2차)
                boxShadow: 'none' }}>
                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 /* ← [v13] Figma 243:614 gap-[6px] */ }}>
                  <div style={{
                    fontSize: 16, fontWeight: 500, color: '#000',        // ← [v14] 15 → 16
                    lineHeight: '17px',                                   // ← [v14] leading-none → 17px
                    letterSpacing: 0,                                     // ← [v14] 0.45px → 0
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontFamily: "'Pretendard', -apple-system, sans-serif",
                  }}>{room.room_name}</div>
                  <div style={{
                    fontSize: 10, fontWeight: 400, color: '#94A3B8',
                    lineHeight: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    fontFamily: "'Pretendard', -apple-system, sans-serif",
                  }}>{floor?.floor_name} · {room?.capacity}인</div>
                </div>
              </div>

              {/* 시간 셀 */}
              <div style={{ flex: 1, position: 'relative', height: RH, display: 'flex', overflow: 'hidden' }}>
                {HOURS.map(h => {
                  // ← [2026-04-23] 슬롯 단위 예약 가능성 판정
                  //   · 과거 날짜/시간 전체 차단 (Admin 포함) — 기능만 차단, 시각은 정상(opacity 1)
                  //   · 30일 초과는 일반 사용자만 차단 — 시각적 구분 필요 (opacity 0.4)
                  // ← [2026-04-24] 블록 단위 판정으로 변경 — 블록 내 마지막 15분(h:45)이 미래면 블록 허용
                  const slotBookable = isSlotBookable(selectedDate, h, todayStrVal, now, isAdmin)
                  // ← [2026-04-24] isPastSlot도 블록 단위 과거 판정으로 통일 (기존: 블록 시작만 체크 → 부분 미래 블록을 과거로 오판정)
                  const isPastSlot = selectedDate < todayStrVal || (selectedDate === todayStrVal && (h + 1) * 60 - 15 <= now)
                  const tooltipMsg = !slotBookable
                    ? (isPastSlot ? '과거 시간은 예약할 수 없습니다' : '예약은 오늘부터 30일 이내만 가능합니다')
                    : ''
                  // 과거는 시각 효과 없이 클릭만 차단, 30일 초과만 흐리게
                  const dimmed = !slotBookable && !isPastSlot
                  // ← [2026-04-23] 차단 슬롯(과거 or 30일 초과)에 커스텀 툴팁 (블록 단위 훅 — 부모 div에서만 처리)
                  const dlH = getDailyTooltipHandlers({ blocked: !slotBookable, message: tooltipMsg })
                  return (
                    <div key={h}
                      aria-label={!slotBookable ? tooltipMsg : undefined}   // ← [2026-04-23] 접근성
                      style={{
                        width: CW, minWidth: CW, flexShrink: 0, borderRight: '1px solid #F1F5F9',
                        cursor: 'default',                                   // ← [2026-04-24 v2] 블록 자체는 default — 클릭/hover는 quarter overlay가 담당
                        position: 'relative', transition: 'background 0.1s', opacity: dimmed ? 0.4 : 1,
                      }}
                      onMouseEnter={dlH.onMouseEnter}                       // ← [2026-04-24 v2] 블록 전체 배경 하이라이트 제거 — quarter가 개별 담당
                      onMouseMove={dlH.onMouseMove}                          // ← [2026-04-23] 마우스 추적 (툴팁용)
                      onMouseLeave={dlH.onMouseLeave}>
                      {/* 15분 구분선 — quarter 경계 표시 (dashed, pointerEvents:none로 클릭 통과) */}
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '25%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', borderLeft: '1px dashed #F1F5F9', pointerEvents: 'none' }} />
                      <div style={{ position: 'absolute', top: 0, bottom: 0, left: '75%', borderLeft: '1px dashed #F8FAFC', pointerEvents: 'none' }} />

                      {/* ← [2026-04-24 v2] 15분 quarter 개별 hover/click 영역 (오버레이 4개)
                          배경: 기존 1시간 블록 전체 hover 방식 → 사용자가 1시간 단위 예약만 가능한 것으로 오해.
                                onClick은 이미 15분 단위로 프리필되지만 hover 피드백이 1시간 단위라 시각/기능 불일치.
                          해결: 4개 quarter overlay를 absolute 25%씩 배치하여 각각 독립 hover/click 처리.

                          동작:
                            · slotBookable=false(과거/30일 초과): overlay 미생성 → 블록 전체 툴팁 표시 (기존 UX 유지)
                            · slotBookable=true: 4개 quarter overlay 렌더링
                              - q=0 (h:00~h:15) / q=1 (h:15~h:30) / q=2 (h:30~h:45) / q=3 (h:45~(h+1):00)
                              - quarterBookable 개별 판정: 과거 quarter는 cursor default + hover 무반응
                                예: 10:10 현재 → 10시 블록의 q0(10:00)은 과거라 반응 없음, q1~q3만 반응
                              - 미래 quarter hover: 배경 rgba(30,41,59,0.04) + cursor pointer

                          zIndex 미지정: 소스 순서로 dashed(pointerEvents:none) 위, 예약 블록(absolute zIndex:1/3/5)
                            아래 자연 stacking → 예약 블록 hover/click 정상 유지. */}
                      {slotBookable && [0, 1, 2, 3].map(q => {
                        const clickedMin = h * 60 + q * 15
                        const quarterBookable = isQuarterBookable(selectedDate, clickedMin, todayStrVal, now, isAdmin)
                        return (
                          <div key={q}
                            onClick={() => {
                              if (!quarterBookable) return
                              // ← [2026-04-27] 60→15: 캘린더 슬롯 클릭 기본 시간 1시간 → 15분 (BookingModal 모달 오픈/날짜변경/tick보정/데스크톱 select와 동기화)
                              const endMin = Math.min(clickedMin + 15, 19 * 60)
                              onEmptyClick(room.room_id, clickedMin, endMin)   // ← [2026-04-24] 시그니처: (rid, startMin, endMin)
                            }}
                            style={{
                              position: 'absolute', top: 0, bottom: 0,
                              left: `${q * 25}%`, width: '25%',
                              cursor: quarterBookable ? 'pointer' : 'default',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (quarterBookable) (e.currentTarget as HTMLElement).style.background = 'rgba(30,41,59,0.04)' }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                          />
                        )
                      })}
                    </div>
                  )
                })}

                {/* 행별 현재시간선 제거됨 ← [2026-04-24] A안 적용.
                     기존: 각 행마다 top:0~bottom 세로 라인 + ri===0일 때 dot. 9행 × 1라인 = 9개 중복,
                     색상도 #EF4444(행별)와 #FF393C(상위) 두 가지 섞임. 상위 인디케이터 하나로 단일화. */}

                {/* 노쇼 박제 슬롯 — CalendarSlotCard 단일 컴포넌트로 통합
                     ← [2026-04-23 v12] 렌더 로직을 CalendarSlotCard로 이관
                     · 배경/border/칩/컴팩트(15분 폭) 분기 모두 컴포넌트 내부 담당
                     · 호출부는 위치 계산(absolute top/left/width)만 책임 */}
                {rBksCancelled.map(b => {
                  const sm = tsMin(b.start_at)
                  // 노쇼는 시점 무관 15분 폭 고정 → 컴팩트 모드 자동 적용
                  const occupiedMin = quantizeMin(15)
                  const left  = ((sm-7*60)/60)*CW + 3
                  const width = Math.max(minToPx(occupiedMin) - 7, 20)
                  return (
                    <CalendarSlotCard
                      key={b.id}
                      booking={b}
                      room={null}
                      currentUser={currentUser}
                      currentUserId={currentUserId}
                      currentUserEmail={currentUserEmail}
                      users={users}
                      now={now}
                      isToday={isToday}
                      occupiedMin={occupiedMin}
                      positionStyle={{ position: 'absolute', top: 3, bottom: 4, left, width, zIndex: 1 }}
                      onClick={(e) => { e.stopPropagation(); onBlockClick(b) }}
                    />
                  )
                })}

                {/* 예약 블록 — CalendarSlotCard 단일 컴포넌트로 통합
                     ← [2026-04-23 v12] Figma 242:427 신규 스펙 반영
                     · 15분 폭 규칙: compact 모드 자동 분기 (칩 숨김, 텍스트만)
                     · 사용 중(isAct): 흰 배경 + 1px #373737 border
                     · 그 외(예약됨/사용완료/조기반납): #1D1D1D 검정 배경 */}
                {rBks.map(b => {
                  // ← [2026-04-24 P5] getSlotState 시그니처 변경 — 이름 → UUID/email
                  const st = getSlotState(b, now, isToday, currentUserId, currentUserEmail)
                  const { sm, em, isEnded, isAct, isNoshow } = st
                  // 15분 단위 올림 (조기반납 제외 일반 예약은 원본 유지)
                  const actualMin   = em - sm
                  const occupiedMin = isEnded ? quantizeMin(actualMin) : actualMin
                  const left  = ((sm-7*60)/60)*CW + 3
                  const width = Math.max(minToPx(occupiedMin) - 7, 20)
                  const slotRoom = (dvRooms as any[]).find(r => r.room_id === b.room_id)
                  return (
                    <CalendarSlotCard
                      key={b.id}
                      booking={b}
                      room={slotRoom}
                      currentUser={currentUser}
                      currentUserId={currentUserId}
                      currentUserEmail={currentUserEmail}
                      users={users}
                      now={now}
                      isToday={isToday}
                      occupiedMin={occupiedMin}
                      positionStyle={{
                        position: 'absolute',
                        top: 3, bottom: 4, left, width,
                        zIndex: isNoshow ? 1 : isAct ? 5 : 3,
                      }}
                      onClick={(e) => { e.stopPropagation(); onBlockClick(b) }}
                      onMouseEnter={e => { if (!isNoshow) (e.currentTarget as HTMLElement).style.filter = isAct ? 'brightness(0.97)' : 'brightness(1.15)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = 'none' }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      {dailyTooltipNode /* ← [2026-04-23] Daily 차단 슬롯용 커스텀 툴팁 Portal 렌더 */}
      {/* ← [2026-06-10] scrollRef(가로 스크롤 컨테이너) 닫기 — 닫는 태그 뒤 주석은 TS JSX 파서 에러라 앞 줄에 배치 */}
    </div>

      {/* ← [2026-06-10] 좌측 스크롤 화살표 (Figma 1308:611) — 회의실명 컬럼 경계(LW-8) + 세로 중앙. 좌측 끝이면 fade-out */}
      <button type="button" onClick={() => scrollTimeline(-1)} aria-label="이전 시간대"
        style={{
          position: 'absolute', left: 200, top: '47%', transform: 'translateY(-50%)',     /* ← [2026-06-10] 위치 조정: left LW-8→200, top 50%→47% (사용자 요청) */
          width: 48, height: 48, borderRadius: 100, boxSizing: 'border-box',               /* ← [2026-06-10] 박스 40→48 / borderRadius 100 (원형) */
          background: 'rgba(255,255,255,0.65)', border: '1px solid #F1F1F1',                /* ← [2026-06-10] 배경 투명도 0.1→0.65 + #F1F1F1 1px */
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',                 /* ← [2026-06-10] 반투명 글래스 */
          display: 'flex', alignItems: 'center', justifyContent: 'center',                  /* ← [2026-06-10] 아이콘 16 정중앙(여백 12) */
          cursor: 'pointer', zIndex: 20,                                                     /* ← [2026-06-10] 헤더(9)/현재시각(10) 위 */
          opacity: canLeft ? 1 : 0, pointerEvents: canLeft ? 'auto' : 'none',                /* ← [2026-06-10] 좌측 끝 도달 시 숨김 + 클릭 비활성 */
          transition: 'opacity 0.2s ease',                                                   /* ← [2026-06-10] 부드러운 fade */
        }}>
        <IcoTimelineLeft />{/* ← [2026-06-10] '<' (arrow.svg) */}
      </button>

      {/* ← [2026-06-10] 우측 스크롤 화살표 (Figma 1308:615) — 가시영역 오른쪽(right 8) + 세로 중앙. 우측 끝이면 fade-out */}
      <button type="button" onClick={() => scrollTimeline(1)} aria-label="다음 시간대"
        style={{
          position: 'absolute', right: -20, top: '47%', transform: 'translateY(-50%)',       /* ← [2026-06-10] 위치 조정: right 8→-20, top 50%→47% (사용자 요청) */
          width: 48, height: 48, borderRadius: 100, boxSizing: 'border-box',               /* ← [2026-06-10] 박스 40→48 / borderRadius 100 (원형) */
          background: 'rgba(255,255,255,0.65)', border: '1px solid #F1F1F1',                /* ← [2026-06-10] 배경 투명도 0.1→0.65 + #F1F1F1 1px */
          backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',                 /* ← [2026-06-10] 반투명 글래스 */
          display: 'flex', alignItems: 'center', justifyContent: 'center',                  /* ← [2026-06-10] 아이콘 16 정중앙(여백 12) */
          cursor: 'pointer', zIndex: 20,                                                     /* ← [2026-06-10] 헤더(9)/현재시각(10) 위 */
          opacity: canRight ? 1 : 0, pointerEvents: canRight ? 'auto' : 'none',              /* ← [2026-06-10] 우측 끝 도달 시 숨김 + 클릭 비활성 */
          transition: 'opacity 0.2s ease',                                                   /* ← [2026-06-10] 부드러운 fade */
        }}>
        <IcoTimelineRight />{/* ← [2026-06-10] '>' (arrow_back.svg) */}
      </button>
      {/* ← [2026-06-10] relative wrapper(화살표 뷰포트 고정용) 닫기 — 닫는 태그 뒤 주석은 TS JSX 파서 에러라 앞 줄에 배치 */}
    </div>
  )
}

// ─── Weekly View ──────────────────────────────────────────────────────────────
export function WeeklyView({ bookings, selectedDate, onBlockClick, onEmptyClick, rooms = [], currentUser = '', isAdmin = false }) {
  const holidayMap = useHolidayMap()   // ← [2026-08-03] 요일 헤더 공휴일·이벤트 라벨
  const today     = todayStr()
  const now       = nowMinutes()
  const HOUR_H    = 140   // 1시간 행 높이 (Figma 스펙)
  const TIME_W    = 64    // 시간 레이블 열 너비
  // ← [2026-04-23] Weekly 뷰 차단 슬롯용 커스텀 툴팁
  const { getHandlers: getWeeklyTooltipHandlers, tooltipNode: weeklyTooltipNode } = useBlockedTooltip()

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

  // ← [2026-04-24] fmtAmPm 제거 (CalendarCompactCard 내부로 이관됨)

  // 요일별 색상
  const dayColor = (dow: number, isToday2: boolean) => {
    if (dow === 0) return '#EF4444'
    if (dow === 6) return '#3B82F6'
    return '#333333'
  }

  return (
    <div style={{ background: '#fff', borderRadius: 20, border: '1px solid #FFFFFF', overflow: 'hidden' }}>{/* ← [2026-05-13 v5] borderRadius 16→20 / [v4] border '#E2E8F0' → '#FFFFFF' (캘린더 쉘 외곽, WeeklyView) */}
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
                  {/* N월 N일: 동일 색상 체계 — ← [2026-08-03] 공휴일이면 빨강 우선 */}
                  <div style={{ fontSize: 12, fontWeight: fw,
                    color: holidayMap.get(ds)?.holiday ? '#EF4444' : color, marginTop: 3,
                    fontFamily: "'Pretendard', -apple-system, sans-serif" }}
                    ref={isToday2 ? todayColRef : undefined}>
                    {d.getMonth()+1}월 {d.getDate()}일
                  </div>
                  {/* ← [2026-08-03] 공휴일명(빨강) · 회사 이벤트명(보라) 라벨 — 없으면 미렌더 */}
                  {(holidayMap.get(ds)?.holiday || holidayMap.get(ds)?.company) && (
                    <div style={{ fontSize: 10, marginTop: 2, lineHeight: 1.4,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {holidayMap.get(ds)?.holiday && (
                        <span style={{ color: '#EF4444', fontWeight: 600 }}>{holidayMap.get(ds)!.holiday}</span>
                      )}
                      {holidayMap.get(ds)?.holiday && holidayMap.get(ds)?.company && <span style={{ color: '#CBD5E1' }}> · </span>}
                      {holidayMap.get(ds)?.company && (
                        <span style={{ color: '#8B5CF6', fontWeight: 600 }}>{holidayMap.get(ds)!.company}</span>
                      )}
                    </div>
                  )}
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
                  //   · 과거는 기능만 차단 (opacity 1, cursor default)
                  //   · 30일 초과는 시각적 구분 (opacity 0.5 + 배경 회색)
                  const bookable = isSlotBookable(ds, h, today, now, isAdmin)
                  const isPastSlot = ds < today || (ds === today && h * 60 <= now)
                  const tooltipMsg = !bookable
                    ? (isPastSlot ? '과거 시간은 예약할 수 없습니다' : '예약은 오늘부터 30일 이내만 가능합니다')
                    : ''
                  const dimmed = !bookable && !isPastSlot
                  // ← [2026-04-23] 차단 슬롯(과거 or 30일 초과)에 커스텀 툴팁
                  const wkH = getWeeklyTooltipHandlers({ blocked: !bookable, message: tooltipMsg })
                  return (
                    <div key={ds}
                      onClick={() => { if (bookable) onEmptyClick(ds, h) }}
                      aria-label={!bookable ? tooltipMsg : undefined}      // ← [2026-04-23] 접근성
                      style={{
                        flex: 1, minWidth: 0, padding: '4px 5px',
                        borderRight: i < days.length - 1 ? '1px solid #F1F5F9' : 'none',
                        cursor: bookable ? 'pointer' : 'default',           // ← [2026-04-23] not-allowed → default
                        background: dimmed ? '#F8FAFC' : isToday2 ? '#FAFEFF' : 'transparent',
                        opacity: dimmed ? 0.5 : 1,
                        minHeight: HOUR_H, transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => { wkH.onMouseEnter(e); if (bookable && visible.length === 0) (e.currentTarget as HTMLElement).style.background = isToday2 ? '#F0FEFF' : '#F8FAFC' }}  // ← [2026-04-23] 훅 합성
                      onMouseMove={wkH.onMouseMove}                                                                                                                                              // ← [2026-04-23] 마우스 추적
                      onMouseLeave={e => { wkH.onMouseLeave(); (e.currentTarget as HTMLElement).style.background = dimmed ? '#F8FAFC' : isToday2 ? '#FAFEFF' : 'transparent' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {visible.map(b => (
                          <CalendarCompactCard
                            key={b.id}
                            booking={b}
                            isToday={isToday2}
                            onClick={e => { e.stopPropagation(); onBlockClick(b) }}
                          />
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
      {weeklyTooltipNode /* ← [2026-04-23] Weekly 차단 슬롯용 커스텀 툴팁 Portal 렌더 */}
    </div>
  )
}


