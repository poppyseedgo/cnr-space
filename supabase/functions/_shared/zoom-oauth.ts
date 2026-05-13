// @ts-nocheck
/**
 * zoom-oauth.ts (shared)
 *
 * Zoom Server-to-Server OAuth 토큰 관리.
 * - 마스터 어카운트 1개 자격증명 (환경변수 ZOOM_ACCOUNT_ID/CLIENT_ID/CLIENT_SECRET)
 * - 토큰 1시간 유효 → zoom_oauth_token 싱글톤 테이블에 캐싱
 * - 만료 5분 전부터 자동 갱신
 *
 * 사용 예시:
 *   const token = await getZoomAccessToken(SUPABASE_URL, SERVICE_KEY)
 *   const res = await fetch('https://api.zoom.us/v2/...', {
 *     headers: { Authorization: `Bearer ${token}` }
 *   })
 */

const ZOOM_OAUTH_URL = 'https://zoom.us/oauth/token'
const REFRESH_BUFFER_MS = 5 * 60 * 1000  // 만료 5분 전부터 갱신
const FALLBACK_TTL_SECONDS = 3600        // Zoom 응답에 expires_in 없을 때 fallback

export async function getZoomAccessToken(
  supabaseUrl: string,
  serviceKey: string
): Promise<string> {
  const sbHeaders = {
    'apikey':        serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type':  'application/json',
  }

  // ── 1. 캐시된 토큰 조회 ────────────────────────────────────────
  const cacheRes = await fetch(
    `${supabaseUrl}/rest/v1/zoom_oauth_token?id=eq.1&select=access_token,expires_at`,
    { headers: sbHeaders }
  )

  if (cacheRes.ok) {
    const rows = await cacheRes.json()
    if (rows.length > 0) {
      const expiresAt = new Date(rows[0].expires_at).getTime()
      const now = Date.now()
      // 만료 5분 전까지는 캐시 사용
      if (expiresAt - now > REFRESH_BUFFER_MS) {
        return rows[0].access_token
      }
    }
  } else {
    // 캐시 읽기 실패는 치명적이지 않음 - 새로 발급으로 fallback
    console.warn('[zoom-oauth] cache read failed, will request new token:', await cacheRes.text())
  }

  // ── 2. Zoom OAuth 엔드포인트에서 새 토큰 발급 ──────────────────
  const accountId    = Deno.env.get('ZOOM_ACCOUNT_ID')    ?? ''
  const clientId     = Deno.env.get('ZOOM_CLIENT_ID')     ?? ''
  const clientSecret = Deno.env.get('ZOOM_CLIENT_SECRET') ?? ''

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('[zoom-oauth] ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET not configured')
  }

  const basicAuth = btoa(`${clientId}:${clientSecret}`)
  const tokenRes = await fetch(
    `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      }
    }
  )

  if (!tokenRes.ok) {
    const errText = await tokenRes.text()
    throw new Error(`[zoom-oauth] Token request failed (${tokenRes.status}): ${errText}`)
  }

  const tokenData = await tokenRes.json()
  const accessToken = tokenData.access_token
  const expiresIn   = tokenData.expires_in ?? FALLBACK_TTL_SECONDS

  if (!accessToken) {
    throw new Error('[zoom-oauth] No access_token in Zoom response')
  }

  // ── 3. 캐시 UPSERT (싱글톤 id=1) ──────────────────────────────
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresIn * 1000)

  const upsertRes = await fetch(
    `${supabaseUrl}/rest/v1/zoom_oauth_token?on_conflict=id`,
    {
      method: 'POST',
      headers: {
        ...sbHeaders,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        id:           1,
        access_token: accessToken,
        expires_at:   expiresAt.toISOString(),
        refreshed_at: now.toISOString(),
      })
    }
  )

  if (!upsertRes.ok) {
    // 캐시 저장 실패해도 토큰은 사용 가능 - 다음 호출에서 다시 발급될 뿐
    console.warn('[zoom-oauth] cache UPSERT failed:', await upsertRes.text())
  }

  return accessToken
}
