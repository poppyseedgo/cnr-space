// @ts-nocheck
/**
 * auto-cancel-bookings Edge Function
 * Supabase Cron으로 매 5분 실행 (2026-04-17 최적화)
 *
 * 처리 항목:
 *   1. 노쇼 자동 취소   — confirmed 예약 중 start_at + 10분 초과 & 미체크인
 *   4. 노쇼 이용 제재 통지 — 발생/해제 미통지분 폴링 발송 (← [2026-08-10] 20260745)
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
 * [2026-04-27 P3 v2] 노쇼 알림 사일런트 누락 버그 해결 (lock-step 보장)
 *   · 증상: 테스트 예약 b1777262571607_0 — auto_cancelled=true, cancelled_by=system,
 *           noshow_notified=true(마킹 완료) 상태인데 이메일/인앱 모두 도착 안 함
 *   · 근본 원인: callSendNotification 시그니처가 Promise<void>라
 *           발송 결과(HTTP 4xx/5xx, 응답 본문의 success:false, 네트워크 예외)를
 *           호출자에게 전달하지 못함. 호출자는 무조건 noshow_notified=true 마킹 →
 *           다음 cron이 재시도 대상에서 배제 → 영구 누락 + DB 상태/실제 발송 lock-step 깨짐
 *   · 해결:
 *     (a) callSendNotification 시그니처: Promise<void> → Promise<boolean>
 *         · HTTP non-2xx → false
 *         · HTTP 200이지만 응답 json.success===false → false
 *         · HTTP 200이지만 json.emailFailed > 0 → false (Resend 부분 실패)
 *         · 네트워크 예외 → false
 *         · 그 외 → true
 *     (b) 노쇼 처리 루프: 발송 결과 boolean 받아서 true일 때만 마킹
 *         · false 시 continue → noshow_notified=false 유지 → 다음 cron 자동 재시도
 *   · 효과:
 *     · 일시 실패: 다음 cron(15분 후) 자동 재시도, 사용자에게 결국 도달
 *     · 영구 실패: DB가 정직하게 미발송 상태 유지, 운영자 로그로 인지 가능
 *     · 멱등성 유지: 성공 마킹된 건은 다음 cron 쿼리에서 배제됨

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
 * · throw 안 함 — boolean 반환으로 호출자에게 발송 결과 전달
 *
 * ← [2026-04-27 P3 v2] Promise<void> → Promise<boolean> 변경
 *   호출자가 발송 성공 시에만 noshow_notified=true 마킹하도록 결과 전달.
 *   마킹과 실제 발송 결과의 lock-step 보장이 목적.
 *
 * @returns true  = 발송 성공 (HTTP 200 + json.success !== false + emailFailed === 0)
 *          false = 어떤 이유로든 실패 (다음 cron이 재시도해야 함)
 */
async function callSendNotification(type: string, booking: any): Promise<boolean> {
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

    // ── 1차: HTTP 상태 코드 ──────────────────────────────────────────────
    if (!res.ok) {
      const body = await res.text()
      console.warn(`[auto-cancel] send-notification(${type}) 실패 [${res.status}]:`, body)
      return false
    }

    // ── 2차: 응답 본문 검증 ──────────────────────────────────────────────
    // ← [P3 v2] HTTP 200이라도 send-notification 내부에서 발송 실패 가능
    //   send-notification 응답 형식: { success: bool, emailSent, emailFailed, ... }
    //   · success === false (전체 실패)
    //   · emailFailed > 0 (Resend Batch 일부 실패)
    //   둘 중 하나라도 해당되면 false 반환 → 호출자가 재시도 보장
    try {
      const json = await res.json()
      if (json && json.success === false) {
        console.warn(`[auto-cancel] send-notification(${type}) 응답 success:false:`, JSON.stringify(json))
        return false
      }
      if (json && typeof json.emailFailed === 'number' && json.emailFailed > 0) {
        console.warn(`[auto-cancel] send-notification(${type}) 부분 발송 실패 (emailFailed=${json.emailFailed}):`, JSON.stringify(json))
        return false
      }
    } catch (jsonErr) {
      // 응답 본문이 JSON이 아닌 경우 — 비정상이지만 HTTP 200이므로
      // 보수적으로 성공 취급 (응답 형식이 향후 변경되어도 호환 유지)
      console.warn(`[auto-cancel] send-notification(${type}) 응답 JSON 파싱 실패 (HTTP 200, 본문 비정상) — 성공 취급`)
    }

    return true
  } catch (e: any) {
    // 네트워크/타임아웃/DNS 등 fetch 자체 실패
    console.warn(`[auto-cancel] send-notification(${type}) 호출 오류:`, e?.message ?? String(e))
    return false
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
    // ← [2026-09-09 노쇼 종결] 노쇼 전환 시 DB 트리거(trg_noshow_close_end)가 end_at 을 start+15분으로
    //   종결하고 원본을 original_end_at 에 보존한다. 이메일 본문의 예약 시간은 사용자가 잡은 원 구간이어야
    //   하므로 원본을 복원해 전달. (조기반납 행은 이 함수 경로로 오지 않음 — noshow/pending 알림 전용)
    end_at: booking.original_end_at ?? booking.end_at,
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
    const stats = { noshow: 0, reminderSent: 0, pendingExpired: 0, penaltyApplied: 0, penaltyCleared: 0 }  // ← [2026-08-10 이용제재 알림] 카운터 2종 추가

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
      .eq('early_ended',    false)        // ← [변경] App.tsx 필터와 동일 조건 추가
      .is('cancelled_by',   null)         // ← [변경] 이미 취소 처리된 건 차단
      .gte('start_at',      noshowLowerBound)
      .lt('start_at',       noshowCutoff)

    if (noshowErrFresh) {
      console.error('[auto-cancel] noshow fresh 조회 실패:', noshowErrFresh)
    }

    for (const booking of (noshowTargetsFresh ?? [])) {
      // 프론트와 race 방지: markNoshow()와 동일한 5-guard 원자적 UPDATE
      const { data: updated, error: upErr } = await supabase
        .from('bookings')
        .update({ auto_cancelled: true, cancelled_by: 'system' })
        .eq('id',            booking.id)
        .eq('status',        'confirmed')  // ← [변경] markNoshow() 가드 ①
        .eq('checked_in',    false)        // ← [변경] markNoshow() 가드 ②
        .eq('early_ended',   false)        // ← [변경] markNoshow() 가드 ③
        .eq('auto_cancelled', false)       // markNoshow() 가드 ④ (기존 유지)
        .is('cancelled_by',  null)         // ← [변경] markNoshow() 가드 ⑤
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
      // ── 이메일 + 인앱 발송 (send-notification이 둘 다 처리) ──────────────
      const payload = await buildPayload(booking)
      const sent = await callSendNotification('noshow', payload)

      // ← [2026-04-27 P3 v2] 발송 성공 시에만 마킹 — lock-step 보장
      //   기존: 발송 결과 무관하게 noshow_notified=true 마킹 → 사일런트 누락
      //   변경: false 반환 시 continue → noshow_notified=false 유지 →
      //         다음 cron 회차에 (1-b) 쿼리가 재조회 → 자동 재시도
      if (!sent) {
        console.warn(
          `[auto-cancel] noshow 발송 실패 — 마킹 스킵 (다음 cron 재시도 대기): ${booking.id} (${booking.title})`
        )
        continue
      }

      // ── 발송 완료 마킹 (원자성: notified=false 일 때만 true로) ──────────
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
      console.log(`[auto-cancel] noshow 알림 발송 성공 + 마킹 완료: ${booking.id} (${booking.title})`)
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
      .eq('room_id',                3)           // ← [변경] pending은 admin only 룸(room_id=3)에서만 발생
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
    // ← [2026-04-29] 쿼리/UPDATE 정비
    //   (1) room_id=3 추가 — pending은 admin only 룸에서만 발생
    //   (2) .or(cancelled_by) → .is('cancelled_by', null) 단순화
    //       App.tsx 낙관적 업데이트가 status:'cancelled'도 세팅하므로
    //       App.tsx 처리 건은 status='pending' 쿼리에서 이미 배제됨
    //       → cancelled_by='system' 허용 조건이 불필요해짐
    //   (3) UPDATE에 room_id=3 + cancelled_by IS NULL 가드 추가
    //   isExpiredPending 공식: status='cancelled' && cancelledBy='system' && room_id=3
    //
    // ← [2026-04-19 P2 v6] auto_cancelled=false 필터 제거 + UPDATE 원자성 강화
    // ← [2026-04-17] start_at lower bound 추가 (과거 1시간만 스캔)
    const expireDeadline     = new Date(now.getTime() + 1 * 60 * 1000).toISOString()
    const expireLowerBound   = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

    const { data: expiredTargets, error: expiredErr } = await supabase
      .from('bookings')
      .select('*')
      .eq('status',    'pending')
      .eq('room_id',   3)                 // ← [변경] admin only 룸 조건 추가
      .is('cancelled_by', null)           // ← [변경] .or() 단순화 — null만 허용
      .gte('start_at', expireLowerBound)
      .lt('start_at',  expireDeadline)

    if (expiredErr) {
      console.error('[auto-cancel] pending_expired 조회 실패:', expiredErr)
    }

    for (const booking of (expiredTargets ?? [])) {
      // ← [P2 v6] 원자적 조건부 UPDATE — pending일 때만 cancelled로 바꿈
      // ← [2026-04-29] room_id=3 + cancelled_by IS NULL 가드 추가
      const { data: updated, error: upErr } = await supabase
        .from('bookings')
        .update({
          status:         'cancelled',
          auto_cancelled: true,
          cancelled_by:   'system',
        })
        .eq('id',       booking.id)
        .eq('status',   'pending')        // 원자성: pending일 때만 UPDATE
        .eq('room_id',  3)                // ← [변경] admin only 룸 가드
        .is('cancelled_by', null)         // ← [변경] 이미 취소 처리된 건 덮어쓰기 방지
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
    // 4. 노쇼 이용 제재 통지 (← [2026-08-10] 20260745, Phase 2-2)
    //
    //   제재 발생 지점 = DB 트리거(markNoshow tick·cron 양경로) — 프론트 이벤트
    //   기반 발사가 구조적으로 불가능해, 미통지분을 여기서 폴링한다 (설계 §3.2).
    //   이 함수를 택한 이유: 노쇼 마킹과 같은 파이프라인 + 15분 주기 —
    //   정상 경로에서는 위 1번 스텝의 마킹 직후 같은 실행 안에서 통지된다.
    //
    //   lock-step (P3 v2 원칙 그대로): 발송 성공(callSendNotification=true) 건만
    //   마킹. 실패 건은 미마킹 → 다음 15분 주기 자동 재시도.
    //   독립 try/catch — 이 배치의 실패가 다른 배치를 막지 않는다 (도서 [0-2] 원칙).
    // ═══════════════════════════════════════════════════════════════════════

    // ── 4-a. 발생 통지 (noshow_penalty_applied) ─────────────────────────────
    try {
      const { data: pens, error: penErr } = await supabase.rpc('get_unnotified_noshow_penalties')
      if (penErr) throw new Error(`제재 발생 통지 조회 실패: ${penErr.message}`)

      const appliedOk: string[] = []
      for (const p of (pens ?? [])) {
        // payload booking = 3번째 노쇼 예약 → POLICIES booker_only 가 대상자 1명 해석.
        // 예약이 어드민 삭제됐어도 통지는 나가야 하므로 스냅샷 필드로 조립한다.
        // *_kst 는 서버 완성 문자열 — 재변환 금지 (타임존 이중적용 하루 밀림 교훈).
        const sent = await callSendNotification('noshow_penalty_applied', {
          id:               p.triggered_booking_id,
          title:            p.booking_title ?? '회의실 예약',
          user_id:          p.user_id,
          user_name:        p.user_name ?? '',
          noshow_count:     p.noshow_count ?? 3,
          penalty_starts_kst: p.starts_kst,
          penalty_ends_kst:   p.ends_kst,
        })
        if (!sent) continue                    // 미마킹 → 다음 cron 재시도
        appliedOk.push(p.penalty_id)
        stats.penaltyApplied++
        console.log(`[auto-cancel] 제재 발생 통지: ${p.penalty_id} (${p.user_name ?? p.user_id}) ~${p.ends_kst}`)
      }

      if (appliedOk.length > 0) {
        const { error: markErr } = await supabase.rpc('mark_noshow_penalty_applied_notified', { p_penalty_ids: appliedOk })
        // 마킹 실패 = 다음 실행에서 재발송(중복) 가능 — 조용히 넘기지 않고 로그로 추적
        if (markErr) console.error('[auto-cancel] 제재 발생 통지 마킹 실패:', markErr.message)
      }
    } catch (e) {
      console.error('[auto-cancel] 제재 발생 통지 처리 오류:', e)
    }

    // ── 4-b. 해제 통지 (noshow_penalty_cleared) ─────────────────────────────
    //   해제 3경로(기간 만료/관리자 수동/근거 노쇼 해제·삭제 자동 revoke) 단일 타입.
    //   still_blocked(같은 사용자의 다른 유효 제재 존재) = 발송하면 거짓말 —
    //   건너뛰고 마킹만 한다 (도서 skip_still_blocked 원칙 동일).
    try {
      const { data: clears, error: clrErr } = await supabase.rpc('get_uncleared_noshow_penalties')
      if (clrErr) throw new Error(`제재 해제 통지 조회 실패: ${clrErr.message}`)

      const clearedOk: string[] = []
      for (const p of (clears ?? [])) {
        if (p.still_blocked) {
          clearedOk.push(p.penalty_id)         // 알리지 않고 마킹만
          console.log(`[auto-cancel] 제재 해제 통지 skip(still_blocked): ${p.penalty_id}`)
          continue
        }
        const sent = await callSendNotification('noshow_penalty_cleared', {
          id:               p.triggered_booking_id,
          title:            p.booking_title ?? '회의실 예약',
          user_id:          p.user_id,
          user_name:        p.user_name ?? '',
          penalty_ends_kst: p.ends_kst,
        })
        if (!sent) continue
        clearedOk.push(p.penalty_id)
        stats.penaltyCleared++
        console.log(`[auto-cancel] 제재 해제 통지: ${p.penalty_id} (${p.user_name ?? p.user_id})`)
      }

      if (clearedOk.length > 0) {
        const { error: markErr } = await supabase.rpc('mark_noshow_penalty_cleared_notified', { p_penalty_ids: clearedOk })
        if (markErr) console.error('[auto-cancel] 제재 해제 통지 마킹 실패:', markErr.message)
      }
    } catch (e) {
      console.error('[auto-cancel] 제재 해제 통지 처리 오류:', e)
    }

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
