/**
 * resourceApi.ts — 자원예약 Supabase API (Phase 2A)
 *
 * DB: resource_categories / resource_items / resource_bookings (20260734)
 *
 * 설계 메모
 *  - user 정보: resource_bookings.user_id 는 FK 없음(bookings 관례) → PostgREST 조인 불가.
 *    live 이름·부서는 화면에서 users 풀 lookup, user_name/user_dept 스냅샷은 퇴사자 폴백.
 *  - occupied_until 은 서버 트리거가 계산해 덮어쓴다. insert 시 end_at 을 placeholder 로 보냄
 *    (NOT NULL 충족용 — 어떤 값을 보내도 트리거가 재계산).
 *  - 겹침은 DB EXCLUDE(23P01)가 최종 방어. 프론트 사전검사는 두지 않는다 —
 *    회의실 check_booking_conflict 같은 RPC 는 EXCLUDE 도입 전 유산이며,
 *    여기는 처음부터 DB 가 막아주므로 에러 매핑으로 충분 (근본 해결 우선 원칙).
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 2A)
 */

import { supabase } from './supabase'
import type {
  ResourceBooking, ResourceBookingDraft, ResourceCategory, ResourceItem,
} from '../types/resource'

/* ── 조회 ─────────────────────────────────────────────────────────────── */

/** 활성 카테고리 (sort_order 순) */
export async function loadResourceCategories(): Promise<ResourceCategory[]> {
  const { data, error } = await supabase
    .from('resource_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceCategory[]
}

/** 전체 개체 (retired 포함 — 표시 여부는 화면이 결정) */
export async function loadResourceItems(): Promise<ResourceItem[]> {
  const { data, error } = await supabase
    .from('resource_items')
    .select('*, category:resource_categories(*)')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceItem[]
}

/**
 * 표시에 필요한 confirmed 예약:
 * 아직 점유가 살아있거나(occupied_until ≥ now-7d 여유) 미래인 것.
 * 연체(점유 종료 후 미반납)도 카드에 보여야 하므로 과거 7일 버퍼를 둔다.
 */
export async function loadResourceBookings(): Promise<ResourceBooking[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('resource_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .gte('occupied_until', since)
    .order('start_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceBooking[]
}

/**
 * 범위 조회 (Phase 2B 타임라인·캘린더) — 점유구간이 [from, to] 와 겹치는 confirmed 예약.
 * 과거 달 조회를 위해 2A 의 loadResourceBookings(현재성 버퍼)와 별도로 둔다.
 */
export async function loadResourceBookingsRange(fromISO: string, toISO: string): Promise<ResourceBooking[]> {
  const { data, error } = await supabase
    .from('resource_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .gte('occupied_until', fromISO)
    .lte('start_at', toISO)
    .order('start_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceBooking[]
}

/* ── 생성 ─────────────────────────────────────────────────────────────── */

/** 트리거·제약 에러 → 사용자 문구 (설계서 §3 매핑) */
function resourceErrorMessage(code: string | undefined, message: string): string {
  if (code === '23P01' || message.includes('resource_bookings_no_overlap') || message.includes('exclusion'))
    return '해당 기간에 이미 예약이 있습니다. 반납일까지 자원이 점유되니 다른 시간이나 자원을 선택해 주세요.'
  if (message.includes('USAGE_MUST_BE_SAME_DAY'))
    return '사용 시작과 종료는 같은 날이어야 합니다. 다음 날까지 쓰신다면 반납일로 지정해 주세요.'
  if (message.includes('RETURN_BEFORE_START'))
    return '반납일은 사용일보다 빠를 수 없습니다.'
  if (message.includes('EMPLOYMENT') || message.includes('DEPART'))
    return '재직 상태에서만 예약할 수 있습니다.'   // 퇴사자 게이트 (assert_employment_can_create)
  return message
}

export async function insertResourceBooking(
  draft: ResourceBookingDraft,
  snapshot: { user_name: string; user_dept: string },
  booker?: { user_id: string; email: string },   // ← [2026-08-19 Phase 3] 대리예약 — 회의실 insertBooking booker override 패턴
): Promise<ResourceBooking> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('로그인이 필요합니다.')

  const row = {
    id:             `r${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    item_id:        draft.item_id,
    user_id:        booker?.user_id ?? user.id,          // ← [Phase 3] override 우선 (RLS: 본인 OR resource 관리자)
    user_email:     booker?.email ?? user.email ?? '',
    user_name:      snapshot.user_name,
    user_dept:      snapshot.user_dept,
    start_at:       draft.start_at,
    end_at:         draft.end_at,
    return_due:     draft.return_due,
    occupied_until: draft.end_at,          // placeholder — 트리거가 재계산
    memo:           draft.memo,
  }
  const { data, error } = await supabase
    .from('resource_bookings').insert(row).select().single()
  if (error) throw new Error(resourceErrorMessage(error.code, error.message))
  return data as ResourceBooking
}

/* ── 취소 ─────────────────────────────────────────────────────────────── */

/** 본인 예약 취소 — 사용 시작 전만 (호출부 검증 + RLS 본인 한정) */
export async function cancelResourceBooking(id: string): Promise<void> {
  const { error } = await supabase
    .from('resource_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'user' })
    .eq('id', id)
    .eq('status', 'confirmed')
  if (error) throw new Error(error.message)
}

/* ── 어드민 (Phase 3) — RLS has_admin_role('resource') 전제 ──────────────── */

/** 어드민: 비활성 포함 전체 카테고리 */
export async function loadResourceCategoriesAll(): Promise<ResourceCategory[]> {
  const { data, error } = await supabase
    .from('resource_categories').select('*')
    .order('sort_order', { ascending: true }).order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceCategory[]
}

/** 어드민 현황: 기간 내 시작 + (기간 무관) 미반납 confirmed — 연체가 기간 필터에 묻히지 않게 */
export async function loadResourceBookingsAdmin(fromISO: string): Promise<ResourceBooking[]> {
  const { data, error } = await supabase
    .from('resource_bookings').select('*')
    .or(`start_at.gte.${fromISO},and(status.eq.confirmed,returned_at.is.null)`)
    .order('start_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceBooking[]
}

export interface ResourceCategoryDraft {
  id?:               number
  name:              string
  slot_step_minutes: number
  allow_multi_day:   boolean
  open_time:         string   // 'HH:MM'
  close_time:        string
  is_active:         boolean
  sort_order?:       number
}

/** 카테고리 생성/수정 (id 유무로 분기) */
export async function upsertResourceCategory(d: ResourceCategoryDraft): Promise<void> {
  const payload = {
    name: d.name.trim(), slot_step_minutes: d.slot_step_minutes,
    allow_multi_day: d.allow_multi_day, open_time: d.open_time, close_time: d.close_time,
    is_active: d.is_active, ...(d.sort_order != null ? { sort_order: d.sort_order } : {}),
  }
  const q = d.id != null
    ? supabase.from('resource_categories').update(payload).eq('id', d.id)
    : supabase.from('resource_categories').insert(payload)
  const { error } = await q
  if (error) throw new Error(
    error.message.includes('duplicate') ? '같은 이름의 카테고리가 이미 있습니다.' : error.message)
}

export interface ResourceItemDraft {
  id?:         number
  category_id: number
  label:       string
  asset_code:  string | null
  status:      'available' | 'maintenance' | 'retired'
}

/** 개체 생성/수정 — 삭제 없음, 폐기는 status='retired' (이력 보존, 고지 확정) */
export async function upsertResourceItem(d: ResourceItemDraft): Promise<void> {
  const payload = {
    category_id: d.category_id, label: d.label.trim(),
    asset_code: d.asset_code?.trim() || null, status: d.status,
  }
  const q = d.id != null
    ? supabase.from('resource_items').update(payload).eq('id', d.id)
    : supabase.from('resource_items').insert(payload)
  const { error } = await q
  if (error) throw new Error(
    error.message.includes('duplicate') ? '같은 라벨 또는 자산번호가 이미 있습니다.' : error.message)
}

/** 반납 확인 — 관리자 전용 (트리거 RETURN_CONFIRM_ADMIN_ONLY 가 최종 방어) */
export async function adminConfirmResourceReturn(bookingId: string, adminUserId: string): Promise<void> {
  const { error } = await supabase
    .from('resource_bookings')
    .update({ returned_at: new Date().toISOString(), returned_by: adminUserId })
    .eq('id', bookingId).eq('status', 'confirmed')
  if (error) throw new Error(
    error.message.includes('RETURN_CONFIRM_ADMIN_ONLY')
      ? '반납 확인 권한이 없습니다.' : error.message)
}

/**
 * 관리자 취소 — 사유는 memo 에 '[관리자취소]' 접두로 기록 (100자 CHECK 내 절삭).
 * 전용 사유 컬럼은 두지 않는다 — 취소가 잦아지면 그때 컬럼 추가가 근본 해결.
 */
export async function adminCancelResourceBooking(bookingId: string, reason: string): Promise<void> {
  const memo = `[관리자취소] ${reason.trim()}`.slice(0, 100)
  const { error } = await supabase
    .from('resource_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(),
              cancelled_by: 'admin', memo })
    .eq('id', bookingId).eq('status', 'confirmed')
  if (error) throw new Error(error.message)
}
