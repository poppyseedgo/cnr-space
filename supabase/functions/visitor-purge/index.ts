// @ts-nocheck
/**
 * visitor-purge Edge Function — 1년 경과 방문로그 자동 폐기
 *
 * 역할:
 *   "작성일로부터 1년" 파쇄 폐기 정책 실행 (개인정보 보호).
 *   visited_at < now() - 1년 인 방문 기록의 Storage 파일 + DB 행을 함께 삭제.
 *   Storage 파일 삭제는 service_role(Storage API)이 필요 → 순수 SQL cron 불가, 본 함수가 담당.
 *
 * 호출:
 *   pg_cron이 매일 1회 net.http_post로 호출 (Phase 2 cron SQL 참조).
 *   공개 노출 방어: X-Purge-Secret 헤더가 VISITOR_PURGE_SECRET 와 일치해야 실행.
 *
 * 배포: supabase functions deploy visitor-purge --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 *   시크릿: supabase secrets set VISITOR_PURGE_SECRET=... --project-ref jjzcqpbwkkujttwxksvy
 *   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 런타임 자동 주입)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PURGE_SECRET  = Deno.env.get('VISITOR_PURGE_SECRET')      ?? ''
const supabase      = createClient(SUPABASE_URL, SERVICE_KEY)

const BUCKET = 'visitor-signatures'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-purge-secret',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // ── 시크릿 검증 (공개 배포 방어) ──
  const secret = req.headers.get('x-purge-secret') ?? ''
  if (!PURGE_SECRET || secret !== PURGE_SECRET) {
    return json({ error: 'FORBIDDEN' }, 403)
  }

  // ── 1) 1년 경과 대상 조회 ──
  const cutoffIso = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const { data: rows, error: selErr } = await supabase
    .from('visitor_logs')
    .select('id, name_img_path, org_img_path, sig_img_path')
    .lt('visited_at', cutoffIso)

  if (selErr) {
    console.error('[visitor-purge] 조회 실패:', selErr.message)
    return json({ error: 'SELECT_FAILED' }, 500)
  }
  if (!rows || rows.length === 0) {
    return json({ ok: true, purged: 0 })
  }

  // ── 2) Storage 파일 삭제 (경로 3개/행) ──
  const paths = rows.flatMap(r => [r.name_img_path, r.org_img_path, r.sig_img_path]).filter(Boolean)
  if (paths.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(paths)
    if (rmErr) {
      // Storage 삭제 실패 시 DB 행은 남겨 재시도 가능하게 함 (다음 cron이 재처리)
      console.error('[visitor-purge] Storage 삭제 실패:', rmErr.message)
      return json({ error: 'STORAGE_DELETE_FAILED' }, 500)
    }
  }

  // ── 3) DB 행 삭제 ──
  const ids = rows.map(r => r.id)
  const { error: delErr } = await supabase.from('visitor_logs').delete().in('id', ids)
  if (delErr) {
    console.error('[visitor-purge] DB 삭제 실패:', delErr.message)
    return json({ error: 'DB_DELETE_FAILED' }, 500)
  }

  console.log(`[visitor-purge] ${rows.length}건 폐기 (cutoff ${cutoffIso})`)
  return json({ ok: true, purged: rows.length })
})
