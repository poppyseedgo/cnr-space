// ============================================================
// shipping.ts — 운송내역서 임시 등록 페이지(#shipping) 타입
// [2026-11-19] 신규 — DB public.shipping_records (20261023_shipping_temp.sql) 와 1:1 (snake_case)
// ============================================================
import type { ShippingItemType, ShippingDirection, ShippingUnit, ShippingRegion } from '../data/shipping'

/** DB 행 그대로 */
export interface ShippingRecord {
  id:               string
  shipping_no:      string             // 수발신번호 (DB 발급)
  item_type:        ShippingItemType
  issued_on:        string             // 등록일 (KST date) — 당일 수정 판정 기준
  seq:              number
  user_id:          string | null
  user_name:        string             // 등록 시점 스냅샷 (서버가 profiles 에서 채움)
  user_email:       string
  employee_no:      string             // 사번
  project_no:       string
  billable:         boolean
  requested_on:     string             // 신청일자 = 발송할 날짜 (KST date)
  amount:           number
  direction:        ShippingDirection
  unit:             ShippingUnit | null
  quantity:         number
  contents:         string
  tracking_no:      string
  region:           ShippingRegion
  weight_g:         number
  note:             string
  sender_company:   string
  sender_name:      string
  sender_phone:     string
  sender_addr1:     string
  sender_addr2:     string
  receiver_company: string
  receiver_name:    string
  receiver_phone:   string
  receiver_addr1:   string
  receiver_addr2:   string
  created_at:       string
  updated_at:       string
  deleted_at:       string | null
}

/** shipping_create / shipping_update 에 보내는 값 (등록자·번호는 서버가 채운다) */
export interface ShippingPayload {
  project_no:       string
  billable:         boolean | null     // null = 미선택 → 서버가 REQUIRED:billable
  item_type:        ShippingItemType | ''
  requested_on:     string
  direction:        ShippingDirection
  unit:             ShippingUnit | ''
  quantity:         string
  contents:         string
  tracking_no:      string
  region:           ShippingRegion | ''
  note:             string
  sender_company:   string
  sender_name:      string
  sender_phone:     string
  sender_addr1:     string
  sender_addr2:     string
  receiver_company: string
  receiver_name:    string
  receiver_phone:   string
  receiver_addr1:   string
  receiver_addr2:   string
}

/** 관리자 화면 검색 조건 */
export interface ShippingAdminFilter {
  projectNo:  string
  userName:   string
  itemType:   ShippingItemType | ''
  direction:  ShippingDirection | ''
  trackingNo: string
  from:       string    // 조회기간 시작 (신청일자 기준, YYYY-MM-DD)
  to:         string
}
