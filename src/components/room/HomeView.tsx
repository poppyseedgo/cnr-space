// ─────────────────────────────────────────────────────────────────────────────
// [변경 이력]
// 2026-04-17: 그리드 밀도 토글(comfortable 3열 / compact 5열) 추가
//   - localStorage 'cnr-grid-density'에 선호도 저장
//   - 데스크탑(1024px+)에서만 토글 노출, 모바일/태블릿은 기존 1/2열 유지
//   - compact 모드: 썸네일 120px, 회의실명 16px, '오늘 남은 예약' 박스 숨김
//   - 반응형 규칙: 1024~1279px=4열, 1280px+=5열 (너무 좁게 찌그러지지 않도록)
//
// 2026-04-17 (2차): 반응형 breakpoint 재조정
//   - 모바일(<640px): 1열 → 2열로 변경 + density와 무관하게 강제 compact 스타일 적용
//     → 카드 폭 170~200px에서 comfortable 스타일(썸네일 160px, 회의실명 21px)은
//       찌그러지므로 모바일은 항상 compact 스타일로 렌더링 (localStorage 선택값은 유지)
//   - 5열 전환 경계점: 1280px → 1400px로 상향 (min-[1400px]: arbitrary variant)
//     → 1024~1399px 구간은 compact=4열로 유지, 큰 데스크탑에서만 5열
//   - "오늘 내 예약" 가로 스크롤 스트립: 모바일 42vw → 45vw (회의실 카드와 정렬)
//
// 2026-04-17 (3차): "오늘 내 예약" 카드를 정사각형으로 변경
//   - 기존: width 45vw(모바일) / 160px(데스크탑), minHeight 120/140 — 세로로 길어 보임
//   - 변경: 모바일 140×140, 데스크탑 160×160 고정 정사각형
//   - minWidth 제거(width가 고정값이라 불필요), minHeight → height로 변경
//   - 제목 line-clamp-2 → line-clamp-1 (정사각형 높이에 맞춰 1줄만)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Search, UsersRound, X, LayoutGrid, Grid3x3 } from 'lucide-react' // ← [그리드 토글 아이콘 추가]
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

  // ← [그리드 밀도 상태 추가] comfortable(3열) | compact(4~5열) - localStorage 연동
  const [gridDensity, setGridDensity] = useState<'comfortable' | 'compact'>(() => {
    if (typeof window === 'undefined') return 'comfortable';
    const saved = window.localStorage.getItem('cnr-grid-density');
    return (saved === 'compact' || saved === 'comfortable') ? saved : 'comfortable';
  });

  // ← [gridDensity 변경 시 localStorage 저장]
  useEffect(() => {
    try { window.localStorage.setItem('cnr-grid-density', gridDensity); } catch {}
  }, [gridDensity]);

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
            style={{width:isMobile?140:160, height:isMobile?140:160, /* ← [2026-04-17 3차] 정사각형 고정 */
              background:"#111111", flexShrink:0, gap:8}}>
            <span style={{fontSize:24, lineHeight:1}}>＋</span>
            <span style={{fontSize:isMobile?12:13}}>예약하기</span>
          </button>

          {myBookings.length === 0 ? (
            <div className="flex-none flex items-center justify-center rounded-2xl text-slate-300 dark:text-slate-600 text-sm"
              style={{width:isMobile?140:160, height:isMobile?140:160, background:"#F3F4F8"}}> {/* ← [2026-04-17 3차] 정사각형 고정 */}
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
                style={{width:isMobile?140:160, height:isMobile?140:160, /* ← [2026-04-17 3차] 정사각형 고정 */
                  flexShrink:0, overflow:"hidden", /* ← [2026-04-17 3차] 넘침 방지 */
                  opacity: (cardState==="cancelled"||cardState==="noshow"||cardState==="adminCancel"||cardState==="rejected"||cardState==="pendingExpired") ? 0.45 : 1,
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
                  <div className="text-xs font-semibold text-slate-900 dark:text-white leading-snug line-clamp-1 mb-1.5">{b.title}</div> {/* ← [2026-04-17 3차] line-clamp-2 → line-clamp-1 */}
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

        {/* ← [그리드 토글 버튼] 데스크탑(1024px+)에서만 표시. 모바일/태블릿은 1열/2열 고정이므로 숨김 */}
        <div className="hidden lg:flex items-center flex-shrink-0 gap-1 p-1 rounded-full"
          style={{background: dark?"#334155":"#fff"}}>
          <button
            className="btn flex items-center justify-center rounded-full transition-colors"
            onClick={()=>setGridDensity('comfortable')}
            aria-label="3열 보기"
            title="3열 보기"
            style={{
              width:30, height:30,
              background: gridDensity==='comfortable' ? "#111" : "transparent",
              color:      gridDensity==='comfortable' ? "#fff" : "#94A3B8",
              border:"none",
            }}>
            <LayoutGrid size={15} strokeWidth={2}/>
          </button>
          <button
            className="btn flex items-center justify-center rounded-full transition-colors"
            onClick={()=>setGridDensity('compact')}
            aria-label="조밀하게 보기"
            title="조밀하게 보기"
            style={{
              width:30, height:30,
              background: gridDensity==='compact' ? "#111" : "transparent",
              color:      gridDensity==='compact' ? "#fff" : "#94A3B8",
              border:"none",
            }}>
            <Grid3x3 size={15} strokeWidth={2}/>
          </button>
        </div>
      </div>

      {/* ── 회의실 그리드 ── */}
      {withStatus.length===0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="mb-4" style={{display:"flex",justifyContent:"center"}}><Search size={48} strokeWidth={1.8} color="#CBD5E1"/></div>
          <div className="text-lg font-semibold">검색 결과가 없습니다</div>
        </div>
      ) : (
        // ← [그리드 반응형 규칙 - 2026-04-17 2차 수정]
        //   모바일(~639px):         2열 (1열에서 변경)
        //   태블릿(640~1023px):      2열 (density 무관)
        //   작은 데스크탑(1024~1399px): comfortable=3열 / compact=4열
        //   큰 데스크탑(1400px+):    comfortable=3열 / compact=5열
        //   ※ min-[1400px]: arbitrary variant로 Tailwind config 수정 없이 정확한 경계 지정
        <div className={
          gridDensity === 'compact'
            ? "grid grid-cols-2 lg:grid-cols-4 min-[1400px]:grid-cols-5 gap-4"
            : "grid grid-cols-2 lg:grid-cols-3 gap-4"
        }>
          {withStatus.map((item,i) => (
            // ← [density prop 전달 - 모바일은 강제 compact 적용]
            //   isMobile일 때 사용자의 localStorage 선택값과 무관하게 compact 스타일 사용
            //   이유: 모바일 2열은 카드 폭 170~200px이라 comfortable 스타일은 찌그러짐
            //   localStorage 값은 유지되므로 데스크탑 접속 시 원래 선택값 복원됨
            <RoomCard key={item.room.room_id} room={item.room} status={item.status} animDelay={i*40}
              onBook={onBook} onDetail={onDetail} bookings={bookings} onCheckIn={onCheckIn} dark={dark}
              density={isMobile ? 'compact' : gridDensity}/>
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
// ← [density prop 추가] comfortable(기본) | compact(5그리드 시 좁은 카드)
export function RoomCard({room:r, status, onBook, onDetail, bookings, onCheckIn, animDelay, dark=false, density='comfortable'}: {room:any,status:any,onBook?:any,onDetail?:any,bookings:any[],onCheckIn?:any,animDelay?:number,dark?:boolean,density?:'comfortable'|'compact'}) {
  const floor    = getFloor(r.floor_id);
  const isBusy   = status.type === "BUSY";
  const isSoon   = status.type === "SOON";
  const isAvail  = status.type === "AVAILABLE";

  // ← [density에 따른 스타일 값 한 곳에 모음 - 유지보수 용이]
  const isCompact = density === 'compact';
  const D = {
    thumbHeight: isCompact ? 120 : 160,
    cardPadding: isCompact ? "p-4 gap-2" : "p-5 gap-3",
    roomNameSize: isCompact ? 16 : 21,
    metaSize: isCompact ? 12 : 13,
    btnSize: isCompact ? 13 : 14,
    btnPadding: isCompact ? "10px" : "13px",
    btnBottomPadding: isCompact ? "4px 16px 16px" : "4px 20px 20px",
  };

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
      <div style={{width:"100%", height:D.thumbHeight, overflow:"hidden", flexShrink:0, background:thumbnail?"#F3F4F8":"rgb(251, 253, 255)", position:"relative"}}> {/* ← [썸네일 높이 density 분기] */}
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

      <div className={`${D.cardPadding} flex flex-col flex-1`}> {/* ← [패딩/gap density 분기] */}

        {/* ① 상태 칩 */}
        <RoomStatusBadge status={status} />

        {/* ② 회의실명 */}
        <div style={{fontSize:D.roomNameSize, fontWeight:600, letterSpacing:"-0.3px", lineHeight:1.2, /* ← [폰트 크기 density 분기] */
          color: (isBusy||isSoon) ? "#94A3B8" : dark?"#fff":"#111111"}}>
          {r.room_name}
        </div>

        {/* ③ 층 + 인원 */}
        <div style={{display:"flex", alignItems:"center", gap:12, fontSize:D.metaSize, /* ← [메타 폰트 density 분기] */
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

        {/* ④ 예약 현황 — compact 모드에서는 박스 자체를 숨김 */}
        {!isCompact && ( /* ← [compact 모드에서 '오늘 남은 예약' 박스 전체 숨김] */
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
        )} {/* ← [compact 모드에서 박스 숨김 조건부 렌더링 닫기] */}

        {/* ← [compact 모드에서 flex-1이 하단 버튼을 바닥으로 밀어내도록 spacer 추가] */}
        {isCompact && <div style={{flex:1}}/>}

      </div>

      {/* ⑤ 버튼 */}
      <div style={{display:"flex", alignItems:"center", gap:8, padding:D.btnBottomPadding}}> {/* ← [버튼 영역 패딩 density 분기] */}
        {isAvail && (<>
          <button className="btn" onClick={e=>{e.stopPropagation();onBook(r, status);}}
            style={{flex:1, background:"#111111", color:"#fff", fontWeight:600,
              borderRadius:12, padding:D.btnPadding, fontSize:D.btnSize, textAlign:"center"}}> {/* ← [버튼 폰트/패딩 density 분기] */}
            바로 예약
          </button>
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:D.btnSize, padding:D.btnPadding, cursor:"pointer", textAlign:"center"}}> {/* ← [버튼 폰트/패딩 density 분기] */}
            자세히 보기
          </button>
        </>)}
        {isSoon && (<>
          <button className="btn" disabled
            style={{flex:1, background:"#FCE7F3", color:"#BE185D", fontWeight:600,
              borderRadius:12, padding:D.btnPadding, fontSize:D.btnSize, textAlign:"center", /* ← [버튼 폰트/패딩 density 분기] */
              cursor:"not-allowed", border:"none"}}>
            {status.minsUntil}분 뒤 사용
          </button>
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:D.btnSize, padding:D.btnPadding, cursor:"pointer", textAlign:"center"}}> {/* ← [버튼 폰트/패딩 density 분기] */}
            자세히 보기
          </button>
        </>)}
        {isBusy && (
          <button className="btn" onClick={e=>{e.stopPropagation();onDetail(r);}}
            style={{flex:1, background:"none", border:"none", color:"#64748B",
              fontWeight:600, fontSize:D.btnSize, padding:D.btnPadding, cursor:"pointer", textAlign:"center"}}> {/* ← [버튼 폰트/패딩 density 분기] */}
            자세히 보기
          </button>
        )}
      </div>
    </div>
  );
}

