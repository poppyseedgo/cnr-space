import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'  // ← [2026-05-06 사이드 sticky 핫픽스] 사이드 네비를 body 직접 mount하기 위함
import { AlertCircle, AlertTriangle, ArrowUpDown, Ban, BarChart2, Building2, Calendar, CheckCircle2, ChevronDown, Clock, Download, ImagePlus, Inbox, RefreshCw, RotateCw, Search, Trash2, Upload, Users, X } from 'lucide-react'
import { Button } from '../components/common/Button'
import { ModalCloseButton } from '../components/common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화
import {
  todayStr, tsDate, tsMin, tsTime, fmtTime, fmtTSDateFull, fmtTSRangeFull,
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
// ← [2026-04-18 P0 fix] 파일 중간에 있던 import 3개를 최상단으로 이동
//   원인: ES 모듈 사양상 import는 파일 최상단만 허용. Vite dev는 관대하지만
//   Rollup 프로덕션 빌드에서 청크 분할 시 로드 순서가 꼬여 lazy export가
//   undefined로 평가되는 현상 발생 (배포 직후 뷰 전환 시 흰 화면)
import { UserAvatar } from '../components/common/UserAvatar'
import { UserChip } from '../components/common/UserChip'
import { BookingListTable } from '../components/common/BookingListTable'
// ← [2026-05-06 Admin Phase A] 좌측 사이드 네비게이션 컴포넌트 신설 (Figma node 451:3522)
import { AdminSideNav, type AdminTabId } from '../components/layout/AdminSideNav'
// ← [2026-05-06 Admin Phase C] 승인 관리 테이블 컴포넌트 신설 (Figma node 451:3534, Phase B 공통 컴포넌트 사용)
import { AdminApprovalTable } from '../components/common/AdminApprovalTable'
// ← [2026-05-11 Phase 2] isNoshow 통일 — utils/noshow.ts SSOT 사용
//   기존 분산: L186 / L783 / L1073 (모두 옛 autoCancelled 룰)
//   변경 사유: cron ②③ 비활성화 후 markNoshow API가 status='confirmed' 유지 → 확정 룰이 더 정확
//   영향: contaminated 데이터(status='cancelled' 시절) 제외 + 강제취소 자동 분리
import { isNoshow } from '../utils/noshow'
// ← [2026-05-11 Phase 4] 위젯 ② 노쇼 현황 — 카드 헤더 inline date picker용
import { DatePickerPopup } from '../components/common/DatePickerPopup'

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

// ─── 차트 공통 ────────────────────────────────────────────────────────────────
const PIE_COLORS  = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#06B6D4','#3B82F6','#F97316']

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

function DetailDrawer({ type, rooms, users, initFrom, initTo, onDetail, onClose }:
  { type: DetailType; rooms: Room[]; users: AppUser[]; initFrom: string; initTo: string; onDetail?: (b:Booking)=>void; onClose: ()=>void }) {
  const [presetId, setPresetId] = useState('custom')
  const [dateFrom, setDateFrom] = useState(initFrom)
  const [dateTo,   setDateTo]   = useState(initTo)
  const [data,     setData]     = useState<Booking[]>([])
  const [loading,  setLoading]  = useState(false)
  const [page,     setPage]     = useState(1)
  const [sortKey,  setSortKey]  = useState('start_at')
  const [sortAsc,  setSortAsc]  = useState(false)
  // 드릴다운: 집계 행 클릭 → 해당 필터로 예약 목록 표시
  const [drill, setDrill] = useState<{ label: string; fn: (b:Booking)=>boolean } | null>(null)
  const PER = 30

  const fetchData = useCallback(async () => {
    setLoading(true); setPage(1)
    try { setData(await loadBookingsByRange(dateFrom, dateTo)) }
    catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  // ← [2026-05-11 Phase 2] 로컬 isNoshow 정의 제거 — utils/noshow.ts SSOT 사용
  //   옛 룰: autoCancelled && !checkedIn && !earlyEnded → 통일 룰: status==='confirmed' && cancelledBy==='system' && !checkedIn

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
      return { room_name: r?.room_name || String(rid), ...s,
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
  // 공통 예약 목록 렌더 (drill-down 시에도 재사용)
  const renderBookingList = (source: Booking[], drillLabel?: string) => {
    const sorted = [...source].sort((a,b) => {
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
        {/* 드릴다운 브레드크럼 */}
        {drillLabel && (
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14, padding:'8px 12px', background:'#F5F5FF', borderRadius:8 }}>
            <button className="btn" onClick={() => { setDrill(null); setPage(1) }}
              style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, color:'#6366F1', padding:'4px 8px', borderRadius:6, background:'#fff', border:'1px solid #C7D2FE' }}>
              ← 전체 보기
            </button>
            <span style={{ fontSize:12, color:'#6366F1', fontWeight:600 }}>{drillLabel}</span>
            <span style={{ fontSize:11, color:'#94A3B8' }}>예약 {total}건</span>
          </div>
        )}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
          <div style={{ fontSize:12, color:'#64748B' }}>총 <b style={{ color:'#111' }}>{total}</b>건</div>
          <button className="btn" onClick={() => exportCSV(csvRows, `${drillLabel??DETAIL_META[type].title}_${dateFrom}_${dateTo}`)}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', fontSize:11, fontWeight:600, color:'#374151' }}>
            <Download size={11} strokeWidth={1.8}/> CSV 내보내기
          </button>
        </div>
        <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #F1F5F9' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'#F8FAFC' }}>
                {[{k:'title',l:'회의명'},{k:'room_id',l:'회의실'},{k:'start_at',l:'날짜'},{k:'start_at',l:'시간'},{k:'user',l:'예약자'},{k:'',l:'상태'}].map((h,i) => (
                  <th key={i} onClick={() => { if(h.k){ setSortKey(h.k); setSortAsc(s => sortKey===h.k?!s:false) } }}
                    style={{ padding:'8px 12px', textAlign:'left', fontSize:10, fontWeight:600, color:'#94A3B8', whiteSpace:'nowrap', borderBottom:'1px solid #F1F5F9', cursor:h.k?'pointer':'default' }}>
                    {h.l}{h.k && <ArrowUpDown size={9} strokeWidth={1.8}/>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map(b => {
                const r = rooms.find(rm => rm.room_id === b.room_id)
                const status = b.status==='pending'?{l:'승인대기',c:'#D97706',bg:'#FEF3C7'}:b.autoCancelled&&!b.checkedIn&&!b.earlyEnded?{l:'노쇼',c:'#DC2626',bg:'#FEF2F2'}:b.autoCancelled?{l:'취소',c:'#94A3B8',bg:'#F1F5F9'}:b.checkedIn||b.earlyEnded?{l:'완료',c:'#16A34A',bg:'#DCFCE7'}:{l:'예정',c:'#3B82F6',bg:'#EFF6FF'}
                // ← [2026-04-24 P6-B] 예약자 이름 live (profiles.name 우선, snapshot fallback)
                const owner = (users as any[]).find(u => u.user_id === b.user_id)
                const displayName = owner?.name ?? b.user ?? '?'
                return (
                  <tr key={b.id}
                    onClick={() => { onDetail?.(b) }}
                    style={{ borderBottom:'1px solid #F8FAFC', cursor: onDetail ? 'pointer' : 'default' }}
                    onMouseEnter={e => e.currentTarget.style.background = onDetail ? '#F0F4FF' : '#FAFBFD'}
                    onMouseLeave={e => { e.currentTarget.style.background='transparent' }}>
                    <td style={{ padding:'8px 12px', fontWeight:600, color:'#111', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b.title}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{r?.room_name??''}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{fmtTSDateFull(b.start_at)}</td>
                    <td style={{ padding:'8px 12px', color:'#64748B', whiteSpace:'nowrap' }}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                    <td style={{ padding:'8px 12px', whiteSpace:'nowrap' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:500, flexShrink:0, background:'#F1EFE8', color:'#444441' }}>{(displayName ?? '?')[0]}</div>
                        <span style={{ fontSize:12, fontWeight:500, color:'#111' }}>{displayName}</span>
                      </div>
                    </td>
                    <td style={{ padding:'8px 12px' }}><span style={{ background:status.bg, color:status.c, fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:999 }}>{status.l}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div style={{ display:'flex', justifyContent:'center', gap:4, paddingTop:12 }}>
            <button className="btn" disabled={page===1} onClick={() => setPage(p=>p-1)} style={{ padding:'5px 10px', fontSize:11, borderRadius:7, background:'#F1F5F9', color:page===1?'#CBD5E1':'#64748B' }}>‹</button>
            {Array.from({length:Math.min(pages,7)},(_,i)=>{const p=pages<=7?i+1:page<=4?i+1:page>=pages-3?pages-6+i:page-3+i
              return <button key={p} className="btn" onClick={() => setPage(p)} style={{ padding:'5px 9px', fontSize:11, borderRadius:7, minWidth:28, background:page===p?'#111':'#F8FAFC', color:page===p?'#fff':'#64748B', fontWeight:page===p?700:400 }}>{p}</button>})}
            <button className="btn" disabled={page===pages} onClick={() => setPage(p=>p+1)} style={{ padding:'5px 10px', fontSize:11, borderRadius:7, background:'#F1F5F9', color:page===pages?'#CBD5E1':'#64748B' }}>›</button>
          </div>
        )}
      </>
    )
  }

  const renderTable = () => {
    if (loading) return <div style={{ textAlign:'center', padding:40, color:'#94A3B8', fontSize:13 }}><RefreshCw size={20} strokeWidth={1.8}/> 불러오는 중...</div>

    // drill-down 활성화 시 → 예약 목록 표시
    if (drill) {
      const drillData = filtered.filter(drill.fn)
      return renderBookingList(drillData, drill.label)
    }

    // 집계 테이블 타입 (드릴다운 콜백 포함)
    if (type === 'rooms') return <AggTable rows={roomAgg}
      cols={[{k:'room_name',l:'회의실'},{k:'confirmed',l:'예약'},{k:'checkin',l:'체크인'},{k:'noshow',l:'노쇼'},{k:'noshow_rate',l:'노쇼율(%)',fmt:v=>`${v}%`}]}
      onExport={() => exportCSV(roomAgg.map(r=>({회의실:r.room_name,예약:r.confirmed,체크인:r.checkin,노쇼:r.noshow,'노쇼율(%)':r.noshow_rate})), `회의실별통계_${dateFrom}_${dateTo}`)}
      onRowClick={row => { const rm = rooms.find(r=>r.room_name===row.room_name); if(rm) { setDrill({ label:row.room_name, fn:(b)=>b.room_id===rm.room_id }); setPage(1) } }}/>

    if (type === 'dept') return <AggTable rows={deptAgg}
      cols={[{k:'dept',l:'부서'},{k:'confirmed',l:'예약'},{k:'noshow',l:'노쇼'}]}
      onExport={() => exportCSV(deptAgg.map(r=>({부서:r.dept,예약:r.confirmed,노쇼:r.noshow})), `부서별통계_${dateFrom}_${dateTo}`)}
      onRowClick={row => { setDrill({ label:row.dept, fn:(b)=>b.dept===row.dept }); setPage(1) }}/>

    if (type === 'hours') return <AggTable rows={hourAgg}
      cols={[{k:'hour',l:'시간대'},{k:'count',l:'예약 건수'}]}
      onExport={() => exportCSV(hourAgg.map(r=>({시간대:r.hour,예약건수:r.count})), `시간대별분포_${dateFrom}_${dateTo}`)}
      onRowClick={row => { const h = parseInt(row.hour); setDrill({ label:row.hour, fn:(b)=>Math.floor(tsMin(b.start_at)/60)===h }); setPage(1) }}/>

    if (type === 'users') return <AggTable rows={userAgg}
      cols={[{k:'name',l:'이름'},{k:'dept',l:'부서'},{k:'count',l:'예약'},{k:'noshow',l:'노쇼'}]}
      onExport={() => exportCSV(userAgg.map(r=>({이름:r.name,부서:r.dept,예약:r.count,노쇼:r.noshow})), `사용자별통계_${dateFrom}_${dateTo}`)}
      onRowClick={row => { setDrill({ label:row.name, fn:(b)=>b.user===row.name }); setPage(1) }}/>

    // bookings / noshow / pending → 개별 예약 목록
    return renderBookingList(filtered)
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
function AggTable({ rows, cols, onExport, onRowClick }: {
  rows: any[]
  cols: {k:string;l:string;fmt?:(v:any)=>string}[]
  onExport: () => void
  onRowClick?: (row: any) => void
}) {
  if (!rows.length) return <div style={{ textAlign:'center', padding:40, color:'#CBD5E1', fontSize:12 }}>데이터 없음</div>
  const canDrill = !!onRowClick
  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:12, color:'#64748B' }}>총 <b style={{ color:'#111' }}>{rows.length}</b>개
          {canDrill && <span style={{ marginLeft:8, fontSize:11, color:'#6366F1' }}>행 클릭 → 예약 목록</span>}
        </div>
        <button className="btn" onClick={onExport}
          style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, background:'#F8FAFC', border:'1px solid #E2E8F0', fontSize:11, fontWeight:600, color:'#374151' }}>
          <Download size={11} strokeWidth={1.8}/> CSV 내보내기
        </button>
      </div>
      <div style={{ overflowX:'auto', borderRadius:10, border:'1px solid #F1F5F9' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
          <thead><tr style={{ background:'#F8FAFC' }}>
            {cols.map(c => <th key={c.k} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:600, color:'#94A3B8', borderBottom:'1px solid #F1F5F9', whiteSpace:'nowrap' }}>{c.l}</th>)}
            {canDrill && <th style={{ width:24, borderBottom:'1px solid #F1F5F9' }}/>}
          </tr></thead>
          <tbody>{rows.map((r,i) => (
            <tr key={i}
              onClick={() => onRowClick?.(r)}
              style={{ borderBottom:'1px solid #F8FAFC', cursor: canDrill ? 'pointer' : 'default' }}
              onMouseEnter={e => { e.currentTarget.style.background = canDrill ? '#F5F5FF' : '#FAFBFD' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
              {cols.map(c => <td key={c.k} style={{ padding:'10px 14px', color:'#374151' }}>{c.fmt ? c.fmt(r[c.k]) : r[c.k]}</td>)}
              {canDrill && <td style={{ padding:'10px 14px', color:'#A5B4FC', fontSize:14 }}>›</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}


// ─── AdminView ─────────────────────────────────────────────────────────────────
// ← [2026-05-06 Admin Phase C] currentUserId/currentUserEmail 추가 — AdminApprovalTable 내 BookingStatusBadge 판정용
// ← [2026-05-06 사이드 sticky 핫픽스] headerHeight 추가 — 사이드 네비 fixed top 위치 계산용
export function AdminView({ bookings, setBookings, rooms, setRooms, users, setUsers, showToast, isMobile, isTablet, onApprove, onReject, onForceCancel, onDetail, currentUserId = '', currentUserEmail = '', headerHeight = 0 }) {
  const TABS = ['dashboard','bookings','approvals','rooms','users']
  const getTabFromHash = () => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('admin-booking-')) return 'approvals'  // 딥링크: 승인 관리 탭으로
    const t = hash.replace('admin-tab-','')
    return TABS.includes(t) ? t : 'dashboard'
  }
  const [activeTab, setActiveTab] = useState(getTabFromHash)
  const setTab = (t: string) => {
    setActiveTab(t)
    window.location.hash = `admin-tab-${t}`
  }

  // 딥링크 처리: #admin-booking-{id} 또는 sessionStorage(OAuth 후 복원) 로 진입 시 예약 모달 자동 오픈
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    // 해시에서 먼저 확인, 없으면 sessionStorage에서 복원
    const raw = hash.startsWith('admin-booking-')
      ? hash
      : (sessionStorage.getItem('cnr_deeplink') ?? '')
    if (!raw.startsWith('admin-booking-')) return
    const bookingId = raw.replace('admin-booking-', '')
    const target = bookings.find((b: any) => b.id === bookingId)
    if (target) {
      setActiveTab('approvals')
      onDetail(target)
      // 딥링크 소비 후 정리
      window.location.hash = 'admin-tab-approvals'
      sessionStorage.removeItem('cnr_deeplink')
    }
  }, [bookings])
  const PER_PAGE = 15
  // ← [2026-05-06 Admin Phase A] 가로 탭바 제거 — 좌측 사이드 네비 (AdminSideNav)로 이동
  //   기존: tabs 배열 + 가로 button 그룹 (lucide 아이콘 + 라벨)
  //   변경: AdminSideNav 컴포넌트가 5개 메뉴를 수직 표시 (Figma node 451:3522)
  //   영향: lucide BarChart2/Inbox/Calendar/Users/Building2 imports는 다른 곳에서도
  //         사용 중이라 일단 보존 (Phase B/C에서 정리)

  // 승인 대기 건수 — 사이드 네비 dot 표시용
  const pendingCount = useMemo(
    () => bookings.filter((b: any) => b.status === 'pending' && !b.autoCancelled).length,
    [bookings]
  )

  return (
    /* ═══════════════════════════════════════════════════════════════════
       ↓ Admin 외곽 wrapper — Figma node 451:3521 1:1
       · max-width 1400 (사이드 160 + gap 60 + 콘텐츠 1180)
       · 데스크톱: 사이드는 createPortal로 body에 fixed mount (sticky 우회)
       · 모바일: 사이드가 콘텐츠 위에 일반 흐름으로 표시
       ─────────────────────────────────────────────────────────────────
       [2026-05-06 사이드 sticky 핫픽스] sticky → fixed (createPortal 패턴)
       · 증상: 사이드 네비가 스크롤 시 같이 딸려 올라가는 문제
       · 근본 원인: html/body의 overflow-x:hidden이 sticky의 컨테이닝 블록을
                  가로채어 sticky 작동 안 함 (userMemories 명시 룰)
       · 해결: 헤더와 동일한 패턴 사용 — createPortal로 body 직접 mount + fixed
                · 부모 체인의 어떤 css(overflow/transform/filter 등)도 영향 0
                · top: headerHeight + 32 (헤더 아래 + 여유)
                · left: viewport 너비 기반 동적 계산 (1400 wrapper 좌측 padding과 정렬)
                · 콘텐츠 영역은 paddingLeft로 사이드 자리 확보 (244 = 24+160+60)
       ═══════════════════════════════════════════════════════════════════ */
    <>
      {/* ── 데스크톱: 사이드 네비를 body에 portal mount + fixed 위치 ──── */}
      {!isMobile && createPortal(
        <aside style={{
          position: 'fixed',
          top:      headerHeight + 32,                    // ← 헤더 높이 + 여유 32
          // viewport 1400 이상: (vw - 1400)/2 + 24 padding / 1400 미만: 24
          // → max((100vw - 1400px) / 2, 0px) + 24px (CSS calc + max)
          left:     'calc(max((100vw - 1400px) / 2, 0px) + 24px)',
          width:    160,                                   // ← Figma: 160
          zIndex:   50,                                    // ← 콘텐츠 위에 표시 (헤더 100보다 낮게)
        }}>
          <AdminSideNav
            activeTab={activeTab as AdminTabId}
            onTabChange={(id) => setTab(id)}
            pendingCount={pendingCount}
          />
        </aside>,
        document.body
      )}

      {/* ── 본문 wrapper ─────────────────────────────────────────────
          · 데스크톱: paddingLeft 244 = 24(좌) + 160(사이드) + 60(gap) — 사이드 자리 확보
          · 모바일: 일반 padding 12, 사이드는 콘텐츠 위 인라인 */}
      <div style={{
        maxWidth: 1400,
        margin:   '0 auto',
        padding:  isMobile ? '16px 12px' : '32px 24px 32px 244px',
      }}>
        {/* 모바일: 사이드 인라인 표시 (자연 흐름) */}
        {isMobile && (
          <div style={{ marginBottom: 16 }}>
            <AdminSideNav
              activeTab={activeTab as AdminTabId}
              onTabChange={(id) => setTab(id)}
              pendingCount={pendingCount}
            />
          </div>
        )}

        {/* ── 콘텐츠 영역 ──────────────────────────────────────────── */}
        <div style={{ minWidth: 0 /* ← overflow 안전장치 */ }}>
      {activeTab==='dashboard' && <AdminDashboard bookings={bookings} rooms={rooms} users={users} isMobile={isMobile} onDetail={onDetail}/>}
      {activeTab==='bookings'  && <AdminBookings  bookings={bookings} setBookings={setBookings} rooms={rooms} users={users} onForceCancel={onForceCancel} showToast={showToast} isMobile={isMobile} PER_PAGE={PER_PAGE} onDetail={onDetail}/>}{/* ← [2026-04-24 P6-B] users 추가 — 예약자 이름 live */}
      {/* ← [2026-05-06 Admin Phase C] AdminApprovals → AdminApprovalTable 교체
            · Phase B 공통 컴포넌트(DateRangeFilter / SegmentTabBar / DataTable) 사용
            · Figma node 451:3534 1:1 — 7개 컬럼 / 5개 탭 / 3개 퀵버튼 / 검색 활성화
            · 처리 컬럼 분기 — 승인대기=버튼 / 처리완료=처리자
            · 기존 AdminApprovals 데이터 로직(classify/loadBookingsByRange/canApprove) 그대로 보존
            · 기존 AdminApprovals 함수 자체는 보존 (혹시 다른 곳에서 import 시 안전) */}
      {activeTab==='approvals' && <AdminApprovalTable bookings={bookings} rooms={rooms} users={users} currentUserId={currentUserId} currentUserEmail={currentUserEmail} onApprove={onApprove} onReject={onReject} onDetail={onDetail} onCsvClick={() => showToast('CSV 다운로드 기능은 추후 구현 예정입니다.', 'info')}/>}
      {activeTab==='rooms'     && <AdminRooms     showToast={showToast} isMobile={isMobile}/>}
      {activeTab==='users'     && <AdminUsers     users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile}/>}
        </div>
      </div>
    </>
  )
}

// ─── 순수 SVG 차트 컴포넌트 ──────────────────────────────────────────────────

// ① AreaChart
function AreaChartSVG({ data }: { data:{label:string;count:number;isToday:boolean}[] }) {
  const [hov, setHov] = useState<number|null>(null)
  if (!data.length) return null
  const W=700, H=160, pl=28, pr=8, pt=12, pb=24
  const iW=W-pl-pr, iH=H-pt-pb
  const max=Math.max(...data.map(d=>d.count),1)
  const n=data.length
  const px=(i:number)=>pl+i*(iW/Math.max(n-1,1))
  const py=(v:number)=>pt+iH-(v/max*iH)
  const lineStr=data.map((d,i)=>`${px(i)},${py(d.count)}`).join(' ')
  const area=`M${px(0)},${py(data[0].count)}`+data.slice(1).map((d,i)=>`L${px(i+1)},${py(d.count)}`).join('')
    +` L${px(n-1)},${pt+iH} L${px(0)},${pt+iH} Z`
  const step=Math.max(1,Math.ceil(n/8))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:'block',overflow:'visible'}}>
      <defs>
        <linearGradient id="ag2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,.25,.5,.75,1].map((v,i)=><line key={i} x1={pl} y1={pt+iH*(1-v)} x2={W-pr} y2={pt+iH*(1-v)} stroke="#F1F5F9" strokeWidth="1"/>)}
      <path d={area} fill="url(#ag2)"/>
      <polyline points={lineStr} fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {data.map((d,i)=>(i%step===0||i===n-1)&&<text key={i} x={px(i)} y={H-4} textAnchor="middle" fontSize="10" fill="#94A3B8">{d.label}</text>)}
      {data.map((d,i)=>d.isToday&&<circle key={i} cx={px(i)} cy={py(d.count)} r="4" fill="#7C3AED" stroke="#fff" strokeWidth="2"/>)}
      {hov!==null&&(
        <>
          <line x1={px(hov)} y1={pt} x2={px(hov)} y2={pt+iH} stroke="#7C3AED" strokeWidth="1" strokeDasharray="4 2" opacity="0.5"/>
          <circle cx={px(hov)} cy={py(data[hov].count)} r="5" fill="#7C3AED" stroke="#fff" strokeWidth="2"/>
          <rect x={px(hov)-26} y={py(data[hov].count)-28} width={52} height={22} rx={5} fill="#1E1B4B"/>
          <text x={px(hov)} y={py(data[hov].count)-13} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="600">{data[hov].count}건</text>
        </>
      )}
      {data.map((_,i)=>(
        <rect key={i} x={px(i)-(iW/n)/2} y={pt} width={iW/n} height={iH} fill="transparent"
          onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}/>
      ))}
    </svg>
  )
}

// ② HourBar
function HourBarChart({ data }: { data:{hour:number;label:string;count:number}[] }) {
  const max=Math.max(...data.map(d=>d.count),1)
  const col=(v:number)=>v===max&&max>0?'#0E7490':v>max*.6?'#0891B2':v>max*.3?'#22D3EE':v>0?'#A5F3FC':'#F0FDFF'
  return (
    <div style={{display:'flex',alignItems:'flex-end',gap:3,height:200,paddingBottom:28,position:'relative'}}>
      {data.map((h,i)=>{
        const pct=h.count>0?Math.max(h.count/max*100,3):0
        return (
          <div key={i} title={`${h.label}: ${h.count}건`}
            style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'flex-end',height:'100%',gap:3,position:'relative'}}>
            {h.count===max&&max>0&&<span style={{fontSize:10,color:'#0E7490',fontWeight:700,marginBottom:1}}>{h.count}</span>}
            <div style={{width:'100%',background:col(h.count),borderRadius:'4px 4px 0 0',height:`${pct}%`,transition:'height .4s ease',minHeight:h.count>0?3:0}}/>
            <span style={{position:'absolute',bottom:0,fontSize:10,color:'#94A3B8',whiteSpace:'nowrap'}}>{h.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ③ DonutChart
function DonutSVG({ data, colors }: { data:{name:string;value:number}[]; colors:string[] }) {
  const total=data.reduce((s,d)=>s+d.value,0)
  if(!total) return null
  const cx=70,cy=70,or=62,ir=42
  let angle=-Math.PI/2
  const slices=data.map((d,i)=>{
    const sw=(d.value/total)*Math.PI*2
    const x1=cx+or*Math.cos(angle),y1=cy+or*Math.sin(angle)
    const x2=cx+or*Math.cos(angle+sw),y2=cy+or*Math.sin(angle+sw)
    const xi1=cx+ir*Math.cos(angle),yi1=cy+ir*Math.sin(angle)
    const xi2=cx+ir*Math.cos(angle+sw),yi2=cy+ir*Math.sin(angle+sw)
    const p=`M${xi1},${yi1} A${or},${or} 0 ${sw>Math.PI?1:0} 1 ${x2},${y2} L${xi2},${yi2} A${ir},${ir} 0 ${sw>Math.PI?1:0} 0 ${xi1},${yi1} Z`
    angle+=sw
    return {...d,path:p,color:colors[i%colors.length]}
  })
  return (
    <div style={{display:'flex',alignItems:'center',gap:16}}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{flexShrink:0}}>
        {slices.map((s,i)=>(
          <path key={i} d={s.path} fill={s.color} opacity="0.92" strokeWidth="1.5" stroke="#fff">
            <title>{s.name}: {s.value}건</title>
          </path>
        ))}
      </svg>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:7}}>
        {slices.map((s,i)=>(
          <div key={i} style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:8,height:8,borderRadius:2,background:s.color,flexShrink:0,display:'inline-block'}}/>
            <span style={{fontSize:11,color:'#374151',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
            <span style={{fontSize:11,fontWeight:600,color:'#111',flexShrink:0}}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ④ Treemap (자체 레이아웃 알고리즘)
const TREE_COLORS = ['#1E1B4B','#3730A3','#4F46E5','#7C3AED','#9333EA','#A855F7','#C084FC','#DDD6FE','#EDE9FE']
interface TmItem { name:string; size:number; noshow:number; idx:number }
interface TmRect extends TmItem { x:number; y:number; w:number; h:number }

function tmLayout(items:TmItem[], x:number, y:number, w:number, h:number, total:number): TmRect[] {
  if(!items.length) return []
  if(items.length===1) return [{...items[0],x,y,w,h}]
  let sum=0; let split=1; const half=total/2
  for(let i=0;i<items.length;i++){ sum+=items[i].size; if(sum>=half){ split=i+1; break } }
  split=Math.max(1,Math.min(split,items.length-1))
  const a=items.slice(0,split), b=items.slice(split)
  const aSum=a.reduce((s,i)=>s+i.size,0), bSum=b.reduce((s,i)=>s+i.size,0)
  if(w>=h){
    const aw=w*aSum/total
    return [...tmLayout(a,x,y,aw,h,aSum),...tmLayout(b,x+aw,y,w-aw,h,bSum)]
  } else {
    const ah=h*aSum/total
    return [...tmLayout(a,x,y,w,ah,aSum),...tmLayout(b,x,y+ah,w,h-ah,bSum)]
  }
}

function TreemapSVG({ data, colors }: { data:{name:string;size:number;noshow:number}[]; colors:string[] }) {
  const W=500, H=260, GAP=2
  const sorted=data.filter(d=>d.size>0).map((d,i)=>({...d,idx:i})).sort((a,b)=>b.size-a.size)
  const total=sorted.reduce((s,d)=>s+d.size,0)
  if(!total) return <div style={{textAlign:'center',padding:'32px 0',color:'#CBD5E1',fontSize:12}}>예약 없음</div>
  const rects=tmLayout(sorted,0,0,W,H,total)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{display:'block'}}>
      {rects.map((r,i)=>{
        const fill=colors[Math.min(r.idx,colors.length-1)]
        const light=r.idx>=6
        const tc=light?'rgba(30,27,75,0.9)':'rgba(255,255,255,0.95)'
        const sc=light?'rgba(30,27,75,0.5)':'rgba(255,255,255,0.6)'
        const rx=r.x+GAP/2, ry=r.y+GAP/2, rw=r.w-GAP, rh=r.h-GAP
        if(rw<4||rh<4) return null
        const showName=rw>52&&rh>26
        const showCount=rw>44&&rh>46
        const lx=rx+10, ly=showCount?ry+rh/2-6:ry+rh/2+5
        const maxCh=Math.floor((rw-16)/7)
        const label=r.name?r.name.length>maxCh?r.name.slice(0,maxCh-1)+'…':r.name:''
        return (
          <g key={i}>
            <rect x={rx} y={ry} width={rw} height={rh} fill={fill} rx={4}/>
            <rect x={rx} y={ry} width={rw} height={rh} fill="transparent" rx={4} stroke="#fff" strokeWidth={GAP}/>
            {showName&&<text x={lx} y={ly} fill={tc} fontSize="12" fontWeight="600"
              fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" dominantBaseline="central">{label}</text>}
            {showCount&&<text x={lx} y={ry+rh/2+13} fill={sc} fontSize="11"
              fontFamily="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" dominantBaseline="central">
              {r.size}건{r.noshow>0?` · 노쇼 ${r.noshow}`:''}
            </text>}
            <title>{r.name}: {r.size}건{r.noshow>0?` (노쇼 ${r.noshow})`:''}</title>
          </g>
        )
      })}
    </svg>
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

// ─── [2026-05-11 Phase 3] Dashboard 카드 컴포넌트 ───────────────────────────
//   · Figma node 489:393 1:1 — 위젯 ① 승인 대기 + 7개 위젯 placeholder
//   · 각 카드 공통 스타일: bg #fff / radius 24 / padding pt12 px16 pb16
//   · 위젯 ②~⑧은 Phase 4~10에서 PlaceholderCard 자리에 진짜 구현 컴포넌트로 교체

// ─── 위젯 ① 승인 대기 (Figma node 489:406) ──────────────────────────────────
//   사용처: Row 1 Col 1 (356×268, 3-col grid)
//   데이터: pendingCount (props로 전달)
//   동작: 정적 카드 (클릭 액션 없음 — Q5 결정: DetailDrawer 제거)
function ApprovalPendingCard({ count }: { count: number }) {
  return (
    <div style={{
      // ── Figma outer 1:1 ───────────────────────────────
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',      // ← Figma: pt 12 / px 16 / pb 16
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          4,                            // ← Figma: gap 4 (title block ↔ number)
      height:       268,                          // ← Figma: 카드 높이 명시
      width:        '100%',                       // ← grid cell 폭 채움 (3-col)
      // Figma는 box-shadow 없음
    }}>
      {/* ── 타이틀 블록 (gap 2) ───────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 500,                        // ← Figma: Medium
          fontSize:   16,                         // ← Figma: 16
          lineHeight: 1.4,                        // ← Figma: 1.4
          color:      '#111',                     // ← Figma: #111
          margin:     0,
          whiteSpace: 'nowrap',
          overflow:   'hidden',
          textOverflow: 'ellipsis',
        }}>승인 대기</p>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 400,                        // ← Figma: Regular
          fontSize:   12,                         // ← Figma: 12
          lineHeight: 1.5,                        // ← Figma: 1.5
          color:      '#AEB5C4',                  // ← Figma: #AEB5C4
          margin:     0,
        }}>즉시 처리 필요</p>
      </div>

      {/* ── 숫자 블록 ──────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', width:'100%' }}>
        <p style={{
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 400,                        // ← Figma: Regular
          fontSize:   38,                         // ← Figma: 38
          lineHeight: 1.5,                        // ← Figma: 1.5
          color:      '#111',                     // ← Figma: #111
          margin:     0,
        }}>{count}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//   [2026-05-11 Phase 4] 카드별 날짜 필터 인프라 + 위젯 ② 노쇼 현황
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Booking range fetch cache (dedupe) ─────────────────────────────────────
//   목적: 6개 위젯이 동시에 같은 default 30일 range로 fetch 호출 → 1번만 실제 fetch
//   동작: module-level Map에 in-flight Promise 저장, 동일 key 요청은 같은 Promise 반환
//   만료: 60초 후 자동 제거 (stale 방지)
//   주의: 이후 위젯 데이터 mutation 발생 시 invalidate 필요 — 현재는 read-only 대시보드라 안전
const bookingRangeCache = new Map<string, Promise<Booking[]>>()
function fetchBookingsRangeCached(from: string, to: string): Promise<Booking[]> {
  const key = `${from}|${to}`
  const existing = bookingRangeCache.get(key)
  if (existing) return existing
  const promise = loadBookingsByRange(from, to)
  bookingRangeCache.set(key, promise)
  // 60초 후 자동 만료 (동일 range 추가 fetch 시 fresh data)
  setTimeout(() => bookingRangeCache.delete(key), 60_000)
  return promise
}

// ─── useBookingsByRange — 위젯 공통 date filter + fetch hook ───────────────
//   사용: 각 위젯이 자체 dateFrom/dateTo state를 보유, 이 hook으로 데이터 + loading 받음
//   dedupe: 동일 (from,to) 요청은 fetchBookingsRangeCached에서 자동 dedupe
function useBookingsByRange(dateFrom: string, dateTo: string) {
  const [data,    setData]    = useState<Booking[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchBookingsRangeCached(dateFrom, dateTo)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => console.error('[useBookingsByRange] fetch failed', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dateFrom, dateTo])

  return { data, loading }
}

// ─── SmallDateTrigger — 카드 헤더용 inline 날짜 picker trigger ──────────────
//   Figma 1:1: 단순 텍스트만 표시 (예: "2026-04-11"), 클릭 시 DatePickerPopup 띄움
//   DateDisplay는 h 48이라 카드 헤더에 너무 큼 → 텍스트만 있는 작은 버전 별도
//   재사용: Phase 5-10 다른 위젯들도 동일 패턴 사용 예정
interface SmallDateTriggerProps {
  value:    string                                    // ← YYYY-MM-DD
  onChange: (newDate: string) => void
  min?:     string
  max?:     string
}
function SmallDateTrigger({ value, onChange, min, max }: SmallDateTriggerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          // ── Figma: 텍스트만 표시, button reset ──
          background: 'transparent',
          border:     'none',
          padding:    0,
          margin:     0,
          cursor:     'pointer',
          // ── Figma: Pretendard Regular 12 / lh 1.5 / #AEB5C4 ──
          fontFamily: "'Pretendard', -apple-system, sans-serif",
          fontWeight: 400,
          fontSize:   12,
          lineHeight: 1.5,
          color:      '#AEB5C4',
          // hover 시 살짝 진한 색 (인터랙션 가능 명시)
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#697077'}
        onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#AEB5C4'}>
        {value}
      </button>
      {open && (
        <DatePickerPopup
          value={value}
          onChange={d => { onChange(d); setOpen(false) }}
          onClose={() => setOpen(false)}
          anchorRef={triggerRef}
          min={min}
          max={max}
        />
      )}
    </>
  )
}

// ─── 위젯 ② 노쇼 현황 (Figma node 490:704) ──────────────────────────────────
//   사용처: Row 1 Col 2 (356×268, 3-col grid)
//   데이터: 외곽 봉(총예약 100%) + 내부 봉(노쇼/총예약 비율) 이중 구조
//   동작: 자체 dateFrom/dateTo + useBookingsByRange + 봉 hover/click 시 툴팁
//   ※ Figma 1:1 사양 (gap 48 헤더↔차트, 외곽/내부 봉 gradient, StatusBadge 툴팁)
//   ※ [Phase 4 v3] 라벨 표시: peak 자동 → 인터랙티브 툴팁 (사용자 의도)
function NoshowChartCard() {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (dedupe cache 통해) ────────────────────────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 일자별 stats (총예약 + 노쇼 + 비율) ──────────────────────────
  //   ← [2026-05-11 Phase 4 v5] total = 그 날 등록된 모든 예약 (사용자 정정)
  //      · 사유: 사용자/관리자/시스템 취소 등 status 무관 — "등록된 모든 예약"이 분모
  //      · 노쇼 ⊆ total (그 날 booking) 보장 → rate ∈ [0, 1] 안전
  //      · 이전 v4 (옵션 A: confirmed + system cancelled): 일부 케이스 여전히 100% → 폐기
  //   isNoshow는 Phase 2 SSOT 그대로 (status='confirmed' + cancelledBy='system' + !checkedIn)
  const dailyStats = useMemo(() => {
    const diffDays = Math.round(
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
    ) + 1
    if (diffDays <= 0 || diffDays > 365) return []   // ← 가드: 비정상 range 차단
    return Array.from({ length: diffDays }, (_, i) => {
      const date        = addDaysStr(dateFrom, i)
      const dayBookings = bookings.filter(b => tsDate(b.start_at) === date)
      const total       = dayBookings.length                  // ← 그 날의 모든 booking row
      const noshow      = dayBookings.filter(isNoshow).length // ← Phase 2 SSOT
      const rate        = total > 0 ? noshow / total : 0      // ← 0~1 (안전)
      return { date, total, noshow, rate }
    })
  }, [bookings, dateFrom, dateTo])

  // ── 4. 활성 봉(hover/click) 상태 ─────────────────────────────────────
  //   ← [2026-05-11 Phase 4 v3] peak 자동 표시 → hover/click 툴팁으로 변경
  //   · 사용자 의도: 평소엔 라벨 없음, 사용자 인터랙션 시에만 그 봉 위에 표시
  //   · activeDate가 set된 봉에만 라벨 렌더링 (각 봉별 그 날 노쇼 건수)
  //   · 데스크탑: bar onMouseEnter → set, container onMouseLeave → null
  //   · 모바일/터치: bar onClick → toggle (같은 봉 재클릭 시 해제)
  const [activeDate, setActiveDate] = useState<string | null>(null)

  // ── 활성 봉의 라벨 내용 ("5월 7일 5건") ──────────────────────────────
  //   activeDate 없거나 dailyStats에 없으면 null → 라벨 안 그림
  const activeLabel = useMemo(() => {
    if (!activeDate) return null
    const active = dailyStats.find(d => d.date === activeDate)
    if (!active) return null
    const dt = new Date(active.date)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일 ${active.noshow}건`
  }, [activeDate, dailyStats])

  // ── Date 라벨 (차트 아래) — dateFrom 표시 ─────────────────────────────
  const dateLabel = useMemo(() => {
    const dt = new Date(dateFrom)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일`
  }, [dateFrom])

  // ── 차트 영역 높이 상수 (Figma) ───────────────────────────────────────
  const CHART_HEIGHT = 111

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          48,                              // ← Figma: gap 48 (헤더 ↔ 차트)
      height:       268,
      width:        '100%',
      // ← Peak label이 차트 위로 absolute 위치하므로 overflow visible 필요 없음
      //   (gap 48 안에서 자연스럽게 들어감)
    }}>
      {/* ── 헤더 (gap 2) ────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>노쇼 현황</p>
        {/* ── 날짜 범위 (SmallDateTrigger × 2 + ⎯) — Figma 1:1 ── */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>⎯</span>
          <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
        </div>
      </div>

      {/* ── 차트 영역 (flex column gap 6) ────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', gap:6, width:'100%', position:'relative' }}>
        {/* ── Bar 컨테이너 (h 111, flex row gap 4, items-end) ── */}
        {/*    ← [Phase 4 v3] onMouseLeave로 컨테이너 벗어나면 라벨 해제 (hover 추적) */}
        <div
          onMouseLeave={() => setActiveDate(null)}
          style={{
            display:    'flex',
            alignItems: 'flex-end',
            gap:        4,                              // ← Figma: gap 4 (bar 간격)
            height:     CHART_HEIGHT,
            width:      '100%',
            position:   'relative',
          }}>
          {dailyStats.length === 0 ? (
            <div style={{ flex:1, height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
              {loading ? '로딩 중…' : '데이터 없음'}
            </div>
          ) : (
            dailyStats.map(d => {
              const isActive = d.date === activeDate     // ← [Phase 4 v3] peak → activeDate
              // ── 외곽 봉 + 내부 봉 이중 구조 (사용자 설명 1:1) ──
              //   · 외곽: 총예약 100% 기준 → 모두 동일 111px (Q1)
              //   · 내부: 111 × 노쇼율 만큼 하단 채움 (Q3)
              const innerH = CHART_HEIGHT * d.rate       // ← 0~111 (rate는 0~1 보장)
              return (
                <div
                  key={d.date}
                  // ── [Phase 4 v3] 인터랙티브 툴팁 이벤트 ──
                  //   · 데스크탑: hover로 즉시 표시 (mouseEnter)
                  //   · 모바일/터치: 탭으로 toggle (같은 봉 재탭 시 해제)
                  onMouseEnter={() => setActiveDate(d.date)}
                  onClick={() => setActiveDate(prev => prev === d.date ? null : d.date)}
                  style={{
                    flex:     1,
                    height:   CHART_HEIGHT,
                    position: 'relative',
                    minWidth: 0,                         // ← grid overflow 안전장치
                    cursor:   'pointer',                 // ← 인터랙션 가능 명시
                  }}>
                  {/* ── 외곽 봉 (희미, 총예약 100% 기준) ── */}
                  <div style={{
                    position:     'absolute',
                    inset:        0,
                    borderRadius: 24,
                    background:   'linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)',
                  }}/>
                  {/* ── 내부 봉 (진함, 노쇼/총예약 비율) ── */}
                  {innerH > 0 && (
                    <div style={{
                      position:     'absolute',
                      bottom:       0,
                      left:         0,
                      right:        0,
                      height:       innerH,
                      borderRadius: 24,
                      background:   'linear-gradient(to bottom, #000 0%, #7E7F80 100%)',
                      transition:   'height 0.4s ease',
                    }}/>
                  )}
                  {/* ── 툴팁 라벨 (활성 봉에만 표시) ── */}
                  {/*   Figma StatusBadge-XS 사양 (bg rgba(255,255,255,0.9), border 1px #000) */}
                  {isActive && activeLabel && (
                    <div style={{
                      position:     'absolute',
                      // 내부 봉 top 위쪽 6px (rate=0이면 봉 바닥 = 차트 바닥 위)
                      bottom:       innerH + 6,
                      left:         '50%',
                      transform:    'translateX(-50%)',
                      background:   'rgba(255,255,255,0.9)',
                      border:       '1px solid #000',
                      borderRadius: 24,
                      padding:      '2px 8px',
                      display:      'flex',
                      gap:          10,
                      alignItems:   'center',
                      justifyContent:'center',
                      fontFamily:   "'Pretendard', -apple-system, sans-serif",
                      fontWeight:   400,
                      fontSize:     10,
                      lineHeight:   1.5,
                      letterSpacing:'0.1px',
                      color:        '#1E1E1E',
                      whiteSpace:   'nowrap',
                      pointerEvents:'none',              // ← 라벨이 hover/click 방해 X
                      zIndex:       1,                   // ← 인접 봉 위에 표시
                    }}>
                      {activeLabel}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* ── Date 라벨 (차트 아래) ──────────────────────────── */}
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:400, fontSize:10, lineHeight:1.5, color:'#AEB5C4', margin:0,
          whiteSpace:'nowrap',
        }}>{dateLabel}</p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ③ 최근 생성된 예약 (Figma node 551:3458) ──────────────────────────
//   사용처: Row 1 Col 3 (356×268, 3-col grid)
//   데이터: bookings prop top 5 sorted by createdAt desc (옵션 A — 자체 fetch 안 함)
//   동작: row 클릭 → onDetail(booking) → BookingModal 열기
//   ※ Figma 1:1 사양: 헤더(타이틀만, 날짜 범위 없음) + 5 rows (각 h 34)
function RecentBookingsCard({
  bookings,
  users,
  rooms,
  onDetail,
}: {
  bookings: Booking[]
  users:    AppUser[]
  rooms:    Room[]
  onDetail?: (b: Booking) => void
}) {
  // ── 데이터: createdAt desc top 5 (옵션 A — bookings prop 사용) ────────
  //   · createdAt이 number(timestamp) → desc 정렬 = 최신순
  //   · createdAt 없는 row는 안전 제외 (legacy data 방어)
  const recent = useMemo(() => {
    return [...bookings]
      .filter(b => b.createdAt != null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
  }, [bookings])

  return (
    <div style={{
      // ── Figma outer 1:1 (위젯 ①과 동일 카드 스타일) ──
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          48,                              // ← Figma: 헤더(22h) ↔ 리스트(82y) = 82-12-22=48
      height:       268,
      width:        '100%',
    }}>
      {/* ── 헤더 (타이틀만, 날짜 범위 없음 — Figma) ── */}
      <div style={{ width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>최근 생성된 예약</p>
      </div>

      {/* ── 리스트 (5 rows, 각 h 34, 인접 row 사이 border #FAFBFF) ── */}
      <div style={{
        display:      'flex',
        flexDirection:'column',
        width:        '100%',
      }}>
        {recent.length === 0 ? (
          <div style={{
            padding:'24px 0', textAlign:'center', fontSize:11, color:'#CBD5E1',
          }}>예약 없음</div>
        ) : (
          recent.map((b, i) => {
            // user lookup (UUID 기반, fallback to snapshot)
            const user = users.find(u => u.user_id === b.user_id)
            const ownerName   = user?.name ?? b.user ?? '—'
            const ownerAvatar = user?.avatar_url ?? null
            // room lookup
            const room        = rooms.find(r => r.room_id === b.room_id)
            const roomName    = room?.room_name ?? '—'
            return (
              <div
                key={b.id}
                onClick={() => onDetail?.(b)}
                style={{
                  // ── Figma row 1:1 ─────────────────────────────────────
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  padding:        '8px 0',           // ← Figma: py 8 (row h 34 = 18 + 8*2)
                  // ── Figma: border-top + border-bottom #FAFBFF (인접 row 자연스러운 구분) ──
                  borderTop:      i === 0 ? '1px solid #FAFBFF' : 'none',  // ← 첫 row만 top 보임
                  borderBottom:   '1px solid #FAFBFF',
                  cursor:         onDetail ? 'pointer' : 'default',
                  transition:     'background 0.12s',
                }}
                onMouseEnter={e => { if (onDetail) (e.currentTarget as HTMLElement).style.background = '#FAFBFD' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                {/* ── 제목 (w 120) ── */}
                <div style={{ display:'flex', alignItems:'center', flexShrink:0, width:120 }}>
                  <p style={{
                    fontFamily:"'Pretendard', -apple-system, sans-serif",
                    fontWeight:400, fontSize:12, lineHeight:1.5, color:'#000', margin:0,
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                  }}>{b.title || '—'}</p>
                </div>
                {/* ── 회의실 (w 120) ── */}
                <div style={{ display:'flex', alignItems:'center', flexShrink:0, width:120 }}>
                  <p style={{
                    fontFamily:"'Pretendard', -apple-system, sans-serif",
                    fontWeight:400, fontSize:10, lineHeight:1.5, color:'#000', margin:0,
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                  }}>{roomName}</p>
                </div>
                {/* ── 예약자 (avatar 16 + name) ── */}
                <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                  <UserAvatar
                    name={ownerName}
                    avatarUrl={ownerAvatar}
                    size={16}
                    fontSize={9}                       // ← Figma: 이니셜 9 (Regular)
                    fontWeight={400}                   // ← Figma: Regular (이전 기본 500)
                  />
                  <span style={{
                    fontFamily:"'Pretendard', -apple-system, sans-serif",
                    fontWeight:400, fontSize:11, lineHeight:1.3, color:'#111',
                    whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    maxWidth:60,
                  }}>{ownerName}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ④ 예약 많은 회의실 (Figma node 551:3513) ──────────────────────────
//   사용처: Row 2 Col 1 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + rooms prop
//   동작: 9 회의실 모두 표시, count desc 정렬, count 0도 마지막에 표시 (Q2)
//   ※ Figma 1:1: 9-row 점진적 height + 점진적 색상 그라데이션 (rank 시각화)

// ─── ROOM_RANKING_STYLES — Figma 1:1 색상/높이 매핑 ──────────────────────
//   rank 0 = 1위 (가장 어두운 #393939) → rank 8 = 9위 (가장 밝은 #F4F4F4)
//   text color: rank 0-4 = white, rank 5-8 = #111 (어두운 텍스트)
//   total list height = 52 + 46*3 + 29*5 + 8*2 (gap) = 351 (Figma 1:1)
const ROOM_RANKING_STYLES: { h: number; bg: string; color: string }[] = [
  { h: 52, bg: '#393939', color: '#fff'  },   // rank 0 (1위) — 가장 진함
  { h: 46, bg: '#525252', color: '#fff'  },
  { h: 46, bg: '#6F6F6F', color: '#fff'  },
  { h: 46, bg: '#8D8D8D', color: '#fff'  },
  { h: 29, bg: '#A8A8A8', color: '#fff'  },   // 마지막 white text
  { h: 29, bg: '#C6C6C6', color: '#111'  },   // 5위부터 #111 텍스트
  { h: 29, bg: '#E0E0E0', color: '#111'  },
  { h: 29, bg: '#F4F4F4', color: '#111'  },
  { h: 29, bg: '#F4F4F4', color: '#111'  },   // rank 8 (9위) — 가장 밝음
]

function RoomRankingCard({ rooms }: { rooms: Room[] }) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (Phase 4 cache 재사용, 위젯 ②와 dedupe) ────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 회의실별 카운트 + desc 정렬 (Q1: 모든 booking, Q2: 9개 모두) ──
  const roomStats = useMemo(() => {
    return [...rooms]
      .map(r => ({
        room:  r,
        count: bookings.filter(b => b.room_id === r.room_id).length,  // Q1: 그 날짜 범위 모든 booking
      }))
      .sort((a, b) => b.count - a.count)                              // Q2: count desc, 0도 마지막에 표시
  }, [bookings, rooms])

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',                // ← Figma: 헤더↔리스트 양 끝 분배 (no gap)
      height:        504,
      width:         '100%',
    }}>
      {/* ── 헤더 (gap 2) ────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>예약 많은 회의실</p>
        {/* ── 날짜 범위 picker (SmallDateTrigger × 2 + ⎯) — Q3: 위젯 ②와 동일 ── */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>⎯</span>
          <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
        </div>
      </div>

      {/* ── 리스트 (9 rows, gap 2, 점진적 height/색상) ────── */}
      <div style={{
        display:      'flex',
        flexDirection:'column',
        gap:          2,                              // ← Figma: gap 2 (row 사이)
        width:        '100%',
      }}>
        {roomStats.length === 0 ? (
          <div style={{ padding:'40px 0', textAlign:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '회의실 데이터 없음'}
          </div>
        ) : (
          roomStats.slice(0, ROOM_RANKING_STYLES.length).map((s, i) => {
            const style = ROOM_RANKING_STYLES[i]
            return (
              <div
                key={s.room.room_id}
                style={{
                  // ── Figma row 1:1 ─────────────────────────────────────
                  background:     style.bg,
                  color:          style.color,
                  height:         style.h,
                  display:        'flex',
                  alignItems:     'flex-start',          // ← Figma: items-start (텍스트 상단 정렬)
                  justifyContent: 'space-between',
                  padding:        '8px 12px',            // ← Figma: px 12 py 8
                  borderRadius:   1,                     // ← Figma: radius 1 (거의 직각)
                  // ── Figma 텍스트: Regular 10 / lh 1.25 / tracking 0.1 ──
                  fontFamily:     "'Pretendard', -apple-system, sans-serif",
                  fontWeight:     400,
                  fontSize:       10,
                  lineHeight:     1.25,
                  letterSpacing:  '0.1px',
                }}>
                <span style={{
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                  flexShrink:1, minWidth:0, paddingRight:8,
                }}>{s.room.room_name}</span>
                <span style={{ flexShrink:0 }}>{s.count}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑤ 회의실 노쇼 현황 (Figma node 551:3548) ──────────────────────────
//   사용처: Row 2 Col 2 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + isNoshow SSOT
//   동작: 9 회의실 모두 차트 + Top 5 ranked list + bar hover/click 시 label
//   ※ Figma 1:1: 3-section (헤더 + 세로 bar 차트 + ranked list)
function RoomNoshowCard({ rooms }: { rooms: Room[] }) {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④와 dedupe) ────────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 회의실별 노쇼 카운트 + desc 정렬 (Q1, Q2: 9개 모두) ──────────
  const roomNoshow = useMemo(() => {
    return [...rooms]
      .map(r => ({
        room:   r,
        noshow: bookings.filter(b => b.room_id === r.room_id && isNoshow(b)).length,
      }))
      .sort((a, b) => b.noshow - a.noshow)                         // Q1: noshow desc
  }, [bookings, rooms])

  // ── 4. 차트 max 값 (bar height 비례 계산) ──────────────────────────
  //   maxNoshow=0이면 모든 bar 내부 미표시 (외곽만 보임)
  const maxNoshow = useMemo(
    () => roomNoshow.reduce((m, s) => Math.max(m, s.noshow), 0),
    [roomNoshow]
  )

  // ── 5. Top 5 ranked list (Q3: 항상 5, count 0이어도 채움) ──────────
  const top5 = useMemo(() => roomNoshow.slice(0, 5), [roomNoshow])

  // ── 6. 인터랙티브 hover/click state (Q4: 위젯 ② v3 패턴) ───────────
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null)
  const activeRoom = useMemo(
    () => roomNoshow.find(s => s.room.room_id === activeRoomId) ?? null,
    [activeRoomId, roomNoshow]
  )

  // ── 차트 상수 (Figma 사양) ──────────────────────────────────────────
  const CHART_HEIGHT     = 172    // ← Figma: 외곽 컨테이너 h
  const CHART_INNER_MAX  = 109    // ← Figma: 내부 bar max (Bar 1 = max noshow)

  return (
    <div style={{
      // ── Figma outer 1:1 ─────────────────────────────────────
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 24px 16px',           // ← Figma: pt12 px16 pb24 (위젯 ④의 pb16과 다름)
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'flex-start',
      justifyContent:'space-between',
      height:        504,
      width:         '100%',
    }}>
      {/* ── 헤더 (gap 2) ────────────────────────────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>회의실 노쇼 현황</p>
        {/* ── 날짜 범위 picker (위젯 ②④와 동일) ── */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>⎯</span>
          <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
        </div>
      </div>

      {/* ── 세로 bar 차트 (h 172, gap 2, 9 bars flex 1) ────── */}
      <div
        onMouseLeave={() => setActiveRoomId(null)}
        style={{
          display:    'flex',
          alignItems: 'flex-start',
          gap:        2,                                // ← Figma: gap 2 (bar 간격)
          height:     CHART_HEIGHT,
          width:      '100%',
          position:   'relative',
        }}>
        {roomNoshow.length === 0 ? (
          <div style={{ flex:1, height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '회의실 데이터 없음'}
          </div>
        ) : (
          roomNoshow.map(s => {
            const isActive = s.room.room_id === activeRoomId
            // ── 내부 bar height: 노쇼 비례, max 109px (Figma 사양) ──
            //   · maxNoshow=0이면 모든 bar 내부 h=0 → 외곽만 표시
            //   · noshow>0이면 최소 8px 보장 (가시성)
            const innerH = maxNoshow > 0 && s.noshow > 0
              ? Math.max(8, (s.noshow / maxNoshow) * CHART_INNER_MAX)
              : 0
            return (
              <div
                key={s.room.room_id}
                onMouseEnter={() => setActiveRoomId(s.room.room_id)}
                onClick={() => setActiveRoomId(prev => prev === s.room.room_id ? null : s.room.room_id)}
                style={{
                  flex:     1,
                  height:   CHART_HEIGHT,
                  position: 'relative',
                  // ── Figma: 외곽 bg #F6F7FA, items-end (bottom 정렬) ──
                  background:'#F6F7FA',
                  display:    'flex',
                  flexDirection:'column',
                  justifyContent:'flex-end',          // ← Figma: justify-end (내부 bar 하단 정렬)
                  alignItems:'stretch',
                  minWidth:0,                          // ← grid overflow 안전
                  cursor:   'pointer',
                }}>
                {/* ── 내부 bar (활성 시 진한 색상 — Q4) ── */}
                {innerH > 0 && (
                  <div style={{
                    width:'100%',
                    height: innerH,
                    // ── Figma rotate-180 + bg-gradient-to-b 시각 효과 = to top 사용 ──
                    //   · 기본: 위 #DDD(진함) → 아래 #F1F1F1(밝음)
                    //   · 활성: 위 #424242(더 진함) → 아래 #747474(밝음)
                    background: isActive
                      ? 'linear-gradient(to top, #747474 0.481%, #424242 58.173%)'
                      : 'linear-gradient(to top, #F1F1F1 0.481%, #DDD 58.173%)',
                    transition:'height 0.4s ease, background 0.15s ease',
                  }}/>
                )}
              </div>
            )
          })
        )}
        {/* ── 활성 bar에 label 표시 (Q4: 위젯 ② v3 패턴) ── */}
        {activeRoom && (() => {
          const idx       = roomNoshow.findIndex(s => s.room.room_id === activeRoom.room.room_id)
          if (idx < 0) return null
          const barCount  = roomNoshow.length
          // bar 폭: flex 1 균등분할 = (100% - gaps) / count
          const totalGap  = (barCount - 1) * 2
          const barW      = `calc((100% - ${totalGap}px) / ${barCount})`
          const innerH    = maxNoshow > 0 && activeRoom.noshow > 0
            ? Math.max(8, (activeRoom.noshow / maxNoshow) * CHART_INNER_MAX)
            : 0
          return (
            <div style={{
              position:    'absolute',
              // label 위치: bar 중앙 위쪽
              bottom:      innerH + 6,
              left:        `calc(${idx} * (${barW} + 2px) + ${barW} / 2)`,
              transform:   'translateX(-50%)',
              // ── Figma StatusBadge-XS 사양 (위젯 ② 동일) ──
              background:  'rgba(255,255,255,0.9)',
              border:      '1px solid #000',
              borderRadius:24,
              padding:     '2px 8px',
              display:     'flex',
              gap:         10,
              alignItems:  'center',
              fontFamily:  "'Pretendard', -apple-system, sans-serif",
              fontWeight:  400,
              fontSize:    10,
              lineHeight:  1.5,
              letterSpacing:'0.1px',
              color:       '#1E1E1E',
              whiteSpace:  'nowrap',
              pointerEvents:'none',
              zIndex:      1,
            }}>
              {activeRoom.room.room_name} {activeRoom.noshow}건
            </div>
          )
        })()}
      </div>

      {/* ── Top 5 ranked list (h 34 × 5 rows = 170) ────────── */}
      <div style={{
        display:'flex', flexDirection:'column', width:'100%',
      }}>
        {top5.map((s, i) => (
          <div key={s.room.room_id} style={{
            // ── Figma row 1:1: py 8, border-top + border-bottom #FAFBFF ──
            display:      'flex',
            alignItems:   'center',
            justifyContent:'space-between',
            padding:      '8px 0',
            borderTop:    i === 0 ? '1px solid #FAFBFF' : 'none',   // ← 첫 row만 top
            borderBottom: '1px solid #FAFBFF',
            width:        '100%',
          }}>
            {/* ── 좌측: rank circle + 회의실명 (gap 10) ── */}
            <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:1, minWidth:0, paddingRight:8 }}>
              {/* ── Rank circle (Figma: 16×16, border 1px #000, radius 999) ── */}
              <div style={{
                width:16, height:16,
                border:'1px solid #000',
                borderRadius:999,
                display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0,
              }}>
                <span style={{
                  fontFamily:"'Pretendard', -apple-system, sans-serif",
                  fontWeight:400, fontSize:8, lineHeight:1.5, color:'#000',
                }}>{i + 1}</span>
              </div>
              {/* ── 회의실명 ── */}
              <span style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif",
                fontWeight:400, fontSize:12, lineHeight:1.5, color:'#000',
                whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
              }}>{s.room?.room_name ?? '—'}</span>
            </div>
            {/* ── 우측: count ── */}
            <span style={{
              fontFamily:"'Pretendard', -apple-system, sans-serif",
              fontWeight:400, fontSize:12, lineHeight:1.5, color:'#000',
              flexShrink:0,
            }}>{s.room ? s.noshow : '—'}</span>
          </div>
        ))}
        {/* ── Q3: rooms.length < 5인 경우 placeholder row로 5개 채움 (count 0 표시) ── */}
        {Array.from({ length: Math.max(0, 5 - top5.length) }).map((_, i) => (
          <div key={`empty-${i}`} style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'8px 0',
            borderBottom:'1px solid #FAFBFF',
            width:'100%',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{
                width:16, height:16, border:'1px solid #CBD5E1', borderRadius:999,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <span style={{ fontSize:8, color:'#CBD5E1' }}>{top5.length + i + 1}</span>
              </div>
              <span style={{ fontSize:12, color:'#CBD5E1' }}>—</span>
            </div>
            <span style={{ fontSize:12, color:'#CBD5E1' }}>0</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑥ 예약추이 (Figma node 565:21848) — Mountain/Spline Area Chart ────
//   사용처: Row 3 Col 1 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange
//   동작: Catmull-Rom 스플라인 보간으로 부드러운 곡선 영역 차트 (Mountain Chart)
//   ※ Figma 1:1: SVG path + 그라데이션 fill (회색 진함 → 흰색 fade-out) + 외곽선
//   ※ 옛 BookingTrendsBarCard (이중 봉) 폐기 — 사용자 정정 (추세 표현이 본질)
//   ※ 결정사항 (사용자 확정):
//     · Q1 Catmull-Rom 곡선 (자연스러움, 표준 tension=1)
//     · Q2 Figma 1:1 그라데이션 (회색 진함 → 흰색 fade-out)
//     · Q3 영역 + 외곽선 (line stroke)
//     · Q4 Active 데이터 포인트 작은 원 (Figma 1:1, size 6)
//     · Q5 column별 hit area (위젯 ⑥ 패턴 - hover detection)

// ─── catmullRomPath — Catmull-Rom 스플라인을 SVG cubic Bezier path로 변환 ─
//   · Q1 결정: Catmull-Rom (peak sharp + 자연스러운 보간)
//   · tension=1: 표준 Catmull-Rom (Monotone은 단조성 강제로 작위적,
//     B-spline은 너무 부드러워 peak 손실)
//   · 알고리즘: N개 점 → N-1개 cubic Bezier segment 생성
//     각 segment의 control point는 인접한 4개 점 (P[i-1], P[i], P[i+1], P[i+2])로 계산
//   · 양 끝 점은 인접 점이 없으므로 자기 자신을 복제 (mirror)
function catmullRomPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`

  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]            // ← 첫 segment는 P[i] 복제 (mirror)
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? points[i + 1]        // ← 마지막은 P[i+1] 복제 (mirror)

    // Catmull-Rom → Cubic Bezier 변환 (tension=1 표준)
    //   CP1 = P[i]   + (P[i+1] - P[i-1]) / 6
    //   CP2 = P[i+1] - (P[i+2] - P[i])   / 6
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6

    path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }

  return path
}

// ─── linearPath — 직선 polyline SVG path (각진 mountain chart) ────────────
//   · 데이터 포인트를 직선으로 연결 (sharp peak, Catmull-Rom 곡선보다 각짐)
//   · 사용자 정정 2026-05-12: 곡선 → 직선 (각진 시각 효과)
//   · catmullRomPath와 동일한 input/output 시그니처 (drop-in 교체 가능)
function linearPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  let path = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x.toFixed(2)},${points[i].y.toFixed(2)}`
  }
  return path
}
// ─── BOOKING_TRENDS — Figma 1:1 차트 viewBox 사양 ───────────────────────
const TREND_VIEWBOX_W = 510       // ← Figma 565:21965: w 509 (510으로 단순화)
const TREND_VIEWBOX_H = 414       // ← Figma: 차트 영역 height
const TREND_PADDING_TOP = 22      // ← Figma: SVG path가 chart 상단 5.2%부터 시작 (peak 잘림 방지)
const TREND_MARKER_LINE_H = 40    // ← Figma 570:7429: 활성 marker 수직 연결선 h-[40px]

function BookingTrendsAreaCard() {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑦⑧와 dedupe) ──────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 일자별 count (모든 booking, 위젯 ②⑦⑧과 일관성) ──────────────
  const dayStats = useMemo(() => {
    const diffDays = Math.round(
      (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
    ) + 1
    if (diffDays <= 0 || diffDays > 365) return []
    return Array.from({ length: diffDays }, (_, i) => {
      const date  = addDaysStr(dateFrom, i)
      const count = bookings.filter(b => tsDate(b.start_at) === date).length
      return { date, count }
    })
  }, [bookings, dateFrom, dateTo])

  const maxCount = useMemo(
    () => dayStats.reduce((m, d) => Math.max(m, d.count), 0),
    [dayStats]
  )

  // ── 4. 인터랙티브 hover/click state ──────────────────────────────────
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const activeIdx = useMemo(
    () => activeDate ? dayStats.findIndex(d => d.date === activeDate) : -1,
    [activeDate, dayStats]
  )
  const activeStats = activeIdx >= 0 ? dayStats[activeIdx] : null

  // ── Active label "5월 20일  20건" (Figma 1:1: 공백 2개) ──
  const activeLabel = useMemo(() => {
    if (!activeStats) return null
    const dt = new Date(activeStats.date)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일  ${activeStats.count}건`
  }, [activeStats])

  // ── X축 footer 양 끝 라벨 (Figma 570:7467: 양 끝만 표시) ──────────────
  const xAxisLabels = useMemo(() => {
    if (dayStats.length === 0) return null
    const first = new Date(dayStats[0].date)
    const last  = new Date(dayStats[dayStats.length - 1].date)
    return {
      from: `${first.getMonth() + 1}월 ${first.getDate()}일`,
      to:   `${last.getMonth() + 1}월 ${last.getDate()}일`,
    }
  }, [dayStats])

  // ── 5. SVG 좌표 계산 ──────────────────────────────────────────────────
  const points = useMemo(() => {
    if (dayStats.length === 0) return []
    const drawableH = TREND_VIEWBOX_H - TREND_PADDING_TOP
    return dayStats.map((d, i) => {
      const x = dayStats.length === 1
        ? TREND_VIEWBOX_W / 2
        : (i / (dayStats.length - 1)) * TREND_VIEWBOX_W
      const yRatio = maxCount > 0 ? d.count / maxCount : 0
      const y = TREND_VIEWBOX_H - drawableH * yRatio
      return { x, y, date: d.date, count: d.count }
    })
  }, [dayStats, maxCount])

  const linePath = useMemo(() => catmullRomPath(points), [points])
  const areaPath = useMemo(() => {
    if (points.length === 0) return ''
    return linePath +
      ` L ${TREND_VIEWBOX_W.toFixed(2)},${TREND_VIEWBOX_H.toFixed(2)}` +
      ` L 0,${TREND_VIEWBOX_H.toFixed(2)} Z`
  }, [linePath, points])

  const activePoint = activeIdx >= 0 ? points[activeIdx] : null

  // ── 6. Label clamp (좌/우 가장자리 잘림 방지) ────────────────────────
  const labelPosition = useMemo(() => {
    if (!activePoint) return null
    const leftPct = (activePoint.x / TREND_VIEWBOX_W) * 100
    let leftStr:    string
    let translateX: string
    if (leftPct < 12) {
      leftStr    = '0'
      translateX = '0'
    } else if (leftPct > 88) {
      leftStr    = '100%'
      translateX = '-100%'
    } else {
      leftStr    = `${leftPct}%`
      translateX = '-50%'
    }
    return { leftStr, translateX }
  }, [activePoint])

  return (
    <div style={{
      // ── v6: Figma 1:1 정확 반영 ──────────────────────────────────
      //   · padding pt12 px16 pb16 (Figma 565:21848)
      //   · flex-col items-start justify-between
      //   · v5 (padding 0) 폐기 → Figma 1:1로 복귀
      //   · 단, absolute layout 유지 (작동 보장)
      position:      'relative',
      background:    '#fff',
      borderRadius:  24,
      height:        504,
      width:         '100%',
      overflow:      'hidden',
    }}>
      {/* ── 헤더 (absolute top 12 left 16 right 16) ─────────────── */}
      <div style={{
        position:      'absolute',
        top:           12,                                 // ← Figma pt12
        left:          16,                                 // ← Figma px16
        right:         16,
        display:       'flex',
        flexDirection: 'column',
        alignItems:    'flex-start',
        gap:           2,                                  // ← Figma gap-[2px]
        zIndex:        2,
      }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500,                                  // ← Pretendard:Medium
          fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>예약추이</p>
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>⎯</span>
          <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
        </div>
      </div>

      {/* ── 차트 영역 (absolute, X축 footer 위까지) ──────────────────
            · top 70 = 헤더 끝 (12 + 22 title + 2 gap + 18 date = 54) + 16 gap
            · bottom 40 = X축 footer (24 = 수평선 1 + gap 4 + text 15 + 4 안전) + pb16 = 40
            · left/right 16 = Figma px16 padding */}
      <div style={{
        position: 'absolute',
        top:      70,
        left:     16,
        right:    16,
        bottom:   40,
      }}>
        {dayStats.length === 0 ? (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1' }}>
            {loading ? '로딩 중…' : '데이터 없음'}
          </div>
        ) : (
          <>
            {/* ── SVG: fill area + outline + active marker (line + circle) ── */}
            <svg
              width="100%"
              height="100%"
              viewBox={`0 0 ${TREND_VIEWBOX_W} ${TREND_VIEWBOX_H}`}
              preserveAspectRatio="none"                   // ← 가로 stretch
              style={{ position:'absolute', inset:0, display:'block' }}
            >
              <defs>
                {/* ── Figma 그라데이션 fill: 위 진함 → 아래 흰색 fade-out ── */}
                <linearGradient id="trend-area-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#5C5C5C" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* ── Fill area (그라데이션, 외곽선 없이 자연스러운 형태) ── */}
              {areaPath && (
                <path d={areaPath} fill="url(#trend-area-fill)" />
              )}
              {/* ── 외곽선 삭제됨 (사용자 정정 2026-05-12) ──
                    이전: <path d={linePath} fill="none" stroke="#888" ... />
                    fade-out gradient만으로 자연스러운 mountain 효과 */}
              {/* ── Active 수직 연결선 (Figma 570:7429: h-[40px], 0.5px) ── */}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  y1={activePoint.y - TREND_MARKER_LINE_H - 4}    // ← label 아래 끝
                  x2={activePoint.x}
                  y2={activePoint.y - 4}                            // ← circle 위 끝
                  stroke="#000"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {/* ── Active 데이터 포인트 (Figma 565:21972: size-[8px] = r=4) ── */}
              {activePoint && (
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                  fill="#FFFFFF"
                  stroke="#000000"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* ── Column별 hit area (위젯 ⑥ 패턴, hover detection) ── */}
            <div
              onMouseLeave={() => setActiveDate(null)}
              style={{
                position: 'absolute',
                inset:    0,
                display:  'flex',
                cursor:   'pointer',
              }}>
              {dayStats.map(d => (
                <div
                  key={d.date}
                  onMouseEnter={() => setActiveDate(d.date)}
                  onClick={() => setActiveDate(prev => prev === d.date ? null : d.date)}
                  style={{
                    flex:     1,
                    height:   '100%',
                    minWidth: 0,
                  }}
                />
              ))}
            </div>

            {/* ── Active label (StatusBadge-XS, line 위쪽) ──
                  · Figma 565:21967: bg rgba(255,255,255,0.9), border 1px black, rounded-24
                  · Figma 565:21968: Pretendard Medium 10 #1E1E1E tracking 0.1
                  · 위치: line 위쪽 (top = (activePoint.y - MARKER_LINE_H - 4) %, translateY -100% - 2px) */}
            {activePoint && activeLabel && labelPosition && (
              <div style={{
                position:    'absolute',
                left:        labelPosition.leftStr,
                top:         `${((activePoint.y - TREND_MARKER_LINE_H - 4) / TREND_VIEWBOX_H) * 100}%`,
                transform:   `translate(${labelPosition.translateX}, calc(-100% - 2px))`,
                background:  'rgba(255,255,255,0.9)',
                border:      '1px solid #000',
                borderRadius:24,
                padding:     '2px 8px',
                display:     'flex',
                alignItems:  'center',
                justifyContent:'center',
                fontFamily:  "'Pretendard', -apple-system, sans-serif",
                fontWeight:  500,                              // ← Figma: Pretendard Medium
                fontSize:    10,
                lineHeight:  1.5,
                letterSpacing:'0.1px',
                color:       '#1E1E1E',
                whiteSpace:  'nowrap',
                maxWidth:    'calc(100% - 8px)',
                overflow:    'hidden',
                textOverflow:'ellipsis',
                pointerEvents:'none',
                zIndex:      10,
              }}>
                {activeLabel}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── X축 footer (Figma 570:7433 수평선 + 570:7467 양 끝 라벨) ──── */}
      <div style={{
        position:      'absolute',
        bottom:        16,                                  // ← Figma pb16
        left:          16,
        right:         16,
        display:       'flex',
        flexDirection: 'column',
        gap:           4,
      }}>
        {/* 수평선 (Figma 570:7433: 0.5px) */}
        <div style={{
          borderTop: '0.5px solid #DDE1E6',
          width:     '100%',
        }} />
        {/* 양 끝 날짜 라벨 (Figma 570:7467: justify-between, Medium 10 #DDE1E6) */}
        <div style={{
          display:        'flex',
          justifyContent: 'space-between',
          fontFamily:     "'Pretendard', -apple-system, sans-serif",
          fontWeight:     500,                              // ← Figma: Pretendard Medium
          fontSize:       10,
          lineHeight:     1.5,
          letterSpacing:  '0.1px',
          color:          '#DDE1E6',                         // ← Figma: #DDE1E6 (날짜 picker #AEB5C4와 다름)
          whiteSpace:     'nowrap',
        }}>
          <span>{xAxisLabels?.from ?? ''}</span>
          <span>{xAxisLabels?.to ?? ''}</span>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑦ 부서별 예약 현황 (Figma node 565:13085) ─────────────────────────
//   사용처: Row 3 Col 2 (542×504, 2-col grid)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange + b.dept group by
//   동작: 상단 부서 list (Top 5, count 0 placeholder) + 하단 가로 비율 bar
//   ※ Figma 1:1: padding p16 균등 + flex-col gap 24 (위젯 ②④⑤⑥과 다름)
//   ※ hover/click 시 그 column #343333 진해짐 + label (위젯 ②⑤⑥ 패턴 일관)

// ─── DEPT_RANK_COLORS — Rank별 점진적 옅음 (Top 7 대응, 7단계 그라데이션) ──
//   rank 0 (1위): #777 (가장 진함)
//   rank 1 (2위): #8B8B8B
//   rank 2 (3위): #A0A0A0
//   rank 3 (4위): #B5B5B5
//   rank 4 (5위): #C8C8C8
//   rank 5 (6위): #D6D6D6
//   rank 6+ (7위~): #E2E2E2 (가장 옅음)
const DEPT_RANK_COLORS = ['#777', '#8B8B8B', '#A0A0A0', '#B5B5B5', '#C8C8C8', '#D6D6D6', '#E2E2E2']
const DEPT_RANK_ACTIVE_COLOR = '#343333'    // ← hover/click 시 (Figma mockup의 활성 색)

function DepartmentBookingsCard() {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑥와 dedupe) ──────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 부서별 카운트 (Q1: 모든 booking, Q6: b.dept group by) ─────────
  //   · b.dept null/empty 안전 제외
  //   · 그 기간 예약 있는 부서만 표시 (Q6 A)
  const deptStats = useMemo(() => {
    const map = new Map<string, number>()
    bookings.forEach(b => {
      const dept = b.dept?.trim()
      if (!dept) return                                 // ← 안전: dept 없는 booking 제외
      map.set(dept, (map.get(dept) ?? 0) + 1)
    })
    return Array.from(map.entries())
      .map(([dept, count]) => ({ dept, count }))
      .sort((a, b) => b.count - a.count)                // Q6: count desc
  }, [bookings])

  // ── 4. Top 7 부서 (사용자 정정 2026-05-12: list와 chart 모두 Top 7) ───
  const top7 = useMemo(() => deptStats.slice(0, 7), [deptStats])

  // ── 5. 총 카운트 (Q6: bar width = count / totalCount × 100%) ──────────
  //   ← Top 7 합 기준 → chart가 가득 차오름 (Top 8+ 부서 제외)
  const totalCount = useMemo(
    () => top7.reduce((s, d) => s + d.count, 0),
    [top7]
  )

  // ── 6. 인터랙티브 hover/click state (Q5: 위젯 ②⑤⑥ v3 패턴 일관) ────
  const [activeDept, setActiveDept] = useState<string | null>(null)
  const activeStats  = useMemo(
    () => top7.find(d => d.dept === activeDept) ?? null,    // ← Top 7 안에서만
    [activeDept, top7]
  )

  // ── 활성 column label 내용 ("{부서명} {N}건") ─────────────────────────
  const activeLabel = useMemo(() => {
    if (!activeStats) return null
    return `${activeStats.dept} ${activeStats.count}건`
  }, [activeStats])

  return (
    <div style={{
      // ── Figma outer 1:1 (다른 위젯과 다른 padding/gap 패턴) ──
      background:    '#fff',
      borderRadius:  24,
      padding:       16,                                // ← Figma: p16 균등 (위젯 ②④⑤⑥의 pt12 px16 pb16과 다름)
      display:       'flex',
      flexDirection: 'column',
      gap:           24,                                // ← Figma 1:1 (chart flex:1로 남은 공간 자동 채움)
      height:        504,
      width:         '100%',
      overflow:      'hidden',                          // ← Figma: overflow-clip
    }}>
      {/* ── 헤더 (gap 2, 위젯 ②④⑤⑥과 동일) ─────────────── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>부서별 예약 현황</p>
        {/* ── 날짜 범위 picker (위젯 ②④⑤⑥와 동일) ── */}
        <div style={{ display:'flex', gap:4, alignItems:'center' }}>
          <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
          <span style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
          }}>⎯</span>
          <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
        </div>
      </div>

      {/* ── 부서 list (상단, Top 7 - 사용자 정정 2026-05-12) ──────────── */}
      <div style={{ display:'flex', flexDirection:'column', width:'100%' }}>
        {top7.map((s, i) => {
          const dotColor = DEPT_RANK_COLORS[Math.min(i, DEPT_RANK_COLORS.length - 1)]
          return (
            <div key={s.dept} style={{
              // ── Figma row 1:1: py 8, border #FAFBFF ──
              display:      'flex',
              alignItems:   'center',
              justifyContent:'space-between',
              padding:      '8px 0',
              borderTop:    i === 0 ? '1px solid #FAFBFF' : 'none',
              borderBottom: '1px solid #FAFBFF',
              width:        '100%',
            }}>
              {/* ── 좌측: dot 12 + 부서명 (gap 10) ── */}
              <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:1, minWidth:0, paddingRight:8 }}>
                <div style={{
                  width:12, height:12,
                  borderRadius:999,
                  background: dotColor,                  // ← rank별 색상 (bar 색상과 일관)
                  flexShrink:0,
                }}/>
                <span style={{
                  fontFamily:"'Pretendard', -apple-system, sans-serif",
                  fontWeight:400, fontSize:12, lineHeight:1.5, color:'#000',
                  whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                }}>{s.dept}</span>
              </div>
              <span style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif",
                fontWeight:400, fontSize:12, lineHeight:1.5, color:'#000',
                flexShrink:0,
              }}>{s.count}</span>
            </div>
          )
        })}
        {/* ── deptStats.length < 7인 경우 placeholder row로 7개 채움 ── */}
        {Array.from({ length: Math.max(0, 7 - top7.length) }).map((_, i) => (
          <div key={`empty-${i}`} style={{
            display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'8px 0',
            borderBottom:'1px solid #FAFBFF',
            width:'100%',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:12, height:12, borderRadius:999, background:'#E5E7EB' }}/>
              <span style={{ fontSize:12, color:'#CBD5E1' }}>—</span>
            </div>
            <span style={{ fontSize:12, color:'#CBD5E1' }}>0</span>
          </div>
        ))}
      </div>

      {/* ── 가로 비율 bar 차트 (하단, Top 7만 표시) ─────────────────────
            ※ wrapper(외부) + container(내부 overflow:hidden) 구조로 분리
              · 사유: label은 container 위쪽(top: -25)에 표시되어야 하는데
                      Figma의 radius 16 + overflow:hidden 때문에 label이 잘림
              · 해결: wrapper(position:relative)에 label 위치, container만 overflow hidden */}
      <div
        onMouseLeave={() => setActiveDept(null)}
        style={{
          position: 'relative',                          // ← label absolute 기준점
          width:    '100%',
          flex:     1,                                    // ← 카드 안 남은 공간 자동 채움
          minHeight:0,                                    // ← flex item이 min-content 제한 무시 (필수)
        }}>
        {/* ── Chart container (height 100% — wrapper flex 1로 자동 sizing) ── */}
        <div style={{
          display:     'flex',
          alignItems:  'stretch',
          gap:         1,                                // ← Figma: gap 1px
          height:      '100%',                            // ← wrapper height 자동 채움 (Top 5/6/7 변동 무관 자동 조정)
          width:       '100%',
          borderRadius:0,                                 // ← 사용자 정정 2026-05-12: borderRadius 16 → 0 (직각 모서리)
          overflow:    'hidden',                          // ← column ellipsis용 유지 (borderRadius와 무관)
        }}>
          {top7.length === 0 || totalCount === 0 ? (
            <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#CBD5E1', background:'#F8F9FB' }}>
              {loading ? '로딩 중…' : '예약 데이터 없음'}
            </div>
          ) : (
            top7.map((s, i) => {
              const isActive = s.dept === activeDept
              // Q6: width = count / totalCount × 100% (Top 7 합 기준 → 100% 차오름)
              const widthPct = (s.count / totalCount) * 100
              // Q4: rank별 색상, 활성 시 #343333
              const bgColor = isActive
                ? DEPT_RANK_ACTIVE_COLOR
                : DEPT_RANK_COLORS[Math.min(i, DEPT_RANK_COLORS.length - 1)]
              return (
                <div
                  key={s.dept}
                  onMouseEnter={() => setActiveDept(s.dept)}
                  onClick={() => setActiveDept(prev => prev === s.dept ? null : s.dept)}
                  style={{
                    width:         `${widthPct}%`,
                    minWidth:      0,
                    background:    bgColor,
                    display:       'flex',
                    flexDirection: 'column',
                    alignItems:    'flex-start',
                    justifyContent:'space-between',         // ← count 위 / 부서명 아래
                    padding:       8,
                    cursor:        'pointer',
                    transition:    'background 0.15s ease',
                    overflow:      'hidden',                 // ← column 내부 ellipsis용 (label은 wrapper에서 처리)
                    position:      'relative',
                  }}>
                  {/* ── count (상단) ── */}
                  <span style={{
                    fontFamily:"'Pretendard', -apple-system, sans-serif",
                    fontWeight:400, fontSize:10, lineHeight:1.3, color:'#fff',
                    whiteSpace:'nowrap',
                  }}>{s.count}</span>
                  {/* ── 부서명 (하단, Top 7 모두 표시 - 사용자 정정) ── */}
                  <span style={{
                    fontFamily:"'Pretendard', -apple-system, sans-serif",
                    fontWeight:400, fontSize:10, lineHeight:1.5,
                    color:       '#fff',                    // ← 모두 표시 (좁은 column은 ellipsis로 자동 자름)
                    whiteSpace:  'nowrap',
                    overflow:    'hidden',
                    textOverflow:'ellipsis',
                    maxWidth:    '100%',
                  }}>{s.dept}</span>
                </div>
              )
            })
          )}
        </div>
        {/* ── 활성 column label (chart container 외부 - overflow:hidden 영향 안 받음) ──
              · 위치: chart 위쪽 외부 (top: -25)
              · 형식: "{부서명} {N}건" (위젯 ②⑤⑥ 패턴 일관)
              · ← [2026-05-12 v3] clamp 처리: 좌/우 가장자리에서 label 잘림 방지
                · 정상: translateX(-50%) (column 중앙 정렬)
                · 좌측 끝: translateX(0)    (label 좌측 = chart 0%)
                · 우측 끝: translateX(-100%) (label 우측 = chart 100%) */}
        {activeStats && activeLabel && totalCount > 0 && (() => {
          // 활성 column 중앙 위치 계산 (Top 7 누적 width)
          let leftPct = 0
          for (const s of top7) {
            if (s.dept === activeStats.dept) break
            leftPct += (s.count / totalCount) * 100
          }
          const activeWidthPct = (activeStats.count / totalCount) * 100
          const centerPct      = leftPct + activeWidthPct / 2
          // ── clamp 임계값: chart 폭 25% 이하면 좌측 정렬, 75% 이상이면 우측 정렬 ──
          //   · 부서명 긴 경우(예: 'Clinical Platform Research Institute 51건' ~280px) 안전
          let leftStr:      string
          let transformStr: string
          if (centerPct < 25) {
            leftStr      = '0'
            transformStr = 'translateX(0)'              // ← label 좌측 = chart 좌측
          } else if (centerPct > 75) {
            leftStr      = '100%'
            transformStr = 'translateX(-100%)'           // ← label 우측 = chart 우측
          } else {
            leftStr      = `${centerPct}%`
            transformStr = 'translateX(-50%)'            // ← 정상 (column 중앙)
          }
          return (
            <div style={{
              position:    'absolute',
              top:         -25,                              // ← chart 위쪽 외부 (wrapper 기준)
              left:        leftStr,
              transform:   transformStr,
              // ── Figma StatusBadge-XS (위젯 ②⑤⑥와 동일) ──
              background:  'rgba(255,255,255,0.9)',
              border:      '1px solid #000',
              borderRadius:24,
              padding:     '2px 8px',
              display:     'flex',
              gap:         10,
              alignItems:  'center',
              justifyContent:'center',
              fontFamily:  "'Pretendard', -apple-system, sans-serif",
              fontWeight:  400,
              fontSize:    10,
              lineHeight:  1.5,
              letterSpacing:'0.1px',
              color:       '#1E1E1E',
              whiteSpace:  'nowrap',
              // ── 안전망: label width 너무 길면 ellipsis ──
              maxWidth:    'calc(100% - 8px)',             // ← chart 폭 - 양쪽 4px 여백
              overflow:    'hidden',
              textOverflow:'ellipsis',
              pointerEvents:'none',
              zIndex:      10,
            }}>
              {activeLabel}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── 위젯 ⑧ 시간대별 예약 분포 (Figma node 565:21770) ─────────────────────
//   사용처: Row 4 (좌측만, 우측 빈 칸 — Figma 1:1)
//   데이터: 자체 dateFrom/dateTo (default 30일) + useBookingsByRange
//   동작: 13 columns (7시~19시 운영시간) 이중 봉 차트, 위젯 ⑥ 그래프 형식
//   ※ Figma 1:1: 외곽 봉 bg #F6F7FA + 내부 봉 #DDDEDF→#EFF0F1 (활성 시 #000→#7E7F80)
//   ※ 헤더 두 번째 줄 justify-between: 좌(picker) / 우(subtitle) — 위젯 ⑥⑦과 다름
//   ※ Q5: timezone 안전 — b.start_at.substring(11, 13)로 KST hour 추출

// ─── HOURLY — Figma 1:1 차트 사양 상수 ────────────────────────────────────
const OPERATING_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]   // ← Q3: 7~19시 13 columns
const HOURLY_OUTER_H  = 93                                                    // ← Figma: 외곽 봉 height

function HourlyDistributionCard() {
  // ── 1. 자체 날짜 state (default 지난 30일) ────────────────────────────
  const [dateFrom, setDateFrom] = useState<string>(() => addDaysStr(todayStr(), -29))
  const [dateTo,   setDateTo]   = useState<string>(() => todayStr())

  // ── 2. 자체 fetch (Phase 4 cache 공유, 위젯 ②④⑤⑥⑦와 dedupe) ────────
  const { data: bookings, loading } = useBookingsByRange(dateFrom, dateTo)

  // ── 3. 시간대별 count (Q1: 모든 booking, Q2: start_at hour, Q5: substring 안전) ─
  //   · Q5: b.start_at.substring(11, 13) → "08" → 8 (KST hour, timezone 무관)
  //   · Q3: 7~19시만 카운트 (운영 외 시간 표시 안 함)
  const hourStats = useMemo(() => {
    return OPERATING_HOURS.map(h => {
      const count = bookings.filter(b => {
        if (!b.start_at) return false                  // ← 안전: start_at 없는 booking 제외
        const hourStr = b.start_at.substring(11, 13)   // Q5: ISO 8601 "T08:30..." → "08"
        return parseInt(hourStr, 10) === h
      }).length
      return { hour: h, count }
    })
  }, [bookings])

  // ── 4. maxCount (내부 봉 비례 계산 기준) ──────────────────────────────
  const maxCount = useMemo(
    () => hourStats.reduce((m, d) => Math.max(m, d.count), 0),
    [hourStats]
  )

  // ── 5. 인터랙티브 hover/click state (Q4: 위젯 ②⑤⑥⑦ v3 패턴 일관) ───
  const [activeHour, setActiveHour] = useState<number | null>(null)
  const activeStats  = useMemo(
    () => hourStats.find(d => d.hour === activeHour) ?? null,
    [activeHour, hourStats]
  )

  // ── 활성 column label 내용 ("{N}시 {N}건") ───────────────────────────
  const activeLabel = useMemo(() => {
    if (!activeStats) return null
    return `${activeStats.hour}시 ${activeStats.count}건`
  }, [activeStats])

  return (
    <div style={{
      // ── Figma outer 1:1 (Row 4 단독, 좌측만) ──
      background:    '#fff',
      borderRadius:  24,
      padding:       '12px 16px 16px 16px',           // ← Figma: pt12 px16 pb16
      display:       'flex',
      flexDirection: 'column',
      gap:           24,                                // ← Figma: flex-col gap 24
      width:         '100%',
      overflow:      'hidden',                          // ← Figma: overflow-clip
    }}>
      {/* ── 헤더 (위젯 ⑥⑦과 다른 구조 - 두 번째 줄 justify-between) ──── */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>시간대별 예약 분포</p>
        {/* ── 두 번째 줄: 좌(picker) ↔ 우(subtitle) justify-between ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',              // ← Figma: 헤더 두 번째 줄 좌/우 분리
          width:          '100%',
        }}>
          {/* 좌: 날짜 범위 picker (위젯 ②④⑤⑥⑦와 동일) */}
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            <SmallDateTrigger value={dateFrom} onChange={setDateFrom} max={dateTo} />
            <span style={{
              fontFamily:"'Pretendard', -apple-system, sans-serif",
              fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4',
            }}>⎯</span>
            <SmallDateTrigger value={dateTo} onChange={setDateTo} min={dateFrom} max={todayStr()} />
          </div>
          {/* 우: subtitle "운영시간 오전 7시 부터 오후 7시" — Figma 1:1 */}
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
            whiteSpace:'nowrap',
          }}>운영시간 오전 7시 부터 오후 7시</p>
        </div>
      </div>

      {/* ── 차트 (h 111, gap 4, items-end, 13 columns) ──────────────── */}
      <div
        onMouseLeave={() => setActiveHour(null)}
        style={{
          display:    'flex',
          alignItems: 'flex-end',                       // ← Figma: items-end
          gap:        4,                                 // ← Figma: gap 4
          height:     111,                               // ← Figma: chart 컨테이너 h 111 (graph 93 + gap 4 + label 14)
          width:      '100%',
          position:   'relative',
        }}>
        {hourStats.map(d => {
          const isActive = d.hour === activeHour
          // ── 내부 봉 height: count/maxCount × 93 (외곽 height) ──
          //   · maxCount=0 (전체 0) → 내부 미표시 (외곽만)
          //   · Math.max(2,...): count > 0이면 최소 2px 표시 (시각적 존재감)
          const innerH = maxCount > 0 && d.count > 0
            ? Math.max(2, (d.count / maxCount) * HOURLY_OUTER_H)
            : 0
          return (
            <div
              key={d.hour}
              onMouseEnter={() => setActiveHour(d.hour)}
              onClick={() => setActiveHour(prev => prev === d.hour ? null : d.hour)}
              style={{
                flex:          1,
                height:        '100%',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'stretch',
                justifyContent:'flex-end',                // ← Figma: column items-start justify-end
                gap:           4,                          // ← Figma: column 내부 gap 4
                minWidth:      0,
                cursor:        'pointer',
              }}>
              {/* ── Graph 영역 (외곽 봉 + 내부 봉) ── */}
              <div style={{
                position:    'relative',
                height:      HOURLY_OUTER_H,             // ← Figma: 외곽 h 93
                width:       '100%',
                background:  '#F6F7FA',                   // ← Figma: 외곽 bg #F6F7FA (위젯 ⑥의 #FCFCFC와 다름)
              }}>
                {/* ── 내부 봉 (bottom 정렬, 비례 height, 활성 시 검정 그라데이션) ── */}
                {innerH > 0 && (
                  <div style={{
                    position:   'absolute',
                    bottom:     0,
                    left:       0,
                    right:      0,
                    height:     innerH,
                    // ── Figma 1:1 ──
                    //   평소: linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)
                    //   활성: linear-gradient(to bottom, #000 48.954%, #7E7F80 100%)
                    background: isActive
                      ? 'linear-gradient(to bottom, #000 48.954%, #7E7F80 100%)'
                      : 'linear-gradient(to bottom, #DDDEDF 24.207%, #EFF0F1 100%)',
                    transition: 'height 0.4s ease, background 0.15s ease',
                  }}/>
                )}
                {/* ── 활성 column label (내부 봉 위쪽 6px - 위젯 ⑥ 패턴) ── */}
                {isActive && activeLabel && (
                  <div style={{
                    position:    'absolute',
                    bottom:      innerH + 6,
                    left:        '50%',
                    transform:   'translateX(-50%)',
                    // ── Figma StatusBadge-XS (위젯 ②⑤⑥⑦와 동일) ──
                    background:  'rgba(255,255,255,0.9)',
                    border:      '1px solid #000',
                    borderRadius:24,
                    padding:     '2px 8px',
                    display:     'flex',
                    gap:         10,
                    alignItems:  'center',
                    justifyContent:'center',
                    fontFamily:  "'Pretendard', -apple-system, sans-serif",
                    fontWeight:  400,
                    fontSize:    10,
                    lineHeight:  1.5,
                    letterSpacing:'0.1px',
                    color:       '#1E1E1E',
                    whiteSpace:  'nowrap',
                    pointerEvents:'none',
                    zIndex:      10,
                  }}>
                    {activeLabel}
                  </div>
                )}
              </div>
              {/* ── 시간 라벨 (X축, "7시" ~ "19시") ── */}
              <span style={{
                fontFamily:"'Pretendard', -apple-system, sans-serif",
                fontWeight:400, fontSize:9, lineHeight:1.5, color:'#AEB5C4',
                textAlign:'center',
                whiteSpace:'nowrap',
              }}>{d.hour}시</span>
            </div>
          )
        })}
        {/* ── 빈 데이터 case (전체 0건) - 차트 자체는 모두 외곽만 표시 ── */}
        {!loading && maxCount === 0 && bookings.length === 0 && (
          <div style={{
            position:'absolute',
            top:0, left:0, right:0, bottom:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            pointerEvents:'none',
            fontSize:11, color:'#CBD5E1',
          }}>
            예약 데이터 없음
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════

// ─── DashboardPlaceholderCard ───────────────────────────────────────────────
//   목적: Phase 4~10 위젯 구현 전까지 외곽 레이아웃 유지 + 진척 표시
//   교체 방식: 각 Phase에서 해당 카드만 진짜 위젯으로 교체
//   ※ 시각: 동일한 outer 스타일 (bg #fff / radius 24 / pt12 px16 pb16) 유지
//
//   ← [2026-05-11 Phase 3.5] dateRange prop optional + default 자동 생성
//      · 사유: Q1 결정 — 각 위젯이 자체 날짜 필터(DateDisplay × 2 picker) 보유
//      · placeholder 시점에는 default 30일 텍스트만 표시 (인터랙션 없음)
//      · 각 위젯이 Phase 4-10에서 구현되면 picker로 교체
interface PlaceholderProps {
  height:    number       // ← Figma 카드 높이 (Row 1: 268 / Row 2-3: 504 / Row 4: 205)
  title:     string       // ← Figma 카드 타이틀
  subtitle?: string       // ← Figma 카드 서브타이틀 (시간대별 예약 분포만 사용)
  /** 날짜 범위 표시 (3-state):
   *  · undefined → default 30일 자동 표시 (지난 30일 ⎯ 오늘)
   *  · null      → 표시 안 함 (위젯 ③ 최근 생성된 예약, ⑧ 시간대별 예약 분포)
   *  · string    → 명시한 텍스트 표시 */
  dateRange?: string | null
  phaseNote: string       // ← "Phase N에서 구현 예정" 안내
}
function DashboardPlaceholderCard({ height, title, subtitle, dateRange, phaseNote }: PlaceholderProps) {
  // ← [2026-05-11 Phase 3.5] dateRange 미지정 시 default 30일 자동 표시
  //   default 산출: 각 위젯이 own state로 초기화할 때 동일한 값 사용 예정 (UX 연속성)
  const effectiveDateRange = dateRange ?? `${addDaysStr(todayStr(), -29)} ⎯ ${todayStr()}`
  return (
    <div style={{
      background:   '#fff',
      borderRadius: 24,
      padding:      '12px 16px 16px 16px',
      display:      'flex',
      flexDirection:'column',
      alignItems:   'flex-start',
      gap:          4,
      height,
      width:        '100%',
    }}>
      {/* 타이틀 블록 — Figma 동일 스펙 */}
      <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start', gap:2, width:'100%' }}>
        <p style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontWeight:500, fontSize:16, lineHeight:1.4, color:'#111', margin:0,
          whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
        }}>{title}</p>
        {subtitle && (
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
          }}>{subtitle}</p>
        )}
        {dateRange !== null && (
          <p style={{
            fontFamily:"'Pretendard', -apple-system, sans-serif",
            fontWeight:400, fontSize:12, lineHeight:1.5, color:'#AEB5C4', margin:0,
          }}>{effectiveDateRange}</p>
        )}
      </div>

      {/* Phase 진행 안내 — 카드 중앙 */}
      <div style={{
        flex:1, width:'100%',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        <span style={{
          fontFamily:"'Pretendard', -apple-system, sans-serif",
          fontSize: 12, color:'#CBD5E1', fontWeight:400,
        }}>🚧 {phaseNote}</span>
      </div>
    </div>
  )
}

// ─── AdminDashboard ────────────────────────────────────────────────────────────
export function AdminDashboard({ bookings, rooms, users, isMobile, onDetail }) {
  // ── [2026-05-11 Phase 3.5] 외곽 정비 — 카드별 독립 날짜 필터로 전환 ──────
  //   · 사유: Q1 결정 — 위젯 ②~⑧이 각자 dateFrom/dateTo state + own
  //            loadBookingsByRange fetch + DateDisplay picker 보유
  //   · 제거된 state: dateFrom/setDateFrom, dateTo/setDateTo, rangeData/setRangeData,
  //                   loadingChart/setLoadingChart
  //   · 제거된 effect: fetchRange useCallback + useEffect (각 위젯 own fetch)
  //   · 제거된 useMemo: filtered / past / confirmed / dayRange / roomStats / deptStats /
  //                    noshowRank / hourDist / roomChartData / deptChartData
  //                    (각 위젯 구현 시 자체 state + 계산)
  //   · 제거된 변수: noshowRate, noswColor (위젯별 own 정의로 이전)
  //   · 제거된 helper: inputStyle / btnStyle (공통 날짜 필터 UI 전용)
  //   · 유지: pendingCount — bookings prop에서 직접 (실시간 pending count, 위젯 ①)
  //   · rooms / users / onDetail props: Phase 4-10 위젯 구현 시 사용 예정 → 시그니처 보존

  // 위젯 ① 승인 대기용 — bookings prop에서 직접 계산 (날짜 필터 없음)
  const pendingCount = bookings.filter(b => b.status === 'pending' && !b.autoCancelled).length

  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: 1100, width: '100%' }}>

      {/* ── [2026-05-11 Phase 3.5] 상단 공통 날짜 필터 + 로딩 인디케이터 제거 ──
            · 사유: Q1 결정 — 각 위젯이 자체 dateFrom/dateTo state + DateDisplay picker 보유
            · 공통 필터를 두면 카드별 필터와 충돌하므로 완전 제거 (Q2 결정)
            · 각 위젯이 own loadBookingsByRange fetch + own loading state 가짐 */}

      {/* ──────────────────────────────────────────────────────────────────
           [2026-05-11 Phase 3] Dashboard 외곽 4-row grid (Figma node 489:393 1:1)
           · Row 1 (gap 16): 위젯 ①②③ 각 356×268 (3-col)
           · Row 2 (gap 16): 위젯 ④⑤   각 542×504 (2-col)
           · Row 3 (gap 16): 위젯 ⑥⑦   각 542×504 (2-col)
           · Row 4 (gap 16): 위젯 ⑧     542×205 (좌측만, 우측 빈 칸)
           · 위젯 ②~⑧는 Phase 4~10에서 PlaceholderCard 자리 1개씩 진짜 구현으로 교체
         ──────────────────────────────────────────────────────────────── */}

      {/* ── Row 1: 위젯 ① 승인 대기 / ② 노쇼 현황 / ③ 최근 생성된 예약 ── */}
      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
        {/* ① 승인 대기 — Phase 3 구현 (Figma 489:406) */}
        <ApprovalPendingCard count={pendingCount} />

        {/* ② 노쇼 현황 — Phase 4 구현 (Figma 490:704) ✓ */}
        <NoshowChartCard />

        {/* ③ 최근 생성된 예약 — Phase 5 구현 (Figma 551:3458) ✓ */}
        <RecentBookingsCard
          bookings={bookings}
          users={users}
          rooms={rooms}
          onDetail={onDetail}
        />
      </div>

      {/* ── Row 2: 위젯 ④ 예약 많은 회의실 / ⑤ 회의실 노쇼 현황 ── */}
      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {/* ④ 예약 많은 회의실 — Phase 6 구현 (Figma 551:3513) ✓ */}
        <RoomRankingCard rooms={rooms} />
        {/* ⑤ 회의실 노쇼 현황 — Phase 7 구현 (Figma 551:3548) ✓ */}
        <RoomNoshowCard rooms={rooms} />
      </div>

      {/* ── Row 3: 위젯 ⑥ 예약추이 / ⑦ 부서별 예약 현황 ── */}
      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {/* ⑥ 예약추이 — Mountain Chart (Figma 565:21848) ✓ */}
        <BookingTrendsAreaCard />
        {/* ⑦ 부서별 예약 현황 — Phase 9 (Figma 565:13085) ✓ */}
        <DepartmentBookingsCard />
      </div>

      {/* ── Row 4: 위젯 ⑧ 시간대별 예약 분포 (좌측만) ── */}
      <div className={`grid gap-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {/* ⑧ 시간대별 예약 분포 — Phase 10 (Figma 565:21770) ✓ */}
        <HourlyDistributionCard />
        {/* 우측 빈 칸 — Figma 사양 (Row 4는 좌측 카드만) */}
        {!isMobile && <div />}
      </div>

      {/* ── [2026-05-11 Phase 3] DetailDrawer 렌더링 제거 (Q5 결정) ──
            · 기존: 카드 클릭 → setDetail(type) → <DetailDrawer .../> 표시
            · 변경: 카드 클릭 액션 자체 제거 (정적 카드, Figma 1:1)
            · 안전: DetailDrawer 컴포넌트 함수 자체는 보존 (L168) — 다른 곳에서 import 시 안전 */}
    </div>
  )
}

// ─── AdminBookings ─────────────────────────────────────────────────────────────
// ← [2026-04-24 P6-B] users prop 추가 — 예약자 이름 live 조회용 (L1113)
export function AdminBookings({ bookings, setBookings, rooms, users = [], onForceCancel, showToast, isMobile, PER_PAGE, onDetail }) {
  const today=todayStr()
  const [dateFrom, setDateFrom]=useState(()=>{const d=new Date();return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-01`})
  const [dateTo,   setDateTo]  =useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return`${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`})
  const [filterRoom,   setFilterRoom]  =useState('ALL')
  const [filterUser,   setFilterUser]  =useState('')
  const [filterStatus, setFilterStatus]=useState('ALL')
  const [page, setPage]=useState(1)
  // ← [2026-04-24 P8-B] 자체 cancelModal / cancelReason / cancelling state 제거
  //   · 공통 컴포넌트 ConfirmForceCancelModal (App.tsx modal)로 이관
  //   · onForceCancel prop은 이제 App의 confirmAndAdminForceCancel — (id) 단일 인자, 다이얼로그 자동 오픈
  //   · doCancel / cancelReason 입력 / 로딩 상태는 모두 공통 컴포넌트가 담당
  // ← [2026-05-11 Phase 2] 로컬 isNoshow 정의 제거 — utils/noshow.ts SSOT 사용
  //   · 옛 룰: autoCancelled && !checkedIn && !earlyEnded && cancelledBy!=='admin'
  //   · 확정 룰: status==='confirmed' && cancelledBy==='system' && !checkedIn
  //   · cancelledBy!=='admin' 가드 제거 사유: 확정 룰의 status==='confirmed' 조건이
  //     강제취소(status='cancelled' + cancelledBy='admin')를 자동 분리 — 가드 중복
  //   · adminCancel 탭 필터(L1089)는 그대로 유지 — 별개 분류 카운트용
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
  // ← [2026-04-24 P8-B] doCancel 함수 제거 — App.tsx의 confirmAndAdminForceCancel이 담당
  //   (다이얼로그에서 사유 입력 → 확정 시 adminForceCancelBooking 호출까지 전부 공통 경로)
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
              <tbody>{paged.map(b=>{const r=rooms.find(rm=>rm.room_id===b.room_id);const canCancel=!b.autoCancelled&&b.status!=='rejected';
                // ← [2026-04-24 P6-B] 예약자 이름 live — profiles.name 우선, snapshot fallback
                const owner = (users as any[]).find((u:any) => u.user_id === b.user_id);
                const displayName = owner?.name ?? b.user ?? '—';
                return(
                <tr key={b.id} style={{borderBottom:'1px solid #F8FAFC',cursor:'pointer'}} onClick={()=>onDetail&&onDetail(b)} onMouseEnter={e=>e.currentTarget.style.background='#FAFBFD'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <td style={{padding:'10px 14px',fontWeight:600,color:'#111',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.title}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{r?.room_name??'?'}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSDateFull(b.start_at)}</td>
                  <td style={{padding:'10px 14px',color:'#64748B',whiteSpace:'nowrap'}}>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}><div style={{display:'flex',alignItems:'center',gap:7}}><div style={{width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:500,flexShrink:0,background:'#F1EFE8',color:'#444441'}}>{(displayName ?? '?')[0]}</div><span style={{fontSize:13,fontWeight:500}}>{displayName}</span></div></td>
                  <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>{getBadge(b)}</td>
                  <td style={{padding:'10px 14px'}} onClick={e=>e.stopPropagation()}>{canCancel&&<Button variant='danger-outline' size='sm' onClick={()=>onForceCancel(b.id)}>강제 취소</Button>}{/* ← [2026-04-24 P8-B] setCancelModal(b) → onForceCancel(b.id) — App.tsx confirmAndAdminForceCancel이 ConfirmForceCancelModal 자동 오픈 */}</td>
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
      {/* ← [2026-04-24 P8-B] 인라인 강제취소 모달 제거 — ConfirmForceCancelModal 공통 컴포넌트로 이관
            (App.tsx confirmAndAdminForceCancel 헬퍼가 modal.type='confirmForceCancel' 띄움) */}
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
        <Button variant='primary' size='sm' onClick={()=>openEdit(null)}>+ 회의실 추가</Button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:12}}>
        {rooms.map(r=>{const fl=getFloor(r.floor_id);return(
          <div key={r.room_id} className="anm" style={{background:'#fff',borderRadius:16,overflow:'hidden',opacity:r.is_active?1:0.6}}>
            <div style={{display:'flex',gap:16,padding:'20px 20px 16px'}}>
              <div style={{width:88,height:88,borderRadius:12,overflow:'hidden',flexShrink:0,background:'#F8FAFC'}}>
                {r.thumbnail?<img src={r.thumbnail} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:<div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><Building2 size={24} strokeWidth={1.8} color="#CBD5E1"/></div>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  <div style={{fontSize:14,fontWeight:600,color:'#111'}}>{r.room_name}</div>
                  {!r.is_active&&<span style={{background:'#FEE2E2',color:'#DC2626',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>비활성</span>}
                  {r.is_admin_only&&<span style={{background:'#F3E8FF',color:'#7C3AED',fontSize:9,fontWeight:600,padding:'2px 6px',borderRadius:999}}>관리자전용</span>}
                </div>
                <div style={{fontSize:12,color:'#64748B',marginTop:2}}>{r.room_name} · {fl?.floor_name} · {r.capacity}인</div>
                {(r.features??[]).length>0&&<div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>{(r.features??[]).slice(0,3).map(f=><span key={f.feature_id} style={{background:'#F0F9FF',border:'1px solid #BAE6FD',borderRadius:999,padding:'2px 7px',fontSize:10,color:'#0369A1',fontWeight:600}}>{f.feature_name}</span>)}</div>}
              </div>
            </div>
            <div style={{display:'flex',gap:8,padding:'0 20px 16px'}}>
              <Button variant='secondary' size='sm' flex onClick={()=>openEdit(r)}>수정</Button>
              <Button variant={r.is_active?'danger-outline':'success'} size='sm' flex onClick={()=>toggleActive(r.room_id)}>{r.is_active?'비활성화':'활성화'}</Button>
            </div>
          </div>
        )})}
      </div>
      {editRoom&&(<ModalPortal><div onClick={e=>e.target===e.currentTarget&&setEditRoom(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:1000,padding:16}}>
        <div className="anm" style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:460,maxHeight:'88vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.15)'}}>\n          <div style={{overflowY:'auto',flex:1,padding:'24px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
            <div style={{fontSize:16,fontWeight:600,color:'#111'}}>{editRoom?.room_id?'회의실 정보 수정':'새 회의실 추가'}</div>
            <ModalCloseButton onClick={()=>setEditRoom(null)} />
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
          </div>
          {/* sticky footer */}
          <div style={{display:'flex',gap:8,padding:'12px 24px 20px',borderTop:'1px solid #F1F5F9',flexShrink:0}}>
            <Button variant='ghost' flex onClick={()=>setEditRoom(null)}>취소</Button>
            <Button variant='primary' flex onClick={saveEdit}>저장</Button>
          </div>
        </div>
      </div></ModalPortal>)}
    </div>
  )
}

// ─── AdminUsers ────────────────────────────────────────────────────────────────
// ← [2026-04-18 P0 fix] import 제거 → 최상단으로 이동
//
// ✅ 변경 이력
//  - [2026-05-14] '로그인/미로그인' 구별 기능 제거
//      · 배경: sync-all-users v7부터 미로그인 사용자도 Azure AD에서 dept 자동 수집
//              → 기존 `dept 유무 = 로그인 여부` heuristic이 무효화됨
//      · 변경: FilterType에서 'logged'|'unlogged' 제거, 카운트/필터/탭/뱃지/CSV 라벨 모두 정리
//      · 영향: 사용자 목록 화면에서 '로그인'·'미로그인' 탭 사라짐, dept 빈값은 '-'로 표시
//      · 후속 [2026-05-14] '전체' 라벨 → '재직자'로 변경 (퇴사자와 대구되는 명확한 표현)

export function AdminUsers({ users, setUsers, showToast, isMobile }) {
  type FilterType = 'all' | 'admin' | 'departed' // ← [2026-05-14] 'logged' | 'unlogged' 제거

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
    // ← [2026-05-14] logged/unlogged 카운트 제거 (dept 유무로 판정하던 heuristic 폐기)
    departed: departed.length,
  }

  // ── 검색 + 필터
  const filteredUsers = users.filter(u => {
    if (filter === 'admin'    && u.role !== 'ADMIN') return false
    // ← [2026-05-14] logged/unlogged 필터 분기 제거 (FilterType에서도 제거됨)
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
    { id: 'all',      label: '재직자' }, // ← [2026-05-14] '전체' → '재직자' (퇴사자와 대구되는 명확한 표현, 의미적으로 'all'은 재직중인 사용자 전체)
    { id: 'admin',    label: 'Admin' },
    // ← [2026-05-14] '로그인'·'미로그인' 탭 제거 (dept 유무 heuristic 폐기)
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
                : filteredUsers.map(u => ({ 이름:u.name, 부서:u.dept || '', 이메일:u.email, 권한:u.role })), // ← [2026-05-14] '(미로그인)' fallback 제거 → 빈문자열
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
                      {u.name}
                      {/* ← [2026-05-14] '미로그인' 노란뱃지 제거 — dept 있을 때만 회색 부서 표시 */}
                      {u.dept && <> <span style={{ color:'#94A3B8', fontWeight:400 }}>{u.dept}</span></>}
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
                      {/* ← [2026-05-14] '미로그인' 노란뱃지 제거 — 빈값은 '-' 표시 (테이블 컬럼 정렬 유지) */}
                      {u.dept || '-'}
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
                  <Button variant='ghost' flex onClick={closeModal}>취소</Button>
                  <Button variant='primary' flex loading={saving} onClick={saveEdit}>저장</Button>
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
// ← [2026-04-18 P0 fix] import 제거 → 최상단으로 이동

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
  // 툴바 내 로컬 필터 (sort/floor/search)
  const [sortOrder,   setSortOrder]   = useState<'latest'|'oldest'>('latest')
  const [floorFilter, setFloorFilter] = useState<number|'ALL'>('ALL')
  const [searchQ,     setSearchQ]     = useState('')

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

  // 툴바 내 로컬 필터 적용 (sort/floor/search)
  const floors = useMemo(() =>
    [...new Set(rooms.map(r => r.floor_id).filter(Boolean))].sort((a,b) => (a as number)-(b as number)) as number[],
  [rooms])

  const filteredDisplayData = useMemo(() => {
    let list = [...displayData]
    if (floorFilter !== 'ALL') {
      const ids = rooms.filter(r => r.floor_id === floorFilter).map(r => r.room_id)
      list = list.filter(b => ids.includes(b.room_id))
    }
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      list = list.filter(b => b.title.toLowerCase().includes(q) || (b.user ?? '').toLowerCase().includes(q))
    }
    return list.sort((a, b) =>
      sortOrder === 'latest' ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : (a.createdAt ?? 0) - (b.createdAt ?? 0)
    )
  }, [displayData, floorFilter, searchQ, sortOrder, rooms])

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
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value) }}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:108, outline:'none' }}/>
            <span style={{ fontSize:12, color:'#CBD5E1' }}>~</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value) }}
              style={{ height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 8px', fontSize:12, background:'#fff', color:'#111', width:108, outline:'none' }}/>
            {[
              { label:'오늘',     fn:():[string,string]=>[todayStr(), todayStr()] },
              { label:'지난 7일', fn:():[string,string]=>[addDaysStr(todayStr(),-6), todayStr()] },
              { label:'이번 달',  fn:():[string,string]=>[getMonthStart(0), todayStr()] },
              { label:'지난 달',  fn:():[string,string]=>[getMonthStart(-1), getMonthEnd(-1)] },
            ].map(p => (
              <button key={p.label} className="btn" onClick={() => { const [f,t]=p.fn(); setDateFrom(f); setDateTo(t) }}
                style={{ height:32, padding:'0 10px', border:'0.5px solid #E2E8F0', borderRadius:8, fontSize:12, background:'#fff', color:'#64748B', cursor:'pointer', whiteSpace:'nowrap' }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {/* Row 2: 상태 탭 + 정렬 + 층 + 검색 */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
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
          <div style={{ flex:1 }}/>
          {(['latest','oldest'] as const).map(s => (
            <button key={s} className="btn" onClick={() => setSortOrder(s)}
              style={{ height:32, padding:'0 10px', border:'0.5px solid', borderColor: sortOrder===s ? 'transparent' : '#E2E8F0', borderRadius:8, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' as const, background: sortOrder===s ? '#111' : '#fff', color: sortOrder===s ? '#fff' : '#64748B' }}>
              {s==='latest' ? '최신순' : '과거순'}
            </button>
          ))}
          <div style={{ position:'relative', minWidth:140, maxWidth:200 }}>
            <svg style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', opacity:.35, pointerEvents:'none' }} width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input type="text" value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="이름 또는 회의명"
              style={{ width:'100%', height:32, border:'0.5px solid #E2E8F0', borderRadius:8, padding:'0 10px 0 28px', fontSize:12, background:'#fff', color:'#111', outline:'none' }}/>
          </div>
        </div>
      </div>

      <BookingListTable
        bookings={bookings}
        rooms={rooms}
        users={users ?? []}
        currentUser=""
        onDetail={onDetail ?? (() => {})}
        loading={loadingRange}
        controlled={filteredDisplayData}
        hideFilters={true}
        actionColumn={{
          header: '처리',
          render: (b: Booking) => {
            const status = classify(b)
            const isProc = processing === b.id

            // 승인완료 — 처리한 관리자 칩 (데이터 없으면 빈칸)
            if (status === 'confirmed') {
              if (!b.processedByName) return null
              const processedByUser = (users ?? []).find((u: any) => u.name === b.processedByName)
              return <UserChip name={b.processedByName} avatarUrl={b.processedByAvatar ?? null} variant="sm" isAdmin userInfo={processedByUser} />
            }

            // 거절 — 처리한 관리자 칩 (데이터 없으면 빈칸)
            if (status === 'rejected') {
              if (!b.processedByName) return null
              const processedByUser = (users ?? []).find((u: any) => u.name === b.processedByName)
              return <UserChip name={b.processedByName} avatarUrl={b.processedByAvatar ?? null} variant="sm" isAdmin userInfo={processedByUser} />
            }

            // 기한초과 — 라벨만
            if (status === 'expired') {
              return <span style={{ fontSize:11, color:'#94A3B8', padding:'4px 8px', background:'#F8FAFC', borderRadius:8 }}>기한초과</span>
            }

            // 승인 대기 — 승인/거절 버튼
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
              <Button variant='ghost' flex onClick={() => setRejectModal(null)}>취소</Button>
              <Button variant='danger' flex loading={!!processing} onClick={doReject}>거절 확정</Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}
