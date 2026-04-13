// @ts-nocheck
/**
 * send-notification Edge Function
 * 예약 생성 / 변경 / 취소 / 노쇼 / 승인 / 거절 시 생성자 + 참석자에게 이메일 발송
 *
 * ✅ 수정 내역 (2025-04-13):
 *   1. pending 타입 — profiles 테이블에서 admin 이메일 직접 조회 (프론트 의존 제거)
 *   2. user_email 누락 시 user_id → profiles 테이블에서 이메일 자동 조회
 *   3. FROM_EMAIL 환경변수화 (커스텀 도메인 지원)
 *   4. APP_URL 기본값 cnr-space.pages.dev로 수정
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'C&R SPACE <onboarding@resend.dev>'
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'
const TEAMS_WEBHOOK_URL = Deno.env.get('TEAMS_WEBHOOK_URL') ?? ''

// ── Supabase 환경변수 ────────────────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ── KST 시간 포맷 유틸 ─────────────────────────────────────────────────────
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

// ── DB 조회 유틸 ─────────────────────────────────────────────────────────────

/** user_email 없을 때 user_id → profiles 테이블에서 이메일 조회 */
async function fetchUserEmail(userId: string): Promise<string | null> {
  if (!userId || !SUPABASE_URL) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email&limit=1`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    if (!res.ok) return null
    const rows: { email: string }[] = await res.json()
    return rows[0]?.email ?? null
  } catch (e) {
    console.warn('[notify] fetchUserEmail 실패:', e)
    return null
  }
}

/** pending 타입 전용 — Admin 전원 이메일 조회 */
async function fetchAdminEmails(): Promise<string[]> {
  if (!SUPABASE_URL) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?role=eq.ADMIN&is_active=eq.true&select=email`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    if (!res.ok) {
      console.warn('[notify] fetchAdminEmails HTTP 오류:', res.status)
      return []
    }
    const rows: { email: string }[] = await res.json()
    return rows.map(r => r.email).filter(Boolean)
  } catch (e) {
    console.warn('[notify] fetchAdminEmails 실패:', e)
    return []
  }
}

/** booking_attendees 테이블에서 참석자 이메일 조회 (생성자 제외) */
async function fetchAttendeeEmails(bookingId: string, creatorEmail: string): Promise<string[]> {
  if (!bookingId || !SUPABASE_URL) return []
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/booking_attendees?booking_id=eq.${bookingId}&select=email`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    if (!res.ok) return []
    const rows: { email: string }[] = await res.json()
    return rows.map(r => r.email).filter(e => e && e !== creatorEmail)
  } catch (e) {
    console.warn('[notify] booking_attendees 조회 실패:', e)
    return []
  }
}

// ── 이메일 템플릿 ────────────────────────────────────────────────────────────
function getSubject(type: string, booking: any): string {
  const title = booking.title
  const subjects: Record<string, string> = {
    created:          `[C&R SPACE] ✅ 예약 확정 — ${title}`,
    updated:          `[C&R SPACE] 📝 예약 변경 — ${title}`,
    cancelled:        `[C&R SPACE] ❌ 예약 취소 — ${title}`,
    noshow:           `[C&R SPACE] ⚠️ 미체크인 자동취소 — ${title}`,
    pending:          `[C&R SPACE] 📋 에메랄드 승인 요청 — ${title}`,
    approved:         `[C&R SPACE] ✅ 예약 승인 — ${title}`,
    rejected:         `[C&R SPACE] ❌ 예약 반려 — ${title}`,
    attendee_removed: `[C&R SPACE] 📌 참석자 제외 알림 — ${title}`,
  }
  return subjects[type] ?? `[C&R SPACE] 예약 알림 — ${title}`
}

function getEmailHtml(type: string, booking: any, isAttendee = false): string {
  console.log('[notify] booking.end_at:', booking.end_at, 'room_name:', booking.room_name)
  const dateStr  = fmtDate(booking.start_at)
  const startStr = fmtTime(booking.start_at)
  const endStr   = fmtTime(booking.end_at ?? booking.end_time)
  const role     = isAttendee ? '참석자로 초대됨' : '예약자'

  const headerColors: Record<string, string> = {
    created:          '#4F46E5',
    updated:          '#0891B2',
    cancelled:        '#DC2626',
    noshow:           '#D97706',
    pending:          '#D97706',
    approved:         '#16A34A',
    rejected:         '#DC2626',
    attendee_removed: '#6B7280',
  }
  const headerColor = headerColors[type] ?? '#4F46E5'

  const headerLabels: Record<string, string> = {
    created:          '예약이 확정되었습니다',
    updated:          '예약이 변경되었습니다',
    cancelled:        '예약이 취소되었습니다',
    noshow:           '미체크인으로 자동 취소되었습니다',
    pending:          '에메랄드 룸 승인 요청이 접수되었습니다',
    approved:         '예약 요청이 승인되었습니다',
    rejected:         '예약 요청이 반려되었습니다',
    attendee_removed: '해당 예약의 참석자에서 제외되었습니다',
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

// ── Teams Adaptive Card 발송 ─────────────────────────────────────────────
async function sendTeamsCard(type: string, booking: any): Promise<void> {
  if (!TEAMS_WEBHOOK_URL) return

  const colorMap: Record<string, string> = {
    created:   'Good',
    pending:   'Warning',
    approved:  'Good',
    rejected:  'Attention',
    cancelled: 'Default',
    noshow:    'Warning',
    updated:   'Default',
  }
  const color = colorMap[type] ?? 'Default'

  const titleMap: Record<string, string> = {
    created:   '✅ 새 예약이 생성되었습니다',
    pending:   '📋 에메랄드 룸 승인 요청',
    approved:  '✅ 예약이 승인되었습니다',
    rejected:  '❌ 예약이 거절되었습니다',
    cancelled: '❌ 예약이 취소되었습니다',
    noshow:    '⚠️ 노쇼 자동취소',
    updated:   '📝 예약이 변경되었습니다',
  }
  const cardTitle = titleMap[type] ?? '예약 알림'

  const card = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'Container',
            style: color,
            items: [{
              type: 'TextBlock',
              text: cardTitle,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
            }]
          },
          {
            type: 'FactSet',
            facts: [
              { title: '회의명', value: booking.title ?? '-' },
              { title: '회의실', value: booking.room_name ?? '-' },
              { title: '날짜',   value: booking.start_at ? booking.start_at.slice(0, 10) : '-' },
              { title: '시간',   value: booking.start_at && booking.end_at
                  ? `${booking.start_at.slice(11,16)} ~ ${booking.end_at.slice(11,16)}`
                  : '-' },
              { title: '예약자', value: `${booking.user_name ?? '-'} (${booking.user_dept ?? '-'})` },
              ...(booking.reject_reason ? [{ title: '거절 사유', value: booking.reject_reason }] : []),
            ]
          },
          ...(type === 'pending' ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '승인 관리 페이지로 이동',
              url: `${APP_URL}#admin`,
            }]
          }] : []),
          ...((type === 'created' || type === 'approved') ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '예약 확인하기',
              url: APP_URL,
            }]
          }] : []),
        ],
        '$version': '1.0',
      }
    }]
  }

  try {
    const res = await fetch(TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    })
    if (!res.ok) {
      console.warn('[notify] Teams 발송 실패:', res.status, await res.text())
    } else {
      console.log('[notify] Teams 카드 발송 완료, type:', type)
    }
  } catch (e) {
    console.warn('[notify] Teams 발송 오류 (이메일은 정상):', e)
  }
}

// ── Resend 발송 ────────────────────────────────────────────────────────────
async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY 없음 — 발송 스킵')
    return
  }
  if (to.length === 0) return

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
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { type, booking } = await req.json()

    if (!type || !booking) {
      return new Response(JSON.stringify({ error: 'type, booking 필수' }), { status: 400, headers: corsHeaders })
    }

    const subject = getSubject(type, booking)
    const results = []

    // ── Teams 알림 (비동기, 실패해도 이메일에 영향 없음) ────────────────────
    if (['created', 'approved', 'rejected', 'cancelled', 'noshow', 'updated', 'pending'].includes(type)) {
      sendTeamsCard(type, booking).catch(() => {})
    }

    // ── pending: Admin 전원에게 발송 (DB에서 직접 조회) ─────────────────────
    if (type === 'pending') {
      const adminEmails = await fetchAdminEmails()
      console.log('[notify] pending → admin 이메일:', adminEmails.length, '명')
      if (adminEmails.length > 0) {
        const html = getEmailHtml(type, booking, false)
        await sendEmail(adminEmails, subject, html)
        results.push({ to: adminEmails, role: 'admins' })
      } else {
        console.warn('[notify] pending: admin 이메일 없음 — profiles.role=ADMIN 확인 필요')
      }
      return new Response(
        JSON.stringify({ success: true, sent: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── attendee_removed: 제거된 참석자에게만 발송 ────────────────────────
    if (type === 'attendee_removed') {
      const removedEmails: string[] = (booking.removed_emails ?? []).filter((e: string) => !!e)
      if (removedEmails.length > 0) {
        const html = getEmailHtml(type, booking, true)
        for (let i = 0; i < removedEmails.length; i += 50) {
          const batch = removedEmails.slice(i, i + 50)
          await sendEmail(batch, subject, html)
          results.push({ to: batch, role: 'removed_attendees' })
        }
      }
      console.log(`[notify] attendee_removed 발송 완료 — ${removedEmails.length}명`)
      return new Response(
        JSON.stringify({ success: true, sent: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── user_email 확보: 없으면 user_id → profiles 조회 ────────────────────
    let creatorEmail = booking.user_email ?? ''
    if (!creatorEmail && booking.user_id) {
      console.log('[notify] user_email 없음 → user_id로 profiles 조회:', booking.user_id)
      creatorEmail = await fetchUserEmail(booking.user_id) ?? ''
    }
    if (!creatorEmail) {
      console.warn('[notify] 예약자 이메일 확인 불가 — user_email, user_id 모두 없거나 profiles 조회 실패')
    }

    // ── booking_attendees 테이블에서 참석자 조회 ────────────────────────────
    const attendeeEmailList = booking.id
      ? await fetchAttendeeEmails(booking.id, creatorEmail)
      : []

    // ── 1. 예약 생성자에게 발송 ─────────────────────────────────────────────
    if (creatorEmail) {
      const html = getEmailHtml(type, booking, false)
      await sendEmail([creatorEmail], subject, html)
      results.push({ to: creatorEmail, role: 'creator' })
    }

    // ── 2. 참석자에게 발송 (50명씩 배치) ───────────────────────────────────
    if (attendeeEmailList.length > 0) {
      const html = getEmailHtml(type, booking, true)
      for (let i = 0; i < attendeeEmailList.length; i += 50) {
        const batch = attendeeEmailList.slice(i, i + 50)
        await sendEmail(batch, subject, html)
        results.push({ to: batch, role: 'attendees' })
      }
    }

    console.log(`[notify] ${type} 발송 완료 — 예약자(${creatorEmail || '없음'}) + 참석자 ${attendeeEmailList.length}명`)

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
