// @ts-nocheck
/**
 * send-notification Edge Function
 * 예약 생성 / 변경 / 취소 / 노쇼 시 생성자 + 참석자에게 이메일 발송
 *
 * 호출 방법 (App.tsx에서):
 *   await supabase.functions.invoke('send-notification', {
 *     body: { type: 'created' | 'updated' | 'cancelled' | 'noshow', booking: {...} }
 *   })
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = 'C&R SPACE <onboarding@resend.dev>'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://cnr-booking.vercel.app'

// ── KST 시간 포맷 유틸 ─────────────────────────────────────────────────────
function utcToKST(ts: string): string {
  if (!ts) return ''
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth()+1)}.${pad(kst.getUTCDate())} ` +
         `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}
function fmtDate(ts: string): string {
  if (!ts) return ''
  const d   = new Date(ts)
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const days = ['일','월','화','수','목','금','토']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}년 ${pad(kst.getUTCMonth()+1)}월 ${pad(kst.getUTCDate())}일 (${days[kst.getUTCDay()]})`
}
function fmtTime(ts: string | undefined | null): string {
  if (!ts) return '—'
  try {
    const d   = new Date(ts)
    if (isNaN(d.getTime())) return '—'
    const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
    const h   = kst.getUTCHours()
    const m   = String(kst.getUTCMinutes()).padStart(2, '0')
    const period = h < 12 ? '오전' : '오후'
    const hour   = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${period} ${hour}:${m}`
  } catch { return '—' }
}

// ── 이메일 템플릿 ────────────────────────────────────────────────────────────
function getSubject(type: string, booking: any): string {
  const title = booking.title
  const subjects: Record<string, string> = {
    created:   `[C&R SPACE] ✅ 예약 확정 — ${title}`,
    updated:   `[C&R SPACE] 📝 예약 변경 — ${title}`,
    cancelled: `[C&R SPACE] ❌ 예약 취소 — ${title}`,
    noshow:    `[C&R SPACE] ⚠️ 미체크인 자동취소 — ${title}`,
    pending:   `[C&R SPACE] 📋 에메랄드 승인 요청 — ${title}`,
    approved:  `[C&R SPACE] ✅ 예약 승인 — ${title}`,
    rejected:  `[C&R SPACE] ❌ 예약 반려 — ${title}`,
  }
  return subjects[type] ?? `[C&R SPACE] 예약 알림 — ${title}`
}

function getEmailHtml(type: string, booking: any, isAttendee = false): string {
  // end_at 디버그 (배포 후 로그에서 확인)
  console.log('[notify] booking.end_at:', booking.end_at, 'room_name:', booking.room_name)
  const dateStr  = fmtDate(booking.start_at)
  const startStr = fmtTime(booking.start_at)
  const endStr   = fmtTime(booking.end_at ?? booking.end_time)
  const role     = isAttendee ? '참석자로 초대됨' : '예약자'

  const headerColors: Record<string, string> = {
    created:   '#4F46E5',
    updated:   '#0891B2',
    cancelled: '#DC2626',
    noshow:    '#D97706',
    pending:   '#D97706',
    approved:  '#16A34A',
    rejected:  '#DC2626',
  }
  const headerColor = headerColors[type] ?? '#4F46E5'

  const headerLabels: Record<string, string> = {
    created:   '예약이 확정되었습니다',
    updated:   '예약이 변경되었습니다',
    cancelled: '예약이 취소되었습니다',
    noshow:    '미체크인으로 자동 취소되었습니다',
    pending:   '에메랄드 룸 승인 요청이 접수되었습니다',
    approved:  '예약 요청이 승인되었습니다',
    rejected:  '예약 요청이 반려되었습니다',
  }
  const headerLabel = headerLabels[type] ?? '예약 알림'

  const cancelledStyle = (type === 'cancelled' || type === 'noshow' || type === 'rejected')
    ? 'text-decoration: line-through; color: #9CA3AF;' : ''

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Apple SD Gothic Neo',Pretendard,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- 헤더 -->
        <tr>
          <td style="background:${headerColor};padding:28px 32px;">
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500;">CNR Research</p>
            <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#fff;">C&amp;R SPACE</p>
            <p style="margin:12px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">${headerLabel}</p>
          </td>
        </tr>

        <!-- 예약 정보 -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#111;${cancelledStyle}">${booking.title}</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;padding:16px 20px;">
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">날짜</span>
                  <span style="font-size:13px;color:#111;font-weight:500;">${dateStr}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">시간</span>
                  <span style="font-size:13px;color:#111;font-weight:500;">${startStr} – ${endStr}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">회의실</span>
                  <span style="font-size:13px;color:#111;font-weight:500;">${booking.room_name ?? booking.room_id + 'F'}</span>
                </td>
              </tr>
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">예약자</span>
                  <span style="font-size:13px;color:#111;font-weight:500;">${booking.user_name} (${booking.user_dept})</span>
                </td>
              </tr>
              ${isAttendee ? `
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">구분</span>
                  <span style="font-size:13px;color:#4F46E5;font-weight:600;">${role}</span>
                </td>
              </tr>` : ''}
              ${booking.memo ? `
              <tr>
                <td style="padding:6px 0;">
                  <span style="display:inline-block;width:72px;font-size:12px;color:#6B7280;font-weight:600;">메모</span>
                  <span style="font-size:13px;color:#374151;">${booking.memo}</span>
                </td>
              </tr>` : ''}
            </table>

            ${type === 'noshow' ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">⚠️ 체크인 미완료로 예약이 자동 취소되었습니다.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#B45309;">예약 시작 후 10분 이내에 체크인이 없으면 자동 취소됩니다.</p>
            </div>` : ''}
            ${type === 'pending' ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">📋 AdminPage → 승인 관리 탭에서 승인 또는 거절해 주세요.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#B45309;">승인/거절 시 신청자에게 자동으로 결과가 통보됩니다.</p>
            </div>` : ''}
            ${type === 'rejected' && booking.reject_reason ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF2F2;border-radius:10px;border-left:4px solid #DC2626;">
              <p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">거절 사유</p>
              <p style="margin:6px 0 0;font-size:13px;color:#DC2626;">${booking.reject_reason}</p>
            </div>` : ''}

            ${(type === 'created' || type === 'updated' || type === 'approved' || type === 'pending') ? `
            <div style="margin:20px 0 0;text-align:center;">
              <a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">
                예약 확인하기 →
              </a>
            </div>` : ''}
          </td>
        </tr>

        <!-- 푸터 -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #F1F5F9;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">
              이 메일은 C&R SPACE에서 자동 발송됩니다.<br>
              문의: 총무팀 (HR)
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ── Resend 발송 ────────────────────────────────────────────────────────────
async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY 없음 — 발송 스킵')
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[notify] Resend 오류:', err)
    throw new Error(`Resend 발송 실패: ${err}`)
  }
  const data = await res.json()
  console.log('[notify] 발송 완료:', data.id, '→', to)
  return data
}

// ── 메인 핸들러 ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // CORS preflight
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, booking, attendeeEmails = [] } = await req.json()

    if (!type || !booking) {
      return new Response(JSON.stringify({ error: 'type, booking 필수' }), { status: 400, headers: corsHeaders })
    }

    const subject = getSubject(type, booking)
    const results = []

    // pending(승인 요청)은 Admin에게 발송, 나머지는 예약자에게 발송
    if (type === 'pending') {
      // Admin 이메일 목록으로 발송 (attendeeEmails에 admin_emails 담겨 옴)
      const adminEmails = attendeeEmails.filter((e: string) => !!e)
      if (adminEmails.length > 0) {
        const html = getEmailHtml(type, booking, false)
        await sendEmail(adminEmails, subject, html)
        results.push({ to: adminEmails, role: 'admins' })
      }
      return new Response(
        JSON.stringify({ success: true, sent: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. 예약 생성자에게 발송
    if (booking.user_email) {
      const html = getEmailHtml(type, booking, false)
      await sendEmail([booking.user_email], subject, html)
      results.push({ to: booking.user_email, role: 'creator' })
    }

    // 2. 참석자에게 발송 (생성자 제외)
    const attendees = attendeeEmails.filter((e: string) => e !== booking.user_email)
    if (attendees.length > 0) {
      const html = getEmailHtml(type, booking, true)
      // Resend는 한 번에 최대 50명 — 초과 시 배치 처리
      for (let i = 0; i < attendees.length; i += 50) {
        const batch = attendees.slice(i, i + 50)
        await sendEmail(batch, subject, html)
        results.push({ to: batch, role: 'attendees' })
      }
    }

    return new Response(
      JSON.stringify({ success: true, sent: results.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[notify] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
