import type { Booking, ConflictResult, RoomStatus } from '../types'
import { ROOMS_DB, ADMIN_ONLY_ROOMS } from '../data/master'

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
export function hasTimeConflict(existingBookings, roomId, date, startMin, endMin) {
  if (!roomId || !date || startMin >= endMin || endMin <= 0) return { conflict: true, reason: "INVALID_TIME" };

  const activeBookings = existingBookings.filter(b =>
    b.room_id === roomId &&
    tsDate(b.start_at) === date &&
    !b.autoCancelled &&
    !b.earlyEnded
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
    if (ADMIN_ONLY_ROOMS.has(r.room_id) && !isAdmin) return false;
    return isRoomAvailable(bookings, r.room_id, date, startTime, endTime);
  });
  const unavailable = active.filter(r => !available.find(a => a.room_id === r.room_id));
  return { available, unavailable };
}

export function getRoomStatus(roomId, bookings, date) {
  const now = nowMinutes();
  const today = todayStr();
  const isToday = date === today;
  const dayBks = bookings.filter(b => b.room_id === roomId && tsDate(b.start_at) === date && !b.autoCancelled && !b.earlyEnded);

  // BUSY 정책: 예약 시간 범위 내 (체크인 여부 무관 — 시작되면 사용중으로 표시)
  // checkedIn 여부는 뱃지 표시에만 사용 (체크인 대기 / 체크인 완료)
  const current = dayBks.find(b =>
    tsMin(b.start_at) <= now && now < tsMin(b.end_at)
  );
  if (current && isToday) {
    const minsLeft    = tsMin(current.end_at) - now;
    const minsElapsed = now - tsMin(current.start_at);  // 시작 후 경과 분
    const checkinWaiting = !current.checkedIn && minsElapsed <= 10;  // 체크인 대기 (10분 이내)
    return {
      type: "BUSY",
      label: "사용중",
      endTime: tsTime(current.end_at),
      minsLeft,
      booking: current,
      checkedIn:      current.checkedIn,       // 체크인 완료 여부
      checkinWaiting,                           // 체크인 대기 중 (10분 이내 미체크인)
    };
  }
  const next = dayBks.filter(b => tsMin(b.start_at) > now).sort((a,b) => a.start_at.localeCompare(b.start_at))[0];
  if (next && isToday) {
    const minsUntil = tsMin(next.start_at) - now;
    if (minsUntil <= 15) return { type: "SOON", label: "곧 사용", nextStart: tsTime(next.start_at), minsUntil, booking: next };
  }
  return { type: "AVAILABLE", label: "예약가능", nextBooking: next };
}