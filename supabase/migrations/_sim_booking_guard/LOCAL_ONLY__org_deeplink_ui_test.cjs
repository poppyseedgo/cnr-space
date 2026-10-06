// ⚠ LOCAL_ONLY — 조직도 딥링크(#admin-org-{fileId}) 새로고침·메일 링크 복귀 검증 (실브라우저)
//
// 수정 전 빌드와 수정 후 빌드를 같은 시나리오로 돌려 비교한다. Supabase 응답만 가짜로 돌려준다
// (실제 백엔드에는 요청이 한 건도 나가지 않는다: HTTP 는 전부 가로채고, WebSocket 은 닫고, 그 외 외부 주소는 차단).
// 시나리오마다 브라우저를 새로 띄운다 (앞 시나리오의 저장소·세션이 섞이지 않게).
//
// 실행:
//   VITE_SUPABASE_URL=https://simref.supabase.test VITE_SUPABASE_ANON_KEY=sim npx vite build --outDir /tmp/orglink/dist-after
//   (수정 전 커밋을 worktree 로 체크아웃해 같은 방식으로)                              --outDir /tmp/orglink/dist-before
//   NODE_PATH=$(npm root -g) node LOCAL_ONLY__org_deeplink_ui_test.cjs /tmp/orglink/dist-before /tmp/orglink/dist-after /tmp/orglink/shots
//   (ONLY=A,C 처럼 환경변수로 일부 시나리오만 실행 가능)
//
//   판정 방식
//     · fix  = 이번 수정 대상 — 수정 전 기대(버그 재현)와 수정 후 기대를 각각 명시해 둘 다 확인
//     · same = 건드리지 않은 경로 — 수정 전·후 결과가 완전히 같아야 한다 (기대값을 따로 적지 않고 서로 비교)
const { chromium } = require('playwright')
const http = require('http'), fs = require('fs'), path = require('path')

const [BEFORE, AFTER, SHOTS] = process.argv.slice(2)
if (!BEFORE || !AFTER) { console.error('사용법은 파일 상단 참조'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const SB = 'https://simref.supabase.test', STORAGE_KEY = 'sb-simref-auth-token'
const ME = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222', EMAIL = 'tester@cnrres.com'
const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', FILE_NAME = '시뮬조직도2026'
const ORG_HASH = `#admin-org-${FILE}`
const ALL_ROLES = ['dashboard','booking','approval','room','user','visitor','book','notification','notice','kb','resource','org','super','workboard']
const NAV_LABELS = ['대시보드','승인 관리','예약 관리','사용자 관리','회의실 관리','방문 기록','도서 관리','알림 설정','공지 배너','CANTEEN DP','KB 관리','자원 관리','조직도']
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json', '.ico':'image/x-icon' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const iso = h => new Date(Date.now() + h * 3600e3).toISOString()

function serve(dist, port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let f = path.join(dist, decodeURIComponent(q.url.split('?')[0]))
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html')   // _redirects: /* /index.html 200
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r)
    }).listen(port, '127.0.0.1', () => res(s))
  })
}

// 한 시나리오 실행. flow(page, helpers) 가 사용자의 실제 동작 순서를 그대로 밟는다.
async function run(port, { profileRole, roles, flow, shot }) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const origin = `http://127.0.0.1:${port}`
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'azure' }, user_metadata: { full_name: '테스터' } }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, email: EMAIL, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user }
  const me = { id: ME, email: EMAIL, name: '테스터', dept: 'QA', role: profileRole, is_active: true, employment_status: 'active', avatar_url: null, employee_id: EMAIL }
  const other = { id: OTHER, email: 'other@cnrres.com', name: '다른사람', dept: 'BD', role: 'USER', is_active: true, employment_status: 'active', avatar_url: null, employee_id: 'other@cnrres.com' }
  const rooms = [{ room_id: 3, floor_id: 2, room_code: 'E', room_name: '2F Emerald', room_name_ko: '에메랄드', capacity: 12, is_active: true, is_admin_only: true }]
  const bookings = [{ id: 'bOTHER_P', room_id: 3, title: '시뮬 승인대기', memo: '', attendees: [], start_at: iso(8), end_at: iso(9), user_id: OTHER, user_name: '다른사람', user_dept: 'BD', user_email: 'other@cnrres.com',
    checked_in: false, auto_cancelled: false, early_ended: false, recur_group_id: null, created_at: iso(-0.1), cancelled_by: null, status: 'pending', original_end_at: null, reject_reason: null,
    processed_by_name: null, processed_by_avatar: null, cancelled_by_user_id: null, purpose: 'part', purpose_detail: null, booking_attendees: [] }]
  const orgFile = { id: FILE, name: FILE_NAME, status: 'active', effective_on: '2026-10-01', parent_file_id: null, memo: null, lock_by: null, lock_at: null, created_by: ME, created_at: iso(-100), updated_by: ME, updated_at: iso(-1), activated_at: iso(-50), activated_by: ME, archived_at: null }
  const orgUnit = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', file_id: FILE, parent_unit_id: null, name: 'C&R Research', code: 'ROOT', azure_division: null, head_card_id: null, sort_order: 0, kind: 'unit', unit_type: null, head_job_id: null, memo: null, prev_unit_id: null }
  const state = { writes: [], sbRequests: 0 }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/*' }, body: JSON.stringify(body) })
  await ctx.routeWebSocket(/.*/, ws => ws.close())
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin === origin) return route.continue()
    if (u.origin !== SB) return route.abort()
    state.sbRequests++
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
    if (p === '/rest/v1/org_files') return json(route, single ? orgFile : [orgFile])
    if (p === '/rest/v1/org_units') return json(route, single ? orgUnit : [orgUnit])
    if (p.startsWith('/rest/v1/rpc/')) return json(route, null)
    if (p.startsWith('/functions/v1/')) return json(route, {})
    return json(route, single ? null : [])
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)))
  // 로그인 세션은 "로그인한 상태" 플래그가 켜져 있을 때만 심는다 → 로그아웃 상태로 메일 링크를 연 뒤 로그인하는 흐름을 재현할 수 있다.
  await page.addInitScript(([key, sess, fileName]) => {
    if (location.protocol !== 'http:') return
    if (sessionStorage.getItem('__logged_in') === '1') localStorage.setItem(key, JSON.stringify(sess)); else localStorage.removeItem(key)
    window.__saw = { nav: false, canvas: false }
    const check = () => {
      if (!document.body) return
      const t = document.body.innerText
      if (t.includes('승인 관리')) window.__saw.nav = true          // 어드민 사이드 메뉴가 한 번이라도 보였는가
      if (t.includes(fileName)) window.__saw.canvas = true          // 조직도 파일 내용이 한 번이라도 보였는가
    }
    new MutationObserver(check).observe(document, { childList: true, subtree: true, characterData: true })
  }, [STORAGE_KEY, session, FILE_NAME])

  const h = {
    origin,
    // 로그인 상태로 전환(= 다음 페이지 로드부터 세션 존재). 같은 탭이라 sessionStorage(cnr_deeplink)는 그대로 남는다.
    markLoggedIn: async () => { await page.evaluate(() => sessionStorage.setItem('__logged_in', '1')) },
    // 첫 로드 전에 로그인 상태로 만들기: 빈 문서를 한 번 열어 플래그만 심는다.
    startLoggedIn: async () => { await page.goto(origin + '/__blank'); await page.evaluate(() => { sessionStorage.setItem('__logged_in', '1') }) },
    // 본 화면(헤더의 전체 메뉴 버튼) 또는 로그인 화면이 뜰 때까지 기다린 뒤, 리다이렉트·권한 확인이 끝나도록 잠시 둔다.
    settle: async (want = 'app') => {
      const sel = want === 'app' ? 'button[aria-label="전체 메뉴 열기"]' : 'text=Sign in with Microsoft'
      await page.waitForSelector(sel, { timeout: 20000 })
      await page.waitForTimeout(3500)
    },
  }
  let flowError = null
  try { await flow(page, h) } catch (e) { flowError = String(e).split('\n')[0].slice(0, 200) }
  const o = await page.evaluate(([L, fileName]) => {
    const body = document.body ? document.body.innerText : ''
    const side = [...document.querySelectorAll('aside button, aside a')].map(b => b.textContent.trim())
    return {
      hash: location.hash,
      saved: sessionStorage.getItem('cnr_deeplink'),
      adminShown: side.some(t => L.some(l => t.startsWith(l))),
      sideNav: side.filter(t => L.some(l => t.startsWith(l))).map(t => L.find(l => t.startsWith(l))),
      canvasShown: body.includes(fileName),
      notFoundToast: body.includes('조직도 파일을 찾을 수 없습니다'),
      loginPage: body.includes('Sign in with Microsoft'),
      sawAdminEver: !!(window.__saw && window.__saw.nav),
      sawCanvasEver: !!(window.__saw && window.__saw.canvas),
      head: body.slice(0, 80).replace(/\n/g, ' / '),
    }
  }, [NAV_LABELS, FILE_NAME])
  o.errors = errors; o.writes = state.writes; o.sbRequests = state.sbRequests; o.flowError = flowError
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot) })
  await browser.close()
  return o
}

const ADMIN = { profileRole: 'ADMIN', roles: ALL_ROLES }, USER = { profileRole: 'USER', roles: [] }
// 로그아웃 상태로 메일 링크를 연다 → 로그인 화면 → (Microsoft 로그인 다녀옴: 다른 주소로 나갔다가 해시 없는 주소로 복귀) → 앱
const mailLinkThenLogin = hash => async (page, h) => {
  await page.goto(`${h.origin}/${hash}`); await h.settle('login')
  await h.markLoggedIn()
  await page.goto('about:blank')                 // 외부 로그인 페이지로 나간 것에 해당
  await page.goto(`${h.origin}/`); await h.settle('app')   // redirectTo = origin (해시 없음)
}
const openLoggedIn = hash => async (page, h) => { await h.startLoggedIn(); await page.goto(`${h.origin}/${hash}`); await h.settle('app') }

const SCENARIOS = [
  // ── 이번 수정 대상 ──
  { id: 'A', kind: 'fix', label: '관리자 · 조직도 갤러리에서 파일을 열고(캔버스) 새로고침', ...ADMIN, shot: 'A_admin_canvas_reload',
    flow: async (page, h) => {
      await h.startLoggedIn(); await page.goto(`${h.origin}/#admin-tab-org`); await h.settle('app')
      await page.evaluate(hh => { window.location.hash = hh }, ORG_HASH.slice(1)); await page.waitForTimeout(2500)   // OrgAdminPanel.openFile 과 같은 동작
      await page.reload(); await h.settle('app')
    },
    before: o => o.hash === '#home' && !o.adminShown && !o.canvasShown,
    after:  o => o.hash === ORG_HASH && o.adminShown && o.canvasShown && !o.notFoundToast && o.saved === null },
  { id: 'B', kind: 'fix', label: '관리자 · 조직도 캔버스 주소로 직접 진입(주소창 입력·즐겨찾기)', ...ADMIN,
    flow: openLoggedIn(ORG_HASH),
    before: o => o.hash === '#home' && !o.adminShown,
    after:  o => o.hash === ORG_HASH && o.adminShown && o.canvasShown && o.saved === null },
  { id: 'C', kind: 'fix', label: '관리자 · 조직도 알림 메일 링크(로그아웃 상태) → 로그인 복귀', ...ADMIN, shot: 'C_admin_mail_login',
    flow: mailLinkThenLogin(ORG_HASH),
    before: o => !o.canvasShown && !o.hash.startsWith('#admin-org-'),
    after:  o => o.hash === ORG_HASH && o.adminShown && o.canvasShown && o.saved === null },
  { id: 'D', kind: 'fix', label: '조직도 역할이 없는 관리자 · 조직도 캔버스 주소 진입', profileRole: 'ADMIN', roles: ['dashboard'],
    flow: openLoggedIn(ORG_HASH),
    before: o => o.hash === '#home' && !o.adminShown,
    after:  o => o.adminShown && JSON.stringify(o.sideNav) === JSON.stringify(['대시보드']) && !o.canvasShown && !o.sawCanvasEver && o.saved === null },
  { id: 'E', kind: 'fix', label: '일반 사용자 · 조직도 캔버스 주소 진입 → 차단', ...USER,
    flow: openLoggedIn(ORG_HASH),
    before: o => o.hash === '#home' && !o.adminShown && !o.sawAdminEver,
    after:  o => o.hash === '#home' && !o.adminShown && !o.sawAdminEver && !o.sawCanvasEver && o.saved === null && o.writes.length === 0 },
  { id: 'F', kind: 'fix', label: '일반 사용자 · 조직도 메일 링크(로그아웃 상태) → 로그인 복귀 → 차단', ...USER,
    flow: mailLinkThenLogin(ORG_HASH),
    before: o => !o.adminShown && !o.sawAdminEver,
    after:  o => o.hash === '#home' && !o.adminShown && !o.sawAdminEver && !o.sawCanvasEver && o.saved === null && o.writes.length === 0 },
  { id: 'G', kind: 'fix', label: '관리자 · 캔버스 새로고침 뒤 홈으로 이동해 다시 새로고침 (저장값이 남아 캔버스로 끌려가지 않는가)', ...ADMIN,
    flow: async (page, h) => {
      await h.startLoggedIn(); await page.goto(`${h.origin}/${ORG_HASH}`); await h.settle('app')
      await page.evaluate(() => { window.location.hash = 'home' }); await page.waitForTimeout(800)
      await page.goto(`${h.origin}/#home`); await page.reload(); await h.settle('app')
    },
    before: o => o.hash === '#home' && !o.adminShown,
    after:  o => o.hash === '#home' && !o.adminShown && o.saved === null },
  // ── 건드리지 않은 경로: 수정 전·후가 같아야 한다 ──
  { id: 'H', kind: 'same', label: '관리자 · 조직도 갤러리(#admin-tab-org) 새로고침', ...ADMIN, flow: openLoggedIn('#admin-tab-org') },
  { id: 'I', kind: 'same', label: '관리자 · #admin 새로고침', ...ADMIN, flow: openLoggedIn('#admin') },
  { id: 'J', kind: 'same', label: '관리자 · 승인 관리 탭(#admin-tab-approvals) 새로고침', ...ADMIN, flow: openLoggedIn('#admin-tab-approvals') },
  { id: 'K', kind: 'same', label: '관리자 · 승인요청 메일 링크(#admin-booking-) 직접 진입', ...ADMIN, flow: openLoggedIn('#admin-booking-bOTHER_P') },
  { id: 'L', kind: 'same', label: '관리자 · 승인요청 메일 링크(로그아웃 상태) → 로그인 복귀', ...ADMIN, flow: mailLinkThenLogin('#admin-booking-bOTHER_P') },
  { id: 'M', kind: 'same', label: '일반 사용자 · #admin 진입 → 차단', ...USER, flow: openLoggedIn('#admin') },
  { id: 'N', kind: 'same', label: '일반 사용자 · 승인요청 메일 링크(로그아웃 상태) → 로그인 복귀 → 차단', ...USER, flow: mailLinkThenLogin('#admin-booking-bOTHER_P') },
  { id: 'O', kind: 'same', label: '일반 사용자 · 예약 메일 링크(#booking-) 로그인 복귀', ...USER, flow: mailLinkThenLogin('#booking-bOTHER_P') },
  { id: 'P', kind: 'same', label: '일반 사용자 · #myloans 로그인 복귀', ...USER, flow: mailLinkThenLogin('#myloans') },
  { id: 'Q', kind: 'same', label: '일반 사용자 · 캘린더(#calendar) 새로고침', ...USER, flow: openLoggedIn('#calendar') },
  { id: 'R', kind: 'same', label: '일반 사용자 · 없는 주소(#nope) 진입 → 홈', ...USER, flow: openLoggedIn('#nope') },
  { id: 'S', kind: 'same', label: '일반 사용자 · 해시 없이 진입 → 홈', ...USER, flow: openLoggedIn('') },
]
// 수정 전·후 비교에 쓰는 관측값 (시각·요청 수처럼 실행마다 달라지는 값은 뺀다)
const pick = o => ({ hash: o.hash, saved: o.saved, adminShown: o.adminShown, sideNav: o.sideNav, canvasShown: o.canvasShown, loginPage: o.loginPage, sawAdminEver: o.sawAdminEver, errors: o.errors, writes: o.writes, flowError: o.flowError })
const brief = o => `${o.hash || '(해시 없음)'}${o.adminShown ? ' [어드민]' : ''}${o.canvasShown ? ' [조직도 캔버스]' : ''}${o.loginPage ? ' [로그인 화면]' : ''}${o.saved ? ` 저장값=${o.saved}` : ''}`

;(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null
  const sB = await serve(BEFORE, 4661), sA = await serve(AFTER, 4662)
  let pass = 0, fail = 0
  const ok = (cond, msg, detail) => { cond ? pass++ : fail++; console.log(`    ${cond ? 'PASS' : 'FAIL'} ${msg}${cond ? '' : '\n         ' + JSON.stringify(detail)}`) }
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue
    console.log(`[${s.id}] ${s.label}`)
    const ob = await run(4661, { ...s, shot: s.shot ? s.shot + '_before.png' : null })
    const oa = await run(4662, { ...s, shot: s.shot ? s.shot + '_after.png' : null })
    const clean = o => o.flowError === null && o.errors.length === 0
    if (s.kind === 'fix') {
      ok(clean(ob) && s.before(ob), `수정 전(버그 재현): ${brief(ob)}`, ob)
      ok(clean(oa) && s.after(oa),  `수정 후: ${brief(oa)}`, oa)
    } else {
      ok(clean(ob) && clean(oa) && JSON.stringify(pick(ob)) === JSON.stringify(pick(oa)), `수정 전·후 동일: ${brief(oa)}`, { before: pick(ob), after: pick(oa) })
    }
  }
  sB.close(); sA.close()
  console.log(`결과: PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('테스트 러너 오류:', e); process.exit(2) })
