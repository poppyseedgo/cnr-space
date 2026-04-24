/**
 * BookingListTable — 예약 목록 테이블 (MyPage·AdminPage 공통)
 *
 * 예약을 테이블 형태(날짜/회의명/회의실/예약자/상태)로 렌더링하는 공통 컴포넌트.
 *
 * ✅ 변경 이력
 *  - [2026-04-24 P4-B] BookingStatusBadge에 currentUserId/currentUserEmail 전파
 *    · 뱃지 내부 isBooker 판정(UUID/email 기반)을 사용하려면 prop 전달 필수
 *    · props 시그니처에 currentUserId? 추가 (currentUserEmail은 기존)
 *    · L325 BookingStatusBadge 호출에 두 prop 전달
 *    · MyPage/AdminPage 호출부에서 각각 authUserId/email 전달받아 넘김
 *
 *  - [2026-04-24 P4-A-3] 예약자 이름·아바타 역조회를 user_id 기반 + live 이름으로 전환
 *    · 배경 2건:
 *      ① 예약자 이름 snapshot 표시 (P4-A-1/A-2와 동일 버그)
 *      ② users.find(u => u.name === b.user) — 이름 변경 시 매칭 실패 → 아바타 사라짐
 *    · 원인: 이름(snapshot)을 식별자로 사용 → Azure 동기화 후 매칭 실패
 *    · 해결: P4-A-1 DetailModal과 동일 패턴
 *      · 역조회: users.find(u => u.user_id === b.user_id) (UUID 불변 식별자)
 *      · 이름 표시: owner?.name ?? b.user (live 우선, snapshot fallback)
 *    · 영향: 표시만 변경. 데드 코드(isMe)는 P7에서 정리 예정
 */

import { useState, useMemo } from 'react'
import { Inbox } from 'lucide-react'
import {
  todayStr, tsDate, tsTime, fmtTime, fmtDateFullWithDay, objToStr,
} from '../../utils/time'
import { BookingStatusBadge } from './BookingStatusBadge'
import { UserChip } from './UserChip'
import { MetaBadge } from './MetaBadge'  // ← [2026-04-18] 반복 뱃지 공통화
import type { Booking, Room, AppUser } from '../../types'

// ─── 노쇼 판별 ───────────────────────────────────────────────────────────────
function isNoshow(b: Booking): boolean {
  return !!b.autoCancelled && b.cancelledBy === 'system' && b.status !== 'pending' && b.status !== 'rejected'
}

// ─── 스타일 헬퍼 ─────────────────────────────────────────────────────────────
const filterInputStyle: React.CSSProperties = {
  height: 34, border: '0.5px solid #E2E8F0', borderRadius: 8,
  padding: '0 8px', fontSize: 12, background: '#fff', color: '#111',
  width: 112, outline: 'none',
}
function thStyle(width?: number): React.CSSProperties {
  return {
    padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: '#94A3B8', borderBottom: '0.5px solid #F1F5F9',
    whiteSpace: 'nowrap', background: '#F8FAFC',
    ...(width ? { width } : {}),
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface BookingListTableProps {
  bookings:          Booking[]
  rooms:             Room[]
  users?:            AppUser[]
  currentUser:       string
  /** ← [2026-04-24 P4-B] "내 예약" 뱃지 판정용 (UUID/email 기반 isBooker) */
  currentUserId?:    string
  currentUserEmail?: string
  onDetail:          (b: Booking) => void
  loading?:          boolean
  controlled?:       Booking[]
  hideFilters?:      boolean    // 필터 UI 전체 숨김 (부모가 직접 필터 제어할 때)
  actionColumn?: {
    header?: string
    render: (b: Booking) => React.ReactNode
  }
}

const PAGE_SIZE = 15

// ─── Component ───────────────────────────────────────────────────────────────
export function BookingListTable({
  bookings, rooms, users = [], currentUser, currentUserId = '', currentUserEmail = '', onDetail,
  loading = false, controlled, hideFilters = false, actionColumn,
}: BookingListTableProps) {
  const today = todayStr()

  // ── 날짜 범위 (normal 모드 전용)
  const [listFrom, setListFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1); return objToStr(d)
  })
  const [listTo, setListTo] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return objToStr(d)
  })
  const [activeQuick, setActiveQuick] = useState<'7' | '15' | 'month' | null>('month')

  // ── 공통 필터 state
  const [listStatus,  setListStatus]  = useState('ALL')
  const [searchQ,     setSearchQ]     = useState('')
  const [floorFilter, setFloorFilter] = useState<number | 'ALL'>('ALL')
  const [sortOrder,   setSortOrder]   = useState<'latest' | 'oldest'>('latest')
  const [page, setPage] = useState(1)
  const resetPage = () => setPage(1)

  // ── 퀵버튼
  const applyQuick = (type: '7' | '15' | 'month') => {
    const now = new Date()
    if (type === '7') {
      const f = new Date(); f.setDate(now.getDate() - 6)
      setListFrom(objToStr(f)); setListTo(objToStr(now))
    } else if (type === '15') {
      const f = new Date(); f.setDate(now.getDate() - 14)
      setListFrom(objToStr(f)); setListTo(objToStr(now))
    } else {
      const f = new Date(now.getFullYear(), now.getMonth(), 1)
      const t = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      setListFrom(objToStr(f)); setListTo(objToStr(t))
    }
    setActiveQuick(type)
    resetPage()
  }

  // ── Normal 모드: 날짜 기반 필터 + 상태 필터
  const dateFiltered = useMemo(() => {
    if (controlled) return []
    return bookings.filter(b => { const d = tsDate(b.start_at); return d >= listFrom && d <= listTo })
  }, [bookings, listFrom, listTo, controlled])

  const stats = useMemo(() => ({
    all:       dateFiltered.length,
    upcoming:  dateFiltered.filter(b => !b.autoCancelled && tsDate(b.start_at) >= today).length,
    completed: dateFiltered.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled).length,
    cancelled: dateFiltered.filter(b => !!b.autoCancelled && !isNoshow(b)).length,
    noshow:    dateFiltered.filter(b => isNoshow(b)).length,
  }), [dateFiltered, today])

  const floors = useMemo(() =>
    [...new Set(rooms.map(r => r.floor_id).filter(Boolean))].sort((a, b) => a - b) as number[],
  [rooms])

  // ── 공통 후처리 (floor / search / sort)
  const applyCommon = (list: Booking[]) => {
    if (floorFilter !== 'ALL') {
      const ids = rooms.filter(r => r.floor_id === floorFilter).map(r => r.room_id)
      list = list.filter(b => ids.includes(b.room_id))
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(b => b.title.toLowerCase().includes(q) || (b.user ?? '').toLowerCase().includes(q))
    }
    return list.sort((a, b) =>
      sortOrder === 'latest'
        ? (b.createdAt ?? 0) - (a.createdAt ?? 0)
        : (a.createdAt ?? 0) - (b.createdAt ?? 0)
    )
  }

  // ── 최종 표시 목록
  const displayList = useMemo(() => {
    if (controlled) return applyCommon([...controlled])
    let list = [...dateFiltered]
    if (listStatus === 'upcoming')  list = list.filter(b => !b.autoCancelled && tsDate(b.start_at) >= today)
    if (listStatus === 'completed') list = list.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled)
    if (listStatus === 'cancelled') list = list.filter(b => !!b.autoCancelled && !isNoshow(b))
    if (listStatus === 'noshow')    list = list.filter(b => isNoshow(b))
    return applyCommon(list)
  }, [controlled, dateFiltered, listStatus, floorFilter, searchQ, sortOrder, rooms, today])

  const totalPages = Math.max(1, Math.ceil(displayList.length / PAGE_SIZE))
  const pagedList  = displayList.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const STATUS_TABS = [
    { id: 'ALL',       label: '전체', count: stats.all },
    { id: 'upcoming',  label: '예정', count: stats.upcoming },
    { id: 'completed', label: '완료', count: stats.completed },
    { id: 'cancelled', label: '취소', count: stats.cancelled },
    { id: 'noshow',    label: '노쇼',  count: stats.noshow },
  ]

  const chipActiveStyle = (id: string): React.CSSProperties => {
    if (listStatus !== id) return {}
    const map: Record<string, React.CSSProperties> = {
      ALL:       { background: '#111',    borderColor: '#111',    color: '#fff' },
      upcoming:  { background: '#854F0B', borderColor: '#854F0B', color: '#FAEEDA' },
      completed: { background: '#0F6E56', borderColor: '#0F6E56', color: '#E1F5EE' },
      cancelled: { background: '#5F5E5A', borderColor: '#5F5E5A', color: '#F1EFE8' },
      noshow:    { background: '#A32D2D', borderColor: '#A32D2D', color: '#FCEBEB' },
    }
    return map[id] ?? {}
  }

  const sortBtnStyle = (s: 'latest' | 'oldest'): React.CSSProperties => ({
    height: 34, padding: '0 11px',
    border: '0.5px solid', borderColor: sortOrder === s ? 'transparent' : '#E2E8F0',
    borderRadius: 8, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' as const,
    background: sortOrder === s ? '#111' : '#fff',
    color: sortOrder === s ? '#fff' : '#64748B',
  })

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Row 1: 날짜 범위 + 퀵버튼 (normal 모드만) ── */}
      {!controlled && !hideFilters && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <input type="date" value={listFrom}
            onChange={e => { setListFrom(e.target.value); setActiveQuick(null); resetPage() }}
            style={filterInputStyle}/>
          <span style={{ fontSize: 12, color: '#CBD5E1', flexShrink: 0 }}>~</span>
          <input type="date" value={listTo}
            onChange={e => { setListTo(e.target.value); setActiveQuick(null); resetPage() }}
            style={filterInputStyle}/>
          {(['7', '15', 'month'] as const).map(t => (
            <button key={t} className="btn" onClick={() => applyQuick(t)}
              style={{
                height: 34, padding: '0 11px',
                border: '0.5px solid', borderColor: activeQuick === t ? 'transparent' : '#E2E8F0',
                borderRadius: 8, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                background: activeQuick === t ? '#111' : '#fff',
                color: activeQuick === t ? '#fff' : '#64748B',
              }}>
              {t === '7' ? '최근 7일' : t === '15' ? '최근 15일' : '이번 달'}
            </button>
          ))}
        </div>
      )}

      {/* ── Row 2: 상태 칩 (normal) + 정렬 + 층 + 검색 ── */}
      {!hideFilters && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* 상태 칩 — normal 모드만 */}
        {!controlled && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {STATUS_TABS.map(s => (
              <button key={s.id} className="btn"
                onClick={() => { setListStatus(s.id); resetPage() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  height: 34, padding: '0 12px',
                  border: '0.5px solid #E2E8F0', borderRadius: 999,
                  fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: '#fff', color: '#64748B',
                  ...chipActiveStyle(s.id),
                }}>
                <span>{s.label}</span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.count}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }}/>

        {/* 정렬 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn" onClick={() => { setSortOrder('latest'); resetPage() }} style={sortBtnStyle('latest')}>최신순</button>
          <button className="btn" onClick={() => { setSortOrder('oldest'); resetPage() }} style={sortBtnStyle('oldest')}>과거순</button>
        </div>

        {/* 층 필터 */}
        <select
          value={floorFilter === 'ALL' ? 'ALL' : String(floorFilter)}
          onChange={e => { setFloorFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)); resetPage() }}
          style={{ height: 34, border: '0.5px solid #E2E8F0', borderRadius: 8, padding: '0 8px', fontSize: 12, background: '#fff', color: '#64748B', outline: 'none' }}>
          <option value="ALL">전체 층</option>
          {floors.map(f => <option key={f} value={String(f)}>{f}층</option>)}
        </select>

        {/* 검색 */}
        <div style={{ position: 'relative', minWidth: 150, maxWidth: 220 }}>
          <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: .35, pointerEvents: 'none' }}
            width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input type="text" value={searchQ}
            onChange={e => { setSearchQ(e.target.value); resetPage() }}
            placeholder="이름 또는 회의명"
            style={{ width: '100%', height: 34, border: '0.5px solid #E2E8F0', borderRadius: 8, padding: '0 10px 0 30px', fontSize: 12, background: '#fff', color: '#111', outline: 'none' }}/>
        </div>
      </div>
      )}

      {/* ── 테이블 컨테이너 ── */}
      <div style={{ marginTop: 12, border: '1px solid #F1F5F9', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#CBD5E1', fontSize: 13 }}>불러오는 중…</div>
          ) : displayList.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#CBD5E1', fontSize: 13 }}>
              <Inbox size={32} strokeWidth={1.8} color="#CBD5E1" style={{ display: 'block', margin: '0 auto 8px' }}/>
              해당 기간에 예약 내역이 없습니다
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={thStyle(160)}>날짜 / 시간</th>
                  <th style={thStyle()}>회의명</th>
                  <th style={thStyle(120)}>회의실</th>
                  <th style={thStyle(110)}>예약자</th>
                  <th style={thStyle(actionColumn ? 100 : 110)}>상태</th>
                  {actionColumn && <th style={thStyle(120)}>{actionColumn.header ?? ''}</th>}
                </tr>
              </thead>
              <tbody>
                {pagedList.map(b => {
                  const room       = rooms.find(r => r.room_id === b.room_id)
                  const isMe       = b.user === currentUser
                  // ← [2026-04-24 P4-A-3] 역조회 기준 이름 → user_id로 전환 (P4-A-1 DetailModal과 동일 패턴)
                  //   기존: users.find(u => u.name === b.user) — 이름 변경 시 매칭 실패 → 아바타 사라짐
                  //   변경: users.find(u => u.user_id === b.user_id) — UUID 불변 식별자로 매칭
                  const bookingUser = users.find(u => u.user_id === b.user_id)
                  const avatarUrl  = (bookingUser as any)?.avatar_url ?? null

                  return (
                    <tr key={b.id} onClick={() => onDetail(b)}
                      style={{ borderBottom: '1px solid #F8FAFC', cursor: 'pointer' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFBFD'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>

                      {/* 날짜 / 시간 */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>
                          {fmtDateFullWithDay(tsDate(b.start_at))}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8' }}>
                          {fmtTime(tsTime(b.start_at))} – {fmtTime(tsTime(b.end_at))}
                        </div>
                      </td>

                      {/* 회의명 */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {/* ← [2026-04-18] 인라인 span → MetaBadge 공통 컴포넌트 (HomeView와 동일 색상) */}
                          {b.recurGroupId && <MetaBadge type="recurring" size="sm" />}
                          <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {b.title}
                          </span>
                        </div>
                      </td>

                      {/* 회의실 */}
                      <td style={{ padding: '10px 14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {room?.room_name ?? '—'}
                      </td>

                      {/* 예약자: UserChip sm
                          ← [2026-04-24 P4-A-3] 이름 live 우선 (P4-A-1 DetailModal과 동일 패턴)
                             기존: name={b.user ?? '?'} (bookings.user_name snapshot)
                             변경: name={bookingUser?.name ?? b.user ?? '?'}
                               1순위: profiles.name live (DB 변경 자동 반영)
                               2순위: b.user snapshot (퇴사자 등 fallback)
                               3순위: '?' (이름 없음 엣지) */}
                      <td style={{ padding: '10px 14px' }}>
                        <UserChip
                          name={bookingUser?.name ?? b.user ?? '?'}
                          avatarUrl={avatarUrl}
                          variant="sm"
                        />
                      </td>

                      {/* 상태 */}
                      <td style={{ padding: '10px 14px' }}>
                        {/* ← [2026-04-24 P4-B] currentUserId/Email 추가 — "내 예약" 뱃지 판정 UUID/email 기반 */}
                        <BookingStatusBadge booking={b} room={room} isAdminRoom={!!room?.is_admin_only} size="sm" currentUser={currentUser} currentUserId={currentUserId} currentUserEmail={currentUserEmail}/>
                      </td>

                      {/* 액션 컬럼 */}
                      {actionColumn && (
                        <td style={{ padding: '10px 14px' }} onClick={e => e.stopPropagation()}>
                          {actionColumn.render(b)}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이지네이션 */}
        {!loading && totalPages > 1 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', borderTop: '1px solid #F1F5F9', background: '#FAFBFD',
          }}>
            <span style={{ fontSize: 12, color: '#94A3B8' }}>
              {(page-1)*PAGE_SIZE+1}–{Math.min(page*PAGE_SIZE, displayList.length)} / 총 {displayList.length}건
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button className="btn" onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ width: 30, height: 30, borderRadius: 6, fontSize: 14, border: '0.5px solid #E2E8F0', background: '#fff', color: page===1?'#CBD5E1':'#64748B', cursor: page===1?'default':'pointer' }}>‹</button>

              {Array.from({ length: totalPages }, (_, i) => i+1)
                .filter(n => n===1 || n===totalPages || Math.abs(n-page)<=2)
                .reduce<(number|'...')[]>((acc, n, i, arr) => {
                  if (i>0 && (n as number)-(arr[i-1] as number)>1) acc.push('...')
                  acc.push(n); return acc
                }, [])
                .map((n, i) => n==='...'
                  ? <span key={`d${i}`} style={{ fontSize:12, color:'#CBD5E1', padding:'0 2px' }}>…</span>
                  : <button key={n} className="btn" onClick={() => setPage(n as number)}
                      style={{ width:30, height:30, borderRadius:6, fontSize:12, border:'0.5px solid', borderColor:page===n?'#111':'#E2E8F0', background:page===n?'#111':'#fff', color:page===n?'#fff':'#64748B', cursor:'pointer', fontWeight:page===n?600:400 }}>{n}</button>
                )
              }

              <button className="btn" onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                style={{ width:30, height:30, borderRadius:6, fontSize:14, border:'0.5px solid #E2E8F0', background:'#fff', color:page===totalPages?'#CBD5E1':'#64748B', cursor:page===totalPages?'default':'pointer' }}>›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
