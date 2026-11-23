/**
 * pendingStatus.ts — 승인 대기 / 기한 초과 판별 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규 생성 — "승인 대기 2건이 떴다가 몇 초 뒤 사라지는" 버그의 근본 수정
 *  - [2026-11-23] 에메랄드 '기한초과 취소' 깜빡임 근본 수정 — 판정·기록 주체를 DB 한 곳으로
 *      · 원인: DB 에 기한초과를 기록하는 주체가 없어(cron ③ 정지) App.tsx 10초 tick 이 화면에서만
 *              임시 마킹 → DB 를 다시 읽을 때마다 원복 → "기한초과 ↔ 승인 대기(점유)" 반복
 *      · 해결: DB 함수 expire_pending_bookings()(pg_cron 매분, 20261123)가 마감 시각에
 *              status='cancelled' + cancelled_by='system' 으로 기록. App.tsx 임시 마킹은 삭제.
 *      · 추가 ①: isSystemExpired — DB 가 기록한 기한초과 건 판정 (slotHelpers 와 같은 식).
 *                어드민 승인 표의 '기한 초과' 분류가 이 값을 봐야 탭에서 사라지지 않는다.
 *      · 추가 ②: 직전 신청 차단 규칙 (고지 확정 2026-11-23)
 *                일반 사용자 = 시작 15분 전까지 / 관리자 = 시작 1분 전까지.
 *                최종 강제는 DB 트리거 trg_bookings_approval_lead_time — 여기는 사전 안내 + 에러 문구 변환.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🐞 버그 원인 (전수 조사 결과)
 *
 *   1. DB에는 승인 기한이 이미 지난 pending 예약이 `status='pending'` 그대로 남아 있다.
 *      (auto-cancel-bookings cron의 pending 처리 블록 ②③이 주석 처리된 상태 — v3 재설계 대기 중)
 *   2. 화면 진입 시 `pendingCount = status==='pending' && !autoCancelled` 로 세므로
 *      기한이 지난 건까지 **대기로 잡혀 "2"가 표시된다.**
 *   3. 그 뒤 App.tsx의 tick useEffect(블록 ②)가 돌면서 그 건들을
 *      `status:'cancelled', autoCancelled:true` 로 **낙관적 마킹**한다 → 카운트가 0으로 떨어진다.
 *   → "몇 초 뒤 사라짐"의 정체는 정확히 **다음 tick까지의 지연**이었다.
 *      DB는 그대로이므로 새로고침할 때마다 무한 반복된다.
 *
 * 🔧 근본 수정
 *   집계 시점에 "기한 초과"를 판정해 **첫 렌더부터 대기에서 제외**한다.
 *   tick을 기다릴 필요가 없어지고, DB 상태와 무관하게 화면이 항상 정확해진다.
 *
 *   ※ 판정식은 새로 만든 것이 아니라 App.tsx 블록 ②가 이미 쓰고 있던 공식을 1:1로 옮긴 것이다.
 *     (room_id===3 && nowMs >= start_at - 60_000). 규칙 변경이 아니라 일원화다.
 *   ※ 남은 과제: DB에 쌓인 잔여 pending 정리 + cron 재활성화는 별건이다.
 *     cron을 그냥 켜면 과거 건에 대해 pending_expired 알림이 대량 발송될 수 있다.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { Booking } from '../types'

/**
 * 승인제(에메랄드) 회의실 ID.
 * App.tsx 블록 ②가 `b.room_id === 3` 으로 하드코딩해 둔 값을 상수화했다.
 * ※ 원칙적으로는 `rooms.is_admin_only` 로 판정하는 것이 옳지만, 그렇게 바꾸면
 *   기존 동작이 달라지므로 여기서는 현행 공식을 그대로 유지한다.
 */
export const APPROVAL_ROOM_ID = 3

/** 승인 마감 유예 — 시작 1분 전 (App.tsx 블록 ②와 동일) */
export const APPROVAL_DEADLINE_MS = 60_000

/**
 * 기한 초과 pending — 관리자가 승인하지 못한 채 마감 시각을 넘긴 건.
 * 화면상 '대기'로 세면 안 된다.
 */
export function isExpiredPending(b: Booking, nowMs: number = Date.now()): boolean {
  return b.status === 'pending'
      && !b.autoCancelled
      // ← [2026-07-23 보강] cancelledBy 가드. App.tsx 블록②의 `if (b.cancelledBy != null) return b`
      //   (누군가 이미 처리한 건 보호)를 옮길 때 빠뜨렸던 조건이다.
      //   조합 전수 시뮬에서 `pending + cancelledBy='user'` 같은 건까지 기한초과로 잡히는 걸 확인해 보강.
      && b.cancelledBy == null
      && b.room_id === APPROVAL_ROOM_ID
      && nowMs >= new Date(b.start_at).getTime() - APPROVAL_DEADLINE_MS
}

/**
 * 실제로 처리를 기다리는 승인 대기 건.
 * 관리자가 지금 승인/거절을 누를 수 있는 것만 해당한다.
 */
export function isAwaitingApproval(b: Booking, nowMs: number = Date.now()): boolean {
  return b.status === 'pending'
      && !b.autoCancelled
      && !isExpiredPending(b, nowMs)
}

/** 대기 건수 — 대시보드 카드 / 사이드 네비 dot 공용 */
export function countAwaitingApproval(bookings: Booking[], nowMs: number = Date.now()): number {
  return bookings.filter(b => isAwaitingApproval(b, nowMs)).length
}

// ─────────────────────────────────────────────────────────────────────────────
// ← [2026-11-23] DB 가 기록한 기한초과 건
//   expire_pending_bookings() 가 남기는 형태 = status='cancelled' + cancelled_by='system' (승인룸).
//   calendar/slotHelpers.ts getSlotState 의 isExpiredPending 과 같은 식이다.
//   ※ isExpiredPending(위)은 "DB 가 아직 기록하기 전(수 초)" 의 pending 을 시각으로 판정하는 함수 —
//     두 함수를 합쳐야 기록 전·후 어느 시점에도 '기한초과' 로 읽힌다.
// ─────────────────────────────────────────────────────────────────────────────
export function isSystemExpired(b: Booking): boolean {
  return b.room_id === APPROVAL_ROOM_ID
      && b.status === 'cancelled'
      && b.cancelledBy === 'system'
}

// ─────────────────────────────────────────────────────────────────────────────
// ← [2026-11-23] 직전 신청 차단 (고지 확정)
//   승인룸은 관리자 승인 시간이 필요하므로 시작 직전 신청을 받지 않는다.
//     · 일반 사용자: 시작 15분 전까지 신청 가능
//     · 관리자     : 시작  1분 전까지 생성 가능 (관리자 예약은 즉시 확정 — 승인 마감과 같은 시각)
//   DB 상수 approval_request_lead_minutes()=15 / approval_deadline_minutes()=1 과 같은 값.
// ─────────────────────────────────────────────────────────────────────────────
/** 일반 사용자 신청 마감 — 시작 15분 전 */
export const APPROVAL_REQUEST_LEAD_MS = 15 * 60_000

/** 신청(생성) 마감까지 필요한 여유 — 관리자는 승인 마감(1분)과 동일 */
export function approvalLeadMs(isAdmin: boolean): number {
  return isAdmin ? APPROVAL_DEADLINE_MS : APPROVAL_REQUEST_LEAD_MS
}

/**
 * 승인룸 신청이 마감됐는가 — 마감 시각(시작 − 여유)을 "지난" 경우 true.
 * DB 트리거와 같은 부등호: now > start_at − lead 이면 차단 (정확히 마감 시각까지는 허용).
 */
export function isApprovalRequestClosed(startAt: string, isAdmin: boolean, nowMs: number = Date.now()): boolean {
  return nowMs > new Date(startAt).getTime() - approvalLeadMs(isAdmin)
}

/** 마감 안내 문구 — 예약 모달 토스트 · DB 에러 변환 공용 */
export function approvalLeadMessage(isAdmin: boolean): string {
  return isAdmin
    ? '에메랄드 룸은 회의 시작 1분 전까지만 예약할 수 있습니다.'
    : '에메랄드 룸은 회의 시작 15분 전까지만 신청할 수 있습니다.'
}

/**
 * DB 트리거 에러(APPROVAL_ROOM_LEAD_TIME:{분}) → 한글 문구.
 * 해당 에러가 아니면 null — 호출부가 `?? 다음 매퍼` 로 이어 쓴다 (noshowPenaltyErrorMessage 와 같은 계약).
 */
export function approvalLeadErrorMessage(err: unknown): string | null {
  const msg = (err as any)?.message ?? String(err ?? '')
  const m = /APPROVAL_ROOM_LEAD_TIME:(\d+)/.exec(msg)
  if (!m) return null
  return approvalLeadMessage(Number(m[1]) <= APPROVAL_DEADLINE_MS / 60_000)
}
