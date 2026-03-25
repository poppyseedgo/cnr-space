import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Layers, Users, UsersRound, Building2, Clock, User, Monitor, FileText, XCircle, AlertTriangle, CheckCircle2, Circle, X, Calendar, Home, LayoutGrid, LogOut, Settings, Search, BarChart2, ClipboardList, Inbox, ChevronDown, ChevronUp, AlertCircle, CheckCheck, Ban, Check } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from './utils/time'
import { ROOMS_DB, APP_USERS, ADMIN_ONLY_ROOMS, getFloor, getRoomFeatures, getRoomById } from './data/master'
import { loadBookings, saveBookings, insertBooking, updateBooking as apiUpdateBooking, cancelBooking as apiCancelBooking, subscribeBookings, loadRooms, saveRooms, loadUsers, saveUsers, loadRoomImages } from './lib/api'
import { supabase } from './lib/supabase'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType } from './types'
import { HomeView, RoomDetailModal } from './components/room/HomeView'
import { CalendarShell } from './components/layout/CalendarShell'
import { BookingModal } from './components/booking/BookingModal'
import { DetailModal } from './components/booking/DetailModal'
import { BookingDoneModal } from './components/booking/BookingDoneModal'
import { RecurDoneModal } from './components/booking/RecurDoneModal'
import { MyPageView } from './pages/MyPage'
import { AdminView } from './pages/AdminPage'
import LoginPage from './pages/LoginPage'
import { useBreakpoint, useVisualViewport } from './hooks/useBreakpoint'
import { AuthProvider, useAuth } from './hooks/useAuth'


// ─── App ──────────────────────────────────────────────────────────────────────
function AppContent() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  const [bookings, setBookings]   = useState([]);
  const [rooms, setRooms]         = useState(ROOMS_DB);
  const [users, setUsers]         = useState(APP_USERS);
  // URL 해시에서 초기 view 복원 (#home, #calendar, #mypage, #admin)
  const getViewFromHash = (): string => {
    const hash = window.location.hash.replace('#', '')
    return ['home','calendar','mypage','admin'].includes(hash) ? hash : 'home'
  }
  const [view, setViewState] = useState<string>(getViewFromHash);
  const setView = (v: string) => {
    setViewState(v)
    window.location.hash = v
    // 탭 전환 시 해당 화면 필터 초기화
    if (v === 'home')     setHomeFilterFloor('ALL')
    if (v === 'calendar') setCalFilterFloor('ALL')
  }
  const [calView, setCalView]     = useState("timeline");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [modal, setModal]         = useState(null);
  const [toast, setToast]         = useState(null);
  const [searchQ, setSearchQ]     = useState("");
  const [homeFilterFloor, setHomeFilterFloor] = useState("ALL");  // 홈화면 전용
  const [calFilterFloor,  setCalFilterFloor]  = useState("ALL");  // 캘린더 전용
  const [tick, setTick]           = useState(0);
  const [loading, setLoading]     = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const { currentUser: authUser, logout, isAdmin, loading: authLoading } = useAuth()
  const currentUser = authUser?.name ?? ""
  const currentDept = authUser?.dept ?? ""

  // 데이터 로딩: authUser가 확정된 후 실행
  // - authUser가 null→유저로 바뀔 때(로그인) 재실행
  // - authUser가 유저→null로 바뀔 때(로그아웃) 스킵
  useEffect(() => {
    if (authLoading) return;  // Auth 초기화 중이면 대기
    if (!authUser) {          // 미로그인이면 데이터 로딩 불필요
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.all([loadBookings(), loadRooms(), loadUsers()])
      .then(async ([b, r, u]) => {
        // rooms 테이블에서 이미지 URL 병합
        const roomsWithImages = await Promise.all(r.map(async room => {
          const imgs = await loadRoomImages(room.room_id)
          return { ...room, thumbnail: imgs.thumbnail_url, gallery: imgs.gallery_urls }
        }))
        setBookings(b); setRooms(roomsWithImages); setUsers(u);
      })
      .catch(err => { console.error('[App] 초기 데이터 로딩 실패:', err); })
      .finally(() => { setLoading(false); });
  }, [authLoading, authUser?.user_id]);

  // 틱 타이머 + Realtime + 이벤트 리스너 + 탭 복귀 새로고침 (마운트 1회)
  useEffect(() => {
    // ① 10초마다 tick → 시간 기반 UI 상태 즉시 반영 (체크인 대기/사용중 등)
    const iv = setInterval(() => setTick(t => t+1), 10000);

    // ② Realtime 구독 → 다른 사람 예약/취소/체크인 시 즉시 반영
    const unsubscribe = subscribeBookings(() => {
      loadBookings().then(b => setBookings(b))
    });

    // ③ Page Visibility API → 탭 복귀 시 데이터 강제 새로고침
    // (자리 비운 사이 바뀐 예약 상태를 즉시 반영)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadBookings().then(b => setBookings(b));
        setTick(t => t+1);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ④ 예약하기 이벤트
    const handler = () => setModal({type:"new", prefill:{}});
    document.addEventListener("openNewBooking", handler);

    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener("openNewBooking", handler);
      unsubscribe();
    };
  }, []);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const h = (e) => { if(dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const showToast = useCallback((msg, type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null), 3500);
  }, []);

  // ── 이메일 알림 발송 (Fire & Forget — 실패해도 예약 로직에 영향 없음) ──
  const sendNotification = useCallback(async (
    type: 'created' | 'updated' | 'cancelled' | 'noshow',
    booking: any,
    attendeeEmails: string[] = []
  ) => {
    try {
      // anon key로 호출 (Edge Function JWT 검증 비활성화)
      const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${supabaseAnon}`,
          'apikey':        supabaseAnon,
        },
        body: JSON.stringify({ type, booking, attendeeEmails }),
      })
    } catch (e) {
      console.warn('[notify] 알림 발송 실패 (예약은 정상 처리됨):', e)
    }
  }, []);



  const [isSubmitting, setIsSubmitting] = useState(false);

  const addBooking = useCallback(async (form, date) => {
    if (isSubmitting) return false;
    setIsSubmitting(true);
    try {
      const d     = date || selectedDate;
      const fStart = timeToMin(form.start), fEnd = timeToMin(form.end);
      const recur  = form.recur || "NEVER"; // "NEVER" | "EVERY_DAY" | "EVERY_WEEK"

      // ── 기본 유효성 ──
      if (!form.room_id || !form.title.trim() || fStart >= fEnd) {
        showToast("예약 정보를 확인해주세요.", "error");
        return false;
      }
      // ── ADMIN_ONLY 권한 체크 ──
      if (ADMIN_ONLY_ROOMS.has(form.room_id) && !isAdmin) {
        showToast("해당 회의실은 관리자만 예약할 수 있습니다.", "error");
        return false;
      }

      // ── 반복 날짜 목록 생성 ──
      const maxD = new Date(); maxD.setMonth(maxD.getMonth() + 1);
      const maxDateStr = objToStr(maxD);
      const targetDates = [];
      if (recur === "NEVER") {
        targetDates.push(d);
      } else {
        const startDow = dateToObj(d).getDay(); // 시작 요일 (EVERY_WEEK 용)
        let cur = dateToObj(d);
        const max = dateToObj(maxDateStr);
        while (cur <= max) {
          const ds  = objToStr(cur);
          const dow = cur.getDay();
          if (recur === "EVERY_DAY") {
            targetDates.push(ds);
          } else if (recur === "EVERY_WEEK" && dow === startDow) {
            targetDates.push(ds);
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      if (targetDates.length === 0) {
        showToast("반복 예약 가능한 날짜가 없습니다.", "error");
        return false;
      }

      // ── freshBookings 준비 ──
      // 단건(NEVER): canSubmit이 이미 충돌 검사를 마쳤으므로 메모리 상태 직접 사용.
      //              storage.get + seedDemoBookings 재실행 비용 제거 → 즉시 응답.
      // 반복(EVERY_DAY/WEEK): 다수 날짜를 루프 돌며 freshBookings를 갱신해가므로
      //                       storage에서 최신값을 로드해 race condition 방지.
      let freshBookings;
      if (recur === "NEVER") {
        freshBookings = bookings;
      } else {
        try { freshBookings = await loadBookings(); }
        catch (_) { freshBookings = bookings; }
      }

      // ── 날짜별 충돌 검사 → 충돌 날짜 스킵, 나머지 생성 ──
      const room  = ROOMS_DB.find(r => r.room_id === form.room_id);
      const floor = getFloor(room?.floor_id);
      const createdAt    = Date.now();
      const recurGroupId = recur !== "NEVER" ? `rg_${createdAt}` : null;
      const newBookings  = [];
      let   skipped      = 0;

      for (let i = 0; i < targetDates.length; i++) {
        const td    = targetDates[i];
        const check = hasTimeConflict(freshBookings, form.room_id, td, fStart, fEnd);
        if (check.conflict) { skipped++; continue; }

        const nb = {
          id:           `b${createdAt}_${i}`,
          room_id:      form.room_id,
          title:        form.title,
          memo:         form.memo,
          attendees:    form.attendees || [],
          start_at:     makeTZ(td, form.start),
          end_at:       makeTZ(td, form.end),
          user:         currentUser,
          dept:         currentDept,
          checkedIn:    false,
          autoCancelled:false,
          createdAt,
          recurGroupId,  // null이면 단건, 값이 있으면 반복 그룹
          _seed:         false,
        };
        newBookings.push(nb);
        // 이후 루프의 충돌 검사에도 새 예약 반영
        freshBookings = [nb, ...freshBookings];
      }

      if (newBookings.length === 0) {
        showToast("선택한 시간에 모든 날짜가 이미 예약되어 있습니다.", "error");
        return false;
      }

      // ── Supabase 저장 ──
      try {
        for (const nb of newBookings) {
          await insertBooking(nb);
        }
      } catch (err: any) {
        showToast(err.message ?? "예약 저장에 실패했습니다.", "error");
        return false;
      }

      // ── UI 즉시 반영 (Realtime 오기 전 낙관적 업데이트) ──
      setBookings(prev => {
        const ids = new Set(newBookings.map(b => b.id));
        return [...prev.filter(b => !ids.has(b.id)), ...newBookings];
      });

      // ── 완료 피드백 ──
      if (recur === "NEVER") {
        setModal({ type: "bookingDone", data: newBookings[0] });
        // 이메일 알림 발송
        const createdRoom = ROOMS_DB.find(r => r.room_id === newBookings[0].room_id)
        sendNotification('created', {
          ...newBookings[0],
          user_email:   authUser?.email,
          room_name:    createdRoom?.room_name_ko ?? createdRoom?.room_name ?? String(newBookings[0].room_id) + 'F',
        });
      } else {
        setModal({ type: "recurDone", data: {
          bookings: newBookings,
          skipped,
          recur,
          room: ROOMS_DB.find(r => r.room_id === form.room_id),
          floor: getFloor(ROOMS_DB.find(r => r.room_id === form.room_id)?.floor_id),
        }});
      }
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }, [bookings, selectedDate, currentUser, currentDept, showToast, isSubmitting, isAdmin]);

  const checkIn = useCallback(async (id) => {
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:true} : b));
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, { checkedIn: true });
      showToast("체크인 완료!");
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:false} : b));
      showToast(err.message ?? "체크인에 실패했습니다.", "error");
    }
  }, [showToast]);

  const earlyEnd = useCallback(async (id) => {
    const now = nowMinutes();
    const target = bookings.find(b => b.id === id);
    if (!target) return;
    // 현재 시각이 start_at보다 최소 1분 이후여야 constraint 통과
    const startMin  = tsMin(target.start_at);
    const safeNow   = Math.max(now, startMin + 1);
    const endTimeStr = `${fmt2(Math.floor(safeNow/60))}:${fmt2(safeNow%60)}`;
    // start_at의 날짜가 UTC로 저장됐을 수 있으므로 KST 날짜 기준으로 계산
    const todayKST  = todayStr();
    const newEndAt  = makeTZ(todayKST, endTimeStr);

    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id
      ? {...b, end_at: newEndAt, earlyEnded: true} : b
    ));
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, { earlyEnded: true, end_at: newEndAt });
      showToast("사용 완료! 회의실이 반환되었습니다.");
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id
        ? {...b, end_at: target.end_at, earlyEnded: false} : b
      ));
      showToast(err.message ?? "조기 반납에 실패했습니다.", "error");
    }
  }, [bookings, showToast]);

  const cancelBooking = useCallback(async (id) => {
    // 취소 전 예약 정보 먼저 저장 (낙관적 업데이트 전에)
    const targetBooking = bookings.find(b => b.id === id);
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:true} : b));
    setModal(null);
    try {
      await apiCancelBooking(id);
      showToast("예약이 취소되었습니다.", "info");
      // 이메일 알림 발송
      if (targetBooking) {
        const cancelledRoom = ROOMS_DB.find(r => r.room_id === targetBooking.room_id)
        sendNotification('cancelled', {
          ...targetBooking,
          user_email: authUser?.email,
          room_name:  cancelledRoom?.room_name_ko ?? cancelledRoom?.room_name ?? String(targetBooking.room_id) + 'F',
        });
      }
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:false} : b));
      showToast(err.message ?? "취소에 실패했습니다.", "error");
    }
  }, [bookings, showToast, authUser?.email, sendNotification]);

  // ── 예약 변경 ──────────────────────────────────────────────────────────────
  const updateBooking = useCallback(async (form, date, originalId) => {
    if (!form.room_id || !form.title.trim() || timeToMin(form.start) >= timeToMin(form.end)) {
      showToast("예약 정보를 확인해주세요.", "error"); return false;
    }
    const otherBookings = bookings.filter(b => b.id !== originalId);
    const check = hasTimeConflict(otherBookings, form.room_id, date, timeToMin(form.start), timeToMin(form.end));
    if (check.conflict) {
      showToast("선택한 시간에 이미 예약이 있습니다.", "error"); return false;
    }
    const changes = {
      room_id:   form.room_id,
      title:     form.title,
      memo:      form.memo,
      attendees: form.attendees || [],
      start_at:  makeTZ(date, form.start),
      end_at:    makeTZ(date, form.end),
    };
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id === originalId ? { ...b, ...changes } : b));
    setModal(null);
    try {
      await apiUpdateBooking(originalId, changes);
      showToast("예약이 변경되었습니다.");
      // 이메일 알림 발송
      const updatedB = bookings.find(b => b.id === originalId);
      if (updatedB) {
        const updatedRoom = ROOMS_DB.find(r => r.room_id === (changes.room_id ?? updatedB.room_id))
        sendNotification('updated', {
          ...updatedB, ...changes,
          user_email: authUser?.email,
          room_name:  updatedRoom?.room_name_ko ?? updatedRoom?.room_name ?? String(updatedB.room_id) + 'F',
        });
      }
    } catch (err: any) {
      // 실패 시 원복
      const latest = await loadBookings();
      setBookings(latest);
      showToast(err.message ?? "예약 변경에 실패했습니다.", "error");
    }
    return true;
  }, [bookings, showToast]);

  // Auto-cancel (미체크인 예약 자동 취소)
  useEffect(() => {
    const now=nowMinutes(), today=todayStr();
    const toCancel=bookings.filter(b=>
      tsDate(b.start_at)===today &&
      !b.checkedIn && !b.autoCancelled && !b.earlyEnded &&
      now > tsMin(b.start_at)+CHECKIN_WINDOW_MIN &&
      true  // 모든 예약 대상
    );
    if(toCancel.length===0) return;
    const ids=new Set(toCancel.map(b=>b.id));
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => ids.has(b.id) ? {...b, autoCancelled:true} : b));
    // DB 반영
    Promise.all(toCancel.map(b => apiCancelBooking(b.id))).catch(console.error);
  }, [tick]);

  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvH, off: vvOff } = useVisualViewport();

  // ── 인증 로딩 중 ──
  if (authLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",background:"#F3F4F8"}}>
      <div style={{width:32,height:32,border:"3px solid #E2E8F0",borderTop:"3px solid #6366F1",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  // ── 미로그인 → 로그인 페이지 ──
  if (!authUser) return <LoginPage />

  // ── 데이터 로딩 중 ──
  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-slate-50 dark:bg-slate-900">
      <div className="text-center text-slate-400">
        <div className="mb-3" style={{display:"flex",justifyContent:"center"}}><Building2 size={48} strokeWidth={1.2} color="#CBD5E1"/></div>
        <div className="text-sm font-semibold">로딩 중...</div>
      </div>
    </div>
  );

  return (
    <div className={dark ? "dark" : ""}>
    <div className="dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-200" style={{background:"#F3F4F8"}}>
{/* ── Header ── */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[100]">
        <div style={{maxWidth:1280, margin:"0 auto", padding: isMobile?"0 12px":"0 28px"}}>
          <div style={{display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", height: isMobile?52:64, gap:12}}>

            {/* ① 브랜드 (left) — 클릭 시 홈 */}
            <div className="flex items-center min-w-0 cursor-pointer" onClick={()=>setView("home")}>
              <div className="min-w-0">
                <div className="font-extrabold text-slate-900 dark:text-white tracking-tight truncate"
                  style={{fontSize: isMobile?13:15}}>
                  {isMobile ? "C&R" : "C&R Booking Room"}
                </div>
              </div>
            </div>

            {/* ② Nav pills (center) — mypage/admin에서는 숨김 */}
            {(view==="home"||view==="calendar") ? (
              <div className="flex dark:bg-slate-700 rounded-full p-1 gap-1" style={{background:"#F3F4F8"}}>
                {([ ["home", <Home size={14} strokeWidth={1.8}/>, "실시간 현황"] as const, ["calendar", <Calendar size={14} strokeWidth={1.8}/>, "캘린더 뷰"] as const ] as [string, React.ReactElement, string][]).map(([v,icon,label])=>(
                  <button key={v} onClick={()=>setView(v)}
                    className="btn flex items-center gap-1.5 rounded-full font-bold transition-all whitespace-nowrap"
                    style={{
                      padding: isMobile?"7px 12px":"8px 18px",
                      fontSize: isMobile?12:13,
                      background: view===v ? (dark?"#F1F5F9":"#111111") : "transparent",
                      color: view===v ? (dark?"#111111":"#fff") : (dark?"#94A3B8":"#64748B"),
                      boxShadow: view===v ? "0 2px 8px rgba(0,0,0,0.18)" : "none",
                    }}>
                    <span style={{fontSize: isMobile?13:14}}>{icon}</span>
                    {!isMobile && label}
                    {isMobile && (v==="home" ? "현황" : "캘린더")}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                <button className="btn" onClick={()=>setView("home")}
                  style={{background:"#F3F4F8",color:"#64748B",padding:"6px 14px",fontSize:12,borderRadius:999,
                    display:"flex",alignItems:"center",gap:5}}>
                  ← <span style={{fontWeight:700}}>{view==="mypage"?"My Page":"Admin"}</span>에서 홈으로
                </button>
              </div>
            )}

            {/* ③ 우측: 유저 드롭다운 */}
            <div className="flex items-center gap-2 justify-end">
              <div ref={dropdownRef} style={{position:"relative"}}>
                <button className="btn flex items-center gap-2 rounded-full border flex-shrink-0"
                  onClick={()=>setShowDropdown(v=>!v)}
                  style={{
                    padding: isMobile?"4px 4px":"5px 14px 5px 5px",
                    background: dark?"rgba(255,255,255,0.05)":"#F8FAFC",
                    borderColor: dark?"#475569":"#E2E8F0",
                    cursor:"pointer",
                  }}>
                  <div style={{
                    width:28, height:28, borderRadius:"50%",
                    background: "#CBECFF",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:12, fontWeight:800,
                    color: "#111111",
                  }}>
                    {currentUser.charAt(0)}
                  </div>
                  {!isMobile && (
                    <span style={{
                      fontSize:13, fontWeight:600,
                      color: dark?"#fff":"#111111",
                    }}>
                      {currentUser} <span style={{fontWeight:400,opacity:0.6}}>{currentDept}</span>
                    </span>
                  )}
                </button>

                {/* 드롭다운 메뉴 */}
                {showDropdown && (
                  <div className="anm" style={{
                    position:"absolute", top:"calc(100% + 6px)", right:0, zIndex:200,
                    background:"#fff", border:"1px solid #E2E8F0", borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.12)", overflow:"hidden",
                    minWidth:180,
                  }}>
                    {/* 사용자 정보 */}
                    <div style={{padding:"14px 16px",borderBottom:"1px solid #F1F5F9"}}>
                      <div style={{fontSize:13,fontWeight:700,color:"#111"}}>{currentUser}</div>
                      <div style={{fontSize:11,color:"#94A3B8",marginTop:2}}>{currentDept}</div>
                    </div>
                    {/* 메뉴 항목 */}
                    <div style={{padding:"4px 0"}}>
                      <button className="btn" onClick={()=>{setView("mypage");setShowDropdown(false);}}
                        style={{width:"100%",textAlign:"left",padding:"10px 16px",fontSize:13,
                          background:view==="mypage"?"#F8FAFC":"transparent",color:"#111",
                          display:"flex",alignItems:"center",gap:8}}
                        onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                        onMouseLeave={e=>e.currentTarget.style.background=view==="mypage"?"#F8FAFC":"transparent"}>
                        <User size={15} strokeWidth={1.8}/> My Page
                      </button>
                      {isAdmin && (
                        <button className="btn" onClick={()=>{setView("admin");setShowDropdown(false);}}
                          style={{width:"100%",textAlign:"left",padding:"10px 16px",fontSize:13,
                            background:view==="admin"?"#F8FAFC":"transparent",color:"#111",
                            display:"flex",alignItems:"center",gap:8}}
                          onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                          onMouseLeave={e=>e.currentTarget.style.background=view==="admin"?"#F8FAFC":"transparent"}>
                          <Settings size={15} strokeWidth={1.8}/> Admin
                        </button>
                      )}
                    </div>
                    {/* 하단 구분 */}
                    <div style={{borderTop:"1px solid #F1F5F9",padding:"4px 0"}}>
                      <button className="btn" disabled
                        style={{width:"100%",textAlign:"left",padding:"10px 16px",fontSize:13,
                          color:"#CBD5E1",display:"flex",alignItems:"center",gap:8,cursor:"not-allowed"}}>
                        <LogOut size={15} strokeWidth={1.8}/> 로그아웃 <span style={{fontSize:10,color:"#CBD5E1"}}>(SSO 연동 후)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* ── Views ── */}
      {(view==="home"||view==="calendar") && (
        <div style={{maxWidth:1280, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>
          {view==="home"     && <HomeView     bookings={bookings} rooms={rooms} tick={tick} searchQ={searchQ} setSearchQ={setSearchQ} filterFloor={homeFilterFloor} setFilterFloor={setHomeFilterFloor} onBook={(r, status)=>{
              // 바로예약: 지금 시각부터 다음 예약 직전까지 자동 설정
              const now = nowMinutes();
              const snapStart = Math.ceil((now+1)/15)*15;
              const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
              // 다음 예약이 있으면 그 시작 시간을 end 상한으로 사용
              const nextStartMin = status?.nextBooking ? tsMin(status.nextBooking.start_at) : 19*60;
              const clampedEnd = Math.min(clampedStart+60, nextStartMin, 19*60);
              // clampedEnd <= clampedStart: 현재 시각 snap이 다음 예약 직전 → 가능 시간 없음
              // 시간 없이 모달 열기 (사용자가 직접 설정)
              if (clampedEnd <= clampedStart) {
                setModal({type:"new", prefill:{room_id:r.room_id}});
                return;
              }
              const s = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
              const e = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
              setModal({type:"new", prefill:{room_id:r.room_id, start:s, end:e}});
            }} onDetail={(r)=>setModal({type:"roomDetail",data:r})} onCheckIn={checkIn} onEarlyEnd={earlyEnd} onCancel={cancelBooking} currentUser={currentUser} dark={dark} />}
          {view==="calendar" && <CalendarShell bookings={bookings} selectedDate={selectedDate} setSelectedDate={setSelectedDate} calView={calView} setCalView={setCalView} onBookingClick={b=>setModal({type:"detail",data:b})} onNewBooking={(d,h,rid)=>setModal({type:"new",prefill:{room_id:rid,start:h!=null?`${fmt2(h)}:00`:undefined,end:h!=null?`${fmt2(h+1)}:00`:undefined},date:d}) } onCheckIn={checkIn} filterFloor={calFilterFloor} setFilterFloor={setCalFilterFloor} />}
        </div>
      )}
      {view==="mypage" && <MyPageView bookings={bookings} setBookings={setBookings} currentUser={currentUser} currentDept={currentDept} showToast={showToast} isMobile={isMobile} onDetail={b=>setModal({type:"detail",data:b})} />}
      {view==="admin" && <AdminView bookings={bookings} setBookings={setBookings} rooms={rooms} setRooms={setRooms} users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile} isTablet={isTablet} />}

      {/* ── Modals ── */}
      {modal && (
        <div
          onClick={e=>e.target===e.currentTarget&&setModal(null)}
          style={{
            position:"fixed",
            // iOS Safari: visualViewport 기준으로 overlay 영역 정확히 잡기
            top: vvOff,
            left: 0,
            width: "100%",
            height: vvH,
            background:"rgba(15,23,42,0.55)",
            backdropFilter:"blur(6px)",
            display:"flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent:"center",
            zIndex:1000,
            padding: isMobile ? 0 : 16,
          }}>
          {modal.type==="new"         && <BookingModal prefill={modal.prefill} date={modal.date||selectedDate} onClose={()=>setModal(null)} onSubmit={addBooking} onUpdate={()=>false} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} />}
          {modal.type==="edit"         && <BookingModal prefill={{}} editBooking={modal.data} date={tsDate(modal.data.start_at)} onClose={()=>setModal(null)} onSubmit={async ()=>false} onUpdate={(form,date)=>updateBooking(form,date,modal.data.id)} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} />}
          {modal.type==="detail"      && <DetailModal booking={modal.data} onClose={()=>setModal(null)} onCheckIn={checkIn} onCancel={cancelBooking} onEdit={(b)=>setModal({type:"edit",data:b})} currentUser={currentUser} />}
          {modal.type==="bookingDone" && <BookingDoneModal booking={modal.data} onClose={()=>setModal(null)}  />}
          {modal.type==="recurDone"    && <RecurDoneModal data={modal.data} onClose={()=>setModal(null)} />}
          {modal.type==="roomDetail"  && <RoomDetailModal room={modal.data} bookings={bookings} onClose={()=>setModal(null)} onBook={(status)=>{
              const now = nowMinutes();
              const snapStart = Math.ceil((now+1)/15)*15;
              const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
              const nextStartMin = status?.nextBooking ? tsMin(status.nextBooking.start_at) : 19*60;
              const clampedEnd = Math.min(clampedStart+60, nextStartMin, 19*60);
              if (clampedEnd <= clampedStart) {
                setModal(null);
                setModal({type:"new", prefill:{room_id:modal.data.room_id}});
                return;
              }
              const s = `${fmt2(Math.floor(clampedStart/60))}:${fmt2(clampedStart%60)}`;
              const e = `${fmt2(Math.floor(clampedEnd/60))}:${fmt2(clampedEnd%60)}`;
              setModal(null);
              setModal({type:"new", prefill:{room_id:modal.data.room_id, start:s, end:e}});
            }} />}
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[9999] px-5 py-3 rounded-xl text-sm font-semibold shadow-lg border
          ${toast.type==="error"
            ? "bg-red-50 border-red-200 text-red-600 dark:bg-red-950 dark:border-red-800 dark:text-red-400"
            : toast.type==="info"
            ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-400"
            : "bg-green-50 border-green-200 text-green-600 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
          }`}
          style={{animation:"tIn 0.3s ease"}}>
          {toast.msg}
        </div>
      )}

      {/* ── Footer ── */}
      <footer style={{
        maxWidth:1280, margin:"200px auto 0",
        padding: isMobile?"24px 12px 16px":"32px 28px 20px",
        textAlign:"center", fontSize:11, color:"#94A3B8", letterSpacing:"0.2px",
      }}>
        © {new Date().getFullYear()} CNR Research. All rights reserved.
      </footer>

    </div>
    </div>
  );
}

// ─── Home View ─────────────────────────────────────────────────────────────────

// ── AuthProvider로 감싸서 내보내기 ──────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
