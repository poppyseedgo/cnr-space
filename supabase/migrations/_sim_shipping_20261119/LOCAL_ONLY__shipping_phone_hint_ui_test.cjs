// LOCAL_ONLY — 전화번호 입력 칸 아래 안내 확인. 하네스(https://localhost:5199) 필요
const { chromium } = require('/opt/npm-tools/node_modules/playwright')
const out = process.env.SHOTS_DIR || '/home/claude/scratch/shots'
const R = []; const ok = (n, c, extra = '') => { R.push(!!c); console.log((c ? 'PASS' : 'FAIL'), n, extra) }
;(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text() + ' @' + m.location().url) })
  await page.goto('https://localhost:5199/'); await page.waitForSelector('.shp-empty'); await page.click('text=등록하기'); await page.waitForSelector('#shp-project')
  const hint = sel => page.locator(sel).locator('xpath=..').locator('.shp-hint-warn')
  const after = async (sel, v) => { await page.fill(sel, ''); await page.locator(sel).pressSequentially(v); await page.locator('#shp-project').focus(); return (await hint(sel).count()) ? hint(sel).innerText() : '' }

  ok('H1 처음에는 안내 없음', await page.locator('.shp-hint-warn').count() === 0)
  await page.locator('#shp-rphone').pressSequentially('0101')
  ok('H2 치는 동안에는 안내를 띄우지 않음', await hint('#shp-rphone').count() === 0)
  await page.locator('#shp-project').focus()
  ok('H3 칸을 벗어나면: 자릿수 부족 안내', (await hint('#shp-rphone').innerText()) === '자릿수가 모자랍니다. 번호를 확인해 주세요.')
  ok('H4 안내 색은 오류(빨강)와 다름', await hint('#shp-rphone').evaluate(e => getComputedStyle(e).color) === 'rgb(180, 83, 9)')
  await page.locator('#shp-rphone').focus()
  ok('H5 다시 그 칸에 들어가면 안내 사라짐', await hint('#shp-rphone').count() === 0)
  ok('H6 완성 번호: 안내 없음 (휴대폰 · 서울 · 지역 · 대표번호)', await after('#shp-rphone', '01034567890') === '' && await after('#shp-rphone', '029830938') === '' && await after('#shp-rphone', '0311234567') === '' && await after('#shp-rphone', '15880002') === '')
  ok('H7 자릿수 초과', await after('#shp-rphone', '02123456789') === '자릿수가 많습니다. 번호를 확인해 주세요.')
  ok('H8 없는 앞자리', await after('#shp-rphone', '0341234567') === '앞자리를 확인해 주세요.')
  ok('H9 지역번호 없는 번호', await after('#shp-rphone', '7654321') === '지역번호부터 넣어 주세요. (예: 02, 031)')
  ok('H10 해외 번호 · 글자가 섞인 값: 안내 없음', await after('#shp-rphone', '+1 617 555 0100') === '' && await after('#shp-rphone', '02-123-4567 내선 12') === '')

  // 미리보기용: 두 칸에 서로 다른 안내
  await after('#shp-sphone', '010101'); await after('#shp-rphone', '7654321')
  await page.locator('#shp-sphone').scrollIntoViewIfNeeded()
  const fs = page.locator('fieldset').filter({ has: page.locator('#shp-sphone') }).first()
  await page.screenshot({ path: out + '/h1_hints.png', fullPage: true })

  // 필수 오류와 겹치지 않음
  await page.fill('#shp-sphone', ''); await page.fill('#shp-rphone', '0101'); await page.locator('#shp-project').focus()
  await page.click('.shp-actions button:text-is("등록")'); await page.waitForSelector('.shp-err')
  const sWrap = page.locator('#shp-sphone').locator('xpath=..'), rWrap = page.locator('#shp-rphone').locator('xpath=..')
  ok('H11 빈 칸: 필수 오류(빨강)만, 안내 없음', await sWrap.locator('.shp-err').count() === 1 && await sWrap.locator('.shp-hint-warn').count() === 0)
  ok('H12 자릿수 부족은 오류가 아님: 안내만', await rWrap.locator('.shp-err').count() === 0 && await rWrap.locator('.shp-hint-warn').count() === 1)

  // 안내만 — 등록은 막지 않는다 (확정 1-가)
  await page.fill('#shp-project', 'CNR'); await page.locator('input[name=shp-billable]').nth(1).check(); await page.selectOption('#shp-item', 'quick'); await page.fill('#shp-qty', '1')
  await page.locator('input[name=shp-region]').nth(0).check(); await page.fill('#shp-sname', '홍길동'); await page.fill('#shp-sphone', '01034567890'); await page.fill('#shp-rname', '수신')
  await page.click('.shp-actions button:text-is("등록")'); await page.waitForSelector('.shp-table')
  ok('H13 자릿수 부족 번호가 있어도 등록됨(번호 발급 · 목록 1건)', /퀵-\d{8}-\d{3}/.test(await page.locator('.shp-table tbody tr').first().innerText()) && await page.locator('.shp-table tbody tr').count() === 1)   // 하네스에 다른 직원의 퀵 1건이 있어 순번은 002
  await page.locator('.shp-table tbody tr').first().locator('text=수정').click(); await page.waitForSelector('#shp-item')
  ok('H14 수정 화면: 저장된 미완성 번호에 안내 표시', await page.inputValue('#shp-rphone') === '010-1' && (await hint('#shp-rphone').innerText()).includes('모자랍니다') && await hint('#shp-sphone').count() === 0, await page.inputValue('#shp-rphone'))

  await page.setViewportSize({ width: 390, height: 800 }); await page.locator('#shp-rphone').scrollIntoViewIfNeeded()
  ok('M1 모바일 폭: 가로 넘침 없음', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: out + '/h2_hint_mobile.png' })
  ok('Z 콘솔·런타임 오류 없음', errs.length === 0, [...new Set(errs)].join(' | ').slice(0, 300))
  console.log(`\n결과: ${R.filter(Boolean).length}/${R.length} PASS`)
  await browser.close(); process.exit(R.every(Boolean) ? 0 : 1)
})().catch(e => { console.error('ERR', String(e).split('\n')[0]); process.exit(2) })
