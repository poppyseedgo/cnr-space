/**
 * api.ts — Supabase 기반 데이터 레이어
 *
 * [2026-04-29 Phase 1] Audit log 확장 — buildBookingDiff 헬퍼 추가
 *   배경: 기존 BOOKING_UPDATED audit는 title/start_at/end_at/room_id 4개 필드만 raw 저장
 *         memo/status/attendees 변경은 추적 안 됨, 변경 안 된 필드도 같이 기록되어 노이즈
 *   변경: buildBookingDiff(prev, next, rooms, prevAttendees, nextAttendees) 헬퍼 추가
 *     · 변경된 필드만 before/after 객체에 포함 (변경 0개면 빈 객체)
 *     · room: id + name 함께 (메일 본문 가독성)
 *     · attendees: added/removed 가공 정보 + 전체 목록 모두 저장
 *   효과:
 *     · 모든 사용자 직접 수정이 정밀 audit (어떤 필드가 어떻게 바뀌었는지)
 *     · 변경 안 된 필드 노이즈 제거
 *     · Phase 2 메일 diff 페이로드와 동일 객체 재사용 가능 (단일 진실 소스)
 *   사용처: App.tsx update 핸들러 + 향후 Phase 2 sendNotification('updated')
 *
 * [2026-04-29 v3] upsertBookingAttendees → RPC 'sync_booking_attendees' 호출로 전환
 *   배경: v2 (SELECT-then-diff)는 클라이언트 측 DELETE silent fail (RLS 차단)을
 *         회피하지 못해 참석자 제거가 동작하지 않음 + 누적 정리도 RLS 막힘
 *   변경: 클라이언트 직접 DELETE/INSERT → SECURITY DEFINER RPC 함수에 위임
 *     · DB 함수: sync_booking_attendees(p_booking_id, p_attendees jsonb)
 *     · 함수 내부: 권한 검증 → DELETE all → INSERT distinct (RLS 우회)
 *     · 권한 검증: 예약자 / 참석자 / 관리자만 호출 가능 (anon 차단)
 *   효과:
 *     · 참석자 추가/제거/변경 모두 정상 동작 ✅
 *     · DB 자체 중복 누적이 호출되는 즉시 자동 정리 ✅
 *     · 클라이언트 코드 90% 단축
 *   필수 사전 작업:
 *     · Supabase SQL Editor에서 sync_booking_attendees.sql 실행 (RPC 함수 생성)
 *     · 함수 미생성 시 throw → 호출 측에서 catch (이전 동작보다 더 안전)
 *
 * [2026-04-29 v2] booking_attendees 중복 누적 영구 차단 (upsertBookingAttendees 재설계)
 *   배경: DB 분석 결과 — 4/22 5건 INSERT (정상) → 4/29 수정 시 5건 더 INSERT (DELETE 미동작) → 10건
 *         created_at microsecond까지 동일 → 한 번의 INSERT가 5 row를 한꺼번에 추가
 *         즉 DELETE가 silent fail(RLS 의심)되고 INSERT만 누적되는 구조
 *   변경: delete-all → insert-all 패턴 폐기, SELECT 후 diff 패턴으로 전환
 *     1. 기존 행 SELECT
 *     2. wanted(form) vs existing(DB) email 기준 비교
 *     3. toInsert: DB에 없는 것만 INSERT (중복 누적 영구 차단)
 *     4. toDeleteIds: form엔 없는 것 + DB 자체 중복 행 정밀 DELETE
 *     5. .select() 가드로 silent fail 감지 + 콘솔 경고
 *   효과:
 *     · 수정 시 중복 누적   → ✅ 영구 차단 (SELECT에서 잡혀 INSERT 제외)
 *     · 참석자 추가/변경    → ✅ 정상
 *     · 참석자 제거 (RLS 정상) → ✅ 정상
 *     · 참석자 제거 (RLS silent fail) → ⚠️ 제거 안 됨 (단 중복은 안 만듦, RLS 정책 별도 추적)
 *
 * [2026-04-29 v1] booking_attendees 중복 행 표시/저장 차단 (4지점 dedupe)
 *   배경: DB의 booking_attendees 테이블에 (booking_id, email) 중복 행 43건 누적
 *         원인 추적 종료 — 외부 INSERT 경로(트리거/race/자동작업) 차단 우선 적용
 *   변경 위치 (4곳, 모두 api.ts):
 *     ① loadBookings           — attendees 파싱 시 email 기준 dedupe (화면 표시 차단)
 *     ② loadBookingsByRange    — Admin Dashboard 경로 동일 처리
 *     ③ getBookingAttendees    — diff 계산 정확도 보장 (반환 email 목록 dedupe)
 *     ④ upsertBookingAttendees — rows 생성 시 dedupe (v2에서 재설계로 통합)
 *   효과:
 *     · 즉시: 기존 DB 중복 43건이 화면에서 1명씩만 표시 (DB 데이터는 그대로 보존)
 *     · 이후: 새 예약/수정 시 DB 자체에 중복 INSERT 안 됨
 *   호환성:
 *     · email 정규화 trim().toLowerCase() — 대소문자/공백 차이로 인한 dedupe 누락 방지
 *     · email 없는 행(외부인/이름만 있음)은 dedupe 제외 — 동명이인 보호
 *     · 호출 측 시그니처/반환 타입 100% 동일 — 기존 컴포넌트 영향 0
 *     · RLS / FK / Realtime 영향 0
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
 *  5. [2026-05-15 HOTFIX] PostgREST default 1000-row limit 회피 — paging 적용
 *     - 증상: 캘린더(CalendarShell)에서 2026-06-15 이후 예약이 전부 사라짐
 *     - 검증: SELECT COUNT(*) FROM bookings WHERE start_at >= NOW()-INTERVAL '3 months'
 *            → 1147건 (1000 초과)
 *     - 근본 원인: loadBookings / loadBookingsByRange 가 .range() / .limit() 미명시
 *            → PostgREST default max-rows(=1000)이 적용되어
 *            ASC 정렬 시 가장 미래 147건이 잘림
 *     - 해결: 1000건씩 .range(start, end) paging 루프로 모두 fetch 후 합산
 *            · data.length < PAGE_SIZE 면 마지막 페이지로 판정하고 break
 *            · 각 페이지마다 withRetry 그대로 적용 — 일시 오류 복원력 유지
 *     - 대상 함수:
 *       · loadBookings        (현재 발생 중인 증상의 원인)
 *       · loadBookingsByRange (동일 패턴 — Admin Dashboard 90일 범위에서 동일 위험)
 *     - 호환: 반환 타입 Booking[] 동일 — 호출부(App.tsx, AdminPage 등) 수정 불필요
 *     - 별도: MyPage.tsx 인라인 쿼리 3건도 동일 패턴이지만 DESC 정렬이라 미래는
 *            안 잘림. 가장 오래된 것부터 잘리는 별개 이슈로 follow-up 처리.
 */

import { supabase, isSupabaseEnabled } from './supabase'
import type { Booking, Room, AppUser, Feature, AttendeeRef,
  MyBookLoan, ExtendErrorCode,
  CheckoutErrorCode, BookRequest } from '../types'  // ← [2026-07-18] 내 대여 / [2026-07-22] 대여신청

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
    // ← [2026-05-04 옵션 B] cancelled_by_user_id 매핑 (snake → camel)
    //   · DB 칼럼: cancelled_by_user_id UUID FK to profiles
    //   · 라벨 분기에 사용 (예약자/참석자 취소 구분)
    cancelledByUserId: row.cancelled_by_user_id ?? null,
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
// [2026-05-15 HOTFIX] PostgREST default max-rows(1000) 회피 — paging 루프 적용 (이력 5번 참조)
export async function loadBookings(): Promise<Booking[]> {
  if (!isSupabaseEnabled) return localGetBookings()
  try {
    const from = new Date()
    from.setMonth(from.getMonth() - 3)   // ← [2026-04-25] -7일 → -3개월
    // ← [2026-04-25] 미래 컷오프 제거: 기존 const to = +60일 + .lte('start_at', to) 삭제
    const fromISO = from.toISOString()   // ← [2026-05-15] paging 루프 안에서 재사용

    // bookings + booking_attendees join 조회
    // bookings.attendees JSONB는 신규 예약에 저장 안 됨 → booking_attendees 테이블이 정본
    // ← [2026-04-23] withRetry: 일시 오류 시 최대 3회 재시도 (exponential backoff + jitter)
    // ← [2026-05-15 HOTFIX] PostgREST default 1000-row limit 회피 — paging 루프
    //   · .range(pageStart, pageStart + PAGE_SIZE - 1) 로 1000건씩 fetch
    //   · 받은 data.length < PAGE_SIZE 이면 마지막 페이지로 판정하고 break
    //   · withRetry는 페이지마다 그대로 적용 — 일시 오류 복원력 유지
    const PAGE_SIZE = 1000                  // ← [2026-05-15] PostgREST max-rows 기본값과 일치
    const allRows: any[] = []               // ← [2026-05-15] 페이지 누적 버퍼
    let pageStart = 0                       // ← [2026-05-15] range 시작 인덱스 (0부터)

    while (true) {                          // ← [2026-05-15] 무한 루프 — break 조건은 내부에서
      const pageEnd = pageStart + PAGE_SIZE - 1   // ← [2026-05-15] range 끝(포함) 인덱스
      const data = await withRetry(async () => {
        const { data, error } = await supabase
          .from('bookings')
          .select('*, booking_attendees(email, name)')
          .gte('start_at', fromISO)         // ← [2026-04-25] 미래 .lte 조건 제거됨 (무제한)
          .order('start_at', { ascending: true })
          .range(pageStart, pageEnd)        // ← [2026-05-15 HOTFIX] 페이지 범위 명시 (필수)
        if (error) throw error
        return data
      }, `loadBookings page=${pageStart}`)  // ← [2026-05-15] 재시도 로그에 페이지 식별자 포함

      if (!data || data.length === 0) break  // ← [2026-05-15] 빈 결과 → 종료 (정확히 1000의 배수 케이스)
      allRows.push(...data)                  // ← [2026-05-15] 누적
      if (data.length < PAGE_SIZE) break     // ← [2026-05-15] 마지막 페이지 — 종료
      pageStart += PAGE_SIZE                 // ← [2026-05-15] 다음 페이지로
    }

    return allRows.map(row => {              // ← [2026-05-15] data → allRows 로 교체
      const parsed = rowToBooking(row)
      // booking_attendees 테이블에서 attendees 파싱 (email이 유일 키)
      // ← [2026-04-29] dedupeAttendeesByEmail 적용 — DB 중복 행이 있어도 화면엔 1명씩만 표시
      parsed.attendees = dedupeAttendeesByEmail(
        (row.booking_attendees ?? [])
          .map((a: any): AttendeeRef => ({ email: a.email ?? '', name: a.name ?? '' }))
          .filter((a: AttendeeRef) => a.email || a.name)
      )
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
// ← [2026-05-06 사용자 결정 Q3-A] dateField 파라미터 추가 — 'start_at'(default) | 'created_at'
//    근거: 승인 관리 테이블에 신청일/시작일 토글이 추가되어 백엔드 fetch 기준도 통일 필요
//    default 'start_at'으로 기존 호출처(AdminPage 등)는 영향 없음
// ← [2026-05-15 HOTFIX] PostgREST default max-rows(1000) 회피 — paging 루프 적용 (이력 5번 참조)
//    배경: loadBookings와 동일 패턴. 90일 범위 사용 시 1000건 초과 가능 → 동일 위험.
export async function loadBookingsByRange(
  from: string,
  to: string,
  dateField: 'start_at' | 'created_at' = 'start_at'
): Promise<Booking[]> {
  if (!isSupabaseEnabled) return []
  try {
    const fromISO = new Date(from + 'T00:00:00+09:00').toISOString()
    const toISO   = new Date(to   + 'T23:59:59+09:00').toISOString()

    // ← [2026-05-15 HOTFIX] PostgREST default 1000-row limit 회피 — paging 루프
    //   동일 패턴: loadBookings paging 구현 참조. 정렬 방향(DESC)은 기존 유지.
    const PAGE_SIZE = 1000                       // ← [2026-05-15] max-rows 기본값과 일치
    const allRows: any[] = []                    // ← [2026-05-15] 페이지 누적 버퍼
    let pageStart = 0                            // ← [2026-05-15] range 시작 인덱스

    while (true) {                               // ← [2026-05-15] break 조건은 내부에서
      const pageEnd = pageStart + PAGE_SIZE - 1  // ← [2026-05-15] range 끝(포함) 인덱스
      const { data, error } = await supabase
        .from('bookings')
        .select('*, booking_attendees(email, name)')
        .gte(dateField, fromISO)                 // ← dateField 동적 ('start_at' 또는 'created_at')
        .lte(dateField, toISO)
        .order(dateField, { ascending: false })  // ← 정렬도 동일 기준
        .range(pageStart, pageEnd)               // ← [2026-05-15 HOTFIX] 페이지 범위 명시 (필수)
      if (error) throw error
      if (!data || data.length === 0) break      // ← [2026-05-15] 빈 결과 → 종료
      allRows.push(...data)                       // ← [2026-05-15] 누적
      if (data.length < PAGE_SIZE) break          // ← [2026-05-15] 마지막 페이지 — 종료
      pageStart += PAGE_SIZE                      // ← [2026-05-15] 다음 페이지로
    }

    return allRows.map(row => {                   // ← [2026-05-15] data → allRows 로 교체
      const b = rowToBooking(row)
      // ← [2026-04-29] dedupeAttendeesByEmail 적용 — Admin Dashboard 경로 동일 보장
      b.attendees = dedupeAttendeesByEmail(
        (row.booking_attendees ?? [])
          .map((a: any): AttendeeRef => ({ email: a.email ?? '', name: a.name ?? '' }))
          .filter((a: AttendeeRef) => a.email || a.name)
      )
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
// ← [2026-06-12] 대리 예약 지원: booker override 파라미터 추가
//   · 미지정(기존 호출) → 로그인 사용자(auth.getUser)가 예약자 (동작 100% 동일)
//   · 지정(관리자 대리 예약) → 명시한 user_id/email로 예약자 저장
//   · RLS 확인 결과 bookings_insert with_check = auth.role()='authenticated' 뿐 →
//     타인 user_id INSERT가 RLS에 막히지 않음 (SECURITY DEFINER RPC 불필요)
//   · user_name/user_dept는 booking.user/booking.dept(폼 주입)에서 그대로 옴 — 호출부가 요청자 값으로 세팅
export async function insertBooking(
  booking: Booking,
  booker?: { user_id: string; email: string },   // ← 대리 예약 시 예약자 명시 지정
): Promise<Booking> {
  if (!isSupabaseEnabled) {
    localSaveBookings([...localGetBookings(), booking])
    return booking
  }
  const { data: { user } } = await supabase.auth.getUser()

  // 예약자 결정: override 있으면 그 값, 없으면 로그인 사용자
  const bookerUserId = booker?.user_id ?? user?.id ?? ''      // ← [대리예약] override 우선
  const bookerEmail  = booker?.email  ?? user?.email ?? ''    // ← [대리예약] override 우선

  // 서버사이드 충돌 검사
  const { data: conflict } = await supabase.rpc('check_booking_conflict', {
    p_room_id: booking.room_id, p_start_at: booking.start_at,
    p_end_at:  booking.end_at,  p_exclude_id: null,
  })
  if (conflict) throw new Error('해당 시간에 이미 예약이 있습니다.')

  const { data, error } = await supabase
    // ← [2026-04-24 P3-2] user.email도 함께 전달 — bookings.user_email 컬럼에 저장 (isBooker OR 판정용)
    .from('bookings').insert(bookingToRow(booking, bookerUserId, bookerEmail)).select().single()  // ← [2026-06-12] booker override 반영

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

// ── 참석자 email 기준 dedupe 헬퍼 ─────────────────────────────────────────────
// [2026-04-29] booking_attendees 중복 행 표시/저장 양쪽 차단용
//   · email 정규화: trim().toLowerCase() (대소문자/공백 차이로 인한 dedupe 누락 방지)
//   · email 없는 행(외부인/이름만 있는 참석자)은 dedupe 제외 — 동명이인 보호
//   · 첫 번째 등장한 행 우선 유지 (Stable order preservation)
//   · 적용 위치: loadBookings / loadBookingsByRange / upsertBookingAttendees (3곳)
function dedupeAttendeesByEmail<T extends { email?: string; name?: string }>(arr: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const a of arr) {
    const key = (a.email ?? '').trim().toLowerCase()
    if (!key) {
      // email 없는 행(이름만 있는 외부인)은 그대로 유지 — 동명이인 가능성 보호
      result.push(a)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    result.push(a)
  }
  return result
}

// ── booking_attendees 저장 (예약 생성/수정 시 호출) ────────────────────────
// [2026-04-29 v2 — 재설계] SELECT 후 diff 패턴으로 변경
//
// 배경:
//   기존 패턴(delete 전체 → insert 전체)은 DELETE가 silent fail되면 누적 INSERT 발생
//   실제 발생: 4/22 5건 INSERT (정상) → 4/29 수정 시 5건 더 INSERT (DELETE 미동작) → 10건
//   created_at microsecond까지 동일 → 한 INSERT 호출이 5 row를 한꺼번에 넣은 것
//   즉 DELETE가 아예 안 일어나거나 0건 처리되고 INSERT만 누적됨
//
// 변경:
//   [기존 — 위험]
//     delete eq booking_id → insert all
//
//   [변경 — 안전]
//     1. SELECT 기존 (booking_id로 조회)
//     2. wanted(form) vs existing(DB) email 기준 비교
//     3. toInsert: form엔 있고 DB엔 없는 것만 INSERT
//     4. toDeleteIds: DB엔 있고 form엔 없는 것의 row id로 정밀 DELETE
//
// 효과 (시나리오별):
//   · 수정 시 중복 누적     → ✅ 영구 차단 (같은 email은 SELECT에서 잡혀 INSERT 제외)
//   · 참석자 추가만         → ✅ 추가분만 INSERT (불필요한 라운드트립 제거)
//   · 참석자 이름·정보 변경 → ✅ 같은 email 유지
//   · 참석자 제거 (DELETE 정상) → ✅ 정상 제거
//   · 참석자 제거 (DELETE silent fail) → ⚠️ 제거 안 됨 (RLS 진범이면 정책 수정 별도 필요)
//                                          단 중복은 여전히 안 만듦
//
// 호환성:
//   · 함수 시그니처/반환 타입 동일 (Promise<void>)
//   · 빈 attendees 처리 동일 (early return)
//   · 호출 측 영향 0 (insertBooking, App.tsx 수정 핸들러)
export async function upsertBookingAttendees(
  bookingId: string,
  attendees: { email?: string; name?: string }[]
): Promise<void> {
  // ── [2026-04-29 v3] RPC 'sync_booking_attendees' 호출로 단순화 ──
  //
  // 배경:
  //   v2 (SELECT-then-diff)는 클라이언트 측 DELETE silent fail (RLS 차단)을
  //   회피하지 못함 → 참석자 제거 동작 안 됨 + 누적 정리도 RLS 막힘
  //
  // 변경:
  //   클라이언트가 직접 DELETE/INSERT 수행 → DB의 SECURITY DEFINER RPC 함수에 위임
  //   · sync_booking_attendees(p_booking_id, p_attendees)
  //   · 함수 내부: 권한 검증 → DELETE all → INSERT distinct (RLS 우회)
  //
  // 효과:
  //   · 참석자 추가/제거/변경 모두 정상 동작
  //   · DB 자체 중복 누적은 호출 시 자동 정리 (DELETE all로 클린)
  //   · 클라이언트 코드 90% 단축
  //
  // 호환성:
  //   · 함수 시그니처 / 반환 타입 동일 — 호출 측 영향 0
  //   · email 정규화/dedupe는 RPC 함수 내부에서 처리
  //   · 권한 검증 실패 시 throw → 호출 측에서 catch 가능

  // 입력 정규화 (RPC가 추가로 dedupe하지만 네트워크 페이로드 절감)
  const cleanAttendees = dedupeAttendeesByEmail(attendees ?? [])
    .map(a => ({
      email: (a.email ?? '').trim(),
      name:  (a.name  ?? '').trim(),
    }))
    .filter(a => a.email)   // RPC는 email 필수 (이름만 있는 외부인은 RPC가 처리 안 함)

  const { data, error } = await supabase.rpc('sync_booking_attendees', {
    p_booking_id: bookingId,
    p_attendees:  cleanAttendees,
  })

  if (error) {
    // RPC 실패 시 — 권한 거부 또는 DB 오류
    console.error('[api] sync_booking_attendees RPC 실패:', error.message, { bookingId })
    throw new Error(`참석자 동기화 실패: ${error.message}`)
  }

  // 결과 로그 (개발 시 확인용, 운영에선 제거 가능)
  if (data && typeof data === 'object') {
    const { deleted, inserted } = data as { deleted?: number; inserted?: number }
    console.log('[api] sync_booking_attendees 완료:', { bookingId, deleted, inserted })
  }
}

// ── 현재 참석자 이메일 목록 조회 (업데이트 전 diff 계산용) ─────────────────
export async function getBookingAttendees(bookingId: string): Promise<string[]> {
  if (!isSupabaseEnabled || !bookingId) return []
  const { data, error } = await supabase
    .from('booking_attendees')
    .select('email')
    .eq('booking_id', bookingId)
  if (error) return []
  // ← [2026-04-29] email 기준 dedupe — diff 계산 정확도 보장
  //   배경: DB 중복 행이 있을 때 동일 email이 2번 반환 → App.tsx의 oldAttendeeEmails 비교가 어긋남
  //   처리: 정규화 trim().toLowerCase() 기준 첫 등장만 유지 (원본 email 문자열은 보존)
  const seen = new Set<string>()
  return (data ?? [])
    .map(r => r.email)
    .filter((e): e is string => Boolean(e))
    .filter(e => {
      const key = e.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
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
  // ← [2026-05-04 옵션 B] cancelledByUserId 매핑 — '예약자/참석자/관리자' 취소 라벨 분기용
  if (changes.cancelledByUserId !== undefined) dbChanges.cancelled_by_user_id = changes.cancelledByUserId
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
//
// ← [2026-05-04 옵션 B] adminUserId 파라미터 추가 (필수)
//   · 어느 관리자가 강제 취소했는지 cancelled_by_user_id에 저장
//   · 호출부: App.tsx의 adminForceCancelBooking 함수에서 authUser?.user_id 전달
//   · 향후 활용 가능 (감사 로그 / 알림 메시지 등)
export async function adminForceCancel(id: string, adminUserId: string): Promise<void> {
  await updateBooking(id, {
    status: 'cancelled',
    autoCancelled: true,
    cancelledBy: 'admin',
    cancelledByUserId: adminUserId,                    // ← [옵션 B] 관리자 user_id
  })
}

// ── 예약자(소유권) 변경 — 관리자 전용 ─────────────────────────────────────────
// ← [2026-06-12] admin_change_booking_owner RPC 래퍼
//   · SECURITY DEFINER RPC에 위임: admin 검증 + 미래/confirmed 가드 + 참석자 자동 제거
//     + user_id/email/name/dept 4-스냅샷 원자 갱신 + 원래/새 예약자 정보 반환
//   · updateBooking에 user_id를 끼워넣지 않는 이유: 시간/룸 충돌·pending 재평가 로직과
//     완전 격리하기 위함 (소유권 변경은 단일 책임의 별도 경로)
//   · 호출부: App.tsx의 changeBookingOwner 핸들러 (RPC 성공 후 알림 2종 발사)
//   · 반환값을 그대로 알림 페이로드(former_booker_user_id 등) 구성에 사용
export interface ChangeOwnerResult {
  ok: boolean
  old_booker: { user_id: string; email: string; name: string; dept: string }
  new_booker: { user_id: string; email: string; name: string; dept: string }
  removed_from_attendees: boolean
}

export async function changeBookingOwner(
  bookingId: string,
  newUserId: string,
): Promise<ChangeOwnerResult> {
  const { data, error } = await supabase.rpc('admin_change_booking_owner', {
    p_booking_id:  bookingId,
    p_new_user_id: newUserId,
  })

  if (error) {
    // RPC 내부 RAISE EXCEPTION 메시지를 한글 안내로 매핑 (UI 토스트용)
    console.error('[api] admin_change_booking_owner RPC 실패:', error.message, { bookingId, newUserId })
    const map: Record<string, string> = {
      UNAUTHENTICATED:     '로그인이 필요합니다.',
      FORBIDDEN_NOT_ADMIN: '관리자만 예약자를 변경할 수 있습니다.',
      BOOKING_NOT_FOUND:   '예약을 찾을 수 없습니다.',
      NOT_CONFIRMED:       '확정된 예약만 예약자를 변경할 수 있습니다.',
      NOT_FUTURE:          '시작 전 예약만 예약자를 변경할 수 있습니다.',
      NOT_ACTIVE:          '취소·노쇼·반납된 예약은 예약자를 변경할 수 없습니다.',
      SAME_OWNER:          '현재 예약자와 동일한 사용자입니다.',
      NEW_OWNER_NOT_FOUND: '새 예약자 정보를 찾을 수 없습니다.',
      NEW_OWNER_INACTIVE:  '퇴사한 사용자는 예약자로 지정할 수 없습니다.',
      NEW_OWNER_NO_EMAIL:  '새 예약자의 이메일 정보가 없어 변경할 수 없습니다.',
    }
    const key = Object.keys(map).find(k => error.message.includes(k))
    throw new Error(key ? map[key] : '예약자 변경에 실패했습니다.')
  }

  return data as ChangeOwnerResult
}

// ── 취소 ─────────────────────────────────────────────────────────────────────
// ── 취소 ─────────────────────────────────────────────────────────────────────
// ← [2026-04-23 HOTFIX Phase 3] status: 'cancelled' 추가
//   증상: 사용자가 취소한 예약이 캘린더 뷰에 표시됨
//   원인: status='confirmed' 유지된 채 auto_cancelled=true만 저장 → 활성 예약으로 오인
//   해결: status='cancelled' 명시 저장으로 isShownInCalendar의 status 기반 필터가 정확히 작동
//   주의: auto_cancelled=true는 유지 (isUserCancel 판정 플래그 그대로 사용, 뱃지 정상 표시)
//   연관: Phase 2 adminForceCancel과 동일 패턴
//
// ← [2026-04-27 Layer 1 가드] cancelled_by='system'/'admin' 오염 차단 (근본)
//   증상: 노쇼 처리(cancelled_by='system')된 예약이 사용자 취소로 덮어써져
//          'system' → 'user'로 오염 → 노쇼 박제와 캘린더 표시 모두 사라짐
//   원인: stale modal.data로 DetailModal이 노쇼 처리된 예약에도 BtnCancel을 표시,
//          사용자가 누르면 cancelBooking이 현재 상태 무시하고 무조건 덮어씀
//   해결: updateBooking 단순 호출 → 원자적 조건부 UPDATE로 변경
//          ① cancelled_by IS NULL — 아직 누구도 취소하지 않은 상태만 (system/admin/user 모두 차단)
//          ② status IN ('confirmed','pending') — 정상 활성 예약만 (rejected/cancelled 차단)
//          UPDATE 0 rows 반환 = 이미 처리된 예약 → throw로 호출 측에 알림
//   짝 배포: App.tsx Layer 2 (DetailModal에 fresh booking 전달 — 사용자가 애초에 못 누르게 함)
//
// ← [2026-05-04 옵션 B] cancelledByUserId 파라미터 추가 (필수)
//   · 호출자(예약자 또는 참석자)의 user_id 저장
//   · BookingStatusBadge가 b.cancelledByUserId === b.user_id 비교로 예약자/참석자 라벨 분기
//   · 호출부: App.tsx의 cancelBooking 함수에서 authUser?.user_id 전달
export async function cancelBooking(id: string, cancelledByUserId: string): Promise<void> {
  // localStorage fallback (Supabase 미사용 환경) — 가드 불필요, 단일 사용자 환경
  if (!isSupabaseEnabled) {
    await updateBooking(id, {
      status: 'cancelled',
      autoCancelled: true,
      cancelledBy: 'user',
      cancelledByUserId,                               // ← [옵션 B] 호출자 user_id
    })
    return
  }

  // 원자적 조건부 UPDATE — DB 단에서 race/오염 차단 (진실의 원천)
  const { data, error } = await supabase
    .from('bookings')
    .update({
      status: 'cancelled',
      auto_cancelled: true,
      cancelled_by: 'user',
      cancelled_by_user_id: cancelledByUserId,         // ← [2026-05-04 옵션 B] 누가 취소했는지 저장
    })
    .eq('id', id)
    .is('cancelled_by', null)                       // ← 가드 ①
    .in('status', ['confirmed', 'pending'])         // ← 가드 ②
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    // 0 rows = 이미 system 노쇼 / admin 강제취소 / user 본인 이전 취소 / 거절된 예약
    throw new Error('이미 노쇼·취소 처리된 예약이라 취소할 수 없습니다.')
  }
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
 *
 * ← [2026-04-27 가드 5종] stale state로 인한 양방향 오염 근본 차단
 *   배경:
 *     · 클라이언트 useEffect가 매분 tick으로 markNoshow를 일괄 호출
 *     · 어드민/운영팀 PC, 자리비운 사용자 화면이 매분 stale state로 노쇼 후보 산출
 *     · trigger trg_block_noshow_on_checked_in이 평소 보호막 역할이지만
 *       정상 보호막에 의존하는 구조 자체가 위험 (트리거 OFF시 누적 시도 일괄 통과)
 *   가드 5종 (모두 필수, AND 조건):
 *     ① status='confirmed'         — pending/rejected/cancelled 행 차단
 *     ② checked_in=false           — 체크인된 진행 중 회의 차단 (양방향 오염 핵심)
 *     ③ early_ended=false          — 조기반납 회의 차단
 *     ④ auto_cancelled=false       — 멱등성 (동시 호출 1번만 성공)
 *     ⑤ cancelled_by IS NULL       — 사용자/관리자 직접 취소 행 차단 (덮어쓰기 방지)
 *   throw 정책:
 *     · cancelBooking과 다름 — 0 rows는 정상(가드 통과 못한 stale 시도) → silent skip
 *     · 호출 측 useEffect의 Promise.all(...).catch(console.error) 패턴과 호환
 *   짝 배포: 없음 (lib/api.ts 단일 파일)
 */
export async function markNoshow(id: string): Promise<void> {
  // localStorage fallback (Supabase 미사용 환경) — 가드 불필요, 단일 사용자 환경
  if (!isSupabaseEnabled) {
    await updateBooking(id, { autoCancelled: true, cancelledBy: 'system' })
    return
  }

  // 원자적 조건부 UPDATE — DB 단에서 stale state 시도를 거름
  // 0 rows = 가드 통과 못 함 = 정상 (silent skip)
  const { error } = await supabase
    .from('bookings')
    .update({ auto_cancelled: true, cancelled_by: 'system' })
    .eq('id', id)
    .eq('status',          'confirmed')   // ← 가드 ①
    .eq('checked_in',      false)          // ← 가드 ②
    .eq('early_ended',     false)          // ← 가드 ③
    .eq('auto_cancelled',  false)         // ← 가드 ④
    .is('cancelled_by',    null)           // ← 가드 ⑤

  if (error) throw error
  // 0 rows일 때 throw 없음 — 호출 측 useEffect는 다음 tick에 다시 시도
}

// ── Realtime 구독 ────────────────────────────────────────────────────────────
//
// ← [2026-04-30 Step 3-A] onResubscribe 옵셔널 콜백 추가
//    배경: Realtime 끊김(네트워크 단절/슬립/와이파이 전환 등) 후 자동 재연결 시
//          그 사이의 변경 메시지를 놓쳤을 가능성이 있음 → React state stale 발생
//    해결: subscribe()의 status callback에서 'SUBSCRIBED' 도래 시 onResubscribe 호출
//          → 호출 측이 loadBookings로 fresh data 강제 sync
//    호환성: onResubscribe는 옵셔널이므로 기존 호출(`subscribeBookings(cb)`)은 그대로 작동
//    짝 배포: src/App.tsx (호출 측에서 onResubscribe 사용)
export function subscribeBookings(
  onUpdate: () => void,
  onResubscribe?: () => void,
) {
  if (!isSupabaseEnabled) return () => {}
  const channel = supabase
    .channel('bookings-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => onUpdate())
    .subscribe((status) => {
      // SUBSCRIBED는 최초 구독 + 재연결 성공 모두에서 발생
      // 끊김 사이 변경을 놓쳤을 수 있어 호출 측에서 fresh data fetch
      if (status === 'SUBSCRIBED' && onResubscribe) onResubscribe()
    })
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
      usage_rules:  row.usage_rules   ?? '', // ← [2026-05-14] 이용규칙 필드 추가
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
      usage_rules:  row.usage_rules   ?? '', // ← [2026-05-14] 이용규칙 필드 추가
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
    // ← [2026-05-14] is_active=false(퇴사자) 제외 필터 추가
    //   · 배경: AdminPage 사용자 관리의 '재직자' 카운트에 퇴사자가 포함되어 있던 문제
    //   · 시스템 전반에서 is_active=false = 퇴사자/비활성으로 일관되게 취급되는데
    //     loadUsers만 필터 누락 → users 배열에 퇴사자 섞여 들어옴
    //   · 다른 곳(api.ts:searchUsers, BookingModal 등)은 이미 `.neq('is_active', false)` 적용 중
    //   · 추가 효과: Live profile lookup의 fallback 메커니즘 의도대로 작동
    //     (퇴사자 예약 표시 시 owner를 못 찾고 snapshot으로 fallback)
    const data = await withRetry(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, employee_id, name, dept, role, email, is_active, avatar_url')
        .neq('is_active', false) // ← [2026-05-14] 퇴사자 제외 — 시스템 전반 일관성
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
  | 'BOOKING_OWNER_CHANGED'   // ← [2026-06-12] 관리자 예약자(소유권) 변경
  | 'BOOKING_CREATED_ON_BEHALF'  // ← [2026-06-12] 관리자 대리 예약 생성

// ── Booking 변경 diff 계산 ─────────────────────────────────────────────────
// [2026-04-29 Phase 1] audit_log + 변경 메일 본문 비교용 단일 진실 소스
//
// 동작:
//   prev vs next의 각 필드를 비교 → 변경된 필드만 before/after에 포함
//   변경 안 된 필드는 양쪽 객체 모두에서 제외 (노이즈 제거)
//
// 입력:
//   prev               — 변경 전 booking (DB 또는 메모리 원본)
//   next               — 변경 후 changes payload
//   rooms              — 회의실 lookup (room_id → room_name 변환)
//   prevAttendeeEmails — 변경 전 attendees email 목록 (booking_attendees 테이블 별도 조회 결과)
//   nextAttendees      — 변경 후 attendees ({email, name}[])
//
// 반환:
//   { before, after } — audit_log의 before_data/after_data에 그대로 저장 가능
//   변경 0개면 둘 다 빈 객체 {}
//
// 사용처:
//   1. App.tsx update 핸들러 → insertAuditLog 의 beforeData/afterData
//   2. (Phase 2 예정) sendNotification('updated') 의 diff 페이로드
export interface BookingChangeRecord {
  before: Record<string, any>
  after:  Record<string, any>
}

export function buildBookingDiff(
  prev: Partial<{
    title:    string
    memo:     string
    status:   string
    start_at: string
    end_at:   string
    room_id:  number
  }>,
  next: Partial<{
    title:    string
    memo:     string
    status:   string
    start_at: string
    end_at:   string
    room_id:  number
  }>,
  rooms: { room_id: number; room_name?: string; room_name_ko?: string }[] = [],
  prevAttendeeEmails: string[] = [],
  nextAttendees:      { email?: string; name?: string }[] = [],
): BookingChangeRecord {
  const before: Record<string, any> = {}
  const after:  Record<string, any> = {}

  // 단순 텍스트 필드
  if (next.title !== undefined && (prev.title ?? '') !== next.title) {
    before.title = prev.title ?? ''
    after.title  = next.title
  }
  if (next.memo !== undefined && (prev.memo ?? '') !== next.memo) {
    before.memo = prev.memo ?? ''
    after.memo  = next.memo
  }
  if (next.status !== undefined && prev.status && prev.status !== next.status) {
    before.status = prev.status
    after.status  = next.status
  }

  // 시간 필드 (ISO 문자열 비교)
  if (next.start_at !== undefined && prev.start_at && prev.start_at !== next.start_at) {
    before.start_at = prev.start_at
    after.start_at  = next.start_at
  }
  if (next.end_at !== undefined && prev.end_at && prev.end_at !== next.end_at) {
    before.end_at = prev.end_at
    after.end_at  = next.end_at
  }

  // 회의실 변경 (id + name 함께 — 메일 본문에서 사용자가 읽기 쉽도록)
  if (next.room_id !== undefined && prev.room_id !== undefined && prev.room_id !== next.room_id) {
    const fromRoom = rooms.find(r => r.room_id === prev.room_id)
    const toRoom   = rooms.find(r => r.room_id === next.room_id)
    before.room = {
      room_id:   prev.room_id,
      room_name: fromRoom?.room_name_ko ?? fromRoom?.room_name ?? `Room ${prev.room_id}`,
    }
    after.room = {
      room_id:   next.room_id,
      room_name: toRoom?.room_name_ko   ?? toRoom?.room_name   ?? `Room ${next.room_id}`,
    }
  }

  // 참석자 변경 (email 정규화 후 비교)
  if (nextAttendees.length > 0 || prevAttendeeEmails.length > 0) {
    const norm = (e: string) => e.trim().toLowerCase()
    const prevSet = new Set(prevAttendeeEmails.map(norm).filter(Boolean))
    const nextMap = new Map<string, AttendeeRef>()
    for (const a of nextAttendees) {
      const k = norm(a.email ?? '')
      if (!k) continue
      if (!nextMap.has(k)) nextMap.set(k, { email: a.email ?? '', name: a.name ?? '' })
    }

    // 실제 변경 여부 검증 (set equality)
    const prevKeys = [...prevSet].sort().join(',')
    const nextKeys = [...nextMap.keys()].sort().join(',')

    if (prevKeys !== nextKeys) {
      const added: AttendeeRef[]   = []
      const removed: AttendeeRef[] = []
      for (const [k, ref] of nextMap.entries()) {
        if (!prevSet.has(k)) added.push(ref)
      }
      for (const k of prevSet) {
        if (!nextMap.has(k)) removed.push({ email: k, name: '' })
      }
      // before에는 변경 전 전체 목록 (저장 시 fallback용)
      before.attendees = prevAttendeeEmails.map(e => ({ email: e, name: '' }))
      // after에는 변경 후 전체 목록 + 변환 정보 (added/removed)
      after.attendees  = [...nextMap.values()]
      after.attendees_added   = added
      after.attendees_removed = removed
    }
  }

  return { before, after }
}

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
    usage_rules:  room.usage_rules ?? '', // ← [2026-05-14] 이용규칙 저장
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

// ═══════════════════════════════════════════════════════════════════════════
// 방문로그(Visitor Log) 관리 API — Phase 5
// ───────────────────────────────────────────────────────────────────────────
// 게이트: 모든 호출이 서버(RPC/Edge)에서 visitor_verify_access(ADMIN·활성 AND 2차 비번)로 재검증됨.
// pw는 UI 잠금해제 후 메모리 state로 유지하며 매 호출에 첨부 (stateless 검증).
// 이미지는 Storage 경로만 오고, signed URL은 visitorSignedUrls로 생성.
// ═══════════════════════════════════════════════════════════════════════════

const VISITOR_BUCKET = 'visitor-signatures'

export interface VisitorLog {
  id:           string
  purpose:      string
  visitor_memo: string | null
  card_no:      string | null   // 카드 라벨(text)
  returned:     boolean
  returned_at:  string | null
  visited_at:   string
  name_text:    string
  org_text:     string
  admin_memo:   string | null
  sig_img_path: string
}

export interface VisitorCard {
  label:      string
  in_use:     boolean
  created_at: string
}

// 2차 비번 검증 (잠금해제) — true/false 반환 (예외 없음)
export async function visitorVerifyAccess(pw: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('visitor_verify_access', { p_pw: pw })
  if (error) throw new Error(error.message)
  return data === true
}

// 전체 기록 조회 (ADMIN + 2차 비번). 잘못된 비번이면 서버가 FORBIDDEN throw.
export async function visitorListLogs(pw: string): Promise<VisitorLog[]> {
  const { data, error } = await supabase.rpc('visitor_admin_list_logs', { p_pw: pw })
  if (error) throw new Error(error.message)
  return (data ?? []) as VisitorLog[]
}

// 카드 반납 처리. 실제 처리 시 true.
export async function visitorReturnCard(pw: string, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('visitor_admin_return_card', { p_pw: pw, p_id: id })
  if (error) throw new Error(error.message)
  return data === true
}

// 기록 삭제 (Storage 파일 + DB 행 원자 삭제) — Edge Function. 관리자 세션 토큰 첨부.
export async function visitorDeleteLog(pw: string, id: string): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''
  const res = await fetch(`${url}/functions/v1/visitor-admin-delete`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ pw, id }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.ok) throw new Error(j?.error ?? `삭제 실패 (HTTP ${res.status})`)
}

// 여러 경로 → signed URL 일괄 생성 (경로→URL 맵). 만료 10분.
export async function visitorSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(paths.filter(Boolean)))
  if (uniq.length === 0) return {}
  const { data, error } = await supabase.storage
    .from(VISITOR_BUCKET)
    .createSignedUrls(uniq, 600)
  if (error) throw new Error(error.message)
  const map: Record<string, string> = {}
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

// ─── 방문로그: 카드 관리 + 메모 (Step 4) ────────────────────────────────────

// 카드 목록(사용중 여부 포함)
export async function visitorListCards(pw: string): Promise<VisitorCard[]> {
  const { data, error } = await supabase.rpc('visitor_admin_list_cards', { p_pw: pw })
  if (error) throw new Error(error.message)
  return (data ?? []) as VisitorCard[]
}

// 카드 추가
export async function visitorAddCard(pw: string, label: string): Promise<void> {
  const { error } = await supabase.rpc('visitor_admin_add_card', { p_pw: pw, p_label: label })
  if (error) throw new Error(error.message)
}

// 카드 삭제 (사용중이면 서버가 예외 → CARD_IN_USE)
export async function visitorDeleteCard(pw: string, label: string): Promise<void> {
  const { error } = await supabase.rpc('visitor_admin_delete_card', { p_pw: pw, p_label: label })
  if (error) throw new Error(error.message)
}

// 어드민 메모 저장
export async function visitorSetMemo(pw: string, id: string, memo: string): Promise<void> {
  const { error } = await supabase.rpc('visitor_admin_set_memo', { p_pw: pw, p_id: id, p_memo: memo })
  if (error) throw new Error(error.message)
}

// ─── 마이페이지 '내 대여' (도서 대여 조회 + 연장) ───────────────────────────
// [2026-07-18] 스코프: 조회 + 연장신청 (반납/분실 전이는 관리자 전용)
//   · 조회: RLS(book_checkouts_select_self_or_admin)가 본인 건만 반환.
//           방어적으로 user_id 필터도 명시.
//   · 연장: 반드시 RPC(extend_book_checkout) 경유.
//           클라이언트가 book_checkouts를 직접 UPDATE하면 due_at 임의 조작이
//           가능하므로, 본인·active·미연장·미연체 검증과 정확한 +7일 적용은
//           서버(SECURITY DEFINER)에서만 수행한다.

/** 내 도서 대여 목록 조회 (최신 대여순, 도서 정보 조인) */
export async function fetchMyBookLoans(userId: string): Promise<MyBookLoan[]> {
  if (!userId) return []

  const { data, error } = await supabase
    .from('book_checkouts')
    .select(`
      id, book_id, checkout_at, due_at, returned_at,
      extension_count, last_extended_at, status,
      books ( title, author, publisher, cover_url )
    `)
    .eq('user_id', userId)
    .order('checkout_at', { ascending: false })

  if (error) throw new Error(error.message)

  // supabase 조인 결과의 books 는 객체 또는 배열로 올 수 있어 정규화
  return (data ?? []).map((r: any): MyBookLoan => ({
    id:               r.id,
    book_id:          r.book_id,
    checkout_at:      r.checkout_at,
    due_at:           r.due_at,
    returned_at:      r.returned_at ?? null,
    extension_count:  r.extension_count ?? 0,
    last_extended_at: r.last_extended_at ?? null,
    status:           r.status,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  }))
}

/** 연장 RPC 에러 메시지 → 코드 매핑 (Postgres RAISE EXCEPTION 메시지 기반) */
function parseExtendError(message: string): ExtendErrorCode {
  const codes: ExtendErrorCode[] = [
    'CHECKOUT_NOT_FOUND', 'NOT_OWNER', 'NOT_ACTIVE', 'ALREADY_EXTENDED', 'OVERDUE',
  ]
  const hit = codes.find(c => message.includes(c))
  return hit ?? 'UNKNOWN'
}

/**
 * 대여 연장 (1회, +7일) — 서버 RPC 경유
 * 성공: { ok:true, row }  /  실패: { ok:false, code }
 * 예외를 throw 하지 않고 코드로 반환 → 호출부에서 한글 토스트 매핑
 *
 * ← [2026-07-20 fix] 반환 타입을 판별 유니온에서 단일 타입으로 변경.
 *   이 프로젝트는 tsconfig 의 strict(=strictNullChecks) 가 false 라
 *   `ok: true | false` 리터럴이 boolean 으로 뭉개져 if(!res.ok) 안에서도
 *   유니온이 좁혀지지 않는다(TS2339: Property 'code' does not exist...).
 *   호출부에서 좁히기에 의존하지 않도록 두 필드를 모두 옵셔널로 갖는
 *   단일 결과 타입으로 계약을 정리한다.
 */
export interface ExtendResult {
  ok:    boolean
  row?:  MyBookLoan       // ok === true 일 때 존재
  code?: ExtendErrorCode  // ok === false 일 때 존재
}

export async function extendBookCheckout(checkoutId: string): Promise<ExtendResult> {
  const { data, error } = await supabase.rpc('extend_book_checkout', {
    p_checkout_id: checkoutId,
  })

  if (error) return { ok: false, code: parseExtendError(error.message ?? '') }

  // RPC는 갱신된 book_checkouts 행을 반환 (books 조인 없음 → book은 호출부에서 유지)
  const r: any = Array.isArray(data) ? data[0] : data
  if (!r) return { ok: false, code: 'UNKNOWN' }

  return {
    ok: true,
    row: {
      id:               r.id,
      book_id:          r.book_id,
      checkout_at:      r.checkout_at,
      due_at:           r.due_at,
      returned_at:      r.returned_at ?? null,
      extension_count:  r.extension_count ?? 0,
      last_extended_at: r.last_extended_at ?? null,
      status:           r.status,
      book:             null,
    },
  }
}

/** 연장 실패 코드 → 사용자 안내 문구 */
export function extendErrorMessage(code: ExtendErrorCode): string {
  switch (code) {
    case 'CHECKOUT_NOT_FOUND': return '대여 정보를 찾을 수 없습니다'
    case 'NOT_OWNER':          return '본인 대여만 연장할 수 있습니다'
    case 'NOT_ACTIVE':         return '이미 반납된 도서입니다'
    case 'ALREADY_EXTENDED':   return '이미 연장한 도서입니다 (연장은 1회만 가능)'
    case 'OVERDUE':            return '연체 중에는 연장할 수 없습니다. 반납 후 다시 대여해주세요'
    default:                   return '연장에 실패했습니다. 잠시 후 다시 시도해주세요'
  }
}

// ─── 도서 대여 등록 / 신청 / 승인 (← [2026-07-22]) ───────────────────────────
// 설계 원칙:
//   · 모든 상태 전이는 SECURITY DEFINER RPC 경유. 클라이언트 직접 INSERT/UPDATE 금지.
//     (RLS 도 20260722 마이그레이션에서 "사용자는 pending INSERT만" 으로 제한됨)
//   · 여러 권 등록/신청은 서버에서 단일 트랜잭션 처리 → 부분 실패 없음
//   · 실패는 throw 대신 코드로 반환 → 호출부에서 한글 토스트 매핑

/** RPC 에러 메시지 → 코드 파싱 (LIMIT_EXCEEDED:2:2 같은 접미사 포함 형태 지원) */
function parseCheckoutError(message: string): { code: CheckoutErrorCode; detail?: string } {
  const codes: CheckoutErrorCode[] = [
    'NOT_AUTHENTICATED', 'NOT_ADMIN', 'NOT_OWNER', 'NO_BORROWER', 'NO_BOOKS',
    'NOTES_TOO_LONG', 'REASON_TOO_LONG', 'LIMIT_EXCEEDED', 'ALREADY_REQUESTED',
    'BOOK_NOT_AVAILABLE', 'BOOK_NOT_FOUND', 'REQUEST_NOT_FOUND', 'NOT_PENDING',
  ]
  const hit = codes.find(c => message.includes(c))
  if (!hit) return { code: 'UNKNOWN' }
  // "LIMIT_EXCEEDED:2:2" / "BOOK_NOT_AVAILABLE:12:구의 증명" → 뒤쪽 상세 추출
  const m = message.match(new RegExp(hit + ':([^\\s]*(?:\\s[^\\s]*)*)'))
  return { code: hit, detail: m?.[1] }
}

/** 대여 등록/신청 실패 코드 → 사용자 안내 문구 */
export function checkoutErrorMessage(code: CheckoutErrorCode, detail?: string): string {
  switch (code) {
    case 'NOT_AUTHENTICATED':  return '로그인이 필요합니다'
    case 'NOT_ADMIN':          return '대여 등록/승인 권한이 없습니다'
    case 'NOT_OWNER':          return '본인 신청만 취소할 수 있습니다'
    case 'NO_BORROWER':        return '대여자를 선택해주세요'
    case 'NO_BOOKS':           return '도서를 선택해주세요'
    case 'NOTES_TOO_LONG':     return '메모는 100자까지 입력할 수 있습니다'
    case 'REASON_TOO_LONG':    return '거절 사유는 200자까지 입력할 수 있습니다'
    case 'ALREADY_REQUESTED':  return '이미 신청한 도서입니다'
    case 'BOOK_NOT_FOUND':     return '도서 정보를 찾을 수 없습니다'
    case 'REQUEST_NOT_FOUND':  return '신청 정보를 찾을 수 없습니다'
    case 'NOT_PENDING':        return '이미 처리된 신청입니다'
    case 'LIMIT_EXCEEDED': {
      // detail = "현재:한도"
      const [held, max] = (detail ?? '').split(':')
      return max
        ? `대여·신청 합계 ${max}권까지 가능합니다 (현재 ${held}권)`
        : '대여 가능 권수를 초과했습니다'
    }
    case 'BOOK_NOT_AVAILABLE': {
      // detail = "id:제목"
      const title = (detail ?? '').split(':').slice(1).join(':')
      return title
        ? `"${title}" 은(는) 이미 대여 중입니다. 목록을 새로고침해주세요`
        : '이미 대여 중인 도서가 포함되어 있습니다'
    }
    default:                   return '처리에 실패했습니다. 잠시 후 다시 시도해주세요'
  }
}

export interface CheckoutResult {
  ok:    boolean
  rows?: MyBookLoan[]
  code?: CheckoutErrorCode
  detail?: string
}

/** RPC 반환 행 → MyBookLoan 정규화 (books 조인 없음 → book 은 호출부에서 채움) */
function toLoanRow(r: any): MyBookLoan {
  return {
    id:                r.id,
    book_id:           r.book_id,
    checkout_at:       r.checkout_at,
    due_at:            r.due_at,
    returned_at:       r.returned_at ?? null,
    extension_count:   r.extension_count ?? 0,
    last_extended_at:  r.last_extended_at ?? null,
    status:            r.status,
    book:              null,
    requested_at:      r.requested_at ?? null,
    processed_at:      r.processed_at ?? null,
    processed_by_name: r.processed_by_name ?? null,
    reject_reason:     r.reject_reason ?? null,
    notes:             r.notes ?? null,
  }
}

/** [Admin] 도서 대여 등록 — 여러 권 동시, 단일 트랜잭션 */
export async function adminCheckoutBooks(
  userId: string, bookIds: number[], notes?: string | null
): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('admin_checkout_books', {
    p_user_id:  userId,
    p_book_ids: bookIds,
    p_notes:    notes ?? null,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  return { ok: true, rows: (data ?? []).map(toLoanRow) }
}

/** [사용자] 도서 대여 신청 — pending 생성 */
export async function requestBookCheckout(
  bookIds: number[], notes?: string | null
): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('request_book_checkout', {
    p_book_ids: bookIds,
    p_notes:    notes ?? null,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  return { ok: true, rows: (data ?? []).map(toLoanRow) }
}

/** [Admin] 신청 승인 — pending → active (승인 시점 기준 반납일 재계산) */
export async function approveBookRequest(
  checkoutId: string, adminName?: string | null
): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('admin_approve_book_request', {
    p_checkout_id: checkoutId,
    p_admin_name:  adminName ?? null,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  const r = Array.isArray(data) ? data[0] : data
  return r ? { ok: true, rows: [toLoanRow(r)] } : { ok: false, code: 'UNKNOWN' }
}

/** [Admin] 신청 거절 — pending → rejected (사유 기록) */
export async function rejectBookRequest(
  checkoutId: string, reason: string, adminName?: string | null
): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('admin_reject_book_request', {
    p_checkout_id: checkoutId,
    p_reason:      reason,
    p_admin_name:  adminName ?? null,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  const r = Array.isArray(data) ? data[0] : data
  return r ? { ok: true, rows: [toLoanRow(r)] } : { ok: false, code: 'UNKNOWN' }
}

/** [본인] 신청 취소 — pending → cancelled */
export async function cancelBookRequest(checkoutId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('cancel_book_request', {
    p_checkout_id: checkoutId,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  const r = Array.isArray(data) ? data[0] : data
  return r ? { ok: true, rows: [toLoanRow(r)] } : { ok: false, code: 'UNKNOWN' }
}

/** [Admin] 승인 대기 신청 목록 (선착순 정렬) */
export async function fetchPendingBookRequests(): Promise<BookRequest[]> {
  const { data, error } = await supabase
    .from('book_checkouts')
    .select(`
      id, book_id, user_id, checkout_at, due_at, returned_at,
      extension_count, last_extended_at, status, notes,
      requested_at, processed_at, processed_by_name, reject_reason,
      books ( title, author, publisher, cover_url )
    `)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })   // 선착순

  if (error) throw new Error(error.message)

  return (data ?? []).map((r: any): BookRequest => ({
    ...toLoanRow(r),
    user_id: r.user_id,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  } as BookRequest))
}
