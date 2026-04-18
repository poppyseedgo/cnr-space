// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Supabase Cron으로 매 5분 실행 (2026-04-17 최적화)
 *
 * 처리 항목:
 *   1. 노쇼 자동 취소   — confirmed 예약 중 start_at + 10분 초과 & 미체크인
 *   2. 승인 기한 10분 전 알림 — pending 예약 start_at 9~11분 전 (Admin 알림)
 *   3. 승인 기한 초과 자동 취소 — pending 예약 start_at 1분 전까지 미승인 시 자동 취소
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2025-04-xx] 초기 버전
 *   · pending_expiring: 승인 기한 10분 전 Admin 알림 추가
 *   · pending_expired:  승인 기한 초과 자동 취소 + Admin/예약자/참석자 알림
 *   · approval_reminder_sent 플래그로 중복 방지
 *
 * [2026-04-17] Disk IO 최적화
 *   · start_at 쿼리에 lower bound 추가 (full scan 방지)
 *   · 실행 주기 1분 → 5분
 *   · pg_cron 13번 job (auto-cancel-bookings) 유효
 *
 * [2026-04-18 P2] 중복 인앱 알림 제거 — 320줄 → ~200줄 (38% 축소)
 *   · 기존 문제: callSendNotification() 후에 직접 insertInAppNotification() 중복 호출
 *     → 사용자 인앱 벨에 같은 알림이 2번 쌓임
 *   · 원인: 배송 2에서 send-notification이 인앱 INSERT를 담당하게 되었는데
 *     auto-cancel은 그 전 구조(이메일/인앱 분리)를 유지
 *   · 해결: auto-cancel은 이제 DB 상태 업데이트 + send-notification 호출만.
 *     인앱 알림은 send-notification 내부의 sendInAppForAllRoles가 전담.
 *   · 제거된 헬퍼: insertInAppNotification, fetchAdminUserIds, fetchAttendeeUserIds
 *   · 인앱 중복 INSERT 근본 제거
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙
 * ═══════════════════════════════════════════════════════════════════════════
 *   · send-notification 호출 시 Bearer: ANON_KEY 사용 (SERVICE_KEY X)
 *
 * Cron: 매 5분 (pg_cron job id=13)
 * 배포: supabase functions deploy auto-cancel-bookings --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

// ═══════════════════════════════════════════════════════════════════════════
// 환경변수
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// ← [CRITICAL] send-notification 호출 시 SERVICE_KEY 아닌 ANON_KEY 사용
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')         ?? ''

// DB 조작: SERVICE_KEY (bookings UPDATE 권한 필요)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ═══════════════════════════════════════════════════════════════════════════
// send-notification 호출 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * send-notification Edge Function 호출
 * · Edge Function 간 호출은 ANON_KEY Bearer 필수 (SERVICE_KEY 시 401)
 * · send-notification이 이메일 + 인앱 + Teams 모두 담당
 * · 실패해도 throw 안 함 (warn 로그만) — cron 전체 실행 중단 방지
 */
async function callSendNotification(type: string, booking: any): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,   // ← [CRITICAL] ANON_KEY 사용
        'apikey':        ANON_KEY,
      },
      body: JSON.stringify({ type, booking }),
    })
    if (!res.ok) {
      console.warn(`[auto-cancel] send-notification(${type}) 실패 [${res.status}]:`, await res.text())
    }
  } catch (e: any) {
    console.warn(`[auto-cancel] send-notification(${type}) 호출 오류:`, e?.message ?? String(e))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 예약 페이로드 조립 (DB row → send-notification 입력 형식)
// ═══════════════════════════════════════════════════════════════════════════

async function getRoomName(roomId: string): Promise<string> {
  const { data } = await supabase
    .from('rooms')
    .select('room_name, room_name_ko')
    .eq('room_id', roomId)
    .single()
  return data?.room_name_ko ?? data?.room_name ?? String(roomId)
}

async function buildPayload(booking: any): Promise<any> {
  const roomName = await getRoomName(booking.room_id)
  return {
    ...booking,
    user_name: booking.user_name ?? '',
    user_dept: booking.user_dept ?? '',
    room_name: roomName,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }

  try {
    const now = new Date()
    const stats = { noshow: 0, reminderSent: 0, pendingExpired: 0 }

    // ─── 1. 노쇼 자동 취소 ──────────────────────────────────────────────
    // confirmed 예약 중 (start_at + 10분)이 현재보다 이전 & 미체크인
    // ← [2026-04-17] start_at lower bound로 full scan 방지 (과거 1시간까지만)
    const noshowCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const noshowLowerBound = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

    const { data: noshowTargets, error: noshowErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',         'confirmed')
      .eq('checked_in',     false)
      .eq('auto_cancelled', false)
      .gte('start_at',      noshowLowerBound)
      .lt('start_at',       noshowCutoff)

    if (noshowErr) {
      console.error('[auto-cancel] noshow 조회 실패:', noshowErr)
    }

    for (const booking of (noshowTargets ?? [])) {
      const { error: upErr } = await supabase
        .from('bookings')
        .update({ auto_cancelled: true, cancelled_by: 'system' })
        .eq('id', booking.id)

      if (upErr) {
        console.error(`[auto-cancel] noshow 업데이트 실패 (${booking.id}):`, upErr)
        continue
      }

      // ← [P2] 이메일 + 인앱 알림 모두 send-notification이 담당
      //        (기존 insertInAppNotification 중복 호출 제거)
      const payload = await buildPayload(booking)
      await callSendNotification('noshow', payload)

      stats.noshow++
      console.log(`[auto-cancel] noshow 처리: ${booking.id} (${booking.title})`)
    }

    // ─── 2. 승인 기한 10분 전 알림 (Admin 전용) ────────────────────────
    // ← [2026-04-17] start_at 범위 양방향 제한
    const reminderWindowStart = new Date(now.getTime() + 9  * 60 * 1000).toISOString()
    const reminderWindowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

    const { data: reminderTargets, error: reminderErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',                 'pending')
      .eq('approval_reminder_sent', false)
      .gte('start_at', reminderWindowStart)
      .lte('start_at', reminderWindowEnd)

    if (reminderErr) {
      console.error('[auto-cancel] pending_expiring 조회 실패:', reminderErr)
    }

    for (const booking of (reminderTargets ?? [])) {
      // 중복 발송 방지 플래그 먼저 세팅 (알림 실패해도 재발송 없음 — 의도된 설계)
      const { error: flagErr } = await supabase
        .from('bookings')
        .update({ approval_reminder_sent: true })
        .eq('id', booking.id)

      if (flagErr) {
        console.error(`[auto-cancel] approval_reminder_sent 업데이트 실패 (${booking.id}):`, flagErr)
        continue
      }

      // ← [P2] Admin 인앱 알림은 send-notification 내부에서 담당 (중복 제거)
      const payload = await buildPayload(booking)
      await callSendNotification('pending_expiring', payload)

      stats.reminderSent++
      console.log(`[auto-cancel] pending_expiring 발송: ${booking.id} (${booking.title})`)
    }

    // ─── 3. 승인 기한 초과 자동 취소 ───────────────────────────────────
    // pending 예약 중 start_at이 현재+1분 이내면 자동 취소 (승인 안 됨)
    // ← [2026-04-17] start_at lower bound 추가 (과거 1시간만 스캔)
    const expireDeadline     = new Date(now.getTime() + 1 * 60 * 1000).toISOString()
    const expireLowerBound   = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

    const { data: expiredTargets, error: expiredErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',         'pending')
      .eq('auto_cancelled', false)
      .gte('start_at',      expireLowerBound)
      .lt('start_at',       expireDeadline)

    if (expiredErr) {
      console.error('[auto-cancel] pending_expired 조회 실패:', expiredErr)
    }

    for (const booking of (expiredTargets ?? [])) {
      // ← [CRITICAL] pending_expired는 status를 cancelled로 저장해야 함
      //    (BookingStatusBadge 로직: status==='cancelled' && auto_cancelled && cancelled_by==='system')
      const { error: upErr } = await supabase
        .from('bookings')
        .update({
          status:         'cancelled',
          auto_cancelled: true,
          cancelled_by:   'system',
        })
        .eq('id', booking.id)

      if (upErr) {
        console.error(`[auto-cancel] pending_expired 업데이트 실패 (${booking.id}):`, upErr)
        continue
      }

      // ← [P2] 이메일 + 인앱 모두 send-notification이 담당
      //        기존 3중 INSERT (Admin/예약자/참석자) 모두 제거됨
      //        POLICIES.pending_expired: recipients=booker_attendees_admins
      const payload = await buildPayload(booking)
      await callSendNotification('pending_expired', payload)

      stats.pendingExpired++
      console.log(`[auto-cancel] pending_expired 처리: ${booking.id} (${booking.title})`)
    }

    console.log('[auto-cancel] 전체 완료:', JSON.stringify(stats))
    return new Response(
      JSON.stringify({ success: true, ...stats, at: now.toISOString() }),
      { headers: corsHeaders }
    )

  } catch (err: any) {
    console.error('[auto-cancel] 예기치 못한 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
