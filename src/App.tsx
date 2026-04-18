/**
 * App.tsx — C&R Space 루트 컴포넌트
 *
 * ✅ 변경 이력
 *  - [2026-04-17 P0 fix] selectedDate stale 버그 해결 (자정 경계/탭 유지 케이스)
 *      · 10초 tick에서 todayStr()과 비교해 과거면 강제 갱신
 *      · visibilitychange에서 탭 복귀 시 동일 로직 적용
 *      · 원인: useState(todayStr())가 마운트 시점에만 평가되어 탭을 밤새 유지하면 과거 날짜 고정
 *
 *  - [2026-04-18 P2] 인앱 알림 중복 INSERT 제거
 *      · 배경: 배송 2에서 send-notification Edge Fn이 인앱 INSERT까지 담당하게 됨
 *      · 그런데 App.tsx는 기존 패턴(프론트가 직접 insertNotification)을 유지
 *        → notifications 테이블에 같은 알림이 2번 쌓이는 중복 발생
 *      · 해결: sendNotification 호출과 쌍이 되던 insertNotification 호출 모두 제거
 *      · 제거된 함수: addBooking(3곳), cancelBooking, approvePendingBooking(2곳),
 *                   rejectPendingBooking(2곳), adminForceCancelBooking,
 *                   updateBooking(2곳 + pending 전환 2곳), useEffect noshow, useEffect pending_expired(2곳)
 *      · 유지: checkIn (POLICIES에 없음, 프론트 전용), earlyEnd (POLICIES에 없음, 프론트 전용)
 *      · Realtime 구독(subscribeNotifications)이 INSERT 이벤트를 <100ms로 푸시하여 UX 지연 없음
 */

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { Bell, Calendar, Home, LogOut, Settings, User } from 'lucide-react'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, fmtTSFull, fmtTSRangeFull, fmtTSDateFull, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from './utils/time'
import { getFloor } from './data/floors'
import { loadBookings, saveBookings, insertBooking, updateBooking as apiUpdateBooking, cancelBooking as apiCancelBooking, subscribeBookings, loadRooms, saveRooms, loadUsers, saveUsers, loadRoomImages, insertAuditLog, approveBooking, rejectBooking, upsertBookingAttendees, getBookingAttendees, insertNotification, loadNotifications, markNotificationRead, markAllNotificationsRead, subscribeNotifications, expirePendingBooking, adminForceCancel, type AppNotification } from './lib/api'
import { supabase } from './lib/supabase'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType } from './types'
import { HomeView } from './components/room/HomeView'
import { RoomDetailModal } from './components/room/RoomDetailModal'
import { CalendarSkeleton, MyPageSkeleton, AdminSkeleton } from './components/skeleton'
import { initGlobalRipple } from './hooks/useGlobalRipple'
import { CalendarShell } from './components/layout/CalendarShell'
// ── 무거운 페이지는 lazy load — 초기 번들에서 제외 ─────────────────────────
import { BookingDoneModal } from './components/booking/BookingDoneModal'
import { RecurDoneModal } from './components/booking/RecurDoneModal'
import { BookingModal } from './components/booking/BookingModal'
import { DetailModal } from './components/booking/DetailModal'
const MyPageView          = lazy(() => import('./pages/MyPage').then(m => ({ default: m.MyPageView })))
import { UserAvatar } from './components/common/UserAvatar'
const AdminView           = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminView })))
import LoginPage from './pages/LoginPage'
import { useBreakpoint, useVisualViewport } from './hooks/useBreakpoint'
import { AuthProvider, useAuth } from './hooks/useAuth'


// ─── App ──────────────────────────────────────────────────────────────────────
function AppContent() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
  const [bookings, setBookings]   = useState([]);
  const [rooms, setRooms]         = useState<any[]>([]);
  const [users, setUsers]         = useState<any[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const unreadCount = notifications.filter((n: AppNotification) => !n.is_read).length;
  // URL 해시에서 초기 view 복원 (#home, #calendar, #mypage, #admin)
  const getViewFromHash = (): string => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('admin-tab-')) return 'admin'
    if (hash.startsWith('admin-booking-')) return 'admin'
    if (hash.startsWith('booking-')) return 'mypage'
    // OAuth 리다이렉트 후 해시가 소실된 경우 sessionStorage에서 복원
    const saved = sessionStorage.getItem('cnr_deeplink')
    if (saved?.startsWith('admin-booking-')) return 'admin'
    if (saved?.startsWith('booking-')) return 'mypage'
    return ['home','calendar','mypage','admin'].includes(hash) ? hash : 'home'
  }
  const [view, setViewState] = useState<string>(getViewFromHash);
  const setView = (v: string) => {
    setViewState(v)
    window.location.hash = v
    window.scrollTo({ top: 0, behavior: 'instant' })
    // 탭 전환 시 해당 화면 필터 초기화
    if (v === 'home')     setHomeFilterFloor('ALL')
    if (v === 'calendar') setCalFilterFloor('ALL')
  }
  const [calView, setCalView]     = useState("daily");
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [modal, setModal]         = useState(null);
  const [subModal, setSubModal]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [searchQ, setSearchQ]     = useState("");
  const [homeFilterFloor, setHomeFilterFloor] = useState("ALL");

  // 회의실 이미지 일괄 로딩 (초기 렌더 블로킹 방지)
  const loadAllRoomImages = useCallback(async (roomList: any[]) => {
    try {
      const { data } = await supabase
        .from('rooms')
        .select('room_id, thumbnail_url, gallery_urls')
      if (!data) return
      const imgMap = new Map(data.map(d => [d.room_id, d]))
      setRooms(prev => prev.map(room => {
        const imgs = imgMap.get(room.room_id)
        if (!imgs) return room
        return {
          ...room,
          thumbnail: imgs.thumbnail_url || room.thumbnail || '',
          gallery:   imgs.gallery_urls  || room.gallery  || [],
        }
      }))
    } catch (e) {
      console.warn('[App] 이미지 로딩 실패:', e)
    }
  }, [])  // 홈화면 전용
  const [calFilterFloor,  setCalFilterFloor]  = useState("ALL");  // 캘린더 전용
  const [tick, setTick]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false); // 100ms 딜레이 후 표시

  // 100ms 이상 로딩 시에만 스켈레톤 표시 (짧은 로딩은 깜박임 방지)
  useEffect(() => {
    if (!loading) { setShowSkeleton(false); return; }
    const t = setTimeout(() => setShowSkeleton(true), 300);
    return () => clearTimeout(t);
  }, [loading]);
  const [splashDone, setSplashDone] = useState(false); // Text Reveal 최소 표시 보장

  // Text Reveal 최소 표시 시간 (애니메이션 완료 타이밍)
  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1600);
    return () => clearTimeout(t);
  }, []);

  // modal 닫히면 subModal도 자동 클리어
  useEffect(() => { if (!modal) setSubModal(null) }, [modal]);

  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const { currentUser: authUser, logout, isAdmin, loading: authLoading } = useAuth()
  const currentUser = authUser?.name ?? ""
  const currentDept = authUser?.dept ?? ""

  // 데이터 로딩: authUser가 확정된 후 실행
  // - authUser가 null→유저로 바뀔 때(로그인) 재실행
  // - authUser가 유저→null로 바뀔 때(로그아웃) 스킵
  useEffect(() => {
    if (authLoading) return;
    if (!authUser) {
      setLoading(false);
      return;
    }
    // 최초 로그인(hash 없을 때)만 홈으로 이동, 새로고침 시 현재 hash 유지
    const currentHash = window.location.hash.replace('#', '');
    const isValidHash = ['home','calendar','mypage','admin'].includes(currentHash)
      || currentHash.startsWith('admin-tab-')
      || currentHash.startsWith('admin-booking-')
      || currentHash.startsWith('booking-')
      || !!sessionStorage.getItem('cnr_deeplink'); // OAuth 후 deeplink 복원 중이면 홈 이동 차단
    if (!isValidHash) {
      setView('home');
    }
    setLoading(true);
    Promise.all([loadBookings(), loadRooms(), loadUsers()])
      .then(([b, r, u]) => {
        setBookings(b); setRooms(r); setUsers(u);
        // 이미지는 별도로 비동기 로딩 (초기 로딩 블로킹 방지)
        loadAllRoomImages(r);
      })
      .catch(err => { console.error('[App] 초기 데이터 로딩 실패:', err); })
      .finally(() => { setLoading(false); });
  }, [authLoading, authUser?.user_id]);

  // 알림 로드 + Realtime 구독
  useEffect(() => {
    if (!authUser) { setNotifications([]); return; }
    loadNotifications().then(setNotifications);
    const unsub = subscribeNotifications((payload) => {
      // payload.new 에서 직접 새 알림 추가 — Edge Function insert 즉시 반영
      if (payload?.new) {
        const n = payload.new;
        setNotifications(prev => [{
          id:         n.id,
          user_id:    n.user_id,
          type:       n.type,
          title:      n.title,
          body:       n.body ?? '',
          booking_id: n.booking_id ?? null,
          is_read:    false,
          created_at: n.created_at,
        } as AppNotification, ...prev]);
      } else {
        loadNotifications().then(setNotifications);
      }
    }, authUser.user_id);
    return unsub;
  }, [authUser?.user_id]);

  // admin-booking- 딥링크 해시를 sessionStorage에 저장 (OAuth 리다이렉트 시 소실 방지)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash.startsWith('admin-booking-') || hash.startsWith('booking-')) {
      sessionStorage.setItem('cnr_deeplink', hash)
    }
  }, [])

  // 틱 타이머 + Realtime + 이벤트 리스너 + 탭 복귀 새로고침 (마운트 1회)
  useEffect(() => {
    // ① 10초마다 tick → 시간 기반 UI 상태 즉시 반영 (체크인 대기/사용중 등)
    // [2026-04-17 P0 fix] 자정 경계 통과 시 selectedDate 자동 갱신 — 탭을 밤새 열어둔 케이스 방어
    const iv = setInterval(() => {
      setTick(t => t+1);
      // ← [2026-04-17] selectedDate가 실제 오늘보다 과거면 강제 갱신 (자정 넘긴 탭)
      const t = todayStr();
      setSelectedDate(prev => (prev < t ? t : prev));
    }, 10000);

    // ② Realtime 구독 → 다른 사람 예약/취소/체크인 시 즉시 반영
    // 500ms 디바운스: Realtime 재연결 시 연속 호출로 인한 auth lock 경쟁 방지
    let realtimeDebounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeBookings(() => {
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
      realtimeDebounce = setTimeout(() => {
        loadBookings().then(fresh => {
          setBookings(fresh)
          setModal(prev => {
            if (prev?.type !== 'detail') return prev
            const updated = fresh.find((b: any) => b.id === (prev.data as any)?.id)
            return updated ? { ...prev, data: updated } : prev
          })
        })
      }, 500);
    });


    // ③ Page Visibility API → 탭 복귀 시 데이터 강제 새로고침
    // (자리 비운 사이 바뀐 예약 상태를 즉시 반영)
    // [2026-04-17 P0 fix] 탭 복귀 시 selectedDate도 갱신 — 어제 열어둔 탭이 오늘 날짜로 복구됨
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadBookings().then(b => setBookings(b));
        setTick(t => t+1);
        // ← [2026-04-17] 탭 복귀 시 오늘 날짜로 강제 갱신 (selectedDate stale 방지)
        const t = todayStr();
        setSelectedDate(prev => (prev < t ? t : prev));
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // ④ 예약하기 이벤트
    const handler = () => setModal({type:"new", prefill:{}});
    document.addEventListener("openNewBooking", handler);

    return () => {
      if (realtimeDebounce) clearTimeout(realtimeDebounce);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener("openNewBooking", handler);
      unsubscribe();
    };
  }, []);

  // 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const h = (e) => {
      if(dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
      if(notifRef.current && !notifRef.current.contains(e.target)) setShowNotifPanel(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const showToast = useCallback((msg, type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null), 3500);
  }, []);

  // ── 이메일 알림 발송 (Fire & Forget — 실패해도 예약 로직에 영향 없음) ──
  const sendNotification = useCallback(async (
    type: 'created' | 'updated' | 'cancelled' | 'noshow' | 'pending' | 'approved' | 'rejected' | 'attendee_removed',
    booking: any,
  ) => {
    try {
      // anon key로 호출 (Edge Function JWT 검증 비활성화)
      // 수신자(예약자·참석자) 이메일은 Edge Function이 DB에서 직접 조회
      const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
      const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY
      await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${supabaseAnon}`,
          'apikey':        supabaseAnon,
        },
        body: JSON.stringify({ type, booking }),
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
      // is_admin_only 회의실은 pending 상태로 생성 (아래 isAdminOnlyRoom 변수로 처리)

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
      const room  = rooms.find(r => r.room_id === form.room_id);
      const floor = getFloor(room?.floor_id);
      // is_admin_only 회의실(에메랄드)이면 pending 상태로 생성
      const isAdminOnlyRoom = room?.is_admin_only ?? false
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
          status:       isAdminOnlyRoom ? 'pending' : 'confirmed',
          createdAt,
          recurGroupId,  // null이면 단건, 값이 있으면 반복 그룹
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
        const createdRoom = rooms.find(r => r.room_id === newBookings[0].room_id)
        const notifType = isAdminOnlyRoom ? 'pending' : 'created'
        const notifPayload = {
          ...newBookings[0],
          user_id:    authUser?.user_id ?? '',
          user_name:  currentUser,
          user_email: authUser?.email ?? '',
          user_dept:  currentDept,
          room_name:  createdRoom?.room_name_ko ?? createdRoom?.room_name ?? String(newBookings[0].room_id) + 'F',
        }
        if (isAdminOnlyRoom) {
          // 승인 요청 — admin emails는 Edge Fn이 DB에서 직접 조회
          sendNotification('pending', notifPayload)
        } else {
          sendNotification('created', notifPayload)
        }
      } else {
        setModal({ type: "recurDone", data: {
          bookings: newBookings,
          skipped,
          recur,
          room: rooms.find(r => r.room_id === form.room_id),
          floor: getFloor(rooms.find(r => r.room_id === form.room_id)?.floor_id),
        }});
        // 반복 예약 이메일 알림 — 1회 발송 (recurBookings에 전체 일정 포함)
        const notifType = isAdminOnlyRoom ? 'pending' : 'created'
        const bkRoom = rooms.find(r => r.room_id === form.room_id)
        sendNotification(notifType, {
          ...newBookings[0],
          user_id:      authUser?.user_id ?? '',
          user_name:    currentUser,
          user_email:   authUser?.email ?? '',
          user_dept:    currentDept,
          room_name:    bkRoom?.room_name_ko ?? bkRoom?.room_name ?? String(newBookings[0].room_id) + 'F',
          recurBookings: newBookings.map(bk => ({ start_at: bk.start_at, end_at: bk.end_at })),
        })
      }
      // Audit log만 프론트에서 처리
      // ← [2026-04-18 P2] 인앱 알림 3개 블록(예약자/관리자/참석자) 제거됨
      //   이유: send-notification Edge Function이 이메일+인앱 모두 담당하도록 통합됨
      //         sendNotification('created' 또는 'pending', ...) 호출 시 자동으로
      //         booker/attendees/admins에게 인앱 알림 INSERT됨 (sendInAppForAllRoles)
      //   결과: notifications 테이블에 같은 알림이 2번 INSERT되던 중복 문제 해결
      for (const bk of newBookings) {
        insertAuditLog({
          action: 'BOOKING_CREATED', entityType: 'booking', entityId: bk.id,
          actorName: currentUser,
          afterData: { title: bk.title, room_id: bk.room_id, start_at: bk.start_at, end_at: bk.end_at }
        }).catch(() => {})
      }
      return true;
    } finally {
      setIsSubmitting(false);
    }
  }, [bookings, selectedDate, currentUser, currentDept, showToast, isSubmitting, isAdmin]);

  const checkIn = useCallback(async (id) => {
    // pending 상태면 체크인 불가
    const target = bookings.find(b => b.id === id)
    if (target?.status === 'pending') {
      showToast('관리자 승인 후 체크인 가능합니다.', 'info'); return;
    }
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:true} : b));
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, { checkedIn: true })
    insertAuditLog({ action: 'BOOKING_CHECKIN', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{});
      showToast("체크인 완료!");
      if (authUser?.user_id && target) {
        const r = rooms.find(rm => rm.room_id === target.room_id)
        insertNotification({
          userId: authUser.user_id, type: 'booking_checkin',
          title: '체크인 완료',
          body: `${target.title} · ${r?.room_name ?? ''} · ${fmtTSDateFull(target.start_at)} ${fmtTSFull(target.start_at)}`,
          bookingId: id,
        }).catch(() => {})
      }
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id===id ? {...b, checkedIn:false} : b));
      showToast(err.message ?? "체크인에 실패했습니다.", "error");
    }
  }, [showToast, bookings, rooms, authUser?.user_id]);

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

    // 낙관적 UI 업데이트 — end_at 유지, originalEndAt에 원본 저장
    setBookings(prev => prev.map(b => b.id===id
      ? {...b, originalEndAt: target.end_at, end_at: newEndAt, earlyEnded: true} : b
    ));
    setTick(t => t+1);
    try {
      await apiUpdateBooking(id, {
        earlyEnded: true,
        end_at: newEndAt,
        originalEndAt: target.end_at,  // 원래 예약 종료 시간 보존
      });
      insertAuditLog({ action: 'BOOKING_EARLY_END', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{})
      showToast("사용 완료! 회의실이 반환되었습니다.");
      if (authUser?.user_id && target) {
        const r = rooms.find(rm => rm.room_id === target.room_id)
        insertNotification({
          userId: authUser.user_id, type: 'booking_early_end',
          title: '회의실 반납 완료',
          body: `${target.title} · ${r?.room_name ?? ''} · ${fmtTSDateFull(target.start_at)}`,
          bookingId: id,
        }).catch(() => {})
      }
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id
        ? {...b, end_at: target.end_at, earlyEnded: false, originalEndAt: null} : b
      ));
      showToast(err.message ?? "조기 반납에 실패했습니다.", "error");
    }
  }, [bookings, showToast, rooms, authUser?.user_id]);

  const cancelBooking = useCallback(async (id) => {
    // 취소 전 예약 정보 먼저 저장 (낙관적 업데이트 전에)
    const targetBooking = bookings.find(b => b.id === id);
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:true} : b));
    setModal(null);
    try {
      await apiCancelBooking(id)
    insertAuditLog({ action: 'BOOKING_CANCELLED', entityType: 'booking', entityId: id, actorName: currentUser }).catch(()=>{});
    // ← [2026-04-18 P2] 예약자 인앱 알림 제거 — send-notification('cancelled')이 담당
      showToast("예약이 취소되었습니다.", "info");
      // 이메일 알림 발송
      if (targetBooking) {
        const cancelledRoom = rooms.find(r => r.room_id === targetBooking.room_id)
        sendNotification('cancelled', {
          ...targetBooking,
          user_name:  targetBooking.user,
          user_dept:  targetBooking.dept,
          room_name:  cancelledRoom?.room_name_ko ?? cancelledRoom?.room_name ?? String(targetBooking.room_id) + 'F',
        });
      }
    } catch (err: any) {
      setBookings(prev => prev.map(b => b.id===id ? {...b, autoCancelled:false} : b));
      showToast(err.message ?? "취소에 실패했습니다.", "error");
    }
  }, [bookings, showToast, sendNotification]);

  // ── 에메랄드 승인/거절 ─────────────────────────────────────────────────────
  const approvePendingBooking = useCallback(async (id: string) => {
    try {
      await approveBooking(id, currentUser, authUser?.avatar_url ?? null)
      const target = bookings.find(b => b.id === id)
      setBookings(prev => prev.map(b => b.id===id ? {
        ...b, status:'confirmed',
        processedByName: currentUser,
        processedByAvatar: authUser?.avatar_url ?? null,
      } : b))
      // 승인 이메일 — admin_name/admin_avatar 포함
      if (target) {
        const approvedRoom = rooms.find(r => r.room_id === target.room_id)
        sendNotification('approved', {
          ...target,
          user_name:    target.user,
          user_dept:    target.dept,
          room_name:    approvedRoom?.room_name_ko ?? approvedRoom?.room_name ?? '',
          admin_name:   currentUser,
          admin_avatar: authUser?.avatar_url ?? null,
        })
      }
      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('approved')가 booker + attendees에게 자동 INSERT
      showToast('예약이 승인되었습니다.')
    } catch (err: any) { showToast(err.message, 'error') }
  }, [showToast, bookings, rooms, users, sendNotification])

  const rejectPendingBooking = useCallback(async (id: string, reason: string) => {
    try {
      await rejectBooking(id, reason, currentUser, authUser?.avatar_url ?? null)
      const target = bookings.find(b => b.id === id)
      setBookings(prev => prev.map(b => b.id===id ? {
        ...b, status:'rejected', autoCancelled:true, cancelledBy:'admin',
        processedByName: currentUser,
        processedByAvatar: authUser?.avatar_url ?? null,
      } : b))
      // 거절 이메일 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
      if (target) {
        const rejectedRoom = rooms.find(r => r.room_id === target.room_id)
        sendNotification('rejected', {
          ...target,
          user_name:     target.user,
          user_dept:     target.dept,
          room_name:     rejectedRoom?.room_name_ko ?? rejectedRoom?.room_name ?? '',
          reject_reason: reason || '관리자 거절',
          admin_name:    currentUser,                   // 거절한 관리자 이름
          admin_avatar:  authUser?.avatar_url ?? null,  // 관리자 아바타
        })
      }
      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('rejected')가 booker + attendees에게 자동 INSERT
      showToast('예약이 거절되었습니다.', 'info')
    } catch (err: any) { showToast(err.message, 'error') }
  }, [showToast, bookings, rooms, users, sendNotification])

  // ── 관리자 강제 취소 ────────────────────────────────────────────────────────
  const adminForceCancelBooking = useCallback(async (id: string, reason: string) => {
    const targetB = bookings.find(b => b.id === id)
    try {
      await adminForceCancel(id)
      // 낙관적 UI 업데이트
      setBookings(prev => prev.map(b => b.id === id ? { ...b, autoCancelled: true, cancelledBy: 'admin' } : b))

      // Audit log
      insertAuditLog({
        action: 'ADMIN_FORCE_CANCEL', entityType: 'booking', entityId: id,
        actorName: currentUser,
        afterData: { reason, title: targetB?.title, user: targetB?.user },
      }).catch(() => {})

      // ← [2026-04-18 P2] 예약자 인앱 알림 제거
      //   send-notification('cancelled' + admin_force=true)가 booker + attendees에게 자동 INSERT

      // 이메일 알림 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
      if (targetB) {
        const cancelledRoom = rooms.find(r => r.room_id === targetB.room_id)
        sendNotification('cancelled', {
          ...targetB,
          user_name:     targetB.user,
          user_dept:     targetB.dept,
          room_name:     cancelledRoom?.room_name_ko ?? cancelledRoom?.room_name ?? '',
          admin_force:   true,
          cancel_reason: reason || '관리자 강제 취소',
        })
      }

      showToast('예약이 강제 취소되었습니다.', 'info')
    } catch (err: any) {
      // 실패 시 롤백
      setBookings(prev => prev.map(b => b.id === id ? { ...b, autoCancelled: false, cancelledBy: null } : b))
      showToast(err.message ?? '취소 중 오류가 발생했습니다.', 'error')
    }
  }, [bookings, rooms, users, currentUser, showToast, sendNotification])
  const updateBooking = useCallback(async (form, date, originalId) => {
    if (!form.room_id || !form.title.trim() || timeToMin(form.start) >= timeToMin(form.end)) {
      showToast("예약 정보를 확인해주세요.", "error"); return false;
    }

    // ── Bug 2 방어: pending 예약은 변경 불가 ──────────────────────────
    const originalBooking = bookings.find(b => b.id === originalId)
    if (originalBooking?.status === 'pending') {
      showToast("승인 대기 중인 예약은 변경할 수 없습니다.", "error"); return false;
    }

    // ── 승인완료된 에메랄드룸 예약은 변경 불가 ────────────────────────
    const originalRoom = rooms.find(r => r.room_id === originalBooking?.room_id)
    if (originalRoom?.is_admin_only && originalBooking?.status === 'confirmed') {
      showToast("승인 완료된 예약은 변경할 수 없습니다. 취소 후 재예약해주세요.", "error"); return false;
    }

    const otherBookings = bookings.filter(b => b.id !== originalId);
    const check = hasTimeConflict(otherBookings, form.room_id, date, timeToMin(form.start), timeToMin(form.end));
    if (check.conflict) {
      showToast("선택한 시간에 이미 예약이 있습니다.", "error"); return false;
    }

    // ── Bug 1: 변경 후 room이 에메랄드(is_admin_only)면 pending 재설정 ──
    const newRoom = rooms.find(r => r.room_id === form.room_id)
    const newStatus = newRoom?.is_admin_only ? 'pending' : 'confirmed'

    const changes = {
      room_id:   form.room_id,
      title:     form.title,
      memo:      form.memo,
      attendees: form.attendees || [],
      start_at:  makeTZ(date, form.start),
      end_at:    makeTZ(date, form.end),
      status:    newStatus as 'confirmed' | 'pending',
    };
    // 낙관적 UI 업데이트
    setBookings(prev => prev.map(b => b.id === originalId ? { ...b, ...changes } : b));
    setModal(null);
    try {
      const prevBooking = bookings.find(b => b.id === originalId)

      // diff 계산: upsertBookingAttendees 전에 현재 참석자 조회
      const oldAttendeeEmails = changes.attendees !== undefined
        ? await getBookingAttendees(originalId)
        : []

      await apiUpdateBooking(originalId, changes);

      // attendees 변경 시 booking_attendees 업데이트
      if (changes.attendees !== undefined) {
        await upsertBookingAttendees(originalId, changes.attendees)
      }

      // ← [2026-04-18 P2] 예약자/참석자 인앱 알림 제거
      //   send-notification('updated')가 booker + attendees에게 자동 INSERT
      //   pending 전환 시에도 send-notification('pending')이 자동 처리

      // Audit log
      insertAuditLog({
        action: 'BOOKING_UPDATED', entityType: 'booking', entityId: originalId,
        actorName: currentUser,
        beforeData: prevBooking ? { title: prevBooking.title, start_at: prevBooking.start_at, end_at: prevBooking.end_at, room_id: prevBooking.room_id } : undefined,
        afterData:  { title: changes.title, start_at: changes.start_at, end_at: changes.end_at, room_id: changes.room_id }
      }).catch(() => {})
      showToast(newStatus === 'pending' ? "예약이 변경되었습니다. 관리자 승인 후 확정됩니다." : "예약이 변경되었습니다.");

      // ── 일반 → 에메랄드룸 변경으로 pending이 된 경우 → Admin 알림 ──
      if (newStatus === 'pending') {
        const pendingRoom = rooms.find(r => r.room_id === changes.room_id)
        // ← [2026-04-18 P2] 예약자/관리자 인앱 알림 제거
        //   Admin 이메일 알림 (Edge Fn 내부에서 booker/attendees/admins 인앱 자동 INSERT)
        if (prevBooking) {
          sendNotification('pending', {
            ...prevBooking, ...changes,
            user_name:  prevBooking.user,
            user_dept:  prevBooking.dept,
            room_name:  pendingRoom?.room_name_ko ?? pendingRoom?.room_name ?? '',
          })
        }
      }

      // 이메일 알림 발송
      const updatedB = bookings.find(b => b.id === originalId);
      if (updatedB) {
        const updatedRoom = rooms.find(r => r.room_id === (changes.room_id ?? updatedB.room_id))
        const basePayload = {
          ...updatedB, ...changes,
          user_name:  updatedB.user,
          user_dept:  updatedB.dept,
          room_name:  updatedRoom?.room_name_ko ?? updatedRoom?.room_name ?? String(updatedB.room_id) + 'F',
        }

        // 변경 알림 — 예약자·참석자 수신자는 Edge Fn이 DB에서 조회
        sendNotification('updated', basePayload)

        // 제거된 참석자 별도 알림
        if (changes.attendees !== undefined) {
          const newAttendeeEmails = (changes.attendees as any[])
            .map(a => typeof a === 'string' ? a : (a as any).email ?? '')
            .filter(Boolean)
          const removedEmails = oldAttendeeEmails.filter(e => !newAttendeeEmails.includes(e))
          if (removedEmails.length > 0) {
            sendNotification('attendee_removed', {
              ...basePayload,
              removed_emails: removedEmails,  // Edge Function에서 직접 사용
            })
          }
        }
      }
    } catch (err: any) {
      // 실패 시 원복
      const latest = await loadBookings();
      setBookings(latest);
      showToast(err.message ?? "예약 변경에 실패했습니다.", "error");
    }
    return true;
  }, [bookings, showToast]);

  // Auto-cancel: ① 노쇼(미체크인) 자동 취소  ② pending 승인 기한 초과 자동 취소
  //
  // ← [2026-04-18 P2] 이 useEffect는 "프론트에서도 빠른 UI 반영"을 위한 안전망.
  //    실제 자동 취소 처리는 auto-cancel-bookings Edge Function (cron 5분마다)이 담당.
  //    인앱 알림도 send-notification이 자동 발송하므로 여기서는 UI 업데이트만.
  useEffect(() => {
    const now=nowMinutes(), today=todayStr(), nowMs=Date.now();

    // ① 노쇼: 오늘 예약 중 체크인 없이 CHECKIN_WINDOW_MIN 경과
    const toCancel=bookings.filter(b=>
      tsDate(b.start_at)===today &&
      !b.checkedIn && !b.autoCancelled && !b.earlyEnded &&
      b.status !== 'pending' && b.status !== 'rejected' &&   // pending·rejected는 별도 처리
      now > tsMin(b.start_at)+CHECKIN_WINDOW_MIN
    );
    if(toCancel.length>0){
      const ids=new Set(toCancel.map(b=>b.id));
      setBookings(prev => prev.map(b => ids.has(b.id) ? {...b, autoCancelled:true} : b));
      Promise.all(toCancel.map(b => apiCancelBooking(b.id))).catch(console.error);
      // ← [2026-04-18 P2] 예약자 인앱 알림 제거
      //   auto-cancel-bookings Edge Fn이 5분마다 실행되며 noshow 처리 후
      //   send-notification('noshow')가 booker + attendees에게 자동 INSERT
    }

    // ② pending 승인 기한 초과: start_at 1분 전 이후 경과
    const pendingExpired = bookings.filter(b =>
      b.status === 'pending' && !b.autoCancelled &&
      nowMs >= new Date(b.start_at).getTime() - 60_000
    );
    if(pendingExpired.length > 0){
      const expiredIds = new Set(pendingExpired.map(b => b.id));
      setBookings(prev => prev.map(b => expiredIds.has(b.id) ? {...b, autoCancelled:true, cancelledBy:'system'} : b));
      pendingExpired.forEach(b => {
        expirePendingBooking(b.id).catch(() => {});
        // ← [2026-04-18 P2] 예약자/관리자 인앱 알림 제거
        //   auto-cancel-bookings Edge Fn이 pending_expired 처리 후
        //   send-notification('pending_expired')가 booker + attendees + admins에게 자동 INSERT
      });
    }
  }, [tick]);

  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvH, off: vvOff } = useVisualViewport();

  // ── 인증 로딩 중 (Text Reveal) ──
  if (authLoading || (!authUser && !splashDone)) return (
    <div style={{
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      minHeight:"100vh",
      background: "#F3F4F8",
      gap: 10, position:"relative", overflow:"hidden"
    }}>
      <style>{`
        @keyframes cnr-reveal {
          0%   { clip-path: inset(0 100% 0 0); }
          15%  { clip-path: inset(0 100% 0 0); }
          72%  { clip-path: inset(0 0% 0 0); }
          100% { clip-path: inset(0 0% 0 0); }
        }
        @keyframes cnr-sub {
          0%, 68%  { opacity: 0; transform: translateY(8px); }
          100%     { opacity: 1; transform: translateY(0); }
        }
        @keyframes cnr-bar {
          0%   { transform: scaleX(0); }
          70%  { transform: scaleX(0.7); }
          100% { transform: scaleX(0.88); }
        }
      `}</style>

      {/* 로고 텍스트 */}
      <span style={{
        fontSize: 28, fontWeight: 600, letterSpacing: "-0.5px",
        color: dark ? "#F1F5F9" : "#1E293B",
        animation: "cnr-reveal 1.8s cubic-bezier(0.4,0,0.2,1) forwards"
      }}>C&amp;R Space</span>

      {/* 서브타이틀 */}
      <div style={{
        fontSize: 11, color: dark ? "#64748B" : "#94A3B8",
        letterSpacing:"0.02em",
        opacity:0,
        animation:"cnr-sub 2.2s ease forwards"
      }}>회의실 예약 시스템 연결 중...</div>

      {/* 하단 진행 바 */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, height:3,
        background: dark ? "rgba(241,245,249,0.1)" : "rgba(17,17,17,0.08)"
      }}>
        <div style={{
          height:"100%", background: dark ? "#F1F5F9" : "#111111",
          borderRadius:"0 2px 2px 0",
          transformOrigin:"left",
          animation:"cnr-bar 3s ease-out forwards"
        }}/>
      </div>
    </div>
  )

  // ── 미로그인 → 로그인 페이지 ──
  if (!authUser) return <LoginPage />

  // ── 데이터 로딩 중 ──
  if (loading) {
    if (!showSkeleton) return null; // 100ms 미만이면 아무것도 표시 안 함
    // 현재 뷰에 맞는 스켈레톤 렌더
    const SkeletonComp = view === 'calendar' ? CalendarSkeleton
                       : view === 'mypage'   ? MyPageSkeleton
                       : view === 'admin'    ? AdminSkeleton
                       : null; // home: 헤더 스켈레톤만, 콘텐츠 영역은 비워둠
    return (
      <div style={{background:'#F3F4F8', minHeight:'100vh'}}>
        {/* 헤더 스켈레톤 — 좌:로고pill / 중:nav2개 / 우:유저pill */}
        <div style={{background:'#fff', height:60, borderBottom:'1px solid #E2E8F0',
          display:'flex', alignItems:'center', padding:'0 28px'}}>
          {/* 좌: 로고 */}
          <div className="sk-block" style={{width:120, height:36, borderRadius:999, flexShrink:0}} />
          {/* 중: 네비 탭 2개 — 가운데 정렬 */}
          <div style={{flex:1, display:'flex', justifyContent:'center', gap:8}}>
            <div className="sk-block" style={{width:120, height:36, borderRadius:999}} />
            <div className="sk-block" style={{width:120, height:36, borderRadius:999}} />
          </div>
          {/* 우: 유저 정보 */}
          <div className="sk-block" style={{width:180, height:36, borderRadius:999, flexShrink:0}} />
        </div>
        {SkeletonComp && <SkeletonComp />}
      </div>
    );
  }

  return (
    <div className={dark ? "dark" : ""}>
    <div className="dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-200" style={{background:"#F3F4F8"}}>
{/* ── Header ── */}
      <header className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[100]">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-7">
          <div className="grid items-center gap-3" style={{gridTemplateColumns:"1fr auto 1fr", height:52}} data-desktop-height="64">

            {/* ① 브랜드 (left) — 클릭 시 홈 */}
            <div className="flex items-center min-w-0 cursor-pointer" onClick={()=>setView("home")}>
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 dark:text-white truncate"
                  style={{fontSize: isMobile?13:15, letterSpacing:0}}>
                  {isMobile ? "C&R" : "C&R SPACE"}
                </div>
              </div>
            </div>

            {/* ② Nav pills (center) */}
            {(view==="home"||view==="calendar") ? (
              <div className="flex dark:bg-slate-700 rounded-full p-1 gap-1" style={{background:"#F3F4F8"}}>
                {([
                  ["home",       <Home size={14} strokeWidth={1.8}/>,     "실시간 현황", "현황"]    as const,
                  ["calendar",   <Calendar size={14} strokeWidth={1.8}/>,  "캘린더 뷰",  "캘린더"]  as const,
                ] as [string, React.ReactElement, string, string][]).map(([v,icon,label,mLabel])=>(
                  <button key={v} onClick={()=>setView(v)}
                    className="btn flex items-center gap-1.5 rounded-full font-semibold transition-all whitespace-nowrap"
                    style={{
                      padding: isMobile?"7px 10px":"8px 18px",
                      fontSize: isMobile?11:13,
                      background: view===v ? (dark?"#F1F5F9":"#111111") : "transparent",
                      color: view===v ? (dark?"#111111":"#fff") : (dark?"#94A3B8":"#64748B"),
                      boxShadow: view===v ? "0 2px 8px rgba(0,0,0,0.18)" : "none",
                    }}>
                    <span style={{fontSize: isMobile?13:14}}>{icon}</span>
                    {!isMobile && label}
                    {isMobile && mLabel}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                <button className="btn" onClick={()=>setView("home")}
                  style={{background:"#F3F4F8",color:"#64748B",padding:"6px 14px",fontSize:12,borderRadius:999,
                    display:"flex",alignItems:"center",gap:5}}>
                  ← <span style={{fontWeight:600}}>{view==="mypage"?"My Page":"Admin"}</span>에서 홈으로
                </button>
              </div>
            )}

            {/* ③ 우측: 알림 벨 + 유저 드롭다운 */}
            <div className="flex items-center gap-2 justify-end">

              {/* 알림 벨 */}
              <div ref={notifRef} style={{position:"relative"}}>
                <button className="btn" onClick={()=>setShowNotifPanel(v=>!v)}
                  style={{position:"relative",width:36,height:36,borderRadius:"50%",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    background:showNotifPanel?(dark?"rgba(255,255,255,0.1)":"#F1F5F9"):"transparent",
                    color:dark?"#94A3B8":"#64748B"}}>
                  <Bell size={18} strokeWidth={1.8}/>
                  {unreadCount > 0 && (
                    <span style={{position:"absolute",top:4,right:4,
                      background:"#EF4444",color:"#fff",
                      fontSize:9,fontWeight:600,borderRadius:999,
                      padding:"1px 4px",lineHeight:1.4,minWidth:14,textAlign:"center"}}>
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </button>

                {/* 알림 패널 */}
                {showNotifPanel && (
                  <div className="anm" style={{
                    position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:300,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:16,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.12)",width:340,overflow:"hidden"}}>

                    {/* 패널 헤더 */}
                    <div style={{padding:"14px 16px",borderBottom:"1px solid #F1F5F9",
                      display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{fontSize:14,fontWeight:600,color:"#111"}}>
                        알림 {unreadCount > 0 && <span style={{color:"#EF4444",fontSize:12}}>({unreadCount})</span>}
                      </span>
                      {unreadCount > 0 && (
                        <button className="btn" onClick={()=>{
                          markAllNotificationsRead()
                          setNotifications(prev => prev.map(n => ({...n, is_read:true})))
                        }} style={{fontSize:11,color:"#64748B",padding:"2px 8px",borderRadius:6,
                          border:"1px solid #E2E8F0",background:"#F8FAFC"}}>
                          모두 읽음
                        </button>
                      )}
                    </div>

                    {/* 알림 목록 */}
                    <div style={{maxHeight:400,overflowY:"auto"}}>
                      {notifications.length === 0 ? (
                        <div style={{padding:"40px 0",textAlign:"center",color:"#94A3B8",fontSize:13}}>
                          알림이 없습니다
                        </div>
                      ) : notifications.map(n => {
                        const typeColors: Record<string,string> = {
                          booking_created:          "#16A34A",
                          booking_pending:          "#D97706",
                          booking_approved:         "#16A34A",
                          booking_rejected:         "#DC2626",
                          booking_cancelled:        "#64748B",
                          booking_admin_cancelled:  "#DC2626",  // 관리자 강제취소 — 빨간색
                          booking_checkin:          "#2563EB",
                          booking_early_end:        "#7C3AED",
                          booking_noshow:           "#EF4444",
                          booking_expired:          "#94A3B8",
                          booking_updated:          "#0891B2",
                          checkin_reminder_10:      "#0891B2",
                          checkin_required:         "#16A34A",
                          checkin_warning:          "#EF4444",
                        }
                        const color = typeColors[n.type] ?? "#64748B"
                        return (
                          <div key={n.id}
                            onClick={()=>{
                              if (!n.is_read) {
                                markNotificationRead(n.id)
                                setNotifications(prev => prev.map(x => x.id===n.id ? {...x,is_read:true} : x))
                              }
                              if (n.booking_id) setModal({type:"detail", data: bookings.find(b=>b.id===n.booking_id) ?? null})
                              setShowNotifPanel(false)
                            }}
                            style={{padding:"12px 16px",borderBottom:"1px solid #F8FAFC",cursor:"pointer",
                              background:n.is_read?"transparent":"#F0F9FF",transition:"background 0.15s"}}
                            onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                            onMouseLeave={e=>e.currentTarget.style.background=n.is_read?"transparent":"#F0F9FF"}>
                            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
                              <div style={{width:6,height:6,borderRadius:"50%",
                                background:n.is_read?"transparent":color,
                                marginTop:6,flexShrink:0}}/>
                              <div style={{flex:1,minWidth:0}}>
                                {/* 알림 제목 (상태 메시지) */}
                                <div style={{fontSize:13,fontWeight:n.is_read?400:600,color:"#111",
                                  marginBottom:3}}>{n.title}</div>
                                {/* body 파싱: "회의제목 · 회의실 · 날짜 오전/오후 H:MM" */}
                                {n.body && (() => {
                                  const parts = n.body.split(' · ')
                                  return (
                                    <div style={{display:"flex",flexDirection:"column",gap:1}}>
                                      {parts[0] && <div style={{fontSize:12,fontWeight:600,color:"#374151",
                                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{parts[0]}</div>}
                                      {parts.slice(1).map((p,i) => (
                                        <div key={i} style={{fontSize:11,color:"#64748B"}}>{p}</div>
                                      ))}
                                    </div>
                                  )
                                })()}

                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div ref={dropdownRef} style={{position:"relative"}}>
                <button className="btn flex items-center gap-2 rounded-full border flex-shrink-0"
                  onClick={()=>setShowDropdown(v=>!v)}
                  style={{
                    padding: isMobile?"4px 4px":"5px 14px 5px 5px",
                    background: dark?"rgba(255,255,255,0.05)":"#F8FAFC",
                    borderColor: dark?"#475569":"#E2E8F0",
                    cursor:"pointer",
                  }}>
                  <UserAvatar name={currentUser} avatarUrl={authUser?.avatar_url} size={28} bgColor="#CBECFF" textColor="#111111" />
                  {!isMobile && (
                    <span style={{
                      fontSize:13, fontWeight:600,
                      color: dark?"#fff":"#111111",
                    }}>
                      {currentUser} <span style={{fontWeight:400,opacity:0.6}}>{currentDept.length > 10 ? currentDept.slice(0, 10) + '…' : currentDept}</span>
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
                      <div style={{fontSize:13,fontWeight:600,color:"#111"}}>{currentUser}</div>
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
                      <button className="btn" onClick={()=>{logout();setShowDropdown(false);}}
                        style={{width:"100%",textAlign:"left",padding:"10px 16px",fontSize:13,
                          color:"#EF4444",display:"flex",alignItems:"center",gap:8}}>
                        <LogOut size={15} strokeWidth={1.8}/> 로그아웃
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
        <div style={{maxWidth:1400, margin:"0 auto", padding: isMobile?"16px 12px":"28px 28px"}}>
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
            }} onDetail={(r)=>setModal({type:"roomDetail",data:r})} onBookingDetail={(b)=>setModal({type:"detail",data:b})} onCheckIn={checkIn} onEarlyEnd={earlyEnd} onCancel={cancelBooking} currentUser={currentUser} currentUserEmail={authUser?.email ?? ''} dark={dark} />}
          {view==="calendar" && <CalendarShell bookings={bookings} rooms={rooms} selectedDate={selectedDate} setSelectedDate={setSelectedDate} calView={calView} setCalView={setCalView} onBookingClick={b=>setModal({type:"detail",data:b})} onNewBooking={(d,h,rid)=>setModal({type:"new",prefill:{room_id:rid,start:h!=null?`${fmt2(h)}:00`:undefined,end:h!=null?`${fmt2(h+1)}:00`:undefined},date:d}) } onCheckIn={checkIn} filterFloor={calFilterFloor} setFilterFloor={setCalFilterFloor} currentUser={currentUser} />}
        </div>
      )}

      {view==="mypage" && <Suspense fallback={<MyPageSkeleton />}><MyPageView bookings={bookings} setBookings={setBookings} currentUser={currentUser} currentDept={currentDept} showToast={showToast} isMobile={isMobile} onDetail={b=>setModal({type:"detail",data:b})} onCheckIn={checkIn} onEarlyEnd={earlyEnd} onCancel={cancelBooking} rooms={rooms} users={users} authUserId={authUser?.user_id ?? ''} currentUserEmail={authUser?.email ?? ''} avatarUrl={authUser?.avatar_url ?? null} /></Suspense>}
      {view==="admin" && <Suspense fallback={<AdminSkeleton />}><AdminView bookings={bookings} setBookings={setBookings} rooms={rooms} setRooms={setRooms} users={users} setUsers={setUsers} showToast={showToast} isMobile={isMobile} isTablet={isTablet} onApprove={approvePendingBooking} onReject={rejectPendingBooking} onForceCancel={adminForceCancelBooking} onDetail={b=>setModal({type:'detail',data:b})} /></Suspense>}

      {/* ── Modals ── */}
      {modal && (
        <div
          style={{
            position:"fixed",
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
          {modal.type==="new"         && <BookingModal prefill={modal.prefill} date={modal.date||selectedDate} onClose={()=>setModal(null)} onSubmit={addBooking} onUpdate={()=>false} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} currentUserEmail={authUser?.email ?? ''} rooms={rooms} users={users} />}
            {modal.type==="edit"         && <BookingModal prefill={{}} editBooking={modal.data} date={tsDate(modal.data.start_at)} onClose={()=>setModal(null)} onSubmit={async ()=>false} onUpdate={(form,date)=>updateBooking(form,date,modal.data.id)} bookings={bookings} isAdmin={isAdmin} currentUser={currentUser} currentUserEmail={authUser?.email ?? ''} rooms={rooms} users={users} />}
            {modal.type==="detail"      && <DetailModal booking={modal.data} onClose={()=>setModal(null)} onCheckIn={checkIn} onCancel={cancelBooking} onEdit={(b)=>setModal({type:"edit",data:b})} currentUser={currentUser} rooms={rooms} users={users} isAdmin={isAdmin} onApprove={approvePendingBooking} onReject={rejectPendingBooking} onForceCancel={adminForceCancelBooking} />}
            {modal.type==="bookingDone" && <BookingDoneModal booking={modal.data} onClose={()=>setModal(null)} rooms={rooms} users={users} />}
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
            }} onDetail={b=>setSubModal({type:'detail',data:b})} />}
        </div>
      )}

      {/* ── Sub Modal (RoomDetailModal 위에 올라오는 2차 모달) ── */}
      {subModal && (
        <div
          style={{
            position:"fixed",
            top: vvOff,
            left: 0,
            width: "100%",
            height: vvH,
            background:"rgba(15,23,42,0.35)",
            backdropFilter:"blur(3px)",
            display:"flex",
            alignItems: isMobile ? "flex-end" : "center",
            justifyContent:"center",
            zIndex:1001,
            padding: isMobile ? 0 : 16,
          }}>
          {subModal.type==="detail" && <DetailModal
            booking={subModal.data}
            onClose={()=>setSubModal(null)}
            onCheckIn={checkIn}
            onCancel={cancelBooking}
            onEdit={(b)=>{ setSubModal(null); setModal({type:"edit",data:b}); }}
            currentUser={currentUser}
            rooms={rooms}
            users={users}
            isAdmin={isAdmin}
            onApprove={approvePendingBooking}
            onReject={rejectPendingBooking}
            onForceCancel={adminForceCancelBooking}
          />}
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
        maxWidth:1400, margin:"200px auto 0",
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
