// @ts-nocheck
/**
 * delete-zoom-meeting Edge Function
 *
 * 사용자가 Zoom 예약을 취소할 때 호출되는 Edge Function.
 * Zoom API로 미팅 삭제 + zoom_bookings status='cancelled' UPDATE.
 *
 * 입력 (POST body):
 *   { booking_id: uuid, cancelled_by?: 'user' | 'admin' | 'system' | 'departed' }
 *   cancelled_by 기본값: 'user'
 *
 * 응답 (200):
 *   { cancelled: true, zoom_meeting_id: string | null }
 *
 * 동작:
 *   1. zoom_bookings에서 zoom_meeting_id 조회
 *   2. zoom_meeting_id가 있으면 Zoom API DELETE 호출
 *      - 404 (이미 삭제됨): 정상 처리 (멱등성)
 *      - 기타 에러: 502
 *   3. zoom_bookings.status='cancelled', cancelled_by, cancelled_at 업데이트
 *
 * 멱등성 (idempotent):
 *   이미 status='cancelled'인 booking은 그대로 통과 (재호출 안전)
 *
 * 배포: supabase functions deploy delete-zoom-meeting --project-ref jjzcqpbwkkujttwxksvy --no-verify-jwt
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
    const { booking_id, cancelled_by } = await req.json()
    if (!booking_id) return jsonResponse({ error: 'booking_id required' }, 400)

    const validCancelledBy = ['user', 'admin', 'system', 'departed']
    const cancelledByValue = validCancelledBy.includes(cancelled_by) ? cancelled_by : 'user'

    // ── 2. zoom_bookings 조회 ────────────────────────────────────
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/zoom_bookings?id=eq.${booking_id}&select=id,zoom_meeting_id,status`,
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

    // ── 3. 멱등성: 이미 취소됨 ───────────────────────────────────
    if (booking.status === 'cancelled') {
      return jsonResponse({
        cancelled:        true,
        zoom_meeting_id:  booking.zoom_meeting_id,
        already_cancelled: true,
      }, 200)
    }

    // ── 4. Zoom API DELETE (zoom_meeting_id가 있을 때만) ─────────
    if (booking.zoom_meeting_id) {
      const accessToken = await getZoomAccessToken(SUPABASE_URL, SERVICE_KEY)
      const zoomRes = await fetch(
        `https://api.zoom.us/v2/meetings/${encodeURIComponent(booking.zoom_meeting_id)}`,
        {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      )

      // 200/204: 정상 삭제
      // 404:     Zoom에 이미 미팅이 없음 (이미 삭제됐거나 사용자가 직접 삭제) → 정상 처리
      // 그 외:   에러
      if (!zoomRes.ok && zoomRes.status !== 404) {
        const errText = await zoomRes.text()
        console.error(`[delete-zoom-meeting] Zoom API error (${zoomRes.status}):`, errText)
        return jsonResponse({
          error: 'Zoom API error',
          zoom_status: zoomRes.status,
          details: errText,
        }, 502)
      }

      if (zoomRes.status === 404) {
        console.warn(`[delete-zoom-meeting] Meeting ${booking.zoom_meeting_id} already gone on Zoom side (404), continuing`)
      }
    }

    // ── 5. zoom_bookings UPDATE ──────────────────────────────────
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/zoom_bookings?id=eq.${booking_id}`,
      {
        method: 'PATCH',
        headers: {
          ...sbHeaders,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          status:        'cancelled',
          cancelled_by:  cancelledByValue,
          cancelled_at:  new Date().toISOString(),
        })
      }
    )

    if (!updateRes.ok) {
      const errText = await updateRes.text()
      console.error(`[delete-zoom-meeting] DB UPDATE failed:`, errText)
      return jsonResponse({ error: 'DB update failed', details: errText }, 500)
    }

    return jsonResponse({
      cancelled:       true,
      zoom_meeting_id: booking.zoom_meeting_id,
    }, 200)

  } catch (e) {
    console.error('[delete-zoom-meeting] unhandled error:', e)
    return jsonResponse({ error: String(e?.message ?? e) }, 500)
  }
})
