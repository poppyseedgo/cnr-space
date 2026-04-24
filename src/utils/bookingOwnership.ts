/**
 * bookingOwnership.ts — "내 예약" 판정 공통 헬퍼
 *
 * ✅ 변경 이력
 *  - [2026-04-24 P1 hotfix] MyPage 방식으로 전면 단순화
 *      · 이전 isBookingOwner(user_id + user name fallback) → 이름 fallback이
 *        snapshot 이름과 꼬여 'profiles.name 변경' 시나리오에서 false 반환 가능
 *      · MyPage의 allMyBookings 로직(UUID + attendee email)이 이미 검증된 방식 →
 *        이 헬퍼도 동일 기준으로 재설계해서 전 화면 일관성 확보
 *      · 정책 확장: "예약자 OR 참석자" 모두 본인 예약으로 인정 (2026-04-08 정책 구현)
 *  - [2026-04-24 P1] 최초 작성 (isBookingOwner, 이름 fallback 포함 버전 — deprecated)
 *
 * ── 설계 원칙 ─────────────────────────────────────────────────────────────
 *  1) 예약자 판정: bookings.user_id(UUID) === authUser.user_id
 *       · auth.users.id와 직결, FK ON UPDATE CASCADE로 이름/이메일 변경에 불변
 *       · MyPage.tsx:82의 `.eq('user_id', authUserId)` 쿼리와 동일 기준
 *
 *  2) 참석자 판정: booking_attendees.email === authUser.email
 *       · 이메일은 고정 식별자 (회사 계정 불변)
 *       · MyPage.tsx:90의 `.eq('email', currentUserEmail)` 쿼리와 동일 기준
 *       · booking_attendees.email 기반 설계(2026-04-16 확정)와 일관
 *
 *  3) 이름(name) 비교 없음: snapshot 꼬임 원천 차단
 *       · bookings.user_name은 예약 생성 시점 snapshot이므로 현재 profiles.name과
 *         불일치 가능. 이름을 식별자로 쓰면 Azure AD 동기화 후 예약 주인이 바뀜.
 *
 * ── 호환성 주의 ───────────────────────────────────────────────────────────
 *   · bookings.user_id가 NULL인 레거시 예약은 예약자로 인식 안 됨.
 *     현재 insertBooking()은 항상 auth.user.id를 저장하므로 정상 데이터는 영향 없음.
 *     만약 초기 테스트 예약 중 NULL이 있다면 DB 수동 정정 필요.
 */

interface BookingLike {
  user_id?:  string
  attendees?: Array<{ email?: string }>
}

/**
 * 이 예약이 현재 로그인 사용자의 "내 예약"인지 판정 (예약자 OR 참석자).
 * MyPage의 allMyBookings 조회 로직과 동일한 기준.
 *
 * @param booking           판정 대상 예약 (user_id + attendees 필드 필요)
 * @param currentUserId     현재 로그인 사용자 UUID (authUser.user_id)
 * @param currentUserEmail  현재 로그인 사용자 이메일 (authUser.email)
 * @returns 본인 예약(예약자/참석자) 여부
 */
export function isMyBooking(
  booking:          BookingLike,
  currentUserId:    string,
  currentUserEmail: string,
): boolean {
  // ① 예약자 판정 — UUID 직접 비교 (MyPage .eq('user_id', authUserId) 와 동일)
  if (currentUserId && booking.user_id === currentUserId) return true

  // ② 참석자 판정 — email 직접 비교 (MyPage .eq('email', currentUserEmail) 와 동일)
  if (currentUserEmail && booking.attendees?.some(a => a.email === currentUserEmail)) {
    return true
  }

  return false
}
