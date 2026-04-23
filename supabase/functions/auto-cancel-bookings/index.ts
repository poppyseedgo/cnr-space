// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Supabase Cron으로 매 5분 실행 (2026-04-17 최적화)
 *
 * 처리 항목:
 *   1. 노쇼 자동 취소   — confirmed 예약 중 start_at + 10분 초과 & 미체크인
 *   2. 승인 기한 10분 전 알림 — pending 예약 start_at 9~11분 전 (Admin 알림)
 *   3. 승인 기한 초과 자동 취소 — pending 예약 start_at 1분 전까지 미승인 시 자동 취소
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 변경 이력
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * [2025-04-xx] 초기 버전
 *   · pending_expiring: 승인 기한 10분 전 Admin 알림 추가
 *   · pending_expired:  승인 기한 초과 자동 취소 + Admin/예약자/참석자 알림
 *   · approval_reminder_sent 플래그로 중복 방지
 *
 * [2026-04-17] Disk IO 최적화
 *   · start_at 쿼리에 lower bound 추가 (full scan 방지)
 *   · 실행 주기 1분 → 5분
 *   · pg_cron 13번 job (auto-cancel-bookings) 유효
 *
 * [2026-04-18 P2] 중복 인앱 알림 제거 — 320줄 → ~200줄 (38% 축소)
 *   · 기존 문제: callSendNotification() 후에 직접 insertInAppNotification() 중복 호출
 *     → 사용자 인앱 벨에 같은 알림이 2번 쌓임
 *   · 원인: 배송 2에서 send-notification이 인앱 INSERT를 담당하게 되었는데
 *     auto-cancel은 그 전 구조(이메일/인앱 분리)를 유지
 *   · 해결: auto-cancel은 이제 DB 상태 업데이트 + send-notification 호출만.
 *     인앱 알림은 send-notification 내부의 sendInAppForAllRoles가 전담.
 *   · 제거된 헬퍼: insertInAppNotification, fetchAdminUserIds, fetchAttendeeUserIds
 *   · 인앱 중복 INSERT 근본 제거
 *
 * [2026-04-19 P2 v6] pending_expired 알림 누락 버그 해결 (Race Condition)
 *   · 증상: 승인 기한 초과로 자동 취소된 예약의 이메일/인앱 알림 완전 누락
 *   · DB 검증: status=pending + auto_cancelled=true 행 17건 누적, pending_expired 알림 04-18 이후 0건
 *   · 근본 원인: App.tsx의 expirePendingBooking()이 DB에 auto_cancelled=true로 선점
 *     → 기존 쿼리 필터 `auto_cancelled=false`에 걸려 cron이 건너뜀
 *     → send-notification('pending_expired') 호출 안 됨
 *   · 노쇼는 정상 작동 (start_at+10분 시점 감지로 cron이 먼저 선점되는 구조)
 *   · 해결 (pending_expired만):
 *     (a) App.tsx: useEffect의 expirePendingBooking() 호출 제거 (단일 주체 DB 쓰기)
 *     (b) 본 파일 쿼리: `auto_cancelled=false` 필터 제거 (프론트 선점 건 backfill)
 *     (c) 본 파일 UPDATE: `.eq('status','pending')` + `.select('id')` 추가
 *         → 원자적 조건부 UPDATE로 재발송 방지 (PostgreSQL row-level lock 동등)
 *   · 노쇼 로직은 정상 작동 중이므로 건드리지 않음 (동일 패턴 방어는 필요 시 추후)

 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 배포 규칙
 * ═══════════════════════════════════════════════════════════════════════════
 *   · send-notification 호출 시 Bearer: ANON_KEY 사용 (SERVICE_KEY X)
 *
 * Cron: 매 5분 (pg_cron job id=13)
 * 배포: supabase functions deploy auto-cancel-bookings --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

// ═══════════════════════════════════════════════════════════════════════════
// 환경변수
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')              ?? ''
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// ← [CRITICAL] send-notification 호출 시 SERVICE_KEY 아닌 ANON_KEY 사용
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')         ?? ''

// DB 조작: SERVICE_KEY (bookings UPDATE 권한 필요)
const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ═══════════════════════════════════════════════════════════════════════════
// send-notification 호출 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

/**
 * send-notification Edge Function 호출
 * · Edge Function 간 호출은 ANON_KEY Bearer 필수 (SERVICE_KEY 시 401)
 * · send-notification이 이메일 + 인앱 + Teams 모두 담당
 * · 실패해도 throw 안 함 (warn 로그만) — cron 전체 실행 중단 방지
 */
async function callSendNotification(type: string, booking: any): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,   // ← [CRITICAL] ANON_KEY 사용
        'apikey':        ANON_KEY,
      },
      body: JSON.stringify({ type, booking }),
    })
    if (!res.ok) {
      console.warn(`[auto-cancel] send-notification(${type}) 실패 [${res.status}]:`, await res.text())
    }
  } catch (e: any) {
    console.warn(`[auto-cancel] send-notification(${type}) 호출 오류:`, e?.message ?? String(e))
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 예약 페이로드 조립 (DB row → send-notification 입력 형식)
// ═══════════════════════════════════════════════════════════════════════════

async function getRoomName(roomId: string): Promise<string> {
  const { data } = await supabase
    .from('rooms')
    .select('room_name, room_name_ko')
    .eq('room_id', roomId)
    .single()
  // ← [2026-04-18 P2 v4] 이메일 기본 표기는 영문 room_name (e.g. "2F Emerald")
  //   한글 room_name_ko는 폴백으로만 사용
  return data?.room_name ?? data?.room_name_ko ?? String(roomId)
}

async function buildPayload(booking: any): Promise<any> {
  const roomName = await getRoomName(booking.room_id)
  return {
    ...booking,
    user_name: booking.user_name ?? '',
    user_dept: booking.user_dept ?? '',
    room_name: roomName,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인 핸들러
// ═══════════════════════════════════════════════════════════════════════════

Deno.serve(async () => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  }

  try {
    const now = new Date()
    const stats = { noshow: 0, reminderSent: 0, pendingExpired: 0 }

    // ─── 1. 노쇼 자동 취소 + 이메일 발송 ──────────────────────────────────
    //
    // ← [2026-04-22 v3] 옵션 A — 프론트/cron 역할 분리
    //   변경 전 (v6): .eq('auto_cancelled', false)만 조회 → 프론트가 먼저 선점하면
    //                 cron 쿼리에서 배제되어 이메일 미발송 (알려진 버그)
    //   변경 후 (v3): noshow_notified=false인 system 취소 건을 조회
    //                 · 프론트 markNoshow로 선점된 건 포함
    //                 · cron 단독 처리 건 포함
    //                 · 모두 이메일 1회만 발송 후 noshow_notified=true 마킹
    //   흐름:
    //     ① 프론트(즉시): markNoshow → auto_cancelled=true, cancelled_by='system', noshow_notified=false
    //     ② Realtime 구독: 전 클라이언트 즉시 노쇼 뱃지 표시
    //     ③ cron(5분): 이 쿼리로 조회 → 이메일 발송 → noshow_notified=true 마킹
    //     ④ 다음 cron: noshow_notified=true 이미 발송된 건 배제 (중복 방지)
    //
    // 대상 1: cron이 단독 처리할 건 (프론트 미선점)
    // ← [2026-04-23 HOTFIX] cron 5분 주기 → 15분 오프셋(10,25,40,55) 최적화에 맞춰
    //   시간 범위 60분 → 25분으로 축소
    //   설계 의도:
    //     · 예약 시각은 15분 단위 (15n), 노쇼 판정 시각도 15분 단위 (15n+10)
    //     · cron 실행 시각을 10,25,40,55로 고정 → 노쇼 판정 시각과 완벽 동기화
    //     · 매 cron 실행마다 직전 15분 동안 노쇼된 예약 1개 슬롯 처리
    //     · 윈도우 [now-25분, now-10분) = 15분 윈도우 (cron 주기와 동일)
    //     · cron 1번 놓쳐도 다음 실행에서 복구 가능
    //   효과:
    //     · 낭비율 66% → 0%
    //     · 진행 중 장시간 회의 완전 보호 (25분 전보다 과거 시작한 예약 자동 제외)
    //     · Disk IO 대폭 감소
    const noshowCutoff = new Date(now.getTime() - 10 * 60 * 1000).toISOString()
    const noshowLowerBound = new Date(now.getTime() - 25 * 60 * 1000).toISOString()

    // (1-a) 아직 프론트가 선점 안 한 건 → cron이 DB 기록
    const { data: noshowTargetsFresh, error: noshowErrFresh } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',         'confirmed')
      .eq('checked_in',     false)
      .eq('auto_cancelled', false)
      .gte('start_at',      noshowLowerBound)
      .lt('start_at',       noshowCutoff)

    if (noshowErrFresh) {
      console.error('[auto-cancel] noshow fresh 조회 실패:', noshowErrFresh)
    }

    for (const booking of (noshowTargetsFresh ?? [])) {
      // 프론트와 race 방지: .eq('auto_cancelled', false)로 원자성 확보
      const { data: updated, error: upErr } = await supabase
        .from('bookings')
        .update({ auto_cancelled: true, cancelled_by: 'system' })
        .eq('id', booking.id)
        .eq('auto_cancelled', false)  // ← race 발생 시 UPDATE 0 rows
        .select('id')

      if (upErr) {
        console.error(`[auto-cancel] noshow 업데이트 실패 (${booking.id}):`, upErr)
        continue
      }
      // UPDATE 0 rows = 프론트가 먼저 선점 → 이 건은 (1-b) 쿼리에서 처리됨
      if (!updated || updated.length === 0) {
        console.log(`[auto-cancel] noshow 프론트 선점 감지 (${booking.id}) — 다음 조회에서 알림 처리`)
        continue
      }
    }

    // (1-b) 프론트 선점 포함 — noshow_notified=false인 모든 system 노쇼 조회 → 이메일 발송
    const { data: noshowToNotify, error: notifyErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('checked_in',        false)
      .eq('auto_cancelled',    true)
      .eq('cancelled_by',      'system')
      .eq('noshow_notified',   false)
      .gte('start_at',         noshowLowerBound)
      .lt('start_at',          noshowCutoff)

    if (notifyErr) {
      console.error('[auto-cancel] noshow 알림 대상 조회 실패:', notifyErr)
    }

    for (const booking of (noshowToNotify ?? [])) {
      // 이메일 발송
      const payload = await buildPayload(booking)
      await callSendNotification('noshow', payload)

      // 발송 완료 마킹 (원자성: notified=false 일 때만 true로)
      const { error: markErr } = await supabase
        .from('bookings')
        .update({ noshow_notified: true })
        .eq('id', booking.id)
        .eq('noshow_notified', false)

      if (markErr) {
        console.error(`[auto-cancel] noshow_notified 마킹 실패 (${booking.id}):`, markErr)
        continue
      }

      stats.noshow++
      console.log(`[auto-cancel] noshow 알림 발송: ${booking.id} (${booking.title})`)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ← [2026-04-23 HOTFIX] ②번 리마인더 + ③번 기한초과 로직 정지
    // ═══════════════════════════════════════════════════════════════════════
    // 증상: 진행 중 회의를 기한초과로 오인식 + 체크인된 예약이 사용자 취소로 덮어써짐
    //       (cancelled_by='user' 오염, 추적 트리거 emergency_log_user_cancel로 경로 추적 중)
    // 조치: 파괴적 로직 차단 — ②번과 ③번 블록 주석 처리
    //   · ①번 노쇼 자동 처리는 유지 (cron 15분 오프셋 주기에 최적화됨)
    //   · ②번 리마인더 정지 (임시)
    //   · ③번 기한초과 자동 취소 정지 (파괴 근본 원인 추정, 분리 후 재설계)
    // 복구 예정: auto-cancel-bookings를 3개 Edge Function으로 분리 후 야간 배포
    //   · process-noshow/            ← 유지 (이미 정상 작동)
    //   · send-pending-reminder/     ← 복구 예정
    //   · process-pending-expired/   ← 근본 원인 해결 후 재가동
    // ═══════════════════════════════════════════════════════════════════════
    /*
    // ─── 2. 승인 기한 10분 전 알림 (Admin 전용) ────────────────────────
    // ← [2026-04-17] start_at 범위 양방향 제한
    const reminderWindowStart = new Date(now.getTime() + 9  * 60 * 1000).toISOString()
    const reminderWindowEnd   = new Date(now.getTime() + 11 * 60 * 1000).toISOString()

    const { data: reminderTargets, error: reminderErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',                 'pending')
      .eq('approval_reminder_sent', false)
      .gte('start_at', reminderWindowStart)
      .lte('start_at', reminderWindowEnd)

    if (reminderErr) {
      console.error('[auto-cancel] pending_expiring 조회 실패:', reminderErr)
    }

    for (const booking of (reminderTargets ?? [])) {
      // 중복 발송 방지 플래그 먼저 세팅 (알림 실패해도 재발송 없음 — 의도된 설계)
      const { error: flagErr } = await supabase
        .from('bookings')
        .update({ approval_reminder_sent: true })
        .eq('id', booking.id)

      if (flagErr) {
        console.error(`[auto-cancel] approval_reminder_sent 업데이트 실패 (${booking.id}):`, flagErr)
        continue
      }

      // ← [P2] Admin 인앱 알림은 send-notification 내부에서 담당 (중복 제거)
      const payload = await buildPayload(booking)
      await callSendNotification('pending_expiring', payload)

      stats.reminderSent++
      console.log(`[auto-cancel] pending_expiring 발송: ${booking.id} (${booking.title})`)
    }

    // ─── 3. 승인 기한 초과 자동 취소 ───────────────────────────────────
    // pending 예약 중 start_at이 현재+1분 이내면 자동 취소 (승인 안 됨)
    //
    // ← [2026-04-19 P2 v6] auto_cancelled=false 필터 제거 + UPDATE 원자성 강화
    //   배경:
    //     · 기존: `auto_cancelled=false` 필터로만 재처리 방지 → 프론트가 선점한 건들 전부 누락
    //     · App.tsx의 expirePendingBooking() 호출 제거(근본 해결)와 병행하는 방어막
    //   변경:
    //     (1) 쿼리에서 `auto_cancelled=false` 제거 — pending + start_at 조건만으로 대상 식별
    //     (2) UPDATE에 `.eq('status', 'pending')` + `.select('id')` 추가
    //         → 원자적 조건부 UPDATE: pending일 때만 cancelled로 바꾸고 실제 바뀐 행 수 확인
    //         → 다른 주체가 이미 status를 바꿨다면 UPDATE 0 rows (재처리 방지)
    //     (3) UPDATE 결과가 0 rows면 알림 발송 skip (이미 다른 주체가 처리한 건)
    //   효과:
    //     · 프론트가 auto_cancelled=true로 선점한 과거 17건도 cron이 다시 처리함 (backfill)
    //     · 동시 cron 인스턴스가 같은 건을 처리해도 1건만 UPDATE 성공 (알림 중복 방지)
    // ← [2026-04-17] start_at lower bound 추가 (과거 1시간만 스캔)
    const expireDeadline     = new Date(now.getTime() + 1 * 60 * 1000).toISOString()
    const expireLowerBound   = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

    const { data: expiredTargets, error: expiredErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',    'pending')
      // ← [P2 v6] auto_cancelled=false 필터 제거 (프론트 선점 건 backfill)
      //   · 대신 cancelled_by로 "누가 취소했는지" 구분하여 사용자/관리자 수동 취소는 제외
      //   · 허용: cancelled_by IS NULL (정상 pending) OR 'system' (프론트 expirePendingBooking)
      //   · 제외: cancelled_by IN ('user', 'admin') — 사용자 수동 취소 / 관리자 강제 취소
      //   · PostgREST는 .or('cancelled_by.is.null,cancelled_by.eq.system') 형태로 표현
      .or('cancelled_by.is.null,cancelled_by.eq.system')
      .gte('start_at', expireLowerBound)
      .lt('start_at',  expireDeadline)

    if (expiredErr) {
      console.error('[auto-cancel] pending_expired 조회 실패:', expiredErr)
    }

    for (const booking of (expiredTargets ?? [])) {
      // ← [CRITICAL] pending_expired는 status를 cancelled로 저장해야 함
      //    (BookingStatusBadge 로직: status==='cancelled' && auto_cancelled && cancelled_by==='system')
      //
      // ← [P2 v6] 원자적 조건부 UPDATE
      //   · .eq('status', 'pending')를 UPDATE 절에도 추가 → pending일 때만 바꿈
      //   · .select('id')로 실제 UPDATE된 행 반환
      //   · 0 rows면 다른 주체가 이미 처리한 것 → 알림 skip (재발송 방지)
      const { data: updated, error: upErr } = await supabase
        .from('bookings')
        .update({
          status:         'cancelled',
          auto_cancelled: true,
          cancelled_by:   'system',
        })
        .eq('id',     booking.id)
        .eq('status', 'pending')   // ← [P2 v6] 원자성: pending일 때만 UPDATE
        .select('id')

      if (upErr) {
        console.error(`[auto-cancel] pending_expired 업데이트 실패 (${booking.id}):`, upErr)
        continue
      }

      // ← [P2 v6] UPDATE 0 rows → 이미 처리됨 (재발송 방지)
      if (!updated || updated.length === 0) {
        console.log(`[auto-cancel] pending_expired skip (이미 처리됨): ${booking.id}`)
        continue
      }

      // ← [P2] 이메일 + 인앱 모두 send-notification이 담당
      //        기존 3중 INSERT (Admin/예약자/참석자) 모두 제거됨
      //        POLICIES.pending_expired: recipients=booker_attendees_admins
      const payload = await buildPayload(booking)
      await callSendNotification('pending_expired', payload)

      stats.pendingExpired++
      console.log(`[auto-cancel] pending_expired 처리: ${booking.id} (${booking.title})`)
    }
    */
    // ═══════════════════════════════════════════════════════════════════════
    // ← [2026-04-23 HOTFIX] ②+③ 정지 상태 로그 (모니터링 용이)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('[auto-cancel] ⚠️ pending_expiring + pending_expired 정지 (2026-04-23 HOTFIX)')

    console.log('[auto-cancel] 전체 완료:', JSON.stringify(stats))
    return new Response(
      JSON.stringify({ success: true, ...stats, at: now.toISOString() }),
      { headers: corsHeaders }
    )

  } catch (err: any) {
    console.error('[auto-cancel] 예기치 못한 오류:', err)
    return new Response(
      JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: corsHeaders }
    )
  }
})
