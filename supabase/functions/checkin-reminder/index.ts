// @ts-nocheck
/**
 * checkin-reminder Edge Function
 *
 * 세 가지 알림을 매 분 체크:
 *   ① 예약 시작 10분 전  → 알림만 발송 (체크인 버튼 없음)
 *   ② 예약 시작 시각     → "체크인 하러가기" 버튼 포함 알림
 *   ③ 예약 시작 후 5분   → "5분 후 자동취소" 경고
 *
 * Cron: '* * * * *' (매 분)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTeamsDM, sendTeamsDMBatch } from '../send-notification/teams.ts'

const AZURE_ENABLED = !!(
  Deno.env.get('AZURE_TENANT_ID') &&
  Deno.env.get('AZURE_CLIENT_ID') &&
  Deno.env.get('AZURE_CLIENT_SECRET')
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = 'C&R SPACE <onboarding@resend.dev>'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://cnr-space.vercel.app'

/** notifications 테이블에 인앱 알림 insert */
async function insertNotification(supabase: any, params: {
  userId: string, type: string, title: string, body?: string, bookingId?: string
}) {
  const { error } = await supabase.from('notifications').insert({
    user_id:    params.userId,
    type:       params.type,
    title:      params.title,
    body:       params.body ?? null,
    booking_id: params.bookingId ?? null,
    is_read:    false,
  })
  if (error) console.warn('[checkin-reminder] 인앱 알림 저장 실패:', error.message)
}


/** Teams DM 메시지 HTML — 리마인더용 */
function makeTeamsHtml(type: '10min' | 'start' | '5min', b: any): string {
  const APP = Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'
  const icons = { '10min': '⏰', start: '🟢', '5min': '⚠️' }
  const titles = {
    '10min': '10분 후 회의가 시작됩니다',
    start:   '회의가 시작되었습니다. 체크인해 주세요!',
    '5min':  '5분 후 자동취소 예정 — 지금 바로 체크인하세요!',
  }
  const colors = { '10min': '#0891B2', start: '#16A34A', '5min': '#DC2626' }
  const icon = icons[type], title = titles[type], color = colors[type]
  const start = fmtTime(b.start_at), end = fmtTime(b.end_at)
  return `
<div style="font-family:sans-serif;max-width:480px">
  <div style="background:${color};padding:14px 18px;border-radius:8px 8px 0 0">
    <span style="font-size:16px;font-weight:700;color:#fff">${icon} ${title}</span>
  </div>
  <div style="border:1px solid #E2E8F0;border-top:none;padding:16px 18px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
      <tr><td style="padding:3px 0;color:#94A3B8;width:70px">회의</td><td style="font-weight:600">${b.title}</td></tr>
      <tr><td style="padding:3px 0;color:#94A3B8">회의실</td><td>${b.rooms?.room_name ?? ''}</td></tr>
      <tr><td style="padding:3px 0;color:#94A3B8">시간</td><td>${start} ~ ${end}</td></tr>
    </table>
    <a href="${APP}" style="display:inline-block;background:#111;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;margin-top:12px">
      체크인하러 가기 →
    </a>
  </div>
</div>`
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

function fmtTime(ts: string): string {
  const d = new Date(ts)
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  const h = k.getUTCHours()
  return `${h < 12 ? '오전' : '오후'} ${h === 0 ? 12 : h > 12 ? h - 12 : h}:${p(k.getUTCMinutes())}`
}

// ── ① 10분 전 알림 — 체크인 버튼 없음 ─────────────────────────────────────
function makeBefore10Html(b: any, recipientName: string, isAttendee: boolean): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:500px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr><td style="background:#0891B2;padding:22px 28px;">
        <p style="margin:0;font-size:19px;font-weight:700;color:#fff;">⏰ 10분 후 시작합니다</p>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">C&amp;R SPACE</p>
      </td></tr>
      <tr><td style="padding:22px 28px;">
        <p style="margin:0 0 4px;font-size:13px;color:#6B7280;">안녕하세요, ${recipientName}님${isAttendee ? ' (참석자)' : ''} 👋</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;font-weight:600;">${b.title}</p>
        <table width="100%" style="background:#F0F9FF;border-radius:10px;padding:14px 18px;">
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">시작</span>
            <span style="font-size:13px;color:#0E7490;font-weight:700;">${fmtTime(b.start_at)}</span>
          </td></tr>
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">종료</span>
            <span style="font-size:13px;color:#111;">${fmtTime(b.end_at)}</span>
          </td></tr>
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">회의실</span>
            <span style="font-size:13px;color:#111;">${b.room_name ?? b.room_id + 'F'}</span>
          </td></tr>
        </table>
        <div style="margin:16px 0 0;padding:12px 14px;background:#F0F9FF;border-radius:8px;border-left:3px solid #0891B2;">
          <p style="margin:0;font-size:12px;color:#075985;font-weight:600;">💡 예약 시작 시각에 체크인 알림이 별도로 발송됩니다.</p>
          <p style="margin:5px 0 0;font-size:12px;color:#0369A1;">시작 후 10분 내 체크인하지 않으면 자동 취소됩니다.</p>
        </div>
      </td></tr>
      <tr><td style="padding:14px 28px 18px;border-top:1px solid #F1F5F9;">
        <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">C&R SPACE 자동 발송</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

// ── ② 예약 시작 시각 알림 — 체크인 버튼 포함 ──────────────────────────────
function makeStartHtml(b: any, recipientName: string, isAttendee: boolean): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:500px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr><td style="background:#16A34A;padding:22px 28px;">
        <p style="margin:0;font-size:19px;font-weight:700;color:#fff;">🟢 회의 시작! 체크인해 주세요</p>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">C&amp;R SPACE</p>
      </td></tr>
      <tr><td style="padding:22px 28px;">
        <p style="margin:0 0 4px;font-size:13px;color:#6B7280;">안녕하세요, ${recipientName}님${isAttendee ? ' (참석자)' : ''} 👋</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;font-weight:600;">${b.title}</p>
        <table width="100%" style="background:#F0FDF4;border-radius:10px;padding:14px 18px;">
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">시작</span>
            <span style="font-size:13px;color:#16A34A;font-weight:700;">${fmtTime(b.start_at)}</span>
          </td></tr>
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">종료</span>
            <span style="font-size:13px;color:#111;">${fmtTime(b.end_at)}</span>
          </td></tr>
          <tr><td style="padding:5px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">회의실</span>
            <span style="font-size:13px;color:#111;">${b.room_name ?? b.room_id + 'F'}</span>
          </td></tr>
        </table>
        <div style="margin:16px 0 0;padding:12px 14px;background:#FEF9C3;border-radius:8px;border-left:3px solid #EAB308;">
          <p style="margin:0;font-size:12px;color:#854D0E;font-weight:600;">⚠️ 지금 바로 체크인해 주세요</p>
          <p style="margin:5px 0 0;font-size:12px;color:#A16207;">10분 내 체크인하지 않으면 예약이 자동 취소됩니다.</p>
        </div>
        <div style="margin:18px 0 0;text-align:center;">
          <a href="${APP_URL}" style="display:inline-block;background:#16A34A;color:#fff;padding:13px 32px;border-radius:10px;text-decoration:none;font-size:14px;font-weight:700;">
            체크인 하러가기 →
          </a>
        </div>
      </td></tr>
      <tr><td style="padding:14px 28px 18px;border-top:1px solid #F1F5F9;">
        <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">C&R SPACE 자동 발송</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

// ── ③ 시작 후 5분 경고 — 자동취소 임박 ────────────────────────────────────
function makeAfter5Html(b: any, recipientName: string, isAttendee: boolean): string {
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:500px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
      <tr><td style="background:#DC2626;padding:22px 28px;">
        <p style="margin:0;font-size:19px;font-weight:700;color:#fff;">⚠️ 5분 후 자동 취소됩니다</p>
        <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">C&amp;R SPACE</p>
      </td></tr>
      <tr><td style="padding:22px 28px;">
        <p style="margin:0 0 4px;font-size:13px;color:#6B7280;">안녕하세요, ${recipientName}님${isAttendee ? ' (참석자)' : ''}</p>
        <p style="margin:0 0 18px;font-size:14px;color:#374151;font-weight:600;">${b.title}</p>
        <div style="margin:0 0 16px;padding:14px 16px;background:#FEF2F2;border-radius:10px;border:1.5px solid #FECACA;">
          <p style="margin:0;font-size:14px;color:#991B1B;font-weight:700;">아직 체크인이 완료되지 않았습니다!</p>
          <p style="margin:6px 0 0;font-size:13px;color:#DC2626;">지금 바로 체크인하지 않으면 <strong>5분 후 예약이 자동 취소</strong>됩니다.</p>
        </div>
        <table width="100%" style="background:#F8FAFC;border-radius:10px;padding:12px 16px;">
          <tr><td style="padding:4px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">시작</span>
            <span style="font-size:13px;color:#111;">${fmtTime(b.start_at)}</span>
          </td></tr>
          <tr><td style="padding:4px 0;">
            <span style="font-size:12px;color:#6B7280;display:inline-block;width:60px;font-weight:600;">회의실</span>
            <span style="font-size:13px;color:#111;">${b.room_name ?? b.room_id + 'F'}</span>
          </td></tr>
        </table>
        <div style="margin:16px 0 0;text-align:center;">
          <a href="${APP_URL}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 28px;border-radius:9px;text-decoration:none;font-size:14px;font-weight:700;">
            지금 바로 체크인하기 →
          </a>
        </div>
      </td></tr>
      <tr><td style="padding:14px 28px 18px;border-top:1px solid #F1F5F9;">
        <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">C&R SPACE 자동 발송</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

// ── 메인 핸들러 ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const now = new Date()
    let totalSent = 0

    // ── ① 예약 시작 10분 전 알림 (버튼 없음) ───────────────────────────
    const before10 = new Date(now.getTime() + 10 * 60 * 1000)
    const { data: upcoming } = await supabase
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(email, name), rooms(room_name)')
      .gte('start_at', new Date(before10.getTime() - 30000).toISOString())
      .lte('start_at', new Date(before10.getTime() + 30000).toISOString())
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .eq('checked_in',     false)

    for (const b of upcoming ?? []) {
      const userEmail = b.profiles?.email
      const userName  = b.profiles?.name ?? b.user_name
      const roomName  = (b.rooms as any)?.room_name ?? ''
      // 이메일 발송 (이메일 있을 때만)
      if (userEmail) {
        await sendEmail([userEmail], `[C&R SPACE] ⏰ 10분 후 시작 — ${b.title}`, makeBefore10Html(b, userName, false))
        totalSent++
      }
      // 인앱 알림
      if (b.user_id) {
        await insertNotification(supabase, {
          userId: b.user_id, type: 'checkin_reminder_10',
          title: '10분 후 회의가 시작됩니다',
          body: `${b.title} · ${roomName} · ${fmtTime(b.start_at)}`,
          bookingId: b.id,
        })
      }
      // Teams DM — 예약자 + 참석자
      if (AZURE_ENABLED) {
        const teamsHtml = makeTeamsHtml('10min', b)
        const allEmails = [userEmail, ...(b.attendees ?? [])].filter(Boolean)
        sendTeamsDMBatch(allEmails, teamsHtml).catch(() => {})
      }
      if (b.attendees?.length > 0) {
        const attendeeEmails = b.attendees.filter((e: string) => e !== userEmail)
        if (attendeeEmails.length > 0) {
          await sendEmail(attendeeEmails, `[C&R SPACE] ⏰ 10분 후 시작 — ${b.title}`, makeBefore10Html(b, '참석자', true))
          totalSent++
        }
      }
    }

    // ── ② 예약 시작 시각 알림 (체크인 버튼 포함) ───────────────────────
    const { data: justStarted } = await supabase
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(email, name), rooms(room_name)')
      .gte('start_at', new Date(now.getTime() - 30000).toISOString())
      .lte('start_at', new Date(now.getTime() + 30000).toISOString())
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .eq('checked_in',     false)

    for (const b of justStarted ?? []) {
      const userEmail = b.profiles?.email
      const userName  = b.profiles?.name ?? b.user_name
      const roomName  = (b.rooms as any)?.room_name ?? ''
      if (userEmail) {
        await sendEmail([userEmail], `[C&R SPACE] 🟢 회의 시작! 체크인해 주세요 — ${b.title}`, makeStartHtml(b, userName, false))
        totalSent++
      }
      if (b.user_id) {
        await insertNotification(supabase, {
          userId: b.user_id, type: 'checkin_required',
          title: '회의가 시작되었습니다. 체크인해 주세요!',
          body: `${b.title} · ${roomName} · ${fmtTime(b.start_at)}`,
          bookingId: b.id,
        })
      }
      if (AZURE_ENABLED) {
        const teamsHtml = makeTeamsHtml('start', b)
        const allEmails = [userEmail, ...(b.attendees ?? [])].filter(Boolean)
        sendTeamsDMBatch(allEmails, teamsHtml).catch(() => {})
      }
      if (b.attendees?.length > 0) {
        const attendeeEmails = b.attendees.filter((e: string) => e !== userEmail)
        if (attendeeEmails.length > 0) {
          await sendEmail(attendeeEmails, `[C&R SPACE] 🟢 회의 시작! 체크인해 주세요 — ${b.title}`, makeStartHtml(b, '참석자', true))
          totalSent++
        }
      }
    }

    // ── ③ 예약 시작 후 5분 경과 → 자동취소 5분 전 경고 ────────────────
    const after5 = new Date(now.getTime() - 5 * 60 * 1000)
    const { data: started } = await supabase
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(email, name), rooms(room_name)')
      .gte('start_at', new Date(after5.getTime() - 30000).toISOString())
      .lte('start_at', new Date(after5.getTime() + 30000).toISOString())
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .eq('checked_in',     false)
      .gt('end_at', now.toISOString())

    for (const b of started ?? []) {
      const userEmail = b.profiles?.email
      const userName  = b.profiles?.name ?? b.user_name
      const roomName  = (b.rooms as any)?.room_name ?? ''
      if (userEmail) {
        await sendEmail([userEmail], `[C&R SPACE] ⚠️ 5분 후 자동취소 — ${b.title}`, makeAfter5Html(b, userName, false))
        totalSent++
      }
      if (b.user_id) {
        await insertNotification(supabase, {
          userId: b.user_id, type: 'checkin_warning',
          title: '⚠️ 5분 후 자동취소 — 지금 바로 체크인해 주세요!',
          body: `${b.title} · ${roomName} · ${fmtTime(b.start_at)}`,
          bookingId: b.id,
        })
      }
      if (AZURE_ENABLED) {
        const teamsHtml = makeTeamsHtml('5min', b)
        const allEmails = [userEmail, ...(b.attendees ?? [])].filter(Boolean)
        sendTeamsDMBatch(allEmails, teamsHtml).catch(() => {})
      }
      if (b.attendees?.length > 0) {
        const attendeeEmails = b.attendees.filter((e: string) => e !== userEmail)
        if (attendeeEmails.length > 0) {
          await sendEmail(attendeeEmails, `[C&R SPACE] ⚠️ 5분 후 자동취소 — ${b.title}`, makeAfter5Html(b, '참석자', true))
          totalSent++
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: totalSent, time: now.toISOString() }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[checkin-reminder] 오류:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
