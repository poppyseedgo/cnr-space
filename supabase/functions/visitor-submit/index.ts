// @ts-nocheck
/**
 * visitor-submit Edge Function — 방문 등록(익명) 처리
 *
 * 역할:
 *   키오스크(공개 라우트 /visit)에서 익명으로 제출된 방문 정보를
 *   service_role 권한으로 Storage 업로드 + visitor_logs INSERT까지 원자적으로 처리.
 *   → 익명 클라이언트가 테이블/버킷에 직접 접근하지 않음 (Phase 1에서 전면 잠금)
 *
 * 요청 (POST, anon key Authorization):
 *   { name_img, org_img, sig_img: dataURL(image/png), purpose: '점검'|'미팅'|'기타',
 *     card_no: number|string|null }
 *
 * 원자성:
 *   이미지 3장 업로드 → DB INSERT. INSERT 실패 시 업로드된 파일 즉시 삭제(보상 트랜잭션).
 *   업로드 도중 실패 시에도 그때까지 올린 파일 삭제 후 실패 반환. → 고아 파일 없음.
 *
 * 배포: supabase functions deploy visitor-submit --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 *   · SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입 (별도 설정 불필요)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY)

const BUCKET = 'visitor-signatures'

// purpose 허용값 (DB CHECK 제약과 1:1)
const PURPOSES = ['점검', '미팅', '기타']

// 이미지 1장당 최대 크기(바이트). 필기/서명 PNG는 수십 KB 수준 → 2MB면 충분히 여유.
const MAX_IMG_BYTES = 2 * 1024 * 1024

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

// data:image/png;base64,.... → Uint8Array. PNG dataURL이 아니면 null.
function pngDataUrlToBytes(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string') return null
  if (!dataUrl.startsWith('data:image/png')) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const bin   = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.length > 0 ? bytes : null
  } catch {
    return null
  }
}

// card_no 정규화: '' / null / undefined → null, 그 외엔 1~10 정수만 허용
function normalizeCardNo(raw: unknown): number | null | 'INVALID' {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isInteger(n) || n < 1 || n > 10) return 'INVALID'
  return n
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  // ── 입력 파싱 ──
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'INVALID_JSON' }, 400)
  }

  const { name_img, org_img, sig_img, purpose } = payload ?? {}

  // ── 검증: 목적 ──
  if (!PURPOSES.includes(purpose)) {
    return json({ error: 'INVALID_PURPOSE' }, 400)
  }

  // ── 검증: card_no ──
  const cardNo = normalizeCardNo(payload?.card_no)
  if (cardNo === 'INVALID') {
    return json({ error: 'INVALID_CARD_NO' }, 400)
  }

  // ── 검증: 이미지 3장 (PNG dataURL + 크기) ──
  const imgs: Array<{ key: string; bytes: Uint8Array }> = []
  for (const [key, raw] of [['name', name_img], ['org', org_img], ['sig', sig_img]] as const) {
    const bytes = pngDataUrlToBytes(raw)
    if (!bytes) {
      return json({ error: 'INVALID_IMAGE', field: key }, 400)
    }
    if (bytes.length > MAX_IMG_BYTES) {
      return json({ error: 'IMAGE_TOO_LARGE', field: key }, 413)
    }
    imgs.push({ key, bytes })
  }

  // ── 레코드 id = Storage 폴더명. 경로: {id}/{name|org|sig}.png ──
  const id       = crypto.randomUUID()
  const pathOf   = (k: string) => `${id}/${k}.png`
  const uploaded: string[] = []

  // ── 업로드 (실패 시 그때까지 올린 파일 정리 후 반환) ──
  for (const img of imgs) {
    const path = pathOf(img.key)
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, img.bytes, { contentType: 'image/png', upsert: false })
    if (error) {
      if (uploaded.length > 0) await supabase.storage.from(BUCKET).remove(uploaded)
      console.error('[visitor-submit] 업로드 실패:', error.message)
      return json({ error: 'UPLOAD_FAILED' }, 500)
    }
    uploaded.push(path)
  }

  // ── DB INSERT (실패 시 업로드 파일 보상 삭제) ──
  const { error: insErr } = await supabase.from('visitor_logs').insert({
    id,
    name_img_path: pathOf('name'),
    org_img_path:  pathOf('org'),
    sig_img_path:  pathOf('sig'),
    purpose,
    card_no: cardNo,   // number | null
  })

  if (insErr) {
    await supabase.storage.from(BUCKET).remove(uploaded)   // 고아 파일 방지
    console.error('[visitor-submit] INSERT 실패:', insErr.message)
    return json({ error: 'INSERT_FAILED' }, 500)
  }

  return json({ ok: true, id })
})
