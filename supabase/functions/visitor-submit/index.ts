// @ts-nocheck
/**
 * visitor-submit Edge Function — 방문 등록(익명) 처리  [텍스트 전용 개편]
 *
 * 정책(2026-07-10):
 *   · 이름/소속 = 텍스트(name_text/org_text). 이미지 처리 없음.
 *   · 서명(sig)만 이미지 → Storage 업로드.
 *   · 카드 필수(1~10). 미반납 카드 중복 시 CARD_IN_USE(409) — DB 부분 유니크 인덱스로 보장.
 *
 * 요청(POST, anon key):
 *   { name_text, org_text: string, sig_img: dataURL(png), purpose: '점검'|'미팅'|'기타', card_no: 1~10 }
 *
 * 원자성: 서명 업로드 → DB INSERT. INSERT 실패 시 업로드 파일 보상 삭제.
 *
 * 배포: supabase functions deploy visitor-submit --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY)

const BUCKET   = 'visitor-signatures'
const PURPOSES = ['점검', '미팅', '기타']
const MAX_IMG_BYTES = 2 * 1024 * 1024
const MAX_TEXT_LEN  = 60

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function pngDataUrlToBytes(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  try {
    const bin = atob(dataUrl.slice(comma + 1))
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.length > 0 ? bytes : null
  } catch { return null }
}

function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (t.length === 0 || t.length > MAX_TEXT_LEN) return null
  return t
}

function normalizeCardNo(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  if (!Number.isInteger(n) || n < 1 || n > 10) return null
  return n
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'INVALID_JSON' }, 400) }

  // ── 검증: 이름/소속 텍스트 ──
  const nameText = cleanText(payload?.name_text)
  if (!nameText) return json({ error: 'INVALID_NAME' }, 400)
  const orgText = cleanText(payload?.org_text)
  if (!orgText) return json({ error: 'INVALID_ORG' }, 400)

  // ── 검증: 목적 ──
  if (!PURPOSES.includes(payload?.purpose)) return json({ error: 'INVALID_PURPOSE' }, 400)

  // ── 검증: 카드 필수 ──
  const cardNo = normalizeCardNo(payload?.card_no)
  if (cardNo === null) return json({ error: 'CARD_REQUIRED' }, 400)

  // ── 검증: 서명 이미지 ──
  const sigBytes = pngDataUrlToBytes(payload?.sig_img)
  if (!sigBytes)                       return json({ error: 'INVALID_SIGNATURE' }, 400)
  if (sigBytes.length > MAX_IMG_BYTES)  return json({ error: 'IMAGE_TOO_LARGE' }, 413)

  // ── 서명 업로드 ──
  const id      = crypto.randomUUID()
  const sigPath = `${id}/sig.png`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(sigPath, sigBytes, { contentType: 'image/png', upsert: false })
  if (upErr) {
    console.error('[visitor-submit] 업로드 실패:', upErr.message)
    return json({ error: 'UPLOAD_FAILED' }, 500)
  }

  // ── DB INSERT ──
  const { error: insErr } = await supabase.from('visitor_logs').insert({
    id,
    name_text:    nameText,
    org_text:     orgText,
    sig_img_path: sigPath,
    purpose:      payload.purpose,
    card_no:      cardNo,
  })

  if (insErr) {
    await supabase.storage.from(BUCKET).remove([sigPath])  // 보상 삭제
    // 미반납 카드 중복 = 부분 유니크 인덱스 위반(23505)
    if (insErr.code === '23505') {
      return json({ error: 'CARD_IN_USE', card_no: cardNo }, 409)
    }
    console.error('[visitor-submit] INSERT 실패:', insErr.message)
    return json({ error: 'INSERT_FAILED' }, 500)
  }

  return json({ ok: true, id })
})
