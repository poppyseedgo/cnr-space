/**
 * api.ts — Supabase 기반 데이터 레이어
 *
 * [2026-07-27 KB] GA 챗봇 지식베이스 — loadKbChunks / saveKbChunk / deleteKbChunk
 *   · RLS(has_admin_role('kb')) 직접 접근, RPC 없음 / updated_* 는 DB 트리거 담당
 *
 * [2026-07-27 목적 Phase 1] 예약 목적 카테고리 데이터 계층
 *   · bookingToRow: purpose / purpose_detail 저장 (etc 외에는 detail 강제 null)
 *   · rowToBooking: purpose / purposeDetail 읽기 (null = 도입 전 예약)
 *   · updateBooking: purpose 변경 매핑 + etc 이탈 시 detail 동반 null
 *   · SSOT: src/data/bookingPurpose.ts / DB: 20260731_booking_purpose.sql
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
  CheckoutErrorCode, BookRequest,
  // ← [2026-07-23] 어드민 '도서 관리' 탭
  Book, BookCategory, AdminBookLoan, BookReturnAction, BookReturnErrorCode, BookEditForm,
} from '../types'  // ← [2026-07-18] 내 대여 / [2026-07-22] 대여신청
// ← [2026-07-21] 연체 패널티
import type { BookPenaltyState, AdminBookPenalty } from '../types'
// ← [2026-08-10] 노쇼 이용 제재 (20260743)
import type { NoshowPenaltyRow, MyNoshowPenaltyState } from '../utils/noshowPenalty'
import { revokeNoshowPenaltyErrorMessage } from '../utils/noshowPenalty'

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
    // ← [2026-09-09 노쇼 종결] DB 트리거가 기록하는 종결 시각 (읽기 전용 — bookingToRow 미포함)
    noshowClosedAt: row.noshow_closed_at ? utcToKST(row.noshow_closed_at) : null,
    recurGroupId:  row.recur_group_id ?? null,
    // ← [2026-07-27 목적] 목적 코드 + 기타 상세 읽기 — null=기능 도입 전 예약(칩 생략)
    purpose:       row.purpose ?? null,
    purposeDetail: row.purpose_detail ?? null,
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
    // ← [2026-07-27 목적] 목적 코드 + 기타 상세 저장
    //   · detail 은 etc 일 때만 저장 — etc 외 값이 남으면 DB CHECK(chk_bookings_purpose_detail) 위반이므로
    //     저장 계층에서 강제 null (모달 검증과 이중 방어가 아니라 "저장 규칙" 자체)
    purpose:        b.purpose ?? null,
    purpose_detail: b.purpose === 'etc' ? (b.purposeDetail?.trim() || null) : null,
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
  // ← [2026-07-27 목적] 수정 모달에서 목적 변경 허용 (고지 확정)
  //   · purpose 가 etc 외로 바뀌면 detail 을 함께 null — 안 하면 DB CHECK 위반으로 수정 전체 실패
  if (changes.purpose       !== undefined) {
    dbChanges.purpose = changes.purpose
    if (changes.purpose !== 'etc') dbChanges.purpose_detail = null
  }
  if (changes.purposeDetail !== undefined && dbChanges.purpose_detail === undefined) {
    dbChanges.purpose_detail = changes.purposeDetail?.trim() || null
  }
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
      NEW_OWNER_ON_LEAVE:  '휴직 중인 사용자는 예약자로 지정할 수 없습니다.',            // ← [2026-07-30] 20260736 트리거 가드
      NEW_OWNER_AFTER_DEPARTURE: '새 예약자의 퇴사 예정일 이후에 시작하는 예약입니다.',  // ← [2026-07-30] 20260736 트리거 가드
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
export async function markNoshow(id: string): Promise<number> {
  // localStorage fallback (Supabase 미사용 환경) — 가드 불필요, 단일 사용자 환경
  if (!isSupabaseEnabled) {
    await updateBooking(id, { autoCancelled: true, cancelledBy: 'system' })
    return 1
  }

  // ← [2026-08-27 시간가드] RPC mark_noshow — 가드 5종 + `now() >= start_at + 10분` 을 서버 시계로 단일 판정
  //   배경: 8/27 13:00 사고 — 참석자 브라우저의 tick 이 클라이언트 시계 기준으로 13:15 예약을 노쇼 마킹.
  //         기존 PATCH 가드 5종에는 시간 조건이 없어 미래 예약(체크인 전)이 통과됨.
  //   반환: 실제 갱신 행 수(0|1). 0 = 서버 거부(시간 미달·이미 처리·체크인 등) — 호출 측은 0이면
  //         낙관적 UI/audit 을 하지 않는다. DB 트리거 trg_block_premature_noshow 가 모든 경로의 최종 안전망.
  const { data, error } = await supabase.rpc('mark_noshow', { p_booking_id: id })
  if (error) throw error
  return Number(data ?? 0)
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
    // ← [2026-07-30] employment_status 3필드 추가 (20260735) — 라벨/피커 판정 SSOT 원천
    //   휴직·퇴사예정자도 users 배열에 포함되어야 라벨 표시 가능. 피커 제외는
    //   utils/employment.ts canPickUser 가 담당 (is_active 필터는 레거시 호환 유지)
    const data = await withRetry(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, employee_id, name, dept, role, email, is_active, avatar_url, employment_status, departure_scheduled_on, returned_on, azure_user_id, azure_extra, azure_synced_at') // ← [2026-07-30] 3필드 추가 · [2026-10-01] Azure 전체 필드 3개
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
      employment_status:      (row.employment_status ?? 'active') as import('../types').EmploymentStatus, // ← [2026-07-30]
      departure_scheduled_on: row.departure_scheduled_on ?? null,                                          // ← [2026-07-30]
      returned_on:            row.returned_on            ?? null,                                          // ← [2026-07-30]
      azure_user_id:          row.azure_user_id          ?? null,                                          // ← [2026-10-01]
      azure_extra:            row.azure_extra            ?? null,
      azure_synced_at:        row.azure_synced_at        ?? null,
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
    // ← [2026-07-30] employment 필드 추가 — 검색 결과에도 라벨 표시·휴직 제외 판정 필요
    const { data, error } = await supabase
      .from('profiles')
      .select('id, employee_id, name, dept, role, email, is_active, avatar_url, employment_status, departure_scheduled_on') // ← [2026-07-30] 2필드 추가
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
        employment_status:      (row.employment_status ?? 'active') as import('../types').EmploymentStatus, // ← [2026-07-30]
        departure_scheduled_on: row.departure_scheduled_on ?? null,                                          // ← [2026-07-30]
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

// ← [2026-07-30] manualDepartUser 제거 — depart-user Edge Function(departUser)으로 대체.
//   구 함수는 클라 4단계 순차 실행이라 비원자적(중간 실패 시 반쪽 퇴사)이었고
//   cancelled_by='system' 기록이 노쇼 오염(확정룰 충돌)을 만들던 구방식.
//   호출부 0건 확인 후 제거 (AdminPage import 동시 정리).

// ═══════════════════════════════════════════════════════════════════════════
// 재직 상태 관리 API — [2026-07-30] 퇴사자 정책 개편 Phase 3 (20260735 짝 배포)
// ───────────────────────────────────────────────────────────────────────────
// 상태 변경/퇴사는 반드시 서버 경유 — 클라 직접 UPDATE 금지:
//   · 상태 변경: admin_set_employment_status RPC (전이 검증·예정일 정합 서버 강제)
//   · 즉시 퇴사: depart-user Edge Function (process_departure RPC + auth 삭제)
// 에러 → 한글 매핑은 utils/employment.ts (employmentStatusErrorMessage 등)
// ═══════════════════════════════════════════════════════════════════════════

/** 재직 상태 변경 — 재직/휴직/복직/퇴사예정(예정일 필수) */
export async function setEmploymentStatus(
  userId: string,
  status: import('../types').EmploymentStatus,
  departureOn?: string,   // 'YYYY-MM-DD' — status='departing' 일 때만
): Promise<{ employment_status: string; departure_scheduled_on: string | null; returned_on: string | null }> {
  const { data, error } = await supabase.rpc('admin_set_employment_status', {
    p_user_id:      userId,
    p_status:       status,
    p_departure_on: departureOn ?? null,
  })
  if (error) throw new Error(error.message)
  return data
}

/** 즉시 퇴사 처리 — depart-user Edge Function (원자적 RPC + auth 삭제, 복구 불가) */
export interface DepartUserResult {
  success:           boolean
  cancelledBookings: number
  authDeleted:       boolean
  rpc:               Record<string, unknown>   // process_departure 상세 카운트
  error?:            string
}
export async function departUser(userId: string): Promise<DepartUserResult> {
  const { data, error } = await supabase.functions.invoke('depart-user', {
    body: { user_id: userId },
  })
  // invoke 는 4xx/5xx 에서 error 를 주지만 본문(error 코드)은 data 로 안 옴 —
  // FunctionsHttpError 의 context 에서 본문을 복원해 한글 매핑이 코드를 읽을 수 있게 한다
  if (error) {
    const body = await (error as any)?.context?.json?.().catch?.(() => null)
    throw new Error(body?.error ?? error.message ?? '퇴사 처리 실패')
  }
  if (!data?.success) throw new Error(data?.error ?? '퇴사 처리 실패')
  return data as DepartUserResult
}


/** 관리자 예약 취소 — admin_cancel_book_checkout (20260737, 미시작 건 한정, 무통보)
 *  에러코드는 서버가 message 로 던진다 — 한글 매핑 자체 처리 */
export async function adminCancelBookCheckout(
  checkoutId: string,
): Promise<{ ok: boolean; message?: string; bookTitle?: string }> {
  const { data, error } = await supabase.rpc('admin_cancel_book_checkout', {
    p_checkout_id: checkoutId,
  })
  if (error) {
    const msg = error.message ?? ''
    const map: Record<string, string> = {
      NOT_AUTHENTICATED:  '로그인이 필요합니다',
      NOT_ADMIN:          '도서 관리 권한이 필요합니다',
      CHECKOUT_NOT_FOUND: '대여 정보를 찾을 수 없습니다. 목록을 새로고침해주세요',
      NOT_ACTIVE:         '이미 처리된 예약입니다. 목록을 새로고침해주세요',
      ALREADY_STARTED:    '이미 시작된 대여는 취소할 수 없습니다. 반납 처리해주세요',
    }
    const hit = Object.keys(map).find(k => msg.includes(k))
    return { ok: false, message: hit ? map[hit] : '예약 취소에 실패했습니다. 잠시 후 다시 시도해주세요' }
  }
  const r: any = Array.isArray(data) ? data[0] : data
  return { ok: true, bookTitle: r?.book_title ?? undefined }
}

/** [어드민] 공휴일·회사 이벤트 관리 (20260738·20260739) — has_admin_role('room') */
export interface AdminHoliday {
  holiday_date: string
  name: string
  kind: 'holiday' | 'company'
  source: string   // 'seed' | 'api' | 'manual'
}
const HOLIDAY_ERR: Record<string, string> = {
  NOT_AUTHENTICATED: '로그인이 필요합니다',
  NOT_ADMIN:         '회의실 관리 권한이 필요합니다',
  NAME_REQUIRED:     '이름을 입력해주세요',
  INVALID_KIND:      '구분 값이 올바르지 않습니다',
  INVALID_YEAR:      '연도가 올바르지 않습니다',
  HOLIDAY_NOT_FOUND: '항목을 찾을 수 없습니다. 목록을 새로고침해주세요',
}
function holidayErr(msg: string): string {
  const hit = Object.keys(HOLIDAY_ERR).find(k => msg.includes(k))
  return hit ? HOLIDAY_ERR[hit] : '처리에 실패했습니다. 잠시 후 다시 시도해주세요'
}
export async function loadHolidaysAdmin(): Promise<AdminHoliday[]> {
  const { data, error } = await supabase
    .from('holidays').select('holiday_date, name, kind, source').order('holiday_date')
  if (error) throw error
  return data ?? []
}
export async function adminUpsertHoliday(
  date: string, name: string, kind: 'holiday' | 'company',
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_upsert_holiday', { p_date: date, p_name: name, p_kind: kind })
  return error ? { ok: false, message: holidayErr(error.message ?? '') } : { ok: true }
}
export async function adminDeleteHoliday(
  date: string, kind: 'holiday' | 'company',
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_delete_holiday', { p_date: date, p_kind: kind })
  return error ? { ok: false, message: holidayErr(error.message ?? '') } : { ok: true }
}
export async function adminGenerateFamilyDays(
  year: number,
): Promise<{ ok: boolean; count?: number; message?: string }> {
  const { data, error } = await supabase.rpc('admin_generate_family_days', { p_year: year })
  if (error) return { ok: false, message: holidayErr(error.message ?? '') }
  return { ok: true, count: Number(data ?? 0) }
}

/** 공휴일 전량 로드 (holidays 테이블 — RLS 전 직원 읽기)
 *  ← [2026-08-03] 법정 공휴일 표기. 실패 시 throw — 캐시 계층(utils/holidays)이
 *    빈 Map 안전값으로 변환한다. 연 수십 행이라 전량 로드가 가장 단순·안전 */
export interface Holiday {
  holiday_date: string
  name: string
  kind: 'holiday' | 'company'   // ← [2026-08-03] company = 패밀리데이·창립기념일 등 회사 이벤트
}
export async function loadHolidays(): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from('holidays')
    .select('holiday_date, name, kind')
    .order('holiday_date')
  if (error) throw error
  return data ?? []
}

/** 도서 예약/대여 구간 (기간만 — 예약자 신원 없음)
 *  ← [2026-07-30] 예약 기간 공개 (20260737). RLS 가 비관리자에 본인 행만 주므로
 *    타인 예약 기간은 이 RPC 가 유일한 경로. 실패 시 [] — 표시만 생략되고
 *    최종 차단은 서버 EXCLUDE 제약이 담당하므로 조회 장애가 대여를 막지 않는다. */
export interface BookReservedPeriod {
  book_id:  number
  start_on: string   // 'YYYY-MM-DD' (KST)
  due_on:   string   // 'YYYY-MM-DD' (KST)
}
export async function loadBookReservedPeriods(): Promise<BookReservedPeriod[]> {
  try {
    const { data, error } = await supabase.rpc('get_book_reserved_periods')
    if (error) throw error
    return (data ?? []).map((r: any) => ({
      book_id: Number(r.book_id), start_on: r.start_on, due_on: r.due_on,
    }))
  } catch (e) {
    console.error('[api] loadBookReservedPeriods 실패(표시 생략):', e)
    return []
  }
}

/** 특정 유저의 진행 중 도서 대여 수 — 즉시 퇴사 확인 모달 프리뷰용 */
export async function countActiveBookLoans(userId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('book_checkouts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('status', ['active', 'overdue'])   // 살아있는 대여 (20260724 체계)
    if (error) throw error
    return count ?? 0
  } catch (e) {
    console.error('[api] countActiveBookLoans 실패:', e)
    return 0
  }
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
      extension_count, last_extended_at, status, penalty_exempt,
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
    penalty_exempt:   r.penalty_exempt ?? false,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  }))
}

/** 연장 RPC 에러 메시지 → 코드 매핑 (Postgres RAISE EXCEPTION 메시지 기반) */
function parseExtendError(message: string): ExtendErrorCode {
  // ← [2026-07-20] 순서 주의: includes 매칭이므로 긴 코드를 먼저 검사해야 한다.
  //   'OVERDUE_TOO_LONG' 메시지는 'OVERDUE' 도 포함하므로,
  //   'OVERDUE' 가 앞에 있으면 항상 잘못된 코드로 매핑된다.
  const codes: ExtendErrorCode[] = [
    'CHECKOUT_NOT_FOUND', 'NOT_OWNER', 'NOT_ACTIVE', 'ALREADY_EXTENDED',
    'OVERDUE_TOO_LONG', 'OVERDUE',
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

/**
 * 연장 RPC + 완료 알림(book_extended)을 묶은 래퍼 (← [2026-07-30])
 *
 *   기존에는 MyBookLoans 가 RPC 호출과 send-notification invoke 를 인라인으로
 *   들고 있었다. 도서관 화면(카드/상세모달)에도 연장 버튼이 생기면서 같은
 *   흐름이 두 곳이 되므로, 다른 도서 액션(adminCheckoutBooksWithNotify 등)과
 *   동일하게 api 로 승격해 payload 구성이 갈라지지 않게 한다.
 *
 *   · 알림 실패는 연장 자체를 되돌리면 안 되므로 catch 로 흡수 (기존 정책 유지)
 *   · 수신자: 본인 1명 (POLICIES.book_extended → recipients='book_borrower')
 */
export async function extendBookCheckoutWithNotify(
  checkoutId: string,
  info: { userId: string; bookTitle: string },
): Promise<ExtendResult> {
  const res = await extendBookCheckout(checkoutId)
  if (!res.ok || !res.row) return res

  supabase.functions.invoke('send-notification', {
    body: {
      type: 'book_extended',
      booking: {
        id:         res.row.id,
        title:      info.bookTitle,
        user_id:    info.userId,
        book_title: info.bookTitle,
        due_at:     res.row.due_at,
      },
    },
  }).catch(err => console.warn('[api] 연장 알림 발송 실패:', err))

  return res
}

/** 연장 실패 코드 → 사용자 안내 문구 */
export function extendErrorMessage(code: ExtendErrorCode): string {
  switch (code) {
    case 'CHECKOUT_NOT_FOUND': return '대여 정보를 찾을 수 없습니다'
    case 'NOT_OWNER':          return '본인 대여만 연장할 수 있습니다'
    case 'NOT_ACTIVE':         return '이미 반납된 도서입니다'
    case 'ALREADY_EXTENDED':   return '이미 연장한 도서입니다 (연장은 1회만 가능)'
    // ← [2026-07-20] 연체 7일 초과 — 연장해도 반납일이 과거라 무의미하므로 차단
    case 'OVERDUE_TOO_LONG':   return '연체 7일이 지나 연장할 수 없습니다. 도서를 반납해주세요'
    // 구 정책(연체=무조건 불가) 잔재. 서버에서 더 이상 발생하지 않지만 방어적으로 유지
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
    'CHECKOUT_AT_OUT_OF_RANGE',   // ← [2026-07-20] 대여일 허용 범위 초과
    // ← [2026-07-21] 자가 대여/예약. includes 매칭이므로 접두사가 겹치는 코드를
    //   추가할 때는 긴 쪽을 앞에 둘 것 (OVERDUE_TOO_LONG 사례와 동일한 함정).
    'CHECKOUT_AT_PAST', 'RESERVE_TOO_FAR', 'PERIOD_CONFLICT', 'ALREADY_STARTED',
    'CHECKOUT_NOT_FOUND', 'NOT_ACTIVE',
    // ← [2026-08-13] 어드민 기한 자유 설정. 'DUE_OUT_OF_RANGE' 는
    //   'CHECKOUT_AT_OUT_OF_RANGE' 와 부분 문자열 관계가 아니므로 순서 무관.
    'NO_DUE_DATE', 'DUE_BEFORE_CHECKOUT', 'DUE_OUT_OF_RANGE',
    'PENALTY_BLOCKED',            // ← [2026-07-21] 연체 제재
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
    case 'NOT_ADMIN':          return '대여 등록 권한이 없습니다'
    case 'NOT_OWNER':          return '본인 예약만 취소할 수 있습니다'
    case 'NO_BORROWER':        return '대여자를 선택해주세요'
    case 'NO_BOOKS':           return '도서를 선택해주세요'
    case 'NOTES_TOO_LONG':     return '메모는 100자까지 입력할 수 있습니다'
    case 'CHECKOUT_AT_OUT_OF_RANGE':
      return `대여일은 오늘 기준 ${detail ?? '365'}일 이내로만 지정할 수 있습니다`
    case 'REASON_TOO_LONG':    return '사유는 200자까지 입력할 수 있습니다'
    case 'ALREADY_REQUESTED':  return '이미 대여 중인 도서입니다'
    case 'BOOK_NOT_FOUND':     return '도서 정보를 찾을 수 없습니다'
    case 'REQUEST_NOT_FOUND':  return '대여 정보를 찾을 수 없습니다'
    case 'NOT_PENDING':        return '이미 처리된 건입니다'
    // ── [2026-07-21] 자가 대여 / 예약 ───────────────────────────────────
    case 'CHECKOUT_AT_PAST':   return '지난 날짜로는 대여할 수 없습니다'
    case 'RESERVE_TOO_FAR':
      return `대여 시작일은 오늘부터 ${detail ?? '3'}일 이내로만 지정할 수 있습니다`
    case 'PERIOD_CONFLICT': {
      // detail = "id:제목"
      const t = (detail ?? '').split(':').slice(1).join(':')
      return t
        ? `"${t}" 은(는) 그 기간에 이미 대여가 잡혀 있습니다. 다른 날짜를 선택해주세요`
        : '해당 기간에 이미 대여가 잡혀 있습니다. 다른 날짜를 선택해주세요'
    }
    case 'ALREADY_STARTED':    return '이미 시작된 대여는 취소할 수 없습니다. 반납 처리해주세요'
    // ── [2026-08-13] 어드민 기한 자유 설정 ──────────────────────────────
    case 'NO_DUE_DATE':        return '반납기한을 선택해주세요'
    case 'DUE_BEFORE_CHECKOUT':return '반납기한은 대여일 다음날 이후로만 지정할 수 있습니다'
    case 'DUE_OUT_OF_RANGE':
      return `반납기한은 오늘 기준 ${detail ?? '365'}일 이내로만 지정할 수 있습니다`
    case 'CHECKOUT_NOT_FOUND': return '대여 정보를 찾을 수 없습니다'
    case 'NOT_ACTIVE':         return '이미 처리된 대여입니다. 목록을 새로고침해주세요'
    // ── [2026-07-21] 연체 제재. detail = "tier:해제일(YYYY-MM-DD, 없으면 빈값)"
    case 'PENALTY_BLOCKED': {
      const [tier, until] = (detail ?? '').split(':')
      if (tier === 'overdue_now')
        return '연체 중인 도서가 있어 대여할 수 없습니다. 반납 후 이용해주세요'
      if (tier === 'permanent')
        return '연체 누적으로 대여가 영구 제한되었습니다. 도서 관리자에게 문의해주세요'
      return until
        ? `연체 제재로 ${until} 까지 대여할 수 없습니다`
        : '연체 제재로 대여할 수 없습니다'
    }
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
    // ← [2026-07-21] 어드민 연체 관리 탭의 '면제' 토글이 현재 상태를 알아야 한다
    penalty_exempt:    r.penalty_exempt ?? false,
    // ← [2026-07-23] 대여 생성순 조회/정렬용. select 에 없으면 undefined 로 남는다
    created_at:        r.created_at ?? undefined,
  }
}

/** [Admin] 도서 대여 등록 — 여러 권 동시, 단일 트랜잭션
 *  ← [2026-08-13] admin_checkout_books_v2 로 전환 (20260746).
 *    v2 는 기존 admin_checkout_books 를 내부 호출한 뒤 같은 트랜잭션에서
 *    기한만 교체한다 — dueOn 미지정이면 기존과 완전 동일(기본 7일). */
export async function adminCheckoutBooks(
  userId: string, bookIds: number[], notes?: string | null,
  /** ← [2026-07-20] 대여일(ISO). 미지정 시 서버가 등록 시각을 쓴다. */
  checkoutAt?: string | null,
  /** ← [2026-08-13] 반납기한('YYYY-MM-DD'). 미지정 시 대여일 +7일(서버 기본). */
  dueOn?: string | null,
): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('admin_checkout_books_v2', {
    p_user_id:     userId,
    p_book_ids:    bookIds,
    p_notes:       notes ?? null,
    p_checkout_at: checkoutAt ?? null,
    p_due_on:      dueOn ?? null,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  return { ok: true, rows: (data ?? []).map(toLoanRow) }
}

/** [Admin] 반납기한 자유 변경 — admin_set_book_due (20260746)
 *  연장/단축 모두 가능, 횟수 제한 없음. extension_count 는 건드리지 않으므로
 *  사용자의 셀프 연장 1회권이 보존된다. 겹침은 서버가 최종 강제(PERIOD_CONFLICT). */
export async function adminSetBookDue(
  checkoutId: string,
  /** 'YYYY-MM-DD' — 최소 대여일 +1일, 최대 오늘 +365일 */
  dueOn: string,
  /* strict:false 환경에선 판별 유니언의 truthiness 축소가 동작하지 않아
   * (CheckoutResult 와 동일하게) 단일 형태 + 옵셔널 필드로 반환한다. */
): Promise<{ ok: boolean; row?: MyBookLoan; code?: CheckoutErrorCode; detail?: string }> {
  const { data, error } = await supabase.rpc('admin_set_book_due', {
    p_checkout_id: checkoutId,
    p_due_on:      dueOn,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  return { ok: true, row: toLoanRow(data) }
}

// ─────────────────────────────────────────────────────────────────────────────
// [2026-07-21] 승인 플로우 폐지 — 아래 5개 래퍼를 제거했다.
//   requestBookCheckout / approveBookRequest / rejectBookRequest /
//   cancelBookRequest / fetchPendingBookRequests
//   (대응 RPC 는 20260724_book_self_checkout.sql 에서 DROP 됨)
//
// 대체 경로
//   자가 대여  → userCheckoutBooksWithNotify
//   예약 취소  → cancelBookCheckout
// ─────────────────────────────────────────────────────────────────────────────


// ═════════════════════════════════════════════════════════════════════════════
// [2026-07-23] 어드민 '도서 관리' 탭 전용 API
//
// 설계 원칙
//   ① PostgREST 기본 max-rows(1000) 무음 절단을 반드시 페이징 루프로 회피한다.
//      도서는 현재 300권 수준이지만 대여 이력은 누적되므로 1000행을 넘는다.
//      절단은 오류를 내지 않고 "그냥 적게 오는" 형태라 통계가 조용히 틀어진다.
//      (loadBookings 에서 이미 같은 사고를 겪었고 동일 패턴으로 해결했다)
//   ② 상태 전이는 SECURITY DEFINER RPC 경유. 클라 직접 UPDATE 금지.
//   ③ 대여자 이름/부서는 저장하지 않는다. users 배열에서 live 조회한다.
//      (퇴사·부서이동 시 스냅샷이 낡는 문제 — 회의실 모듈과 동일 원칙)
// ═════════════════════════════════════════════════════════════════════════════

/** PostgREST 기본 max-rows. 이 값 단위로 페이징한다. */
const BOOK_PAGE_SIZE = 1000

/** 대여 이력 기간 조회의 기준 컬럼 (← [2026-07-23] 'created_at' 추가) */
export type BookLoanDateField = 'checkout_at' | 'created_at' | 'requested_at'

/**
 * 전체 도서 목록 (카테고리 조인) — 페이징 루프 적용
 *
 * LibraryPage 의 load() 는 .range() 없이 select 하므로 도서가 1000권을 넘으면
 * 조용히 잘린다. 어드민은 "전량"을 다루는 화면이라 여기서는 반드시 페이징한다.
 */
export async function loadAllBooks(): Promise<Book[]> {
  const rows: any[] = []
  let start = 0
  while (true) {
    const { data, error } = await supabase
      .from('books')
      .select('*, category:book_categories(id, name, parent_id, sort_order)')
      .order('id', { ascending: true })
      .range(start, start + BOOK_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < BOOK_PAGE_SIZE) break
    start += BOOK_PAGE_SIZE
  }
  return rows as Book[]
}

/** 도서 카테고리 전체 */
export async function loadBookCategories(): Promise<BookCategory[]> {
  const { data, error } = await supabase
    .from('book_categories')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as BookCategory[]
}

/**
 * 기간별 대여 이력 (전체 사용자) — 관리자 전용
 *
 * @param from 'YYYY-MM-DD' (KST 00:00 부터)
 * @param to   'YYYY-MM-DD' (KST 23:59:59 까지 — 종료일 당일 포함)
 * @param dateField 기간 판정 기준 컬럼
 *        'checkout_at'  = 대여일 기준 (기본. "그 기간에 빌려간 건")
 *        'created_at'   = 생성일 기준 (← [2026-07-23] "그 기간에 접수된 건")
 *        'requested_at' = 신청일 기준 (폐지된 승인 플로우의 리드타임 분석용)
 *
 * ★ 'created_at' 이 필요한 이유
 *   대여일은 사용자가 고르는 값이라 최대 3일 뒤 미래일 수 있다. 오늘 접수된
 *   예약이 checkout_at 기준 조회(기본 기간 = 오늘까지)에서는 **아예 빠진다**.
 *   "방금 들어온 대여"를 보려면 생성 시각으로 조회해야 한다.
 *   정렬도 이 컬럼을 따른다(서버 ORDER BY dateField DESC).
 *
 * 반환은 status 제한 없이 전량이다(pending/rejected/cancelled 포함).
 * 화면에서 목적에 맞게 필터한다 — 서버 쿼리를 목적별로 쪼개면 같은 기간에
 * 대해 서로 다른 모수가 만들어져 통계가 어긋난다.
 *
 * ※ RLS(book_checkouts_select_self_or_admin): 비관리자가 호출하면 본인 행만
 *   돌아온다. 오류가 아니라 "적게 오는" 형태이므로 호출부는 반드시 관리자
 *   화면에서만 사용해야 한다.
 */
export async function loadBookCheckoutsByRange(
  from: string,
  to: string,
  dateField: BookLoanDateField = 'checkout_at',
): Promise<AdminBookLoan[]> {
  // KST 경계를 명시적으로 ISO 로 변환한다.
  // 'YYYY-MM-DD' 를 그대로 넘기면 UTC 자정으로 해석돼 KST 기준 9시간이 밀린다.
  const fromISO = new Date(`${from}T00:00:00+09:00`).toISOString()
  const toISO   = new Date(`${to}T23:59:59.999+09:00`).toISOString()

  const rows: any[] = []
  let start = 0
  while (true) {
    const { data, error } = await supabase
      .from('book_checkouts')
      .select(`
        id, book_id, user_id, checkout_at, due_at, returned_at,
        extension_count, last_extended_at, status, notes,
        requested_at, processed_at, processed_by_name, reject_reason, penalty_exempt,
        created_at,
        books ( title, author, publisher, cover_url )
      `)
      .gte(dateField, fromISO)
      .lte(dateField, toISO)
      .order(dateField, { ascending: false })
      .range(start, start + BOOK_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < BOOK_PAGE_SIZE) break
    start += BOOK_PAGE_SIZE
  }

  return rows.map((r: any): AdminBookLoan => ({
    ...toLoanRow(r),
    user_id: r.user_id,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  }))
}

/**
 * 미반납 대여 전량 (기간 무관) — 연체 관리 탭 전용
 *
 * 연체는 "조회 기간"과 무관한 개념이다. 6개월 전에 빌려간 책이 아직
 * 안 들어왔다면 이번 달 기간 필터에서 빠져 화면에서 사라진다. 그래서
 * 연체 탭만 기간 필터를 적용하지 않고 status 기준으로 전량을 가져온다.
 */
export async function loadOutstandingBookLoans(): Promise<AdminBookLoan[]> {
  const rows: any[] = []
  let start = 0
  while (true) {
    const { data, error } = await supabase
      .from('book_checkouts')
      .select(`
        id, book_id, user_id, checkout_at, due_at, returned_at,
        extension_count, last_extended_at, status, notes,
        requested_at, processed_at, processed_by_name, reject_reason, penalty_exempt,
        created_at,
        books ( title, author, publisher, cover_url )
      `)
      .in('status', ['active', 'overdue'])
      .order('due_at', { ascending: true })
      .range(start, start + BOOK_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < BOOK_PAGE_SIZE) break
    start += BOOK_PAGE_SIZE
  }

  return rows.map((r: any): AdminBookLoan => ({
    ...toLoanRow(r),
    user_id: r.user_id,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  }))
}

// ─── 반납 / 분실 처리 ─────────────────────────────────────────────────────────

/** admin_return_book RPC 에러 메시지 → 코드 */
function parseReturnError(message: string): BookReturnErrorCode {
  const codes: BookReturnErrorCode[] = [
    'NOT_AUTHENTICATED', 'NOT_ADMIN', 'INVALID_ACTION',
    'CHECKOUT_NOT_FOUND', 'NOT_ACTIVE',
  ]
  return codes.find(c => message.includes(c)) ?? 'UNKNOWN'
}

/** 반납/분실 실패 코드 → 사용자 안내 문구 */
export function returnErrorMessage(code: BookReturnErrorCode): string {
  switch (code) {
    case 'NOT_AUTHENTICATED': return '로그인이 필요합니다'
    case 'NOT_ADMIN':         return '반납 처리 권한이 없습니다'
    case 'INVALID_ACTION':    return '잘못된 처리 요청입니다'
    case 'CHECKOUT_NOT_FOUND':return '대여 정보를 찾을 수 없습니다'
    // 다른 관리자가 먼저 처리했거나 이미 종결된 건
    case 'NOT_ACTIVE':        return '이미 처리된 대여입니다. 목록을 새로고침해주세요'
    default:                  return '처리에 실패했습니다. 잠시 후 다시 시도해주세요'
  }
}

export interface ReturnResult {
  ok:    boolean
  row?:  AdminBookLoan
  code?: BookReturnErrorCode
}

/**
 * [Admin] 반납 / 분실 처리 — admin_return_book RPC 경유
 *
 * 왜 RPC 인가 (임시방편 배제):
 *   반납은 book_checkouts 와 books 두 테이블을 함께 바꿔야 성립한다.
 *   클라이언트에서 UPDATE 를 두 번 보내면 사이에 실패가 끼어들 수 있고,
 *   그 결과 "대여기록은 반납완료인데 도서는 대여중"인 행이 남는다.
 *   이 상태는 화면상 반납 버튼도 나오지 않아 관리자가 복구할 수 없다.
 *   재시도/보정 코드로 덮지 않고, 두 UPDATE 를 하나의 트랜잭션으로 묶는다.
 */
export async function adminReturnBook(
  checkoutId: string,
  action: BookReturnAction = 'return',
): Promise<ReturnResult> {
  const { data, error } = await supabase.rpc('admin_return_book', {
    p_checkout_id: checkoutId,
    p_action:      action,
  })
  if (error) return { ok: false, code: parseReturnError(error.message ?? '') }
  const r: any = Array.isArray(data) ? data[0] : data
  if (!r) return { ok: false, code: 'UNKNOWN' }

  // ── [2026-07-21] 반납으로 제재가 확정됐으면 알림 발송 ────────────────────
  //
  //   admin_return_book 은 book_checkouts 행만 반환하므로 여기서는
  //   "제재가 생겼는지" 를 알 수 없다. 같은 공식으로 다시 계산할 수도 있지만
  //   그러면 'DB 가 만든 사실' 과 '화면이 추측한 사실' 두 갈래가 생기고,
  //   어긋나는 순간 제재가 없는데 제재 안내 메일이 나간다.
  //   실제로 생성된 행을 읽어서 보낸다.
  //
  //   분실(lost)은 제재 대상이 아니므로 조회 자체를 하지 않는다.
  if (action === 'return') {
    void notifyPenaltyApplied(checkoutId)
  }

  return { ok: true, row: { ...toLoanRow(r), user_id: r.user_id } }
}

/** 반납 직후 생성된 제재를 읽어 book_penalty_applied 발송 (실패해도 반납은 성립) */
async function notifyPenaltyApplied(checkoutId: string): Promise<void> {
  try {
    const { data, error } = await supabase.rpc('get_book_penalty_by_checkout', {
      p_checkout_id: checkoutId,
    })
    if (error) { console.warn('[api] 제재 조회 실패:', error.message); return }

    const p: any = Array.isArray(data) ? data[0] : data
    if (!p) return                       // 제재 없음 = 기한 내 반납. 정상 경로다

    await supabase.functions.invoke('send-notification', {
      body: {
        type: 'book_penalty_applied',
        booking: {
          // ★ 딥링크 규약: 도서 알림의 booking_id 는 book_checkouts.id 다.
          //   penalty_id 를 넣으면 클릭했을 때 대여 건을 못 찾아 빈 화면이 뜬다.
          id:                checkoutId,
          title:             p.book_title ?? '(제목 없음)',
          user_id:           p.user_id,
          book_title:        p.book_title ?? '(제목 없음)',
          penalty_tier:      p.tier,
          penalty_over_days: p.overdue_days,
          penalty_until_kst: p.ends_at
            ? new Date(p.ends_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' })
            : undefined,
        },
      },
    })
  } catch (e) {
    // 알림 실패가 반납을 되돌리지는 않는다. 로그만 남긴다.
    console.warn('[api] 제재 알림 발송 실패:', e)
  }
}

// ─── 도서 마스터 저장 / 삭제 / 일괄등록 ───────────────────────────────────────
//
// [2026-07-23] LibraryPage 의 handleSaveBook / handleDelete / handleImport 내부
//   DB 로직을 그대로 옮겨왔다. 어드민 '도서 관리' 탭이 같은 동작을 해야 하는데,
//   화면마다 payload 를 각자 만들면 아래 규칙들이 한쪽에서만 지켜진다.
//
//     · acquired_at 은 'YYYY-MM' 입력을 'YYYY-MM-01' 로 보정해야 한다
//     · new_until 은 체크 해제 시 반드시 null 로 덮어써야 라벨이 실제로 내려간다
//     · borrowed 상태 도서는 status 를 건드리면 안 된다 (반납 처리 경로로만 변경)
//     · 카카오 표지는 CDN URL 을 그대로 쓰면 안 되고 Storage 로 옮겨야 한다
//
//   실제로 이 규칙들은 각각 별도 hotfix 로 들어온 것들이라 복제 시 누락 위험이
//   가장 큰 부분이다. 호출부는 상태/토스트만 담당하고 규칙은 여기 한 곳에 둔다.

/**
 * 카카오 표지 → Supabase Storage 영구 저장
 * Kakao CDN URL 은 외부 도메인 <img> 가 차단되므로 Storage 로 옮겨야 한다.
 * 실패해도 도서 저장 자체는 성립하므로 throw 하지 않고 경고만 남긴다.
 */
async function applyKakaoCoverToStorage(bookId: number, kakaoItem: any): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('search-book', {
      body: { action: 'apply', book_id: bookId, kakao: kakaoItem },
    })
    if (error) console.warn('[api] 표지 Storage 저장 실패:', error.message)
  } catch (e) {
    console.warn('[api] 표지 Storage 저장 오류:', e)
  }
}

/**
 * 도서 추가/수정 저장
 * @param form     편집 폼 값
 * @param existing 기존 도서 (null 이면 신규 추가)
 * @param kakaoItem 카카오 검색으로 선택한 항목 (있으면 표지를 Storage 로 이관)
 * @returns 저장된 도서 id
 */
export async function persistBook(
  form: BookEditForm,
  existing: Book | null,
  kakaoItem?: any,
): Promise<number> {
  const isNew = existing === null

  const payload: any = {
    title:       form.title.trim(),
    author:      form.author.trim() || null,
    publisher:   form.publisher.trim() || null,
    isbn:        form.isbn.trim() || null,
    // cover_url 은 kakaoItem 이 있을 때 null 로 초기화한다.
    //   → applyKakaoCoverToStorage() 가 Storage URL 로 다시 채운다.
    //   → kakaoItem 이 없을 때만 수동 입력 URL 을 그대로 쓴다.
    cover_url:   kakaoItem ? null : (form.cover_url.trim() || null),
    category_id: form.category_id ? parseInt(form.category_id) : null,
    acquired_at: form.acquired_at ? `${form.acquired_at}-01` : null,
    // 체크 해제 시 반드시 null 로 덮어써야 ⭐NEW⭐ 라벨이 실제로 내려간다
    new_until:   form.is_new && form.new_until ? form.new_until : null,
    notes:       form.notes.trim() || null,
    updated_at:  new Date().toISOString(),
  }

  if (isNew) {
    payload.status = 'available'
  } else if (existing!.status !== 'borrowed') {
    // 대여중 도서의 status 는 반납 처리 경로(admin_return_book)로만 바뀐다
    payload.status = form.status
  }

  if (isNew) {
    const { data, error } = await supabase
      .from('books').insert(payload).select('id').single()
    if (error) throw new Error(error.message)
    const newId = data!.id as number
    if (kakaoItem) await applyKakaoCoverToStorage(newId, kakaoItem)
    return newId
  }

  const bookId = existing!.id
  const { error } = await supabase.from('books').update(payload).eq('id', bookId)
  if (error) throw new Error(error.message)
  if (kakaoItem) await applyKakaoCoverToStorage(bookId, kakaoItem)
  return bookId
}

/** deleteBookRecord 결과 — 이력이 있어 차단된 경우를 오류가 아닌 상태로 반환 */
export interface DeleteBookResult {
  ok:      boolean
  blocked: boolean   // true = 대여 이력이 있어 삭제 차단됨
}

/**
 * 도서 삭제
 * 대여 이력(반납분 포함)이 하나라도 있으면 FK 제약으로 삭제할 수 없다.
 * DB 오류로 터뜨리지 않고 사전 확인 후 blocked 로 돌려준다 —
 * 운영상 정답은 삭제가 아니라 상태를 '분실'로 바꾸는 것이기 때문이다.
 */
export async function deleteBookRecord(bookId: number): Promise<DeleteBookResult> {
  const { count, error: cErr } = await supabase
    .from('book_checkouts')
    .select('id', { count: 'exact', head: true })
    .eq('book_id', bookId)
  if (cErr) throw new Error(cErr.message)
  if ((count ?? 0) > 0) return { ok: false, blocked: true }

  const { error } = await supabase.from('books').delete().eq('id', bookId)
  if (error) throw new Error(error.message)
  return { ok: true, blocked: false }
}

/** importBookRows 결과 */
export interface ImportBooksResult {
  success: number
  errors:  string[]
}

/**
 * CSV 일괄 등록 — 50건 배치 insert
 * 일부 배치가 실패해도 나머지는 계속 진행하고, 결과를 합산해 돌려준다.
 * (전량 롤백하면 수백 건 중 한 줄 때문에 다시 처음부터 해야 한다)
 */
export async function importBookRows(rows: any[]): Promise<ImportBooksResult> {
  const BATCH = 50
  let success = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await supabase.from('books').insert(
      batch.map((r: any) => ({
        title:       r.title,
        author:      r.author,
        publisher:   r.publisher,
        isbn:        r.isbn,
        category_id: r.category_id,
        // 'YYYY-MM' → 'YYYY-MM-01' 보정 (date 컬럼)
        acquired_at: r.acquired_at ? (r.acquired_at.length === 7 ? `${r.acquired_at}-01` : r.acquired_at) : null,
        // 일괄 등록은 ⭐NEW⭐ 미지정 — 등록 후 편집에서 개별 설정
        new_until:   null,
        notes:       r.notes,
        status:      'available',
      }))
    )
    if (error) errors.push(error.message)
    else success += batch.length
  }
  return { success, errors }
}

// ─── 대여 등록 / 승인 / 거절 + 알림 발송 (화면 공용) ──────────────────────────
//
// [2026-07-23] LibraryPage 의 handleCheckout / handleApprove / handleReject 에
//   들어 있던 "RPC 호출 + send-notification 페이로드 조립"을 그대로 옮겼다.
//
//   알림 페이로드는 필드 이름 하나만 달라도 인앱 본문이 "제목 · · " 처럼 깨진다
//   (2026-07-20 에 실제로 겪은 결함). 화면이 늘어날 때마다 페이로드를 복제하면
//   같은 사고가 반복되므로, 발송 규칙을 한 곳에 고정한다.
//
//   알림 발송은 의도적으로 await 하지 않는다. 메일 게이트웨이 지연 때문에
//   대여 등록 자체가 느려지면 안 되고, 실패해도 대여는 이미 성립했기 때문이다.

/** 여러 권을 한 통으로 묶는 제목 라벨 — '자바스크립트 외 2권' */
function joinBookTitles(titles: string[]): string {
  const list = titles.filter(Boolean)
  if (list.length === 0) return ''
  return list.length > 1 ? `${list[0]} 외 ${list.length - 1}권` : list[0]
}

export interface AdminCheckoutOutcome extends CheckoutResult {
  /** 미래 날짜 예약이라 '대여 확정' 알림을 보내지 않은 경우 true */
  deferredNotify?: boolean
}

/**
 * [Admin] 대여 등록 + book_borrowed 알림
 *
 * @param checkoutAt 'YYYY-MM-DD' (선택). 지정 시 그 날 정오(KST)로 고정해 전송한다.
 *   자정으로 보내면 타임존 경계에서 하루 밀릴 수 있고, 정오면 ±12시간 여유가 있다.
 * @param titles 알림 문구에 쓸 도서 제목들 (호출부의 books 배열에서 해석해 전달)
 */
export async function adminCheckoutBooksWithNotify(
  userId: string,
  bookIds: number[],
  notes: string,
  titles: string[],
  checkoutAt?: string,
  /** ← [2026-08-13] 반납기한('YYYY-MM-DD'). 미지정 시 대여일 +7일(서버 기본). */
  dueOn?: string,
): Promise<AdminCheckoutOutcome> {
  const checkoutIso = checkoutAt
    ? new Date(`${checkoutAt}T12:00:00+09:00`).toISOString()
    : null

  const res = await adminCheckoutBooks(userId, bookIds, notes, checkoutIso, dueOn ?? null)
  if (!res.ok) return res

  const label = joinBookTitles(titles)
  const due   = res.rows?.[0]?.due_at

  // 미래 날짜로 등록(예약)한 경우 '대여 확정' 알림을 보내지 않는다.
  //   book_borrowed 는 "지금 대여되었습니다" 문구다. 아직 시작하지 않은 예약에
  //   이 메일이 나가면 대여자가 오늘 책을 받은 것으로 오해한다.
  //   ※ 시작일 자동 통지는 book-due-reminder cron 에 '대여 시작' 타입과
  //     notified_started 컬럼을 추가해야 한다 (별도 작업 — 미구현).
  // ← [2026-07-23] 관리자 통지는 시작 시점과 무관하게 항상 보낸다.
  //   대여자에게는 '대여 확정' 을 미루지만, 관리자에게는 접수 사실 자체가 필요하다.
  notifyBookAdminsCheckoutCreated(res.rows ?? [], label, userId)

  const startsInFuture = !!checkoutAt && checkoutAt > todayKSTStr()
  if (startsInFuture) return { ...res, deferredNotify: true }

  supabase.functions.invoke('send-notification', {
    body: {
      type: 'book_borrowed',
      booking: {
        id:           res.rows?.[0]?.id ?? '',
        title:        label,
        user_id:      userId,
        book_title:   label,
        due_at:       due,
        due_date_kst: due ? String(due).slice(0, 10) : undefined,
      },
    },
  }).catch(err => console.warn('[api] 대여 알림 발송 실패:', err))

  return { ...res, deferredNotify: false }
}

/** 오늘(KST) 'YYYY-MM-DD' — libraryListShared.todayKST 와 동일 규칙.
 *  lib 계층이 components 를 import 하면 순환이 생기므로 여기서 계산한다. */
function todayKSTStr(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

/** ISO → KST 'YYYY-MM-DD' (utils/bookLoan.kstDateStr 와 동일 식) */
function toKstDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * [2026-07-23] 대여 접수 → 도서 담당 관리자 통지 (메일 + 인앱)
 *
 * ★ 왜 별도 타입인가
 *   book_borrowed 는 대여자 본인용 문구("도서가 대여되었습니다")다. 수신자 규칙도
 *   book_borrower 라 관리자에게 보낼 수 없다. 같은 사건이지만 수신자와 문구가
 *   다르므로 타입을 나누는 것이 이 시스템의 기존 규칙(POLICIES 단위 = 수신자+문구)이다.
 *
 * ★ 미래 예약도 보낸다
 *   대여자에게는 시작 전 '대여 확정' 알림을 보내지 않지만(아직 책을 받지 않았다),
 *   관리자에게는 "예약이 접수됐다" 는 사실 자체가 필요하다. 대여일을 본문에 실어
 *   언제부터 나가는 책인지 구분하게 한다.
 *
 * ★ 실패해도 대여는 성립한다
 *   await 하지 않는다. 메일 게이트웨이 지연으로 대여 등록이 느려지면 안 되고,
 *   알림 실패가 이미 성립한 대여를 되돌리지도 않는다. (기존 book_borrowed 와 동일)
 *
 * 딥링크 규약: booking.id 는 **항상 book_checkouts.id** — 알림 클릭 시
 * NotificationBell 이 'book_' 접두사를 보고 BookLoanDetailModal 로 연결한다.
 */
function notifyBookAdminsCheckoutCreated(
  rows: MyBookLoan[], label: string, borrowerUserId: string,
): void {
  const first = rows[0]
  if (!first) return

  supabase.functions.invoke('send-notification', {
    body: {
      type: 'book_checkout_created',
      booking: {
        id:                first.id,
        title:             label,
        user_id:           borrowerUserId,     // 수신자가 아니라 '주체'(대여자) — 본문 대여자 행
        book_title:        label,
        due_at:            first.due_at,
        due_date_kst:      toKstDate(first.due_at),
        // 화면이 고른 날짜가 아니라 DB 가 확정한 checkout_at 을 쓴다.
        // 즉시 대여는 화면에 날짜 입력이 없어 서버 값만이 유일한 사실이다.
        checkout_date_kst: toKstDate(first.checkout_at),
      },
    },
  }).catch(err => console.warn('[api] 대여 접수 관리자 알림 실패:', err))
}


// ─── [사용자] 자가 대여 / 예약 (← [2026-07-21]) ───────────────────────────────
//
// 승인 플로우가 폐지되면서 사용자가 직접 대여를 성립시킨다.
// 서버 RPC(user_checkout_books)가 본인 확인·한도·예약 범위·기간 겹침을 모두
// 검증하므로 화면은 입력만 모아 넘긴다. 화면에서 한 번 더 막는 것은 UX 용이며,
// 최종 강제는 서버와 EXCLUDE 제약이 담당한다.

/**
 * 사용자 대여 — user_checkout_books RPC + book_borrowed 알림
 *
 * @param checkoutAt 'YYYY-MM-DD' (선택). 미지정 시 즉시 대여.
 *   지정 시 그 날 정오(KST)로 고정해 보낸다 — 자정으로 보내면 타임존 경계에서
 *   하루 밀리고, 정오면 ±12시간 여유가 생긴다(관리자 경로와 동일 규칙).
 * @param titles 알림 문구용 도서 제목 (호출부가 books 배열에서 해석해 전달)
 */
export async function userCheckoutBooksWithNotify(
  bookIds: number[],
  notes: string,
  titles: string[],
  checkoutAt?: string,
): Promise<AdminCheckoutOutcome> {
  const checkoutIso = checkoutAt
    ? new Date(`${checkoutAt}T12:00:00+09:00`).toISOString()
    : null

  const { data, error } = await supabase.rpc('user_checkout_books', {
    p_book_ids:    bookIds,
    p_notes:       notes || null,
    p_checkout_at: checkoutIso,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }

  const rows = (data ?? []).map(toLoanRow)
  const label = joinBookTitles(titles)
  const due   = rows[0]?.due_at

  // 미래 시작 예약에는 '대여 확정' 알림을 보내지 않는다.
  //   book_borrowed 는 "지금 대여되었습니다" 문구다. 시작일이 오면
  //   book-due-reminder 배치가 book_started 알림을 보낸다.
  // ← [2026-07-23] 관리자 통지 (예약 포함 — 위 관리자 경로와 동일 규칙)
  notifyBookAdminsCheckoutCreated(rows, label, rows[0]?.user_id ?? '')

  const startsInFuture = !!checkoutAt && checkoutAt > todayKSTStr()
  if (startsInFuture) return { ok: true, rows, deferredNotify: true }

  supabase.functions.invoke('send-notification', {
    body: {
      type: 'book_borrowed',
      booking: {
        id:           rows[0]?.id ?? '',
        title:        label,
        user_id:      rows[0]?.user_id ?? '',
        book_title:   label,
        due_at:       due,
        due_date_kst: due ? String(due).slice(0, 10) : undefined,
      },
    },
  }).catch(err => console.warn('[api] 대여 알림 발송 실패:', err))

  return { ok: true, rows, deferredNotify: false }
}

/**
 * [본인] 예약 취소 — cancel_book_checkout RPC
 *
 * 시작 전 예약만 취소할 수 있다. 이미 시작된 대여는 책이 물리적으로 나가 있어
 * 취소가 아니라 반납으로 처리해야 하며, 서버가 ALREADY_STARTED 로 막는다.
 */
export async function cancelBookCheckout(checkoutId: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.rpc('cancel_book_checkout', {
    p_checkout_id: checkoutId,
  })
  if (error) return { ok: false, ...parseCheckoutError(error.message ?? '') }
  const r = Array.isArray(data) ? data[0] : data
  return r ? { ok: true, rows: [toLoanRow(r)] } : { ok: false, code: 'UNKNOWN' }
}


// ─── 연체 패널티 (← [2026-07-21]) ─────────────────────────────────────────────
//
// 차단의 최종 강제는 서버(user_checkout_books / admin_checkout_books)가 한다.
// 아래 조회는 "왜 못 빌리는지 미리 알려주기" 위한 것이다. 화면에서만 막고
// 서버가 안 막으면 RPC 직접 호출로 우회되고, 반대로 서버만 막으면 사용자가
// 버튼을 눌러보고 나서야 이유를 알게 된다. 둘 다 필요하다.

/** 내 대여 차단 상태 — my_book_penalty_state RPC */
export async function fetchMyPenaltyState(): Promise<BookPenaltyState> {
  const { data, error } = await supabase.rpc('my_book_penalty_state')
  if (error) {
    // 제재 조회 실패가 도서관 화면 전체를 막지 않게 한다.
    // 차단 여부는 서버가 대여 시점에 다시 검사하므로 안전 측 기본값은 '차단 아님'.
    console.warn('[api] 제재 상태 조회 실패:', error.message)
    return { blocked: false, tier: null, blockedUntil: null, overdueDays: 0, reason: null }
  }
  const r = Array.isArray(data) ? data[0] : data
  return {
    blocked:      !!r?.blocked,
    tier:         r?.tier ?? null,
    blockedUntil: r?.blocked_until ?? null,
    overdueDays:  r?.overdue_days ?? 0,
    reason:       r?.reason ?? null,
  }
}

/** 특정 사용자의 차단 상태 — 관리자 대여 등록 모달에서 대여자 선택 시 */
export async function fetchUserPenaltyState(userId: string): Promise<BookPenaltyState> {
  const { data, error } = await supabase.rpc('book_penalty_state', { p_user_id: userId })
  if (error) {
    console.warn('[api] 제재 상태 조회 실패:', error.message)
    return { blocked: false, tier: null, blockedUntil: null, overdueDays: 0, reason: null }
  }
  const r = Array.isArray(data) ? data[0] : data
  return {
    blocked:      !!r?.blocked,
    tier:         r?.tier ?? null,
    blockedUntil: r?.blocked_until ?? null,
    overdueDays:  r?.overdue_days ?? 0,
    reason:       r?.reason ?? null,
  }
}

/** [Admin] 제재 목록 — activeOnly=false 면 해제·만료분까지 (이력 조회) */
export async function adminListBookPenalties(
  activeOnly = true,
): Promise<AdminBookPenalty[]> {
  const { data, error } = await supabase.rpc('admin_list_book_penalties', {
    p_active_only: activeOnly,
  })
  if (error) throw new Error(error.message)
  return (data ?? []) as AdminBookPenalty[]
}

/** [Admin] 제재 해제 — 삭제가 아니라 revoked_* 기록 (근거 보존) */
export async function revokeBookPenalty(
  penaltyId: string, reason?: string,
): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc('admin_revoke_book_penalty', {
    p_penalty_id: penaltyId,
    p_reason:     reason || null,
  })
  if (!error) {
    // ── [2026-07-21] 해제 알림 ───────────────────────────────────────────
    //   still_blocked 이면 보내지 않는다. 30일 제재가 남아 있는데
    //   "대여 제한이 해제되었습니다" 를 보내면 사용자가 대여를 시도했다가
    //   다시 막힌다 — 알림이 거짓말이 되는 경우다.
    const p: any = Array.isArray(data) ? data[0] : data
    if (p && !p.still_blocked) {
      supabase.functions.invoke('send-notification', {
        body: {
          type: 'book_penalty_cleared',
          booking: {
            // ★ 딥링크 규약 — book_checkouts.id (penalty_id 아님)
            id:           p.checkout_id ?? p.penalty_id,
            title:        p.book_title ?? '도서 대여',
            user_id:      p.user_id,
            book_title:   p.book_title ?? '',
            penalty_tier: p.tier,
            // 해제 알림에는 until 을 싣지 않는다 — 이미 풀렸으므로
          },
        },
      }).catch(err => console.warn('[api] 제재 해제 알림 실패:', err))
    }
    return { ok: true }
  }

  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))        return { ok: false, message: '제재 해제 권한이 없습니다' }
  if (m.includes('ALREADY_REVOKED'))  return { ok: false, message: '이미 해제된 제재입니다' }
  if (m.includes('PENALTY_NOT_FOUND'))return { ok: false, message: '제재 정보를 찾을 수 없습니다' }
  if (m.includes('REASON_TOO_LONG'))  return { ok: false, message: '사유는 200자까지 입력할 수 있습니다' }
  return { ok: false, message: `해제 실패: ${m}` }
}

/**
 * [Admin] 진행 중 연체 건 개별 면제
 *
 * 확정 제재(book_penalties)가 아니라 대여 건 자체를 제재 대상에서 빼는 것이다.
 * 아직 반납하지 않아 제재 행이 없는 상태에서는 이 경로로만 풀 수 있다.
 */
export async function adminExemptCheckout(
  checkoutId: string, exempt = true,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_exempt_book_checkout', {
    p_checkout_id: checkoutId,
    p_exempt:      exempt,
  })
  if (!error) return { ok: true }
  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))          return { ok: false, message: '면제 권한이 없습니다' }
  if (m.includes('CHECKOUT_NOT_FOUND')) return { ok: false, message: '대여 정보를 찾을 수 없습니다' }
  return { ok: false, message: `면제 실패: ${m}` }
}


// ─── 대여 단건 조회 (← [2026-07-21]) ─────────────────────────────────────────
//
// 알림을 클릭했을 때 쓰는 경로다. App 은 book_checkouts 목록을 들고 있지 않고
// (도서관 화면에서만 로드한다), 알림은 어느 화면에서나 열릴 수 있으므로
// id 하나로 대여 건을 직접 가져올 수단이 필요하다.
//
// RLS 가 본인 건 또는 관리자만 허용하므로 권한 검사를 따로 하지 않는다.
// 권한이 없으면 0행이 오고, 호출부가 "정보를 찾을 수 없습니다" 로 처리한다.
export async function fetchBookLoanById(
  checkoutId: string,
): Promise<AdminBookLoan | null> {
  if (!checkoutId) return null

  const { data, error } = await supabase
    .from('book_checkouts')
    .select(`
      id, book_id, user_id, checkout_at, due_at, returned_at,
      extension_count, last_extended_at, status, notes, penalty_exempt,
      requested_at, processed_at, processed_by_name, reject_reason,
      created_at,
      books ( title, author, publisher, cover_url )
    `)
    .eq('id', checkoutId)
    .maybeSingle()

  if (error) {
    console.warn('[api] 대여 단건 조회 실패:', error.message)
    return null
  }
  if (!data) return null

  const r: any = data
  return {
    ...toLoanRow(r),
    user_id: r.user_id,
    book: Array.isArray(r.books) ? (r.books[0] ?? null) : (r.books ?? null),
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// [2026-07-23] 알림 설정 — 채널 on/off + 관리자 수신자 지정
//
// 설계 원칙
//   ① 미설정 = 켜짐 (fail-open). 화면도 서버와 같은 규칙으로 읽어야 한다.
//      행이 없다고 '꺼짐'으로 그리면, 관리자가 "꺼져 있네" 하고 켜는 순간
//      비로소 enabled=true 행이 생겨 동작은 그대로인데 화면만 바뀐다.
//   ② 상태 전이는 SECURITY DEFINER RPC 경유 — 클라 직접 UPDATE 금지.
//   ③ 저장 실패는 조용히 넘기지 않는다. 알림 설정은 "안 왔는데 왜?"의
//      원인이 되는 자리라, 실패를 숨기면 추적이 불가능해진다.
// ═════════════════════════════════════════════════════════════════════════════

/** notification_settings 한 행 */
export interface NotificationChannelSetting {
  type:    string
  channel: 'email' | 'inapp' | 'teams'
  enabled: boolean
}

/** 지정 수신자 한 행 (profiles 조인 결과) */
export interface NotificationRecipientRow {
  type:    string
  user_id: string
  name:    string
  email:   string
  dept:    string | null
}

/**
 * 채널 설정 전량 조회
 *
 * 반환은 "저장된 행" 뿐이다. 화면은 `설정에 없으면 켜짐`으로 해석해야 한다
 * (isChannelEnabled 헬퍼 사용).
 */
export async function loadNotificationSettings(): Promise<NotificationChannelSetting[]> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('type, channel, enabled')
  if (error) throw new Error(error.message)
  return (data ?? []) as NotificationChannelSetting[]
}

/** 서버(loadChannelFlags)와 동일한 해석: 행이 없으면 켜짐 */
export function isChannelEnabled(
  settings: NotificationChannelSetting[], type: string, channel: 'email' | 'inapp' | 'teams',
): boolean {
  const row = settings.find(s => s.type === type && s.channel === channel)
  return row ? row.enabled : true
}

/** 채널 on/off 저장 */
export async function setNotificationChannel(
  type: string, channel: 'email' | 'inapp' | 'teams', enabled: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_set_notification_channel', {
    p_type: type, p_channel: channel, p_enabled: enabled,
  })
  if (!error) return { ok: true }
  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))        return { ok: false, message: '알림 설정 권한이 없습니다' }
  if (m.includes('INVALID_CHANNEL'))  return { ok: false, message: '알 수 없는 채널입니다' }
  if (m.includes('INVALID_TYPE'))     return { ok: false, message: '알 수 없는 알림 종류입니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}

// ← [2026-09-30 5-A] 사용자별 알림 설정 — 사용자 상세 모달 '알림 수신' 섹션
//   list 는 그 사용자가 **자격 있는 타입만** 돌려준다(DB notification_recipient_entitled). 없는 타입 = 토글 자체가 없음
export interface UserNotificationPref { type: string; email_enabled: boolean; inapp_enabled: boolean }
export async function loadUserNotificationPrefs(userId: string): Promise<UserNotificationPref[]> {
  const { data, error } = await supabase.rpc('admin_list_user_notification_prefs', { p_user: userId })
  if (error) throw new Error(error.message)
  return (data ?? []) as UserNotificationPref[]
}
export async function setUserNotificationPref(
  userId: string, type: string, channel: 'email' | 'inapp', enabled: boolean,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_set_user_notification_pref', { p_user: userId, p_type: type, p_channel: channel, p_enabled: enabled })
  if (!error) return { ok: true }
  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))      return { ok: false, message: '알림 설정 권한이 없습니다 (사용자 관리 또는 알림 설정 권한 필요)' }
  if (m.includes('NOT_ENTITLED'))   return { ok: false, message: '이 사용자는 해당 알림의 자격(권한)이 없습니다 — 권한을 먼저 저장하세요' }
  if (m.includes('INVALID_CHANNEL'))return { ok: false, message: '알 수 없는 채널입니다' }
  if (m.includes('USER_NOT_FOUND')) return { ok: false, message: '사용자를 찾을 수 없습니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}

/** 지정 수신자 전량 조회 (타입 무관 — 화면에서 그룹핑) */
export async function loadNotificationRecipients(): Promise<NotificationRecipientRow[]> {
  const { data, error } = await supabase.rpc('admin_list_notification_recipients')
  if (error) throw new Error(error.message)
  return (data ?? []) as NotificationRecipientRow[]
}

/**
 * 지정 수신자 저장 — **전체 교체**
 *
 * 빈 배열을 넘기면 지정이 해제되어 기존 규칙(관리자 전원 / 도서 담당)으로
 * 되돌아간다. "아무에게도 안 보냄"이 아니다 — 그건 채널 토글로 처리한다.
 */
export async function setNotificationRecipients(
  type: string, userIds: string[],
): Promise<{ ok: boolean; saved?: number; message?: string }> {
  const { data, error } = await supabase.rpc('admin_set_notification_recipients', {
    p_type: type, p_user_ids: userIds,
  })
  if (!error) return { ok: true, saved: Number(data) || 0 }
  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))    return { ok: false, message: '알림 설정 권한이 없습니다' }
  if (m.includes('INVALID_TYPE')) return { ok: false, message: '알 수 없는 알림 종류입니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}


// ═════════════════════════════════════════════════════════════════════════════
// [2026-07-24] 헤더 공지 배너
//
//   NoticeBar 데이터가 App.tsx 의 하드코딩 상수(MOCK_ANNOUNCEMENT)였다.
//   공지를 바꾸려면 배포가 필요했고, 게시 기간이 없어 5/12 핫픽스 안내가
//   두 달 넘게 떠 있었다. DB 로 옮기고 기간이 지나면 자동으로 내려가게 한다.
//
//   ★ "지금 보여줄 공지인가" 판정은 **RLS 가 한다**(20260729_announcements.sql).
//     프론트에서 다시 거르지 않는다 — 조건이 두 곳에 생기면 한쪽만 고쳐져
//     기간이 끝난 공지가 어딘가에서 계속 보인다.
// ═════════════════════════════════════════════════════════════════════════════

export interface Announcement {
  id:         string
  message:    string
  bg_color:   string
  text_color: string
  starts_at:  string
  ends_at:    string
  is_active:  boolean
  created_at?: string
}

/**
 * 지금 게시 중인 공지 1건 (없으면 null)
 *
 * 기간이 겹치는 공지가 여럿이면 **최근 시작한 것**을 보여준다.
 * 배너는 한 줄뿐이라 여러 개를 동시에 띄울 수 없고, 나중에 등록한 공지가
 * 더 최신 상황을 담고 있을 가능성이 높다.
 */
// ─── [2026-07-27 공지 리얼타임] Broadcast 동기화 채널 ──────────────────────────
//   ⭐ announcements 테이블 postgres_changes 구독을 쓰지 않는 이유:
//     RLS SELECT 정책이 "게시 중 OR 관리자"라, 공지를 **내리는** 변경
//     (is_active=false, 기간 축소, 삭제)은 변경 후 행이 일반 사용자 RLS를
//     통과하지 못해 이벤트가 전달되지 않는다 → "내렸는데 화면엔 계속 떠 있음"
//     이라는, 이 기능이 잡아야 할 케이스에서 정확히 실패한다.
//   대신 어드민 저장/삭제 성공 시 Broadcast 신호만 쏘고, 각 클라이언트는
//   loadActiveAnnouncement 를 **재조회**한다 — "지금 보여줄 공지인가" 판정은
//   계속 RLS 단일 진실(20260729 설계 원칙 유지), 클라이언트는 신호만 받는다.
//   · 채널은 모듈 싱글턴 — 같은 topic 을 이중 subscribe 하면 supabase-js 가
//     에러를 내므로(수신용 App + 발신용 어드민 패널이 한 브라우저에 공존),
//     수신/발신이 하나의 조인된 채널을 공유한다.
//   · 신호 전송 실패는 저장을 되돌리지 않는다 — 저장이 진실, 신호는 부가.

let annSyncChannel: ReturnType<typeof supabase.channel> | null = null
let annSyncJoined  = false
const annSyncListeners = new Set<() => void>()

function ensureAnnSyncChannel() {
  if (annSyncChannel) return annSyncChannel
  annSyncChannel = supabase
    .channel('announcement-sync')
    .on('broadcast', { event: 'changed' }, () => {
      annSyncListeners.forEach(fn => { try { fn() } catch (e) { console.warn('[api] 공지 동기화 콜백 실패:', e) } })
    })
  annSyncChannel.subscribe((status) => { annSyncJoined = status === 'SUBSCRIBED' })
  return annSyncChannel
}

/** 공지 변경 신호 수신 구독 — cleanup 함수 반환. 채널은 앱 생명주기 동안 유지 */
export function subscribeAnnouncementSync(onChange: () => void): () => void {
  annSyncListeners.add(onChange)
  ensureAnnSyncChannel()
  return () => { annSyncListeners.delete(onChange) }
}

/** 어드민 저장/삭제 성공 후 호출 — 전 클라이언트에 재조회 신호. fire & forget */
export async function notifyAnnouncementSync(): Promise<void> {
  try {
    const ch = ensureAnnSyncChannel()
    // 어드민 화면은 App 마운트 시 이미 조인돼 있어 사실상 항상 joined 상태지만,
    // 조인 직후 극단 타이밍 방어 — 최대 3초 대기 후 미조인이면 전송 포기(저장은 이미 성립)
    for (let i = 0; i < 30 && !annSyncJoined; i++) await new Promise(r => setTimeout(r, 100))
    if (!annSyncJoined) { console.warn('[api] 공지 동기화: 채널 미조인 — 신호 생략'); return }
    await ch.send({ type: 'broadcast', event: 'changed', payload: { at: Date.now() } })
  } catch (e) {
    console.warn('[api] 공지 동기화 신호 실패 (저장은 정상):', e)
  }
}

export async function loadActiveAnnouncement(): Promise<Announcement | null> {
  if (!isSupabaseEnabled) return null
  const { data, error } = await supabase
    .from('announcements')
    .select('id, message, bg_color, text_color, starts_at, ends_at, is_active')
    .eq('is_active', true)
    .order('starts_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) { console.warn('[api] 공지 조회 실패:', error.message); return null }
  return (data?.[0] as Announcement) ?? null
}

/** 관리자 — 전체 목록 (지난 공지 포함). RLS 가 관리자에게만 전체를 준다 */
export async function loadAllAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('id, message, bg_color, text_color, starts_at, ends_at, is_active, created_at')
    .order('starts_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as Announcement[]
}

export interface AnnouncementInput {
  /** null = 새 공지 */
  id:         string | null
  message:    string
  bg_color:   string
  text_color: string
  /** KST 하루 단위 — 화면에서 'YYYY-MM-DD' 를 받아 경계를 붙여 보낸다 */
  starts_at:  string
  ends_at:    string
  is_active:  boolean
}

/** 저장 (생성/수정 공용) — 상태 전이는 SECURITY DEFINER RPC 경유 */
export async function saveAnnouncement(
  input: AnnouncementInput,
): Promise<{ ok: boolean; row?: Announcement; message?: string }> {
  const { data, error } = await supabase.rpc('admin_save_announcement', {
    p_id:         input.id,
    p_message:    input.message,
    p_bg_color:   input.bg_color,
    p_text_color: input.text_color,
    p_starts_at:  input.starts_at,
    p_ends_at:    input.ends_at,
    p_is_active:  input.is_active,
  })
  if (!error) return { ok: true, row: data as Announcement }
  const m = error.message ?? ''
  if (m.includes('NOT_ADMIN'))       return { ok: false, message: '공지 관리 권한이 없습니다' }
  if (m.includes('EMPTY_MESSAGE'))   return { ok: false, message: '공지 내용을 입력하세요' }
  if (m.includes('INVALID_PERIOD'))  return { ok: false, message: '종료일이 시작일보다 빠릅니다' }
  if (m.includes('INVALID_COLOR'))   return { ok: false, message: '색상은 #RRGGBB 형식이어야 합니다' }
  if (m.includes('ANNOUNCEMENT_NOT_FOUND')) return { ok: false, message: '이미 삭제된 공지입니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}

export async function deleteAnnouncement(id: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_delete_announcement', { p_id: id })
  if (!error) return { ok: true }
  if ((error.message ?? '').includes('NOT_ADMIN')) return { ok: false, message: '공지 관리 권한이 없습니다' }
  return { ok: false, message: `삭제 실패: ${error.message}` }
}

/** 'YYYY-MM-DD' → KST 하루 경계 timestamptz 문자열 */
export const kstDayStart = (d: string) => `${d}T00:00:00+09:00`
export const kstDayEnd   = (d: string) => `${d}T23:59:59+09:00`
/** timestamptz → 'YYYY-MM-DD' (KST) — 폼에 되돌려 넣을 때 */
export const toKstDayStr = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)


// ═════════════════════════════════════════════════════════════════════════════
// [2026-07-24] 관리자 권한 (Phase 1)
//
//   권한 체계가 profiles.role / admin_roles 두 벌로 갈라져 있었고 부여 화면이 없어
//   SQL 을 직접 실행해야 했다. admin_roles 를 단일 원장으로 삼고, profiles.role 은
//   저장 RPC 안에서 함께 재계산한다(트리거 아님 — 20260730 주석 참조).
// ═════════════════════════════════════════════════════════════════════════════

/** 내 역할 — admin_roles SELECT 정책이 본인 것은 항상 허용한다 */
export async function loadMyAdminRoles(userId: string): Promise<string[]> {
  // ← [2026-10-06 ADMIN-GATE] 조회 본체를 loadMyAdminRolesStrict 로 분리 — 이 함수의 동작(실패 시 경고 + [])은 그대로
  try { return await loadMyAdminRolesStrict(userId) }
  catch (e: any) { console.warn('[api] 내 권한 조회 실패:', e?.message); return [] }
}

/**
 * ← [2026-10-06 ADMIN-GATE] 내 역할 조회 (엄격판) — 조회 실패를 [] 로 삼키지 않고 throw.
 *   어드민 접근 게이트는 '역할 없음'(닫아야 함)과 '조회 실패'(이미 통과한 관리자를 내쫓으면 안 됨)를
 *   구분해야 하는데, loadMyAdminRoles 는 둘 다 [] 라 구분이 안 된다.
 */
export async function loadMyAdminRolesStrict(userId: string): Promise<string[]> {
  if (!isSupabaseEnabled || !userId) return []
  const { data, error } = await supabase
    .from('admin_roles').select('role').eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => r.role)
}

/** 사용자별 역할 맵 — 사용자 관리 목록의 배지용 (N+1 회피) */
export async function loadAllUserRoles(): Promise<Record<string, string[]>> {
  const { data, error } = await supabase.rpc('admin_list_user_roles')
  if (error) throw new Error(error.message)
  const map: Record<string, string[]> = {}
  ;(data ?? []).forEach((r: any) => { map[r.user_id] = r.roles ?? [] })
  return map
}

/**
 * 한 사람의 역할 전체 교체 (super 전용)
 *
 * 부분 add/remove 가 아니라 교체다 — 화면이 보여준 체크 상태가 곧 결과여야 하고,
 * 두 관리자가 동시에 편집할 때 한쪽 변경이 조용히 사라지지 않는다.
 */
export async function setUserAdminRoles(
  userId: string, roles: string[],
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('admin_set_user_roles', {
    p_user_id: userId, p_roles: roles,
  })
  if (!error) return { ok: true }
  const m = error.message ?? ''
  if (m.includes('NOT_SUPER'))              return { ok: false, message: '권한 부여는 최고 관리자만 가능합니다' }
  if (m.includes('CANNOT_REVOKE_OWN_SUPER'))return { ok: false, message: '자신의 최고 관리자 권한은 회수할 수 없습니다. 다른 최고 관리자에게 요청하세요' }
  if (m.includes('LAST_SUPER'))             return { ok: false, message: '마지막 최고 관리자입니다. 회수하면 아무도 권한을 부여할 수 없습니다' }
  if (m.includes('USER_NOT_FOUND'))         return { ok: false, message: '존재하지 않는 사용자입니다' }
  if (m.includes('DEPRECATED_ROLE'))        return { ok: false, message: '폐기된 역할은 부여할 수 없습니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}

/** 권한 변경 이력 (Phase 2) — 특정 사용자 것만. actor 는 처리자, NULL 이면 시스템 */
export interface RoleGrantLog {
  id:         string
  role:       string
  action:     'grant' | 'revoke'
  actor:      string | null
  created_at: string
}

export async function loadRoleGrantLog(userId: string, limit = 20): Promise<RoleGrantLog[]> {
  const { data, error } = await supabase
    .from('admin_role_grants')
    .select('id, role, action, actor, created_at')
    .eq('target_user', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { console.warn('[api] 권한 이력 조회 실패:', error.message); return [] }
  return (data ?? []) as RoleGrantLog[]
}


// ═════════════════════════════════════════════════════════════════════════════
// [2026-07-27] GA 챗봇 지식베이스 (kb_chunks)
//
//   Notion GA 가이드를 정제한 청크가 원본이다 (시드: 20260733_kb_chunks.sql).
//   RLS 가 읽기·쓰기 모두 has_admin_role('kb') 를 요구하므로 별도 RPC 없이
//   테이블 직접 접근 — 검증할 상태 전이가 없고(공지의 기간 검증과 다름),
//   updated_at/updated_by 는 DB BEFORE UPDATE 트리거가 보장한다.
//   챗봇 런타임은 이 함수를 쓰지 않는다(service_role 별도 경로) —
//   anon 정책이 없어 credential 포함 청크가 비로그인에 노출되지 않는다.
// ═════════════════════════════════════════════════════════════════════════════

export interface KbChunk {
  id:        string
  bot_id:    string
  category:  string
  doc:       string
  section:   string
  content:   string
  keywords:  string[]
  contacts:  string[]
  related:   string[]
  status:    'ok' | 'image_only' | 'pdf_only'
  sensitive: boolean
  updated_at?: string
  updated_by?: string | null
}

/** KB 관리 탭 — 봇 단위 전체 로드. RLS 가 kb 역할 없으면 0행을 준다(에러 아님) */
export async function loadKbChunks(botId = 'ga'): Promise<KbChunk[]> {
  const { data, error } = await supabase
    .from('kb_chunks')
    .select('id, bot_id, category, doc, section, content, keywords, contacts, related, status, sensitive, updated_at, updated_by')
    .eq('bot_id', botId)
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as KbChunk[]
}

/** 저장 (생성/수정 공용) — PK upsert. 실패 사유를 한글 메시지로 변환 */
export async function saveKbChunk(
  chunk: KbChunk,
): Promise<{ ok: boolean; row?: KbChunk; message?: string }> {
  const { data, error } = await supabase
    .from('kb_chunks')
    .upsert({
      id:        chunk.id,
      bot_id:    chunk.bot_id,
      category:  chunk.category,
      doc:       chunk.doc,
      section:   chunk.section,
      content:   chunk.content,
      keywords:  chunk.keywords,
      contacts:  chunk.contacts,
      related:   chunk.related,
      status:    chunk.status,
      sensitive: chunk.sensitive,
    })
    .select()
    .single()
  if (!error) return { ok: true, row: data as KbChunk }
  const m = error.message ?? ''
  if (m.includes('row-level security')) return { ok: false, message: 'KB 관리 권한이 없습니다' }
  if (m.includes('kb_chunks_status_check')) return { ok: false, message: '상태 값이 올바르지 않습니다' }
  return { ok: false, message: `저장 실패: ${m}` }
}

export async function deleteKbChunk(id: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('kb_chunks').delete().eq('id', id)
  if (!error) return { ok: true }
  if ((error.message ?? '').includes('row-level security')) return { ok: false, message: 'KB 관리 권한이 없습니다' }
  return { ok: false, message: `삭제 실패: ${error.message}` }
}

// ── 노쇼 관리 (어드민 '예약 관리' 탭 하위) ──────────────────────────────────
// ← [2026-08-05] 신규 — 노쇼 해제(사용 완료 전환) / 영구 삭제
//   · 반드시 RPC 경유 — 노쇼 확정룰 검증을 서버가 강제 (클라 직접 UPDATE/DELETE 금지)
//   · 짝 배포: supabase/migrations/20260740_noshow_admin.sql
//   · 에러 매핑 패턴: changeBookingOwner 와 동일 (RPC RAISE EXCEPTION → 한글 토스트)

const NOSHOW_RPC_ERR: Record<string, string> = {
  NOT_AUTHENTICATED: '로그인이 필요합니다.',
  NOT_ADMIN:         '예약 관리 권한이 없습니다.',
  BOOKING_NOT_FOUND: '예약을 찾을 수 없습니다. (이미 삭제되었을 수 있습니다)',
  NOT_NOSHOW:        '노쇼 상태가 아닌 예약입니다. 목록을 새로고침해 주세요.',
  // ← [2026-09-09 노쇼 종결] 종결 구간 [start, start+15분) 에 살아있는 다른 예약이 있어 해제 불가
  //   (RPC 사전검사 SLOT_OCCUPIED:{id} / 동시 INSERT 레이스 SLOT_OCCUPIED:RACE 공용)
  SLOT_OCCUPIED:     '해당 시간에 다른 예약이 있어 해제할 수 없습니다.',
}

// ← [2026-09-09] 폴백에 서버 code/message 를 그대로 노출.
//   사고: 8/5~9/9 한 달간 exclusion 위반(23P01)이 매핑에 없어 "노쇼 해제에 실패했습니다" 로만 보여
//   원인이 은폐됨. 매핑 밖 오류는 반드시 원문이 토스트에 보여야 한다.
function mapNoshowRpcError(error: { message?: string; code?: string; details?: string }, fallback: string): Error {
  const message = error.message ?? ''
  const key = Object.keys(NOSHOW_RPC_ERR).find(k => message.includes(k))
  if (key) return new Error(NOSHOW_RPC_ERR[key])
  const raw = [error.code, message || error.details].filter(Boolean).join(': ')
  return new Error(raw ? `${fallback} (${raw})` : fallback)
}

/** 노쇼 해제 — 종결된 15분 블록의 상태만 노쇼→'사용완료' (checked_in=true). end_at 은 복원하지 않는다.
 *  ← [2026-09-09] 짝 배포: supabase/migrations/20260763_noshow_close_end.sql */
export async function resolveNoshowBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_noshow', { p_booking_id: bookingId })
  if (error) {
    console.error('[api] admin_resolve_noshow 실패:', error.code, error.message, { bookingId })
    throw mapNoshowRpcError(error, '노쇼 해제에 실패했습니다.')
  }
}

/** 노쇼 예약 영구 삭제 — 참석자 포함 DB 에서 제거, 감사 로그에 스냅샷 보존 */
export async function deleteNoshowBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_noshow_booking', { p_booking_id: bookingId })
  if (error) {
    console.error('[api] admin_delete_noshow_booking 실패:', error.code, error.message, { bookingId })
    throw mapNoshowRpcError(error, '노쇼 예약 삭제에 실패했습니다.')
  }
}

// ── 노쇼 이용 제재 (20260743) ────────────────────────────────────────────────
// ← [2026-08-10] 1개월 내 3회 → 7일 예약 생성 차단. 판정·차단은 DB 트리거가 강제,
//   여기는 조회/해제 통로만. 낙관적 갱신 금지 — 액션 후 반드시 재조회 (프로젝트 규칙)
/** 내 제재 상태 — my_noshow_penalty_state RPC (없으면 blocked=false 1행) */
export async function fetchMyNoshowPenalty(): Promise<MyNoshowPenaltyState> {
  const { data, error } = await supabase.rpc('my_noshow_penalty_state')
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return row ?? { blocked: false, penalty_id: null, starts_at: null, ends_at: null }
}

/** 제재 이력 전체 — RLS 가 본인 행 또는 has_admin_role('booking') 만 반환 (어드민 패널용) */
export async function fetchNoshowPenalties(): Promise<NoshowPenaltyRow[]> {
  const { data, error } = await supabase
    .from('noshow_penalties')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[api] noshow_penalties 조회 실패:', error.message)
    throw new Error('제재 목록을 불러오지 못했습니다.')
  }
  return (data ?? []) as NoshowPenaltyRow[]
}

/** 제재 수동 해제 — admin_revoke_noshow_penalty RPC (예약 관리 권한) */
export async function revokeNoshowPenalty(penaltyId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_noshow_penalty', {
    p_penalty_id: penaltyId,
    p_reason: reason ?? null,
  })
  if (error) {
    console.error('[api] admin_revoke_noshow_penalty 실패:', error.message, { penaltyId })
    throw new Error(revokeNoshowPenaltyErrorMessage(new Error(error.message)))
  }
}

// ── CANTEEN DP (로비 디스플레이 공지) ────────────────────────────────────────
// [2026-09-08] cnr-res 로비 디스플레이(쇼츠 + 공지 슬라이드)의 공지 이미지 관리.
//  · 테이블 lobby_notices / 버킷 lobby-notices (20260908_lobby_notices.sql — 배포 완료)
//  · RLS: 읽기 공개(디스플레이가 비로그인 폴링), 쓰기 has_admin_role('notice')
//  · 등록 한도(LOBBY_NOTICE_LIMIT)는 DB 트리거(enforce_lobby_notice_limit)가 최종 방어 — 화면은 접근성만 담당. 한도 변경 시 양쪽 함께
//  · Storage 키는 ASCII 생성 규칙({timestamp}_{rand}.{ext}, ext는 MIME 기준) —
//    한글 원본 파일명을 키에 쓰면 400 Invalid key (2026-09-03 실사고 규칙)

export interface LobbyNotice {
  id:         string
  file_path:  string
  file_name:  string
  mime_type:  string
  sort_order: number
  is_visible: boolean
  starts_at:  string | null   // 'YYYY-MM-DD' (date 컬럼)
  ends_at:    string | null
  created_by: string | null
  created_at: string
}

export const LOBBY_NOTICE_LIMIT = 15   // ← [2026-09-08] 10→15. DB 트리거(enforce_lobby_notice_limit)와 동기 — 변경 시 양쪽 함께
const LOBBY_NOTICE_BUCKET = 'lobby-notices'

/** MIME → 확장자 화이트리스트 — 여기 없는 타입은 업로드 거부 */
const LOBBY_NOTICE_MIME_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
}

/** Storage 공개 URL (버킷 public) — 목록 썸네일·미리보기용 */
export function lobbyNoticePublicUrl(path: string): string {
  return supabase.storage.from(LOBBY_NOTICE_BUCKET).getPublicUrl(path).data.publicUrl
}

export async function loadLobbyNotices(): Promise<LobbyNotice[]> {
  const { data, error } = await supabase
    .from('lobby_notices')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[api] lobby_notices 조회 실패:', error.message)
    throw new Error('로비 공지 목록을 불러오지 못했습니다.')
  }
  return (data ?? []) as LobbyNotice[]
}

/** 업로드 + 행 등록. insert 실패 시 방금 올린 Storage 객체를 정리해 고아 파일을 남기지 않는다 */
export async function uploadLobbyNotice(file: File, existing: LobbyNotice[]): Promise<void> {
  if (existing.length >= LOBBY_NOTICE_LIMIT) {
    throw new Error(`최대 ${LOBBY_NOTICE_LIMIT}개까지 등록할 수 있습니다. 기존 항목을 삭제 후 업로드하세요.`)
  }
  const ext = LOBBY_NOTICE_MIME_EXT[file.type]
  if (!ext) throw new Error('PNG / JPG / GIF / WEBP 만 업로드할 수 있습니다.')

  const key = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error: upErr } = await supabase.storage
    .from(LOBBY_NOTICE_BUCKET)
    .upload(key, file, { contentType: file.type })
  if (upErr) throw new Error(`업로드 실패: ${upErr.message}`)

  const { data: { user } } = await supabase.auth.getUser()
  const maxOrder = existing.reduce((m, x) => Math.max(m, x.sort_order), -1)
  const { error } = await supabase.from('lobby_notices').insert({
    file_path:  key,
    file_name:  file.name,
    mime_type:  file.type,
    sort_order: maxOrder + 1,
    created_by: user?.id ?? null,
  })
  if (error) {
    await supabase.storage.from(LOBBY_NOTICE_BUCKET).remove([key]).catch(() => {})
    throw new Error(error.message.includes('LOBBY_NOTICE_LIMIT')   // ← [2026-09-08] 예외 코드에서 숫자 제거(_EXCEEDED) — 한도 변경이 프론트 매칭을 안 건드리게
      ? `최대 ${LOBBY_NOTICE_LIMIT}개까지 등록할 수 있습니다.`
      : `등록 실패: ${error.message}`)
  }
}

export async function updateLobbyNotice(
  id: string,
  patch: Partial<Pick<LobbyNotice, 'is_visible' | 'starts_at' | 'ends_at'>>,
): Promise<void> {
  const { error } = await supabase.from('lobby_notices').update(patch).eq('id', id)
  if (error) throw new Error(`변경 실패: ${error.message}`)
}

/** 순서 전체 재부여 — 인접 스왑만 하면 초기값 0 중복 상태에서 순서가 안 바뀌는 근본 원인이 남는다 */
export async function reorderLobbyNotices(orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase.from('lobby_notices').update({ sort_order: idx }).eq('id', id)),
  )
  const failed = results.find(r => r.error)
  if (failed?.error) throw new Error(`순서 변경 실패: ${failed.error.message}`)
}

/** Storage 객체 → 행 순서로 삭제. 행부터 지우면 실패 시 파일만 남아 재업로드가 막히지는 않지만
 *  버킷에 고아가 쌓인다 — 파일 삭제 성공을 확인한 뒤 행을 지운다 */
export async function deleteLobbyNotice(n: LobbyNotice): Promise<void> {
  const { error: sErr } = await supabase.storage.from(LOBBY_NOTICE_BUCKET).remove([n.file_path])
  if (sErr) throw new Error(`파일 삭제 실패: ${sErr.message}`)
  const { error } = await supabase.from('lobby_notices').delete().eq('id', n.id)
  if (error) throw new Error(`삭제 실패: ${error.message}`)
}
