import { useState, useMemo } from 'react'
import { Inbox } from 'lucide-react'
import {
  todayStr, tsDate, tsTime, fmtTime, fmtDateFullWithDay,
  objToStr, dateToObj,
} from '../../utils/time'
import { BookingStatusBadge } from './BookingStatusBadge'
import type { Booking, Room } from '../../types'

// ─────────────────────────────────────────────────────────────────────────────
// 노쇼 판별 (BookingStatusBadge 와 동일 기준)
// ─────────────────────────────────────────────────────────────────────────────
function isNoshow(b: Booking): boolean {
  return (
    !!b.autoCancelled &&
    b.cancelledBy === 'system' &&
    b.status !== 'pending' &&
    b.status !== 'rejected'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 공통 스타일 헬퍼
// ─────────────────────────────────────────────────────────────────────────────
const filterInputStyle: React.CSSProperties = {
  height: 34,
  border: '0.5px solid #E2E8F0',
  borderRadius: 8,
  padding: '0 8px',
  fontSize: 12,
  background: '#fff',
  color: '#111',
  width: 112,
  outline: 'none',
}

function thStyle(width?: number): React.CSSProperties {
  return {
    padding: '9px 14px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#94A3B8',
    borderBottom: '0.5px solid #F1F5F9',
    whiteSpace: 'nowrap',
    ...(width ? { width } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────
interface BookingListTableProps {
  /** 표시할 예약 목록 (날짜 범위 제한 없이 전체 전달) */
  bookings:         Booking[]
  rooms:            Room[]
  currentUser:      string
  currentUserEmail?: string
  onDetail:         (b: Booking) => void
  loading?:         boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function BookingListTable({
  bookings,
  rooms,
  currentUser,
  onDetail,
  loading = false,
}: BookingListTableProps) {
  const today = todayStr()

  // ── 날짜 범위 (기본: 이번 달)
  const [listFrom, setListFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1); return objToStr(d)
  })
  const [listTo, setListTo] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1, 0); return objToStr(d)
  })
  const [activeQuick, setActiveQuick] = useState<'7' | '15' | 'month' | null>('month')

  // ── 필터 상태
  const [listStatus, setListStatus] = useState('ALL')
  const [searchQ,    setSearchQ]    = useState('')
  const [floorFilter, setFloorFilter] = useState<number | 'ALL'>('ALL')

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
  }

  // ── 날짜 필터 (상태 필터 전 — 카운트 기준)
  const dateFiltered = useMemo(() =>
    bookings.filter(b => {
      const d = tsDate(b.start_at)
      return d >= listFrom && d <= listTo
    }),
  [bookings, listFrom, listTo])

  // ── 상태별 카운트
  const stats = useMemo(() => ({
    all:       dateFiltered.length,
    upcoming:  dateFiltered.filter(b => !b.autoCancelled && tsDate(b.start_at) >= today).length,
    completed: dateFiltered.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled).length,
    cancelled: dateFiltered.filter(b => !!b.autoCancelled && !isNoshow(b)).length,
    noshow:    dateFiltered.filter(b => isNoshow(b)).length,
  }), [dateFiltered, today])

  // ── 층 목록 (중복 제거 + 정렬)
  const floors = useMemo(() =>
    [...new Set(rooms.map(r => r.floor_id).filter(Boolean))].sort((a, b) => a - b) as number[],
  [rooms])

  // ── 최종 필터 목록
  const filteredList = useMemo(() => {
    let list = [...dateFiltered]

    if (listStatus === 'upcoming')  list = list.filter(b => !b.autoCancelled && tsDate(b.start_at) >= today)
    if (listStatus === 'completed') list = list.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled)
    if (listStatus === 'cancelled') list = list.filter(b => !!b.autoCancelled && !isNoshow(b))
    if (listStatus === 'noshow')    list = list.filter(b => isNoshow(b))

    if (floorFilter !== 'ALL') {
      const ids = rooms.filter(r => r.floor_id === floorFilter).map(r => r.room_id)
      list = list.filter(b => ids.includes(b.room_id))
    }

    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.user ?? '').toLowerCase().includes(q)
      )
    }

    return list.sort((a, b) => b.start_at.localeCompare(a.start_at))
  }, [dateFiltered, listStatus, floorFilter, searchQ, rooms, today])

  // ── 상태 탭 정의
  const STATUS_TABS = [
    { id: 'ALL',       label: '전체', count: stats.all },
    { id: 'upcoming',  label: '예정', count: stats.upcoming },
    { id: 'completed', label: '완료', count: stats.completed },
    { id: 'cancelled', label: '취소', count: stats.cancelled },
    { id: 'noshow',    label: '노쇼', count: stats.noshow },
  ]

  // ── 상태칩 활성 스타일
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

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── 1열: 날짜 범위 + 퀵버튼 ────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <input
          type="date"
          value={listFrom}
          onChange={e => { setListFrom(e.target.value); setActiveQuick(null) }}
          style={filterInputStyle}
        />
        <span style={{ fontSize: 12, color: '#CBD5E1', flexShrink: 0 }}>~</span>
        <input
          type="date"
          value={listTo}
          onChange={e => { setListTo(e.target.value); setActiveQuick(null) }}
          style={filterInputStyle}
        />
        {(['7', '15', 'month'] as const).map(t => (
          <button
            key={t}
            className="btn"
            onClick={() => applyQuick(t)}
            style={{
              height: 34,
              padding: '0 11px',
              border: '0.5px solid',
              borderColor: activeQuick === t ? 'transparent' : '#E2E8F0',
              borderRadius: 8,
              fontSize: 12,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              background: activeQuick === t ? '#111' : '#fff',
              color: activeQuick === t ? '#fff' : '#64748B',
            }}
          >
            {t === '7' ? '최근 7일' : t === '15' ? '최근 15일' : '이번 달'}
          </button>
        ))}
      </div>

      {/* ── 2열: 상태 칩 + 층 필터 + 검색창 ─────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* 상태 칩 */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {STATUS_TABS.map(s => (
            <button
              key={s.id}
              className="btn"
              onClick={() => setListStatus(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                height: 34, padding: '0 12px',
                border: '0.5px solid #E2E8F0',
                borderRadius: 999,
                fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                background: '#fff', color: '#64748B',
                ...chipActiveStyle(s.id),
              }}
            >
              <span>{s.label}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{s.count}</span>
            </button>
          ))}
        </div>

        {/* 우측 정렬: 층 필터 + 검색 */}
        <div style={{ flex: 1 }} />
        <select
          value={floorFilter === 'ALL' ? 'ALL' : String(floorFilter)}
          onChange={e => setFloorFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
          style={{
            height: 34, border: '0.5px solid #E2E8F0', borderRadius: 8,
            padding: '0 8px', fontSize: 12, background: '#fff', color: '#64748B', outline: 'none',
          }}
        >
          <option value="ALL">전체 층</option>
          {floors.map(f => <option key={f} value={String(f)}>{f}층</option>)}
        </select>
        <div style={{ position: 'relative', minWidth: 150, maxWidth: 220 }}>
          <svg
            style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', opacity: .35, pointerEvents: 'none' }}
            width="14" height="14" viewBox="0 0 16 16" fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            placeholder="이름 또는 회의명"
            style={{
              width: '100%', height: 34,
              border: '0.5px solid #E2E8F0', borderRadius: 8,
              padding: '0 10px 0 30px', fontSize: 12, background: '#fff', color: '#111', outline: 'none',
            }}
          />
        </div>
      </div>

      {/* ── 테이블 ────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 12, border: '1px solid #F1F5F9', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#CBD5E1', fontSize: 13 }}>
            불러오는 중…
          </div>
        ) : filteredList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#CBD5E1', fontSize: 13 }}>
            <Inbox size={32} strokeWidth={1.8} color="#CBD5E1" style={{ display: 'block', margin: '0 auto 8px' }} />
            해당 기간에 예약 내역이 없습니다
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 13 }}>
            <thead style={{ background: '#F8FAFC' }}>
              <tr>
                <th style={thStyle(160)}>날짜 / 시간</th>
                <th style={thStyle()}>회의명</th>
                <th style={thStyle(120)}>회의실</th>
                <th style={thStyle(100)}>예약자</th>
                <th style={thStyle(110)}>상태</th>
              </tr>
            </thead>
            <tbody>
              {filteredList.map(b => {
                const room  = rooms.find(r => r.room_id === b.room_id)
                const isMe  = b.user === currentUser
                const initial = (b.user ?? '?')[0]

                return (
                  <tr
                    key={b.id}
                    onClick={() => onDetail(b)}
                    style={{ borderBottom: '1px solid #F8FAFC', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#FAFBFD'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                  >
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
                        {b.recurGroupId && (
                          <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 999,
                            background: '#E1F5EE', color: '#0F6E56',
                            whiteSpace: 'nowrap', flexShrink: 0,
                          }}>반복</span>
                        )}
                        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.title}
                        </span>
                      </div>
                    </td>

                    {/* 회의실 */}
                    <td style={{ padding: '10px 14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {room?.room_name ?? '—'}
                    </td>

                    {/* 예약자 */}
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 500, flexShrink: 0,
                          background: isMe ? '#E6F1FB' : '#F1EFE8',
                          color:      isMe ? '#185FA5' : '#444441',
                        }}>
                          {initial}
                        </div>
                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {b.user ?? '—'}
                        </span>
                      </div>
                    </td>

                    {/* 상태 */}
                    <td style={{ padding: '10px 14px' }}>
                      <BookingStatusBadge
                        booking={b}
                        room={room}
                        isAdminRoom={!!room?.is_admin_only}
                        size="sm"
                        currentUser={currentUser}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
