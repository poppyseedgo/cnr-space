// @ts-nocheck
/**
 * sync-all-users Edge Function v6
 * Microsoft Graph API User.ReadBasic.All (Application 권한)
 *
 * 퇴사자 처리 정책:
 *   - departed_users 테이블에 이력 INSERT (화면에서 퇴사자 목록으로 표시)
 *   - profiles 테이블에서 DELETE (이메일 재사용 가능하도록)
 *   - 미래 예약 auto_cancelled = true
 *
 * 신규 직원 INSERT id 결정 기준:
 *   - auth.users에 존재(로그인 이력 있음) → auth.users.id 사용
 *   - auth.users에 없음(미로그인)         → Azure AD object id 사용
 *     (첫 SSO 로그인 시 handle_sso_new_user 트리거가 id 교체 + dept 채움)
 *
 * 기존 직원 PATCH:
 *   - name, employee_id, azure_user_id 만 갱신
 *   - id, dept, role 절대 건드리지 않음
 *
 * Avatar sync 정책:
 *   - avatar_url 이 NULL 인 프로필만 처리 (이미 있으면 skip)
 *   - ?forceRefreshAvatars=true 로 호출 시 전체 재동기화
 *   - Graph API /users/{azureObjectId}/photo/$value (User.ReadBasic.All 로 접근)
 *   - Supabase Storage avatars/{profileId}.jpg 에 service_role 로 업로드
 *
 * 안전장치:
 *   - 퇴사자가 전체 profiles의 30% 초과 시 싱크 중단
 */

const TENANT_ID     = Deno.env.get('AZURE_TENANT_ID')           ?? ''
const CLIENT_ID     = Deno.env.get('AZURE_CLIENT_ID')           ?? ''
const CLIENT_SECRET = Deno.env.get('AZURE_CLIENT_SECRET')       ?? ''
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

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
async function fetchAllProfiles(): Promise<{
  id: string; name: string; email: string; dept: string
  employee_id: string; role: string; avatar_url: string | null; azure_user_id: string | null
}[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,name,email,dept,employee_id,role,avatar_url,azure_user_id`,
    { headers: sbHeaders }
  )
  if (!res.ok) throw new Error(`profiles 조회 실패 (${res.status}): ${await res.text()}`)
  return await res.json()
}

// ── auth.users 이메일 → id 맵 조회 ──────────────────────────────────────────
async function fetchAuthUserEmailMap(): Promise<Map<string, string>> {
  const emailToId = new Map<string, string>()
  let page = 0
  const perPage = 1000

  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      {
        headers: {
          'apikey':         SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
      }
    )
    if (!res.ok) throw new Error(`auth.users 조회 실패 (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const users = data.users ?? []
    for (const u of users) {
      if (u.email) emailToId.set(u.email.toLowerCase(), u.id)
    }
    if (users.length < perPage) break
    page++
  }
  return emailToId
}

// ── 퇴사자 처리 ─────────────────────────────────────────────────────────────
async function processDeparted(departed: {
  id: string; name: string; email: string; dept: string; employee_id: string
}[]): Promise<void> {
  if (departed.length === 0) return

  const rows = departed.map(p => ({
    id:          p.id,
    name:        p.name        ?? '',
    email:       p.email       ?? '',
    dept:        p.dept        ?? '',
    employee_id: p.employee_id ?? '',
    departed_at: new Date().toISOString(),
  }))

  const insertRes = await fetch(
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

  const ids    = departed.map(p => `"${p.id}"`).join(',')
  const delRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=in.(${ids})`,
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

// ── profiles 신규/기존 분리 처리 ─────────────────────────────────────────────
async function syncProfiles(
  azUsers: any[],
  existingEmails: Set<string>,
  authEmailMap: Map<string, string>,
): Promise<{ inserted: number; updated: number; skipped: number }> {

  const rows = azUsers
    .map(u => ({
      azureId:     u.id,
      name:        u.displayName ?? '',
      email:       (u.mail ?? u.userPrincipalName ?? '').toLowerCase(),
      employee_id: u.userPrincipalName ?? '',
    }))
    .filter(r => r.name && r.email)

  if (rows.length === 0) return { inserted: 0, updated: 0, skipped: azUsers.length }

  // 신규 직원 INSERT — azure_user_id 포함
  const toInsert = rows
    .filter(r => !existingEmails.has(r.email))
    .map(r => ({
      id:             authEmailMap.get(r.email) ?? r.azureId,
      name:           r.name,
      email:          r.email,
      employee_id:    r.employee_id,
      azure_user_id:  r.azureId,
      role:           'USER',
      dept:           '',
    }))

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

  // 기존 직원 PATCH — name, employee_id, azure_user_id 갱신 / id·dept·role 건드리지 않음
  const toUpdate = rows.filter(r => existingEmails.has(r.email))
  for (const row of toUpdate) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(row.email)}`,
      {
        method:  'PATCH',
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body:    JSON.stringify({
          name:          row.name,
          employee_id:   row.employee_id,
          azure_user_id: row.azureId,
        }),
      }
    )
    if (!res.ok) console.error(`[sync] PATCH 실패 (${row.email}):`, await res.text())
  }

  return {
    inserted: toInsert.length,
    updated:  toUpdate.length,
    skipped:  azUsers.length - rows.length,
  }
}

// ── 프로필 사진 동기화 ───────────────────────────────────────────────────────
// - avatar_url 이 NULL 인 프로필만 처리 (forceRefresh=true 시 전체)
// - Graph API /users/{azureObjectId}/photo/$value (Application 권한)
// - Supabase Storage avatars/{profileId}.jpg (service_role 로 업로드 → RLS 우회)
async function syncAvatars(
  token: string,
  profiles: any[],
  azEmailMap: Map<string, string>, // email → azureObjectId (fetchAllAzureUsers 결과)
  forceRefresh = false,
): Promise<{ synced: number; skipped: number; noPhoto: number; failed: number }> {

  // 처리 대상: avatar_url 없는 프로필만 (forceRefresh 시 전체)
  const targets = forceRefresh
    ? profiles
    : profiles.filter(p => !p.avatar_url)

  if (targets.length === 0) {
    return { synced: 0, skipped: profiles.length, noPhoto: 0, failed: 0 }
  }

  console.log(`[avatar] 처리 대상 ${targets.length}명 (전체 ${profiles.length}명)`)

  let synced = 0, noPhoto = 0, failed = 0

  for (const profile of targets) {
    // Azure Object ID 결정: 컬럼에 저장된 값 우선, 없으면 이메일로 매핑
    const email   = (profile.email ?? '').toLowerCase()
    const azureId = profile.azure_user_id || azEmailMap.get(email)

    if (!azureId) {
      console.warn(`[avatar] azureId 없음 — skip (${email})`)
      failed++
      continue
    }

    try {
      // 1. Graph API 에서 photo binary 취득
      const photoRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${azureId}/photo/$value`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      // 404 = 사진 등록 안 된 계정 (정상 케이스, 에러 아님)
      if (photoRes.status === 404) { noPhoto++; continue }

      if (!photoRes.ok) {
        console.warn(`[avatar] photo fetch 실패 (${azureId}): ${photoRes.status}`)
        failed++
        continue
      }

      const contentType   = photoRes.headers.get('content-type') ?? 'image/jpeg'
      const arrayBuffer   = await photoRes.arrayBuffer()
      const fileName      = `${profile.id}.jpg`

      // 2. Supabase Storage 에 service_role 로 업로드 (x-upsert: true → PUT 대신 POST 한 번으로 처리)
      const uploadRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/avatars/${fileName}`,
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type':  contentType,
            'x-upsert':      'true',
          },
          body: arrayBuffer,
        }
      )

      if (!uploadRes.ok) {
        console.warn(`[avatar] Storage 업로드 실패 (${profile.id}):`, await uploadRes.text())
        failed++
        continue
      }

      // 3. public URL 구성 후 profiles.avatar_url 갱신
      const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${fileName}`
      const patchRes  = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.id}`,
        {
          method:  'PATCH',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
          body:    JSON.stringify({ avatar_url: avatarUrl, azure_user_id: azureId }),
        }
      )

      if (!patchRes.ok) {
        console.warn(`[avatar] profiles PATCH 실패 (${profile.id}):`, await patchRes.text())
        failed++
        continue
      }

      synced++
    } catch (e) {
      console.warn(`[avatar] 처리 중 예외 (${profile.id}):`, e)
      failed++
    }
  }

  return { synced, skipped: profiles.length - targets.length, noPhoto, failed }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const url              = new URL(req.url)
    const forceRefreshAvatars = url.searchParams.get('forceRefreshAvatars') === 'true'

    // 1. Azure AD 전체 조회
    const token   = await getGraphToken()
    const azUsers = await fetchAllAzureUsers(token)
    const azUPNSet    = new Set(azUsers.map(u => (u.userPrincipalName ?? '').toLowerCase()))
    // email → azureObjectId 맵 (avatar sync에서 사용)
    const azEmailMap  = new Map<string, string>(
      azUsers
        .filter(u => u.mail || u.userPrincipalName)
        .map(u => [(u.mail ?? u.userPrincipalName ?? '').toLowerCase(), u.id])
    )

    // 2. profiles 전체 조회 (avatar_url, azure_user_id 포함)
    const profiles       = await fetchAllProfiles()
    const existingEmails = new Set(profiles.map(p => (p.email ?? '').toLowerCase()))

    // 3. auth.users 이메일 → id 맵 (로그인 이력 있는 계정 id 보존)
    const authEmailMap = await fetchAuthUserEmailMap()

    // 4. 퇴사자 감지 (employee_id 있는 계정만 — 수동 생성 계정 보호)
    const departed = profiles.filter(
      p => p.employee_id && !azUPNSet.has(p.employee_id.toLowerCase())
    )

    // 안전장치: 퇴사자 30% 초과 시 싱크 중단
    const employeeProfiles = profiles.filter(p => p.employee_id)
    if (employeeProfiles.length > 0) {
      const ratio = departed.length / employeeProfiles.length
      if (ratio > 0.3) {
        const msg = `[sync] 안전장치 발동: 퇴사자 비율 ${Math.round(ratio * 100)}% (${departed.length}/${employeeProfiles.length}) — 30% 초과로 싱크 중단`
        console.error(msg)
        return new Response(
          JSON.stringify({ success: false, error: msg, aborted: true }),
          { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
        )
      }
    }

    // 5. 퇴사자 처리
    await processDeparted(departed)
    const cancelledCount = await cancelFutureBookings(departed.map(p => p.id))
    departed.forEach(p => existingEmails.delete((p.email ?? '').toLowerCase()))

    // 6. 신규/기존 직원 처리 (azure_user_id 포함)
    const { inserted, updated, skipped } = await syncProfiles(azUsers, existingEmails, authEmailMap)

    // 7. 프로필 사진 동기화 — INSERT/PATCH 반영된 최신 profiles 재조회
    const latestProfiles = await fetchAllProfiles()
    const avatarResult   = await syncAvatars(token, latestProfiles, azEmailMap, forceRefreshAvatars)

    const result = {
      success: true, total: azUsers.length,
      inserted, updated, skipped,
      departed: departed.length, cancelledBookings: cancelledCount,
      avatars: avatarResult,
      syncedAt: new Date().toISOString(),
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
