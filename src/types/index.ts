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
  employee_id: string   // 사번 (동명이인 구분 + SSO 로그인 식별자)
  name:        string
  dept:        string
  role:        UserRole
  email:       string
}

// ─── 예약 타입 ──────────────────────────────────────────────────────────────────

export interface Booking {
  id: string
  room_id: number
  title: string
  memo?: string
  attendees?: string[]
  /** "YYYY-MM-DDThh:mm:ss+09:00" */
  start_at: string
  end_at: string
  user:              string
  user_employee_id?: string   // 사번 (동명이인 구분용)
  dept:              string
  checkedIn:         boolean
  autoCancelled:  boolean
  cancelledBy?:   'user' | 'system' | null  // 직접취소 vs 노쇼자동취소
  status?:        'confirmed' | 'pending' | 'rejected'  // 에메랄드 승인 상태
  earlyEnded?: boolean
  createdAt: number
  recurGroupId?: string | null
  /** true = 시드 데이터, false = 사용자가 직접 생성 */
  _seed?: boolean
}

// ─── 예약 폼 타입 (BookingModal 입력값) ─────────────────────────────────────────

export interface BookingForm {
  room_id: number | null
  title: string
  memo: string
  attendees: string[]
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
  | { type: 'bookingDone'; data: Booking }
  | { type: 'recurDone'; data: RecurDoneData }
  | { type: 'roomDetail'; data: Room }
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
  checkinWaiting?: boolean  // BUSY: 체크인 대기 중 (유예기간 10분 이내)
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

export type AppView = 'home' | 'calendar' | 'mypage' | 'admin'
