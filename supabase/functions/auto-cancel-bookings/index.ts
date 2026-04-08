// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Cron: 매 5분
 * 역할: 예약 시작 후 10분 경과, 체크인 없는 예약 자동 취소 (노쇼)
 *
 * [변경 사항]
 * - send-notification 호출 시 user_email 제거 (Edge Fn이 DB에서 직접 조회)
 * - 참석자 인앱 알림 추가 (booking_attendees 테이블 조회)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKIN_GRACE_MINUTES = 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey',
      },
    })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const nowUTC      = new Date()
    const nowKST      = new Date(nowUTC.getTime() + 9 * 60 * 60 * 1000)
    const graceCutoff = new Date(nowUTC.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000)

    // ── 자동취소 대상 조회 ────────────────────────────────────────────────────
    const { data: toCancel, error: fetchError } = await supabase
      .from('bookings')
      .select('id, title, user_id, user_name, user_dept, room_name, start_at, end_at')
      .eq('checked_in',     false)
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .lte('start_at', graceCutoff.toISOString())
      .gte('end_at',   nowUTC.toISOString())

    if (fetchError) throw fetchError

    if (!toCancel || toCancel.length === 0) {
      return new Response(
        JSON.stringify({ message: '자동취소 대상 없음', timestamp: nowKST.toISOString() }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // ── 일괄 취소 ────────────────────────────────────────────────────────────
    const ids = toCancel.map(b => b.id)
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ auto_cancelled: true, cancelled_by: 'system' })
      .in('id', ids)

    if (updateError) throw updateError
    console.log(`[auto-cancel] ${toCancel.length}건 자동취소:`, ids)

    // ── 각 건별 후처리: Audit log + 인앱 알림 + 이메일 알림 ─────────────────
    for (const b of toCancel) {
      // KST 시간 포맷 (인앱 알림 body용)
      const d = new Date(b.start_at)
      const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const pad = n => String(n).padStart(2, '0')
      const h = k.getUTCHours()
      const dateStr = `${k.getUTCFullYear()}년 ${k.getUTCMonth()+1}월 ${k.getUTCDate()}일`
      const timeStr = `${h < 12 ? '오전' : '오후'} ${h === 0 ? 12 : h > 12 ? h - 12 : h}:${pad(k.getUTCMinutes())}`
      const inappBody = `${b.title} · ${b.room_name ?? ''} · ${dateStr} ${timeStr}`

      // Audit log
      try {
        await supabase.from('audit_log').insert({
          actor_id:    null,
          actor_name:  'system',
          action:      'BOOKING_NOSHOW',
          entity_type: 'booking',
          entity_id:   b.id,
          before_data: null,
          after_data:  { title: b.title, user_name: b.user_name, start_at: b.start_at, cancelled_by: 'system' },
        })
      } catch (e) {
        console.warn('[auto-cancel] audit_log 실패 (취소는 정상):', e)
      }

      // 예약자 인앱 알림
      if (b.user_id) {
        try {
          await supabase.from('notifications').insert({
            user_id:    b.user_id,
            type:       'booking_noshow',
            title:      '노쇼 처리 — 예약이 자동 취소되었습니다',
            body:       inappBody,
            booking_id: b.id,
            is_read:    false,
          })
        } catch (e) {
          console.warn('[auto-cancel] 예약자 인앱 알림 실패:', e)
        }
      }

      // 참석자 인앱 알림 (booking_attendees 테이블에서 조회)
      try {
        const { data: attendeeRows } = await supabase
          .from('booking_attendees')
          .select('user_id, email')
          .eq('booking_id', b.id)

        for (const att of attendeeRows ?? []) {
          if (!att.user_id) continue  // user_id 없으면 인앱 알림 불가 (이메일은 send-notification이 처리)
          await supabase.from('notifications').insert({
            user_id:    att.user_id,
            type:       'booking_noshow',
            title:      '참석 예약이 자동 취소되었습니다',
            body:       inappBody,
            booking_id: b.id,
            is_read:    false,
          })
        }
      } catch (e) {
        console.warn('[auto-cancel] 참석자 인앱 알림 실패 (취소는 정상):', e)
      }

      // 이메일 알림 — send-notification Edge Fn 호출
      // booking.user_id와 booking.id만 전달하면
      // send-notification이 DB에서 예약자·참석자 이메일을 직접 조회해 발송
      try {
        await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              type: 'noshow',
              booking: {
                id:        b.id,
                user_id:   b.user_id,
                title:     b.title,
                user_name: b.user_name,
                user_dept: b.user_dept ?? '',
                room_name: b.room_name ?? '',
                start_at:  b.start_at,
                end_at:    b.end_at,
              },
            }),
          }
        )
      } catch (e) {
        console.warn('[auto-cancel] 노쇼 이메일 알림 실패 (취소는 정상):', e)
      }
    }

    return new Response(
      JSON.stringify({
        message:   `${toCancel.length}건 자동취소 완료`,
        cancelled: toCancel.map(b => b.id),
        timestamp: nowKST.toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[auto-cancel] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
