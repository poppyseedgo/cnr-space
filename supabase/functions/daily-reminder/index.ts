// @ts-nocheck
/**
 * daily-reminder Edge Function
 * 매일 아침 07:00 KST에 당일 예약자 + 참석자에게 리마인더 발송
 *
 * ✅ 수정 내역 (2025-04-13):
 *   - APP_URL 기본값 cnr-space.pages.dev로 수정
 *   - booking_attendees 조인 추가 → 참석자에게도 리마인더 발송
 *
 * Cron: '0 22 * * *'  (UTC 22:00 = KST 07:00)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'C&R SPACE <onboarding@resend.dev>'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'

function fmtTime(ts: string): string {
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

function makeReminderHtml(b: any, recipientName: string, isAttendee: boolean): string {
  const startStr = fmtTime(b.start_at)
  const endStr   = fmtTime(b.end_at)
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#4F46E5;padding:24px 32px;">
          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);">오늘의 예약 리마인더</p>
          <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#fff;">C&amp;R SPACE</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <p style="margin:0 0 4px;font-size:14px;color:#6B7280;">안녕하세요, ${recipientName}님${isAttendee ? ' (참석자)' : ''} 👋</p>
          <p style="margin:0 0 20px;font-size:14px;color:#374151;">오늘 ${isAttendee ? '참석 예정인' : '예약된'} 회의가 있습니다.</p>
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
            <tr><td style="padding:5px 0;">
              <span style="display:inline-block;width:64px;font-size:12px;color:#6B7280;font-weight:600;">예약자</span>
              <span style="font-size:13px;color:#111;">${b.user_name}</span>
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
          <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">C&R SPACE 자동 발송</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
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

    // 오늘 예약 전체 조회 + 참석자 조인
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(email, name), booking_attendees(email, name)')
      .gte('start_at', `${todayKST}T00:00:00+09:00`)
      .lte('start_at', `${todayKST}T23:59:59+09:00`)
      .eq('auto_cancelled', false)
      .eq('early_ended', false)
      .order('start_at', { ascending: true })

    if (error) throw error
    if (!bookings || bookings.length === 0) {
      return new Response(JSON.stringify({ message: '오늘 예약 없음', date: todayKST }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    let sentCount = 0
    for (const b of bookings) {
      const userEmail = b.profiles?.email
      const userName  = b.profiles?.name ?? b.user_name
      if (!userEmail) continue

      const subject = `[C&R SPACE] 📅 오늘 예약 리마인더 — ${b.title}`

      // 예약자에게 발송
      await sendEmail([userEmail], subject, makeReminderHtml(b, userName, false))
      sentCount++

      // 참석자에게 발송 (booking_attendees 테이블)
      const attendeeEmails = (b.booking_attendees ?? [])
        .map((a: any) => a.email)
        .filter((e: string) => e && e !== userEmail)

      if (attendeeEmails.length > 0) {
        // 참석자는 이름 대신 "참석자"로 표시 (개인화 발송은 별도 루프)
        for (const att of b.booking_attendees ?? []) {
          if (!att.email || att.email === userEmail) continue
          const attName = att.name ?? '참석자'
          await sendEmail([att.email], subject, makeReminderHtml(b, attName, true))
          sentCount++
        }
      }
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
