/**
 * orgApi.ts — 조직도(ORG) 데이터 접근
 *
 * ✅ 변경 이력
 *  - [2026-10-01 ORG Phase 3] 신규 — 20261005_org_phase1 / 20261006_org_phase2 짝
 *
 * 원칙
 *  · 조회는 테이블 직접 SELECT (RLS has_admin_role('org') 가 게이트)
 *  · 구조 편집(파일 메타·단위·카드·직무)은 직접 쓰기 — 초안 파일만 허용(RLS + 가드 트리거 이중). 변경 로그는 DB 트리거가 기록
 *  · 수명주기(복사·Active·잠금)·사람 상태·입사예정자 연결은 RPC 만 (org_copy_file / org_activate_file / org_acquire_lock … / org_set_person_status)
 *  · RPC 실패코드(P0001 message)는 그대로 throw → 화면에서 orgErrorMessage() 로 한글 매핑
 *  · 변경 후 낙관적 갱신 금지 — 단건 재조회(loadOrgCardById / loadOrgUnitById) 로 SSOT 반영
 */

import { supabase, isSupabaseEnabled } from './supabase'
import type {
  OrgFile, OrgFileSummary, OrgUnit, OrgCard, OrgPerson, OrgRank, OrgJob, OrgStatusType, OrgPersonStatus,
  OrgOffboardingItem, OrgRosterCheck,
} from '../types'

// ─── 코드 테이블 ────────────────────────────────────────────────────────────
export interface OrgCodes { ranks: OrgRank[]; jobs: OrgJob[]; statusTypes: OrgStatusType[] }
export async function loadOrgCodes(): Promise<OrgCodes> {
  if (!isSupabaseEnabled) return { ranks: [], jobs: [], statusTypes: [] }
  const [r, j, s] = await Promise.all([
    supabase.from('org_ranks').select('*').order('sort_order'),
    supabase.from('org_jobs').select('*').order('sort_order'),
    supabase.from('org_status_types').select('*').order('sort_order'),
  ])
  if (r.error) throw new Error(r.error.message)
  if (j.error) throw new Error(j.error.message)
  if (s.error) throw new Error(s.error.message)
  return { ranks: (r.data ?? []) as OrgRank[], jobs: (j.data ?? []) as OrgJob[], statusTypes: (s.data ?? []) as OrgStatusType[] }
}

// ─── 파일 ───────────────────────────────────────────────────────────────────
/** 갤러리 — 파일 + 단위·카드 수. 파일 수가 적어(수십) 집계는 클라에서 */
export async function loadOrgFiles(): Promise<OrgFileSummary[]> {
  if (!isSupabaseEnabled) return []
  const [f, u, c] = await Promise.all([
    supabase.from('org_files').select('*').order('updated_at', { ascending: false }),
    supabase.from('org_units').select('file_id'),
    supabase.from('org_cards').select('file_id, is_vacancy'),
  ])
  if (f.error) throw new Error(f.error.message)
  if (u.error) throw new Error(u.error.message)
  if (c.error) throw new Error(c.error.message)
  const uc = new Map<string, number>(); for (const x of u.data ?? []) uc.set(x.file_id, (uc.get(x.file_id) ?? 0) + 1)
  const cc = new Map<string, number>(); for (const x of c.data ?? []) if (!x.is_vacancy) cc.set(x.file_id, (cc.get(x.file_id) ?? 0) + 1)
  return ((f.data ?? []) as OrgFile[]).map(x => ({ ...x, unit_count: uc.get(x.id) ?? 0, card_count: cc.get(x.id) ?? 0 }))
}

export interface OrgFileBundle { file: OrgFile; units: OrgUnit[]; cards: OrgCard[]; persons: OrgPerson[] }
const CARD_SELECT = `id, file_id, unit_id, profile_id, person_id, display_name, rank_id, reports_to_card_id, is_unit_head, is_vacancy,
  employment_type, work_location, fte, memo, sort_order, org_card_jobs ( job_id, is_primary, sort_order )`
function rowToCard(r: any): OrgCard {
  const { org_card_jobs, ...rest } = r
  return { ...rest, fte: Number(rest.fte ?? 1), jobs: (org_card_jobs ?? []) as OrgCard['jobs'] }
}
/** 캔버스 — 파일 1개의 단위·카드·직무·입사예정자 */
export async function loadOrgFileBundle(fileId: string): Promise<OrgFileBundle | null> {
  if (!isSupabaseEnabled) return null
  const f = await supabase.from('org_files').select('*').eq('id', fileId).maybeSingle()
  if (f.error) throw new Error(f.error.message)
  if (!f.data) return null
  const [u, c] = await Promise.all([
    supabase.from('org_units').select('*').eq('file_id', fileId).order('sort_order').order('name'),
    supabase.from('org_cards').select(CARD_SELECT).eq('file_id', fileId).order('sort_order'),
  ])
  if (u.error) throw new Error(u.error.message)
  if (c.error) throw new Error(c.error.message)
  const cards = (c.data ?? []).map(rowToCard)
  const personIds = Array.from(new Set(cards.map(x => x.person_id).filter((x): x is string => !!x)))
  let persons: OrgPerson[] = []
  if (personIds.length > 0) {
    const p = await supabase.from('org_persons').select('id, name, email, planned_start_on, linked_profile_id').in('id', personIds)
    if (p.error) throw new Error(p.error.message)
    persons = (p.data ?? []) as OrgPerson[]
  }
  return { file: f.data as OrgFile, units: (u.data ?? []) as OrgUnit[], cards, persons }
}
export async function loadOrgCardById(id: string): Promise<OrgCard | null> {
  const { data, error } = await supabase.from('org_cards').select(CARD_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToCard(data) : null
}
export async function loadOrgUnitById(id: string): Promise<OrgUnit | null> {
  const { data, error } = await supabase.from('org_units').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as OrgUnit) ?? null
}

/** 새 초안(빈 파일) — 루트 단위 1개를 함께 만든다 */
export async function createOrgFile(name: string, effectiveOn: string | null, createdBy: string, rootUnitName = 'C&R Research'): Promise<OrgFile> {
  const { data, error } = await supabase.from('org_files')
    .insert({ name: name.trim(), status: 'draft', effective_on: effectiveOn, created_by: createdBy, updated_by: createdBy })
    .select('*').single()
  if (error) throw new Error(error.message)
  const { error: e2 } = await supabase.from('org_units').insert({ file_id: data.id, name: rootUnitName, code: 'ROOT', sort_order: 0 })
  if (e2) throw new Error(e2.message)
  return data as OrgFile
}
export async function updateOrgFileMeta(id: string, patch: Partial<Pick<OrgFile, 'name' | 'effective_on' | 'memo'>>): Promise<void> {
  const { error } = await supabase.from('org_files').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}
export async function deleteOrgFile(id: string): Promise<void> {
  const { error, count } = await supabase.from('org_files').delete({ count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('ORG_FILE_NOT_DELETABLE')   // RLS 0행 = 초안 아님 또는 권한 없음
}

// ─── RPC: 수명주기 ──────────────────────────────────────────────────────────
export async function copyOrgFile(sourceId: string, name: string, effectiveOn: string | null): Promise<{ file_id: string; units: number; cards: number; missing_count: number; ghost_count: number }> {
  const { data, error } = await supabase.rpc('org_copy_file', { p_source_file_id: sourceId, p_name: name, p_effective_on: effectiveOn })
  if (error) throw new Error(error.message)
  return data
}
export async function activateOrgFile(fileId: string, force = false): Promise<{ file_id: string; prev_file_id: string | null; diff_count: number; diff: Record<string, number>; inapp_sent: number }> {
  const { data, error } = await supabase.rpc('org_activate_file', { p_file_id: fileId, p_force: force })
  if (error) throw new Error(error.message)
  return data
}
export async function acquireOrgLock(fileId: string, force = false): Promise<{ lock_by: string; lock_at: string; forced: boolean }> {
  const { data, error } = await supabase.rpc('org_acquire_lock', { p_file_id: fileId, p_force: force })
  if (error) throw new Error(error.message)
  return data
}
export async function releaseOrgLock(fileId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('org_release_lock', { p_file_id: fileId })
  if (error) throw new Error(error.message)
  return !!data
}
export async function rosterCheck(fileId: string): Promise<OrgRosterCheck> {
  const { data, error } = await supabase.rpc('org_roster_check', { p_file_id: fileId })
  if (error) throw new Error(error.message)
  return data as OrgRosterCheck
}

// ─── 단위 (직접 쓰기 — 초안만) ───────────────────────────────────────────────
export async function insertOrgUnit(u: { file_id: string; parent_unit_id: string | null; name: string; code?: string | null; sort_order?: number }): Promise<OrgUnit> {
  const { data, error } = await supabase.from('org_units').insert({ ...u, code: u.code ?? null, sort_order: u.sort_order ?? 0 }).select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgUnit
}
export async function updateOrgUnit(id: string, patch: Partial<Pick<OrgUnit, 'name' | 'code' | 'azure_division' | 'head_card_id' | 'parent_unit_id' | 'sort_order'>>): Promise<OrgUnit> {
  const { data, error } = await supabase.from('org_units').update(patch).eq('id', id).select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('ORG_FILE_NOT_EDITABLE')   // RLS 0행
  return data as OrgUnit
}
export async function deleteOrgUnit(id: string): Promise<void> {
  const { error, count } = await supabase.from('org_units').delete({ count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('ORG_FILE_NOT_EDITABLE')
}
/** 같은 부모 안 순서 일괄 저장 */
export async function reorderOrgUnits(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from('org_units').update({ sort_order: i }).eq('id', ids[i])
    if (error) throw new Error(error.message)
  }
}

// ─── 카드 (직접 쓰기 — 초안만) ───────────────────────────────────────────────
export interface OrgCardInput {
  file_id: string; unit_id: string; profile_id?: string | null; person_id?: string | null; display_name?: string | null
  rank_id?: string | null; reports_to_card_id?: string | null; is_unit_head?: boolean; is_vacancy?: boolean
  employment_type?: OrgCard['employment_type']; work_location?: string | null; fte?: number; memo?: string | null; sort_order?: number
}
export async function insertOrgCard(c: OrgCardInput, jobIds: string[] = []): Promise<OrgCard> {
  const { data, error } = await supabase.from('org_cards').insert(c).select('id').single()
  if (error) throw new Error(error.message)
  if (jobIds.length > 0) await setOrgCardJobs(data.id, jobIds)
  return (await loadOrgCardById(data.id))!
}
export async function updateOrgCard(id: string, patch: Partial<Omit<OrgCardInput, 'file_id'>>): Promise<OrgCard> {
  const { error, count } = await supabase.from('org_cards').update(patch, { count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('ORG_FILE_NOT_EDITABLE')
  return (await loadOrgCardById(id))!
}
export async function deleteOrgCard(id: string): Promise<void> {
  const { error, count } = await supabase.from('org_cards').delete({ count: 'exact' }).eq('id', id)
  if (error) throw new Error(error.message)
  if (!count) throw new Error('ORG_FILE_NOT_EDITABLE')
}
/** 카드 직무 전체 교체 — 첫 번째가 대표 */
export async function setOrgCardJobs(cardId: string, jobIds: string[]): Promise<void> {
  const { error: e1 } = await supabase.from('org_card_jobs').delete().eq('card_id', cardId)
  if (e1) throw new Error(e1.message)
  if (jobIds.length === 0) return
  const rows = jobIds.map((job_id, i) => ({ card_id: cardId, job_id, is_primary: i === 0, sort_order: i }))
  const { error: e2 } = await supabase.from('org_card_jobs').insert(rows)
  if (e2) throw new Error(e2.message)
}

// ─── 입사 예정자 ────────────────────────────────────────────────────────────
export async function insertOrgPerson(p: { name: string; email: string | null; planned_start_on: string | null; created_by: string }): Promise<OrgPerson> {
  const { data, error } = await supabase.from('org_persons')
    .insert({ ...p, email: p.email ? p.email.trim().toLowerCase() : null }).select('id, name, email, planned_start_on, linked_profile_id').single()
  if (error) throw new Error(error.message)
  return data as OrgPerson
}
export async function linkPlannedPerson(email: string, personId?: string): Promise<{ linked: boolean; reason?: string; cards_linked?: number }> {
  const { data, error } = await supabase.rpc('org_link_planned_person', { p_email: email, p_person_id: personId ?? null })
  if (error) throw new Error(error.message)
  return data
}

// ─── 사람 상태 (RPC 전용) ───────────────────────────────────────────────────
/** 활성 상태 전체 — 파일 밖 데이터라 1회 로드 후 카드에 매핑 */
export async function loadActiveOrgStatuses(): Promise<OrgPersonStatus[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('org_person_status').select('*').is('ended_at', null)
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgPersonStatus[]
}
export async function loadOrgStatusHistory(profileId: string | null, personId: string | null): Promise<OrgPersonStatus[]> {
  let q = supabase.from('org_person_status').select('*').order('created_at', { ascending: false })
  q = profileId ? q.eq('profile_id', profileId) : q.eq('person_id', personId!)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgPersonStatus[]
}
export interface OrgStatusPayload {
  start_on?: string | null; end_on?: string | null; return_on?: string | null; departure_on?: string | null
  planned_status_code?: string | null; note?: string | null; applicable_template_ids?: string[]
}
export async function setOrgPersonStatus(profileId: string | null, personId: string | null, statusCode: string, payload: OrgStatusPayload): Promise<OrgPersonStatus> {
  const { data, error } = await supabase.rpc('org_set_person_status', { p_profile_id: profileId, p_person_id: personId, p_status_code: statusCode, p_payload: payload })
  if (error) throw new Error(error.message)
  return data as OrgPersonStatus
}
export async function endOrgPersonStatus(statusId: string, reason = 'manual'): Promise<OrgPersonStatus> {
  const { data, error } = await supabase.rpc('org_end_person_status', { p_status_id: statusId, p_reason: reason })
  if (error) throw new Error(error.message)
  return data as OrgPersonStatus
}
export async function loadOffboardingItems(statusId: string): Promise<OrgOffboardingItem[]> {
  const { data, error } = await supabase.from('org_offboarding_items').select('*').eq('status_id', statusId).order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgOffboardingItem[]
}
export async function setOffboardingItem(id: string, patch: { checked?: boolean; applicable?: boolean }, actor: string): Promise<void> {
  const body: Record<string, unknown> = { ...patch }
  if (patch.checked !== undefined) { body.checked_by = patch.checked ? actor : null; body.checked_at = patch.checked ? new Date().toISOString() : null }
  const { error } = await supabase.from('org_offboarding_items').update(body).eq('id', id)
  if (error) throw new Error(error.message)
}

// ─── 히스토리 ───────────────────────────────────────────────────────────────
export interface OrgChangeLogRow { id: number; file_id: string | null; actor: string | null; action: 'insert' | 'update' | 'delete'; target_table: string; target_id: string; before: any; after: any; created_at: string }
export async function loadOrgChangeLog(fileId: string | null, limit = 200): Promise<OrgChangeLogRow[]> {
  let q = supabase.from('org_change_log').select('*').order('created_at', { ascending: false }).limit(limit)
  q = fileId ? q.eq('file_id', fileId) : q.is('file_id', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgChangeLogRow[]
}
export interface OrgDiffRow { id: number; file_id: string; prev_file_id: string | null; kind: string; card_ref: string | null; label: string | null; before: any; after: any }
export async function loadOrgActivationDiffs(fileId: string): Promise<OrgDiffRow[]> {
  const { data, error } = await supabase.from('org_activation_diffs').select('*').eq('file_id', fileId).order('kind').order('label')
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgDiffRow[]
}
