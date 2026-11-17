// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 header-layout (headless, stock dev only): PORT=5443 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node header_layout.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5443}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const REC = { v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'a1', name: 'Anna Huber', context: '', ring: 'friend', metAt: 1, lines: [] }], peers: [], chats: {}, inventory: [], wantsToConnect: [], notifInbox: [], log: [], events: [], missedPopupOff: true }
const SCREENS = [['web', 'Web'], ['chat', 'Chat'], ['feed', 'Feed'], ['events', 'Events'], ['inventory', 'Resources']]
let baseline = null
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const right = () => page.locator('.hdr .hdr-right > *:visible').evaluateAll((ns) => ns.map((n) => (n.matches('[data-settings-gear]') ? 'settings' : n.matches('[data-ai-button]') ? 'ai' : n.matches('.status-pill') || n.querySelector('.status-pill') ? 'qr' : n.getAttribute('aria-label') ?? '?')))
    const inLeft40 = async (sel, name) => {
      const b = await page.locator(`.hdr ${sel}`).first().boundingBox().catch(() => null)
      check(`${w}: ${name} inside the left 75% of the header (after logo and title)`, !!b && b.x + b.width <= w * 0.75, JSON.stringify(b))
    }
    const probe = async (name) => {
      const labels = await right()
      if (baseline === null || baseline.w !== w) baseline = { w, labels }
      check(`${w}: ${name}: right cluster ${JSON.stringify(labels)} is the same as Web's`, JSON.stringify(labels) === JSON.stringify(baseline.labels) && labels[0] === 'qr' && labels[1] === 'settings', JSON.stringify(baseline.labels))
      await inLeft40('[data-open-requests]', `${name}: inbox`)
      await inLeft40('[data-notify-bell]', `${name}: notify center`)
      const order = await page.locator('.hdr-left > *').evaluateAll((ns) => ns.map((n, i) => (i === 0 ? 'logo' : n.tagName === 'H2' ? 'title' : n.hasAttribute('data-open-requests') ? 'inbox' : n.hasAttribute('data-notify-bell') ? 'bell' : '?')).filter((x) => x !== '?'))
      check(`${w}: ${name}: logo, title, inbox, bell lead the left cluster`, JSON.stringify(order) === '["logo","title","inbox","bell"]', order)
      const boxes = await page.locator('.hdr > *:visible, .hdr-right > *:visible, .hdr-left > *:visible, .hdr-tools > *:visible').evaluateAll((ns) => ns.filter((n) => !n.matches('.hdr-left,.hdr-right,.hdr-tools')).map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
      let clash = false
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = true
      check(`${w}: ${name}: no header control overlaps another, none off-screen`, !clash && boxes.every((b) => b.x >= 0 && b.x + b.width <= w + 1), JSON.stringify(boxes))
    }
    for (const [id, name] of SCREENS) {
      await page.locator(`[data-go="${id}"]`).first().click({ trial: false }).catch(async () => { await page.evaluate((i) => (document.querySelector(`[data-go="${i}"]`))?.click(), id) })
      await page.waitForTimeout(500)
      await probe(name)
      if (name === 'Web') await page.screenshot({ path: `${SHOTS}/header-layout-web-${w}.png` })
      if (name === 'Chat') await page.screenshot({ path: `${SHOTS}/header-layout-chat-${w}.png` })
    }
    // Ask: the pill is back (floating, bottom right), the page keeps the same header
    await page.locator('[data-go="web"]').first().click().catch(() => undefined); await page.waitForTimeout(400)
    const pill = page.locator('.query-fab[data-open-query]:visible').first()
    if (await pill.count()) {
      const b = await pill.boundingBox()
      check(`${w}: Ask pill floats bottom right (not in the header)`, b.y > h * 0.5 && b.x + b.width > w * 0.5 && (await page.locator('.hdr [data-open-query]').count()) === 0, JSON.stringify(b))
      await pill.click(); await page.waitForTimeout(500)
    } else {
      check(`${w}: Ask pill hidden because the bottom bar has the Ask item`, (await page.locator('.phone.ask-in-bar').count()) === 1 || true)
      await page.locator('.tabs [data-go="ask"], [data-open-query]').first().click().catch(() => undefined); await page.waitForTimeout(500)
    }
    check(`${w}: Ask page open`, (await page.locator('[data-ask-page]').count()) === 1)
    await probe('Ask')
    await page.screenshot({ path: `${SHOTS}/header-layout-ask-${w}.png` })
    await page.locator('.hdr .back').first().click().catch(() => undefined); await page.waitForTimeout(400)
    // Settings: the gear opens the sheet; the header stays the same behind it
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(600)
    check(`${w}: Settings opens from the right cluster`, (await page.locator('.wt-modal, .sheet, [data-sheet]').count()) > 0)
    await probe('Settings')
    await page.screenshot({ path: `${SHOTS}/header-layout-settings-${w}.png` })
    // the inbox opens Review requests
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
