// @ts-nocheck
// ↑ Deno Edge Function — VS Code의 Node.js TypeScript 체커 오류 방지
// 실제 실행은 Supabase Edge Runtime(Deno)에서 이루어짐

/**
 * auto-cancel-bookings Edge Function
 * 실행 주기: 매 5분 (Supabase Cron으로 설정)
 * 역할: 예약 시작 후 10분이 지났는데 체크인 안 한 예약을 자동 취소
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
