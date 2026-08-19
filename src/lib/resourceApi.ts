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
): Promise<ResourceBooking> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('로그인이 필요합니다.')

  const row = {
    id:             `r${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    item_id:        draft.item_id,
    user_id:        user.id,
    user_email:     user.email ?? '',
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
