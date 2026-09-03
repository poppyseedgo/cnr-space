// ============================================================
// HR Interview API — [2026-09-03] 신규 (api.ts 와 분리: 임시 페이지라 종료 시 파일 단위 제거)
//   · 접근: 로그인 사용자 전원 (RLS 가 본인 행만 허용) — [2026-09-03] 화이트리스트 게이트 폐기
//   · 답변: hr_interview_answers — (question_id, user_id) UNIQUE upsert
//   · 이미지: private 버킷 hr-interview, 경로 {uid}/{question_id}/{ts}_{name}, 열람은 signed URL
//   · 임시본: localStorage (즉시) + DB draft (debounce) — 다른 기기에서도 이어쓰기
// ============================================================
import { supabase } from './supabase'
import type { HrInterviewAnswerRow, HrLocalDraft } from '../types/hrInterview'

export const HR_BUCKET = 'hr-interview'
export const HR_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const HR_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const SIGNED_URL_TTL_SEC = 60 * 60

// ── 답변 조회/저장 ─────────────────────────────────────────
export async function fetchMyHrAnswers(userId: string): Promise<HrInterviewAnswerRow[]> {
  const { data, error } = await supabase
    .from('hr_interview_answers')
    .select('*')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as HrInterviewAnswerRow[]
}

interface UpsertArgs {
  userId: string
  questionId: string
  content: string
  imagePaths: string[]
  status: 'draft' | 'submitted'
}

/**
 * draft 자동저장 / submitted 확정 공용 upsert.
 * 이미 submitted 인 행을 draft 로 되돌리지 않도록, status='draft' 요청은 기존 status 를 유지한다.
 */
export async function upsertHrAnswer(a: UpsertArgs): Promise<HrInterviewAnswerRow> {
  // 기존 status 확인 (submitted 유지 규칙)
  const { data: existing, error: e1 } = await supabase
    .from('hr_interview_answers')
    .select('status')
    .eq('user_id', a.userId)
    .eq('question_id', a.questionId)
    .maybeSingle()
  if (e1) throw new Error(e1.message)

  const nextStatus: 'draft' | 'submitted' =
    a.status === 'submitted' ? 'submitted'
    : (existing?.status === 'submitted' ? 'submitted' : 'draft')

  const { data, error } = await supabase
    .from('hr_interview_answers')
    .upsert(
      {
        user_id: a.userId,
        question_id: a.questionId,
        content: a.content,
        image_paths: a.imagePaths,
        status: nextStatus,
      },
      { onConflict: 'question_id,user_id' },
    )
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as HrInterviewAnswerRow
}

// ── 이미지 ─────────────────────────────────────────────────
function safeFileName(name: string): string {
  const base = name.normalize('NFC').replace(/[^\w.\-가-힣]/g, '_')
  return base.length > 80 ? base.slice(-80) : base
}

export async function uploadHrImage(userId: string, questionId: string, file: File): Promise<string> {
  if (!HR_IMAGE_MIME.includes(file.type)) throw new Error('PNG/JPG/WEBP/GIF 이미지만 첨부할 수 있습니다.')
  if (file.size > HR_IMAGE_MAX_BYTES) throw new Error('이미지는 10MB 이하만 첨부할 수 있습니다.')
  const path = `${userId}/${questionId}/${Date.now()}_${safeFileName(file.name)}`
  const { error } = await supabase.storage.from(HR_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return path
}

export async function removeHrImage(path: string): Promise<void> {
  const { error } = await supabase.storage.from(HR_BUCKET).remove([path])
  if (error) throw new Error(error.message)
}

/** 경로 배열 → { path: signedUrl } (실패한 항목은 누락) */
export async function signHrImages(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage.from(HR_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SEC)
  if (error) throw new Error(error.message)
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out[d.path] = d.signedUrl
  return out
}

// ── localStorage 임시본 ─────────────────────────────────────
const draftKey = (uid: string, qid: string) => `hr_interview_draft:${uid}:${qid}`

export function readLocalDraft(uid: string, qid: string): HrLocalDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(uid, qid))
    if (!raw) return null
    const d = JSON.parse(raw) as HrLocalDraft
    if (typeof d.content !== 'string' || !Array.isArray(d.image_paths) || typeof d.saved_at !== 'number') return null
    return d
  } catch { return null }
}

export function writeLocalDraft(uid: string, qid: string, content: string, imagePaths: string[]): void {
  try {
    const d: HrLocalDraft = { content, image_paths: imagePaths, saved_at: Date.now() }
    localStorage.setItem(draftKey(uid, qid), JSON.stringify(d))
  } catch { /* quota 등 — 무시(DB draft 가 2차 안전망) */ }
}

export function clearLocalDraft(uid: string, qid: string): void {
  try { localStorage.removeItem(draftKey(uid, qid)) } catch { /* noop */ }
}
