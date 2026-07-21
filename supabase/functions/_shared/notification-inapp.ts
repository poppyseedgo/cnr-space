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

  // ── 도서관 전용 (← [2026-07-20]) ──────────────────────────────────────
  //   도서 알림은 회의실/시작시각 개념이 없어 위 필드로는 본문을 만들 수 없다.
  //   아래 필드가 있으면 buildInAppBody가 도서 포맷으로 렌더한다.
  book_title?:   string          // 도서명
  due_date_kst?: string          // 반납예정일 (KST 'YYYY-MM-DD')
  days_overdue?: number          // 연체 일수 (book_overdue 전용)

  // ── 연체 제재 전용 (← [2026-07-21]) ──────────────────────────────────
  //   제재 알림은 반납기한이 아니라 "제한 기간" 을 알려야 한다.
  //   penalty_tier 가 있으면 buildInAppBody 가 제재 포맷으로 렌더한다.
  penalty_tier?:       '7d' | '30d' | 'permanent'
  penalty_until_kst?:  string    // 해제 예정일 (KST 'YYYY-MM-DD'). 영구면 없음
  penalty_over_days?:  number    // 기준일 초과 일수 (due_at 초과 일수가 아님)
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
 * ← [2026-07-20] 이미 KST로 계산된 'YYYY-MM-DD' → '7월 27일(월)'
 *
 * new Date(ymd) 로 파싱하면 UTC 자정이 되고, 이 파일의 다른 헬퍼처럼 +9h 를
 * 더하면 "이미 KST인 값에 KST 오프셋 재적용"이라 경계에서 하루가 밀 수 있다.
 * 문자열을 파싱하지 않고 분해해서 쓴다. (요일만 UTC 기준으로 계산 — 오프셋 무관)
 */
function fmtDueShortKo(ymd: string | undefined | null): string {
  if (!ymd) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd))
  if (!m) return String(ymd)
  const [, y, mo, d] = m
  const days = ['일','월','화','수','목','금','토']
  const dow = days[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()]
  return `${+mo}월 ${+d}일(${dow})`
}

/**
 * 인앱 알림 body 문자열 생성 (일관 포맷)
 *
 * 예시:
 *   · booker/attendee: "주간 회의 · 2F Emerald · 2026년 4월 22일 오후 2:00"
 *   · admin:           "주간 회의 · 2F Emerald · 신청자: 송보람 · 2026년 4월 22일 오후 2:00"
 */
export function buildInAppBody(booking: InAppBookingData, role: 'booker' | 'attendee' | 'admin'): string {
  // ── 도서관 알림 분기 (← [2026-07-20]) ────────────────────────────────────
  //   도서 알림에는 회의실/시작시각이 없으므로 회의실 포맷을 그대로 쓰면
  //   "제목 · · " 처럼 빈 구분자만 남는다. 도서 전용 포맷으로 렌더한다.
  //     · 대여/연장/D-1/당일: "도서명 · 7월 27일(월) 이내 반납"
  //     · 연체:               "도서명 · 3일 연체 (7월 20일(월) 마감)"
  //   ← [2026-07-20] 반납일은 "그 날 반납"이 아니라 "7일 이내 반납"이 정책이라
  //     시점 표기를 기한 표기로 바꿨다. 프론트 utils/bookLoan.ts 와 동일 문구.
  //   날짜는 due_date_kst(이미 KST로 계산된 문자열)를 그대로 쓴다.
  //   여기서 재변환하면 타임존 이중 적용으로 날짜가 밀릴 수 있다.
  //   ← [2026-07-21] book_started(대여 시작일 도래)도 book_title 을 실어 보내므로
  //     이 분기를 그대로 탄다. 본문은 "도서명 · 반납기한 …" 으로 동일하고,
  //     "오늘부터 시작" 문구는 제목/배너(notification-types)가 담당한다.
  // ── 연체 제재 분기 (← [2026-07-21]) ──────────────────────────────────────
  //   아래 도서 분기보다 먼저 검사한다. 제재 알림도 book_title 을 싣기 때문에
  //   순서가 바뀌면 "도서명 · 7월 28일 이내 반납" 이라는 엉뚱한 본문이 나간다.
  //   (이미 반납한 건이라 반납기한 안내는 의미가 없다)
  if (booking.penalty_tier) {
    const name  = booking.book_title ?? ''
    const until = booking.penalty_until_kst
      ? fmtDueShortKo(booking.penalty_until_kst)
      : ''
    const label =
      booking.penalty_tier === 'permanent' ? '영구 대여 제한'
      : booking.penalty_tier === '30d'     ? '30일 대여 제한'
      :                                      '7일 대여 제한'

    // 해제 알림은 until 이 없다(이미 풀렸다) → 라벨 없이 해제 사실만 전한다
    const head = name ? `${name} · ` : ''
    if (!until) return `${head}${label}`
    return `${head}${label} · ${until}까지`
  }

  if (booking.book_title) {
    const name = booking.book_title
    const due  = booking.due_date_kst ?? ''
    const od   = booking.days_overdue ?? 0

    const dueShort = fmtDueShortKo(due)
    if (od > 0) {
      const tail = dueShort ? ` (${dueShort} 마감)` : ''
      return `${name} · ${od}일 연체${tail}`
    }
    return dueShort ? `${name} · ${dueShort} 이내 반납` : name
  }

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
