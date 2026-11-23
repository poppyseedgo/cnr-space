// ⚠ LOCAL_ONLY — auto-cancel-bookings 실물 함수 스모크. 운영 실행 금지.
// supabase/functions/auto-cancel-bookings/index.ts 를 수정 없이 읽어 타입만 벗기고(esbuild),
// import(createClient)·Deno 전역만 메모리 목으로 바꿔 핸들러를 그대로 실행한다.
//   실행(저장소 루트에서): node supabase/migrations/_sim_emerald_expiry_20261123/LOCAL_ONLY__edge_smoke.mjs
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const SRC = readFileSync('supabase/functions/auto-cancel-bookings/index.ts', 'utf8')
const IMPORT = "import { createClient } from 'jsr:@supabase/supabase-js@2'"
if (!SRC.includes(IMPORT)) throw new Error('import 줄을 찾지 못함 — 스모크 갱신 필요')
const js = transformSync(SRC.replace(IMPORT, 'const { createClient } = globalThis.__mock'), { loader: 'ts', format: 'esm' }).code

// ── 메모리 DB + PostgREST 흉내 (필터 eq/is/gt/gte/lt/lte, update…select, rpc) ──
function makeWorld(rows, { failTypes = new Set() } = {}) {
  const sent = []
  const table = { bookings: rows, rooms: [{ room_id: 3, room_name: '2F Emerald', room_name_ko: '2층 에메랄드' }] }
  const match = (r, fs) => fs.every(([op, c, v]) => {
    const x = r[c]
    if (op === 'eq')  return x === v
    if (op === 'is')  return v === null ? (x === null || x === undefined) : x === v
    const a = new Date(x).getTime(), b = new Date(v).getTime()
    return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
  })
  const q = (t) => {
    const st = { fs: [], upd: null, sel: false, single: false }
    const run = () => {
      const hit = (table[t] ?? []).filter(r => match(r, st.fs))
      if (st.upd) { hit.forEach(r => Object.assign(r, st.upd)); return { data: st.sel ? hit.map(r => ({ id: r.id })) : null, error: null } }
      return { data: st.single ? (hit[0] ?? null) : hit.map(r => ({ ...r })), error: null }
    }
    const api = {
      select() { st.sel = true; return api }, update(o) { st.upd = o; return api }, single() { st.single = true; return api },
      eq(c, v) { st.fs.push(['eq', c, v]); return api }, is(c, v) { st.fs.push(['is', c, v]); return api },
      gt(c, v) { st.fs.push(['gt', c, v]); return api }, gte(c, v) { st.fs.push(['gte', c, v]); return api },
      lt(c, v) { st.fs.push(['lt', c, v]); return api }, lte(c, v) { st.fs.push(['lte', c, v]); return api },
      then(res, rej) { try { res(run()) } catch (e) { rej(e) } },     // await 시점에 한 번에 실행 = 조건부 UPDATE 원자성
    }
    return api
  }
  const client = { from: q, rpc: async () => ({ data: [], error: null }) }
  const fetchMock = async (_url, init) => {
    const { type, booking } = JSON.parse(init.body)
    if (failTypes.has(type)) return { ok: false, status: 500, text: async () => 'boom' }
    sent.push(`${type}:${booking.id}`)
    return { ok: true, status: 200, json: async () => ({ success: true, emailFailed: 0 }) }
  }
  return { client, fetchMock, sent, rows, failTypes }
}

async function load(world) {
  let handler
  globalThis.__mock = { createClient: () => world.client }
  globalThis.Deno = { env: { get: (k) => (k === 'SUPABASE_URL' ? 'http://local' : 'key') }, serve: (h) => { handler = h } }
  globalThis.fetch = world.fetchMock
  await import('data:text/javascript;base64,' + Buffer.from(js + `\n//${Math.random()}`).toString('base64'))
  const call = async (body) => {
    const res = await handler({ json: async () => { if (body === undefined) throw new Error('no body'); return body } })
    return JSON.parse(await res.text())
  }
  return call
}

const NOW = Date.now(), MIN = 60_000
const at = (ms) => new Date(NOW + ms).toISOString()
const bk = (id, o) => ({ id, room_id: 3, title: id, start_at: at(0), end_at: at(60 * MIN), status: 'pending', auto_cancelled: false, cancelled_by: null,
  checked_in: false, early_ended: false, approval_reminder_sent: false, pending_expired_notified: false, noshow_notified: false, original_end_at: null, ...o })
const seed = () => [
  bk('R1', { start_at: at(5 * MIN) }),                                                    // 승인 마감 5분 전 구간
  bk('R2', { start_at: at(7 * MIN) }),                                                    // 아직 구간 전
  bk('R3', { start_at: at(30_000) }),                                                     // 마감 지남, DB 전환 전(수 초 구간)
  bk('R4', { start_at: at(5 * MIN), room_id: 1 }),                                        // 다른 방 pending
  bk('X1', { start_at: at(-30_000), status: 'cancelled', auto_cancelled: true, cancelled_by: 'system' }),   // DB 가 기록한 기한초과
  bk('X2', { start_at: at(-120 * MIN), status: 'cancelled', auto_cancelled: true, cancelled_by: 'system' }), // 1시간 넘은 건
  bk('X3', { start_at: at(-30_000), status: 'cancelled', auto_cancelled: true, cancelled_by: 'user' }),     // 사용자 취소
  bk('X4', { start_at: at(-30_000), status: 'cancelled', auto_cancelled: true, cancelled_by: 'system', pending_expired_notified: true }), // 통지 완료
  bk('N1', { start_at: at(-20 * MIN), status: 'confirmed', auto_cancelled: true, cancelled_by: 'system' }), // 에메랄드 노쇼(confirmed)
  bk('X5', { start_at: at(-15 * MIN), status: 'cancelled', auto_cancelled: true, cancelled_by: 'system', pending_expired_notified: true }), // 기한초과 후 15분 경과(노쇼 알림 창 안)
]

let fail = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fail++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `→ got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
const snap = (rows) => rows.map(r => `${r.id}:${r.status}/${r.auto_cancelled}/${r.cancelled_by}`).join(' ')

// T1 깨움 호출(task=pending): ②③ 만 실행
{ const w = makeWorld(seed()); const before = snap(w.rows); const call = await load(w)
  const r = await call({ task: 'pending' })
  eq('T1 발송 = 임박 알림 R1 + 기한초과 알림 X1 뿐', w.sent.sort(), ['pending_expired:X1', 'pending_expiring:R1'])
  eq('T1 응답 통계', [r.task, r.reminderSent, r.pendingExpired, r.noshow], ['pending', 1, 1, 0])
  eq('T1 표식: 이번 호출로 새로 true 가 된 건 R1·X1 뿐', w.rows.filter(x => x.approval_reminder_sent || (x.pending_expired_notified && !['X4', 'X5'].includes(x.id))).map(x => x.id), ['R1', 'X1'])   // X4·X5 는 시드부터 통지 완료
  eq('T1 ★ 예약 상태(status·auto_cancelled·cancelled_by)는 한 건도 바뀌지 않음', snap(w.rows), before)
  const r2 = await call({ task: 'pending' })
  eq('T2 같은 호출 반복 → 추가 발송 없음', [w.sent.length, r2.reminderSent, r2.pendingExpired], [2, 0, 0]) }

// T3 정기 실행(body 없음): ②③ + 노쇼 알림
{ const w = makeWorld(seed()); const before = snap(w.rows); const call = await load(w)
  const r = await call(undefined)
  eq('T3 발송 = R1·X1 + 에메랄드 노쇼 N1 은 noshow 로만', w.sent.sort(), ['noshow:N1', 'pending_expired:X1', 'pending_expiring:R1'])
  eq('T3 노쇼 건에 기한초과 알림이 가지 않음', w.sent.includes('pending_expired:N1'), false)
  eq('T3 ★ 기한초과 건(X5)에 노쇼 알림이 가지 않음', w.sent.includes('noshow:X5'), false)
  eq('T3 예약 상태 불변', snap(w.rows), before)
  eq('T3 응답에 task 없음(정기 실행)', r.task, undefined) }

// T4 발송 실패 → 표식 되돌림 → 다음 호출 재시도 성공
{ const w = makeWorld(seed(), { failTypes: new Set(['pending_expired', 'pending_expiring']) }); const call = await load(w)
  await call({ task: 'pending' })
  eq('T4 실패 시 발송 0 · 표식 원복', [w.sent.length, w.rows.find(x => x.id === 'X1').pending_expired_notified, w.rows.find(x => x.id === 'R1').approval_reminder_sent], [0, false, false])
  w.failTypes.clear(); await call({ task: 'pending' })
  eq('T4 다음 호출에서 재발송 성공', w.sent.sort(), ['pending_expired:X1', 'pending_expiring:R1']) }

// T5 동시 호출 2건(매분 깨움 + 정기 실행이 겹친 경우) → 한 건은 한 번만
{ const w = makeWorld(seed()); const call = await load(w)
  await Promise.all([call({ task: 'pending' }), call({ task: 'pending' })])
  eq('T5 동시 호출에도 중복 발송 없음', w.sent.sort(), ['pending_expired:X1', 'pending_expiring:R1']) }

// T6 발송 직전에 관리자가 승인한 건은 임박 알림을 보내지 않음(선점 조건 status='pending')
{ const rows = seed(); const w = makeWorld(rows); const call = await load(w)
  const realFrom = w.client.from; let flipped = false
  w.client.from = (t) => { const api = realFrom(t); const u = api.update; api.update = (o) => { if (!flipped && 'approval_reminder_sent' in o) { flipped = true; rows.find(x => x.id === 'R1').status = 'confirmed' } return u(o) }; return api }
  await call({ task: 'pending' })
  eq('T6 승인된 건 임박 알림 미발송 · 표식 미변경', [w.sent.includes('pending_expiring:R1'), rows.find(x => x.id === 'R1').approval_reminder_sent], [false, false]) }

console.log(fail === 0 ? '\n전부 PASS' : `\nFAIL ${fail}`)
process.exit(fail ? 1 : 0)
