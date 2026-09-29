/**
 * workboardApi.ts — Work Space(WORKBOARD) 데이터 접근
 *
 * ✅ 변경 이력
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
  id, area_id, milestone_id, template_id, period_key, title, description, status, priority, due_at,
  checklist, created_by, created_at, updated_at, completed_at, completed_by,
  wb_task_assignees ( user_id ),
  wb_task_templates ( rrule )
`

function rowToTask(r: any): WbTask {
  return {
    id: r.id, area_id: r.area_id, milestone_id: r.milestone_id ?? null, template_id: r.template_id ?? null,
    period_key: r.period_key ?? null, title: r.title, description: r.description ?? null,
    status: r.status, priority: r.priority, due_at: r.due_at ?? null,
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

export async function loadWbActivity(targetType: 'area' | 'task' | 'issue', targetId: string): Promise<WbActivity[]> {
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
  })
  if (error) throw new Error(error.message)
  return data as string
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
  return data as WbComment
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
  INVALID_OWNER_SAME:  '주담당과 부담당은 같은 사람일 수 없습니다',
}

export function wbErrorMessage(e: unknown, fallback = '처리에 실패했습니다'): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  for (const code of Object.keys(WB_ERR)) if (msg.includes(code)) return WB_ERR[code]
  if (msg.includes('row-level security') || msg.includes('permission denied')) return WB_ERR.NOT_WORKBOARD
  return fallback
}
