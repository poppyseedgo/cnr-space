/**
 * resource.ts — 자원예약 타입 (Phase 2A)
 *
 * DB: 20260734_resource_phase1.sql (resource_categories / resource_items / resource_bookings)
 * 설계: docs/RESOURCE_DESIGN_20260812.md
 *
 * types/index.ts 에 합치지 않고 분리 — 도서관과 동일하게 독립 모듈로 유지.
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 *  - [2026-08-26] period_changed_* 이력 + ResourceBookingPeriodDraft (기한 변경)
 */

export interface ResourceCategory {
  id:                number
  name:              string
  description:       string | null
  icon:              string | null
  /** 시간 선택 단위(분) — 15 | 30 | 60. 모달 시간 옵션과 안내 배너 문구의 근거 */
  slot_step_minutes: number
  /** false = 당일 반납 강제 (모달에서 반납일 고정) */
  allow_multi_day:   boolean
  open_time:         string   // 'HH:MM:SS' (KST)
  close_time:        string
  is_active:         boolean
  sort_order:        number
  created_at:        string
}

export type ResourceItemStatus = 'available' | 'maintenance' | 'retired'

export interface ResourceItem {
  id:          number
  category_id: number
  label:       string
  asset_code:  string | null
  /** DB 저장 상태 — 'borrowed' 없음. 점유/연체는 예약에서 파생 (utils/resourceStatus.ts SSOT) */
  status:      ResourceItemStatus
  memo:        string | null
  sort_order:  number
  created_at:  string
  category?:   ResourceCategory | null
}

export type ResourceBookingStatus = 'confirmed' | 'cancelled'

export interface ResourceBooking {
  id:             string            // 'r{epoch_ms}_{rand}' — 클라 생성 (bookings 'b...' 관례)
  item_id:        number
  user_id:        string            // uuid — live 정보는 users 풀에서 lookup
  user_email:     string
  user_name:      string | null     // 스냅샷 — 퇴사자 폴백 전용
  user_dept:      string | null
  start_at:       string            // timestamptz ISO
  end_at:         string
  return_due:     string            // 'YYYY-MM-DD' (KST)
  /** 서버 트리거 계산값 — 클라가 보낸 값은 항상 덮어써진다 */
  occupied_until: string
  status:         ResourceBookingStatus
  returned_at:    string | null     // 관리자 반납 확인 시각
  returned_by:    string | null
  cancelled_at:   string | null
  cancelled_by:   string | null     // 'user' | 'admin' | 'departed'
  memo:           string | null
  created_at:     string
  /** ← [2026-08-26] 기간(사용시간·반납일) 최근 변경 이력 — 20260752 트리거 자동 기록 */
  period_changed_at?: string | null
  period_changed_by?: string | null
}

/** ← [2026-08-26] 기간 변경 시 클라가 보내는 필드 (start_at 은 시작 후 잠금 — 트리거 START_LOCKED) */
export interface ResourceBookingPeriodDraft {
  start_at:   string
  end_at:     string
  return_due: string
  memo:       string | null
}

/** insert 시 클라가 채우는 필드 (트리거 계산·기본값 제외) */
export interface ResourceBookingDraft {
  item_id:    number
  start_at:   string
  end_at:     string
  return_due: string
  memo:       string | null
}
