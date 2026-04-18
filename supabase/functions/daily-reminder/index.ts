// @ts-nocheck
/**
 * daily-reminder Edge Function
 *
 * 매일 아침 07:00 KST (UTC 22:00) cron 실행.
 * 당일 예약된 모든 건에 대해 예약자 + 참석자에게 리마인더 알림 발송 요청.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2025-04-13] 초기 버전
 *   · APP_URL 기본값 cnr-space.pages.dev로 수정
 *   · booking_attendees 조인 추가 → 참석자에게도 리마인더 발송
 *
 * [2026-04-18 P2] 전면 리팩토링 — 159줄 → ~90줄 (43% 축소)
 *   · 자체 HTML 템플릿(makeReminderHtml) 완전 제거
 *   · 자체 sendEmail 제거
 *   · 각 예약마다 send-notification HTTP 호출 패턴으로 전환
 *   · 이 파일은 이제 "당일 예약 조회 + 알림 트리거" 역할만
 *   · 인앱 알림 신규 추가 (기존엔 이메일만) — send-notification이 자동 처리
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙
 * ═══════════════════════════════════════════════════════════════════════════
 *   · send-notification HTTP 호출 시 Bearer: ANON_KEY 사용 (SERVICE_KEY X)
 *
 * Cron: '0 22 * * *' (UTC 22:00 = KST 07:00)
 * 배포: supabase functions deploy daily-reminder --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ═══════════════════════════════════════════════════════════════════════════
// 환경변수
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// ← [CRITICAL] send-notification 호출 시 SERVICE_KEY 아닌 ANON_KEY 사용
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// ═══════════════════════════════════════════════════════════════════════════
// send-notification HTTP 호출 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

async function triggerNotification(type: string, booking: any): Promise<boolean> {
  if (!SUPABASE_URL) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,   // ← [CRITICAL] ANON_KEY 사용
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ type, booking }),
    })
    if (!res.ok) {
      console.warn(`[daily-reminder] send-notification 실패 (booking=${booking.id}):`, res.status, await res.text())
      return false
    }
    return true
  } catch (e: any) {
    console.warn(`[daily-reminder] send-notification 호출 예외 (booking=${booking.id}):`, e?.message ?? String(e))
    return false
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (_req: Request) => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    // KST 기준 오늘 날짜
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const p = (n: number) => String(n).padStart(2, '0')
    const todayKST = `${nowKST.getUTCFullYear()}-${p(nowKST.getUTCMonth() + 1)}-${p(nowKST.getUTCDate())}`

    // 오늘의 예약 조회 — 취소/조기종료/승인대기 제외
    // ← [P2] send-notification이 내부에서 참석자/관리자 조회하므로 여기선 참석자 조인 불필요
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('*')
      .gte('start_at', `${todayKST}T00:00:00+09:00`)
      .lte('start_at', `${todayKST}T23:59:59+09:00`)
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .neq('status',        'cancelled')
      .neq('status',        'pending')               // 승인 대기는 별도 흐름
      .order('start_at', { ascending: true })

    if (error) throw error

    if (!bookings || bookings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: '오늘 예약 없음', date: todayKST, triggered: 0 }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    // 각 예약마다 send-notification 트리거
    let triggered = 0
    for (const booking of bookings) {
      const ok = await triggerNotification('daily_reminder', booking)
      if (ok) triggered++
    }

    console.log(`[daily-reminder] 완료 — ${triggered}/${bookings.length}건 트리거됨 (${todayKST})`)

    return new Response(
      JSON.stringify({
        success:   true,
        date:      todayKST,
        total:     bookings.length,
        triggered,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[daily-reminder] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
