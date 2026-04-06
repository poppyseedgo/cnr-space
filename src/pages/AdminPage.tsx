import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Building2, Users, Inbox, BarChart2, Search, X, AlertTriangle,
  Upload, ImagePlus, Trash2, X as XIcon,
  Calendar, Clock, AlertCircle,
} from 'lucide-react'
import {
  todayStr, tsDate, tsMin, fmtTSDateFull, fmtTSRangeFull,
  fmt2, objToStr,
} from '../utils/time'
import { FLOORS, getFloor } from '../data/master'
import {
  uploadRoomImage, deleteRoomImage, saveRoomImages, loadRoomImages,
  cancelBooking as apiCancelBooking, insertAuditLog, upsertRoom,
  toggleRoomActive, saveRoomFeatures, loadFeatures, updateProfile,
  loadAllRooms,
} from '../lib/api'
import type { Booking, Room, AppUser } from '../types'

// ─── AdminView ─────────────────────────────────────────────────────────────────
export function AdminView({ bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet, onApprove, onReject, onDetail }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const PER_PAGE = 15

  const tabs = [
    { id: 'dashboard', icon: <BarChart2 size={14} strokeWidth={1.8} />, label: '대시보드' },
    { id: 'bookings',  icon: <Calendar  size={14} strokeWidth={1.8} />, label: '예약 관리' },
    { id: 'approvals', icon: <Inbox     size={14} strokeWidth={1.8} />, label: '승인 관리',
      badge: bookings.filter(b => b.status === 'pending').length },
    { id: 'rooms',     icon: <Building2 size={14} strokeWidth={1.8} />, label: '회의실 관리' },
    { id: 'users',     icon: <Users     size={14} strokeWidth={1.8} />, label: '사용자 관리' },
  ]

  return (
    <div className="max-w-[1200px] mx-auto px-3 py-4 sm:px-6 sm:py-7">
      <div className="anm flex gap-1 mb-5 bg-white rounded-xl p-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {tabs.map(t => (
          <button key={t.id} className="btn" onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, minWidth: isMobile ? 40 : 80, padding: isMobile ? '9px 6px' : '10px',
              fontSize: isMobile ? 11 : 13, borderRadius: 10, fontWeight: activeTab === t.id ? 700 : 500,
              background: activeTab === t.id ? '#111' : 'transparent',
              color: activeTab === t.id ? '#fff' : '#64748B',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              position: 'relative', whiteSpace: 'nowrap',
            }}>
            <span>{t.icon}</span>
            {!isMobile && t.label}
            {(t as any).badge > 0 && (
              <span style={{ position: 'absolute', top: 4, right: 4, background: '#EF4444', color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: 999, padding: '1px 5px', lineHeight: 1.4 }}>
                {(t as any).badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && <AdminDashboard bookings={bookings} rooms={rooms} users={users} isMobile={isMobile} />}
      {activeTab === 'bookings'  && <AdminBookings  bookings={bookings} setBookings={setBookings} rooms={rooms} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail} />}
      {activeTab === 'approvals' && <AdminApprovals bookings={bookings} rooms={rooms} onApprove={onApprove} onReject={onReject} showToast={showToast} isMobile={isMobile} onDetail={onDetail} />}
      {activeTab === 'rooms'     && <AdminRooms     showToast={showToast} isMobile={isMobile} />}
      {activeTab === 'users'     && <AdminUsers     users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile} />}
    </div>
  )
}

// ─── AdminDashboard ────────────────────────────────────────────────────────────
export function AdminDashboard({ bookings, rooms, users, isMobile }) {
  const today = todayStr()
  const thisMonth = today.slice(0, 7)

  const monthBookings = useMemo(() => bookings.filter(b => tsDate(b.start_at).startsWith(thisMonth)), [bookings, thisMonth])
  const todayBookings = useMemo(() => bookings.filter(b => tsDate(b.start_at) === today), [bookings, today])
  const pastBookings  = useMemo(() => bookings.filter(b => tsDate(b.start_at) < today && b.status !== 'pending'), [bookings, today])

  const isNoshow = (b: Booking) => b.autoCancelled && !b.checkedIn && !b.earlyEnded

  const noshowRate    = pastBookings.length > 0 ? Math.round(pastBookings.filter(isNoshow).length / pastBookings.length * 100) : 0
  const pendingCount   = bookings.filter(b => b.status === 'pending').length
  const monthConfirmed = monthBookings.filter(b => !b.autoCancelled && b.status !== 'rejected').length
  const todayConfirmed = todayBookings.filter(b => !b.autoCancelled && b.status !== 'rejected').length

  const roomStats = useMemo(() => rooms.map(r => {
    const rb = monthBookings.filter(b => b.room_id === r.room_id)
    return {
      room: r,
      confirmed: rb.filter(b => !b.autoCancelled && b.status !== 'rejected').length,
      noshow:    rb.filter(isNoshow).length,
    }
  }).filter(s => s.confirmed + s.noshow > 0).sort((a, b) => b.confirmed - a.confirmed), [rooms, monthBookings])
  const maxRoomCount = Math.max(...roomStats.map(r => r.confirmed), 1)

  const deptStats = useMemo(() => {
    const map = new Map<string, number>()
    monthBookings.filter(b => !b.autoCancelled && b.status !== 'rejected' && b.dept).forEach(b => {
      map.set(b.dept, (map.get(b.dept) ?? 0) + 1)
    })
    return Array.from(map.entries()).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count).slice(0, 8)
  }, [monthBookings])
  const maxDeptCount = Math.max(...deptStats.map(d => d.count), 1)

  const last14 = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 13 + i)
    const ds = objToStr(d)
    return {
      date: ds,
      count: bookings.filter(b => tsDate(b.start_at) === ds && !b.autoCancelled && b.status !== 'rejected').length,
      label: `${fmt2(d.getMonth() + 1)}/${fmt2(d.getDate())}`,
      isToday: ds === today,
    }
  }), [bookings, today])
  const maxDay = Math.max(...last14.map(d => d.count), 1)

  const noshowRanking = useMemo(() => rooms.map(r => {
    const pb = pastBookings.filter(b => b.room_id === r.room_id)
    const ns = pb.filter(isNoshow).length
    return { room: r, total: pb.length, noshow: ns, rate: pb.length > 0 ? Math.round(ns / pb.length * 100) : 0 }
  }).filter(r => r.total >= 3).sort((a, b) => b.rate - a.rate).slice(0, 5), [rooms, pastBookings])

  const hourDist = useMemo(() => {
    const map = new Map<number, number>()
    bookings.filter(b => !b.autoCancelled && b.status !== 'rejected').forEach(b => {
      const h = Math.floor(tsMin(b.start_at) / 60)
      if (h >= 8 && h <= 18) map.set(h, (map.get(h) ?? 0) + 1)
    })
    return Array.from({ length: 11 }, (_, i) => {
      const h = 8 + i
      return { hour: h, label: `${h}시`, count: map.get(h) ?? 0 }
    })
  }, [bookings])
  const maxHour = Math.max(...hourDist.map(h => h.count), 1)

  const KPI = [
    { label: '이번 달 예약', value: monthConfirmed, sub: `전체 ${monthBookings.length}건 중`, color: '#111', bg: '#F8FAFC', icon: <Calendar size={18} strokeWidth={1.8} /> },
    { label: '오늘 예약',    value: todayConfirmed,  sub: `${todayBookings.length}건 예약됨`, color: '#2563EB', bg: '#EFF6FF', icon: <Clock size={18} strokeWidth={1.8} /> },
    { label: '노쇼율',       value: `${noshowRate}%`, sub: `${pastBookings.filter(isNoshow).length}건 / ${pastBookings.length}건`, color: noshowRate > 15 ? '#DC2626' : noshowRate > 8 ? '#D97706' : '#16A34A', bg: noshowRate > 15 ? '#FEF2F2' : noshowRate > 8 ? '#FFFBEB' : '#F0FDF4', icon: <AlertCircle size={18} strokeWidth={1.8} /> },
    { label: '승인 대기',    value: pendingCount,    sub: '즉시 처리 필요', color: '#D97706', bg: '#FFFBEB', icon: <Inbox size={18} strokeWidth={1.8} /> },
  ]

  return (
    <div className="anm" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12 }}>
        {KPI.map((k, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '18px 20px', border: `1.5px solid ${k.bg}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.label}</div>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: k.color }}>{k.icon}</div>
            </div>
            <div style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 6 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 최근 14일 추이 */}
      <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 16 }}>최근 14일 예약 추이</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 88 }}>
          {last14.map((d, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              {d.count > 0 && <div style={{ fontSize: 9, color: d.isToday ? '#111' : '#94A3B8', fontWeight: 700 }}>{d.count}</div>}
              <div style={{
                width: '100%', borderRadius: '3px 3px 0 0',
                height: Math.max(d.count / maxDay * 60, d.count > 0 ? 4 : 2),
                background: d.isToday ? '#111' : d.count > 0 ? '#CBD5E1' : '#F1F5F9',
                transition: 'height 0.4s ease',
              }} />
              {!isMobile && <div style={{ fontSize: 8, color: d.isToday ? '#111' : '#CBD5E1', fontWeight: d.isToday ? 700 : 400 }}>{d.label}</div>}
            </div>
          ))}
        </div>
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 9, color: '#94A3B8' }}>{last14[0].label}</span>
            <span style={{ fontSize: 9, color: '#111', fontWeight: 700 }}>오늘</span>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {/* 회의실별 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>회의실별 예약 현황</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>{thisMonth.slice(0,4)}년 {Number(thisMonth.slice(5,7))}월</div>
          {roomStats.length === 0
            ? <div style={{ textAlign: 'center', padding: '24px 0', color: '#CBD5E1', fontSize: 12 }}>이번 달 예약 없음</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {roomStats.slice(0, 7).map(s => (
                <div key={s.room.room_id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{s.room.room_name_ko || s.room.room_name}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {s.noshow > 0 && <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 600 }}>노쇼 {s.noshow}</span>}
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{s.confirmed}건</span>
                    </div>
                  </div>
                  <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999 }}>
                    <div style={{ height: '100%', borderRadius: 999, background: '#111', width: `${Math.round(s.confirmed / maxRoomCount * 100)}%`, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          }
        </div>

        {/* 부서별 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>부서별 예약 현황</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>{thisMonth.slice(0,4)}년 {Number(thisMonth.slice(5,7))}월</div>
          {deptStats.length === 0
            ? <div style={{ textAlign: 'center', padding: '24px 0', color: '#CBD5E1', fontSize: 12 }}>이번 달 예약 없음</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deptStats.map((d, i) => (
                <div key={d.dept}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{d.dept}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>{d.count}건</span>
                  </div>
                  <div style={{ height: 6, background: '#F1F5F9', borderRadius: 999 }}>
                    <div style={{ height: '100%', borderRadius: 999, background: ['#111','#334155','#64748B','#94A3B8','#CBD5E1'][Math.min(i,4)], width: `${Math.round(d.count / maxDeptCount * 100)}%`, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          }
        </div>

        {/* 노쇼 TOP */}
        <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>노쇼율 상위 회의실</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>전체 기간 · 3건 이상 예약 기준</div>
          {noshowRanking.length === 0
            ? <div style={{ textAlign: 'center', padding: '24px 0', color: '#CBD5E1', fontSize: 12 }}>집계 데이터 없음</div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {noshowRanking.map((r, i) => (
                <div key={r.room.room_id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? '#FEF2F2' : '#F8FAFC', color: i === 0 ? '#DC2626' : '#94A3B8', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{r.room.room_name_ko || r.room.room_name}</div>
                    <div style={{ fontSize: 10, color: '#94A3B8' }}>{r.noshow}건 노쇼 / {r.total}건</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: r.rate >= 20 ? '#DC2626' : r.rate >= 10 ? '#D97706' : '#64748B' }}>{r.rate}%</div>
                </div>
              ))}
            </div>
          }
        </div>

        {/* 시간대별 */}
        <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 2 }}>시간대별 예약 분포</div>
          <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 16 }}>전체 기간 기준</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
            {hourDist.map((h, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                {h.count === maxHour && maxHour > 0 && <div style={{ fontSize: 8, color: '#111', fontWeight: 700 }}>{h.count}</div>}
                <div style={{ width: '100%', borderRadius: '3px 3px 0 0', height: Math.max(h.count / maxHour * 56, h.count > 0 ? 3 : 0), background: h.count === maxHour ? '#111' : h.count > 0 ? '#CBD5E1' : '#F8FAFC' }} />
                <div style={{ fontSize: 8, color: '#94A3B8' }}>{h.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 사용자 현황 */}
      <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 16 }}>사용자 현황</div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 12 }}>
          {[
            { label: '전체 사용자', value: users.length, color: '#111' },
            { label: 'ADMIN',      value: users.filter(u => u.role === 'ADMIN').length, color: '#7C3AED' },
            { label: '이번 달 예약자', value: new Set(monthBookings.filter(b => !b.autoCancelled).map(b => b.user)).size, color: '#2563EB' },
            { label: '등록 부서 수',  value: new Set(users.map(u => u.dept).filter(Boolean)).size, color: '#0891B2' },
          ].map((s, i) => (
            <div key={i} style={{ background: '#F8FAFC', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── AdminBookings ─────────────────────────────────────────────────────────────
export function AdminBookings({ bookings, setBookings, rooms, showToast, isMobile, PER_PAGE, onDetail }) {
  const today = todayStr()
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01` })
  const [dateTo,   setDateTo]   = useState(() => { const d = new Date(); d.setMonth(d.getMonth()+1,0); return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}` })
  const [filterRoom,   setFilterRoom]   = useState('ALL')
  const [filterUser,   setFilterUser]   = useState('')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [page, setPage]         = useState(1)
  const [cancelModal,  setCancelModal]  = useState<Booking | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling,   setCancelling]   = useState(false)

  const isNoshow = (b: Booking) => b.autoCancelled && !b.checkedIn && !b.earlyEnded

  const filtered = useMemo(() => bookings.filter(b => {
    const d = tsDate(b.start_at)
    if (d < dateFrom || d > dateTo) return false
    if (filterRoom !== 'ALL' && b.room_id !== Number(filterRoom)) return false
    if (filterUser && !b.user.toLowerCase().includes(filterUser.toLowerCase())) return false
    if (filterStatus === 'upcoming'  && (b.autoCancelled || b.status === 'rejected' || d < today)) return false
    if (filterStatus === 'completed' && !((b.checkedIn || b.earlyEnded) && !b.autoCancelled)) return false
    if (filterStatus === 'cancelled' && !(b.autoCancelled || b.status === 'rejected')) return false
    if (filterStatus === 'noshow'    && !isNoshow(b)) return false
    return true
  }).sort((a, b) => b.start_at.localeCompare(a.start_at)), [bookings, dateFrom, dateTo, filterRoom, filterUser, filterStatus, today])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const paged      = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const stats = {
    all:       filtered.length,
    upcoming:  filtered.filter(b => !b.autoCancelled && b.status !== 'rejected' && tsDate(b.start_at) >= today).length,
    completed: filtered.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled).length,
    cancelled: filtered.filter(b => b.autoCancelled || b.status === 'rejected').length,
    noshow:    filtered.filter(isNoshow).length,
  }

  // ★ Bug Fix: DB 반영 (apiCancelBooking), cancelledBy 'system'으로 수정
  const doCancel = async (id: string) => {
    if (cancelling) return
    setCancelling(true)
    const reason  = cancelReason || '관리자 강제 취소'
    const targetB = bookings.find(b => b.id === id)
    try {
      await apiCancelBooking(id)
      setBookings(prev => prev.map(b => b.id === id ? { ...b, autoCancelled: true, cancelledBy: 'system' } : b))
      insertAuditLog({ action: 'ADMIN_FORCE_CANCEL', entityType: 'booking', entityId: id, afterData: { reason, title: targetB?.title, user: targetB?.user } }).catch(() => {})
      showToast('예약이 강제 취소되었습니다.', 'info')
    } catch (err: any) {
      showToast(err.message ?? '취소 중 오류가 발생했습니다.', 'error')
    } finally {
      setCancelling(false); setCancelModal(null); setCancelReason('')
    }
  }

  const getStatusBadge = (b: Booking) => {
    const d = tsDate(b.start_at)
    if (b.status === 'pending')  return <span style={{ background:'#FEF3C7',color:'#92400E',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>승인대기</span>
    if (b.status === 'rejected') return <span style={{ background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>거절</span>
    if (isNoshow(b) && d < today) return <span style={{ background:'#FEF3C7',color:'#D97706',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>노쇼</span>
    if (b.autoCancelled)         return <span style={{ background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>취소</span>
    if (b.checkedIn || b.earlyEnded) return <span style={{ background:'#DCFCE7',color:'#16A34A',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>완료</span>
    if (d >= today)              return <span style={{ background:'#EFF6FF',color:'#3B82F6',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>예정</span>
    return <span style={{ background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:999 }}>종료</span>
  }

  return (
    <div className="anm">
      <div style={{ background:'#fff',borderRadius:16,padding:isMobile?'16px':'20px 24px',marginBottom:16 }}>
        <div style={{ display:'flex',flexWrap:'wrap',gap:10,alignItems:'flex-end' }}>
          {[{l:'시작일',v:dateFrom,s:setDateFrom},{l:'종료일',v:dateTo,s:setDateTo}].map(f=>(
            <div key={f.l} style={{flex:'1 1 130px',minWidth:120}}>
              <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label>
              <input type="date" value={f.v} onChange={e=>{f.s(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}/>
            </div>
          ))}
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>회의실</label>
            <select value={filterRoom} onChange={e=>{setFilterRoom(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}>
              <option value="ALL">전체</option>
              {rooms.map(r=><option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>예약자</label>
            <input placeholder="이름 검색..." value={filterUser} onChange={e=>{setFilterUser(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}/>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:12,flexWrap:'wrap'}}>
          {[{id:'ALL',l:`전체 ${stats.all}`},{id:'upcoming',l:`예정 ${stats.upcoming}`},{id:'completed',l:`완료 ${stats.completed}`},{id:'noshow',l:`노쇼 ${stats.noshow}`},{id:'cancelled',l:`취소 ${stats.cancelled}`}].map(s=>(
            <button key={s.id} className="btn" onClick={()=>{setFilterStatus(s.id);setPage(1)}}
              style={{padding:'5px 12px',fontSize:11,borderRadius:999,background:filterStatus===s.id?'#111':'#F8FAFC',color:filterStatus===s.id?'#fff':'#64748B',border:filterStatus===s.id?'none':'1px solid #E2E8F0'}}>{s.l}</button>
          ))}
        </div>
      </div>

      <div style={{background:'#fff',borderRadius:16,overflow:'hidden'}}>
        {paged.length===0?(
          <div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}>
            <div style={{display:'flex',justifyContent:'center',marginBottom:8}}><Inbox size={40} strokeWidth={1.2} color="#CBD5E1"/></div>
            <div style={{fontSize:13}}>조건에 맞는 예약이 없습니다</div>
          </div>
        ):(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'#F8FAFC'}}>
                {['회의명','회의실','날짜','시간','예약자','상태','관리'].map(h=>(
                  <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'#94A3B8',whiteSpace:'nowrap',borderBottom:'1px solid #F1F5F9'}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>{paged.map(b=>{
                const r=rooms.find(rm=>rm.room_id===b.room_id)
                const canCancel=!b.autoCancelled&&b.status!=='rejected'
                return(
                  <tr key={b.id} style={{borderBottom:'1px solid #F8FAFC',cursor:'pointer'}}
                    onClick={()=>onDetail&&onDetail(b)}
                    onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'10px 14px',fontWeight:600,color:'#111',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</td>
                    <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{r?.room_name??'?'}</td>
                    <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSDateFull(b.start_at)}</td>
                    <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                    <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}><span style={{fontWeight:600,color:'#111'}}>{b.user}</span> <span style={{color:'#94A3B8',fontSize:11}}>{b.dept}</span></td>
                    <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{getStatusBadge(b)}</td>
                    <td style={{padding:'10px 14px'}} onClick={e=>e.stopPropagation()}>
                      {canCancel&&<button className="btn" onClick={()=>setCancelModal(b)} style={{background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#DC2626',padding:'5px 12px',fontSize:11,borderRadius:10}}>강제 취소</button>}
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        )}
        {totalPages>1&&(
          <div style={{display:'flex',justifyContent:'center',gap:4,padding:'16px',borderTop:'1px solid #F1F5F9'}}>
            <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===1?'#CBD5E1':'#64748B'}}>‹</button>
            {Array.from({length:Math.min(totalPages,7)},(_,i)=>{const p=totalPages<=7?i+1:page<=4?i+1:page>=totalPages-3?totalPages-6+i:page-3+i;
              return <button key={p} className="btn" onClick={()=>setPage(p)} style={{padding:'6px 10px',fontSize:12,borderRadius:8,minWidth:32,background:page===p?'#111':'#F8FAFC',color:page===p?'#fff':'#64748B',fontWeight:page===p?700:400}}>{p}</button>})}
            <button className="btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===totalPages?'#CBD5E1':'#64748B'}}>›</button>
          </div>
        )}
      </div>

      {cancelModal&&(
        <div onClick={e=>e.target===e.currentTarget&&setCancelModal(null)}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'#111',marginBottom:4,display:'flex',alignItems:'center',gap:6}}><AlertTriangle size={15} strokeWidth={1.8}/>예약 강제 취소</div>
            <div style={{fontSize:13,color:'#64748B',marginBottom:16}}>"{cancelModal.title}" — {cancelModal.user}</div>
            <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:6}}>취소 사유</label>
            <textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value)} rows={3} placeholder="취소 사유를 입력하세요 (선택)"
              style={{width:'100%',background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:10,padding:'10px 14px',fontSize:13,outline:'none',resize:'none'}}/>
            <div style={{display:'flex',gap:8,marginTop:16}}>
              <button className="btn" onClick={()=>{setCancelModal(null);setCancelReason('')}} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>돌아가기</button>
              <button className="btn" onClick={()=>doCancel(cancelModal.id)} disabled={cancelling}
                style={{flex:1,background:'#DC2626',color:'#fff',padding:'12px',fontSize:13,fontWeight:700,borderRadius:12,opacity:cancelling?0.6:1}}>
                {cancelling?'처리 중...':'강제 취소'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AdminRooms ────────────────────────────────────────────────────────────────
// ★ Bug Fix: prop rooms 대신 자체 state + loadAllRooms() (비활성 방 포함)
// ★ Bug Fix: useEffect로 features 로드 (기존 useState 오용 수정)
export function AdminRooms({ showToast, isMobile }) {
  const [rooms,        setRooms]        = useState<Room[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [editRoom,     setEditRoom]     = useState<any>(null)
  const [form,         setForm]         = useState<Record<string,any>>({})
  const [thumbnail,    setThumbnail]    = useState('')
  const [gallery,      setGallery]      = useState<string[]>([])
  const [uploading,    setUploading]    = useState(false)
  const thumbRef   = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const [allFeatures,   setAllFeatures]   = useState<any[]>([])
  const [selectedFeats, setSelectedFeats] = useState<number[]>([])

  useEffect(() => {
    setLoadingRooms(true)
    Promise.all([loadAllRooms(), loadFeatures()])
      .then(([r, f]) => { setRooms(r); setAllFeatures(f) })
      .catch(err => showToast(err.message ?? '로드 실패', 'error'))
      .finally(() => setLoadingRooms(false))
  }, [])

  const openEdit = async (r: Room | null) => {
    setForm({ room_name:r?.room_name??'', room_name_ko:r?.room_name_ko??'', floor_id:r?.floor_id??1, capacity:r?.capacity??4, notes:r?.notes??'', is_active:r?.is_active??true, is_admin_only:r?.is_admin_only??false })
    setEditRoom(r ?? { room_id: null })
    if (r?.room_id) {
      const imgs = await loadRoomImages(r.room_id)
      setThumbnail(imgs.thumbnail_url); setGallery(imgs.gallery_urls)
      setSelectedFeats((r.features??[]).map((f:any)=>f.feature_id))
    } else { setThumbnail(''); setGallery([]); setSelectedFeats([]) }
  }

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file=e.target.files?.[0]; if(!file||!editRoom?.room_id)return
    setUploading(true)
    try { if(thumbnail)await deleteRoomImage(thumbnail); const url=await uploadRoomImage(editRoom.room_id,file,'thumbnail'); setThumbnail(url); showToast('대표 이미지가 업로드되었습니다.') }
    catch(err:any){showToast(err.message,'error')} finally{setUploading(false);e.target.value=''}
  }

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files=Array.from(e.target.files||[]); if(!files.length||!editRoom?.room_id)return
    setUploading(true)
    try { const urls=await Promise.all(files.map(f=>uploadRoomImage(editRoom.room_id,f,'gallery'))); setGallery(prev=>[...prev,...urls]); showToast(`갤러리 이미지 ${urls.length}장이 추가되었습니다.`) }
    catch(err:any){showToast(err.message,'error')} finally{setUploading(false);e.target.value=''}
  }

  const removeGalleryImage = async (url:string) => { await deleteRoomImage(url); setGallery(prev=>prev.filter(u=>u!==url)); showToast('이미지가 삭제되었습니다.','info') }

  const saveEdit = async () => {
    if(!form.room_name.trim()){showToast('회의실명을 입력해주세요.','error');return}
    const capacity=Number(form.capacity), floor_id=Number(form.floor_id), roomId=editRoom?.room_id
    try {
      if(roomId){
        await upsertRoom({room_id:roomId,room_code:'',room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery} as any)
        await saveRoomImages(roomId,thumbnail,gallery)
        await saveRoomFeatures(roomId,selectedFeats)
        setRooms(prev=>prev.map(r=>r.room_id===roomId?{...r,...form,capacity,floor_id,thumbnail,gallery,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))}:r))
        showToast('회의실 정보가 수정되었습니다.')
      } else {
        const nid=Math.max(...rooms.map(r=>r.room_id),0)+1
        const newRoom={room_id:nid,room_code:`ROOM_${nid}`,room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery}
        await upsertRoom(newRoom as any); await saveRoomImages(nid,thumbnail,gallery); await saveRoomFeatures(nid,selectedFeats)
        setRooms(prev=>[...prev,{...newRoom,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))} as any])
        showToast('회의실이 추가되었습니다.')
      }
      setEditRoom(null)
    } catch(err:any){showToast(err.message,'error')}
  }

  const toggleActive = async (rid:number) => {
    const next=!rooms.find(r=>r.room_id===rid)?.is_active
    try { await toggleRoomActive(rid,next); setRooms(rooms.map(r=>r.room_id===rid?{...r,is_active:next}:r)); showToast(next?'활성화되었습니다.':'비활성화되었습니다.','info') }
    catch(err:any){showToast(err.message,'error')}
  }

  if(loadingRooms) return (
    <div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}>
      <Building2 size={36} strokeWidth={1.2} color="#CBD5E1"/><div style={{fontSize:13,marginTop:8}}>회의실 불러오는 중...</div>
    </div>
  )

  return (
    <div className="anm">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:800,color:'#111'}}>전체 {rooms.length}개
          <span style={{fontSize:12,color:'#94A3B8',fontWeight:400,marginLeft:8}}>활성 {rooms.filter(r=>r.is_active).length} · 비활성 {rooms.filter(r=>!r.is_active).length}</span>
        </div>
        <button className="btn" onClick={()=>openEdit(null)} style={{background:'#111',color:'#fff',padding:'8px 16px',fontSize:12,borderRadius:10}}>+ 회의실 추가</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>
        {rooms.map(r=>{const fl=getFloor(r.floor_id);return(
          <div key={r.room_id} className="anm" style={{background:'#fff',borderRadius:16,overflow:'hidden',opacity:r.is_active?1:0.6}}>
            <div style={{display:'flex',gap:16,padding:'16px 20px'}}>
              <div style={{width:72,height:72,borderRadius:10,overflow:'hidden',flexShrink:0,background:'#F8FAFC'}}>
                {r.thumbnail?<img src={r.thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                :<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={24} color="#CBD5E1"/></div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#111'}}>{r.room_name}</div>
                  {!r.is_active&&<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:999}}>비활성</span>}
                  {r.is_admin_only&&<span style={{background:'#F3E8FF',color:'#7C3AED',fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:999}}>관리자전용</span>}
                </div>
                <div style={{fontSize:12,color:'#64748B',marginTop:2}}>{r.room_name_ko} · {fl?.floor_name} · {r.capacity}인</div>
                {(r.features??[]).length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
                  {(r.features??[]).slice(0,3).map(f=><span key={f.feature_id} style={{background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:999,padding:'2px 7px',fontSize:10,color:'#0369A1',fontWeight:600}}>{f.feature_name}</span>)}
                </div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,padding:'0 20px 16px'}}>
              <button className="btn" onClick={()=>openEdit(r)} style={{flex:1,background:'#F8FAFC',color:'#64748B',padding:'8px',fontSize:12,borderRadius:10,border:'1px solid #E2E8F0'}}>수정</button>
              <button className="btn" onClick={()=>toggleActive(r.room_id)} style={{flex:1,background:r.is_active?'#FEF2F2':'#F0FDF4',color:r.is_active?'#DC2626':'#16A34A',padding:'8px',fontSize:12,borderRadius:10,border:`1px solid ${r.is_active?'#FCA5A5':'#86EFAC'}`}}>
                {r.is_active?'비활성화':'활성화'}</button>
            </div>
          </div>
        )})}
      </div>

      {editRoom&&(
        <div onClick={e=>e.target===e.currentTarget&&setEditRoom(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflow:'auto',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:800,color:'#111'}}>{editRoom?.room_id?'회의실 정보 수정':'새 회의실 추가'}</div>
              <button className="btn" onClick={()=>setEditRoom(null)} style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'50%',background:'#F1F5F9',color:'#64748B'}}><X size={14} strokeWidth={2}/></button>
            </div>
            {[{k:'room_name',l:'회의실명 (영문) *'},{k:'room_name_ko',l:'회의실명 (한글)'}].map(f=>(
              <div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label>
              <input value={form[f.k]||''} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>
            ))}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
              <div><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>층 *</label>
                <select value={form.floor_id} onChange={e=>setForm(p=>({...p,floor_id:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}>
                  {FLOORS.map(f=><option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}</select></div>
              <div><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>수용인원 *</label>
                <input type="number" value={form.capacity} min={1} onChange={e=>setForm(p=>({...p,capacity:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>
            </div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>설명/메모</label>
              <textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none',resize:'none'}}/></div>
            <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}>
              <input type="checkbox" id="is_admin_only" checked={!!form.is_admin_only} onChange={e=>setForm(p=>({...p,is_admin_only:e.target.checked}))} style={{width:16,height:16,cursor:'pointer'}}/>
              <label htmlFor="is_admin_only" style={{fontSize:13,color:'#374151',cursor:'pointer',fontWeight:500}}>관리자 전용 회의실 (일반 유저 예약 불가)</label>
            </div>
            {allFeatures.length>0&&(
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:8}}>회의실 기능</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                  {allFeatures.map(f=>(
                    <label key={f.feature_id} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'6px 12px',borderRadius:8,border:'1px solid #E2E8F0',fontSize:12,fontWeight:500,background:selectedFeats.includes(f.feature_id)?'#111':'#F8FAFC',color:selectedFeats.includes(f.feature_id)?'#fff':'#64748B'}}>
                      <input type="checkbox" checked={selectedFeats.includes(f.feature_id)} style={{display:'none'}} onChange={e=>setSelectedFeats(prev=>e.target.checked?[...prev,f.feature_id]:prev.filter(id=>id!==f.feature_id))}/>
                      {f.feature_name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {editRoom?.room_id&&(
              <>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:8}}>대표 이미지</label>
                  <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                    <div style={{width:72,height:72,borderRadius:10,overflow:'hidden',background:'#F8FAFC',flexShrink:0,border:'1px solid #E2E8F0'}}>
                      {thumbnail?<img src={thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={20} color="#CBD5E1"/></div>}
                    </div>
                    <div style={{flex:1}}>
                      <input ref={thumbRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleThumbnailUpload}/>
                      <button className="btn" onClick={()=>thumbRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                        <Upload size={13}/>{uploading?'업로드 중...':thumbnail?'이미지 교체':'이미지 업로드'}</button>
                      {thumbnail&&<button className="btn" onClick={async()=>{await deleteRoomImage(thumbnail);setThumbnail('');showToast('삭제되었습니다.','info')}} style={{width:'100%',marginTop:6,padding:'8px',borderRadius:10,background:'#FEF2F2',color:'#DC2626',fontSize:11,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Trash2 size={11}/> 삭제</button>}
                    </div>
                  </div>
                </div>
                <div style={{marginBottom:14}}>
                  <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:8}}>갤러리 ({gallery.length}장)</label>
                  {gallery.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginBottom:8}}>
                    {gallery.map((url,i)=>(
                      <div key={i} style={{position:'relative',paddingBottom:'100%',borderRadius:8,overflow:'hidden',background:'#F8FAFC'}}>
                        <img src={url} alt="" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/>
                        <button onClick={()=>removeGalleryImage(url)} style={{position:'absolute',top:4,right:4,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.6)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><XIcon size={10} color="#fff" strokeWidth={2.5}/></button>
                      </div>
                    ))}
                  </div>}
                  <input ref={galleryRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleGalleryUpload}/>
                  <button className="btn" onClick={()=>galleryRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                    <ImagePlus size={13}/>{uploading?'업로드 중...':'갤러리 이미지 추가'}</button>
                </div>
              </>
            )}
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn" onClick={()=>setEditRoom(null)} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>취소</button>
              <button className="btn" onClick={saveEdit} style={{flex:1,background:'#111',color:'#fff',padding:'12px',fontSize:13,fontWeight:700,borderRadius:12}}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AdminUsers ────────────────────────────────────────────────────────────────
export function AdminUsers({ users, setUsers, showToast, isMobile }) {
  const [searchQ,  setSearchQ]  = useState('')
  const [editUser, setEditUser] = useState<any>(null)
  const [form,     setForm]     = useState<Record<string,any>>({})

  const filtered = users.filter(u => {
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return u.name.toLowerCase().includes(q) || u.dept.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  const toggleRole = async (uid:string) => {
    const next = users.find(u=>u.user_id===uid)?.role==='ADMIN'?'USER':'ADMIN'
    try { await updateProfile(uid,{role:next}); setUsers(users.map(u=>u.user_id===uid?{...u,role:next}:u)); showToast(`권한이 ${next}로 변경되었습니다.`,'info') }
    catch(err:any){showToast(err.message,'error')}
  }

  const openEdit = (u:any) => { setForm(u?{name:u.name,dept:u.dept,email:u.email,role:u.role}:{name:'',dept:'',email:'',role:'USER'}); setEditUser(u??{user_id:null}) }

  const saveEdit = async () => {
    if(!editUser?.user_id)return
    if(!form.name.trim()){showToast('이름은 필수입니다.','error');return}
    try { await updateProfile(editUser.user_id,{name:form.name,dept:form.dept,role:form.role}); setUsers(users.map(u=>u.user_id===editUser.user_id?{...u,...form}:u)); showToast('수정되었습니다.'); setEditUser(null) }
    catch(err:any){showToast(err.message,'error')}
  }

  return (
    <div className="anm">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div style={{fontSize:15,fontWeight:800,color:'#111'}}>전체 {users.length}명 <span style={{color:'#94A3B8',fontWeight:400,fontSize:13}}>· ADMIN {users.filter(u=>u.role==='ADMIN').length}명</span></div>
      </div>
      <div style={{background:'#fff',borderRadius:12,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
        <Search size={14} strokeWidth={1.8} style={{color:'#94A3B8',flexShrink:0}}/>
        <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="이름, 부서, 이메일로 검색..." style={{flex:1,border:'none',outline:'none',fontSize:13,background:'transparent',color:'#111'}}/>
        {searchQ&&<button className="btn" onClick={()=>setSearchQ('')} style={{background:'none',color:'#CBD5E1',display:'flex',alignItems:'center'}}><X size={11} strokeWidth={2}/></button>}
      </div>
      <div style={{background:'#fff',borderRadius:16,overflow:'hidden'}}>
        {isMobile?(
          <div>{filtered.map(u=>(
            <div key={u.user_id} style={{padding:'14px 20px',borderBottom:'1px solid #F8FAFC',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:u.role==='ADMIN'?'#111':'#E2E8F0',color:u.role==='ADMIN'?'#fff':'#64748B',fontSize:13,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{u.name.charAt(0)}</div>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:'#111'}}>{u.name} <span style={{color:'#94A3B8',fontWeight:400}}>{u.dept}</span></div><div style={{fontSize:11,color:'#94A3B8',marginTop:1}}>{u.email}</div></div>
              <div style={{display:'flex',gap:6,flexShrink:0}}>
                <button className="btn" onClick={()=>toggleRole(u.user_id)} style={{padding:'4px 10px',fontSize:10,borderRadius:999,fontWeight:700,background:u.role==='ADMIN'?'#111':'#F8FAFC',color:u.role==='ADMIN'?'#fff':'#64748B',border:u.role==='ADMIN'?'none':'1px solid #E2E8F0'}}>{u.role}</button>
                <button className="btn" onClick={()=>openEdit(u)} style={{background:'#F1F5F9',color:'#64748B',padding:'4px 10px',fontSize:10,borderRadius:999}}>수정</button>
              </div>
            </div>
          ))}</div>
        ):(
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead><tr style={{background:'#F8FAFC'}}>{['','이름','부서','이메일','권한','관리'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:700,color:'#94A3B8',borderBottom:'1px solid #F1F5F9'}}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map(u=>(
              <tr key={u.user_id} style={{borderBottom:'1px solid #F8FAFC'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <td style={{padding:'10px 14px',width:48}}><div style={{width:32,height:32,borderRadius:'50%',background:u.role==='ADMIN'?'#111':'#E2E8F0',color:u.role==='ADMIN'?'#fff':'#64748B',fontSize:12,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center'}}>{u.name.charAt(0)}</div></td>
                <td style={{padding:'10px 14px',fontWeight:600,color:'#111'}}>{u.name}</td>
                <td style={{padding:'10px 14px',color:'#64748B'}}>{u.dept}</td>
                <td style={{padding:'10px 14px',color:'#64748B'}}>{u.email}</td>
                <td style={{padding:'10px 14px'}}><button className="btn" onClick={()=>toggleRole(u.user_id)} style={{padding:'4px 12px',fontSize:11,borderRadius:999,fontWeight:700,background:u.role==='ADMIN'?'#111':'#F8FAFC',color:u.role==='ADMIN'?'#fff':'#64748B',border:u.role==='ADMIN'?'none':'1px solid #E2E8F0'}}>{u.role}</button></td>
                <td style={{padding:'10px 14px'}}><button className="btn" onClick={()=>openEdit(u)} style={{background:'#F1F5F9',color:'#64748B',padding:'6px 14px',fontSize:11,borderRadius:10}}>수정</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {editUser&&(
        <div onClick={e=>e.target===e.currentTarget&&setEditUser(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
              <div style={{fontSize:16,fontWeight:800,color:'#111'}}>사용자 수정</div>
              <button className="btn" onClick={()=>setEditUser(null)} style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'50%',background:'#F1F5F9',color:'#64748B'}}><X size={14} strokeWidth={2}/></button>
            </div>
            {[{k:'name',l:'이름 *'},{k:'dept',l:'부서'}].map(f=>(
              <div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label>
              <input value={form[f.k]||''} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>
            ))}
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>이메일 (읽기 전용)</label>
              <input value={form.email||''} readOnly style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none',color:'#94A3B8'}}/></div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:4}}>권한</label>
              <select value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}>
                <option value="USER">USER</option><option value="ADMIN">ADMIN</option></select></div>
            <div style={{display:'flex',gap:8,marginTop:20}}>
              <button className="btn" onClick={()=>setEditUser(null)} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>취소</button>
              <button className="btn" onClick={saveEdit} style={{flex:1,background:'#111',color:'#fff',padding:'12px',fontSize:13,fontWeight:700,borderRadius:12}}>저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AdminApprovals ────────────────────────────────────────────────────────────
export function AdminApprovals({ bookings, rooms, onApprove, onReject, showToast, isMobile, onDetail }) {
  const [rejectModal,  setRejectModal]  = useState<{id:string;title:string;user:string}|null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [processing,   setProcessing]   = useState<string|null>(null)

  const pending = bookings.filter(b => b.status === 'pending')

  // ★ Bug Fix: App.tsx가 showToast 처리하므로 여기서 중복 제거
  const doApprove = async (id:string, e:React.MouseEvent) => {
    e.stopPropagation()  // ★ Bug Fix: 카드 클릭(detail 열림) 이벤트 차단
    if(processing)return
    setProcessing(id)
    try { await onApprove(id) }
    finally { setProcessing(null) }
  }

  const doReject = async () => {
    if(!rejectModal||processing)return
    setProcessing(rejectModal.id)
    try { await onReject(rejectModal.id, rejectReason||'관리자 거절'); setRejectModal(null); setRejectReason('') }
    finally { setProcessing(null) }
  }

  return (
    <div className="anm">
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:800,color:'#111'}}>승인 대기</div>
        <span style={{background:'#EF4444',color:'#fff',fontSize:11,fontWeight:700,borderRadius:999,padding:'2px 8px'}}>{pending.length}건</span>
      </div>
      {pending.length===0?(
        <div style={{textAlign:'center',padding:'60px 0',color:'#94A3B8'}}>
          <div style={{fontSize:36,marginBottom:8}}>✅</div>
          <div style={{fontSize:14,fontWeight:600}}>대기 중인 승인 요청이 없습니다</div>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {pending.map(b=>{
            const r=rooms.find(rm=>rm.room_id===b.room_id)
            const isProc=processing===b.id
            return(
              <div key={b.id} onClick={()=>onDetail&&onDetail(b)} style={{background:'#fff',borderRadius:14,padding:'16px 20px',border:'1.5px solid #FCD34D',cursor:'pointer'}}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                      <span style={{background:'#FEF3C7',color:'#92400E',fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999}}>승인 대기</span>
                      <span style={{fontSize:12,color:'#94A3B8'}}>{r?.room_name_ko??r?.room_name}</span>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:'#111',marginBottom:4}}>{b.title}</div>
                    <div style={{fontSize:12,color:'#64748B'}}>신청자: {b.user} ({b.dept})</div>
                    <div style={{fontSize:12,color:'#64748B',marginTop:2}}>{fmtTSDateFull(b.start_at)} · {fmtTSRangeFull(b.start_at,b.end_at)}</div>
                    {b.memo&&<div style={{fontSize:11,color:'#94A3B8',marginTop:4}}>메모: {b.memo}</div>}
                  </div>
                  {/* ★ Bug Fix: stopPropagation으로 detail 모달 동시 열림 방지 */}
                  <div style={{display:'flex',gap:8,flexShrink:0}} onClick={e=>e.stopPropagation()}>
                    <button className="btn" onClick={e=>doApprove(b.id,e)} disabled={isProc}
                      style={{padding:'8px 16px',fontSize:12,fontWeight:700,borderRadius:10,background:'#16A34A',color:'#fff',opacity:isProc?0.6:1}}>
                      {isProc?'처리 중...':'승인'}</button>
                    <button className="btn" onClick={e=>{e.stopPropagation();setRejectModal({id:b.id,title:b.title,user:b.user})}} disabled={isProc}
                      style={{padding:'8px 16px',fontSize:12,fontWeight:700,borderRadius:10,background:'#FEF2F2',color:'#DC2626',border:'1px solid #FCA5A5',opacity:isProc?0.6:1}}>
                      거절</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {rejectModal&&(
        <div onClick={e=>e.target===e.currentTarget&&setRejectModal(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
          <div style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:420,padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
            <div style={{fontSize:16,fontWeight:800,color:'#111',marginBottom:4}}>예약 거절</div>
            <div style={{fontSize:13,color:'#64748B',marginBottom:16}}>"{rejectModal.title}" — {rejectModal.user}</div>
            <label style={{fontSize:11,fontWeight:700,color:'#94A3B8',display:'block',marginBottom:6}}>거절 사유 (신청자에게 전달됩니다)</label>
            <textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} rows={3} placeholder="거절 사유를 입력하세요 (선택)"
              style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,outline:'none',resize:'none',background:'#F8FAFC',boxSizing:'border-box'}}/>
            <div style={{display:'flex',gap:8,marginTop:16}}>
              <button className="btn" onClick={()=>setRejectModal(null)} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>취소</button>
              <button className="btn" onClick={doReject} disabled={!!processing} style={{flex:1,background:'#DC2626',color:'#fff',padding:'12px',fontSize:13,fontWeight:700,borderRadius:12,opacity:processing?0.6:1}}>
                {processing?'처리 중...':'거절 확정'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
