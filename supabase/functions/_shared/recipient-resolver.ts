// @ts-nocheck
/**
 * _shared/recipient-resolver.ts
 * ← [2026-09-30 5-B] 규칙 'wb_recipients' — DB wb_notification_recipients (Work Space 5종, admins 슬롯)
 * ← [2026-09-30 5-A] 관리자 수신자 해석을 DB RPC(notification_resolve_recipients)로 일원화 — 임베드 4함수 제거, Person 에 채널 플래그
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
 * [2026-07-20] book_borrower 규칙 구현 (도서관 알림 5종 수신자 해석)
 *   · ResolvedRecipients.bookBorrower / ResolveInput.borrowerUserId 추가
 *   · 기존에 send-notification 이 recipients.bookBorrower 를 참조했으나
 *     resolver 에 구현이 없어 항상 undefined → 도서 알림 이메일·인앱 전부 무발송
 *
 * [2026-06-12] former_booker 규칙 추가 (예약자 변경 시 원래 예약자 알림)
 *   · ResolvedRecipients.formerBooker / ResolveInput.formerBookerUserId 추가
 *   · former_booker 규칙은 별도 경로 — fetchBooker 재사용해 원래 예약자 1명 해석
 *
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
  // ← [2026-09-30 5-A] 사용자별 알림 설정(notification_user_prefs) — 관리자 수신자에만 채워진다. undefined = 켜짐
  email_enabled?: boolean
  inapp_enabled?: boolean
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
  // ← [2026-06-12] former_booker 규칙일 때만. 원래(이전) 예약자 1명.
  formerBooker: Person | null
  // ← [2026-07-20] book_borrower 규칙일 때만. 도서 대여자 본인 1명.
  //   send-notification / notification-types 는 이 필드를 이미 참조하고 있었으나
  //   resolver 에 구현이 없어 항상 undefined 였다 → 도서 알림 전 5종이 무발송이었음.
  bookBorrower: Person | null

  // ← [2026-07-20] 예약/대여의 **주체**. 수신자 규칙과 무관하게 항상 해석된다.
  //
  //   왜 booker 와 별도로 두는가:
  //     booker 는 "booker_* 규칙일 때 메일을 받는 사람"이다. 즉 수신자 개념이다.
  //     그런데 메일 **본문**의 예약자/대여자 행은 "누가 받는가"가 아니라
  //     "이 예약·대여의 주인이 누구인가"를 보여주는 자리다. 두 개는 다른 개념인데
  //     send-notification 이 본문 정보를 recipients.booker 에서 가져오고 있었다.
  //     → booker 를 조회하지 않는 규칙(admins_only / former_booker /
  //       removed_attendees / book_borrower)에서는 본문 사용자 행이 통째로 비어
  //       아바타가 "?" 로 렌더됐다. 23종 중 11종이 해당.
  //
  //   owner 는 항상 bookerUserId(= booking.user_id)로 해석하므로 규칙과 무관하다.
  owner: Person | null
}

/** resolveRecipients 입력 */
export interface ResolveInput {
  rule:          RecipientRule
  bookerUserId?: string              // booker 조회 + attendees/admins에서 예약자 제외용
  bookingId?:    string              // attendees 조회용 (booking_attendees 테이블)
  removedEmails?: string[]           // removed_attendees 규칙 시 외부 주입
  // ← [2026-06-12] former_booker 규칙 시 원래 예약자 user_id 외부 주입
  formerBookerUserId?: string
  // ← [2026-07-20] book_borrower 규칙 시 도서 대여자 user_id 외부 주입
  borrowerUserId?: string
  /**
   * ← [2026-07-23] 알림 타입. 관리자 수신자 '지정 명단'(notification_recipients)을
   *   조회하는 데 쓴다. 넘기지 않으면 지정 명단을 무시하고 기존 규칙대로 동작한다.
   */
  notificationType?: string
  /** ← [2026-09-30 5-B] wb_recipients 전용 — DB wb_notification_recipients 인자. actor 는 본인 제외, added 는 task_assigned 의 신규 담당자 */
  wbTargetType?: 'task' | 'issue' | 'user'
  wbTargetId?:   string
  wbActorId?:    string
  wbAddedIds?:   string[]
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
/**
 * ← [2026-09-30 5-A] 관리자 수신자 해석 — DB 함수 notification_resolve_recipients(p_type, p_exclude) 가 유일한 경로.
 *
 *   이전(fetchAdmins / fetchBookAdmins / fetchResourceAdmins / fetchDesignatedRecipients)은 PostgREST 임베드
 *   `profiles!inner(...)` 에 의존했는데 운영 스키마에 그 FK 가 없어(notification_recipients FK 없음,
 *   admin_roles.user_id → auth.users) 항상 실패 → profiles.role='ADMIN' 전원 폴백으로 떨어졌다
 *   (2026-09-30 실측: 함수 로그 "Could not find a relationship between 'notification_recipients' and 'profiles'").
 *   규칙(자격 = 명시 모듈 권한 · 지정 ∩ 자격 · 폴백 없음 · 개인 채널 플래그)은 20261003 SQL 이 SSOT.
 *   조회 실패 시 빈 배열 — "누구에게 갈지 모르면 안 보낸다"(폴백 폐지, 고지 확정). 로그에 no_recipient 로 남는다.
 */
async function fetchEntitledAdmins(supabase: SupabaseClient, type?: string, excludeUserId?: string): Promise<Person[]> {
  if (!type) return []
  try {
    const { data, error } = await supabase.rpc('notification_resolve_recipients', { p_type: type, p_exclude: excludeUserId ?? null })
    if (error) { console.warn('[resolver] notification_resolve_recipients 실패:', error.message); return [] }
    return ((data ?? []) as any[])
      .map(r => ({
        user_id: r.user_id, email: r.email ?? '', name: r.name ?? '', dept: r.dept ?? '', avatar_url: r.avatar_url ?? null,
        email_enabled: r.email_enabled !== false, inapp_enabled: r.inapp_enabled !== false,
      }))
      .filter(p => p.email || p.user_id)
  } catch (e: any) {
    console.warn('[resolver] notification_resolve_recipients 예외:', e?.message ?? String(e))
    return []
  }
}

/**
 * ← [2026-09-30 5-B] Work Space 수신자 — DB wb_notification_recipients(p_type, p_target_type, p_target_id, p_actor, p_added).
 *   내부적으로 notification_resolve_recipients(자격 workboard ∩ 지정 · 개인 채널 플래그 · 행위자 제외) ∩ 타입별 대상.
 *   실패 시 빈 배열(fail-closed) — 로그에 no_recipient 로 남는다.
 */
async function fetchWbRecipients(supabase: SupabaseClient, input: ResolveInput): Promise<Person[]> {
  const { notificationType, wbTargetType, wbTargetId, wbActorId, wbAddedIds } = input
  if (!notificationType || !wbTargetType || !wbTargetId) {
    console.warn('[resolver] wb_recipients 인자 부족:', { notificationType, wbTargetType, wbTargetId })
    return []
  }
  try {
    const { data, error } = await supabase.rpc('wb_notification_recipients', {
      p_type: notificationType, p_target_type: wbTargetType, p_target_id: wbTargetId,
      p_actor: wbActorId ?? null, p_added: wbAddedIds ?? null,
    })
    if (error) { console.warn('[resolver] wb_notification_recipients 실패:', error.message); return [] }
    return ((data ?? []) as any[])
      .map(r => ({
        user_id: r.user_id, email: r.email ?? '', name: r.name ?? '', dept: r.dept ?? '', avatar_url: r.avatar_url ?? null,
        email_enabled: r.email_enabled !== false, inapp_enabled: r.inapp_enabled !== false,
      }))
      .filter(p => p.email || p.user_id)
  } catch (e: any) {
    console.warn('[resolver] wb_notification_recipients 예외:', e?.message ?? String(e))
    return []
  }
}

// [2026-09-30 5-A] 제거된 함수 4종 — fetchAdmins / fetchDesignatedRecipients / fetchBookAdmins / fetchResourceAdmins
//   (지정 명단·도서/자원 담당·ADMIN 폴백 규칙은 전부 DB notification_resolve_recipients 로 이동. 위 fetchEntitledAdmins 주석 참조)

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

    const attendeesRaw = (rawAttendees ?? [])
      .map((a: any) => ({ email: a.email ?? '', name: a.name ?? '' }))
      .filter((a: any) => a.email && a.email !== excludeEmail)

    // ← [2026-04-29] email 기준 dedupe 추가 (메일 폭탄 즉시 차단)
    //   배경: booking_attendees 테이블에 (booking_id, email) 중복 행 누적 시
    //         · 메일 본문에 동일 인물 N번 표시
    //         · 같은 사람에게 메일 N번 발송 (수신자 목록 중복)
    //         · 인앱 알림 N번 INSERT
    //   처리: email 정규화 trim().toLowerCase() 기준 첫 등장만 유지
    //         (DB 데이터는 보존, 메일/알림 출력 단에서만 dedupe)
    //   효과: 1곳 수정으로 send-notification의 모든 메일 + 인앱 알림 동시 차단
    const seen = new Set<string>()
    const attendees = attendeesRaw.filter((a: any) => {
      const key = a.email.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

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
  const { rule, bookerUserId, bookingId, removedEmails, formerBookerUserId, borrowerUserId,
          notificationType } = input

  // 기본값
  const result: ResolvedRecipients = {
    booker:           null,
    attendees:        [],
    admins:           [],
    removedAttendees: [],
    formerBooker:     null,   // ← [2026-06-12]
    bookBorrower:     null,   // ← [2026-07-20]
    owner:            null,   // ← [2026-07-20] 본문 표시용 주체 (규칙 무관)
  }

  // ← [2026-07-20] 주체 해석 — 모든 규칙에서 동일하게 수행한다.
  //   도서 알림은 borrowerUserId 가 주체, 회의 알림은 bookerUserId 가 주체다.
  //   (send-notification 은 양쪽에 booking.user_id 를 넣어 보내므로 사실상 동일)
  const ownerUserId = borrowerUserId || bookerUserId || ''

  // ← [2026-09-30 5-B] Work Space — admins 슬롯에 담는다 (book_admins 와 같은 이유: 이메일·인앱 'admin' 렌더 분기 재사용).
  //   owner 는 행위자(배정자·댓글 작성자·등록자·처리자) — 본문의 사람 행은 wb 컨텍스트가 그리므로 참고용.
  if (rule === 'wb_recipients') {
    const [admins, actor] = await Promise.all([
      fetchWbRecipients(supabase, input),
      fetchBooker(supabase, input.wbActorId ?? ''),
    ])
    result.admins = admins
    result.owner  = actor
    return result
  }

  // removed_attendees는 완전 별도 경로
  if (rule === 'removed_attendees') {
    const [removed, owner] = await Promise.all([
      fetchRemovedAttendees(supabase, removedEmails ?? []),
      fetchBooker(supabase, ownerUserId),
    ])
    result.removedAttendees = removed
    result.owner = owner
    return result
  }

  // ← [2026-06-12] former_booker는 완전 별도 경로 — 원래 예약자 1명만 조회
  //   fetchBooker 재사용 (profiles에서 id로 단건 조회). 퇴사/삭제 시 null → 발송 스킵.
  if (rule === 'former_booker') {
    const [former, owner] = await Promise.all([
      fetchBooker(supabase, formerBookerUserId ?? ''),
      fetchBooker(supabase, ownerUserId),
    ])
    result.formerBooker = former
    result.owner = owner
    return result
  }

  // ← [2026-07-20] book_borrower 도 완전 별도 경로 — 도서 대여자 1명만 조회
  //   도서 알림에는 참석자/관리자 개념이 없으므로 attendees/admins 조회를 하지 않는다.
  //   borrowerUserId 가 비어 있으면 bookerUserId 로 폴백한다
  //   (send-notification 은 booking.user_id 를 양쪽에 모두 넘기므로 안전망).
  if (rule === 'book_borrower') {
    result.bookBorrower = await fetchBooker(supabase, ownerUserId)
    // 도서 알림은 수신자 == 주체다. 같은 사람이므로 재조회하지 않는다.
    result.owner = result.bookBorrower
    return result
  }

  // ← [2026-08-19 Phase 4] resource_owner — 자원 예약자 본인 1명 (book_borrower 동일 해석)
  if (rule === 'resource_owner') {
    result.booker = await fetchBooker(supabase, ownerUserId)
    result.owner  = result.booker
    return result
  }

  // ← [2026-08-19 Phase 4] resource_admins_and_owner — 연체 전용: 예약자 + 자원 담당 관리자.
  //   admins 필드에 담는 이유는 book_admins 와 동일(이메일·인앱 렌더 분기 재사용).
  //   지정 명단이 있으면 '관리자 집합만' 대체 — 예약자는 당사자라 항상 수신한다.
  if (rule === 'resource_admins_and_owner') {
    const [admins, owner] = await Promise.all([
      fetchEntitledAdmins(supabase, notificationType, ownerUserId),   // ← [5-A] RPC (지정 ∩ 자격 · 예약자 제외)
      fetchBooker(supabase, ownerUserId),
    ])
    result.admins = admins
    result.booker = owner
    result.owner  = owner
    return result
  }

  // ← [2026-07-23] book_admins — 도서 담당 관리자에게만.
  //   결과를 result.admins 에 담는 이유: send-notification 의 이메일/인앱
  //   '관리자' 분기가 이미 이 필드를 role='admin' 으로 렌더한다.
  //   새 수신자 배열을 만들면 렌더 분기를 양쪽에 복제해야 하고, 한쪽만
  //   고치는 순간 "인앱은 오는데 메일은 안 오는" 결함이 생긴다.
  //   owner(대여자)는 별도로 해석한다 — 본문의 '대여자' 행과 인앱 본문에 쓰인다.
  if (rule === 'book_admins') {
    // ← [2026-07-23] 지정 명단이 있으면 그것이 우선. 없을 때만 도서 담당 권한으로 해석한다.
    const [admins, owner] = await Promise.all([
      fetchEntitledAdmins(supabase, notificationType, ownerUserId),   // ← [5-A] RPC
      fetchBooker(supabase, ownerUserId),
    ])
    result.admins = admins
    result.owner  = owner
    return result
  }

  // 규칙별 필요한 조회 플래그
  const needBooker    = rule === 'booker_only' || rule === 'booker_and_attendees' || rule === 'booker_attendees_admins'
  const needAttendees = rule === 'booker_and_attendees' || rule === 'booker_attendees_admins'
  const needAdmins    = rule === 'admins_only' || rule === 'booker_attendees_admins'

  // 1차 병렬: booker + admins (attendees는 booker.email이 필요하므로 2차에서)
  //   owner 는 booker 를 조회하는 규칙이면 같은 사람이라 재사용하고,
  //   아니면(admins_only) 별도로 한 번 조회한다.
  const [booker, admins, ownerOnly] = await Promise.all([
    needBooker ? fetchBooker(supabase, bookerUserId ?? '') : Promise.resolve(null),
    needAdmins ? fetchEntitledAdmins(supabase, notificationType, bookerUserId) : Promise.resolve([]),   // ← [5-A] RPC
    needBooker ? Promise.resolve(null) : fetchBooker(supabase, ownerUserId),
  ])

  result.booker = booker
  result.admins = admins
  result.owner  = booker ?? ownerOnly

  // ← [2026-07-23] 관리자 수신 규칙에 지정 명단이 있으면 대체한다.
  //   admins_only / booker_attendees_admins 둘 다 해당한다. 예약자·참석자 수신은
  //   지정 명단과 무관하게 그대로 유지한다 — 그들은 '당사자'이지 '관리자'가 아니다.
  // ← [5-A] 지정 명단 재적용 블록 제거 — fetchEntitledAdmins 가 이미 지정 ∩ 자격을 반환한다

  // 2차: attendees (예약자 이메일 제외)
  if (needAttendees && bookingId) {
    const excludeEmail = booker?.email ?? undefined
    result.attendees = await fetchAttendees(supabase, bookingId, excludeEmail)
  }

  return result
}
