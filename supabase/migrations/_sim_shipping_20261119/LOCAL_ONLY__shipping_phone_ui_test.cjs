// LOCAL_ONLY — 전화번호 표기 설계 반영 확인: 입력 칸 동작 + 전화번호가 나오는 모든 화면. 하네스(https://localhost:5199) 필요
// ?legacy=1 = 하이픈 표기 배포 전에 저장된 모양(숫자만 · 자릿수 부족 · 해외 번호)의 내 건 2건이 있는 상태
const { chromium } = require('/opt/npm-tools/node_modules/playwright')
const out = process.env.SHOTS_DIR || '/home/claude/scratch/shots'
const R = []; const ok = (n, c, extra = '') => { R.push(!!c); console.log((c ? 'PASS' : 'FAIL'), n, extra) }
;(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true })
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text() + ' @' + m.location().url) })
  await page.goto('https://localhost:5199/?legacy=1'); await page.waitForSelector('.shp-table')
  const typed = async (sel, keys) => { await page.fill(sel, ''); await page.locator(sel).pressSequentially(keys); return page.inputValue(sel) }

  // ── 입력 칸: 치는 동안 ──
  await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
  const steps = []; await page.fill('#shp-rphone', '')
  for (const ch of '0212345678') { await page.locator('#shp-rphone').pressSequentially(ch); steps.push(await page.inputValue('#shp-rphone')) }
  ok('I1 서울: 한 글자씩 — 10번째 숫자에서 한 번만 다시 묶임', steps.join(' | ') === '0 | 02 | 02-1 | 02-12 | 02-123 | 02-123-4 | 02-123-45 | 02-123-456 | 02-123-4567 | 02-1234-5678', steps.join(' | '))
  const m = []; await page.fill('#shp-rphone', '')
  for (const ch of '01034567890') { await page.locator('#shp-rphone').pressSequentially(ch); m.push(await page.inputValue('#shp-rphone')) }
  ok('I2 휴대폰: 처음부터 4자리씩(다시 묶이지 않음)', m.join(' | ') === '0 | 01 | 010 | 010-3 | 010-34 | 010-345 | 010-3456 | 010-3456-7 | 010-3456-78 | 010-3456-789 | 010-3456-7890', m.join(' | '))
  ok('I3 지역 3-4 / 4-4', await typed('#shp-rphone', '0311234567') === '031-123-4567' && await typed('#shp-rphone', '03112345678') === '031-1234-5678')
  ok('I4 안심번호 · 대표번호 · 14XX', await typed('#shp-rphone', '050712345678') === '0507-1234-5678' && await typed('#shp-rphone', '15880002') === '1588-0002' && await typed('#shp-rphone', '143312') === '1433-12')
  ok('I5 없는 지역번호 · 자릿수 초과는 묶지 않음', await typed('#shp-rphone', '0341234567') === '0341234567' && await typed('#shp-rphone', '02123456789') === '02123456789')
  ok('I6 지역번호 없는 번호는 묶지 않음', await typed('#shp-rphone', '7654321') === '7654321')
  await page.fill('#shp-rphone', '02) 123.4567'); const p1 = await page.inputValue('#shp-rphone')
  await page.fill('#shp-rphone', '+82-2-312-3456'); const p2 = await page.inputValue('#shp-rphone')
  await page.fill('#shp-rphone', '０１０３４５６７８９０'); const p3 = await page.inputValue('#shp-rphone')
  ok('I7 붙여넣기: 괄호·점 / +82 / 전각 숫자 정리', p1 === '02-123-4567' && p2 === '02-312-3456' && p3 === '010-3456-7890', [p1, p2, p3].join(' | '))
  await page.fill('#shp-rphone', '02-123-4567 내선 12'); await page.locator('#shp-rname').focus()
  ok('I8 글자가 섞인 값은 그대로(내선 미지원)', await page.inputValue('#shp-rphone') === '02-123-4567 내선 12')
  await page.click('.shp-actions button:text-is("목록")'); await page.waitForSelector('.shp-table')

  // ── 수정 화면으로 불러올 때 ──
  await page.locator('.shp-table tbody tr', { hasText: '오수신' }).locator('text=수정').click(); await page.waitForSelector('#shp-item')
  ok('E1 숫자만 저장된 건 → 수정 화면에 하이픈 표기', await page.inputValue('#shp-sphone') === '010-3456-7890' && await page.inputValue('#shp-rphone') === '02-983-0938', await page.inputValue('#shp-sphone') + ' / ' + await page.inputValue('#shp-rphone'))
  await page.click('.shp-actions button:text-is("목록")'); await page.waitForSelector('.shp-table')
  await page.locator('.shp-table tbody tr', { hasText: 'J. Doe' }).locator('text=수정').click(); await page.waitForSelector('#shp-item')
  ok('E2 자릿수 부족 · 해외 번호 건 → 친 만큼만 묶음 / 그대로', await page.inputValue('#shp-sphone') === '010-101' && await page.inputValue('#shp-rphone') === '+1 617 555 0100', await page.inputValue('#shp-sphone') + ' / ' + await page.inputValue('#shp-rphone'))
  await page.click('.shp-actions button:text-is("목록")'); await page.waitForSelector('.shp-table')

  // ── 라벨 인쇄 ──
  await page.click('text=운송내역서 인쇄'); await page.waitForSelector('th.chk input'); await page.locator('th.chk input').check()
  const labels = await page.locator('.shp-print-root .shp-sheet').evaluateAll(a => a.map(e => [...e.querySelectorAll('.shp-sheet-blk > div')].map(d => d.textContent).join('¦')))
  const la = labels.find(t => t.includes('오수신')), lb = labels.find(t => t.includes('J. Doe'))
  ok('L1 라벨: 숫자만 저장된 번호 → 하이픈', la.includes('¦010-3456-7890') && la.includes('¦02-983-0938') && !la.includes('01034567890') && !la.includes('029830938'), la)
  ok('L2 라벨: 자릿수 부족 · 해외 번호는 저장된 그대로', lb.includes('¦010101') && lb.includes('¦+1 617 555 0100') && !lb.includes('010-101'), lb)
  await page.screenshot({ path: out + '/p1_print.png', fullPage: true })

  // ── 관리자 목록 · 상세 창 ──
  await page.click('text=운송내역서(관리자)'); await page.waitForSelector('.shp-table-admin')
  const cells = async name => page.locator('.shp-table-admin tbody tr', { hasText: name }).locator('td').allInnerTexts()
  const ca = await cells('오수신'), cb = await cells('J. Doe'), cc = await cells('김샘플')
  ok('A1 관리자 목록: 숫자만 저장된 번호 → 하이픈 (수신인 · 발신인)', ca[6] === '02-983-0938' && ca[15] === '010-3456-7890', ca[6] + ' / ' + ca[15])
  ok('A2 관리자 목록: 자릿수 부족 · 해외 번호는 저장된 그대로', cb[6] === '+1 617 555 0100' && cb[15] === '010101', cb[6] + ' / ' + cb[15])
  ok('A3 이미 하이픈으로 저장된 건은 그대로', cc[6] === '02-000-0002' && cc[15] === '010-0000-0001')
  await page.screenshot({ path: out + '/p2_admin_list.png', fullPage: true })
  await page.locator('.shp-table-admin tbody tr', { hasText: '오수신' }).locator('td').first().click(); await page.waitForSelector('.shp-modal-detail')
  const dt = (await page.locator('.shp-modal-detail').innerText()).replace(/\s+/g, ' ')
  ok('D1 상세 창: 하이픈 표기', dt.includes('전화번호 010-3456-7890') && dt.includes('전화번호 02-983-0938') && !dt.includes('01034567890'), dt.slice(dt.indexOf('발신처')))
  await page.screenshot({ path: out + '/p3_admin_detail.png' })
  await page.keyboard.press('Escape'); await page.waitForSelector('.shp-modal-detail', { state: 'detached' })
  await page.locator('.shp-table-admin tbody tr', { hasText: 'J. Doe' }).locator('td').first().click(); await page.waitForSelector('.shp-modal-detail')
  const dt2 = (await page.locator('.shp-modal-detail').innerText()).replace(/\s+/g, ' ')
  ok('D2 상세 창: 자릿수 부족 · 해외 번호는 저장된 그대로', dt2.includes('전화번호 010101') && dt2.includes('전화번호 +1 617 555 0100'), dt2.slice(dt2.indexOf('발신처')))
  await page.keyboard.press('Escape'); await page.waitForSelector('.shp-modal-detail', { state: 'detached' })

  // ── 엑셀 ──
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=엑셀다운로드')]); await dl.saveAs(out + '/phone_download.xlsx')
  ok('X1 엑셀다운로드 실행 (내용은 파일 검사에서 확인)', true)

  ok('Z 콘솔·런타임 오류 없음', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 300))
  console.log(`\n결과: ${R.filter(Boolean).length}/${R.length} PASS`)
  await browser.close(); process.exit(R.every(Boolean) ? 0 : 1)
})().catch(e => { console.error('ERR', String(e).split('\n')[0]); process.exit(2) })
