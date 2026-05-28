import type { Booking, ConflictResult, RoomStatus } from '../types'

/**
 * time.ts
 * ✅ 변경 이력
 *  - [2026-05-28 시작 전 체크인 완료 상태 SSOT 추가] isCheckedInWaiting 헬퍼 신규
 *    · 배경: 2026-05-12 체크인 윈도우를 [start, start+10)에서 [start-5, start+10)으로
 *            앞당겼으나, 그 결과로 새로 생긴 "체크인 완료 + 시작 전 대기"(checkedIn=true && isFuture=true)
 *            상태에 대한 표현 분기가 BookingStatusBadge / HomeView / MyPage 3곳 모두에서 누락됨.
 *    · 증상 (사용자 보고 2026-05-28):
 *        ① BookingStatusBadge "체크인 완료" 칩이 isAct(시작 이후)에만 표시되어 시작 전 체크인 시 미표시
 *        ② HomeView 미니카드 cardState가 `checkedIn ? "done"` 폴백으로 떨어져 "종료" 라벨 오표시
 *        ③ DetailModal 버튼 분기가 폴백 경로로 가서 "예약 취소 + 예약 변경" 노출 (체크인 후인데도)
 *    · 새 SSOT 헬퍼 isCheckedInWaiting(b):
 *        조건: checkedIn=true && now<start_at && status='confirmed' && !autoCancelled && !earlyEnded
 *        isCheckinable과 동일한 SSOT 패턴 — 4곳 이상 분산 위험 차단
 *    · isCheckinable과의 배타성: isCheckinable은 !checkedIn 가드, isCheckedInWaiting은 checkedIn 가드
 *        → 두 헬퍼는 항상 상호 배타 (동시 true 불가)
 *  - [2026-05-12 체크인 활성 5분 전으로 변경] CHECKIN_EARLY_MIN 상수 + isCheckinable 헬퍼 신규
 *    · 정책 변경: 체크인 활성 윈도우 [start, start+10분] → [start-5분, start+10분] (총 15분)
 *    · 노쇼 cutoff(start+10분)는 변동 없음 — CHECKIN_WINDOW_MIN 그대로
 *    · 새 상수 CHECKIN_EARLY_MIN=5: 시작 전 체크인 가능 분
 *    · 새 헬퍼 isCheckinable(b): 6곳 분산 위험 차단 SSOT (DetailModal/HomeView/MyPage/BookingStatusBadge 등)
 *    · isAct는 절대 손대지 않음 — "회의 진행중"의 의미 보존 (active/nci/getRoomStatus 등 의존)
 *  - [2026-05-07 HOTFIX] tsDate / tsTime / tsMin — 문자열 슬라이싱 → Date 파싱으로 교체
 *    · 원인: DB timestamptz가 UTC(+00:00) 형식일 때 slice()가 UTC 시간을 추출.
 *            nowMinutes()는 KST 기준이라 9시간 어긋남 → 미래 예약을 현재로 오인식.
 *    · 증상: 마이그레이션 예약(+00:00 형식)이 useEffect 노쇼 판정에서 미래인데 노쇼 처리됨.
 *            일반 예약(+09:00 형식)은 slice가 KST 시간을 그대로 추출해 영향 없었음.
 *    · 해결: new Date(ts) + KST offset(+9h)으로 파싱 → 어떤 offset 형식이든 KST 정규화.
 *  - [2026-04-29] HOURS 배열 length 13 → 12 (범위 7~18, 오후7시 열 제거)
 *    · 증상: 캘린더 데일리/위클리뷰에서 오후 7시 이후 슬롯 클릭 시
 *            startMin=19:15+, endMin=Math.min(+15, 19*60)=19:00 → start>end 역전
 *            → BookingModal 시간 필드 오류 상태로 열림
 *    · 해결: h=19(오후7시) 열 자체를 제거. 마지막 열 h=18이 6:00~7:00을 표현하므로
 *            6:45까지 클릭 가능(endMin=7:00) — 예약 가능 범위 동일하게 유지
 */

// ─── Util ─────────────────────────────────────────────────────────────────────
export const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // ← [2026-04-29] 13→12: h=19(오후7시) 열 제거 — 19:xx 클릭 시 start>end 역전 버그 차단. 마지막 열 h=18(오후6시)이 6:00~7:00 범위 표현
export const DAY_NAMES = ["일","월","화","수","목","금","토"];
export const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
export const CHECKIN_WINDOW_MIN = 10; // 시작 후 체크인 윈도우 (= 노쇼 cutoff). 변동 금지.
export const CHECKIN_EARLY_MIN  = 5;  // ← [2026-05-12] 시작 전 체크인 윈도우. 정책 변경 시 이 값만 수정.

export function fmt2(n) { return String(n).padStart(2,"0"); }

// ─── timestamptz 유틸 ────────────────────────────────────────────────────────
// 서울 오프셋 고정 (+09:00). SSO/배포 환경이 UTC여도 저장값 일관성 보장.
const KST = "+09:00";
// "YYYY-MM-DD" + "HH:MM" → "2026-03-05T09:00:00+09:00"
export function makeTZ(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00${KST}`;
}
// timestamptz → "YYYY-MM-DD" (KST 기준)
// ← [2026-05-07 HOTFIX] slice(0,10) → Date 파싱으로 교체
//   이유: DB에서 오는 값이 "+00:00"(UTC) 형식이면 slice가 UTC 날짜를 추출.
//         new Date(ts) + 9h offset으로 offset 형식 무관하게 KST 날짜 보장.
export function tsDate(ts) {
  if (!ts) return "";
  const kst = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // ← [HOTFIX] UTC→KST
  return `${kst.getUTCFullYear()}-${fmt2(kst.getUTCMonth()+1)}-${fmt2(kst.getUTCDate())}`;
}
// timestamptz → "HH:MM" (KST 기준)
// ← [2026-05-07 HOTFIX] slice(11,16) → Date 파싱으로 교체
//   이유: "+00:00" 형식이면 slice가 UTC 시간을 추출 → tsMin이 KST 기준 nowMinutes()와 9시간 어긋남.
export function tsTime(ts) {
  if (!ts) return "";
  const kst = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // ← [HOTFIX] UTC→KST
  return `${fmt2(kst.getUTCHours())}:${fmt2(kst.getUTCMinutes())}`;
}
// timestamptz → 분 단위 (자정 기준, KST)
export function tsMin(ts) {
  if (!ts) return 0; // ← [HOTFIX] null/undefined 방어
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
/** YYYY년 M월 D일 요일 형식 (풀네임, 예: "2026년 5월 27일 수요일")
 *  ← [2026-05-16] DetailModal에서 요일 풀네임 표시 위해 신규 추가
 *  · 기존 fmtDateFullWithDay와의 차이: (수) 짧은 형식 → 수요일 풀네임
 *  · 기존 함수는 테이블 컴팩트 표시용으로 그대로 유지 */
export function fmtDateFullWithDayFull(dateStr: string): string {
  if (!dateStr) return "";
  const d = dateToObj(dateStr);
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 ${DAY_NAMES[d.getDay()]}요일`;
}
/** timestamp → YYYY년 MM월 DD일 */
export function fmtTSDateFull(ts: string): string { return fmtDateFull(tsDate(ts)); }
/** timestamp → YYYY년 M월 D일 요일 풀네임 (DetailModal 전용)
 *  ← [2026-05-16] fmtTSDateFull의 요일 추가 버전 */
export function fmtTSDateFullWithDayFull(ts: string): string { return fmtDateFullWithDayFull(tsDate(ts)); }
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

// ─── 체크인 가능 여부 (SSOT) ─────────────────────────────────────────────
// ← [2026-05-12] 체크인 활성 시점 변경에 따라 신설
// ← [2026-05-12 hotfix v2] 분 단위(nowMinutes/tsMin) → ms 단위 비교로 교체
//   배경: 사용자 보고 — 메일 링크로 5분 전 클릭 시 모바일에서 체크인 버튼 비활성
//   근본 원인: 분 단위 정수 비교(Math.floor)가 메일 cron ±30초 발송 윈도우와 어긋남
//     · 메일 cron 발송 시점: start_at - 5분 ± 30초 (즉 sm-5'30" ~ sm-4'30")
//     · 사용자가 sm-5'30" 즈음 즉시 클릭 → nowMinutes()는 sm-6분으로 반올림
//     · `now >= sm - 5` 분 단위 비교: sm-6 >= sm-5 → false → 비활성
//   해결: Date.now() ms 단위 비교 → 발송/활성 시점이 ms 정밀도로 정렬
//   영향: isAct/nci/tl 등 다른 곳은 분 단위 그대로 유지 (의미 보존)
//
// 정책: 체크인 활성 윈도우 = [start_at - CHECKIN_EARLY_MIN, start_at + CHECKIN_WINDOW_MIN)
//       즉, 시작 5분 전부터 시작 후 10분까지 총 15분간 활성
//
// 분산 위험 차단:
//   · DetailModal 체크인 버튼 분기
//   · HomeView "오늘 내 예약" 카드 cardState
//   · MyPage WeeklyView 카드 cardState
//   · BookingStatusBadge "체크인 대기" 칩
//   → 4곳 이상이 동일 조건을 직접 작성하면 향후 분 단위 정책 변경 시 누락 위험.
//     isNoshow(noshow.ts) SSOT 패턴과 동일하게 단일 함수로 통일.
//
// 가드:
//   ① b.start_at 존재 — 누락 시 false (방어)
//   ② nowMs ∈ [startMs - 5분, startMs + 10분) — ms 단위 시간 윈도우
//   ③ status === 'confirmed' — pending/cancelled/rejected 차단
//   ④ !checkedIn — 이미 체크인한 건 false (체크인 → 다른 라벨로 전환)
//   ⑤ !autoCancelled — 노쇼/만료 차단
//   ⑥ !earlyEnded — 조기반납 차단
//
// 주의: isAct(회의 진행중)과 다른 개념. isAct는 [sm, em] 진행 시간대.
//       isCheckinable은 체크인 가능 시간대 (시작 전 5분 포함).
export function isCheckinable(b: Booking): boolean {
  if (!b.start_at) return false
  const nowMs   = Date.now()
  const startMs = new Date(b.start_at).getTime()
  if (Number.isNaN(startMs)) return false   // 불완전한 booking 객체 방어
  return nowMs >= startMs - CHECKIN_EARLY_MIN  * 60_000
      && nowMs <  startMs + CHECKIN_WINDOW_MIN * 60_000
      && b.status === 'confirmed'
      && !b.checkedIn
      && !b.autoCancelled
      && !b.earlyEnded
}

// ─── 시작 전 체크인 완료 대기 (SSOT) ─────────────────────────────────────
// ← [2026-05-28] 시작 전 체크인 완료 상태 표현 SSOT 신설
//
// 정책: "체크인 완료 + 아직 시작 전" 대기 상태
//       isCheckinable 시점에 사용자가 체크인을 누르면, 시작 시각 도달 전까지
//       이 상태에 머무름. isAct(진행중)와 다른 별개 라이프사이클 단계.
//
// 가드:
//   ① b.start_at 존재 — 누락 시 false (방어)
//   ② nowMs < startMs — 시작 전 (Date.now() ms 단위 비교, isCheckinable과 동일 정밀도)
//   ③ status === 'confirmed' — pending/cancelled/rejected 차단
//   ④ checkedIn === true — 체크인 완료
//   ⑤ !autoCancelled — 노쇼/만료 차단 (이론상 ④와 동시 불가지만 방어)
//   ⑥ !earlyEnded — 조기반납 차단 (이론상 시작 전에는 불가지만 방어)
//
// 배타성:
//   · isCheckinable과 항상 상호 배타 (checkedIn 가드가 반대)
//   · isAct와 배타 (isAct는 sm<=now, isCheckedInWaiting은 now<startMs)
//
// 사용처 (분산 위험 차단):
//   · BookingStatusBadge: 'checkin-done' 칩 표시 조건 확장 (isAct || isCheckedInWaiting)
//   · HomeView.cardState: 새 분기 "checkedInWaiting" (시작 전 체크인 완료 → 카운트다운 라벨)
//   · MyPage.cardState:    동일 패턴 (소형카드)
//
// 주의: now 비교는 ms 단위 (isCheckinable과 동일 정밀도). 분 단위(nowMinutes/tsMin) 비교
//       사용 시 경계(start-1초)에서 0분으로 반올림되어 isAct=true와 동시 true가 될 수 있음.
//       ms 비교로 startMs 경계가 정확히 분리됨.
export function isCheckedInWaiting(b: Booking): boolean {
  if (!b.start_at) return false
  const nowMs   = Date.now()
  const startMs = new Date(b.start_at).getTime()
  if (Number.isNaN(startMs)) return false   // 불완전한 booking 객체 방어
  return b.checkedIn === true
      && nowMs < startMs                    // 시작 전
      && b.status === 'confirmed'
      && !b.autoCancelled
      && !b.earlyEnded
}

/**
 * getRoomStatus — 특정 날짜/회의실의 현재 상태 계산
 *
 * ✅ 변경 이력
 *  - [2026-05-12 SOON 분기에 checkinWaiting 전파]
 *    · 사용자 정책: 시작 5분 전부터 "체크인 대기 중" 칩 노출 ("곧 사용" 대신)
 *    · 변경: SOON 반환 객체에 checkinWaiting 필드 추가 (isCheckinable SSOT 활용)
 *    · 에메랄드 pending은 status='pending'이라 isCheckinable=false → 자연스럽게 배제
 *    · RoomStatusBadge에서 SOON.checkinWaiting=true면 "체크인 대기 중" 칩 우선 렌더
 *    · BUSY 분기/판정 로직 무변경
 *
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
    if (minsUntil <= 15) {
      // ── [2026-05-12] 5분 전 윈도우의 체크인 대기 상태 감지 ──────────────
      // 정책: 시작 5분 전부터 시작 직전까지 미체크인 confirmed 예약이 있으면
      //       RoomStatusBadge에서 "체크인 대기 중" 칩을 노출 ("곧 사용" 대신)
      // 가드: isCheckinable SSOT 사용 (status='confirmed' + !checkedIn + !autoCancelled + !earlyEnded)
      //       에메랄드 룸 pending(승인 대기)은 status='pending'이므로 자동 배제
      const checkinWaiting = isCheckinable(next);
      return {
        type:        "SOON" as const,
        label:       "곧 사용",
        nextStart:   tsTime(next.start_at),
        minsUntil,
        booking:     next,
        checkinWaiting,   // ← [2026-05-12] SOON 분기에도 checkinWaiting 전파
      };
    }
  }
  return { type: "AVAILABLE" as const, label: "예약가능", nextBooking: next };
}