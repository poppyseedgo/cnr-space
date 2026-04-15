import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { AlertCircle, AlertTriangle, ArrowUpDown, Ban, BarChart2, Building2, Calendar, CheckCircle2, ChevronDown, Clock, Download, ImagePlus, Inbox, RefreshCw, RotateCw, Search, Trash2, Upload, Users, X } from 'lucide-react'
import {
  todayStr, tsDate, tsMin, fmtTSDateFull, fmtTSRangeFull,
  fmt2, objToStr,
} from '../utils/time'
import { FLOORS, getFloor } from '../data/floors'
import {
  uploadRoomImage, deleteRoomImage, saveRoomImages, loadRoomImages,
  cancelBooking as apiCancelBooking, insertAuditLog, upsertRoom,
  toggleRoomActive, saveRoomFeatures, loadFeatures, updateProfile,
  loadAllRooms, loadBookingsByRange, expirePendingBooking,
  syncAllUsers, loadUsers, loadDepartedUsers, type SyncResult,
  countFutureBookings, manualDepartUser,
} from '../lib/api'
import type { Booking, Room, AppUser, DepartedUser } from '../types'
import { ModalPortal } from '../components/common/ModalPortal'

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────
function addDaysStr(base: string, days: number): string {
  const d = new Date(base); d.setDate(d.getDate() + days)
  return objToStr(d)
}
function getMonthStart(offset = 0): string {
  const d = new Date(); d.setMonth(d.getMonth() + offset, 1)
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`
}
function getMonthEnd(offset = 0): string {
  const d = new Date(); d.setMonth(d.getMonth() + offset + 1, 0)
  return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`
}
function getYearStart(): string {
  return `${new Date().getFullYear()}-01-01`
}

// ─── 기간 프리셋 ──────────────────────────────────────────────────────────────
const today = todayStr()
const PRESETS = [
  { id: 'today',     label: '오늘',    fn: (): [string,string] => [today, today] },
  { id: 'yesterday', label: '어제',    fn: (): [string,string] => { const y=addDaysStr(today,-1); return [y,y] } },
  { id: '7d',        label: '7일',     fn: (): [string,string] => [addDaysStr(today,-6), today] },
  { id: '30d',       label: '30일',    fn: (): [string,string] => [addDaysStr(today,-29), today] },
  { id: '90d',       label: '90일',    fn: (): [string,string] => [addDaysStr(today,-89), today] },
  { id: 'thisMonth', label: '이번 달', fn: (): [string,string] => [getMonthStart(0), today] },
  { id: 'lastMonth', label: '지난 달', fn: (): [string,string] => [getMonthStart(-1), getMonthEnd(-1)] },
  { id: 'thisYear',  label: '올해',    fn: (): [string,string] => [getYearStart(), today] },
  { id: 'custom',    label: '기간 지정', fn: (): [string,string] => [addDaysStr(today,-29), today] },
]

// ─── DateRangePicker ──────────────────────────────────────────────────────────
function DateRangePicker({ from, to, onChangeFn, presetId, onPreset, compact = false }:
  { from:string; to:string; onChangeFn:(from:string,to:string)=>void; presetId:string; onPreset:(id:string,from:string,to:string)=>void; compact?:boolean }) {
  const [open, setOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState(from)
  const [customTo,   setCustomTo]   = useState(to)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e:MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])

  const curPreset = PRESETS.find(p => p.id === presetId)
  const label = presetId === 'custom' ? `${from} ~ ${to}` : curPreset?.label ?? '기간 선택'

  const applyPreset = (p: typeof PRESETS[0]) => {
    const [f,t] = p.fn()
    onPreset(p.id, f, t)
    if (p.id !== 'custom') setOpen(false)
    else { setCustomFrom(f); setCustomTo(t) }
  }
  const applyCustom = () => { onPreset('custom', customFrom, customTo); setOpen(false) }

  return (
    <div ref={ref} style={{ position:'relative', display:'inline-block' }}>
      <button className="btn" onClick={() => setOpen(v => !v)}
        style={{ display:'flex', alignItems:'center', gap:6, padding: compact ? '6px 10px' : '8px 14px',
          borderRadius:10, border:'1px solid #E2E8F0', background:'#fff', fontSize:compact?11:12,
          fontWeight:600, color:'#374151', whiteSpace:'nowrap' }}>
        <Calendar size={12} strokeWidth={1.8}/>
        {label}
        <ChevronDown size={12} strokeWidth={1.8} style={{opacity:0.5,transform: open ? 'rotate(180deg)' : 'none',transition:'transform 0.2s'}}/>
      </button>
      {open && (
        <div className="anm" style={{ position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:300,
          background:'#fff', border:'1px solid #E2E8F0', borderRadius:14,
          boxShadow:'0 8px 32px rgba(0,0,0,0.12)', minWidth:280, overflow:'hidden' }}>
          <div style={{ padding:'10px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:4 }}>
            {PRESETS.filter(p => p.id !== 'custom').map(p => (
              <button key={p.id} className="btn" onClick={() => applyPreset(p)}
                style={{ padding:'7px 10px', fontSize:12, borderRadius:8, textAlign:'left',
                  fontWeight: presetId===p.id ? 700 : 400,
                  background: presetId===p.id ? '#111' : '#F8FAFC',
                  color: presetId===p.id ? '#fff' : '#374151' }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ borderTop:'1px solid #F1F5F9', padding:'10px' }}>
            <div style={{ fontSize:11, fontWeight:600, color:'#94A3B8', marginBottom:8 }}>직접 입력</div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
              <input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)}
                style={{ flex:1, padding:'7px 10px', borderRadius:8, border:'1px solid #E2E8F0', fontSize:12, outline:'none', background:'#F8FAFC' }}/>
              <span style={{ color:'#CBD5E1', fontSize:11 }}>~</span>
              <input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)}
                style={{ flex:1, padding:'7px 10px', borderRadius:8, border:'1px solid #E2E8F0', fontSize:12, outline:'none', background:'#F8FAFC' }}/>
            </div>
            <button className="btn" onClick={applyCustom}
              style={{ width:'100%', padding:'8px', borderRadius:8, background:'#111', color:'#fff', fontSize:12, fontWeight:600 }}>
              조회
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CSV Export 유틸 ──────────────────────────────────────────────────────────
function exportCSV(rows: Record<string,any>[], filename: string) {
  if (!rows.length) return
  const BOM = '\uFEFF'
  const cols = Object.keys(rows[0])
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = BOM + [cols.join(','), ...rows.map(r => cols.map(c => escape(r[c])).join(','))].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8;' }))
  a.download = `${filename}_${todayStr()}.csv`
  a.click(); URL.revokeObjectURL(a.href)
}

// ─── Detail Drawer ─────────────────────────────────────────────────────────────
type DetailType = 'bookings'|'noshow'|'rooms'|'dept'|'hours'|'pending'|'users'
interface DetailConfig { type: DetailType; title: string; icon: React.ReactNode }

const DETAIL_META: Record<DetailType, { title: string; icon: React.ReactNode }> = {
  bookings: { title: '예약 전체 목록',     icon: <Calendar size={16} strokeWidth={1.8}/> },
  noshow:   { title: '노쇼 목록',          icon: <AlertCircle size={16} strokeWidth={1.8}/> },
  rooms:    { title: '회의실별 예약 통계', icon: <Building2 size={16} strokeWidth={1.8}/> },
  dept:     { title: '부서별 예약 통계',   icon: <Users size={16} strokeWidth={1.8}/> },
  hours:    { title: '시간대별 분포',      icon: <Clock size={16} strokeWidth={1.8}/> },
  pending:  { title: '승인 대기 목록',     icon: <Inbox size={16} strokeWidth={1.8}/> },
  users:    { title: '사용자 예약 현황',   icon: <Users size={16} strokeWidth={1.8}/> },
}

function DetailDrawer({ type, rooms, users, initFrom, initTo, onClose }:
  { type: DetailType; rooms: Room[]; users: AppUser[]; initFrom: string; initTo: string; onClose: ()=>void }) {
  const [presetId, setPresetId] = useState('custom')
  const [dateFrom, setDateFrom] = useState(initFrom)
  const [dateTo,   setDateTo]   = useState(initTo)
  const [data,     setData]     = useState<Booking[]>([])
  const [loading,  setLoading]  = useState(false)
  const [page,     setPage]     = useState(1)
  const [sortKey,  setSortKey]  = useState('start_at')
  const [sortAsc,  setSortAsc]  = useState(false)
  const PER = 30

  const fetchData = useCallback(async () => {
    setLoading(true); setPage(1)
    try { setData(await loadBookingsByRange(dateFrom, dateTo)) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const isNoshow = (b: Booking) => b.autoCancelled && !b.checkedIn && !b.earlyEnded

  // 타입별 필터
  const filtered = useMemo(() => {
    let d = data
    if (type === 'noshow')  d = d.filter(isNoshow)
    if (type === 'pending') d = d.filter(b => b.status === 'pending')
    return d
  }, [data, type])

  // 집계 데이터
  const roomAgg = useMemo(() => {
    const map = new Map<number, { confirmed:number; noshow:number; checkin:number }>()
    filtered.forEach(b => {
      if (!map.has(b.room_id)) map.set(b.room_id, { confirmed:0, noshow:0, checkin:0 })
      const s = map.get(b.room_id)!
      if (!b.autoCancelled && b.status !== 'rejected') s.confirmed++
      if (isNoshow(b)) s.noshow++
      if (b.checkedIn) s.checkin++
    })
    return Array.from(map.entries()).map(([rid, s]) => {
      const r = rooms.find(rm => rm.room_id === rid)
      return { room_name: r?.room_name_ko || r?.room_name || rid, ...s,
        noshow_rate: s.confirmed + s.noshow > 0 ? Math.round(s.noshow / (s.confirmed + s.noshow) * 100) : 0 }
    }).sort((a,b) => b.confirmed - a.confirmed)
  }, [filtered, rooms])

  const deptAgg = useMemo(() => {
    const map = new Map<string, { confirmed:number; noshow:number }>()
    filtered.filter(b => b.dept).forEach(b => {
      if (!map.has(b.dept)) map.set(b.dept, { confirmed:0, noshow:0 })
      const s = map.get(b.dept)!
      if (!b.autoCancelled && b.status !== 'rejected') s.confirmed++
      if (isNoshow(b)) s.noshow++
    })
    return Array.from(map.entries()).map(([dept, s]) => ({ dept, ...s })).sort((a,b) => b.confirmed - a.confirmed)
  }, [filtered])

  const hourAgg = useMemo(() => Array.from({ length: 13 }, (_, i) => {
    const h = 7 + i
    const count = filtered.filter(b => !b.autoCancelled && b.status !== 'rejected' && Math.floor(tsMin(b.start_at)/60) === h).length
    return { hour: `${h}:00`, count }
  }), [filtered])

  const userAgg = useMemo(() => {
    const map = new Map<string, { name:string; dept:string; count:number; noshow:number }>()
    filtered.forEach(b => {
      if (!map.has(b.user)) map.set(b.user, { name:b.user, dept:b.dept, count:0, noshow:0 })
      const s = map.get(b.user)!
      if (!b.autoCancelled && b.status !== 'rejected') s.count++
      if (isNoshow(b)) s.noshow++
    })
    return Array.from(map.values()).sort((a,b) => b.count - a.count)
  }, [filtered])

  // 테이블 렌더
  const renderTable = () => {
    if (loading) return <div style={{ textAlign:'center', padding:40, color:'#94A3B8', fontSize:13 }}><RefreshCw size={20} strokeWidth={1.8}/> 불러오는 중...</div>
    if (type === 'rooms') return <AggTable rows={roomAgg} cols={[{k:'room_name',l:'회의실'},{k:'confirmed',l:'예약'},{k:'checkin',l:'체크인'},{k:'noshow',l:'노쇼'},{k:'noshow_rate',l:'노쇼율(%)',fmt:v=>`${v}%`}]} onExport={() => exportCSV(roomAgg.map(r=>({회의실:r.room_name,예약:r.confirmed,체크인:r.checkin,노쇼:r.noshow,'노쇼율(%)':r.noshow_rate})), `회의실별통계_${dateFrom}_${dateTo}`)} />
    if (type === 'dept')  return <AggTable rows={deptAgg} cols={[{k:'dept',l:'부서'},{k:'confirmed',l:'예약'},{k:'noshow',l:'노쇼'}]} onExport={() => exportCSV(deptAgg.map(r=>({부서:r.dept,예약:r.confirmed,노쇼:r.noshow})), `부서별통계_${dateFrom}_${dateTo}`)} />
    if (type === 'hours') return <AggTable rows={hourAgg} cols={[{k:'hour',l:'시간대'},{k:'count',l:'예약 건수'}]} onExport={() => exportCSV(hourAgg.map(r=>({시간대:r.hour,예약건수:r.count})), `시간대별분포_${dateFrom}_${dateTo}`)} />
    if (type === 'users') return <AggTable rows={userAgg} cols={[{k:'name',l:'이름'},{k:'dept',l:'부서'},{k:'count',l:'예약'},{k:'noshow',l:'노쇼'}]} onExport={() => exportCSV(userAgg.map(r=>({이름:r.name,부서:r.dept,예약:r.count,노쇼:r.noshow})), `사용자별통계_${dateFrom}_${dateTo}`)} />
    // bookings / noshow / pending → 행 테이블
    const sorted = [...filtered].sort((a,b) => {
      const av = a[sortKey as keyof Booking] ?? '', bv = b[sortKey as keyof Booking] ?? ''
      return sortAsc ? (av<bv?-1:av>bv?1:0) : (av>bv?-1:av<bv?1:0)
    })
    const total = sorted.length, pages = Math.max(1, Math.ceil(total/PER))
    const paged = sorted.slice((page-1)*PER, page*PER)
    const csvRows = sorted.map(b => {
      const r = rooms.find(rm => rm.room_id === b.room_id)
      return { 회의명:b.title, 회의실:r?.room_name??'', 날짜:tsDate(b.start_at), 시작:b.start_at.slice(11,16), 종료:b.end_at.slice(11,16), 예약자:b.user, 부서:b.dept, 상태:b.autoCancelled?'취소':b.checkedIn?'완료':b.status==='pending'?'승인대기':'예정' }
    })
    return (
      <>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:12, color:'#64748B' }}>총 <b style={{ color:'#111' }}>{total}</b>건</div>
          <button className="btn" onClick={() => exportCSV(csvRows, `${DETAIL_META[type].title}_${dateFrom}_${dateTo}`)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', fontSize:11, fontWeight:600, color:'#374151' }}>
            <Download size={11} strokeWidth={1.8}/> CSV 내보내기
          </button>
        </div>
        <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #F1F5F9' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                {[{k:'title',l:'회의명'},{k:'room_id',l:'회의실'},{k:'start_at',l:'날짜'},{k:'start_at',l:'시간'},{k:'user',l:'예약자'},{k:'',l:'상태'}].map((h,i) => (
                  <th key={i} onClick={()=>{if(h.k){setSortKey(h.k);setSortAsc(s=>sortKey===h.k?!s:false)}}}
                    style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:600, color:'#94A3B8', whiteSpace:'nowrap', borderBottom:'1px solid #F1F5F9', cursor:h.k?'pointer':'default' }}>
                    {h.l}{h.k&&<ArrowUpDown size={9} strokeWidth={1.8}/>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map(b => {
                const r = rooms.find(rm => rm.room_id === b.room_id)
                const status = b.status==='pending'?{l:'승인대기',c:'#D97706',bg:'#FEF3C7'}:b.autoCancelled&&!b.checkedIn&&!b.earlyEnded?{l:'노쇼',c:'#D97706',bg:'#FEF3C7'}:b.autoCancelled?{l:'취소',c:'#94A3B8',bg:'#F1F5F9'}:b.checkedIn||b.earlyEnded?{l:'완료',c:'#16A34A',bg:'#DCFCE7'}:{l:'예정',c:'#3B82F6',bg:'#EFF6FF'}
                return (
                  <tr key={b.id} style={{ borderBottom:'1px solid #F8FAFC' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{ padding:'8px 12px', fontWeight:600, color:'#111', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.title}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{r?.room_name??''}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{fmtTSDateFull(b.start_at)}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }}><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:22,height:22,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:500,flexShrink:0,background:'#F1EFE8',color:'#444441'}}>{(b.user??'?')[0]}</div><span style={{fontSize:12,fontWeight:500,color:'#111'}}>{b.user}</span></div></td>
                    <td style={{ padding:'8px 12px' }}><span style={{ background:status.bg, color:status.c, fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:999 }}>{status.l}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pages>1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:4, paddingTop:12 }}>
            <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} style={{ padding:'5px 10px', fontSize:11, borderRadius:7, background:'#F1F5F9', color:page===1?'#CBD5E1':'#64748B' }}>‹</button>
            {Array.from({length:Math.min(pages,7)},(_,i)=>{const p=pages<=7?i+1:page<=4?i+1:page>=pages-3?pages-6+i:page-3+i;
              return <button key={p} className="btn" onClick={()=>setPage(p)} style={{ padding:'5px 9px', fontSize:11, borderRadius:7, minWidth:28, background:page===p?'#111':'#F8FAFC', color:page===p?'#fff':'#64748B', fontWeight:page===p?700:400 }}>{p}</button>})}
            <button className="btn" disabled={page===pages} onClick={()=>setPage(p=>p+1)} style={{ padding:'5px 10px', fontSize:11, borderRadius:7, background:'#F1F5F9', color:page===pages?'#CBD5E1':'#64748B' }}>›</button>
          </div>
        )}
      </>
    )
  }

  const meta = DETAIL_META[type]
  return (
    <ModalPortal>
    <div style={{ position:'fixed', inset:0, zIndex:500, display:'flex', justifyContent:'flex-end' }}>
      {/* 배경 dim */}
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(15,23,42,0.4)', backdropFilter:'blur(4px)' }}/>
      {/* 드로어 패널 */}
      <div className="anm" style={{ position:'relative', width:'min(700px,100vw)', height:'100%', background:'#fff', display:'flex', flexDirection:'column', boxShadow:'-8px 0 40px rgba(0,0,0,0.12)' }}>
        {/* 헤더 */}
        <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #F1F5F9', flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ color:'#64748B' }}>{meta.icon}</div>
              <div style={{ fontSize:16, fontWeight:600, color:'#111' }}>{meta.title}</div>
            </div>
            <button className="btn" onClick={onClose} style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', background:'#F1F5F9', color:'#64748B' }}>
              <X size={14} strokeWidth={1.8}/>
            </button>
          </div>
          {/* 기간 선택 */}
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <DateRangePicker from={dateFrom} to={dateTo} presetId={presetId}
              onChangeFn={(f,t)=>{ setDateFrom(f); setDateTo(t) }}
              onPreset={(id,f,t)=>{ setPresetId(id); setDateFrom(f); setDateTo(t) }}
              compact />
            <button className="btn" onClick={fetchData} disabled={loading}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 10px', borderRadius:8, background:loading?'#F8FAFC':'#111', border:'none', color:loading?'#CBD5E1':'#fff', fontSize:11, fontWeight:600 }}>
              <RefreshCw size={11} strokeWidth={1.8}/>{loading?'조회 중...':'새로고침'}
            </button>
            <div style={{ fontSize:11, color:'#94A3B8', marginLeft:'auto' }}>
              {dateFrom === dateTo ? dateFrom : `${dateFrom} ~ ${dateTo}`}
            </div>
          </div>
        </div>
        {/* 컨텐츠 */}
        <div style={{ flex:1, overflow:'auto', padding:'20px 24px' }}>
          {renderTable()}
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}

// 집계 테이블 컴포넌트
function AggTable({ rows, cols, onExport }: { rows: any[]; cols:{k:string;l:string;fmt?:(v:any)=>string}[]; onExport:()=>void }) {
  if (!rows.length) return <div style={{ textAlign:'center', padding:40, color:'#CBD5E1', fontSize:12 }}>데이터 없음</div>
  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:12, color:'#64748B' }}>총 <b style={{ color:'#111' }}>{rows.length}</b>개</div>
        <button className="btn" onClick={onExport}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', fontSize:11, fontWeight:600, color:'#374151' }}>
          <Download size={11} strokeWidth={1.8}/> CSV 내보내기
        </button>
      </div>
      <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #F1F5F9' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr style={{ background:'#F8FAFC' }}>
            {cols.map(c => <th key={c.k} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9', whiteSpace:'nowrap' }}>{c.l}</th>)}
          </tr></thead>
          <tbody>{rows.map((r,i) => (
            <tr key={i} style={{ borderBottom:'1px solid #F8FAFC' }}
              onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              {cols.map(c => <td key={c.k} style={{ padding:'10px 14px', color:'#374151', fontWeight: i===0&&c.k!==cols[0].k?700:400 }}>{c.fmt ? c.fmt(r[c.k]) : r[c.k]}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}

// ─── AdminView ─────────────────────────────────────────────────────────────────
export function AdminView({ bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet, onApprove, onReject, onForceCancel, onDetail }) {
  const TABS = ['dashboard','bookings','approvals','rooms','users']
  const getTabFromHash = () => {
    const t = window.location.hash.replace('#admin-tab-','')
    return TABS.includes(t) ? t : 'dashboard'
  }
  const [activeTab, setActiveTab] = useState(getTabFromHash)
  const setTab = (t: string) => {
    setActiveTab(t)
    window.location.hash = `admin-tab-${t}`
  }
  const PER_PAGE = 15
  const tabs = [
    { id:'dashboard', icon:<BarChart2 size={14} strokeWidth={1.8}/>,  label:'대시보드' },
    { id:'bookings',  icon:<Calendar size={14} strokeWidth={1.8}/>,  label:'예약 관리' },
    { id:'approvals', icon:<Inbox size={14} strokeWidth={1.8}/>,  label:'승인 관리', badge: bookings.filter(b => b.status === 'pending' && !b.autoCancelled).length },
    { id:'rooms',     icon:<Building2 size={14} strokeWidth={1.8}/>,  label:'회의실 관리' },
    { id:'users',     icon:<Users size={14} strokeWidth={1.8}/>,  label:'사용자 관리' },
  ]
  return (
    <div className="max-w-[1200px] mx-auto px-3 py-4 sm:px-6 sm:py-7">
      <div className="anm flex gap-2 mb-5 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
        {tabs.map(t=>(
          <button key={t.id} className="btn" onClick={()=>setTab(t.id)}
            style={{
              flexShrink: 0,
              padding: isMobile ? '8px 14px' : '10px 20px',
              fontSize: isMobile ? 11 : 13,
              borderRadius: 999,
              fontWeight: activeTab===t.id ? 600 : 400,
              background: activeTab===t.id ? '#111' : '#fff',
              color: activeTab===t.id ? '#fff' : '#64748B',
              border: activeTab===t.id ? 'none' : '1px solid #E2E8F0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 5, whiteSpace: 'nowrap',
            }}>
            {isMobile && <span style={{ display:'flex', alignItems:'center' }}>{t.icon}</span>}
            {!isMobile && t.label}
            {(t as any).badge > 0 && (
              <span style={{ fontSize: 12, fontWeight: 600, color: activeTab===t.id ? 'rgba(255,255,255,0.6)' : '#E85D04' }}>
                {(t as any).badge}
              </span>
            )}
          </button>
        ))}
      </div>
      {activeTab==='dashboard' && <AdminDashboard bookings={bookings} rooms={rooms} users={users} isMobile={isMobile}/>}
      {activeTab==='bookings'  && <AdminBookings  bookings={bookings} setBookings={setBookings} rooms={rooms} onForceCancel={onForceCancel} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail}/>}
      {activeTab==='approvals' && <AdminApprovals bookings={bookings} rooms={rooms} users={users} onApprove={onApprove} onReject={onReject} showToast={showToast} isMobile={isMobile} onDetail={onDetail}/>}
      {activeTab==='rooms'     && <AdminRooms     showToast={showToast} isMobile={isMobile}/>}
      {activeTab==='users'     && <AdminUsers     users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile}/>}
    </div>
  )
}

// ─── CardShell: AdminDashboard 카드 래퍼 (외부 정의 → re-render 시 unmount 방지) ──
// 내부 정의 시 AdminDashboard re-render마다 새 컴포넌트 참조 → anm 애니메이션 재실행 → 깜빡거림
const CardShell = memo(function CardShell({ children, type: ct, onClick }: {
  children: React.ReactNode; type: DetailType; onClick: (type: DetailType) => void
}) {
  return (
    <div onClick={() => onClick(ct)} style={{
      background: '#fff', borderRadius: 16, padding: 24, cursor: 'pointer',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.08)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
      {children}
    </div>
  )
})

// ─── AdminDashboard ────────────────────────────────────────────────────────────
export function AdminDashboard({ bookings, rooms, users, isMobile }) {
  const [presetId,  setPresetId]  = useState('30d')
  const [dateFrom,  setDateFrom]  = useState(addDaysStr(todayStr(),-29))
  const [dateTo,    setDateTo]    = useState(todayStr())
  const [detail,    setDetail]    = useState<DetailType|null>(null)

  const handlePreset = (id:string, f:string, t:string) => { setPresetId(id); setDateFrom(f); setDateTo(t) }

  const td = todayStr()
  const filtered = useMemo(() => bookings.filter(b => {
    const d = tsDate(b.start_at); return d >= dateFrom && d <= dateTo
  }), [bookings, dateFrom, dateTo])

  const past = useMemo(() => filtered.filter(b => tsDate(b.start_at) < td && b.status !== 'pending'), [filtered, td])
  const isNoshow = (b: Booking) => b.autoCancelled && !b.checkedIn && !b.earlyEnded
  const confirmed = filtered.filter(b => !b.autoCancelled && b.status !== 'rejected')
  const noshowRate = past.length > 0 ? Math.round(past.filter(isNoshow).length / past.length * 100) : 0
  const pendingCount = bookings.filter(b => b.status === 'pending' && !b.autoCancelled).length

  // 차트: 날짜별 추이
  const dayRange = useMemo(() => {
    const days: {date:string;label:string;count:number;isToday:boolean}[] = []
    const diffMs = new Date(dateTo).getTime() - new Date(dateFrom).getTime()
    const diffDays = Math.round(diffMs / 86400000) + 1
    // 너무 많으면 주간 집계
    if (diffDays <= 31) {
      for (let i = 0; i < diffDays; i++) {
        const d = addDaysStr(dateFrom, i)
        const cnt = filtered.filter(b => tsDate(b.start_at)===d && !b.autoCancelled && b.status!=='rejected').length
        const dt = new Date(d)
        days.push({ date:d, label:`${fmt2(dt.getMonth()+1)}/${fmt2(dt.getDate())}`, count:cnt, isToday:d===td })
      }
    } else {
      // 주간 집계
      let cur = new Date(dateFrom)
      while (objToStr(cur) <= dateTo) {
        const wStart = objToStr(cur)
        const wEnd   = objToStr(new Date(cur.getTime() + 6*86400000))
        const cnt = filtered.filter(b => {const d=tsDate(b.start_at);return d>=wStart&&d<=wEnd&&!b.autoCancelled&&b.status!=='rejected'}).length
        const dt = new Date(wStart)
        days.push({ date:wStart, label:`${dt.getMonth()+1}/${dt.getDate()}W`, count:cnt, isToday:false })
        cur.setDate(cur.getDate() + 7)
      }
    }
    return days
  }, [filtered, dateFrom, dateTo, td])
  const maxDay = Math.max(...dayRange.map(d=>d.count), 1)

  // 회의실별
  const roomStats = useMemo(() => rooms.map(r => {
    const rb = filtered.filter(b => b.room_id===r.room_id)
    return { room:r, confirmed:rb.filter(b=>!b.autoCancelled&&b.status!=='rejected').length, noshow:rb.filter(isNoshow).length }
  }).filter(s=>s.confirmed+s.noshow>0).sort((a,b)=>b.confirmed-a.confirmed), [rooms, filtered])
  const maxRoom = Math.max(...roomStats.map(r=>r.confirmed), 1)

  // 부서별
  const deptStats = useMemo(()=>{
    const map = new Map<string,number>()
    confirmed.filter(b=>b.dept).forEach(b=>map.set(b.dept,(map.get(b.dept)??0)+1))
    return Array.from(map.entries()).map(([dept,count])=>({dept,count})).sort((a,b)=>b.count-a.count).slice(0,8)
  },[confirmed])
  const maxDept = Math.max(...deptStats.map(d=>d.count), 1)

  // 노쇼 TOP
  const noshowRank = useMemo(()=>rooms.map(r=>{
    const pb=past.filter(b=>b.room_id===r.room_id)
    const ns=pb.filter(isNoshow).length
    return {room:r,total:pb.length,noshow:ns,rate:pb.length>0?Math.round(ns/pb.length*100):0}
  }).filter(r=>r.total>=3).sort((a,b)=>b.rate-a.rate).slice(0,5),[rooms,past])

  // 시간대별 07~19
  const hourDist = useMemo(()=>Array.from({length:13},(_,i)=>{
    const h=7+i
    const count=filtered.filter(b=>!b.autoCancelled&&b.status!=='rejected'&&Math.floor(tsMin(b.start_at)/60)===h).length
    return {hour:h,label:`${h}시`,count}
  }),[filtered])
  const maxHour = Math.max(...hourDist.map(h=>h.count),1)

  const KPI = [
    { type:'bookings' as DetailType, label:'기간 내 예약', value:confirmed.length, sub:`취소 포함 ${filtered.length}건`, color:'#111', bg:'#F8FAFC', icon:<Calendar size={18} strokeWidth={1.8}/> },
    { type:'noshow'   as DetailType, label:'노쇼율', value:`${noshowRate}%`, sub:`${past.filter(isNoshow).length}건 / 과거 ${past.length}건`, color:noshowRate>15?'#DC2626':noshowRate>8?'#D97706':'#16A34A', bg:noshowRate>15?'#FEF2F2':noshowRate>8?'#FFFBEB':'#F0FDF4', icon:<AlertCircle size={18} strokeWidth={1.8}/> },
    { type:'pending'  as DetailType, label:'승인 대기', value:pendingCount, sub:'즉시 처리 필요', color:'#D97706', bg:'#FFFBEB', icon:<Inbox size={18} strokeWidth={1.8}/> },
    { type:'users'    as DetailType, label:'이용 사용자', value:new Set(confirmed.map(b=>b.user)).size, sub:`전체 ${users.length}명 중`, color:'#2563EB', bg:'#EFF6FF', icon:<Users size={18} strokeWidth={1.8}/> },
  ]

  const openDetail = useCallback((type: DetailType) => setDetail(type), [])

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* 통계 기간 */}
      <div style={{ background:'#fff', borderRadius:14, padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'#111' }}>📊 통계 대시보드</div>
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ height:34, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:112, outline:'none' }}/>
          <span style={{ fontSize:12, color:'#CBD5E1' }}>~</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ height:34, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:112, outline:'none' }}/>
          {[
            { label:'7일',    fn:():[string,string]=>[addDaysStr(todayStr(),-6), todayStr()] },
            { label:'30일',   fn:():[string,string]=>[addDaysStr(todayStr(),-29), todayStr()] },
            { label:'이번 달',fn:():[string,string]=>[getMonthStart(0), todayStr()] },
            { label:'지난 달',fn:():[string,string]=>[getMonthStart(-1), getMonthEnd(-1)] },
          ].map(p => (
            <button key={p.label} className="btn" onClick={() => { const [f,t]=p.fn(); setDateFrom(f); setDateTo(t) }}
              style={{ height:34, padding:'0 11px', border:'0.5px solid #E2E8F0', borderRadius:8, fontSize:12, background:'#fff', color:'#64748B', cursor:'pointer', whiteSpace:'nowrap' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI */}
      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)', gap:12 }}>
        {KPI.map((k,i)=>(
          <CardShell key={i} type={k.type} onClick={openDetail}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:600, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.06em' }}>{k.label}</div>
              <div style={{ width:32, height:32, borderRadius:10, background:k.bg, display:'flex', alignItems:'center', justifyContent:'center', color:k.color }}>{k.icon}</div>
            </div>
            <div style={{ fontSize:isMobile?22:26, fontWeight:600, color:k.color, lineHeight:1 }}>{k.value}</div>
            <div style={{ fontSize:11, color:'#94A3B8', marginTop:6 }}>{k.sub}</div>
          </CardShell>
        ))}
      </div>

      {/* 예약 추이 */}
      <CardShell type="bookings" onClick={openDetail}>
        <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:2 }}>예약 추이</div>
        <div style={{ fontSize:11, color:'#94A3B8', marginBottom:16 }}>{dateFrom} ~ {dateTo} · {dayRange.length > 31 ? '주간 집계' : '일간 집계'}</div>
        <div style={{ display:'flex', alignItems:'flex-end', gap:dayRange.length>20?2:4, height:80 }}>
          {dayRange.map((d,i)=>(
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
              {d.count>0&&dayRange.length<=20&&<div style={{ fontSize:8, color:d.isToday?'#111':'#94A3B8', fontWeight:600 }}>{d.count}</div>}
              <div style={{ width:'100%', borderRadius:'2px 2px 0 0', height:Math.max(d.count/maxDay*60,d.count>0?3:1), background:d.isToday?'#111':d.count>0?'#CBD5E1':'#F1F5F9', transition:'height 0.3s' }}/>
              {!isMobile&&dayRange.length<=20&&<div style={{ fontSize:7, color:d.isToday?'#111':'#CBD5E1', fontWeight:d.isToday?700:400 }}>{d.label}</div>}
            </div>
          ))}
        </div>
        {(isMobile||dayRange.length>20)&&<div style={{ display:'flex', justifyContent:'space-between', marginTop:4 }}>
          <span style={{ fontSize:9, color:'#94A3B8' }}>{dayRange[0]?.label}</span>
          <span style={{ fontSize:9, color:'#94A3B8' }}>{dayRange[dayRange.length-1]?.label}</span>
        </div>}
      </CardShell>

      <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr':'1fr 1fr', gap:16 }}>
        {/* 회의실별 */}
        <CardShell type="rooms" onClick={openDetail}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:2 }}>회의실별 예약 현황</div>
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:16 }}>{dateFrom} ~ {dateTo}</div>
          {roomStats.length===0?<div style={{ textAlign:'center', padding:'24px 0', color:'#CBD5E1', fontSize:12 }}>예약 없음</div>
          :<div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {roomStats.slice(0,7).map(s=>(
              <div key={s.room.room_id}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{s.room.room_name_ko||s.room.room_name}</span>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {s.noshow>0&&<span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>노쇼 {s.noshow}</span>}
                    <span style={{ fontSize:12, fontWeight:600, color:'#111' }}>{s.confirmed}건</span>
                  </div>
                </div>
                <div style={{ height:6, background:'#F1F5F9', borderRadius:999 }}>
                  <div style={{ height:'100%', borderRadius:999, background:'#111', width:`${Math.round(s.confirmed/maxRoom*100)}%`, transition:'width 0.5s' }}/>
                </div>
              </div>
            ))}
          </div>}
        </CardShell>

        {/* 부서별 */}
        <CardShell type="dept" onClick={openDetail}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:2 }}>부서별 예약 현황</div>
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:16 }}>{dateFrom} ~ {dateTo}</div>
          {deptStats.length===0?<div style={{ textAlign:'center', padding:'24px 0', color:'#CBD5E1', fontSize:12 }}>예약 없음</div>
          :<div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {deptStats.map((d,i)=>(
              <div key={d.dept}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{d.dept}</span>
                  <span style={{ fontSize:12, fontWeight:600, color:'#111' }}>{d.count}건</span>
                </div>
                <div style={{ height:6, background:'#F1F5F9', borderRadius:999 }}>
                  <div style={{ height:'100%', borderRadius:999, background:['#111','#334155','#64748B','#94A3B8','#CBD5E1'][Math.min(i,4)], width:`${Math.round(d.count/maxDept*100)}%`, transition:'width 0.5s' }}/>
                </div>
              </div>
            ))}
          </div>}
        </CardShell>

        {/* 노쇼 TOP */}
        <CardShell type="noshow" onClick={openDetail}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:2 }}>노쇼율 상위 회의실</div>
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:16 }}>과거 예약 기준 · 3건 이상</div>
          {noshowRank.length===0?<div style={{ textAlign:'center', padding:'24px 0', color:'#CBD5E1', fontSize:12 }}>집계 데이터 없음</div>
          :<div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {noshowRank.map((r,i)=>(
              <div key={r.room.room_id} style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:24, height:24, borderRadius:'50%', background:i===0?'#FEF2F2':'#F8FAFC', color:i===0?'#DC2626':'#94A3B8', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{i+1}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:12, fontWeight:600, color:'#374151' }}>{r.room.room_name_ko||r.room.room_name}</div>
                  <div style={{ fontSize:10, color:'#94A3B8' }}>{r.noshow}건 노쇼 / {r.total}건</div>
                </div>
                <div style={{ fontSize:16, fontWeight:600, color:r.rate>=20?'#DC2626':r.rate>=10?'#D97706':'#64748B' }}>{r.rate}%</div>
              </div>
            ))}
          </div>}
        </CardShell>

        {/* 시간대별 07~19 */}
        <CardShell type="hours" onClick={openDetail}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:2 }}>시간대별 예약 분포</div>
          <div style={{ fontSize:11, color:'#94A3B8', marginBottom:16 }}>운영시간 07:00 ~ 19:00</div>
          <div style={{ display:'flex', alignItems:'flex-end', gap:3, height:80 }}>
            {hourDist.map((h,i)=>(
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                {h.count===maxHour&&maxHour>0&&<div style={{ fontSize:8, color:'#111', fontWeight:600 }}>{h.count}</div>}
                <div style={{ width:'100%', borderRadius:'2px 2px 0 0', height:Math.max(h.count/maxHour*56,h.count>0?3:0), background:h.count===maxHour?'#111':h.count>0?'#CBD5E1':'#F8FAFC' }}/>
                <div style={{ fontSize:7, color:'#94A3B8' }}>{h.label}</div>
              </div>
            ))}
          </div>
        </CardShell>
      </div>

      {/* 사용자 현황 */}
      <CardShell type="users" onClick={openDetail}>
        <div style={{ fontSize:14, fontWeight:600, color:'#111', marginBottom:16 }}>사용자 현황</div>
        <div style={{ display:'grid', gridTemplateColumns:isMobile?'1fr 1fr':'repeat(4,1fr)', gap:12 }}>
          {[
            {label:'전체 사용자', value:users.length, color:'#111'},
            {label:'ADMIN',      value:users.filter(u=>u.role==='ADMIN').length, color:'#7C3AED'},
            {label:'기간 내 예약자', value:new Set(confirmed.map(b=>b.user)).size, color:'#2563EB'},
            {label:'활성 부서',   value:new Set(confirmed.map(b=>b.dept).filter(Boolean)).size, color:'#0891B2'},
          ].map((s,i)=>(
            <div key={i} style={{ background:'#F8FAFC', borderRadius:12, padding:'14px 16px' }}>
              <div style={{ fontSize:10, fontWeight:600, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:6 }}>{s.label}</div>
              <div style={{ fontSize:24, fontWeight:600, color:s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </CardShell>

      {/* Detail Drawer */}
      {detail && (
        <DetailDrawer type={detail} rooms={rooms} users={users}
          initFrom={dateFrom} initTo={dateTo}
          onClose={()=>setDetail(null)}/>
      )}
    </div>
  )
}

// ─── AdminBookings ─────────────────────────────────────────────────────────────
export function AdminBookings({ bookings, setBookings, rooms, onForceCancel, showToast, isMobile, PER_PAGE, onDetail }) {
  const today=todayStr()
  const [dateFrom, setDateFrom]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`})
  const [dateTo,   setDateTo]  =useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`})
  const [filterRoom,   setFilterRoom]  =useState('ALL')
  const [filterUser,   setFilterUser]  =useState('')
  const [filterStatus, setFilterStatus]=useState('ALL')
  const [page, setPage]=useState(1)
  const [cancelModal,  setCancelModal] =useState<Booking|null>(null)
  const [cancelReason, setCancelReason]=useState('')
  const [cancelling,   setCancelling]  =useState(false)
  // 관리자 강제취소는 cancelledBy==='admin', 노쇼는 그 외 autoCancelled
  const isNoshow=(b:Booking)=>b.autoCancelled&&!b.checkedIn&&!b.earlyEnded&&b.cancelledBy!=='admin'
  const filtered=useMemo(()=>bookings.filter(b=>{
    const d=tsDate(b.start_at)
    if(d<dateFrom||d>dateTo)return false
    if(filterRoom!=='ALL'&&b.room_id!==Number(filterRoom))return false
    if(filterUser&&!b.user.toLowerCase().includes(filterUser.toLowerCase()))return false
    if(filterStatus==='upcoming'&&(b.autoCancelled||b.status==='rejected'||d<today))return false
    if(filterStatus==='completed'&&!((b.checkedIn||b.earlyEnded)&&!b.autoCancelled))return false
    if(filterStatus==='cancelled'&&!(b.autoCancelled||b.status==='rejected'))return false
    if(filterStatus==='noshow'&&!isNoshow(b))return false
    if(filterStatus==='adminCancel'&&b.cancelledBy!=='admin')return false
    return true
  }).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[bookings,dateFrom,dateTo,filterRoom,filterUser,filterStatus,today])
  const totalPages=Math.max(1,Math.ceil(filtered.length/PER_PAGE))
  const paged=filtered.slice((page-1)*PER_PAGE,page*PER_PAGE)
  const stats={
    all:filtered.length,
    upcoming:filtered.filter(b=>!b.autoCancelled&&b.status!=='rejected'&&tsDate(b.start_at)>=today).length,
    completed:filtered.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length,
    cancelled:filtered.filter(b=>b.autoCancelled||b.status==='rejected').length,
    noshow:filtered.filter(isNoshow).length,
    adminCancel:filtered.filter(b=>b.cancelledBy==='admin').length,
  }
  // ★ App.tsx의 adminForceCancelBooking 콜백 위임 (알림·이메일·audit 모두 App에서 처리)
  const doCancel=async(id:string)=>{
    if(cancelling)return; setCancelling(true)
    try { await onForceCancel(id, cancelReason||'관리자 강제 취소') }
    catch(err:any){ showToast(err.message??'취소 중 오류','error') }
    finally{ setCancelling(false); setCancelModal(null); setCancelReason('') }
  }
  const getBadge=(b:Booking)=>{
    const d=tsDate(b.start_at)
    if(b.status==='pending'&&!b.autoCancelled)return<span style={{background:'#FEF3C7',color:'#92400E',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>승인대기</span>
    if(b.status==='rejected')return<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>거절</span>
    // ★ 관리자 강제취소 — 가장 먼저 체크 (다른 취소 케이스와 명확히 구분)
    if(b.cancelledBy==='admin')return<span style={{background:'#111',color:'#fff',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999,display:'inline-flex',alignItems:'center',gap:3}}><AlertTriangle size={9} strokeWidth={1.8}/>관리자 강제취소</span>
    if(isNoshow(b)&&d<today)return<span style={{background:'#FEF3C7',color:'#D97706',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>노쇼</span>
    if(b.autoCancelled)return<span style={{background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>취소</span>
    if(b.checkedIn||b.earlyEnded)return<span style={{background:'#DCFCE7',color:'#16A34A',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>완료</span>
    if(d>=today)return<span style={{background:'#EFF6FF',color:'#3B82F6',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>예정</span>
    return<span style={{background:'#F1F5F9',color:'#94A3B8',fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:999}}>종료</span>
  }
  return(
    <div className="anm">
      <div style={{background:'#fff',borderRadius:16,padding:isMobile?'16px':'20px 24px',marginBottom:16}}>
        <div style={{display:'flex',flexWrap:'wrap',gap:10,alignItems:'flex-end'}}>
          {[{l:'시작일',v:dateFrom,s:setDateFrom},{l:'종료일',v:dateTo,s:setDateTo}].map(f=>(
            <div key={f.l} style={{flex:'1 1 130px',minWidth:120}}>
              <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label>
              <input type="date" value={f.v} onChange={e=>{f.s(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}/>
            </div>
          ))}
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>회의실</label>
            <select value={filterRoom} onChange={e=>{setFilterRoom(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}>
              <option value="ALL">전체</option>{rooms.map(r=><option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>
          <div style={{flex:'1 1 130px',minWidth:120}}>
            <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>예약자</label>
            <input placeholder="이름 검색..." value={filterUser} onChange={e=>{setFilterUser(e.target.value);setPage(1)}} style={{width:'100%',padding:'8px 10px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none'}}/>
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6,marginTop:12,flexWrap:'wrap'}}>
          {[
            {id:'ALL',        l:`전체 ${stats.all}`},
            {id:'upcoming',   l:`예정 ${stats.upcoming}`},
            {id:'completed',  l:`완료 ${stats.completed}`},
            {id:'noshow',     l:`노쇼 ${stats.noshow}`},
            {id:'cancelled',  l:`취소 ${stats.cancelled}`},
            {id:'adminCancel',l:`관리자취소 ${stats.adminCancel}`, dark:true},
          ].map(s=>(
            <button key={s.id} className="btn" onClick={()=>{setFilterStatus(s.id);setPage(1)}}
              style={{padding:'5px 12px',fontSize:11,borderRadius:999,
                background:filterStatus===s.id?((s as any).dark?'#111':'#111'):'#F8FAFC',
                color:filterStatus===s.id?'#fff':'#64748B',
                border:filterStatus===s.id?'none':'1px solid #E2E8F0'}}>{s.l}</button>
          ))}
          <button className="btn" onClick={()=>{
            const getStatus=(b:Booking)=>b.cancelledBy==='admin'?'관리자강제취소':b.autoCancelled?'취소':b.checkedIn?'완료':b.status==='pending'?'승인대기':'예정'
            const csvRows=filtered.map(b=>{const r=rooms.find(rm=>rm.room_id===b.room_id);return{회의명:b.title,회의실:r?.room_name??'',날짜:tsDate(b.start_at),시작:b.start_at.slice(11,16),종료:b.end_at.slice(11,16),예약자:b.user,부서:b.dept,상태:getStatus(b)}})
            exportCSV(csvRows,`예약목록_${dateFrom}_${dateTo}`)
          }} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:5,padding:'5px 12px',fontSize:11,borderRadius:999,background:'#F8FAFC',border:'1px solid #E2E8F0',color:'#374151',fontWeight:600}}>
            <Download size={10} strokeWidth={1.8}/> CSV
          </button>
        </div>
      </div>
      <div style={{background:'#fff',borderRadius:16,overflow:'hidden'}}>
        {paged.length===0?(<div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}><div style={{display:'flex',justifyContent:'center',marginBottom:8}}><Inbox size={40} strokeWidth={1.8} color="#CBD5E1"/></div><div style={{fontSize:13}}>조건에 맞는 예약이 없습니다</div></div>):(
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr style={{background:'#F8FAFC'}}>
                {['회의명','회의실','날짜','시간','예약자','상태','관리'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:11,fontWeight:600,color:'#94A3B8',whiteSpace:'nowrap',borderBottom:'1px solid #F1F5F9'}}>{h}</th>)}
              </tr></thead>
              <tbody>{paged.map(b=>{const r=rooms.find(rm=>rm.room_id===b.room_id);const canCancel=!b.autoCancelled&&b.status!=='rejected';return(
                <tr key={b.id} style={{borderBottom:'1px solid #F8FAFC',cursor:'pointer'}} onClick={()=>onDetail&&onDetail(b)} onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{padding:'10px 14px',fontWeight:600,color:'#111',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{r?.room_name??'?'}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSDateFull(b.start_at)}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}><div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:500,flexShrink:0,background:'#F1EFE8',color:'#444441'}}>{(b.user??'?')[0]}</div><span style={{fontSize:13,fontWeight:500}}>{b.user??'—'}</span></div></td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{getBadge(b)}</td>
                  <td style={{padding:'10px 14px'}} onClick={e=>e.stopPropagation()}>{canCancel&&<button className="btn" onClick={()=>setCancelModal(b)} style={{background:'#FEF2F2',border:'1px solid #FCA5A5',color:'#DC2626',padding:'5px 12px',fontSize:11,borderRadius:10}}>강제 취소</button>}</td>
                </tr>
              )})}</tbody>
            </table>
          </div>
        )}
        {totalPages>1&&(<div style={{display:'flex',justifyContent:'center',gap:4,padding:'16px',borderTop:'1px solid #F1F5F9'}}>
          <button className="btn" disabled={page===1} onClick={()=>setPage(p=>p-1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===1?'#CBD5E1':'#64748B'}}>‹</button>
          {Array.from({length:Math.min(totalPages,7)},(_,i)=>{const p=totalPages<=7?i+1:page<=4?i+1:page>=totalPages-3?totalPages-6+i:page-3+i;return<button key={p} className="btn" onClick={()=>setPage(p)} style={{padding:'6px 10px',fontSize:12,borderRadius:8,minWidth:32,background:page===p?'#111':'#F8FAFC',color:page===p?'#fff':'#64748B',fontWeight:page===p?700:400}}>{p}</button>})}
          <button className="btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)} style={{padding:'6px 12px',fontSize:12,borderRadius:8,background:'#F1F5F9',color:page===totalPages?'#CBD5E1':'#64748B'}}>›</button>
        </div>)}
      </div>
      {cancelModal&&(<ModalPortal><div onClick={e=>e.target===e.currentTarget&&setCancelModal(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
        <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:400,padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
          <div style={{fontSize:16,fontWeight:600,color:'#111',marginBottom:4,display:'flex',alignItems:'center',gap:6}}><AlertTriangle size={15} strokeWidth={1.8}/>예약 강제 취소</div>
          <div style={{fontSize:13,color:'#64748B',marginBottom:16}}>"{cancelModal.title}" — {cancelModal.user}</div>
          <label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:6}}>취소 사유</label>
          <textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value)} rows={3} placeholder="취소 사유를 입력하세요 (선택)" style={{width:'100%',background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:10,padding:'10px 14px',fontSize:13,outline:'none',resize:'none'}}/>
          <div style={{display:'flex',gap:8,marginTop:16}}>
            <button className="btn" onClick={()=>{setCancelModal(null);setCancelReason('')}} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>돌아가기</button>
            <button className="btn" onClick={()=>doCancel(cancelModal.id)} disabled={cancelling} style={{flex:1,background:'#DC2626',color:'#fff',padding:'12px',fontSize:13,fontWeight:600,borderRadius:12,opacity:cancelling?0.6:1}}>{cancelling?'처리 중...':'강제 취소'}</button>
          </div>
        </div>
      </div></ModalPortal>)}
    </div>
  )
}

// ─── AdminRooms ────────────────────────────────────────────────────────────────
export function AdminRooms({ showToast, isMobile }) {
  const [rooms,setRooms]=useState<Room[]>([])
  const [loadingRooms,setLoadingRooms]=useState(true)
  const [editRoom,setEditRoom]=useState<any>(null)
  const [form,setForm]=useState<Record<string,any>>({})
  const [thumbnail,setThumbnail]=useState('')
  const [gallery,setGallery]=useState<string[]>([])
  const [uploading,setUploading]=useState(false)
  const thumbRef=useRef<HTMLInputElement>(null)
  const galleryRef=useRef<HTMLInputElement>(null)
  const [allFeatures,setAllFeatures]=useState<any[]>([])
  const [selectedFeats,setSelectedFeats]=useState<number[]>([])
  useEffect(()=>{
    setLoadingRooms(true)
    Promise.all([loadAllRooms(),loadFeatures()]).then(([r,f])=>{setRooms(r);setAllFeatures(f)}).catch(err=>showToast(err.message??'로드 실패','error')).finally(()=>setLoadingRooms(false))
  },[])
  const openEdit=async(r:Room|null)=>{
    setForm({room_name:r?.room_name??'',room_name_ko:r?.room_name_ko??'',floor_id:r?.floor_id??1,capacity:r?.capacity??4,notes:r?.notes??'',is_active:r?.is_active??true,is_admin_only:r?.is_admin_only??false})
    setEditRoom(r??{room_id:null})
    if(r?.room_id){const imgs=await loadRoomImages(r.room_id);setThumbnail(imgs.thumbnail_url);setGallery(imgs.gallery_urls);setSelectedFeats((r.features??[]).map((f:any)=>f.feature_id))}
    else{setThumbnail('');setGallery([]);setSelectedFeats([])}
  }
  const handleThumbnailUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file||!editRoom?.room_id)return;setUploading(true);try{if(thumbnail)await deleteRoomImage(thumbnail);const url=await uploadRoomImage(editRoom.room_id,file,'thumbnail');setThumbnail(url);showToast('대표 이미지가 업로드되었습니다.')}catch(err:any){showToast(err.message,'error')}finally{setUploading(false);e.target.value=''}}
  const handleGalleryUpload=async(e:React.ChangeEvent<HTMLInputElement>)=>{const files=Array.from(e.target.files||[]);if(!files.length||!editRoom?.room_id)return;setUploading(true);try{const urls=await Promise.all(files.map(f=>uploadRoomImage(editRoom.room_id,f,'gallery')));setGallery(prev=>[...prev,...urls]);showToast(`갤러리 이미지 ${urls.length}장이 추가되었습니다.`)}catch(err:any){showToast(err.message,'error')}finally{setUploading(false);e.target.value=''}}
  const removeGalleryImage=async(url:string)=>{await deleteRoomImage(url);setGallery(prev=>prev.filter(u=>u!==url));showToast('이미지가 삭제되었습니다.','info')}
  const saveEdit=async()=>{
    if(!form.room_name.trim()){showToast('회의실명을 입력해주세요.','error');return}
    const capacity=Number(form.capacity),floor_id=Number(form.floor_id),roomId=editRoom?.room_id
    try{
      if(roomId){await upsertRoom({room_id:roomId,room_code:'',room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery}as any);await saveRoomImages(roomId,thumbnail,gallery);await saveRoomFeatures(roomId,selectedFeats);setRooms(prev=>prev.map(r=>r.room_id===roomId?{...r,...form,capacity,floor_id,thumbnail,gallery,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))}:r));showToast('회의실 정보가 수정되었습니다.')}
      else{const nid=Math.max(...rooms.map(r=>r.room_id),0)+1;const newRoom={room_id:nid,room_code:`ROOM_${nid}`,room_name:form.room_name,room_name_ko:form.room_name_ko,floor_id,capacity,notes:form.notes??'',is_active:form.is_active??true,is_admin_only:form.is_admin_only??false,color:'#111111',thumbnail,gallery};await upsertRoom(newRoom as any);await saveRoomImages(nid,thumbnail,gallery);await saveRoomFeatures(nid,selectedFeats);setRooms(prev=>[...prev,{...newRoom,features:allFeatures.filter(f=>selectedFeats.includes(f.feature_id))}as any]);showToast('회의실이 추가되었습니다.')}
      setEditRoom(null)
    }catch(err:any){showToast(err.message,'error')}
  }
  const toggleActive=async(rid:number)=>{const next=!rooms.find(r=>r.room_id===rid)?.is_active;try{await toggleRoomActive(rid,next);setRooms(rooms.map(r=>r.room_id===rid?{...r,is_active:next}:r));showToast(next?'활성화되었습니다.':'비활성화되었습니다.','info')}catch(err:any){showToast(err.message,'error')}}
  if(loadingRooms)return<div style={{textAlign:'center',padding:'60px',color:'#CBD5E1'}}><Building2 size={36} strokeWidth={1.8} color="#CBD5E1"/><div style={{fontSize:13,marginTop:8}}>회의실 불러오는 중...</div></div>
  return(
    <div className="anm">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:600,color:'#111'}}>전체 {rooms.length}개 <span style={{fontSize:12,color:'#94A3B8',fontWeight:400}}>활성 {rooms.filter(r=>r.is_active).length} · 비활성 {rooms.filter(r=>!r.is_active).length}</span></div>
        <button className="btn" onClick={()=>openEdit(null)} style={{background:'#111',color:'#fff',padding:'8px 16px',fontSize:12,borderRadius:10}}>+ 회의실 추가</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:12}}>
        {rooms.map(r=>{const fl=getFloor(r.floor_id);return(
          <div key={r.room_id} className="anm" style={{background:'#fff',borderRadius:16,overflow:'hidden',opacity:r.is_active?1:0.6}}>
            <div style={{display:'flex',gap:16,padding:'16px 20px'}}>
              <div style={{width:72,height:72,borderRadius:10,overflow:'hidden',flexShrink:0,background:'#F8FAFC'}}>
                {r.thumbnail?<img src={r.thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={24} strokeWidth={1.8} color="#CBD5E1"/></div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#111'}}>{r.room_name}</div>
                  {!r.is_active&&<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>비활성</span>}
                  {r.is_admin_only&&<span style={{background:'#F3E8FF',color:'#7C3AED',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>관리자전용</span>}
                </div>
                <div style={{fontSize:12,color:'#64748B',marginTop:2}}>{r.room_name_ko} · {fl?.floor_name} · {r.capacity}인</div>
                {(r.features??[]).length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>{(r.features??[]).slice(0,3).map(f=><span key={f.feature_id} style={{background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:999,padding:'2px 7px',fontSize:10,color:'#0369A1',fontWeight:600}}>{f.feature_name}</span>)}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,padding:'0 20px 16px'}}>
              <button className="btn" onClick={()=>openEdit(r)} style={{flex:1,background:'#F8FAFC',color:'#64748B',padding:'8px',fontSize:12,borderRadius:10,border:'1px solid #E2E8F0'}}>수정</button>
              <button className="btn" onClick={()=>toggleActive(r.room_id)} style={{flex:1,background:r.is_active?'#FEF2F2':'#F0FDF4',color:r.is_active?'#DC2626':'#16A34A',padding:'8px',fontSize:12,borderRadius:10,border:`1px solid ${r.is_active?'#FCA5A5':'#86EFAC'}`}}>{r.is_active?'비활성화':'활성화'}</button>
            </div>
          </div>
        )})}
      </div>
      {editRoom&&(<ModalPortal><div onClick={e=>e.target===e.currentTarget&&setEditRoom(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
        <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'90vh',overflow:'auto',padding:'24px',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div style={{fontSize:16,fontWeight:600,color:'#111'}}>{editRoom?.room_id?'회의실 정보 수정':'새 회의실 추가'}</div>
            <button className="btn" onClick={()=>setEditRoom(null)} style={{width:32,height:32,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:'50%',background:'#F1F5F9',color:'#64748B'}}><X size={14} strokeWidth={1.8}/></button>
          </div>
          {[{k:'room_name',l:'회의실명 (영문) *'},{k:'room_name_ko',l:'회의실명 (한글)'}].map(f=>(<div key={f.k} style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>{f.l}</label><input value={form[f.k]||''} onChange={e=>setForm(p=>({...p,[f.k]:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>))}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>층 *</label><select value={form.floor_id} onChange={e=>setForm(p=>({...p,floor_id:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}>{FLOORS.map(f=><option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}</select></div>
            <div><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>수용인원 *</label><input type="number" value={form.capacity} min={1} onChange={e=>setForm(p=>({...p,capacity:e.target.value}))} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:14,background:'#F8FAFC',outline:'none'}}/></div>
          </div>
          <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:4}}>설명/메모</label><textarea value={form.notes||''} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} style={{width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid #E2E8F0',fontSize:13,background:'#F8FAFC',outline:'none',resize:'none'}}/></div>
          <div style={{marginBottom:14,display:'flex',alignItems:'center',gap:10}}><input type="checkbox" id="is_admin_only" checked={!!form.is_admin_only} onChange={e=>setForm(p=>({...p,is_admin_only:e.target.checked}))} style={{width:16,height:16,cursor:'pointer'}}/><label htmlFor="is_admin_only" style={{fontSize:13,color:'#374151',cursor:'pointer',fontWeight:500}}>관리자 전용 회의실 (일반 유저 예약 불가)</label></div>
          {allFeatures.length>0&&(<div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>회의실 기능</label><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{allFeatures.map(f=>(<label key={f.feature_id} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'6px 12px',borderRadius:8,border:'1px solid #E2E8F0',fontSize:12,fontWeight:500,background:selectedFeats.includes(f.feature_id)?'#111':'#F8FAFC',color:selectedFeats.includes(f.feature_id)?'#fff':'#64748B'}}><input type="checkbox" checked={selectedFeats.includes(f.feature_id)} style={{display:'none'}} onChange={e=>setSelectedFeats(prev=>e.target.checked?[...prev,f.feature_id]:prev.filter(id=>id!==f.feature_id))}/>{f.feature_name}</label>))}</div></div>)}
          {editRoom?.room_id&&(<>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>대표 이미지</label>
              <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                <div style={{width:72,height:72,borderRadius:10,overflow:'hidden',background:'#F8FAFC',flexShrink:0,border:'1px solid #E2E8F0'}}>{thumbnail?<img src={thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={20} strokeWidth={1.8} color="#CBD5E1"/></div>}</div>
                <div style={{flex:1}}><input ref={thumbRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleThumbnailUpload}/><button className="btn" onClick={()=>thumbRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><Upload size={13} strokeWidth={1.8}/>{uploading?'업로드 중...':thumbnail?'이미지 교체':'이미지 업로드'}</button>{thumbnail&&<button className="btn" onClick={async()=>{await deleteRoomImage(thumbnail);setThumbnail('');showToast('삭제되었습니다.','info')}} style={{width:'100%',marginTop:6,padding:'8px',borderRadius:10,background:'#FEF2F2',color:'#DC2626',fontSize:11,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:4}}><Trash2 size={11} strokeWidth={1.8}/> 삭제</button>}</div>
              </div>
            </div>
            <div style={{marginBottom:14}}><label style={{fontSize:11,fontWeight:600,color:'#94A3B8',display:'block',marginBottom:8}}>갤러리 ({gallery.length}장)</label>
              {gallery.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginBottom:8}}>{gallery.map((url,i)=>(<div key={i} style={{position:'relative',paddingBottom:'100%',borderRadius:8,overflow:'hidden',background:'#F8FAFC'}}><img src={url} alt="" style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover'}}/><button onClick={()=>removeGalleryImage(url)} style={{position:'absolute',top:4,right:4,width:20,height:20,borderRadius:'50%',background:'rgba(0,0,0,0.6)',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><X size={10} strokeWidth={1.8}/></button></div>))}</div>}
              <input ref={galleryRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={handleGalleryUpload}/><button className="btn" onClick={()=>galleryRef.current?.click()} disabled={uploading} style={{width:'100%',padding:'10px',borderRadius:10,border:'1.5px dashed #CBD5E1',background:'#F8FAFC',color:'#64748B',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}><ImagePlus size={13} strokeWidth={1.8}/>{uploading?'업로드 중...':'갤러리 이미지 추가'}</button>
            </div>
          </>)}
          <div style={{display:'flex',gap:8,marginTop:20}}>
            <button className="btn" onClick={()=>setEditRoom(null)} style={{flex:1,background:'#F1F5F9',color:'#64748B',padding:'12px',fontSize:13,borderRadius:12}}>취소</button>
            <button className="btn" onClick={saveEdit} style={{flex:1,background:'#111',color:'#fff',padding:'12px',fontSize:13,fontWeight:600,borderRadius:12}}>저장</button>
          </div>
        </div>
      </div></ModalPortal>)}
    </div>
  )
}

// ─── AdminUsers ────────────────────────────────────────────────────────────────
import { UserAvatar } from '../components/common/UserAvatar'

export function AdminUsers({ users, setUsers, showToast, isMobile }) {
  type FilterType = 'all' | 'admin' | 'logged' | 'unlogged' | 'departed'

  const [filter,     setFilter]     = useState<FilterType>('all')
  const [searchQ,    setSearchQ]    = useState('')
  // 사용자 상세 모달
  const [editUser,   setEditUser]   = useState<AppUser | null>(null)
  const [form,       setForm]       = useState<Record<string,any>>({})
  const [saving,     setSaving]     = useState(false)
  // Azure AD 동기화
  const [syncing,    setSyncing]    = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  // 퇴사자 목록
  const [departed,   setDeparted]   = useState<DepartedUser[]>([])
  // 수동 퇴사 처리 — API 구현 완료, UI 버튼은 미노출 (기술검증 완료)
  // countFutureBookings / manualDepartUser 함수는 api.ts에 존재

  useEffect(() => {
    loadDepartedUsers().then(setDeparted).catch(() => {})
  }, [])

  // ── 동기화 이력
  const SYNC_LOG_KEY = 'cnr_sync_logs'
  const loadSyncLogs = (): SyncResult[] => {
    try { return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) ?? '[]') } catch { return [] }
  }
  const saveSyncLog = (r: SyncResult) => {
    localStorage.setItem(SYNC_LOG_KEY, JSON.stringify([r, ...loadSyncLogs()].slice(0, 20)))
  }
  const [syncLogs, setSyncLogs] = useState<SyncResult[]>(loadSyncLogs)
  const [showLogs, setShowLogs] = useState(false)

  // ── 카운트
  const counts = {
    all:      users.length,
    admin:    users.filter(u => u.role === 'ADMIN').length,
    logged:   users.filter(u => !!u.dept).length,        // dept 있으면 로그인 완료
    unlogged: users.filter(u => !u.dept).length,
    departed: departed.length,
  }

  // ── 검색 + 필터
  const filteredUsers = users.filter(u => {
    if (filter === 'admin'    && u.role !== 'ADMIN') return false
    if (filter === 'logged'   && !u.dept)            return false
    if (filter === 'unlogged' && !!u.dept)           return false
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return u.name.toLowerCase().includes(q)
        || (u.dept ?? '').toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
  })

  const filteredDeparted = departed.filter(u => {
    if (!searchQ) return true
    const q = searchQ.toLowerCase()
    return u.name.toLowerCase().includes(q)
        || (u.dept ?? '').toLowerCase().includes(q)
        || u.email.toLowerCase().includes(q)
  })

  const openDetail = (u: AppUser) => {
    setForm({ name: u.name, dept: u.dept, email: u.email, role: u.role })
    setEditUser(u)
  }

  const closeModal = () => setEditUser(null)

  // ── 저장
  const saveEdit = async () => {
    if (!editUser?.user_id) return
    if (!form.name.trim()) { showToast('이름은 필수입니다.', 'error'); return }
    setSaving(true)
    const prev = users.find(u => u.user_id === editUser.user_id)
    setUsers(users.map(u => u.user_id === editUser.user_id ? { ...u, ...form } : u))
    try {
      await updateProfile(editUser.user_id, { name: form.name, dept: form.dept, role: form.role })
      showToast('수정되었습니다.')
      closeModal()
    } catch (err: any) {
      if (prev) setUsers(users.map(u => u.user_id === editUser.user_id ? prev : u))
      showToast(err.message, 'error')
    } finally { setSaving(false) }
  }

  // ── 권한 토글
  const toggleRole = async (uid: string) => {
    const prev = users.find(u => u.user_id === uid)?.role
    const next = prev === 'ADMIN' ? 'USER' : 'ADMIN'
    setUsers(users.map(u => u.user_id === uid ? { ...u, role: next } : u))
    try {
      await updateProfile(uid, { role: next })
      showToast(`권한이 ${next}로 변경되었습니다.`, 'info')
    } catch (err: any) {
      setUsers(users.map(u => u.user_id === uid ? { ...u, role: prev ?? 'USER' } : u))
      showToast(err.message, 'error')
    }
  }

  // ── Azure AD 동기화
  const handleSync = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const result = await syncAllUsers()
      setSyncResult(result); saveSyncLog(result); setSyncLogs(loadSyncLogs())
      const [refreshed, refreshedDeparted] = await Promise.all([loadUsers(), loadDepartedUsers()])
      setUsers(refreshed); setDeparted(refreshedDeparted)
      showToast(`동기화 완료 — ${result.synced}명 반영`, 'info')
    } catch (err: any) {
      showToast(err.message ?? 'Azure AD 동기화 실패', 'error')
    } finally { setSyncing(false) }
  }

  // ── 필터 탭
  const FILTER_TABS: { id: FilterType; label: string }[] = [
    { id: 'all',      label: '전체' },
    { id: 'admin',    label: 'Admin' },
    { id: 'logged',   label: '로그인' },
    { id: 'unlogged', label: '미로그인' },
    { id: 'departed', label: '퇴사자' },
  ]

  return (
    <div className="anm">
      {/* ── 헤더 ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, flexWrap:'wrap', gap:10 }}>
        <div style={{ fontSize:15, fontWeight:600, color:'#111' }}>사용자 관리</div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn" onClick={handleSync} disabled={syncing}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8,
              background: syncing ? '#F1F5F9' : '#EFF6FF', border:'1px solid #BFDBFE',
              color: syncing ? '#94A3B8' : '#2563EB', fontWeight:600, cursor: syncing ? 'not-allowed' : 'pointer' }}>
            <RefreshCw size={11} strokeWidth={1.8}/>
            {syncing ? '동기화 중...' : 'Azure AD 동기화'}
          </button>
          <button className="btn"
            onClick={() => exportCSV(
              filter === 'departed'
                ? filteredDeparted.map(u => ({ 이름:u.name, 부서:u.dept, 이메일:u.email, 퇴사일:u.departed_at.slice(0,10) }))
                : filteredUsers.map(u => ({ 이름:u.name, 부서:u.dept||'(미로그인)', 이메일:u.email, 권한:u.role })),
              filter === 'departed' ? '퇴사자목록' : '사용자목록'
            )}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#374151', fontWeight:600 }}>
            <Download size={10} strokeWidth={1.8}/> CSV
          </button>
        </div>
      </div>

      {/* ── 동기화 결과 배너 ── */}
      {syncResult && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 14px', marginBottom:10, borderRadius:10, background:'#F0FDF4', border:'1px solid #86EFAC', flexWrap:'wrap', gap:6 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <CheckCircle2 size={13} strokeWidth={1.8} color="#16A34A"/>
            <span style={{ fontSize:12, fontWeight:600, color:'#15803D' }}>Azure AD 동기화 완료</span>
            <span style={{ fontSize:11, color:'#64748B' }}>총 {syncResult.total}명 · {syncResult.synced}명 반영</span>
            {syncResult.departed > 0 && (
              <span style={{ fontSize:11, fontWeight:600, color:'#DC2626', background:'#FEF2F2', padding:'1px 8px', borderRadius:999 }}>
                퇴사자 {syncResult.departed}명
                {syncResult.cancelledBookings > 0 && ` · 예약 ${syncResult.cancelledBookings}건 취소`}
              </span>
            )}
          </div>
          <span style={{ fontSize:10, color:'#94A3B8' }}>
            {new Date(syncResult.syncedAt).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}
          </span>
        </div>
      )}

      {/* ── 동기화 이력 ── */}
      {syncLogs.length > 0 && (
        <div style={{ marginBottom:10 }}>
          <button className="btn" onClick={() => setShowLogs(v => !v)}
            style={{ fontSize:11, color:'#94A3B8', background:'none', display:'flex', alignItems:'center', gap:4, padding:'2px 0' }}>
            <RefreshCw size={10} strokeWidth={1.8}/>
            동기화 이력 {syncLogs.length}건 {showLogs ? '▲' : '▼'}
          </button>
          {showLogs && (
            <div style={{ marginTop:6, background:'#F8FAFC', borderRadius:10, overflow:'hidden', border:'1px solid #E2E8F0' }}>
              {syncLogs.map((log, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'7px 14px', borderBottom: i < syncLogs.length-1 ? '1px solid #F1F5F9' : 'none', fontSize:11 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ color:'#64748B' }}>{new Date(log.syncedAt).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                    <span style={{ color:'#374151' }}>총 {log.total}명 · {log.synced}명 반영</span>
                    {(log as any).departed > 0 && <span style={{ color:'#DC2626', fontWeight:600 }}>퇴사 {(log as any).departed}명</span>}
                  </div>
                  <span style={{ color: log.success ? '#16A34A' : '#DC2626', fontWeight:600 }}>{log.success ? '성공' : '실패'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 필터 탭 ── */}
      <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
        {FILTER_TABS.map(t => (
          <button key={t.id} className="btn" onClick={() => setFilter(t.id)}
            style={{
              display:'flex', alignItems:'center', gap:5,
              padding:'5px 12px', borderRadius:999, fontSize:12, fontWeight:600, cursor:'pointer',
              background: filter === t.id ? '#111' : '#F8FAFC',
              color:      filter === t.id ? '#fff' : '#374151',
              border:     filter === t.id ? 'none' : '1px solid #E2E8F0',
            }}>
            <span>{t.label}</span>
            <span style={{ fontWeight:700 }}>
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {/* ── 검색창 ── */}
      <div style={{ background:'#fff', borderRadius:12, padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
        <Search size={14} strokeWidth={1.8} color="#94A3B8" style={{flexShrink:0}}/>
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
          placeholder="이름, 부서, 이메일로 검색..."
          style={{ flex:1, border:'none', outline:'none', fontSize:13, background:'transparent', color:'#111' }}/>
        {searchQ && (
          <button className="btn" onClick={() => setSearchQ('')} style={{ background:'none', color:'#CBD5E1', display:'flex', alignItems:'center' }}>
            <X size={11} strokeWidth={1.8}/>
          </button>
        )}
      </div>

      {/* ── 사용자 목록 ── */}
      {filter !== 'departed' && (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden' }}>
          {isMobile ? (
            // 모바일: 카드 리스트
            <div>
              {filteredUsers.map(u => (
                <div key={u.user_id}
                  onClick={() => openDetail(u)}
                  style={{ padding:'14px 20px', borderBottom:'1px solid #F8FAFC', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FAFBFD')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={36} bgColor={u.role==='ADMIN'?'#111':'#E2E8F0'} textColor={u.role==='ADMIN'?'#fff':'#64748B'} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'#111' }}>
                      {u.name}{' '}
                      {u.dept
                        ? <span style={{ color:'#94A3B8', fontWeight:400 }}>{u.dept}</span>
                        : <span style={{ fontSize:10, fontWeight:600, background:'#FEF3C7', color:'#92400E', padding:'1px 6px', borderRadius:999 }}>미로그인</span>
                      }
                    </div>
                    <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{u.email}</div>
                  </div>
                  <span style={{
                    padding:'3px 9px', borderRadius:999, fontSize:10, fontWeight:600,
                    background: u.role==='ADMIN' ? '#111' : '#F8FAFC',
                    color:      u.role==='ADMIN' ? '#fff' : '#64748B',
                  }}>{u.role}</span>
                </div>
              ))}
            </div>
          ) : (
            // 데스크탑: 테이블 (관리 컬럼 없음, row 전체 클릭)
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#F8FAFC' }}>
                  {['', '이름', '부서', '이메일', '권한'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(u => (
                  <tr key={u.user_id}
                    onClick={() => openDetail(u)}
                    style={{ borderBottom:'1px solid #F8FAFC', cursor:'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFBFD')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding:'10px 14px', width:44 }}>
                      <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={30} bgColor={u.role==='ADMIN'?'#111':'#E2E8F0'} textColor={u.role==='ADMIN'?'#fff':'#64748B'} />
                    </td>
                    <td style={{ padding:'10px 14px', fontWeight:600, color:'#111' }}>{u.name}</td>
                    <td style={{ padding:'10px 14px', color:'#64748B' }}>
                      {u.dept || <span style={{ fontSize:10, fontWeight:600, background:'#FEF3C7', color:'#92400E', padding:'2px 8px', borderRadius:999 }}>미로그인</span>}
                    </td>
                    <td style={{ padding:'10px 14px', color:'#64748B' }}>{u.email}</td>
                    <td style={{ padding:'10px 14px' }}>
                      <span style={{
                        padding:'3px 10px', borderRadius:999, fontSize:11, fontWeight:600,
                        background: u.role==='ADMIN' ? '#111' : '#F8FAFC',
                        color:      u.role==='ADMIN' ? '#fff' : '#64748B',
                        border:     u.role==='ADMIN' ? 'none' : '1px solid #E2E8F0',
                      }}>{u.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── 퇴사자 목록 ── */}
      {filter === 'departed' && (
        <div style={{ background:'#fff', borderRadius:16, overflow:'hidden' }}>
          {isMobile ? (
            <div>
              {filteredDeparted.map(u => (
                <div key={u.id} style={{ padding:'14px 20px', borderBottom:'1px solid #F8FAFC', display:'flex', alignItems:'center', gap:12, opacity:0.7 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'#FEE2E2', color:'#DC2626', fontSize:13, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    {u.name.charAt(0)}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:'#374151' }}>
                      {u.name}{' '}
                      <span style={{ fontSize:10, fontWeight:600, background:'#FEE2E2', color:'#DC2626', padding:'1px 6px', borderRadius:999 }}>퇴사</span>
                    </div>
                    <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{u.dept} · {u.email}</div>
                    <div style={{ fontSize:10, color:'#CBD5E1', marginTop:2 }}>퇴사일: {u.departed_at.slice(0,10)}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#FEF2F2' }}>
                  {['', '이름', '부서', '이메일', '퇴사일'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #FEE2E2' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeparted.map(u => (
                  <tr key={u.id} style={{ borderBottom:'1px solid #F8FAFC', opacity:0.75 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FFF5F5')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding:'10px 14px', width:44 }}>
                      <div style={{ width:30, height:30, borderRadius:'50%', background:'#FEE2E2', color:'#DC2626', fontSize:11, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {u.name.charAt(0)}
                      </div>
                    </td>
                    <td style={{ padding:'10px 14px', fontWeight:600, color:'#374151' }}>
                      {u.name}
                      <span style={{ marginLeft:6, fontSize:10, fontWeight:600, background:'#FEE2E2', color:'#DC2626', padding:'1px 6px', borderRadius:999 }}>퇴사</span>
                    </td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.dept || '-'}</td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.email}</td>
                    <td style={{ padding:'10px 14px', color:'#94A3B8' }}>{u.departed_at.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          사용자 상세 모달 (드로어 → 중앙 모달)
      ══════════════════════════════════════════════════════════════════════ */}
      {editUser && (
        <ModalPortal>
        <div onClick={closeModal}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
          <div className="anm" onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:480, maxHeight:'88vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.15)', display:'flex', flexDirection:'column' }}>

            {/* ── 모달 헤더 */}
            <div style={{ padding:'20px 24px', borderBottom:'1px solid #F1F5F9', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <UserAvatar name={editUser.name} avatarUrl={(editUser as any).avatar_url ?? null} size={40} bgColor={editUser.role==='ADMIN'?'#111':'#E2E8F0'} textColor={editUser.role==='ADMIN'?'#fff':'#64748B'} />
                <div>
                  <div style={{ fontSize:15, fontWeight:600, color:'#111' }}>{editUser.name}</div>
                  <div style={{ fontSize:11, color:'#94A3B8', marginTop:1 }}>{editUser.email}</div>
                </div>
              </div>
              <button className="btn" onClick={closeModal} style={{ width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:'50%', background:'#F1F5F9', color:'#64748B' }}>
                <X size={14} strokeWidth={1.8}/>
              </button>
            </div>

            {/* ── 기본 정보 편집 뷰 */}
            <div style={{ padding:'20px 24px', flex:1 }}>
                {/* 이름 */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>이름 *</label>
                  <input value={form.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:14, background:'#fff', outline:'none', boxSizing:'border-box' }}
                    onFocus={e => e.target.style.borderColor='#111'} onBlur={e => e.target.style.borderColor='#E2E8F0'}/>
                </div>
                {/* 부서 */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>부서</label>
                  <input value={form.dept || ''} onChange={e => setForm(p => ({ ...p, dept: e.target.value }))}
                    style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:14, background:'#fff', outline:'none', boxSizing:'border-box' }}
                    onFocus={e => e.target.style.borderColor='#111'} onBlur={e => e.target.style.borderColor='#E2E8F0'}/>
                </div>
                {/* 이메일 (읽기 전용) */}
                <div style={{ marginBottom:14 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:5 }}>이메일</label>
                  <input value={form.email || ''} readOnly style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #F1F5F9', fontSize:14, background:'#F8FAFC', outline:'none', color:'#94A3B8', boxSizing:'border-box' }}/>
                </div>
                {/* 권한 */}
                <div style={{ marginBottom:20 }}>
                  <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:8 }}>권한</label>
                  <div style={{ display:'flex', gap:8 }}>
                    {['USER','ADMIN'].map(r => (
                      <button key={r} className="btn" onClick={() => setForm(p => ({ ...p, role: r }))}
                        style={{ flex:1, padding:'10px', borderRadius:10, fontSize:13, fontWeight:600,
                          border:`1.5px solid ${form.role===r?'#111':'#E2E8F0'}`,
                          background: form.role===r?'#111':'#F8FAFC',
                          color:      form.role===r?'#fff':'#64748B', cursor:'pointer' }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 저장 / 취소 */}
                <div style={{ display:'flex', gap:8, marginBottom:24 }}>
                  <button className="btn" onClick={closeModal} style={{ flex:1, background:'#F1F5F9', color:'#64748B', padding:'12px', fontSize:13, borderRadius:12 }}>취소</button>
                  <button className="btn" onClick={saveEdit} disabled={saving}
                    style={{ flex:1, background:'#111', color:'#fff', padding:'12px', fontSize:13, fontWeight:600, borderRadius:12, opacity:saving?0.6:1 }}>
                    {saving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
// ─── AdminApprovals ────────────────────────────────────────────────────────────
// 승인 정책:
//   - 승인/거절 가능 시간: start_at 1분 전까지 (nowMs < startMs - 60000)
//   - 기한 초과: status='pending' && autoCancelled=true
//   - 거절: status='rejected' && autoCancelled=true
//   - 승인 완료: status='confirmed'
import { BookingListTable } from '../components/common/BookingListTable'

export function AdminApprovals({ bookings, rooms, users, onApprove, onReject, showToast, isMobile, onDetail }) {
  const [filterStatus, setFilterStatus] = useState<'pending'|'confirmed'|'rejected'|'expired'|'all'>('pending')
  const [rejectModal,  setRejectModal]  = useState<{id:string;title:string;user:string}|null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [processing,   setProcessing]   = useState<string|null>(null)
  const [nowMs,        setNowMs]        = useState(Date.now())
  const [dateFrom,     setDateFrom]     = useState(getMonthStart(0))
  const [dateTo,       setDateTo]       = useState(todayStr())
  const [rangeData,    setRangeData]    = useState<Booking[]>([])
  const [loadingRange, setLoadingRange] = useState(false)

  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 10000)
    return () => clearInterval(iv)
  }, [])

  const adminRoomIds = useMemo(() => new Set(rooms.filter(r => r.is_admin_only).map(r => r.room_id)), [rooms])

  const fetchRange = useCallback(async () => {
    setLoadingRange(true)
    try {
      const data = await loadBookingsByRange(dateFrom, dateTo)
      setRangeData(data.filter(b => adminRoomIds.has(b.room_id)))
    } catch (e) { console.error(e) }
    finally { setLoadingRange(false) }
  }, [dateFrom, dateTo, adminRoomIds])

  useEffect(() => { fetchRange() }, [fetchRange])

  const mergedData = useMemo(() => {
    const liveAll = bookings.filter(b => adminRoomIds.has(b.room_id))
    const liveIds = new Set(liveAll.map(b => b.id))
    const historical = rangeData.filter(b => !liveIds.has(b.id))
    return [...liveAll, ...historical].sort((a,b) => b.start_at.localeCompare(a.start_at))
  }, [bookings, rangeData, adminRoomIds])

  const classify = (b: Booking) => {
    if (b.status === 'pending' && b.autoCancelled)  return 'expired'
    if (b.status === 'pending' && !b.autoCancelled) return 'pending'
    if (b.status === 'confirmed') return 'confirmed'
    if (b.status === 'rejected')  return 'rejected'
    return 'other'
  }

  const displayData = useMemo(() => {
    if (filterStatus === 'all') return mergedData
    return mergedData.filter(b => classify(b) === filterStatus)
  }, [mergedData, filterStatus])

  const counts = useMemo(() => ({
    pending:   mergedData.filter(b => classify(b) === 'pending').length,
    confirmed: mergedData.filter(b => classify(b) === 'confirmed').length,
    rejected:  mergedData.filter(b => classify(b) === 'rejected').length,
    expired:   mergedData.filter(b => classify(b) === 'expired').length,
    all:       mergedData.length,
  }), [mergedData])

  const canApprove = (b: Booking) => nowMs < new Date(b.start_at).getTime() - 60_000
  const minsLeft   = (b: Booking) => Math.max(0, Math.floor((new Date(b.start_at).getTime() - 60_000 - nowMs) / 60_000))

  const doApprove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (processing) return
    setProcessing(id)
    try { await onApprove(id); fetchRange() }
    finally { setProcessing(null) }
  }

  const doReject = async () => {
    if (!rejectModal || processing) return
    setProcessing(rejectModal.id)
    try {
      await onReject(rejectModal.id, rejectReason || '관리자 거절')
      setRejectModal(null); setRejectReason('')
      fetchRange()
    } finally { setProcessing(null) }
  }

  const TABS = [
    { id:'pending',   label:'대기',    count:counts.pending,   color:'#D97706', activeBg:'#FEF3C7' },
    { id:'confirmed', label:'승인완료', count:counts.confirmed, color:'#16A34A', activeBg:'#DCFCE7' },
    { id:'rejected',  label:'거절',    count:counts.rejected,  color:'#DC2626', activeBg:'#FEF2F2' },
    { id:'expired',   label:'기한초과', count:counts.expired,   color:'#94A3B8', activeBg:'#F1F5F9' },
    { id:'all',       label:'전체',    count:counts.all,       color:'#111',    activeBg:'#F1F5F9' },
  ] as const

  return (
    <div className="anm">
      {/* 인라인 날짜 필터 */}
      <div style={{ background:'#fff', borderRadius:14, padding:'14px 16px', marginBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:8 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#111' }}>승인 관리</div>
          <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:108, outline:'none' }}/>
            <span style={{ fontSize:12, color:'#CBD5E1' }}>~</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:108, outline:'none' }}/>
            {[
              { label:'이번 달', fn:():[string,string]=>[getMonthStart(0), todayStr()] },
              { label:'지난 달', fn:():[string,string]=>[getMonthStart(-1), getMonthEnd(-1)] },
            ].map(p => (
              <button key={p.label} className="btn" onClick={() => { const [f,t]=p.fn(); setDateFrom(f); setDateTo(t) }}
                style={{ height:32, padding:'0 10px', border:'0.5px solid #E2E8F0', borderRadius:8, fontSize:12, background:'#fff', color:'#64748B', cursor:'pointer', whiteSpace:'nowrap' }}>
                {p.label}
              </button>
            ))}
            <button className="btn" onClick={fetchRange} disabled={loadingRange}
              style={{ display:'flex', alignItems:'center', gap:4, height:32, padding:'0 10px', borderRadius:8, background:loadingRange?'#F8FAFC':'#111', color:loadingRange?'#CBD5E1':'#fff', fontSize:11, fontWeight:600, border:'none', cursor:loadingRange?'default':'pointer' }}>
              <RefreshCw size={11} strokeWidth={1.8}/>{loadingRange?'조회 중...':'새로고침'}
            </button>
          </div>
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {TABS.map(t => (
            <button key={t.id} className="btn" onClick={() => setFilterStatus(t.id as any)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', fontSize:11, borderRadius:999,
                fontWeight: filterStatus===t.id ? 700 : 500,
                background: filterStatus===t.id ? t.activeBg : '#F8FAFC',
                color:      filterStatus===t.id ? t.color    : '#64748B',
                border:     filterStatus===t.id ? `1.5px solid ${t.color}40` : '1px solid #E2E8F0' }}>
              <span>{t.label}</span>
              {t.count > 0 && <span style={{ background: filterStatus===t.id ? t.color : '#E2E8F0', color: filterStatus===t.id ? '#fff' : '#64748B', borderRadius:999, padding:'1px 6px', fontSize:10, fontWeight:600 }}>{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <BookingListTable
        bookings={bookings}
        rooms={rooms}
        users={users ?? []}
        currentUser=""
        onDetail={onDetail ?? (() => {})}
        loading={loadingRange}
        controlled={displayData}
        actionColumn={{
          header: '처리',
          render: (b: Booking) => {
            const status = classify(b)
            const isProc = processing === b.id
            if (status !== 'pending' || b.autoCancelled) return null
            if (!canApprove(b)) return <span style={{ fontSize:11, color:'#94A3B8', padding:'4px 8px', background:'#F8FAFC', borderRadius:8 }}>마감</span>
            const mins = minsLeft(b)
            return (
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <div style={{ display:'flex', gap:5 }}>
                  <button onClick={e => doApprove(b.id, e)} disabled={isProc}
                    style={{ padding:'5px 10px', fontSize:11, fontWeight:600, borderRadius:8, background:'#16A34A', color:'#fff', border:'none', cursor:isProc?'default':'pointer', opacity:isProc?0.6:1 }}>승인</button>
                  <button onClick={e => { e.stopPropagation(); setRejectModal({id:b.id,title:b.title,user:b.user}) }} disabled={isProc}
                    style={{ padding:'5px 10px', fontSize:11, fontWeight:600, borderRadius:8, background:'#FEF2F2', color:'#DC2626', border:'1px solid #FCA5A5', cursor:isProc?'default':'pointer', opacity:isProc?0.6:1 }}>거절</button>
                </div>
                {mins <= 30 && <span style={{ fontSize:10, color:'#DC2626', fontWeight:600 }}>{mins > 0 ? `${mins}분 후 마감` : '곧 마감'}</span>}
              </div>
            )
          }
        }}
      />

      {rejectModal && (
        <ModalPortal>
        <div onClick={e => e.target === e.currentTarget && setRejectModal(null)}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.55)', backdropFilter:'blur(6px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
          <div style={{ background:'#fff', borderRadius:16, width:'100%', maxWidth:420, padding:'24px', boxShadow:'0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ fontSize:16, fontWeight:600, color:'#111', marginBottom:4 }}>예약 거절</div>
            <div style={{ fontSize:13, color:'#64748B', marginBottom:16 }}>"{rejectModal.title}" — {rejectModal.user}</div>
            <div style={{ fontSize:11, color:'#D97706', background:'#FFFBEB', borderRadius:8, padding:'8px 12px', marginBottom:14 }}>
              ⚠️ 거절 시 예약은 즉시 취소되며 신청자에게 알림이 발송됩니다
            </div>
            <label style={{ fontSize:11, fontWeight:600, color:'#94A3B8', display:'block', marginBottom:6 }}>거절 사유</label>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
              placeholder="거절 사유를 입력하세요 (선택)"
              style={{ width:'100%', padding:'10px 14px', borderRadius:10, border:'1px solid #E2E8F0', fontSize:13, outline:'none', resize:'none', background:'#F8FAFC', boxSizing:'border-box' }}/>
            <div style={{ display:'flex', gap:8, marginTop:16 }}>
              <button className="btn" onClick={() => setRejectModal(null)} style={{ flex:1, background:'#F1F5F9', color:'#64748B', padding:'12px', fontSize:13, borderRadius:12 }}>취소</button>
              <button className="btn" onClick={doReject} disabled={!!processing} style={{ flex:1, background:'#DC2626', color:'#fff', padding:'12px', fontSize:13, fontWeight:600, borderRadius:12, opacity:processing?0.6:1 }}>
                {processing ? '처리 중...' : '거절 확정'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
