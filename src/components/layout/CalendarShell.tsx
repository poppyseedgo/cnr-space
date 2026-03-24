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

export function CalendarShell({bookings, selectedDate, setSelectedDate, calView, setCalView, onBookingClick, onNewBooking, onCheckIn, filterFloor, setFilterFloor}) {
  const { isMobile, isTablet } = useBreakpoint();
  const VIEWS=[{id:"timeline",label:"타임라인"},{id:"monthly",label:"월"},{id:"weekly",label:"주"},{id:"daily",label:"일"}];
  const navLabel=()=>{
    const d=dateToObj(selectedDate);
    if(calView==="monthly") return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]}`;
    if(calView==="weekly"){const ws=getWeekStart(selectedDate),we=addDays(ws,6),wd=dateToObj(ws),wed=dateToObj(we);return `${wd.getFullYear()}년 ${MONTH_NAMES[wd.getMonth()]} ${wd.getDate()}일 – ${MONTH_NAMES[wed.getMonth()]} ${wed.getDate()}일`;}
    return `${d.getFullYear()}년 ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
  };
  const navigate=(dir)=>{
    if(calView==="monthly"){const d=dateToObj(selectedDate);d.setMonth(d.getMonth()+dir);setSelectedDate(objToStr(d));}
    else if(calView==="weekly") setSelectedDate(addDays(selectedDate,dir*7));
    else setSelectedDate(addDays(selectedDate,dir));
  };

  const filteredRooms = filterFloor==="ALL" ? ROOMS_DB.filter(r=>r.is_active) : ROOMS_DB.filter(r=>r.is_active&&r.floor_id===parseInt(filterFloor));
  const filteredBks = filterFloor==="ALL" ? bookings : bookings.filter(b=>filteredRooms.some(r=>r.room_id===b.room_id));

  // ── 커스텀 날짜 피커 state ──
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dpYear, setDpYear]   = useState(() => dateToObj(selectedDate).getFullYear());
  const [dpMonth, setDpMonth] = useState(() => dateToObj(selectedDate).getMonth());
  const dpRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if(dpRef.current && !dpRef.current.contains(e.target)) setShowDatePicker(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // 선택 날짜가 외부에서 바뀌면 피커 월도 동기화
  useEffect(() => {
    const d = dateToObj(selectedDate);
    setDpYear(d.getFullYear());
    setDpMonth(d.getMonth());
  }, [selectedDate]);

  const today = todayStr();
  const dpPrevMonth = () => { if(dpMonth===0){setDpYear(y=>y-1);setDpMonth(11);}else setDpMonth(m=>m-1); };
  const dpNextMonth = () => { if(dpMonth===11){setDpYear(y=>y+1);setDpMonth(0);}else setDpMonth(m=>m+1); };
  const dpSelectDate = (ds) => { setSelectedDate(ds); setShowDatePicker(false); };

  const dpFirstDay    = new Date(dpYear, dpMonth, 1).getDay();
  const dpDaysInMonth = new Date(dpYear, dpMonth+1, 0).getDate();
  const dpCells       = [];
  for(let i=0; i<dpFirstDay; i++) dpCells.push(null);
  for(let i=1; i<=dpDaysInMonth; i++) dpCells.push(i);
  while(dpCells.length%7!==0) dpCells.push(null);

  return (
    <div>
      {/* 툴바 — 단일 flex 1행 */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 mb-4"
        style={{padding: isMobile ? "10px 12px" : "12px 18px",
          display:"flex", alignItems:"center", gap: isMobile ? 6 : 10, flexWrap:"nowrap",
          position:"relative", zIndex:50}}>

        {/* 뷰 탭 — left */}
        <div className="flex dark:bg-slate-700 rounded-xl p-0.5 gap-0.5" style={{background:"#F3F4F8",flexShrink:0,justifyContent:"center"}}>
          {VIEWS.map(v=>(
            <button key={v.id} className="btn rounded-lg font-semibold"
              onClick={()=>setCalView(v.id)}
              style={{
                background: calView===v.id ? "#111111" : "transparent",
                color:      calView===v.id ? "#fff"    : "#64748B",
                padding:    isMobile ? "7px 10px" : "8px 16px",
                fontSize:   14,
                whiteSpace: "nowrap",
                flexShrink: 0,
                textAlign:  "center",
              }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* 날짜 네비 — absolute center */}
        <div className="flex items-center gap-1.5"
          style={{position:"absolute", left:"50%", transform:"translateX(-50%)", flexShrink:0, zIndex:51}}>
          <button className="btn dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg flex-shrink-0"
            style={{padding:"7px 14px", fontSize:20, background:"#FFFFFF", lineHeight:1}} onClick={()=>navigate(-1)}>‹</button>

          {(calView==="timeline"||calView==="daily") ? (
            <div ref={dpRef} style={{position:"relative",flex:1,minWidth:0}}>
              <button className="btn dark:bg-slate-700 rounded-lg"
                onClick={()=>setShowDatePicker(v=>!v)}
                style={{width:"100%",padding:"5px 14px",background:"#FFFFFF",whiteSpace:"nowrap",
                  border:showDatePicker?"1px solid #111111":"1px solid transparent",
                  display:"flex",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:isMobile?14:16,fontWeight:700,color:"#111111"}}>
                  <Calendar size={14} strokeWidth={1.8}/> {selectedDate} ({DAY_NAMES[dateToObj(selectedDate).getDay()]})
                </span>
                {showDatePicker ? null : null}
              </button>
              {showDatePicker && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:"50%",transform:"translateX(-50%)",zIndex:9999,
                  background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                  boxShadow:"0 8px 32px rgba(0,0,0,0.12)",padding:"14px",minWidth:260}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <button className="btn" onClick={e=>{e.stopPropagation();dpPrevMonth();}}
                      style={{background:"none",color:"#111111",padding:"4px 10px",fontSize:16}}>‹</button>
                    <span style={{fontSize:14,fontWeight:700,color:"#111111"}}>{dpYear}년 {MONTH_NAMES[dpMonth]}</span>
                    <button className="btn" onClick={e=>{e.stopPropagation();dpNextMonth();}}
                      style={{background:"none",color:"#111111",padding:"4px 10px",fontSize:16}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                    {DAY_NAMES.map((n,i)=>(
                      <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:700,
                        color:i===0?"#EF4444":i===6?"#3B82F6":"#94A3B8",padding:"2px 0"}}>{n}</div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                    {dpCells.map((day,idx)=>{
                      if(!day) return <div key={`e${idx}`}/>;
                      const ds=`${dpYear}-${fmt2(dpMonth+1)}-${fmt2(day)}`;
                      const isSel=ds===selectedDate, isToday2=ds===today;
                      const dow=(dpFirstDay+day-1)%7;
                      return (
                        <div key={day} onClick={()=>dpSelectDate(ds)}
                          style={{textAlign:"center",padding:"5px 2px",borderRadius:6,fontSize:12,
                            fontWeight:isSel||isToday2?700:400,
                            background:isSel?"#111111":isToday2?"#EFF6FF":"transparent",
                            color:isSel?"#fff":isToday2?"#3B82F6":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151",
                            cursor:"pointer"}}
                          onMouseEnter={e=>{if(!isSel)e.currentTarget.style.background="#F1F5F9";}}
                          onMouseLeave={e=>{if(!isSel)e.currentTarget.style.background=isToday2?"#EFF6FF":"transparent";}}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #F1F5F9",textAlign:"center"}}>
                    <button className="btn" onClick={()=>dpSelectDate(today)}
                      style={{background:"#111111",color:"#fff",padding:"5px 16px",fontSize:11,borderRadius:8}}>
                      오늘로 이동
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="font-bold text-slate-900 dark:text-white whitespace-nowrap"
              style={{fontSize: isMobile ? 14 : 16, flex:1, textAlign:"center"}}>
              {navLabel()}
            </span>
          )}

          <button className="btn dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg flex-shrink-0"
            style={{padding:"7px 14px", fontSize:20, background:"#FFFFFF", lineHeight:1}} onClick={()=>navigate(1)}>›</button>
          {selectedDate!==todayStr() && (
            <button className="btn bg-slate-900 dark:bg-slate-700 text-white dark:text-slate-900 rounded-lg flex-shrink-0"
              style={{padding:"5px 10px", fontSize:11}} onClick={()=>setSelectedDate(todayStr())}>오늘</button>
          )}
        </div>

        {/* 층 필터 — right */}
        <div className="flex gap-1.5" style={{marginLeft:"auto",justifyContent:"flex-end",flexWrap:"nowrap",overflow:"hidden"}}>
          {[{id:"ALL",label:"전체"},...FLOORS.map(f=>({id:f.floor_id,label:f.floor_name}))].map(f=>(
            <button key={f.id} className="btn rounded-full flex-shrink-0 border"
              onClick={()=>setFilterFloor(f.id==="ALL"?"ALL":f.id)}
              style={{
                padding: isMobile ? "4px 8px" : "4px 12px",
                fontSize: isMobile ? 10 : 11,
                background: filterFloor===(f.id==="ALL"?"ALL":f.id) ? "#111111" : "transparent",
                color:      filterFloor===(f.id==="ALL"?"ALL":f.id) ? "#fff"    : "#64748B",
                borderColor: filterFloor===(f.id==="ALL"?"ALL":f.id) ? "#111111" : "#E2E8F0",
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {calView==="monthly"  && <MonthlyView bookings={filteredBks} selectedDate={selectedDate} onDayClick={d=>{setSelectedDate(d);setCalView("daily");}} onBookingClick={onBookingClick} />}
      {calView==="weekly"   && <WeeklyView  bookings={filteredBks} selectedDate={selectedDate} onDateClick={setSelectedDate} onBlockClick={onBookingClick} onEmptyClick={(d,h)=>onNewBooking(d,h,null)} onCheckIn={onCheckIn} />}
      {calView==="daily"    && <DailyView   bookings={filteredBks.filter(b=>tsDate(b.start_at)===selectedDate)} selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(rid,h)=>onNewBooking(selectedDate,h,rid)} onCheckIn={onCheckIn} />}
      {calView==="timeline" && <TimelineView bookings={filteredBks.filter(b=>tsDate(b.start_at)===selectedDate)} rooms={filteredRooms} selectedDate={selectedDate} onBlockClick={onBookingClick} onEmptyClick={(rid,h)=>onNewBooking(selectedDate,h,rid)} onCheckIn={onCheckIn} />}
    </div>
  );
}

// ─── Calendar Sub-Views ───────────────────────────────────────────────────────
export function MonthlyView({bookings,selectedDate,onDayClick,onBookingClick}) {
  const d=dateToObj(selectedDate),year=d.getFullYear(),month=d.getMonth();
  const firstDay=new Date(year,month,1).getDay();
  const dim=new Date(year,month+1,0).getDate();
  const today=todayStr();
  const cells=[];
  for(let i=0;i<firstDay;i++) cells.push(null);
  for(let i=1;i<=dim;i++) cells.push(i);
  while(cells.length%7!==0) cells.push(null);
  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",overflow:"hidden"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#F8FAFC",borderBottom:"1px solid #E2E8F0"}}>
        {DAY_NAMES.map((n,i)=><div key={n} style={{padding:"10px 0",textAlign:"center",fontSize:12,fontWeight:700,color:i===0?"#EF4444":i===6?"#3B82F6":"#64748B"}}>{n}</div>)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
        {cells.map((day,idx)=>{
          if(!day) return <div key={`e${idx}`} style={{minHeight:110,borderRight:"1px solid #F1F5F9",borderBottom:"1px solid #F1F5F9",background:"#FAFAFA"}}/>;
          const ds=`${year}-${fmt2(month+1)}-${fmt2(day)}`;
          const dbs=bookings.filter(b=>tsDate(b.start_at)===ds&&!b.autoCancelled);
          const isToday=ds===today,isSel=ds===selectedDate;
          const dow=(firstDay+day-1)%7;
          return(
            <div key={day} onClick={()=>onDayClick(ds)}
              style={{minHeight:110,borderRight:"1px solid #F1F5F9",borderBottom:"1px solid #F1F5F9",padding:"7px 6px",cursor:"pointer",background:isSel?"#EEF2FF":isToday?"#F0FDF4":"#fff",transition:"background 0.12s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <span style={{width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"50%",fontSize:12,fontWeight:isToday?800:500,background:isToday?"#111111":"transparent",color:isToday?"#fff":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151"}}>{day}</span>
                {dbs.length>0&&<span style={{fontSize:9,color:"#94A3B8",fontWeight:600}}>{dbs.length}건</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {dbs.slice(0,3).map(b=>{
                  const r=ROOMS_DB.find(r=>r.room_id===b.room_id);
                  return <div key={b.id} onClick={e=>{e.stopPropagation();onBookingClick(b);}} style={{background:r.color+"18",borderLeft:`2px solid ${r.color}`,borderRadius:3,padding:"2px 5px",fontSize:10,color:r.color,fontWeight:600,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",cursor:"pointer"}}>{fmtTS(b.start_at)} {b.title}</div>;
                })}
                {dbs.length>3&&<div style={{fontSize:9,color:"#94A3B8",paddingLeft:3}}>+{dbs.length-3}개</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WeeklyView({bookings,selectedDate,onDateClick,onBlockClick,onEmptyClick,onCheckIn}) {
  const { isMobile } = useBreakpoint();
  const weekStart = getWeekStart(selectedDate);
  const days = Array.from({length:7}, (_,i) => addDays(weekStart,i));
  const today = todayStr(), now = nowMinutes();
  const HH=120, LW=52;
  const DEFAULT_COL_W = isMobile ? 80 : 120;

  // ── 컬럼 너비 상태 (요일별 px) ──────────────────────────────────────────
  const [colWidths, setColWidths] = useState(() =>
    Object.fromEntries(days.map(d => [d, DEFAULT_COL_W]))
  );
  // 주가 바뀌면 너비 초기화
  useEffect(() => {
    setColWidths(Object.fromEntries(days.map(d => [d, DEFAULT_COL_W])));
  }, [weekStart]);

  // ── 드래그 리사이즈 핸들러 ───────────────────────────────────────────────
  const dragRef = useRef(null); // { ds, startX, startW }
  const handleResizeStart = useCallback((e, ds) => {
    e.preventDefault();
    e.stopPropagation();
    // 클로저 변수로 직접 캡처 — dragRef.current 참조 제거
    const startX = e.clientX;
    const startW = colWidths[ds];
    dragRef.current = { ds, startX, startW };
    const onMove = (ev) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - startX;
      const newW  = Math.max(60, Math.min(400, startW + delta));
      setColWidths(prev => ({ ...prev, [ds]: newW }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [colWidths]);

  const handleResetWidth = useCallback((ds) => {
    setColWidths(prev => ({ ...prev, [ds]: DEFAULT_COL_W }));
  }, [DEFAULT_COL_W]);

  // ── 서브 컬럼 레이아웃 계산 ──────────────────────────────────────────────
  // 같은 날, 시간이 겹치는 예약들을 가로로 나란히 배치
  function calcColumns(bks) {
    // 시간순 정렬
    const sorted = [...bks].sort((a,b) => tsMin(a.start_at) - tsMin(b.start_at));
    const cols = []; // cols[i] = 해당 컬럼에 들어간 예약 배열

    for (const b of sorted) {
      const sm = tsMin(b.start_at), em = tsMin(b.end_at);
      // 이미 만들어진 컬럼 중 끝 시간이 현재 시작보다 이른 컬럼 찾기
      let placed = false;
      for (const col of cols) {
        const lastEnd = tsMin(col[col.length-1].end_at);
        if (lastEnd <= sm) { col.push(b); placed = true; break; }
      }
      if (!placed) cols.push([b]);
    }

    // 각 예약에 { colIndex, totalCols } 메타 붙이기
    // 겹치는 그룹 단위로 totalCols 재계산
    const result = new Map(); // b.id -> {colIndex, totalCols}
    for (let ci = 0; ci < cols.length; ci++) {
      for (const b of cols[ci]) {
        result.set(b.id, { colIndex: ci, totalCols: cols.length });
      }
    }
    // 실제 겹치는 이벤트끼리만 컬럼 수 계산 (더 정밀한 버전)
    for (const b of sorted) {
      const sm = tsMin(b.start_at), em = tsMin(b.end_at);
      // b와 겹치는 모든 예약
      const overlapping = sorted.filter(o =>
        tsMin(o.start_at) < em && tsMin(o.end_at) > sm
      );
      const maxCols = Math.max(...overlapping.map(o => result.get(o.id)?.colIndex ?? 0)) + 1;
      result.set(b.id, { ...result.get(b.id), totalCols: maxCols });
    }
    return result;
  }

  // 요일별 컬럼 레이아웃 미리 계산
  const dayLayouts = {};
  for (const ds of days) {
    const dbs = bookings.filter(b => tsDate(b.start_at) === ds && !b.autoCancelled);
    dayLayouts[ds] = calcColumns(dbs);
  }

  // 회의실별 색상 팔레트 (9개)
  const ROOM_COLORS = [
    "#111111","#2563EB","#16A34A","#D97706","#DC2626",
    "#7C3AED","#0891B2","#DB2777","#65A30D",
  ];
  const roomColor = (roomId) => ROOM_COLORS[(roomId-1) % ROOM_COLORS.length];

  return (
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",overflow:"hidden"}}>
      {/* 가로 스크롤 래퍼 */}
      <div style={{overflowX:"auto"}}>
      {/* 요일 헤더 */}
      <div style={{display:"flex",borderBottom:"1px solid #E2E8F0",background:"#F8FAFC",
        position:"sticky",top:0,zIndex:9,minWidth: LW + days.reduce((s,d)=>s+colWidths[d],0)}}>
        <div style={{width:LW,minWidth:LW,borderRight:"1px solid #E2E8F0",flexShrink:0,
          position:"sticky",left:0,background:"#F8FAFC",zIndex:12}}/>
        {days.map(ds=>{
          const d=dateToObj(ds), dow=d.getDay();
          const isToday=ds===today, isSel=ds===selectedDate;
          const dayBks = bookings.filter(b=>tsDate(b.start_at)===ds&&!b.autoCancelled);
          const cw = colWidths[ds];
          return(
            <div key={ds}
              style={{width:cw,minWidth:cw,flexShrink:0,position:"relative",
                textAlign:"center",cursor:"pointer",
                borderRight:"1px solid #E2E8F0",transition:"background 0.15s",
                background:isToday?"#EFF6FF":isSel?"#F8FAFC":"transparent"}}>
              {/* 클릭 영역 (날짜 이동) */}
              <div onClick={()=>onDateClick(ds)} style={{padding:"8px 4px 4px"}}>
                <div style={{fontSize:10,fontWeight:700,
                  color:dow===0?"#EF4444":dow===6?"#3B82F6":"#64748B"}}>
                  {DAY_NAMES[dow]}
                </div>
                <div style={{width:28,height:28,margin:"3px auto 0",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  borderRadius:"50%",fontSize:13,fontWeight:800,
                  background:isToday?"#111111":"transparent",
                  color:isToday?"#fff":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151"}}>
                  {d.getDate()}
                </div>
                {dayBks.length>0 && (
                  <div style={{fontSize:9,color:"#94A3B8",marginTop:2,fontWeight:600}}>
                    {dayBks.length}건
                  </div>
                )}
              </div>
              {/* 리사이즈 핸들 — 오른쪽 끝 드래그 */}
              <div
                onMouseDown={e=>handleResizeStart(e,ds)}
                onDoubleClick={()=>handleResetWidth(ds)}
                title="드래그: 너비 조절 / 더블클릭: 초기화"
                style={{position:"absolute",top:0,right:0,width:6,height:"100%",
                  cursor:"col-resize",zIndex:20,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  background:"transparent",transition:"background 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.background="rgba(30,41,59,0.12)"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div style={{width:2,height:20,borderRadius:1,background:"#CBD5E1"}}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* 시간 그리드 */}
      <div style={{display:"flex",overflowY:"auto",maxHeight:"calc(100vh - 300px)",
        minWidth: LW + days.reduce((s,d)=>s+colWidths[d],0)}}>
        {/* 시간 레이블 */}
        <div style={{width:LW,minWidth:LW,borderRight:"1px solid #E2E8F0",flexShrink:0,
          position:"sticky",left:0,background:"#fff",zIndex:5}}>
          {HOURS.map(h=>(
            <div key={h} style={{height:HH, position:"relative", borderBottom:"1px dashed #F1F5F9"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"flex-end",
                paddingRight:8,paddingTop:4,fontSize:10,color:"#94A3B8",fontWeight:600,height:"50%"}}>
                {h}:00
              </div>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"flex-end",
                paddingRight:8,paddingTop:2,fontSize:9,color:"#CBD5E1",fontWeight:500,height:"50%"}}>
                {h}:30
              </div>
            </div>
          ))}
        </div>

        {/* 요일 컬럼 */}
        {days.map(ds=>{
          const dbs    = bookings.filter(b=>tsDate(b.start_at)===ds&&!b.autoCancelled);
          const dbsCan = bookings.filter(b=>tsDate(b.start_at)===ds&&b.autoCancelled);
          const isToday = ds===today;
          const layout  = dayLayouts[ds];
          const cw = colWidths[ds];

          return(
            <div key={ds} style={{width:cw,minWidth:cw,flexShrink:0,
              borderRight:"1px solid #E2E8F0",position:"relative",
              background:isToday?"#FAFFFE":"#fff"}}>

              {/* 시간 셀 배경 (클릭 → 예약) */}
              {HOURS.map(h=>(
                <div key={h} onClick={()=>onEmptyClick(ds,h)}
                  style={{height:HH,borderBottom:"1px dashed #F1F5F9",cursor:"pointer",
                    transition:"background 0.1s", position:"relative"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(30,41,59,0.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{position:"absolute",top:"25%",left:0,right:0,borderTop:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                  <div style={{position:"absolute",top:"50%",left:0,right:0,borderTop:"1px dashed #F1F5F9",pointerEvents:"none"}}/>
                  <div style={{position:"absolute",top:"75%",left:0,right:0,borderTop:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                </div>
              ))}

              {/* 취소된 예약 (흐리게) */}
              {dbsCan.map(b=>{
                const sm=tsMin(b.start_at),em=tsMin(b.end_at);
                const top=(sm-7*60)/60*HH;
                const h=Math.max((em-sm)/60*HH-2,14);
                return(
                  <div key={b.id} onClick={e=>{e.stopPropagation();onBlockClick(b);}}
                    style={{position:"absolute",top:top+1,left:2,right:2,height:h,
                      background:"#F1F5F9",border:"1px dashed #D1D5DB",
                      borderRadius:5,padding:"2px 5px",cursor:"pointer",
                      opacity:0.5,overflow:"hidden",zIndex:1}}>
                    <div style={{fontSize:9,color:"#94A3B8",whiteSpace:"nowrap",
                      textOverflow:"ellipsis",overflow:"hidden"}}>
                      취소 · {b.title}
                    </div>
                  </div>
                );
              })}

              {/* 일반 예약 — 서브 컬럼 분리 */}
              {dbs.map(b=>{
                const sm=tsMin(b.start_at),em=tsMin(b.end_at);
                const top=(sm-7*60)/60*HH;
                const blockH=Math.max((em-sm)/60*HH-3,16);
                const isAct=isToday&&sm<=now&&now<em&&!b.earlyEnded;
                const nci=isAct&&!b.checkedIn;
                const isEnded=b.earlyEnded;
                const color=isEnded?"#94A3B8":roomColor(b.room_id);
                const { colIndex, totalCols } = layout.get(b.id) || {colIndex:0,totalCols:1};

                // 서브 컬럼 위치 계산 (2px gap)
                const GAP=2;
                const colW = `calc((100% - ${GAP*(totalCols+1)}px) / ${totalCols})`;
                const colL = `calc(${GAP}px + (${colIndex}) * ((100% - ${GAP*(totalCols+1)}px) / ${totalCols} + ${GAP}px))`;

                return(
                  <div key={b.id}
                    onClick={e=>{e.stopPropagation();onBlockClick(b);}}
                    style={{
                      position:"absolute",
                      top:top+2, height:blockH,
                      left:colL, width:colW,
                      background:isEnded?"#F1F5F9":isAct?color:`${color}18`,
                      border:`1.5px solid ${isEnded?"#E2E8F0":color}${isAct||isEnded?"":"99"}`,
                      borderLeft:`3px solid ${color}`,
                      borderRadius:5,
                      padding:"3px 5px",
                      cursor:"pointer",
                      overflow:"hidden",
                      opacity:isEnded?0.6:1,
                      zIndex: isAct?8:3,
                      transition:"all 0.12s",
                      boxShadow:isAct?`0 2px 8px ${color}55`:"none",
                    }}
                    onMouseEnter={e=>{if(!isEnded){e.currentTarget.style.zIndex="15";e.currentTarget.style.boxShadow=`0 4px 12px ${color}44`;}}}
                    onMouseLeave={e=>{if(!isEnded){e.currentTarget.style.zIndex=isAct?"8":"3";e.currentTarget.style.boxShadow=isAct?`0 2px 8px ${color}55`:"none";}}}>
                    <div style={{fontSize:10,fontWeight:700,
                      color:isEnded?"#94A3B8":isAct?"#fff":color,
                      overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",
                      lineHeight:1.2}}>
                      {isEnded&&<CheckCircle2 size={10} strokeWidth={2} style={{marginRight:2,flexShrink:0}}/>}
                      {isAct&&!isEnded&&<Circle size={7} fill="#4ADE80" strokeWidth={0} style={{marginRight:2,flexShrink:0}}/>}
                      {b.checkedIn&&!isEnded&&!isAct&&<CheckCircle2 size={10} strokeWidth={2} style={{marginRight:2,flexShrink:0}}/>}
                      {b.title}
                    </div>
                    {blockH>26&&(
                      <div style={{fontSize:9,color:isEnded?"#CBD5E1":isAct?"rgba(255,255,255,0.8)":"#94A3B8",
                        marginTop:1,whiteSpace:"nowrap"}}>
                        {fmtTSRange(b.start_at, b.end_at)}{isEnded?" (완료)":""}
                      </div>
                    )}
                    {blockH>42&&(
                      <div style={{fontSize:9,color:isEnded?"#CBD5E1":isAct?"rgba(255,255,255,0.7)":"#94A3B8",
                        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {b.user}{b.checkedIn&&!isEnded&&<CheckCircle2 size={9} strokeWidth={2} style={{marginLeft:3,verticalAlign:"middle",flexShrink:0}}/>}
                      </div>
                    )}
                    {blockH>54&&isToday&&!b.checkedIn&&!isEnded&&(
                      <button className="btn"
                        onClick={e=>{e.stopPropagation();if(nci)onCheckIn(b.id);}}
                        disabled={!nci}
                        style={{marginTop:3,background:nci?"#16A34A":"rgba(255,255,255,0.2)",
                          color:"#fff",padding:"1px 6px",fontSize:9,borderRadius:4,
                          display:"block",cursor:nci?"pointer":"not-allowed"}}>
                        체크인
                      </button>
                    )}
                  </div>
                );
              })}

              {/* 현재 시간선 */}
              {isToday&&(()=>{
                const tp=(now-7*60)/60*HH;
                if(tp<0||tp>HOURS.length*HH) return null;
                return(
                  <div style={{position:"absolute",top:tp,left:0,right:0,
                    height:2,background:"#EF4444",zIndex:10,pointerEvents:"none"}}>
                    <div style={{position:"absolute",left:-5,top:-4,
                      width:10,height:10,borderRadius:"50%",background:"#EF4444"}}/>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
      </div>{/* 가로 스크롤 래퍼 닫기 */}
      {/* 리사이즈 안내 */}
      <div style={{padding:"5px 16px",fontSize:10,color:"#CBD5E1",textAlign:"right",
        borderTop:"1px solid #F8FAFC",background:"#FAFAFA"}}>
        ↔ 날짜 헤더 오른쪽 끝을 드래그해 컬럼 너비 조절 · 더블클릭으로 초기화
      </div>
    </div>
  );
}


export function DailyView({bookings,selectedDate,onBlockClick,onEmptyClick,onCheckIn}) {
  const isToday = selectedDate===todayStr(), now=nowMinutes();
  // X=시간(가로), Y=회의실(세로)
  const CW=120, // 시간 1칸 너비(px)
        RH=72,  // 회의실 1행 높이(px)
        LW=148; // 왼쪽 회의실명 영역 너비

  const rooms = ROOMS_DB.filter(r=>r.is_active);
  const totalW = CW * HOURS.length;

  return(
    <div style={{background:"#fff",borderRadius:16,border:"1px solid #E2E8F0",overflow:"hidden"}}>
      {/* 스크롤 컨테이너 */}
      <div style={{overflowX:"auto",overflowY:"auto",maxHeight:"calc(100vh - 240px)"}}>
        <div style={{minWidth: LW + totalW}}>

          {/* ── 헤더: 시간축 ── */}
          <div style={{display:"flex",position:"sticky",top:0,zIndex:9,background:"#F8FAFC",borderBottom:"1px solid #E2E8F0"}}>
            {/* 좌상단 코너셀 — 세로(top) + 가로(left) 동시 고정 */}
            <div style={{width:LW,minWidth:LW,flexShrink:0,borderRight:"1px solid #E2E8F0",padding:"10px 16px",
              fontSize:11,fontWeight:700,color:"#94A3B8",
              position:"sticky",left:0,zIndex:9,background:"#F8FAFC"}}>
              회의실
            </div>
            {/* 시간 헤더 — 세로만 고정, 가로 스크롤과 함께 이동 */}
            {HOURS.map(h=>(
              <div key={h} style={{width:CW,minWidth:CW,textAlign:"center",padding:"10px 0",
                fontSize:11,fontWeight:600,color:"#64748B",
                borderRight:"1px solid #E2E8F0",flexShrink:0,background:"#F8FAFC"}}>
                {h<12?`오전 ${h}`:h===12?"정오":`오후 ${h-12}`}시
              </div>
            ))}
          </div>

          {/* ── 바디: 회의실별 행 ── */}
          {rooms.map((room,ri)=>{
            const floor = getFloor(room.floor_id);
            const rBks  = bookings.filter(b=>b.room_id===room.room_id&&!b.autoCancelled);
            const rBksCancelled = bookings.filter(b=>b.room_id===room.room_id&&b.autoCancelled);
            return(
              <div key={room.room_id}
                style={{display:"flex",borderBottom:ri<rooms.length-1?"1px solid #F1F5F9":"none",minHeight:RH,position:"relative"}}
                onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}>

                {/* 회의실명 셀 (sticky left) */}
                <div style={{width:LW,minWidth:LW,flexShrink:0,borderRight:"1px solid #E2E8F0",
                  padding:"0 16px",display:"flex",flexDirection:"column",justifyContent:"center",
                  position:"sticky",left:0,background:"#fff",zIndex:5,
                  boxShadow:"2px 0 6px rgba(0,0,0,0.04)"}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#111111",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{room.room_name}</div>
                  <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{floor.floor_name} · {room.capacity}인</div>
                </div>

                {/* 시간 셀들 (빈 슬롯 클릭 → 예약) */}
                <div style={{flex:1,position:"relative",minHeight:RH,display:"flex"}}>
                  {HOURS.map(h=>(
                    <div key={h} onClick={()=>onEmptyClick(room.room_id,h)}
                      style={{width:CW,minWidth:CW,flexShrink:0,borderRight:"1px solid #F1F5F9",
                        cursor:"pointer",position:"relative",transition:"background 0.1s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(30,41,59,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      {/* 15분 단위 구분선 */}
                      <div style={{position:"absolute",top:0,bottom:0,left:"25%",borderLeft:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:0,bottom:0,left:"50%",borderLeft:"1px dashed #F1F5F9",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:0,bottom:0,left:"75%",borderLeft:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                    </div>
                  ))}

                  {/* 현재 시간선 */}
                  {isToday&&(()=>{
                    const left=((now-7*60)/60)*CW;
                    if(left<0||left>totalW) return null;
                    return(
                      <div style={{position:"absolute",top:0,bottom:0,left,width:2,background:"#EF4444",zIndex:5,pointerEvents:"none"}}>
                        {ri===0&&<div style={{position:"absolute",top:4,left:-4,width:10,height:10,borderRadius:"50%",background:"#EF4444"}}/>}
                      </div>
                    );
                  })()}

                  {/* 예약 블록 */}
                  {[...rBks,...rBksCancelled].map(b=>{
                    const sm=tsMin(b.start_at),em=tsMin(b.end_at);
                    const left=((sm-7*60)/60)*CW+2;
                    const width=Math.max(((em-sm)/60)*CW-4,20);
                    const isCan=b.autoCancelled;
                    const isEnded=b.earlyEnded;
                    const isAct=isToday&&sm<=now&&now<em&&!isCan&&!isEnded;
                    const nci=isAct&&!b.checkedIn;
                    return(
                      <div key={b.id} onClick={e=>{e.stopPropagation();onBlockClick(b);}}
                        style={{
                          position:"absolute",top:6,bottom:6,left,width,
                          background:isCan?"#F1F5F9":isEnded?"#E2E8F0":"#111111",
                          border:`1.5px solid ${isCan?"#E2E8F0":isEnded?"#CBD5E1":isAct?"#000":"#334155"}`,
                          borderRadius:8,padding:"5px 8px",cursor:"pointer",zIndex:3,
                          overflow:"hidden",
                          boxShadow:isAct?"0 0 0 2px #EF4444, 0 2px 8px rgba(0,0,0,0.2)":isCan||isEnded?"none":"0 1px 4px rgba(0,0,0,0.15)",
                          opacity:isCan?0.45:isEnded?0.55:1,transition:"all 0.12s"
                        }}
                        onMouseEnter={e=>{ if(!isCan&&!isEnded) e.currentTarget.style.filter="brightness(1.15)"; }}
                        onMouseLeave={e=>{ e.currentTarget.style.filter="none"; }}>
                        <div style={{fontSize:11,fontWeight:700,color:isCan||isEnded?"#94A3B8":"#fff",
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                          {isEnded&&<CheckCircle2 size={10} strokeWidth={2} style={{marginRight:3,flexShrink:0}}/>}
                          {isAct&&!isEnded&&<Circle size={7} fill="#86EFAC" strokeWidth={0} style={{marginRight:3,flexShrink:0}}/>}
                          {b.checkedIn&&!isEnded&&!isAct&&<CheckCircle2 size={10} strokeWidth={2} style={{marginRight:3,flexShrink:0}}/>}
                          {b.title}
                        </div>
                        {width>80&&<div style={{fontSize:10,color:isEnded?"#CBD5E1":"#94A3B8",marginTop:1,whiteSpace:"nowrap"}}>{fmtTSRange(b.start_at, b.end_at)}{isEnded?" (완료)":""}</div>}
                        {width>120&&<div style={{fontSize:10,color:isEnded?"#CBD5E1":"#64748B",whiteSpace:"nowrap"}}>{b.user}{b.checkedIn&&!isEnded&&<CheckCircle2 size={9} strokeWidth={2} style={{marginLeft:3,verticalAlign:"middle",flexShrink:0}}/>}</div>}
                        {isToday&&!isCan&&!isEnded&&!b.checkedIn&&width>90&&(
                          <button className="btn" onClick={e=>{e.stopPropagation();if(nci)onCheckIn(b.id);}} disabled={!nci}
                            style={{marginTop:3,background:nci?"#16A34A":"#CBD5E1",color:nci?"#fff":"#94A3B8",padding:"2px 7px",fontSize:9,borderRadius:4,display:"block",cursor:nci?"pointer":"not-allowed",alignItems:"center",gap:3}}><CheckCircle2 size={9} strokeWidth={2}/>체크인</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function TimelineView({bookings,rooms,selectedDate,onBlockClick,onEmptyClick,onCheckIn}) {
  const isToday = selectedDate===todayStr(), now=nowMinutes();

  const HH   = 120;  // 1시간 높이(px)
  const TW   = 64;   // 시간 레이블 열 너비
  const COL  = 200;  // 회의실 열 최소 너비
  const totalH = HOURS.length * HH;
  const minToPx = (min) => ((min - 7*60) / 60) * HH;
  const nowPx = isToday ? minToPx(now) : -1;

  return (
    <div style={{
      background:"#fff", borderRadius:16, border:"1px solid #E2E8F0",
      userSelect:"none", overflow:"hidden"
    }}>
      {/* ── 단일 스크롤 컨테이너: 가로+세로 동시 스크롤 ── */}
      <div style={{overflowX:"auto", overflowY:"auto", maxHeight:"calc(100vh - 180px)"}}>
        {/* 전체 너비 고정 래퍼 */}
        <div style={{minWidth: TW + rooms.length * COL, position:"relative"}}>

          {/* ── 헤더 행: 회의실명 (sticky top) ── */}
          <div style={{
            display:"flex", position:"sticky", top:0, zIndex:10,
            background:"#F8FAFC", borderBottom:"2px solid #E2E8F0"
          }}>
            {/* 좌상단 코너 (sticky left + top) */}
            <div style={{
              width:TW, minWidth:TW, flexShrink:0,
              borderRight:"1px solid #E2E8F0",
              position:"sticky", left:0, zIndex:11,
              background:"#F8FAFC"
            }}/>

            {/* 회의실 헤더 컬럼들 */}
            {rooms.map((room, ri) => {
              const floor    = getFloor(room.floor_id);
              const features = getRoomFeatures(room.room_id);
              const status   = getRoomStatus(room.room_id, bookings, selectedDate);
              const isAvail  = status.type==="AVAILABLE" || status.type==="SOON";
              return (
                <div key={room.room_id} style={{
                  width:COL, minWidth:COL, flexShrink:0,
                  borderRight: ri<rooms.length-1 ? "1px solid #E2E8F0" : "none",
                  padding:"14px 16px", textAlign:"center"
                }}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6,marginBottom:4}}>
                    <span style={{
                      width:8, height:8, borderRadius:"50%", flexShrink:0,
                      background: isAvail ? "#22C55E" : "#EF4444",
                      boxShadow: isAvail ? "0 0 6px #22C55E88" : "0 0 6px #EF444488"
                    }}/>
                    <span style={{fontSize:13, fontWeight:700, color:"#111111", whiteSpace:"nowrap"}}>{room.room_name}</span>
                  </div>
                  <div style={{fontSize:11, color:"#94A3B8"}}>
                    {floor.floor_name} · {room.capacity}인
                    {features.length>0 && ` · ${features.map(f=>f.feature_name).join(", ")}`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── 바디 행: 시간 레이블 + 회의실 그리드 ── */}
          <div style={{display:"flex", position:"relative"}}>

            {/* 시간 레이블 열 (sticky left) */}
            <div style={{
              width:TW, minWidth:TW, flexShrink:0,
              borderRight:"1px solid #E2E8F0",
              position:"sticky", left:0, zIndex:10,
              background:"#F8FAFC"
            }}>
              {HOURS.map(h=>(
                <div key={h} style={{height:HH, position:"relative", borderBottom:"1px solid #F1F5F9"}}>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"flex-end",
                    paddingRight:10,paddingTop:8,fontSize:11,fontWeight:600,color:"#94A3B8",height:"50%"}}>
                    {h<12?`${h}AM`:h===12?"12PM":`${h-12}PM`}
                  </div>
                  <div style={{display:"flex",alignItems:"flex-start",justifyContent:"flex-end",
                    paddingRight:10,paddingTop:4,fontSize:9,fontWeight:500,color:"#CBD5E1",height:"50%"}}>
                    :30
                  </div>
                </div>
              ))}
            </div>

            {/* 회의실 컬럼들 */}
            {rooms.map((room, ri)=>{
              const rBks = bookings.filter(b=>b.room_id===room.room_id);
              return (
                <div key={room.room_id} style={{
                  width:COL, minWidth:COL, flexShrink:0, position:"relative",
                  borderRight: ri<rooms.length-1 ? "1px solid #E2E8F0" : "none"
                }}>
                  {/* 시간 그리드 배경 */}
                  {HOURS.map(h=>(
                    <div key={h}
                      onClick={()=>onEmptyClick(room.room_id, h)}
                      style={{
                        height:HH, borderBottom:"1px solid #F1F5F9",
                        cursor:"pointer", position:"relative", transition:"background 0.1s"
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(30,41,59,0.03)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div style={{position:"absolute",top:"25%",left:0,right:0,borderTop:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:"50%",left:0,right:0,borderTop:"1px dashed #F1F5F9",pointerEvents:"none"}}/>
                      <div style={{position:"absolute",top:"75%",left:0,right:0,borderTop:"1px dashed #F8FAFC",pointerEvents:"none"}}/>
                    </div>
                  ))}

                  {/* 현재 시간 가로선 */}
                  {isToday && nowPx>=0 && nowPx<=totalH && (
                    <div style={{
                      position:"absolute", top:nowPx, left:0, right:0,
                      height:2, background:"#EF4444", zIndex:6, pointerEvents:"none"
                    }}>
                      {ri===0 && (
                        <div style={{
                          position:"absolute", left:-TW, top:-5,
                          fontSize:10, fontWeight:700, color:"#EF4444",
                          background:"#F8FAFC", paddingRight:4, whiteSpace:"nowrap"
                        }}>
                          {fmt2(Math.floor(now/60))}:{fmt2(now%60)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 예약 카드 */}
                  {rBks.map(b=>{
                    const sm  = tsMin(b.start_at), em = tsMin(b.end_at);
                    const top = minToPx(sm);
                    const h   = Math.max(minToPx(em) - top - 4, 24);
                    const isCan  = b.autoCancelled;
                    const isAct  = isToday && sm<=now && now<em && !isCan;
                    const nci    = isAct && !b.checkedIn;

                    const cardBg    = isCan ? "#F8FAFC" : isAct ? "#F0FDF4" : "#EFF6FF";
                    const borderCol = isCan ? "#E2E8F0" : isAct ? "#16A34A" : "#3B82F6";
                    const titleColor= isCan ? "#94A3B8" : isAct ? "#15803D" : "#1D4ED8";

                    return (
                      <div key={b.id}
                        onClick={e=>{e.stopPropagation();onBlockClick(b);}}
                        style={{
                          position:"absolute", top:top+2, left:6, right:6, height:h,
                          background:cardBg, border:`1.5px solid ${borderCol}`,
                          borderRadius:10, padding:"8px 10px", cursor:"pointer",
                          zIndex:3, overflow:"hidden", transition:"all 0.12s",
                          boxShadow: isAct?`0 0 12px ${borderCol}44`:isCan?"none":"0 1px 4px rgba(0,0,0,0.06)"
                        }}
                        onMouseEnter={e=>{if(!isCan)e.currentTarget.style.filter="brightness(0.97)";}}
                        onMouseLeave={e=>{e.currentTarget.style.filter="none";}}>
                        <div style={{fontSize:12,fontWeight:700,color:titleColor,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:2}}>
                          {b.title}
                        </div>
                        {h>36&&<div style={{fontSize:10,color:"#64748B",whiteSpace:"nowrap"}}>
                          {fmtTSRange(b.start_at, b.end_at)} · {b.user}
                        </div>}
                        {isToday&&!isCan&&!b.checkedIn&&h>48&&(
                          <button className="btn"
                            onClick={e=>{e.stopPropagation();if(nci)onCheckIn(b.id);}} disabled={!nci}
                            style={{marginTop:5,background:nci?"#16A34A":"#E2E8F0",color:nci?"#fff":"#94A3B8",
                              padding:"3px 9px",fontSize:10,borderRadius:6,display:"block",cursor:nci?"pointer":"not-allowed"}}>
                            {nci?<span style={{display:"inline-flex",alignItems:"center",gap:4}}><CheckCircle2 size={12} strokeWidth={2}/>체크인</span>:"체크인 대기중"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── List View ────────────────────────────────────────────────────────────────
export function ListView({bookings,selectedDate,setSelectedDate,onItemClick,onCheckIn}) {
  const { isMobile } = useBreakpoint();
  const isToday=selectedDate===todayStr(),now=nowMinutes();
  const sorted=[...bookings].filter(b=>!b.autoCancelled).sort((a,b)=>a.start_at.localeCompare(b.start_at));
  return(
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
        <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}
          style={{background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,color:"#111111",padding:"8px 14px",fontSize:13,outline:"none"}}/>
        {selectedDate!==todayStr()&&<button className="btn" onClick={()=>setSelectedDate(todayStr())} style={{background:"#111111",color:"#fff",padding:"8px 14px",fontSize:12,borderRadius:10}}>오늘</button>}
      </div>
      {sorted.length===0
        ? <div style={{textAlign:"center",padding:"80px 0",color:"#CBD5E1"}}><div style={{display:"flex",justifyContent:"center",marginBottom:16}}><Inbox size={48} strokeWidth={1.2} color="#CBD5E1"/></div><div style={{fontSize:17,fontWeight:600,color:"#94A3B8"}}>이 날 예약이 없습니다</div></div>
        : <div style={{display:"flex",flexDirection:"column",gap:10,maxWidth:800}}>
            {sorted.map(b=>{
              const r=ROOMS_DB.find(r=>r.room_id===b.room_id);
              const fl=getFloor(r.floor_id);
              const isAct=isToday&&tsMin(b.start_at)<=now&&now<tsMin(b.end_at)&&!b.earlyEnded;
              const nci=isAct&&!b.checkedIn;
              return(
                <div key={b.id} onClick={()=>onItemClick(b)}
                  style={{background:"#fff",border:`1px solid ${isAct?r.color:"#E2E8F0"}`,borderLeft:`4px solid ${r.color}`,borderRadius:12,padding:isMobile?"12px 14px":"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:isMobile?10:14,flexWrap:isMobile?"wrap":"nowrap",transition:"all 0.15s",boxShadow:isAct?`0 2px 12px ${r.color}22`:"0 1px 4px rgba(0,0,0,0.04)"}}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.08)"}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow=isAct?`0 2px 12px ${r.color}22`:"0 1px 4px rgba(0,0,0,0.04)"}>
                  <div style={{textAlign:"center",minWidth:50}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#64748B"}}>{fmtTS(b.start_at)}</div>
                    <div style={{width:1,height:8,background:"#E2E8F0",margin:"3px auto"}}/>
                    <div style={{fontSize:12,fontWeight:700,color:"#64748B"}}>{fmtTS(b.end_at)}</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                      {isAct&&<span className="chip" style={{background:r.color+"18",color:r.color}}><Circle size={7} fill={r.color} strokeWidth={0} style={{marginRight:3}}/>진행중</span>}
                      {b.checkedIn&&<span className="chip" style={{background:"#DCFCE7",color:"#16A34A",display:"inline-flex",alignItems:"center",gap:3}}><CheckCircle2 size={10} strokeWidth={2}/>체크인</span>}
                      <span style={{fontSize:15,fontWeight:700,color:"#111111"}}>{b.title}</span>
                    </div>
                    <div style={{fontSize:12,color:"#94A3B8"}}><span style={{color:r.color,fontWeight:600}}>{r.room_name}</span> · {fl.floor_name} · {b.user} · {b.dept}</div>
                  </div>
                  {isToday&&!b.autoCancelled&&!b.checkedIn&&<button className="btn" onClick={e=>{e.stopPropagation();if(nci)onCheckIn(b.id);}} disabled={!nci} style={{background:nci?"#16A34A":"#E2E8F0",color:nci?"#fff":"#94A3B8",padding:"7px 14px",fontSize:12,borderRadius:10,cursor:nci?"pointer":"not-allowed",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:4}}>{nci?<><CheckCircle2 size={11} strokeWidth={2}/>체크인</>:"체크인 대기"}</button>}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ─── Booking Modal ─────────────────────────────────────────────────────────────
