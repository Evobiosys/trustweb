/**
 * Wave 6b LIVE acceptance of the connect code, the username and the scan that lands on the person, against a DEPLOYED app and its real
 * connect service and relay. Two fresh headless phones (390x844), throwaway names only, no phone number anywhere.
 *   1  Phone A makes an account ("TW6b Live A <4 hex>"), saves a fake Signal USERNAME link (https://signal.me/#eu/<43 random chars>,
 *      shared on connect), opens Meet and waits (up to 20 s) for a REAL connect code: the QR/link shows https://<origin>/c/<22 chars>.
 *      Only the long link on show means the server did not answer: that is a FAIL, said plainly.
 *   2  A claims the throwaway username "tw6b-<8 hex>" in Meet > Advanced. Plain HTTP (redirects not followed):
 *      GET <origin>/who/<name> is a 302 to <origin>/c/<code>, and GET <origin>/c/<code> is a 302 to the same origin with ?connect=.
 *   3  Phone B (a second account, "TW6b Live B <4 hex>") opens <origin>/c/<code>: the add sheet names A (it replaces the placeholder
 *      within 20 s), "Add to my web" opens A's card, and "Message on Signal" (or Molly) shows A's link (the contact text travels over
 *      the real relay, up to 30 s): its href starts with https://signal.me/#eu/ and equals A's fake link.
 *   3b CROSS-HOST (review 6b; on by default when TW_LIVE_HOST is app.idea2.site, TW_LIVE_CROSS=0 skips it): phone C on https://app.trustweb.one
 *      types "@<the username>" on the add sheet and must get A added and connected: the server's /c/ lands the lookup on .one, and the
 *      app accepts A's idea2 relay (one shared relay). This is the path of a new person on the canonical host typing a name.
 *   4  ALWAYS, in a finally block (also after a FAIL, an error or a timeout): the username is released again (A's "Release" button,
 *      else a POST /name "" from A's page using the record the app keeps there), then checked with GET /who/<name> (404 expected).
 *      The secret is never printed. When the release cannot be done or checked, a WARN names the username so it can be released by hand.
 *
 * WARNING: this runs on PRODUCTION. It creates two throwaway TrustWeb instances, one connect code on the live connect service and one
 * throwaway username, and releases the username at the end. The instances and the code stay behind (codes expire on the server, as for
 * any phone). Never point it at anything but the three hosts below.
 *
 * TW_LIVE_HOST (required) is one of  https://app.idea2.site/trustweb  |  https://app.trustweb.one  |  https://app.trustintheweb.org
 * (a trailing slash is ignored). app.trustintheweb.org pages now 301 to app.trustweb.one: the final page origin is then
 * app.trustweb.one, and the connect paths (/connect, /c/*, /name, /who/*) are on that ORIGIN root, never under /trustweb/.
 * TW_SCREENS=<dir> saves live_connect_<host>_<what>.png (default
 * /Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6b/). Headless only. Exit 0 all PASS, 1 any FAIL, 2 bad setup.
 *   cd apps/demo && TW_LIVE_HOST=https://app.idea2.site/trustweb PLAYWRIGHT_PACKAGE=/Users/personal/Documents/SingularStructure/code/other/signal-orbit/node_modules/playwright-core/index.js ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_live.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone } from './swiss_harness.mjs'
import { saveChannel } from '../helpers/share_box.mjs'

const ALLOWED_HOSTS = ['https://app.idea2.site/trustweb', 'https://app.trustweb.one', 'https://app.trustintheweb.org']
const MOVED_TO = { 'https://app.trustintheweb.org': 'https://app.trustweb.one' }
const DEFAULT_SCREENS = '/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6b/'
const VIEWPORT = { width: 390, height: 844 }
const CODE_RE = /^[A-Za-z0-9_-]{22}$/
const SIGNAL_PREFIX = 'https://signal.me/#eu/'
const SIGNAL_PLACEHOLDER = 'Signal username link (best) or phone number (+43...)'
const CODE_WAIT_MS = 20_000
const NAME_WAIT_MS = 20_000
const CONTACT_WAIT_MS = 30_000
const CROSS_HOST = 'https://app.trustweb.one'

const HOST = (process.env.TW_LIVE_HOST ?? '').replace(/\/+$/, '')
const SCREENS = process.env.TW_SCREENS || DEFAULT_SCREENS
const c = checker()
const ok = c.ok
const errors = []

if (!HOST || !ALLOWED_HOSTS.includes(HOST)) {
  console.error(`connect_live.mjs needs TW_LIVE_HOST, one of: ${ALLOWED_HOSTS.join(' | ')}  (got: ${HOST || 'nothing'})`)
  process.exit(2)
}
const HOST_SLUG = new URL(HOST).hostname
const APP_URL = HOST + '/'

const hex = (bytes) => randomBytes(bytes).toString('hex')
const TAG = hex(2)
const NAME_A = `TW6b Live A ${TAG}`
const NAME_B = `TW6b Live B ${TAG}`
const USERNAME = `tw6b-${hex(4)}`
const SIGNAL_LINK = `${SIGNAL_PREFIX}${randomBytes(32).toString('base64url')}`

/** Everything the finally block needs, filled in as the run goes. */
const run = { origin: '', code: '', claimAttempted: false, a: null, b: null }

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
const bodyText = (page, selector) => page.locator(selector).innerText().catch(() => '')

async function shot(page, what) {
  if (!page || page.isClosed()) return
  try { await page.screenshot({ path: path.join(SCREENS, `live_connect_${HOST_SLUG}_${what}.png`) }) } catch { /* a missing picture never fails the run */ }
}

/** One plain GET, redirects NOT followed; the Location is resolved against the url. Never throws. */
async function plainGet(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    await res.body?.cancel().catch(() => {})
    const loc = res.headers.get('location')
    return { status: res.status, location: loc ? new URL(loc, url).href : '' }
  } catch (e) {
    return { status: 0, location: '', error: String(e?.message ?? e) }
  }
}

// ---- step 1: phone A, Signal link, a real code --------------------------------------------------------

async function openMeet(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
}

/** Saves the fake username link and makes sure the "share when we connect" tick is on. */
async function saveSignalLink(page) {
  await saveChannel(page, 'signal', SIGNAL_LINK)
  const tick = page.locator('.meet-page [data-share-tick="signal"]').first()
  if ((await tick.count()) > 0 && !(await tick.isChecked())) await tick.check()
  return (await tick.count()) === 0 || (await tick.isChecked())
}

/** The code in the QR payload when it is https://<origin>/c/<22 chars>, else null. */
async function codeOnShow(page, origin) {
  const p = await payload(page)
  if (!p || !p.startsWith(`${origin}/c/`)) return null
  const code = p.slice(origin.length + 3)
  return CODE_RE.test(code) ? code : null
}

/** Says why no code came: the long link on show means the server did not answer in time. */
async function explainNoCode(page) {
  const p = (await payload(page)) ?? ''
  const status = (await bodyText(page, '[data-code-status]')).trim()
  const rec = await record(page).catch(() => null)
  return `${p.includes('connect=') ? 'only the long link is on show (Long link, until the server answers)' : 'QR payload is not a connect link'}; status line: "${status}"; connectCode kept: ${Boolean(rec?.connectCode)}`
}

async function stepPhoneA(browser) {
  console.log(`\n[1] phone A "${NAME_A}": account, Signal username link, real connect code`)
  const a = await newPhone(browser, errors, { viewport: VIEWPORT })
  run.a = a
  await startPhone(a, APP_URL, NAME_A)
  run.origin = new URL(a.url()).origin
  const expected = MOVED_TO[HOST] ?? new URL(HOST).origin
  if (MOVED_TO[HOST]) console.log(`  [note] ${HOST} pages 301 to ${MOVED_TO[HOST]}; the connect paths are on that origin root`)
  ok(`final page origin is ${expected}`, run.origin === expected, run.origin)
  await openMeet(a)
  ok('A saved a Signal username link and it is ticked to be shared on connect', await saveSignalLink(a))
  const code = await until(() => codeOnShow(a, run.origin), CODE_WAIT_MS)
  if (!code) {
    ok(`A's Meet shows https://${new URL(run.origin).host}/c/<22 chars> within ${CODE_WAIT_MS / 1000} s`, false, await explainNoCode(a))
    await shot(a, '01_a_no_code')
    return false
  }
  run.code = code
  ok(`A's QR carries ${run.origin}/c/<22 chars>`, true)
  ok('A\'s link line shows the same code link and the "until the server answers" status is gone',
    (await bodyText(a, '[data-link="code"]')).trim() === `${run.origin}/c/${code}` && (await bodyText(a, '[data-code-status]')).trim() === '')
  ok('A\'s phone keeps the code (the secret is not printed)', (await record(a)).connectCode?.code === code)
  await shot(a, '01_a_meet_code')
  return true
}

// ---- step 2: the username and the two redirects --------------------------------------------------------

async function openAdvanced(page) {
  if (!(await page.locator('.meet-page').isVisible().catch(() => false))) await openMeet(page)
  if (await page.locator('.advanced-panel').isHidden()) await page.locator('[data-act="advanced"]').click()
  await page.locator('[data-username]').waitFor({ timeout: 15_000 })
}

async function claimUsername(page) {
  await openAdvanced(page)
  await page.locator('[data-username]').fill(USERNAME)
  run.claimAttempted = true // set before the click: the server may have taken the name even if the page then fails
  await page.locator('[data-act="claim-name"]').click()
  return until(async () => { const t = await bodyText(page, '[data-username-status]'); return t.includes(`@${USERNAME} is yours`) ? t : null }, 15_000)
}

async function checkRedirects() {
  const who = await plainGet(`${run.origin}/who/${USERNAME}`)
  ok(`GET /who/${USERNAME} is a 302 to ${run.origin}/c/<code>`, who.status === 302 && who.location === `${run.origin}/c/${run.code}`, `${who.status} ${who.location}${who.error ? ' ' + who.error : ''}`)
  const open = await plainGet(`${run.origin}/c/${run.code}`)
  let sameOrigin = false
  let hasConnect = false
  try { const u = new URL(open.location); sameOrigin = u.origin === run.origin; hasConnect = u.searchParams.has('connect') } catch { /* no location */ }
  ok('GET /c/<code> is a 302 to a URL on the same origin with ?connect=', open.status === 302 && sameOrigin && hasConnect, `${open.status} ${open.location.split('?')[0]}${open.error ? ' ' + open.error : ''}`)
}

async function stepUsername() {
  console.log(`\n[2] A claims "${USERNAME}" (Meet > Advanced), then the two redirects`)
  const said = await claimUsername(run.a)
  ok(`A claims @${USERNAME}: the page says it is hers`, Boolean(said), (await bodyText(run.a, '[data-username-status]')).trim())
  await shot(run.a, '02_a_username_claimed')
  if (!said) return false
  ok('A\'s record keeps the name next to the code', (await record(run.a)).connectCode?.name === USERNAME)
  await checkRedirects()
  return true
}

// ---- step 3: phone B scans /c/<code> ------------------------------------------------------------------

async function openCodeLinkOnB(b) {
  await b.goto(`${run.origin}/c/${run.code}`)
  await b.locator('.sheet.on [data-connect-add-title]').waitFor({ timeout: 25_000 })
}

async function checkAddSheetNamesA(b) {
  const field = b.locator('.sheet.on [data-connect-add-name]')
  const named = await until(async () => (await field.inputValue()) === NAME_A, NAME_WAIT_MS)
  const title = (await bodyText(b, '.sheet.on [data-connect-add-title]')).trim()
  ok(`B's add sheet names A (the placeholder is replaced within ${NAME_WAIT_MS / 1000} s)`, Boolean(named) && title.includes(NAME_A), `field "${await field.inputValue()}", title "${title}"`)
}

async function checkMessageButton(b) {
  const msg = b.locator('.sheet.on a', { hasText: /Message on Signal/ })
  const href = await until(async () => ((await msg.count()) === 1 ? await msg.getAttribute('href') : null), CONTACT_WAIT_MS)
  if (!href) {
    const none = (await b.locator('[data-no-messenger]').count()) > 0
    ok(`A's card shows a Message on Signal/Molly button within ${CONTACT_WAIT_MS / 1000} s (the contact text over the relay)`, false, none ? 'the card says no link yet' : 'no such button')
    return
  }
  ok('the Message button\'s href starts with https://signal.me/#eu/', href.startsWith(SIGNAL_PREFIX), href.slice(0, 40))
  ok('and equals A\'s fake link', href === SIGNAL_LINK, 'different link')
}

async function stepPhoneB(browser) {
  console.log(`\n[3] phone B "${NAME_B}" opens <origin>/c/<code>, adds A, sees A's Message button`)
  const b = await newPhone(browser, errors, { viewport: VIEWPORT })
  run.b = b
  await startPhone(b, APP_URL, NAME_B)
  await openCodeLinkOnB(b)
  await checkAddSheetNamesA(b)
  await shot(b, '03_b_add_sheet')
  await b.locator('.sheet.on [data-connect-add]').click()
  const card = await b.locator('.sheet.on h3', { hasText: NAME_A }).waitFor({ timeout: 10_000 }).then(() => true, () => false)
  ok('"Add to my web" opens A\'s card', card)
  await checkMessageButton(b)
  await shot(b, '04_b_card_message')
  ok('A holds B as a connection too', Boolean(await until(async () => (await record(run.a)).peers.some((p) => p.displayName === NAME_B), 20_000)))
}

// ---- step 3b: a phone on the canonical host adds A by @name (cross-host) ---------------------------------

async function stepCrossHost(browser) {
  if (run.origin === CROSS_HOST || process.env.TW_LIVE_CROSS === '0') { console.log('\n[3b] cross-host @name: skipped (same host or TW_LIVE_CROSS=0)'); return }
  console.log(`\n[3b] phone C on ${CROSS_HOST} types @${USERNAME}: lookup lands on its own host, A's relay is accepted`)
  const c = await newPhone(browser, errors, { viewport: VIEWPORT })
  await startPhone(c, CROSS_HOST + '/', `TW6b Live C ${TAG}`)
  await c.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
  await c.locator('.sheet.on [data-add-code]').waitFor({ timeout: 10_000 })
  await c.locator('.sheet.on [data-add-code]').fill('@' + USERNAME)
  await c.locator('.sheet.on [data-add-person]').click()
  const card = await c.locator('.sheet.on h3', { hasText: NAME_A }).waitFor({ timeout: 20_000 }).then(() => true, () => false)
  const status = (await bodyText(c, '.sheet.on [data-add-code-status]')).trim()
  ok(`C on ${CROSS_HOST} adds A by @name (A's card opens)`, card, status || 'no card, no status')
  ok('A holds C as a connection (the shared relay carried the ack across hosts)', Boolean(await until(async () => (await record(run.a)).peers.some((p) => p.displayName === `TW6b Live C ${TAG}`), 30_000)))
  await shot(c, '03b_c_cross_host')
}

// ---- step 4: release the username, whatever happened --------------------------------------------------

/** The Release button on A's page; true when the page then says the name is released. */
async function releaseViaUi(page) {
  await openAdvanced(page)
  await page.locator('[data-act="release-name"]').click()
  return Boolean(await until(async () => /released/i.test(await bodyText(page, '[data-username-status]')), 15_000))
}

/** POST /name "" from a page of A's origin with the record the app keeps there. Prints only a status, never the secret. */
async function releaseViaFetch() {
  const { a } = run
  let page = a && !a.isClosed() ? a : null
  if (!page) { page = await a.context().newPage(); await page.goto(APP_URL) }
  return page.evaluate(async () => {
    const rec = JSON.parse(localStorage.getItem('trustweb.v1.me') ?? 'null')?.connectCode
    if (!rec?.code || !rec?.secret) return { status: 'no-record' }
    const res = await fetch(`${location.origin}/name`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', credentials: 'omit',
      body: JSON.stringify({ name: '', code: rec.code, secret: rec.secret }),
    })
    return { status: res.status }
  })
}

const warnByHand = (why) => console.log(`  WARN  username "${USERNAME}" may still be held on ${run.origin || HOST}: ${why}. Release it by hand.`)

async function releaseUsername() {
  if (!run.claimAttempted) { console.log('  [release] no username was claimed, nothing to release'); return }
  console.log(`\n[4] releasing "${USERNAME}"`)
  let viaUi = false
  try { viaUi = Boolean(run.a) && !run.a.isClosed() && (await releaseViaUi(run.a)) } catch (e) { console.log(`  [release] button route failed: ${String(e?.message ?? e).split('\n')[0]}`) }
  if (!viaUi) {
    try {
      const out = await releaseViaFetch()
      console.log(`  [release] direct POST /name "" from A's page answered ${out.status}`)
    } catch (e) { console.log(`  [release] direct route failed: ${String(e?.message ?? e).split('\n')[0]}`) }
  }
  const check = await plainGet(`${run.origin}/who/${USERNAME}`)
  if (check.status === 0) { warnByHand(`could not check (${check.error})`); return }
  ok(`${USERNAME} is released: GET /who/${USERNAME} no longer redirects (404 expected)`, check.status === 404, `${check.status} ${check.location}`)
  if (check.status !== 404) warnByHand(`GET /who/${USERNAME} answered ${check.status}`)
  await shot(run.a, '05_a_released')
}

// ---- main ---------------------------------------------------------------------------------------------

async function flow(browser) {
  if (!(await stepPhoneA(browser))) return
  if (!(await stepUsername())) return
  await stepPhoneB(browser)
  await stepCrossHost(browser)
}

async function main() {
  mkdirSync(SCREENS, { recursive: true })
  console.log(`trustweb live connect acceptance against ${HOST}  (throwaway: ${NAME_A}, ${NAME_B}, @${USERNAME})`)
  let browser = null
  try {
    browser = await launch()
    await flow(browser)
    ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  } catch (e) {
    ok('the run finished without an unexpected error', false, String(e?.message ?? e).split('\n')[0])
    await shot(run.a, 'failure_a')
    await shot(run.b, 'failure_b')
  } finally {
    try { await releaseUsername() } catch (e) { warnByHand(`release step crashed: ${String(e?.message ?? e).split('\n')[0]}`) }
    await browser?.close().catch(() => {})
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
