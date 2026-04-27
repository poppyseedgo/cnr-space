/**
 * api.ts — Supabase 기반 데이터 레이어
 *
 * 버그 수정:
 *  1. UTC→KST 변환: Supabase는 timestamptz를 UTC로 반환 → +9h 보정 필요
 *  2. [2026-04-23] loadBookings/loadUsers/loadRooms: 일시 오류 재시도 로직 추가
 *     - 배경: 초기 로드 silent failure로 users 빈 배열 → 참석자 검색 안됨 (5명 문의)
 *     - 해결: Supabase 쿼리 블록을 withRetry로 감쌈 (3회, exponential backoff + jitter)
 *     - 호환: 3회 모두 실패 시 기존대로 [] 반환 (호출부 시그니처 유지, 회귀 0)
 *  3. [2026-04-24 P3-2] bookings.user_email 컬럼 저장/읽기 추가
 *     - 배경: 예약자 판정을 UUID OR email 이중 복원으로 확장 준비 (P3-3 선행 작업)
 *     - 원칙: "이름이 바뀌어도 부서가 바뀌어도 본인 예약으로 인식" (고지 2026-04-24)
 *     - 변경:
 *       · bookingToRow 시그니처: (b, userId) → (b, userId, userEmail='')
 *       · bookingToRow 저장 필드: user_email (빈 string → NULL)
 *       · rowToBooking: user_email 읽기 추가 → Booking.user_email
 *       · saveBookings / insertBooking: 두 호출부에서 user.email 전달
 *     - 호환: 헬퍼(isMyBooking) 변경 없음 — 기능 동작 완전 동일, P3-3에서 OR 판정 전환
 *     - 선행: P3-1 DB 마이그레이션 완료 (user_email 컬럼 + 백필 + 인덱스)
 *  4. [2026-04-25] loadBookings 조회 범위 정책 변경
 *     - 배경: 미래 +60일 컷오프로 인해 Admin이 그 이후로 만든 예약 / recurring 예약이
 *            캘린더 뷰에서 가려지는 정합성 버그 (DB에는 정상 저장됨)
 *     - 변경:
 *       · 과거: -7일 → -3개월 (지난 분기 데이터 조회 가능)
 *       · 미래: +60일 → 무제한 (.lte 조건 제거)
 *     - 영향: 시그니처/호출부 변경 없음 — App.tsx 5곳 호출 모두 그대로 동작
 *     - 부하: 9개 회의실 × 평균 3~5건/일 × 15개월 ≈ 1만~1.6만건, payload 수 MB —
 *            첫 로드 1회만이고 이후는 subscribeBookings Realtime incremental, 안전
 *     - 호환: rowToBooking + utcToKST 그대로 적용, CalendarShell/MyPage prop 영향 0
 */

import { supabase, isSupabaseEnabled } from './supabase'
import type { Booking, Room, AppUser, Feature, AttendeeRef } from '../types'

// ── UTC → KST 변환 ───────────────────────────────────────────────────────────
// Supabase가 UTC ISO 문자열로 반환하므로 앱 기준인 KST로 보정
// ← [2026-04-27] export 추가 — MyPage.tsx 자체 fetch에서도 동일 변환 필수
//   · 배경: MyPage가 api.ts를 우회하고 직접 supabase.from('bookings') 호출 → UTC 시각 그대로 표시되는 버그
//   · 동작 변경 0 — 단순 export 키워드만 추가
export function utcToKST(ts: string): string {
  if (!ts) return ts
  if (ts.includes('+09:00')) return ts  // 이미 KST면 패스
  const d  = new Date(ts)
  const k  = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth()+1)}-${pad(k.getUTCDate())}` +
         `T${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}+09:00`
}

// ── 재시도 헬퍼 ──────────────────────────────────────────────────────────────
// [2026-04-23 신규] 일시 네트워크 오류 / RLS 경합 / JWT 갱신 충돌 등 transient failure 자동 복구
//
// 재시도 간격: exponential backoff + jitter (Thundering herd 방지)
//   시도 1 실패 → 300ms × (0.5~1.5 지터) → 시도 2
//   시도 2 실패 → 600ms × (0.5~1.5 지터) → 시도 3
//   시도 3 실패 → throw (호출부 catch에서 빈 배열 반환)
//
// jitter가 필수인 이유: 동시에 여러 탭/사용자가 재시도하면 서버에 집중 요청이 몰릴 수 있음
//   (이전 Thundering herd 이슈 회피 — 50 simultaneous loadBookings 사례 참고)
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
  baseDelayMs = 300
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt < maxAttempts) {
        const base   = baseDelayMs * Math.pow(2, attempt - 1)
        const jitter = base * (0.5 + Math.random())  // 50%~150% 랜덤
        console.warn(`[api] ${label} 실패 (시도 ${attempt}/${maxAttempts}), ${Math.round(jitter)}ms 후 재시도:`, e)
        await new Promise(r => setTimeout(r, jitter))
      }
    }
  }
  // maxAttempts 소진 — 호출부가 catch로 처리 (기존 [] 반환 폴백 유지)
  throw lastErr
}

// ── DB row → Booking ─────────────────────────────────────────────────────────
function rowToBooking(row: Record<string, any>): Booking {
  return {
    id:            row.id,
    room_id:       row.room_id,
    title:         row.title,
    memo:          row.memo ?? '',
    attendees:     [],                         // loadBookings에서 booking_attendees join으로 채움
    start_at:      utcToKST(row.start_at),
    end_at:        utcToKST(row.end_at),
    user:          row.user_name,
    user_id:       row.user_id ?? undefined,   // 예약자 UUID — avatar 역조회용
    user_email:    row.user_email ?? undefined,  // ← [2026-04-24 P3-2] 예약자 이메일 — isBooker OR 조건 판정용
    dept:          row.user_dept,
    checkedIn:     row.checked_in,
    autoCancelled: row.auto_cancelled,
    cancelledBy:   row.cancelled_by ?? null,
    status:        row.status ?? 'confirmed',
    reject_reason: row.reject_reason ?? null,
    processedByName:   row.processed_by_name ?? null,
    processedByAvatar: row.processed_by_avatar ?? null,
    earlyEnded:    row.early_ended ?? false,
    // ← [2026-04-22 HOTFIX] originalEndAt도 KST 변환 필수 (기존 UTC 그대로 → 조기반납 시 취소선 표기 시각 오류)
    //   start_at/end_at과 동일 패턴. null이면 null 유지.
    originalEndAt: row.original_end_at ? utcToKST(row.original_end_at) : null,
    recurGroupId:  row.recur_group_id ?? null,
    createdAt:     new Date(row.created_at).getTime(),
  }
}

// ── Booking → DB row ─────────────────────────────────────────────────────────
// ← [2026-04-24 P3-2] 시그니처 확장: userEmail 파라미터 추가
//   · 목적: bookings.user_email 컬럼에 예약자 이메일 저장 — isBooker OR 조건 판정용
//   · 호출부(saveBookings/insertBooking)는 supabase.auth.getUser()의 user.email을 전달
//   · 빈 string은 허용(로그인 세션 없는 엣지 케이스) — DB NULL 허용 상태이므로 안전
function bookingToRow(b: Booking, userId: string, userEmail: string = '') {
  return {
    id:             b.id,
    room_id:        b.room_id,
    title:          b.title,
    memo:           b.memo ?? '',
    // attendees는 booking_attendees 테이블로 분리 (별도 upsert)
    start_at:       b.start_at,  // +09:00 포함 → Supabase가 UTC로 저장
    end_at:         b.end_at,
    user_id:        userId,
    user_email:     userEmail || null,  // ← [2026-04-24 P3-2] 빈 string은 NULL로 저장 (인덱스 WHERE IS NOT NULL 조건 준수)
    user_name:      b.user,
    user_dept:      b.dept,
    checked_in:     b.checkedIn,
    auto_cancelled: b.autoCancelled,
    cancelled_by:   b.cancelledBy ?? null,
    early_ended:    b.earlyEnded ?? false,
    original_end_at: b.originalEndAt ?? null,
    recur_group_id: b.recurGroupId ?? null,
    status:         b.status ?? 'confirmed',
  }
}

// ── 전체 조회 (날짜 범위 필터링) ─────────────────────────────────────────────
// [2026-04-25] 정책: 과거 3개월 ~ 미래 무제한
//   · 과거: -3개월 (지난 분기 통계/조회 지원, 7일은 너무 짧음)
//   · 미래: 무제한 (Admin/recurring이 만든 모든 미래 예약을 캘린더에서 노출)
export async function loadBookings(): Promise<Booking[]> {
  if (!isSupabaseEnabled) return localGetBookings()
  try {
    const from = new Date()
    from.setMonth(from.getMonth() - 3)   // ← [2026-04-25] -7일 → -3개월
    // ← [2026-04-25] 미래 컷오프 제거: 기존 const to = +60일 + .lte('start_at', to) 삭제

    // bookings + booking_attendees join 조회
    // bookings.attendees JSONB는 신규 예약에 저장 안 됨 → booking_attendees 테이블이 정본
    // ← [2026-04-23] withRetry: 일시 오류 시 최대 3회 재시도 (exponential backoff + jitter)
    const data = await withRetry(async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('*, booking_attendees(email, name)')
        .gte('start_at', from.toISOString())   // ← [2026-04-25] 미래 .lte 조건 제거됨 (무제한)
        .order('start_at', { ascending: true })
      if (error) throw error
      return data
    }, 'loadBookings')

    return (data ?? []).map(row => {
      const parsed = rowToBooking(row)
      // booking_attendees 테이블에서 attendees 파싱 (email이 유일 키)
      parsed.attendees = (row.booking_attendees ?? [])
        .map((a: any): AttendeeRef => ({ email: a.email ?? '', name: a.name ?? '' }))
        .filter((a: AttendeeRef) => a.email || a.name)
      return parsed
    })
  } catch (e) {
    // ← [2026-04-23] 재시도 3회 모두 실패 시 도달 — 기존대로 빈 배열 반환 (호환성 유지)
    console.error('[api] loadBookings 최종 실패 (3회 재시도 소진 → 빈 배열 반환):', e)
    return []
  }
}

// ── 기간별 예약 조회 (Admin Dashboard 전용) ───────────────────────────────────
// Supabase Pro PITR 기준 전체 기간 조회 가능, 날짜 범위는 KST 기준
export async function loadBookingsByRange(from: string, to: string): Promise<Booking[]> {
  if (!isSupabaseEnabled) return []
  try {
    const fromISO = new Date(from + 'T00:00:00+09:00').toISOString()
    const toISO   = new Date(to   + 'T23:59:59+09:00').toISOString()
    const { data, error } = await supabase
      .from('bookings')
      .select('*, booking_attendees(email, name)')
      .gte('start_at', fromISO)
      .lte('start_at', toISO)
      .order('start_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(row => {
      const b = rowToBooking(row)
      b.attendees = (row.booking_attendees ?? [])
        .map((a: any): AttendeeRef => ({ email: a.email ?? '', name: a.name ?? '' }))
        .filter((a: AttendeeRef) => a.email || a.name)
      return b
    })
  } catch (e) {
    console.error('[api] loadBookingsByRange 실패:', e)
    return []
  }
}

// ── saveBookings (하위 호환) ──────────────────────────────────────────────────
export async function saveBookings(bookings: Booking[]): Promise<void> {
  if (!isSupabaseEnabled) { localSaveBookings(bookings); return }
  const { data: { user } } = await supabase.auth.getUser()
  // ← [2026-04-24 P3-2] user.email도 함께 전달 — bookings.user_email 컬럼에 저장
  const rows = bookings.map(b => bookingToRow(b, user?.id ?? '', user?.email ?? ''))
  const { error } = await supabase.from('bookings').upsert(rows, { onConflict: 'id' })
  if (error) console.error('[api] saveBookings 오류:', error)
}

// ── 단건 생성 ────────────────────────────────────────────────────────────────
export async function insertBooking(booking: Booking): Promise<Booking> {
  if (!isSupabaseEnabled) {
    localSaveBookings([...localGetBookings(), booking])
    return booking
  }
  const { data: { user } } = await supabase.auth.getUser()

  // 서버사이드 충돌 검사
  const { data: conflict } = await supabase.rpc('check_booking_conflict', {
    p_room_id: booking.room_id, p_start_at: booking.start_at,
    p_end_at:  booking.end_at,  p_exclude_id: null,
  })
  if (conflict) throw new Error('해당 시간에 이미 예약이 있습니다.')

  const { data, error } = await supabase
    // ← [2026-04-24 P3-2] user.email도 함께 전달 — bookings.user_email 컬럼에 저장 (isBooker OR 판정용)
    .from('bookings').insert(bookingToRow(booking, user?.id ?? '', user?.email ?? '')).select().single()

  if (error) {
    // DB Exclusion Constraint 위반 (23P01) — 동시 요청으로 인한 더블부킹 차단
    if (error.code === '23P01' || error.message.includes('exclusion')) {
      throw new Error('해당 시간에 이미 예약이 있습니다. 다른 시간을 선택해 주세요.')
    }
    // 기타 DB 오류
    throw new Error('예약 저장 중 오류가 발생했습니다. 다시 시도해 주세요.')
  }
  const saved = rowToBooking(data)
  // attendees → booking_attendees 테이블에 저장
  if (booking.attendees && booking.attendees.length > 0) {
    await upsertBookingAttendees(saved.id, booking.attendees)
  }
  return saved
}

// ── booking_attendees 저장 (예약 생성/수정 시 호출) ────────────────────────
export async function upsertBookingAttendees(
  bookingId: string,
  attendees: { email?: string; name?: string }[]
): Promise<void> {
  await supabase.from('booking_attendees').delete().eq('booking_id', bookingId)
  if (!attendees || attendees.length === 0) return
  const rows = attendees
    .map(a => ({
      booking_id: bookingId,
      email: a.email ?? '',
      name:  a.name  ?? '',
    }))
    .filter(r => r.email || r.name)
  if (rows.length === 0) return
  const { error } = await supabase.from('booking_attendees').insert(rows)
  if (error) console.warn('[api] booking_attendees 저장 실패:', error.message)
}

// ── 현재 참석자 이메일 목록 조회 (업데이트 전 diff 계산용) ─────────────────
export async function getBookingAttendees(bookingId: string): Promise<string[]> {
  if (!isSupabaseEnabled || !bookingId) return []
  const { data, error } = await supabase
    .from('booking_attendees')
    .select('email')
    .eq('booking_id', bookingId)
  if (error) return []
  return (data ?? []).map(r => r.email).filter(Boolean)
}

// ── 단건 수정 ────────────────────────────────────────────────────────────────
export async function updateBooking(
  id: string, changes: Partial<Booking>
): Promise<Booking | null> {
  if (!isSupabaseEnabled) {
    const all = localGetBookings()
    const updated = all.map(b => b.id === id ? { ...b, ...changes } : b)
    localSaveBookings(updated)
    return updated.find(b => b.id === id) ?? null
  }

  const dbChanges: Record<string, any> = {}
  if (changes.checkedIn     !== undefined) dbChanges.checked_in     = changes.checkedIn
  if (changes.autoCancelled !== undefined) dbChanges.auto_cancelled = changes.autoCancelled
  if (changes.cancelledBy    !== undefined) dbChanges.cancelled_by   = changes.cancelledBy
  if (changes.status         !== undefined) dbChanges.status          = changes.status
  if (changes.earlyEnded    !== undefined) dbChanges.early_ended    = changes.earlyEnded
  if (changes.originalEndAt !== undefined) dbChanges.original_end_at = changes.originalEndAt
  if (changes.end_at        !== undefined) dbChanges.end_at         = changes.end_at
  if (changes.title         !== undefined) dbChanges.title          = changes.title
  if (changes.memo          !== undefined) dbChanges.memo           = changes.memo
  // attendees는 booking_attendees 테이블로 분리 — upsertBookingAttendees 별도 호출
  if (changes.start_at      !== undefined) dbChanges.start_at       = changes.start_at
  if (changes.room_id       !== undefined) dbChanges.room_id        = changes.room_id
  // ↑ DB 컬럼과 매핑되는 필드만 명시적으로 포함
  // user_employee_id, createdAt 등 프론트 전용 필드는 제외됨

  const { data, error } = await supabase
    .from('bookings').update(dbChanges).eq('id', id).select()

  if (error) {
    // 400 Bad Request 상세 로그
    console.error('[api] updateBooking 오류:', error.message, '| dbChanges:', JSON.stringify(dbChanges))
    throw new Error(error.message)
  }

  // data가 빈 배열 → RLS 차단
  // 두 경우 모두 UI는 낙관적 업데이트 상태 유지, 조용히 null 반환
  if (!data || data.length === 0) {
    console.warn('[api] updateBooking: 업데이트 0행 (RLS 차단), id=', id)
    return null
  }
  return rowToBooking(data[0])
}

/** 관리자 강제 취소 — cancelled_by: 'admin' 으로 저장해 일반 취소·노쇼와 구분 */
// ← [2026-04-23 HOTFIX] status: 'cancelled' 추가
//   증상: 관리자 강제 취소된 예약이 캘린더 뷰에 표시됨
//   원인: status='confirmed' 유지된 채 auto_cancelled=true만 저장 → 활성 예약으로 오인
//   해결: status='cancelled' 명시 저장으로 isShownInCalendar의 status 기반 필터가 정확히 작동
//   주의: auto_cancelled=true는 유지 (isAdminCancel 판정 플래그 그대로 사용)
export async function adminForceCancel(id: string): Promise<void> {
  await updateBooking(id, { status: 'cancelled', autoCancelled: true, cancelledBy: 'admin' })
}

// ── 취소 ─────────────────────────────────────────────────────────────────────
// ── 취소 ─────────────────────────────────────────────────────────────────────
// ← [2026-04-23 HOTFIX Phase 3] status: 'cancelled' 추가
//   증상: 사용자가 취소한 예약이 캘린더 뷰에 표시됨
//   원인: status='confirmed' 유지된 채 auto_cancelled=true만 저장 → 활성 예약으로 오인
//   해결: status='cancelled' 명시 저장으로 isShownInCalendar의 status 기반 필터가 정확히 작동
//   주의: auto_cancelled=true는 유지 (isUserCancel 판정 플래그 그대로 사용, 뱃지 정상 표시)
//   연관: Phase 2 adminForceCancel과 동일 패턴
export async function cancelBooking(id: string): Promise<void> {
  await updateBooking(id, { status: 'cancelled', autoCancelled: true, cancelledBy: 'user' })
}

/**
 * 노쇼 자동 감지 — cancelled_by='system'으로 기록
 *
 * ← [2026-04-22 v3] 기존 cancelBooking이 'user'로만 기록되어
 *    프론트 useEffect 노쇼 감지 시 cancelled_by='user' 오염 발생.
 *    노쇼는 시스템 자동 처리이므로 'system'으로 명확히 분리.
 *
 * 흐름:
 *   프론트(즉시) → markNoshow → DB에 system 기록 → 모든 클라이언트 즉시 노쇼 뱃지 표시
 *   cron(최대 5분) → noshow_notified=false인 건 조회 → 이메일 발송 → noshow_notified=true 마킹
 */
export async function markNoshow(id: string): Promise<void> {
  await updateBooking(id, { autoCancelled: true, cancelledBy: 'system' })
}

// ── Realtime 구독 ────────────────────────────────────────────────────────────
export function subscribeBookings(onUpdate: () => void) {
  if (!isSupabaseEnabled) return () => {}
  const channel = supabase
    .channel('bookings-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => onUpdate())
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ── localStorage fallback ────────────────────────────────────────────────────
const LS_KEY = 'cnr-bookings-v1'
function localGetBookings(): Booking[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') } catch { return [] }
}
function localSaveBookings(bookings: Booking[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(bookings))
}

// ── rooms 테이블 전체 로드 (Supabase) ────────────────────────────────────────
/** Admin 전용: is_active 필터 없이 전체 회의실 로드 */
export async function loadAllRooms(): Promise<Room[]> {
  try {
    const [roomsRes, roomFeaturesRes] = await Promise.all([
      supabase.from('rooms').select('*').order('room_id'),
      supabase.from('room_features').select('*, features(*)'),
    ])
    if (roomsRes.error) throw roomsRes.error

    const rfMap = new Map<number, Feature[]>()
    for (const rf of roomFeaturesRes.data ?? []) {
      const f = rf.features as any
      if (!f) continue
      if (!rfMap.has(rf.room_id)) rfMap.set(rf.room_id, [])
      rfMap.get(rf.room_id)!.push({ feature_id: f.feature_id, feature_key: f.feature_key, feature_name: f.feature_name })
    }
    return (roomsRes.data ?? []).map(row => ({
      room_id:      row.room_id,
      floor_id:     row.floor_id      ?? 1,
      room_code:    row.room_code     ?? '',
      room_name:    row.room_name     ?? '',
      room_name_ko: row.room_name_ko  ?? '',
      capacity:     row.capacity      ?? 4,
      notes:        row.notes         ?? '',
      is_active:    row.is_active     ?? true,
      is_admin_only: row.is_admin_only ?? false,
      color:        row.color         ?? '#111111',
      thumbnail:    row.thumbnail_url ?? '',
      gallery:      row.gallery_urls  ?? [],
      features:     rfMap.get(row.room_id) ?? [],
    }))
  } catch (e) {
    console.error('[api] loadAllRooms 실패:', e)
    return []
  }
}

export async function loadRooms(): Promise<Room[]> {
  try {
    // ← [2026-04-23] withRetry: 3개 쿼리 Promise.all 전체 재시도
    //   어느 한 쿼리(rooms/features/room_features)라도 실패하면 전체 재시도
    const { roomsRes, featuresRes, roomFeaturesRes } = await withRetry(async () => {
      const [roomsRes, featuresRes, roomFeaturesRes] = await Promise.all([
        supabase.from('rooms').select('*').eq('is_active', true).order('room_id'),
        supabase.from('features').select('*'),
        supabase.from('room_features').select('*, features(*)'),
      ])
      if (roomsRes.error) throw roomsRes.error
      return { roomsRes, featuresRes, roomFeaturesRes }
    }, 'loadRooms')

    const features   = featuresRes.data  ?? []
    const rfMap      = new Map<number, Feature[]>()
    for (const rf of roomFeaturesRes.data ?? []) {
      const f = rf.features as any
      if (!f) continue
      if (!rfMap.has(rf.room_id)) rfMap.set(rf.room_id, [])
      rfMap.get(rf.room_id)!.push({ feature_id: f.feature_id, feature_key: f.feature_key, feature_name: f.feature_name })
    }

    return (roomsRes.data ?? []).map(row => ({
      room_id:      row.room_id,
      floor_id:     row.floor_id      ?? 1,
      room_code:    row.room_code     ?? '',
      room_name:    row.room_name     ?? '',
      room_name_ko: row.room_name_ko  ?? '',
      capacity:     row.capacity      ?? 4,
      notes:        row.notes         ?? '',
      is_active:    row.is_active     ?? true,
      is_admin_only: row.is_admin_only ?? false,
      color:        row.color         ?? '#111111',
      thumbnail:    row.thumbnail_url ?? '',
      gallery:      row.gallery_urls  ?? [],
      features:     rfMap.get(row.room_id) ?? [],
    }))
  } catch (e) {
    // ← [2026-04-23] 재시도 3회 모두 실패 시 도달 — 기존대로 빈 배열 반환 (호환성 유지)
    console.error('[api] loadRooms 최종 실패 (3회 재시도 소진 → 빈 배열 반환):', e)
    return []
  }
}

export async function saveRooms(_rooms: Room[]): Promise<void> {
  // rooms는 이제 Supabase가 source of truth — AdminPage에서 직접 upsert
  console.warn('[api] saveRooms: Supabase 전환됨, AdminPage에서 직접 저장 필요')
}

// ── profiles 테이블 전체 로드 (Supabase) ──────────────────────────────────────
export async function loadUsers(): Promise<AppUser[]> {
  try {
    // ← [2026-04-23] withRetry: 일시 오류 시 최대 3회 재시도
    //   중요: 이 함수가 빈 배열 반환 시 BookingModal 참석자 검색이 전부 실패
    //   (메모리 기록 증상: "참석자 검색 안됨 - 5명 문의")
    const data = await withRetry(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, employee_id, name, dept, role, email, is_active, avatar_url')
        .order('name')
      if (error) throw error
      return data
    }, 'loadUsers')

    return (data ?? []).map(row => ({
      user_id:     row.id,
      employee_id: row.employee_id ?? '',
      name:        row.name        ?? '',
      dept:        row.dept        ?? '',
      role:        (row.role === 'ADMIN' ? 'ADMIN' : 'USER') as 'USER' | 'ADMIN',
      email:       row.email       ?? '',
      is_active:   row.is_active   ?? true,
      avatar_url:  row.avatar_url  ?? null,
    }))
  } catch (e) {
    // ← [2026-04-23] 재시도 3회 모두 실패 시 도달 — 기존대로 빈 배열 반환 (호환성 유지)
    console.error('[api] loadUsers 최종 실패 (3회 재시도 소진 → 빈 배열 반환):', e)
    return []
  }
}

export async function saveUsers(_users: AppUser[]): Promise<void> {
  console.warn('[api] saveUsers: profiles는 Supabase Auth 관리')
}

// ── Audit Log ────────────────────────────────────────────────────────────────
export type AuditAction =
  | 'BOOKING_CREATED'
  | 'BOOKING_UPDATED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_NOSHOW'
  | 'BOOKING_CHECKIN'
  | 'BOOKING_EARLY_END'
  | 'ADMIN_FORCE_CANCEL'

export async function insertAuditLog(params: {
  action:      AuditAction
  entityType:  string
  entityId:    string
  actorName?:  string
  beforeData?: Record<string, any>
  afterData?:  Record<string, any>
}): Promise<void> {
  if (!isSupabaseEnabled) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('audit_log').insert({
      actor_id:    user?.id   ?? null,
      actor_name:  params.actorName ?? user?.email ?? 'unknown',
      action:      params.action,
      entity_type: params.entityType,
      entity_id:   params.entityId,
      before_data: params.beforeData ?? null,
      after_data:  params.afterData  ?? null,
    })
  } catch (e) {
    console.warn('[api] insertAuditLog 실패 (무시):', e)
  }
}

// ── 회의실 이미지 (Supabase Storage) ─────────────────────────────────────────

/** 이미지 파일 → Supabase Storage 업로드 → 공개 URL 반환 */
export async function uploadRoomImage(
  roomId: number,
  file: File,
  type: 'thumbnail' | 'gallery'
): Promise<string> {
  const ext  = file.name.split('.').pop()
  const path = `room-${roomId}/${type}-${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('room-images')
    .upload(path, file, { upsert: true })

  if (error) throw new Error(`이미지 업로드 실패: ${error.message}`)

  const { data } = supabase.storage.from('room-images').getPublicUrl(path)
  return data.publicUrl
}

/** Storage에서 이미지 삭제 */
export async function deleteRoomImage(publicUrl: string): Promise<void> {
  // URL에서 path 추출: .../room-images/room-1/thumbnail-xxx.jpg → room-1/thumbnail-xxx.jpg
  const path = publicUrl.split('/room-images/')[1]
  if (!path) return
  const { error } = await supabase.storage.from('room-images').remove([path])
  if (error) console.warn('[api] 이미지 삭제 실패:', error.message)
}

/** rooms 테이블에 thumbnail_url, gallery_urls 저장 */
export async function saveRoomImages(
  roomId: number,
  thumbnailUrl: string,
  galleryUrls: string[]
): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .upsert({ room_id: roomId, thumbnail_url: thumbnailUrl, gallery_urls: galleryUrls })
  if (error) throw new Error(`이미지 정보 저장 실패: ${error.message}`)
}

/** rooms 테이블에서 이미지 정보 로드 */
export async function loadRoomImages(roomId: number): Promise<{
  thumbnail_url: string
  gallery_urls: string[]
}> {
  const { data, error } = await supabase
    .from('rooms')
    .select('thumbnail_url, gallery_urls')
    .eq('room_id', roomId)
    .single()
  if (error || !data) return { thumbnail_url: '', gallery_urls: [] }
  return {
    thumbnail_url: data.thumbnail_url ?? '',
    gallery_urls:  data.gallery_urls  ?? [],
  }
}

// ── rooms 테이블 저장 (AdminPage용) ──────────────────────────────────────────

/** 회의실 정보 upsert (수정/추가) */
export async function upsertRoom(room: Room): Promise<void> {
  const { error } = await supabase.from('rooms').upsert({
    room_id:      room.room_id,
    room_code:    room.room_code   ?? '',
    room_name:    room.room_name   ?? '',
    room_name_ko: room.room_name_ko ?? '',
    floor_id:     room.floor_id    ?? 1,
    capacity:     room.capacity    ?? 4,
    notes:        room.notes       ?? '',
    is_active:    room.is_active   ?? true,
    is_admin_only: room.is_admin_only ?? false,
    color:        room.color       ?? '#111111',
  }, { onConflict: 'room_id' })
  if (error) throw new Error(`회의실 저장 실패: ${error.message}`)
}

/** 회의실 활성/비활성 토글 */
export async function toggleRoomActive(roomId: number, isActive: boolean): Promise<void> {
  const { error } = await supabase
    .from('rooms').update({ is_active: isActive }).eq('room_id', roomId)
  if (error) throw new Error(`회의실 상태 변경 실패: ${error.message}`)
}

/** room_features 저장 (회의실 기능 목록 교체) */
export async function saveRoomFeatures(roomId: number, featureIds: number[]): Promise<void> {
  // 기존 삭제 후 재삽입
  await supabase.from('room_features').delete().eq('room_id', roomId)
  if (featureIds.length === 0) return
  const rows = featureIds.map(fid => ({ room_id: roomId, feature_id: fid, value_text: null }))
  const { error } = await supabase.from('room_features').insert(rows)
  if (error) throw new Error(`기능 저장 실패: ${error.message}`)
}

/** features 전체 목록 로드 */
export async function loadFeatures(): Promise<{ feature_id: number; feature_key: string; feature_name: string }[]> {
  const { data, error } = await supabase.from('features').select('*').order('feature_id')
  if (error) return []
  return data ?? []
}

// ── profiles 테이블 수정 (AdminPage 사용자 관리) ──────────────────────────────

/** 사용자 role/dept/name 수정
 *
 * ⚠️ RLS 요구사항: profiles 테이블에 아래 정책이 있어야 관리자가 타인 프로필 수정 가능
 *   CREATE POLICY "admins_can_update_profiles" ON public.profiles
 *   FOR UPDATE TO authenticated
 *   USING ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ADMIN' )
 *   WITH CHECK ( (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ADMIN' );
 */
export async function updateProfile(userId: string, fields: {
  name?: string; dept?: string; role?: string; employee_id?: string
}): Promise<void> {
  // .select('id')를 추가해 실제 업데이트된 행 수를 확인
  // RLS가 차단하면 error는 null이지만 data가 빈 배열 → 명시적 에러 발생
  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId)
    .select('id')

  if (error) throw new Error(`사용자 정보 수정 실패: ${error.message}`)

  if (!data || data.length === 0) {
    throw new Error(
      'DB에 반영되지 않았습니다. Supabase 대시보드에서 profiles 테이블의 UPDATE RLS 정책을 확인해주세요.\n' +
      '필요한 정책: admins_can_update_profiles (ADMIN 역할 사용자가 모든 프로필 수정 허용)'
    )
  }
}

/** pending 예약 승인 기한 초과 처리 (status 유지, auto_cancelled=true) */
export async function expirePendingBooking(id: string): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({ auto_cancelled: true, cancelled_by: 'system' })
    .eq('id', id)
    .eq('status', 'pending')  // pending 상태인 것만 처리
  if (error) throw new Error(`기한 초과 처리 실패: ${error.message}`)
  await insertAuditLog({
    action: 'BOOKING_CANCELLED' as any, entityType: 'booking', entityId: id,
    afterData: { reason: '승인 기한 초과 자동 취소', cancelled_by: 'system' }
  })
}

// ── 에메랄드 승인/거절 ────────────────────────────────────────────────────────

/** 관리자 승인 → status: confirmed + 처리 관리자 기록 */
export async function approveBooking(id: string, adminName?: string, adminAvatar?: string | null): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      status:              'confirmed',
      processed_by_name:   adminName   ?? null,
      processed_by_avatar: adminAvatar ?? null,
    })
    .eq('id', id)
  if (error) throw new Error(`승인 실패: ${error.message}`)
  await insertAuditLog({
    action: 'BOOKING_CREATED' as any,
    entityType: 'booking', entityId: id,
    afterData: { status: 'confirmed', note: '관리자 승인', adminName }
  })
}

/** 관리자 거절 → status: rejected + auto_cancelled: true + 처리 관리자 기록 */
export async function rejectBooking(id: string, reason: string, adminName?: string, adminAvatar?: string | null): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      status:              'rejected',
      auto_cancelled:      true,
      cancelled_by:        'admin',
      reject_reason:       reason || null,
      processed_by_name:   adminName   ?? null,
      processed_by_avatar: adminAvatar ?? null,
    })
    .eq('id', id)
  if (error) throw new Error(`거절 실패: ${error.message}`)
  await insertAuditLog({
    action: 'BOOKING_CANCELLED' as any,
    entityType: 'booking', entityId: id,
    afterData: { status: 'rejected', reason, adminName }
  })
}

// ── 인앱 알림 (notifications 테이블) ─────────────────────────────────────────

export interface AppNotification {
  id:         string
  user_id:    string
  type:       string
  title:      string
  body?:      string
  booking_id?: string
  is_read:    boolean
  created_at: string
}

/** 알림 생성 (본인 또는 타겟 user_id 지정) */
export async function insertNotification(params: {
  userId:    string
  type:      string
  title:     string
  body?:     string
  bookingId?: string
}): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id:    params.userId,
    type:       params.type,
    title:      params.title,
    body:       params.body ?? null,
    booking_id: params.bookingId ?? null,
    is_read:    false,
  })
  if (error) console.warn('[api] insertNotification 실패:', error.message)
}

/** 내 알림 목록 (최근 30건) */
export async function loadNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) return []
  return data ?? []
}

/** 알림 읽음 처리 (단건) */
export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from('notifications').update({ is_read: true }).eq('id', id)
}

/** 전체 읽음 처리 */
export async function markAllNotificationsRead(): Promise<void> {
  await supabase.from('notifications')
    .update({ is_read: true })
    .eq('is_read', false)
}

// ── 참석자 검색 (search-users Edge Function → Graph API) ─────────────────────

/**
 * 예약 모달 참석자 검색
 * @param query        - 검색어 (이름, 이메일, 부서)
 * @param excludeEmail - 현재 사용자 이메일 (검색 결과에서 제외)
 */
export async function searchGraphUsers(
  query: string,
  excludeEmail?: string
): Promise<AppUser[]> {
  if (!isSupabaseEnabled || query.trim().length < 1) return []
  try {
    const q = query.trim()
    // profiles 테이블에서 직접 검색
    // is_active = false(퇴사자) 제외, 이름·이메일·부서 중 하나라도 일치하면 반환
    const { data, error } = await supabase
      .from('profiles')
      .select('id, employee_id, name, dept, role, email, is_active, avatar_url')
      .or(`name.ilike.%${q}%,email.ilike.%${q}%,dept.ilike.%${q}%`)
      .neq('is_active', false)
      .limit(8)

    if (error) {
      console.error('[api] searchGraphUsers(profiles) 실패:', error)
      return []
    }

    return (data ?? [])
      .filter(row => row.email !== excludeEmail)   // 본인 제외
      .map(row => ({
        user_id:     row.id,
        employee_id: row.employee_id ?? '',
        name:        row.name        ?? '',
        dept:        row.dept        ?? '',
        role:        (row.role === 'ADMIN' ? 'ADMIN' : 'USER') as 'USER' | 'ADMIN',
        email:       row.email       ?? '',
        is_active:   row.is_active   ?? true,
        avatar_url:  row.avatar_url  ?? null,
      }))
  } catch (e) {
    console.error('[api] searchGraphUsers(profiles) 예외:', e)
    return []
  }
}

// ── Azure AD 전체 임직원 사전 동기화 ─────────────────────────────────────────

export interface SyncResult {
  success:           boolean
  total:             number
  synced:            number
  skipped:           number
  departed:          number   // 퇴사 처리된 인원 (profiles 삭제 + departed_users 이력 저장)
  cancelledBookings: number
  syncedAt:          string
  error?:            string
}

export async function syncAllUsers(): Promise<SyncResult> {
  const { data, error } = await supabase.functions.invoke('sync-all-users')
  if (error) throw new Error(error.message ?? 'Azure AD 동기화 실패')
  if (!data?.success) throw new Error(data?.error ?? 'Azure AD 동기화 실패')
  return data as SyncResult
}

// ── 퇴사자 목록 조회 ─────────────────────────────────────────────────────────
export async function loadDepartedUsers(): Promise<import('../types').DepartedUser[]> {
  if (!isSupabaseEnabled) return []
  try {
    const { data, error } = await supabase
      .from('departed_users')
      .select('id, name, email, dept, employee_id, departed_at')
      .order('departed_at', { ascending: false })
    if (error) throw error
    return data ?? []
  } catch (e) {
    console.error('[api] loadDepartedUsers 실패:', e)
    return []
  }
}

/** notifications Realtime 구독 — userId 필터로 본인 알림만 수신 */
export function subscribeNotifications(onNew: (payload: any) => void, userId?: string) {
  const channel = supabase
    .channel('notifications-realtime')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'notifications',
      ...(userId ? { filter: `user_id=eq.${userId}` } : {}),
    }, (payload) => onNew(payload))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

/** 특정 유저의 미래 예약 건수 조회 (취소되지 않은 것만) */
export async function countFutureBookings(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gt('start_at', new Date().toISOString())
      .eq('auto_cancelled', false)
    if (error) throw error
    return count ?? 0
  } catch (e) {
    console.error('[api] countFutureBookings 실패:', e)
    return 0
  }
}

/** 수동 퇴사 처리
 *  1. 미래 예약 auto_cancelled → true (cancelled_by: 'system')
 *  2. departed_users INSERT
 *  3. profiles DELETE
 */
export async function manualDepartUser(
  userId: string,
  userInfo: { name: string; email: string; dept: string; employee_id: string }
): Promise<{ cancelledCount: number }> {
  // 1. 미래 예약 목록 조회
  const { data: futureBks, error: bkErr } = await supabase
    .from('bookings')
    .select('id')
    .eq('user_id', userId)
    .gt('start_at', new Date().toISOString())
    .eq('auto_cancelled', false)
  if (bkErr) throw new Error(bkErr.message)

  const cancelledCount = futureBks?.length ?? 0

  // 2. 미래 예약 일괄 취소
  if (cancelledCount > 0) {
    const ids = futureBks!.map((b: any) => b.id)
    const { error: cancelErr } = await supabase
      .from('bookings')
      .update({ auto_cancelled: true, cancelled_by: 'system' })
      .in('id', ids)
    if (cancelErr) throw new Error(cancelErr.message)
  }

  // 3. departed_users INSERT (중복 시 무시)
  const { error: departErr } = await supabase
    .from('departed_users')
    .upsert({
      id:          userId,
      name:        userInfo.name,
      email:       userInfo.email,
      dept:        userInfo.dept,
      employee_id: userInfo.employee_id,
      departed_at: new Date().toISOString(),
    }, { onConflict: 'id' })
  if (departErr) throw new Error(departErr.message)

  // 4. profiles DELETE
  const { error: deleteErr } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId)
  if (deleteErr) throw new Error(deleteErr.message)

  return { cancelledCount }
}
