// @ts-nocheck
// ↑ Deno Edge Function — VS Code의 Node.js TypeScript 체커 오류 방지
// 실제 실행은 Supabase Edge Runtime(Deno)에서 이루어짐

/**
 * auto-cancel-bookings Edge Function
 * 실행 주기: 매 5분 (Supabase Cron으로 설정)
 * 역할: 예약 시작 후 10분이 지났는데 체크인 안 한 예약을 자동 취소
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendTeamsDM } from '../send-notification/teams.ts'

const AZURE_ENABLED = !!(
  Deno.env.get('AZURE_TENANT_ID') &&
  Deno.env.get('AZURE_CLIENT_ID') &&
  Deno.env.get('AZURE_CLIENT_SECRET')
)

const CHECKIN_GRACE_MINUTES = 10

Deno.serve(async (req: Request) => {
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

    const nowUTC = new Date()
    const nowKST = new Date(nowUTC.getTime() + 9 * 60 * 60 * 1000)
    const graceCutoff = new Date(nowUTC.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000)

    const { data: toCancel, error: fetchError } = await supabase
      .from('bookings')
      .select('id, title, user_name, start_at')
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

    const ids = toCancel.map((b: any) => b.id)
    const { error: updateError } = await supabase
      .from('bookings')
      .update({ auto_cancelled: true, cancelled_by: 'system' })  // 노쇼 자동취소
      .in('id', ids)

    if (updateError) throw updateError

    console.log(`[auto-cancel] ${toCancel.length}건 자동취소:`, ids)

    // ── Audit log — 노쇼 자동취소 기록 ──────────────────────────────────────
    for (const b of toCancel) {
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
        console.warn('[auto-cancel] audit_log 기록 실패 (취소는 정상 처리됨):', e)
      }
    }

    // ── 노쇼 인앱 알림 insert ──────────────────────────────────────────
    for (const b of toCancel) {
      try {
        // bookings에서 user_id 조회
        const { data: bk } = await supabase
          .from('bookings')
          .select('user_id')
          .eq('id', b.id)
          .single()

        if (bk?.user_id) {
          // KST 시간 포맷
          const d = new Date(b.start_at)
          const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
          const pad = (n: number) => String(n).padStart(2, '0')
          const h = k.getUTCHours()
          const ampm = h < 12 ? '오전' : '오후'
          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
          const dateStr = `${k.getUTCFullYear()}년 ${k.getUTCMonth()+1}월 ${k.getUTCDate()}일`
          const timeStr = `${ampm} ${h12}:${pad(k.getUTCMinutes())}`

          await supabase.from('notifications').insert({
            user_id:    bk.user_id,
            type:       'booking_noshow',
            title:      '노쇼 처리 — 예약이 자동 취소되었습니다',
            body:       `${b.title} · ${b.room_name ?? ''} · ${dateStr} ${timeStr}`,
            booking_id: b.id,
            is_read:    false,
          })
        }
      } catch (e) {
        console.warn('[auto-cancel] 인앱 알림 실패 (취소는 정상 처리됨):', e)
      }
    }

    // ── 노쇼 Teams DM 발송 ─────────────────────────────────────────────
    if (AZURE_ENABLED) {
      for (const b of toCancel) {
        try {
          const { data: bk } = await supabase
            .from('bookings')
            .select('profiles!bookings_user_id_fkey(email)')
            .eq('id', b.id)
            .single()

          const userEmail = (bk?.profiles as any)?.email
          if (!userEmail) continue

          const d = new Date(b.start_at)
          const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
          const pad = (n: number) => String(n).padStart(2, '0')
          const timeStr = `${k.getUTCFullYear()}.${pad(k.getUTCMonth()+1)}.${pad(k.getUTCDate())} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`
          const APP = Deno.env.get('APP_URL') ?? 'https://cnr-space.pages.dev'

          const teamsHtml = `
<div style="font-family:sans-serif;max-width:480px">
  <div style="background:#DC2626;padding:14px 18px;border-radius:8px 8px 0 0">
    <span style="font-size:16px;font-weight:700;color:#fff">🚫 노쇼 처리 — 예약이 자동 취소되었습니다</span>
  </div>
  <div style="border:1px solid #E2E8F0;border-top:none;padding:16px 18px;border-radius:0 0 8px 8px">
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:#374151">
      <tr><td style="padding:3px 0;color:#94A3B8;width:70px">회의</td><td style="font-weight:600">${b.title}</td></tr>
      <tr><td style="padding:3px 0;color:#94A3B8">회의실</td><td>${b.room_name ?? ''}</td></tr>
      <tr><td style="padding:3px 0;color:#94A3B8">시간</td><td>${timeStr}</td></tr>
    </table>
    <p style="font-size:12px;color:#6B7280;margin-top:10px">체크인하지 않아 예약이 자동 취소되었습니다.</p>
    <a href="${APP}" style="display:inline-block;background:#111;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;margin-top:8px">
      C&amp;R SPACE 열기 →
    </a>
  </div>
</div>`

          await sendTeamsDM(userEmail, teamsHtml)
        } catch (e) {
          console.warn('[auto-cancel] Teams DM 실패 (취소는 정상 처리됨):', e)
        }
      }
    }

    // ── 노쇼 알림 이메일 발송 ──────────────────────────────────────────
    // profiles에서 이메일 조회 후 send-notification 호출
    for (const b of toCancel) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, name')
          .eq('id', (await supabase.from('bookings').select('user_id').eq('id', b.id).single()).data?.user_id)
          .single()

        if (profile?.email) {
          await fetch(
            `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-notification`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                type: 'noshow',
                booking: { ...b, user_email: profile.email, user_name: profile.name },
                attendeeEmails: b.attendees ?? [],
              }),
            }
          )
        }
      } catch (e) {
        console.warn('[auto-cancel] 노쇼 알림 실패 (취소는 정상 처리됨):', e)
      }
    }

    return new Response(
      JSON.stringify({
        message:   `${toCancel.length}건 자동취소 완료`,
        cancelled: toCancel,
        timestamp: nowKST.toISOString(),
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[auto-cancel] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
