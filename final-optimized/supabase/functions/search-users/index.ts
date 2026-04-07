// @ts-nocheck
/**
 * search-users Edge Function
 * Microsoft Graph API User.ReadBasic.All (Application 권한) 사용
 * client_credentials 플로우로 토큰 발급 → /users $search 호출
 */

const TENANT_ID     = Deno.env.get('AZURE_TENANT_ID')     ?? ''
const CLIENT_ID     = Deno.env.get('AZURE_CLIENT_ID')     ?? ''
const CLIENT_SECRET = Deno.env.get('AZURE_CLIENT_SECRET') ?? ''

let cachedToken: { token: string; expiresAt: number } | null = null

async function getGraphToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < cachedToken.expiresAt - 60_000) return cachedToken.token
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
  if (!res.ok) throw new Error(`Graph 토큰 발급 실패: ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return cachedToken.token
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { query, excludeEmail } = await req.json()

    if (!query || query.trim().length < 1) {
      return new Response(JSON.stringify({ users: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const q = query.trim()
    const token = await getGraphToken()

    // $filter 와 $search 동시 사용 불가 → $search 만 사용
    const searchUrl = new URL('https://graph.microsoft.com/v1.0/users')
    searchUrl.searchParams.set('$search', `"displayName:${q}"`)
    searchUrl.searchParams.set('$select', 'id,displayName,mail,department,userPrincipalName')
    searchUrl.searchParams.set('$top', '10')
    searchUrl.searchParams.set('$count', 'true')

    const graphRes = await fetch(searchUrl.toString(), {
      headers: {
        Authorization:    `Bearer ${token}`,
        ConsistencyLevel: 'eventual',
      },
    })

    if (!graphRes.ok) {
      const text = await graphRes.text()
      console.error('[search-users] Graph API 오류:', text)
      return new Response(JSON.stringify({ users: [], error: text }), {
        status: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    const graphData = await graphRes.json()
    const rawUsers = graphData.value ?? []

    const users = rawUsers
      // Supabase UUID ≠ Azure AD Object ID → 이메일로 본인 제외
      .filter(u => {
        const email = (u.mail ?? u.userPrincipalName ?? '').toLowerCase()
        return email !== (excludeEmail ?? '').toLowerCase()
      })
      .map(u => ({
        user_id:     u.id,
        employee_id: u.userPrincipalName ?? '',
        name:        u.displayName       ?? '',
        dept:        u.department        ?? '',
        role:        'USER',
        email:       u.mail ?? u.userPrincipalName ?? '',
      }))
      .filter(u => u.name && u.email)
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
