/**
 * BookingModal.tsx — 예약 생성/수정 모달
 *
 * ✅ 변경 이력
 *  - [2026-04-26 Phase A] 데스크톱 모달 골격 — Figma 매칭 (UI 리디자인 1단계)
 *      · Figma 노드: 302:5364 (빈 상태) / 299:3607 (채워진 상태)
 *      · 변경 범위: 데스크톱만 (모바일 분기 일체 변경 없음)
 *      · 변경 내용:
 *        1) 모달 컨테이너: maxWidth 960→924, borderRadius 16→24
 *        2) 로딩 오버레이 borderRadius 16→24 (모달과 동기화)
 *        3) 헤더: 데스크톱에서 position absolute(top:0), padding 16/20,
 *           borderRadius 24px 24px 0 0, drop-shadow 효과, border-bottom 제거
 *        4) 데스크톱 헤더 타이틀: fontSize 18→24, fontWeight 600→500 (Pretendard Medium)
 *        5) 데스크톱 본체 컨테이너: padding 60px 0 (헤더/푸터 absolute 영역 확보)
 *        6) 데스크톱 푸터: position absolute(bottom:0), padding 8, gap 8,
 *           borderRadius 0 0 24px 24px, 배경 #f5f5f5 over #fff,
 *           Button height 56, borderRadius 16
 *      · 검증/판단 로직 변경 없음 (canSubmit, availableRooms, validTime 등 그대로)
 *      · CTA 텍스트 로직 그대로 (변경 저장 / 승인 요청 / 예약 확정)
 *
 *  - [2026-04-26] 기본 회의 시간 60분 → 15분 변경 (UX 개선)
 *      · 사용자 요청: 모달 오픈 시 미리 입력되어있는 시간 예약값을 1시간 → 15분으로 변경
 *                    (예: 현재 14:08 → 시작 14:15 → 종료 14:30)
 *      · 적용 범위 (B안: UX 일관성 확보 — 5곳 모두 동기화):
 *        1) L87  — 모달 오픈 시 초기 form 생성 (신규 예약 진입점)
 *        2) L247 — tick 자동 시간 보정 (탭 오래 켜둔 후 form.start가 과거로 밀려날 때)
 *        3) L312 — selectDate (캘린더에서 "오늘"로 다시 선택 시 재계산)
 *        4) L422 — handleTimeBtn (모바일 시간 그리드에서 시작 클릭 시 자동 종료)
 *        5) L1071 — 데스크톱 select 시작 변경 시 자동 종료
 *      · 변경 사유: 어떤 경로로 진입하든 동일한 기본값(15분) 보장.
 *                  ①만 변경하면 날짜·시간 재선택 시 60분으로 되돌아가는 UX 비일관 발생.
 *      · 19:00 한계는 그대로 유지 (Math.min(..., 19*60))
 *      · 검증/판단 로직(canSubmit, availableRooms, validTime 등)은 일체 변경 없음
 *
 *  - [2026-04-22 HOTFIX] 반복예약 기능 임시 비활성화 (Phase 1 긴급 차단)
 *      · 증상: 반복예약이 "시작일~1달" 안내와 달리 DB에 12월 말까지 생성됨
 *              → 일반 사용자 정책 위반(30일 제한)
 *              → 오늘 하루 동안 288건 오염 데이터 누적 → SQL DELETE로 정리 완료
 *      · 조치 (버튼 근본 수정 전 임시 차단, 3중 방어):
 *        1) 모바일/데스크톱 모두 "매일"/"매주" 옵션 disabled + opacity 0.25 처리
 *        2) 상단에 "반복 예약은 오남용으로 사용을 일시중지합니다. 정책확정 전까지,
 *           단일 예약만 가능합니다." 경고 배너 표시
 *        3) handleSubmit onClick 핸들러에서 recur를 강제로 "NEVER"로 세팅
 *           (DevTools 조작 등 우회 시도 대응)
 *      · 복구: 반복예약 생성 로직(allDates 계산 + maxDate 적용)을 근본 수정 후 해제
 *      · 참고: 이 수정은 UI 차단만 담당. DB 저장 로직(onSubmit)의 버그는 별도 세션에서 수정.
 *
 *  - [2026-04-19 P1] 과거 날짜 방어 로직 추가 (App.tsx 전역 보정 제거에 따른 이동)
 *      · 배경: App.tsx 10초 tick에서 selectedDate를 강제로 today로 갱신하던 로직이
 *              캘린더 과거 날짜 탐색을 막아버리는 버그를 일으켜 제거됨.
 *              그러나 원래 방어하고자 했던 "탭 밤새 유지 후 예약" 시나리오는 여전히 유효.
 *      · 해결: 예약 생성 플로우에 한정하여 여기서만 방어
 *              · initDate가 과거면 today로 보정 (새 예약 한정)
 *              · editBooking은 그 예약의 실제 날짜 그대로 유지 (과거 예약 수정 가능해야 함)
 *              · 달력 초기 월/연도도 보정된 날짜 기준으로 계산
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, AlertTriangle, Ban, Calendar, Check, CheckCircle2, ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { useBreakpoint, useVisualViewport } from '../../hooks/useBreakpoint'
import { todayStr, nowMinutes, tsDate, tsTime, tsMin, fmtTime, fmtTS, fmtRange,
  fmtTSRange, timeToMin, dateToObj, objToStr, addDays, getWeekStart, nowStr,
  fmt2, makeTZ, getRoomStatus, hasTimeConflict, isRoomAvailable, getAvailableRooms,
  DAY_NAMES, MONTH_NAMES, HOURS, CHECKIN_WINDOW_MIN } from '../../utils/time'
import { getFloor } from '../../data/floors'
// [2026-04-17 Step 3] searchGraphUsers import 제거 — 참석자 검색을 DB 호출에서 메모리 필터링(usersProp 기반)으로 전환
// import { searchGraphUsers } from '../../lib/api'
import type { Booking, Room, AppUser, ModalState, Toast, AppView, CalViewType, BookingForm } from '../../types'

import { UserAvatar } from '../common/UserAvatar'
import { AttendeeChip } from '../common/AttendeeChip'
import { Button } from '../common/Button' 
import { ModalCloseButton } from '../common/ModalCloseButton' // ← [2026-04-22] 모달 X 버튼 공통화

export function BookingModal({prefill, date:initDate, editBooking=null, onClose, onSubmit, onUpdate, bookings, isAdmin=false, currentUser="홍길동", currentUserEmail="", rooms:roomsProp=[], users:usersProp=[]}) {
  // ── 모든 hooks를 최상단에 선언 ──────────────────────────────────────────────
  const { isMobile, isTablet } = useBreakpoint();
  const { vh: vvHeight, off: vvOff } = useVisualViewport();
  const today = todayStr();
  const maxDateObj = new Date(); maxDateObj.setMonth(maxDateObj.getMonth()+1);
  const maxDate = objToStr(maxDateObj);

  const [bookingDate, setBookingDate] = useState(
    // ← [2026-04-19 P1] editBooking이면 그 예약의 날짜 유지(과거 예약 수정 가능),
    //   새 예약이면 initDate < today 일 때 today로 보정 (탭 밤새 유지 방어)
    editBooking ? tsDate(editBooking.start_at) : (initDate && initDate >= today ? initDate : today)
  );
  const [showPicker,  setShowPicker]  = useState(false);
  // ← [2026-04-19 P1] 달력 초기 표시 월/연도도 보정된 날짜 기준으로 계산
  const [calYear,  setCalYear]  = useState(() => dateToObj((initDate && initDate >= today) ? initDate : today).getFullYear());
  const [calMonth, setCalMonth] = useState(() => dateToObj((initDate && initDate >= today) ? initDate : today).getMonth());
  const [form, setForm] = useState(() => {
    if (editBooking) {
      return {
        room_id:   editBooking.room_id,
        title:     editBooking.title,
        start:     tsTime(editBooking.start_at),  // "HH:MM" 24시간 형식 유지
        end:       tsTime(editBooking.end_at),
        memo:      editBooking.memo || "",
        // AttendeeRef[] → AttendeeFormItem[]
        // email로 usersProp에서 역조회해 user_id·dept·avatar_url 복원
        attendees: (editBooking.attendees || []).map(a => {
          const u = (usersProp as any[]).find(u => u.email === a.email)
          return {
            user_id:    u?.user_id   ?? a.email,   // 없으면 email을 임시 key로
            name:       a.name       || u?.name    || a.email,
            email:      a.email,
            dept:       u?.dept      ?? '',
            avatar_url: u?.avatar_url ?? null,
          }
        }),
      };
    }
    // 현재 시각 기준 다음 15분 단위 스냅 (예: 6:08 → 6:15, 6:15 → 6:30)
    const nowMin = nowMinutes();
    const snapStart = Math.ceil((nowMin+1)/15)*15;
    const clampedStart = Math.min(Math.max(snapStart, 7*60), 18*60+45);
    const clampedEnd   = Math.min(clampedStart+15, 19*60); // ← [2026-04-26] 60→15: 모달 오픈 시 기본 15분
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [graphUsers,    setGraphUsers]    = useState<AppUser[]>([]);
  const [isSearching,   setIsSearching]   = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");

  // [2026-04-17 Step 3] 참석자 검색: DB 호출 → 메모리 필터링으로 전환
  // ────────────────────────────────────────────────────────────────────
  // 변경 이유:
  //   - 기존: searchGraphUsers(q) → profiles 테이블 ILIKE %q% 쿼리
  //           → 인덱스 활용 불가 → 매 키스트로크마다 profiles 529행 Full Scan
  //           → BookingModal 열 때마다 3~5회 DB 호출 발생
  //   - 변경: usersProp(앱 시작 시 1회 로드된 전체 users)에서 로컬 필터링
  //           → DB 호출 0회 + 즉시 반응 + 디바운스 불필요
  //
  // 설계 원칙: 마스터 데이터(users 500명)는 앱 시작 시 1회만 로드,
  //            검색/필터링은 메모리에서 처리 (rooms 패턴과 동일)
  //
  // UX 호환성:
  //   - "길동"으로 "홍길동" 검색 가능 (includes 사용 — ILIKE %q% 와 동일)
  //   - 이름·이메일·부서 3개 필드 중 하나라도 매칭 (기존 동일)
  //   - 최대 8개 결과 (기존 LIMIT 8 과 동일)
  //   - 본인 제외, 퇴사자(is_active=false) 제외 (기존 동일)
  useEffect(() => {
    const q = attendeeQ.trim().toLowerCase();  // ← [변경] 대소문자 무시 위해 lowercase 통일
    // 입력값 없으면 즉시 동기 초기화 (리스트 잔존 방지)
    if (q.length < 1) {
      setGraphUsers([]);
      setIsSearching(false);
      setSearchedQuery("");
      return;
    }
    // [변경] 디바운스 제거 — 메모리 검색이라 즉시 실행 (DB 부담 없음)
    // usersProp에서 로컬 필터링
    const results = (usersProp as AppUser[])
      .filter(u => {
        // 본인 제외 (currentUserEmail 있을 때만)
        if (currentUserEmail && u.email === currentUserEmail) return false;
        // 비활성 유저(퇴사자) 제외
        if (u.is_active === false) return false;
        // 이름/이메일/부서 중 하나라도 포함되면 매칭 (ILIKE %q% 동등)
        const name  = (u.name  ?? '').toLowerCase();
        const email = (u.email ?? '').toLowerCase();
        const dept  = (u.dept  ?? '').toLowerCase();
        return name.includes(q) || email.includes(q) || dept.includes(q);
      })
      .slice(0, 8);  // 기존 LIMIT 8 동등
    setGraphUsers(results);
    setSearchedQuery(attendeeQ.trim());  // 원본 query (UI 렌더링에서 trim된 값과 비교하므로)
    setIsSearching(false);  // 동기 실행이라 항상 false
  }, [attendeeQ, currentUserEmail, usersProp]);


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
  // 오늘이고 현재시각이 18:45 이후(= 시작 슬롯 없음) → 예약 불가 안내
  const noTimeLeft     = bookingDate === todayStr() && tOpts.length === 0;
  // 오늘이고 현재시각이 19:00 이상 → "오후 7시 이후 예약 불가" 안내
  const isAfter7pm     = bookingDate === todayStr() && nowMinutes() >= 19 * 60;

  const validTime   = form.start < form.end;
  const durMin      = timeToMin(form.end) - timeToMin(form.start);
  const allRooms = roomsProp;
  const selectedRoom     = form.room_id ? allRooms.find(r=>r.room_id===form.room_id) : null;
  const isApprovalRoom   = !editBooking && (selectedRoom?.is_admin_only ?? false);  // Admin 포함 모두 승인 요청
  const selectedFloor    = selectedRoom  ? getFloor(selectedRoom.floor_id) : null;
  const selectedFeatures = selectedRoom?.features ?? [];

  // ── 편집 모드에서 자기 자신 예약 제외 (충돌 검사 용) ──
  const bookingsForCheck = editBooking
    ? bookings.filter(b => b.id !== editBooking.id)
    : bookings;

  // ── 중앙화된 가용 회의실 검증 ──
  const { available: availableRooms, unavailable: unavailableRooms } = useMemo(
    () => getAvailableRooms(allRooms, bookingsForCheck, bookingDate, form.start, form.end, isAdmin),
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
      const nextEndMin = Math.min(timeToMin(nextStart) + 15, 19*60); // ← [2026-04-26] 60→15: tick 자동보정 시 기본 15분
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
      const clampedEnd   = Math.min(clampedStart+15, 19*60); // ← [2026-04-26] 60→15: 날짜 변경 시 기본 15분
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
  // Graph API 결과에서 이미 추가된 참석자만 제거
  const attendeeSuggestions = graphUsers
    .filter(u => !form.attendees.find(a => a.user_id === u.user_id));

  // 참석자 UI JSX (재사용: 모바일 Step1 + 데스크톱 폼)
  const AttendeeSection = (compact = false) => (
    <div>
      <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",
        marginBottom:6,letterSpacing:"0.4px"}}>
        참석자 <span style={{fontWeight:400,color:"#CBD5E1"}}>(선택 · 초대 메일 자동 발송)</span>
      </label>

      {/* 선택된 참석자 칩 */}
      {form.attendees.length > 0 && (
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
          {form.attendees.map(a => (
            <AttendeeChip
              key={a.user_id}
              name={a.name}
              avatarUrl={a.avatar_url}
              dept={a.dept}
              onRemove={() => removeAttendee(a.user_id)}
            />
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
                <UserAvatar name={u.name} avatarUrl={(u as any).avatar_url ?? null} size={28} />
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{u.name}</div>
                  <div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div>
                </div>
                <span style={{fontSize:11,color:"#CBD5E1",flexShrink:0}}>+ 추가</span>
              </div>
            ))}
          </div>
        )}
        {attendeeFocus && attendeeQ.trim().length > 0 && isSearching && (
          <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
            background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
            padding:"12px 14px",fontSize:12,color:"#94A3B8",
            boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
            검색 중...
          </div>
        )}
        {attendeeFocus && attendeeQ.trim().length > 0 && !isSearching && searchedQuery === attendeeQ.trim() && attendeeSuggestions.length === 0 && (
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
      const newEnd = timeToMin(t) + 15; // ← [2026-04-26] 60→15: 모바일 그리드 시작 클릭 시 기본 15분
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

        {/* ── 19시 이후 안내 문구 ── */}
        {isAfter7pm && (
          <div style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"7px 12px", borderRadius:8,
            background:"#FFF7ED", border:"1px solid #FED7AA",
          }}>
            <AlertCircle size={13} strokeWidth={1.8} color="#F97316" style={{flexShrink:0}}/>
            <span style={{fontSize:11, fontWeight:600, color:"#C2410C"}}>
              오후 7시 이후에는 예약할 수 없습니다.
            </span>
          </div>
        )}

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
                color:"#fff", fontSize:10, fontWeight:600,
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              }}>1</div>
              <span style={{fontSize:12,fontWeight:600,
                color: isPickingStart && startOpen ? "#6366F1" : "#475569"}}>시작 시간</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:13,fontWeight:600,
                color: isPickingStart && startOpen ? "#6366F1" : "#111111"}}>
                {form.start ? fmtTime(form.start) : <span style={{color:"#CBD5E1",fontWeight:400}}>선택하세요</span>}
              </span>
              <span style={{color:"#CBD5E1",fontSize:11}}>startOpen ? <ChevronUp size={11} strokeWidth={1.8}/> : <ChevronDown size={11} strokeWidth={1.8}/></span>
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
                color:"#fff", fontSize:10, fontWeight:600,
                display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,
              }}>2</div>
              <span style={{fontSize:12,fontWeight:600,
                color: isPickingEnd && endOpen ? "#6366F1" : "#475569"}}>종료 시간</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {validTime && (
                <span style={{fontSize:11,color:"#94A3B8"}}>
                  {Math.floor(durMin/60)>0?`${Math.floor(durMin/60)}시간`:""}
                  {durMin%60>0?` ${durMin%60}분`:""}
                </span>
              )}
              <span style={{fontSize:13,fontWeight:600,
                color: isPickingEnd && endOpen ? "#6366F1" : validTime ? "#111111" : "#EF4444"}}>
                {form.end
                  ? <>{fmtTime(form.end)}{!validTime&&<AlertTriangle size={10} strokeWidth={1.8} style={{marginLeft:4,flexShrink:0,display:"inline-block",verticalAlign:"middle"}}/>}</>
                  : <span style={{color:"#CBD5E1",fontWeight:400}}>선택하세요</span>}
              </span>
              <span style={{color:"#CBD5E1",fontSize:11}}>endOpen ? <ChevronUp size={11} strokeWidth={1.8}/> : <ChevronDown size={11} strokeWidth={1.8}/></span>
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
        const isAdminRoom = allRooms.find(rm=>rm.room_id===r.room_id)?.is_admin_only ?? false;
        return (
          <div key={r.room_id} onClick={()=>set("room_id", isSel?null:r.room_id)}
            style={{background:isSel?"#111":"#fff",
              border:`1.5px solid ${isSel?"#111":"#E2E8F0"}`, borderRadius:12,
              padding:"16px 18px", cursor:"pointer", transition:"all 0.15s", boxSizing:"border-box"}}
            onMouseEnter={e=>{if(!isSel){e.currentTarget.style.borderColor="#94A3B8";}}}
            onMouseLeave={e=>{if(!isSel){e.currentTarget.style.borderColor="#E2E8F0";}}}>
            <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
              {isSel
                ? <span style={{background:"#B9F8CF",color:"#111",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999,display:"inline-flex",alignItems:"center",gap:3}}><Check size={10} strokeWidth={1.8}/>선택됨</span>
                : <span style={{background:"#CBECFF",color:"#000",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>예약가능</span>}
              {isAdminRoom && !isSel && (
                <span style={{background:"#FEF3C7",color:"#92400E",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>승인 필요</span>
              )}
              {isAdminRoom && isSel && (
                <span style={{background:"#FEF3C7",color:"#92400E",fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>승인 후 확정</span>
              )}
            </div>
            <div style={{fontSize:15,fontWeight:600,color:isSel?"#fff":"#111",marginBottom:4}}>{r.room_name}</div>
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
              <span style={{background:st.bg==="FEF2F2"?"#FEE2E2":"#FEE2E2",color:st.color,fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:999}}>{st.label}</span>
            </div>
            <div style={{fontSize:15,fontWeight:600,color:"#ff9494",marginBottom:4}}>{r.room_name}</div>
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
      borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [Phase A] 16→24 (Figma)
      width:"100%", maxWidth: isMobile ? "100%" : 924, // ← [Phase A] 960→924 (Figma)
      maxHeight: isMobile ? `${Math.floor(vvHeight * 0.95)}px` : modalMaxH,
      height: isMobile ? `${Math.floor(vvHeight * 0.95)}px` : "auto",
      boxShadow:"0 20px 60px rgba(0,0,0,0.15)",
      display:"flex", flexDirection:"column",
      overflow: "hidden",
      alignSelf: isMobile ? "flex-end" : "center",
      position:"relative",
    }}>
      {/* 모바일 핸들 */}
      {isMobile && <div style={{width:40,height:4,background:"#D1D5DB",borderRadius:2,
        position:"absolute",top:10,left:"50%",transform:"translateX(-50%)",zIndex:10}}/>}

      {/* 예약 생성 로딩 오버레이 — submit 후 250ms 이상 소요 시 표시 */}
      {isSubmitting && (
        <div style={{
          position:"absolute", inset:0, zIndex:500,
          background:"rgba(255,255,255,0.88)",
          backdropFilter:"blur(3px)",
          borderRadius: isMobile ? "20px 20px 0 0" : 24, // ← [Phase A] 모달과 동기화
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          gap:16,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:13,fontWeight:600,color:"#111"}}>예약을 생성 중입니다</span>
            <span className="loading-dots">
              <span/><span/><span/>
            </span>
          </div>
        </div>
      )}

      {/* ════ 헤더 (모바일: 일반 / 데스크톱: absolute) ════ */}
      {/* ← [Phase A] 데스크톱은 absolute(top:0)로 본체 위에 떠 있음 + drop-shadow */}
      <div style={{
        padding: isMobile ? "20px 20px 12px" : "16px 20px",
        borderBottom: isMobile ? "1px solid #F1F5F9" : "none", // ← [Phase A] 데스크톱은 boder 제거
        borderRadius: isMobile ? 0 : "24px 24px 0 0", // ← [Phase A] 모달 상단 라운드 매칭
        position: isMobile ? "static" : "absolute", // ← [Phase A] 데스크톱 absolute
        top: isMobile ? "auto" : 0,
        left: isMobile ? "auto" : 0,
        right: isMobile ? "auto" : 0,
        background: "#fff",
        filter: isMobile ? "none" : "drop-shadow(0px 4px 4px #fff)", // ← [Phase A] Figma drop-shadow
        zIndex: 10,
        display:"flex",
        justifyContent:"space-between",
        alignItems: isMobile ? "flex-start" : "center",
        flexShrink:0
      }}>

        {isMobile ? (
          /* 모바일 헤더: 스텝 인디케이터 포함 */
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:600,color:"#111111",marginBottom:10}}>{editBooking ? "예약 변경" : "새 회의 예약"}</div>
            {/* Step 인디케이터 */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginTop:4}}>
              {[{n:1,label:"일정 입력"},{n:2,label:"회의실 선택"}].map(({n,label},i)=>(
                <React.Fragment key={n}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:26,height:26,borderRadius:"50%",
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:12,fontWeight:600,flexShrink:0,
                      background:step>=n?"#111111":"#F1F5F9",
                      color:step>=n?"#fff":"#94A3B8"}}>
                      {step>n?<CheckCircle2 size={14} strokeWidth={1.8}/>:n}
                    </div>
                    <span style={{fontSize:13,fontWeight:step===n?700:400,
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
          // ← [Phase A] 데스크톱 타이틀: 18→24, fontWeight 600→500 (Pretendard Medium)
          <div style={{fontSize:24,fontWeight:500,color:"#111",lineHeight:1.5}}>{editBooking ? "예약 변경" : "새 회의실 예약"}</div>
        )}
        {/* ← [피그마 2026-04-22] 헤더 X → ModalCloseButton 공통 컴포넌트 */}
        <ModalCloseButton onClick={onClose} style={{marginLeft:12}} />
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
                <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6}}>회의 제목 *</label>
                <input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="회의 제목을 입력하세요" maxLength={40}
                  autoComplete="off"
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
                <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6}}>날짜 *</label>
                <button className="btn" onClick={()=>setShowPicker(v=>!v)}
                  style={{width:"100%",background:"#F8FAFC",border:`1px solid ${showPicker?"#111111":"#E2E8F0"}`,
                    borderRadius:10,color:"#111111",padding:"12px 14px",fontSize:14,
                    display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5}}><Calendar size={13} strokeWidth={1.8}/>{bookingDate} ({DAY_NAMES[dateToObj(bookingDate).getDay()]})</span>
                  <ChevronDown size={10} strokeWidth={1.8} color="#94A3B8"/>
                </button>
                {showPicker && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                    boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                      <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                        style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                      <span style={{fontSize:13,fontWeight:600,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                      <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                        style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                      {DAY_NAMES.map((n,i)=>(
                        <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:600,
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
                <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6}}>메모 (선택)</label>
                <textarea value={form.memo} onChange={e=>set("memo",e.target.value)} rows={2} placeholder="안건, 준비물 등"
                  style={{width:"100%",background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,
                    color:"#111111",padding:"12px 14px",fontSize:13,outline:"none",resize:"none"}}
                  onFocus={e=>e.target.style.borderColor="#111111"}
                  onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
              </div>
              {/* 참석자 */}
              {AttendeeSection()}
              {/* 반복 예약 */}
              {/* ← [2026-04-22 HOTFIX] 반복예약 기능 임시 비활성화
                   이유: 한 달치만 생성되어야 하는데 DB에 12월까지 생성되는 심각한 버그 발견
                   조치: NEVER 외 옵션 disabled 처리 + 점검 중 배너 표시
                   복구: 반복예약 로직 근본 수정 후 해제 */}
              {!editBooking && <div>
                <label style={{fontSize:11,fontWeight:600,color:"#94A3B8",display:"block",marginBottom:6,letterSpacing:"0.4px"}}>반복 예약</label>
                {/* ← [2026-04-22 HOTFIX] 점검 중 안내 배너 */}
                <div style={{padding:"8px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:11,color:"#92400E",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                  <AlertTriangle size={12} strokeWidth={1.8} style={{flexShrink:0}}/>
                  <span>반복 예약은 오남용으로 사용을 일시중지합니다. 정책확정 전까지, 단일 예약만 가능합니다.</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {[
                    {val:"NEVER",      label:"반복 안함",      sub:"단일 예약"},
                    {val:"EVERY_DAY",  label:"매일",           sub:"시작일부터 매일"},
                    {val:"EVERY_WEEK", label:"매주",           sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                  ].map(o=>{
                    // ← [2026-04-22 HOTFIX] NEVER 외 disabled
                    const isDisabled = o.val !== "NEVER";
                    return (
                    <button key={o.val} onClick={()=>{ if(!isDisabled) setRecur(o.val); }}
                      disabled={isDisabled}
                      style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        padding:"11px 14px",borderRadius:10,border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                        background:recur===o.val?"#111":(isDisabled?"#F1F5F9":"#F8FAFC"),
                        cursor:isDisabled?"not-allowed":"pointer",textAlign:"left",transition:"all 0.13s",
                        opacity:isDisabled?0.25:1}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:600,color:recur===o.val?"#fff":"#374151"}}>{o.label}</div>
                        <div style={{fontSize:11,color:recur===o.val?"rgba(255,255,255,0.55)":"#94A3B8",marginTop:1}}>{o.sub}</div>
                      </div>
                      {recur===o.val && <CheckCircle2 size={14} strokeWidth={1.8} color="#fff"/>}
                    </button>
                    );
                  })}
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
                        <div style={{fontWeight:600,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.8}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
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
                  <div style={{fontSize:13,fontWeight:600,color:"#111111"}}>{form.title||"(제목 없음)"}</div>
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
                    <div style={{fontSize:13,fontWeight:600,color:"#111111"}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><CheckCircle2 size={12} strokeWidth={1.8}/>{selectedRoom.room_name}</span></div>
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
                <div style={{fontSize:12,fontWeight:600,color:"#111111"}}>
                  {fmtTime(form.start)} – {fmtTime(form.end)} 이용 가능 회의실
                </div>
                <span style={{background:"#DCFCE7",color:"#16A34A",fontSize:11,fontWeight:600,display:"inline-flex",alignItems:"center",gap:3,padding:"3px 10px",borderRadius:20}}>
                  <CheckCircle2 size={11} strokeWidth={1.8} style={{marginRight:3}}/>{availableRooms.length}개
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
            <Button variant="ghost"   flex onClick={onClose}>취소</Button>
            <Button variant="primary" flex onClick={()=>setStep(2)} disabled={!canGoStep2}>다음 → 회의실 선택</Button>
          </>) : (<>
            {isApprovalRoom && (
              <div style={{width:"100%",marginBottom:8,padding:"10px 14px",borderRadius:10,
                background:"#FEF3C7",border:"1px solid #FCD34D",fontSize:12,color:"#92400E",
                display:"flex",alignItems:"center",gap:8}}>
                관리자 승인 후 예약이 확정됩니다. 에메랄드 룸은 사전 승인이 필요합니다.
              </div>
            )}
            <Button variant="ghost"   flex onClick={()=>setStep(1)} style={{minHeight:52}}>← 이전</Button>
            <Button variant="primary" flex disabled={!canSubmit} loading={isSubmitting} style={{minHeight:52}}
              onClick={async ()=>{
                if(!canSubmit)return;
                submitTimerRef.current = setTimeout(()=>setIsSubmitting(true), 250);
                try {
                  editBooking ? await onUpdate({...form},bookingDate) : await onSubmit({...form,recur:"NEVER"},bookingDate) /* ← [2026-04-22 HOTFIX] 반복예약 점검 중 — 강제 NEVER */;
                } finally {
                  if(submitTimerRef.current) clearTimeout(submitTimerRef.current);
                  setIsSubmitting(false);
                }
              }}>
              {editBooking ? "변경 저장" : isApprovalRoom ? "승인 요청" : "예약 확정"}
            </Button>
          </>)}
        </div>
      </>) : (

      /* ════ 데스크톱: 이미지 기반 리디자인 ════ */
      // ← [Phase A] padding 60px 0: 헤더/푸터 absolute 영역 확보 (Figma py-[60px])
      <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden",padding:"60px 0"}}>
        <div style={{display:"flex",flex:1,overflow:"hidden"}}>
          {/* LEFT: 폼 (50%) */}
          <div style={{flex:1,padding:"24px 28px",borderRight:"1px solid #F1F5F9",
            display:"flex",flexDirection:"column",gap:18,overflowY:"auto"}}>
            {/* 회의 제목 */}
            <div>
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>회의 제목 <span style={{color:"#EF4444"}}>*</span></label>
              <input value={form.title} onChange={e=>set("title",e.target.value)} placeholder="회의 제목을 입력하세요 40자" maxLength={40}
                autoComplete="off"
                style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  color:"#111",padding:"12px 16px",fontSize:14,outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#111"}
                onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
            </div>
            {/* 날짜 — Date Picker */}
            <div ref={pickerRef2} style={{position:"relative",zIndex:200}}>
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>날짜 <span style={{color:"#EF4444"}}>*</span></label>
              <button className="btn" onClick={()=>setShowPicker(v=>!v)}
                style={{width:"100%",background:"#fff",border:`1px solid ${showPicker?"#111111":"#E2E8F0"}`,
                  borderRadius:10,color:"#111111",padding:"12px 16px",fontSize:14,
                  display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:5}}><Calendar size={13} strokeWidth={1.8}/>{bookingDate} ({DAY_NAMES[dateToObj(bookingDate).getDay()]})</span>
                {showPicker ? <ChevronUp size={10} strokeWidth={1.8} color="#94A3B8"/> : <ChevronDown size={10} strokeWidth={1.8} color="#94A3B8"/>}
              </button>
              {showPicker && (
                <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:300,
                  background:"#fff",border:"1px solid #E2E8F0",borderRadius:12,
                  boxShadow:"0 8px 32px rgba(0,0,0,0.16)",padding:"14px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                    <button className="btn" onClick={e=>{e.stopPropagation();prevMonth();}} disabled={!canGoPrev}
                      style={{background:"none",color:canGoPrev?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>‹</button>
                    <span style={{fontSize:13,fontWeight:600,color:"#111111"}}>{calYear}년 {MONTH_NAMES[calMonth]}</span>
                    <button className="btn" onClick={e=>{e.stopPropagation();nextMonth();}} disabled={!canGoNext}
                      style={{background:"none",color:canGoNext?"#111111":"#E2E8F0",padding:"4px 10px",fontSize:16}}>›</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",marginBottom:4}}>
                    {DAY_NAMES.map((n,i)=>(
                      <div key={n} style={{textAlign:"center",fontSize:10,fontWeight:600,
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
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <label style={{fontSize:13,fontWeight:600,color:"#111"}}>시간 <span style={{color:"#EF4444"}}>*</span></label>
                {isAfter7pm && (
                  <span style={{fontSize:11,fontWeight:600,color:"#C2410C",display:"flex",alignItems:"center",gap:4}}>
                    <AlertCircle size={11} strokeWidth={1.8} color="#F97316"/>
                    오후 7시 이후에는 예약할 수 없습니다.
                  </span>
                )}
              </div>
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
                        const newEnd=timeToMin(e.target.value)+15; // ← [2026-04-26] 60→15: 데스크톱 select 시작 변경 시 기본 15분
                        const clamped=Math.min(newEnd,19*60);
                        set("end",`${fmt2(Math.floor(clamped/60))}:${fmt2(clamped%60)}`);
                      }}
                        style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                          color:"#111",padding:"12px 16px",fontSize:14,fontWeight:600,outline:"none",appearance:"none",cursor:"pointer"}}>
                        {tOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                    <span style={{color:"#94A3B8",fontSize:16,flexShrink:0}}>→</span>
                    <div style={{flex:1}}>
                      <select value={form.end} onChange={e=>set("end",e.target.value)}
                        style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                          color:"#111",padding:"12px 16px",fontSize:14,fontWeight:600,outline:"none",appearance:"none",cursor:"pointer"}}>
                        {endOpts.map(t=><option key={t} value={t}>{fmtTime(t)}</option>)}
                      </select>
                    </div>
                  </div>
                  {validTime && (
                    <div style={{textAlign:"right",marginTop:6,fontSize:12,color:"#94A3B8"}}>
                      소요시간 <span style={{color:"#111",fontWeight:600}}>
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
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>선택된 회의실</label>
              {selectedRoom ? (
                <div style={{background:"#b9f8cf42",border:"1.5px solid #86EFAC",borderRadius:10,padding:"14px 16px",
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:15,fontWeight:600,color:"#111"}}>{selectedRoom.room_name}</div>
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
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>참석자</label>
              {form.attendees.length > 0 && (
                <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                  {form.attendees.map(a => (
                    <AttendeeChip
                      key={a.user_id}
                      name={a.name}
                      avatarUrl={a.avatar_url}
                      dept={a.dept}
                      onRemove={() => removeAttendee(a.user_id)}
                    />
                  ))}
                </div>
              )}
              <div ref={attendeeRef} style={{position:"relative"}}>
                <input value={attendeeQ} onChange={e=>{setAttendeeQ(e.target.value);setAttendeeFocus(true);}}
                  onFocus={()=>setAttendeeFocus(true)}
                  placeholder="팀즈에 등록된 이름으로 검색"
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
                        <UserAvatar name={u.name} avatarUrl={u.avatar_url ?? null} size={28} />
                        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#111"}}>{u.name}</div><div style={{fontSize:11,color:"#94A3B8"}}>{u.dept} · {u.email}</div></div>
                        <span style={{fontSize:11,color:"#CBD5E1"}}>+ 추가</span>
                      </div>
                    ))}
                  </div>
                )}
                {attendeeFocus && attendeeQ.trim().length > 0 && isSearching && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                    padding:"12px 14px",fontSize:12,color:"#94A3B8",
                    boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
                    검색 중...
                  </div>
                )}
                {attendeeFocus && attendeeQ.trim().length > 0 && !isSearching && searchedQuery === attendeeQ.trim() && attendeeSuggestions.length === 0 && (
                  <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:400,
                    background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                    padding:"12px 14px",fontSize:12,color:"#94A3B8",
                    boxShadow:"0 8px 24px rgba(0,0,0,0.08)"}}>
                    검색 결과가 없습니다
                  </div>
                )}
              </div>
            </div>
            {/* 메모 */}
            <div>
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>메모 (선택)</label>
              <textarea value={form.memo} onChange={e=>set("memo",e.target.value)} rows={3} placeholder="안건, 준비물 등"
                style={{width:"100%",background:"#fff",border:"1px solid #E2E8F0",borderRadius:10,
                  color:"#111",padding:"12px 16px",fontSize:13,outline:"none",resize:"none"}}
                onFocus={e=>e.target.style.borderColor="#111"}
                onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
            </div>
            {/* 반복 예약 */}
            {/* ← [2026-04-22 HOTFIX] 반복예약 기능 임시 비활성화 (모바일과 동일) */}
            {!editBooking && <div>
              <label style={{fontSize:13,fontWeight:600,color:"#111",display:"block",marginBottom:8}}>반복 예약</label>
              {/* ← [2026-04-22 HOTFIX] 점검 중 안내 배너 */}
              <div style={{padding:"8px 12px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,fontSize:12,color:"#92400E",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                <AlertTriangle size={14} strokeWidth={1.8} style={{flexShrink:0}}/>
                <span>반복 예약은 오남용으로 사용을 일시중지합니다. 정책확정 전까지, 단일 예약만 가능합니다.</span>
              </div>
              <div style={{display:"flex",gap:8}}>
                {[
                  {val:"NEVER",      label:"반복 안함", sub:"단일"},
                  {val:"EVERY_DAY",  label:"매일",      sub:"시작일~1달"},
                  {val:"EVERY_WEEK", label:"매주",      sub:`매주 ${DAY_NAMES[dateToObj(bookingDate).getDay()]}요일`},
                ].map(o=>{
                  // ← [2026-04-22 HOTFIX] NEVER 외 disabled
                  const isDisabled = o.val !== "NEVER";
                  return (
                  <button key={o.val} onClick={()=>{ if(!isDisabled) setRecur(o.val); }}
                    disabled={isDisabled}
                    style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      padding:"12px 8px",borderRadius:10,
                      border:`1.5px solid ${recur===o.val?"#111":"#E2E8F0"}`,
                      background:recur===o.val?"#111":(isDisabled?"#F1F5F9":"#F8FAFC"),
                      cursor:isDisabled?"not-allowed":"pointer",transition:"all 0.13s",
                      opacity:isDisabled?0.25:1}}>
                    <span style={{fontSize:13,fontWeight:600,color:recur===o.val?"#fff":"#374151"}}>{o.label}</span>
                    <span style={{fontSize:10,color:recur===o.val?"rgba(255,255,255,0.5)":"#94A3B8",textAlign:"center"}}>{o.sub}</span>
                  </button>
                  );
                })}
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
                      <div style={{fontWeight:600,marginBottom:4}}><span style={{display:"inline-flex",alignItems:"center",gap:4}}><AlertTriangle size={12} strokeWidth={1.8}/>아래 날짜는 이미 예약이 있어 생성되지 않습니다</span></div>
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
              <div style={{fontSize:17,fontWeight:600,color:"#111"}}>
                {validTime?`${fmtTime(form.start)} - ${fmtTime(form.end)} 이용 가능 회의실`:"시간을 먼저 선택해주세요"}
              </div>
              {validTime&&<div style={{fontSize:13,color:"#94A3B8",marginTop:4}}>{availableRooms.length}개 가능 · 클릭해서 선택</div>}
            </div>
            {!validTime ? (
              <div style={{textAlign:"center",padding:"60px 20px",color:"#CBD5E1"}}>
                <div style={{display:"flex",justifyContent:"center",marginBottom:12}}><Clock size={40} strokeWidth={1.8} color="#CBD5E1"/></div>
                <div style={{fontSize:13}}>시작/종료 시간을 설정하면<br/>예약 가능한 회의실이 자동으로 표시됩니다</div>
              </div>
            ) : RoomGrid2(2)}
          </div>
        </div>

        {/* ── 하단 버튼 (데스크톱: absolute / 모달 전체 너비) ── */}
        {/* ← [Phase A] absolute(bottom:0), padding 8, gap 8, radius 0/24, 배경 #f5f5f5 over #fff */}
        <div style={{
          display:"flex",
          gap:8,
          padding:"8px",
          position:"absolute",
          bottom:0,
          left:0,
          right:0,
          borderRadius:"0 0 24px 24px",
          background:"linear-gradient(0deg, #fff, #fff), linear-gradient(0deg, #f5f5f5, #f5f5f5)",
          backgroundBlendMode:"normal",
          flexShrink:0,
          zIndex:10
        }}>
          {/* ← [Phase A] Button height 56, radius 16 (Figma) — minHeight로 강제 override */}
          <Button variant="ghost"   flex onClick={onClose} style={{minHeight:56, borderRadius:16}}>취소</Button>
          <Button variant="primary" flex disabled={!canSubmit} loading={isSubmitting}
            style={{minHeight:56, borderRadius:16}}
            onClick={async ()=>{
                if(!canSubmit)return;
                submitTimerRef.current = setTimeout(()=>setIsSubmitting(true), 250);
                try {
                  editBooking ? await onUpdate({...form},bookingDate) : await onSubmit({...form,recur:"NEVER"},bookingDate) /* ← [2026-04-22 HOTFIX] 반복예약 점검 중 — 강제 NEVER */;
                } finally {
                  if(submitTimerRef.current) clearTimeout(submitTimerRef.current);
                  setIsSubmitting(false);
                }
              }}>
            {editBooking ? "변경 저장" : isApprovalRoom ? "승인 요청" : "예약 확정"}
          </Button>
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Detail Modal ──────────────────────────────────────────────────────────────
