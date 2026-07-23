// @ts-nocheck
/**
 * book-due-reminder / index.ts
 * 도서 반납 리마인더 — 매일 09:00 KST 발송 (반납 1일 전 / 당일 / 연체)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 스케줄
 * ═══════════════════════════════════════════════════════════════════════════
 *   Cron: '0 0 * * *'   (UTC 00:00 = KST 09:00)
 *
 *   ※ 기존 daily-reminder는 '0 22 * * *' (UTC 22:00 = KST 07:00).
 *      본 함수는 09:00 KST 이므로 UTC 00:00 이며 날짜가 같은 날로 유지된다
 *      (KST 09:00 = 같은 날 UTC 00:00). 검증 완료.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KST 혼동 방지 설계 (이 함수의 핵심)
 * ═══════════════════════════════════════════════════════════════════════════
 * 문제:
 *   due_at 은 "대여시각 + 7일" 이라 시각 성분(예: 14:37)을 갖는다.
 *   만약 "due_at > now()" 같은 시각 비교로 D-day를 판정하면
 *   cron 실행 시각(09:00)과 due_at 시각의 대소에 따라
 *   같은 날짜인데도 발송/미발송이 갈리는 경계 버그가 생긴다.
 *
 * 해결 (근본):
 *   모든 판정을 "KST 날짜(YYYY-MM-DD) 단위"로만 수행한다.
 *     dDiff = KST날짜(due_at) - KST날짜(실행시점)
 *       dDiff === 1  → book_due_tomorrow  (반납 1일 전)
 *       dDiff === 0  → book_due_today     (반납 당일)
 *       dDiff <   0  → book_overdue       (연체중, 매일 반복)
 *   시각 성분은 판정에 일절 관여하지 않으므로 몇 시에 대여했든 결과가 동일하다.
 *
 *   KST 날짜 도출은 프로젝트 표준 패턴을 따른다:
 *     new Date(ts + 9h) 후 getUTC*  → UTC 기준으로 읽되 +9h 만큼 밀어 KST 벽시계를 얻음
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 중복 발송 방지
 * ═══════════════════════════════════════════════════════════════════════════
 *   · due_tomorrow / due_today: 대여 1건당 각 1회만 발송돼야 한다.
 *     book_checkouts.notified_due_tomorrow / notified_due_today (date 컬럼)에
 *     "발송한 KST 날짜"를 기록하고, 같은 날짜면 skip.
 *     → cron 재실행/수동 호출해도 중복 발송되지 않음 (멱등)
 *   · overdue: 매일 1회 반복 발송이 정책이므로
 *     notified_overdue_on 에 마지막 발송 KST 날짜를 기록하고 날짜가 다를 때만 발송.
 *
 *   연장(extend)이 일어나면 due_at 이 미래로 밀리므로
 *   RPC에서 위 3개 컬럼을 NULL로 초기화한다 → 새 due_at 기준으로 다시 알림 발송.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 발송 경로
 * ═══════════════════════════════════════════════════════════════════════════
 *   send-notification Edge Function 호출 (이메일 + 인앱 동시 처리)
 *   payload: { type, book_checkout_id, ... } → 도서관 알림은 recipients='book_borrower'
 *
 * Deploy:
 *   supabase functions deploy book-due-reminder --no-verify-jwt
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─────────────────────────────────────────────────────────────────────────────
// CORS — 인라인 정의
// ─────────────────────────────────────────────────────────────────────────────
//   ← [2026-07-20 fix] 기존 코드는 '../_shared/cors.ts' 를 import 했으나
//     이 저장소에는 해당 파일이 존재하지 않는다(_shared 는 notification-types /
//     email-templates / email-sender / notification-inapp / recipient-resolver /
//     zoom-oauth 6개뿐). 그래서 번들 단계에서
//     "Module not found .../_shared/cors.ts" 로 배포가 400 실패했다.
//
//   근본 정정: 이 프로젝트의 실제 컨벤션은 "함수마다 corsHeaders 인라인"이다
//   (search-users / send-notification / create-zoom-meeting / search-book /
//    visitor-* / auto-cancel-bookings 등 기존 함수 전부 동일).
//   없는 공유 모듈을 새로 만들어 이 함수만 다른 방식을 쓰게 하면 컨벤션이
//   두 갈래로 갈라지므로, 기존 방식에 맞춰 인라인으로 정정한다.
const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ─────────────────────────────────────────────────────────────────────────────
// KST 유틸 — 판정의 SSOT
// ─────────────────────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO/timestamp → KST 기준 'YYYY-MM-DD' */
function kstDateStr(ts: string | number | Date): string {
  const ms = ts instanceof Date ? ts.getTime()
           : typeof ts === 'number' ? ts
           : new Date(ts).getTime()
  const k = new Date(ms + KST_OFFSET_MS)
  return `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`
}

/** KST 날짜 기준 자정 epoch(ms) — 날짜 차이 계산용 (시각 성분 완전 제거) */
function kstDayEpoch(ts: string | number | Date): number {
  const ms = ts instanceof Date ? ts.getTime()
           : typeof ts === 'number' ? ts
           : new Date(ts).getTime()
  const k = new Date(ms + KST_OFFSET_MS)
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate())
}

/** due_at 이 실행시점 기준 며칠 남았는지 (KST 날짜 단위, 음수=연체) */
function dueDayDiff(dueAt: string, nowMs: number): number {
  return (kstDayEpoch(dueAt) - kstDayEpoch(nowMs)) / 86400000
}

/**
 * "시작된 대여" 의 checkout_at 상한 (KST 익일 자정의 ISO)  ← [2026-07-23]
 *
 * 대여일은 KST 정오로 저장된다. 그래서 09:00 배치 시점에 `checkout_at <= now()`
 * 로 거르면 **오늘 시작한 대여가 전부 탈락**한다(정오 < 09:00 이 거짓).
 * 시작 판정 SSOT 는 "KST 날짜" 이므로(DB book_checkout_started),
 * 오늘 날짜에 속하는 모든 시각을 포함하도록 상한을 KST 익일 00:00 으로 둔다.
 *
 *   started(c)  ==  c.checkout_at < KST(오늘+1일) 00:00
 */
function kstStartedUpperBoundISO(nowMs: number): string {
  return new Date(kstDayEpoch(nowMs) + 86400000 - KST_OFFSET_MS).toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const nowMs    = Date.now()
  const todayKST = kstDateStr(nowMs)

  try {
    // ══════════════════════════════════════════════════════════════════════
    // [0] 대여 시작일 도래 처리 (← [2026-07-21] 예약 기능 도입)
    //
    //   start_due_book_checkouts() 가 두 가지를 한다.
    //     ① 시작일이 지난 예약의 books.status 를 'borrowed' 로 전환
    //     ② 아직 시작 알림을 안 보낸 건의 목록 반환
    //
    //   전환과 "발송 완료 마킹"을 분리한 이유: 알림 발송이 실패했는데
    //   notified_started 가 먼저 찍히면 그 사용자는 영구히 시작 알림을 못 받는다.
    //   발송에 성공한 id 만 모아 마지막에 mark_book_start_notified 로 기록한다.
    //
    //   이 블록이 실패해도 아래 반납 알림은 계속 진행한다 — 둘은 독립 기능이고,
    //   시작 알림 하나 때문에 연체 알림 전체가 멈추면 피해가 더 크다.
    // ══════════════════════════════════════════════════════════════════════
    let startedSent = 0
    const startedResults: any[] = []
    try {
      const { data: startRows, error: startErr } =
        await supabase.rpc('start_due_book_checkouts')

      if (startErr) throw new Error(`시작일 배치 실패: ${startErr.message}`)

      const okIds: string[] = []
      for (const sr of (startRows ?? [])) {
        const { error: e } = await supabase.functions.invoke('send-notification', {
          body: {
            type: 'book_started',
            booking: {
              id:           sr.checkout_id,
              title:        sr.book_title ?? '(제목 없음)',
              user_id:      sr.user_id,
              book_title:   sr.book_title ?? '(제목 없음)',
              due_at:       sr.due_at,
              due_date_kst: kstDateStr(sr.due_at),
            },
          },
        })
        if (e) {
          startedResults.push({ id: sr.checkout_id, type: 'book_started', status: 'send_failed', error: e.message })
          continue
        }
        okIds.push(sr.checkout_id)
        startedSent++
        startedResults.push({ id: sr.checkout_id, type: 'book_started', status: 'sent' })
      }

      if (okIds.length > 0) {
        const { error: markErr } =
          await supabase.rpc('mark_book_start_notified', { p_checkout_ids: okIds })
        // 마킹 실패는 다음 실행에서 재발송으로 이어진다(중복 발송).
        // 조용히 넘기지 않고 로그를 남겨 추적 가능하게 한다.
        if (markErr) console.error('[book-due-reminder] 시작 알림 마킹 실패:', markErr.message)
      }
    } catch (e) {
      console.error('[book-due-reminder] 시작일 처리 오류:', e)
      startedResults.push({ status: 'batch_failed', error: String((e as any)?.message ?? e) })
    }

    // ══════════════════════════════════════════════════════════════════════
    // [0-2] 연체 제재 만료 처리 (← [2026-07-21])
    //
    //   ends_at 이 지나면 제재는 자동으로 풀린다(book_penalty_state 가
    //   ends_at > now() 만 유효로 보므로). 하지만 그 순간 도는 코드가 없어
    //   사용자는 언제 풀렸는지 알 수 없다. 여기서 하루 한 번 통지한다.
    //
    //   [0] 블록과 같은 이유로 조회와 마킹을 분리한다 —
    //   마킹이 먼저 찍히면 발송 실패 건은 영구 미통지가 된다.
    //
    //   still_blocked(다른 제재가 아직 남음)는 발송을 건너뛰고 마킹만 한다.
    //   보내면 거짓말이 되고, 마킹을 안 하면 매일 다시 잡혀 배치가 헛돈다.
    // ══════════════════════════════════════════════════════════════════════
    let clearedSent = 0
    const clearedResults: any[] = []
    try {
      const { data: expRows, error: expErr } =
        await supabase.rpc('expire_book_penalties')

      if (expErr) throw new Error(`제재 만료 조회 실패: ${expErr.message}`)

      const markIds: string[] = []
      for (const p of (expRows ?? [])) {
        if (p.still_blocked) {
          // 다른 제재가 남아 있다 → 알리지 않고 마킹만
          markIds.push(p.penalty_id)
          clearedResults.push({ id: p.penalty_id, status: 'skip_still_blocked' })
          continue
        }

        const { error: e } = await supabase.functions.invoke('send-notification', {
          body: {
            type: 'book_penalty_cleared',
            booking: {
              // ★ 딥링크 규약: 도서 알림의 booking_id 는 book_checkouts.id 다.
              //   penalty_id 를 넣으면 클릭 시 대여 건을 못 찾아 빈 화면이 뜬다.
              //   checkout 이 지워진 건은 폴백해도 모달이 '찾을 수 없음' 을 안내한다.
              id:           p.checkout_id ?? p.penalty_id,
              title:        p.book_title ?? '도서 대여',
              user_id:      p.user_id,
              book_title:   p.book_title ?? '',
              penalty_tier: p.tier,
              // 해제 알림에는 until 을 싣지 않는다 — 이미 풀렸다
            },
          },
        })
        if (e) {
          clearedResults.push({ id: p.penalty_id, status: 'send_failed', error: e.message })
          continue
        }
        markIds.push(p.penalty_id)
        clearedSent++
        clearedResults.push({ id: p.penalty_id, status: 'sent' })
      }

      if (markIds.length > 0) {
        const { error: markErr } = await supabase.rpc(
          'mark_book_penalty_cleared_notified', { p_penalty_ids: markIds })
        if (markErr) console.error('[book-due-reminder] 제재 해제 마킹 실패:', markErr.message)
      }
    } catch (e) {
      console.error('[book-due-reminder] 제재 만료 처리 오류:', e)
      clearedResults.push({ status: 'batch_failed', error: String((e as any)?.message ?? e) })
    }

    // ══════════════════════════════════════════════════════════════════════
    // [1] 반납 알림 (기존)
    // ══════════════════════════════════════════════════════════════════════
    //   ← [2026-07-21] checkout_at 조건 추가.
    //     예약(미래 시작) 건도 status='active' 라 이 질의에 걸린다. 지금은
    //     예약 최대 3일 + 대여 7일이라 dDiff 가 최소 7이어서 우연히 무해하지만,
    //     상수가 바뀌면 "아직 받지도 않은 책의 반납 알림"이 나간다.
    //     시작하지 않은 대여는 반납 알림 대상이 아니라는 것을 명시한다.
    const { data: rows, error } = await supabase
      .from('book_checkouts')
      .select(`
        id, user_id, due_at, extension_count,
        notified_due_tomorrow, notified_due_today, notified_overdue_on,
        books ( title, author )
      `)
      .eq('status', 'active')
      // ← [2026-07-23] .lte(now) → .lt(KST 익일 자정).
      //   now() 비교는 정오 저장 규칙과 어긋나 오늘 시작 건을 통째로 떨어뜨렸다.
      .lt('checkout_at', kstStartedUpperBoundISO(nowMs))

    if (error) throw new Error(`대여 목록 조회 실패: ${error.message}`)

    if (!rows || rows.length === 0) {
      return json({
        success: true, message: '반납 알림 대상 없음', date: todayKST,
        sent: 0, startedSent, startedResults, clearedSent, clearedResults,
      })
    }

    let sent = 0, skipped = 0
    const results: any[] = []

    for (const r of rows) {
      const diff = dueDayDiff(r.due_at, nowMs)

      // 발송 대상 타입 판정 (KST 날짜 단위 — 시각 무관)
      let type: string | null = null
      let dedupeColumn: string | null = null

      if (diff === 1) {
        type = 'book_due_tomorrow'
        dedupeColumn = 'notified_due_tomorrow'
      } else if (diff === 0) {
        type = 'book_due_today'
        dedupeColumn = 'notified_due_today'
      } else if (diff < 0) {
        type = 'book_overdue'
        dedupeColumn = 'notified_overdue_on'   // 매일 1회 반복
      }

      if (!type) { skipped++; continue }   // 아직 여유 (D-2 이상)

      // ── 중복 발송 방지: 이미 오늘(KST) 발송했으면 skip ────────────────────
      const already = r[dedupeColumn!]
      if (already && kstDateStr(already) === todayKST) {
        skipped++
        results.push({ id: r.id, type, status: 'skip_already_sent' })
        continue
      }

      // ── 발송 (이메일 + 인앱 동시) ─────────────────────────────────────────
      //   ← [2026-07-20 fix] send-notification 은 { type, booking } 형태만 받는다
      //     (핸들러 첫 줄: const { type, booking } = payload → 없으면 400).
      //     기존 코드는 필드를 최상위에 평평하게 보내 100% 400 실패했다.
      //     MyBookLoans.tsx 의 book_extended 호출과 동일한 형태로 통일한다.
      const bookTitle = Array.isArray(r.books) ? r.books[0]?.title : r.books?.title

      const { error: sendErr } = await supabase.functions.invoke('send-notification', {
        body: {
          type,
          booking: {
            id:              r.id,                 // book_checkouts.id
            title:           bookTitle ?? '(제목 없음)',   // 메일 타이틀 = 도서명
            user_id:         r.user_id,            // → recipients(book_borrower) 해석 키
            book_title:      bookTitle ?? '(제목 없음)',
            due_at:          r.due_at,
            due_date_kst:    kstDateStr(r.due_at), // 이미 KST로 계산된 문자열
            days_overdue:    diff < 0 ? Math.abs(diff) : 0,
            extension_count: r.extension_count ?? 0,
          },
        },
      })

      if (sendErr) {
        results.push({ id: r.id, type, status: 'send_failed', error: sendErr.message })
        continue
      }

      // ── 발송 성공 기록 (멱등 보장) ────────────────────────────────────────
      await supabase
        .from('book_checkouts')
        .update({ [dedupeColumn!]: todayKST })
        .eq('id', r.id)

      sent++
      results.push({ id: r.id, type, status: 'sent', dDiff: diff })
    }

    console.log(
      `[book-due-reminder] ${todayKST} KST 09:00 — ` +
      `반납알림 ${sent}건 / 스킵 ${skipped}건 / 대여시작 ${startedSent}건 / 제재해제 ${clearedSent}건`,
    )

    return json({
      success: true, date: todayKST, sent, skipped, results,
      startedSent, startedResults, clearedSent, clearedResults,
    })

  } catch (e) {
    console.error('[book-due-reminder] 오류:', e)
    return json({ success: false, error: String(e?.message ?? e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}