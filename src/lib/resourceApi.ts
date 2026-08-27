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
 *  - [2026-08-26] 기한 변경(updateResourceBookingPeriod) + 20260752 가드 에러 매핑 + 연체 조회
 *  - [2026-08-27] 연체 조회 return_due<오늘(KST) 로 SSOT 정합 / 표시 조회에 미반납 건 항상 포함
 */

import { supabase } from './supabase'
import { todayStr } from '../utils/time'   // ← [2026-08-27] KST 오늘
// ← [2026-08-19 Phase 4] 알림 발사 — send-notification invoke (fire-and-forget, 도서 *WithNotify 패턴)
import type {
  ResourceBooking, ResourceBookingDraft, ResourceBookingPeriodDraft, ResourceCategory, ResourceItem,
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
 * 아직 점유가 살아있거나(occupied_until ≥ now-7d 여유) 미래인 것 + 미반납 건 전부.
 * ← [2026-08-27] 미반납(사용중·연체)은 기간 무관하게 카드·헤더에 보여야 하므로 OR 로 항상 포함
 *   (구: 7일 버퍼만 → 7일 넘은 연체가 카드에서 사라져 '예약가능'으로 오표기)
 */
export async function loadResourceBookings(): Promise<ResourceBooking[]> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('resource_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .or(`occupied_until.gte.${since},returned_at.is.null`)
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

/**
 * ← [2026-08-26] 미반납 연체 예약 — 실물이 돌아오지 않은 건.
 * 범위 조회는 occupied_until ≥ from 이라 오래된 연체가 빠질 수 있어 모달 개체 가용 판정용으로 별도 조회.
 * ← [2026-08-27] 연체 판정 SSOT 와 동일: return_due < 오늘(KST). (구: occupied_until < now → 반납일 당일도 연체)
 */
export async function loadOverdueResourceBookings(): Promise<ResourceBooking[]> {
  const { data, error } = await supabase
    .from('resource_bookings')
    .select('*')
    .eq('status', 'confirmed')
    .is('returned_at', null)
    .lt('return_due', todayStr())
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
  // ← [2026-08-26] 20260752 가드 트리거 — 회의실 prevent_past_booking / date_limit 과 동일 정책
  if (message.includes('PAST_START'))
    return '이미 지난 시간은 예약할 수 없습니다. 시간을 다시 선택해 주세요.'
  if (message.includes('PAST_END'))
    return '종료 시간은 현재 시각 이후여야 합니다.'
  if (message.includes('PAST_RETURN_DUE'))
    return '반납일은 오늘 이후여야 합니다.'
  if (message.includes('DATE_LIMIT_30D'))
    return '예약은 오늘부터 30일 이내만 가능합니다.'
  if (message.includes('START_LOCKED'))
    return '이미 시작한 예약은 시작 시간을 변경할 수 없습니다.'
  if (message.includes('BOOKING_CLOSED'))
    return '취소되었거나 반납이 완료된 예약은 변경할 수 없습니다.'
  if (message.includes('IMMUTABLE_FIELD'))
    return '자원과 예약자는 변경할 수 없습니다. 취소 후 다시 예약해 주세요.'
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
    .from('resource_bookings').insert(row).select(BOOKING_WITH_ITEM).single()  // ← [Phase 4] 라벨 조인 — 알림 payload 용
  if (error) throw new Error(resourceErrorMessage(error.code, error.message))
  // ← [Phase 4] 예약 완료 알림 — 대리예약은 라벨에 명시 (타입 분리 대신, 회의실 created_on_behalf 는 후속 검토)
  fireResourceNotification('resource_booking_created', data,
    booker ? { labelSuffix: ' (관리자 대리예약)' } : {})
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

/**
 * ← [2026-08-26] 기한 변경 — 예약자 본인·자원 관리자 공통 (RLS update_self_or_admin).
 * 규칙은 20260752 guard_update 트리거가 최종 방어(시작 후 start 잠금·과거·30일·닫힌 건),
 * 겹침은 EXCLUDE 가 UPDATE 에도 적용. period_changed_at/by 는 트리거 자동 기록.
 */
export async function updateResourceBookingPeriod(
  bookingId: string,
  draft: ResourceBookingPeriodDraft,
  byAdmin: boolean,
): Promise<ResourceBooking> {
  const { data, error } = await supabase
    .from('resource_bookings')
    .update({ start_at: draft.start_at, end_at: draft.end_at, return_due: draft.return_due, memo: draft.memo })
    .eq('id', bookingId).eq('status', 'confirmed')
    .select(BOOKING_WITH_ITEM).single()
  if (error) throw new Error(resourceErrorMessage(error.code, error.message))
  fireResourceNotification('resource_booking_period_changed', data,
    byAdmin ? { labelSuffix: ' (관리자 변경)' } : {})
  return data as ResourceBooking
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
  /** ← [2026-08-21] SVG 원문 (null = 아이콘 없음 — 텍스트만 표기) */
  icon?:             string | null
}

/** 카테고리 생성/수정 (id 유무로 분기) */
export async function upsertResourceCategory(d: ResourceCategoryDraft): Promise<void> {
  const payload = {
    name: d.name.trim(), slot_step_minutes: d.slot_step_minutes,
    allow_multi_day: d.allow_multi_day, open_time: d.open_time, close_time: d.close_time,
    is_active: d.is_active, icon: d.icon ?? null,  // ← [2026-08-21] draftOf 가 기존 icon 을 항상 실어 오므로 무조건 포함해도 소실 없음
    ...(d.sort_order != null ? { sort_order: d.sort_order } : {}),
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
  const { data, error } = await supabase
    .from('resource_bookings')
    .update({ returned_at: new Date().toISOString(), returned_by: adminUserId })
    .eq('id', bookingId).eq('status', 'confirmed')
    .select(BOOKING_WITH_ITEM).single()   // ← [Phase 4] 알림 payload 용
  if (error) throw new Error(
    error.message.includes('RETURN_CONFIRM_ADMIN_ONLY')
      ? '반납 확인 권한이 없습니다.' : error.message)
  fireResourceNotification('resource_return_confirmed', data)   // ← [Phase 4]
}

/**
 * 관리자 취소 — 사유는 memo 에 '[관리자취소]' 접두로 기록 (100자 CHECK 내 절삭).
 * 전용 사유 컬럼은 두지 않는다 — 취소가 잦아지면 그때 컬럼 추가가 근본 해결.
 */
export async function adminCancelResourceBooking(bookingId: string, reason: string): Promise<void> {
  const memo = `[관리자취소] ${reason.trim()}`.slice(0, 100)
  const { data, error } = await supabase
    .from('resource_bookings')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(),
              cancelled_by: 'admin', memo })
    .eq('id', bookingId).eq('status', 'confirmed')
    .select(BOOKING_WITH_ITEM).single()   // ← [Phase 4] 알림 payload 용
  if (error) throw new Error(error.message)
  fireResourceNotification('resource_booking_cancelled_by_admin', data,
    { cancelReason: reason.trim() })      // ← [Phase 4] 사유 포함 통지
}
/* ── 알림 (Phase 4) ───────────────────────────────────────────────────── */

/** 예약 row + 개체·카테고리 라벨 조인 select (알림 payload 구성용) */
const BOOKING_WITH_ITEM = '*, resource_items ( label, resource_categories ( name ) )'

function resourceLabelOf(row: any): string {
  const item = Array.isArray(row.resource_items) ? row.resource_items[0] : row.resource_items
  const cat  = item ? (Array.isArray(item.resource_categories) ? item.resource_categories[0] : item.resource_categories) : null
  return `${cat?.name ?? '자원'} · ${item?.label ?? '-'}`
}

const NDOW = ['일', '월', '화', '수', '목', '금', '토']
function fmtDueKst(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}(${NDOW[new Date(y, m - 1, d).getDay()]})`
}
function fmtHm(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 발송 실패가 본 동작을 막지 않는다 — 알림은 부가 기능 (fire-and-forget) */
function fireResourceNotification(
  type: 'resource_booking_created' | 'resource_booking_cancelled_by_admin' | 'resource_return_confirmed'
      | 'resource_booking_period_changed',   // ← [2026-08-26] 기한 변경
  row: any,
  extra: { labelSuffix?: string; cancelReason?: string } = {},
): void {
  const label = resourceLabelOf(row) + (extra.labelSuffix ?? '')
  supabase.functions.invoke('send-notification', {
    body: {
      type,
      booking: {
        id:             row.id,
        title:          label,
        user_id:        row.user_id,
        user_name:      row.user_name,
        user_dept:      row.user_dept,
        resource_label: label,
        use_time_kst:   `${fmtDueKst(String(row.start_at).slice(0, 10))} ${fmtHm(row.start_at)}~${fmtHm(row.end_at)}`,
        return_due_kst: fmtDueKst(row.return_due),
        ...(extra.cancelReason ? { cancel_reason: extra.cancelReason } : {}),
      },
    },
  }).catch(err => console.warn('[resourceApi] 알림 발송 실패:', err))
}

/** 마이페이지 자원 탭 — 본인 예약 이력 (최근 90일 시작분 + 미반납 전체) */
export async function loadMyResourceBookings(
  userId: string,
): Promise<(ResourceBooking & { resource_items?: { label: string; category?: { icon: string | null } | null } | null })[]> {  // ← [2026-08-21] 아이콘 조인
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabase
    .from('resource_bookings')
    .select('*, resource_items ( label, category:resource_categories ( icon ) )')   // ← 개체 라벨 조인 — 마이페이지 표기용  ← [2026-08-21] 카테고리 아이콘 동반 조인
    .eq('user_id', userId)
    .or(`start_at.gte.${since},and(status.eq.confirmed,returned_at.is.null)`)
    .order('start_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ResourceBooking[]
}
