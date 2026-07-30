// @ts-nocheck
/**
 * depart-user Edge Function — 수동 퇴사 처리 (Phase 2)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 수동 퇴사 UI 백엔드 (확정 요구사항 ③)
 *      · 기존 api.ts manualDepartUser(클라 직접 4단계, 비원자적·미사용)를 대체
 *      · DB 처리는 process_departure RPC 단일 트랜잭션 / auth 삭제는 여기서
 *      · 복구(되돌리기) 기능 없음 — 확정 정책
 *      · 알림 미발송 — send-notification 호출 없음
 *
 * 호출: supabase.functions.invoke('depart-user', { body: { user_id } })
 *       — invoke 가 호출자 JWT 를 Authorization 헤더로 자동 전달
 *
 * 권한: --no-verify-jwt 배포(프로젝트 관례)이므로 함수 내부에서 직접 검증.
 *       호출자 JWT → auth.getUser → profiles.role='ADMIN' OR admin_roles 'user' 보유
 *       (process_departure RPC 의 권한식과 동일 기준 — 사용자 관리 탭 진입 권한)
 *
 * 배포: supabase functions deploy depart-user --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 */

import { executeDeparture } from '../_shared/departure.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')         ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const svcHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

// ── 호출자 검증: JWT → user id ──────────────────────────────────────────────
async function getCallerId(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': ANON_KEY, 'Authorization': auth },  // 사용자 토큰 그대로 전달
  })
  if (!res.ok) return null
  const u = await res.json()
  return u?.id ?? null
}

// ── 관리자 판정: profiles.role='ADMIN' OR admin_roles 'user' 역할 보유 ──────
//    (RPC process_departure 의 is_profile_admin() OR has_admin_role('user') 와 동일 기준)
async function isUserAdmin(callerId: string): Promise<boolean> {
  const [pRes, rRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerId}&select=role`,             { headers: svcHeaders }),
    fetch(`${SUPABASE_URL}/rest/v1/admin_roles?user_id=eq.${callerId}&role=eq.user&select=role`, { headers: svcHeaders }),
  ])
  const profile = pRes.ok ? await pRes.json() : []
  const roles   = rRes.ok ? await rRes.json() : []
  return profile?.[0]?.role === 'ADMIN' || (roles?.length ?? 0) > 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. 호출자 검증
    const callerId = await getCallerId(req)
    if (!callerId) return json({ success: false, error: 'UNAUTHENTICATED' }, 401)
    if (!(await isUserAdmin(callerId))) return json({ success: false, error: 'FORBIDDEN' }, 403)

    // 2. 입력 검증
    const { user_id } = await req.json().catch(() => ({}))
    if (!user_id || typeof user_id !== 'string') {
      return json({ success: false, error: 'USER_ID_REQUIRED' }, 400)
    }
    if (user_id === callerId) {
      // 본인 셀프 퇴사 방지 — 마지막 관리자가 스스로를 지우는 사고 차단
      return json({ success: false, error: 'CANNOT_DEPART_SELF' }, 400)
    }

    // 3. 대상 프로필 조회 (email = auth 매칭 키)
    const pRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}&select=id,name,email`,
      { headers: svcHeaders }
    )
    const profile = pRes.ok ? (await pRes.json())?.[0] : null
    if (!profile) return json({ success: false, error: 'USER_NOT_FOUND' }, 404)

    // 4. 퇴사 실행 — RPC(원자적) + auth 삭제. actor = 처리 관리자 (감사 기록용)
    const result = await executeDeparture(
      SUPABASE_URL, SERVICE_KEY, profile.id, profile.email, callerId,
    )
    if (result.error) return json({ success: false, error: result.error }, 500)

    console.log(`[depart-user] 완료 by ${callerId}:`, JSON.stringify(result))
    return json({ success: true, ...result })

  } catch (err) {
    console.error('[depart-user] 오류:', err)
    return json({ success: false, error: String(err) }, 500)
  }
})
