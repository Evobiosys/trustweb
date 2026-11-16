// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-community-bar: the bottom bar reads the same in Community mode as in Personal mode. PORT=5292 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node steer_community_bar.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5292}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + extra}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [person('p1', 'Ben Gruber', 'close', { iyg: 'true' })], events: [] })
const tags = JSON.stringify([{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }])
const labels = (page) => page.locator('.tabs [data-go]').evaluateAll((b) => b.map((x) => `${x.getAttribute('data-go')}|${x.innerText.trim()}`))
try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const errors = []
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [record, tags])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
    const personal = await labels(page)
    console.log(`INFO  ${vw}: Personal bar = ${personal.join(' · ')}`)
    const ids = (l) => l.map((x) => x.split('|')[0])
    check(`${vw}: Personal bar = Web · Chat · Events · Resources (no Feed)`, ids(personal).join() === 'web,chat,events,inventory', personal.join())
    await page.screenshot({ path: `${SHOTS}/steer-community-bar-${vw}-personal.png` })
    await page.locator('[data-mode="community"]').click(); await page.waitForTimeout(1500)
    check(`${vw}: Community view is showing`, (await page.locator('[data-community]').count()) === 1)
    const community = await labels(page)
    console.log(`INFO  ${vw}: Community bar = ${community.join(' · ')}`)
    check(`${vw}: Community bar = community Home · Web · then Chat · Events · Resources`, ids(community).join() === 'community:home,web,chat,events,inventory', community.join())
    check(`${vw}: Web second from left in Community, leftmost in Personal`, ids(community)[1] === 'web' && ids(personal)[0] === 'web')
    await page.screenshot({ path: `${SHOTS}/steer-community-bar-${vw}-community.png` })
    await page.locator('.tabs [data-go="community:home"]').click(); await page.waitForTimeout(400)
    check(`${vw}: the Home button opens the community home`, (await page.locator('[data-community]').count()) === 1)
    const nav = page.locator('[data-community-nav="members"]')
    if (!(await nav.isVisible())) await page.locator('[data-community-menu]').click()
    check(`${vw}: community sections reachable in the view's own menu`, await nav.isVisible())
    await nav.click(); await page.waitForTimeout(400)
    check(`${vw}: Members opens`, (await page.locator('[data-community-member]').count()) === 1)
    await page.locator('.tabs [data-go="web"]').click(); await page.waitForTimeout(500)
    check(`${vw}: Web tab opens the Web, mode stays Community`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('[data-mode-pill] .mode-opt.on').getAttribute('data-mode')) === 'community')
    await page.locator('[data-mode="personal"]').click(); await page.waitForTimeout(600)
    check(`${vw}: back in Personal the bar is Web first again, no Home button`, ids(await labels(page)).join() === 'web,chat,events,inventory')
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.evaluate(() => { for (const q of ['[data-settings-group="variations"]', '[data-settings-section="variations"]']) { const d = document.querySelector(q); if (d) d.open = true } }); await page.waitForTimeout(300)
    check(`${vw}: Variations keeps the default-interface rows, the Community layout rows are hidden`, (await page.locator('[data-mode-default]').count()) >= 2 && (await page.locator('[data-mode-item], [data-mode-move]').count()) === 0)
    check(`${vw}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${vw}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
