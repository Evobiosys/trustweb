// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c header-cluster δ (headless, stock dev only): PORT=5473 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node header_cluster.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5473}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const REC = { v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'a1', name: 'Anna Huber', context: '', ring: 'friend', metAt: 1, lines: [] }], peers: [], chats: {}, inventory: [], wantsToConnect: [], notifInbox: [], log: [], events: [], missedPopupOff: true }
const SCREENS = [['web', 'Web'], ['chat', 'Chat'], ['feed', 'Feed'], ['events', 'Events'], ['inventory', 'Resources']]
const ORDER = ['eye', 'search', 'qr', 'settings']
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const right = () => page.locator('.hdr .hdr-right > *:visible').evaluateAll((ns) => ns.map((n) => (n.matches('[data-settings-gear]') ? 'settings' : n.matches('[data-ai-button]') ? 'ai' : n.matches('.status-pill') || n.querySelector('.status-pill') ? 'qr' : n.matches('.view-menu-btn, [data-view-menu], .view-switch') ? 'eye' : n.querySelector('.view-menu-btn') ? 'eye' : n.matches('.web-search-btn') ? 'search' : n.getAttribute('aria-label') ?? '?')))
    const probe = async (name) => {
      const labels = await right()
      const core = labels.filter((l) => ORDER.includes(l))
      check(`${w}: ${name}: right cluster ${JSON.stringify(labels)} keeps eye, search, QR, settings order`, JSON.stringify(core) === JSON.stringify(ORDER.filter((o) => core.includes(o))) && core.slice(-2).join() === 'qr,settings', JSON.stringify(labels))
      check(`${w}: ${name}: no tools row`, (await page.locator('.hdr-tools').count()) === 0)
      const hdr = await page.locator('.hdr').first().boundingBox()
      check(`${w}: ${name}: header is one row (height ${Math.round(hdr.height)})`, hdr.height < 120, JSON.stringify(hdr))
      const boxes = await page.locator('.hdr .hdr-left > *:visible, .hdr .hdr-right > *:visible').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
      let clash = false
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = true
      check(`${w}: ${name}: no overlap, none off-screen, one row`, !clash && boxes.every((b) => b.x >= 0 && b.x + b.width <= w + 1) && Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y)) < 30, JSON.stringify(boxes))
      const order = await page.locator('.hdr-left > *').evaluateAll((ns) => ns.map((n) => (n.tagName === 'H2' ? 'title' : n.hasAttribute('data-chat-switch') ? 'switch' : n.hasAttribute('data-open-requests') ? 'inbox' : n.hasAttribute('data-notify-bell') ? 'bell' : '?')))
      const t = order.indexOf('title')
      check(`${w}: ${name}: switch/pins follow the title, inbox and bell after`, t >= 0 && order.indexOf('inbox') > t && (order.indexOf('switch') < 0 || (order.indexOf('switch') === t + 1 && order.indexOf('switch') < order.indexOf('inbox'))), JSON.stringify(order))
    }
    for (const [id, name] of SCREENS) {
      await page.locator(`[data-go="${id}"]`).first().click().catch(async () => { await page.evaluate((i) => (document.querySelector(`[data-go="${i}"]`))?.click(), id) })
      await page.waitForTimeout(500)
      await probe(name)
      await page.screenshot({ path: `${SHOTS}/header-cluster-${id}-${w}.png` })
    }
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
