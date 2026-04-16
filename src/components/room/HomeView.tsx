import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Search, UsersRound, X } from 'lucide-react'
import { useBreakpoint, useVisualViewport } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtRangeFull, fmtTimeFull, fmtTSRangeFull, fmtTSFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { FLOORS, getFloor } from '../../data/floors'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'
import { RoomStatusBadge } from '../common/RoomStatusBadge'
import { BookingStatusBadge } from '../common/BookingStatusBadge'

export function HomeView({bookings, rooms:roomsData=[], tick, searchQ, setSearchQ, filterFloor, setFilterFloor, onBook, onDetail, onBookingDetail, onCheckIn, onEarlyEnd, onCancel, currentUser, currentUserEmail='', dark}) {
  const { isMobile, isTablet } = useBreakpoint();
  const today = todayStr();
  const now   = nowMinutes();
  const nowDisplay = nowStr();
  const [filterStatus,  setFilterStatus]  = useState("ALL");   // ALL | AVAILABLE | BUSY
  const [bookingSort,   setBookingSort]   = useState<'recent' | 'time'>('recent');  // 최근 생성순 | 시간 가까운 순

  const activeRooms = roomsData.filter(r => r.is_active);

  // 검색 + 층 필터
  const filtered = activeRooms.filter(r => {
    const floor = getFloor(r.floor_id);
    const matchSearch = !searchQ || r.room_name.includes(searchQ) || r.room_name_ko?.includes(searchQ) || floor?.floor_name?.includes(searchQ);
    const matchFloor  = filterFloor==="ALL" || r.floor_id === parseInt(filterFloor);
    return matchSearch && matchFloor;
  });

  // 상태별 그룹 (검색+층 필터 적용 후)
  const withStatusAll = filtered.map(r => ({ room: r, status: getRoomStatus(r.room_id, bookings, today) }));
  const availCount = withStatusAll.filter(x => x.status.type==="AVAILABLE").length;
  const busyCount  = withStatusAll.filter(x => x.status.type==="BUSY" || x.status.type==="SOON").length;

  // 상태 필터 적용
  const withStatus = filterStatus==="ALL" ? withStatusAll
    : filterStatus==="AVAILABLE" ? withStatusAll.filter(x => x.status.type==="AVAILABLE")
    : withStatusAll.filter(x => x.status.type==="BUSY" || x.status.type==="SOON");

  const available  = withStatus.filter(x => x.status.type==="AVAILABLE");
  const soon       = withStatus.filter(x => x.status.type==="SOON");
  const busy       = withStatus.filter(x => x.status.type==="BUSY");

  // 오늘 내 예약 — 직접 취소만 제외, 노쇼 자동취소는 유지 (예약자 + 참석자 모두 포함)
  const myBookingsBase = bookings.filter(b =>
    tsDate(b.start_at) === today &&
    b.cancelledBy !== 'user' &&
    (b.user === currentUser ||
     (currentUserEmail && (b.attendees ?? []).some((a: any) => a.email === currentUserEmail)))
  )

  const myBookings = [...myBookingsBase].sort((a, b) => {
    if (bookingSort === 'recent') {
      // 최근 생성순 (createdAt 내림차순 — 가장 최근에 만든 게 앞)
      return b.createdAt - a.createdAt
    } else {
      // 현재 시각과 가까운 순
      const aStart = tsMin(a.start_at), aEnd = tsMin(a.end_at)
      const bStart = tsMin(b.start_at), bEnd = tsMin(b.end_at)
      const aActive   = aStart <= now && now < aEnd
      const bActive   = bStart <= now && now < bEnd
      const aUpcoming = aStart > now
      const bUpcoming = bStart > now
      if (aActive   && !bActive)    return -1
      if (!aActive  && bActive)     return  1
      if (aUpcoming && bUpcoming)   return aStart - bStart
      if (!aUpcoming && !bUpcoming) return bEnd - aEnd
      if (aUpcoming && !bUpcoming)  return -1
      return 1
    }
  })

  return (
    <div>
      {/* ── 오늘 내 예약 (가로 스크롤 스트립) ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">오늘 내 예약</span>
            <span className="text-xs text-slate-400 font-medium">{myBookings.length}건</span>
          </div>
          {/* 정렬 토글 */}
          {myBookings.length > 1 && (
            <div className="flex items-center rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700" style={{fontSize:11}}>
              <button
                onClick={()=>setBookingSort('recent')}
                className="px-2.5 py-1 font-semibold transition-colors"
                style={{
                  background: bookingSort==='recent' ? '#111' : 'transparent',
                  color: bookingSort==='recent' ? '#fff' : '#94A3B8',
                }}>
                최근 생성순
              </button>
              <button
                onClick={()=>setBookingSort('time')}
                className="px-2.5 py-1 font-semibold transition-colors"
                style={{
                  background: bookingSort==='time' ? '#111' : 'transparent',
                  color: bookingSort==='time' ? '#fff' : '#94A3B8',
                }}>
                시간순
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-3 pb-2"
          style={{overflowX:"auto",scrollbarWidth:"none",WebkitOverflowScrolling:"touch",
            paddingLeft:0, paddingRight:4}}>

          {/* + 예약하기 첫 카드 */}
          <button onClick={()=>{/* onBook 없이 새 예약 모달 */document.dispatchEvent(new CustomEvent("openNewBooking"))}}
            className="btn flex-none flex flex-col items-center justify-center rounded-2xl text-white font-semibold"
            style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
              background:"#111111", flexShrink:0, gap:8}}>
            <span style={{fontSize:24, lineHeight:1}}>＋</span>
            <span style={{fontSize:isMobile?12:13}}>예약하기</span>
          </button>

          {myBookings.length === 0 ? (
            <div className="flex-none flex items-center justify-center rounded-2xl text-slate-300 dark:text-slate-600 text-sm"
              style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140, background:"#F3F4F8"}}>
              오늘 예약 없음
            </div>
          ) : myBookings.map(b => {
            const r = roomsData.find(r=>r.room_id===b.room_id);
            const isActive   = tsDate(b.start_at)===today && tsMin(b.start_at)<=now && now<tsMin(b.end_at) && !b.autoCancelled;
            const isPast     = tsMin(b.end_at) < now;
            const minsUntil  = tsMin(b.start_at) - now;   // 시작까지 남은 분
            const isSoon     = minsUntil > 0 && minsUntil <= 10;  // 10분 이내
            const cardState: string = b.status === 'rejected'                                  ? "rejected"
              : b.cancelledBy === 'admin'                                                      ? "adminCancel"
              : b.autoCancelled && b.cancelledBy === 'system' && b.status === 'cancelled'      ? "pendingExpired"
              : b.autoCancelled && b.cancelledBy === 'system' && b.status === 'confirmed'      ? "noshow"
              : b.autoCancelled                                                                ? "cancelled"
              : b.earlyEnded                      ? "earlyEnded"
              : b.checkedIn && isActive           ? "using"
              : b.checkedIn                       ? "done"
              : isActive                          ? "checkin"
              : isPast                            ? "done"
              : b.status === 'pending'            ? "pending"
              : isSoon                            ? "soon"
              : "waiting";

            const S = {
              waiting:    {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:true},
              soon:       {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:true},
              pending:    {label:"승인 대기",    btnBg:"#FEF3C7", btnColor:"#92400E", disabled:true,  action:null,                showBtn:true},
              checkin:    {label:"체크인",       btnBg:"#16A34A", btnColor:"#fff",    disabled:false, action:()=>onCheckIn(b.id), showBtn:true},
              using:      {label:"조기반납",     btnBg:"#111111", btnColor:"#fff",    disabled:false, action:()=>onEarlyEnd(b.id),showBtn:true},
              noshow:        {label:null,           btnBg:"",        btnColor:"",        disabled:true,  action:null,                showBtn:false},
              pendingExpired:{label:null,           btnBg:"",        btnColor:"",        disabled:true,  action:null,                showBtn:false},
              done:       {label:"종료",         btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:true},
              earlyEnded: {label:"반납됨",       btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  action:null,                showBtn:true},
              adminCancel:{label:"강제취소",      btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:false},
              rejected:   {label:"거절됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:false},
              cancelled:  {label:"취소됨",       btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                showBtn:true},
            }[cardState] ?? {label:"체크인 대기", btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true, action:null, showBtn:true};

            const isCancellable = cardState==="waiting" || cardState==="soon" || cardState==="pending";

            return (
              <div key={b.id} className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl p-3"
                onClick={()=>onBookingDetail&&onBookingDetail(b)}
                style={{width:isMobile?"42vw":160, minWidth:140, minHeight:isMobile?120:140,
                  flexShrink:0, opacity: (cardState==="cancelled"||cardState==="noshow"||cardState==="adminCancel"||cardState==="rejected"||cardState==="pendingExpired") ? 0.45 : 1,
                  border: cardState==="pending" ? "1.5px solid #FCD34D" : "none",
                  cursor:"pointer"}}>
                {/* 상단 */}
                <div>
                  {b.recurGroupId && (
                    <span style={{display:'inline-block',background:'#EEF2FF',color:'#4338CA',fontSize:9,fontWeight:600,borderRadius:4,padding:'1px 5px',marginBottom:3,marginRight:3}}>🔁 반복</span>
                  )}
                  {b.user !== currentUser && (
                    <span style={{display:'inline-block',background:'#F0FDF4',color:'#15803D',fontSize:9,fontWeight:600,borderRadius:4,padding:'1px 5px',marginBottom:3}}>참석자</span>
                  )}
                  <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2 mb-1.5">{b.title}</div>
                  <div style={{marginBottom:4}}>
                    <BookingStatusBadge booking={b} room={r} isAdminRoom={!!r?.is_admin_only} size="sm" currentUser={currentUser} />
                  </div>
                  <div className="text-[10px] text-slate-400">{r?.room_name ?? ''}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRangeFull(b.start_at, b.end_at)}</div>
                </div>
                {/* 버튼 영역 */}
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
                    <button className="btn text-[11px] font-semibold rounded-xl py-2 px-2.5 dark:bg-slate-700 text-slate-500 dark:text-slate-400" style={{background:"#F3F4F8"}}
                      onClick={e=>{e.stopPropagation(); onCancel(b.id);}}>취소</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 상태 필터 + 층 필터 + 검색 (한 줄) ── */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto" style={{scrollbarWidth:"none"}}>
        {/* 상태 필터 */}
        {[
          {id:"ALL",label:"전체",count:withStatusAll.length},
          {id:"AVAILABLE",label:"예약가능",count:availCount,badgeBg:"#CBECFF",badgeColor:"#000"},
          {id:"BUSY",label:"사용중",count:busyCount,badgeBg:"#ffdaed",badgeColor:"#000"},
        ].map(s=>(
          <button key={s.id} className="btn flex-shrink-0 font-semibold rounded-full"
            onClick={()=>setFilterStatus(s.id)}
            style={{
              padding:"7px 14px", fontSize:13,
              background: filterStatus===s.id ? "#111111" : (dark?"#334155":"#fff"),
              color:      filterStatus===s.id ? "#fff"    : (dark?"#94A3B8":"#64748B"),
              border:"none",
              display:"flex",alignItems:"center",gap:5,
            }}>
            {s.label}
            <span style={{
              background: filterStatus===s.id ? "rgba(255,255,255,0.2)" : (s.badgeBg || (dark?"#475569":"#F1F5F9")),
              color: filterStatus===s.id ? "#fff" : (s.badgeColor || "#94A3B8"),
              fontSize:11, fontWeight:600, padding:"1px 7px", borderRadius:999,
            }}>{s.count}</span>
          </button>
        ))}

        {/* 구분선 */}
        <div style={{width:1,height:20,background:dark?"#475569":"#E2E8F0",flexShrink:0}}/>

        {/* 층 필터 */}
        {[{id:"ALL",label:"전체층"}, ...FLOORS.map(f=>({id:f.floor_id,label:f?.floor_name}))].map(f=>(
          <button key={f.id} className="btn flex-shrink-0 font-semibold rounded-full"
            onClick={()=>setFilterFloor(f.id==="ALL"?"ALL":f.id)}
            style={{
              padding:"7px 14px", fontSize:13,
              background: filterFloor===(f.id==="ALL"?"ALL":f.id) ? "#111111" : (dark?"#334155":"#fff"),
              color:      filterFloor===(f.id==="ALL"?"ALL":f.id) ? "#fff"    : (dark?"#94A3B8":"#64748B"),
              border: "none",
            }}>
            {f.label}
          </button>
        ))}

        {/* 검색 */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-full flex-1 min-w-[160px]"
          style={{padding:"7px 16px"}}>
          <Search size={14} strokeWidth={1.8} className="text-slate-300 dark:text-slate-500 flex-shrink-0"/>
          <input className="bg-transparent flex-1 text-sm text-slate-900 dark:text-white outline-none min-w-0"
            style={{fontSize:13}}
            placeholder="회의실 이름, 층수로 검색..."
            value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
          {searchQ && <button className="text-slate-300 flex-shrink-0 text-xs" onClick={()=>setSearchQ("")}><X size={10} strokeWidth={1.8}/></button>}
        </div>
      </div>

      {/* ── 회의실 그리드 ── */}
      {withStatus.length===0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="mb-4" style={{display:"flex",justifyContent:"center"}}><Search size={48} strokeWidth={1.8} color="#CBD5E1"/></div>
          <div className="text-lg font-semibold">검색 결과가 없습니다</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {withStatus.map((item,i) => (
            <RoomCard key={item.room.room_id} room={item.room} status={item.status} animDelay={i*40}
              onBook={onBook} onDetail={onDetail} bookings={bookings} onCheckIn={onCheckIn} dark={dark}/>
          ))}
        </div>
      )}
    </div>
  );
}

export function Section({title, count, accent, children}) {
  return (
    <div className="mb-9">
      <div className="flex items-center gap-2.5 mb-4">
        <div style={{width:4,height:20,background:accent,borderRadius:2}} />
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white tracking-tight">{title}</h2>
        <span style={{background:accent+"18",color:accent,fontSize:12,fontWeight:600,padding:"2px 9px",borderRadius:20}}>{count}</span>
      </div>
      {children}
    </div>
  );
}

export function RoomGrid({items, onBook, onDetail, bookings, onCheckIn}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map(({room:r, status},i) => (
        <RoomCard key={r.room_id} room={r} status={status} onBook={onBook} onDetail={onDetail} bookings={bookings} onCheckIn={onCheckIn} animDelay={i*40} />
      ))}
    </div>
  );
}

// ─── Room Card ─────────────────────────────────────────────────────────────────
export function RoomCard({room:r, status, onBook, onDetail, bookings, onCheckIn, animDelay, dark=false}: {room:any,status:any,onBook?:any,onDetail?:any,bookings:any[],onCheckIn?:any,animDelay?:number,dark?:boolean}) {
  const floor    = getFloor(r.floor_id);
  const isBusy   = status.type === "BUSY";
  const isSoon   = status.type === "SOON";
  const isAvail  = status.type === "AVAILABLE";

  const today   = todayStr();
  const now     = nowMinutes();
  const todayBks = bookings
    .filter(b => b.room_id===r.room_id && tsDate(b.start_at)===today && !b.autoCancelled && !b.earlyEnded)
    .sort((a,b) => a.start_at.localeCompare(b.start_at));

  // 현재 진행중인 예약
  const activeBk = todayBks.find(b => tsMin(b.start_at) <= now && now < tsMin(b.end_at));
  // 다음 예약 (현재 시각 이후 가장 가까운 것)
  const nextBk   = todayBks.find(b => tsMin(b.start_at) > now);

  const features  = r.features ?? [];
  const thumbnail = r.thumbnail ?? '';

  return (
    <div className="anm room-card bg-white dark:bg-slate-800 rounded-2xl flex flex-col"
      style={{animationDelay:`${animDelay}ms`, overflow:"hidden", cursor:"pointer"}}
      onClick={()=>onDetail&&onDetail(r)}>

      {/* ── 썸네일 영역 ── */}
      <div style={{width:"100%", height:160, overflow:"hidden", flexShrink:0, background:thumbnail?"#F3F4F8":"rgb(251, 253, 255)", position:"relative"}}>
        {thumbnail ? (
          <img src={thumbnail} alt={r.room_name}
            style={{width:"100%",height:"100%",objectFit:"cover",display:"block",
              filter:(isBusy||isSoon)?"grayscale(40%) brightness(1.08)":"none",
              opacity:(isBusy||isSoon)?0.35:1, transition:"filter 0.3s, opacity 0.3s"}}
            onError={e=>{(e.target as HTMLElement).style.display="none";}}/>
        ) : (
          <div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgb(199, 213, 228)" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>
            </svg>
            <div style={{fontSize:11,color:"rgb(199, 213, 228)",fontWeight:500}}>이미지 준비중</div>
          </div>
        )}
      </div>

      <div className="p-5 flex flex-col gap-3 flex-1">

        {/* ① 상태 칩 */}
        <RoomStatusBadge status={status} />

        {/* ② 회의실명 */}
        <div style={{fontSize:21, fontWeight:600, letterSpacing:"-0.3px", lineHeight:1.2,
          color: (isBusy||isSoon) ? "#94A3B8" : dark?"#fff":"#111111"}}>
          {r.room_name}
        </div>

        {/* ③ 층 + 인원 */}
        <div style={{display:"flex", alignItems:"center", gap:12, fontSize:13,
          color: (isBusy||isSoon) ? "#CBD5E1" : "#64748B"}}>
          <span style={{display:"flex",alignItems:"center",gap:4}}>
            <Layers size={13} strokeWidth={1.8} style={{flexShrink:0}}/>
            <span style={{fontWeight:500}}>{floor?.floor_no}층</span>
          </span>
          <span style={{display:"flex",alignItems:"center",gap:4}}>
            <UsersRound size={13} strokeWidth={1.8} style={{flexShrink:0}}/>
            <span style={{fontWeight:500}}>{r.capacity}명</span>
          </span>
        </div>

        {/* ④ 예약 현황 — 심플 텍스트 리스트 */}
        <div style={{marginTop:"auto", paddingTop:4}}>
          {(() => {
            const futureBks = todayBks.filter(b => tsMin(b.start_at) > now);
            if (activeBk) {
              return (
                <div style={{padding:"10px 16px", background:"#F8FAFC", borderRadius:8}}>
                  <div style={{fontSize:12, color:"#ff1999", marginBottom:0}}>
                    현재 사용 중 · <span style={{fontWeight:600, color:"#475569"}}>{activeBk.title}</span> · <span style={{fontWeight:600, color:"#64748B"}}>{fmtTSFull(activeBk.end_at)}까지</span>
                  </div>
                  {futureBks.length > 0 && (
                    <div style={{fontSize:11, color:"#CBD5E1", marginTop:2}}>
                      이후 예약 {futureBks.length}건
                    </div>
                  )}
                </div>
              );
            }
            if (futureBks.length > 0) {
              return (
                <div style={{padding:"10px 16px", background:"#F8FAFC", borderRadius:8}}>
                  <div style={{fontSize:12, color:"#94A3B8", marginBottom:6}}>
                    오늘 남은 예약&nbsp;
                    <span style={{fontWeight:600, color:"#64748B"}}>
                      {futureBks.length}건
                    </span>
                  </div>
                  <div style={{display:"flex", flexDirection:"column", gap:4}}>
                    {futureBks.slice(0,3).map(b=>(
                      <div key={b.id} style={{display:"flex", justifyContent:"space-between",
                        alignItems:"center", fontSize:12}}>
                        <span style={{color:"#475569", flex:1, overflow:"hidden",
                          textOverflow:"ellipsis", whiteSpace:"nowrap", marginRight:8}}>
                          {b.title}
                        </span>
                        <span style={{color:"#94A3B8", flexShrink:0, whiteSpace:"nowrap"}}>
                          {fmtTSFull(b.start_at)}–{fmtTSFull(b.end_at)}
                        </span>
                      </div>
                    ))}
                    {futureBks.length > 3 && (
                      <div style={{fontSize:11, color:"#CBD5E1"}}>
                        +{futureBks.length-3}건 더
                      </div>
                    )}
                  </div>
                </div>
              );
            }
            return <div style={{padding:"10px 16px", background:"#F8FAFC", borderRadius:8, fontSize:12, color:"#CBD5E1"}}>오늘 남은 예약 없음</div>;
          })()}
        </div>

      </div>

      {/* ⑤ 버튼 */}
      <div style={{display:"flex", alignItems:"center", gap:8, padding:"4px 20px 20px"}}>
        {isAvail && (<>
          <button className="btn" onClick={e=>{e.stopPropagation();onBook(r, status);}}
            style={{flex:1, background:"#111111", color:"#fff", fontWeight:600,
              borderRadius:12, padding:"13px", fontSize:14, textAlign:"center"}}>
            바로 예약
          </button>
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        </>)}
        {isSoon && (<>
          <button className="btn" disabled
            style={{flex:1, background:"#FCE7F3", color:"#BE185D", fontWeight:600,
              borderRadius:12, padding:"13px", fontSize:14, textAlign:"center",
              cursor:"not-allowed", border:"none"}}>
            {status.minsUntil}분 뒤 사용
          </button>
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        </>)}
        {isBusy && (
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        )}
      </div>
    </div>
  );
}

