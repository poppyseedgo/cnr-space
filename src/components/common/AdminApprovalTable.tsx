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
 *  · 처리완료 (confirmed/rejected): 처리자 아바타 + 이름 (UserChip sm)
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
import { UserChip } from './UserChip'
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
function classify(b: Booking): 'pending' | 'confirmed' | 'rejected' | 'expired' | 'other' {
  if (b.status === 'pending' && b.autoCancelled)  return 'expired'   // 기한 초과 (Emerald 자동 만료)
  if (b.status === 'pending' && !b.autoCancelled) return 'pending'   // 승인 대기
  if (b.status === 'confirmed')                   return 'confirmed' // 승인 완료
  if (b.status === 'rejected')                    return 'rejected'  // 거절
  return 'other'
}

// ─── 탭/퀵버튼 ID 타입 ───────────────────────────────────────────────────────
type TabId   = 'all' | 'pending' | 'confirmed' | 'rejected' | 'expired'
type QuickId = 'today' | '15days' | '3months'

// ─── 퀵버튼 정의 (Figma 451:3552) ────────────────────────────────────────────
const QUICK_BUTTONS: QuickButtonDef<QuickId>[] = [
  { id: 'today',    label: '오늘' },
  { id: '15days',   label: '지난 15일' },
  { id: '3months',  label: '지난 3개월' },
]

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
  // ── 날짜 범위 (기본: 오늘 ~ 오늘 — Figma의 '오늘' 퀵버튼 활성 상태)
  const [from, setFrom] = useState<string>(todayStr())
  const [to,   setTo]   = useState<string>(todayStr())
  const [activeQuick, setActiveQuick] = useState<QuickId | null>('today')
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
  //   기존 AdminApprovals의 fetchRange와 동일 로직
  const [rangeData, setRangeData] = useState<Booking[]>([])
  const [loadingRange, setLoadingRange] = useState(false)
  const fetchRange = useCallback(async () => {
    setLoadingRange(true)
    try {
      const data = await loadBookingsByRange(from, to)
      setRangeData(data.filter(b => adminRoomIds.has(b.room_id)))
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [from, to, adminRoomIds])
  useEffect(() => { fetchRange() }, [fetchRange])

  // ── 라이브 + 백엔드 머지 (라이브 우선)
  const mergedData = useMemo(() => {
    const liveAll    = bookings.filter(b => adminRoomIds.has(b.room_id))
    const liveIds    = new Set(liveAll.map(b => b.id))
    const historical = rangeData.filter(b => !liveIds.has(b.id))
    // 시작일 내림차순 (최신 예약이 위)
    return [...liveAll, ...historical].sort((a, b) => b.start_at.localeCompare(a.start_at))
  }, [bookings, rangeData, adminRoomIds])

  // ── 통계 (탭 카운트)
  const counts = useMemo(() => ({
    all:       mergedData.length,
    pending:   mergedData.filter(b => classify(b) === 'pending').length,
    confirmed: mergedData.filter(b => classify(b) === 'confirmed').length,
    rejected:  mergedData.filter(b => classify(b) === 'rejected').length,
    expired:   mergedData.filter(b => classify(b) === 'expired').length,
  }), [mergedData])

  // ── 탭 + 검색 필터 → 표시 리스트
  const displayList = useMemo(() => {
    let list = mergedData
    if (tab !== 'all') list = list.filter(b => classify(b) === tab)
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase().trim()
      list = list.filter(b =>
        (b.title ?? '').toLowerCase().includes(q) ||
        (b.user  ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [mergedData, tab, searchQ])

  // ── 페이징
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE))
  const pagedList  = displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── 퀵버튼 적용
  const applyQuick = (type: QuickId) => {
    const today = new Date()
    if (type === 'today') {
      setFrom(objToStr(today)); setTo(objToStr(today))
    } else if (type === '15days') {
      const f = new Date(); f.setDate(f.getDate() - 14)  // -14일 ~ 오늘 = 15일치
      setFrom(objToStr(f));     setTo(objToStr(today))
    } else {
      const f = new Date(); f.setDate(f.getDate() - 90)  // 지난 3개월 (-90일 ~ 오늘)
      setFrom(objToStr(f));     setTo(objToStr(today))
    }
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

  // ── 탭 정의 (Figma 451:3562 — 5개)
  const TABS: TabDef<TabId>[] = [
    { id: 'all',       label: '전체',       count: counts.all       },
    { id: 'pending',   label: '승인 대기',   count: counts.pending   },
    { id: 'confirmed', label: '승인 완료',   count: counts.confirmed },
    { id: 'rejected',  label: '거절',       count: counts.rejected  },
    { id: 'expired',   label: '기한 초과',   count: counts.expired   },
  ]

  // ─── DataTable 컬럼 정의 (Figma 7개 컬럼) ──────────────────────────────
  //   날짜 164 / 시간 160 / 회의 320 / 회의실 162 / 예약자 124 / 상태 126 / 처리 124
  //   합계 1180 = Figma 콘텐츠 영역 1180 정확 일치
  const columns: Column<Booking>[] = [
    {
      key: 'date', label: '날짜', width: 164, pad: '10 16',
      render: (b) => (
        <span style={{
          fontSize: 14, fontWeight: 500, color: '#64748B', lineHeight: 1.5,
          whiteSpace: 'nowrap',
        }}>
          {fmtDateFullWithDay(tsDate(b.start_at))}
        </span>
      ),
    },
    {
      key: 'time', label: '시간', width: 160,
      render: (b) => (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 14, fontWeight: 400, color: '#64748B', lineHeight: 1.5,
          whiteSpace: 'nowrap', overflow: 'hidden',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtTime(tsTime(b.start_at))}</span>
          <span>–</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtTime(tsTime(b.end_at))}</span>
        </div>
      ),
    },
    {
      key: 'title', label: '회의', width: 320,
      render: (b) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {b.recurGroupId && <MetaBadge type="recurring" size="sm"/>}
          <span style={{
            fontSize: 14, fontWeight: 500, color: '#111', lineHeight: 1.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{b.title}</span>
        </div>
      ),
    },
    {
      key: 'room', label: '회의실', width: 162,
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
    {
      key: 'owner', label: '예약자', width: 124,
      render: (b) => {
        // ← 사용자 룰: profiles.name live (1순위) → snapshot (2순위) → '?' (3순위)
        const owner       = users.find(u => u.user_id === b.user_id)
        const ownerName   = owner?.name ?? b.user ?? '?'
        const ownerAvatar = (owner as any)?.avatar_url ?? null
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserAvatar name={ownerName} avatarUrl={ownerAvatar} size={20}/>
            <span style={{
              fontSize: 14, fontWeight: 400, color: '#111', lineHeight: 1.3,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{ownerName}</span>
          </div>
        )
      },
    },
    {
      key: 'status', label: '상태', width: 126,
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
        // ── 처리 완료 (confirmed/rejected): 처리자 표시 (UserChip sm)
        if (c === 'confirmed' || c === 'rejected') {
          if (!b.processedByName) return <span style={{ fontSize: 12, color: '#CBD5E1' }}>—</span>
          const processedByUser = users.find((u: any) => u.name === b.processedByName)
          return (
            <UserChip
              name={b.processedByName}
              avatarUrl={b.processedByAvatar ?? null}
              variant="sm"
              isAdmin
              userInfo={processedByUser as any}
            />
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
          ↓ Filter Row 1: 날짜 범위 + 퀵버튼 (DateRangeFilter)
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <DateRangeFilter
          from={from} to={to}
          onFromChange={d => { setFrom(d); setActiveQuick(null); resetPage() }}
          onToChange={d   => { setTo(d);   setActiveQuick(null); resetPage() }}
          activeQuick={activeQuick}
          onQuickClick={applyQuick}
          quickButtons={QUICK_BUTTONS}
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
          ═══════════════════════════════════════════════════════════════════ */}
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
      />
    </div>
  )
}
