import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useBreakpoint, useVisualViewport } from '../../hooks/useBreakpoint'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, getFloor, getRoomFeatures, getRoomById } from '../../data/master'
import { loadBookings, saveBookings } from '../../utils/seed'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

export function BookingModal({prefill, date:initDate, editBooking=null, onClose, onSubmit, onUpdate, bookings, isAdmin=false, currentUser="홍길동"}) {
  // ── 모든 hooks를 최상단에 선언 ──────────────────────────────────────────────
  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvHeight, off: vvOff } = useVisualViewport();
  const today = todayStr();
  const maxDateObj = new Date(); maxDateObj.setMonth(maxDateObj.getMonth()+1);
  const maxDate = objToStr(maxDateObj);

  const [bookingDate, setBookingDate] = useState(
    editBooking ? tsDate(editBooking.start_at) : (initDate || today)
  );
  const [showPicker,  setShowPicker]  = useState(false);
  const [calYear,  setCalYear]  = useState(() => dateToObj(initDate||today).getFullYear());
  const [calMonth, setCalMonth] = useState(() => dateToObj(initDate||today).getMonth());
  const [form, setForm] = useState(() => {
    if (editBooking) {
      return {
        room_id:   editBooking.room_id,
        title:     editBooking.title,
        start:     fmtTS(editBooking.start_at),  // "HH:MM"
        end:       fmtTS(editBooking.end_at),
        memo:      editBooking.memo || "",
        attendees: editBooking.attendees || [],
      };
    }
    // 현재 시각 기준 다음 15분 단위 스냅 (예: 6:08 → 6:15, 6:15 → 6:30)
    const nowMin = nowMinutes();
    const snapStart = Math.ceil((nowMin+1)/15)*15;
    const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
    const clampedEnd   = Math.min(clampedStart+60, 19*60);
    const defStart = prefill?.start || `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
    const defEnd   = prefill?.end   || `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
    return {
      room_id:    prefill?.room_id || null,
      title:      "",
      start:      defStart,
      end:        defEnd,
      memo:       "",
      attendees:  [],
    };
  });
  const pickerRef    = useRef(null);
  const pickerRef2   = useRef(null);
  const attendeeRef  = useRef(null);
  const [attendeeQ,  setAttendeeQ]  = useState("");
  const [attendeeFocus, setAttendeeFocus] = useState(false);
  const [recur, setRecur] = useState("NEVER"); // "NEVER" | "EVERY_DAY" | "EVERY_WEEK"

  useEffect(() => {
    const h = (e) => {
      const inPicker = (pickerRef.current && pickerRef.current.contains(e.target))
                    || (pickerRef2.current && pickerRef2.current.contains(e.target));
      if(!inPicker) setShowPicker(false);
      if(attendeeRef.current && !attendeeRef.current.contains(e.target)) setAttendeeFocus(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── 파생 값 ────────────────────────────────────────────────────────────────
  const set = (k,v) => setForm(f => ({...f, [k]:v}));

  // 시작 슬롯: 07:00 ~ 18:45 (19:00 이후 시작 불가)
  // 종료 슬롯: 시작보다 늦고 최대 19:00
  const tOpts = (() => {
    const all: string[] = [];
    for(let h=7; h<=18; h++) for(let m=0; m<60; m+=15) all.push(`${fmt2(h)}:${fmt2(m)}`);
    all.push('18:45'); // 마지막 시작 슬롯 (중복 방지: 루프가 18:00~18:45 이미 포함)
    // 중복 제거 후 정렬
    const unique = [...new Set(all)].sort();
    // 오늘 날짜면 현재 시각 이전 슬롯 제거
    if (bookingDate === todayStr()) {
      const now = nowMinutes();
      return unique.filter(t => timeToMin(t) > now);
    }
    return unique;
  })();
  // 종료 슬롯: 시작보다 늦고 최대 19:00
  const endOpts = (() => {
    const all: string[] = [];
    for(let h=7; h<=19; h++) for(let m=0; m<60; m+=15) all.push(`${fmt2(h)}:${fmt2(m)}`);
    all.push('19:00');
    const unique = [...new Set(all)].sort();
    return unique.filter(t => timeToMin(t) > timeToMin(form.start) && timeToMin(t) <= 19*60);
  })();
  // 오늘인데 예약 가능한 시작 슬롯이 없는 경우 (18:45 이후)
  const noTimeLeft = bookingDate === todayStr() && tOpts.length === 0;

  const validTime   = form.start < form.end;
  const durMin      = timeToMin(form.end) - timeToMin(form.start);
  const selectedRoom     = form.room_id ? ROOMS_DB.find(r=>r.room_id===form.room_id) : null;
  const selectedFloor    = selectedRoom  ? getFloor(selectedRoom.floor_id) : null;
  const selectedFeatures = selectedRoom  ? getRoomFeatures(selectedRoom.room_id) : [];

  // ── 편집 모드에서 자기 자신 예약 제외 (충돌 검사 용) ──
  const bookingsForCheck = editBooking
    ? bookings.filter(b => b.id !== editBooking.id)
    : bookings;

  // ── 중앙화된 가용 회의실 검증 ──
  const { available: availableRooms, unavailable: unavailableRooms } = useMemo(
    () => getAvailableRooms(ROOMS_DB, bookingsForCheck, bookingDate, form.start, form.end, isAdmin),
    [bookingsForCheck, bookingDate, form.start, form.end, isAdmin]
  );

  // 선택된 회의실이 현재 시간 기준으로 여전히 가용한지 실시간 검증
  const isSelectedRoomAvailable = form.room_id
    ? availableRooms.some(r => r.room_id === form.room_id)
    : false;

  // ── 핵심: 시간/날짜 변경 시 선택된 회의실이 불가능하면 자동 해제 ──
  // 초기 마운트 시에는 실행하지 않음 (prefill room_id 보호)
  // skipRoomClear: 자동 시간보정 직후 1회 skip — 캘린더 빈칸 클릭 시 room_id 보호
  const isMounted     = useRef(false);
  const skipRoomClear = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    if (skipRoomClear.current) { skipRoomClear.current = false; return; } // 자동보정 직후 skip
    if (form.room_id && validTime && !availableRooms.some(r => r.room_id === form.room_id)) {
      set("room_id", null);
    }
  }, [form.start, form.end, bookingDate, availableRooms]);

  // 시간이 흘러 form.start가 tOpts 범위 밖(과거)으로 밀려났을 때 자동 보정
  // tick(30초) 기반으로만 체크 — tOpts[0] 의존성은 React 렌더 사이클과 맞지 않아 제거
  useEffect(() => {
    if (bookingDate !== todayStr() || tOpts.length === 0) return;
    const startMin = timeToMin(form.start);
    const now = nowMinutes();
    if (startMin <= now) {
      const nextStart = tOpts[0];
      if (nextStart === form.start) return; // 이미 같으면 스킵
      const nextEndMin = Math.min(timeToMin(nextStart) + 60, 19*60);
      skipRoomClear.current = true; // 자동보정 발생 → auto-clear 1회 건너뜀
      setForm(f => ({
        ...f,
        start: nextStart,
        end: `${fmt2(Math.floor(nextEndMin/60))}:${fmt2(nextEndMin%60)}`,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingDate]); // 날짜 변경 시에만 보정 (tick 의존 제거)

  // 반복 선택 시 생성 가능 건수 미리 계산 (maxDate 기준)
  // 반복 예약 미리보기: 전체 날짜 목록 + 회의실 선택 시 충돌 날짜까지 계산
  const recurPreview = useMemo(() => {
    if (editBooking || recur === "NEVER") return { total: 1, available: 1, conflictDates: [], allDates: [] };
    const maxD2 = new Date(); maxD2.setMonth(maxD2.getMonth() + 1);
    const maxStr = objToStr(maxD2);
    const startDow = dateToObj(bookingDate).getDay();
    const allDates = [];
    let cur = dateToObj(bookingDate);
    const max = dateToObj(maxStr);
    while (cur <= max) {
      const ds = objToStr(cur), dow = cur.getDay();
      if (recur === "EVERY_DAY") allDates.push(ds);
      else if (recur === "EVERY_WEEK" && dow === startDow) allDates.push(ds);
      cur.setDate(cur.getDate() + 1);
    }
    // 회의실이 선택돼 있고 시간이 유효하면 충돌 날짜도 미리 계산
    const conflictDates = [];
    if (form.room_id && validTime) {
      const fS = timeToMin(form.start), fE = timeToMin(form.end);
      allDates.forEach(ds => {
        const check = hasTimeConflict(bookingsForCheck, form.room_id, ds, fS, fE);
        if (check.conflict) conflictDates.push(ds);
      });
    }
    return {
      total: allDates.length,
      available: allDates.length - conflictDates.length,
      conflictDates,
      allDates,
      maxStr,
    };
  }, [recur, bookingDate, form.room_id, form.start, form.end, validTime, bookings]);
  const recurPreviewCount = recurPreview.total; // 하위 호환용
  const canSubmit = !!(form.room_id && form.title.trim() && validTime && isSelectedRoomAvailable && recurPreview.available > 0);

  // ── 날짜 피커 helpers ───────────────────────────────────────────────────────
  const todayObj   = dateToObj(today);
  const maxObj     = dateToObj(maxDate);
  const canGoPrev  = calYear > todayObj.getFullYear() || (calYear===todayObj.getFullYear() && calMonth > todayObj.getMonth());
  const canGoNext  = calYear < maxObj.getFullYear()   || (calYear===maxObj.getFullYear()   && calMonth < maxObj.getMonth());
  const prevMonth  = () => { if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1); };
  const nextMonth  = () => { if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1); };

  const selectDate = (ds) => {
    if(ds < today || ds > maxDate) return;
    setBookingDate(ds);
    setShowPicker(false);
    set("room_id", null);
    // 오늘로 변경 시 start/end가 과거면 현재 기준으로 재계산
    if (ds === todayStr()) {
      const now = nowMinutes();
      const snapStart = Math.ceil((now+1)/15)*15;
      const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
      const clampedEnd   = Math.min(clampedStart+60, 19*60);
      const newStart = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
      const newEnd   = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
      setForm(f => ({...f, start:newStart, end:newEnd, room_id:null}));
    }
  };

  const calFirstDay    = new Date(calYear, calMonth, 1).getDay();
  const calDaysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const calCells       = [];
  for(let i=0; i<calFirstDay; i++) calCells.push(null);
  for(let i=1; i<=calDaysInMonth; i++) calCells.push(i);
  while(calCells.length%7!==0) calCells.push(null);

  // ── 참석자 helpers ──────────────────────────────────────────────────────────
  const addAttendee = (u) => {
    if (form.attendees.find(a => a.user_id === u.user_id)) return;
    set("attendees", [...form.attendees, { ...u, role: "ATTENDEE" }]);
    setAttendeeQ("");
    setAttendeeFocus(false);
  };
  const removeAttendee = (uid) => set("attendees", form.attendees.filter(a => a.user_id !== uid));

  // 검색 결과: 현재 사용자 + 이미 추가된 사람 제외
  const attendeeSuggestions = attendeeQ.trim().length > 0
    ? APP_USERS.filter(u =>
        u.user_id !== (APP_USERS.find(x => x.name === currentUser)?.user_id) &&
        !form.attendees.find(a => a.user_id === u.user_id) &&
        (u.name.includes(attendeeQ) || u.dept.toLowerCase().includes(attendeeQ.toLowerCase()) ||
         u.email.toLowerCase().includes(attendeeQ.toLowerCase()))
      ).slice(0, 6)
    : [];

  // 참석자 UI JSX (재사용: 모바일 Step1 + 데스크톱 폼)
  const AttendeeSection = (compact = false) => (
    <div>
      <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",
        marginBottom:6,letterSpacing:"0.4px"}}>
        참석자 <span style={{fontWeight:400,color:"#CBD5E1"}}>(선택 · SSO 연동 시 초대 메일 자동 발송)</span>
      </label>

      {/* 선택된 참석자 칩 */}
      {form.attendees.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
          {form.attendees.map(a => (
            <div key={a.user_id} style={{
              display:"inline-flex",alignItems:"center",gap:5,
              background:"#EEF2FF",color:"#000",
              fontSize:11,fontWeight:600,padding:"4px 10px 4px 8px",borderRadius:999,
            }}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"#3D88FF",
                color:"#fff",fontSize:9,fontWeight:800,
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                {a.name.charAt(0)}
              </div>
              <span>{a.name}</span>
              <span style={{color:"rgba(0,0,0,0.4)",fontSize:10}}>{a.dept}</span>
              <button onClick={()=>removeAttendee(a.user_id)}
                style={{background:"none",border:"none",cursor:"pointer",
                  color:"#d4d4d4",lineHeight:1,padding:0,marginLeft:2,display:"flex",alignItems:"center"}}><X size={10} strokeWidth={2}/></button>
            </div>
          ))}
        </div>
      )}

      {/* 검색 인풋 */}
      <div ref={attendeeRef} style={{position:"relative"}}>
        <input
          value={attendeeQ}
          onChange={e=>{setAttendeeQ(e.target.value);setAttendeeFocus(true);}}
          onFocus={()=>setAttendeeFocus(true)}
          placeholder="이름 또는 부서로 검색..."
          style={{width:"100%",background:"#F8FAFC",border:`1px solid ${attendeeFocus?"#6366F1":"#E2E8F0"}`,
            borderRadius:10,color:"#111111",padding:"10px 14px",fontSize:13,outline:"none"}}/>
        {/* 드롭다운 */}
        {attendeeFocus && attendeeSuggestions.length > 0 && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            boxShadow:"0 8px 24px rgba(0,0,0,0.10)",overflow:"hidden"}}>
            {attendeeSuggestions.map(u => (
              <div key={u.user_id} onClick={()=>addAttendee(u)}
                style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",
                  cursor:"pointer",borderBottom:"1px solid #F8FAFC"}}
                onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                <div style={{width:28,height:28,borderRadius:"50%",background:"#111111",
                  color:"#fff",fontSize:11,fontWeight:800,
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  {u.name.charAt(0)}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{u.name}</div>
                  <div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div>
                </div>
                <span style={{fontSize:11,color:"#CBD5E1",flexShrink:0}}>+ 추가</span>
              </div>
            ))}
          </div>
        )}
        {attendeeFocus && attendeeQ.trim().length > 0 && attendeeSuggestions.length === 0 && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            padding:"12px 14px",fontSize:12,color:"#94A3B8",
            boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
            검색 결과가 없습니다
          </div>
        )}
      </div>
    </div>
  );

  // ── 시간 버튼 picker 단계: "start" | "end"
  const [timePickerStep, setTimePickerStep] = useState("start");
  const [startOpen, setStartOpen] = useState(true);
  const [endOpen,   setEndOpen]   = useState(false);

  // 시간 버튼 선택 핸들러
  const handleTimeBtn = (t) => {
    if (timePickerStep === "start") {
      set("start", t);
      const newEnd = timeToMin(t) + 60;
      const clampedEnd = Math.min(newEnd, 19*60);
      set("end", `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`);
      setTimePickerStep("end");
      setStartOpen(false);
      setEndOpen(true);
    } else {
      if (timeToMin(t) <= timeToMin(form.start)) return;
      set("end", t);
      setTimePickerStep("start");
      setEndOpen(false);
    }
  };

  // 시간 버튼 그리드 공통 JSX
  const TimeRangePicker = () => {
    const startMin = timeToMin(form.start);
    const endMin   = timeToMin(form.end);
    const isPickingStart = timePickerStep === "start";
    const isPickingEnd   = timePickerStep === "end";

    const TimeGrid = ({ mode }) => {
      // 시작: tOpts(07:00~18:45), 종료: 시작보다 늦고 최대 19:00
      const gridSlots = mode === "end"
        ? [...new Set([...tOpts, "19:00"])].sort().filter(t => timeToMin(t) > timeToMin(form.start) && timeToMin(t) <= 19*60)
        : tOpts;
      return (
      <div style={{display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:5}}>
        {gridSlots.map(t => {
          const tMin     = timeToMin(t);
          const isActive = mode==="start" ? t===form.start : t===form.end;
          const inRange  = validTime && tMin > startMin && tMin < endMin;
          const isDisabled = (mode==="end" && tMin <= startMin)
                          || (bookingDate===todayStr() && tMin <= nowMinutes());
          const isPicking = mode==="start" ? isPickingStart : isPickingEnd;

          let bg="#F8FAFC", color="#475569", border="1px solid #E2E8F0", fw=500;
          if (isActive)        { bg="#111111"; color="#fff"; border="1px solid #111111"; fw=700; }
          else if (inRange && mode==="end") { bg="#EEF2FF"; color="#6366F1"; border="1px solid #C7D2FE"; }
          if (isDisabled)      { bg="#F8FAFC"; color="#D1D5DB"; border="1px solid #F1F5F9"; }

          return (
            <button key={t} disabled={isDisabled}
              onClick={()=>{ setTimePickerStep(mode); handleTimeBtn(t); }}
              style={{
                background:bg, color, border, fontWeight:fw,
                borderRadius:8, padding:"9px 2px", fontSize:11,
                cursor:isDisabled?"not-allowed":"pointer",
                transition:"background 0.1s",
                outline: isPicking && !isActive ? "2px dashed #E2E8F0" : "none",
                outlineOffset:"-2px",
              }}>
              {fmtTime(t)}
            </button>
          );
        })}
      </div>
      );
    }

    return (
      <div style={{display:"flex", flexDirection:"column", gap:10}}>

        {/* ── 시작 시간 섹션 ── */}
        <div style={{
          border:`2px solid ${isPickingStart && startOpen ? "#6366F1" : "#E2E8F0"}`,
          borderRadius:12, overflow:"hidden", transition:"border-color 0.15s",
        }}>
          <div onClick={()=>{ setStartOpen(o=>!o); setTimePickerStep("start"); }}
            style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"10px 14px", cursor:"pointer",
              background: isPickingStart && startOpen ? "#F5F3FF" : "#F8FAFC",
              borderBottom: startOpen ? "1px solid #F1F5F9" : "none",
            }}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{
                width:20,height:20,borderRadius:"50%",
                background: isPickingStart && startOpen ? "#6366F1" : form.start ? "#111111" : "#E2E8F0",
                color:"#fff", fontSize:10, fontWeight:800,
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              }}>1</div>
              <span style={{fontSize:12,fontWeight:700,
                color: isPickingStart && startOpen ? "#6366F1" : "#475569"}}>시작 시간</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:700,
                color: isPickingStart && startOpen ? "#6366F1" : "#111111"}}>
                {form.start ? fmtTime(form.start) : <span style={{color:"#CBD5E1",fontWeight:400}}>선택하세요</span>}
              </span>
              <span style={{color:"#CBD5E1",fontSize:11}}>startOpen ? <ChevronUp size={11} strokeWidth={2}/> : <ChevronDown size={11} strokeWidth={2}/></span>
            </div>
          </div>
          {startOpen && (
            <div style={{padding:"12px 10px", background:"#fff"}}>
              <TimeGrid mode="start"/>
            </div>
          )}
        </div>

        {/* ── 종료 시간 섹션 ── */}
        <div style={{
          border:`2px solid ${isPickingEnd && endOpen ? "#6366F1" : "#E2E8F0"}`,
          borderRadius:12, overflow:"hidden", transition:"border-color 0.15s",
        }}>
          <div onClick={()=>{ setEndOpen(o=>!o); setTimePickerStep("end"); }}
            style={{
              display:"flex", alignItems:"center", justifyContent:"space-between",
              padding:"10px 14px", cursor:"pointer",
              background: isPickingEnd && endOpen ? "#F5F3FF" : "#F8FAFC",
              borderBottom: endOpen ? "1px solid #F1F5F9" : "none",
            }}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{
                width:20,height:20,borderRadius:"50%",
                background: isPickingEnd && endOpen ? "#6366F1" : form.end && validTime ? "#111111" : "#E2E8F0",
                color:"#fff", fontSize:10, fontWeight:800,
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              }}>2</div>
              <span style={{fontSize:12,fontWeight:700,
                color: isPickingEnd && endOpen ? "#6366F1" : "#475569"}}>종료 시간</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {validTime && (
                <span style={{fontSize:11,color:"#94A3B8"}}>
                  {Math.floor(durMin/60)>0?`${Math.floor(durMin/60)}시간`:""}
                  {durMin%60>0?` ${durMin%60}분`:""}
                </span>
              )}
              <span style={{fontSize:13,fontWeight:700,
                color: isPickingEnd && endOpen ? "#6366F1" : validTime ? "#111111" : "#EF4444"}}>
                {form.end
                  ? <>{fmtTime(form.end)}{!validTime&&<AlertTriangle size={10} strokeWidth={2} style={{marginLeft:4,flexShrink:0,display:"inline-block",verticalAlign:"middle"}}/>}</>
                  : <span style={{color:"#CBD5E1",fontWeight:400}}>선택하세요</span>}
              </span>
              <span style={{color:"#CBD5E1",fontSize:11}}>endOpen ? <ChevronUp size={11} strokeWidth={2}/> : <ChevronDown size={11} strokeWidth={2}/></span>
            </div>
          </div>
          {endOpen && (
            <div style={{padding:"12px 10px", background:"#fff"}}>
              <TimeGrid mode="end"/>
            </div>
          )}
        </div>

      </div>
    );
  };

  // ── Step 상태 (모바일 전용) ─────────────────────────────────────────────────
  const [step, setStep] = useState(1); // 항상 step1(일정입력)부터 시작 — prefill room_id가 있어도 동일
  const canGoStep2 = !!(form.title.trim() && validTime);

  // ── 공통: 회의실 카드 그리드 ────────────────────────────────────────────────
  // 회의실별 상태 판별 (unavailable room용)
  const getRoomUnavailStatus = (rid) => {
    const now = nowMinutes();
    const isToday = bookingDate === todayStr();
    const dayBks = bookings.filter(b => b.room_id===rid && tsDate(b.start_at)===bookingDate && !b.autoCancelled);
    const fStart = timeToMin(form.start), fEnd = timeToMin(form.end);
    // 요청 시간과 겹치는 예약 찾기
    const conflict = dayBks.find(b => {
      const bs=tsMin(b.start_at), be=tsMin(b.end_at);
      return bs<fEnd && be>fStart;
    });
    if (!conflict) return { label:"예약됨", color:"#DC2626", bg:"#FEF2F2" };
    // 곧 시작 vs 이미 예약됨 구분
    if (isToday) {
      const minsUntil = tsMin(conflict.start_at) - now;
      if (minsUntil > 0 && minsUntil <= 30) return { label:"곧 시작", color:"#D97706", bg:"#FFFBEB" };
    }
    return { label:"예약됨", color:"#DC2626", bg:"#FEF2F2" };
  };

  const RoomGrid2 = (cols) => (
    <div style={{display:"grid", gridTemplateColumns:`repeat(${cols},1fr)`, gap:10}}>
      {/* 예약 가능 회의실 */}
      {availableRooms.map(r => {
        const fl=getFloor(r.floor_id);
        const isSel=form.room_id===r.room_id;
        const isAdminRoom = ADMIN_ONLY_ROOMS.has(r.room_id);
        return (
          <div key={r.room_id} onClick={()=>set("room_id", isSel?null:r.room_id)}
            style={{background:isSel?"#111":"#fff",
              border:`1.5px solid ${isSel?"#111":"#E2E8F0"}`, borderRadius:12,
              padding:"16px 18px", cursor:"pointer", transition:"all 0.15s", boxSizing:"border-box"}}
            onMouseEnter={e=>{if(!isSel){e.currentTarget.style.borderColor="#94A3B8";}}}
            onMouseLeave={e=>{if(!isSel){e.currentTarget.style.borderColor="#E2E8F0";}}}>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {isSel
                ? <span style={{background:"#B9F8CF",color:"#111",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:999,display:"inline-flex",alignItems:"center",gap:3}}><Check size={10} strokeWidth={2.5}/>선택됨</span>
                : <span style={{background:"#CBECFF",color:"#000",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:999}}>예약가능</span>}
              {isAdminRoom && !isSel && (
                <span style={{background:"#F1F5F9",color:"#64748B",fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:999}}>관리자 승인</span>
              )}
            </div>
            <div style={{fontSize:15,fontWeight:700,color:isSel?"#fff":"#111",marginBottom:4}}>{r.room_name}</div>
            <div style={{fontSize:12,color:isSel?"rgba(255,255,255,0.5)":"#94A3B8"}}>{fl.floor_name} · {r.capacity}인</div>
          </div>
        );
      })}
      {/* 사용 불가 회의실 — separator 없이 자연스럽게 이어짐 */}
      {unavailableRooms.map(r => {
        const fl=getFloor(r.floor_id);
        const st=getRoomUnavailStatus(r.room_id);
        return (
          <div key={r.room_id} style={{background:st.bg, border:"1.5px solid transparent",
            borderRadius:12, padding:"16px 18px", boxSizing:"border-box"}}>
            <div style={{marginBottom:10}}>
              <span style={{background:st.bg==="FEF2F2"?"#FEE2E2":"#FEE2E2",color:st.color,fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:999}}>{st.label}</span>
            </div>
            <div style={{fontSize:15,fontWeight:700,color:"#ff9494",marginBottom:4}}>{r.room_name}</div>
            <div style={{fontSize:12,color:"#ff9494",opacity:0.6}}>{fl.floor_name} · {r.capacity}인</div>
          </div>
        );
      })}
    </div>
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────────
  // 모바일: visualViewport 실제 가시 높이 기준으로 모달 높이 결정
  // (iOS Safari 주소창/탭바 영역을 정확히 제외)
  const modalMaxH = isMobile
    ? Math.floor(vvHeight * 0.92)   // 가시 영역의 92%
    : "90vh";

  return (
    <div className="anm" style={{
      background:"#fff",
      borderRadius: isMobile ? "20px 20px 0 0" : 16,
      width:"100%", maxWidth: isMobile ? "100%" : 960,
      // 모바일: 높이 제약 없이 스크롤 영역이 자연스럽게 확장
      maxHeight: isMobile ? "none" : modalMaxH,
      // 모바일은 overlay가 flex-end이므로 자동으로 바텀시트처럼 붙음
      height: isMobile ? "100%" : "auto",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column",
      overflow: isMobile ? "auto" : "hidden",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {/* 모바일 핸들 */}
      {isMobile && <div style={{width:36,height:4,background:"#E2E8F0",borderRadius:2,
        position:"absolute",top:8,left:"50%",transform:"translateX(-50%)",zIndex:10}}/>}

      {/* ════ 헤더 (고정) ════ */}
      <div style={{padding: isMobile?"20px 20px 12px":"24px 28px 18px",
        borderBottom:"1px solid #F1F5F9",display:"flex",
        justifyContent:"space-between",alignItems:"center",flexShrink:0}}>

        {isMobile ? (
          /* 모바일 헤더: 스텝 인디케이터 포함 */
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:800,color:"#111111",marginBottom:10}}>{editBooking ? "예약 변경" : "새 회의 예약"}</div>
            {/* Step 인디케이터 */}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {[{n:1,label:"일정 입력"},{n:2,label:"회의실 선택"}].map(({n,label},i)=>(
                <React.Fragment key={n}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:22,height:22,borderRadius:"50%",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:11,fontWeight:700,flexShrink:0,
                      background:step>=n?"#111111":"#F1F5F9",
                      color:step>=n?"#fff":"#94A3B8"}}>
                      {step>n?<CheckCircle2 size={12} strokeWidth={2}/>:n}
                    </div>
                    <span style={{fontSize:11,fontWeight:step===n?700:400,
                      color:step===n?"#111111":step>n?"#16A34A":"#94A3B8"}}>
                      {label}
                    </span>
                  </div>
                  {i===0&&<div style={{flex:1,height:1,background:step>1?"#111111":"#E2E8F0",margin:"0 4px"}}/>}
                </React.Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div style={{fontSize:18,fontWeight:800,color:"#111"}}>{editBooking ? "예약 변경" : "새 회의실 예약"}</div>
        )}
        <button className="btn" onClick={onClose}
          style={{background:"none",color:"#94A3B8",fontSize:22,marginLeft:12,flexShrink:0,
            padding:"4px",lineHeight:1,display:"flex",alignItems:"center"}}><X size={10} strokeWidth={2}/></button>
      </div>

      {/* ════ 모바일: 2-Step Wizard ════ */}
      {isMobile ? (<>
        {/* Step 바디 — 모바일: 자체 스크롤 제거, 모달 전체가 스크롤됨 */}
        <div style={{display:"flex",flexDirection:"column"}}>

          {/* Step 1: 일정 입력 */}
          {step===1 && (
            <div style={{padding:"16px 20px 8px",
              display:"flex",flexDirection:"column",gap:14}}>
              {/* 회의 제목 */}
              <div>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:6}}>회의 제목 *</label>
                <input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="회의 제목을 입력하세요" maxLength={40}
                  style={{width:"100%",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,
                    color:"#111111",padding:"12px 14px",fontSize:15,outline:"none"}}
                  onFocus={e=>e.target.style.borderColor="#111111"}
                  onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
                <div style={{textAlign:"right",fontSize:11,color:form.title.length>=38?"#EF4444":"#CBD5E1",marginTop:4}}>
                  {form.title.length}/40
                </div>
              </div>
              {/* 날짜 */}
              <div ref={pickerRef} style={{position:"relative",zIndex:200}}>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:6}}>날짜 *</label>
                <button className="btn" onClick={()=>setShowPicker(v=>!v)}
                  style={{width:"100%",background:"#F8FAFC",border:`1px solid ${showPicker?"#111111":"#E2E8F0"}`,
                    borderRadius:10,color:"#111111",padding:"12px 14px",fontSize:14,
                    display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5}}><Calendar size={13} strokeWidth={1.8}/>{bookingDate} ({DAY_NAMES[dateToObj(bookingDate).getDay()]})</span>
                  <ChevronDown size={10} strokeWidth={2} style={{color:"#94A3B8"}}/>
                </button>
                {showPicker && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                        style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                      <span style={{fontSize:13,fontWeight:700,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                      <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                        style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                      {DAY_NAMES.map((n,i)=>(
                        <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:700,
                          color:i===0?"#EF4444":i===6?"#3B82F6":"#94A3B8",padding:"2px 0"}}>{n}</div>
                      ))}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                      {calCells.map((day,idx)=>{
                        if(!day) return <div key={`e${idx}`}/>;
                        const ds=`${calYear}-${fmt2(calMonth+1)}-${fmt2(day)}`;
                        const disabled=ds<today||ds>maxDate, isSel=ds===bookingDate, isToday2=ds===today;
                        const dow=(calFirstDay+day-1)%7;
                        return (
                          <div key={day} onClick={()=>!disabled&&selectDate(ds)}
                            style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:13,
                              fontWeight:isSel||isToday2?700:400,
                              background:isSel?"#111111":isToday2?"#EFF6FF":"transparent",
                              color:disabled?"#D1D5DB":isSel?"#fff":isToday2?"#3B82F6":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151",
                              cursor:disabled?"not-allowed":"pointer"}}>
                            {day}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #F1F5F9",fontSize:10,color:"#94A3B8",textAlign:"center"}}>
                      오늘부터 1개월 이내만 선택 가능
                    </div>
                  </div>
                )}
              </div>
              {/* 시간 */}
              {TimeRangePicker()}
              {/* 메모 */}
              <div>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:6}}>메모 (선택)</label>
                <textarea value={form.memo} onChange={e=>set("memo",e.target.value)} rows={2} placeholder="안건, 준비물 등"
                  style={{width:"100%",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,
                    color:"#111111",padding:"12px 14px",fontSize:13,outline:"none",resize:"none"}}
                  onFocus={e=>e.target.style.borderColor="#111111"}
                  onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
              </div>
              {/* 참석자 */}
              {AttendeeSection()}
              {/* 반복 예약 */}
              {!editBooking && <div>
                <label style={{fontSize:11,fontWeight:700,color:"#94A3B8",display:"block",marginBottom:6,letterSpacing:"0.4px"}}>반복 예약</label>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[
                    {val:"NEVER",      label:"반복 안함",      sub:"단일 예약"},
                    {val:"EVERY_DAY",  label:"매일",           sub:"시작일부터 매일"},
                    {val:"EVERY_WEEK", label:"매주",           sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                  ].map(o=>(
                    <button key={o.val} onClick={()=>setRecur(o.val)}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"11px 14px",borderRadius:10,border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                        background:recur===o.val?"#111":"#F8FAFC",cursor:"pointer",textAlign:"left",transition:"all 0.13s"}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:recur===o.val?"#fff":"#374151"}}>{o.label}</div>
                        <div style={{fontSize:11,color:recur===o.val?"rgba(255,255,255,0.55)":"#94A3B8",marginTop:1}}>{o.sub}</div>
                      </div>
                      {recur===o.val && <CheckCircle2 size={14} strokeWidth={2} color="#fff"/>}
                    </button>
                  ))}
                </div>
                {recur!=="NEVER" && (
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
                    {/* 요약 배지 */}
                    <div style={{padding:"8px 12px",background:"#EFF6FF",borderRadius:8,fontSize:12,color:"#2563EB",fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span>{bookingDate} ~ {recurPreview.maxStr || ""}</span>
                      <span>
                        <b>{recurPreview.available}건</b> 예약 예정
                        {recurPreview.conflictDates.length > 0 && <span style={{color:"#DC2626",marginLeft:6}}>({recurPreview.conflictDates.length}건 불가)</span>}
                      </span>
                    </div>
                    {/* 충돌 날짜 경고 */}
                    {form.room_id && recurPreview.conflictDates.length > 0 && (
                      <div style={{padding:"8px 12px",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:11,color:"#DC2626"}}>
                        <div style={{fontWeight:700,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={2}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                          {recurPreview.conflictDates.slice(0,10).map(ds=>(
                            <span key={ds} style={{background:"#FEE2E2",padding:"2px 7px",borderRadius:4,fontWeight:600}}>{ds} ({DAY_NAMES[dateToObj(ds).getDay()]})</span>
                          ))}
                          {recurPreview.conflictDates.length > 10 && <span style={{color:"#EF4444"}}>외 {recurPreview.conflictDates.length - 10}건</span>}
                        </div>
                      </div>
                    )}
                    {/* 회의실 미선택 시 안내 */}
                    {!form.room_id && (
                      <div style={{padding:"7px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:11,color:"#92400E"}}>
                        회의실을 선택하면 날짜별 예약 가능 여부를 미리 확인할 수 있습니다
                      </div>
                    )}
                  </div>
                )}
              </div>}
            </div>
          )}

          {/* Step 2: 회의실 선택 — 전체 높이 독립 스크롤 */}
          {step===2 && (
            <div style={{padding:"14px 20px 8px",
              display:"flex",flexDirection:"column",gap:12}}>
              {/* 예약 요약 칩 */}
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"10px 14px",
                display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#111111"}}>{form.title||"(제목 없음)"}</div>
                  <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>
                    {bookingDate} · {fmtTime(form.start)} – {fmtTime(form.end)}
                  </div>
                </div>
                <button className="btn" onClick={()=>setStep(1)}
                  style={{background:"#F1F5F9",color:"#64748B",padding:"5px 11px",fontSize:11,borderRadius:999,flexShrink:0}}>수정</button>
              </div>
              {/* 선택된 회의실 확인 */}
              {selectedRoom && (
                <div style={{background:"#F0FDF4",border:"1px solid #86EFAC",borderRadius:10,padding:"10px 14px",
                  display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:"#111111"}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><CheckCircle2 size={12} strokeWidth={2}/>{selectedRoom.room_name}</span></div>
                    <div style={{fontSize:11,color:"#64748B",marginTop:2}}>{selectedFloor?.floor_name} · {selectedRoom.capacity}인</div>
                  </div>
                  <button className="btn" onClick={()=>set("room_id",null)}
                    style={{background:"#fff",color:"#EF4444",padding:"4px 10px",fontSize:11,border:"1px solid #FCA5A5",borderRadius:999}}>변경</button>
                </div>
              )}
              {/* 충돌 경고 — 선택된 회의실이 불가능한 경우 */}
              {form.room_id && validTime && !isSelectedRoomAvailable && (
                <div style={{background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:10,padding:"10px 14px",fontSize:12,color:"#DC2626",flexShrink:0}}>
                  선택한 회의실은 이 시간에 이미 예약이 있습니다. 다른 회의실을 선택해주세요.
                </div>
              )}
              {/* 회의실 헤더 */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <div style={{fontSize:12,fontWeight:700,color:"#111111"}}>
                  {fmtTime(form.start)} – {fmtTime(form.end)} 이용 가능 회의실
                </div>
                <span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:3,padding:"3px 10px",borderRadius:20}}>
                  <CheckCircle2 size={11} strokeWidth={2} style={{marginRight:3}}/>{availableRooms.length}개
                </span>
              </div>
              {/* 회의실 그리드 */}
              {RoomGrid2(2)}
            </div>
          )}
        </div>

        {/* ── 모바일 CTA 버튼 — 스크롤 영역 맨 아래 (fixed 없음) ── */}
        <div style={{
          padding:"16px 20px 32px",
          borderTop:"1px solid #F1F5F9",
          display:"flex",gap:8,background:"#fff",marginTop:"auto"}}>
          {step===1 ? (<>
            <button className="btn" onClick={onClose}
              style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"13px",fontSize:14,borderRadius:12}}>
              취소
            </button>
            <button className="btn" onClick={()=>setStep(2)} disabled={!canGoStep2}
              style={{flex:2,padding:"13px",fontSize:14,fontWeight:700,borderRadius:12,
                background:canGoStep2?"#111111":"#E2E8F0",
                color:canGoStep2?"#fff":"#94A3B8",
                cursor:canGoStep2?"pointer":"not-allowed"}}>
              다음 → 회의실 선택
            </button>
          </>) : (<>
            <button className="btn" onClick={()=>setStep(1)}
              style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"13px",fontSize:14,borderRadius:12}}>
              ← 이전
            </button>
            <button className="btn" disabled={!canSubmit}
              onClick={()=>{ if(!canSubmit)return; editBooking ? onUpdate({...form},bookingDate) : onSubmit({...form,recur},bookingDate); }}
              style={{flex:2,padding:"13px",fontSize:14,fontWeight:700,borderRadius:12,
                background:canSubmit?"#111111":"#E2E8F0",
                color:canSubmit?"#fff":"#94A3B8",
                cursor:canSubmit?"pointer":"not-allowed"}}>
              {editBooking ? "변경 저장" : "예약 확정"}
            </button>
          </>)}
        </div>
      </>) : (

      /* ════ 데스크톱: 이미지 기반 리디자인 ════ */
      <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* LEFT: 폼 (50%) */}
          <div style={{flex:1,padding:"24px 28px",borderRight:"1px solid #F1F5F9",
            display:"flex",flexDirection:"column",gap:18,overflowY:"auto"}}>
            {/* 회의 제목 */}
            <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>회의 제목 <span style={{color:"#EF4444"}}>*</span></label>
              <input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="회의 제목을 입력하세요 40자" maxLength={40}
                style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  color:"#111",padding:"12px 16px",fontSize:14,outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#111"}
                onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
            </div>
            {/* 날짜 — Date Picker */}
            <div ref={pickerRef2} style={{position:"relative",zIndex:200}}>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>날짜 <span style={{color:"#EF4444"}}>*</span></label>
              <button className="btn" onClick={()=>setShowPicker(v=>!v)}
                style={{width:"100%",background:"#fff",border:`1px solid ${showPicker?"#111111":"#E2E8F0"}`,
                  borderRadius:10,color:"#111111",padding:"12px 16px",fontSize:14,
                  display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}><Calendar size={13} strokeWidth={1.8}/>{bookingDate} ({DAY_NAMES[dateToObj(bookingDate).getDay()]})</span>
                {showPicker ? <ChevronUp size={10} strokeWidth={2} style={{color:"#94A3B8"}}/> : <ChevronDown size={10} strokeWidth={2} style={{color:"#94A3B8"}}/>}
              </button>
              {showPicker && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                  background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                  boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                      style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                    <span style={{fontSize:13,fontWeight:700,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                    <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                      style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                    {DAY_NAMES.map((n,i)=>(
                      <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:700,
                        color:i===0?"#EF4444":i===6?"#3B82F6":"#94A3B8",padding:"2px 0"}}>{n}</div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
                    {calCells.map((day,idx)=>{
                      if(!day) return <div key={`e${idx}`}/>;
                      const ds=`${calYear}-${fmt2(calMonth+1)}-${fmt2(day)}`;
                      const disabled=ds<today||ds>maxDate, isSel=ds===bookingDate, isToday2=ds===today;
                      const dow=(calFirstDay+day-1)%7;
                      return (
                        <div key={day} onClick={()=>!disabled&&selectDate(ds)}
                          style={{textAlign:"center",padding:"6px 2px",borderRadius:6,fontSize:13,
                            fontWeight:isSel||isToday2?700:400,
                            background:isSel?"#111111":isToday2?"#EFF6FF":"transparent",
                            color:disabled?"#D1D5DB":isSel?"#fff":isToday2?"#3B82F6":dow===0?"#EF4444":dow===6?"#3B82F6":"#374151",
                            cursor:disabled?"not-allowed":"pointer"}}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid #F1F5F9",fontSize:10,color:"#94A3B8",textAlign:"center"}}>
                    오늘부터 1개월 이내만 선택 가능
                  </div>
                </div>
              )}
            </div>
            {/* 시간 — 두 개 select + → */}
            <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>시간 <span style={{color:"#EF4444"}}>*</span></label>
              {noTimeLeft ? (
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                  background:"#F8FAFC",border:"1.5px dashed #CBD5E1",borderRadius:10,
                  padding:"14px 16px",color:"#94A3B8",fontSize:13,fontWeight:600,gap:8}}>
                  <Ban size={16} strokeWidth={1.8}/>
                  오늘은 더 예약할 수 없습니다
                </div>
              ) : (
                <>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{flex:1}}>
                      <select value={form.start} onChange={e=>{
                        set("start",e.target.value);
                        const newEnd=timeToMin(e.target.value)+60;
                        const clamped=Math.min(newEnd,19*60);
                        set("end",`${fmt2(Math.floor(clamped/60))}:${fmt2(clamped%60)}`);
                      }}
                        style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                          color:"#111",padding:"12px 16px",fontSize:14,fontWeight:700,outline:"none",appearance:"none",cursor:"pointer"}}>
                        {tOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                    <span style={{color:"#94A3B8",fontSize:16,flexShrink:0}}>→</span>
                    <div style={{flex:1}}>
                      <select value={form.end} onChange={e=>set("end",e.target.value)}
                        style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                          color:"#111",padding:"12px 16px",fontSize:14,fontWeight:700,outline:"none",appearance:"none",cursor:"pointer"}}>
                        {endOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                  </div>
                  {validTime && (
                    <div style={{textAlign:"right",marginTop:6,fontSize:12,color:"#94A3B8"}}>
                      소요시간 <span style={{color:"#111",fontWeight:700}}>
                        {Math.floor(durMin/60)>0?`${Math.floor(durMin/60)}시간`:""}
                        {durMin%60>0?` ${durMin%60}분`:""}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
            {/* 선택된 회의실 */}
            <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>선택된 회의실</label>
              {selectedRoom ? (
                <div style={{background:"#b9f8cf42",border:"1.5px solid #86EFAC",borderRadius:10,padding:"14px 16px",
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:700,color:"#111"}}>{selectedRoom.room_name}</div>
                    <div style={{fontSize:12,color:"#64748B",marginTop:4}}>
                      {selectedFloor?.floor_name} · {selectedRoom.capacity}인
                    </div>
                  </div>
                  <button className="btn" onClick={()=>set("room_id",null)}
                    style={{background:"#fff",color:"#EF4444",padding:"6px 14px",fontSize:12,fontWeight:600,border:"1px solid #FCA5A5",borderRadius:999}}>변경</button>
                </div>
              ) : (
                <div style={{background:"#F8FAFC",border:"1.5px dashed #E2E8F0",borderRadius:10,padding:"18px",
                  textAlign:"center",fontSize:13,color:"#94A3B8"}}>
                  오른쪽에서 회의실을 선택해주세요
                </div>
              )}
            </div>
            {/* 참석자 */}
            <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>참석자</label>
              {form.attendees.length > 0 && (
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
                  {form.attendees.map(a => (
                    <div key={a.user_id} style={{display:"inline-flex",alignItems:"center",gap:5,
                      background:"#EEF2FF",color:"#000",fontSize:11,fontWeight:600,padding:"4px 10px 4px 8px",borderRadius:999}}>
                      <div style={{width:18,height:18,borderRadius:"50%",background:"#3D88FF",color:"#fff",fontSize:9,fontWeight:800,
                        display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{a.name.charAt(0)}</div>
                      {a.name}
                      <button onClick={()=>removeAttendee(a.user_id)} style={{background:"none",border:"none",cursor:"pointer",color:"#6366F1",padding:0,marginLeft:2,display:"inline-flex",alignItems:"center"}}><X size={11} strokeWidth={2}/></button>
                    </div>
                  ))}
                </div>
              )}
              <div ref={attendeeRef} style={{position:"relative"}}>
                <input value={attendeeQ} onChange={e=>{setAttendeeQ(e.target.value);setAttendeeFocus(true);}}
                  onFocus={()=>setAttendeeFocus(true)}
                  placeholder="회의 참석자에게 메일이 발송됩니다 SSO 연동시 작동"
                  style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                    color:"#111",padding:"12px 16px",fontSize:13,outline:"none"}}/>
                {attendeeFocus && attendeeSuggestions.length > 0 && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.10)",overflow:"hidden"}}>
                    {attendeeSuggestions.map(u => (
                      <div key={u.user_id} onClick={()=>addAttendee(u)}
                        style={{display:"flex",alignItems:"center",gap:10,padding:"9px 14px",cursor:"pointer",borderBottom:"1px solid #F8FAFC"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                        onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                        <div style={{width:28,height:28,borderRadius:"50%",background:"#111",color:"#fff",fontSize:11,fontWeight:800,
                          display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{u.name.charAt(0)}</div>
                        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#111"}}>{u.name}</div><div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div></div>
                        <span style={{fontSize:11,color:"#CBD5E1"}}>+ 추가</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* 메모 */}
            <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>메모 (선택)</label>
              <textarea value={form.memo} onChange={e=>set("memo",e.target.value)} rows={3} placeholder="안건, 준비물 등"
                style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  color:"#111",padding:"12px 16px",fontSize:13,outline:"none",resize:"none"}}
                onFocus={e=>e.target.style.borderColor="#111"}
                onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
            </div>
            {/* 반복 예약 */}
            {!editBooking && <div>
              <label style={{fontSize:13,fontWeight:700,color:"#111",display:"block",marginBottom:8}}>반복 예약</label>
              <div style={{display:"flex",gap:8}}>
                {[
                  {val:"NEVER",      label:"반복 안함", sub:"단일"},
                  {val:"EVERY_DAY",  label:"매일",      sub:"시작일~1달"},
                  {val:"EVERY_WEEK", label:"매주",      sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                ].map(o=>(
                  <button key={o.val} onClick={()=>setRecur(o.val)}
                    style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      padding:"12px 8px",borderRadius:10,
                      border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                      background:recur===o.val?"#111":"#F8FAFC",
                      cursor:"pointer",transition:"all 0.13s"}}>
                    <span style={{fontSize:13,fontWeight:700,color:recur===o.val?"#fff":"#374151"}}>{o.label}</span>
                    <span style={{fontSize:10,color:recur===o.val?"rgba(255,255,255,0.5)":"#94A3B8",textAlign:"center"}}>{o.sub}</span>
                  </button>
                ))}
              </div>
              {recur!=="NEVER" && (
                <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:6}}>
                  {/* 요약 배지 */}
                  <div style={{padding:"8px 12px",background:"#EFF6FF",borderRadius:8,fontSize:12,color:"#2563EB",fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span>{bookingDate} ~ {recurPreview.maxStr || ""}</span>
                    <span>
                      <b>{recurPreview.available}건</b> 예약 예정
                      {recurPreview.conflictDates.length > 0 && <span style={{color:"#DC2626",marginLeft:6}}>({recurPreview.conflictDates.length}건 불가)</span>}
                    </span>
                  </div>
                  {/* 충돌 날짜 경고 */}
                  {form.room_id && recurPreview.conflictDates.length > 0 && (
                    <div style={{padding:"8px 12px",background:"#FEF2F2",border:"1px solid #FCA5A5",borderRadius:8,fontSize:11,color:"#DC2626"}}>
                      <div style={{fontWeight:700,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={2}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                        {recurPreview.conflictDates.slice(0,10).map(ds=>(
                          <span key={ds} style={{background:"#FEE2E2",padding:"2px 7px",borderRadius:4,fontWeight:600}}>{ds} ({DAY_NAMES[dateToObj(ds).getDay()]})</span>
                        ))}
                        {recurPreview.conflictDates.length > 10 && <span style={{color:"#EF4444"}}>외 {recurPreview.conflictDates.length - 10}건</span>}
                      </div>
                    </div>
                  )}
                  {/* 회의실 미선택 시 안내 */}
                  {!form.room_id && (
                    <div style={{padding:"7px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:11,color:"#92400E"}}>
                      회의실을 선택하면 날짜별 예약 가능 여부를 미리 확인할 수 있습니다
                    </div>
                  )}
                </div>
              )}
            </div>}
          </div>

          {/* RIGHT: 회의실 패널 (50%) */}
          <div style={{flex:1,padding:"24px 28px",overflowY:"auto",display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <div style={{fontSize:17,fontWeight:800,color:"#111"}}>
                {validTime?`${fmtTime(form.start)} - ${fmtTime(form.end)} 이용 가능 회의실`:"시간을 먼저 선택해주세요"}
              </div>
              {validTime&&<div style={{fontSize:13,color:"#94A3B8",marginTop:4}}>{availableRooms.length}개 가능 · 클릭해서 선택</div>}
            </div>
            {!validTime ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"#CBD5E1"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Clock size={40} strokeWidth={1.2} color="#CBD5E1"/></div>
                <div style={{fontSize:13}}>시작/종료 시간을 설정하면<br/>예약 가능한 회의실이 자동으로 표시됩니다</div>
              </div>
            ) : RoomGrid2(2)}
          </div>
        </div>

        {/* ── 하단 버튼 (모달 전체 너비) ── */}
        <div style={{display:"flex",gap:10,padding:"16px 28px 20px",borderTop:"1px solid #F1F5F9",flexShrink:0,background:"#fff"}}>
          <button className="btn" onClick={onClose}
            style={{flex:1,background:"#F1F5F9",color:"#64748B",padding:"14px",fontSize:14,borderRadius:12}}>
            취소
          </button>
          <button className="btn" disabled={!canSubmit}
            onClick={()=>{ if(!canSubmit)return; editBooking ? onUpdate({...form},bookingDate) : onSubmit({...form,recur},bookingDate); }}
            style={{flex:1,padding:"14px",fontSize:14,fontWeight:700,borderRadius:12,
              background:canSubmit?"#111":"#E2E8F0",
              color:canSubmit?"#fff":"#94A3B8",
              cursor:canSubmit?"pointer":"not-allowed"}}>
            {editBooking ? "변경 저장" : "예약 확정"}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────
