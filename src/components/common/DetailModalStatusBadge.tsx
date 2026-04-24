// ─── 변경 이력 ───────────────────────────────────────────────────────────────
// [2026-04-24 P4-B] currentUserId, currentUserEmail prop 추가
//   · BookingStatusBadge의 isBooker 기반 판정을 DetailModal에서 사용하려면
//     래퍼도 prop을 투명하게 전파해야 함.
//   · 기존 currentUser prop 유지 (호환성), 새 prop 2개 추가.
//
// [2026-04-24] 신규 — DetailModal 전용 상태 뱃지
//
//   배경: DetailModal의 상태 칩은 Figma 212:322 / 212:324 (StautsChip) 전용 스펙으로
//         캘린더 슬롯의 StatusBadge-XS(Figma 242:608, CalendarSlotBadge 담당)와 완전 별개.
//         둘을 혼용하면 Figma 스펙 어긋남 + 한 쪽 변경이 타 쪽 영향 → 분리 필요.
//
//   스펙 (Figma 212:322 / 212:324 / 193:458 헤더 샘플):
//     · padding: 4×10 (기본) — 승인 대기 등 일부 상태는 4×12로 개별 오버라이드 가능
//     · border-radius: 8
//     · font-size: 11 Medium (Pretendard)
//     · line-height: 1.5
//
//   관계:
//     · 내부적으로 BookingStatusBadge(shape='square')를 호출
//     · BookingStatusBadge의 기존 상태 판정 로직 재사용 (중복 제거)
//     · CSS 토큰 .chip--square 스펙이 Figma와 일치하도록 tokens.css에서 보장
//
//   사용처:
//     · DetailModal 헤더 영역 (예약 상세 모달 상단 상태 표시)
//
//   사용 예:
//     <DetailModalStatusBadge booking={b} room={r} currentUser={me} currentUserId={uid} currentUserEmail={mail} />
// ─────────────────────────────────────────────────────────────────────────────

import type { Booking, Room } from '../../types'
import { BookingStatusBadge } from './BookingStatusBadge'

interface DetailModalStatusBadgeProps {
  booking:      Booking
  room?:        Room | null
  /** @deprecated P4-B-3 이후 제거 예정 */
  currentUser?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 UUID */
  currentUserId?: string
  /** ← [2026-04-24 P4-B] 현재 로그인 사용자 이메일 */
  currentUserEmail?: string
  /** 관리자 전용 회의실 여부 (승인완료 칩 판정에 사용). 생략 시 room.is_admin_only 참조 */
  isAdminRoom?: boolean
}

/**
 * DetailModal 전용 상태 칩
 * Figma 212:322 / 212:324 StautsChip 스펙으로 고정 렌더 (padding 4×10, radius 8, 11px Medium).
 * 내부 상태 판정은 BookingStatusBadge의 로직을 그대로 사용.
 */
export function DetailModalStatusBadge({
  booking,
  room,
  currentUser,
  currentUserId,       // ← [2026-04-24 P4-B]
  currentUserEmail,    // ← [2026-04-24 P4-B]
  isAdminRoom,
}: DetailModalStatusBadgeProps) {
  return (
    <BookingStatusBadge
      booking={booking}
      room={room}
      currentUser={currentUser}
      currentUserId={currentUserId}        // ← [2026-04-24 P4-B] 투명 전파
      currentUserEmail={currentUserEmail}  // ← [2026-04-24 P4-B] 투명 전파
      isAdminRoom={isAdminRoom ?? !!room?.is_admin_only}
      shape="square"
    />
  )
}
