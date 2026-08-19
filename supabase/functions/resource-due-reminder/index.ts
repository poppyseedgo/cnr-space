/**
 * resource-due-reminder — 자원 반납일 안내 + 연체 알림 (Phase 4)
 *
 * 실행: 매일 09:00 KST (cron '0 0 * * *' UTC) — 도서 book-due-reminder 와 동일 시각 (고지 확정)
 *
 * 판정 (KST 오늘 = today):
 *  ① resource_due_reminder — return_due == today, 미반납, confirmed
 *  ② resource_overdue      — return_due <  today, 미반납, confirmed (매일 반복 — 도서 book_overdue 관례)
 *
 * 멱등: resource_bookings.notified_due_on / notified_overdue_on 에 발송일(KST date) 마킹.
 *       같은 날 재실행·수동 호출해도 중복 발송 없음 (book_checkouts dedupe 컬럼 패턴).
 *
 * 발송: send-notification 함수 invoke — 채널 게이트·수신자 해석·로그는 그쪽 SSOT.
 *       booking payload 의 *_kst 필드는 여기서 완성한 문자열 (수신측 재변환 금지 규칙).
 *
 * ✅ 변경 이력
 *  - [2026-08-19] 최초 작성 (Phase 4)
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** KST 오늘 'YYYY-MM-DD' — Intl(Asia/Seoul), UTC cron 이므로 반드시 변환 */
function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
/** ISO → 'H:MM' KST */
function hmKST(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: false,
  }).format(new Date(iso))
}
/** 'YYYY-MM-DD' → 'M/D(요일)' */
function fmtDue(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}/${d}(${dow})`
}
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.round((Date.parse(toYmd) - Date.parse(fromYmd)) / 86400000)
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const today = todayKST()
  const result = { dueReminded: 0, overdueNotified: 0, skipped: 0, failed: 0 }

  // 미반납 confirmed 중 반납일이 오늘이거나 지난 것 + 개체 라벨 조인
  const { data, error } = await supabase
    .from('resource_bookings')
    .select(`id, user_id, user_name, user_dept, start_at, end_at, return_due,
             notified_due_on, notified_overdue_on,
             resource_items ( label, resource_categories ( name ) )`)
    .eq('status', 'confirmed')
    .is('returned_at', null)
    .lte('return_due', today)
  if (error) {
    console.error('[resource-due-reminder] 조회 실패:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  for (const r of (data ?? []) as any[]) {
    const isOverdue = r.return_due < today
    const dedupeColumn = isOverdue ? 'notified_overdue_on' : 'notified_due_on'
    if (r[dedupeColumn] === today) { result.skipped++; continue }   // 오늘 이미 발송 (멱등)

    const item = Array.isArray(r.resource_items) ? r.resource_items[0] : r.resource_items
    const cat  = item ? (Array.isArray(item.resource_categories) ? item.resource_categories[0] : item.resource_categories) : null
    const label = `${cat?.name ?? '자원'} · ${item?.label ?? '-'}`

    try {
      const { error: fnErr } = await supabase.functions.invoke('send-notification', {
        body: {
          type: isOverdue ? 'resource_overdue' : 'resource_due_reminder',
          booking: {
            id:             r.id,
            title:          label,
            user_id:        r.user_id,
            user_name:      r.user_name,
            user_dept:      r.user_dept,
            resource_label: label,
            use_time_kst:   `${fmtDue(r.start_at.slice(0, 10))} ${hmKST(r.start_at)}~${hmKST(r.end_at)}`,
            return_due_kst: fmtDue(r.return_due),
            ...(isOverdue ? { days_overdue: daysBetween(r.return_due, today) } : {}),
          },
        },
      })
      if (fnErr) throw fnErr

      // 발송 성공 마킹 — 실패 시 마킹하지 않아 다음 실행에서 재시도
      await supabase.from('resource_bookings')
        .update({ [dedupeColumn]: today }).eq('id', r.id)
      isOverdue ? result.overdueNotified++ : result.dueReminded++
    } catch (e) {
      console.error(`[resource-due-reminder] 발송 실패 booking=${r.id}:`, e)
      result.failed++
    }
  }

  console.log('[resource-due-reminder]', today, JSON.stringify(result))
  return new Response(JSON.stringify({ ok: true, today, ...result }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
