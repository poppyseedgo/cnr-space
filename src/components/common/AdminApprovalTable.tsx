/**
 * AdminApprovalTable — Admin 페이지 "승인 관리" 테이블
 *
 * ✅ 변경 이력
 *  - [2026-05-06 Admin Phase C] 신규 — Figma node 451:3534 1:1 반영
 *    · Phase B 공통 컴포넌트(DateRangeFilter / SegmentTabBar / DataTable) 사용
 *    · 기존 AdminApprovals 데이터 로직(classify / loadBookingsByRange / canApprove) 그대로 보존
 *    · 처리 컬럼 신설 — 상태별 분기 (승인대기=버튼 / 처리완료=처리자)
 *    · 검색 기능 활성화 (예약자 이름 또는 회의명)
 *
 * 📌 Figma 사양 (node 451:3534)
 *  · 페이지 제목: "승인 관리" 38px H1
 *  · 컬럼 7개: 날짜 164 / 시간 160 / 회의 320 / 회의실 162 / 예약자 124 / 상태 126 / 처리 124
 *  · 세그먼트 탭 5개: 전체 / 승인 대기 / 승인 완료 / 거절 / 기한 초과
 *  · 퀵버튼 3개: 오늘 / 지난 15일 / 지난 3개월 (롤링)
 *  · 검색 input: 예약자 이름 또는 회의명
 *
 * 📌 데이터 정의 (기존 AdminApprovals 로직 보존)
 *  · classify(b):
 *    - 'expired'   = pending && autoCancelled (기한 초과 — Emerald 룸 자동 만료)
 *    - 'pending'   = pending && !autoCancelled (승인 대기)
 *    - 'confirmed' = status='confirmed' (승인 완료)
 *    - 'rejected'  = status='rejected' (거절)
 *  · 데이터 소스: loadBookingsByRange(from, to) + 라이브 bookings 머지
 *  · 필터: adminRoomIds (is_admin_only=true 룸만 — 현재는 Emerald)
 *
 * 📌 처리 컬럼 (사용자 결정 Q4 — C안: 상태별 분기)
 *  · 승인대기 (pending && canApprove): [승인][거절] 버튼 2개
 *  · 처리완료 (confirmed/rejected): 처리자 아바타 + 이름 (예약자 컬럼과 동일 패턴 — UserAvatar 20 + 이름 14)
 *  · 기한초과 (expired): 표시 없음 (자동 만료라 처리자 없음)
 *
 * 📌 canApprove (1분 전 제한)
 *  · 시작 시각 1분 전부터는 승인 불가 (이미 늦음)
 *  · 거절은 시간 무관 가능 (관리자 권한)
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  tsDate, tsTime, tsMin, fmtTime, fmtDateFullWithDay,
  todayStr, objToStr,
} from '../../utils/time'
import { BookingStatusBadge } from './BookingStatusBadge'
import { UserAvatar } from './UserAvatar'
// ← [2026-05-06 핫픽스 v3] UserChip 제거 — 처리자도 예약자와 동일하게 UserAvatar+이름 직접 구성
import { MetaBadge } from './MetaBadge'
import { DateRangeFilter, type QuickButtonDef } from './DateRangeFilter'
import { SegmentTabBar, type TabDef } from './SegmentTabBar'
import { DataTable, type Column } from './DataTable'
import { loadBookingsByRange } from '../../lib/api'
import type { Booking, Room, AppUser } from '../../types'

// ─── 상수 ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 15

// ─── 도메인 분류 함수 (기존 AdminApprovals.classify와 동일) ─────────────────
//   사용자 룰: 확정 공식은 변경 금지. classify는 기존 AdminApprovals에서 사용된 동일 로직
// ← [2026-05-06 사용자 요청] 'cancelled' 분기 추가
//    정의: cancelled_by='user' (사용자 직접 취소). 노쇼/기한초과/관리자 취소는 별개
function classify(b: Booking): 'pending' | 'confirmed' | 'rejected' | 'expired' | 'cancelled' | 'other' {
  if (b.status === 'pending' && b.autoCancelled)  return 'expired'   // 기한 초과 (Emerald 자동 만료)
  if (b.status === 'pending' && !b.autoCancelled) return 'pending'   // 승인 대기
  if (b.status === 'confirmed')                   return 'confirmed' // 승인 완료
  if (b.status === 'rejected')                    return 'rejected'  // 거절
  // ← [2026-05-06] '취소' = 사용자가 직접 취소한 케이스 (cancelledBy='user')
  if (b.status === 'cancelled' && b.cancelledBy === 'user') return 'cancelled'
  return 'other'
}

// ─── 탭/퀵버튼 ID 타입 ───────────────────────────────────────────────────────
type TabId   = 'all' | 'pending' | 'confirmed' | 'rejected' | 'expired' | 'cancelled'
// QuickId는 아래 buildQuickButtons 위에서 정의 (퀵버튼 재구성 ← [Phase 3] 2026-05-06)
// ← [2026-05-06 사용자 요청 Q1-C] 날짜 조회 토글 — 신청일 vs 시작일
type DateFilterMode = 'createdAt' | 'startAt'

// ─── 퀵버튼 ID 타입 ──────────────────────────────────────────────────────────
// ← [2026-05-06 사용자 결정 Q1-A] '오늘' 삭제 + '이번 달'/'전체' 추가
//   재구성: 이번 달 / 지난 3개월 / 전체 (3개)
//   기본값: 이번 달 (가장 자연스러운 진입점)
type QuickId = 'month' | '3months' | 'all'

// ─── 퀵버튼 라벨 동적 생성 (모드별) ─────────────────────────────────────────
// ← [2026-05-06 사용자 결정 Q4-B] 모드에 따라 라벨 다름
//   · createdAt 모드: '이번 달 요청' / '지난 3개월 요청' / '전체'   ← Figma 451:3205
//   · startAt   모드: '이번 달 회의' / '지난 3개월 회의' / '전체'   ← Figma 468:2589
//   '전체'는 모드 무관 (의미 동일)
// ← [2026-05-06 Phase 4 사용자 요청] '신청'→'요청', '진행'→'회의' (Figma 정확 라벨)
function buildQuickButtons(mode: 'createdAt' | 'startAt'): QuickButtonDef<QuickId>[] {
  const verb = mode === 'createdAt' ? '요청' : '회의'  // ← '신청'/'진행' → '요청'/'회의'
  return [
    { id: 'month',    label: `이번 달 ${verb}` },
    { id: '3months',  label: `지난 3개월 ${verb}` },
    { id: 'all',      label: '전체' },                  // ← 모드 무관
  ]
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface AdminApprovalTableProps {
  /** 라이브 bookings (App.tsx state — 즉시 반영용) */
  bookings:         Booking[]
  rooms:            Room[]
  users?:           AppUser[]
  currentUserId:    string
  currentUserEmail: string
  /** 행 클릭 시 상세 모달 */
  onDetail:         (b: Booking) => void
  /** 승인 콜백 */
  onApprove:        (id: string) => Promise<void>
  /** 거절 콜백 */
  onReject:         (id: string, reason: string) => Promise<void>
  /** CSV 다운로드 (현재는 toast — 추후 구현) */
  onCsvClick?:      () => void
}

// ─── Component ───────────────────────────────────────────────────────────────
export function AdminApprovalTable({
  bookings, rooms, users = [],
  currentUserId, currentUserEmail,
  onDetail, onApprove, onReject, onCsvClick,
}: AdminApprovalTableProps) {
  // ── 날짜 범위 헬퍼 (퀵버튼별 from/to 계산) ─────────────────────────────────
  // ← [2026-05-06 Phase 3] 퀵버튼 재구성에 따른 헬퍼
  //   · month: 이번 달 1일 ~ 말일
  //   · 3months: 오늘 -90일 ~ 오늘 (롤링)
  //   · all: '2020-01-01' ~ 오늘 (사용자 결정 Q2-A: 실용적 무한대)
  function getQuickRange(quickId: QuickId): [string, string] {
    const today = new Date()
    if (quickId === 'month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      return [objToStr(first), objToStr(last)]
    }
    if (quickId === '3months') {
      const f = new Date(); f.setDate(f.getDate() - 90)
      return [objToStr(f), objToStr(today)]
    }
    // 'all' — 2020-01-01 ~ today (실용적 무한대)
    return ['2020-01-01', objToStr(today)]
  }

  // ── 날짜 범위 (기본: 이번 달 — 사용자 결정 Q1-A)
  // ← [2026-05-06 Phase 3] '오늘' → '이번 달' 기본값 변경
  const initialMonthRange = (() => {
    const today = new Date()
    const first = new Date(today.getFullYear(), today.getMonth(), 1)
    const last  = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    return [objToStr(first), objToStr(last)] as [string, string]
  })()
  const [from, setFrom] = useState<string>(initialMonthRange[0])
  const [to,   setTo]   = useState<string>(initialMonthRange[1])
  const [activeQuick, setActiveQuick] = useState<QuickId | null>('month')
  // ← [2026-05-06 사용자 요청 Q1-C] 날짜 조회 기준 토글 — 신청일(createdAt) vs 시작일(startAt)
  //    근거: 컬럼이 "승인 요청 날짜" + "날짜(예약 시작일)" 2개로 늘어남 → 어느 기준 조회인지 명시 필요
  //    기본: 신청일(createdAt) — 승인 관리는 "들어온 신청 처리"가 목적
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>('createdAt')
  // ── 활성 탭 (기본: 승인 대기)
  const [tab, setTab] = useState<TabId>('pending')
  // ── 페이지
  const [page, setPage] = useState(1)
  const resetPage = () => setPage(1)
  // ── 검색
  const [searchQ, setSearchQ] = useState('')

  // ── 1분 단위 시각 갱신 (canApprove 판정용)
  const [nowMs, setNowMs] = useState(Date.now())
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 10000)
    return () => clearInterval(iv)
  }, [])

  // ── Admin 룸 ID 집합 (is_admin_only=true 룸만 — 현재 Emerald=room_id=3)
  const adminRoomIds = useMemo(
    () => new Set(rooms.filter(r => r.is_admin_only).map(r => r.room_id)),
    [rooms]
  )

  // ── 백엔드 데이터 (날짜 범위 — 과거 포함, Admin 룸 필터)
  // ← [2026-05-06 Phase 3 사용자 결정 Q3-A] dateFilterMode 반영
  //    · 'createdAt' 모드 → loadBookingsByRange(from, to, 'created_at')
  //    · 'startAt'   모드 → loadBookingsByRange(from, to, 'start_at')   [기존 동작]
  //    deps에 dateFilterMode 추가 → 모드 변경 시 자동 refetch
  const [rangeData, setRangeData] = useState<Booking[]>([])
  const [loadingRange, setLoadingRange] = useState(false)
  const fetchRange = useCallback(async () => {
    setLoadingRange(true)
    try {
      const dateField = dateFilterMode === 'createdAt' ? 'created_at' : 'start_at'
      const data = await loadBookingsByRange(from, to, dateField)
      setRangeData(data.filter(b => adminRoomIds.has(b.room_id)))
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [from, to, adminRoomIds, dateFilterMode])
  useEffect(() => { fetchRange() }, [fetchRange])

  // ── 라이브 + 백엔드 머지 (라이브 우선)
  const mergedData = useMemo(() => {
    const liveAll    = bookings.filter(b => adminRoomIds.has(b.room_id))
    const liveIds    = new Set(liveAll.map(b => b.id))
    const historical = rangeData.filter(b => !liveIds.has(b.id))
    // ← [2026-05-06 사용자 요청] 정렬 기준: start_at → createdAt (생성순, 최신 생성이 위)
    //   근거: 승인 관리는 "방금 들어온 새 예약을 빠르게 확인"이 목적이라
    //         시작일보다 생성일이 더 자연스러운 정렬 키.
    //   MyBookingTable의 displayList 정렬과 동일 패턴 (createdAt 내림차순) → 일관성 확보
    //   createdAt이 없는 (예전) 데이터는 0 fallback → 가장 마지막에 배치됨
    return [...liveAll, ...historical].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [bookings, rangeData, adminRoomIds])

  // ── 날짜 범위 + 토글 적용된 데이터 (단일 진실 원천)
  // ← [2026-05-06 Phase 3 사용자 결정 Q5-A] 카운트와 표시 데이터 통합 기준
  //    근거: counts와 displayList가 다른 데이터 기준으로 계산되면 사용자 혼란
  //    해결: 날짜 토글 + from~to 적용 후의 단일 데이터(filteredByDate) → counts/displayList 모두 이로부터 파생
  //    백엔드(loadBookingsByRange)도 dateField 동일 기준으로 fetch하므로 클라이언트 필터는
  //    라이브 bookings (날짜 무관 전체 admin 데이터) 정리용
  const filteredByDate = useMemo(() => {
    const fromTs = +new Date(from + 'T00:00:00+09:00')
    const toTs   = +new Date(to   + 'T23:59:59+09:00')
    return mergedData.filter(b => {
      if (dateFilterMode === 'createdAt') {
        return b.createdAt && b.createdAt >= fromTs && b.createdAt <= toTs
      }
      // startAt 모드: start_at 문자열을 timestamp로 변환해 비교
      const startTs = +new Date(b.start_at)
      return startTs >= fromTs && startTs <= toTs
    })
  }, [mergedData, dateFilterMode, from, to])

  // ── 통계 (탭 카운트) — filteredByDate 기준으로 변경 (사용자 결정 Q5-A)
  // ← [2026-05-06 Phase 3] mergedData → filteredByDate
  //    탭 카운트와 표시 데이터가 동일한 데이터 풀에서 파생 → 일관성 보장
  const counts = useMemo(() => ({
    all:       filteredByDate.length,
    pending:   filteredByDate.filter(b => classify(b) === 'pending').length,
    confirmed: filteredByDate.filter(b => classify(b) === 'confirmed').length,
    rejected:  filteredByDate.filter(b => classify(b) === 'rejected').length,
    expired:   filteredByDate.filter(b => classify(b) === 'expired').length,
    cancelled: filteredByDate.filter(b => classify(b) === 'cancelled').length,
  }), [filteredByDate])

  // ── 탭 + 검색 필터 → 표시 리스트 (filteredByDate 기준으로 정리)
  // ← [2026-05-06 Phase 3] 백엔드가 dateField 기준 fetch하지만 라이브 bookings는 무관
  //    → filteredByDate에서 탭/검색 추가 필터 (이중 안전망)
  const displayList = useMemo(() => {
    let list = filteredByDate
    if (tab !== 'all') list = list.filter(b => classify(b) === tab)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase().trim()
      list = list.filter(b =>
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.user  ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [filteredByDate, tab, searchQ])

  // ── 페이징
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE))
  const pagedList  = displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── 퀵버튼 적용 (Phase 3: getQuickRange 헬퍼 사용)
  // ← [2026-05-06 Phase 3] 'today'/'15days' 제거, 'month'/'3months'/'all' 추가
  const applyQuick = (type: QuickId) => {
    const [f, t] = getQuickRange(type)
    setFrom(f); setTo(t)
    setActiveQuick(type)
    resetPage()
  }

  // ── 처리 액션 ────────────────────────────────────────────────────────────
  const [processing, setProcessing] = useState<string | null>(null)
  const doApprove = async (b: Booking, e: React.MouseEvent) => {
    e.stopPropagation()
    if (processing) return
    setProcessing(b.id)
    try { await onApprove(b.id); fetchRange() }
    finally { setProcessing(null) }
  }
  // ← 거절은 사유 입력이 필요해 즉시 처리하지 않고 onDetail로 위임
  //   (DetailModal에서 거절 사유 입력 → onReject 호출)
  const doReject = (b: Booking, e: React.MouseEvent) => {
    e.stopPropagation()
    onDetail(b)  // ← 상세 모달에서 거절 사유 입력
  }

  // ── canApprove (시작 시각 1분 전 제한)
  const canApprove = (b: Booking) => nowMs < new Date(b.start_at).getTime() - 60_000

  // ── 탭 정의 (Figma 451:3562 — 5개) + [2026-05-06 사용자 요청] 6번째 '취소' 추가
  const TABS: TabDef<TabId>[] = [
    { id: 'all',       label: '전체',       count: counts.all       },
    { id: 'pending',   label: '승인 대기',   count: counts.pending   },
    { id: 'confirmed', label: '승인 완료',   count: counts.confirmed },
    { id: 'rejected',  label: '거절',       count: counts.rejected  },
    { id: 'expired',   label: '기한 초과',   count: counts.expired   },
    { id: 'cancelled', label: '취소',       count: counts.cancelled },  // ← 신규 (cancelled_by='user')
  ]

  // ─── DataTable 컬럼 정의 (Figma 468:2122 — 8개 컬럼) ──────────────────────
  //   ← [2026-05-06 사용자 요청] Figma 새 디자인 1:1 적용
  //     · 신규: '승인 요청 날짜' 컬럼 (createdAt 표시) — 첫 번째
  //     · 순서: 승인 요청 날짜 → 회의 → 날짜 → 시간 → 회의실 → 예약자 → 상태 → 처리
  //     · fw 변경: 회의 Medium / 날짜 Regular (기존 반대)
  //     · width: 시간 200→160 / 회의실 162→100 / 처리 140→124
  //   합계: 164+280+164+160+100+124+110(상태)+124 = 1226
  //   콘텐츠 영역 가용 ≈ 1132 → 약 94 초과 → 사용자 결정 Q3-A: overflow-x:auto 적용 (가로 스크롤)
  const columns: Column<Booking>[] = [
    // ── 1. 회의 (Figma node 468:2126) ───────────────────────────────
    //    Medium 14 #111 / w 200 / pad '10 14' / gap 5 (recurring 칩 포함)
    // ← [2026-05-06 Phase 4 사용자 요청] Figma 468:2122 1:1
    //    · 위치: 2번째 → 1번째 (테이블 첫 컬럼)
    //    · width: 320 → 280 → 200 (사용자 캡쳐 화면 기준 v3)
    {
      key: 'title', label: '회의', width: 200,
      render: (b) => (
        // ← [2026-05-06 Phase 4 사용자 요청] '회의' 제목 ellipsis 작동 fix
        //    근본 원인: flex 자식 default min-width:auto → 자식이 컨텐츠 너비 강제 확장 → ellipsis 미작동
        //    해결: 부모 div에 width:100% + minWidth:0 (Td 안에서 shrink 허용)
        //          자식 span에 flex:1 + minWidth:0 (recurring 칩 옆 영역 다 차지하면서 shrink)
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5,
          width: '100%', minWidth: 0,                 // ← 부모 Td 안에서 100% + shrink 허용
        }}>
          {b.recurGroupId && <MetaBadge type="recurring" size="sm"/>}
          <span style={{
            flex: 1, minWidth: 0,                     // ← ★ 핵심: flex 자식 shrink 허용 → ellipsis 활성
            fontSize: 14, fontWeight: 500, color: '#111', lineHeight: 1.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{b.title}</span>
        </div>
      ),
    },
    // ── 2. 승인 요청 날짜 (Figma node 468:2124) ─────────────────────
    //    ← [2026-05-06 Phase 4 사용자 요청] Figma 468:2122 1:1
    //    · 위치: 1번째 → 2번째
    //    · body fw: Medium 500 → Regular 400 (Figma `Pretendard:Regular`)
    //    Regular 14 #64748b / w 164 / pad '10 16'
    {
      key: 'createdAt', label: '승인 요청 날짜', width: 164, pad: '10 16',
      render: (b) => (
        <span style={{
          fontSize: 14, fontWeight: 400, color: '#64748B', lineHeight: 1.5,  // ← fw 500 → 400
          whiteSpace: 'nowrap',
        }}>
          {b.createdAt ? fmtDateFullWithDay(tsDate(new Date(b.createdAt).toISOString())) : '—'}
        </span>
      ),
    },
    // ── 3. 회의 날짜 (Figma node 468:2128) ─────────────────────────
    //    ← [2026-05-06 Phase 4 사용자 요청] 라벨 '날짜' → '회의 날짜' (Figma 468:2122)
    //    Regular 14 #64748b / w 164 / pad '10 16'
    {
      key: 'date', label: '회의 날짜', width: 164, pad: '10 16',
      render: (b) => (
        <span style={{
          fontSize: 14, fontWeight: 400, color: '#64748B', lineHeight: 1.5,
          whiteSpace: 'nowrap',
        }}>
          {fmtDateFullWithDay(tsDate(b.start_at))}
        </span>
      ),
    },
    // ── 4. 회의 시간 (Figma node 468:2130) ─────────────────────────
    //    ← [2026-05-06 Phase 4 사용자 요청] 라벨 '시간' → '회의 시간' (Figma 468:2122)
    //    Regular 14 #64748b / w 160 / gap 4
    {
      key: 'time', label: '회의 시간', width: 160,
      render: (b) => (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 14, fontWeight: 400, color: '#64748B', lineHeight: 1.5,
          whiteSpace: 'nowrap',
        }}>
          <span>{fmtTime(tsTime(b.start_at))}</span>
          <span>–</span>
          <span>{fmtTime(tsTime(b.end_at))}</span>
        </div>
      ),
    },
    // ── 5. 회의실 (Figma node 468:2132) — width 162 → 100 ──────────
    //    Regular 14 #111 / w 100
    {
      key: 'room', label: '회의실', width: 100,
      render: (b) => {
        const room = rooms.find(r => r.room_id === b.room_id)
        return (
          <span style={{
            fontSize: 14, fontWeight: 400, color: '#111', lineHeight: 1.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{room?.room_name ?? '—'}</span>
        )
      },
    },
    // ── 6. 예약자 (Figma node 468:2134) — Regular #111 ─────────────
    //    UserAvatar 20 + span 14 fw 400 #111 gap 6
    {
      key: 'owner', label: '예약자', width: 124,
      render: (b) => {
        // ← 사용자 룰: profiles.name live (1순위) → snapshot (2순위) → '?' (3순위)
        const owner       = users.find(u => u.user_id === b.user_id)
        const ownerName   = owner?.name ?? b.user ?? '?'
        const ownerAvatar = (owner as any)?.avatar_url ?? null
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <UserAvatar name={ownerName} avatarUrl={ownerAvatar} size={20}/>
            <span style={{
              fontSize: 14, fontWeight: 400, color: '#111', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0,                                               // ← flex item ellipsis 강제
            }}>{ownerName}</span>
          </div>
        )
      },
    },
    // ── 7. 상태 (Figma node 468:2136) — w 110 (Figma는 auto, 110로 fixed) ─
    //    BookingStatusBadge size='list' (chip-pending #f4ffaa / chip-approved #e5ffab — tokens.css)
    {
      key: 'status', label: '상태', width: 110,
      render: (b) => {
        const room = rooms.find(r => r.room_id === b.room_id)
        return (
          <BookingStatusBadge
            booking={b}
            room={room}
            isAdminRoom={!!room?.is_admin_only}
            size="list"
            currentUserId={currentUserId}
            currentUserEmail={currentUserEmail}
          />
        )
      },
    },
    {
      // ── 8. 처리 (Figma node 468:2138) — width 140 → 124 ─────────
      key: 'action', label: '처리', width: 124,
      render: (b) => {
        // ─── 처리 컬럼 분기 (사용자 Q4 결정 — C안) ──────────────────────
        const c = classify(b)
        if (c === 'pending') {
          // ── 승인 대기: [승인][거절] 버튼 2개
          //   · 승인은 canApprove 시에만 활성 (시작 1분 전 차단)
          //   · 거절은 시간 무관 가능 (행 클릭 시 DetailModal에서 사유 입력)
          const approvable = canApprove(b)
          const isProcessing = processing === b.id
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                disabled={!approvable || isProcessing}
                onClick={(e) => doApprove(b, e)}
                style={{
                  padding: '4px 10px', borderRadius: 9999,
                  border: 'none', cursor: approvable && !isProcessing ? 'pointer' : 'default',
                  fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                  background: approvable ? '#111' : '#F1F5F9',
                  color:      approvable ? '#fff' : '#CBD5E1',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s',
                }}
                title={approvable ? '승인' : '시작 1분 전이라 승인할 수 없습니다'}>
                승인
              </button>
              <button
                type="button"
                disabled={isProcessing}
                onClick={(e) => doReject(b, e)}
                style={{
                  padding: '4px 10px', borderRadius: 9999,
                  border: '1px solid #E2E8F0', cursor: isProcessing ? 'default' : 'pointer',
                  fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
                  background: '#fff', color: '#DC2626',
                  whiteSpace: 'nowrap',
                  transition: 'background 0.15s',
                }}
                title="거절 (사유 입력 필요)">
                거절
              </button>
            </div>
          )
        }
        // ── 처리 완료 (confirmed/rejected): 처리자 표시 (예약자 컬럼과 동일 패턴)
        // ← [2026-05-06 핫픽스 v3] UserChip → UserAvatar+이름 직접 구성 (사용자 요청)
        //   근본 원인: UserChip variant="sm"의 아바타/폰트 사이즈가 예약자 컬럼(UserAvatar 20+이름 14)과 다름
        //   해결: 예약자 컬럼과 동일 패턴 (UserAvatar size 20 + 이름 14)으로 시각 일관성 확보
        if (c === 'confirmed' || c === 'rejected') {
          if (!b.processedByName) return <span style={{ fontSize: 12, color: '#CBD5E1' }}>—</span>
          // 처리자 user_id 역조회: 이름 매칭 (snapshot 호환)
          //   ← Booking 타입에 processedByUserId 필드 없음 → 이름 매칭만 사용 (기존 동작과 동일)
          const processedByUser = users.find((u: any) => u.name === b.processedByName)
          const processedAvatar = (processedByUser as any)?.avatar_url ?? b.processedByAvatar ?? null
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <UserAvatar name={b.processedByName} avatarUrl={processedAvatar} size={20}/>
              <span style={{
                fontSize: 14, fontWeight: 400, color: '#111', lineHeight: 1.3,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{b.processedByName}</span>
            </div>
          )
        }
        // ── 기한 초과 (expired): 자동 만료라 처리자 없음 (—)
        return <span style={{ fontSize: 12, color: '#CBD5E1' }}>—</span>
      },
    },
  ]

  return (
    <div>
      {/* ═══════════════════════════════════════════════════════════════════
          ↓ 페이지 제목 (Figma node 451:3535) — "승인 관리" H1
          · ← [2026-05-06 사용자 요청 v2] 스타일 변경:
              fontSize 38 → 28, fontWeight 700 → 500, margin-bottom 24 → 52
          · letter-spacing 0 / leading 1 / color #111 (rgb 17,17,17) 유지
          ═══════════════════════════════════════════════════════════════════ */}
      <h1 style={{
        fontFamily: "'Pretendard', -apple-system, sans-serif",
        fontSize:   28,                                  // ← 38 → 28 (사용자 요청 v2)
        fontWeight: 500,                                 // ← 700 → 500 (사용자 요청 v2)
        color:      '#111',                              // ← rgb(17, 17, 17)
        lineHeight: 1,
        letterSpacing: 0,
        margin:     '0 0 52px 0',                        // ← 24 → 52 (사용자 요청 v2)
      }}>승인 관리</h1>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ Filter Row 1: 조회 기준 토글 + 날짜 범위 + 퀵버튼 (DateRangeFilter 통합)
          ─────────────────────────────────────────────────────────────────
          · [2026-05-06 Phase 4] Figma 451:3205 / 468:2589 — 토글이 DateRangeFilter 내부 좌측에 들어감
          · 토글 라벨: '요청 날짜' / '회의 날짜' (이전 '신청일'/'시작일'에서 변경)
          · 토글 변경 시 자동으로 '이번 달'로 리셋 (UX 일관성)
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <DateRangeFilter
          from={from} to={to}
          onFromChange={d => { setFrom(d); setActiveQuick(null); resetPage() }}
          onToChange={d   => { setTo(d);   setActiveQuick(null); resetPage() }}
          activeQuick={activeQuick}
          onQuickClick={applyQuick}
          quickButtons={buildQuickButtons(dateFilterMode) /* ← Q4-B: 모드별 동적 라벨 */}
          modeToggle={{
            options: [
              { id: 'createdAt' as const, label: '요청 날짜' },  // ← Figma: '신청일' → '요청 날짜'
              { id: 'startAt'   as const, label: '회의 날짜' },  // ← Figma: '시작일' → '회의 날짜'
            ],
            activeMode: dateFilterMode,
            onModeChange: (id) => {
              setDateFilterMode(id)
              // ← [2026-05-06 Phase 3] 모드 변경 시 퀵버튼/날짜 범위 '이번 달'로 자동 리셋
              //    근거: 모드가 바뀌면 데이터 의미도 달라짐 → 일관된 시작점 제공
              const [f, t] = getQuickRange('month')
              setFrom(f); setTo(t)
              setActiveQuick('month')
              resetPage()
            },
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ Filter Row 2: 세그먼트 탭 + 검색 + CSV (SegmentTabBar — 검색 활성화)
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <SegmentTabBar
          tabs={TABS}
          activeTab={tab}
          onTabChange={(id) => { setTab(id); resetPage() }}
          searchProps={{
            value: searchQ,
            onChange: (v) => { setSearchQ(v); resetPage() },
            placeholder: '예약자 이름 또는 회의명',
          }}
          onCsvClick={onCsvClick}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ 테이블 (DataTable)
          ─────────────────────────────────────────────────────────────────
          [2026-05-06 Phase 4] 가로 스크롤 근본 해결
          · 이전: 외부 wrapper에 overflowX:auto 적용했으나 동작 안 함
          · 원인: DataTable 외곽 `overflow:hidden`(borderRadius)이 자식 row 가로 확장 차단
          · 해결: DataTable에 minWidth prop 전달 → 자식이 부모 초과 → wrapper의 overflowX:auto 작동
          · 컬럼 합계 자동 계산 (수동 하드코딩 X — 컬럼 변경 시 자동 반영)
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <DataTable
          data={pagedList}
          columns={columns}
          getRowKey={(b) => b.id}
          onRowClick={onDetail}
          loading={loadingRange}
          emptyMessage="해당 기간에 승인 관리 내역이 없습니다."
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          /* ← [Phase 4] 컬럼 width 합계 자동 계산 → 부모 wrapper의 overflowX:auto 작동 보장 */
          minWidth={columns.reduce((sum, c) => sum + (c.width ?? 0), 0)}
        />
      </div>
    </div>
  )
}
