// @ts-nocheck
/**
 * sync-all-users Edge Function v2
 * Microsoft Graph API User.ReadBasic.All (Application 권한)
 *
 * 실행 주체:
 *   - Admin 수동: supabase.functions.invoke('sync-all-users')
 *   - pg_cron 자동: 매일 오전 2시
 *
 * 동작:
 *   1. Azure AD 전체 사용자 페이지네이션 조회
 *   2. profiles 테이블 전체 조회
 *   3. Azure AD에 없는 employee_id 보유 계정 → 퇴사자 처리
 *      - profiles.is_active = false
 *      - 해당 유저의 미래 예약 auto_cancelled = true
 *   4. Azure AD 전체 UPSERT (신규 삽입 / 기존 name+email 갱신, dept 보존)
 *
 * 퇴사 기준: "Azure AD 계정 완전 삭제" (비활성화 아님 — IT팀 확인 완료)
 * 안전 장치: employee_id 없는 계정은 퇴사 처리 대상에서 제외
 *            (수동 생성 계정, 로컬 테스트 계정 보호)
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

// ── Supabase REST 공통 헤더 ───────────────────────────────────────────────────
const sbHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

// ── Graph 토큰 발급 (모듈 레벨 캐시) ────────────────────────────────────────
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
  const data   = await res.json()
  cachedToken  = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
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
      headers: {
        Authorization:    `Bearer ${token}`,
        ConsistencyLevel: 'eventual',
      },
    })
    if (!res.ok) throw new Error(`Graph API 오류 (${res.status}): ${await res.text()}`)
    const data = await res.json()
    all.push(...(data.value ?? []))
    url = data['@odata.nextLink'] ?? null
  }
  return all
}

// ── profiles 전체 조회 ───────────────────────────────────────────────────────
async function fetchAllProfiles(): Promise<{ id: string; employee_id: string }[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,employee_id`,
    { headers: sbHeaders }
  )
  if (!res.ok) throw new Error(`profiles 조회 실패 (${res.status}): ${await res.text()}`)
  return await res.json()
}

// ── 퇴사자 처리: is_active = false ───────────────────────────────────────────
async function deactivateProfiles(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  // Supabase REST: IN 필터는 id=in.(id1,id2,...)
  const filter = `id=in.(${ids.map(id => `"${id}"`).join(',')})`
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?${filter}`,
    {
      method:  'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({ is_active: false }),
    }
  )
  if (!res.ok) throw new Error(`퇴사자 비활성화 실패 (${res.status}): ${await res.text()}`)
}

// ── 퇴사자 미래 예약 자동 취소 ───────────────────────────────────────────────
// bookings 테이블의 user_id (= profiles.id) 기준으로 취소
// start_at > now() 인 예약만 대상 (과거 예약은 이력 보존)
async function cancelFutureBookings(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0

  // 취소 대상 조회
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

  // 일괄 취소
  const idFilter = `id=in.(${targets.map(b => `"${b.id}"`).join(',')})`
  const patchRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?${idFilter}`,
    {
      method:  'PATCH',
      headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
      body:    JSON.stringify({
        auto_cancelled: true,
        cancelled_by:   'system',
      }),
    }
  )
  if (!patchRes.ok) {
    console.error('[sync-all-users] 예약 취소 실패:', await patchRes.text())
    return 0
  }
  return targets.length
}

// ── profiles UPSERT (신규 삽입 / 기존 name+email 갱신, dept·is_active 보존) ──
async function upsertProfiles(users: any[]): Promise<{ synced: number; skipped: number }> {
  if (users.length === 0) return { synced: 0, skipped: 0 }

  const rows = users
    .map(u => ({
      id:          u.id,
      name:        u.displayName ?? '',
      email:       u.mail ?? u.userPrincipalName ?? '',
      employee_id: u.userPrincipalName ?? '',
      role:        'USER',
      is_active:   true,   // 신규 삽입 시 기본값, 기존 row는 Prefer merge로 덮어씀
      // dept: 생략 — 로그인 후 useAuth.fetchAndSaveDept()가 채움
    }))
    .filter(r => r.name && r.email)

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`,
    {
      method:  'POST',
      headers: {
        ...sbHeaders,
        // merge-duplicates: id 충돌 시 UPDATE (is_active도 true로 재활성화됨)
        // 퇴사 후 재입사 시 자동 재활성화
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    }
  )
  if (!res.ok) throw new Error(`profiles UPSERT 실패 (${res.status}): ${await res.text()}`)
  return { synced: rows.length, skipped: users.length - rows.length }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // 1. Azure AD 전체 사용자 조회
    const token    = await getGraphToken()
    const azUsers  = await fetchAllAzureUsers(token)
    const azIdSet  = new Set(azUsers.map(u => u.id))

    // 2. profiles 전체 조회
    const profiles = await fetchAllProfiles()

    // 3. 퇴사자 감지
    //    조건: profiles에 있지만 Azure AD에 없음
    //         + employee_id가 있는 계정만 (Azure AD 경유 계정)
    //         + 수동 생성 계정(employee_id 없음) 제외
    const departedIds = profiles
      .filter(p => p.employee_id && !azIdSet.has(p.id))
      .map(p => p.id)

    // 4. 퇴사자 비활성화 + 미래 예약 취소
    await deactivateProfiles(departedIds)
    const cancelledCount = await cancelFutureBookings(departedIds)

    // 5. Azure AD 전체 UPSERT
    const { synced, skipped } = await upsertProfiles(azUsers)

    const result = {
      success:    true,
      total:      azUsers.length,       // Azure AD 전체 인원
      synced,                            // profiles에 반영된 인원
      skipped,                           // 이름/이메일 없어서 제외된 계정
      deactivated: departedIds.length,   // 퇴사 처리된 인원
      cancelledBookings: cancelledCount, // 취소된 미래 예약 수
      syncedAt:   new Date().toISOString(),
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
