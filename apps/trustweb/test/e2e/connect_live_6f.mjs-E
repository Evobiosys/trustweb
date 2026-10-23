/**
 * Wave 6f LIVE acceptance of THE ONE THING: whoever opens my shared link appears in MY web too, also when my app was CLOSED while they
 * added me. Against a DEPLOYED app, its real connect service and the real relay. Fresh headless phones (390x844), throwaway names only.
 *   1  Phone A ("TW6f Live A <hex>") opens Meet and waits for a REAL connect code (https://<origin>/c/<22 chars>), then CLOSES its page.
 *   2  Phone B ("TW6f Live B <hex>") adds A while A is closed: on A's host it opens A's /c/ link and presses "Add to my web"; on another
 *      host (TW_LIVE_B_HOST) it pastes A's link into "Add someone". B writes one chat line to A.
 *   3  A opens TrustWeb again (a new tab of the same profile): B is in A's web within 40 s, linked to the connection, and B's chat line is there;
 *      B's card of A gets A's name and B's phone marks A as heard from (no more re-sent acks).
 *   4  (A's host only) A keeps the code on the Meet page while phones C and D open it one after the other: two cards in A's web, not one.
 * WARNING: this runs on PRODUCTION. It creates throwaway TrustWeb instances and one connect code per run (codes expire on the server, as for
 * any phone). No username is claimed. Never point it at anything but the hosts below.
 * TW_LIVE_HOST (A) and TW_LIVE_B_HOST (B, default = A) are each one of  https://app.idea2.site/trustweb  |  https://app.trustweb.one
 * Runs back to back from one address meet the connect service's budget (6 POST /connect + /name per minute, 30 per hour): space them
 * by a minute or more; a missing code then reads as FAIL in step 1 or 4 (the app itself falls back to the long link).
 * TW_SCREENS=<dir> (default W6/screens/live-6f/). Headless only. Exit 0 all PASS, 1 any FAIL, 2 bad setup.
 *   cd apps/demo && TW_LIVE_HOST=https://app.trustweb.one PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_live_6f.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, record, startPhone } from './swiss_harness.mjs'

const ALLOWED_HOSTS = ['https://app.idea2.site/trustweb', 'https://app.trustweb.one']
const DEFAULT_SCREENS = '/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6f/'
const VIEWPORT = { width: 390, height: 844 }
/** services/trustweb-backup CONNECT_PER_MINUTE is 6 per address: runs and parts that each mint a code are spaced by this. */
const BUDGET_PAUSE_MS = 65_000
const HOST = (process.env.TW_LIVE_HOST ?? '').replace(/\/+$/, '')
const B_HOST = (process.env.TW_LIVE_B_HOST ?? HOST).replace(/\/+$/, '')
const SCREENS = process.env.TW_SCREENS || DEFAULT_SCREENS
const c = checker()
const ok = c.ok
const errors = []

if (!ALLOWED_HOSTS.includes(HOST) || !ALLOWED_HOSTS.includes(B_HOST)) {
  console.error(`connect_live_6f.mjs needs TW_LIVE_HOST (and optionally TW_LIVE_B_HOST), each one of: ${ALLOWED_HOSTS.join(' | ')}`)
  process.exit(2)
}
const CROSS = B_HOST !== HOST
const ORIGIN = new URL(HOST).origin
const SLUG = new URL(HOST).hostname + (CROSS ? '_to_' + new URL(B_HOST).hostname : '')
const TAG = randomBytes(2).toString('hex')
const NAME = (who) => `TW6f Live ${who} ${TAG}`
const LINE = `hello from B while you were away ${TAG}`

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 300)) }
  return null
}
const webNames = (page) => page.locator('.node:not(.you)').allInnerTexts().then((xs) => xs.map((x) => x.trim()))
const inWeb = async (page, name) => (await webNames(page)).some((x) => x.includes(name))
const hasChat = async (page, text) => JSON.stringify((await record(page)).chats ?? {}).includes(text)

async function shot(page, what) {
  if (!page || page.isClosed()) return
  try { await page.screenshot({ path: path.join(SCREENS, `live6f_${SLUG}_${what}.png`) }) } catch { /* a missing picture never fails the run */ }
}

async function phone(browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  const page = await tab(ctx)
  return { ctx, page }
}

async function tab(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return page
}

/** Meet with a REAL code from the server: returns { code link, long link }, or null. */
async function realCode(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
  const link = await until(async () => { const p = await page.getAttribute('.qrwrap', 'data-payload'); return p && p.startsWith(ORIGIN + '/c/') ? p : null }, 25_000)
  const long = (await record(page)).connectCode?.url ?? null
  return link && long ? { link, long } : null
}

async function addByLink(page, link) {
  await page.goto(link)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 30_000 })
  await page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => {})
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 15_000 })
}

async function addByPaste(page, long) {
  await page.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
  await page.locator('.sheet.on [data-add-code]').fill(long)
  await page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => page.getByRole('button', { name: /^Friend/ }).first().click())
  await page.locator('.sheet.on [data-add-person]').click()
  await page.locator('.sheet.on [data-chat-open]').waitFor({ timeout: 30_000 })
}

async function writeLine(page) {
  await page.locator('.sheet.on [data-chat-open]').click()
  await page.getByPlaceholder('Write a message').fill(LINE)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  return until(async () => JSON.stringify((await record(page)).chats ?? {}).includes('"delivered"'), 20_000)
}

async function offlineAdd(browser) {
  const a = await phone(browser)
  await startPhone(a.page, HOST + '/', NAME('A'))
  const code = await realCode(a.page)
  ok('1: A has a REAL code from the server (QR = https://<origin>/c/<22 chars>)', Boolean(code), String(code?.link))
  if (!code) return
  await shot(a.page, '1_a_code')
  await a.page.close()
  ok('1: A\'s page is CLOSED from here on', a.page.isClosed())

  const b = await phone(browser)
  await startPhone(b.page, B_HOST + '/', NAME('B'))
  if (CROSS) await addByPaste(b.page, code.long)
  else await addByLink(b.page, code.link)
  const rb = await record(b.page)
  ok(`2: B (${CROSS ? 'another host, pasted link' : 'same host, opened the /c/ link'}) has A in his web`, rb.people.some((p) => p.peerId) && rb.peers.length === 1)
  ok('2: B wrote a chat line to A (the relay accepted it)', Boolean(await writeLine(b.page)))
  await shot(b.page, '2_b_added')
  await b.page.waitForTimeout(2000)

  const back = await tab(a.ctx)
  await back.goto(HOST + '/')
  await back.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  const seen = await until(() => inWeb(back, NAME('B')), 40_000)
  ok('3: A reopens: B is in A\'s web', Boolean(seen), JSON.stringify(await webNames(back)))
  const ra = await record(back)
  const peerB = ra.peers.find((p) => p.displayName === NAME('B'))
  ok('3: as a card linked to B\'s connection', Boolean(peerB) && ra.people.some((p) => p.peerId === peerB.id))
  ok('3: B\'s chat line is there', Boolean(await until(() => hasChat(back, LINE), 30_000)))
  await shot(back, '3_a_reopened_sees_b')
  ok('3: B\'s card of A carries A\'s name (A\'s hello came back)', Boolean(await until(async () => (await record(b.page)).people.some((p) => p.name === NAME('A')), 30_000)))
  ok('3: B\'s phone marks A as heard from (no more re-sent acks)', Boolean(await until(async () => (await record(b.page)).peers[0]?.heardAt, 30_000)))
  await a.ctx.close(); await b.ctx.close()
}

async function meetTwoPeople(browser) {
  const a = await phone(browser)
  await startPhone(a.page, HOST + '/', NAME('M'))
  const code = await realCode(a.page)
  ok('4: A has a real code and keeps it on the Meet page', Boolean(code))
  if (!code) return
  for (const who of ['C', 'D']) {
    const x = await phone(browser)
    await startPhone(x.page, HOST + '/', NAME(who))
    await addByLink(x.page, code.link)
    await until(async () => (await record(a.page)).peers.some((p) => p.displayName === NAME(who)), 30_000)
    await x.ctx.close()
  }
  const r = await record(a.page)
  const names = r.people.map((p) => p.name)
  ok('4: two people who connect one after the other while the code is on screen are TWO cards', names.includes(NAME('C')) && names.includes(NAME('D')), JSON.stringify(names))
  ok('4: each card on its own connection', new Set(r.people.map((p) => p.peerId).filter(Boolean)).size === 2)
  await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await shot(a.page, '4_two_cards')
  await a.ctx.close()
}

async function main() {
  mkdirSync(SCREENS, { recursive: true })
  console.log(`connect_live_6f: A on ${HOST}, B on ${B_HOST}, tag ${TAG}`)
  const browser = await launch()
  try {
    await offlineAdd(browser)
    // The connect service allows 6 POST /connect + /name per network address per minute: one minute between the two codes.
    if (!CROSS) { await new Promise((r) => setTimeout(r, BUDGET_PAUSE_MS)); await meetTwoPeople(browser) }
  } catch (e) {
    ok('ran to the end', false, String(e?.message ?? e).split('\n')[0])
  } finally {
    await browser.close()
  }
  ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(c.failures === 0 ? `\nCONNECT LIVE 6f (${SLUG}): ALL ${c.passes} PASS` : `\nCONNECT LIVE 6f (${SLUG}): ${c.failures} FAILED, ${c.passes} PASS`)
  process.exit(c.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
