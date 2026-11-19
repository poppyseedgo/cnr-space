// ============================================================
// Shipping API — 운송내역서 임시 등록 페이지(#shipping)
// [2026-11-19] 신규 (api.ts 와 분리: 임시 페이지라 종료 시 파일 단위 제거 — hrInterviewApi 와 같은 방식)
//   · 읽기: shipping_records SELECT — RLS 가 "본인의 삭제 안 된 행 또는 shipping 역할" 만 돌려준다
//   · 쓰기: shipping_create / shipping_update / shipping_delete RPC 만 (테이블 직접 쓰기 권한 없음)
//           낙관적 갱신 금지 — RPC 가 돌려준 행(수발신번호 포함)을 그대로 화면에 반영한다
//   · 관리자 판정: has_admin_role('shipping') RPC — RLS 와 같은 함수(판정 SSOT). super 는 자동 통과
// ============================================================
import { supabase } from './supabase'
import type { ShippingRecord, ShippingPayload, ShippingAdminFilter } from '../types/shipping'

const TABLE = 'shipping_records'
const PAGE = 1000   // PostgREST 1000행 제한 — 페이지네이션 루프

/** 본인 등록 건 (최신순). RLS 가 본인·미삭제 행만 준다 — user_id 조건은 관리자 계정에서 '본인 건만' 보이게 하려는 것 */
export async function fetchMyShipping(userId: string): Promise<ShippingRecord[]> {
  const out: ShippingRecord[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(TABLE).select('*')
      .eq('user_id', userId).is('deleted_at', null)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as ShippingRecord[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** 관리자 — 전체 등록 건 검색 (최신순). 조회기간은 신청일자(발송할 날짜) 기준 */
export async function fetchAllShipping(f: ShippingAdminFilter): Promise<ShippingRecord[]> {
  const out: ShippingRecord[] = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(TABLE).select('*').is('deleted_at', null)
    if (f.projectNo.trim())  q = q.ilike('project_no', `%${f.projectNo.trim()}%`)
    if (f.userName.trim())   q = q.ilike('user_name', `%${f.userName.trim()}%`)
    if (f.itemType)          q = q.eq('item_type', f.itemType)
    if (f.direction)         q = q.eq('direction', f.direction)
    if (f.trackingNo.trim()) q = q.ilike('tracking_no', `%${f.trackingNo.trim()}%`)
    if (f.from)              q = q.gte('requested_on', f.from)
    if (f.to)                q = q.lte('requested_on', f.to)
    const { data, error } = await q
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as ShippingRecord[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

export async function createShipping(p: ShippingPayload): Promise<ShippingRecord> {
  const { data, error } = await supabase.rpc('shipping_create', { p })
  if (error) throw new Error(error.message)
  return data as ShippingRecord
}

export async function updateShipping(id: string, p: ShippingPayload): Promise<ShippingRecord> {
  const { data, error } = await supabase.rpc('shipping_update', { p_id: id, p })
  if (error) throw new Error(error.message)
  return data as ShippingRecord
}

export async function deleteShipping(id: string): Promise<void> {
  const { error } = await supabase.rpc('shipping_delete', { p_id: id })
  if (error) throw new Error(error.message)
}

/** 운송내역서(관리자) 메뉴 노출 여부 — 실패하면 false(메뉴 숨김). 데이터 권한은 RLS 가 따로 지킨다 */
export async function fetchShippingIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_admin_role', { role_name: 'shipping' })
  if (error) return false
  return data === true
}
