// ⚠ LOCAL_ONLY — 권한별 UI 제어 전수 검증 (실브라우저)
//
// 대상 빌드를 Chromium 으로 열고 Supabase 응답만 가짜로 돌려준다 (실제 백엔드에는 요청이 한 건도 나가지 않는다:
// HTTP 는 전부 가로채고, WebSocket 은 닫고, 그 외 외부 주소는 차단).
//
//   node perm_matrix_test.cjs prod   <스크린샷 폴더>            ← 운영에 배포된 산출물(space.cnrres.com 의 정적 파일)을 그대로 받아 검증
//   node perm_matrix_test.cjs dir    <스크린샷 폴더> <dist 폴더> [toast]   ← 로컬 빌드 검증. toast = 접근 거부 안내 토스트 기대
const { chromium } = require('playwright')
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path')

const MODE = process.argv[2], SHOTS = process.argv[3], DIST = process.argv[4], EXPECT_TOAST = process.argv[5] === 'toast'
if (!['prod', 'dir'].includes(MODE) || !SHOTS || (MODE === 'dir' && !DIST)) { console.error('사용법은 파일 상단 참조'); process.exit(2) }
fs.mkdirSync(SHOTS, { recursive: true })
const PROD = 'https://space.cnrres.com'
const SB = MODE === 'prod' ? 'https://jjzcqpbwkkujttwxksvy.supabase.co' : 'https://simref.supabase.test'
const STORAGE_KEY = MODE === 'prod' ? 'sb-jjzcqpbwkkujttwxksvy-auth-token' : 'sb-simref-auth-token'
const PORT = MODE === 'prod' ? 4611 : 4612

const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222'
const EMAIL = 'tester@cnrres.com'
const ALL_ROLES = ['dashboard','booking','approval','room','user','visitor','book','notification','notice','kb','resource','org','super','workboard']
const NAV_LABELS = ['대시보드','승인 관리','예약 관리','사용자 관리','회의실 관리','방문 기록','도서 관리','알림 설정','공지 배너','CANTEEN DP','KB 관리','자원 관리','조직도']
const MODAL_BTNS = ['닫기','예약 취소','예약 변경','승인','거절','강제취소','예약자 변경','체크인 하세요','조기반납']
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json', '.ico':'image/x-icon' }

const cache = new Map()
function fetchProd(p) {                      // 운영 정적 파일 그대로 받기 (GET 만)
  if (cache.has(p)) return Promise.resolve(cache.get(p))
  return new Promise((res, rej) => https.get(PROD + p, r => {
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => { const v = { status: r.statusCode, type: r.headers['content-type'], body: Buffer.concat(chunks) }; cache.set(p, v); res(v) })
  }).on('error', rej))
}
function serve() {
  return new Promise(res => {
    const s = http.createServer(async (q, r) => {
      const p = decodeURIComponent(q.url.split('?')[0])
      if (MODE === 'prod') {
        try { const v = await fetchProd(p); r.writeHead(v.status, { 'content-type': v.type || 'application/octet-stream' }); r.end(v.body) }
        catch (e) { r.writeHead(502); r.end(String(e)) }
        return
      }
      let f = path.join(DIST, p)
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')   // _redirects: /* /index.html 200
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r)
    }).listen(PORT, '127.0.0.1', () => res(s))
  })
}
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const iso = h => new Date(Date.now() + h * 3600e3).toISOString()
const bk = (id, room, status, uid, name, email, h) => ({
  id, room_id: room, title: `시뮬 ${id}`, memo: '', attendees: [], start_at: iso(h), end_at: iso(h + 1), user_id: uid, user_name: name, user_dept: 'QA', user_email: email,
  checked_in: false, auto_cancelled: false, early_ended: false, recur_group_id: null, created_at: iso(-0.1), cancelled_by: null, status,
  original_end_at: null, reject_reason: null, processed_by_name: null, processed_by_avatar: null, cancelled_by_user_id: null, purpose: 'part', purpose_detail: null, booking_attendees: [],
})

async function run(browser, { profileRole, roles, url, shot, shotAt, steps }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const state = { leaks: [], writes: [] }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'azure' }, user_metadata: { full_name: '테스터' } }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, email: EMAIL, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user }
  const me = { id: ME, email: EMAIL, name: '테스터', dept: 'QA', role: profileRole, is_active: true, employment_status: 'active', avatar_url: null, employee_id: EMAIL }
  const other = { id: OTHER, email: 'other@cnrres.com', name: '다른사람', dept: 'BD', role: 'USER', is_active: true, employment_status: 'active', avatar_url: null, employee_id: 'other@cnrres.com' }
  const rooms = [
    { room_id: 1, floor_id: 1, room_code: 'A', room_name: '1F Amber', room_name_ko: '앰버', capacity: 6, is_active: true, is_admin_only: false },
    { room_id: 3, floor_id: 2, room_code: 'E', room_name: '2F Emerald', room_name_ko: '에메랄드', capacity: 12, is_active: true, is_admin_only: true },
  ]
  const bookings = [
    bk('bMINE_P', 3, 'pending', ME, '테스터', EMAIL, 2), bk('bMINE_C', 1, 'confirmed', ME, '테스터', EMAIL, 4),
    bk('bOTHER_C', 1, 'confirmed', OTHER, '다른사람', 'other@cnrres.com', 6), bk('bOTHER_P', 3, 'pending', OTHER, '다른사람', 'other@cnrres.com', 8),
  ]
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/*' }, body: JSON.stringify(body) })
  await ctx.routeWebSocket(/.*/, ws => ws.close())                        // Realtime 등 WebSocket 은 연결하지 않는다
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin === `http://127.0.0.1:${PORT}`) return route.continue()
    if (u.origin !== SB) return route.abort()                             // 폰트·GA 등 외부 요청 차단
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = u.pathname, single = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    if (p === '/auth/v1/user') return json(route, user)
    if (p.startsWith('/auth/v1/token')) return json(route, session)
    if (p.startsWith('/auth/v1/')) return json(route, {})
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/')) { state.writes.push(`${req.method()} ${p}`); return json(route, single ? {} : []) }
    if (p === '/rest/v1/admin_roles') return json(route, roles.map(role => ({ role })))
    if (p === '/rest/v1/profiles') return json(route, single ? me : [me, other])
    if (p === '/rest/v1/rooms') return json(route, rooms)
    if (p === '/rest/v1/bookings') return json(route, single ? bookings[0] : bookings)
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (p.startsWith('/functions/v1/')) return json(route, {})
    return json(route, single ? null : [])
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)))
  await page.addInitScript(([key, sess]) => {
    localStorage.setItem(key, JSON.stringify(sess))
    window.__saw = { nav: false, toast: '' }
    const check = () => {
      if (!document.body) return
      const t = document.body.innerText
      if (t.includes('승인 관리')) window.__saw.nav = true
      const m = t.match(/접근할 수 없습니다[^\n]*/); if (m) window.__saw.toast = m[0]
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true })
  }, [STORAGE_KEY, session])
  await page.goto(`http://127.0.0.1:${PORT}/${url}`)
  if (shot && shotAt) { await page.waitForTimeout(shotAt); await page.screenshot({ path: path.join(SHOTS, shot) }) }
  await page.waitForTimeout(shotAt ? Math.max(0, 3500 - shotAt) : 3500)
  const o = {}
  o.hash = await page.evaluate(() => location.hash)
  o.sawAdmin = await page.evaluate(() => window.__saw.nav)
  o.toast = await page.evaluate(() => window.__saw.toast)
  o.footerLink = await page.evaluate(() => [...document.querySelectorAll('footer button')].some(b => b.textContent.trim() === '관리자 페이지'))
  o.modal = await page.evaluate(L => [...new Set([...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => L.includes(t)))], MODAL_BTNS)
  o.sideNav = await page.evaluate(L => [...document.querySelectorAll('aside button, aside a')].map(b => b.textContent.trim()).filter(t => L.some(l => t.startsWith(l))).map(t => L.find(l => t.startsWith(l))), NAV_LABELS)
  if (steps) await steps(page, o)
  if (shot && !shotAt) await page.screenshot({ path: path.join(SHOTS, shot) })
  o.errors = errors; o.writes = state.writes.filter(w => w.includes('/bookings'))
  await ctx.close()
  return o
}
// 드로어·프로필 메뉴는 모달이 없는 화면(#home)에서 연다
const menus = async (page, o) => {
  await page.locator('button[aria-label="전체 메뉴 열기"]').click(); await page.waitForTimeout(500)
  o.drawer = await page.evaluate(() => { const n = document.querySelector('[role="navigation"][aria-label="전체 메뉴"]'); return n ? [...n.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean) : null })
  await page.locator('button[aria-label="메뉴 닫기"]').click(); await page.waitForTimeout(400)
  await page.locator('button.flex-shrink-0.items-center').first().click(); await page.waitForTimeout(400)
  o.profileMenu = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => ['MY PAGE', 'ADMIN'].includes(t)))
}
const has = (arr, x) => Array.isArray(arr) && arr.some(t => t.includes(x))
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

;(async () => {
  const server = await serve()
  const browser = await chromium.launch()
  let pass = 0, fail = 0
  const check = (label, cond, o) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}${cond ? '' : ' — ' + JSON.stringify(o)}`) }
  const USER = { profileRole: 'USER', roles: [] }, ADMIN = { profileRole: 'ADMIN', roles: ALL_ROLES }
  const deniedOk = o => o.hash === '#home' && o.sawAdmin === false && (EXPECT_TOAST ? o.toast.startsWith('접근할 수 없습니다') : o.toast === '')
  console.log(`대상: ${MODE === 'prod' ? '운영 배포 산출물 (space.cnrres.com 정적 파일)' : DIST}${EXPECT_TOAST ? ' · 접근 거부 토스트 기대' : ''}`)

  console.log('[일반 사용자] 역할 없음')
  let o = await run(browser, { ...USER, url: '#home', steps: menus, shot: 'user_home_profile_menu.png' })
  check('푸터에 "관리자 페이지" 없음', o.footerLink === false, o)
  check('전체 메뉴(드로어)에 "어드민"·"팀 워크스페이스" 항목 없음', o.drawer && !has(o.drawer, '어드민') && !has(o.drawer, 'Work Space') && !has(o.drawer, '조직도'), o)
  check('프로필 메뉴에 "ADMIN" 없음 (MY PAGE 만)', same(o.profileMenu, ['MY PAGE']), o)
  o = await run(browser, { ...USER, url: '#admin', shot: 'user_admin_denied.png', shotAt: 1300 })
  check(`#admin 접근 → 홈 이동 · 어드민 화면 미노출${EXPECT_TOAST ? ' · "접근할 수 없습니다" 토스트' : ''}`, deniedOk(o) && o.errors.length === 0, o)
  for (const u of ['#admin-tab-approvals', '#admin-tab-users', '#admin-tab-org', '#admin-booking-bMINE_P']) {
    o = await run(browser, { ...USER, url: u }); check(`${u} 접근 → 차단`, deniedOk(o) && o.writes.length === 0, o)
  }
  // #admin-org-{id} 는 App 의 해시→뷰 매핑에 없는 주소라(관리자도 새로고침 시 home — 기존 동작) 어드민 게이트를 거치지 않는다.
  // 그래서 거부 토스트 대상이 아니고, 확인할 것은 "어드민 화면이 뜨지 않는다" 뿐이다.
  o = await run(browser, { ...USER, url: '#admin-org-1' }); check('#admin-org-1 접근 → 홈, 어드민 미노출', o.hash === '#home' && o.sawAdmin === false && o.writes.length === 0, o)
  o = await run(browser, { ...USER, url: 'admin' })
  check('/admin 경로(해시 아님) → 홈 화면, 어드민 미노출', o.sawAdmin === false && !o.hash.startsWith('#admin'), o)
  o = await run(browser, { ...USER, url: '#booking-bMINE_P', shot: 'user_detail_own_pending.png' }); check('상세 모달 · 본인 승인 대기 건: [예약 취소]만', same(o.modal, ['예약 취소']), o)
  o = await run(browser, { ...USER, url: '#booking-bMINE_C' }); check('상세 모달 · 본인 일반 예약: [예약 취소][예약 변경]', same(o.modal, ['예약 취소', '예약 변경']), o)
  o = await run(browser, { ...USER, url: '#booking-bOTHER_C' }); check('상세 모달 · 타인 예약: [닫기]만 (변경·강제취소·예약자 변경 없음)', same(o.modal, ['닫기']), o)
  o = await run(browser, { ...USER, url: '#booking-bOTHER_P' }); check('상세 모달 · 타인 승인 대기 건: [닫기]만 (승인·거절 없음)', same(o.modal, ['닫기']), o)

  console.log('[일반 사용자] Work Space 권한만')
  o = await run(browser, { profileRole: 'USER', roles: ['workboard'], url: '#home', steps: menus })
  check('드로어에 Work Space 는 보이고 "어드민"은 없음 · 푸터 링크 없음', has(o.drawer, 'Work Space') && !has(o.drawer, '어드민') && o.footerLink === false && same(o.profileMenu, ['MY PAGE']), o)
  o = await run(browser, { profileRole: 'USER', roles: ['workboard'], url: '#admin' }); check('#admin 접근 → 차단', deniedOk(o), o)

  console.log('[관리자] 전 역할')
  o = await run(browser, { ...ADMIN, url: '#home', steps: menus, shot: 'admin_home_profile_menu.png' })
  check('푸터 "관리자 페이지" · 드로어 "어드민" · 프로필 메뉴 "ADMIN" 모두 노출', o.footerLink === true && has(o.drawer, '어드민') && same(o.profileMenu, ['MY PAGE', 'ADMIN']), o)
  o = await run(browser, { ...ADMIN, url: '#admin' })
  check('#admin 새로고침 → 어드민 유지, 사이드 메뉴 13개 전부, 거부 토스트 없음', o.hash.startsWith('#admin') && same(o.sideNav, NAV_LABELS) && o.toast === '' && o.errors.length === 0, o)
  o = await run(browser, { ...ADMIN, url: '#booking-bOTHER_P' }); check('상세 모달 · 타인 승인 대기 건: [닫기][거절][승인]', same(o.modal, ['닫기', '거절', '승인']), o)
  o = await run(browser, { ...ADMIN, url: '#booking-bOTHER_C' }); check('상세 모달 · 타인 예약: [닫기][예약 변경][예약자 변경][강제취소]', same(o.modal, ['닫기', '예약 변경', '예약자 변경', '강제취소']), o)
  o = await run(browser, { ...ADMIN, url: '#booking-bMINE_P' }); check('상세 모달 · 본인 승인 대기 건: [승인][예약 취소]', same(o.modal, ['승인', '예약 취소']), o)

  console.log('[관리자] 일부 역할 — 보유한 탭만')
  o = await run(browser, { profileRole: 'ADMIN', roles: ['org'], url: '#admin-tab-approvals', shot: 'admin_org_only.png' })
  check('조직도 역할만: 사이드 메뉴 [조직도]만 · 승인 관리 주소로 와도 조직도 탭', same(o.sideNav, ['조직도']) && o.hash === '#admin-tab-org' && o.sawAdmin === false, o)
  o = await run(browser, { profileRole: 'ADMIN', roles: ['approval'], url: '#admin-tab-users' })
  check('승인 역할만: 사이드 메뉴 [승인 관리]만 · 사용자 관리 주소로 와도 승인 관리 탭', same(o.sideNav, ['승인 관리']) && o.hash === '#admin-tab-approvals', o)
  o = await run(browser, { profileRole: 'ADMIN', roles: ['book', 'notice'], url: '#admin' })
  check('도서·공지 역할: 사이드 메뉴 [도서 관리][공지 배너][CANTEEN DP]만', same(o.sideNav, ['도서 관리', '공지 배너', 'CANTEEN DP']), o)

  await browser.close(); server.close()
  console.log(`결과: PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('테스트 러너 오류:', e); process.exit(2) })
