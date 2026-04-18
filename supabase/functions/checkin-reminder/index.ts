// @ts-nocheck
/**
 * checkin-reminder Edge Function
 *
 * 매 1분 간격 cron 실행. 예약 시간 기준 3가지 시점에 알림 발송 요청.
 *
 *   ① 예약 시작 10분 전  → type: checkin_before_10  (예약자만)
 *   ② 예약 시작 시각     → type: checkin_start      (예약자 + 참석자)
 *   ③ 예약 시작 후 5분   → type: checkin_warning_5  (예약자만)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2025-04-13] 초기 버전
 *   · booking_attendees 조인 추가 (구 포맷 → 신 포맷)
 *   · 참석자 이메일 발송 로직 추가
 *
 * [2026-04-18 P2] 전면 리팩토링 — 336줄 → ~140줄 (58% 축소)
 *   · 자체 HTML 템플릿 3개(makeBefore10Html/makeStartHtml/makeAfter5Html) 완전 제거
 *   · 자체 sendEmail 제거
 *   · 각 예약마다 send-notification Edge Function을 HTTP 호출하는 패턴으로 전환
 *   · 이 파일은 이제 "DB 조회 + 알림 트리거" 역할만
 *   · 실제 이메일/인앱 발송은 send-notification이 전담 (일관성 확보)
 *   · 인앱 알림 누락 보완:
 *       - checkin_start 참석자 인앱 알림 추가 (기존 없음)
 *       - type 이름을 정책 표준(checkin_before_10/start/warning_5)으로 통일
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙
 * ═══════════════════════════════════════════════════════════════════════════
 *   · 이 파일 자체는 cron에서 호출되므로 --no-verify-jwt 가능
 *   · send-notification HTTP 호출 시 Bearer: ANON_KEY 사용 (SERVICE_KEY X — 401 발생함)
 *
 * Cron: '* * * * *' (매 분)
 * 배포: supabase functions deploy checkin-reminder --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ═══════════════════════════════════════════════════════════════════════════
// 환경변수
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// ← [CRITICAL] send-notification 호출 시 SERVICE_KEY 아닌 ANON_KEY 사용해야 401 안 남
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

// ═══════════════════════════════════════════════════════════════════════════
// send-notification HTTP 호출 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * send-notification Edge Function 호출
 * · 동일 Supabase 프로젝트 내 Edge Function 간 호출은 ANON_KEY Bearer 필수
 * · 실패해도 throw 안 함 (warn 로그만) — 한 건 실패가 전체 cron을 멈추면 안 됨
 */
async function triggerNotification(type: string, booking: any): Promise<void> {
  if (!SUPABASE_URL) return
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
      console.warn(`[checkin-reminder] send-notification 실패 (${type}, booking=${booking.id}):`, res.status, await res.text())
    }
  } catch (e: any) {
    console.warn(`[checkin-reminder] send-notification 호출 예외 (${type}, booking=${booking.id}):`, e?.message ?? String(e))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

    const now = new Date()
    let triggered = 0

    // 공통 필터: 취소되지 않고, 조기종료 안 됐고, 아직 체크인 안 된 예약
    // ← [P2] 메모리 규칙: start_at 범위에 lower bound 추가해 full scan 방지
    const commonQuery = () => supabase
      .from('bookings')
      .select('*, booking_attendees(email, name)')    // ← send-notification에 참석자 정보 넘길 때 필요
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .eq('checked_in',     false)
      .neq('status',        'cancelled')              // 취소된 예약 제외
      .neq('status',        'pending')                // 승인 대기 중인 예약 제외

    // ─── ① 예약 시작 10분 전 ────────────────────────────────────────────────
    //     대상: start_at이 (지금+10분) ± 30초 구간
    const before10 = new Date(now.getTime() + 10 * 60 * 1000)
    const { data: upcoming } = await commonQuery()
      .gte('start_at', new Date(before10.getTime() - 30_000).toISOString())
      .lte('start_at', new Date(before10.getTime() + 30_000).toISOString())

    for (const b of upcoming ?? []) {
      await triggerNotification('checkin_before_10', b)
      triggered++
    }

    // ─── ② 예약 시작 시각 ──────────────────────────────────────────────────
    //     대상: start_at이 (지금) ± 30초 구간
    const { data: justStarted } = await commonQuery()
      .gte('start_at', new Date(now.getTime() - 30_000).toISOString())
      .lte('start_at', new Date(now.getTime() + 30_000).toISOString())

    for (const b of justStarted ?? []) {
      await triggerNotification('checkin_start', b)
      triggered++
    }

    // ─── ③ 예약 시작 후 5분 경고 ──────────────────────────────────────────
    //     대상: start_at이 (지금-5분) ± 30초 + 회의가 아직 안 끝난 것
    const after5 = new Date(now.getTime() - 5 * 60 * 1000)
    const { data: started } = await commonQuery()
      .gte('start_at', new Date(after5.getTime() - 30_000).toISOString())
      .lte('start_at', new Date(after5.getTime() + 30_000).toISOString())
      .gt('end_at', now.toISOString())

    for (const b of started ?? []) {
      await triggerNotification('checkin_warning_5', b)
      triggered++
    }

    console.log(`[checkin-reminder] 완료 — ${triggered}건 트리거됨 (before10: ${upcoming?.length ?? 0}, start: ${justStarted?.length ?? 0}, warning5: ${started?.length ?? 0})`)

    return new Response(
      JSON.stringify({
        success:     true,
        triggered,
        breakdown:   {
          before_10:   upcoming?.length ?? 0,
          start:       justStarted?.length ?? 0,
          warning_5:   started?.length ?? 0,
        },
        time: now.toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err: any) {
    console.error('[checkin-reminder] 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
