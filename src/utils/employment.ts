/**
 * employment.ts — 재직 상태 판정·표시 단일 진실 원천 (SSOT)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 퇴사자 정책 개편 Phase 3 (20260735 짝 배포)
 *      · 라벨 규칙(확정): 퇴사예정(앰버, 예정일 병기) / 휴직(슬레이트) /
 *        복직(인디고, 30일 자동 소멸 — 서버 cron) / 퇴사(레드 + 이름 취소선)
 *      · 피커 제외 규칙(확정): 휴직자만 제외 — 퇴사예정자는 마지막 근무일까지
 *        정상 사용 가능하므로 포함(라벨 동반 노출)
 *      · 서버 가드 에러(LEAVE_CANNOT_CREATE / AFTER_DEPARTURE_DATE) 한글 매핑
 *
 * 📌 판정 원칙
 *    · 재직 상태는 profiles.employment_status 가 유일 기준 (is_active 는 deprecated)
 *    · "퇴사"는 상태값이 아니라 users 배열 부재 + departed_users 존재로 판정
 *      → 이력 화면에서는 users.find() 실패 = 퇴사자 취급 (기존 snapshot fallback 관례)
 */

import type { AppUser, EmploymentStatus } from '../types'

// ── 라벨 스타일 정의 (Figma 확정 전 임시 토큰 — 색상만 조정 가능, 구조 고정) ──
export interface EmploymentBadgeSpec {
  label: string
  color: string   // 텍스트
  bg:    string   // 배경
  /** 이름에 취소선 적용 여부 — 퇴사자 전용 (확정: 취소선 전부 적용) */
  strike: boolean
}

const STYLE: Record<Exclude<EmploymentStatus, 'active'> | 'departed', Omit<EmploymentBadgeSpec, 'label'>> = {
  departing: { color: '#B45309', bg: '#FEF3C7', strike: false }, // 앰버 — 임박 경고 계열
  leave:     { color: '#475569', bg: '#F1F5F9', strike: false }, // 슬레이트 — 중립 부재
  returned:  { color: '#4F46E5', bg: '#EEF2FF', strike: false }, // 인디고 — 복귀 환영
  departed:  { color: '#DC2626', bg: '#FEE2E2', strike: true  }, // 레드 — 종결 + 취소선
}

/** 퇴사예정 라벨의 예정일 표기: 'M/D' (KST date 문자열 'YYYY-MM-DD' 입력) */
function shortDate(d?: string | null): string {
  if (!d || d.length < 10) return ''
  const [, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}`
}

/**
 * getEmploymentBadge — 재직자(users 배열에 있는 사용자)의 라벨 판정
 * @returns active(재직)면 null — 라벨 없음
 */
export function getEmploymentBadge(u?: Pick<AppUser, 'employment_status' | 'departure_scheduled_on'> | null): EmploymentBadgeSpec | null {
  const s = u?.employment_status
  if (!s || s === 'active') return null
  if (s === 'departing') {
    const d = shortDate(u?.departure_scheduled_on)
    return { label: d ? `퇴사예정 · ${d}` : '퇴사예정', ...STYLE.departing }
  }
  if (s === 'leave')    return { label: '휴직', ...STYLE.leave }
  if (s === 'returned') return { label: '복직', ...STYLE.returned }
  return null
}

/** departedBadge — 퇴사자(users 부재 + departed_users 존재 / 이력 snapshot) 라벨 */
export function departedBadge(): EmploymentBadgeSpec {
  return { label: '퇴사', ...STYLE.departed }
}

/**
 * canPickUser — 예약자/참석자/대여자 피커 노출 판정 SSOT
 * 확정 정책: 휴직자만 제외. 퇴사예정·복직은 포함(라벨 동반).
 * is_active=false 는 레거시 호환 유지 (신규 경로에서는 발생하지 않음)
 */
export function canPickUser(u?: Pick<AppUser, 'employment_status' | 'is_active'> | null): boolean {
  if (!u) return false
  if (u.is_active === false) return false          // 레거시 호환
  return u.employment_status !== 'leave'           // 휴직자 제외 (확정)
}

// ── 서버 가드 에러 한글 매핑 ─────────────────────────────────────────────────
//   20260735 assert_employment_can_create 트리거가 던지는 원문 코드.
//   Postgres 에러는 message 에 코드 문자열이 포함되어 도착한다.
export function employmentErrorMessage(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('LEAVE_CANNOT_CREATE'))  return '휴직 중인 사용자는 예약·대여를 생성할 수 없습니다.'
  if (msg.includes('AFTER_DEPARTURE_DATE')) return '퇴사 예정일 이후에 시작하는 예약은 생성할 수 없습니다.'
  return null
}

// ── 상태 변경 RPC(admin_set_employment_status) 에러 매핑 ────────────────────
export function employmentStatusErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('FORBIDDEN'))               return '사용자 관리 권한이 필요합니다.'
  if (msg.includes('DEPARTURE_DATE_REQUIRED')) return '퇴사 예정일을 지정해야 합니다.'
  if (msg.includes('DEPARTURE_DATE_PAST'))     return '퇴사 예정일은 오늘 이후여야 합니다.'
  if (msg.includes('USER_NOT_FOUND'))          return '대상 사용자를 찾을 수 없습니다.'
  if (msg.includes('INVALID_STATUS'))          return '올바르지 않은 상태값입니다.'
  return '상태 변경에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

// ── 수동 퇴사(depart-user Edge Function) 에러 매핑 ──────────────────────────
export function departUserErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (msg.includes('CANNOT_DEPART_SELF')) return '본인 계정은 퇴사 처리할 수 없습니다.'
  if (msg.includes('FORBIDDEN'))          return '사용자 관리 권한이 필요합니다.'
  if (msg.includes('USER_NOT_FOUND'))     return '대상 사용자를 찾을 수 없습니다.'
  if (msg.includes('UNAUTHENTICATED'))    return '로그인이 필요합니다.'
  return '퇴사 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}
