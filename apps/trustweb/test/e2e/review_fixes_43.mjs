// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 review fixes (headless, stock dev server, synthetic record): PORT=5437 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node review_fixes_43.mjs.
 * P1 on the event name and the tag chip; P06 sweep: no two visible controls overlap (clipped to their scroller and the viewport) in every wave-43 state,
 * at 360x780 and 1280x900; no document scroll on the phone.
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default?.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5437}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const KEY = 'trustweb.v1.me'
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const people = [
  { id: 'p1', name: 'Anna Probe', context: '', ring: 'friend', metAt: 1, lines: [], events: ['e1'] },
  { id: 'p2', name: 'Ben Probe', context: '', ring: 'close', metAt: 1, lines: [], events: ['e1'] },
  { id: 'p3', name: 'Cleo Probe', context: '', ring: 'acquaintance', metAt: 1, lines: [] },
]
const EVENT = { id: 'e1', name: 'Winter Probe', tagName: 'Probe Days', from: `${today}T09:30`, where: 'Probe Hall', conditions: 'Bring a mug', themes: ['soil', 'water'], createdAt: 1, attended: true, hosts: ['Tester'], organizers: ['p3'], organizer: 'Cleo Probe', offers: { feed: true, support: true, resources: true } }
const record = { v: 1, me: { id: 'me1', displayName: 'Tester' }, peers: [], log: [], inventory: [], people, events: [EVENT], atEvent: { eventId: 'e1', since: Date.now() - 3600e3 } }

/** Every visible control (button, input, select, textarea, link, summary), its box clipped to the viewport and every scrolling/clipping ancestor; pairs that intersect by more than 2 px and are not nested. */
const overlaps = (page) => page.evaluate(() => {
  const sel = 'button, input:not([type=hidden]), select, textarea, a[href], summary, [role=switch]'
  const clip = (n) => {
    let r = n.getBoundingClientRect()
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom }
    for (let a = n.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX)) {
        const q = a.getBoundingClientRect()
        box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) }
      }
    }
    box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, innerWidth), b: Math.min(box.b, innerHeight) }
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null
  }
  const shown = (n) => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) && n.getClientRects().length > 0
  // Known, older than wave 43 (listed in the review report, not failed here): the hint "i" badge on a header button (wave 20s), the bar's ⋮ circle on the last tab and the raised centre tab over the page (wave 42 bottom bar).
  // Also older: the stock-mode "Show demo content" chip (.demo-toggle, floats bottom-left on the welcome record).
  const known = (n) => n.matches('.hint-i, .bar-more, .demo-toggle') || n.matches('.tab.tab-primary')
  // A control under an open sheet (modal) is not reachable, so it cannot overlay anything: skip it when the sheet covers its centre.
  const layer = (x) => x?.closest('.page-layer, .sheet.on, [role=dialog], .scrim') ?? null
  const underModal = (n, b) => {
    const top = document.elementFromPoint((b.l + b.r) / 2, (b.t + b.b) / 2)
    return !!top && !n.contains(top) && !!layer(top) && layer(top) !== layer(n)
  }
  const list = [...document.querySelectorAll(sel)].filter(shown).filter((n) => !known(n)).map((n) => ({ n, b: clip(n) })).filter((x) => x.b && !underModal(x.n, x.b))
  // An element covered at its centre by an unrelated element (a sticky bar, a sheet) counts too: the top element at the clipped centre must be it or inside it.
  const hits = []
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j]
    if (A.n.contains(B.n) || B.n.contains(A.n)) continue
    const w = Math.min(A.b.r, B.b.r) - Math.max(A.b.l, B.b.l), h = Math.min(A.b.b, B.b.b) - Math.max(A.b.t, B.b.t)
    if (w > 2 && h > 2) hits.push(`${A.n.tagName}[${(A.n.textContent || A.n.getAttribute('aria-label') || '').trim().slice(0, 20)}] x ${B.n.tagName}[${(B.n.textContent || B.n.getAttribute('aria-label') || '').trim().slice(0, 20)}]`)
  }
  return hits
})
const sweep = async (page, label) => {
  // Scroll each scroller through its height so controls further down are checked too.
  const steps = await page.evaluate(() => { const s = [...document.querySelectorAll('.scroll, .sheet.on, .sheet.on *')].filter((n) => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)); return s.length ? Math.ceil(Math.max(...s.map((n) => n.scrollHeight / Math.max(1, n.clientHeight)))) : 1 })
  const all = new Set()
  for (let i = 0; i < Math.min(steps, 8); i++) {
    await page.evaluate((k) => { for (const n of document.querySelectorAll('.scroll, .sheet.on, .sheet.on *')) if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = k * n.clientHeight * 0.8 }, i)
    await page.waitForTimeout(120)
    for (const o of await overlaps(page)) all.add(o)
  }
  await page.evaluate(() => { for (const n of document.querySelectorAll('.scroll, .sheet.on, .sheet.on *')) n.scrollTop = 0 })
  check(`${label}: no two controls overlap`, all.size === 0, [...all].slice(0, 6).join(' | '))
}
const noDocScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.body.scrollHeight <= innerHeight + 1)

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const phone = w < 600
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([k, r]) => localStorage.setItem(k, r), [KEY, JSON.stringify(record)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1200)
    const click = (s) => page.locator(s).first().click()
    const shot = (n) => page.screenshot({ path: `${SHOTS}/review-fixes-43-${w}-${n}.png` })
    const openEvent = async () => {
      await click('[data-at-event-name]'); await page.waitForTimeout(500)
    }

    // event page collapsed
    await openEvent()
    check(`${w}: event page open`, (await page.locator('[data-event-roles-line]').count()) === 1)
    check(`${w}: the tag chip shows the device tag name (#event:Probe Days)`, (await page.locator('[data-event-tag-chip]').innerText()).includes('#event:Probe Days'))
    await sweep(page, `${w} event page collapsed`); await shot('event')
    if (phone) check(`${w}: no document scroll on the event page`, await noDocScroll(page))
    // roles expanded
    await click('[data-event-roles-toggle]'); await page.waitForTimeout(300)
    check(`${w}: roles expanded: organizers, hosts, tech support`, (await page.locator('[data-role]').count()) === 3)
    await sweep(page, `${w} roles expanded`); await shot('roles')
    await click('[data-event-roles-toggle]'); await page.waitForTimeout(300)
    // share row + advanced open
    await page.locator('[data-event-advanced] summary').first().scrollIntoViewIfNeeded()
    await click('[data-event-advanced] summary'); await page.waitForTimeout(300)
    check(`${w}: advanced shows the invite policy and three offers`, (await page.locator('[data-event-invite-policy]').count()) === 1 && (await page.locator('[data-event-offers] button').count()) === 3)
    await sweep(page, `${w} share row + advanced`); await shot('advanced')
    const bl = await page.locator('[data-event-share] u').boundingBox(), bq = await page.locator('[data-event-qr] span').first().boundingBox()   // the visible label and icon, not the buttons' boxes
    check(`${w}: Link and QR icons side by side (visible gap under 72 px)`, !!bl && !!bq && Math.abs(bl.y - bq.y) < 4 && bq.x - (bl.x + bl.width) < 72 && bq.x > bl.x, JSON.stringify([bl, bq]))

    // P1 on the event name: a press edits (nothing to expand), a right click / long press edits with the name focused
    await page.locator('.events-page').evaluate((n) => { n.scrollTop = 0 })
    await page.locator('[data-event-name-line]').first().click({ button: 'right' }); await page.waitForTimeout(400)
    check(`${w}: right click on the event name opens the edit form`, (await page.locator('[data-event-save]').count()) === 1)
    check(`${w}: ... with the name field focused`, await page.evaluate(() => document.activeElement?.tagName === 'INPUT' && (document.activeElement).value === 'Winter Probe'))
    await click('.hdr .back'); await page.waitForTimeout(400)
    check(`${w}: Back from the form returns to the event page`, (await page.locator('[data-event-name-line]').count()) === 1)
    await click('[data-event-name-line]'); await page.waitForTimeout(400)
    check(`${w}: a press on the event name opens the edit form`, (await page.locator('[data-event-save]').count()) === 1)
    await click('.hdr .back'); await page.waitForTimeout(400)

    // Web focused view with the badge
    await click('[data-event-web-focus]'); await page.waitForTimeout(700)
    check(`${w}: focused Web: Web tab on, badge 1`, (await page.locator('.tab.on[data-go="web"], [data-go="web"].on').count()) >= 1 && (await page.locator('[data-filter-badge]').innerText()).trim() === '1')
    await sweep(page, `${w} focused web + badge`); await shot('web-focus')
    if (phone) check(`${w}: no document scroll on the focused Web`, await noDocScroll(page))
    await page.locator('[data-filter-badge]').click({ button: 'right' }); await page.waitForTimeout(300)
    await page.locator('[data-notice-close]').click().catch(() => {}); await page.waitForTimeout(200)   // answers-43: clearing offers a 5 s Undo toast; the sweep checks the screen itself

    // Feed
    await click('[data-go="feed"]'); await page.waitForTimeout(500)
    await sweep(page, `${w} feed`); await shot('feed')
    if (phone) check(`${w}: no document scroll on the Feed`, await noDocScroll(page))

    // overflow sheet (phone bar)
    if (await page.locator('[data-bar-more]').count()) {
      await click('[data-bar-more]'); await page.waitForTimeout(600)
      await sweep(page, `${w} overflow sheet`); await shot('more')
      await page.keyboard.press('Escape'); await page.waitForTimeout(300)
      if (await page.locator('.sheet.on').count()) await page.locator('.sheet.on .sheet-close, .sheet.on [data-sheet-close], .scrim').first().click().catch(() => {})
      await page.waitForTimeout(300)
    }

    // Settings > Import (Advanced holds Obsidian / Tana on the phone)
    await click('[data-go="web"]'); await page.waitForTimeout(400)
    await click('[data-settings-gear]'); await page.waitForTimeout(600)
    await click('[data-setting="ui.import"]'); await page.waitForTimeout(600)
    if (phone) {
      check(`${w}: Import: Obsidian / Tana sit in a closed Advanced`, (await page.locator('[data-sync-advanced]').count()) === 1)
      await page.locator('[data-sync-advanced] summary').scrollIntoViewIfNeeded(); await page.locator('[data-sync-advanced] summary').click(); await page.waitForTimeout(300)
    }
    await sweep(page, `${w} settings import${phone ? ' advanced open' : ''}`); await shot('import')
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
