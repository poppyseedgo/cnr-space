// @ts-nocheck
/**
 * create-zoom-meeting Edge Function
 *
 * 사용자가 Zoom 예약 시 호출되는 Edge Function.
 * Frontend가 zoom_bookings에 status='pending' INSERT 후 이 함수 호출.
 * 이 함수는 Zoom API로 미팅 생성하고 booking을 status='confirmed'로 UPDATE.
 *
 * 입력 (POST body):
 *   { booking_id: uuid }
 *
 * 응답 (200):
 *   { zoom_meeting_id, join_url, passcode, host_key }
 *
 * 실패 처리:
 *   - 400 booking_id 누락
 *   - 404 booking 없음 또는 zoom_account 비활성
 *   - 502 Zoom API 호출 실패 (메시지 포함)
 *   - 500 그 외 (DB UPDATE 실패 등)
 *
 * 호출 패턴 (Frontend):
 *   1. zoom_bookings INSERT (status='pending', zoom_meeting_id=null) → 본인 user_id RLS 통과
 *   2. supabase.functions.invoke('create-zoom-meeting', { body: { booking_id } })
 *   3. 응답 받아 화면 표시
 *
 * 멱등성 (idempotent):
 *   이미 zoom_meeting_id가 있는 booking이면 그대로 반환 (재호출 안전)
 *
 * 배포: supabase functions deploy create-zoom-meeting --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
 */

import { getZoomAccessToken } from '../_shared/zoom-oauth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const sbHeaders = {
  'Content-Type':  'application/json',
  'apikey':         SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
}

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    // ── 1. 입력 파싱 ─────────────────────────────────────────────
    const { booking_id } = await req.json()
    if (!booking_id) return jsonResponse({ error: 'booking_id required' }, 400)

    // ── 2. zoom_bookings 조회 ────────────────────────────────────
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/zoom_bookings?id=eq.${booking_id}&select=id,zoom_account_id,title,start_time,end_time,zoom_meeting_id,join_url,passcode,status`,
      { headers: sbHeaders }
    )
    if (!bookingRes.ok) {
      return jsonResponse({ error: 'Failed to read booking', details: await bookingRes.text() }, 500)
    }
    const bookings = await bookingRes.json()
    if (bookings.length === 0) {
      return jsonResponse({ error: 'Booking not found' }, 404)
    }
    const booking = bookings[0]

    // ── 3. 멱등성: 이미 미팅 생성됨 ───────────────────────────────
    if (booking.zoom_meeting_id) {
      // host_key는 zoom_accounts에서 별도 조회
      const acc = await fetch(
        `${SUPABASE_URL}/rest/v1/zoom_accounts?id=eq.${booking.zoom_account_id}&select=host_key`,
        { headers: sbHeaders }
      ).then(r => r.json())
      return jsonResponse({
        zoom_meeting_id: booking.zoom_meeting_id,
        join_url:        booking.join_url,
        passcode:        booking.passcode,
        host_key:        acc?.[0]?.host_key ?? null,
        already_created: true,
      }, 200)
    }

    // ── 4. zoom_accounts 조회 (sub-user 이메일 + host_key) ──────
    const accountRes = await fetch(
      `${SUPABASE_URL}/rest/v1/zoom_accounts?id=eq.${booking.zoom_account_id}&select=email,host_key,active`,
      { headers: sbHeaders }
    )
    if (!accountRes.ok) {
      return jsonResponse({ error: 'Failed to read zoom_account', details: await accountRes.text() }, 500)
    }
    const accounts = await accountRes.json()
    if (accounts.length === 0) return jsonResponse({ error: 'Zoom account not found' }, 404)
    if (!accounts[0].active)   return jsonResponse({ error: 'Zoom account inactive' }, 404)

    const subUserEmail = accounts[0].email
    const hostKey      = accounts[0].host_key

    // ── 5. OAuth 토큰 발급/조회 ──────────────────────────────────
    const accessToken = await getZoomAccessToken(SUPABASE_URL, SERVICE_KEY)

    // ── 6. 미팅 시작 시각 / duration 계산 ────────────────────────
    // Zoom API는 timezone 필드와 함께 'YYYY-MM-DDTHH:mm:ss' (timezone naive) 형식 권장
    const startUTC = new Date(booking.start_time)
    const endUTC   = new Date(booking.end_time)
    const durationMinutes = Math.round((endUTC.getTime() - startUTC.getTime()) / 60000)

    if (durationMinutes <= 0) {
      return jsonResponse({ error: 'Invalid duration (end_time must be after start_time)' }, 400)
    }

    // KST 기준 'YYYY-MM-DDTHH:mm:ss' 변환
    const kstOffsetMs = 9 * 60 * 60 * 1000
    const kstDate = new Date(startUTC.getTime() + kstOffsetMs)
    const startTimeStr = kstDate.toISOString().slice(0, 19)  // 'YYYY-MM-DDTHH:mm:ss'

    // ── 7. Zoom API 호출: 미팅 생성 ──────────────────────────────
    const zoomRes = await fetch(
      `https://api.zoom.us/v2/users/${encodeURIComponent(subUserEmail)}/meetings`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          topic:      booking.title,
          type:       2,  // scheduled meeting
          start_time: startTimeStr,
          duration:   durationMinutes,
          timezone:   'Asia/Seoul',
          settings: {
            host_video:        true,
            participant_video: true,
            join_before_host:  false,
            waiting_room:      false,
            mute_upon_entry:   true,
            auto_recording:    'none',
            approval_type:     2,  // 등록 불필요
          }
        })
      }
    )

    if (!zoomRes.ok) {
      const errText = await zoomRes.text()
      console.error(`[create-zoom-meeting] Zoom API error (${zoomRes.status}):`, errText)
      return jsonResponse({
        error: 'Zoom API error',
        zoom_status: zoomRes.status,
        details: errText,
      }, 502)
    }

    const meetingData = await zoomRes.json()

    // ── 8. zoom_bookings UPDATE ──────────────────────────────────
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/zoom_bookings?id=eq.${booking_id}`,
      {
        method: 'PATCH',
        headers: {
          ...sbHeaders,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          zoom_meeting_id: String(meetingData.id),
          join_url:        meetingData.join_url,
          passcode:        meetingData.password ?? null,
          status:          'confirmed',
        })
      }
    )

    if (!updateRes.ok) {
      // Zoom에는 미팅이 생성됐는데 DB 업데이트 실패 → 데이터 불일치
      // 운영 모니터링 필요. 일단 사용자에겐 미팅 정보 반환 (수동 복구 가능하도록)
      const errText = await updateRes.text()
      console.error(`[create-zoom-meeting] CRITICAL: Zoom meeting created but DB UPDATE failed:`, errText)
      return jsonResponse({
        error: 'Meeting created on Zoom but DB update failed - manual recovery needed',
        zoom_meeting_id: String(meetingData.id),
        join_url:        meetingData.join_url,
        passcode:        meetingData.password ?? null,
      }, 500)
    }

    // ── 9. 정상 응답 ─────────────────────────────────────────────
    return jsonResponse({
      zoom_meeting_id: String(meetingData.id),
      join_url:        meetingData.join_url,
      passcode:        meetingData.password ?? null,
      host_key:        hostKey,
    }, 200)

  } catch (e) {
    console.error('[create-zoom-meeting] unhandled error:', e)
    return jsonResponse({ error: String(e?.message ?? e) }, 500)
  }
})
