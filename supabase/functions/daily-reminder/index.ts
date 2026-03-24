// @ts-nocheck
/**
 * daily-reminder Edge Function
 * 매일 아침 07:00 KST에 당일 예약자 + 참석자에게 리마인더 발송
 *
 * Cron: '0 22 * * *'  (UTC 22:00 = KST 07:00)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = 'C&R Booking <onboarding@resend.dev>'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://cnr-booking.vercel.app'

function utcToKST(ts: string): string {
  const d = new Date(ts)
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const h = k.getUTCHours()
  const period = h < 12 ? '오전' : '오후'
  const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${period} ${hour}:${p(k.getUTCMinutes())}`
}

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY || to.length === 0) return
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // 오늘 날짜 (KST)
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    const todayKST = `${nowKST.getUTCFullYear()}-${p(nowKST.getUTCMonth()+1)}-${p(nowKST.getUTCDate())}`

    // 오늘 예약 전체 조회
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(email, name)')
      .gte('start_at', `${todayKST}T00:00:00+09:00`)
      .lte('start_at', `${todayKST}T23:59:59+09:00`)
      .eq('auto_cancelled', false)
      .eq('early_ended', false)
      .order('start_at', { ascending: true })

    if (error) throw error
    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ message: '오늘 예약 없음' }), { headers: { 'Content-Type': 'application/json' } })
    }

    let sentCount = 0
    for (const b of bookings) {
      const userEmail = b.profiles?.email
      if (!userEmail) continue

      const subject = `[C&R Booking] 📅 오늘 예약 리마인더 — ${b.title}`
      const startStr = utcToKST(b.start_at)
      const endStr   = utcToKST(b.end_at)

      const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#4F46E5;padding:24px 32px;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);">오늘의 예약 리마인더</p>
          <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#fff;">C&amp;R Booking Room</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">안녕하세요, ${b.profiles?.name ?? b.user_name}님 👋</p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;">오늘 예약된 회의가 있습니다.</p>
          <table width="100%" style="background:#F8FAFC;border-radius:12px;padding:16px 20px;">
            <tr><td style="padding:5px 0;">
              <span style="display:inline-block;width:64px;font-size:12px;color:#6B7280;font-weight:600;">회의명</span>
              <span style="font-size:13px;color:#111;font-weight:600;">${b.title}</span>
            </td></tr>
            <tr><td style="padding:5px 0;">
              <span style="display:inline-block;width:64px;font-size:12px;color:#6B7280;font-weight:600;">시간</span>
              <span style="font-size:13px;color:#111;">${startStr} – ${endStr}</span>
            </td></tr>
            <tr><td style="padding:5px 0;">
              <span style="display:inline-block;width:64px;font-size:12px;color:#6B7280;font-weight:600;">회의실</span>
              <span style="font-size:13px;color:#111;">${b.room_name ?? b.room_id + 'F'}</span>
            </td></tr>
          </table>
          <div style="margin:20px 0 0;padding:12px 16px;background:#EEF2FF;border-radius:10px;">
            <p style="margin:0;font-size:12px;color:#4338CA;font-weight:600;">💡 예약 시작 10분 전부터 체크인이 가능합니다.</p>
            <p style="margin:4px 0 0;font-size:12px;color:#6366F1;">체크인하지 않으면 시작 10분 후 자동 취소됩니다.</p>
          </div>
          <div style="margin:20px 0 0;text-align:center;">
            <a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:11px 24px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">
              체크인하러 가기 →
            </a>
          </div>
        </td></tr>
        <tr><td style="padding:14px 32px 20px;border-top:1px solid #F1F5F9;">
          <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">CNR Research 회의실 예약 시스템 자동 발송</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`

      await sendEmail([userEmail], subject, html)
      sentCount++
    }

    return new Response(
      JSON.stringify({ success: true, date: todayKST, sent: sentCount }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[daily-reminder] 오류:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
