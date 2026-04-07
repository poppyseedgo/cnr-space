// @ts-nocheck
/**
 * search-users Edge Function
 * Microsoft Graph API User.ReadBasic.All (Application 권한) 사용
 * client_credentials 플로우로 토큰 발급 → /users $search 호출
 *
 * ⚠️ User.ReadBasic.All 한계:
 *   - accountEnabled 필드 미반환 → 코드 레벨 필터링 불가 (User.Read.All 필요)
 *   - department 필드 미반환 → dept 빈 값 (User.Read.All 필요)
 *   - 현재는 이름/이메일 기반 검색만 가능
 *
 * ⚠️ Graph API 제약:
 *   - $search와 $filter는 동시 사용 불가 → $filter 제거, 코드 레벨로 처리
 */

const TENANT_ID     = Deno.env.get('AZURE_TENANT_ID')     ?? ''
const CLIENT_ID     = Deno.env.get('AZURE_CLIENT_ID')     ?? ''
const CLIENT_SECRET = Deno.env.get('AZURE_CLIENT_SECRET') ?? ''

// ── 모듈 레벨 토큰 캐시 (같은 warm instance 재사용) ─────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null

async function getGraphToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < cachedToken.expiresAt - 60_000) {
    return cachedToken.token
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph 토큰 발급 실패: ${text}`)
  }
  const data = await res.json()
  cachedToken = {
    token:     data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }
  return cachedToken.token
}

// ── CORS 헤더 ────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  try {
    const { query, excludeId } = await req.json() as { query: string; excludeId?: string }

    // 1글자 미만 검색 차단
    if (!query || query.trim().length < 1) {
      return new Response(JSON.stringify({ users: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const q     = query.trim()
    const token = await getGraphToken()

    // ⚠️ $search와 $filter 동시 사용 불가 → $filter 제거
    // accountEnabled 필터링은 코드 레벨에서 처리
    // User.ReadBasic.All: displayName, givenName, mail, photo, surname, userPrincipalName 만 반환
    // User.Read.All 승인 시: department, accountEnabled 추가 가능
    const searchUrl = new URL('https://graph.microsoft.com/v1.0/users')
    searchUrl.searchParams.set(
      '$search',
      `"displayName:${q}" OR "mail:${q}"`
    )
    searchUrl.searchParams.set(
      '$select',
      'id,displayName,mail,department,userPrincipalName,accountEnabled'
    )
    searchUrl.searchParams.set('$top', '15')  // 필터링 후 8개 확보용
    searchUrl.searchParams.set('$count', 'true')

    const graphRes = await fetch(searchUrl.toString(), {
      headers: {
        Authorization:    `Bearer ${token}`,
        ConsistencyLevel: 'eventual',  // $search 사용 시 필수
      },
    })

    if (!graphRes.ok) {
      const text = await graphRes.text()
      console.error('[search-users] Graph API 오류:', text)
      return new Response(JSON.stringify({ users: [], error: 'Graph API 오류' }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const graphData = await graphRes.json()
    const rawUsers: any[] = graphData.value ?? []

    // AppUser 형태로 매핑
    // accountEnabled: User.ReadBasic.All에서는 null 반환 → 필터링 스킵
    //                 User.Read.All 승인 시 false인 퇴사자 자동 제외
    const users = rawUsers
      .filter(u => u.id !== excludeId)
      .filter(u => u.accountEnabled !== false)  // null(ReadBasic)이면 통과, false(Read.All)면 제외
      .map(u => ({
        user_id:     u.id,
        employee_id: u.userPrincipalName ?? '',
        name:        u.displayName       ?? '',
        dept:        u.department        ?? '',  // ReadBasic: 빈 값, Read.All: 실제 부서
        role:        'USER' as const,
        email:       u.mail ?? u.userPrincipalName ?? '',
      }))
      .filter(u => u.name && u.email)  // 이름/이메일 없는 계정 제외
      .slice(0, 8)

    return new Response(JSON.stringify({ users }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[search-users] 오류:', err)
    return new Response(JSON.stringify({ users: [], error: String(err) }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
