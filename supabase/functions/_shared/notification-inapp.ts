// @ts-nocheck
/**
 * _shared/notification-inapp.ts
 * C&R Space 알림 시스템 — 인앱 알림 DB INSERT 공용 헬퍼
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 원칙
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. 정책 기반 제목 자동 파생
 *    · notification-types.ts의 POLICIES에서 role별 inappTitle* 자동 선택
 *    · 호출자는 userId + type + role + booking만 넘기면 됨
 *    · 제목 문구 변경 시 POLICIES만 수정 → 전체 반영
 *
 * 2. 일관된 body 포맷
 *    · "{title} · {room_name} · {date} {time}"  — 기본형
 *    · "...  · 신청자: {user_name}"              — 관리자 수신 시
 *    · 모든 호출 지점에서 동일 포맷 → 인앱 UI 일관성
 *
 * 3. 일괄 처리 지원
 *    · insertInAppBulk: Admin 전원 / 참석자 전원 같은 케이스
 *    · Promise.allSettled로 병렬 + 부분 실패 허용
 *    · 한 사용자 실패가 다른 사용자에 영향 없음
 *
 * 4. 실패는 warn, throw 금지
 *    · 인앱 실패가 이메일 발송이나 예약 흐름을 끊으면 안 됨
 *    · 에러는 console.warn만 — 상위 호출 흐름 유지
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-18 P2 v1] 초기 생성
 *   · auto-cancel-bookings/checkin-reminder 등에 분산된 insertInAppNotification 통일
 *   · 정책 기반 제목 자동 파생 (POLICIES.inappTitle* 참조)
 *   · body 포맷 표준화 (제목 · 회의실 · 날짜 · 시간 [· 신청자])
 */

import { POLICIES, type NotificationType } from './notification-types.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 타입 정의
// ═══════════════════════════════════════════════════════════════════════════

/** Supabase client 타입 (느슨하게 — createClient 반환값 any 허용) */
type SupabaseClient = any

/** body 생성용 최소 필드 */
export interface InAppBookingData {
  id:         string
  title:      string
  room_name:  string
  start_at:   string
  user_name?: string             // 관리자 수신 시 "신청자" 표시용
}

/** 단일 INSERT 입력 */
export interface InsertInAppInput {
  userId:   string               // 알림 수신자 user_id (profiles.id)
  type:     NotificationType     // 이벤트 타입 (POLICIES에서 inappType/title 조회)
  role:     'booker' | 'attendee' | 'admin'   // 수신자 역할 (제목 선택용)
  booking:  InAppBookingData
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. body 포맷 유틸 (KST 기준)
// ═══════════════════════════════════════════════════════════════════════════

/** KST 기준 "YYYY년 M월 D일" */
function fmtDateKST(ts: string): string {
  if (!ts) return ''
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`
}

/** KST 기준 "오전 H:MM" / "오후 H:MM" */
function fmtTimeKST(ts: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const h   = kst.getUTCHours()
    const m   = String(kst.getUTCMinutes()).padStart(2, '0')
    const period = h < 12 ? '오전' : '오후'
    const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${period} ${hour}:${m}`
  } catch {
    return ''
  }
}

/**
 * 인앱 알림 body 문자열 생성 (일관 포맷)
 *
 * 예시:
 *   · booker/attendee: "주간 회의 · 2F Emerald · 2026년 4월 22일 오후 2:00"
 *   · admin:           "주간 회의 · 2F Emerald · 신청자: 송보람 · 2026년 4월 22일 오후 2:00"
 */
export function buildInAppBody(booking: InAppBookingData, role: 'booker' | 'attendee' | 'admin'): string {
  const title   = booking.title ?? ''
  const room    = booking.room_name ?? ''
  const date    = fmtDateKST(booking.start_at)
  const time    = fmtTimeKST(booking.start_at)
  const dateTime = (date && time) ? `${date} ${time}` : (date || time)

  // 관리자 수신 시 신청자 정보 포함 (pending, pending_expiring, pending_expired에서 유용)
  const applicant = (role === 'admin' && booking.user_name) ? ` · 신청자: ${booking.user_name}` : ''

  // 빈 요소는 제외하고 " · "로 연결
  const parts = [title, room, dateTime].filter(Boolean)
  return parts.join(' · ') + applicant
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 제목 선택 (정책에서 역할별 inappTitle 파생)
// ═══════════════════════════════════════════════════════════════════════════

/** 역할에 맞는 인앱 알림 제목을 POLICIES에서 꺼냄. 없으면 빈 문자열 */
function getInAppTitle(type: NotificationType, role: 'booker' | 'attendee' | 'admin'): string {
  const policy = POLICIES[type]
  if (!policy) return ''

  if (role === 'booker')   return policy.inappTitleBooker
  if (role === 'attendee') return policy.inappTitleAttendee
  if (role === 'admin')    return policy.inappTitleAdmin
  return ''
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 공개 API — 단일 INSERT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 인앱 알림 1건 INSERT
 *
 * · 제목은 정책(POLICIES.inappTitle*)에서 자동 선택
 * · body는 buildInAppBody()로 표준 포맷 생성
 * · userId가 비어있으면 스킵 (에러 아님)
 * · 정책에 해당 역할 제목이 정의되지 않으면 스킵 (예: pending_expiring은 admin 제목만 있음)
 *
 * @param supabase  Service Role Key로 초기화된 Supabase client
 * @param input     userId + type + role + booking
 * @returns         void (실패해도 throw 안 함 — warn 로그만)
 */
export async function insertInAppNotification(
  supabase: SupabaseClient,
  input: InsertInAppInput,
): Promise<void> {
  // userId 없으면 스킵 (정상 케이스 — 퇴사자 등)
  if (!input.userId) return

  // 정책에 역할별 제목이 정의돼 있는지 확인
  const title = getInAppTitle(input.type, input.role)
  if (!title) {
    // 정책 상 이 역할에는 인앱 알림이 없는 경우 (e.g. pending_expiring은 admin 전용)
    return
  }

  const policy = POLICIES[input.type]
  const body   = buildInAppBody(input.booking, input.role)

  try {
    const { error } = await supabase.from('notifications').insert({
      user_id:    input.userId,
      type:       policy.inappType,
      title:      title,
      body:       body,
      booking_id: input.booking.id,
      is_read:    false,
    })
    if (error) {
      console.warn(`[inapp] INSERT 실패 (userId=${input.userId}, type=${input.type}):`, error.message)
    }
  } catch (e: any) {
    console.warn(`[inapp] INSERT 예외 (userId=${input.userId}, type=${input.type}):`, e?.message ?? String(e))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 공개 API — 일괄 INSERT
// ═══════════════════════════════════════════════════════════════════════════

/** 일괄 INSERT 결과 요약 */
export interface InAppBulkResult {
  total:     number
  succeeded: number
  failed:    number
}

/**
 * 여러 사용자에게 같은 알림 일괄 INSERT
 *
 * · Admin 전원 / 참석자 전원 같은 케이스에 사용
 * · Promise.allSettled로 병렬 실행 — 한 명 실패가 다른 명에 영향 없음
 * · 빈 userIds는 즉시 반환
 *
 * @param supabase  Supabase client
 * @param userIds   수신자 user_id 배열
 * @param type      이벤트 타입
 * @param role      수신자 역할 (모든 userIds에 동일 적용)
 * @param booking   예약 데이터
 * @returns         total/succeeded/failed 카운트
 */
export async function insertInAppBulk(
  supabase: SupabaseClient,
  userIds: string[],
  type: NotificationType,
  role: 'booker' | 'attendee' | 'admin',
  booking: InAppBookingData,
): Promise<InAppBulkResult> {
  const cleanIds = (userIds ?? []).filter(Boolean)

  if (cleanIds.length === 0) {
    return { total: 0, succeeded: 0, failed: 0 }
  }

  // 정책에 해당 역할 제목이 없으면 전체 스킵
  const title = getInAppTitle(type, role)
  if (!title) {
    return { total: cleanIds.length, succeeded: 0, failed: 0 }
  }

  const tasks = cleanIds.map(userId =>
    insertInAppNotification(supabase, { userId, type, role, booking })
  )

  const settled = await Promise.allSettled(tasks)
  const failed  = settled.filter(r => r.status === 'rejected').length
  const succeeded = settled.length - failed

  console.log(`[inapp] bulk ${type}(${role}) — ${succeeded}/${cleanIds.length} 성공${failed > 0 ? ` (${failed} 실패)` : ''}`)

  return {
    total:     cleanIds.length,
    succeeded,
    failed,
  }
}
