// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 feed-look (headless, stock dev only): PORT=5447 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node feed_look.mjs. Synthetic record; the one remote instance is mocked in the browser. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5447}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const record = {
  v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p1', name: 'Ann Remote', context: '', ring: 'close', metAt: 1, lines: [], fediverse: { handle: 'ann@fedi.example.org', show: true, reach: 'api' } }],
  feed: { on: true, remote: true },
  events: [{ id: 'e1', name: 'Winter IYG', from: day(2), where: 'Wien', createdAt: 1, attended: true, offers: { feed: true } }],
}
const hit = (a, b) => !(a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5)
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.route('https://fedi.example.org/**', (r) => {
      const u = r.request().url()
      if (u.includes('/accounts/lookup')) return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ id: '77' }) })
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify([{ id: '1', created_at: new Date(Date.now() - 12 * 3_600_000).toISOString(), visibility: 'public', url: 'https://fedi.example.org/@ann/1', content: '<p>Spare bike parts at the repair café</p>' }]) })
    })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([k, r]) => localStorage.setItem(k, r), [KEY, JSON.stringify(record)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const shot = (n) => page.screenshot({ path: `${SHOTS}/feed-look-${w}-${n}.png` })
    await page.locator('.tabs [data-go="feed"]').click(); await page.waitForTimeout(500)
    await page.locator('[data-feed-compose]').fill('Read https://www.example.org/page today')
    await page.locator('[data-feed-compose-send]').click(); await page.waitForTimeout(400)
    const remote = page.locator('[data-post-kind="remote"]').first()
    await remote.waitFor({ timeout: 10_000 })
    const mine = page.locator('[data-post-kind="social"]').first()

    // ---- layout: avatar left of body, handle, compact age ----
    const ava = await remote.locator('.ava').boundingBox(); const body = await remote.locator('.post-body').boundingBox()
    check(`${w}: avatar sits left of the body (bbox), round, ${w < 600 ? 46 : 40}px`, ava.x + ava.width <= body.x + 0.5 && Math.abs(ava.width - (w < 600 ? 46 : 40)) < 1)
    check(`${w}: remote post shows @handle`, (await remote.locator('[data-post-handle]').innerText()) === '@ann@fedi.example.org')
    check(`${w}: age is compact (12h)`, (await remote.locator('.post-age').innerText()) === '12h')
    const hb = await remote.locator('.post-age').boundingBox(); const rb = await remote.boundingBox()
    check(`${w}: age is right-aligned on the head line`, hb.x + hb.width >= rb.x + rb.width - 12)
    check(`${w}: link card with the domain under my post`, (await mine.locator('[data-post-link="example.org"]').count()) === 1)
    check(`${w}: kept hooks (data-post, data-post-kind, post-text)`, (await mine.locator('.post-text').innerText()).includes('today') && (await mine.getAttribute('data-post')) !== null)

    // ---- action row: 5 buttons, no overlap ----
    for (const [name, post] of [['remote', remote], ['mine', mine]]) {
      const btns = post.locator('.post-actions .act')
      check(`${w}: ${name} action row has 5 buttons with aria-labels`, (await btns.count()) === 5 && (await btns.evaluateAll((l) => l.every((b) => b.getAttribute('aria-label')))))
      const boxes = await btns.evaluateAll((l) => l.map((b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
      let overlap = false
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) overlap = true
      check(`${w}: ${name} action buttons do not overlap each other`, !overlap)
    }
    check(`${w}: boost opens the original for a remote post, is struck + disabled for mine`, (await remote.locator('[data-post-boost]').isEnabled()) && (await mine.locator('[data-post-boost]').isDisabled()) && /line-through/.test(await mine.locator('[data-post-boost]').evaluate((b) => getComputedStyle(b).textDecorationLine)))
    const star = mine.locator('[data-post-star]')
    check(`${w}: star off: aria-pressed=false and struck`, (await star.getAttribute('aria-pressed')) === 'false' && /line-through/.test(await star.evaluate((b) => getComputedStyle(b).textDecorationLine)))
    await star.click(); await page.waitForTimeout(300)
    check(`${w}: star on after a tap`, (await page.locator('[data-post-kind="social"]').first().locator('[data-post-star]').getAttribute('aria-pressed')) === 'true')
    check(`${w}: no document scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1))
    const eb = await page.locator('.tabs').boundingBox()
    check(`${w}: last action row does not overlay the bottom bar`, !hit(await page.locator('.post-actions').last().boundingBox(), eb))
    await shot('feed')

    // ---- event row: same row, compact; long press / right click = Feed settings ----
    await page.locator('.tabs [data-go="events"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(500)
    await page.locator('[data-event-feed-toggle]').click(); await page.waitForTimeout(300)
    await page.locator('[data-event-feed-open]').click(); await page.waitForTimeout(600)
    await page.locator('[data-feed-compose]').fill('Arrived at the venue')
    await page.locator('[data-feed-compose-send]').click(); await page.waitForTimeout(400)
    await page.locator('.tabs [data-go="events"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(500)
    await page.locator('[data-event-feed-toggle]').click(); await page.waitForTimeout(300)
    const cp = page.locator('.event-feed-panel [data-event-feed-post] .post-compact')
    check(`${w}: event row shows its post as a compact row (avatar, no action row)`, (await cp.count()) === 1 && (await cp.locator('.ava').count()) === 1 && (await cp.locator('.post-actions').count()) === 0 && /Arrived/.test(await cp.innerText()))
    const pb = await page.locator('.event-feed-panel').boundingBox()
    check(`${w}: the open row does not overlay the bottom bar`, !hit(pb, eb))
    await shot('event-row')
    await page.locator('[data-event-feed-toggle]').click({ button: 'right' }); await page.waitForTimeout(500)
    check(`${w}: right click on the event's Feed row opens the Feed settings`, (await page.locator('[data-feed-toggle]').count()) === 1)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
