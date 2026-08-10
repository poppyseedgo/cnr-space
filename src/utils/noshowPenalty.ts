/**
 * noshowPenalty.ts — 노쇼 이용 제재 프론트 유틸 (SSOT)
 *
 * ✅ 변경 이력
 *  - [2026-08-10] 신규 — 20260743_noshow_penalty.sql 과 짝.
 *      정책: 8월 시행. 노쇼 최초 발생일로부터 1개월 내 3회 누적 → 7일 예약 생성 불가.
 *
 * 📌 판정·차단은 전부 서버(DB 트리거)가 강제한다. 프론트는
 *    ① 차단 에러코드 → 한글 문구 매핑 (App.tsx addBooking catch — employment.ts 패턴 동일)
 *    ② 제재 이력 표시용 타입 정의
 *    만 담당한다. 클라이언트 자체 판정 로직 금지 — 이중 진실 방지.
 */

// ── 서버 계약: RAISE 'NOSHOW_PENALTY_BLOCKED:{KST YYYY-MM-DD HH24:MI}' ──────
export function noshowPenaltyErrorMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const m = msg.match(/NOSHOW_PENALTY_BLOCKED:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)
  if (!m) return msg.includes('NOSHOW_PENALTY_BLOCKED')
    ? '노쇼 누적(1개월 내 3회)으로 예약 생성이 제한된 상태입니다.'   // 상세 시각 파싱 실패 폴백
    : null
  return `노쇼 누적(1개월 내 3회)으로 예약 생성이 제한된 상태입니다. ${m[1]}까지 새 예약을 만들 수 없습니다.`
}

// ── 관리자 해제 RPC(admin_revoke_noshow_penalty) 에러 매핑 ──────────────────
export function revokeNoshowPenaltyErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('NOT_AUTHENTICATED')) return '로그인이 필요합니다.'
  if (msg.includes('NOT_ADMIN'))         return '예약 관리 권한이 필요합니다.'
  if (msg.includes('PENALTY_NOT_FOUND')) return '대상 제재를 찾을 수 없습니다.'
  if (msg.includes('ALREADY_REVOKED'))   return '이미 해제된 제재입니다.'
  return '제재 해제에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

// ── 타입 (noshow_penalties 테이블 1:1, snake_case — DB 컬럼 관례) ────────────
export interface NoshowPenaltyRow {
  id: string
  user_id: string
  user_email: string | null
  user_name: string | null
  anchor_at: string                 // 사이클 첫 노쇼 start_at
  counted_booking_ids: string[]     // 근거 노쇼 3건 (bookings.id)
  triggered_booking_id: string      // 3번째 노쇼
  starts_at: string                 // 제재 시작 (= 3번째 노쇼 start_at)
  ends_at: string                   // 제재 종료 (= starts_at + 7일)
  revoked_at: string | null
  revoked_by: string | null
  revoked_reason: string | null
  created_at: string
}

/** my_noshow_penalty_state RPC 응답 */
export interface MyNoshowPenaltyState {
  blocked: boolean
  penalty_id: string | null
  starts_at: string | null
  ends_at: string | null
}

/** 화면 표시 상태 — DB status 컬럼 없음, 파생값 (이중 진실 방지) */
export type PenaltyDisplayStatus = 'active' | 'expired' | 'revoked'
export function penaltyDisplayStatus(p: NoshowPenaltyRow, nowMs: number = Date.now()): PenaltyDisplayStatus {
  if (p.revoked_at) return 'revoked'
  return nowMs < new Date(p.ends_at).getTime() ? 'active' : 'expired'
}

// ── 해제 시각 표기 SSOT (BookingModal 배너·CTA — 2026-08-10 고지 확정 프리뷰) ─
// time.ts 유틸(tsDate/fmtTS = KST 변환 내장)만 사용 — 자체 타임존 계산 금지
import { tsDate, fmtTS, DAY_NAMES } from './time'

/** 배너용: "8월 16일(일) 오전 9:00" */
export function fmtPenaltyEnd(endsAt: string): string {
  const d = tsDate(endsAt)                       // "YYYY-MM-DD" (KST)
  if (!d) return ''
  const [y, m, dd] = d.split('-').map(Number)
  const day = DAY_NAMES[new Date(y, m - 1, dd).getDay()]
  return `${m}월 ${dd}일(${day}) ${fmtTS(endsAt)}`
}

/** CTA용 짧은 표기: "8/16 오전 9:00" */
export function fmtPenaltyEndShort(endsAt: string): string {
  const d = tsDate(endsAt)
  if (!d) return ''
  const [, m, dd] = d.split('-').map(Number)
  return `${m}/${dd} ${fmtTS(endsAt)}`
}
