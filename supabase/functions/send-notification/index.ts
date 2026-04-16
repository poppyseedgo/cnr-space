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

interface CreatorInfo {
  email:      string
  name:       string
  dept:       string
  avatar_url: string | null
}

/** user_id → profiles 테이블에서 예약자 풀 정보 조회 */
async function fetchCreatorInfo(userId: string): Promise<CreatorInfo | null> {
  if (!userId || !SUPABASE_URL) return null
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,name,dept,avatar_url&limit=1`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    if (!res.ok) return null
    const rows: CreatorInfo[] = await res.json()
    return rows[0] ?? null
  } catch (e) {
    console.warn('[notify] fetchCreatorInfo 실패:', e)
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

/** booking_attendees 테이블에서 참석자 목록 조회 (이메일 + 이름 + 아바타, 생성자 제외) */
async function fetchAttendees(
  bookingId: string,
  creatorEmail: string,
): Promise<{ email: string; name: string; avatar_url: string | null }[]> {
  if (!bookingId || !SUPABASE_URL) return []
  try {
    // 1. booking_attendees에서 email, name 조회
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/booking_attendees?booking_id=eq.${bookingId}&select=email,name`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    if (!res.ok) return []
    const rows: { email: string; name: string }[] = await res.json()
    const filtered = rows.filter(r => r.email && r.email !== creatorEmail)
    if (filtered.length === 0) return []

    // 2. profiles에서 avatar_url 배치 조회
    const emails = filtered.map(r => `"${r.email}"`).join(',')
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=in.(${emails})&select=email,avatar_url`,
      {
        headers: {
          'apikey':        SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type':  'application/json',
        },
      }
    )
    const profileMap = new Map<string, string | null>()
    if (profileRes.ok) {
      const profiles: { email: string; avatar_url: string | null }[] = await profileRes.json()
      for (const p of profiles) profileMap.set(p.email.toLowerCase(), p.avatar_url ?? null)
    }

    return filtered.map(r => ({
      email:      r.email,
      name:       r.name ?? '',
      avatar_url: profileMap.get(r.email.toLowerCase()) ?? null,
    }))
  } catch (e) {
    console.warn('[notify] booking_attendees 조회 실패:', e)
    return []
  }
}

// ── 공통 렌더 헬퍼 ───────────────────────────────────────────────────────────

/** 아바타 원형 (이미지 or 이니셜) */
function renderAvatar(name: string, avatar_url: string | null | undefined, size = 28): string {
  const initial = (name ?? '?')[0]
  const s = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;`
  if (avatar_url && avatar_url.startsWith('https://')) {
    return `<img src="${avatar_url}" width="${size}" height="${size}" style="${s}object-fit:cover;vertical-align:middle;" />`
  }
  return `<span style="display:inline-flex;align-items:center;justify-content:center;${s}background:#C7D2FE;color:#4338CA;font-size:${Math.floor(size * 0.46)}px;font-weight:700;vertical-align:middle;">${initial}</span>`
}

/** 예약자 칩: [아바타] 이름 (부서) */
function renderCreatorChip(name: string, dept: string, avatar_url: string | null | undefined): string {
  return `<span style="display:inline-flex;align-items:center;gap:7px;">
    ${renderAvatar(name, avatar_url, 26)}
    <span style="font-size:13px;color:#111;font-weight:500;">${name}${dept ? ` <span style="color:#6B7280;font-weight:400;">(${dept})</span>` : ''}</span>
  </span>`
}

/** 참석자 칩 목록: [아바타]이름 [아바타]이름 ... */
function renderAttendeesRow(list: { name: string; avatar_url?: string | null }[]): string {
  if (list.length === 0) return ''
  return list.map(a =>
    `<span style="display:inline-flex;align-items:center;background:#EEF2FF;border-radius:20px;padding:3px 10px 3px 5px;margin:2px 4px 2px 0;gap:5px;">
      ${renderAvatar(a.name, a.avatar_url, 20)}
      <span style="font-size:12px;color:#4338CA;font-weight:500;">${a.name}</span>
    </span>`
  ).join('')
}

// ── 이메일 템플릿 ────────────────────────────────────────────────────────────
function getSubject(type: string, booking: any, isAttendee = false): string {
  const title = booking.title
  const subjects: Record<string, string> = {
    created:          `[C&R SPACE] ✅ 예약 확정 — ${title}`,
    updated:          `[C&R SPACE] 📝 예약 변경 — ${title}`,
    cancelled:        `[C&R SPACE] ❌ 예약 취소 — ${title}`,
    noshow:           `[C&R SPACE] ⚠️ 미체크인 경고 — ${title}`,
    pending:          `[C&R SPACE] 💎 에메랄드 승인 요청 — ${title}`,
    approved:         `[C&R SPACE] ✅ 예약 승인 — ${title}`,
    rejected:         `[C&R SPACE] ❌ 승인 거절 — ${title}`,
    attendee_removed:  `[C&R SPACE] 참석자 제외 알림 — ${title}`,
    pending_expiring:  `[C&R SPACE] ⏰ 승인 기한 10분 전 — ${title}`,
    pending_expired:   `[C&R SPACE] ❌ 승인 기한 초과 자동 취소 — ${title}`,
  }
  const base = subjects[type] ?? `[C&R SPACE] 예약 알림 — ${title}`
  return isAttendee ? base.replace('[C&R SPACE]', '[C&R SPACE · 참석자]') : base
}

function getEmailHtml(
  type: string,
  booking: any,
  isAttendee = false,
  attendeeList: { name: string; avatar_url?: string | null }[] = [],
  recipientName = '',
  creatorInfo: CreatorInfo | null = null,
  recurBookings: { start_at: string; end_at: string }[] = [],
  isAdminRecipient = false,
): string {
  const isRecur    = recurBookings.length > 1
  const dateStr    = fmtDate(booking.start_at)
  const startStr   = fmtTime(booking.start_at)
  const endStr     = fmtTime(booking.end_at ?? booking.end_time)
  const creatorName = creatorInfo?.name  ?? booking.user_name ?? ''
  const creatorDept = creatorInfo?.dept  ?? booking.user_dept ?? ''
  const creatorAvatar = creatorInfo?.avatar_url ?? null

  const headerColors: Record<string, string> = {
    created: '#4F46E5', updated: '#0891B2', cancelled: '#DC2626',
    noshow: '#D97706', pending: '#D97706', approved: '#16A34A',
    rejected: '#DC2626', attendee_removed: '#6B7280',
    pending_expiring: '#D97706', pending_expired: '#DC2626',
  }
  const headerLabels: Record<string, string> = {
    created:          isRecur ? `반복 예약 ${recurBookings.length}건이 확정되었습니다` : '예약이 확정되었습니다',
    updated:          '예약이 변경되었습니다',
    cancelled:        '예약이 취소되었습니다',
    noshow:           '노쇼로 예약이 자동 취소되었습니다',
    pending:          isRecur ? `반복 예약 ${recurBookings.length}건 승인 요청` : '에메랄드 룸 승인 요청이 접수되었습니다',
    approved:         '예약 요청이 승인되었습니다',
    rejected:         '승인 요청이 거절되었습니다',
    attendee_removed: '해당 예약의 참석자에서 제외되었습니다',
    pending_expiring: '에메랄드 룸 승인 기한이 10분 후 만료됩니다',
    pending_expired:  '승인 기한 초과로 예약이 자동 취소되었습니다',
  }
  const headerColor = headerColors[type] ?? '#4F46E5'
  const headerLabel = headerLabels[type] ?? '예약 알림'
  const cancelledStyle = (type === 'cancelled' || type === 'noshow' || type === 'rejected' || type === 'pending_expired')
    ? 'text-decoration:line-through;color:#9CA3AF;' : ''

  // 반복예약 일정 목록 (날짜 + 시간)
  const recurRows = isRecur ? recurBookings.map((b, i) =>
    `<tr>
      <td style="padding:5px 0;">
        <span style="display:inline-block;width:22px;font-size:11px;color:#9CA3AF;font-weight:600;">${i + 1}</span>
        <span style="font-size:12px;color:#374151;font-weight:500;">${fmtDate(b.start_at)}</span>
        <span style="font-size:12px;color:#6B7280;margin-left:8px;">${fmtTime(b.start_at)} – ${fmtTime(b.end_at)}</span>
      </td>
    </tr>`
  ).join('') : ''

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:'Arial','Malgun Gothic','맑은 고딕',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- 헤더 -->
        <tr>
          <td style="background:${headerColor};padding:28px 32px;">
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.8);font-weight:500;">CNR Research</p>
            <p style="margin:8px 0 0;font-size:20px;font-weight:700;color:#fff;">C&amp;R SPACE</p>
            <p style="margin:10px 0 0;font-size:14px;color:rgba(255,255,255,0.9);">${headerLabel}</p>
            ${isAttendee ? `<div style="margin:12px 0 0;display:inline-block;background:rgba(255,255,255,0.22);border-radius:20px;padding:4px 14px;">
              <span style="font-size:12px;color:#fff;font-weight:700;">👤 참석자로 초대된 회의입니다</span>
            </div>` : ''}
            ${isRecur ? `<div style="margin:12px 0 0;display:inline-block;background:rgba(255,255,255,0.22);border-radius:20px;padding:4px 14px;">
              <span style="font-size:12px;color:#fff;font-weight:700;">🔁 반복 예약 ${recurBookings.length}건</span>
            </div>` : ''}
          </td>
        </tr>

        <!-- 본문 -->
        <tr>
          <td style="padding:28px 32px;">

            ${isAttendee && recipientName ? `<p style="margin:0 0 16px;font-size:13px;color:#6B7280;">안녕하세요, <strong style="color:#111;">${recipientName}</strong>님. 아래 회의에 참석자로 초대되었습니다.</p>` : ''}

            <!-- 회의 제목 -->
            <p style="margin:0 0 4px;font-size:16px;font-weight:700;color:#111;${cancelledStyle}">${booking.title}</p>
            <p style="margin:0 0 20px;font-size:13px;color:#6B7280;">${booking.room_name ?? ''}</p>

            <!-- 예약 정보 카드 -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border-radius:12px;padding:16px 20px;">

              ${!isRecur ? `
              <!-- 단건: 날짜 + 시간 -->
              <tr><td style="padding:6px 0;">
                <span style="display:inline-block;width:60px;font-size:12px;color:#6B7280;font-weight:600;">날짜</span>
                <span style="font-size:13px;color:#111;font-weight:500;">${dateStr}</span>
              </td></tr>
              <tr><td style="padding:6px 0;">
                <span style="display:inline-block;width:60px;font-size:12px;color:#6B7280;font-weight:600;">시간</span>
                <span style="font-size:13px;color:#111;font-weight:500;">${startStr} – ${endStr}</span>
              </td></tr>` : `
              <!-- 반복예약: 일정 목록 -->
              <tr><td style="padding:6px 0 10px;">
                <span style="display:block;font-size:12px;color:#6B7280;font-weight:600;margin-bottom:6px;">반복 일정</span>
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:8px 12px;">
                  ${recurRows}
                </table>
              </td></tr>`}

              ${booking.memo ? `
              <tr><td style="padding:6px 0;">
                <span style="display:inline-block;width:60px;font-size:12px;color:#6B7280;font-weight:600;vertical-align:top;padding-top:2px;">메모</span>
                <span style="font-size:13px;color:#374151;">${booking.memo}</span>
              </td></tr>` : ''}

              <!-- 예약자: 아바타 + 이름 + 부서 -->
              <tr><td style="padding:8px 0 6px;border-top:1px solid #E5E7EB;margin-top:4px;">
                <span style="display:inline-block;width:60px;font-size:12px;color:#6B7280;font-weight:600;vertical-align:middle;">예약자</span>
                ${renderCreatorChip(creatorName, creatorDept, creatorAvatar)}
              </td></tr>

              ${attendeeList.length > 0 ? `
              <!-- 참석자: 아바타 + 이름 칩 -->
              <tr><td style="padding:6px 0;">
                <span style="display:inline-block;width:60px;font-size:12px;color:#6B7280;font-weight:600;vertical-align:top;padding-top:6px;">참석자</span>
                <span>${renderAttendeesRow(attendeeList)}</span>
              </td></tr>` : ''}

            </table>

            ${type === 'noshow' ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">⚠️ 체크인 미완료로 예약이 자동 취소되었습니다.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#B45309;">예약 시작 후 10분 이내에 체크인이 없으면 자동 취소됩니다.</p>
            </div>` : ''}

            ${type === 'cancelled' && booking.admin_force ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF2F2;border-radius:10px;border-left:4px solid #DC2626;">
              <p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">관리자에 의해 강제 취소된 예약입니다.</p>
              ${booking.cancel_reason ? `<p style="margin:6px 0 0;font-size:13px;color:#DC2626;">취소 사유: ${booking.cancel_reason}</p>` : ''}
            </div>` : ''}

            ${type === 'pending' ? `
            ${isAdminRecipient ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">📋 아래 버튼을 클릭해 승인 또는 거절해 주세요.</p>
            </div>
            <div style="margin:16px 0 0;text-align:center;">
              <a href="${APP_URL}#admin-booking-${booking.id}" style="display:inline-block;background:#D97706;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">지금 승인 처리하기 →</a>
            </div>` : `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">✅ 에메랄드 룸 예약 승인 요청이 접수되었습니다.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#B45309;">관리자 검토 후 승인 또는 거절 결과를 이메일로 안내해 드립니다.</p>
            </div>`}` : ''}

            ${type === 'pending_expiring' ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF3C7;border-radius:10px;border-left:4px solid #D97706;">
              <p style="margin:0;font-size:13px;color:#92400E;font-weight:600;">⏰ 10분 내에 승인 또는 거절하지 않으면 예약이 자동 취소됩니다.</p>
              <p style="margin:6px 0 0;font-size:12px;color:#B45309;">지금 바로 처리해 주세요.</p>
            </div>
            <div style="margin:16px 0 0;text-align:center;">
              <a href="${APP_URL}#admin-booking-${booking.id}" style="display:inline-block;background:#D97706;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">지금 승인 처리하기 →</a>
            </div>` : ''}

            ${type === 'pending_expired' ? `
            <div style="margin:20px 0 0;padding:14px 16px;background:#FEF2F2;border-radius:10px;border-left:4px solid #DC2626;">
              ${isAdminRecipient
                ? `<p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">❌ 예약 시작 1분 전까지 승인이 완료되지 않아 시스템이 자동 취소 처리했습니다.</p>`
                : `<p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">❌ 예약 시작 전까지 관리자 승인이 완료되지 않아 자동 취소되었습니다.</p>
                   <p style="margin:6px 0 0;font-size:12px;color:#B91C1C;">새 예약을 생성하여 다시 승인 요청해 주세요.</p>`
              }
            </div>
            ${!isAdminRecipient ? `
            <div style="margin:16px 0 0;text-align:center;">
              <a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">새 예약 만들기 →</a>
            </div>` : ''}` : ''}

            ${type === 'rejected' ? `
            ${booking.admin_name ? `
            <div style="margin:20px 0 0;padding:12px 16px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0;">
              <span style="font-size:12px;color:#6B7280;font-weight:600;">거절한 관리자</span>
              <div style="margin-top:8px;">${renderCreatorChip(booking.admin_name, '', booking.admin_avatar ?? null)}</div>
            </div>` : ''}
            ${booking.reject_reason ? `
            <div style="margin:16px 0 0;padding:14px 16px;background:#FEF2F2;border-radius:10px;border-left:4px solid #DC2626;">
              <p style="margin:0;font-size:13px;color:#991B1B;font-weight:600;">거절 사유</p>
              <p style="margin:6px 0 0;font-size:13px;color:#DC2626;">${booking.reject_reason}</p>
            </div>` : ''}
            <div style="margin:16px 0 0;padding:14px 16px;background:#F8FAFC;border-radius:10px;border:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;color:#64748B;line-height:1.6;">반려된 예약은 자동으로 취소 처리됩니다.<br>새로운 예약을 생성하여 다시 승인 요청해 주세요.</p>
            </div>
            <div style="margin:16px 0 0;text-align:center;">
              <a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">새 예약 만들기 →</a>
            </div>` : ''}

            ${(type === 'created' || type === 'updated' || type === 'approved') ? `
            <div style="margin:20px 0 0;text-align:center;">
              <a href="${APP_URL}" style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-size:13px;font-weight:700;">예약 확인하기 →</a>
            </div>` : ''}

            ${type === 'approved' && booking.admin_name ? `
            <div style="margin:16px 0 0;padding:12px 16px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0;">
              <span style="font-size:12px;color:#166534;font-weight:600;">승인한 관리자</span>
              <div style="margin-top:8px;">${renderCreatorChip(booking.admin_name, '', booking.admin_avatar ?? null)}</div>
            </div>` : ''}

          </td>
        </tr>

        <!-- 푸터 -->
        <tr>
          <td style="padding:16px 32px 24px;border-top:1px solid #F1F5F9;">
            <p style="margin:0;font-size:11px;color:#9CA3AF;text-align:center;">
              이 메일은 C&R SPACE에서 자동 발송됩니다.<br>문의: 총무팀 (HR)
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
    created:          'Good',
    pending:          'Warning',
    approved:         'Good',
    rejected:         'Attention',
    cancelled:        'Default',
    noshow:           'Warning',
    updated:          'Default',
    pending_expiring: 'Warning',
    pending_expired:  'Attention',
  }
  const color = colorMap[type] ?? 'Default'

  const titleMap: Record<string, string> = {
    created:          '✅ 새 예약이 생성되었습니다',
    pending:          '📋 에메랄드 룸 승인 요청',
    approved:         '✅ 예약이 승인되었습니다',
    rejected:         '❌ 예약이 거절되었습니다',
    cancelled:        '❌ 예약이 취소되었습니다',
    noshow:           '⚠️ 노쇼 자동취소',
    updated:          '📝 예약이 변경되었습니다',
    pending_expiring: '⏰ 에메랄드 룸 승인 기한 10분 전',
    pending_expired:  '❌ 승인 기한 초과 — 자동 취소 처리됨',
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
              url: `${APP_URL}#admin-booking-${booking.id}`,
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

    const subject = getSubject(type, booking, false)  // 예약자용 제목 (참석자는 개별 발송 시 별도 적용)
    const results = []

    // ── Teams 알림 (비동기, 실패해도 이메일에 영향 없음) ────────────────────
    if (['created', 'approved', 'rejected', 'cancelled', 'noshow', 'updated', 'pending', 'pending_expiring', 'pending_expired'].includes(type)) {
      sendTeamsCard(type, booking).catch(() => {})
    }

    // ── pending: Admin(딥링크 포함) + 예약자 + 참석자 발송 ──────────────────
    if (type === 'pending') {
      const [adminEmails, creatorInfo, attendeeList] = await Promise.all([
        fetchAdminEmails(),
        booking.user_id ? fetchCreatorInfo(booking.user_id) : Promise.resolve(null),
        booking.id ? fetchAttendees(booking.id, booking.user_email ?? '') : Promise.resolve([]),
      ])
      const creatorEmail = creatorInfo?.email ?? booking.user_email ?? ''
      const filteredAttendeeList = attendeeList.filter(a => a.email !== creatorEmail)
      const pendingTasks: Promise<void>[] = []

      // Admin 전용 이메일 (딥링크 CTA + 관리자용 안내)
      if (adminEmails.length > 0) {
        const adminSubject = `[C&R SPACE · 관리자] 📋 에메랄드 룸 승인 요청 — ${booking.title}`
        const adminHtml = getEmailHtml(type, booking, false, [], '', creatorInfo, [], true)
        pendingTasks.push(
          sendEmail(adminEmails, adminSubject, adminHtml)
            .then(() => { results.push({ to: adminEmails, role: 'admins' }) })
            .catch(e => console.error('[notify] pending admin 발송 실패:', e))
        )
      } else {
        console.warn('[notify] pending: admin 이메일 없음 — profiles.role=ADMIN 확인 필요')
      }

      // 예약자 이메일 ("승인 요청 접수됨" 안내)
      if (creatorEmail) {
        const html = getEmailHtml(type, booking, false, filteredAttendeeList, '', creatorInfo, [], false)
        pendingTasks.push(
          sendEmail([creatorEmail], subject, html)
            .then(() => { results.push({ to: creatorEmail, role: 'creator' }) })
            .catch(e => console.error('[notify] pending 예약자 발송 실패:', e))
        )
      }

      // 참석자 이메일
      const attendeeSubject = getSubject(type, booking, true)
      for (const att of filteredAttendeeList) {
        const html = getEmailHtml(type, booking, true, filteredAttendeeList, att.name, creatorInfo, [], false)
        pendingTasks.push(
          sendEmail([att.email], attendeeSubject, html)
            .then(() => { results.push({ to: att.email, role: 'attendee' }) })
            .catch(e => console.error(`[notify] pending 참석자 발송 실패 (${att.email}):`, e))
        )
      }

      await Promise.allSettled(pendingTasks)
      console.log(`[notify] pending 발송 완료 — admin(${adminEmails.length}명) + 예약자(${creatorEmail || '없음'}) + 참석자(${filteredAttendeeList.length}명)`)
      return new Response(
        JSON.stringify({ success: true, sent: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── pending_expiring: Admin 전원에게만 발송 ──────────────────────────────
    if (type === 'pending_expiring') {
      const [adminEmails, expiringCreatorInfo] = await Promise.all([
        fetchAdminEmails(),
        booking.user_id ? fetchCreatorInfo(booking.user_id) : Promise.resolve(null),
      ])
      console.log('[notify] pending_expiring → admin 이메일:', adminEmails.length, '명')
      if (adminEmails.length > 0) {
        const html = getEmailHtml(type, booking, false, [], '', expiringCreatorInfo, [], true)
        await sendEmail(adminEmails, subject, html)
        results.push({ to: adminEmails, role: 'admins' })
      }
      return new Response(
        JSON.stringify({ success: true, sent: results.length, results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── pending_expired: Admin(별도 내용) + 예약자 + 참석자 발송 ─────────────
    if (type === 'pending_expired') {
      const [adminEmails, creatorInfo, attendeeList] = await Promise.all([
        fetchAdminEmails(),
        booking.user_id ? fetchCreatorInfo(booking.user_id) : Promise.resolve(null),
        booking.id ? fetchAttendees(booking.id, booking.user_email ?? '') : Promise.resolve([]),
      ])
      const creatorEmail = creatorInfo?.email ?? booking.user_email ?? ''
      const filteredAttendeeList = attendeeList.filter(a => a.email !== creatorEmail)
      const expiredTasks: Promise<void>[] = []

      // Admin 전용 이메일 (isAdminRecipient=true → 관리자용 안내 메시지)
      if (adminEmails.length > 0) {
        const adminSubject = `[C&R SPACE · 관리자] ❌ 승인 기한 초과 자동 취소 — ${booking.title}`
        const adminHtml = getEmailHtml(type, booking, false, [], '', creatorInfo, [], true)
        expiredTasks.push(
          sendEmail(adminEmails, adminSubject, adminHtml)
            .then(() => { results.push({ to: adminEmails, role: 'admins' }) })
            .catch(e => console.error('[notify] admin 발송 실패:', e))
        )
      }

      // 예약자 이메일
      if (creatorEmail) {
        const html = getEmailHtml(type, booking, false, filteredAttendeeList, '', creatorInfo, [])
        expiredTasks.push(
          sendEmail([creatorEmail], subject, html)
            .then(() => { results.push({ to: creatorEmail, role: 'creator' }) })
            .catch(e => console.error('[notify] 예약자 발송 실패:', e))
        )
      }

      // 참석자 개별 이메일
      const attendeeSubject = getSubject(type, booking, true)
      for (const att of filteredAttendeeList) {
        const html = getEmailHtml(type, booking, true, filteredAttendeeList, att.name, creatorInfo, [])
        expiredTasks.push(
          sendEmail([att.email], attendeeSubject, html)
            .then(() => { results.push({ to: att.email, role: 'attendee' }) })
            .catch(e => console.error(`[notify] 참석자 발송 실패 (${att.email}):`, e))
        )
      }

      await Promise.allSettled(expiredTasks)
      console.log(`[notify] pending_expired 발송 완료 — admin(${adminEmails.length}명) + 예약자(${creatorEmail || '없음'}) + 참석자(${filteredAttendeeList.length}명)`)
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

    // ── DB 조회 병렬 실행 (예약자 풀 정보 + 참석자 목록 동시 조회) ──────────
    const [creatorInfo, attendeeList] = await Promise.all([
      booking.user_id ? fetchCreatorInfo(booking.user_id) : Promise.resolve(null),
      booking.id ? fetchAttendees(booking.id, booking.user_email ?? '') : Promise.resolve([]),
    ])

    const creatorEmail = creatorInfo?.email ?? booking.user_email ?? ''
    if (!creatorEmail) {
      console.warn('[notify] 예약자 이메일 확인 불가 — user_id, user_email 모두 없거나 조회 실패')
    }

    // 참석자 목록에서 예약자 중복 제거
    const filteredAttendeeList = attendeeList.filter(a => a.email !== creatorEmail)

    // recurBookings: payload에 포함된 반복예약 전체 일정
    const recurBookings: { start_at: string; end_at: string }[] = booking.recurBookings ?? []

    // ── 이메일 발송 전체 병렬 실행 ──────────────────────────────────────────
    const sendTasks: Promise<void>[] = []

    // 예약자 발송
    if (creatorEmail) {
      const html = getEmailHtml(type, booking, false, filteredAttendeeList, '', creatorInfo, recurBookings)
      sendTasks.push(
        sendEmail([creatorEmail], subject, html)
          .then(() => { results.push({ to: creatorEmail, role: 'creator' }) })
          .catch(e => console.error('[notify] 예약자 발송 실패:', e))
      )
    }

    // 참석자 개별 발송 (이름 개인화 + 참석자 제목/배너)
    if (filteredAttendeeList.length > 0) {
      const attendeeSubject = getSubject(type, booking, true)
      for (const att of filteredAttendeeList) {
        const html = getEmailHtml(type, booking, true, filteredAttendeeList, att.name, creatorInfo, recurBookings)
        sendTasks.push(
          sendEmail([att.email], attendeeSubject, html)
            .then(() => { results.push({ to: att.email, role: 'attendee' }) })
            .catch(e => console.error(`[notify] 참석자 발송 실패 (${att.email}):`, e))
        )
      }
    }

    await Promise.allSettled(sendTasks)

    console.log(`[notify] ${type} 발송 완료 — 예약자(${creatorEmail || '없음'}) + 참석자 ${filteredAttendeeList.length}명`)

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
