// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Supabase Cron으로 실행 (매 1분)
 *
 * 처리 항목:
 * 1. 노쇼 자동 취소   — confirmed 예약 중 start_at + 10분 초과 & 미체크인
 * 2. 승인 기한 10분 전 알림 — pending 예약 start_at 9~11분 전 (Admin 알림)
 * 3. 승인 기한 초과 자동 취소 — pending 예약 start_at 1분 전까지 미승인 시 자동 취소
 *
 * ✅ 수정 내역 (2025-04-xx):
 *   - pending_expiring: 승인 기한 10분 전 Admin 알림 추가
 *   - pending_expired:  승인 기한 초과 자동 취소 + Admin/예약자/참석자 알림 추가
 *   - approvalReminderSent 플래그로 10분 알림 중복 방지
 *   - DB 컬럼명 snake_case 정확히 적용 (checked_in, auto_cancelled, cancelled_by, approval_reminder_sent)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')         ?? ''

// DB 조작: SERVICE_KEY (Service Role Key)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── send-notification 호출 헬퍼 ──────────────────────────────────────────────
// ⚠️ Edge Function → Edge Function 호출 시 반드시 ANON_KEY 사용
//    SERVICE_KEY를 Bearer로 쓰면 API Gateway에서 JWT 파싱 오류(401) 발생
//    send-notification은 verify_jwt:false 이므로 ANON_KEY로 충분
async function callSendNotification(type: string, booking: any): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey':        ANON_KEY,
      },
      body: JSON.stringify({ type, booking }),
    })
    if (!res.ok) {
      console.error(`[auto-cancel] send-notification(${type}) 실패:`, res.status, await res.text())
    }
  } catch (e) {
    console.error(`[auto-cancel] send-notification(${type}) 호출 오류:`, e)
  }
}

// ── 회의실 이름 조회 헬퍼 ────────────────────────────────────────────────────
async function getRoomName(roomId: string): Promise<string> {
  const { data } = await supabase
    .from('rooms')
    .select('room_name, room_name_ko')
    .eq('room_id', roomId)
    .single()
  return data?.room_name_ko ?? data?.room_name ?? String(roomId)
}

// ── 예약 페이로드 조립 ────────────────────────────────────────────────────────
// DB에서 온 booking row → send-notification이 기대하는 필드명으로 정규화
// DB 컬럼: user_name, user_dept (api.ts bookingToRow 기준)
async function buildPayload(booking: any): Promise<any> {
  const roomName = await getRoomName(booking.room_id)
  return {
    ...booking,
    user_name: booking.user_name ?? '',
    user_dept: booking.user_dept ?? '',
    room_name: roomName,
  }
}

// ── 메인 핸들러 ──────────────────────────────────────────────────────────────
Deno.serve(async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }

  try {
    const now = new Date()
    const stats = { noshow: 0, reminderSent: 0, pendingExpired: 0 }

    // ─── 1. 노쇼 자동 취소 ──────────────────────────────────────────────────
    // confirmed 예약 중 (start_at + 10분) 이 현재보다 이전 & 미체크인 & 아직 취소 안 된 것
    const noshowCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString()

    const { data: noshowTargets, error: noshowErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status', 'confirmed')
      .eq('checked_in', false)
      .eq('auto_cancelled', false)
      .lt('start_at', noshowCutoff)

    if (noshowErr) {
      console.error('[auto-cancel] noshow 조회 실패:', noshowErr)
    }

    for (const booking of (noshowTargets ?? [])) {
      // DB 업데이트 — 노쇼 취소 처리
      const { error: upErr } = await supabase
        .from('bookings')
        .update({ auto_cancelled: true, cancelled_by: 'system' })
        .eq('id', booking.id)

      if (upErr) {
        console.error(`[auto-cancel] noshow 업데이트 실패 (${booking.id}):`, upErr)
        continue
      }

      // 알림 발송
      const payload = await buildPayload(booking)
      await callSendNotification('noshow', payload)
      stats.noshow++
      console.log(`[auto-cancel] noshow 처리: ${booking.id} (${booking.title})`)
    }

    // ─── 2. 승인 기한 10분 전 알림 ──────────────────────────────────────────
    // pending 예약 중 start_at이 9~11분 후 & 아직 알림 미발송
    const reminderWindowStart = new Date(now.getTime() + 9  * 60 * 1000).toISOString()
    const reminderWindowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

    const { data: reminderTargets, error: reminderErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status', 'pending')
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

      const payload = await buildPayload(booking)
      await callSendNotification('pending_expiring', payload)
      stats.reminderSent++
      console.log(`[auto-cancel] pending_expiring 발송: ${booking.id} (${booking.title})`)
    }

    // ─── 3. 승인 기한 초과 자동 취소 ────────────────────────────────────────
    // pending 예약 중 start_at이 현재로부터 1분 이내 (= 1분 후도 아직 안 지난 것 포함)
    // → 예약 시작 1분 전까지 승인 안 됐으면 시스템 자동 취소
    const expireDeadline = new Date(now.getTime() + 1 * 60 * 1000).toISOString()

    const { data: expiredTargets, error: expiredErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status', 'pending')
      .eq('auto_cancelled', false)
      .lt('start_at', expireDeadline)

    if (expiredErr) {
      console.error('[auto-cancel] pending_expired 조회 실패:', expiredErr)
    }

    for (const booking of (expiredTargets ?? [])) {
      // DB 업데이트 — pending_expired 취소 처리
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

      // 알림 발송 (Admin + 예약자 + 참석자 — send-notification 내부에서 분기 처리)
      const payload = await buildPayload(booking)
      await callSendNotification('pending_expired', payload)
      stats.pendingExpired++
      console.log(`[auto-cancel] pending_expired 처리: ${booking.id} (${booking.title})`)
    }

    // ─── 완료 ────────────────────────────────────────────────────────────────
    console.log('[auto-cancel] 전체 완료:', JSON.stringify(stats))
    return new Response(
      JSON.stringify({ success: true, ...stats }),
      { headers: corsHeaders }
    )

  } catch (err: any) {
    console.error('[auto-cancel] 예기치 못한 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
