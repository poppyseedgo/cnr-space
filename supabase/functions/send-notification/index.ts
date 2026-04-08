// @ts-nocheck
/**
 * send-notification Edge Function
 *
 * [설계 원칙]
 * - 수신자(예약자·참석자·관리자) 이메일을 프론트에서 받지 않고
 *   DB(profiles, booking_attendees)에서 직접 조회한다.
 * - FROM은 항상 시스템 계정 (환경변수 FROM_EMAIL)
 * - payload에 user_email, attendeeEmails 필드 불필요
 *
 * [수신자 결정 규칙]
 *   pending          → ADMIN role 전원 (DB 조회)
 *   attendee_removed → removed_emails 배열만 (payload 직접)
 *   그 외 전부        → 예약자(booking.user_id → profiles) + 참석자(booking_attendees)
 */

const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL        = Deno.env.get('FROM_EMAIL') ?? 'C&R SPACE <onboarding@resend.dev>'
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'
const TEAMS_WEBHOOK_URL = Deno.env.get('TEAMS_WEBHOOK_URL') ?? ''
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const sbHeaders = {
  'apikey':        SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
  'Content-Type':  'application/json',
}

// ── KST 포맷 유틸 ────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return ''
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const days = ['일','월','화','수','목','금','토']
  const pad = n => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}년 ${pad(kst.getUTCMonth()+1)}월 ${pad(kst.getUTCDate())}일 (${days[kst.getUTCDay()]})`
}
function fmtTime(ts) {
  if (!ts) return '—'
  try {
    const d   = new Date(ts)
    if (isNaN(d.getTime())) return '—'
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const h   = kst.getUTCHours()
    const m   = String(kst.getUTCMinutes()).padStart(2, '0')
    return `${h < 12 ? '오전' : '오후'} ${h === 0 ? 12 : h > 12 ? h - 12 : h}:${m}`
  } catch { return '—' }
}

// ── DB 조회 헬퍼 ─────────────────────────────────────────────────────────────
async function fetchBookerEmail(userId) {
  if (!userId || !SUPABASE_URL) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,name&limit=1`,
      { headers: sbHeaders }
    )
    if (!res.ok) return null
    const rows = await res.json()
    return rows[0] ?? null
  } catch (e) { console.warn('[notify] fetchBookerEmail 실패:', e); return null }
}

async function fetchAdminEmails() {
  if (!SUPABASE_URL) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?role=eq.ADMIN&is_active=eq.true&select=email`,
      { headers: sbHeaders }
    )
    if (!res.ok) return []
    const rows = await res.json()
    return rows.map(r => r.email).filter(Boolean)
  } catch (e) { console.warn('[notify] fetchAdminEmails 실패:', e); return [] }
}

async function fetchAttendeeEmails(bookingId, excludeEmail) {
  if (!bookingId || !SUPABASE_URL) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/booking_attendees?booking_id=eq.${encodeURIComponent(bookingId)}&select=email`,
      { headers: sbHeaders }
    )
    if (!res.ok) return []
    const rows = await res.json()
    return rows.map(r => r.email).filter(e => e && e !== excludeEmail)
  } catch (e) { console.warn('[notify] fetchAttendeeEmails 실패:', e); return [] }
}

// ── 이메일 subject ────────────────────────────────────────────────────────────
function getSubject(type, booking) {
  const t = booking.title
  const map = {
    created: `[C&R SPACE] ✅ 예약 확정 — ${t}`,
    updated: `[C&R SPACE] 📝 예약 변경 — ${t}`,
    cancelled: `[C&R SPACE] ❌ 예약 취소 — ${t}`,
    noshow: `[C&R SPACE] ⚠️ 미체크인 자동취소 — ${t}`,
    pending: `[C&R SPACE] 📋 에메랄드 승인 요청 — ${t}`,
    approved: `[C&R SPACE] ✅ 예약 승인 — ${t}`,
    rejected: `[C&R SPACE] ❌ 예약 반려 — ${t}`,
    attendee_removed: `[C&R SPACE] 📌 참석자 제외 알림 — ${t}`,
  }
  return map[type] ?? `[C&R SPACE] 예약 알림 — ${t}`
}

// ── 이메일 HTML ───────────────────────────────────────────────────────────────
function getEmailHtml(type, booking, isAttendee = false) {
  const dateStr  = fmtDate(booking.start_at)
  const startStr = fmtTime(booking.start_at)
  const endStr   = fmtTime(booking.end_at ?? booking.end_time)
  const headerColors = {
    created:'#4F46E5', updated:'#0891B2', cancelled:'#DC2626', noshow:'#D97706',
    pending:'#D97706', approved:'#16A34A', rejected:'#DC2626', attendee_removed:'#6B7280',
  }
  const headerLabels = {
    created:'예약이 확정되었습니다', updated:'예약이 변경되었습니다',
    cancelled:'예약이 취소되었습니다', noshow:'미체크인으로 자동 취소되었습니다',
    pending:'에메랄드 룸 승인 요청이 접수되었습니다', approved:'예약 요청이 승인되었습니다',
    rejected:'예약 요청이 반려되었습니다', attendee_removed:'해당 예약의 참석자에서 제외되었습니다',
  }
  const hc = headerColors[type] ?? '#4F46E5'
  const hl = headerLabels[type] ?? '예약 알림'
  const cs = (type==='cancelled'||type==='noshow'||type==='rejected') ? 'text-decoration:line-through;color:#9CA3AF;' : ''

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',Pretendard,-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
<tr><td align="center"><table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<tr><td style="background:${hc};padding:28px 32px;">
  <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500;">CNR Research</p>
  <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#fff;">C&amp;R SPACE</p>
  <p style="margin:12px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">${hl}</p>
</td></tr>
<tr><td style="padding:28px 32px;">
  <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#111;${cs}">${booking.title}</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;padding:16px 20px;">
    <tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">날짜</span><span style="font-size:13px;color:#111;font-weight:500;">${dateStr}</span></td></tr>
    <tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">시간</span><span style="font-size:13px;color:#111;font-weight:500;">${startStr} – ${endStr}</span></td></tr>
    <tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">회의실</span><span style="font-size:13px;color:#111;font-weight:500;">${booking.room_name ?? booking.room_id+'F'}</span></td></tr>
    <tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">예약자</span><span style="font-size:13px;color:#111;font-weight:500;">${booking.user_name??''} (${booking.user_dept??''})</span></td></tr>
    ${isAttendee ? `<tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">구분</span><span style="font-size:13px;color:#4F46E5;font-weight:600;">참석자로 초대됨</span></td></tr>` : ''}
    ${booking.memo ? `<tr><td style="padding:6px 0;"><span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">메모</span><span style="font-size:13px;color:#374151;">${booking.memo}</span></td></tr>` : ''}
  </table>
  ${type==='noshow' ? `<div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;"><p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">⚠️ 체크인 미완료로 예약이 자동 취소되었습니다.</p><p style="margin:6px 0 0;font-size:12px;color:#B45309;">예약 시작 후 10분 이내에 체크인이 없으면 자동 취소됩니다.</p></div>` : ''}
  ${type==='pending' ? `<div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;"><p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">📋 AdminPage → 승인 관리 탭에서 승인 또는 거절해 주세요.</p><p style="margin:6px 0 0;font-size:12px;color:#B45309;">승인/거절 시 신청자에게 자동으로 결과가 통보됩니다.</p></div>` : ''}
  ${type==='rejected'&&booking.reject_reason ? `<div style="margin:20px 0 0;padding:14px 16px;background:#FEF2F2;border-radius:10px;border-left:4px solid #DC2626;"><p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">거절 사유</p><p style="margin:6px 0 0;font-size:13px;color:#DC2626;">${booking.reject_reason}</p></div>` : ''}
  ${(type==='created'||type==='updated'||type==='approved'||type==='pending') ? `<div style="margin:20px 0 0;text-align:center;"><a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">예약 확인하기 →</a></div>` : ''}
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #F1F5F9;"><p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">이 메일은 C&R SPACE에서 자동 발송됩니다.<br>문의: 총무팀 (HR)</p></td></tr>
</table></td></tr></table></body></html>`
}

// ── Teams Adaptive Card ───────────────────────────────────────────────────────
async function sendTeamsCard(type, booking) {
  if (!TEAMS_WEBHOOK_URL) return
  const colorMap = { created:'Good', pending:'Warning', approved:'Good', rejected:'Attention', cancelled:'Default', noshow:'Warning', updated:'Default' }
  const titleMap = { created:'✅ 새 예약이 생성되었습니다', pending:'📋 에메랄드 룸 승인 요청', approved:'✅ 예약이 승인되었습니다', rejected:'❌ 예약이 거절되었습니다', cancelled:'❌ 예약이 취소되었습니다', noshow:'⚠️ 노쇼 자동취소', updated:'📝 예약이 변경되었습니다' }
  const card = {
    type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: {
      '$schema':'http://adaptivecards.io/schemas/adaptive-card.json', type:'AdaptiveCard', version:'1.4',
      body: [
        { type:'Container', style:colorMap[type]??'Default', items:[{ type:'TextBlock', text:titleMap[type]??'예약 알림', weight:'Bolder', size:'Medium', wrap:true }] },
        { type:'FactSet', facts:[
          { title:'회의명', value:booking.title??'-' }, { title:'회의실', value:booking.room_name??'-' },
          { title:'날짜', value:booking.start_at?booking.start_at.slice(0,10):'-' },
          { title:'시간', value:(booking.start_at&&booking.end_at)?`${booking.start_at.slice(11,16)} ~ ${booking.end_at.slice(11,16)}`:'-' },
          { title:'예약자', value:`${booking.user_name??'-'} (${booking.user_dept??'-'})` },
          ...(booking.reject_reason?[{title:'거절 사유',value:booking.reject_reason}]:[]),
        ]},
        ...(type==='pending'?[{type:'ActionSet',actions:[{type:'Action.OpenUrl',title:'승인 관리 페이지로 이동',url:`${APP_URL}#admin`}]}]:[]),
        ...((type==='created'||type==='approved')?[{type:'ActionSet',actions:[{type:'Action.OpenUrl',title:'예약 확인하기',url:APP_URL}]}]:[]),
      ],
    }}]
  }
  try {
    const res = await fetch(TEAMS_WEBHOOK_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(card) })
    if (!res.ok) console.warn('[notify] Teams 실패:', res.status)
    else console.log('[notify] Teams 발송 완료:', type)
  } catch (e) { console.warn('[notify] Teams 오류:', e) }
}

// ── 이메일 발송 ────────────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || to.length === 0) return
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) { const err = await res.text(); console.error('[notify] Resend 오류:', err); throw new Error(err) }
  const data = await res.json()
  console.log('[notify] 발송:', data.id, '→', to)
  return data
}

// ── 메인 핸들러 ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { type, booking } = await req.json()
    if (!type || !booking) return new Response(JSON.stringify({ error: 'type, booking 필수' }), { status: 400, headers: cors })

    const subject = getSubject(type, booking)
    const results = []

    // Teams (비동기, 실패 무시)
    if (['created','approved','rejected','cancelled','noshow','updated','pending'].includes(type)) {
      sendTeamsCard(type, booking).catch(() => {})
    }

    // ── pending: 관리자 전원 (DB 조회) ──────────────────────────────────────
    if (type === 'pending') {
      const adminEmails = await fetchAdminEmails()
      if (adminEmails.length > 0) {
        await sendEmail(adminEmails, subject, getEmailHtml(type, booking, false))
        results.push({ to: adminEmails, role: 'admins' })
      }
      console.log(`[notify] pending — 관리자 ${adminEmails.length}명`)
      return new Response(JSON.stringify({ success: true, sent: results.length, results }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── attendee_removed: 제거된 참석자만 ───────────────────────────────────
    if (type === 'attendee_removed') {
      const removedEmails = (booking.removed_emails ?? []).filter(e => !!e)
      if (removedEmails.length > 0) {
        const html = getEmailHtml(type, booking, true)
        for (let i = 0; i < removedEmails.length; i += 50) {
          const batch = removedEmails.slice(i, i + 50)
          await sendEmail(batch, subject, html)
          results.push({ to: batch, role: 'removed_attendees' })
        }
      }
      console.log(`[notify] attendee_removed — ${removedEmails.length}명`)
      return new Response(JSON.stringify({ success: true, sent: results.length, results }), { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── 그 외: 예약자(DB 조회) + 참석자(DB 조회) ────────────────────────────
    const booker       = booking.user_id ? await fetchBookerEmail(booking.user_id) : null
    const bookerEmail  = booker?.email ?? null
    const bookerName   = booker?.name  ?? booking.user_name ?? ''
    const attendees    = booking.id ? await fetchAttendeeEmails(booking.id, bookerEmail ?? '') : []

    if (bookerEmail) {
      await sendEmail([bookerEmail], subject, getEmailHtml(type, { ...booking, user_name: bookerName }, false))
      results.push({ to: bookerEmail, role: 'booker' })
    } else {
      console.warn('[notify] 예약자 이메일 조회 실패, user_id:', booking.user_id)
    }

    if (attendees.length > 0) {
      const html = getEmailHtml(type, booking, true)
      for (let i = 0; i < attendees.length; i += 50) {
        const batch = attendees.slice(i, i + 50)
        await sendEmail(batch, subject, html)
        results.push({ to: batch, role: 'attendees' })
      }
    }

    console.log(`[notify] ${type} — 예약자 ${bookerEmail?1:0}명 + 참석자 ${attendees.length}명`)
    return new Response(JSON.stringify({ success: true, sent: results.length, results }), { headers: { ...cors, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('[notify] 오류:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
