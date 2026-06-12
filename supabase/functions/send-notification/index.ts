// @ts-nocheck
/**
 * send-notification Edge Function
 * C&R Space 알림 시스템 — 이메일 + 인앱 + Teams 통합 발송 진입점
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2026-06-12] 예약자(소유권) 변경 알림 2종 지원 (owner_changed / former_booker)
 *   · resolveRecipients 호출에 formerBookerUserId 전달
 *   · buildEmailItems: formerBooker 수신자 이메일 렌더 분기(role='booker') 추가
 *   · sendInAppForAllRoles: formerBooker 인앱 발송(role='booker') 추가
 *   · Teams colorMap/titleMap/teamsTargetTypes에 owner_changed 추가 (former_booker는 Teams 제외)
 *
 * [2025-04-13] 초기 버전
 *   1. pending 타입 — profiles 테이블에서 admin 이메일 직접 조회 (프론트 의존 제거)
 *   2. user_email 누락 시 user_id → profiles 자동 조회
 *   3. FROM_EMAIL 환경변수화 (커스텀 도메인 지원)
 *   4. APP_URL 기본값 cnr-space.pages.dev로 수정
 *
 * [2026-04-18 P2] 전면 리팩토링 — 781줄 → ~280줄 (64% 축소)
 *   · 5개 _shared 공용 헬퍼로 로직 분리:
 *       - notification-types.ts  : 14개 이벤트 정책
 *       - email-templates.ts     : Figma 기반 HTML 렌더링
 *       - email-sender.ts        : Resend Batch API + 재시도
 *       - notification-inapp.ts  : 인앱 알림 INSERT
 *       - recipient-resolver.ts  : 수신자 통합 조회
 *   · 이벤트별 분기(6개) → 정책 기반 단일 로직으로 통합
 *   · Resend rate_limit 근본 해결: 수신자 N명 → Batch 1회 호출
 *   · 인앱 알림 발송 로직 추가 (기존엔 일부만 프론트에서 처리)
 *   · Teams Adaptive Card 발송은 그대로 유지
 *   · 제목 포맷 변경: "[C&R SPACE] ✅ 예약 확정 — ..." → "[예약확정]  ..."
 *     (notification-types.getSubject() 참조)
 *
 * [2026-05-12] APP_URL fallback 운영 도메인으로 변경
 *   · cnr-space.pages.dev (Cloudflare Pages 기본 도메인) → space.cnrres.com (운영)
 *   · 환경변수 APP_URL이 설정된 경우 그쪽이 우선 (fallback은 안전망)
 *   · 영향 범위: 모든 메일 CTA 버튼 URL, appUrl로 전달되는 모든 링크
 *   · 배포 동기화: supabase secrets set APP_URL=https://space.cnrres.com 권장
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙 (CRITICAL — 위반 시 401 발생)
 * ═══════════════════════════════════════════════════════════════════════════
 *   · 반드시 --no-verify-jwt 플래그로 배포 (아래 "배포 방법" 참조)
 *   · Edge Function → Edge Function HTTP 호출은 ANON_KEY Bearer (SERVICE_KEY X)
 *   · 이 파일 자체는 외부/프론트에서 직접 호출되므로 JWT 검증 없음이 맞음
 *
 * 배포 방법:
 *   supabase functions deploy send-notification --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  POLICIES,
  getSubject,
  type NotificationType,
  type RecipientRule,
} from '../_shared/notification-types.ts'
import {
  renderEmail,
  type EmailRenderInput,
  type EmailBookingData,
  type EmailCreatorInfo,
  type EmailAttendee,
} from '../_shared/email-templates.ts'
import {
  sendEmails,
  type EmailItem,
} from '../_shared/email-sender.ts'
import {
  insertInAppBulk,
  type InAppBookingData,
} from '../_shared/notification-inapp.ts'
import {
  resolveRecipients,
  type Person,
  type ResolvedRecipients,
} from '../_shared/recipient-resolver.ts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 환경변수
// ═══════════════════════════════════════════════════════════════════════════

// ← [2026-05-12] APP_URL fallback 변경: cnr-space.pages.dev → space.cnrres.com (운영 도메인)
//   배경: 메일 링크 클릭 시 Cloudflare Pages 기본 도메인(cnr-space.pages.dev)으로 연결되어
//         사용자가 어색한 URL을 보게 됨. 운영 커스텀 도메인 space.cnrres.com 으로 통일.
//   환경변수 APP_URL이 설정되어 있으면 그쪽이 우선 — Secrets에도 동일 값 설정 권장.
//   배포 후 다음 명령으로 Secrets 동기화:
//     supabase secrets set APP_URL=https://space.cnrres.com
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://space.cnrres.com'
const TEAMS_WEBHOOK_URL = Deno.env.get('TEAMS_WEBHOOK_URL') ?? ''

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Supabase client (Service Role Key — profiles/booking_attendees/notifications 조작 권한 필요)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Teams Adaptive Card 발송 (기존 로직 유지 — P2 범위 외)
// ═══════════════════════════════════════════════════════════════════════════

async function sendTeamsCard(type: string, booking: any): Promise<void> {
  if (!TEAMS_WEBHOOK_URL) return

  const colorMap: Record<string, string> = {
    created:          'Good',
    created_on_behalf:'Good',     // ← [2026-06-12] 대리 예약
    pending:          'Warning',
    approved:         'Good',
    rejected:         'Attention',
    cancelled:        'Default',
    noshow:           'Warning',
    updated:          'Default',
    owner_changed:    'Default',   // ← [2026-06-12] 예약자 변경
    pending_expiring: 'Warning',
    pending_expired:  'Attention',
  }
  const color = colorMap[type] ?? 'Default'

  const titleMap: Record<string, string> = {
    created:          '✅ 새 예약이 생성되었습니다',
    created_on_behalf:'✅ 관리자 대리 예약이 생성되었습니다',   // ← [2026-06-12]
    pending:          '📋 에메랄드 룸 승인 요청',
    approved:         '✅ 예약이 승인되었습니다',
    rejected:         '❌ 예약이 거절되었습니다',
    cancelled:        '❌ 예약이 취소되었습니다',
    noshow:           '⚠️ 노쇼 자동취소',
    updated:          '📝 예약이 변경되었습니다',
    owner_changed:    '🔁 예약자가 변경되었습니다',   // ← [2026-06-12]
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
            }],
          },
          {
            type: 'FactSet',
            facts: [
              { title: '회의명', value: booking.title ?? '-' },
              { title: '회의실', value: booking.room_name ?? '-' },
              { title: '날짜',   value: booking.start_at ? booking.start_at.slice(0, 10) : '-' },
              { title: '시간',   value: booking.start_at && booking.end_at
                  ? `${booking.start_at.slice(11, 16)} ~ ${booking.end_at.slice(11, 16)}`
                  : '-' },
              { title: '예약자', value: `${booking.user_name ?? '-'} (${booking.user_dept ?? '-'})` },
              ...(booking.reject_reason ? [{ title: '거절 사유', value: booking.reject_reason }] : []),
            ],
          },
          ...(type === 'pending' ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '승인 관리 페이지로 이동',
              url: `${APP_URL}#admin-booking-${booking.id}`,
            }],
          }] : []),
          ...((type === 'created' || type === 'approved') ? [{
            type: 'ActionSet',
            actions: [{
              type: 'Action.OpenUrl',
              title: '예약 확인하기',
              url: APP_URL,
            }],
          }] : []),
        ],
        '$version': '1.0',
      },
    }],
  }

  try {
    const res = await fetch(TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    })
    if (!res.ok) {
      console.warn('[notify] Teams 발송 실패:', res.status, await res.text())
    }
  } catch (e) {
    console.warn('[notify] Teams 발송 오류 (이메일은 정상):', e)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 헬퍼 — Person[]을 EmailAttendee[]로 변환
// ═══════════════════════════════════════════════════════════════════════════

function toEmailAttendees(persons: Person[]): EmailAttendee[] {
  return persons
    .filter(p => !!p.email)
    .map(p => ({
      email:      p.email,
      name:       p.name,
      dept:       p.dept,
      avatar_url: p.avatar_url,
    }))
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 헬퍼 — 이메일 아이템 리스트 생성 (역할별 개인화)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 역할(booker/attendee/admin)별로 렌더 입력을 만들어 이메일 아이템으로 변환
 * · 각 수신자마다 role에 맞는 subject + html 생성
 * · sendEmails() batch API로 한 번에 발송
 */
function buildEmailItems(
  type: NotificationType,
  bookingData: EmailBookingData,
  recipients: ResolvedRecipients,
  attendeeList: EmailAttendee[],        // 공통 참석자 목록 (이메일 본문에 표시될 참석자 칩)
  recurBookings: { start_at: string; end_at: string }[],
): EmailItem[] {
  const items: EmailItem[] = []

  // creatorInfo: 본문에 예약자 정보 표시용 (Person → EmailCreatorInfo 변환)
  const creatorInfo: EmailCreatorInfo | null = recipients.booker ? {
    email:      recipients.booker.email,
    name:       recipients.booker.name,
    dept:       recipients.booker.dept,
    avatar_url: recipients.booker.avatar_url,
  } : null

  // 공통 렌더 입력 일부
  const baseInput = {
    type,
    booking:       bookingData,
    creatorInfo,
    recurBookings,
    appUrl:        APP_URL,
  }

  // ── 예약자 ──────────────────────────────────────────────────────
  if (recipients.booker?.email) {
    const role = 'booker' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: recipients.booker.name,
      attendeeList,                 // 예약자 본문엔 "참석자 N명" 전체 노출
    })
    items.push({
      to:      recipients.booker.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── 참석자 (개별 개인화) ────────────────────────────────────────
  for (const att of recipients.attendees) {
    if (!att.email) continue
    const role = 'attendee' as const
    // ← [2026-04-29] 본인 filter 제거 — 참석자도 전체 참석자 목록(본인 포함) 표시
    //   기존: attendeeList.filter(본인 제외) → 본인이 빠진 목록 or 1인일 때 목록 자체 미노출
    //   수정: attendeeList 그대로 전달 (예약자 메일과 동일하게 전체 참석자 노출)
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: att.name,
      attendeeList,
    })
    items.push({
      to:      att.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── 관리자 ──────────────────────────────────────────────────────
  for (const adm of recipients.admins) {
    if (!adm.email) continue
    const role = 'admin' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: adm.name,
      attendeeList,                 // 관리자도 전체 참석자 노출
    })
    items.push({
      to:      adm.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── removed_attendees (예외 케이스) ──────────────────────────────
  for (const rm of recipients.removedAttendees) {
    if (!rm.email) continue
    const role = 'attendee' as const  // removed도 attendee 역할로 렌더 (하지만 getSubject는 'attendee_removed' 예외 처리됨)
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: rm.name,
      attendeeList:  [],             // 참석자 명단은 비움 (제외된 입장)
    })
    items.push({
      to:      rm.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  // ── former_booker (예약자 변경 시 원래 예약자) ──────────────────
  // ← [2026-06-12] role='booker'로 렌더 — former_booker 정책의 booker 배너/제목 사용
  //   ("회의 예약자에서 변경되었습니다"). 참석자 명단은 비움(더 이상 본인 예약 아님).
  if (recipients.formerBooker?.email) {
    const role = 'booker' as const
    const html = renderEmail({
      ...baseInput,
      role,
      recipientName: recipients.formerBooker.name,
      attendeeList:  [],
    })
    items.push({
      to:      recipients.formerBooker.email,
      subject: getSubject(type, bookingData.title, role),
      html,
    })
  }

  return items
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 헬퍼 — 인앱 알림 일괄 발송 (역할별)
// ═══════════════════════════════════════════════════════════════════════════

async function sendInAppForAllRoles(
  type: NotificationType,
  bookingData: InAppBookingData,
  recipients: ResolvedRecipients,
): Promise<void> {
  const bookerId      = recipients.booker?.user_id ? [recipients.booker.user_id] : []
  const attendeeIds   = recipients.attendees.map(p => p.user_id).filter(Boolean)
  const adminIds      = recipients.admins.map(p => p.user_id).filter(Boolean)
  const removedIds    = recipients.removedAttendees.map(p => p.user_id).filter(Boolean)
  // ← [2026-06-12] former_booker 인앱 수신자 (원래 예약자 1명)
  const formerBookerId = recipients.formerBooker?.user_id ? [recipients.formerBooker.user_id] : []

  // 각 역할에 맞는 제목이 정책에 있으면 INSERT, 없으면 insertInAppBulk 내부에서 자동 스킵
  const tasks: Promise<any>[] = [
    insertInAppBulk(supabase, bookerId,    type, 'booker',   bookingData),
    insertInAppBulk(supabase, attendeeIds, type, 'attendee', bookingData),
    insertInAppBulk(supabase, adminIds,    type, 'admin',    bookingData),
    // removed_attendees도 attendee 역할로 알림 (정책: attendee_removed만 해당)
    insertInAppBulk(supabase, removedIds,  type, 'attendee', bookingData),
    // ← [2026-06-12] former_booker는 booker 역할로 알림 (정책: former_booker만 해당)
    //   former_booker 정책의 inappTitleBooker("회의 예약자에서 변경되었습니다") 사용
    insertInAppBulk(supabase, formerBookerId, type, 'booker', bookingData),
  ]

  await Promise.allSettled(tasks)
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

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
    const payload = await req.json()
    const { type, booking } = payload

    if (!type || !booking) {
      return new Response(JSON.stringify({ error: 'type, booking 필수' }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // 정책 조회 — 미지원 타입이면 400 반환
    const policy = POLICIES[type as NotificationType]
    if (!policy) {
      console.warn(`[notify] 미지원 type: ${type}`)
      return new Response(JSON.stringify({ error: `지원하지 않는 type: ${type}` }), {
        status: 400,
        headers: corsHeaders,
      })
    }

    // ── Teams 알림 (비동기, 실패해도 이메일에 영향 없음) ─────────────
    // checkin_* / daily_reminder / attendee_removed 는 Teams 발송 대상 아님
    const teamsTargetTypes = [
      'created', 'pending', 'updated', 'cancelled', 'rejected',
      'approved', 'noshow', 'pending_expiring', 'pending_expired',
      'owner_changed',   // ← [2026-06-12] 예약자 변경 (former_booker는 Teams 제외 — attendee_removed와 동일)
      'created_on_behalf',  // ← [2026-06-12] 대리 예약
    ]
    if (teamsTargetTypes.includes(type)) {
      sendTeamsCard(type, booking).catch(() => {})
    }

    // ── 수신자 조회 (정책 기반 RecipientRule 사용) ───────────────────
    const recipients = await resolveRecipients(supabase, {
      rule:          policy.recipients,
      bookerUserId:  booking.user_id,
      bookingId:     booking.id,
      removedEmails: booking.removed_emails ?? [],   // attendee_removed 전용
      // ← [2026-06-12] former_booker 전용 — 원래 예약자 user_id
      formerBookerUserId: booking.former_booker_user_id,
    })

    // ── 이메일 본문용 참석자 목록 생성 ────────────────────────────────
    // 참석자/관리자 렌더에도 "참석자 N명"이 보여야 하므로 공통 리스트 구성
    // (removed_attendees 제외 — 이 경우 참석자는 본인만이라 명단 표시 안 함)
    const attendeeListForEmail: EmailAttendee[] =
      policy.recipients === 'removed_attendees'
        ? []
        : toEmailAttendees(recipients.attendees)

    // ── EmailBookingData 구성 (렌더 입력용) ──────────────────────────
    // 기존 payload의 필드명과 email-templates의 인터페이스 매핑
    const bookingData: EmailBookingData = {
      id:            booking.id,
      title:         booking.title ?? '',
      memo:          booking.memo,
      start_at:      booking.start_at,
      end_at:        booking.end_at,
      room_name:     booking.room_name ?? '',
      user_name:     recipients.booker?.name ?? booking.user_name ?? '',
      user_dept:     recipients.booker?.dept ?? booking.user_dept ?? '',
      admin_name:    booking.admin_name,
      admin_avatar:  booking.admin_avatar,
      admin_force:   booking.admin_force,
      cancel_reason: booking.cancel_reason,
      reject_reason: booking.reject_reason,
      recur_label:   booking.recur_label,
    }

    const recurBookings: { start_at: string; end_at: string }[] = booking.recurBookings ?? []

    // ── 이메일 아이템 리스트 생성 ────────────────────────────────────
    const emailItems = buildEmailItems(
      type as NotificationType,
      bookingData,
      recipients,
      attendeeListForEmail,
      recurBookings,
    )

    // ── 이메일 발송 (Batch API 1회 호출로 모두 발송) ─────────────────
    const emailResult = await sendEmails(emailItems)

    // ── 인앱 알림 발송 (정책에 정의된 역할만 자동 INSERT) ────────────
    const inAppBooking: InAppBookingData = {
      id:        bookingData.id,
      title:     bookingData.title,
      room_name: bookingData.room_name,
      start_at:  bookingData.start_at,
      user_name: bookingData.user_name,
    }
    // 인앱 알림은 이메일과 독립적으로 진행 (await하지 않고 Promise.allSettled 안에서)
    await sendInAppForAllRoles(type as NotificationType, inAppBooking, recipients)

    console.log(
      `[notify] ${type} 완료 — 이메일 ${emailResult.succeeded}/${emailResult.total}${
        emailResult.failed > 0 ? ` (${emailResult.failed} 실패)` : ''
      }${emailResult.rateLimited ? ' [RATE_LIMITED]' : ''}`
    )

    return new Response(
      JSON.stringify({
        success:     emailResult.failed === 0,
        type,
        emailSent:   emailResult.succeeded,
        emailFailed: emailResult.failed,
        rateLimited: emailResult.rateLimited,
        results:     emailResult.results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[notify] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
