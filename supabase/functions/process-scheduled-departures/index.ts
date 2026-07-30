// @ts-nocheck
/**
 * process-scheduled-departures Edge Function — 예약 퇴사 자동 실행 (Phase 2)
 *
 * ✅ 변경 이력
 *  - [2026-07-30] 신규 — 퇴사 예정(departing) 자동 처리 (확정 요구사항 ①)
 *      · 대상: employment_status='departing' AND departure_scheduled_on < 오늘(KST)
 *        → "예정일 익일" 처리 = 마지막 근무일 자정까지 사용 보장 (확정 정책)
 *      · 예정일 이후 시작 기존 예약도 이 시점에 일괄 취소 (확정 정책 ⑤ —
 *        process_departure 가 미래 예약 전건을 취소하므로 자연 충족)
 *      · 알림 미발송 — send-notification 호출 없음
 *
 * cron: pg_cron '10 15 * * *' (UTC 15:10 = KST 00:10, 한국 서머타임 없어 연중 고정)
 *       — 20260735 마이그레이션 [9] 블록으로 등록 (service key 치환, SQL Editor)
 *
 * 권한: --no-verify-jwt 배포이므로 Bearer == SERVICE_KEY 직접 검증.
 *       (미검증 시 URL 아는 누구나 전 직원 퇴사 트리거 가능 — 파괴적 함수라 필수)
 *
 * 배포: supabase functions deploy process-scheduled-departures --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 */

import { executeDeparture, fetchAuthEmailMap } from '../_shared/departure.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  })

const svcHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

// KST 오늘 날짜 (YYYY-MM-DD) — 시각 성분 배제, 날짜 단위 판정 (도서 알림과 동일 설계)
function todayKST(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // 서비스 키 검증 — cron(net.http_post)만 호출 가능
  const auth = req.headers.get('Authorization') ?? ''
  if (auth !== `Bearer ${SERVICE_KEY}`) {
    return json({ success: false, error: 'FORBIDDEN' }, 403)
  }

  try {
    // 1. 처리 대상: 예정일이 "어제 이전"(< 오늘 KST) — 마지막 근무일 종료 후에만
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles` +
      `?employment_status=eq.departing` +
      `&departure_scheduled_on=lt.${todayKST()}` +
      `&select=id,name,email,departure_scheduled_on`,
      { headers: svcHeaders }
    )
    if (!listRes.ok) throw new Error(`대상 조회 실패 (${listRes.status}): ${await listRes.text()}`)
    const targets: { id: string; name: string; email: string; departure_scheduled_on: string }[] =
      await listRes.json()

    if (targets.length === 0) {
      return json({ success: true, processed: 0, results: [] })
    }

    // 2. auth 맵 1회 선조회 (인당 재조회 방지) 후 순차 실행
    //    순차인 이유: process_departure 가 books/bookings 를 잠그므로 병렬 시 락 경합 불필요
    const authMap = await fetchAuthEmailMap(SUPABASE_URL, SERVICE_KEY)
    const results = []
    for (const t of targets) {
      const r = await executeDeparture(SUPABASE_URL, SERVICE_KEY, t.id, t.email, null, authMap)
      results.push({ name: t.name, scheduled_on: t.departure_scheduled_on, ...r })
      if (r.error) console.error(`[scheduled-departures] 실패 (${t.email}):`, r.error)
      else         console.log(`[scheduled-departures] 완료 (${t.email})`)
    }

    const ok = results.filter(r => !r.error).length
    return json({ success: true, processed: ok, failed: results.length - ok, results })

  } catch (err) {
    console.error('[process-scheduled-departures] 오류:', err)
    return json({ success: false, error: String(err) }, 500)
  }
})
