// @ts-nocheck
/**
 * sync-all-users Edge Function v3
 * Microsoft Graph API User.ReadBasic.All (Application 권한)
 *
 * 퇴사자 처리 정책 (v3 변경):
 *   - departed_users 테이블에 이력 INSERT
 *   - profiles 테이블에서 DELETE (email unique constraint 해제 → 동일 이메일 재사용 가능)
 *   - 미래 예약 auto_cancelled = true
 *
 * 재입사 처리:
 *   - Azure AD에 동일 이메일로 신규 계정 생성 → profiles INSERT (새 object id)
 *   - departed_users 이력은 보존
 */

const TENANT_ID     = Deno.env.get('AZURE_TENANT_ID')             ?? ''
const CLIENT_ID     = Deno.env.get('AZURE_CLIENT_ID')             ?? ''
const CLIENT_SECRET = Deno.env.get('AZURE_CLIENT_SECRET')         ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')                ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')   ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sbHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

// ── Graph 토큰 발급 ──────────────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getGraphToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < cachedToken.expiresAt - 60_000) return cachedToken.token
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )
  if (!res.ok) throw new Error(`Graph 토큰 발급 실패: ${await res.text()}`)
  const data  = await res.json()
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return cachedToken.token
}

// ── Azure AD 전체 사용자 페이지네이션 조회 ───────────────────────────────────
async function fetchAllAzureUsers(token: string): Promise<any[]> {
  const all: any[] = []
  let url: string | null =
    'https://graph.microsoft.com/v1.0/users' +
    '?$select=id,displayName,mail,userPrincipalName' +
    '&$top=999' +
    '&$count=true'

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
    })
    if (!res.ok) throw new Error(`Graph API 오류 (${res.status}): ${await res.text()}`)
    const data = await res.json()
    all.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return all
}

// ── profiles 전체 조회 ───────────────────────────────────────────────────────
async function fetchAllProfiles(): Promise<{ id: string; name: string; email: string; dept: string; employee_id: string }[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,name,email,dept,employee_id`,
    { headers: sbHeaders }
  )
  if (!res.ok) throw new Error(`profiles 조회 실패 (${res.status}): ${await res.text()}`)
  return await res.json()
}

// ── 퇴사자 처리 ─────────────────────────────────────────────────────────────
// 1. departed_users에 이력 INSERT
// 2. profiles에서 DELETE
async function processDeparted(departed: { id: string; name: string; email: string; dept: string; employee_id: string }[]): Promise<void> {
  if (departed.length === 0) return

  // departed_users INSERT (이력 보존)
  const rows = departed.map(p => ({
    id:          p.id,
    name:        p.name        ?? '',
    email:       p.email       ?? '',
    dept:        p.dept        ?? '',
    employee_id: p.employee_id ?? '',
    departed_at: new Date().toISOString(),
  }))

  const insertRes = await fetch(
    // ON CONFLICT DO NOTHING: 같은 id가 이미 있으면 중복 삽입 방지
    `${SUPABASE_URL}/rest/v1/departed_users?on_conflict=id`,
    {
      method:  'POST',
      headers: { ...sbHeaders, 'Prefer': 'resolution=ignore-duplicates,return=minimal' },
      body:    JSON.stringify(rows),
    }
  )
  if (!insertRes.ok) {
    console.error('[sync] departed_users INSERT 실패:', await insertRes.text())
  }

  // profiles DELETE
  const ids    = departed.map(p => `"${p.id}"`).join(',')
  const filter = `id=in.(${ids})`
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?${filter}`,
    {
      method:  'DELETE',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
    }
  )
  if (!delRes.ok) {
    console.error('[sync] profiles DELETE 실패:', await delRes.text())
  }
}

// ── 퇴사자 미래 예약 자동 취소 ───────────────────────────────────────────────
async function cancelFutureBookings(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0

  const filter =
    `user_id=in.(${userIds.map(id => `"${id}"`).join(',')})` +
    `&start_at=gt.${new Date().toISOString()}` +
    `&auto_cancelled=eq.false`

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?select=id&${filter}`,
    { headers: sbHeaders }
  )
  if (!listRes.ok) return 0
  const targets: { id: string }[] = await listRes.json()
  if (targets.length === 0) return 0

  const idFilter = `id=in.(${targets.map(b => `"${b.id}"`).join(',')})`
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?${idFilter}`,
    {
      method:  'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ auto_cancelled: true, cancelled_by: 'system' }),
    }
  )
  if (!patchRes.ok) {
    console.error('[sync] 예약 취소 실패:', await patchRes.text())
    return 0
  }
  return targets.length
}

// ── profiles UPSERT ──────────────────────────────────────────────────────────
// email 기준 분리 처리 (id 보존)
async function upsertProfiles(users: any[], existingEmails: Set<string>): Promise<{ synced: number; skipped: number }> {
  const rows = users
    .map(u => ({
      id:          u.id,
      name:        u.displayName ?? '',
      email:       u.mail ?? u.userPrincipalName ?? '',
      employee_id: u.userPrincipalName ?? '',
      role:        'USER',
      is_active:   true,
    }))
    .filter(r => r.name && r.email)

  if (rows.length === 0) return { synced: 0, skipped: users.length }

  // 신규 → INSERT
  const toInsert = rows.filter(r => !existingEmails.has(r.email))
  if (toInsert.length > 0) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles`,
      {
        method:  'POST',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(toInsert),
      }
    )
    if (!res.ok) throw new Error(`profiles INSERT 실패 (${res.status}): ${await res.text()}`)
  }

  // 기존 → PATCH (name, employee_id만 갱신, id·dept·role 보존)
  const toUpdate = rows.filter(r => existingEmails.has(r.email))
  for (const row of toUpdate) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(row.email)}`,
      {
        method:  'PATCH',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify({ name: row.name, employee_id: row.employee_id }),
      }
    )
    if (!res.ok) console.error(`[sync] PATCH 실패 (${row.email}):`, await res.text())
  }

  return { synced: rows.length, skipped: users.length - rows.length }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. Azure AD 전체 조회
    const token   = await getGraphToken()
    const azUsers = await fetchAllAzureUsers(token)
    const azIdSet = new Set(azUsers.map(u => u.id))

    // 2. profiles 전체 조회
    const profiles      = await fetchAllProfiles()
    const existingEmails = new Set(profiles.map(p => p.email))

    // 3. 퇴사자 감지 (employee_id 있는 계정만 — 수동 생성 계정 보호)
    const departed = profiles.filter(p => p.employee_id && !azIdSet.has(p.id))

    // 4. 퇴사자: departed_users INSERT + profiles DELETE + 미래 예약 취소
    await processDeparted(departed)
    const cancelledCount = await cancelFutureBookings(departed.map(p => p.id))

    // 퇴사자 email을 existingEmails에서 제거 (DELETE 후 재입사자 INSERT 가능하도록)
    departed.forEach(p => existingEmails.delete(p.email))

    // 5. Azure AD 전체 UPSERT
    const { synced, skipped } = await upsertProfiles(azUsers, existingEmails)

    const result = {
      success:          true,
      total:            azUsers.length,
      synced,
      skipped,
      departed:         departed.length,
      cancelledBookings: cancelledCount,
      syncedAt:         new Date().toISOString(),
    }

    console.log('[sync-all-users] 완료:', JSON.stringify(result))
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[sync-all-users] 오류:', err)
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})
