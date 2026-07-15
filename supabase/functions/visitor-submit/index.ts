// @ts-nocheck
/**
 * visitor-submit Edge Function — 방문 등록(익명)  [카드 라벨 + 방문자 메모]
 *
 * 정책(2026-07-10):
 *   · 이름/소속 = 텍스트. 서명만 이미지.
 *   · 카드 = 라벨(text). 등록된 카드(visitor_cards)만 허용. 미반납 중복 시 CARD_IN_USE(409).
 *   · visitor_memo = 방문자 메모(선택, 최대 100자).
 *
 * 요청(POST, anon key):
 *   { name_text, org_text, card_no(라벨): string, sig_img: dataURL(png),
 *     purpose: '점검'|'미팅'|'기타', visitor_memo?: string }
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
const MAX_NAME_LEN  = 60
const MAX_MEMO_LEN  = 100
 
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
 
function pngDataUrlToBytes(dataUrl: unknown): Uint8Array | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) return null
  const comma = dataUrl.indexOf(','); if (comma < 0) return null
  try {
    const bin = atob(dataUrl.slice(comma + 1)); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.length > 0 ? bytes : null
  } catch { return null }
}
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (t.length === 0 || t.length > max) return null
  return t
}
 
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
 
  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'INVALID_JSON' }, 400) }
 
  // 이름/소속
  const nameText = cleanText(payload?.name_text, MAX_NAME_LEN)
  if (!nameText) return json({ error: 'INVALID_NAME' }, 400)
  const orgText = cleanText(payload?.org_text, MAX_NAME_LEN)
  if (!orgText) return json({ error: 'INVALID_ORG' }, 400)
 
  // 목적
  if (!PURPOSES.includes(payload?.purpose)) return json({ error: 'INVALID_PURPOSE' }, 400)
 
  // 방문자 메모 (선택, ≤100)
  let memo: string | null = null
  if (payload?.visitor_memo != null && String(payload.visitor_memo).trim() !== '') {
    memo = cleanText(payload.visitor_memo, MAX_MEMO_LEN)
    if (!memo) return json({ error: 'MEMO_TOO_LONG' }, 400)
  }
 
  // 카드(라벨) 필수 + 등록된 카드인지 검증
  const cardLabel = cleanText(payload?.card_no, 40)
  if (!cardLabel) return json({ error: 'CARD_REQUIRED' }, 400)
  const { data: card, error: cardErr } = await supabase
    .from('visitor_cards').select('label').eq('label', cardLabel).maybeSingle()
  if (cardErr) { console.error('[visitor-submit] 카드 조회 실패:', cardErr.message); return json({ error: 'CARD_CHECK_FAILED' }, 500) }
  if (!card)   return json({ error: 'INVALID_CARD' }, 400)
 
  // 서명 이미지
  const sigBytes = pngDataUrlToBytes(payload?.sig_img)
  if (!sigBytes)                      return json({ error: 'INVALID_SIGNATURE' }, 400)
  if (sigBytes.length > MAX_IMG_BYTES) return json({ error: 'IMAGE_TOO_LARGE' }, 413)
 
  // 서명 업로드
  const id = crypto.randomUUID(); const sigPath = `${id}/sig.png`
  const { error: upErr } = await supabase.storage
    .from(BUCKET).upload(sigPath, sigBytes, { contentType: 'image/png', upsert: false })
  if (upErr) { console.error('[visitor-submit] 업로드 실패:', upErr.message); return json({ error: 'UPLOAD_FAILED' }, 500) }
 
  // DB INSERT
  const { error: insErr } = await supabase.from('visitor_logs').insert({
    id, name_text: nameText, org_text: orgText, sig_img_path: sigPath,
    purpose: payload.purpose, card_no: cardLabel, visitor_memo: memo,
  })
  if (insErr) {
    await supabase.storage.from(BUCKET).remove([sigPath])
    if (insErr.code === '23505') return json({ error: 'CARD_IN_USE', card_no: cardLabel }, 409)
    console.error('[visitor-submit] INSERT 실패:', insErr.message)
    return json({ error: 'INSERT_FAILED' }, 500)
  }
 
  return json({ ok: true, id })
})
