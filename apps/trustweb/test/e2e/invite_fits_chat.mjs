// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave47 invite-fits-chat (headless, stock dev server, synthetic record). 2026-11-25, a production event page: "Send invite" answered "No connection
 * right now. Your message waits here..." while online: the invite text (the event link) was longer than one chat message, nothing was queued, and every
 * refusal was reported as a missing connection. Proven here on the event page: an event whose whole link cannot fit gets its invite into the chat anyway
 * (trimmed link), and one that can never fit says so in its own words. 360x780. PORT=5475 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node invite_fits_chat.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5475}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const ev = (id, name, extra) => ({ id, name, from: day(5), where: 'Alm', createdAt: 1, attended: true, people: ['p1'], ...extra })
const rec = JSON.stringify({
  v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p1', name: 'Ben Moser', context: '', ring: 'friend', metAt: 1, lines: [], peerId: 'peer1' }],
  events: [ev('long', 'Forum', { conditions: 'Bring a dish. '.repeat(34).trim(), themes: ['trust', 'commons'] }), ev('huge', 'Gathering', { where: 'A very long way to describe a place. '.repeat(17).trim() })],
})
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(900)
  await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, rec)
  const open = async (id) => {
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
    await page.waitForTimeout(200)
    await page.locator(`[data-event="${id}"]`).click(); await page.waitForTimeout(400)
    await page.locator('[data-cal-send="p1"]').scrollIntoViewIfNeeded()
  }

  await open('long')
  await page.locator('[data-cal-send="p1"]').click(); await page.waitForTimeout(800)
  const said = ((await page.locator('.toast').textContent()) ?? '').trim()
  console.log(`      notice: "${said}"`)
  check('long event: the notice says the invite is in the chat', /Invite is in your chat with them/.test(said), said)
  check('long event: the notice does not blame the connection', !/No connection/.test(said), said)
  const thread = (await record(page)).chats?.peer1?.messages ?? []
  const text = thread[0]?.text ?? ''
  console.log(`      invite text: ${text.length} characters (one chat message holds 500)`)
  check('long event: one message is in my chat with them, within the chat bound', thread.length === 1 && text.length > 0 && text.length <= 500, `${thread.length} messages, ${text.length} characters`)
  check('long event: it names the event and carries its link', text.startsWith('You are invited: Forum\n') && /#evc?=/.test(text), text.slice(0, 80))
  check('long event: the row says so too', ((await page.locator('[data-cal-invitee="p1"]').textContent()) ?? '').includes('Invite is in your chat with them'))
  await page.screenshot({ path: `${SHOTS}/invite-fits-chat-sent-360.png` })

  await open('huge')
  await page.locator('[data-cal-send="p1"]').click(); await page.waitForTimeout(800)
  const said2 = ((await page.locator('.toast').textContent()) ?? '').trim()
  console.log(`      notice: "${said2}"`)
  check('an event that can never fit: the notice says the link is too long and how to send it', /too long for one chat message/.test(said2) && /Share event link/.test(said2), said2)
  check('an event that can never fit: the notice does not blame the connection', !/No connection/.test(said2), said2)
  check('an event that can never fit: nothing new is in the chat', ((await record(page)).chats?.peer1?.messages ?? []).length === 1)
  await page.screenshot({ path: `${SHOTS}/invite-fits-chat-too-long-360.png` })
  check('no page errors', errors.length === 0, errors.join('|'))
  await ctx.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
