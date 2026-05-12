// @ts-nocheck
/**
 * checkin-reminder Edge Function
 *
 * 매 1분 간격 cron 실행. 예약 시간 기준 2가지 시점에 알림 발송 요청.
 *
 *   ① 예약 시작 5분 전  → type: checkin_before_5    (예약자 + 참석자) — 체크인 활성 시작 알림
 *   ② 예약 시작 후 5분  → type: checkin_warning_5  (예약자 + 참석자) — 자동취소 5분 전 경고
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
 *   · 자체 HTML 템플릿 3개 + 자체 sendEmail 완전 제거
 *   · 각 예약마다 send-notification Edge Function을 HTTP 호출하는 패턴으로 전환
 *   · 이 파일은 이제 "DB 조회 + 알림 트리거" 역할만
 *
 * [2026-05-12] 체크인 활성 5분 전 핫픽스 — 트리거 3개 → 2개로 축소
 *   변경 내용:
 *     · ① checkin_before_10 (시작 10분 전 이동 안내) → 삭제
 *     · ② checkin_start (시작 시점 체크인 요청)      → 삭제
 *     · ③ checkin_warning_5 (시작 후 5분 경고)       → 유지
 *     · 신규: checkin_before_5 (시작 5분 전 체크인 요청 + 체크인 활성 시작 알림)
 *   설계 의도:
 *     · 체크인 활성 윈도우가 [start-5분, start+10분]으로 변경됨에 따라
 *       체크인 요청 메일도 활성 시작 시점(5분 전)에 발송
 *     · 10분 전 이동 안내는 5분 전 메일에 통합 (메일 중복 발송 부담 감소)
 *     · 시작 시점 메일은 불필요 (이미 5분 전부터 체크인 가능)
 *   ±30초 윈도우 정책 유지: cron 1분 주기, 시작 시각이 ±30초 구간에 들어오면 발송
 *   노쇼 cutoff(start+10분) 변동 없음 — auto-cancel-bookings cron이 처리
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
// Supabase client (rooms 조회용)
// ═══════════════════════════════════════════════════════════════════════════

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ═══════════════════════════════════════════════════════════════════════════
// 회의실 이름 캐시 (cron 실행당 한 번만 rooms 조회)
// ═══════════════════════════════════════════════════════════════════════════

let roomNameCache: Map<string, string> | null = null

async function getRoomNameMap(): Promise<Map<string, string>> {
  if (roomNameCache) return roomNameCache
  try {
    const { data } = await supabase
      .from('rooms')
      .select('room_id, room_name, room_name_ko')
    const map = new Map<string, string>()
    for (const r of (data ?? [])) {
      map.set(r.room_id, r.room_name ?? r.room_name_ko ?? String(r.room_id))
    }
    roomNameCache = map
    return map
  } catch (e) {
    console.warn('[checkin-reminder] rooms 조회 실패:', e)
    return new Map()
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// send-notification HTTP 호출 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

async function triggerNotification(type: string, booking: any): Promise<void> {
  if (!SUPABASE_URL) return

  const roomMap  = await getRoomNameMap()
  const roomName = roomMap.get(booking.room_id) ?? String(booking.room_id)
  const enrichedBooking = { ...booking, room_name: roomName }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,   // ← [CRITICAL] ANON_KEY 사용
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ type, booking: enrichedBooking }),
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
    const now = new Date()
    let triggered = 0

    // 공통 필터: 취소되지 않고, 조기종료 안 됐고, 아직 체크인 안 된 예약
    const commonQuery = () => supabase
      .from('bookings')
      .select('*, booking_attendees(email, name)')
      .eq('auto_cancelled', false)
      .eq('early_ended',    false)
      .eq('checked_in',     false)
      .neq('status',        'cancelled')
      .neq('status',        'pending')

    // ─── ① 예약 시작 5분 전 — 체크인 요청 알림 ────────────────────────
    //     대상: start_at이 (지금 + 5분) ± 30초 구간
    //     ← [2026-05-12] 신규 트리거. 체크인 활성 시작 시점에 메일/인앱 발송.
    //     기존 ①(10분 전 이동 안내) + ②(시작 시점 체크인 요청)을 통합.
    const before5 = new Date(now.getTime() + 5 * 60 * 1000)
    const { data: upcoming } = await commonQuery()
      .gte('start_at', new Date(before5.getTime() - 30_000).toISOString())
      .lte('start_at', new Date(before5.getTime() + 30_000).toISOString())

    for (const b of upcoming ?? []) {
      await triggerNotification('checkin_before_5', b)
      triggered++
    }

    // ─── ② 예약 시작 후 5분 — 자동취소 5분 전 경고 ────────────────────
    //     대상: start_at이 (지금 - 5분) ± 30초 구간 + 회의가 아직 안 끝난 것
    //     유지 사유: 정책 이미지 "노쇼(자동취소) 경고" 시점과 1:1 매칭
    const after5 = new Date(now.getTime() - 5 * 60 * 1000)
    const { data: started } = await commonQuery()
      .gte('start_at', new Date(after5.getTime() - 30_000).toISOString())
      .lte('start_at', new Date(after5.getTime() + 30_000).toISOString())
      .gt('end_at', now.toISOString())

    for (const b of started ?? []) {
      await triggerNotification('checkin_warning_5', b)
      triggered++
    }

    console.log(`[checkin-reminder] 완료 — ${triggered}건 트리거됨 (before5: ${upcoming?.length ?? 0}, warning5: ${started?.length ?? 0})`)

    return new Response(
      JSON.stringify({
        success:     true,
        triggered,
        breakdown:   {
          before_5:    upcoming?.length ?? 0,
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
