// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat (headless, stock dev server, synthetic record): the event page's chat button opens the event's ONE shared thread
 * (sheet [data-event-chat]): members line, the stored items (a join notice, Ben's message with his name, mine on the right), a message typed and
 * sent lands in the same thread (waiting while Ben's device is unreachable), Leave this chat hides the composer and stores the leave; no document
 * scroll. 360x780 and 1280x900.
 * PORT=5462 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node event_group_chat.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5462}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const people = [P('b', 'Ben Gruber', { events: ['e1'], peerId: 'peer-b' }), P('c', 'Cleo Maier', { events: ['e1'] })]
const EV = { id: 'e1', name: 'Winter OG', from: day(3), where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna Host'] }
const eventChats = { e1: { unread: 1, items: [
  { m: 'a1', k: 'join', by: 'Ben Gruber', ts: 1_000, at: 1_000 },
  { m: 'a2', k: 'msg', by: 'Ben Gruber', ts: 2_000, at: 2_000, text: 'Who brings tea?' },
] } }
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [{ id: 'peer-b', displayName: 'Ben' }], log: [], inventory: [], people, events: [EV], eventChats }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); sessionStorage.clear() }, JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
    if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
    await page.waitForTimeout(200)
    await page.locator('[data-event="e1"]').click(); await page.waitForTimeout(400)
    const btn = page.locator('[data-event-message-all], [data-event-chat-open]').first()
    check(`${w}: the event page has the chat button`, (await btn.count()) === 1)
    await btn.click(); await page.waitForTimeout(400)
    const sheet = page.locator('[data-event-chat="e1"]')
    check(`${w}: it opens the event's shared thread`, (await sheet.count()) === 1 && /Event chat/.test(await sheet.locator('h3').textContent()))
    const members = await sheet.locator('[data-event-chat-members]').textContent()
    check(`${w}: members: the host, the people joining, me`, ['Hanna Host', 'Ben Gruber', 'Cleo Maier', 'Ana'].every((n) => members.includes(n)), members)
    const kinds = await sheet.locator('[data-event-chat-item]').evaluateAll((n) => n.map((x) => x.dataset.eventChatItem))
    check(`${w}: the stored items, oldest first (join, message)`, JSON.stringify(kinds) === '["join","msg"]', JSON.stringify(kinds))
    check(`${w}: Ben's message carries his name`, (await sheet.locator('.chat-in .chat-by').first().textContent()) === 'Ben Gruber')
    check(`${w}: opening marks it read`, (await rec(page)).eventChats.e1.unread === 0)
    await sheet.locator('[data-event-chat-text]').fill('I bring the tea')
    await sheet.locator('[data-event-chat-send]').click(); await page.waitForTimeout(800)
    const r = await rec(page)
    const mine = r.eventChats.e1.items.find((i) => i.mine)
    check(`${w}: my message is in the same thread (stored, mine)`, mine?.text === 'I bring the tea' && mine.k === 'msg', JSON.stringify(mine))
    check(`${w}: it shows on the right, the composer is empty again`, (await sheet.locator('.chat-out .chat-text').last().textContent()) === 'I bring the tea' && (await sheet.locator('[data-event-chat-text]').inputValue()) === '')
    const doc = await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1)
    check(`${w}: no document scroll`, doc)
    await page.screenshot({ path: `${SHOTS}/event-group-chat-${w}.png` })
    await sheet.locator('[data-event-chat-leave="leave"]').click(); await page.waitForTimeout(500)
    const r2 = await rec(page)
    check(`${w}: Leave stores the leave and hides the composer`, r2.eventChats.e1.mem?.me?.on === false && (await sheet.locator('.ec-compose').isHidden()) && (await sheet.locator('[data-event-chat-leave="rejoin"]').count()) === 1)
    check(`${w}: the leave notice shows in the thread`, (await sheet.locator('[data-event-chat-item="leave"]').count()) === 1)
    if (w === 360) await page.screenshot({ path: `${SHOTS}/event-group-chat-left-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
