// ─── 도메인 데이터 타입 ────────────────────────────────────────────────────────

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
  status:          'active' | 'returned' | 'overdue' | 'lost'
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
  status:           'active' | 'returned' | 'overdue' | 'lost'
  book:             MyBookLoanBook | null
}

/** 화면 표시용 파생 상태 (DB status + due_at 기준 클라 계산) */
export type LoanDisplayStatus =
  | 'active'    // 대여중 (여유)
  | 'due_soon'  // 반납임박 (D-2 이내)
  | 'overdue'   // 연체중
  | 'returned'  // 반납완료
  | 'lost'      // 분실

/** 연장 RPC 실패 코드 (extend_book_checkout) */
export type ExtendErrorCode =
  | 'CHECKOUT_NOT_FOUND'
  | 'NOT_OWNER'
  | 'NOT_ACTIVE'
  | 'ALREADY_EXTENDED'
  | 'OVERDUE'
  | 'UNKNOWN'
