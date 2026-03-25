import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useBreakpoint, useVisualViewport } from '../../hooks/useBreakpoint'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, FLOORS, getFloor, getRoomFeatures, getRoomById, getRoomThumbnail, getRoomGallery } from '../../data/master'
import { loadBookings, saveBookings, loadRooms, saveRooms, loadUsers, saveUsers } from '../../utils/seed'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

export function HomeView({bookings, rooms:roomsData=ROOMS_DB, tick, searchQ, setSearchQ, filterFloor, setFilterFloor, onBook, onDetail, onCheckIn, onEarlyEnd, onCancel, currentUser, dark}) {
  const { isMobile, isTablet } = useBreakpoint();
  const today = todayStr();
  const now   = nowMinutes();
  const nowDisplay = nowStr();
  const [filterStatus, setFilterStatus] = useState("ALL"); // ALL | AVAILABLE | BUSY

  const activeRooms = roomsData.filter(r => r.is_active);

  // 검색 + 층 필터
  const filtered = activeRooms.filter(r => {
    const floor = getFloor(r.floor_id);
    const matchSearch = !searchQ || r.room_name.includes(searchQ) || r.room_name_ko?.includes(searchQ) || floor.floor_name.includes(searchQ);
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

  // 오늘 내 예약 — 예약 시작 시간 순 정렬 (빠른 시간이 앞)
  // 직접 취소(cancelledBy==='user')는 제외, 노쇼 자동취소(cancelledBy==='system')는 포함
  const myBookings = bookings
    .filter(b =>
      tsDate(b.start_at) === today &&
      b.user === currentUser &&
      b.cancelledBy !== 'user'   // 직접 취소만 제외
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at))

  return (
    <div>
      {/* ── 오늘 내 예약 (가로 스크롤 스트립) ── */}
      <div className="mb-6">
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-sm font-bold text-slate-700 dark:text-slate-200">오늘 내 예약</span>
          <span className="text-xs text-slate-400 font-medium">{myBookings.length}건</span>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2" style={{scrollbarWidth:"none"}}>

          {/* + 예약하기 첫 카드 */}
          <button onClick={()=>{/* onBook 없이 새 예약 모달 */document.dispatchEvent(new CustomEvent("openNewBooking"))}}
            className="btn flex-none flex flex-col items-center justify-center rounded-2xl text-white font-bold"
            style={{width:160, minHeight:140, background:"#111111", flexShrink:0, gap:8}}>
            <span style={{fontSize:28, lineHeight:1}}>＋</span>
            <span style={{fontSize:13}}>예약하기</span>
          </button>

          {myBookings.length === 0 ? (
            <div className="flex-none flex items-center justify-center rounded-2xl text-slate-300 dark:text-slate-600 text-sm"
              style={{width:160, minHeight:140, background:"#F3F4F8"}}>
              오늘 예약 없음
            </div>
          ) : myBookings.map(b => {
            const r = ROOMS_DB.find(r=>r.room_id===b.room_id);
            const isActive  = tsDate(b.start_at)===today && tsMin(b.start_at)<=now && now<tsMin(b.end_at) && !b.autoCancelled;
            const isPast    = tsMin(b.end_at) < now;
            const cardState = b.cancelledBy === 'system' ? "noshow"    // 노쇼 자동취소 — 흐릿하게 유지
              : b.autoCancelled              ? "cancelled"  // 기타 취소
              : b.earlyEnded                ? "earlyEnded"
              : b.checkedIn && isActive     ? "using"
              : b.checkedIn                 ? "done"
              : isActive                    ? "checkin"
              : isPast                      ? "cancelled"
              : "waiting";

            const S = {
              noshow:     {label:"미체크인",     btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                badge:"자동취소"},
              waiting:    {label:"체크인 대기",  btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                badge:null},
              checkin:    {label:"체크인",        btnBg:"#16A34A", btnColor:"#fff",    disabled:false, action:()=>onCheckIn(b.id), badge:null},
              using:      {label:"사용 완료",     btnBg:"#111111", btnColor:"#fff",    disabled:false, action:()=>onEarlyEnd(b.id),badge:"사용 중"},
              done:       {label:"완료",          btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  action:null,                badge:null},
              earlyEnded: {label:"반납 완료",     btnBg:"#DBEAFE", btnColor:"#2563EB", disabled:true,  action:null,                badge:"반납됨"},
              cancelled:  {label:"자동취소",      btnBg:"#F1F5F9", btnColor:"#94A3B8", disabled:true,  action:null,                badge:null},
            }[cardState];

            const isCancellable = cardState==="waiting";

            return (
              <div key={b.id} className="flex-none flex flex-col justify-between bg-white dark:bg-slate-800 rounded-2xl p-3"
                style={{width:160, minHeight:140, flexShrink:0, opacity: (cardState==="cancelled" || cardState==="noshow") ? 0.45 : 1}}>
                {/* 상단 */}
                <div>
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div className="text-xs font-bold text-slate-900 dark:text-white leading-snug line-clamp-2" style={{flex:1}}>{b.title}</div>
                    {S.badge && (
                      <span className="flex-shrink-0 text-[9px] font-bold dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full px-2 py-0.5 ml-1" style={{background:"#F3F4F8"}}>{S.badge}</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400">{r?.room_name}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtTSRange(b.start_at, b.end_at)}</div>
                </div>
                {/* 버튼 영역 */}
                <div className="flex gap-1.5 mt-2">
                  <button className="btn flex-1 text-[11px] font-bold rounded-xl py-2"
                    onClick={e=>{e.stopPropagation(); S.action?.();}}
                    disabled={S.disabled}
                    style={{background:S.btnBg, color:S.btnColor, cursor:S.disabled?"default":"pointer"}}>
                    {S.label}
                  </button>
                  {isCancellable && (
                    <button className="btn text-[11px] font-bold rounded-xl py-2 px-2.5 dark:bg-slate-700 text-slate-500 dark:text-slate-400" style={{background:"#F3F4F8"}}
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
          <button key={s.id} className="btn flex-shrink-0 font-bold rounded-full"
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
              fontSize:11, fontWeight:700, padding:"1px 7px", borderRadius:999,
            }}>{s.count}</span>
          </button>
        ))}

        {/* 구분선 */}
        <div style={{width:1,height:20,background:dark?"#475569":"#E2E8F0",flexShrink:0}}/>

        {/* 층 필터 */}
        {[{id:"ALL",label:"전체층"}, ...FLOORS.map(f=>({id:f.floor_id,label:f.floor_name}))].map(f=>(
          <button key={f.id} className="btn flex-shrink-0 font-bold rounded-full"
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
          {searchQ && <button className="text-slate-300 flex-shrink-0 text-xs" onClick={()=>setSearchQ("")}><X size={10} strokeWidth={2}/></button>}
        </div>
      </div>

      {/* ── 회의실 그리드 ── */}
      {withStatus.length===0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="mb-4" style={{display:"flex",justifyContent:"center"}}><Search size={48} strokeWidth={1.2} color="#CBD5E1"/></div>
          <div className="text-lg font-semibold">검색 결과가 없습니다</div>
        </div>
      ) : (
        <div style={{display:"grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "repeat(2,1fr)" : "repeat(3,1fr)", gap:16}}>
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
    <div style={{marginBottom:36}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <div style={{width:4,height:20,background:accent,borderRadius:2}} />
        <h2 style={{fontSize:18,fontWeight:800,color:"#111111",letterSpacing:"-0.3px"}}>{title}</h2>
        <span style={{background:accent+"18",color:accent,fontSize:12,fontWeight:700,padding:"2px 9px",borderRadius:20}}>{count}</span>
      </div>
      {children}
    </div>
  );
}

export function RoomGrid({items, onBook, onDetail, bookings, onCheckIn}) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
      {items.map(({room:r, status},i) => (
        <RoomCard key={r.room_id} room={r} status={status} onBook={onBook} onDetail={onDetail} bookings={bookings} onCheckIn={onCheckIn} animDelay={i*40} />
      ))}
    </div>
  );
}

// ─── Room Card ─────────────────────────────────────────────────────────────────
export function RoomCard({room:r, status, onBook, onDetail, bookings, onCheckIn, animDelay, dark=false}) {
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

  const features  = getRoomFeatures(r.room_id);
  const thumbnail = getRoomThumbnail(r.room_id);

  return (
    <div className="anm room-card bg-white dark:bg-slate-800 rounded-2xl flex flex-col"
      style={{animationDelay:`${animDelay}ms`, overflow:"hidden"}}>

      {/* ── 썸네일 영역 ── */}
      <div style={{width:"100%", height:160, overflow:"hidden", flexShrink:0, background:thumbnail?"#F3F4F8":"rgb(251, 253, 255)", position:"relative", cursor:"pointer"}}
        onClick={()=>onDetail&&onDetail(r)}>
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
        <div style={{display:"flex", alignItems:"center", gap:6, flexWrap:"wrap"}}>
          {isAvail && (
            <span style={{background:"#CBECFF", color:"#111111", fontSize:12, fontWeight:700,
              padding:"5px 14px", borderRadius:999,
              display:"inline-flex", alignItems:"center", gap:6}}>
              <span style={{width:7,height:7,borderRadius:"50%",background:"#111111",
                display:"inline-block",flexShrink:0}}/>
              예약가능
            </span>
          )}
          {isBusy && (<>
            <span style={{background:"#FCE7F3", color:"#BE185D", fontSize:12, fontWeight:700,
              padding:"5px 14px", borderRadius:999,
              display:"inline-flex", alignItems:"center", gap:6}}>
              <span className="rec-dot" style={{width:7,height:7,borderRadius:"50%",background:"#EC4899",
                display:"inline-block",flexShrink:0}}/>
              사용중
            </span>
            <span style={{background:"#F8FAFC", color:"#64748B", fontSize:12, fontWeight:600,
              padding:"5px 14px", borderRadius:999, border:"none"}}>
              {status.minsLeft}분 뒤 종료
            </span>
          </>)}
          {isSoon && (<>
            <span style={{background:"#FCE7F3", color:"#BE185D", fontSize:12, fontWeight:700,
              padding:"5px 14px", borderRadius:999}}>
              {status.minsUntil}분 뒤 사용
            </span>
            <span style={{background:"#F8FAFC", color:"#64748B", fontSize:12, fontWeight:600,
              padding:"5px 14px", borderRadius:999, border:"none"}}>
              {fmtTime(status.nextStart)} 까지
            </span>
          </>)}
        </div>

        {/* ② 회의실명 */}
        <div style={{fontSize:21, fontWeight:700, letterSpacing:"-0.3px", lineHeight:1.2,
          color: (isBusy||isSoon) ? "#94A3B8" : dark?"#fff":"#111111"}}>
          {r.room_name}
        </div>

        {/* ③ 층 + 인원 */}
        <div style={{display:"flex", alignItems:"center", gap:12, fontSize:13,
          color: (isBusy||isSoon) ? "#CBD5E1" : "#64748B"}}>
          <span style={{display:"flex",alignItems:"center",gap:4}}>
            <Layers size={13} strokeWidth={1.8} style={{flexShrink:0}}/>
            <span style={{fontWeight:500}}>{floor.floor_no}층</span>
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
                    현재 사용 중 · <span style={{fontWeight:600, color:"#475569"}}>{activeBk.title}</span> · <span style={{fontWeight:600, color:"#64748B"}}>{fmtTS(activeBk.end_at)}까지</span>
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
                          {fmtTS(b.start_at)}-{fmtTS(b.end_at)}
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
          <button className="btn" onClick={()=>onBook(r, status)}
            style={{flex:1, background:"#111111", color:"#fff", fontWeight:700,
              borderRadius:12, padding:"13px", fontSize:14, textAlign:"center"}}>
            바로 예약
          </button>
          <button className="btn" onClick={()=>onDetail(r)}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        </>)}
        {isSoon && (<>
          <button className="btn" disabled
            style={{flex:1, background:"#FCE7F3", color:"#BE185D", fontWeight:700,
              borderRadius:12, padding:"13px", fontSize:14, textAlign:"center",
              cursor:"not-allowed", border:"none"}}>
            {status.minsUntil}분 뒤 사용
          </button>
          <button className="btn" onClick={()=>onDetail(r)}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        </>)}
        {isBusy && (
          <button className="btn" onClick={()=>onDetail(r)}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:14, padding:"13px", cursor:"pointer", textAlign:"center"}}>
            자세히 보기
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Room Detail Modal ────────────────────────────────────────────────────────
export function RoomDetailModal({room:r, bookings, onClose, onBook}) {
  const { isMobile } = useBreakpoint();
  const floor    = getFloor(r.floor_id);
  const features = getRoomFeatures(r.room_id);
  const today    = todayStr();
  const todayBks = bookings.filter(b=>b.room_id===r.room_id&&tsDate(b.start_at)===today&&!b.autoCancelled&&!b.earlyEnded).sort((a,b)=>a.start_at.localeCompare(b.start_at));
  const status   = getRoomStatus(r.room_id, bookings, today);
  const thumbnail = getRoomThumbnail(r.room_id);

  const [lightbox, setLightbox] = useState(false);

  return (
    <>
    {/* 라이트박스 — 썸네일 확대 */}
    {lightbox && thumbnail && (
      <div onClick={()=>setLightbox(false)}
        style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.92)",
          display:"flex",alignItems:"center",justifyContent:"center",cursor:"zoom-out"}}>
        <img src={thumbnail} alt={r.room_name}
          onClick={e=>e.stopPropagation()}
          style={{maxWidth:"90vw",maxHeight:"85vh",objectFit:"contain",borderRadius:12,
            boxShadow:"0 8px 40px rgba(0,0,0,0.6)",cursor:"default"}}/>
        <button onClick={()=>setLightbox(false)}
          style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.15)",
            border:"none",borderRadius:"50%",width:36,height:36,color:"#fff",
            cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><X size={16} strokeWidth={2}/></button>
      </div>
    )}

    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 16,
      width:"100%", maxWidth: isMobile ? "100%" : 760,
      maxHeight: isMobile ? "88vh" : "90vh",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      overflow:"hidden", display:"flex", flexDirection:"column",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:1}}/>}

      {/* ── 헤더 바 ── */}
      <div style={{padding: isMobile ? "20px 20px 14px" : "18px 28px 14px",
        borderBottom:"1px solid #F1F5F9", display:"flex", justifyContent:"space-between",
        alignItems:"center", flexShrink:0}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
            <div style={{fontSize: isMobile ? 17 : 20, fontWeight:800, color:"#111111"}}>{r.room_name}</div>
            {status.type==="AVAILABLE"&&<span className="chip" style={{background:"#CBECFF",color:"#111"}}>예약가능</span>}
            {status.type==="BUSY"&&<span className="chip" style={{background:"#FEE2E2",color:"#DC2626"}}>사용중</span>}
            {status.type==="SOON"&&<span className="chip" style={{background:"#FEF3C7",color:"#D97706"}}>곧 사용</span>}
          </div>
          <div style={{fontSize:12,color:"#64748B"}}>{r.room_name_ko} · {floor.floor_name} · {r.capacity}인 수용</div>
        </div>
        <button className="btn" onClick={onClose}
          style={{width:32,height:32,borderRadius:"50%",background:"#F1F5F9",
            color:"#64748B",flexShrink:0,
            display:"flex",alignItems:"center",justifyContent:"center"}}><X size={14} strokeWidth={2}/></button>
      </div>

      {/* ── 본문: 데스크톱 2컬럼 / 모바일 1컬럼 ── */}
      <div style={{flex:1, overflowY:"auto"}}>
        <div style={{
          display: isMobile ? "flex" : "grid",
          gridTemplateColumns: isMobile ? undefined : "1fr 1fr",
          flexDirection: isMobile ? "column" : undefined,
          gap: 0,
        }}>

          {/* ── LEFT: 썸네일 + 기본 정보 ── */}
          <div style={{
            padding: isMobile ? "16px 20px" : "20px 24px",
            borderRight: isMobile ? "none" : "1px solid #F1F5F9",
            display:"flex", flexDirection:"column", gap:12,
          }}>
            {/* 썸네일 — 클릭 시 라이트박스 */}
            <div style={{width:"100%", height: isMobile ? 180 : 200, borderRadius:12, overflow:"hidden",
              background:thumbnail?"#F3F4F8":"rgb(251, 253, 255)", cursor: thumbnail ? "zoom-in" : "default"}}
              onClick={()=>thumbnail&&setLightbox(true)}>
              {thumbnail ? (
                <img src={thumbnail} alt={r.room_name}
                  style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}
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

            {/* 기본 정보 카드 */}
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {[
                ["수용인원", `${r.capacity}명`],
                ["위치",     floor.floor_name],
              ].map(([label,val],i)=>(
                <div key={i} style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>{label}</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600}}>{val}</div>
                </div>
              ))}

              {r.notes && (
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>설명</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600,wordBreak:"break-word"}}>{r.notes}</div>
                </div>
              )}

              {/* 설비 — 텍스트 */}
              {features.length>0 && (
                <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",display:"flex",gap:10}}>
                  <div style={{fontSize:11,color:"#94A3B8",minWidth:60,fontWeight:600,flexShrink:0}}>설비</div>
                  <div style={{fontSize:13,color:"#111111",fontWeight:600}}>
                    {features.map(f=>f.value_text||f.feature_name).join(", ")}
                  </div>
                </div>
              )}

              {/* Admin 전용 안내 */}
              {ADMIN_ONLY_ROOMS.has(r.room_id) && (
                <div style={{background:"#EEF2FF",borderRadius:10,padding:"10px 14px",
                  display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#4338CA",fontWeight:600}}>
                  관리자(Admin) 전용 예약 회의실
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT: 상태 + 오늘 예약 현황 ── */}
          <div style={{
            padding: isMobile ? "0 20px 16px" : "20px 24px",
            display:"flex", flexDirection:"column", gap:12,
          }}>
            {/* 현재 상태 상세 */}
            {status.type==="BUSY" && (
              <div style={{background:"#FEF2F2",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#DC2626",fontWeight:700,marginBottom:6}}>현재 사용 중</div>
                <div style={{fontSize:14,color:"#111111",fontWeight:700}}>{status.booking?.title}</div>
                <div style={{fontSize:12,color:"#64748B",marginTop:4}}>{fmtTime(status.endTime)}까지 · {status.minsLeft}분 남음</div>
              </div>
            )}
            {status.type==="SOON" && (
              <div style={{background:"#FFFBEB",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#D97706",fontWeight:700,marginBottom:6}}>사용 예정</div>
                <div style={{fontSize:14,color:"#111111",fontWeight:700}}>{status.minsUntil}분 후 사용 시작</div>
                <div style={{fontSize:12,color:"#64748B",marginTop:4}}>{fmtTime(status.nextStart)} 부터</div>
              </div>
            )}
            {status.type==="AVAILABLE" && (
              <div style={{background:"#E8F4FF",borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:11,color:"#0369A1",fontWeight:700,marginBottom:4}}>예약 가능</div>
                <div style={{fontSize:13,color:"#111111",fontWeight:600}}>지금 바로 이용 가능합니다</div>
              </div>
            )}

            {/* 오늘 예약 현황 — 리스트 */}
            <div>
              <div style={{fontSize:12,fontWeight:700,color:"#111111",marginBottom:10,
                display:"flex",alignItems:"center",gap:6}}>
                <span>오늘 예약 현황</span>
                <span style={{fontSize:11,color:"#fff",fontWeight:700,background:"#111",
                  borderRadius:999,padding:"1px 7px"}}>{todayBks.length}건</span>
              </div>
              {todayBks.length===0
                ? <div style={{background:"#F8FAFC",borderRadius:10,padding:"20px",
                    textAlign:"center",fontSize:12,color:"#CBD5E1"}}>
                    오늘 예약이 없습니다
                  </div>
                : <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {todayBks.map(b => {
                      const bNow = nowMinutes();
                      const isActive = tsMin(b.start_at) <= bNow && bNow < tsMin(b.end_at);
                      return (
                        <div key={b.id} style={{
                          background: isActive ? "#FFF1F2" : "#F8FAFC",
                          border: isActive ? "1px solid #FECDD3" : "1px solid transparent",
                          borderRadius:10, padding:"10px 14px",
                          display:"flex", justifyContent:"space-between", alignItems:"center",
                        }}>
                          <div style={{flex:1,minWidth:0,marginRight:10}}>
                            <div style={{fontSize:13,color:"#111111",fontWeight:600,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              {isActive && <Circle size={7} fill="#E11D48" strokeWidth={0} style={{marginRight:4,flexShrink:0,display:"inline-block",verticalAlign:"middle"}}/>}
                              {b.title}
                            </div>
                            <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{b.user} · {b.dept}</div>
                          </div>
                          <div style={{fontSize:12,color:"#64748B",fontWeight:600,flexShrink:0,textAlign:"right"}}>
                            {fmtTS(b.start_at)}<br/>
                            <span style={{color:"#94A3B8",fontWeight:400}}>~ {fmtTS(b.end_at)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── 버튼 footer — 상태와 무관하게 항상 노출 ── */}
      <div style={{padding: isMobile ? "12px 20px 24px" : "12px 28px 20px",
        flexShrink:0, borderTop:"1px solid #F1F5F9"}}>
        <button className="btn" onClick={()=>onBook(status)}
          style={{width:"100%", background:"#111111", color:"#fff", padding:"13px 8px",
            fontSize:14, fontWeight:700, borderRadius:12}}>
          이 회의실 예약하기
        </button>
      </div>
    </div>
    </>
  );
}

