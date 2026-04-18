// @ts-nocheck
/**
 * _shared/recipient-resolver.ts
 * C&R Space 알림 시스템 — 수신자 정보 통합 조회 헬퍼
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 설계 원칙
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. 단일 진입점 통합
 *    · 기존 분산: fetchCreatorInfo + fetchAdminEmails + fetchAttendees
 *              + fetchAdminUserIds + fetchAttendeeUserIds (총 5개)
 *    · 통합 후: resolveRecipients() 하나 — 한 번 조회로 이메일·인앱 모두 재사용
 *
 * 2. RecipientRule 기반 조건부 조회
 *    · 'booker_only' → booker만
 *    · 'booker_and_attendees' → booker + attendees
 *    · 'admins_only' → admins만
 *    · 'booker_attendees_admins' → 3자 모두
 *    · 'removed_attendees' → 외부 주입 (booking.removed_emails)
 *    · 불필요한 조회는 건너뜀 (DB 부하 최소화)
 *
 * 3. 한 번에 모든 필드
 *    · user_id + email + name + dept + avatar_url 모두 반환
 *    · 이메일(email 필요) / 인앱(user_id 필요) 양쪽에서 동일 객체 재사용
 *    · 같은 사람을 두 번 조회하는 비효율 제거
 *
 * 4. 병렬 실행
 *    · booker / attendees / admins 조회는 독립적 → Promise.all
 *    · send-notification 응답 시간 단축
 *
 * 5. Supabase client 주입
 *    · Service Role client를 호출자가 넘김
 *    · Edge Function → REST API 직접 호출 패턴 통일
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 * [2026-04-18 P2 v1] 초기 생성
 *   · send-notification/auto-cancel-bookings의 분산 조회 통일
 *   · 이메일+인앱에서 같은 사람 2번 조회 문제 해결
 *   · 병렬 조회로 응답 시간 단축
 */

import type { RecipientRule } from './notification-types.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 타입 정의
// ═══════════════════════════════════════════════════════════════════════════

type SupabaseClient = any

/**
 * 공통 Person 타입 — booker/attendee/admin 모두 동일 구조
 * 이메일 발송에 필요한 email + 인앱 발송에 필요한 user_id + UI 표시용 name/dept/avatar 모두 포함
 */
export interface Person {
  user_id:    string                 // profiles.id (인앱 알림 발송용)
  email:      string                 // 이메일 발송용
  name:       string                 // 이메일 본문 / 인앱 body
  dept:       string                 // 이메일 본문 (예약자 부서)
  avatar_url: string | null          // 이메일 본문 (아바타 이미지)
}

/** removed_attendees 케이스 전용 — user_id 없이 email만 있을 수 있음 */
export interface RemovedAttendee {
  email:      string
  name:       string                 // 이름 모르면 빈 문자열
  user_id:    string                 // 퇴사자거나 외부인이면 빈 문자열
  dept:       string
  avatar_url: string | null
}

/** resolveRecipients 반환 */
export interface ResolvedRecipients {
  booker:     Person | null          // booker_* 규칙일 때만 조회, 아니면 null
  attendees:  Person[]               // booker_and_attendees/booker_attendees_admins일 때만. 예약자 제외
  admins:     Person[]               // admins_only/booker_attendees_admins일 때만. 예약자 제외
  removedAttendees: RemovedAttendee[] // removed_attendees 규칙일 때만
}

/** resolveRecipients 입력 */
export interface ResolveInput {
  rule:          RecipientRule
  bookerUserId?: string              // booker 조회 + attendees/admins에서 예약자 제외용
  bookingId?:    string              // attendees 조회용 (booking_attendees 테이블)
  removedEmails?: string[]           // removed_attendees 규칙 시 외부 주입
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 내부 조회 함수
// ═══════════════════════════════════════════════════════════════════════════

/**
 * profiles에서 예약자 1명 조회
 * @returns  Person 객체. 조회 실패 시 null
 */
async function fetchBooker(supabase: SupabaseClient, userId: string): Promise<Person | null> {
  if (!userId) return null
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, dept, avatar_url')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.warn(`[resolver] booker 조회 실패 (userId=${userId}):`, error.message)
      return null
    }
    if (!data) return null

    return {
      user_id:    data.id,
      email:      data.email   ?? '',
      name:       data.name    ?? '',
      dept:       data.dept    ?? '',
      avatar_url: data.avatar_url ?? null,
    }
  } catch (e: any) {
    console.warn(`[resolver] booker 조회 예외 (userId=${userId}):`, e?.message ?? String(e))
    return null
  }
}

/**
 * profiles에서 Admin 전원 조회 (role=ADMIN, is_active=true)
 * @param excludeUserId  예약자가 관리자인 경우 중복 알림 방지 (선택)
 */
async function fetchAdmins(supabase: SupabaseClient, excludeUserId?: string): Promise<Person[]> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, name, dept, avatar_url')
      .eq('role', 'ADMIN')
      .eq('is_active', true)

    if (error) {
      console.warn('[resolver] admins 조회 실패:', error.message)
      return []
    }

    return (data ?? [])
      .filter((r: any) => !excludeUserId || r.id !== excludeUserId)
      .map((r: any) => ({
        user_id:    r.id,
        email:      r.email   ?? '',
        name:       r.name    ?? '',
        dept:       r.dept    ?? '',
        avatar_url: r.avatar_url ?? null,
      }))
      .filter((p: Person) => p.email || p.user_id)   // 둘 다 빈 건 제외
  } catch (e: any) {
    console.warn('[resolver] admins 조회 예외:', e?.message ?? String(e))
    return []
  }
}

/**
 * booking_attendees + profiles JOIN으로 참석자 전원 조회
 * · 예약자 이메일 제외 (동일 인물 중복 방지)
 * · profiles에 없는 참석자(외부인 또는 퇴사자)는 booking_attendees 기록만 사용 — user_id 빈 문자열
 */
async function fetchAttendees(
  supabase: SupabaseClient,
  bookingId: string,
  excludeEmail?: string,
): Promise<Person[]> {
  if (!bookingId) return []

  try {
    // 1. booking_attendees 조회
    const { data: rawAttendees, error: attErr } = await supabase
      .from('booking_attendees')
      .select('email, name')
      .eq('booking_id', bookingId)

    if (attErr) {
      console.warn(`[resolver] booking_attendees 조회 실패 (bookingId=${bookingId}):`, attErr.message)
      return []
    }

    const attendees = (rawAttendees ?? [])
      .map((a: any) => ({ email: a.email ?? '', name: a.name ?? '' }))
      .filter((a: any) => a.email && a.email !== excludeEmail)

    if (attendees.length === 0) return []

    // 2. profiles 배치 조회 (user_id, dept, avatar_url 풍부화)
    const emails = attendees.map((a: any) => a.email)
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, email, name, dept, avatar_url')
      .in('email', emails)

    if (profErr) {
      console.warn('[resolver] attendees profiles 조회 실패:', profErr.message)
    }

    // 3. Map으로 join (email key 소문자 정규화)
    const profileMap = new Map<string, any>()
    for (const p of (profiles ?? [])) {
      if (p.email) profileMap.set(p.email.toLowerCase(), p)
    }

    return attendees.map((a: any) => {
      const p = profileMap.get(a.email.toLowerCase())
      return {
        user_id:    p?.id         ?? '',
        email:      a.email,
        name:       p?.name       ?? a.name,
        dept:       p?.dept       ?? '',
        avatar_url: p?.avatar_url ?? null,
      } as Person
    })
  } catch (e: any) {
    console.warn(`[resolver] attendees 조회 예외 (bookingId=${bookingId}):`, e?.message ?? String(e))
    return []
  }
}

/**
 * removed_attendees 전용 — 주어진 이메일 목록을 profiles와 JOIN해서 Person 풍부화
 * · 주어진 emails 중 profiles에 없는 사람은 email/name만 유지
 */
async function fetchRemovedAttendees(
  supabase: SupabaseClient,
  removedEmails: string[],
): Promise<RemovedAttendee[]> {
  const clean = (removedEmails ?? []).filter(Boolean)
  if (clean.length === 0) return []

  try {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, name, dept, avatar_url')
      .in('email', clean)

    if (error) {
      console.warn('[resolver] removed_attendees 조회 실패:', error.message)
    }

    const profileMap = new Map<string, any>()
    for (const p of (profiles ?? [])) {
      if (p.email) profileMap.set(p.email.toLowerCase(), p)
    }

    return clean.map(email => {
      const p = profileMap.get(email.toLowerCase())
      return {
        email,
        name:       p?.name       ?? '',
        user_id:    p?.id         ?? '',
        dept:       p?.dept       ?? '',
        avatar_url: p?.avatar_url ?? null,
      } as RemovedAttendee
    })
  } catch (e: any) {
    console.warn('[resolver] removed_attendees 조회 예외:', e?.message ?? String(e))
    // 조회 실패해도 최소한 이메일 주소는 반환 (알림 자체는 발송되어야 함)
    return clean.map(email => ({ email, name: '', user_id: '', dept: '', avatar_url: null }))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 공개 API — resolveRecipients (단일 진입점)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이벤트의 RecipientRule에 따라 필요한 수신자 정보만 병렬 조회
 *
 * 조회 규칙:
 *   · booker_only              → booker만
 *   · booker_and_attendees     → booker + attendees (예약자 제외)
 *   · admins_only              → admins만
 *   · booker_attendees_admins  → booker + attendees + admins (모두 예약자 제외)
 *   · removed_attendees        → removedEmails 기반 조회 (booker/attendees/admins 모두 비움)
 *
 * 최적화:
 *   · 불필요한 쿼리는 실행하지 않음 (예: admins_only일 때 attendees 조회 안 함)
 *   · 필요한 쿼리는 Promise.all로 병렬 실행
 *
 * 실패 정책:
 *   · 개별 조회 실패 시 해당 필드만 비어있음 (booker=null, attendees=[])
 *   · throw 하지 않음 — 상위 호출(이메일/인앱 발송)은 계속 진행되어야 함
 */
export async function resolveRecipients(
  supabase: SupabaseClient,
  input: ResolveInput,
): Promise<ResolvedRecipients> {
  const { rule, bookerUserId, bookingId, removedEmails } = input

  // 기본값
  const result: ResolvedRecipients = {
    booker:           null,
    attendees:        [],
    admins:           [],
    removedAttendees: [],
  }

  // removed_attendees는 완전 별도 경로
  if (rule === 'removed_attendees') {
    result.removedAttendees = await fetchRemovedAttendees(supabase, removedEmails ?? [])
    return result
  }

  // 규칙별 필요한 조회 플래그
  const needBooker    = rule === 'booker_only' || rule === 'booker_and_attendees' || rule === 'booker_attendees_admins'
  const needAttendees = rule === 'booker_and_attendees' || rule === 'booker_attendees_admins'
  const needAdmins    = rule === 'admins_only' || rule === 'booker_attendees_admins'

  // 1차 병렬: booker + admins (attendees는 booker.email이 필요하므로 2차에서)
  const [booker, admins] = await Promise.all([
    needBooker ? fetchBooker(supabase, bookerUserId ?? '') : Promise.resolve(null),
    needAdmins ? fetchAdmins(supabase, bookerUserId) : Promise.resolve([]),
  ])

  result.booker = booker
  result.admins = admins

  // 2차: attendees (예약자 이메일 제외)
  if (needAttendees && bookingId) {
    const excludeEmail = booker?.email ?? undefined
    result.attendees = await fetchAttendees(supabase, bookingId, excludeEmail)
  }

  return result
}
