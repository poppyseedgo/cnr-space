// LOCAL_ONLY — 관리자 상세 창 · 헤더 프로필 화면 확인. 하네스(https://localhost:5199) 필요
const { chromium } = require('/opt/npm-tools/node_modules/playwright')
const out = process.env.SHOTS_DIR || '/home/claude/scratch/shots'
const R = []; const ok = (n, c, extra = '') => { R.push(!!c); console.log((c ? 'PASS' : 'FAIL'), n, extra) }
;(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text() + ' @' + m.location().url) })
  await page.goto('https://localhost:5199/'); await page.waitForSelector('.shp-empty')

  // ── 헤더 프로필 ──
  const me = page.locator('.shp-top .shp-me')
  ok('H1 헤더: 프로필(이니셜) + 이름', (await me.innerText()).replace(/\s+/g, ' ').trim() === '홍 홍길동', JSON.stringify(await me.innerText()))
  const av = await me.locator('> div').first().evaluate(e => { const c = getComputedStyle(e); return [e.offsetWidth, e.offsetHeight, c.backgroundColor, c.color, c.borderRadius, c.fontSize, c.fontWeight].join('|') })
  ok('H2 아바타 = SPACE 헤더 값(36px 원 · #000/#fff · 16px/400)', av === '36|36|rgb(0, 0, 0)|rgb(255, 255, 255)|50%|16px|400', av)
  const order = await page.locator('.shp-top-right > *').evaluateAll(a => a.map(e => e.className.split(' ')[0]))
  ok('H3 순서: 프로필 → [C&R SPACE로 이동]', order.join(',') === 'shp-me,shp-btn', order.join(','))
  await page.locator('.shp-top').screenshot({ path: out + '/d1_header_initial.png' })
  await page.goto('https://localhost:5199/?avatar=1&name=' + encodeURIComponent('박예시_Yesi Park_DM')); await page.waitForSelector('.shp-empty')
  ok('H4 프로필 이미지가 있으면 이미지 표시', await page.locator('.shp-top .shp-me img').count() === 1 && (await page.locator('.shp-top .shp-me-name').innerText()) === '박예시_Yesi Park_DM')
  await page.locator('.shp-top').screenshot({ path: out + '/d2_header_image.png' })
  await page.goto('https://localhost:5199/'); await page.waitForSelector('.shp-empty')

  // 내 건 1건 등록(우편번호·비고 포함)
  await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
  await page.fill('#shp-project', '24-046'); await page.locator('input[name=shp-billable]').nth(0).check(); await page.selectOption('#shp-item', 'parcel')
  await page.fill('#shp-qty', '2'); await page.fill('#shp-contents', '혈당측정스트립 2박스'); await page.locator('input[name=shp-region]').nth(1).check(); await page.fill('#shp-note', '냉장 보관 필요')
  await page.fill('#shp-sname', '홍길동'); await page.fill('#shp-sphone', '01034567890')
  await page.fill('#shp-rco', '예시대학교병원'); await page.fill('#shp-rname', '정연구'); await page.fill('#shp-rphone', '0519876543'); await page.fill('#shp-raddr1', '부산광역시 예시구 테스트로 4'); await page.fill('#shp-raddr2', '임상시험센터 3층')
  await page.click('.shp-actions button:text-is("등록")'); await page.waitForSelector('.shp-table')

  // ── 관리자 목록 ──
  await page.click('text=운송내역서(관리자)'); await page.waitForSelector('.shp-table-admin')
  const heads = await page.locator('.shp-table-admin th').allInnerTexts()
  ok('D1 목록 불변: 24열 · 3건', heads.length === 24 && await page.locator('.shp-table-admin tbody tr').count() === 3)
  ok('D2 줄 = 누를 수 있는 표시(커서 · 키보드 초점)', await page.locator('.shp-table-admin tbody tr').first().evaluate(e => getComputedStyle(e).cursor === 'pointer' && e.tabIndex === 0))
  ok('D3 열기 전에는 상세 창 없음', await page.locator('.shp-modal-detail').count() === 0)
  await page.screenshot({ path: out + '/d3_admin_list.png', fullPage: true })

  const row = page.locator('.shp-table-admin tbody tr', { hasText: '김샘플' })
  const rowNo = await row.locator('td').nth(3).innerText(); const rowN = await row.locator('td').nth(0).innerText()
  const c = await row.locator('td').allInnerTexts()   // 목록 줄의 24칸 — 상세 창의 값은 이 줄과 같아야 한다(라벨 SSOT 공유)
  await row.locator('td').nth(4).click(); await page.waitForSelector('.shp-modal-detail')
  const txt = (await page.locator('.shp-modal-detail').innerText()).replace(/\s+/g, ' ')
  ok('D4 줄 클릭 → 그 건의 상세 창(수발신번호·항목·수발형태 = 목록 값)', txt.startsWith(`${rowNo} ${c[9]} ${c[8]} 닫기`), txt.slice(0, 40))
  const want = ['순번 ' + c[0], '사원명 ' + c[1], '사원ID ' + c[2], '프로젝트 번호 ' + c[22], '청구여부 ' + c[23], '신청일자 ' + c[17], '단위 ' + c[10], '수량 ' + c[12], '지역 ' + c[18], '내용물 ' + c[11], '사용금액 ' + c[19], '무게(g) ' + c[20]]
  ok('D5 목록 줄의 값이 상세 창에 모두 같은 표기로 있음', c.length === 24 && want.every(k => txt.includes(k)), want.filter(k => !txt.includes(k)).join(' / ') || want.join(' / ').slice(0, 200))
  ok('D6 목록에 없는 값: 비고 · 우편번호 · 등록 시각', txt.includes('비고 파손 주의 · 오전 중 수령 희망') && txt.includes('06199') && txt.includes('01234') && /등록 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(txt))
  ok('D7 발신처 → 수신처: 담당자·회사·전화·주소', txt.includes('발신처 김샘플 씨엔알리서치(본사) 전화번호 010-0000-0001 주소 06199서울특별시 강남구 역삼로 412') && txt.includes('수신처 이수신 예시대학교병원 전화번호 02-000-0002 주소 01234서울시 예시구 예시길 2 예시빌딩 연구동 101호'), txt.slice(txt.indexOf('발신처')))
  ok('D8 빈 값은 -', txt.includes('운송장번호 -'))
  ok('D9 읽기 전용: 버튼은 [닫기] 하나, 입력 칸 없음', (await page.locator('.shp-modal-detail button').allInnerTexts()).join('/') === '닫기' && await page.locator('.shp-modal-detail input, .shp-modal-detail select, .shp-modal-detail textarea').count() === 0)
  const box = await page.locator('.shp-modal-detail').boundingBox()
  ok('D10 한 화면에 들어옴(스크롤 없이, 900px 높이)', box.y >= 0 && box.y + box.height <= 900 && await page.locator('.shp-dt-scroll').evaluate(e => e.scrollHeight <= e.clientHeight), Math.round(box.width) + 'x' + Math.round(box.height))
  await page.screenshot({ path: out + '/d4_admin_detail.png' })

  await page.keyboard.press('Escape'); await page.waitForSelector('.shp-modal-detail', { state: 'detached' })
  ok('D11 Esc 닫기 → 초점이 누른 줄로 돌아감', await page.evaluate(() => document.activeElement?.classList.contains('shp-row-click')) && (await page.evaluate(() => document.activeElement?.innerText)).includes('김샘플'))
  await page.keyboard.press('Enter'); await page.waitForSelector('.shp-modal-detail')
  ok('D12 키보드 Enter 로도 열림(같은 건)', (await page.locator('.shp-dt-no').innerText()) === rowNo)
  await page.locator('.shp-modal-dim').click({ position: { x: 8, y: 8 } }); await page.waitForSelector('.shp-modal-detail', { state: 'detached' })
  await page.locator('.shp-table-admin tbody tr', { hasText: '홍길동' }).first().click(); await page.waitForSelector('.shp-modal-detail')
  const t2 = (await page.locator('.shp-modal-detail').innerText()).replace(/\s+/g, ' ')
  ok('D13 다른 줄 → 그 줄의 내용(직접 입력 주소: 우편번호 없음, 발신처 본사 06199)', t2.includes('사원명 홍길동') && t2.includes('비고 냉장 보관 필요') && t2.includes('전화번호 051-987-6543 주소 부산광역시 예시구 테스트로 4 임상시험센터 3층') && t2.includes('주소 06199서울특별시 강남구 역삼로 412'), t2.slice(t2.indexOf('발신처')))
  await page.click('.shp-modal-detail button:text-is("닫기")'); await page.waitForSelector('.shp-modal-detail', { state: 'detached' })
  ok('D14 [닫기] · 바깥 클릭으로 닫힘, 목록 그대로', await page.locator('.shp-table-admin tbody tr').count() === 3)

  // 검색하면 열려 있던 상세 창은 닫힌다 / 엑셀은 그대로
  await page.evaluate(() => { const c = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return c.call(this) } })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=엑셀다운로드')]); await dl.saveAs(out + '/detail_download.xlsx')
  ok('D15 엑셀다운로드 그대로 동작', /^운송내역서_/.test(await page.evaluate(() => window.__dlName)))

  // ── 좁은 화면 ──
  await page.setViewportSize({ width: 390, height: 800 })
  ok('M1 모바일: 헤더는 프로필 이미지만(이름 숨김) · 가로 넘침 없음', await page.locator('.shp-me-name').evaluate(e => getComputedStyle(e).display === 'none') && await page.locator('.shp-me > div').first().isVisible() && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.locator('.shp-table-admin tbody tr', { hasText: '김샘플' }).locator('td').first().click(); await page.waitForSelector('.shp-modal-detail')
  const mb = await page.locator('.shp-modal-detail').boundingBox()
  ok('M2 모바일: 상세 창이 화면 안 · 안쪽만 스크롤', mb.x >= 0 && mb.x + mb.width <= 390 && mb.y >= 0 && mb.y + mb.height <= 800, JSON.stringify([Math.round(mb.width), Math.round(mb.height)]))
  await page.screenshot({ path: out + '/d5_mobile_detail.png' })

  ok('Z 콘솔·런타임 오류 없음', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 300))
  console.log(`\n결과: ${R.filter(Boolean).length}/${R.length} PASS`)
  await browser.close(); process.exit(R.every(Boolean) ? 0 : 1)
})().catch(e => { console.error('ERR', String(e).split('\n')[0]); process.exit(2) })
