// @ts-nocheck
/**
 * sync-azure-users — 퇴사자 자동 비활성화 Edge Function
 *
 * Cron: 매일 오전 9시 KST (00:00 UTC)
 *   supabase/config.toml:
 *   [functions.sync-azure-users]
 *   schedule = "0 0 * * *"
 *
 * 동작:
 *   1. Azure AD 전체 사용자 목록 조회 (User.Read.All)
 *   2. Supabase profiles 테이블과 비교
 *   3. accountEnabled=false → 해당 사용자 접근 차단 + 향후 예약 취소
 *   4. 관리자에게 Teams DM 알림
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTeamsDM } from '../send-notification/teams.ts'

const GRAPH = 'https://graph.microsoft.com/v1.0'

async function getAccessToken(): Promise<string> {
  const tenantId     = Deno.env.get('AZURE_TENANT_ID')     ?? ''
  const clientId     = Deno.env.get('AZURE_CLIENT_ID')     ?? ''
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET') ?? ''

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`토큰 발급 실패: ${data.error_description}`)
  return data.access_token
}

/** Azure AD 전체 사용자 조회 (페이징 처리) */
async function getAllAzureUsers(token: string): Promise<any[]> {
  const users: any[] = []
  let url = `${GRAPH}/users?$select=id,userPrincipalName,displayName,accountEnabled&$top=999`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (data.value) users.push(...data.value)
    url = data['@odata.nextLink'] ?? null  // 페이징
  }

  return users
}

/** KST 날짜 포맷 */
function fmtKST(ts: string): string {
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${kst.getUTCFullYear()}.${String(kst.getUTCMonth()+1).padStart(2,'0')}.${String(kst.getUTCDate()).padStart(2,'0')} ${String(kst.getUTCHours()).padStart(2,'0')}:${String(kst.getUTCMinutes()).padStart(2,'0')}`
}

Deno.serve(async () => {
  const corsHeaders = { 'Content-Type': 'application/json' }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── 1. Azure AD 토큰 발급 ──────────────────────────────────────
    const token = await getAccessToken()
    console.log('[sync-azure] 토큰 발급 완료')

    // ── 2. Azure AD 전체 사용자 조회 ──────────────────────────────
    const azureUsers  = await getAllAzureUsers(token)
    const azureMap    = new Map(azureUsers.map(u => [u.userPrincipalName.toLowerCase(), u]))
    console.log(`[sync-azure] Azure 사용자 ${azureUsers.length}명 조회`)

    // ── 3. Supabase profiles 조회 (azure_user_id 있는 사용자만) ───
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, name, role, is_active')
      .not('email', 'is', null)

    if (!profiles?.length) {
      return new Response(JSON.stringify({ message: '프로필 없음' }), { headers: corsHeaders })
    }

    const deactivated: any[] = []

    for (const profile of profiles) {
      const email  = profile.email?.toLowerCase()
      const azUser = azureMap.get(email)

      // Azure에 없거나 비활성화된 계정
      if (!azUser || azUser.accountEnabled === false) {
        // 이미 비활성화된 경우 스킵
        if (profile.is_active === false) continue

        console.log(`[sync-azure] 비활성화 감지: ${profile.email}`)

        // ── 3-1. profiles is_active = false ──────────────────────
        await supabase
          .from('profiles')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', profile.id)

        // ── 3-2. Supabase Auth 계정 차단 (로그인 불가) ────────────
        await supabase.auth.admin.updateUserById(profile.id, { ban_duration: 'none' })
        // 참고: ban_duration='none'은 무기한 차단

        // ── 3-3. 향후 예약 자동 취소 ─────────────────────────────
        const now = new Date().toISOString()
        const { data: futureBookings } = await supabase
          .from('bookings')
          .select('id, title, start_at, room_id')
          .eq('user_id', profile.id)
          .gt('start_at', now)
          .eq('auto_cancelled', false)
          .eq('early_ended', false)

        const cancelledBookings = futureBookings ?? []
        if (cancelledBookings.length > 0) {
          await supabase
            .from('bookings')
            .update({
              auto_cancelled: true,
              cancelled_by:   'system',
            })
            .in('id', cancelledBookings.map(b => b.id))
        }

        deactivated.push({
          ...profile,
          cancelledCount: cancelledBookings.length,
        })
      }
    }

    // ── 4. 관리자에게 Teams DM 알림 ────────────────────────────────
    if (deactivated.length > 0) {
      // 관리자 이메일 조회
      const { data: admins } = await supabase
        .from('profiles')
        .select('email')
        .eq('role', 'ADMIN')
        .eq('is_active', true)

      const adminEmails = (admins ?? []).map(a => a.email).filter(Boolean)

      const teamsHtml = `
<div style="font-family:sans-serif;max-width:480px">
  <div style="background:#DC2626;padding:14px 18px;border-radius:8px 8px 0 0">
    <span style="font-size:16px;font-weight:700;color:#fff">🔒 퇴사자 계정 자동 비활성화 처리</span>
  </div>
  <div style="border:1px solid #E2E8F0;border-top:none;padding:16px 18px;border-radius:0 0 8px 8px">
    <p style="font-size:13px;color:#374151;margin:0 0 12px">
      아래 ${deactivated.length}개 계정이 Azure AD에서 비활성화되어 자동 처리되었습니다.
    </p>
    ${deactivated.map(u => `
      <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-radius:6px;padding:10px 12px;margin-bottom:8px">
        <div style="font-weight:700;color:#991B1B">${u.name} (${u.email})</div>
        <div style="font-size:12px;color:#6B7280;margin-top:2px">
          향후 예약 ${u.cancelledCount}건 자동 취소 완료
        </div>
      </div>
    `).join('')}
    <a href="${Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'}/admin"
       style="display:inline-block;background:#111;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;margin-top:8px">
      관리자 페이지 열기 →
    </a>
  </div>
</div>`

      for (const adminEmail of adminEmails) {
        await sendTeamsDM(adminEmail, teamsHtml).catch(e =>
          console.warn('[sync-azure] 관리자 Teams DM 실패:', e)
        )
      }
    }

    console.log(`[sync-azure] 완료 — 비활성화 ${deactivated.length}건`)
    return new Response(
      JSON.stringify({
        success:     true,
        checked:     profiles.length,
        deactivated: deactivated.length,
        accounts:    deactivated.map(u => u.email),
      }),
      { headers: corsHeaders }
    )

  } catch (err: any) {
    console.error('[sync-azure] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
