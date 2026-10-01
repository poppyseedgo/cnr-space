/**
 * wb-daily-digest — Work Space 일일 다이제스트 (Phase 5-B)
 * 실행: 매일 09:00 KST (cron 'wb-daily-digest-0900kst' · '0 0 * * *' UTC — 도서/자원 리마인더와 동일 시각, 20261004 [E])
 *
 * 흐름 (멤버 1명 = 메일 1통):
 *   ① 수신자 = notification_resolve_recipients('wb_daily_digest')  → 자격 workboard ∩ 지정 · 재직 (개인 채널 OFF 는 send-notification 이 적용)
 *   ② wb_digest_log (user_id, today) 있으면 건너뜀 — 같은 날 재실행·수동 호출 보호
 *   ③ wb_digest_build(user, today, scope) → total 0 이면 'empty' 기록 후 미발송 (고지 확정: 항목 없는 날은 안 보냄)
 *   ④ send-notification invoke { type:'wb_daily_digest', booking:{ id:'digest-{date}', wb_target_type:'user', wb_target_id, wb_digest } }
 *      — 채널 게이트·개인 설정·렌더·인앱·발송 로그는 그쪽 SSOT
 *   ⑤ wb_digest_log 에 sent / failed:<사유> 기록 (failed 는 다음 실행에서 재시도되지 않는다 — 09:00 한 번의 요약이므로. 수동은 ?force=1)
 *
 * 수동 호출: POST /wb-daily-digest?date=YYYY-MM-DD&force=1  (force = 로그 무시하고 재발송, 운영 점검용)
 * scope: 현재 'all' 고정 (멤버 전원 업무 · 본인 담당 '나'). 후속: 개인 선택('mine') 을 설정으로 노출 → 여기서 사용자별 scope 조회만 추가
 *
 * ✅ 변경 이력
 *  - [2026-09-30 5-B] 최초 작성
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/** KST 오늘 'YYYY-MM-DD' — UTC cron 이므로 반드시 변환 */
function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const url = new URL(req.url)
  const date  = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('date') ?? '') ? url.searchParams.get('date')! : todayKST()
  const force = url.searchParams.get('force') === '1'
  const scope = 'all'   // ← 고지 확정 2026-09-30: 일단 전원 업무. 개인 선택은 후속
  const result = { date, members: 0, sent: 0, empty: 0, skipped: 0, failed: 0, details: [] as { name: string; result: string }[] }

  // ① 수신자
  const { data: members, error: mErr } = await supabase.rpc('notification_resolve_recipients', { p_type: 'wb_daily_digest', p_exclude: null })
  if (mErr) {
    console.error('[wb-daily-digest] 수신자 조회 실패:', mErr.message)
    return new Response(JSON.stringify({ error: mErr.message }), { status: 500 })
  }
  result.members = (members ?? []).length

  // ② 오늘 이미 기록된 사람
  const { data: logged } = await supabase.from('wb_digest_log').select('user_id, result').eq('digest_date', date)
  const done = new Map<string, string>((logged ?? []).map((r: any) => [r.user_id, r.result]))

  for (const m of (members ?? []) as any[]) {
    if (!force && done.has(m.user_id)) { result.skipped++; result.details.push({ name: m.name, result: `skipped(${done.get(m.user_id)})` }); continue }
    let outcome = ''
    try {
      // ③ 재료
      const { data: digest, error: dErr } = await supabase.rpc('wb_digest_build', { p_user: m.user_id, p_date: date, p_scope: scope })
      if (dErr) throw new Error(`digest_build: ${dErr.message}`)
      const counts = digest?.counts ?? null
      if (!digest || (digest.total ?? 0) === 0) {
        outcome = 'empty'; result.empty++
      } else {
        // ④ 발송 — 수신자 1명 (send-notification 이 wb_notification_recipients('wb_daily_digest','user',id) 로 다시 자격·개인설정 확인)
        const { data: res, error: fnErr } = await supabase.functions.invoke('send-notification', {
          body: {
            type: 'wb_daily_digest',
            booking: { id: `digest-${date}`, title: '', wb_target_type: 'user', wb_target_id: m.user_id, wb_digest: { ...digest, recipient_name: m.name } },
          },
        })
        if (fnErr) throw fnErr
        if (res && res.success === false && (res.emailFailed ?? 0) > 0) throw new Error(`email failed ${res.emailFailed}`)
        outcome = 'sent'; result.sent++
      }
      // ⑤ 기록 (force 재발송은 upsert)
      const { error: lErr } = await supabase.from('wb_digest_log').upsert({ user_id: m.user_id, digest_date: date, counts, result: outcome, sent_at: new Date().toISOString() })
      if (lErr) console.warn(`[wb-daily-digest] 로그 기록 실패 user=${m.user_id}:`, lErr.message)
    } catch (e: any) {
      outcome = `failed:${String(e?.message ?? e).slice(0, 120)}`; result.failed++
      console.error(`[wb-daily-digest] 실패 user=${m.user_id} (${m.name}):`, e)
      await supabase.from('wb_digest_log').upsert({ user_id: m.user_id, digest_date: date, result: outcome, sent_at: new Date().toISOString() }).then(({ error }: any) => { if (error) console.warn('[wb-daily-digest] 실패 로그 기록 실패:', error.message) })
    }
    result.details.push({ name: m.name, result: outcome })
  }

  console.log(`[wb-daily-digest] ${date} — 멤버 ${result.members} · 발송 ${result.sent} · 0건 ${result.empty} · 건너뜀 ${result.skipped} · 실패 ${result.failed}`)
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
})
