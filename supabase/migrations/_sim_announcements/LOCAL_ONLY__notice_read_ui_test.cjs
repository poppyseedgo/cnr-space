// ⚠ LOCAL_ONLY — 공지 읽기 경로(헤더 배너 · 공지사항 페이지) 실브라우저 검증 (운영과 무관, 로컬 전용)
//
// 수정 전 빌드와 수정 후 빌드를 같은 시나리오로 돌려 비교한다. Supabase 응답만 가짜로 돌려준다
// (실제 백엔드에는 요청이 한 건도 나가지 않는다: HTTP 는 전부 가로채고, WebSocket 은 닫고, 그 외 외부 주소는 차단).
// 가짜 응답은 DB 시뮬(LOCAL_ONLY__run_sim_20261019.py)에서 확인한 규칙을 그대로 옮긴 것이다:
//   · 테이블 직접 조회(RLS)        : 일반 직원 = 게시 중 행만 / notice 관리자 = 전체 / 비로그인 = 0행
//   · rpc/get_active_announcement  : 게시 중(is_active · 기간 내) 중 최근 시작 1건 — 권한 무관
//   · rpc/get_announcement_history : is_active · 게시 시작(종료분 포함) — 권한 무관, 비로그인 401
//
// 실행:
//   VITE_SUPABASE_URL=https://simref.supabase.test VITE_SUPABASE_ANON_KEY=sim npx vite build --outDir /tmp/notice/dist-after
//   (수정 전 커밋을 같은 방식으로)                                                         --outDir /tmp/notice/dist-before
//   NODE_PATH=$(npm root -g) node LOCAL_ONLY__notice_read_ui_test.cjs /tmp/notice/dist-before /tmp/notice/dist-after [스크린샷 폴더]
const { chromium } = require('playwright')
const http = require('http'), fs = require('fs'), path = require('path')

const [BEFORE, AFTER, SHOTS] = process.argv.slice(2)
if (!BEFORE || !AFTER) { console.error('사용법은 파일 상단 참조'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const SB = 'https://simref.supabase.test', STORAGE_KEY = 'sb-simref-auth-token'
const ME = '11111111-1111-1111-1111-111111111111', EMAIL = 'tester@cnrres.com'
const ADMIN_ROLES = ['dashboard','booking','approval','room','user','visitor','book','notification','notice','kb','resource','org','super','workboard']
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.json':'application/json', '.ico':'image/x-icon' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const at = h => new Date(Date.now() + h * 3600e3).toISOString()
const day = 24

// ── 공지 데이터 ──
const row = (message, is_active, startH, endH, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, message, bg_color: '#E6F2FF', text_color: '#1E1E1E',
  starts_at: at(startH), ends_at: at(endH), is_active, created_at: at(startH), created_by: null, updated_at: at(startH), updated_by: null })
// D1 = 운영 그대로: 8건 전부 종료 (운영 기간을 지금 기준 상대값으로 옮김 — 가장 최근 것이 15일 전 종료)
const D1 = [
  row('운영1 SPACE 오픈', true, -168 * day, -153 * day, 1), row('운영2 도서관 오픈', true, -83 * day, -75 * day, 2),
  row('운영3 ZOOM 종료', true, -78 * day, -70 * day, 3),    row('운영4 대여 승인제', true, -77 * day, -69 * day, 4),
  row('운영5 예약화면 개편', true, -72 * day, -64 * day, 5), row('운영6 공휴일 표기', true, -65 * day, -57 * day, 6),
  row('운영7 노쇼 안내', true, -64 * day, -36 * day, 7),     row('운영8 노쇼 누적 안내', true, -29 * day, -15 * day, 8),
]
// D2 = D1 + 판정 경계: 게시중 2건(B 가 더 최근 시작) · 방금 종료 · 게시 예정 · 비활성
const D2 = [...D1,
  row('시뮬 게시중A', true, -3 * day, 1 * day, 11), row('시뮬 게시중B', true, -1, 1 * day, 12),
  row('시뮬 방금종료', true, -0.5, -1 / 3600, 13),  row('시뮬 게시예정', true, 1 * day, 2 * day, 14),
  row('시뮬 비활성', false, -1 / 6, 1 * day, 15),
]
const isLive = (a, now) => a.is_active && Date.parse(a.starts_at) <= now && now <= Date.parse(a.ends_at)
const byStartDesc = (x, y) => Date.parse(y.starts_at) - Date.parse(x.starts_at) || Date.parse(y.created_at) - Date.parse(x.created_at)

function serve(dist, port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let f = path.join(dist, decodeURIComponent(q.url.split('?')[0]))
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html')
      r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r)
    }).listen(port, '127.0.0.1', () => res(s))
  })
}

// who: 'user' | 'admin' | 'anon'(로그인 화면)
async function run(port, { who, data, url }, shot) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } })
  const origin = `http://127.0.0.1:${port}`
  const exp = Math.floor(Date.now() / 1000) + 3600
  const user = { id: ME, aud: 'authenticated', role: 'authenticated', email: EMAIL, app_metadata: { provider: 'azure' }, user_metadata: { full_name: '테스터' } }
  const session = { access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: ME, email: EMAIL, role: 'authenticated', exp })}.sig`, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user }
  const me = { id: ME, email: EMAIL, name: '테스터', dept: 'QA', role: who === 'admin' ? 'ADMIN' : 'USER', is_active: true, employment_status: 'active', avatar_url: null, employee_id: EMAIL }
  const roles = who === 'admin' ? ADMIN_ROLES : []
  const reqs = []   // 공지 관련 요청 기록
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
  const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json', 'content-range': '0-0/*' }, body: JSON.stringify(body) })
  await ctx.routeWebSocket(/.*/, ws => ws.close())
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url())
    if (u.origin === origin) return route.continue()
    if (u.origin !== SB) return route.abort()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const p = u.pathname, single = (req.headers()['accept'] || '').includes('vnd.pgrst.object'), now = Date.now()
    const authed = (req.headers()['authorization'] || '').includes(session.access_token)
    if (p === '/auth/v1/user') return json(route, user)
    if (p.startsWith('/auth/v1/token')) return json(route, session)
    if (p.startsWith('/auth/v1/')) return json(route, {})
    // ── 공지: 테이블 직접 조회 (RLS 규칙) ──
    if (p === '/rest/v1/announcements' && req.method() === 'GET') {
      reqs.push(`GET table ${authed ? 'authenticated' : 'anon'}`)
      let rows = !authed ? [] : who === 'admin' ? [...data] : data.filter(a => isLive(a, now))
      const q = u.searchParams
      if (q.get('is_active') === 'eq.true') rows = rows.filter(a => a.is_active)
      const gte = q.getAll('starts_at').find(v => v.startsWith('gte.')); if (gte) rows = rows.filter(a => Date.parse(a.starts_at) >= Date.parse(gte.slice(4)))
      if ((q.get('order') || '').startsWith('starts_at.desc')) rows.sort(byStartDesc)
      if (q.get('limit')) rows = rows.slice(0, Number(q.get('limit')))
      return json(route, rows)
    }
    // ── 공지: 서버 함수 ──
    if (p === '/rest/v1/rpc/get_active_announcement') {
      reqs.push(`RPC get_active_announcement ${authed ? 'authenticated' : 'anon'}`)
      if (!authed) return json(route, { code: '42501', message: 'permission denied for function get_active_announcement' }, 401)
      return json(route, data.filter(a => isLive(a, now)).sort(byStartDesc).slice(0, 1))
    }
    if (p === '/rest/v1/rpc/get_announcement_history') {
      reqs.push(`RPC get_announcement_history ${authed ? 'authenticated' : 'anon'}`)
      if (!authed) return json(route, { code: '42501', message: 'permission denied for function get_announcement_history' }, 401)
      let rows = data.filter(a => a.is_active && Date.parse(a.starts_at) <= now)
      const q = u.searchParams
      const gte = q.getAll('starts_at').find(v => v.startsWith('gte.')); if (gte) rows = rows.filter(a => Date.parse(a.starts_at) >= Date.parse(gte.slice(4)))
      if ((q.get('order') || '').startsWith('starts_at.desc')) rows.sort(byStartDesc)
      return json(route, rows)
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
  await page.addInitScript(([key, sess, loggedIn]) => { if (loggedIn) localStorage.setItem(key, JSON.stringify(sess)); else localStorage.removeItem(key) }, [STORAGE_KEY, session, who !== 'anon'])
  await page.goto(`${origin}/${url}`)
  await page.waitForSelector(who === 'anon' ? 'text=Sign in with Microsoft' : 'button[aria-label="전체 메뉴 열기"]', { timeout: 20000 })
  await page.waitForTimeout(3000)
  const o = await page.evaluate(() => {
    const banner = [...document.querySelectorAll('div[role="status"] > span')].map(s => s.textContent.trim()).filter(t => /^(운영|시뮬)/.test(t))
    const h1 = [...document.querySelectorAll('h1')].find(h => h.textContent.trim() === '공지사항')
    const pageRoot = h1 ? h1.parentElement : null
    const text = pageRoot ? pageRoot.innerText : ''
    const list = pageRoot ? [...pageRoot.querySelectorAll('p')].map(p => p.textContent.trim()).filter(t => /^(운영|시뮬)/.test(t)) : []
    return { banner, list, empty: text.includes('최근 6개월 공지가 없습니다'), noPast: text.includes('지난 공지가 없습니다'), liveLabel: (text.match(/지금 헤더 배너에 표시 중/g) || []).length }
  })
  o.reqs = reqs; o.errors = errors
  if (SHOTS && shot) await page.screenshot({ path: path.join(SHOTS, shot) })
  await browser.close()
  return o
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const names = rows => rows.map(r => r.message)
const D1_HISTORY = names([...D1].sort(byStartDesc))                                                    // 8건, 최근 시작순
const D2_PUBLISHED = names(D2.filter(a => a.is_active && Date.parse(a.starts_at) <= Date.now()).sort(byStartDesc))   // 11건 (게시예정·비활성 제외)
const D2_ALL = names([...D2].sort(byStartDesc))                                                        // 13건 (관리자가 테이블에서 받는 전체)
const D2_LIVE = ['시뮬 게시중B', '시뮬 게시중A']

const SCENARIOS = [
  // ── 헤더 배너 ──
  { id: 'B1', label: '일반 직원 · 게시 중 공지 2건 → 최근 시작한 1건', who: 'user', data: D2, url: '#home',
    before: o => eq(o.banner, ['시뮬 게시중B']), after: o => eq(o.banner, ['시뮬 게시중B']) && eq(o.reqs, ['RPC get_active_announcement authenticated']) },
  { id: 'B2', label: '공지 관리자 · 같은 데이터 → 일반 직원과 같은 1건 (수정 전: 게시 전 공지가 뜸)', who: 'admin', data: D2, url: '#home', shot: 'B2_admin_banner',
    before: o => eq(o.banner, ['시뮬 게시예정']), after: o => eq(o.banner, ['시뮬 게시중B']) && eq(o.reqs, ['RPC get_active_announcement authenticated']) },
  { id: 'B3', label: '공지 관리자 · 운영 그대로(전부 종료) → 배너 없음 (수정 전: 종료된 노쇼 공지가 뜸)', who: 'admin', data: D1, url: '#home', shot: 'B3_admin_ended',
    before: o => eq(o.banner, ['운영8 노쇼 누적 안내']), after: o => eq(o.banner, []) },
  { id: 'B4', label: '일반 직원 · 운영 그대로(전부 종료) → 배너 없음', who: 'user', data: D1, url: '#home',
    before: o => eq(o.banner, []), after: o => eq(o.banner, []) },
  { id: 'B5', label: '로그인 화면(비로그인) → 공지 요청 자체가 없음 (수정 전: anon 요청 1건)', who: 'anon', data: D2, url: '',
    before: o => eq(o.reqs, ['GET table anon']), after: o => eq(o.reqs, []) },
  // ── 공지사항 페이지 ──
  { id: 'H1', label: '일반 직원 · 운영 그대로 → 지난 공지 8건 (수정 전: "공지가 없습니다")', who: 'user', data: D1, url: '#announcements', shot: 'H1_user_history',
    before: o => o.empty && eq(o.list, []), after: o => !o.empty && eq(o.list, D1_HISTORY) && o.liveLabel === 0 },
  { id: 'H2', label: '일반 직원 · 경계 데이터 → 게시중 2 + 지난 공지 9, 게시예정·비활성 없음 (수정 전: 게시중 2건뿐)', who: 'user', data: D2, url: '#announcements',
    before: o => eq(o.list, D2_LIVE) && o.noPast, after: o => eq(o.list, [...D2_LIVE, ...D2_PUBLISHED.filter(m => !D2_LIVE.includes(m))]) && o.liveLabel === 2 },
  { id: 'H3', label: '공지 관리자 · 경계 데이터 → 일반 직원과 같은 목록 (수정 전: 게시예정·비활성이 지난 공지에 섞임)', who: 'admin', data: D2, url: '#announcements',
    before: o => eq(o.list, [...D2_LIVE, ...D2_ALL.filter(m => !D2_LIVE.includes(m))]), after: o => eq(o.list, [...D2_LIVE, ...D2_PUBLISHED.filter(m => !D2_LIVE.includes(m))]) && o.liveLabel === 2 },
  { id: 'H4', label: '공지사항 페이지의 요청 — 배너 RPC 1건 + 이력 RPC 1건, 테이블 직접 조회 없음', who: 'user', data: D2, url: '#announcements',
    before: o => eq([...o.reqs].sort(), ['GET table authenticated', 'GET table authenticated']), after: o => eq([...o.reqs].sort(), ['RPC get_active_announcement authenticated', 'RPC get_announcement_history authenticated']) },
]

;(async () => {
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null
  const sB = await serve(BEFORE, 4671), sA = await serve(AFTER, 4672)
  let pass = 0, fail = 0
  const ok = (cond, msg, detail) => { cond ? pass++ : fail++; console.log(`    ${cond ? 'PASS' : 'FAIL'} ${msg}${cond ? '' : '\n         ' + JSON.stringify(detail)}`) }
  const brief = o => `배너 [${o.banner.join(', ') || '없음'}]${o.list.length || o.empty ? ` · 목록 ${o.list.length}건` : ''} · 요청 [${o.reqs.join(' | ') || '없음'}]`
  for (const s of SCENARIOS) {
    if (only && !only.includes(s.id)) continue
    console.log(`[${s.id}] ${s.label}`)
    const ob = await run(4671, s, s.shot ? s.shot + '_before.png' : null)
    const oa = await run(4672, s, s.shot ? s.shot + '_after.png' : null)
    ok(ob.errors.length === 0 && s.before(ob), `수정 전: ${brief(ob)}`, ob)
    ok(oa.errors.length === 0 && s.after(oa),  `수정 후: ${brief(oa)}`, oa)
  }
  sB.close(); sA.close()
  console.log(`결과: PASS ${pass} / FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('테스트 러너 오류:', e); process.exit(2) })
