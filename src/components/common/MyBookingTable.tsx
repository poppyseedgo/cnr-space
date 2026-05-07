/**
 * MyBookingTable — MY PAGE 전용 기간별 예약 조회 테이블
 *
 * ✅ 변경 이력
 *  - [2026-05-07] 회의실 필터 추가 + CSV 버튼 제거 (Figma 488:363)
 *    · selectedRoomId state 신설 — 'ALL' | room_id
 *    · dateFiltered → roomFiltered → tab 필터 순서 (1차: 날짜 → 2차: 회의실 → 3차: 탭)
 *    · onCsvClick prop 제거 (사용자 결정 2026-05-07)
 *    · SegmentTabBar에 roomFilterProps 전달
 *  - [2026-05-06 Admin Phase B] 공통 컴포넌트 추출 — DateRangeFilter / SegmentTabBar / DataTable 사용
 *    · 583줄 → 약 280줄로 축소
 *    · 도메인 로직(isNoshow/isCompleted/isCancelled/isUpcoming + PAGE_SIZE)은 그대로 유지
 *    · 시각·기능 동일성 보장 — Figma 사양은 새 컴포넌트들에 동일하게 반영됨
 *    · 추출 이유: AdminApprovalTable과 시각/구조 동일하지만 도메인은 다름 → DRY
 *
 *  - [2026-05-04 핫픽스] STEP 5 후속 정리 (Figma node 454:3905, 454:3951)
 *  - [2026-05-04 STEP 3] 신규 생성 — Figma node 446:418 1:1 반영
 *
 * 📌 BookingListTable과 분리한 이유 (근본 원인 해결)
 *  · BookingListTable은 AdminPage 전용으로 유지 (정렬/층필터/검색/노쇼 카운트 정책 등 다름)
 *  · userMemories 룰: BookingListTable의 isNoshow는 다음 채팅(Admin 재설계)에서 통일
 *
 * 📌 데이터 정의 (사용자 정의 2026-05-04)
 *  · isNoshow: status==='confirmed' && cancelledBy==='system' && !checkedIn (userMemories 확정 룰)
 *  · 다가오는 예약: 미래(시작 전 OR 진행 중) + 살아있음 + 노쇼/취소/거절 제외
 *  · 완료: checkedIn || earlyEnded (autoCancelled 제외)
 *  · 노쇼: isNoshow
 *  · 취소: autoCancelled && !isNoshow (사용자 취소 + 관리자 강제취소 + 기한초과 등)
 *
 * 📌 퀵버튼 (사용자 정의)
 *  · 이번 달: 1일 ~ 말일
 *  · 지난 3개월: 오늘 -90일 ~ 오늘 (롤링)
 */

import { useState, useMemo } from 'react'
import {
  tsDate, tsTime, tsMin, fmtTime, fmtDateFullWithDay,
  todayStr, nowMinutes, objToStr,
} from '../../utils/time'
import { BookingStatusBadge } from './BookingStatusBadge'
import { UserAvatar } from './UserAvatar'
import { MetaBadge } from './MetaBadge'
import { DateRangeFilter, type QuickButtonDef } from './DateRangeFilter'
import { SegmentTabBar, type TabDef } from './SegmentTabBar'
import { DataTable, type Column } from './DataTable'
import type { Booking, Room, AppUser } from '../../types'

// ─── 상수 ────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 15  // ← 사용자 결정 2026-05-04: 기존 BookingListTable과 동일한 15건 유지

// ─── 노쇼/완료/취소/다가오는 판별 (단일 진실 원천) ─────────────────────────
//   userMemories 확정 룰: isNoshow = status==='confirmed' && cancelledBy==='system' && !checkedIn
//   auto_cancelled는 노쇼 판정에 사용 금지 (룰 명시)
function isNoshow(b: Booking): boolean {
  return b.status === 'confirmed' && b.cancelledBy === 'system' && !b.checkedIn
}
function isCompleted(b: Booking): boolean {
  // 완료 = 체크인됐거나 조기반납 + 취소 안 됨
  return (!!b.checkedIn || !!b.earlyEnded) && !b.autoCancelled
}
function isCancelled(b: Booking): boolean {
  // 취소 = autoCancelled && !노쇼 (사용자 취소 + 관리자 취소 + 기한초과)
  return !!b.autoCancelled && !isNoshow(b)
}
function isUpcoming(b: Booking, today: string, now: number): boolean {
  // 다가오는 예약 = 미래(시작 전) 또는 진행 중 + 살아있음
  if (isNoshow(b))                  return false
  if (b.autoCancelled)              return false
  if (b.status === 'rejected')      return false
  const startD = tsDate(b.start_at)
  const endM   = tsMin(b.end_at)
  if (startD > today)                       return true   // 미래
  if (startD === today && endM > now)       return true   // 오늘 + 종료 전
  return false
}

// ─── 탭/퀵버튼 ID 타입 ───────────────────────────────────────────────────────
type TabId   = 'ALL' | 'upcoming' | 'completed' | 'noshow' | 'cancelled'
type QuickId = 'month' | '3months'

// ─── 퀵버튼 정의 (MyPage 전용) ───────────────────────────────────────────────
const QUICK_BUTTONS: QuickButtonDef<QuickId>[] = [
  { id: 'month',    label: '이번 달' },
  { id: '3months',  label: '지난 3개월' },
]

// ─── Props ───────────────────────────────────────────────────────────────────
interface MyBookingTableProps {
  bookings:         Booking[]
  rooms:            Room[]
  users?:           AppUser[]
  currentUserId:    string                                 // ← UUID (BookingStatusBadge isBooker 판정용)
  currentUserEmail: string                                 // ← email (이중 복원 fallback)
  onDetail:         (b: Booking) => void
  loading?:         boolean
}

// ─── Component ───────────────────────────────────────────────────────────────
export function MyBookingTable({
  bookings, rooms, users = [],
  currentUserId, currentUserEmail,
  onDetail, loading = false,
}: MyBookingTableProps) {
  // ── [2026-05-07] 회의실 필터 state ('ALL' | room_id) ────────────────────
  const [selectedRoomId, setSelectedRoomId] = useState<'ALL' | number>('ALL')
  const today = todayStr()
  const now   = nowMinutes()

  // ── 날짜 범위 (기본: 이번 달)
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1)
    return objToStr(d)
  })
  const [to, setTo] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0)
    return objToStr(d)
  })
  // ── 활성 퀵버튼 ('month' | '3months' | null)
  const [activeQuick, setActiveQuick] = useState<QuickId | null>('month')
  // ── 활성 탭
  const [tab, setTab] = useState<TabId>('ALL')
  // ── 페이지
  const [page, setPage] = useState(1)
  const resetPage = () => setPage(1)

  // ── 퀵버튼 적용
  const applyQuick = (type: QuickId) => {
    if (type === 'month') {
      // 이번 달: 1일 ~ 말일
      const f = new Date(); f.setDate(1)
      const t = new Date(f); t.setMonth(t.getMonth() + 1, 0)
      setFrom(objToStr(f)); setTo(objToStr(t))
    } else {
      // 지난 3개월: 오늘 -90일 ~ 오늘 (롤링) — 사용자 정의 2026-05-04
      const t = new Date()
      const f = new Date(); f.setDate(f.getDate() - 90)
      setFrom(objToStr(f)); setTo(objToStr(t))
    }
    setActiveQuick(type)
    resetPage()
  }

  // ── 1차 필터: 날짜 범위
  const dateFiltered = useMemo(() =>
    bookings.filter(b => {
      const d = tsDate(b.start_at)
      return d >= from && d <= to
    })
  , [bookings, from, to])

  // ── 2차 필터: 회의실 [2026-05-07] ───────────────────────────────────────
  //   탭 카운트와 displayList 모두 이 단계 결과를 기준으로 함
  const roomFiltered = useMemo(() =>
    selectedRoomId === 'ALL'
      ? dateFiltered
      : dateFiltered.filter(b => b.room_id === selectedRoomId)
  , [dateFiltered, selectedRoomId])

  // ── 통계 (탭 카운트) — 회의실 필터 적용된 결과 기준
  const stats = useMemo(() => ({
    all:       roomFiltered.length,
    upcoming:  roomFiltered.filter(b => isUpcoming(b, today, now)).length,
    completed: roomFiltered.filter(isCompleted).length,
    noshow:    roomFiltered.filter(isNoshow).length,
    cancelled: roomFiltered.filter(isCancelled).length,
  }), [roomFiltered, today, now])

  // ── 3차 필터: 탭 + 정렬 (최신순 = createdAt 내림차순)
  const displayList = useMemo(() => {
    let list = roomFiltered
    if (tab === 'upcoming')  list = list.filter(b => isUpcoming(b, today, now))
    if (tab === 'completed') list = list.filter(isCompleted)
    if (tab === 'noshow')    list = list.filter(isNoshow)
    if (tab === 'cancelled') list = list.filter(isCancelled)
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [roomFiltered, tab, today, now])

  // ── 페이징
  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE))
  const pagedList  = displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ── 탭 정의 (Figma 순서)
  const TABS: TabDef<TabId>[] = [
    { id: 'ALL',       label: '전체 예약',     count: stats.all       },
    { id: 'upcoming',  label: '다가오는 예약', count: stats.upcoming  },
    { id: 'completed', label: '완료',         count: stats.completed  },
    { id: 'noshow',    label: '노쇼',         count: stats.noshow     },
    { id: 'cancelled', label: '취소',         count: stats.cancelled  },
  ]

  // ─── DataTable 컬럼 정의 (Figma 445:576 — 회의/날짜/시간/회의실/예약자/상태) ──
  //   [2026-05-06] 컬럼 순서 변경: 날짜→시간→회의 → 회의→날짜→시간
  //   너비: 날짜 184→160, 시간 164→160, 회의실 150→162, 예약자 108→120
  const columns: Column<Booking>[] = [
    {
      key: 'title', label: '회의', width: 240, pad: '10 14',  // ← [2026-05-06] 첫 번째로 이동, Figma px 14
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
      key: 'date', label: '날짜', width: 160, pad: '10 16',  // ← [2026-05-06] 184→160, Figma px 16
      render: (b) => (
        <span style={{
          fontSize: 14, fontWeight: 400, color: '#64748B', lineHeight: 1.5,  // ← [2026-05-06] 500→400
          whiteSpace: 'nowrap',
        }}>
          {fmtDateFullWithDay(tsDate(b.start_at))}
        </span>
      ),
    },
    {
      key: 'time', label: '시간', width: 160,  // ← [2026-05-06] 164→160
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
      key: 'room', label: '회의실', width: 162,  // ← [2026-05-06] 150→162
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
      key: 'owner', label: '예약자', width: 120,  // ← [2026-05-06] 108→120
      render: (b) => {
        // ← [user profile live 표시 정책 — userMemories 확정 룰]
        //   1순위: profiles.name live (users 배열에서 user_id 역조회)
        //   2순위: bookings.user snapshot
        //   3순위: '?'
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
      key: 'status', label: '상태', flex: true,
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
  ]

  return (
    <div>
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
          ↓ Filter Row 2: 세그먼트 탭 + 회의실 필터 (SegmentTabBar) [2026-05-07]
          ═══════════════════════════════════════════════════════════════════ */}
      <div style={{ marginBottom: 24 }}>
        <SegmentTabBar
          tabs={TABS}
          activeTab={tab}
          onTabChange={(id) => { setTab(id); resetPage() }}
          roomFilterProps={{
            rooms: rooms.filter(r => r.is_active).map(r => ({ room_id: r.room_id, room_name: r.room_name })),
            selectedRoomId,
            onRoomChange: (id) => { setSelectedRoomId(id); resetPage() },
          }}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          ↓ 테이블 (헤더 + 행 + Empty + 페이지네이션) (DataTable)
          ═══════════════════════════════════════════════════════════════════ */}
      <DataTable
        data={pagedList}
        columns={columns}
        getRowKey={(b) => b.id}
        onRowClick={onDetail}
        loading={loading}
        emptyMessage="해당 기간에 내역이 없습니다."
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  )
}
