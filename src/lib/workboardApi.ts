/**
 * workboardApi.ts — Work Space(WORKBOARD) 데이터 접근
 *
 * ✅ 변경 이력
 *  - [2026-09-30 NOTIFY 5-B] Work Space 알림 발사 — notifyWb(type, target, …): send-notification invoke(fire-and-forget, 실패는 경고만)
 *      · payload 는 대상 id 와 행위자·추가 담당자·댓글 id 뿐. 제목·영역·마감·수신자는 Edge 가 DB(wb_notification_context / wb_notification_recipients)에서 다시 읽는다
 *      · insertWbComment 는 성공 직후 wb_comment_added 를 자체 발사 (TaskDrawer·IssueDrawer 양쪽 공용 경로)
 *  - [2026-09-30 WORKBOARD P4] 반복 업무 — 템플릿 조회/upsert(RPC) · 미리보기(wb_template_preview · wb_templates_next, 규칙 SSOT=DB) · 수동 생성 · 실행 로그
 *  - [2026-09-30 WORKBOARD P3-F] loadWbMembers — 사람 선택 풀(wb_list_members RPC). users(전 직원) 는 표시 룩업에만 쓴다
 *  - [2026-09-30 WORKBOARD P3-E] 마일스톤 RPC 3종(upsert·status·delete) · 업무영역 upsert/reorder RPC · 단건 재조회 2종
 *      · wb_milestones 직접 쓰기는 20260930_workboard_phase3e 에서 회수됨 — 반드시 RPC
 *  - [2026-09-30 WORKBOARD P3-D] start_on 컬럼 · setWbTaskDates(드래그) · START_AFTER_DUE
 *  - [2026-09-30 WORKBOARD P3-C] 이슈 조회·upsert·전환(wb_convert_issue_to_task)·삭제 + 에러코드 3종
 *  - [2026-09-29 WORKBOARD P3-A] 신규 — 보드·상세 드로어에 필요한 조회 + RPC 래퍼
 *
 * 원칙
 *  · 조회는 테이블 직접 SELECT (RLS has_admin_role('workboard') 가 게이트)
 *  · 쓰기는 RPC 만 — wb_upsert_task / wb_set_task_status (직접 INSERT/UPDATE 는 권한·RLS 양쪽에서 차단됨)
 *    예외: wb_comments 는 직접 INSERT/DELETE (본인 명의만, RLS), wb_tasks DELETE 는 RLS 조건부(todo 만)
 *  · RPC 실패코드(P0001 message) 는 그대로 throw → 화면에서 wbErrorMessage() 로 한글 매핑
 *  · 변경 후 낙관적 갱신 금지 — 반환 id 로 단건 재조회(loadWbTaskById) 해서 SSOT 반영
 */

import { supabase, isSupabaseEnabled } from './supabase'
import type {
  WbWorkArea, WbMilestone, WbTask, WbTaskStatus, WbComment, WbActivity, WbTaskUpsertInput, WbRrule,
} from '../types'

// ─── 조회 ───────────────────────────────────────────────────────────────────

const TASK_SELECT = `
  id, area_id, milestone_id, template_id, period_key, title, description, status, priority, due_at, start_on,
  checklist, created_by, created_at, updated_at, completed_at, completed_by,
  wb_task_assignees ( user_id ),
  wb_task_templates ( rrule )
`

function rowToTask(r: any): WbTask {
  return {
    id: r.id, area_id: r.area_id, milestone_id: r.milestone_id ?? null, template_id: r.template_id ?? null,
    period_key: r.period_key ?? null, title: r.title, description: r.description ?? null,
    status: r.status, priority: r.priority, due_at: r.due_at ?? null, start_on: r.start_on ?? null,
    checklist: Array.isArray(r.checklist) ? r.checklist : [],
    created_by: r.created_by ?? null, created_at: r.created_at, updated_at: r.updated_at,
    completed_at: r.completed_at ?? null, completed_by: r.completed_by ?? null,
    assignee_ids: (r.wb_task_assignees ?? []).map((a: any) => a.user_id),
    template_rrule: (r.wb_task_templates?.rrule as WbRrule | undefined) ?? null,
  }
}

export async function loadWbAreas(): Promise<WbWorkArea[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('wb_work_areas').select('*').order('sort_order').order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as WbWorkArea[]
}

export async function loadWbMilestones(): Promise<WbMilestone[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('wb_milestones').select('*').order('start_on', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WbMilestone[]
}

/** 전체 업무 — 팀 규모(수백 건)라 페이지네이션 없이 1회. 완료는 최근 90일만 (보드 완료 열은 3건+더보기) */
export async function loadWbTasks(): Promise<WbTask[]> {
  if (!isSupabaseEnabled) return []
  const since = new Date(Date.now() - 90 * 86400_000).toISOString()
  const { data, error } = await supabase
    .from('wb_tasks').select(TASK_SELECT)
    .or(`status.neq.done,completed_at.gte.${since}`)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToTask)
}

export async function loadWbTaskById(id: string): Promise<WbTask | null> {
  const { data, error } = await supabase.from('wb_tasks').select(TASK_SELECT).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToTask(data) : null
}

export async function loadWbComments(targetType: 'task' | 'issue', targetId: string): Promise<WbComment[]> {
  const { data, error } = await supabase.from('wb_comments').select('*')
    .eq('target_type', targetType).eq('target_id', targetId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as WbComment[]
}

export async function loadWbActivity(targetType: 'area' | 'task' | 'issue' | 'milestone' | 'template', targetId: string): Promise<WbActivity[]> {
  const { data, error } = await supabase.from('wb_activity_log').select('*')
    .eq('target_type', targetType).eq('target_id', targetId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WbActivity[]
}

// ─── 쓰기 (RPC) ─────────────────────────────────────────────────────────────

export async function upsertWbTask(input: WbTaskUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc('wb_upsert_task', {
    p_id:           input.id,
    p_area_id:      input.area_id,
    p_title:        input.title,
    p_description:  input.description,
    p_priority:     input.priority,
    p_due_at:       input.due_at,
    p_milestone_id: input.milestone_id,
    p_checklist:    input.checklist,
    p_assignee_ids: input.assignee_ids,
    p_start_on:     input.start_on,   // ← [2026-09-30 P3-D] 20260930_workboard_phase3d 이후 10-인자
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** ← [2026-09-30 P3-D] 타임라인 바 드래그 — 날짜만 갱신 (wb_set_task_dates) */
export async function setWbTaskDates(id: string, startOn: string | null, dueAt: string | null): Promise<void> {
  const { error } = await supabase.rpc('wb_set_task_dates', { p_id: id, p_start_on: startOn, p_due_at: dueAt })
  if (error) throw new Error(error.message)
}

export async function setWbTaskStatus(id: string, status: WbTaskStatus): Promise<WbTaskStatus> {
  const { data, error } = await supabase.rpc('wb_set_task_status', { p_id: id, p_status: status })
  if (error) throw new Error(error.message)
  return data as WbTaskStatus
}

/** RLS: status='todo' AND completed_at IS NULL 인 행만 지워진다. 0행이면 false */
export async function deleteWbTask(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('wb_tasks').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

// ─── 댓글 (직접 CRUD, 본인 명의) ────────────────────────────────────────────

export async function insertWbComment(targetType: 'task' | 'issue', targetId: string, body: string): Promise<WbComment> {
  // author_id 는 DB DEFAULT auth.uid() — 클라에서 넘기지 않는다 (타인 명의 방지는 RLS WITH CHECK)
  const { data, error } = await supabase.from('wb_comments')
    .insert({ target_type: targetType, target_id: targetId, body }).select('*').single()
  if (error) throw new Error(error.message)
  const c = data as WbComment
  notifyWb('wb_comment_added', targetType, targetId, { actorId: c.author_id, commentId: c.id })   // ← [2026-09-30 5-B]
  return c
}

// ─── 알림 발사 (← [2026-09-30 NOTIFY 5-B]) ───────────────────────────────────
//   RPC 성공 "후"에만 호출. 실패해도 저장을 되돌리지 않는다(도서 extendBookCheckoutWithNotify 와 같은 정책).
//   booking.id 규칙: 'task-{uuid}' | 'issue-{uuid}' — 인앱 booking_id 로 저장되어 NotificationBell 이 #workboard-… 로 연다.

export type WbNotifyType = 'wb_task_assigned' | 'wb_comment_added' | 'wb_issue_created' | 'wb_issue_resolved'

export function notifyWb(
  type: WbNotifyType, targetType: 'task' | 'issue', targetId: string,
  opts: { actorId: string; addedIds?: string[]; commentId?: string },
): void {
  if (!isSupabaseEnabled || !targetId) return
  if (type === 'wb_task_assigned' && (!opts.addedIds || opts.addedIds.length === 0)) return   // 새 담당자 없음 → 발송 없음
  supabase.functions.invoke('send-notification', {
    body: {
      type,
      booking: {
        id: `${targetType}-${targetId}`,
        title: '',                             // Edge 가 DB 제목으로 대체
        wb_target_type: targetType,
        wb_target_id:   targetId,
        wb_actor_id:    opts.actorId,
        wb_added_ids:   opts.addedIds ?? null,
        wb_comment_id:  opts.commentId ?? null,
      },
    },
  }).then(({ error }) => { if (error) console.warn(`[workboardApi] 알림 발송 실패 (${type}):`, error.message) })
    .catch(err => console.warn(`[workboardApi] 알림 발송 예외 (${type}):`, err))
}

export async function deleteWbComment(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('wb_comments').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

// ─── 에러 한글 매핑 (RPC P0001 코드) ────────────────────────────────────────

const WB_ERR: Record<string, string> = {
  NOT_AUTHENTICATED:   '로그인이 필요합니다',
  NOT_WORKBOARD:       'Work Space 권한이 없습니다',
  NOT_FOUND:           '대상을 찾을 수 없습니다 (삭제되었을 수 있음)',
  AREA_NOT_FOUND:      '업무영역을 찾을 수 없습니다',
  MILESTONE_NOT_FOUND: '마일스톤을 찾을 수 없습니다',
  TASK_NOT_FOUND:      '업무를 찾을 수 없습니다',
  INVALID_TITLE:       '제목을 입력해 주세요',
  INVALID_PRIORITY:    '우선순위 값이 올바르지 않습니다',
  INVALID_STATUS:      '상태 값이 올바르지 않습니다',
  INVALID_CHECKLIST:   '체크리스트 형식이 올바르지 않습니다',
  INVALID_NAME:        '이름을 입력해 주세요',
  START_AFTER_DUE:     '시작일이 마감일보다 늦을 수 없습니다',
  INVALID_SEVERITY:    '심각도 값이 올바르지 않습니다',
  ISSUE_NOT_FOUND:     '이슈를 찾을 수 없습니다',
  ALREADY_CONVERTED:   '이미 업무로 전환된 이슈입니다',
  INVALID_OWNER_SAME:  '주담당과 부담당은 같은 사람일 수 없습니다',
  END_BEFORE_START:    '종료일이 시작일보다 빠를 수 없습니다',          // ← [P3-E]
  HAS_LINKS:           '연결된 업무·이슈가 있어 삭제할 수 없습니다 — 취소 상태로 종료하세요',
  INVALID_IDS:         '업무영역 순서 정보가 올바르지 않습니다 — 새로고침 후 다시 시도',
  INVALID_RRULE:       '주기 값이 올바르지 않습니다',                 // ← [P4]
  WEEKLY_NEEDS_WEEKDAY:'주간 반복은 요일을 선택해야 합니다',
  MONTHLY_NEEDS_DAY:   '월간 반복은 날짜를 선택해야 합니다',
  TEMPLATE_NOT_FOUND:  '반복 업무 템플릿을 찾을 수 없습니다',
}

export function wbErrorMessage(e: unknown, fallback = '처리에 실패했습니다'): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  for (const code of Object.keys(WB_ERR)) if (msg.includes(code)) return WB_ERR[code]
  if (msg.includes('row-level security') || msg.includes('permission denied')) return WB_ERR.NOT_WORKBOARD
  return fallback
}

// ═══════════════════════════════════════════════════════════════════════════
// 이슈 — ← [2026-09-30 WORKBOARD P3-C]
// ═══════════════════════════════════════════════════════════════════════════
import type { WbIssue, WbIssueUpsertInput } from '../types'

/** 최근 N일(occurred_on 기준) + 미해결 전부. 해결·보류는 기간 안만 */
export async function loadWbIssues(days = 30): Promise<WbIssue[]> {
  if (!isSupabaseEnabled) return []
  const since = new Date(Date.now() - days * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
  const { data, error } = await supabase.from('wb_issues').select('*')
    .or(`status.in.(open,in_progress),occurred_on.gte.${since}`)
    .order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as WbIssue[]
}

export async function loadWbIssueById(id: string): Promise<WbIssue | null> {
  const { data, error } = await supabase.from('wb_issues').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WbIssue) ?? null
}

export async function upsertWbIssue(input: WbIssueUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc('wb_upsert_issue', {
    p_id: input.id, p_title: input.title, p_description: input.description, p_severity: input.severity,
    p_status: input.status, p_task_id: input.task_id, p_milestone_id: input.milestone_id, p_occurred_on: input.occurred_on,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * 이슈 → 업무 전환. Phase 1 RPC 에는 converted_task_id 를 쓰는 함수가 없어 2단계:
 *   ① wb_upsert_task 로 업무 생성 ② wb_issues.converted_task_id 직접 UPDATE
 * ⚠ ②는 wb_issues UPDATE 권한이 없어 실패한다 (Phase 1 [F]: authenticated 는 SELECT·DELETE 만).
 *   → 20260930_workboard_phase3c.sql 의 wb_convert_issue_to_task RPC 로 대체. 이 함수는 그 RPC 래퍼.
 */
export async function convertWbIssueToTask(issueId: string, areaId: string): Promise<{ taskId: string }> {
  const { data, error } = await supabase.rpc('wb_convert_issue_to_task', { p_issue_id: issueId, p_area_id: areaId })
  if (error) throw new Error(error.message)
  return { taskId: data as string }
}

/** RLS: status='open' 만 지워진다 */
export async function deleteWbIssue(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('wb_issues').delete().eq('id', id).select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

// ═══════════════════════════════════════════════════════════════════════════
// 마일스톤 · 업무영역 — ← [2026-09-30 WORKBOARD P3-E]
//   쓰기 전부 RPC(이력 기록). 삭제 규칙: 마일스톤 = 연결 0건만(HAS_LINKS), 업무영역 = 삭제 없음(비활성화)
// ═══════════════════════════════════════════════════════════════════════════
import type { WbMilestoneStatus, WbMilestoneUpsertInput, WbWorkAreaUpsertInput } from '../types'

export async function loadWbMilestoneById(id: string): Promise<WbMilestone | null> {
  const { data, error } = await supabase.from('wb_milestones').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WbMilestone) ?? null
}

export async function loadWbAreaById(id: string): Promise<WbWorkArea | null> {
  const { data, error } = await supabase.from('wb_work_areas').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WbWorkArea) ?? null
}

export async function upsertWbMilestone(input: WbMilestoneUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc('wb_upsert_milestone', {
    p_id: input.id, p_title: input.title, p_description: input.description, p_start_on: input.start_on, p_end_on: input.end_on,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function setWbMilestoneStatus(id: string, status: WbMilestoneStatus): Promise<WbMilestoneStatus> {
  const { data, error } = await supabase.rpc('wb_set_milestone_status', { p_id: id, p_status: status })
  if (error) throw new Error(error.message)
  return data as WbMilestoneStatus
}

/** 연결 업무·이슈 0건일 때만 성공 — 아니면 HAS_LINKS throw */
export async function deleteWbMilestone(id: string): Promise<void> {
  const { error } = await supabase.rpc('wb_delete_milestone', { p_id: id })
  if (error) throw new Error(error.message)
}

export async function upsertWbArea(input: WbWorkAreaUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc('wb_upsert_work_area', {
    p_id: input.id, p_name: input.name, p_description: input.description, p_primary_owner_id: input.primary_owner_id,
    p_backup_owner_id: input.backup_owner_id, p_sort_order: input.sort_order, p_is_active: input.is_active,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** 전체 순서를 한 번에 — ids 순서대로 sort_order 1..n (한 트랜잭션, 바뀐 행만 이력) */
export async function reorderWbAreas(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('wb_reorder_work_areas', { p_ids: ids })
  if (error) throw new Error(error.message)
}

// ═══════════════════════════════════════════════════════════════════════════
// 멤버 풀 — ← [2026-09-30 WORKBOARD P3-F]
// ═══════════════════════════════════════════════════════════════════════════
import type { WbMember } from '../types'

/** Work Space 를 쓸 수 있는 사람 = admin_roles workboard·super 보유 재직자. 비멤버 호출은 NOT_WORKBOARD */
export async function loadWbMembers(): Promise<WbMember[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.rpc('wb_list_members')
  if (error) throw new Error(error.message)
  return (data ?? []) as WbMember[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 반복 업무 — ← [2026-09-30 WORKBOARD P4]
//   주기 규칙(비영업일 이동·소급 창)은 DB 함수가 SSOT — 화면은 계산하지 않고 wb_template_preview / wb_templates_next 를 호출한다
// ═══════════════════════════════════════════════════════════════════════════
import type { WbTaskTemplate, WbTemplateUpsertInput, WbTemplateDue, WbRecurringRun } from '../types'

export async function loadWbTemplates(): Promise<WbTaskTemplate[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('wb_task_templates').select('*').order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({ ...r, checklist: Array.isArray(r.checklist) ? r.checklist : [], default_assignee_ids: r.default_assignee_ids ?? [] })) as WbTaskTemplate[]
}

export async function loadWbTemplateById(id: string): Promise<WbTaskTemplate | null> {
  const { data, error } = await supabase.from('wb_task_templates').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? ({ ...data, checklist: Array.isArray(data.checklist) ? data.checklist : [], default_assignee_ids: data.default_assignee_ids ?? [] } as WbTaskTemplate) : null
}

export async function upsertWbTemplate(input: WbTemplateUpsertInput): Promise<string> {
  const { data, error } = await supabase.rpc('wb_upsert_task_template', {
    p_id: input.id, p_area_id: input.area_id, p_title: input.title, p_description: input.description, p_checklist: input.checklist,
    p_rrule: input.rrule, p_weekday: input.weekday, p_month_day: input.month_day, p_skip_non_workdays: input.skip_non_workdays,
    p_default_assignee_ids: input.default_assignee_ids, p_is_active: input.is_active,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/** 임의 파라미터 다음 생성일 N개 — 드로어 실시간 미리보기(저장 전) */
export async function previewWbTemplate(rrule: WbRrule, weekday: number | null, monthDay: number | null, skip: boolean, count = 4): Promise<WbTemplateDue[]> {
  const { data, error } = await supabase.rpc('wb_template_preview', { p_rrule: rrule, p_weekday: weekday, p_month_day: monthDay, p_skip: skip, p_count: count })
  if (error) throw new Error(error.message)
  return (data ?? []) as WbTemplateDue[]
}

/** 활성 템플릿 전체의 다음 생성일 — 목록 열 */
export async function loadWbTemplatesNext(): Promise<Map<string, WbTemplateDue>> {
  const m = new Map<string, WbTemplateDue>()
  if (!isSupabaseEnabled) return m
  const { data, error } = await supabase.rpc('wb_templates_next')
  if (error) throw new Error(error.message)
  for (const r of (data ?? []) as (WbTemplateDue & { template_id: string })[]) m.set(r.template_id, { due_on: r.due_on, period_key: r.period_key, shifted: r.shifted })
  return m
}

/** 오늘(KST)분 지금 생성 — 멱등(UNIQUE dedupe). 반환: 생성/스킵 수 */
export async function generateWbRecurringNow(): Promise<{ created: number; skipped: number }> {
  const { data, error } = await supabase.rpc('wb_generate_recurring_now')
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return { created: row?.created_count ?? 0, skipped: row?.skipped_count ?? 0 }
}

export async function loadWbRecurringRuns(limit = 1): Promise<WbRecurringRun[]> {
  if (!isSupabaseEnabled) return []
  const { data, error } = await supabase.from('wb_recurring_runs').select('*').order('ran_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as WbRecurringRun[]
}
