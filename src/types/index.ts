// ─── 도메인 데이터 타입 ────────────────────────────────────────────────────────

// ← [2026-07-27 목적] 목적 코드 union — data/bookingPurpose.ts 가 SSOT (type-only import, 순환 없음)
import type { BookingPurposeCode } from '../data/bookingPurpose'

export interface Floor {
  floor_id: number
  floor_no: number
  floor_name: string
}

export interface Feature {
  feature_id: number
  feature_key: string
  feature_name: string
}

export interface Room {
  room_id:      number
  floor_id:     number
  room_code:    string
  room_name:    string
  room_name_ko: string
  capacity:     number
  notes:        string
  usage_rules?: string  // ← [2026-05-14] 회의실 이용규칙 (멀티라인 자유 텍스트, 옵셔널)
  is_active:    boolean
  is_admin_only?: boolean
  color:        string
  thumbnail:    string
  gallery?:     string[]
  features?:    Feature[]   // Supabase join으로 로드된 기능 목록
}

export interface RoomFeature {
  room_id: number
  feature_id: number
  value_text: string | null
}

export interface RoomRule {
  rule_id: number
  room_id: number
  rule_type: 'ADMIN_ONLY' | string
  rule_text: string
}

export type UserRole = 'USER' | 'ADMIN'

export interface AppUser {
  user_id:     string
  employee_id: string
  name:        string
  dept:        string
  role:        UserRole
  email:       string
  avatar_url?: string | null
  is_active?:  boolean
}

export interface DepartedUser {
  id:          string
  name:        string
  email:       string
  avatar_url?: string | null
  dept:        string
  employee_id: string
  departed_at: string  // ISO 타임스탬프
}

// ─── 참석자 타입 ─────────────────────────────────────────────────────────────
// AttendeeRef: DB 저장/조회용 최소 식별자 (email이 유일 키)
export interface AttendeeRef {
  email: string
  name:  string
}

// AttendeeFormItem: BookingModal 내부 폼 상태용 (아바타·부서 포함 풍부한 객체)
export interface AttendeeFormItem extends AttendeeRef {
  user_id:     string
  dept?:       string
  avatar_url?: string | null
}

// ─── 예약 타입 ──────────────────────────────────────────────────────────────────

export interface Booking {
  id: string
  room_id: number
  title: string
  memo?: string
  attendees?: AttendeeRef[]          // email+name 쌍 — 화면 표시 및 avatar 역조회 키
  /** "YYYY-MM-DDThh:mm:ss+09:00" */
  start_at: string
  end_at: string
  user:              string
  user_id?:          string   // 예약자 UUID — users 배열에서 avatar_url 역조회용
  user_email?:       string   // ← [2026-04-24 P3-2] 예약자 이메일 — UUID OR email 이중 복원 판정용 (isBooker)
  user_employee_id?: string   // 사번 (동명이인 구분용)
  dept:              string
  checkedIn:         boolean
  autoCancelled:  boolean
  cancelledBy?:   'user' | 'system' | 'admin' | null  // 직접취소 | 노쇼/기한초과자동취소 | 관리자강제취소
  // ← [2026-05-04] 누가 취소했는지 user_id 저장 (예약자/참석자/관리자 구분)
  //   · 'user' 취소: 취소한 본인의 UUID (예약자 또는 참석자)
  //   · 'admin' 취소: 강제취소한 관리자 UUID
  //   · 'system' 취소: NULL (시스템이라 user 없음)
  //   · NULL fallback: 기존 데이터 (backfill 안 함) → BookingStatusBadge에서 "예약자 취소"로 안전 표시
  cancelledByUserId?: string | null
  status?:        'confirmed' | 'pending' | 'rejected' | 'cancelled'  // 에메랄드 승인 상태
  reject_reason?: string | null  // 거절 사유
  processedByName?:   string | null  // 승인/거절 처리한 관리자 이름
  processedByAvatar?: string | null  // 승인/거절 처리한 관리자 아바타
  earlyEnded?: boolean
  originalEndAt?: string | null  // 조기 반납 시 원래 예약 종료 시간
  // ← [2026-07-27 목적] 회의 목적 코드 — SSOT: src/data/bookingPurpose.ts (10종)
  //   · null/undefined = 기능 도입 전 예약 → 전 화면에서 칩 생략 (고지 확정)
  purpose?: BookingPurposeCode | null
  // ← [2026-07-27 목적] '기타(etc)' 전용 구체 사유 (1~40자). etc 외에는 null (DB CHECK 강제)
  purposeDetail?: string | null
  createdAt: number
  recurGroupId?: string | null
  /** true = 시드 데이터, false = 사용자가 직접 생성 */
}

// ─── 예약 폼 타입 (BookingModal 입력값) ─────────────────────────────────────────

export interface BookingForm {
  room_id: number | null
  title: string
  memo: string
  attendees: AttendeeFormItem[]     // 폼 내부: user_id·dept·avatar_url 포함 풍부한 객체
  start: string   // "HH:MM"
  end: string     // "HH:MM"
  recur: RecurType
}

export type RecurType = 'NEVER' | 'EVERY_DAY' | 'EVERY_WEEK'

// ─── 모달 상태 타입 ──────────────────────────────────────────────────────────────

export type ModalState =
  | { type: 'new'; prefill: Partial<BookingForm> & { date?: string; room_id?: number } }
  | { type: 'detail'; data: Booking }
  | { type: 'edit'; data: Booking }
  | { type: 'changeOwner'; data: Booking }  // ← [2026-06-12] 관리자 예약자 변경 모달
  | { type: 'bookingDone'; data: Booking }
  | { type: 'recurDone'; data: RecurDoneData }
  | { type: 'roomDetail'; data: Room }
  | { type: 'confirmCancel'; data: { booking: Booking; onConfirm: () => Promise<void> | void } }
  | null

export interface RecurDoneData {
  bookings: Booking[]
  skipped: number
  recur: RecurType
  room: Room | undefined
  floor: Floor | undefined
}

// ─── 회의실 상태 타입 ────────────────────────────────────────────────────────────

export type RoomStatusType = 'AVAILABLE' | 'BUSY' | 'SOON'

export interface RoomStatus {
  type: RoomStatusType
  label: string
  endTime?: string
  minsLeft?: number
  nextStart?: string
  minsUntil?: number
  nextBooking?: Booking
  booking?: Booking
  checkedIn?: boolean       // BUSY: 체크인 완료 여부
  checkinWaiting?: boolean  // BUSY: 유예기간 10분 이내 미체크인 / SOON: 시작 5분 전 윈도우 미체크인 (← [2026-05-12] SOON 분기 추가)
}

// ─── 충돌 검사 결과 ──────────────────────────────────────────────────────────────

export interface ConflictResult {
  conflict: boolean
  reason?: 'INVALID_TIME' | 'OVERLAP'
  booking?: Booking
}

// ─── Toast 타입 ─────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  msg: string
  type: ToastType
}

// ─── 캘린더 뷰 타입 ──────────────────────────────────────────────────────────────

export type CalViewType = 'timeline' | 'week' | 'day' | 'month' | 'list'

// ─── App View 타입 ───────────────────────────────────────────────────────────────

export type AppView = 'home' | 'calendar' | 'mypage' | 'admin' | 'library'  // ← [2026-07-16] library 추가

// ─── 도서관 모듈 타입 ─────────────────────────────────────────────────────────

export interface BookCategory {
  id:         number
  name:       string
  parent_id:  number | null
  sort_order: number
}

export interface BookCheckout {
  id:              string   // uuid
  book_id:         number
  user_id:         string   // uuid
  checkout_at:     string
  due_at:          string
  returned_at:     string | null
  extension_count: number
  /** ← [2026-07-23] 리터럴 유니온 직접 선언 → BookCheckoutStatus 참조로 교체.
   *   20260722 마이그레이션에서 pending/rejected/cancelled 가 추가됐는데 이 타입만
   *   갱신되지 않아, 어드민에서 전체 이력을 다룰 때 실제 DB 값이 타입에 없는
   *   상태였다(컴파일은 통과하지만 분기 누락을 컴파일러가 잡아주지 못함). */
  status:          BookCheckoutStatus
  notes:           string | null
  created_at:      string
  updated_at:      string
}

export interface Book {
  id:          number
  category_id: number | null
  title:       string
  author:      string | null
  publisher:   string | null
  isbn:        string | null
  cover_url:   string | null
  status:      'available' | 'borrowed' | 'maintenance' | 'lost'
  notes:       string | null
  acquired_at: string | null
  /** ← [2026-07-20] ⭐NEW⭐ 노출 종료일(date, KST). NULL = 표시 안 함
   *   판정은 libraryListShared.isNewBook() 이 SSOT */
  new_until:   string | null
  created_at:  string
  updated_at:  string
  category?:        BookCategory | null
  active_checkout?: BookCheckout | null
}

// ─────────────────────────────────────────────────────────────────────────────
// [2026-07-18] 마이페이지 '내 대여' — 조회 + 연장신청
//   · book_checkouts + books 조인 결과 (본인 대여만, RLS로 보장)
//   · 표시 상태(대여중/반납임박/연체/반납완료/분실)는 utils/bookLoan.ts 에서 파생
// ─────────────────────────────────────────────────────────────────────────────

/** 대여 목록에 함께 조인되는 도서 정보 (필요 컬럼만) */
export interface MyBookLoanBook {
  title:     string
  author:    string | null
  publisher: string | null
  cover_url: string | null
}

/** 마이페이지 '내 대여' 행 (book_checkouts × books) */
export interface MyBookLoan {
  id:               string   // checkout uuid
  book_id:          number
  checkout_at:      string
  due_at:           string
  returned_at:      string | null
  extension_count:  number   // 0 | 1 (DB CHECK <= 1)
  last_extended_at: string | null
  status:           BookCheckoutStatus
  book:             MyBookLoanBook | null
  // ── 신청/승인 플로우 (← [2026-07-22]) ────────────────────────────────
  requested_at?:      string | null
  processed_at?:      string | null
  processed_by_name?: string | null
  reject_reason?:     string | null
  notes?:             string | null
  /**
   * ← [2026-07-21] 연체 제재 면제 여부.
   *   true 면 이 대여 건은 제재 계산에서 완전히 빠진다(진행 중 차단·반납 시 확정 둘 다).
   *   정책 시행 전에 대여된 건과, 관리자가 사정을 인정한 건에 세워진다.
   */
  penalty_exempt?:    boolean
  /**
   * ← [2026-07-23] 대여 레코드 생성 시각(book_checkouts.created_at).
   *
   *   checkout_at(대여일)과 다른 값이다. 대여일은 사용자가 고른 날짜(미래 예약 가능,
   *   관리자 소급 등록 가능)이고 created_at 은 "언제 신청·등록됐는가" 다.
   *   어드민이 '방금 들어온 대여'를 보려면 이 값으로 조회·정렬해야 한다.
   */
  created_at?:        string
}

/**
 * book_checkouts.status
 *
 * ← [2026-07-21] 승인 플로우 폐지. pending/rejected 는 **더 이상 생성되지 않지만**
 *   과거 이력 행이 남아 있어 유니온에서 제거하지 않는다. 제거하면 마이페이지
 *   이력에서 그 행들이 타입상 표현 불가능해진다.
 *   cancelled 는 의미가 바뀌었다: '신청 취소' → '예약 취소'(시작 전 본인 취소).
 */
export type BookCheckoutStatus =
  | 'pending'    // [폐지] 구 승인 대기 — 신규 생성 없음, 과거 이력만
  | 'active'     // 대여중
  | 'returned'   // 반납완료
  | 'overdue'    // 연체 (DB 자동전환 배치는 없음 — 표시는 due_at 기준)
  | 'lost'       // 분실
  | 'rejected'   // [폐지] 구 관리자 거절 — 신규 생성 없음, 과거 이력만
  | 'cancelled'  // 예약 취소 (시작 전 본인 취소) ← [2026-07-21] 의미 변경

/** 대여 신청 1건 + 도서/신청자 정보 (관리자 승인 패널용) */
export interface BookRequest extends MyBookLoan {
  /** 신청자 user_id — MyBookLoan(본인 전용)에는 없으므로 여기서 추가 */
  user_id:    string
  user_name?: string | null
  user_dept?: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// [2026-07-23] 어드민 '도서 관리' 탭 — 전체 대여 이력 행
//   · MyBookLoan(본인 전용)과 필드 구성이 같고 user_id 만 더 필요하다.
//     새 타입을 처음부터 다시 선언하면 필드가 갈라지므로 확장으로 둔다.
//   · 정규화는 api.ts 의 toLoanRow() 하나를 계속 재사용한다.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminBookLoan extends MyBookLoan {
  /** 대여자 user_id — 이름/부서는 users 배열에서 live 조회 (스냅샷 저장 안 함) */
  user_id: string
}

/** 도서 추가/편집 폼 상태
 *
 *  ← [2026-07-23] bookFormShared.tsx(구 LibraryPage) 지역 타입에서 승격.
 *    저장 로직(persistBook)이 api.ts 로 이동하면서 lib 계층이 이 타입을 알아야
 *    하는데, components → lib → components 순환 참조가 생긴다.
 *    타입은 최하위 계층(types)에 두는 것이 유일하게 순환이 없는 배치다.
 */
export interface BookEditForm {
  title:       string
  author:      string
  publisher:   string
  isbn:        string
  category_id: string
  acquired_at: string
  /** ⭐NEW⭐ — 체크 여부와 노출 종료일('YYYY-MM-DD') */
  is_new:      boolean
  new_until:   string
  status:      'available' | 'maintenance' | 'lost'
  notes:       string
  cover_url:   string
}

/** 반납/분실 처리 액션 — admin_return_book RPC 의 p_action 과 1:1 */
export type BookReturnAction = 'return' | 'lost'

/** admin_return_book RPC 실패 코드 */
export type BookReturnErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_ADMIN'
  | 'INVALID_ACTION'
  | 'CHECKOUT_NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'UNKNOWN'

/** 화면 표시용 파생 상태 (DB status + due_at 기준 클라 계산) */
export type LoanDisplayStatus =
  | 'pending'   // 승인 대기중 (← [2026-07-22])
  | 'scheduled' // 대여 예정 — checkout_at 이 아직 미래 (← [2026-07-20])
  | 'active'    // 대여중 (여유)
  | 'due_soon'  // 반납임박 (D-2 이내)
  | 'overdue'   // 연체중
  | 'returned'  // 반납완료
  | 'lost'      // 분실
  | 'rejected'  // 거절됨 (← [2026-07-22])
  | 'cancelled' // 예약 취소 (← [2026-07-21] 의미 변경)

/** 연장 RPC 실패 코드 (extend_book_checkout) */
/** 대여 등록/신청/승인 RPC 실패 코드 (← [2026-07-22]) */
export type CheckoutErrorCode =
  | 'NOT_AUTHENTICATED'
  | 'NOT_ADMIN'
  | 'NOT_OWNER'
  | 'NO_BORROWER'
  | 'NO_BOOKS'
  | 'NOTES_TOO_LONG'
  | 'REASON_TOO_LONG'
  | 'LIMIT_EXCEEDED'
  | 'ALREADY_REQUESTED'
  | 'BOOK_NOT_AVAILABLE'
  | 'BOOK_NOT_FOUND'
  | 'REQUEST_NOT_FOUND'
  | 'NOT_PENDING'
  | 'CHECKOUT_AT_OUT_OF_RANGE'   // ← [2026-07-20] 대여일 범위 초과 (관리자 ±365일)
  // ── [2026-07-21] 승인 폐지 + 기간 겹침 예약 도입 ────────────────────────
  | 'CHECKOUT_AT_PAST'           // 사용자는 소급 대여 불가
  | 'RESERVE_TOO_FAR'            // 예약 가능 범위(오늘+3일) 초과
  | 'PERIOD_CONFLICT'            // 해당 기간에 이미 다른 대여가 잡혀 있음
  | 'ALREADY_STARTED'            // 이미 시작된 대여는 취소 불가 (반납 경로)
  | 'CHECKOUT_NOT_FOUND'
  | 'NOT_ACTIVE'
  // ── [2026-07-21] 연체 패널티 ─────────────────────────────────────────────
  | 'PENALTY_BLOCKED'            // detail = "tier:해제일(YYYY-MM-DD 또는 빈값)"
  | 'UNKNOWN'

export type ExtendErrorCode =
  | 'CHECKOUT_NOT_FOUND'
  | 'NOT_OWNER'
  | 'NOT_ACTIVE'
  | 'ALREADY_EXTENDED'
  | 'OVERDUE'
  // ← [2026-07-20] 연체일이 1회 연장 기일(7일)을 넘겨 연장 불가
  //   'OVERDUE' 는 구 정책(연체=무조건 불가) 잔재로 남겨 둔다.
  //   parseExtendError 에서 반드시 이 코드를 'OVERDUE' 보다 먼저 검사해야 한다
  //   (문자열 includes 매칭이라 'OVERDUE_TOO_LONG' 안에 'OVERDUE' 가 포함됨).
  | 'OVERDUE_TOO_LONG'
  | 'UNKNOWN'


// ─── 연체 패널티 (← [2026-07-21]) ─────────────────────────────────────────────

/** 제재 등급. 'overdue_now' 는 확정 제재가 아니라 "지금 연체 중" 차단이다. */
export type BookPenaltyTier = '7d' | '30d' | 'permanent' | 'overdue_now'

/**
 * 대여 차단 상태 — book_penalty_state RPC 반환값
 *
 * blockedUntil 이 null 인데 blocked=true 인 경우가 두 가지다.
 *   · tier='permanent'   → 영구 (해제일 없음)
 *   · tier='overdue_now' → 반납할 때까지 (기한이 아니라 조건)
 * 둘을 tier 로 구분해야 화면 문구가 어긋나지 않는다.
 */
export interface BookPenaltyState {
  blocked:      boolean
  tier:         BookPenaltyTier | null
  blockedUntil: string | null      // ISO. null = 영구 또는 반납 시까지
  overdueDays:  number             // effective_due 초과 일수 (due_at 기준 아님)
  reason:       string | null
}

/** 어드민 '대여 제한' 탭 행 — admin_list_book_penalties RPC 반환값 */
export interface AdminBookPenalty {
  id:             string
  user_id:        string
  checkout_id:    string | null
  book_title:     string | null
  overdue_days:   number
  tier:           '7d' | '30d' | 'permanent'
  starts_at:      string
  ends_at:        string | null
  reason:         string | null
  revoked_at:     string | null
  revoked_by:     string | null
  revoked_reason: string | null
  created_at:     string
}
