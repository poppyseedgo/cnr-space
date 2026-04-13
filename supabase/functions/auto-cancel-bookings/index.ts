// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Cron: 매 5분
 * 역할: 예약 시작 후 10분 경과, 체크인 없는 예약 자동 취소 (노쇼)
 *
 * ✅ 수정 내역 (2025-04-13):
 *   - profiles batch 조회 추가 → user_email을 직접 페이로드에 포함
 *   - send-notification 응답 status 체크 추가 (에러 은폐 방지)
 *   - Edge Fn → Edge Fn 간 user_email fallback 의존성 제거
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CHECKIN_GRACE_MINUTES = 10
const OPERATING_START_KST   = 6   // 06:00 KST
const OPERATING_END_KST     = 20  // 20:00 KST

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey',
      },
    })
  }

  // ── 운영 시간 체크 (KST 06:00 ~ 20:00) ──────────────────────────────────
  const nowUTC = new Date()
  const hourKST = (nowUTC.getUTCHours() + 9) % 24
  if (hourKST < OPERATING_START_KST || hourKST >= OPERATING_END_KST) {
    return new Response(
      JSON.stringify({ message: `운영 시간 외 (현재 KST ${hourKST}시) — 스킵`, timestamp: nowUTC.toISOString() }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const nowKST      = new Date(nowUTC.getTime() + 9 * 60 * 60 * 1000)
    const graceCutoff = new Date(nowUTC.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000)

    // ── 자동취소 대상 조회 ────────────────────────────────────────────────────
    const { data: toCancel, error: fetchError } = await supabase
      .from('bookings')
      .select('id, title, user_id, user_name, user_dept, room_id, start_at, end_at')
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

    // ── rooms 테이블에서 room_name batch 조회 ────────────────────────────────
    const roomIds = [...new Set(toCancel.map(b => b.room_id).filter(Boolean))]
    const { data: roomRows } = await supabase
      .from('rooms')
      .select('room_id, room_name')
      .in('room_id', roomIds)

    const roomMap = new Map()
    for (const r of roomRows ?? []) {
      roomMap.set(r.room_id, r.room_name ?? '')
    }

    // ── profiles 테이블에서 user_email batch 조회 ────────────────────────────
    // send-notification에 user_email 직접 전달 → 중간 lookup 실패 리스크 제거
    const userIds = [...new Set(toCancel.map(b => b.user_id).filter(Boolean))]
    const { data: profileRows } = await supabase
      .from('profiles')
      .select('id, email')
      .in('id', userIds)

    const emailMap = new Map()
    for (const p of profileRows ?? []) {
      emailMap.set(p.id, p.email ?? '')
    }
    console.log(`[auto-cancel] profiles 조회: ${profileRows?.length ?? 0}명`)

    // ── 일괄 취소 ────────────────────────────────────────────────────────────
    const ids = toCancel.map(b => b.id)
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ auto_cancelled: true, cancelled_by: 'system' })
      .in('id', ids)

    if (updateError) throw updateError
    console.log(`[auto-cancel] ${toCancel.length}건 자동취소:`, ids)

    // ── 각 건별 후처리 ────────────────────────────────────────────────────────
    for (const b of toCancel) {
      const roomName  = roomMap.get(b.room_id) ?? ''
      const userEmail = emailMap.get(b.user_id) ?? ''

      // KST 시간 포맷
      const d = new Date(b.start_at)
      const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const pad = n => String(n).padStart(2, '0')
      const h = k.getUTCHours()
      const dateStr = `${k.getUTCFullYear()}년 ${k.getUTCMonth()+1}월 ${k.getUTCDate()}일`
      const timeStr = `${h < 12 ? '오전' : '오후'} ${h === 0 ? 12 : h > 12 ? h - 12 : h}:${pad(k.getUTCMinutes())}`
      const inappBody = `${b.title} · ${roomName} · ${dateStr} ${timeStr}`

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

      // 참석자 인앱 알림
      try {
        const { data: attendeeRows } = await supabase
          .from('booking_attendees')
          .select('user_id')
          .eq('booking_id', b.id)

        for (const att of attendeeRows ?? []) {
          if (!att.user_id) continue
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

      // 이메일 알림 — send-notification 호출 (user_email 직접 포함)
      try {
        const notifRes = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify({
              type: 'noshow',
              booking: {
                id:         b.id,
                user_id:    b.user_id,
                user_email: userEmail,        // ← profiles에서 직접 조회한 이메일
                title:      b.title,
                user_name:  b.user_name,
                user_dept:  b.user_dept ?? '',
                room_name:  roomName,
                start_at:   b.start_at,
                end_at:     b.end_at,
              },
            }),
          }
        )
        if (!notifRes.ok) {
          const errBody = await notifRes.text()
          console.error(`[auto-cancel] 노쇼 이메일 발송 실패 (HTTP ${notifRes.status}):`, errBody)
        } else {
          const result = await notifRes.json()
          console.log(`[auto-cancel] 노쇼 이메일 발송 완료 (${b.id}):`, JSON.stringify(result))
        }
      } catch (e) {
        console.error('[auto-cancel] 노쇼 이메일 알림 네트워크 오류:', e)
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
