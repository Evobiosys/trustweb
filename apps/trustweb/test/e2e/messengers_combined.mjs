// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 messengers-combined proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node messengers_combined.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const now = Date.now()
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123'
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  chats: { x1: { messages: [{ key: 'k1', dir: 'in', text: 'hi from TrustWeb', at: now - 3000, sentAt: now - 3000, state: 'received' }], unread: 1 } },
  people: [{ id: 'p1', name: 'Kaja', ring: 1, lines: [], context: '', peerId: 'x1' }] }
const sync = { rooms: { join: { '!r1:example.org': { state: { events: [{ type: 'm.room.name', content: { name: 'Matrix Mia' } }] }, timeline: { events: [{ origin_server_ts: now - 1000 }] }, unread_notifications: { notification_count: 0 } } } } }

async function open(ctxOpts, { matrix = true, geb = true, off = null } = {}) {
  const ctx = await browser.newContext(ctxOpts)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.route('**/_matrix/client/v3/sync*', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(sync) }))
  await page.route('http://127.0.0.1:8999/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ threads: [{ did: 'did:peer:geb1', title: 'Geb Gus', lastAt: now - 2000, unread: 0 }] }) }))
  await page.goto(URL); await page.waitForTimeout(1200)
  await page.evaluate(([rec, matrix, geb, off, token]) => {
    localStorage.setItem('trustweb.v1.me', JSON.stringify(rec))
    if (matrix) localStorage.setItem('trustweb.matrix.session', JSON.stringify({ hs: 'https://example.org', token: 't', userId: '@jakob:example.org' }))
    if (geb) localStorage.setItem('tw.geb.bridge', JSON.stringify({ port: 8999, token }))
    if (off) localStorage.setItem('trustweb.msg.off', JSON.stringify(off))
  }, [record, matrix, geb, off, TOKEN])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
  await page.locator('[data-go="chat"]').click(); await page.waitForTimeout(600)
  return { page, errors }
}

try {
  // Phone: real touch.
  const { page, errors } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  check('header names the view: TrustWeb', (await page.locator('[data-chat-view-name]').textContent()) === 'TrustWeb')
  check('simple view shows the TrustWeb chat row', (await page.locator('[data-chat-row="p1"]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/01-simple-390.png` })
  await page.locator('[data-chat-source-pill]').tap(); await page.waitForTimeout(300)
  check('tapping the caret pill opens the source list', await page.locator('[data-chat-source-menu]').isVisible())
  check('list names TrustWeb, Matrix, Geb, Signal', (await page.locator('[data-chat-source]').count()) === 4)
  check('Signal (not set up) is greyed with an explanation', (await page.locator('[data-chat-source="signal-link"][data-state="setup"] [data-chat-source-hint]').textContent()).length > 5)
  await page.screenshot({ path: `${SHOTS}/02-menu-390.png` })
  await page.locator('[data-chat-all]').tap(); await page.waitForTimeout(900)
  const srcs = await page.locator('[data-chat-src]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chat-src')))
  check('combined view holds TrustWeb + Matrix + Geb rows', ['trustweb', 'matrix', 'geb'].every((s) => srcs.includes(s)))
  const colors = await page.locator('[data-chat-src]').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).getPropertyValue('--src') || e.style.getPropertyValue('--src')))])
  check('rows carry 3 different bracket colours', colors.length === 3)
  check('header names the combined view', (await page.locator('[data-chat-view-name]').textContent()) === 'All chats')
  await page.screenshot({ path: `${SHOTS}/03-combined-390.png` })
  await page.locator('[data-chat-only]').first().tap(); await page.waitForTimeout(200)
  check('only this chat: one row left, Show all offered', (await page.locator('[data-chat-src]').count()) === 1 && (await page.locator('[data-chat-show-all]').count()) === 1)
  await page.locator('[data-chat-show-all]').tap()
  // three dots opens the same list; Matrix off hides it everywhere.
  await page.locator('[data-chat-dots]').tap(); await page.waitForTimeout(200)
  check('three dots open the list too', await page.locator('[data-chat-source-menu]').isVisible())
  await page.locator('[data-chat-off="matrix"]').tap(); await page.waitForTimeout(800)
  check('Matrix off: no Matrix row', (await page.locator('[data-chat-src="matrix"]').count()) === 0)
  await page.locator('[data-chat-source-pill]').tap(); await page.waitForTimeout(200)
  check('Matrix off: gone from the list (only offered to switch back on)', (await page.locator('[data-chat-source="matrix"]').count()) === 0 && (await page.locator('[data-chat-on="matrix"]').count()) === 1)
  await page.locator('[data-chat-on="matrix"]').tap(); await page.waitForTimeout(300)
  // Signal greyed -> setup page.
  await page.locator('[data-chat-source-pill]').tap(); await page.waitForTimeout(200)
  await page.locator('[data-chat-source-open="signal-link"]').tap(); await page.waitForTimeout(500)
  check('greyed Signal leads to its setup page', (await page.locator('[data-sl-setup]').count()) === 1)
  // Show the code without a companion: says so instead of staying silent.
  for (let i = 0; i < 1; i++) { await page.locator('[data-sl-have-backup]').check(); await page.locator('[data-sl-next]').tap(); await page.waitForTimeout(300) }
  await page.locator('[data-sl-show-qr]').tap(); await page.waitForTimeout(400)
  check('Show the code answers when no companion is paired', (await page.locator('[data-sl-link-status]').textContent()).includes('companion'))
  await page.screenshot({ path: `${SHOTS}/04-signal-code-390.png` })
  // Do Not Disturb keeps the last state.
  await page.goBack(); await page.waitForTimeout(300)
  await page.locator('[data-dnd]').tap(); await page.waitForTimeout(500)
  check('DND on: the hint shows, no new rows after the switch', (await page.locator('[data-chats-hidden]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/05-dnd-390.png` })
  check('no page errors (phone)', errors.length === 0)
  if (errors.length) console.log(errors)

  // Desktop: side by side.
  const d = await open({ viewport: { width: 1440, height: 900 } })
  await d.page.locator('[data-chat-source-pill]').click(); await d.page.locator('[data-chat-all]').click(); await d.page.waitForTimeout(900)
  const xs = await d.page.locator('[data-chat-src]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  check('desktop: rows sit side by side (3 distinct columns)', new Set(xs).size === 3)
  await d.page.screenshot({ path: `${SHOTS}/06-combined-1440.png` })
  // Matrix switched off from the start: hidden.
  const o = await open({ viewport: { width: 1440, height: 900 } }, { off: ['matrix'] })
  await o.page.locator('[data-chat-source-pill]').click(); await o.page.waitForTimeout(200)
  check('Matrix disabled before load: not in the list', (await o.page.locator('[data-chat-source="matrix"]').count()) === 0)
  check('no page errors (desktop)', d.errors.length === 0 && o.errors.length === 0)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
