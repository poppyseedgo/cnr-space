// @ts-nocheck
/**
 * Microsoft Teams DM 발송 — Graph API
 * client_credentials flow (Application 권한)
 *
 * 환경변수:
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'

/** 액세스 토큰 발급 (client_credentials) */
async function getAccessToken(): Promise<string> {
  const tenantId     = Deno.env.get('AZURE_TENANT_ID')     ?? ''
  const clientId     = Deno.env.get('AZURE_CLIENT_ID')     ?? ''
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET') ?? ''

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure 환경변수 미설정 (AZURE_TENANT_ID / CLIENT_ID / CLIENT_SECRET)')
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  )

  const data = await res.json()
  if (!res.ok) throw new Error(`토큰 발급 실패: ${data.error_description ?? data.error}`)
  return data.access_token
}

/** 이메일로 MS user_id 조회 */
async function getUserId(email: string, token: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(email)}?$select=id`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return null
  const data = await res.json()
  return data.id ?? null
}

/** Bot ↔ 사용자 1:1 채팅 생성 (이미 있으면 기존 반환) */
async function getOrCreateChat(
  botUserId: string,
  targetUserId: string,
  token: string
): Promise<string | null> {
  const res = await fetch(`${GRAPH}/chats`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${botUserId}`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users/${targetUserId}`,
        },
      ],
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    console.warn('[Teams] 채팅 생성 실패:', data)
    return null
  }
  return data.id
}

/** Teams DM 메시지 발송 */
async function sendMessage(chatId: string, content: string, token: string): Promise<boolean> {
  const res = await fetch(`${GRAPH}/chats/${chatId}/messages`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: { contentType: 'html', content },
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    console.warn('[Teams] 메시지 발송 실패:', err)
    return false
  }
  return true
}

/** Bot 자신의 user_id 조회 */
async function getBotUserId(token: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/me?$select=id`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  // client_credentials는 /me 미지원 → app ID 기반 서비스 계정 email 사용
  // 환경변수 BOT_USER_EMAIL로 지정
  const botEmail = Deno.env.get('AZURE_BOT_EMAIL') ?? ''
  if (botEmail) return getUserId(botEmail, token)
  return null
}

/**
 * Teams DM 1건 발송
 * @param recipientEmail  수신자 이메일
 * @param htmlContent     HTML 메시지 본문
 */
export async function sendTeamsDM(
  recipientEmail: string,
  htmlContent: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token       = await getAccessToken()
    const botUserId   = await getBotUserId(token)
    const targetId    = await getUserId(recipientEmail, token)

    if (!botUserId)  return { ok: false, error: 'Bot user_id 조회 실패 — AZURE_BOT_EMAIL 확인' }
    if (!targetId)   return { ok: false, error: `수신자 미발견: ${recipientEmail}` }

    const chatId = await getOrCreateChat(botUserId, targetId, token)
    if (!chatId)     return { ok: false, error: '채팅 생성 실패' }

    const ok = await sendMessage(chatId, htmlContent, token)
    return { ok }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

/**
 * Teams DM 일괄 발송 (여러 수신자)
 */
export async function sendTeamsDMBatch(
  emails: string[],
  htmlContent: string
): Promise<void> {
  if (!emails.length) return
  // 토큰은 한 번만 발급
  let token: string
  let botUserId: string | null
  try {
    token     = await getAccessToken()
    botUserId = await getBotUserId(token)
    if (!botUserId) { console.warn('[Teams] Bot user_id 없음'); return }
  } catch (e) {
    console.warn('[Teams] 토큰 발급 실패:', e); return
  }

  // 순차 발송 (rate limit 대비 50ms 간격)
  for (const email of emails) {
    try {
      const targetId = await getUserId(email, token)
      if (!targetId) { console.warn('[Teams] 사용자 미발견:', email); continue }
      const chatId = await getOrCreateChat(botUserId, targetId, token)
      if (!chatId) { console.warn('[Teams] 채팅 생성 실패:', email); continue }
      await sendMessage(chatId, htmlContent, token)
      await new Promise(r => setTimeout(r, 50))
    } catch (e) {
      console.warn('[Teams] 발송 실패:', email, e)
    }
  }
}
