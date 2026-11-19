// LOCAL_ONLY — 주소 검색 · 우편번호 · 전화번호 하이픈 화면 확인 (실제 카카오 우편번호 서비스 사용)
// ⚠ 로컬 전용 — 운영 코드·운영 SQL 과 무관. 저장소의 화면 코드를 메모리 API(하네스)로 띄워 실제 브라우저로 누른다.
// 준비: 하네스(.harness/ — mockAuth · mockApi · vite.config) 를 https://localhost:5199 로 실행.
//       https 인 이유: 카카오 스크립트는 부모 화면의 프로토콜을 따라 검색 화면(iframe)을 연다. http 로 띄우면 iframe 안에서 http/https 가 섞여
//       선택 결과가 간헐적으로 전달되지 않는다(운영 space.cnrres.com 은 https 라 해당 없음).
// 결과: _sim__addr_ui_result_20261119.txt
const { chromium } = require('/opt/npm-tools/node_modules/playwright')
const out = process.env.SHOTS_DIR || '/tmp/shp-shots'
const R = []; const ok = (n, c, extra = '') => { R.push(!!c); console.log((c ? 'PASS' : 'FAIL'), n, extra) }
;(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], proxy: { server: 'http://127.0.0.1:37849', bypass: 'localhost,127.0.0.1' } })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage(); global.__page = page
  const errs = []; const reqs = []
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text() + ' @' + m.location().url) })
  page.on('request', r => { if (/postcode/.test(r.url())) reqs.push(r.url()) })
  // 하네스를 https 로 띄운다(운영과 동일) — 카카오 스크립트는 부모 화면의 프로토콜을 따라 iframe 을 연다. 로컬 인증서는 이 테스트용 1건만 신뢰 등록(LOCAL_ONLY)
  const frame = () => page.frames().find(f => f.url().includes('postcode.map'))
  const search = async (side, q) => {
    await page.locator('.shp-addr').nth(side === 'sender' ? 0 : 1).locator('.shp-btn-search').click()
    await page.waitForSelector('.shp-modal')
    await page.waitForFunction(() => document.querySelector('.shp-modal-embed')?.style.display === 'block')
    for (let i = 0; i < 40 && !frame(); i++) await page.waitForTimeout(250)
    const fr = frame(); await fr.waitForSelector('#region_name')
    // 카카오 화면(iframe)의 스크립트가 다 뜬 뒤에 입력한다 — 뜨기 전에(수십 ms 안에) 입력하면 카카오 쪽 초기화 전이라 선택 결과가 전달되지 않는다.
    // 사람 손으로는 불가능한 속도라 자동화에서만 생기는 조건이며, 화면이 준비됐는지는 카카오 iframe 의 load + 네트워크 한가함으로 판단한다(고정 대기 아님)
    await fr.waitForLoadState('load'); await fr.waitForLoadState('networkidle')
    await fr.fill('#region_name', q); await fr.press('#region_name', 'Enter'); await fr.waitForSelector('.list_post_item .link_post')
    return fr
  }

  await page.goto('https://localhost:5199/'); await page.waitForSelector('.shp-empty')
  await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
  ok('A1 등록 화면 진입만으로는 카카오 스크립트를 부르지 않음', reqs.length === 0 && await page.locator('script[src*="postcode"]').count() === 0)
  ok('A2 주소 줄 2개: 우편번호(읽기 전용) + [주소 검색]', await page.locator('.shp-addr').count() === 2 && await page.locator('#shp-szip').getAttribute('readonly') !== null && await page.locator('#shp-rzip').getAttribute('readonly') !== null && await page.locator('.shp-btn-search').count() === 2)
  ok('A3 기존 주소 칸 id 유지 (#shp-saddr1/2 · #shp-raddr1/2)', await page.locator('#shp-saddr1, #shp-saddr2, #shp-raddr1, #shp-raddr2').count() === 4)
  await page.locator('#shp-rzip').scrollIntoViewIfNeeded()
  await page.screenshot({ path: out + '/a1_form_addr.png', fullPage: true })

  // ── 수신처: 도로명 선택 ──
  await page.fill('#shp-raddr2', '지워질 상세주소')
  let fr = await search('receiver', '역삼로 412')
  ok('A4 검색 창 제목에 대상(수신처) 표시', (await page.locator('.shp-modal-head').innerText()).includes('수신처'))
  ok('A5 스크립트는 kakaocdn 에서 1회 로드', reqs.filter(u => u.includes('postcode.v2.js')).length === 1 && reqs.some(u => u.startsWith('https://t1.kakaocdn.net/')), reqs[0])
  ok('A6 예전 도메인 종료 공지 미노출', await fr.locator('text=도메인 종료 안내').count() === 0)
  await page.screenshot({ path: out + '/a2_modal_results.png' })
  await fr.locator('.list_post_item .link_post').first().click()
  await page.waitForSelector('.shp-modal', { state: 'detached' })
  ok('A7 도로명 선택 → 우편번호 5자리', await page.inputValue('#shp-rzip') === '06199', await page.inputValue('#shp-rzip'))
  ok('A8 주소 = 시도 전체 표기 + (건물명)', await page.inputValue('#shp-raddr1') === '서울특별시 강남구 역삼로 412 (씨엔알빌딩)', await page.inputValue('#shp-raddr1'))
  ok('A9 상세주소 비움 + 그 칸으로 커서 이동', await page.inputValue('#shp-raddr2') === '' && await page.evaluate(() => document.activeElement?.id) === 'shp-raddr2')
  await page.keyboard.type('3층 문서수발실')
  ok('A10 이어서 바로 상세주소 입력', await page.inputValue('#shp-raddr2') === '3층 문서수발실')
  await page.screenshot({ path: out + '/a3_form_picked.png', fullPage: true })

  // ── 검색 후 직접 수정 허용 ──
  await page.fill('#shp-raddr1', '서울특별시 강남구 역삼로 412 (씨엔알빌딩) 별관')
  ok('A11 검색 후 주소 직접 수정 가능 · 우편번호 유지', await page.inputValue('#shp-raddr1') === '서울특별시 강남구 역삼로 412 (씨엔알빌딩) 별관' && await page.inputValue('#shp-rzip') === '06199')
  await page.fill('#shp-raddr1', '')
  ok('A12 주소를 다 지우면 우편번호도 비움', await page.inputValue('#shp-rzip') === '')

  // ── 지번 선택 ──
  fr = await search('receiver', '역삼로 412')
  ok('A13 두 번째 검색: 스크립트 재로드 없음', reqs.filter(u => u.includes('postcode.v2.js')).length === 1)
  await fr.locator('.list_post_item button.link_post:visible', { hasText: '대치동 908-6' }).first().click()   // 지번 줄(DOM 에는 숨겨진 link_post 가 섞여 있어 글자로 고른다)
  await page.waitForSelector('.shp-modal', { state: 'detached' })
  ok('A14 지번 선택 → 지번 주소(건물명 없음) + 우편번호', await page.inputValue('#shp-raddr1') === '서울특별시 강남구 대치동 908-6' && await page.inputValue('#shp-rzip') === '06199', await page.inputValue('#shp-raddr1'))

  // ── 닫기: 값 변화 없음 ──
  await page.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await page.waitForSelector('.shp-modal')
  await page.keyboard.press('Escape'); await page.waitForSelector('.shp-modal', { state: 'detached' })
  await page.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await page.waitForSelector('.shp-modal')
  await page.locator('.shp-modal-dim').click({ position: { x: 10, y: 10 } }); await page.waitForSelector('.shp-modal', { state: 'detached' })
  await page.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await page.waitForSelector('.shp-modal')
  await page.click('.shp-modal-head button'); await page.waitForSelector('.shp-modal', { state: 'detached' })
  ok('A15 Esc · 바깥 클릭 · [닫기] → 닫히고 값 그대로', await page.inputValue('#shp-raddr1') === '서울특별시 강남구 대치동 908-6' && await page.inputValue('#shp-rzip') === '06199')

  // ── 발신처 ──
  ok('A16 발신처 기본(본사): 주소 · 우편번호 자동', await page.inputValue('#shp-saddr1') === '서울특별시 강남구 역삼로 412' && await page.inputValue('#shp-szip') === '06199')
  fr = await search('sender', '판교역로 166')
  ok('A17 검색 창 제목에 대상(발신처) 표시', (await page.locator('.shp-modal-head').innerText()).includes('발신처'))
  await fr.locator('.list_post_item .link_post').first().click(); await page.waitForSelector('.shp-modal', { state: 'detached' })
  const sz = await page.inputValue('#shp-szip'), sa = await page.inputValue('#shp-saddr1')
  ok('A18 발신처 검색 → 발신처 칸만 채움(수신처 불변)', /^\d{5}$/.test(sz) && sz !== '06199' && sa.startsWith('경기도 성남시 분당구 판교역로 166') && await page.inputValue('#shp-raddr1') === '서울특별시 강남구 대치동 908-6', sz + ' ' + sa)
  await page.locator('input[name=shp-sender]').nth(1).check()
  ok('A19 발신 회사 바꾸면 주소 · 우편번호가 그 회사 값으로', await page.inputValue('#shp-saddr1') === '부산광역시 동구 중앙대로 216' && await page.inputValue('#shp-saddr2') === '교원빌딩 17층' && await page.inputValue('#shp-szip') === '48733')
  await page.locator('input[name=shp-sender]').nth(2).check()
  ok('A20 직접 입력으로 바꾸면 회사·주소·우편번호 비움', await page.inputValue('#shp-saddr1') === '' && await page.inputValue('#shp-szip') === '')
  await page.locator('input[name=shp-sender]').nth(1).check()

  // ── 전화번호 ──
  await page.locator('#shp-sphone').pressSequentially('01034567890')
  ok('P1 휴대폰: 번호만 쳐도 하이픈', await page.inputValue('#shp-sphone') === '010-3456-7890', await page.inputValue('#shp-sphone'))
  await page.locator('#shp-rphone').pressSequentially('029830938')
  ok('P2 서울 유선: 02-983-0938', await page.inputValue('#shp-rphone') === '02-983-0938', await page.inputValue('#shp-rphone'))
  await page.fill('#shp-rphone', ''); await page.locator('#shp-rphone').pressSequentially('0519876543')
  ok('P3 지역 유선: 051-987-6543', await page.inputValue('#shp-rphone') === '051-987-6543')
  await page.fill('#shp-rphone', ''); await page.locator('#shp-rphone').pressSequentially('15880002')
  ok('P4 대표번호: 1588-0002', await page.inputValue('#shp-rphone') === '1588-0002')
  await page.fill('#shp-rphone', ''); await page.locator('#shp-rphone').pressSequentially('+82 10-3456-7890'); await page.locator('#shp-rname').focus()
  ok('P5 국제번호 표기는 손대지 않음', await page.inputValue('#shp-rphone') === '+82 10-3456-7890')
  await page.fill('#shp-rphone', ''); await page.locator('#shp-rphone').pressSequentially('010-3456-7890')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
  ok('P6 지우는 중에도 자연스럽게(010-3456)', await page.inputValue('#shp-rphone') === '010-345-6' || await page.inputValue('#shp-rphone') === '010-3456', await page.inputValue('#shp-rphone'))
  await page.fill('#shp-rphone', '')
  // 중간 수정: 커서가 튀지 않게 입력 중에는 그대로 두고, 칸을 벗어날 때 정리
  await page.locator('#shp-rphone').pressSequentially('0101234')
  await page.locator('#shp-rphone').evaluate(e => e.setSelectionRange(3, 3))   // 010|-123-4 → 맨 앞 묶음 뒤
  await page.keyboard.type('9')
  const mid = await page.inputValue('#shp-rphone'); const caret = await page.locator('#shp-rphone').evaluate(e => e.selectionStart)
  ok('P7 중간에 끼워 넣기: 입력 중 재배열 없음(커서 유지)', mid === '0109-123-4' && caret === 4, mid + ' caret=' + caret)
  await page.locator('#shp-rname').focus()
  ok('P8 칸을 벗어나면 규칙대로 정리', await page.inputValue('#shp-rphone') === '010-912-34', await page.inputValue('#shp-rphone'))
  await page.fill('#shp-rphone', '01098765432')    // 붙여넣기에 해당
  ok('P9 붙여넣기 → 즉시 하이픈', await page.inputValue('#shp-rphone') === '010-9876-5432')
  await page.screenshot({ path: out + '/a4_form_phone.png', fullPage: true })

  // ── 등록: 저장값 ──
  await page.evaluate(() => { window.__lastRows = [] })
  await page.fill('#shp-project', '24-046'); await page.locator('input[name=shp-billable]').nth(0).check(); await page.selectOption('#shp-item', 'parcel')
  await page.fill('#shp-qty', '1'); await page.locator('input[name=shp-region]').nth(0).check(); await page.fill('#shp-sname', '홍길동'); await page.fill('#shp-rname', '정연구')
  // 전화번호 중간 수정 직후 칸을 벗어나지 않고 바로 저장
  await page.fill('#shp-sphone', ''); await page.locator('#shp-sphone').pressSequentially('0103456789'); await page.locator('#shp-sphone').evaluate(e => e.setSelectionRange(3, 3)); await page.keyboard.type('1')
  await page.locator('#shp-sphone').evaluate(e => e.dispatchEvent(new Event('x')))
  const beforeSave = await page.inputValue('#shp-sphone')
  await page.click('.shp-actions button:text-is("계속등록")', { noWaitAfter: true })
  await page.waitForSelector('.shp-toast:has-text("등록됨")')
  ok('S1 계속등록 후 발신처 우편번호·주소 유지, 수신처 우편번호 초기화', /^\d{5}$/.test(await page.inputValue('#shp-szip')) && (await page.inputValue('#shp-saddr1')).startsWith('부산광역시') && await page.inputValue('#shp-rzip') === '' && await page.inputValue('#shp-raddr1') === '')
  await page.click('.shp-actions button:text-is("목록")'); await page.waitForSelector('.shp-table')
  await page.locator('.shp-table tbody tr').first().locator('text=수정').click(); await page.waitForSelector('#shp-item')
  ok('S2 저장값(수정 화면에서 다시 읽음): 우편번호 2칸', await page.inputValue('#shp-szip') === '48733' && await page.inputValue('#shp-rzip') === '06199', await page.inputValue('#shp-szip') + '/' + await page.inputValue('#shp-rzip'))
  ok('S3 저장값: 전화번호 하이픈(칸을 벗어나지 않고 저장해도)', /^\d{2,4}-\d{3,4}-\d{4}$/.test(await page.inputValue('#shp-sphone')) && await page.inputValue('#shp-rphone') === '010-9876-5432', beforeSave + ' → ' + await page.inputValue('#shp-sphone'))
  await page.click('.shp-actions button:text-is("목록")'); await page.waitForSelector('.shp-table')

  // ── 출력 서식에는 우편번호 없음 ──
  await page.locator('.shp-table tbody tr').first().locator('text=인쇄').click(); await page.waitForSelector('.shp-preview .shp-sheet')
  const label = await page.locator('.shp-print-root .shp-sheet').first().evaluate(e => e.textContent)
  ok('O1 라벨: 주소는 있고 우편번호는 없음', label.includes('서울특별시 강남구 대치동 908-6') && !label.includes('06199') && !/\b48\d{3}\b/.test(label), label.replace(/\s+/g, ' ').slice(0, 160))
  await page.screenshot({ path: out + '/a5_print.png', fullPage: true })
  await page.click('text=운송내역서(관리자)'); await page.waitForSelector('.shp-table-admin')
  const heads = await page.locator('.shp-table-admin th').allInnerTexts()
  ok('O2 관리자 목록: 24열 그대로, 우편번호 열 없음', heads.length === 24 && !heads.some(h => h.includes('우편')) && !(await page.locator('.shp-table-admin').innerText()).includes('06199'))
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=엑셀다운로드')])
  await dl.saveAs(out + '/addr_download.xlsx')
  ok('O3 엑셀다운로드 실행', true)

  // ── 스크립트를 못 받는 PC ──
  const p2 = await ctx.newPage()
  await p2.route(/postcode\.v2\.js/, r => r.abort())
  await p2.goto('https://localhost:5199/'); await p2.waitForSelector('.shp-tabs'); await p2.click('text=등록하기'); await p2.waitForSelector('#shp-project')
  await p2.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await p2.waitForSelector('.shp-modal-err')
  ok('F1 외부 접속 차단 PC: 안내 문구 + [닫고 직접 입력]', (await p2.locator('.shp-modal-err').innerText()).includes('직접 입력'))
  await p2.screenshot({ path: out + '/a6_modal_error.png' })
  await p2.click('.shp-modal-err button'); await p2.waitForSelector('.shp-modal', { state: 'detached' })
  await p2.fill('#shp-raddr1', '1 Example St, Boston, MA, USA')
  ok('F2 닫은 뒤 주소 직접 입력 가능(우편번호 없이)', await p2.inputValue('#shp-raddr1') === '1 Example St, Boston, MA, USA' && await p2.inputValue('#shp-rzip') === '')
  await p2.unroute(/postcode\.v2\.js/)
  await p2.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await p2.waitForSelector('.shp-modal')
  const recovered = await p2.waitForFunction(() => document.querySelector('.shp-modal-embed')?.style.display === 'block', null, { timeout: 15000 }).then(() => true).catch(() => false)
  ok('F3 실패 후 다시 누르면 재시도(연결되면 정상 동작)', recovered)
  await p2.close()

  // ── 좁은 화면 ──
  await page.setViewportSize({ width: 390, height: 800 }); await page.goto('https://localhost:5199/'); await page.waitForSelector('.shp-empty')   // 관리자 화면에는 [등록하기]가 없다 → 조회 화면으로
  await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
  ok('M1 모바일 폭: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.locator('.shp-addr').nth(1).scrollIntoViewIfNeeded(); await page.screenshot({ path: out + '/a7_mobile_addr.png' })
  await page.locator('.shp-addr').nth(1).locator('.shp-btn-search').click(); await page.waitForSelector('.shp-modal')
  await page.waitForFunction(() => document.querySelector('.shp-modal-embed')?.style.display === 'block'); await page.waitForTimeout(2500)
  const mb = await page.locator('.shp-modal').boundingBox(); const eb = await page.locator('.shp-modal-embed').boundingBox()
  ok('M2 모바일 폭: 검색 창이 화면 안 + 카카오 최소 크기(300×400) 이상', mb.x >= 0 && mb.x + mb.width <= 390 && mb.y >= 0 && mb.y + mb.height <= 800 && eb.width >= 300 && eb.height >= 400, JSON.stringify({ m: [Math.round(mb.width), Math.round(mb.height)], e: [Math.round(eb.width), Math.round(eb.height)] }))
  await page.screenshot({ path: out + '/a8_mobile_modal.png' })

  ok('Z 콘솔·런타임 오류 없음', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 300))
  console.log(`\n결과: ${R.filter(Boolean).length}/${R.length} PASS`)
  await browser.close()
  process.exit(R.every(Boolean) ? 0 : 1)
})().catch(async e => { console.error('ERR', String(e).split('\n')[0]); try { const pg = global.__page; await pg.screenshot({ path: out + '/a_fail.png' }); const f = pg.frames().find(f => f.url().includes('postcode.map')); console.error('frame url', f && decodeURIComponent(f.url())) } catch (x) {} process.exit(2) })
