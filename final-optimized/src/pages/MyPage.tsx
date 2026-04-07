import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, getFloor, getRoomFeatures, getRoomById } from '../data/master'
import { cancelBooking as apiCancelBooking, upsertBookingAttendees } from '../lib/api'
import { WeeklyView } from '../components/layout/CalendarShell'
import { supabase } from '../lib/supabase'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, rooms:rp=[], users:up=[], authUserId=''}) {
  const [tab, setTab] = useState("upcoming");
  const [statYear, setStatYear] = useState(()=>new Date().getFullYear());
  const [statMonth, setStatMonth] = useState(()=>new Date().getMonth());
  const today = todayStr();
  const now = nowMinutes();
  const allUsers = up.length>0 ? up : APP_USERS;
  const allRooms = rp.length>0 ? rp : ROOMS_DB;  // 컴포넌트 스코프 — 모든 곳에서 접근 가능
  const userInfo = allUsers.find(u=>u.name===currentUser);

  // 기간별 조회
  const [listFrom, setListFrom] = useState(()=>{const d=new Date();d.setDate(1);return objToStr(d);});
  const [listTo, setListTo] = useState(()=>{const d=new Date();d.setMonth(d.getMonth()+1,0);return objToStr(d);});
  const [listStatus, setListStatus] = useState("ALL"); // ALL | upcoming | completed | cancelled
  // 전체 내 예약 기록 (마이페이지 전용 — 기간 제한 없이)
  const [allMyBookings, setAllMyBookings] = useState<Booking[]>([]);
  const [allLoading, setAllLoading] = useState(false);

  useEffect(() => {
    if (!authUserId) return;
    setAllLoading(true);
    supabase
      .from('bookings')
      .select('*, booking_attendees(email)')
      .eq('user_id', authUserId)
      .order('start_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          setAllMyBookings(data.map((row: any) => ({
            id:            row.id,
            room_id:       row.room_id,
            title:         row.title,
            memo:          row.memo ?? '',
            attendees:     (row.booking_attendees ?? []).map((a: any) => a.email),
            start_at:      row.start_at,
            end_at:        row.end_at,
            user:          row.user_name,
            dept:          row.user_dept,
            checkedIn:     row.checked_in,
            autoCancelled: row.auto_cancelled,
            cancelledBy:   row.cancelled_by ?? null,
            status:        row.status ?? 'confirmed',
            earlyEnded:    row.early_ended ?? false,
            recurGroupId:  row.recur_group_id ?? null,
            createdAt:     new Date(row.created_at).getTime(),
          })));
        }
        setAllLoading(false);
      });
  }, [authUserId]);

  const cancelBooking = async (id) => {
    // 낙관적 UI 업데이트 (즉시 반영)
    setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:true} : b));
    showToast("예약이 취소되었습니다.", "info");
    try {
      // DB 반영
      await apiCancelBooking(id);
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:false} : b));
      showToast(err.message ?? "취소 중 오류가 발생했습니다.", "error");
    }
  };

  // user_id 기반 필터 (정확) → fallback: name 기반 (SSO 연동 전)
  const myBookings = useMemo(()=>
    bookings.filter(b => b.user === currentUser),
  [bookings, currentUser]);
  const upcoming = useMemo(()=>myBookings.filter(b=>!b.autoCancelled&&(tsDate(b.start_at)>today||(tsDate(b.start_at)===today&&tsMin(b.end_at)>now))).sort((a,b)=>a.start_at.localeCompare(b.start_at)),[myBookings,today,now]);
  const completed = useMemo(()=>myBookings.filter(b=>!b.autoCancelled&&b.checkedIn&&(tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now))).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[myBookings,today,now]);
  const cancelled = useMemo(()=>myBookings.filter(b=>b.autoCancelled).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[myBookings]);
  const tabData = tab==="upcoming"?upcoming:tab==="completed"?completed:cancelled;

  // 월별 통계 — allMyBookings(전체 이력) 기준
  const monthStats = useMemo(()=>{
    const base = allMyBookings.length > 0 ? allMyBookings : myBookings;
    const prefix=`${statYear}-${fmt2(statMonth+1)}`;
    const mb=base.filter(b=>tsDate(b.start_at).startsWith(prefix));
    const total=mb.length, ci=mb.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length, can=mb.filter(b=>b.autoCancelled).length;
    const rate=total>0?Math.round((ci/total)*100):0;
    const rc={};mb.filter(b=>!b.autoCancelled).forEach(b=>{rc[b.room_id]=(rc[b.room_id]||0)+1;});
    const top=Object.entries(rc).sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
  const topRoom=top?(allRooms.find(r=>r.room_id===Number(top[0])) ?? null):null;
    return{total,checkedIn:ci,cancelled:can,rate,topRoom,topCount:top?top[1]:0};
  },[allMyBookings,myBookings,statYear,statMonth]);

  // 이번달 요약 — allMyBookings(전체 이력) 기준
  const thisPrefix=`${new Date().getFullYear()}-${fmt2(new Date().getMonth()+1)}`;
  const baseForStats = allMyBookings.length > 0 ? allMyBookings : myBookings;
  const thisBks = baseForStats.filter(b => tsDate(b.start_at).startsWith(thisPrefix));
  // 체크인율: 이미 지난 예약만 분모로 (미래 예약 제외)
  const thisPastBks = thisBks.filter(b =>
    tsDate(b.start_at) < today ||
    (tsDate(b.start_at) === today && tsMin(b.end_at) <= now)
  );
  const thisCI = thisPastBks.filter(b => b.checkedIn).length;
  const thisRate = thisPastBks.length > 0 ? Math.round((thisCI / thisPastBks.length) * 100) : 0;

  // 기간별 조회 리스트
  // 기간별 기록은 allMyBookings(전체) 기반, 없으면 myBookings fallback
  const baseBookings = allMyBookings.length > 0 ? allMyBookings : myBookings;

  // ★ 날짜 범위만 적용한 전체 목록 (상태 필터 미적용) — 버튼 카운트 기준
  const dateFilteredList = useMemo(() =>
    baseBookings.filter(b => {
      const d = tsDate(b.start_at);
      return d >= listFrom && d <= listTo;
    }),
  [allMyBookings, myBookings, listFrom, listTo]);

  // ★ Bug Fix: listStats는 dateFilteredList(날짜만 필터) 기준 — 상태 필터 무관하게 고정
  const listStats = {
    all:  dateFilteredList.length,
    up:   dateFilteredList.filter(b => !b.autoCancelled && tsDate(b.start_at) >= today).length,
    done: dateFilteredList.filter(b => (b.checkedIn || b.earlyEnded) && !b.autoCancelled).length,
    can:  dateFilteredList.filter(b => b.autoCancelled).length,
  };

  // 상태 필터까지 적용한 최종 목록
  const filteredList = useMemo(() =>
    dateFilteredList.filter(b => {
      if (listStatus === "upcoming"  && (b.autoCancelled || tsDate(b.start_at) < today)) return false;
      if (listStatus === "completed" && ((!b.checkedIn && !b.earlyEnded) || b.autoCancelled)) return false;
      if (listStatus === "cancelled" && !b.autoCancelled) return false;
      return true;
    }).sort((a, b) => b.start_at.localeCompare(a.start_at)),
  [dateFilteredList, listStatus, today]);

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>

      {/* 프로필 카드 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",marginBottom:20,
        display:"flex",alignItems:isMobile?"flex-start":"center",gap:isMobile?16:20,flexDirection:isMobile?"column":"row"}}>
        <div style={{width:56,height:56,borderRadius:"50%",background:"#111",color:"#fff",
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,flexShrink:0}}>
          {currentUser.charAt(0)}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontWeight:800,color:"#111"}}>{currentUser}</div>
          <div style={{fontSize:13,color:"#64748B",marginTop:2}}>{currentDept} · {userInfo?.email}</div>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:"#111"}}>{allLoading ? "—" : thisBks.length}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>이번 달 예약</div>
          </div>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:800,color:thisRate>=70?"#16A34A":"#D97706"}}>{allLoading ? "—" : `${thisRate}%`}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
          </div>
        </div>
      </div>

      {/* ── 기간별 예약 조회 ── */}
      <div className="anm" style={{background:"#fff",borderRadius:16,overflow:"hidden",marginTop:20,animationDelay:"150ms"}}>
        <div style={{padding:isMobile?"16px 20px":"20px 28px",borderBottom:"1px solid #F1F5F9"}}>
          <div style={{fontSize:15,fontWeight:800,color:"#111",marginBottom:14}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><ClipboardList size={15} strokeWidth={1.8}/>기간별 예약 조회</span></div>
          {/* 날짜 필터 */}
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 140px",minWidth:120}}>
              <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>시작일</label>
              <input type="date" value={listFrom} onChange={e=>setListFrom(e.target.value)}
                style={{width:"100%",padding:"8px 12px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#fff",outline:"none"}}/>
            </div>
            <span style={{color:"#CBD5E1",marginTop:16}}>~</span>
            <div style={{flex:"1 1 140px",minWidth:120}}>
              <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:4}}>종료일</label>
              <input type="date" value={listTo} onChange={e=>setListTo(e.target.value)}
                style={{width:"100%",padding:"8px 12px",borderRadius:10,border:"1px solid #E2E8F0",fontSize:13,background:"#fff",outline:"none"}}/>
            </div>
          </div>
          {/* 상태 필터 */}
          <div style={{display:"flex",gap:6,marginTop:12}}>
            {[{id:"ALL",l:"전체",c:listStats.all},{id:"upcoming",l:"예정",c:listStats.up},{id:"completed",l:"완료",c:listStats.done},{id:"cancelled",l:"취소",c:listStats.can}].map(s=>(
              <button key={s.id} className="btn" onClick={()=>setListStatus(s.id)}
                style={{padding:"5px 12px",fontSize:11,borderRadius:999,
                  background:listStatus===s.id?"#111":"#F8FAFC",color:listStatus===s.id?"#fff":"#64748B",
                  border:listStatus===s.id?"none":"1px solid #E2E8F0"}}>
                {s.l} {s.c}
              </button>
            ))}
          </div>
        </div>

        {/* 리스트 */}
        <div style={{maxHeight:400,overflowY:"auto"}}>
          {filteredList.length===0?(
            <div style={{textAlign:"center",padding:"40px 20px",color:"#CBD5E1"}}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:8}}><Inbox size={32} strokeWidth={1.2} color="#CBD5E1"/></div>
              <div style={{fontSize:13}}>해당 기간에 예약 내역이 없습니다</div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr style={{background:"#F8FAFC"}}>
                  {["날짜/시간","회의명","회의실","상태",""].map(h=>(
                    <th key={h} style={{padding:"8px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:"#94A3B8",whiteSpace:"nowrap",borderBottom:"1px solid #F1F5F9"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredList.map(b=>{
                  const r=allRooms.find(rm=>rm.room_id===b.room_id);
                  const isAdminCancel = b.cancelledBy === 'admin';
                  const isCan = b.autoCancelled;
                  const isDone = b.checkedIn && !isCan;
                  const isUp = !isCan && tsDate(b.start_at) >= today;
                  const isNoshow = isCan && !b.checkedIn && !b.earlyEnded && !isAdminCancel;
                  return(
                    <tr key={b.id} style={{borderBottom:"1px solid #F8FAFC",cursor:"pointer"}}
                      onClick={()=>onDetail(b)}
                      onMouseEnter={e=>e.currentTarget.style.background="#FAFBFD"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap",fontSize:12}}>{fmtTSDateFull(b.start_at)}<br/>{fmtTSRangeFull(b.start_at,b.end_at)}</td>
                      <td style={{padding:"10px 14px",fontWeight:600,color:"#111",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.title}</td>
                      <td style={{padding:"10px 14px",color:"#64748B",whiteSpace:"nowrap"}}>{r?.room_name ?? '?'}</td>
                      <td style={{padding:"10px 14px",whiteSpace:"nowrap"}}>
                        {/* ★ 관리자 강제취소 — 최우선 표시 */}
                        {isAdminCancel && <span style={{background:"#111",color:"#fff",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>관리자 강제취소</span>}
                        {!isAdminCancel && isDone && <span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3,padding:"3px 10px",borderRadius:999}}>완료</span>}
                        {!isAdminCancel && isUp && !isDone && <span style={{background:"#EFF6FF",color:"#3B82F6",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>예정</span>}
                        {!isAdminCancel && isNoshow && <span style={{background:"#FEF3C7",color:"#D97706",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>노쇼</span>}
                        {!isAdminCancel && isCan && !isNoshow && !isDone && <span style={{background:"#F1F5F9",color:"#94A3B8",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:999}}>취소</span>}
                      </td>
                      <td style={{padding:"10px 14px"}}>
                        <button className="btn" onClick={()=>onDetail(b)}
                          style={{background:"#F1F5F9",color:"#64748B",padding:"5px 12px",fontSize:11,borderRadius:10}}>상세</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 월별 통계 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",animationDelay:"100ms",marginTop:32}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:800,color:"#111"}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><BarChart2 size={15} strokeWidth={1.8}/>월별 이용 통계</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button className="btn" onClick={()=>{if(statMonth===0){setStatYear(y=>y-1);setStatMonth(11);}else setStatMonth(m=>m-1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>‹</button>
            <span style={{fontSize:13,fontWeight:700,color:"#111",minWidth:100,textAlign:"center"}}>{statYear}년 {MONTH_NAMES[statMonth]}</span>
            <button className="btn" onClick={()=>{if(statMonth===11){setStatYear(y=>y+1);setStatMonth(0);}else setStatMonth(m=>m+1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>›</button>
          </div>
        </div>
        {monthStats.total===0?(
          <div style={{textAlign:"center",padding:"32px",color:"#CBD5E1",fontSize:13}}>이 달의 예약 데이터가 없습니다</div>
        ):(
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {[{label:"예약",value:monthStats.total,color:"#3B82F6"},{label:"체크인",value:monthStats.checkedIn,color:"#16A34A"},{label:"취소/노쇼",value:monthStats.cancelled,color:"#F59E0B"}].map(bar=>(
              <div key={bar.label}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
                  <span style={{color:"#64748B",fontWeight:600}}>{bar.label}</span><span style={{color:"#111",fontWeight:700}}>{bar.value}건</span>
                </div>
                <div style={{height:8,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${monthStats.total>0?(bar.value/monthStats.total)*100:0}%`,background:bar.color,borderRadius:4,transition:"width 0.4s"}}/>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
                <div style={{fontSize:18,fontWeight:800,color:monthStats.rate>=70?"#16A34A":"#D97706",marginTop:2}}>{monthStats.rate}%</div>
              </div>
              {monthStats.topRoom&&(
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                  <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>가장 많이 이용</div>
                  <div style={{fontSize:13,fontWeight:700,color:"#111",marginTop:2}}>{(monthStats.topRoom as any).room_name} ({monthStats.topCount}회)</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ─── My Booking Weekly View ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
export function MyBookingWeeklyView({bookings, currentUser, rooms=[], onDetail, onCheckIn, onNewBooking, authUser}) {
  const today = todayStr()
  const now   = nowMinutes()
  const [selectedDate, setSelectedDate] = useState(today)
  const { isMobile } = useBreakpoint()

  // 본인 예약만 필터
  const myBookings = bookings.filter(b => b.user === currentUser)

  // 오늘 내 예약 (취소 제외, 사용자가 취소한 것만 제외)
  const todayBookings = myBookings
    .filter(b => tsDate(b.start_at) === today && b.cancelledBy !== 'user')
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  // 주 네비게이션
  const weekStart = getWeekStart(selectedDate)
  const weekEnd   = addDays(weekStart, 6)
  const ws = dateToObj(weekStart), we = dateToObj(weekEnd)
  const weekLabel = `${ws.getFullYear()}년 ${MONTH_NAMES[ws.getMonth()]} ${ws.getDate()}일 – ${MONTH_NAMES[we.getMonth()]} ${we.getDate()}일`

  const goWeek = (dir: number) => setSelectedDate(addDays(selectedDate, dir * 7))

  return (
    <div style={{maxWidth:1280, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>

      {/* ── 오늘 내 예약 — HomeView 동일 카드 UI ── */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12}}>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <span style={{fontSize:15, fontWeight:800, color:"#111"}}>오늘 내 예약</span>
            <span style={{fontSize:12, color:"#94A3B8", fontWeight:500}}>{todayBookings.length}건</span>
          </div>
        </div>

        <div className="flex gap-3 pb-2"
          style={{overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch", paddingRight:4}}>

          {/* + 예약하기 첫 카드 */}
          <button onClick={()=>document.dispatchEvent(new CustomEvent("openNewBooking"))}
            className="btn flex-none flex flex-col items-center justify-center rounded-2xl text-white font-bold"
            style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
              background:"#111111", flexShrink:0, gap:8}}>
            <span style={{fontSize:24, lineHeight:1}}>＋</span>
            <span style={{fontSize:isMobile?12:13}}>예약하기</span>
          </button>

          {todayBookings.length === 0 ? (
            <div className="flex-none flex items-center justify-center rounded-2xl text-slate-300 text-sm"
              style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140, background:"#F3F4F8"}}>
              오늘 예약 없음
            </div>
          ) : todayBookings.map(b => {
            const r = (rooms as any[]).find((r:any) => r.room_id === b.room_id)
            const isActive  = tsMin(b.start_at) <= now && now < tsMin(b.end_at) && !b.autoCancelled
            const isPast    = tsMin(b.end_at) < now
            const minsUntil = tsMin(b.start_at) - now
            const isSoon    = minsUntil > 0 && minsUntil <= 10
            const cardState: string = b.cancelledBy === 'system' ? "noshow"
              : b.autoCancelled ? "cancelled"
              : b.earlyEnded    ? "earlyEnded"
              : b.checkedIn && isActive ? "using"
              : b.checkedIn     ? "done"
              : isActive        ? "checkin"
              : isPast          ? "cancelled"
              : isSoon          ? "soon"
              : "waiting"
            const S: any = {
              pending:    {label:"승인 대기",  btnBg:"#FEF3C7", btnColor:"#92400E", disabled:true,  badge:"승인 대기"},
              noshow:     {label:"노쇼",        btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  badge:"자동취소"},
              soon:       {label:"체크인 대기", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  badge:`${minsUntil}분 뒤`},
              waiting:    {label:"체크인 대기", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  badge:null},
              checkin:    {label:"체크인",       btnBg:"#16A34A", btnColor:"#fff",    disabled:false, badge:null},
              using:      {label:"사용 완료",    btnBg:"#111111", btnColor:"#fff",    disabled:false, badge:"사용중"},
              done:       {label:"완료",         btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  badge:null},
              earlyEnded: {label:"반납 완료",    btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  badge:"반납됨"},
              cancelled:  {label:"자동취소",     btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  badge:null},
            }[cardState]
            const isCancellable = cardState==="waiting" || cardState==="soon" || cardState==="pending"
            return (
              <div key={b.id}
                className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl p-3"
                onClick={()=>onDetail(b)}
                style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
                  flexShrink:0, cursor:"pointer",
                  opacity:(cardState==="cancelled"||cardState==="noshow")?0.45:1,
                  border:cardState==="pending"?"1.5px solid #FCD34D":"none"}}>
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-white leading-snug line-clamp-2" style={{flex:1}}>{b.title}</div>
                    {S.badge && (
                      <span className="flex-shrink-0 text-[9px] font-bold rounded-full px-2 py-0.5 ml-1"
                        style={{background:cardState==="soon"?"#FFF3E0":"#F3F4F8",
                          color:cardState==="soon"?"#EA580C":undefined}}>{S.badge}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">{r?.room_name ?? ''}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRangeFull(b.start_at, b.end_at)}</div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  <button className="btn flex-1 text-[11px] font-bold rounded-xl py-2"
                    onClick={e=>{e.stopPropagation();}}
                    disabled={S.disabled}
                    style={{background:S.btnBg, color:S.btnColor, cursor:S.disabled?"default":"pointer",
                      minHeight:32, display:"flex", alignItems:"center", justifyContent:"center"}}>
                    {S.label}
                  </button>
                  {isCancellable && (
                    <button className="btn text-[11px] font-bold rounded-xl py-2 px-2.5 text-slate-500" style={{background:"#F3F4F8"}}
                      onClick={e=>{e.stopPropagation();}}>취소</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 주간 예약 ── */}
      <div>
        {/* 주 네비게이션 */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 mb-4"
          style={{padding: isMobile?"10px 12px":"12px 18px", display:"flex", alignItems:"center", justifyContent:"center", gap:8, position:"relative"}}>
          <button className="btn rounded-lg text-slate-600"
            style={{padding:"7px 14px", fontSize:20, background:"#F8FAFC", lineHeight:1}}
            onClick={()=>goWeek(-1)}>‹</button>
          <span style={{fontSize:isMobile?14:15, fontWeight:700, color:"#111111", whiteSpace:"nowrap"}}>
            {weekLabel}
          </span>
          <button className="btn rounded-lg text-slate-600"
            style={{padding:"7px 14px", fontSize:20, background:"#F8FAFC", lineHeight:1}}
            onClick={()=>goWeek(1)}>›</button>
          {selectedDate !== today && (
            <button className="btn rounded-lg" style={{padding:"5px 10px", fontSize:11, background:"#111111", color:"#fff", marginLeft:4}}
              onClick={()=>setSelectedDate(today)}>오늘</button>
          )}
        </div>

        {/* WeeklyView */}
        <WeeklyView
          bookings={myBookings}
          selectedDate={selectedDate}
          onDateClick={setSelectedDate}
          onBlockClick={onDetail}
          onEmptyClick={()=>{}}
          onCheckIn={onCheckIn}
          fillContainer={true}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin View ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
