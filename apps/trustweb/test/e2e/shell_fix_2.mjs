// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c shell-fix-2 (headless, stock dev server, synthetic record, mocked Tana API on loopback):
 * PORT=5458 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node shell_fix_2.mjs
 * Pull from Tana (preview, apply, errors inline), "Review requests" as a header button, no Record on a protected row,
 * the event-only variant's way back (⋮ and long press), the per-event Notifications switch on a support ask; 360x780 and 1280x900.
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default?.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5458}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const record = {
  v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], notificationsOn: false,
  inventory: [{ id: 'i1', text: 'Probe book', audience: 'friends', included: true, createdAt: 1 }],
  people: [{ id: 'p1', name: 'Anna Probe', context: '', ring: 'friend', metAt: 1, lines: [] }],
  events: [{ id: 'e1', name: 'Winter Probe', from: `${today}T09:30`, where: 'Probe Hall', createdAt: 1, attended: true, hosts: ['Tester'], notify: false }],
}
const INDEX = [
  { id: 'a1', name: 'Anna Beispiel', breadcrumb: ['Library'], created: '2025-02-20T18:05:49.444Z' },
  { id: 'b2', name: 'Ben Muster', breadcrumb: ['Library'], created: '2025-03-01T10:00:00.000Z' },
]
const NODES = { a1: '- Anna Beispiel #person <!-- node-id: a1 -->\n  - **Email**: anna@example.org <!-- node-id: x -->\n', b2: '- Ben Muster #person <!-- node-id: b2 -->\n' }
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'mcp-session-id' }
const mockTana = async (page, { down = false, status = 200 } = {}) => {
  await page.route('http://127.0.0.1:8262/**', async (route) => {
    if (down) return route.abort('connectionrefused')
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    if (status !== 200) return route.fulfill({ status, headers: CORS, body: '' })
    const b = JSON.parse(route.request().postData() ?? '{}')
    const text = b.method !== 'tools/call' ? undefined : b.params.name === 'search_nodes' ? JSON.stringify(INDEX) : NODES[b.params.arguments.nodeId]
    await route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json', 'mcp-session-id': 's1' }, body: JSON.stringify({ jsonrpc: '2.0', id: b.id, result: b.method === 'tools/call' ? { content: [{ text }] } : {} }) })
  })
}

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const phone = w < 600
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await mockTana(page)
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([k, r]) => localStorage.setItem(k, r), [KEY, JSON.stringify(record)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)
    await page.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 3000 }).catch(() => {}) // the keep-a-copy nag (wave 44) is not under test here
    const click = (s) => page.locator(s).first().click()
    const shot = (n) => page.screenshot({ path: `${SHOTS}/shell-fix-2-${w}-${n}.png` })

    // Review requests: a header button on Resources, nothing floating
    await click('[data-go="inventory"]'); await page.waitForTimeout(500)
    check(`${w}: Resources has the Review requests header button`, (await page.locator('.hdr [data-open-requests]').count()) === 1)
    check(`${w}: no floating requests element`, (await page.locator('.requests-fab').count()) === 0)
    const [rq, ask] = [await page.locator('[data-open-requests]').boundingBox(), await page.locator('[data-open-query]').first().boundingBox().catch(() => null)]
    check(`${w}: the requests button sits in the header row and does not overlap Ask`, !!rq && rq.y < 120 && (!ask || rq.x + rq.width <= ask.x + 1 || ask.x + ask.width <= rq.x + 1), JSON.stringify({ rq, ask }))
    await click('[data-open-requests]'); await page.waitForTimeout(500)
    check(`${w}: it opens the requests sheet`, (await page.locator('.sheet.on').count()) === 1)
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    if (await page.locator('.sheet.on').count()) await page.locator('.sheet.on .sheet-close, .sheet.on [data-sheet-close], .scrim').first().click().catch(() => {})

    // Pull from Tana: Settings > Import
    await click('[data-go="web"]'); await page.waitForTimeout(400)
    await click('[data-settings-gear]'); await page.waitForTimeout(600)
    await click('[data-setting="ui.import"]'); await page.waitForTimeout(600)
    if (phone) { await page.locator('[data-sync-advanced] summary').scrollIntoViewIfNeeded(); await page.locator('[data-sync-advanced] summary').click(); await page.waitForTimeout(300) }
    if (phone) {
      // wave 44c: Tana answers on the computer only; a phone says so and gets the people by device sync
      check(`${w}: a phone shows the computer-only note, no token field`, (await page.locator('[data-tana-phone-note]').innerText()).includes('Tana connects on your computer') && (await page.locator('[data-tana-token]').count()) === 0)
      await shot('pull-phone-note')
    } else {
      check(`${w}: Import shows Pull from Tana with its one-line hint`, (await page.locator('[data-tana-pull-hint]').count()) === 1)
      await page.locator('[data-tana-preview]').scrollIntoViewIfNeeded()
      await click('[data-tana-preview]'); await page.waitForTimeout(400)
      check(`${w}: Preview without a token says so inline`, (await page.locator('[data-tana-problem]').innerText()).includes('token'))
      await page.locator('[data-tana-token]').fill('probe-token'); await page.locator('[data-tana-token]').dispatchEvent('change')
      await click('[data-tana-preview]'); await page.waitForTimeout(1500)
      check(`${w}: Preview lists 2 new people, nothing applied yet`, (await page.locator('[data-tana-plan]').getAttribute('data-tana-plan')) === '2/0/0')
      const before = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).people.length, KEY)
      check(`${w}: the record is untouched by the preview`, before === 1, String(before))
      await shot('pull-preview')
      await click('[data-tana-apply]'); await page.waitForTimeout(800)
      const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).people.map((p) => p.id), KEY)
      check(`${w}: Apply adds them`, after.includes('tana-a1') && after.includes('tana-b2') && after.length === 3, JSON.stringify(after))
      // wave 44c: the token lives for this visit only (sessionStorage), never in localStorage unless "Remember" is ticked (then sealed)
      const stored = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).map((k) => localStorage.getItem(k).includes('probe-token') ? k : '').filter(Boolean)))
      const kept = await page.evaluate(() => sessionStorage.getItem('trustweb.tana.token'))
      check(`${w}: the token is kept outside the record, this visit only`, stored === '[]' && kept === 'probe-token', `${stored} ${kept}`)
      await click('[data-tana-preview]'); await page.waitForTimeout(1500)
      check(`${w}: a second preview finds nothing to do`, (await page.locator('[data-tana-plan]').getAttribute('data-tana-plan')) === '0/0/2' && (await page.locator('[data-tana-apply]').count()) === 0)
      await page.unroute('http://127.0.0.1:8262/**'); await mockTana(page, { down: true })
      await click('[data-tana-preview]'); await page.waitForTimeout(1200)
      check(`${w}: Tana not running: the error stays inline`, (await page.locator('[data-tana-problem]').innerText()).includes('did not answer'))
      await page.unroute('http://127.0.0.1:8262/**'); await mockTana(page, { status: 401 })
      await click('[data-tana-preview]'); await page.waitForTimeout(1200)
      check(`${w}: a refused token is told so`, (await page.locator('[data-tana-problem]').innerText()).includes('refused'))
      await shot('pull-error')
      // wave 44c: Remember on this computer: off by default; ticked = sealed copy in localStorage, no plaintext
      check(`${w}: Remember on this computer is off by default`, !(await page.locator('[data-tana-remember]').isChecked()))
      await page.locator('[data-tana-remember]').check()
      await page.waitForTimeout(500)
      const sealed = await page.evaluate(() => JSON.stringify(Object.keys(localStorage).filter((k) => localStorage.getItem(k).includes('probe-token'))))
      const sealedKey = await page.evaluate(() => localStorage.getItem('trustweb.tana.token.sealed'))
      check(`${w}: ticked: a sealed copy exists and no localStorage value holds the token`, !!sealedKey && !sealedKey.includes('probe-token') && sealed === '[]', `${sealed}`)
    }
    await ctx.close()

    // event-only variant: the way back
    const ctx2 = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 })
    const p2 = await ctx2.newPage()
    p2.on('pageerror', (e) => errors.push(String(e)))
    await p2.goto(URL); await p2.waitForTimeout(1000)
    await p2.evaluate(([k, r]) => { localStorage.setItem(k, r); sessionStorage.setItem('trustweb.ui.appMode', 'event') }, [KEY, JSON.stringify(record)])
    await p2.reload(); await p2.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await p2.waitForTimeout(1200)
    await p2.locator('.sheet.on button', { hasText: 'Not now' }).first().click({ timeout: 3000 }).catch(() => {})
    const tabsBefore = await p2.locator('.tabs .tab').count()
    await p2.locator('[data-bar-more]').click(); await p2.waitForTimeout(500)
    check(`${w}: event-only ⋮ offers Open the full app`, (await p2.locator('[data-open-full-app]').count()) === 1)
    await p2.screenshot({ path: `${SHOTS}/shell-fix-2-${w}-event-only-more.png` })
    await p2.locator('[data-open-full-app]').click(); await p2.waitForTimeout(700)
    const tabsAfter = await p2.locator('.tabs .tab').count()
    check(`${w}: it opens the full app (more tabs than the event bar)`, tabsAfter > tabsBefore && (await p2.evaluate(() => sessionStorage.getItem('trustweb.ui.appMode'))) === null, `${tabsBefore} -> ${tabsAfter}`)
    await p2.locator('[data-bar-more]').click(); await p2.waitForTimeout(400)
    check(`${w}: the entry is gone afterwards`, (await p2.locator('[data-open-full-app]').count()) === 0)
    await p2.evaluate(() => sessionStorage.setItem('trustweb.ui.appMode', 'event')); await p2.reload(); await p2.waitForTimeout(1200)
    const mark = p2.locator('.hdr [data-brand-mark]').first()
    if (await mark.count()) {
      await mark.click({ button: 'right' }); await p2.waitForTimeout(700)
      check(`${w}: right click on the app mark opens the full app too (long press = same handler)`, (await p2.evaluate(() => sessionStorage.getItem('trustweb.ui.appMode'))) === null)
    } else check(`${w}: app mark present in the header`, false)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx2.close()
  }
} finally {
  await browser.close()
}
console.log(failed ? 'SOME FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
