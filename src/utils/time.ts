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
//  - [2026-04-27 충돌 판정 기준 단일화]
//    · 원인: 기존 `!autoCancelled` 필터가 status='cancelled'(autoCancelled=false)인
//            사용자 직접취소·admin 강제취소 예약을 충돌로 잘못 판정 → BookingModal
//            가용 회의실 목록이 실제 풀린 시간대에도 비가용으로 표시되며 깜빡임 유발
//    · 증상: ① 사용자가 본인 예약을 취소했는데 그 시간 슬롯이 다른 사용자에게도
//            여전히 비가용으로 보임. ② getRoomStatus와 충돌 기준이 어긋나 홈카드와
//            예약모달의 가용 표시가 불일치 (모순 상태)
//    · 해결: 충돌 판정 기준을 `cancelled_by` 단일 컬럼 기반으로 통일.
//            cancelled_by ∈ {user, system, admin}이면 모두 가용으로 처리.
//            (rejected는 항상 cancelled_by='admin'으로 저장되므로 자동 제외됨)
//    · 영향: getRoomStatus도 동일 기준으로 동기화 (이 파일 하단 참조)
//    · 호출처 검증: BookingModal(가용회의실/반복예약), App.tsx(예약생성 최종검증)
//                   3곳 모두 동일하게 적용 — 풀린 시간대에 새 예약 생성 가능
export function hasTimeConflict(existingBookings, roomId, date, startMin, endMin) {
  if (!roomId || !date || startMin >= endMin || endMin <= 0) return { conflict: true, reason: "INVALID_TIME" };

  const activeBookings = existingBookings.filter(b =>
    b.room_id === roomId &&
    tsDate(b.start_at) === date &&
    b.cancelledBy !== 'user'   && // ← [2026-04-27] 사용자 직접취소 제외
    b.cancelledBy !== 'system' && // ← [2026-04-27] 노쇼/pending_expired 자동취소 제외
    b.cancelledBy !== 'admin'  && // ← [2026-04-27] admin 강제취소·pending 거부(rejected) 제외
    !b.earlyEnded                  // 조기종료 제외 (기존 유지)
    // ← [2026-04-27 삭제] !b.autoCancelled — cancelledBy 단일 기준으로 대체
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
 *  - [2026-04-18 타입 안전성] 반환 타입 `RoomStatus` 명시 + return 객체 `as const` 처리
 *    · 원인: 반환 타입 미명시로 인해 { type: "BUSY" } 같은 리터럴이 string으로 추론됨
 *    · 증상: RoomStatusBadge 같이 status 객체 전체를 타입 엄격하게 받는 컴포넌트에
 *            넘길 때 TS2322 에러 (string → 'AVAILABLE' | 'BUSY' | 'SOON' 불일치)
 *    · 해결: 함수 시그니처에 `: RoomStatus` 명시 + 각 return 객체를 `as const` 처리
 *    · 기존 호출부(status.type === "BUSY" 같은 문자열 비교)는 모두 100% 호환
 *
 *  - [2026-04-27 hasTimeConflict와 필터 기준 단일화]
 *    · 원인: 기존 필터(`!autoCancelled && status!=='rejected'`)가 사용자 직접취소
 *            (status='cancelled', autoCancelled=false)·admin 강제취소를 점유로 잘못 판정.
 *            hasTimeConflict와 기준이 어긋나 BookingModal "가용"인 회의실이 홈카드에선
 *            BUSY/SOON으로 표시되는 모순 상태 발생
 *    · 증상: ① 본인이 취소한 예약 시간대에 홈카드가 여전히 "곧 사용/사용중" 표시
 *            ② BookingModal 가용 회의실 ↔ HomeView 룸카드 칩 불일치
 *    · 해결: dayBks 필터를 hasTimeConflict와 동일한 cancelled_by 단일 기준으로 통일.
 *            cancelled_by ∈ {user, system, admin} → 가용. earlyEnded → 가용.
 *            rejected는 cancelled_by='admin'으로 저장되므로 status 체크 불필요.
 *    · 호출처 검증: HomeView(룸카드 상태칩+카운트), RoomDetailModal(헤더칩) 두 곳
 *                   모두 사용자 시각 정확도 향상 — 풀린 예약은 즉시 AVAILABLE 표시
 *    · BUSY/SOON 판정 로직(currentCheckedIn / currentWaiting / next)은 dayBks를
 *            그대로 사용하므로 별도 변경 불필요
 */
export function getRoomStatus(roomId: number, bookings: Booking[], date: string): RoomStatus {
  const now = nowMinutes();
  const today = todayStr();
  const isToday = date === today;
  // pending 예약은 사실상 점유(SOON) — 취소(user/system/admin)·조기종료 제외
  // ← [2026-04-27] hasTimeConflict와 동일 기준으로 통일 (cancelled_by 단일 컬럼)
  const dayBks = bookings.filter(b =>
    b.room_id === roomId &&
    tsDate(b.start_at) === date &&
    b.cancelledBy !== 'user'   && // ← [2026-04-27] 사용자 직접취소 제외
    b.cancelledBy !== 'system' && // ← [2026-04-27] 노쇼/pending_expired 자동취소 제외
    b.cancelledBy !== 'admin'  && // ← [2026-04-27] admin 강제취소·pending 거부(rejected) 제외
    !b.earlyEnded                  // 조기종료 제외 (기존 유지)
    // ← [2026-04-27 삭제] !b.autoCancelled, status!=='rejected' — cancelledBy 단일 기준으로 대체
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