/**
 * bookingOwnership.ts — 예약 역할 판정 공통 헬퍼
 *
 * ✅ 변경 이력
 *  - [2026-04-24 P3-3] 세 헬퍼로 분리 + UUID OR email 이중 복원 설계
 *      · 배경: 정책 문서 §2.1 확정 — "이름이 바뀌어도 부서가 바뀌어도
 *              본인 예약으로 인식" (고지 2026-04-24)
 *      · 설계: 예약자(booker) / 참석자(attendee) 역할을 코드 레벨에서 구분
 *              (이전 isMyBooking은 둘을 합쳐서 true/false 단일 반환 → UI 뱃지 구분 불가)
 *      · 핵심: isBooker = UUID OR email (이중 복원)
 *              · user_id와 user_email 중 하나만 일치해도 예약자로 인식
 *              · Supabase auth.users 재생성 / email 변경 등 엣지 케이스 모두 복원
 *      · 선행: P3-1(DB user_email 컬럼+백필) + P3-2(code 저장/읽기 경로) 완료
 *      · 레거시 fallback 완전 제거: P3-1 백필로 모든 예약이 user_email을 가짐
 *      · 이름(name) 비교 절대 금지: snapshot 꼬임 원천 차단
 *
 *  - [2026-04-24 P1 hotfix] MyPage 방식으로 단순화 (UUID + attendee email)
 *  - [2026-04-24 P1] 최초 작성 (isBookingOwner, 이름 fallback 포함 — deprecated)
 *
 * ── 설계 원칙 ─────────────────────────────────────────────────────────────
 *  1) 예약자 판정 (isBooker) — UUID OR email 이중 복원
 *       · UUID 경로: bookings.user_id === authUser.user_id
 *         (auth.users.id와 직결, FK ON UPDATE CASCADE로 DB 레벨 불변 보장)
 *       · email 경로: bookings.user_email === authUser.email
 *         (회사 이메일 정책상 불변, DB 컬럼 P3-1에서 추가)
 *       · OR 조합 이유: 하나가 깨져도 나머지로 복원 → 실패율 최소화
 *         (AND 였다면 실패율 합산되어 오히려 취약)
 *
 *  2) 참석자 판정 (isAttendee) — email만
 *       · booking_attendees.email === authUser.email
 *       · 참석자는 booking_attendees 테이블에 email만 저장 (2026-04-16 설계)
 *         · 외부인/퇴사자도 참석자로 기록 가능하도록 FK 제약 없음
 *       · MyPage.tsx의 `.eq('email', currentUserEmail)` 쿼리와 동일 기준
 *
 *  3) 내 예약 판정 (isMyBooking) — isBooker OR isAttendee
 *       · "예약자이거나 참석자" = 모든 권한 동일 (정책 §3.1)
 *       · MyPage의 allMyBookings 조회 범위와 완전 일치
 *
 * ── 상호 배타 규칙 (정책 §1.3) ─────────────────────────────────────────────
 *  · 한 사용자는 한 예약에서 예약자 OR 참석자 중 정확히 하나만 가능
 *  · UI 검색 단계에서 "본인을 참석자로 추가" 차단됨
 *  · 뱃지 표시 시 isBooker 우선: isBooker=true면 isAttendee 체크 무관하게 "내 예약"
 *
 * ── 이름(name) 비교 금지 ──────────────────────────────────────────────────
 *  · bookings.user_name은 예약 생성 시점 snapshot — Azure AD 동기화에 무반응
 *  · 이름은 변경 가능 / UUID + email은 불변 → 불변 식별자만 판정에 사용
 *  · 이 헬퍼에서는 name 필드에 절대 접근하지 않는다
 */

interface BookingLike {
  user_id?:    string
  user_email?: string
  attendees?:  Array<{ email?: string }>
}

/**
 * 이 예약의 '예약자(booker)'가 현재 로그인 사용자인지 판정.
 * UUID OR email 이중 복원 — 하나라도 일치하면 true.
 *
 * @param booking          판정 대상 예약
 * @param currentUserId    현재 로그인 사용자 UUID (authUser.user_id)
 * @param currentUserEmail 현재 로그인 사용자 이메일 (authUser.email)
 * @returns 예약자 여부
 */
export function isBooker(
  booking:          BookingLike,
  currentUserId:    string,
  currentUserEmail: string,
): boolean {
  // ① UUID 경로 — bookings.user_id === authUser.user_id
  if (currentUserId && booking.user_id === currentUserId) return true

  // ② email 경로 — bookings.user_email === authUser.email (이중 복원)
  if (currentUserEmail && booking.user_email === currentUserEmail) return true

  return false
}

/**
 * 이 예약의 '참석자(attendee)'에 현재 로그인 사용자가 포함되는지 판정.
 * 참석자는 booking_attendees 테이블에 email만 저장 → email 비교만 수행.
 *
 * @param booking          판정 대상 예약 (attendees 배열 필요)
 * @param currentUserEmail 현재 로그인 사용자 이메일 (authUser.email)
 * @returns 참석자 여부
 */
export function isAttendee(
  booking:          BookingLike,
  currentUserEmail: string,
): boolean {
  if (!currentUserEmail) return false
  return booking.attendees?.some(a => a.email === currentUserEmail) ?? false
}

/**
 * 이 예약이 현재 로그인 사용자의 "내 예약"인지 판정 (예약자 OR 참석자).
 * MyPage의 allMyBookings 조회 범위와 동일한 기준.
 *
 * 기능 동작: isBooker() || isAttendee()
 *   · 예약자거나 참석자면 true → 홈/캘린더 표시, 권한 부여 등에 사용
 *   · 역할 구분이 필요한 경우(뱃지 분기 등) isBooker/isAttendee 직접 호출
 *
 * @param booking          판정 대상 예약
 * @param currentUserId    현재 로그인 사용자 UUID (authUser.user_id)
 * @param currentUserEmail 현재 로그인 사용자 이메일 (authUser.email)
 * @returns 본인 예약(예약자/참석자) 여부
 */
export function isMyBooking(
  booking:          BookingLike,
  currentUserId:    string,
  currentUserEmail: string,
): boolean {
  return isBooker(booking, currentUserId, currentUserEmail)
      || isAttendee(booking, currentUserEmail)
}
