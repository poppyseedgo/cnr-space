// ⚠ LOCAL_ONLY — #shipping 진입·로그인 복원 + 기존 화면 진입 경로 회귀 검증 (실브라우저). 운영 실행 금지.
//
// 수정 전 빌드(main)와 수정 후 빌드를 같은 시나리오로 돌려 비교한다. Supabase 응답만 가짜로 돌려준다
// (실제 백엔드에는 요청이 나가지 않는다: HTTP 는 전부 가로채고, WebSocket 은 닫고, 그 외 외부 주소는 차단).
// 방식은 _sim_booking_guard/LOCAL_ONLY__org_deeplink_ui_test.cjs 와 동일.
//
// 실행:
//   VITE_SUPABASE_URL=https://simref.supabase.test VITE_SUPABASE_ANON_KEY=sim npx vite build --outDir /tmp/shiproute/dist-after
//   (main 을 worktree 로 체크아웃해 같은 방식으로)                                          --outDir /tmp/shiproute/dist-before
//   NODE_PATH=$(npm root -g) node LOCAL_ONLY__shipping_route_ui_test.cjs /tmp/shiproute/dist-before /tmp/shiproute/dist-after
//
// 판정
//   · fix  = 이번 변경 대상(#shipping) — 수정 전 기대(홈으로 떨어짐)와 수정 후 기대를 각각 확인
//   · same = 건드리지 않은 경로 — 수정 전·후 결과(화면 종류·해시·저장값)가 완전히 같아야 한다
//   · api  = 수정 후 빌드에서 실제 shippingApi 가 보내는 요청 모양 확인 (RPC 이름·인자 이름·조회 조건)
const { chromium } = require('playwright')
const http = require('http'), fs = require('fs'), path = require('path')

const [BEFORE, AFTER] = process.argv.slice(2)
if (!BEFORE || !AFTER) { console.error('사용법은 파일 상단 참조'); process.exit(2) }
const SB = 'https://simref.supabase.test', STORAGE_KEY = 'sb-simref-auth-token'
const ME = '11111111-1111-1111-1111-111111111111', EMAIL = 'tester@cnrres.com'
const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')

function serve(dist, port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let f = path.join(dist, decodeURIComponent(q.url.split('?')[0]))
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html')
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r)
    }).listen(port, '127.0.0.1', () => res(s))
  })
}

async function run(port, { profileRole = 'USER', roles = [], flow }) {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const origin = `http://127.0.0.1:${port}`
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'azure' }, user_metadata: { full_name: '테스터' } }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, email: EMAIL, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user }
  const me = { id: ME, email: EMAIL, name: '테스터', dept: 'QA', role: profileRole, is_active: true, employment_status: 'active', avatar_url: null, employee_id: EMAIL, employee_no: '20990001' }
  const state = { calls: [], shipping: [] }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/*' }, body: JSON.stringify(body) })
  await ctx.routeWebSocket(/.*/, ws => ws.close())
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin === origin) return route.continue()
    if (u.origin !== SB) return route.abort()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = u.pathname, single = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    if (p === '/auth/v1/user') return json(route, user)
    if (p.startsWith('/auth/v1/token')) return json(route, session)
    if (p.startsWith('/auth/v1/')) return json(route, {})
    // ── 운송내역서 (수정 후 빌드만 호출한다) ──
    if (p === '/rest/v1/shipping_records') { state.calls.push({ m: req.method(), p, q: u.search }); return json(route, state.shipping.filter(r => !r.deleted_at).slice().reverse()) }
    if (p === '/rest/v1/rpc/has_admin_role') { const b = req.postDataJSON(); state.calls.push({ m: 'RPC', p, b }); return json(route, roles.includes(b.role_name) || roles.includes('super')) }
    if (p === '/rest/v1/rpc/shipping_create') {
      const b = req.postDataJSON(); state.calls.push({ m: 'RPC', p, b })
      const row = { id: 'id' + (state.shipping.length + 1), shipping_no: `택배-20991231-00${state.shipping.length + 1}`, issued_on: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), seq: state.shipping.length + 1,
        user_id: ME, user_name: '테스터', user_email: EMAIL, employee_no: '20990001', amount: 0, weight_g: 0, created_at: new Date().toISOString(), updated_at: '', deleted_at: null,
        ...b.p, quantity: Number(b.p.quantity), unit: b.p.unit || null }
      state.shipping.push(row); return json(route, row)
    }
    if (p === '/rest/v1/rpc/shipping_update' || p === '/rest/v1/rpc/shipping_delete') {
      const b = req.postDataJSON(); state.calls.push({ m: 'RPC', p, b })
      const row = state.shipping.find(r => r.id === b.p_id)
      if (p.endsWith('delete')) { row.deleted_at = 'x'; return json(route, row.id) }
      Object.assign(row, b.p, { quantity: Number(b.p.quantity) }); return json(route, row)
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/')) return json(route, single ? {} : [])
    if (p === '/rest/v1/admin_roles') return json(route, roles.map(role => ({ role })))
    if (p === '/rest/v1/profiles') return json(route, single ? me : [me])
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (p.startsWith('/functions/v1/')) return json(route, {})
    return json(route, single ? null : [])
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await page.addInitScript(([key, sess]) => {
    if (location.protocol !== 'http:') return
    if (sessionStorage.getItem('__logged_in') === '1') localStorage.setItem(key, JSON.stringify(sess)); else localStorage.removeItem(key)
  }, [STORAGE_KEY, session])

  const h = {
    origin, state,
    markLoggedIn: async () => { await page.evaluate(() => sessionStorage.setItem('__logged_in', '1')) },
    startLoggedIn: async () => { await page.goto(origin + '/__blank'); await page.evaluate(() => { sessionStorage.setItem('__logged_in', '1') }) },
    // 본 화면(헤더 전체 메뉴 버튼) · 운송내역서 단독 페이지 · 로그인 화면 중 하나가 뜰 때까지 기다린 뒤, 리다이렉트·권한 확인이 끝나도록 잠시 둔다
    settle: async () => {
      await page.waitForSelector('button[aria-label="전체 메뉴 열기"], .shp-root, .hri-root, :text("Sign in with Microsoft")', { timeout: 20000 })
      await page.waitForTimeout(2500)
    },
  }
  let flowError = null, extra = null
  try { extra = await flow(page, h) } catch (e) { flowError = String(e).split('\n')[0].slice(0, 200) }
  const o = await page.evaluate(() => {
    const body = document.body ? document.body.innerText : ''
    const kind = document.querySelector('.shp-root') ? 'shipping'
      : document.querySelector('.hri-root') ? 'hr-interview'
      : body.includes('Sign in with Microsoft') ? 'login'
      : document.querySelector('button[aria-label="전체 메뉴 열기"]') ? 'app' : 'unknown'
    return { kind, hash: location.hash, saved: sessionStorage.getItem('cnr_deeplink'), sideAdmin: !!document.querySelector('aside'), head: body.slice(0, 60).replace(/\s+/g, ' ') }
  })
  await browser.close()
  return { ...o, flowError, errors: errors.length, extra }
}

// 로그인 상태로 hash 를 연다
const openLoggedIn = hash => async (page, h) => { await h.startLoggedIn(); await page.goto(h.origin + '/' + hash); await h.settle() }
// 로그아웃 상태로 hash 를 연다 → 로그인 화면 → Microsoft 로그인 뒤 리다이렉트(redirectTo = origin, 해시 없음)
const openThenLogin = hash => async (page, h) => {
  await page.goto(h.origin + '/' + hash); await h.settle()
  await h.markLoggedIn(); await page.goto(h.origin + '/'); await h.settle()
}

const SAME = [
  ['로그인 · 해시 없음',            {}, openLoggedIn('')],
  ['로그인 · #home',                {}, openLoggedIn('#home')],
  ['로그인 · #calendar',            {}, openLoggedIn('#calendar')],
  ['로그인 · #mypage',              {}, openLoggedIn('#mypage')],
  ['로그인 · #library',             {}, openLoggedIn('#library')],
  ['로그인 · #resources',           {}, openLoggedIn('#resources')],
  ['로그인 · #announcements',       {}, openLoggedIn('#announcements')],
  ['로그인 · #release-notes',       {}, openLoggedIn('#release-notes')],
  ['로그인 · #hr-interview',        {}, openLoggedIn('#hr-interview')],
  ['로그인 · #myloans',             {}, openLoggedIn('#myloans')],
  ['로그인 · #workboard (권한 있음)', { roles: ['workboard'] }, openLoggedIn('#workboard')],
  ['로그인 · #workboard (권한 없음)', {}, openLoggedIn('#workboard')],
  ['로그인 · #admin (ADMIN)',        { profileRole: 'ADMIN', roles: ['booking', 'user'] }, openLoggedIn('#admin')],
  ['로그인 · #admin (일반 직원)',     {}, openLoggedIn('#admin')],
  ['로그인 · #admin-org-{id} (org)', { profileRole: 'ADMIN', roles: ['org'] }, openLoggedIn('#admin-org-' + FILE)],
  ['로그인 · #booking-없는예약',     {}, openLoggedIn('#booking-b0_0')],
  ['로그인 · 없는 해시 #nonsense',   {}, openLoggedIn('#nonsense')],
  ['로그인 · 비슷한 해시 #shippingx', {}, openLoggedIn('#shippingx')],
  ['로그인 · shipping 역할만 보유 #home (어드민 진입 불가 유지)', { roles: ['shipping'] }, openLoggedIn('#admin')],
  ['로그아웃→로그인 · 해시 없음',     {}, openThenLogin('')],
  ['로그아웃→로그인 · #calendar',     {}, openThenLogin('#calendar')],
  ['로그아웃→로그인 · #myloans',      {}, openThenLogin('#myloans')],
  ['로그아웃→로그인 · #hr-interview', {}, openThenLogin('#hr-interview')],
  ['로그아웃→로그인 · #workboard-task-1 (권한 있음)', { roles: ['workboard'] }, openThenLogin('#workboard-task-1')],
  ['로그아웃→로그인 · #admin-org-{id} (org)', { profileRole: 'ADMIN', roles: ['org'] }, openThenLogin('#admin-org-' + FILE)],
]

const FIX = [
  ['F1 로그인 · #shipping', {}, openLoggedIn('#shipping'),
    { before: { kind: 'app', hash: '#home' }, after: { kind: 'shipping', hash: '#shipping', saved: null } }],
  ['F2 로그아웃→로그인 · #shipping (공지 링크로 처음 들어온 직원)', {}, openThenLogin('#shipping'),
    { before: { kind: 'app' }, after: { kind: 'shipping', hash: '#shipping', saved: null } }],
  ['F3 로그인 · #shipping → 새로고침', {}, async (page, h) => { await h.startLoggedIn(); await page.goto(h.origin + '/#shipping'); await h.settle(); await page.reload(); await h.settle() },
    { before: { kind: 'app', hash: '#home' }, after: { kind: 'shipping', hash: '#shipping', saved: null } }],
  ['F4 로그아웃 · #shipping → 로그인 화면에 머무름', {}, async (page, h) => { await page.goto(h.origin + '/#shipping'); await h.settle() },
    { before: { kind: 'login' }, after: { kind: 'login', saved: 'shipping' } }],
]

;(async () => {
  const sB = await serve(BEFORE, 5311), sA = await serve(AFTER, 5312)
  const R = []; const ok = (n, c, extra = '') => { R.push(!!c); console.log(c ? 'PASS' : 'FAIL', n, extra) }
  const sig = o => JSON.stringify({ kind: o.kind, hash: o.hash, saved: o.saved, sideAdmin: o.sideAdmin, head: o.head, flowError: o.flowError, errors: o.errors })
  const match = (o, want) => Object.entries(want).every(([k, v]) => o[k] === v)

  console.log('== fix: #shipping (수정 전 → 수정 후)')
  for (const [name, opt, flow, want] of FIX) {
    const b = await run(5311, { ...opt, flow }), a = await run(5312, { ...opt, flow })
    ok(name, match(b, want.before) && match(a, want.after) && !a.flowError && a.errors === 0,
      `전: ${b.kind} ${b.hash} / 후: ${a.kind} ${a.hash} saved=${a.saved}`)
  }

  console.log('== same: 기존 경로 (수정 전·후 결과가 같아야 한다)')
  for (const [name, opt, flow] of SAME) {
    const b = await run(5311, { ...opt, flow }), a = await run(5312, { ...opt, flow })
    ok(name, sig(b) === sig(a), `${a.kind} ${a.hash}${a.sideAdmin ? ' (어드민 메뉴)' : ''}` + (sig(b) === sig(a) ? '' : `\n     전: ${sig(b)}\n     후: ${sig(a)}`))
  }

  console.log('== api: 수정 후 빌드의 실제 요청 모양')
  const fill = async page => {
    await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
    await page.fill('#shp-project', '24-046'); await page.locator('input[name=shp-billable]').nth(0).check(); await page.selectOption('#shp-item', 'parcel')
    await page.fill('#shp-qty', '2'); await page.locator('input[name=shp-region]').nth(1).check()
    await page.fill('#shp-sname', '테스터'); await page.fill('#shp-sphone', '010-0000-0000')
    await page.fill('#shp-rname', '수신인'); await page.fill('#shp-rphone', '02-000-0000'); await page.fill('#shp-raddr1', '부산광역시 예시구 1'); await page.fill('#shp-raddr2', '2층')
    await page.click('.shp-actions button:text-is("등록")'); await page.waitForSelector('.shp-table')
  }
  const a1 = await run(5312, { roles: [], flow: async (page, h) => {
    await h.startLoggedIn(); await page.goto(h.origin + '/#shipping'); await h.settle()
    const tabsBefore = await page.locator('.shp-tabs button').count()
    await fill(page)
    const rowText = (await page.locator('.shp-table tbody tr').first().innerText()).replace(/\s+/g, ' ')
    await page.locator('.shp-table tbody tr').first().locator('button:text-is("수정")').click(); await page.waitForSelector('#shp-qty')
    await page.fill('#shp-qty', '7'); await page.click('.shp-actions button:text-is("저장")'); await page.waitForSelector('.shp-table')
    await page.locator('.shp-table tbody tr').first().locator('button:text-is("삭제")').click()
    await page.locator('button', { hasText: /^삭제$/ }).last().click(); await page.waitForSelector('.shp-empty')
    return { tabsBefore, rowText, calls: h.state.calls }
  } })
  const c = (a1.extra && a1.extra.calls) || []
  const create = c.find(x => x.p.endsWith('shipping_create')), update = c.find(x => x.p.endsWith('shipping_update')), del = c.find(x => x.p.endsWith('shipping_delete'))
  const role = c.find(x => x.p.endsWith('has_admin_role')), list = c.find(x => x.p === '/rest/v1/shipping_records')
  ok('A1 흐름 오류 없음', !a1.flowError && a1.errors === 0, a1.flowError || '')
  ok('A2 관리자 판정 = has_admin_role({role_name:"shipping"})', role && role.b.role_name === 'shipping')
  ok('A3 역할 없으면 메뉴 2개', a1.extra && a1.extra.tabsBefore === 2)
  ok('A4 본인 목록 조회 조건(user_id · deleted_at is null · 최신순)', list && list.q.includes(`user_id=eq.${ME}`) && list.q.includes('deleted_at=is.null') && list.q.includes('order=created_at.desc'), list && decodeURIComponent(list.q))
  const P = create && create.b.p
  ok('A5 shipping_create 인자 이름 p + 21칸, 화면 전용 값(senderKey) 미포함', P && Object.keys(create.b).join() === 'p' && Object.keys(P).length === 21 && !('senderKey' in P), P && Object.keys(P).join(','))
  ok('A6 값 형식: 청구여부 boolean · 코드값 · 수량 문자열', P && P.billable === true && P.item_type === 'parcel' && P.direction === 'send' && P.unit === 'document' && P.region === 'other' && P.quantity === '2')
  ok('A7 등록자·번호는 보내지 않는다(서버가 채움)', P && !('user_name' in P) && !('employee_no' in P) && !('shipping_no' in P) && !('user_id' in P))
  ok('A8 발신처 본사 기본값이 payload 에 실림', P && P.sender_company === '씨엔알리서치(본사)' && P.sender_addr1 === '서울특별시 강남구 역삼로 412')
  ok('A9 RPC 응답의 번호를 목록에 그대로 표시', a1.extra && a1.extra.rowText.includes('택배-20991231-001'), a1.extra && a1.extra.rowText)
  ok('A10 shipping_update 인자 p_id + p', update && Object.keys(update.b).sort().join() === 'p,p_id' && update.b.p.quantity === '7' && update.b.p_id === 'id1')
  ok('A11 shipping_delete 인자 p_id', del && Object.keys(del.b).join() === 'p_id' && del.b.p_id === 'id1')

  const a2 = await run(5312, { roles: ['shipping'], flow: async (page, h) => {
    await h.startLoggedIn(); await page.goto(h.origin + '/#shipping'); await h.settle()
    const tabs = await page.locator('.shp-tabs button').allInnerTexts()
    await page.click('text=운송내역서(관리자)'); await page.waitForSelector('.shp-empty, .shp-table-admin')
    await page.fill('#shp-a-proj', '24-0'); await page.fill('#shp-a-emp', '테스'); await page.selectOption('#shp-a-item', 'quick'); await page.selectOption('#shp-a-dir', 'receive'); await page.fill('#shp-a-track', '807')
    await page.click('button:text-is("검색")'); await page.waitForTimeout(800)
    return { tabs, calls: h.state.calls }
  } })
  const q = a2.extra ? decodeURIComponent((a2.extra.calls.filter(x => x.p === '/rest/v1/shipping_records').pop() || {}).q || '') : ''
  ok('A12 shipping 역할 → 관리자 메뉴 노출', a2.extra && a2.extra.tabs.join('/') === '운송내역서 조회/운송내역서 인쇄/운송내역서(관리자)')
  ok('A13 관리자 검색 조건 6종이 조회에 실림', ['project_no=ilike.%24-0%', 'user_name=ilike.%테스%', 'item_type=eq.quick', 'direction=eq.receive', 'tracking_no=ilike.%807%', 'requested_on=gte.', 'requested_on=lte.', 'deleted_at=is.null'].every(s => q.includes(s)), q)
  ok('A14 관리자 조회는 user_id 조건 없음(전체)', q && !q.includes('user_id='))

  console.log(`\n결과: ${R.filter(Boolean).length}/${R.length} PASS`)
  sB.close(); sA.close()
  process.exit(R.every(Boolean) ? 0 : 1)
})().catch(e => { console.error('ERR', e); process.exit(2) })
