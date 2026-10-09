/**
 * Wave 6i LIVE acceptance of THE ONE THING: an ask and its answer stay one conversation. Against a DEPLOYED app, its real connect
 * service and the real relay. Fresh headless phones (390x844), throwaway names only.
 *   1  Phone A ("TW6i Live A <hex>") has two lines: a spare room (anyone in her web may ask) and a cargo bike (friends only). She shows a
 *      REAL connect code; phone B opens it and adds A (on A's side B is an acquaintance).
 *   2  B asks for a spare room; A shares, then "Message B" from the prompt and writes "I do": A's chat shows the question above it; B gets
 *      "New message from A" above his rings, taps the underlined "open": his chat shows the question above "I do".
 *   3  B asks for a cargo bike: nothing for him (a friends-only line); A sees only the quiet card. A makes B a friend: B's phone sends
 *      that ask again, A sees "Earlier ask from B", shares; B gets "A answered your earlier ask" with her line.
 *   4  A moves B back to acquaintance: for 15 s no POST /relay/send leaves either phone.
 *   5  A records a memo about B and adds a line on Review: it starts as "Close friends".
 * WARNING: this runs on PRODUCTION. It creates throwaway TrustWeb instances and one connect code per run (codes expire on the server).
 * The asks go only to the throwaway A (fresh phones are connected to nothing else). Never point it at anything but the hosts below.
 * TW_LIVE_HOST: https://app.idea2.site/trustweb | https://app.trustweb.one. About 8 minutes per run; space runs by a minute.
 * TW_SCREENS=<dir> (default W6/screens/live-6i/). Headless only. Exit 0 all PASS, 1 any FAIL, 2 bad setup.
 *   cd apps/demo && TW_LIVE_HOST=https://app.trustweb.one PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/conversation_live_6i.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, record, startPhone } from './swiss_harness.mjs'

const ALLOWED_HOSTS = ['https://app.idea2.site/trustweb', 'https://app.trustweb.one']
const DEFAULT_SCREENS = '/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6i/'
const VIEWPORT = { width: 390, height: 844 }
const HOST = (process.env.TW_LIVE_HOST ?? '').replace(/\/+$/, '')
const SCREENS = process.env.TW_SCREENS || DEFAULT_SCREENS
const c = checker()
const ok = c.ok
const errors = []

if (!ALLOWED_HOSTS.includes(HOST)) {
  console.error(`conversation_live_6i.mjs needs TW_LIVE_HOST, one of: ${ALLOWED_HOSTS.join(' | ')}`)
  process.exit(2)
}
const ORIGIN = new URL(HOST).origin
const SLUG = new URL(HOST).hostname
const TAG = randomBytes(2).toString('hex')
const NAME = (who) => `TW6i Live ${who} ${TAG}`
const ROOM = `Spare room in town ${TAG}`
const BIKE = `Cargo bike to lend ${TAG}`

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 300)) }
  return null
}
const inWeb = async (page, name) => (await page.locator('.node:not(.you)').allInnerTexts()).some((x) => x.includes(name))
const bodyText = (page) => page.locator('body').innerText()
const overlayText = (page) => page.evaluate(() => document.querySelector('.overlay.on')?.innerText ?? '')
const chatRe = (page) => page.locator('.sheet.on .chat-msg .chat-re').allInnerTexts()

async function shot(page, what) {
  if (!page || page.isClosed()) return
  try { await page.screenshot({ path: path.join(SCREENS, `live6i_${SLUG}_${what}.png`) }) } catch { /* a missing picture never fails the run */ }
}

async function phone(browser, sends) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, permissions: ['microphone'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/relay/send')) sends.n++ })
  return { ctx, page, sends }
}

async function realCode(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
  return until(async () => { const p = await page.getAttribute('.qrwrap', 'data-payload'); return p && p.startsWith(ORIGIN + '/c/') ? p : null }, 25_000)
}

async function addByLink(page, link) {
  await page.goto(link)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 30_000 })
  await page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => {})
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 15_000 })
}

async function addResource(page, text) {
  await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  await page.getByPlaceholder(/Motorbike/).fill(text)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.locator('.inv', { hasText: text }).waitFor({ timeout: 5000 })
}

async function closeSheets(page) {
  await page.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {})
}

async function toWeb(page) {
  await closeSheets(page)
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
}

async function ask(page, text) {
  await toWeb(page)
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Call into your web', exact: true }).click()
  await page.locator('.query-dock textarea').fill(text)
  await page.getByRole('button', { name: 'Call into my web' }).click()
}

const outcome = (page) => until(async () => { const x = await page.locator('.card.asked .outcome').first().innerText(); return x || null }, 200_000)

async function closeDock(page) {
  await page.locator('.query-dock .dock-head .x').click({ timeout: 2000 }).catch(() => {})
}

async function setRing(page, name, label) {
  await toWeb(page)
  await page.locator('.node', { hasText: name }).first().click()
  await page.locator('.sheet.on').getByRole('button', { name: 'Change ring' }).click()
  await page.locator('.sheet.on .radio').filter({ has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) }).click()
  await page.locator('.sheet.on .meta', { hasText: new RegExp(`^${label} ·`) }).first().waitFor({ timeout: 5_000 })
  await closeSheets(page)
}

async function run(browser) {
  const a = await phone(browser, { n: 0 })
  await startPhone(a.page, HOST + '/', NAME('A'))
  await addResource(a.page, ROOM)
  await addResource(a.page, BIKE)
  // the bike: friends only (the item's own "Who can ask")
  await a.page.evaluate((bike) => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.inventory.find((i) => i.text === bike).audience = 'friends'
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  }, BIKE)
  await a.page.reload()
  await a.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  const link = await realCode(a.page)
  ok('1: A has a REAL code from the server', Boolean(link), String(link))
  if (!link) return
  await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})
  const b = await phone(browser, { n: 0 })
  await startPhone(b.page, HOST + '/', NAME('B'))
  await addByLink(b.page, link)
  await closeSheets(b.page)
  ok('1: B is connected to A, and A sees B in her web', !!(await until(() => inWeb(a.page, NAME('B')), 40_000)))
  ok('1: on A\'s side B is an acquaintance', (await record(a.page)).peers.find((p) => p.displayName === NAME('B'))?.ring === 'acquaintance')

  // 2: the reply carries the question
  await ask(b.page, 'does anyone have a spare room?')
  ok('2: the prompt reaches A', !!(await until(async () => (await overlayText(a.page)).includes(NAME('B')), 40_000)))
  await a.page.getByRole('button', { name: 'Share these' }).click()
  await a.page.locator('.overlay.on [data-ask-message]').click()
  await a.page.locator('.sheet.on [data-chat-context]').waitFor({ timeout: 10_000 })
  await a.page.getByPlaceholder('Write a message').fill(`I do ${TAG}`)
  await a.page.getByRole('button', { name: 'Send', exact: true }).click()
  await a.page.locator('.sheet.on .chat-msg.chat-out', { hasText: `I do ${TAG}` }).waitFor({ timeout: 15_000 })
  const aRe = await chatRe(a.page)
  ok('2: A\'s chat shows the question above "I do"', aRe.length === 1 && /Re: “does anyone have a spare room\?”/.test(aRe[0]), JSON.stringify(aRe))
  await shot(a.page, '2_a_reply_with_question')
  const o2 = await outcome(b.page)
  ok('2: B gets A\'s line at the fixed moment', !!o2 && o2.includes(ROOM))
  await closeDock(b.page)
  const card = b.page.locator('[data-stack-card="message"]')
  await card.waitFor({ timeout: 30_000 })
  ok('2: B sees "New message from A" above his rings, "open" underlined on the right', (await card.innerText()).includes(`New message from ${NAME('A')}`)
    && await card.locator('[data-card-open]').evaluate((n) => getComputedStyle(n).textDecorationLine.includes('underline')))
  await shot(b.page, '2_b_new_message_card')
  await card.locator('[data-card-open]').click()
  await b.page.locator('.sheet.on .chat-msg.chat-in', { hasText: `I do ${TAG}` }).waitFor({ timeout: 10_000 })
  const bRe = await chatRe(b.page)
  ok('2: "open" opens B\'s chat; it shows the question above "I do"', bRe.length === 1 && /Re: “does anyone have a spare room\?”/.test(bRe[0]), JSON.stringify(bRe))
  await shot(b.page, '2_b_reply_with_question')
  await closeSheets(b.page)
  await closeSheets(a.page)

  // 3: tightening brings back the earlier ask
  await ask(b.page, 'cargo bike for a day')
  const quiet = await until(async () => { const x = await bodyText(a.page); return x.includes(`${NAME('B')} asked about something`) && /cargo bike/.test(x) ? x : null }, 40_000)
  ok('3: a friends-only line and B an acquaintance: A sees only the quiet card', !!quiet && !(await overlayText(a.page)))
  const o3 = await outcome(b.page)
  ok('3: B sees "No match"', !!o3 && /No match/.test(o3))
  await closeDock(b.page)
  await setRing(a.page, NAME('B'), 'Friend')
  const earlier = await until(async () => { const x = await overlayText(a.page); return /Earlier ask from/i.test(x) && /cargo bike/.test(x) ? x : null }, 60_000)
  ok('3: A makes B a friend: his earlier ask comes back as "Earlier ask from B (<time>)"', !!earlier)
  await shot(a.page, '3_a_earlier_ask')
  await a.page.getByRole('button', { name: 'Share these' }).click()
  await a.page.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  const got = await until(async () => { const x = await bodyText(b.page); return x.includes(`${NAME('A')} answered your earlier ask`) && x.includes(BIKE) }, 200_000)
  ok('3: B gets "A answered your earlier ask" with her line, at the moment', !!got)
  await shot(b.page, '3_b_answered_earlier')

  // 4: loosening sends nothing
  await new Promise((r) => setTimeout(r, 5_000))
  const before = { a: a.sends.n, b: b.sends.n }
  await setRing(a.page, NAME('B'), 'Acquaintance')
  await new Promise((r) => setTimeout(r, 15_000))
  ok('4: A moves B back to acquaintance: nothing leaves her phone', a.sends.n === before.a, `${before.a} -> ${a.sends.n}`)
  ok('4: nor his', b.sends.n === before.b, `${before.b} -> ${b.sends.n}`)

  // 5: a Record line starts as Close friends
  await toWeb(a.page)
  await a.page.locator('nav.tabs .tab-record').click()
  await a.page.locator('.rec-circle').click()
  await a.page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await a.page.waitForTimeout(1500)
  await a.page.getByRole('button', { name: 'Send' }).click()
  await a.page.getByRole('heading', { name: 'Who was this about?' }).waitFor({ timeout: 5_000 })
  await a.page.locator('.sheet .chip', { hasText: NAME('B') }).click()
  await a.page.getByRole('heading', { name: /Notes about/ }).waitFor({ timeout: 10_000 })
  await a.page.getByRole('button', { name: '+ Add a line' }).click()
  await a.page.locator('.line-text').last().fill(`Knows a bike mechanic ${TAG}`)
  await a.page.getByRole('button', { name: 'Looks right' }).click()
  const pill = await a.page.locator('.aud-row', { hasText: `Knows a bike mechanic ${TAG}` }).locator('.aud').innerText()
  ok('5: a line added on Review starts as "Close friends"', pill === 'Close friends', pill)
  await shot(a.page, '5_a_record_line_close')
  await a.ctx.close(); await b.ctx.close()
}

async function main() {
  mkdirSync(SCREENS, { recursive: true })
  console.log(`conversation_live_6i: on ${HOST}, tag ${TAG}`)
  const browser = await launch()
  try { await run(browser) } catch (e) { ok('ran to the end', false, String(e?.message ?? e).split('\n')[0]) } finally { await browser.close() }
  ok('no page error', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(c.failures === 0 ? `\nCONVERSATION LIVE 6i (${SLUG}): ALL PASS` : `\nCONVERSATION LIVE 6i (${SLUG}): ${c.failures} FAILED`)
  process.exit(c.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
