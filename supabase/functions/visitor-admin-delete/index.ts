// @ts-nocheck
/**
 * visitor-admin-delete Edge Function — 방문 기록 삭제 (관리자)
 *
 * 역할:
 *   관리 UI(Phase 5)에서 기록 1건 삭제 시 Storage 이미지 3장 + visitor_logs 행을
 *   원자적으로 삭제. 순수 SQL RPC는 Storage 파일을 못 지우므로 본 함수가 담당.
 *
 * 인증(2단계 AND):
 *   호출자의 JWT(Authorization)로 visitor_verify_access(pw) RPC 실행
 *   → visitor_is_admin()[role=ADMIN·활성] AND 2차 비번 일치 여야 통과.
 *   통과 시에만 service_role로 실제 삭제 수행.
 *
 * 요청 (POST):
 *   headers: Authorization: Bearer <관리자 세션 access_token>
 *   body:    { pw: string, id: uuid }
 *
 * 배포: supabase functions deploy visitor-admin-delete --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 *   (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입)
 */
 
import { createClient } from 'jsr:@supabase/supabase-js@2'
 
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')         ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
 
const BUCKET = 'visitor-signatures'
 
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
 
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
 
  // ── 입력 ──
  let payload: any
  try { payload = await req.json() } catch { return json({ error: 'INVALID_JSON' }, 400) }
  const { pw, id } = payload ?? {}
  if (!pw || !id) return json({ error: 'MISSING_PARAMS' }, 400)
 
  // ── 게이트: 호출자 JWT로 verify_access(pw) ──
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: ok, error: vErr } = await userClient.rpc('visitor_verify_access', { p_pw: pw })
  if (vErr) {
    console.error('[visitor-admin-delete] 검증 오류:', vErr.message)
    return json({ error: 'VERIFY_FAILED' }, 500)
  }
  if (ok !== true) {
    return json({ error: 'FORBIDDEN' }, 403)
  }
 
  // ── service_role: 대상 경로 조회 → Storage 삭제 → DB 행 삭제 ──
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
 
  const { data: row, error: selErr } = await admin
    .from('visitor_logs')
    .select('name_img_path, org_img_path, sig_img_path')
    .eq('id', id)
    .single()
 
  if (selErr || !row) {
    // 이미 없는 경우도 성공 취급(멱등)
    return json({ ok: true, deleted: 0 })
  }
 
  const paths = [row.name_img_path, row.org_img_path, row.sig_img_path].filter(Boolean)
  if (paths.length > 0) {
    const { error: rmErr } = await admin.storage.from(BUCKET).remove(paths)
    if (rmErr) {
      // Storage 삭제 실패 시 DB 행 보존 → 재시도 가능(브로큰 이미지 행 방지)
      console.error('[visitor-admin-delete] Storage 삭제 실패:', rmErr.message)
      return json({ error: 'STORAGE_DELETE_FAILED' }, 500)
    }
  }
 
  const { error: delErr } = await admin.from('visitor_logs').delete().eq('id', id)
  if (delErr) {
    console.error('[visitor-admin-delete] DB 삭제 실패:', delErr.message)
    return json({ error: 'DB_DELETE_FAILED' }, 500)
  }
 
  return json({ ok: true, deleted: 1 })
})
