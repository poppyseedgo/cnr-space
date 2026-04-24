/**
 * bookingOwnership.ts — 예약자 판정 공통 헬퍼
 *
 * ✅ 최초 작성: 2026-04-24 (P1 예약자 판정 버그 수정)
 *
 * ── 배경 ─────────────────────────────────────────────────────────────────
 *  팀즈/Azure AD에서 사용자가 이름을 변경하면 Admin "Azure AD 동기화" 실행 시
 *  profiles.name이 새 이름으로 덮어써진다. 그러나 bookings.user_name은 예약
 *  생성 시점의 snapshot이라 옛 이름 그대로다.
 *
 *  전체 코드베이스가 예약자 판정을 `b.user === currentUser` (이름 문자열 비교)
 *  로 하고 있어, 이름 변경 직후 다음 버그가 동시 발생했다:
 *   · 홈 "오늘 내 예약" 누락
 *   · 캘린더 "내 예약만" 필터 누락
 *   · 슬롯/카드/리스트의 "내 예약" 뱃지 누락
 *   · ⚠️ DetailModal의 취소/편집/체크인 권한 상실
 *
 * ── 설계 원칙 ─────────────────────────────────────────────────────────────
 *  1) UUID 우선 — bookings.user_id는 auth.users.id와 직결되며
 *     FK에 ON UPDATE CASCADE가 걸려있어 sync로 profiles.id가 바뀌어도
 *     자동 추종한다 (2026-04-22 확정). 이름 변경에 완전 불변.
 *
 *  2) 이름 fallback — user_id가 null인 레거시 데이터(초기 테스트 예약 등)
 *     대응을 위한 안전망. user_id가 있으면 절대 이름 fallback으로 가지 않는다.
 *
 *  3) 참석자(booking_attendees)는 별건 — email 기반 (2026-04-16 설계).
 *     이 헬퍼는 "예약자(booker)" 전용이며, "내 예약" 전체 판정(예약자+참석자
 *     포함)은 호출자가 이 헬퍼 결과와 attendee email 조건을 OR로 결합해야 한다.
 *
 * ── 사용 예 ───────────────────────────────────────────────────────────────
 *   // 예약자 단독 판정 (DetailModal 권한, 캘린더 필터 등)
 *   const isOwner = isBookingOwner(b, currentUserId, currentUser)
 *
 *   // "내 예약" 전체 판정 (홈 "오늘 내 예약" 등)
 *   const isMine = isBookingOwner(b, currentUserId, currentUser)
 *               || (currentUserEmail && b.attendees?.some(a => a.email === currentUserEmail))
 */

interface BookingLike {
  user_id?: string
  user?:    string
}

/**
 * 이 예약의 '예약자(booker)'가 현재 로그인 사용자인지 판정한다.
 *
 * @param booking          판정 대상 예약 (user_id + user 필드만 필요)
 * @param currentUserId    현재 로그인 사용자의 UUID (authUser.user_id)
 * @param currentUserName  현재 로그인 사용자의 이름 (fallback용)
 * @returns 예약자 일치 여부
 */
export function isBookingOwner(
  booking:         BookingLike,
  currentUserId:   string,
  currentUserName: string,
): boolean {
  // 정식 경로 — UUID 비교 (이름 변경에 불변)
  if (booking.user_id && currentUserId) {
    return booking.user_id === currentUserId
  }
  // Fallback — user_id 누락 레거시 데이터 대응
  return !!currentUserName && booking.user === currentUserName
}
