import type { Booking, ConflictResult, RoomStatus } from '../types'

// ─── Util ─────────────────────────────────────────────────────────────────────
export const HOURS = Array.from({ length: 13 }, (_, i) => i + 7);
export const DAY_NAMES = ["일","월","화","수","목","금","토"];
export const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
export const CHECKIN_WINDOW_MIN = 10;

export function fmt2(n) { return String(n).padStart(2,"0"); }

// ─── timestamptz 유틸 ────────────────────────────────────────────────────────
// 서울 오프셋 고정 (+09:00). SSO/배포 환경이 UTC여도 저장값 일관성 보장.
const KST = "+09:00";
// "YYYY-MM-DD" + "HH:MM" → "2026-03-05T09:00:00+09:00"
export function makeTZ(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00${KST}`;
}
// timestamptz → "YYYY-MM-DD" (KST 기준)
export function tsDate(ts) {
  if (!ts) return "";
  // "+09:00" 오프셋 포함된 ISO 문자열에서 날짜만 추출
  return ts.slice(0, 10);
}
// timestamptz → "HH:MM" (KST 기준)
export function tsTime(ts) {
  if (!ts) return "";
  return ts.slice(11, 16);
}
// timestamptz → 분 단위 (자정 기준, KST)
export function tsMin(ts) {
  const [h, m] = tsTime(ts).split(":").map(Number);
  return h * 60 + m;
}
// ─────────────────────────────────────────────────────────────────────────────

// 24시간 "HH:MM" → 오전/오후 12시간 표기 (UI form select 값 변환용)
export function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "오전" : "오후";
  const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${period} ${hour}:${fmt2(m)}`;
}
// timestamptz → 오전/오후 표기
export function fmtTS(ts) { return fmtTime(tsTime(ts)); }
// "HH:MM–HH:MM" 범위 표기
export function fmtRange(s, e) { return `${fmtTime(s)} – ${fmtTime(e)}`; }
// timestamptz 범위 표기
export function fmtTSRange(s_at, e_at) { return `${fmtTS(s_at)} – ${fmtTS(e_at)}`; }

// ── 정식 표기 포맷 (예약 정보 표시 전용) ─────────────────────────────────────
/** 오전/오후 H:MM (정식 표기 — 예: 오후 4:00) */
export function fmtTimeFull(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h < 12 ? "오전" : "오후";
  const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${period} ${hour}:${fmt2(m)}`;
}
/** timestamp → 오전/오후 H:MM */
export function fmtTSFull(ts: string): string { return fmtTimeFull(tsTime(ts)); }
/** 오전/오후 H:MM – 오전/오후 H:MM 범위 */
export function fmtRangeFull(s: string, e: string): string {
  return `${fmtTimeFull(s)} – ${fmtTimeFull(e)}`;
}
/** timestamp 범위 정식 표기 */
export function fmtTSRangeFull(s_at: string, e_at: string): string {
  return `${fmtTSFull(s_at)} – ${fmtTSFull(e_at)}`;
}
/** YYYY년 MM월 DD일 (정식 날짜 표기) */
export function fmtDateFull(dateStr: string): string {
  if (!dateStr) return "";
  const d = dateToObj(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
}
/** YYYY년 M월 D일 (요) 형식 */
export function fmtDateFullWithDay(dateStr: string): string {
  if (!dateStr) return "";
  const d = dateToObj(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${DAY_NAMES[d.getDay()]})`;
}
/** timestamp → YYYY년 MM월 DD일 */
export function fmtTSDateFull(ts: string): string { return fmtDateFull(tsDate(ts)); }
/** N층 회의실명 합성 (예: 2층 에메랄드) */
export function fmtRoomName(room: {room_name_ko?: string; room_name?: string}, floor: {floor_name?: string; floor_no?: number} | null): string {
  const name = room?.room_name_ko || room?.room_name || "";
  const floorStr = floor?.floor_name || (floor?.floor_no ? `${floor.floor_no}층` : "");
  if (floorStr && name) return `${floorStr} ${name}`;
  return name || floorStr;
}
// ── KST(+09:00) 기준 현재 시각 유틸 ──────────────────────────────────────
// Claude 아티팩트는 UTC 환경에서 실행되므로, 모든 "지금" 계산을 KST로 통일
export function nowKST() {
  // UTC ms + 9시간 offset → KST Date 객체처럼 동작하는 값
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}
export function todayStr() { const d=nowKST(); return `${d.getUTCFullYear()}-${fmt2(d.getUTCMonth()+1)}-${fmt2(d.getUTCDate())}`; }
export function nowMinutes() { const d=nowKST(); return d.getUTCHours()*60+d.getUTCMinutes(); }
export function timeToMin(t) { const [h,m]=t.split(":").map(Number); return h*60+m; }
export function dateToObj(s) { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
export function objToStr(d) { return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`; }
export function getWeekStart(s) { const d=dateToObj(s); d.setDate(d.getDate()-d.getDay()); return objToStr(d); }
export function addDays(s,n) { const d=dateToObj(s); d.setDate(d.getDate()+n); return objToStr(d); }
export function nowStr() { const d=nowKST(); return `${fmt2(d.getUTCHours())}:${fmt2(d.getUTCMinutes())}`; }

// ─── 중복 예약 검증 (중앙화) ──────────────────────────────────────────────
// 모든 충돌 검사를 이 함수 하나로 통일. UI 필터 + 제출 검증 모두 사용.
//
// ✅ 변경 이력
//  - [2026-04-22 v2.1] 시간 점유 필터 재정립 ← [변경 설명: 취소 예약이 활성 예약으로 잡혀 "예약할 수 없는 회의실" 버그 유발]
//     · 배경: 2026-04-21 v2.1 판정 공식 확정 시, 사람 개입 취소(User/Admin/거절)는
//            autoCancelled=false로 저장되도록 DB 규칙 변경됨
//     · 기존 버그: !b.autoCancelled 단독 조건 → User/Admin 취소가 활성 예약으로 통과
//                 → BookingModal에서 "예약할 수 없는 회의실" 오류
//     · 해결: CalendarShell/RoomDetailModal과 동일한 v2.1 필터 공식 적용
//            "시간 점유 = autoCancelled=false AND status ∈ ('confirmed','pending')"
//     · v2.1 DB 저장 규칙 (참조):
//        · User 취소:     status='cancelled' + autoCancelled=false + cancelledBy='user'
//        · Admin 강제취소: status='cancelled' + autoCancelled=false + cancelledBy='admin'
//        · Admin 거절:     status='rejected'  + autoCancelled=false + cancelledBy='admin'
//        · 기한초과(cron): status='pending'   + autoCancelled=true  + cancelledBy='system'
//        · 노쇼(cron):     status='confirmed' + autoCancelled=true  + cancelledBy='system'
export function hasTimeConflict(existingBookings, roomId, date, startMin, endMin) {
  if (!roomId || !date || startMin >= endMin || endMin <= 0) return { conflict: true, reason: "INVALID_TIME" };

  const activeBookings = existingBookings.filter(b =>
    b.room_id === roomId &&
    tsDate(b.start_at) === date &&
    !b.autoCancelled &&                              // 노쇼/기한초과 제외 (cron 자동취소)
    !b.earlyEnded &&                                 // 조기반납 제외
    b.status !== 'cancelled' &&                      // ← [v2.1 추가] User/Admin 취소 제외
    b.status !== 'rejected'                          // ← [v2.1 추가] Admin 거절 제외
  );

  for (const b of activeBookings) {
    const bStart = tsMin(b.start_at);
    const bEnd   = tsMin(b.end_at);

    // 시간 겹침: [14:00~15:00] + [14:30~15:30] = 충돌
    // 경계 접촉은 허용: [14:00~15:00] + [15:00~16:00] = OK
    if (startMin < bEnd && endMin > bStart) {
      return { conflict: true, reason: "OVERLAP", booking: b };
    }
  }

  return { conflict: false };
}

// 특정 회의실이 주어진 시간에 예약 가능한지 확인
export function isRoomAvailable(bookings, roomId, date, startTime, endTime) {
  const result = hasTimeConflict(bookings, roomId, date, timeToMin(startTime), timeToMin(endTime));
  return !result.conflict;
}

// 예약 가능한 전체 회의실 목록 반환
export function getAvailableRooms(allRooms, bookings, date, startTime, endTime, isAdmin) {
  if (!startTime || !endTime || startTime >= endTime) return { available: [], unavailable: allRooms.filter(r=>r.is_active) };
  const active = allRooms.filter(r => r.is_active);
  const available = active.filter(r => {
    // is_admin_only 회의실도 선택 가능 (예약 시 pending으로 처리됨)
    // 차단은 하지 않고 시간 충돌 여부만 확인
    return isRoomAvailable(bookings, r.room_id, date, startTime, endTime);
  });
  const unavailable = active.filter(r => !available.find(a => a.room_id === r.room_id));
  return { available, unavailable };
}

/**
 * getRoomStatus — 특정 날짜/회의실의 현재 상태 계산
 *
 * ✅ 변경 이력
 *  - [2026-04-22 v2.1] dayBks 필터 재정립 ← [변경 설명: User/Admin 취소가 BUSY 판정에 포함되던 버그]
 *     · 기존: `!b.autoCancelled && !b.earlyEnded && b.status !== 'rejected'`
 *            → v2.1에서 User/Admin 취소는 autoCancelled=false로 저장되므로 통과됨
 *     · 해결: hasTimeConflict/CalendarShell과 동일한 v2.1 필터 공식 적용
 *            "dayBks = autoCancelled=false AND status ∈ ('confirmed','pending') AND !earlyEnded"
 *     · 영향: 홈 카드 "사용중/예약가능" 판정 정확성 복구
 *
 *  - [2026-04-18 타입 안전성] 반환 타입 `RoomStatus` 명시 + return 객체 `as const` 처리
 *    · 원인: 반환 타입 미명시로 인해 { type: "BUSY" } 같은 리터럴이 string으로 추론됨
 *    · 증상: RoomStatusBadge 같이 status 객체 전체를 타입 엄격하게 받는 컴포넌트에
 *            넘길 때 TS2322 에러 (string → 'AVAILABLE' | 'BUSY' | 'SOON' 불일치)
 *    · 해결: 함수 시그니처에 `: RoomStatus` 명시 + 각 return 객체를 `as const` 처리
 *    · 기존 호출부(status.type === "BUSY" 같은 문자열 비교)는 모두 100% 호환
 */
export function getRoomStatus(roomId: number, bookings: Booking[], date: string): RoomStatus {
  const now = nowMinutes();
  const today = todayStr();
  const isToday = date === today;
  // [v2.1] 시간 점유 필터: 정상 예약(confirmed/pending) + autoCancelled=false + !earlyEnded
  //        · User/Admin 취소(status='cancelled'), 거절(status='rejected') 자동 제외
  //        · 노쇼/기한초과(autoCancelled=true) 자동 제외
  const dayBks = bookings.filter(b =>
    b.room_id === roomId &&
    tsDate(b.start_at) === date &&
    !b.autoCancelled &&                        // 노쇼/기한초과 제외 (cron 자동취소)
    !b.earlyEnded &&                           // 조기반납 제외
    b.status !== 'cancelled' &&                // ← [v2.1 추가] User/Admin 취소 제외
    b.status !== 'rejected'                    // 거절 제외
  );

  // ── BUSY 정책 ────────────────────────────────────────────────────────────
  // 케이스 A: 체크인 완료 + 시간 범위 내 → 진짜 사용중
  // 케이스 B: 미체크인 + 시작 후 10분 이내 → 유예기간 (사용중 + 체크인 대기)
  // 케이스 C: 미체크인 + 시작 후 10분 초과 → BUSY 아님 (자동취소 예정/완료)
  const currentCheckedIn = dayBks.find(b =>
    b.checkedIn &&
    tsMin(b.start_at) <= now && now < tsMin(b.end_at)
  );
  const currentWaiting = dayBks.find(b =>
    !b.checkedIn &&
    tsMin(b.start_at) <= now && now < tsMin(b.end_at) &&
    (now - tsMin(b.start_at)) <= CHECKIN_WINDOW_MIN  // 유예기간 10분 이내
  );
  const current = currentCheckedIn || currentWaiting;

  if (current && isToday) {
    const minsLeft       = tsMin(current.end_at) - now;
    const checkinWaiting = !!currentWaiting;   // 유예기간 중
    return {
      type: "BUSY" as const,  // ← [2026-04-18] as const로 리터럴 타입 고정
      label: "사용중",
      endTime: tsTime(current.end_at),
      minsLeft,
      booking: current,
      checkedIn:      !!currentCheckedIn,
      checkinWaiting,
    };
  }
  const next = dayBks.filter(b => tsMin(b.start_at) > now).sort((a,b) => a.start_at.localeCompare(b.start_at))[0];
  if (next && isToday) {
    const minsUntil = tsMin(next.start_at) - now;
    if (minsUntil <= 15) return { type: "SOON" as const, label: "곧 사용", nextStart: tsTime(next.start_at), minsUntil, booking: next };
  }
  return { type: "AVAILABLE" as const, label: "예약가능", nextBooking: next };
}