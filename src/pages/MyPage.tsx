import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { BarChart2, ClipboardList, Inbox } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTSFull, fmtTimeFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../utils/time'

import { cancelBooking as apiCancelBooking, upsertBookingAttendees } from '../lib/api'
import { WeeklyView } from '../components/layout/CalendarShell'
import { BookingStatusBadge } from '../components/common/BookingStatusBadge'
import { supabase } from '../lib/supabase'
import { useBreakpoint } from '../hooks/useBreakpoint'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../types'

import { UserAvatar } from '../components/common/UserAvatar'
import { BookingListTable } from '../components/common/BookingListTable'

export function MyPageView({bookings, setBookings, currentUser, currentDept, showToast, isMobile, onDetail, onCheckIn, onEarlyEnd, onCancel, rooms:rp=[], users:up=[], authUserId='', currentUserEmail='', avatarUrl=null}) {
  const [tab, setTab] = useState("upcoming");
  const [statYear, setStatYear] = useState(()=>new Date().getFullYear());
  const [statMonth, setStatMonth] = useState(()=>new Date().getMonth());
  const today = todayStr();
  const now = nowMinutes();
  const allUsers = up;
  const allRooms = rp;
  const userInfo = allUsers.find(u=>u.name===currentUser);

  // 전체 내 예약 기록 (마이페이지 전용 — 기간 제한 없이)
  const [allMyBookings, setAllMyBookings] = useState<Booking[]>([]);
  const [allLoading, setAllLoading] = useState(false);

  // ── 내 예약 전체 fetch (예약자 + 참석자 모두 포함) ──────────────────────────
  // 정책: 내가 예약자이거나 참석자로 등록된 예약 모두 = 내 예약
  useEffect(() => {
    if (!authUserId) return;
    setAllLoading(true);

    const mapRow = (row: any) => ({
      id:            row.id,
      room_id:       row.room_id,
      title:         row.title,
      memo:          row.memo ?? '',
      attendees:     (row.booking_attendees ?? []).map((a: any) => ({
        email: a.email ?? '',
        name:  a.name  ?? '',
      })),
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
    });

    Promise.all([
      // ① 내가 예약자인 예약
      supabase
        .from('bookings')
        .select('*, booking_attendees(email, name)')
        .eq('user_id', authUserId)
        .order('start_at', { ascending: false }),

      // ② 내가 참석자인 예약 ID 목록
      currentUserEmail
        ? supabase
            .from('booking_attendees')
            .select('booking_id')
            .eq('email', currentUserEmail)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]).then(async ([bookerRes, attendeeRes]) => {
      const bookerRows   = bookerRes.data ?? [];
      const attendeeIds  = (attendeeRes.data ?? []).map((a: any) => a.booking_id);

      // ③ 참석자 예약 상세 조회 (예약자 목록과 중복 제거)
      let attendeeRows: any[] = [];
      if (attendeeIds.length > 0) {
        const bookerSet = new Set(bookerRows.map((r: any) => r.id));
        const idsToFetch = attendeeIds.filter((id: string) => !bookerSet.has(id));
        if (idsToFetch.length > 0) {
          const { data } = await supabase
            .from('bookings')
            .select('*, booking_attendees(email, name)')
            .in('id', idsToFetch)
            .order('start_at', { ascending: false });
          attendeeRows = data ?? [];
        }
      }

      // ④ 합치고 날짜 내림차순 정렬
      const merged = [...bookerRows, ...attendeeRows]
        .sort((a: any, b: any) => b.start_at.localeCompare(a.start_at));

      setAllMyBookings(merged.map(mapRow));
      setAllLoading(false);
    });

  }, [authUserId, currentUserEmail]);

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
  // ─────────────────────────────────────────────────────────────────────────
  // ⚠️  참석자 정책 (절대 변경 금지)
  //   "내 예약" = 내가 예약자(user_id)이거나 참석자(booking_attendees.email)인 예약
  //   allMyBookings 가 이 두 조건을 모두 포함해서 fetch함 (위 useEffect 참고)
  //   아래 모든 통계·목록은 allMyBookings 단일 소스 사용 — fallback/분기 없음
  // ─────────────────────────────────────────────────────────────────────────

  // 실시간 탭 뷰 (예정/완료/취소)
  const upcoming  = useMemo(()=>allMyBookings.filter(b=>!b.autoCancelled&&(tsDate(b.start_at)>today||(tsDate(b.start_at)===today&&tsMin(b.end_at)>now))).sort((a,b)=>a.start_at.localeCompare(b.start_at)),[allMyBookings,today,now]);
  const completed = useMemo(()=>allMyBookings.filter(b=>!b.autoCancelled&&b.checkedIn&&(tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now))).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[allMyBookings,today,now]);
  const cancelled = useMemo(()=>allMyBookings.filter(b=>b.autoCancelled).sort((a,b)=>b.start_at.localeCompare(a.start_at)),[allMyBookings]);
  const tabData = tab==="upcoming"?upcoming:tab==="completed"?completed:cancelled;

  // 월별 통계
  const monthStats = useMemo(()=>{
    const prefix=`${statYear}-${fmt2(statMonth+1)}`;
    const mb=allMyBookings.filter(b=>tsDate(b.start_at).startsWith(prefix));
    const total=mb.length, ci=mb.filter(b=>(b.checkedIn||b.earlyEnded)&&!b.autoCancelled).length, can=mb.filter(b=>b.autoCancelled).length;
    const rate=total>0?Math.round((ci/total)*100):0;
    const rc: Record<number,number>={};mb.filter(b=>!b.autoCancelled).forEach(b=>{rc[b.room_id]=(rc[b.room_id]||0)+1;});
    const top=Object.entries(rc).sort((a,b)=>(b[1] as number)-(a[1] as number))[0];
    const topRoom=top?(allRooms.find(r=>r.room_id===Number(top[0]))??null):null;
    return{total,checkedIn:ci,cancelled:can,rate,topRoom,topCount:top?top[1]:0};
  },[allMyBookings,statYear,statMonth]);

  // 이번달 요약
  const thisPrefix  = `${new Date().getFullYear()}-${fmt2(new Date().getMonth()+1)}`;
  const thisBks     = allMyBookings.filter(b=>tsDate(b.start_at).startsWith(thisPrefix));
  const thisPastBks = thisBks.filter(b=>tsDate(b.start_at)<today||(tsDate(b.start_at)===today&&tsMin(b.end_at)<=now));
  const thisCI      = thisPastBks.filter(b=>b.checkedIn).length;
  const thisRate    = thisPastBks.length>0?Math.round((thisCI/thisPastBks.length)*100):0;

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:isMobile?"16px 12px":"28px 24px"}}>

      {/* 프로필 카드 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",marginBottom:20,
        display:"flex",alignItems:isMobile?"flex-start":"center",gap:isMobile?16:20,flexDirection:isMobile?"column":"row"}}>
        <UserAvatar name={currentUser} avatarUrl={avatarUrl} size={56} />
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontWeight:600,color:"#111"}}>{currentUser}</div>
          <div style={{fontSize:13,color:"#64748B",marginTop:2}}>{currentDept} · {userInfo?.email}</div>
        </div>
        <div style={{display:"flex",gap:12}}>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:600,color:"#111"}}>{allLoading ? "—" : thisBks.length}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>이번 달 예약</div>
          </div>
          <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:600,color:thisRate>=70?"#16A34A":"#D97706"}}>{allLoading ? "—" : `${thisRate}%`}</div>
            <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
          </div>
        </div>
      </div>

      {/* ── 기간별 예약 조회 ── */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"16px 16px 20px":"20px 28px 24px",marginTop:20,animationDelay:"150ms"}}>
        <div style={{fontSize:15,fontWeight:600,color:"#111",marginBottom:16,display:"flex",alignItems:"center",gap:6}}>
          <ClipboardList size={15} strokeWidth={1.8}/>기간별 예약 조회
        </div>
        <BookingListTable
          bookings={allMyBookings}
          rooms={allRooms}
          users={allUsers}
          currentUser={currentUser}
          currentUserEmail={currentUserEmail}
          onDetail={onDetail}
          loading={allLoading}
        />
      </div>

      {/* 월별 통계 */}
      <div className="anm" style={{background:"#fff",borderRadius:16,padding:isMobile?"20px":"24px 28px",animationDelay:"100ms",marginTop:32}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:600,color:"#111"}}><span style={{display:"inline-flex",alignItems:"center",gap:6}}><BarChart2 size={15} strokeWidth={1.8}/>월별 이용 통계</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button className="btn" onClick={()=>{if(statMonth===0){setStatYear(y=>y-1);setStatMonth(11);}else setStatMonth(m=>m-1);}}
              style={{background:"#F1F5F9",color:"#64748B",padding:"4px 10px",fontSize:14,borderRadius:8}}>‹</button>
            <span style={{fontSize:13,fontWeight:600,color:"#111",minWidth:100,textAlign:"center"}}>{statYear}년 {MONTH_NAMES[statMonth]}</span>
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
                  <span style={{color:"#64748B",fontWeight:600}}>{bar.label}</span><span style={{color:"#111",fontWeight:600}}>{bar.value}건</span>
                </div>
                <div style={{height:8,background:"#F1F5F9",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${monthStats.total>0?(bar.value/monthStats.total)*100:0}%`,background:bar.color,borderRadius:4,transition:"width 0.4s"}}/>
                </div>
              </div>
            ))}
            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:4}}>
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>체크인율</div>
                <div style={{fontSize:18,fontWeight:600,color:monthStats.rate>=70?"#16A34A":"#D97706",marginTop:2}}>{monthStats.rate}%</div>
              </div>
              {monthStats.topRoom&&(
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",flex:1,minWidth:120}}>
                  <div style={{fontSize:11,color:"#94A3B8",fontWeight:600}}>가장 많이 이용</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#111",marginTop:2}}>{(monthStats.topRoom as any).room_name} ({monthStats.topCount}회)</div>
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
export function MyBookingWeeklyView({bookings, currentUser, rooms=[], onDetail, onCheckIn, onEarlyEnd, onCancel, onNewBooking, authUser}: {bookings:any[], currentUser:string, rooms?:any[], onDetail:(b:any)=>void, onCheckIn:(id:string)=>void, onEarlyEnd:(id:string)=>void, onCancel:(id:string)=>void, onNewBooking:()=>void, authUser:any}) {
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
    <div style={{maxWidth:1400, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>

      {/* ── 오늘 내 예약 — HomeView 동일 카드 UI ── */}
      <div style={{marginBottom:28}}>
        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12}}>
          <div style={{display:"flex", alignItems:"center", gap:8}}>
            <span style={{fontSize:15, fontWeight:600, color:"#111"}}>오늘 내 예약</span>
            <span style={{fontSize:12, color:"#94A3B8", fontWeight:500}}>{todayBookings.length}건</span>
          </div>
        </div>

        <div className="flex gap-3 pb-2"
          style={{overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch", paddingRight:4}}>

          {/* + 예약하기 첫 카드 */}
          <button onClick={()=>document.dispatchEvent(new CustomEvent("openNewBooking"))}
            className="btn flex-none flex flex-col items-center justify-center rounded-2xl text-white font-semibold"
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
            const cardState: string = b.status === 'rejected'       ? "rejected"
              : b.cancelledBy === 'admin'         ? "adminCancel"
              : b.cancelledBy === 'system'        ? "noshow"
              : b.autoCancelled                   ? "cancelled"
              : b.earlyEnded                      ? "earlyEnded"
              : b.checkedIn && isActive           ? "using"
              : b.checkedIn                       ? "done"
              : isActive                          ? "checkin"
              : isPast                            ? "done"
              : b.status === 'pending'            ? "pending"
              : isSoon                            ? "soon"
              : "waiting"
            const S: any = {
              waiting:    {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              soon:       {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              pending:    {label:"승인 대기",    btnBg:"#FEF3C7", btnColor:"#92400E", disabled:true,  action:null,                    showBtn:true},
              checkin:    {label:"체크인",       btnBg:"#16A34A", btnColor:"#fff",    disabled:false, action:()=>onCheckIn(b.id),     showBtn:true},
              using:      {label:"조기반납",     btnBg:"#111111", btnColor:"#fff",    disabled:false, action:()=>onEarlyEnd(b.id),    showBtn:true},
              noshow:     {label:null,           btnBg:"",        btnColor:"",        disabled:true,  action:null,                    showBtn:false},
              done:       {label:"종료",         btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
              earlyEnded: {label:"반납됨",       btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  action:null,                    showBtn:true},
              adminCancel:{label:"강제취소",      btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              rejected:   {label:"거절됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:false},
              cancelled:  {label:"취소됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                    showBtn:true},
            }[cardState] ?? {label:"체크인 대기", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true, action:null, showBtn:true}
            const isCancellable = cardState==="waiting" || cardState==="soon" || cardState==="pending"
            return (
              <div key={b.id}
                className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl p-3"
                onClick={()=>onDetail(b)}
                style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
                  flexShrink:0, cursor:"pointer",
                  opacity:(cardState==="cancelled"||cardState==="noshow"||cardState==="adminCancel"||cardState==="rejected")?0.45:1,
                  border:cardState==="pending"?"1.5px solid #FCD34D":"none"}}>
                <div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2 mb-1.5">{b.title}</div>
                  <div style={{marginBottom:4}}>
                    <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} size="sm" currentUser={currentUser} />
                  </div>
                  <div className="text-[10px] text-slate-400">{r?.room_name ?? ''}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRangeFull(b.start_at, b.end_at)}</div>
                </div>
                <div className="flex gap-1.5 mt-2">
                  {S.showBtn && (
                    <button className="btn flex-1 text-[11px] font-semibold rounded-xl py-2"
                      onClick={e=>{e.stopPropagation(); S.action?.();}}
                      disabled={S.disabled}
                      style={{background:S.btnBg, color:S.btnColor, cursor:S.disabled?"default":"pointer",
                        minHeight:32, display:"flex", alignItems:"center", justifyContent:"center"}}>
                      {S.label}
                    </button>
                  )}
                  {isCancellable && (
                    <button className="btn text-[11px] font-semibold rounded-xl py-2 px-2.5 text-slate-500" style={{background:"#F3F4F8"}}
                      onClick={e=>{e.stopPropagation(); onCancel(b.id);}}>취소</button>
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
          <span style={{fontSize:isMobile?14:15, fontWeight:600, color:"#111111", whiteSpace:"nowrap"}}>
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
          onBlockClick={onDetail}
          onEmptyClick={()=>{}}
          rooms={rooms}
          currentUser={currentUser}
        />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── Admin View ────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
