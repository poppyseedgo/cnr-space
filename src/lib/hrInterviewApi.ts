// ============================================================
// HR Interview API — [2026-09-03] 신규 (api.ts 와 분리: 임시 페이지라 종료 시 파일 단위 제거)
//   · 접근: 로그인 사용자 전원 (RLS 가 본인 행만 허용) — [2026-09-03] 화이트리스트 게이트 폐기
//   · 답변: hr_interview_answers — (question_id, user_id) UNIQUE upsert
//   · 이미지: private 버킷 hr-interview, 경로 {uid}/{question_id}/{ts}_{name}, 열람은 signed URL
//   · 임시본: localStorage (즉시) + DB draft (debounce) — 다른 기기에서도 이어쓰기
//   · [2026-09-03 A안] 관리자 현황: hr_interview_is_admin() RPC(RLS 와 동일 판정) + 전체 답변 + profiles 조인, CSV
// ============================================================
import { supabase } from './supabase'
import type { HrInterviewAnswerRow, HrLocalDraft, HrAnswerWithProfile, HrInterviewQuestion } from '../types/hrInterview'

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
// [2026-09-03 HOTFIX] 근본 원인: Supabase Storage 객체 키는 S3 호환 ASCII 집합만 허용
//   (\w / ! - . * ' ( ) 공백 & $ @ = ; : + , ?). 이전 safeFileName 이 한글(가-힣)을 통과시켜
//   "ChatGPT_Image_2026년_8월_26일_…png" 같은 원본 파일명으로 키를 만들면 400 "Invalid key" → 업로드 실패 → 이미지 미표시.
//   해결: 원본 파일명을 키에 절대 넣지 않는다. 키 = {uid}/{qid}/{ts}_{rand}.{ext} (ext 는 MIME 으로 결정, 전부 ASCII).
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
}
function buildImageKey(userId: string, questionId: string, mime: string): string {
  const ext = EXT_BY_MIME[mime]
  const rand = Math.random().toString(36).slice(2, 8)
  return `${userId}/${questionId}/${Date.now()}_${rand}.${ext}`
}

export async function uploadHrImage(userId: string, questionId: string, file: File): Promise<string> {
  if (!HR_IMAGE_MIME.includes(file.type)) throw new Error('PNG/JPG/WEBP/GIF 이미지만 첨부할 수 있습니다.')
  if (file.size > HR_IMAGE_MAX_BYTES) throw new Error('이미지는 10MB 이하만 첨부할 수 있습니다.')
  const path = buildImageKey(userId, questionId, file.type)           // ← [HOTFIX] 원본 파일명 미사용
  const { error } = await supabase.storage.from(HR_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    metadata: { original_name: file.name },                            // ← 원본명은 메타데이터로만 보존
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

// ── [2026-09-03 A안] 관리자 현황 ──────────────────────────────
/** RLS 의 관리자 판정과 동일한 함수를 그대로 호출 — 프론트 별도 판정 금지(권한 이중분리 재현 방지) */
export async function fetchHrInterviewIsAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('hr_interview_is_admin')
  if (error) throw new Error(error.message)
  return data === true
}

/** 전체 답변 + 응답자 프로필 (RLS: 관리자만 타인 행 반환). FK hr_interview_answers.user_id → profiles.id */
export async function fetchAllHrAnswers(): Promise<HrAnswerWithProfile[]> {
  const { data, error } = await supabase
    .from('hr_interview_answers')
    .select('*, profiles(name, dept, email)')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as HrAnswerWithProfile[]
}

function csvCell(v: string | null | undefined): string {
  const t = (v ?? '').replace(/\r?\n/g, '\n')
  return `"${t.replace(/"/g, '""')}"`
}

/** 참여자×문항 long-format CSV (UTF-8 BOM — Excel 한글 깨짐 방지) */
export function buildHrStatusCsv(rows: HrAnswerWithProfile[], questions: HrInterviewQuestion[]): string {
  const head = ['이름', '부서', '이메일', '문항', '상태', '제출시각', '최종수정', '이미지수', '답변'].map(csvCell).join(',')
  const qNo = new Map(questions.map(q => [q.id, q.no]))
  const label = (s: string) => s === 'submitted' ? '답변완료' : '작성중'
  const lines = rows
    .slice()
    .sort((a, b) => (a.profiles?.name ?? '').localeCompare(b.profiles?.name ?? '', 'ko') || (qNo.get(a.question_id) ?? 0) - (qNo.get(b.question_id) ?? 0))
    .map(r => [
      r.profiles?.name, r.profiles?.dept, r.profiles?.email,
      String(qNo.get(r.question_id) ?? r.question_id), label(r.status),
      r.submitted_at ?? '', r.updated_at, String(r.image_paths.length), r.content,
    ].map(csvCell).join(','))
  return '\uFEFF' + [head, ...lines].join('\r\n')
}
