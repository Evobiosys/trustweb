// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b notify-center (headless, stock dev only): PORT=5442 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node notify_center.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5442}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const NOW = Date.now()
const P = (id, name, ring, over = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], ...over })
const peer = (id, ago) => ({ id, displayName: id, did: 'did:key:' + id, ring: 'friend', connectedAt: NOW - ago })
const REC = {
  v: 1, me: { id: 'me1', displayName: 'Tester' },
  people: [P('a1', 'Anna Huber', 'friend', { peerId: 'pa' }), P('b1', 'Ben Gruber', 'close', { peerId: 'pb' }), P('d1', 'Dora Keller', 'intending', { reachedOut: 'received', metAt: NOW - 1000 })],
  peers: [peer('pa', 2 * 86400000), peer('pb', 30 * 86400000)],
  chats: { pb: { unread: 1, messages: [{ key: 'in:1:x', dir: 'in', at: NOW - 60000, sentAt: NOW - 60000, state: 'received', text: 'See you at the event' }] } },
  wantsToConnect: [{ peerId: 'pw', name: 'Wanda Reiter', at: NOW - 5000 }],
  notifInbox: [{ id: 'i1', kind: 'event', title: 'TrustWeb', body: 'Emil joined Winter IYG', at: NOW - 7000, seenAt: null }],
  log: [], events: [], missedPopupOff: true,
}
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const bell = page.locator('[data-notify-bell]')
    check(`${w}: the bell sits in the Web header`, (await bell.count()) === 1)
    const count = Number(await bell.getAttribute('data-notify-bell'))
    check(`${w}: unread count is 5 (message, 2 wants, connected, event)`, count === 5, count)
    check(`${w}: a person who wants to connect sits on the unsorted ring, ringed`, (await page.locator('.node.wants[data-pid="d1"]').count()) === 1)
    // P06: the bell overlaps no other header control
    const boxes = await page.locator('.hdr-right > *, .hdr-tools > *').evaluateAll((ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }))
    let clash = false
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = true
    check(`${w}: no header control overlaps another`, !clash && boxes.every((b) => b.x >= 0 && b.x + b.width <= w + 1), JSON.stringify(boxes))
    await page.screenshot({ path: `${SHOTS}/notify-center-bell-${w}.png` })
    await bell.click(); await page.waitForTimeout(400)
    check(`${w}: the bell opens a PAGE, not an overlay`, (await page.locator('[data-page="notify-center"]').count()) === 1 && (await page.locator('.wt-modal').count()) === 0)
    const secs = await page.locator('[data-notify-section]').evaluateAll((n) => n.map((x) => x.getAttribute('data-notify-section')))
    check(`${w}: four sections in order`, JSON.stringify(secs) === '["messages","wants","connected","events"]', secs)
    check(`${w}: messages lists Ben's message`, (await page.locator('[data-notify-section=messages]').innerText()).includes('See you at the event'))
    const wants = await page.locator('[data-notify-section=wants]').innerText()
    check(`${w}: wants lists Wanda and Dora`, wants.includes('Wanda') && wants.includes('Dora'))
    const conn = page.locator('[data-notify-section=connected] [data-notify-action=message]')
    check(`${w}: Connected has Anna with Send a message`, (await conn.count()) === 1 && (await page.locator('[data-notify-section=connected]').innerText()).includes('Anna') && (await conn.innerText()).includes('Send a message'))
    check(`${w}: events lists the join`, (await page.locator('[data-notify-section=events]').innerText()).includes('Emil joined'))
    await page.screenshot({ path: `${SHOTS}/notify-center-page-${w}.png` })
    await page.locator('[data-page-back]').first().click(); await page.waitForTimeout(400)
    // long press = right click = mark all read
    await page.locator('[data-notify-bell]').click({ button: 'right' }); await page.waitForTimeout(500)
    check(`${w}: mark all read zeroes the badge`, (await page.locator('[data-notify-bell]').getAttribute('data-notify-bell')) === '0', await page.locator('[data-notify-bell]').getAttribute('data-notify-bell'))
    check(`${w}: and is stored`, typeof (await store()).notifReadAt === 'number')
    // Chat: Newly added group
    await page.locator('.tabs [data-go="chat"]').first().click(); await page.waitForTimeout(500)
    const newly = page.locator('[data-chat-newly]')
    check(`${w}: Chat lists Newly added with Anna, not Ben`, (await newly.count()) === 1 && (await newly.innerText()).includes('Anna') && !(await newly.innerText()).includes('Ben'))
    check(`${w}: the bell is in the Chat header too`, (await page.locator('[data-notify-bell]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/notify-center-chat-${w}.png` })
    await page.locator('[data-chat-newly-row="a1"]').click(); await page.waitForTimeout(500)
    check(`${w}: tapping Anna opens her chat`, (await page.locator('[data-chat-input], textarea, [data-chat-sheet]').count()) > 0)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
