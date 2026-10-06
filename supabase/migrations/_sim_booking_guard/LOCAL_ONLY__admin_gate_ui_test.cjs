// ⚠ LOCAL_ONLY — 어드민 접근 게이트 실브라우저 검증 (운영과 무관, 로컬 전용)
//
// 실제 빌드 산출물을 Chromium 으로 열고 Supabase(https://simref.supabase.test) 응답만 가짜로 돌려준다.
// 프론트 코드는 한 줄도 바꾸지 않는다 — 수정 후 빌드와 수정 전(origin/main) 빌드를 같은 시나리오로 비교.
//
// 실행:
//   VITE_SUPABASE_URL=https://simref.supabase.test VITE_SUPABASE_ANON_KEY=sim npx vite build --outDir /tmp/gate/dist
//   (수정 전 커밋을 worktree 로 체크아웃해 같은 방식으로)                              --outDir /tmp/gate/dist-before
//   NODE_PATH=$(npm root -g) node LOCAL_ONLY__admin_gate_ui_test.cjs /tmp/gate/dist /tmp/gate/dist-before /tmp/gate/shots
const { chromium } = require('playwright')
const http = require('http'), fs = require('fs'), path = require('path')

const DIST_AFTER = process.argv[2], DIST_BEFORE = process.argv[3], ROOT = process.argv[4] || require('os').tmpdir()
if (!DIST_AFTER || !DIST_BEFORE) { console.error('사용법: node LOCAL_ONLY__admin_gate_ui_test.cjs <수정후 dist> <수정전 dist> [스크린샷 폴더]'); process.exit(2) }
fs.mkdirSync(ROOT, { recursive: true })
const SB = 'https://simref.supabase.test'
const UID = '11111111-1111-1111-1111-111111111111'
const EMAIL = 'tester@cnrres.com'
const ALL_ROLES = ['dashboard','booking','approval','room','user','visitor','book','notification','notice','kb','resource','org','super','workboard']

function serve(dir, port) {
  const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json' }
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let p = path.join(dir, decodeURIComponent(q.url.split('?')[0]))
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(dir, 'index.html')
      r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r)
    }).listen(port, '127.0.0.1', () => res(s))
  })
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const iso = h => new Date(Date.now() + h * 3600e3).toISOString()

async function scenario(browser, port, name, { profileRole, roles, url, steps = async () => {}, rolesFail = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const state = { roles, rolesFail, writes: [] }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'azure' }, user_metadata: { full_name: '테스터' } }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, email: EMAIL, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user }
  const profile = { id: UID, email: EMAIL, name: '테스터', dept: 'QA', role: profileRole, is_active: true, employment_status: 'active', avatar_url: null, employee_id: EMAIL }
  const rooms = [
    { room_id: 1, floor_id: 1, room_code: 'A', room_name: '1F Amber', room_name_ko: '앰버', capacity: 6, is_active: true, is_admin_only: false },
    { room_id: 3, floor_id: 2, room_code: 'E', room_name: '2F Emerald', room_name_ko: '에메랄드', capacity: 12, is_active: true, is_admin_only: true },
  ]
  const bookings = [{
    id: 'bSIM_0', room_id: 3, title: '시뮬 승인 대기', memo: '', attendees: [], start_at: iso(2), end_at: iso(3), user_id: UID, user_name: '테스터', user_dept: 'QA', user_email: EMAIL,
    checked_in: false, auto_cancelled: false, early_ended: false, recur_group_id: null, created_at: iso(-0.1), cancelled_by: null, status: 'pending',
    original_end_at: null, reject_reason: null, processed_by_name: null, processed_by_avatar: null, cancelled_by_user_id: null, purpose: 'part', purpose_detail: null, booking_attendees: [],
  }]
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/*' }, body: JSON.stringify(body) })

  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin === `http://127.0.0.1:${port}`) return route.continue()
    if (u.origin !== SB) return route.abort()                       // 폰트·GA 등 외부 요청은 차단
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = u.pathname, single = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    if (p === '/auth/v1/user') return json(route, user)
    if (p.startsWith('/auth/v1/token')) return json(route, session)
    if (p.startsWith('/auth/v1/')) return json(route, {})
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/')) {
      state.writes.push(`${req.method()} ${p}${u.search} ${req.postData() || ''}`)
      return json(route, single ? {} : [], 200)
    }
    if (p === '/rest/v1/admin_roles') return state.rolesFail ? json(route, { message: 'sim: 조회 실패' }, 500) : json(route, state.roles.map(role => ({ role })))
    if (p === '/rest/v1/profiles') return json(route, single ? profile : [profile])
    if (p === '/rest/v1/rooms') return json(route, rooms)
    if (p === '/rest/v1/bookings') return json(route, single ? bookings[0] : bookings)
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (p.startsWith('/functions/v1/')) return json(route, {})
    return json(route, single ? null : [])
  })

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  await page.addInitScript(([key, sess]) => {
    localStorage.setItem(key, JSON.stringify(sess))
    // 어드민 화면 흔적 감시: 사이드 네비 '승인 관리' / 승인 관리 표가 한 번이라도 DOM 에 나타났는지
    window.__saw = { nav: false }
    const check = () => { if (document.body && document.body.innerText.includes('승인 관리')) window.__saw.nav = true }
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true })
  }, ['sb-simref-auth-token', session])

  await page.goto(`http://127.0.0.1:${port}/${url}`)
  await page.waitForTimeout(3500)
  const out = { name }
  await steps(page, state, out)
  await page.waitForTimeout(400)
  out.hash = await page.evaluate(() => location.hash)
  out.sawAdmin = await page.evaluate(() => window.__saw.nav)
  out.footerLink = await page.evaluate(() => [...document.querySelectorAll('footer button')].some(b => b.textContent.trim() === '관리자 페이지'))
  out.deeplink = await page.evaluate(() => sessionStorage.getItem('cnr_deeplink'))
  out.buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => ['승인', '거절', '예약 취소', '취소', '닫기'].includes(t)))
  out.writes = state.writes.filter(w => w.includes('/rest/v1/bookings'))
  out.errors = errors
  out.page = page; out.ctx = ctx
  return out
}

;(async () => {
  const after = await serve(DIST_AFTER, 4601), before = await serve(DIST_BEFORE, 4602)
  const browser = await chromium.launch()
  let pass = 0, fail = 0
  const check = (label, cond, detail) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ' — ' + detail}`) }
  const close = async o => { await o.ctx.close() }
  const brief = o => JSON.stringify({ hash: o.hash, sawAdmin: o.sawAdmin, footerLink: o.footerLink, buttons: o.buttons, writes: o.writes.length, deeplink: o.deeplink, errors: o.errors })
  const USER = { profileRole: 'USER', roles: [] }, ADMIN = { profileRole: 'ADMIN', roles: ALL_ROLES }
  const clickApproveInTable = async page => {            // 승인 관리 표의 행 버튼 (title="승인")
    const btn = page.locator('button[title="승인"]').first()
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(600); return true }
    return false
  }

  console.log('[수정 전 · origin/main] 사고 재현')
  let o = await scenario(browser, 4602, 'before/USER footer', { ...USER, url: '#home' })
  check('일반 사용자 푸터에 "관리자 페이지" 링크가 보인다', o.footerLink === true, brief(o))
  await o.page.locator('footer').screenshot({ path: path.join(ROOT, 'footer_before_user.png') }); await close(o)
  // 사고 경로 그대로: 푸터 링크 → 어드민 대시보드 → '승인 대기' 카드 → 승인 관리 표 → [승인]
  o = await scenario(browser, 4602, 'before/USER incident path', { ...USER, url: '#home', steps: async (page, st, out) => {
    await page.locator('footer button', { hasText: '관리자 페이지' }).click(); await page.waitForTimeout(1500)
    out.hashAfterFooter = await page.evaluate(() => location.hash)
    await page.screenshot({ path: path.join(ROOT, 'before_user_admin_dashboard.png') })
    const card = page.getByText('승인 대기', { exact: false }).first()
    out.cardFound = await card.count() > 0
    if (out.cardFound) { await card.click(); await page.waitForTimeout(1200) }
    out.hashAfterCard = await page.evaluate(() => location.hash)
    out.clicked = await clickApproveInTable(page)
    await page.screenshot({ path: path.join(ROOT, 'before_user_admin_approvals.png') })
  } })
  check('일반 사용자: 푸터 링크 → 대시보드 → 승인 대기 카드 → 승인 관리 표 [승인] → UPDATE 전송 (10/6 사고 경로)',
        o.hashAfterFooter === '#admin' && o.clicked === true && o.writes.some(w => w.startsWith('PATCH') && w.includes('"status":"confirmed"')),
        brief(o) + ` footer→${o.hashAfterFooter} card=${o.cardFound}→${o.hashAfterCard} clicked=${o.clicked}`)
  await close(o)

  console.log('[수정 후] 일반 사용자 — 어드민 접근 차단')
  o = await scenario(browser, 4601, 'USER home', { ...USER, url: '#home' })
  check('푸터에 "관리자 페이지" 링크 없음', o.footerLink === false, brief(o))
  await o.page.locator('footer').screenshot({ path: path.join(ROOT, 'footer_after_user.png') }); await close(o)
  for (const [label, url] of [['#admin', '#admin'], ['#admin-tab-approvals', '#admin-tab-approvals'], ['#admin-tab-users', '#admin-tab-users'], ['#admin-booking-{id} (승인요청 메일 링크)', '#admin-booking-bSIM_0']]) {
    o = await scenario(browser, 4601, 'USER ' + url, { ...USER, url, steps: async (page, st, out) => { out.clicked = await clickApproveInTable(page) } })
    check(`${label} → 홈으로 이동, 어드민 화면 미노출, 승인 UPDATE 0건`, o.hash === '#home' && o.sawAdmin === false && o.writes.length === 0 && o.clicked === false && o.deeplink === null && o.errors.length === 0, brief(o))
    await close(o)
  }
  o = await scenario(browser, 4601, 'workboard-only', { profileRole: 'USER', roles: ['workboard'], url: '#admin' })
  check('Work Space 권한만 있는 일반 사용자 #admin → 홈', o.hash === '#home' && o.sawAdmin === false, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'USER detail', { ...USER, url: '#booking-bSIM_0' })
  check('본인 승인 대기 예약 상세 모달: [승인]·[거절] 버튼 없음', !o.buttons.includes('승인') && !o.buttons.includes('거절') && o.buttons.length > 0, brief(o))
  await o.page.screenshot({ path: path.join(ROOT, 'detail_after_user.png') }); await close(o)

  console.log('[수정 후] 관리자 — 기존 동작 유지')
  o = await scenario(browser, 4601, 'ADMIN refresh', { ...ADMIN, url: '#admin' })
  check('어드민 화면에서 새로고침(#admin) → 튕기지 않고 어드민 유지', o.hash.startsWith('#admin') && o.sawAdmin === true && o.errors.length === 0, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN tab refresh', { ...ADMIN, url: '#admin-tab-approvals' })
  check('#admin-tab-approvals 새로고침 → 승인 관리 탭 유지', o.hash === '#admin-tab-approvals' && o.sawAdmin === true, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN footer', { ...ADMIN, url: '#home', steps: async (page, st, out) => {
    out.linkBefore = await page.evaluate(() => [...document.querySelectorAll('footer button')].some(b => b.textContent.trim() === '관리자 페이지'))
    await page.locator('footer').screenshot({ path: path.join(ROOT, 'footer_after_admin.png') })
    await page.locator('footer button', { hasText: '관리자 페이지' }).click(); await page.waitForTimeout(1200)
  } })
  check('푸터 "관리자 페이지" 링크 노출 + 클릭 시 어드민 진입', o.linkBefore === true && o.hash.startsWith('#admin') && o.sawAdmin === true, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN deeplink', { ...ADMIN, url: '#admin-booking-bSIM_0' })
  check('승인요청 메일 링크 → 승인 관리 탭 + 상세 모달에 [승인] 버튼', o.hash === '#admin-tab-approvals' && o.buttons.includes('승인') && o.deeplink === null, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN approve', { ...ADMIN, url: '#admin-tab-approvals', steps: async (page, st, out) => { out.clicked = await clickApproveInTable(page) } })
  check('승인 관리 표 [승인] → UPDATE 전송(관리자 기능 정상)', o.clicked === true && o.writes.some(w => w.startsWith('PATCH') && w.includes('"status":"confirmed"')), brief(o) + ' clicked=' + o.clicked); await close(o)

  console.log('[수정 후] 역할별 탭 게이트 · 조회 실패 · 권한 회수')
  o = await scenario(browser, 4601, 'org-only', { profileRole: 'ADMIN', roles: ['org'], url: '#admin-tab-approvals', steps: async (page, st, out) => { out.clicked = await clickApproveInTable(page) } })
  check('조직도 권한만 있는 관리자가 #admin-tab-approvals → 조직도 탭으로, 승인 관리 미노출', o.hash === '#admin-tab-org' && o.sawAdmin === false && o.clicked === false, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN roles fail (fresh)', { ...ADMIN, rolesFail: true, url: '#admin' })
  check('역할 조회 실패 + 캐시 없음 → 닫힘(홈)', o.hash === '#home' && o.sawAdmin === false, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN roles fail (cached)', { ...ADMIN, url: '#home', steps: async (page, st) => {
    st.rolesFail = true
    await page.locator('footer button', { hasText: '관리자 페이지' }).click(); await page.waitForTimeout(1500)
  } })
  check('이미 통과한 관리자는 순간 조회 실패에도 어드민 유지', o.hash.startsWith('#admin') && o.sawAdmin === true, brief(o)); await close(o)
  o = await scenario(browser, 4601, 'ADMIN revoked', { ...ADMIN, url: '#home', steps: async (page, st) => {
    st.roles = []
    await page.evaluate(() => { location.hash = 'admin' }); await page.waitForTimeout(300)
    await page.reload(); await page.waitForTimeout(3000)
  } })
  check('권한이 회수된 뒤 #admin 재진입 → 홈', o.hash === '#home', brief(o)); await close(o)

  await browser.close(); after.close(); before.close()
  console.log(`결과: PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('테스트 러너 오류:', e); process.exit(2) })
