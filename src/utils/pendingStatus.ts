/**
 * pendingStatus.ts — 승인 대기 / 기한 초과 판별 SSOT
 *
 * ✅ 변경 이력
 *  - [2026-07-23] 신규 생성 — "승인 대기 2건이 떴다가 몇 초 뒤 사라지는" 버그의 근본 수정
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
