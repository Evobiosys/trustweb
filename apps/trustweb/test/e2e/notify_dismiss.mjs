// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-notify-dismiss (headless, stock dev only): PORT=5291 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node notify_dismiss.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5291}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
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
    const badge = async () => Number(await page.locator('[data-notify-bell]').getAttribute('data-notify-bell'))
    const n0 = await badge()
    check(`${w}: badge starts at 5`, n0 === 5, n0)
    await page.locator('[data-notify-bell]').click(); await page.waitForTimeout(400)
    await page.locator('[data-notify-section=connected] [data-notify-action=message]').click(); await page.waitForTimeout(600)
    check(`${w}: the chat opened`, (await page.locator('[data-chat-input], textarea, [data-chat-sheet]').count()) > 0)
    await page.screenshot({ path: `${SHOTS}/steer-notify-dismiss-chat-${w}.png` })
    check(`${w}: the badge dropped by one`, (await badge()) === n0 - 1, await badge())
    check(`${w}: dismissal is stored`, typeof (await store()).notifDismissed?.['conn:a1'] === 'number')
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    check(`${w}: the badge stays down after reload`, (await badge()) === n0 - 1, await badge())
    await page.locator('[data-notify-bell]').click(); await page.waitForTimeout(400)
    check(`${w}: the row is gone, section says Nothing new.`, (await page.locator('[data-notify-item="conn:a1"]').count()) === 0 && (await page.locator('[data-notify-section=connected]').innerText()).includes('Nothing new.'))
    // an open page: act on the events row, the row vanishes at once
    await page.locator('[data-notify-section=events] [data-notify-action]').click(); await page.waitForTimeout(500)
    check(`${w}: the events row is dismissed too and its inbox item seen`, typeof (await store()).notifDismissed?.['inbox:i1'] === 'number' && (await store()).notifInbox[0].seenAt !== null)
    await page.screenshot({ path: `${SHOTS}/steer-notify-dismiss-after-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
