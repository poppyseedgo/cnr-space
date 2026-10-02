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
import type { OrgDisplayName,
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
    supabase.from('org_units').select('file_id, kind'),
    supabase.from('org_cards').select('file_id, is_vacancy'),
  ])
  if (f.error) throw new Error(f.error.message)
  if (u.error) throw new Error(u.error.message)
  if (c.error) throw new Error(c.error.message)
  const uc = new Map<string, number>(); for (const x of u.data ?? []) if (x.kind !== 'bench') uc.set(x.file_id, (uc.get(x.file_id) ?? 0) + 1)   // [Phase 6] 작업대 제외
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
/** 갤러리 초안 썸네일용 — 파일별 단위·카드 최소 컬럼(작업대 하위 제외는 호출부 splitBench). 초안 수가 적어 파일마다 2쿼리 */
export async function loadOrgTree(fileId: string): Promise<{ units: OrgUnit[]; cards: OrgCard[] }> {
  if (!isSupabaseEnabled) return { units: [], cards: [] }
  const [u, c] = await Promise.all([
    supabase.from('org_units').select('id, file_id, parent_unit_id, name, code, sort_order, kind, azure_division, head_card_id, unit_type, head_job_id, memo').eq('file_id', fileId),
    supabase.from('org_cards').select('id, file_id, unit_id, is_vacancy, is_primary, hidden_at').eq('file_id', fileId),
  ])
  if (u.error) throw new Error(u.error.message)
  if (c.error) throw new Error(c.error.message)
  return { units: (u.data ?? []) as OrgUnit[], cards: (c.data ?? []) as unknown as OrgCard[] }
}
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
/** [Phase 4-B] 반환 형식 OrgActivateResult 로 확장 (20261007 — RPC 는 인앱 미발송, 알림은 notifyOrgActivated) */
export async function activateOrgFile(fileId: string, force = false): Promise<OrgActivateResult> {
  const { data, error } = await supabase.rpc('org_activate_file', { p_file_id: fileId, p_force: force })
  if (error) throw new Error(error.message)
  return data as OrgActivateResult
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
export async function insertOrgUnit(u: { file_id: string; parent_unit_id: string | null; name: string; code?: string | null; sort_order?: number; unit_type?: string | null }): Promise<OrgUnit> {
  const { data, error } = await supabase.from('org_units').insert({ ...u, code: u.code ?? null, sort_order: u.sort_order ?? 0 }).select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgUnit
}
/** [8-A] 단위 속성 패치 — 유형·단위장 포지션·메모 포함 */
export type OrgUnitPatch = Partial<Pick<OrgUnit, 'name' | 'code' | 'azure_division' | 'head_card_id' | 'parent_unit_id' | 'sort_order' | 'unit_type' | 'head_job_id' | 'memo'>>
export async function updateOrgUnit(id: string, patch: OrgUnitPatch): Promise<OrgUnit> {
  const { data, error } = await supabase.from('org_units').update(patch).eq('id', id).select('*').maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('ORG_FILE_NOT_EDITABLE')   // RLS 0행
  return data as OrgUnit
}
/** [8-A] 단위 삭제 — org_delete_unit: 하위 단위 없을 때만, 카드는 보류로(한 트랜잭션 = 되돌리기 1단계) */
export async function deleteOrgUnit(id: string): Promise<{ deleted: string; name: string; cards_to_bench: number }> {
  const { data, error } = await supabase.rpc('org_delete_unit', { p_unit_id: id })
  if (error) throw new Error(error.message)
  return data
}
/** [8-A] 상위 변경 + 형제 순서 삽입 — org_place_unit (한 트랜잭션). index null = 끝, parentId null = 루트 층 */
export async function placeOrgUnit(unitId: string, parentId: string | null, index: number | null): Promise<{ unit_id: string; parent_id: string | null; index: number; updated: number }> {
  const { data, error } = await supabase.rpc('org_place_unit', { p_unit_id: unitId, p_parent_id: parentId, p_index: index })
  if (error) throw new Error(error.message)
  return data
}
/** [8-A] 복제 — 같은 층 바로 뒤, 이름 ' (복사)', 하위·카드 제외 */
export async function duplicateOrgUnit(unitId: string): Promise<string> {
  const { data, error } = await supabase.rpc('org_duplicate_unit', { p_unit_id: unitId })
  if (error) throw new Error(error.message)
  return data as string
}
/** 같은 부모 안 순서 일괄 저장 (노드 캔버스 형제 드래그용 — 되돌리기는 변경된 행 수만큼) */
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
  is_primary?: boolean   // ← [Phase 5-B] false = 겸직 카드 (같은 파일에 본 카드 필요)
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

// ─── [2026-10-01 ORG Phase 4-A] 반납 템플릿 · 입사예정자 수정 ───────────────
export interface OrgOffboardingTemplate { id: string; label: string; is_conditional: boolean; is_critical: boolean; sort_order: number; is_active: boolean }
export async function loadOffboardingTemplates(): Promise<OrgOffboardingTemplate[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('org_offboarding_templates').select('*').eq('is_active', true).order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgOffboardingTemplate[]
}
export async function updateOrgPerson(id: string, patch: { name?: string; email?: string | null; planned_start_on?: string | null }): Promise<OrgPerson> {
  const body = { ...patch, ...(patch.email !== undefined ? { email: patch.email ? patch.email.trim().toLowerCase() : null } : {}) }
  const { data, error } = await supabase.from('org_persons').update(body).eq('id', id).select('id, name, email, planned_start_on, linked_profile_id').single()
  if (error) throw new Error(error.message)
  return data as OrgPerson
}

// ─── [2026-10-01 ORG Phase 4-B] 알림 · 시스템 잔여 · 코드 관리 ──────────────
/** Active 전환 알림 — send-notification(org_activated) fire-and-forget. 이메일+인앱 모두 Edge 가 담당(RPC 는 더 이상 인앱을 넣지 않음, 20261007) */
export interface OrgActivateResult { file_id: string; file_name: string; prev_file_id: string | null; prev_file_name: string | null; effective_on: string | null; units: number; cards: number; diff_count: number; diff: Record<string, number>; ghost_count: number; missing_count: number }
export function notifyOrgActivated(r: OrgActivateResult, actorName: string): void {
  if (!isSupabaseEnabled) return
  supabase.functions.invoke('send-notification', {
    body: {
      type: 'org_activated',
      booking: {
        id: `org-${r.file_id}`,                     // CTA #admin-org-{fileId} · 알림벨 딥링크
        title: r.file_name,
        org: { file_name: r.file_name, effective_on: r.effective_on, prev_file_name: r.prev_file_name, diff_count: r.diff_count, diff: r.diff, actor_name: actorName, units: r.units, cards: r.cards },
      },
    },
  }).then(({ error }) => { if (error) console.warn('[orgApi] org_activated 알림 발송 실패:', error.message) })
    .catch(err => console.warn('[orgApi] org_activated 알림 발송 예외:', err))
}
export interface OrgSystemCheck { profile_id: string; books: { title: string; due_at: string }[]; book_count: number; resources: { label: string; start_at: string; end_at: string }[]; resource_count: number; admin_roles: string[]; admin_role_count: number; future_room_bookings: number }
export async function offboardingSystemCheck(profileId: string): Promise<OrgSystemCheck> {
  const { data, error } = await supabase.rpc('org_offboarding_system_check', { p_profile_id: profileId })
  if (error) throw new Error(error.message)
  return data as OrgSystemCheck
}
// 코드 테이블 CRUD (직접 쓰기 — RLS org 전체 쓰기 · 시스템 상태코드는 트리거 보호)
export async function upsertOrgRank(r: Partial<OrgRank> & { code: string; label: string }): Promise<OrgRank> {
  const q = r.id ? supabase.from('org_ranks').update({ code: r.code, label: r.label, level: r.level ?? 0, sort_order: r.sort_order ?? 0, is_active: r.is_active ?? true }).eq('id', r.id)
                 : supabase.from('org_ranks').insert({ code: r.code, label: r.label, level: r.level ?? 0, sort_order: r.sort_order ?? 0, is_active: r.is_active ?? true })
  const { data, error } = await q.select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgRank
}
export async function upsertOrgJob(j: Partial<OrgJob> & { code: string; label: string }): Promise<OrgJob> {
  const body = { code: j.code, label: j.label, level: j.level ?? 40, aliases: j.aliases ?? [], sort_order: j.sort_order ?? 0, is_active: j.is_active ?? true }
  const q = j.id ? supabase.from('org_jobs').update(body).eq('id', j.id) : supabase.from('org_jobs').insert(body)
  const { data, error } = await q.select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgJob
}
export async function upsertOrgStatusType(t: OrgStatusType, isNew: boolean): Promise<OrgStatusType> {
  const body = { label: t.label, category: t.category, color: t.color, sort_order: t.sort_order, is_active: t.is_active }
  const q = isNew ? supabase.from('org_status_types').insert({ code: t.code, ...body, is_system: false }) : supabase.from('org_status_types').update(body).eq('code', t.code)
  const { data, error } = await q.select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgStatusType
}
export async function deleteOrgStatusType(code: string): Promise<void> {
  const { error } = await supabase.from('org_status_types').delete().eq('code', code)
  if (error) throw new Error(error.message)
}
export async function upsertOffboardingTemplate(t: Partial<OrgOffboardingTemplate> & { label: string }): Promise<OrgOffboardingTemplate> {
  const body = { label: t.label, is_conditional: t.is_conditional ?? false, is_critical: t.is_critical ?? false, sort_order: t.sort_order ?? 0, is_active: t.is_active ?? true }
  const q = t.id ? supabase.from('org_offboarding_templates').update(body).eq('id', t.id) : supabase.from('org_offboarding_templates').insert(body)
  const { data, error } = await q.select('*').single()
  if (error) throw new Error(error.message)
  return data as OrgOffboardingTemplate
}
export async function loadAllOffboardingTemplates(): Promise<OrgOffboardingTemplate[]> {
  const { data, error } = await supabase.from('org_offboarding_templates').select('*').order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as OrgOffboardingTemplate[]
}

// ─── [2026-10-01 ORG Phase 5] 조직도 표기 이름 ───────────────────────────────
export async function loadOrgDisplayNames(): Promise<Map<string, OrgDisplayName>> {
  if (!isSupabaseEnabled) return new Map()
  const { data, error } = await supabase.from('org_display_names').select('*')
  if (error) throw new Error(error.message)
  return new Map(((data ?? []) as OrgDisplayName[]).map(d => [d.profile_id, d]))
}
/** 빈 문자열 → 행 삭제(Azure 이름으로 복귀) */
export async function setOrgDisplayName(profileId: string, displayName: string, actor: string, note: string | null = null): Promise<void> {
  const v = displayName.trim()
  if (!v) {
    const { error } = await supabase.from('org_display_names').delete().eq('profile_id', profileId)
    if (error) throw new Error(error.message); return
  }
  const { error } = await supabase.from('org_display_names').upsert({ profile_id: profileId, display_name: v, note, updated_by: actor }, { onConflict: 'profile_id' })
  if (error) throw new Error(error.message)
}

// ─── [2026-10-01 ORG Phase 5-B] 겸직 카드 · 숨김 ────────────────────────────
/** 어떤 status 의 파일에서도 동작(RPC 가 lifecycle GUC 로 가드 통과). 공석은 거부 */
export async function setOrgCardHidden(cardId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc('org_set_card_hidden', { p_card_id: cardId, p_hidden: hidden })
  if (error) throw new Error(error.message)
}
/** 겸직 카드 → 본 카드 승격 (기존 본 카드는 겸직으로). 초안만 */
export async function swapOrgPrimaryCard(cardId: string): Promise<void> {
  const { error } = await supabase.rpc('org_swap_primary_card', { p_card_id: cardId })
  if (error) throw new Error(error.message)
}

// ─── [Phase 6] 대규모 개편 편집 — 작업대 · 다중 이동 · 분리/합치기 · 되돌리기 (20261012 RPC, 설계서 §13) ───
/** 파일의 작업대 단위 id (없으면 생성 — 초안만). 작업대는 kind='bench' 인 두 번째 루트 */
export async function ensureOrgBench(fileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('org_ensure_bench', { p_file_id: fileId })
  if (error) throw new Error(error.message)
  return data as string
}
/** 카드 여러 장을 한 단위로 한 트랜잭션에 이동(= 되돌리기 1단계). 단위장·보고선은 해제, 대상 단위 끝에 순서대로 */
export async function moveOrgCards(cardIds: string[], unitId: string): Promise<{ moved: number; unit_id: string }> {
  const { data, error } = await supabase.rpc('org_move_cards', { p_card_ids: cardIds, p_unit_id: unitId })
  if (error) throw new Error(error.message)
  return data
}
/** 선택 카드로 새 단위 생성(부모 아래 형제 끝) + 이동 */
export async function splitOrgUnit(cardIds: string[], parentUnitId: string, name: string): Promise<{ unit_id: string; moved: number }> {
  const { data, error } = await supabase.rpc('org_split_unit', { p_card_ids: cardIds, p_parent_unit_id: parentUnitId, p_name: name })
  if (error) throw new Error(error.message)
  return data
}
/** from 의 카드·하위 단위를 into 로 옮기고 from 삭제. 같은 사람이 양쪽에 있으면 ORG_MERGE_DUPLICATE_PERSON */
export async function mergeOrgUnit(fromUnitId: string, intoUnitId: string): Promise<{ into: string; cards: number; units: number }> {
  const { data, error } = await supabase.rpc('org_merge_unit', { p_from: fromUnitId, p_into: intoUnitId })
  if (error) throw new Error(error.message)
  return data
}
export interface OrgUndoPeek { available: boolean; conflict?: boolean; at?: string; rows?: number }
/** 내 마지막 동작(같은 트랜잭션 묶음) 되돌리기 — 그 뒤 타인 변경이 있으면 ORG_UNDO_CONFLICT. 되돌림도 기록되어 다시 되돌리면 재실행 */
export async function undoOrgLast(fileId: string): Promise<{ reverted: number; at: string }> {
  const { data, error } = await supabase.rpc('org_undo_last', { p_file_id: fileId })
  if (error) throw new Error(error.message)
  return data
}
export async function undoOrgPeek(fileId: string): Promise<OrgUndoPeek> {
  if (!isSupabaseEnabled) return { available: false }
  const { data, error } = await supabase.rpc('org_undo_peek', { p_file_id: fileId })
  if (error) throw new Error(error.message)
  return data as OrgUndoPeek
}

// ─── [Phase 7] 노드 캔버스 배치 (org_unit_layout · 20261013) ───
export async function loadOrgLayout(fileId: string): Promise<Map<string, { x: number; y: number }>> {
  if (!isSupabaseEnabled) return new Map()
  const { data, error } = await supabase.from('org_unit_layout').select('unit_id, x, y').eq('file_id', fileId)
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((r: any) => [r.unit_id as string, { x: Number(r.x), y: Number(r.y) }]))
}
/** 묶음 upsert — 초안만. 로그 없음(되돌리기 대상 아님) */
export async function saveOrgLayout(fileId: string, items: { unit_id: string; x: number; y: number }[]): Promise<number> {
  if (!items.length) return 0
  const { data, error } = await supabase.rpc('org_save_layout', { p_file_id: fileId, p_items: items })
  if (error) throw new Error(error.message)
  return data as number
}
