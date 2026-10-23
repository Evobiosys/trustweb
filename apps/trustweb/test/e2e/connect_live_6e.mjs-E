/**
 * Wave 6e LIVE acceptance against a DEPLOYED app and its real connect service (production!). Headless, throwaway names only, fake links,
 * no phone number anywhere. Three claims of this run:
 *   1  Phone A (a fresh account) saves a fake Signal username link and a fake WhatsApp share-QR link (wa.me/qr/<code>, no number), gets a REAL
 *      connect code, pins WhatsApp then Signal modes: the Meet row shows the three buttons [primary][secondary][arrow] in pin order.
 *   2  Names: a claim of the reserved "jakob" from this throwaway phone is refused ("This name is reserved."); a throwaway name and one alias
 *      are claimed, GET /who/<each> is a 302 to /c/<code>, and GET /who/japossert and /who/jakob stay 404 (nobody holds them until granted).
 *      Both throwaway names are ALWAYS released in a finally block and checked (404).
 *   3  Phone A chooses "TrustWeb + WhatsApp"; phone B opens <origin>/c/<code>, adds A, and A's card shows "Message on WhatsApp" with the fake
 *      wa.me/qr link and NO Signal button (the mode narrows the shared contact to WhatsApp). The "Is this safe?" link shows on the add sheet.
 * TW_LIVE_HOST is required: https://app.idea2.site/trustweb | https://app.trustweb.one. TW_SCREENS=<dir> (default W6/screens/live-6e/).
 *   cd apps/demo && TW_LIVE_HOST=https://app.trustweb.one PLAYWRIGHT_PACKAGE=<playwright-core> ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_live_6e.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone } from './swiss_harness.mjs'
import { openAdvanced, pin, chooseMode, saveChannel, rowModes } from '../helpers/share_box.mjs'

const ALLOWED_HOSTS = ['https://app.idea2.site/trustweb', 'https://app.trustweb.one']
const HOST = (process.env.TW_LIVE_HOST ?? '').replace(/\/+$/, '')
const SCREENS = process.env.TW_SCREENS || '/Users/personal/Documents/agents/4claude/DEVLOG/trustweb-wave-1733/wave6/screens/live-6e/'
if (!ALLOWED_HOSTS.includes(HOST)) { console.error(`needs TW_LIVE_HOST, one of ${ALLOWED_HOSTS.join(' | ')}`); process.exit(2) }
mkdirSync(SCREENS, { recursive: true })
const SLUG = new URL(HOST).hostname
const c = checker()
const ok = c.ok
const errors = []
const hex = (n) => randomBytes(n).toString('hex')
const TAG = hex(2)
const NAME_A = `TW6e Live A ${TAG}`
const NAME_B = `TW6e Live B ${TAG}`
const MAIN = `tw6e-${hex(4)}`
const ALIAS = `tw6e-${hex(4)}`
const SIGNAL_LINK = `https://signal.me/#eu/${randomBytes(32).toString('base64url')}`
const WA_LINK = `https://wa.me/qr/${randomBytes(8).toString('hex').toUpperCase().slice(0, 13)}`
const CODE_RE = /^[A-Za-z0-9_-]{22}$/
const run = { origin: '', code: '', a: null, b: null }

const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, what) => { try { if (page && !page.isClosed()) await page.screenshot({ path: path.join(SCREENS, `live6e_${SLUG}_${what}.png`) }) } catch { /* never fails the run */ } }
const status = (page) => page.locator('[data-username-status]').innerText().catch(() => '')
async function plainGet(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    await res.body?.cancel().catch(() => {})
    const loc = res.headers.get('location')
    return { status: res.status, location: loc ? new URL(loc, url).href : '' }
  } catch (e) { return { status: 0, location: '', error: String(e?.message ?? e) } }
}

async function stepA(browser) {
  console.log(`\n[1] phone A "${NAME_A}": links, real code, pins, three buttons`)
  const a = await newPhone(browser, errors, { viewport: { width: 390, height: 844 } })
  run.a = a
  await startPhone(a, HOST + '/', NAME_A)
  run.origin = new URL(a.url()).origin
  await a.locator('.hdr [aria-label^="Show my code"]').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
  await saveChannel(a, 'signal', SIGNAL_LINK)
  await saveChannel(a, 'whatsapp', WA_LINK)
  for (const ch of ['signal', 'whatsapp']) {
    const tick = a.locator(`.meet-page [data-share-tick="${ch}"]`).first()
    if ((await tick.count()) > 0 && !(await tick.isChecked())) await tick.check()
  }
  const code = await until(async () => {
    const p = await a.getAttribute('.qrwrap', 'data-payload')
    const cd = p && p.startsWith(`${run.origin}/c/`) ? p.slice(run.origin.length + 3) : ''
    return CODE_RE.test(cd) ? cd : null
  }, 25_000)
  ok(`A gets a REAL connect code (${run.origin}/c/<22 chars>)`, Boolean(code))
  if (!code) return false
  run.code = code
  await pin(a, 'trustweb-whatsapp')
  await pin(a, 'trustweb-signal')
  const row = await rowModes(a)
  ok('the Meet row shows the two pinned modes in pin order (WhatsApp first, Signal second)', JSON.stringify(row) === JSON.stringify(['trustweb-whatsapp', 'trustweb-signal']), JSON.stringify(row))
  ok('and the arrow button that opens Advanced', (await a.locator('[data-share-row] [data-act="advanced"], [data-act="advanced"]').count()) >= 1)
  await shot(a, '01_three_buttons')
  return true
}

async function stepNames() {
  console.log(`\n[2] names: "jakob" refused, "${MAIN}" and alias "${ALIAS}" claimed, /who/ redirects, japossert and jakob stay 404`)
  const a = run.a
  await openAdvanced(a)
  await a.locator('[data-names]').waitFor({ timeout: 20_000 })
  await a.locator('[data-username]').fill('jakob')
  await a.locator('[data-act="claim-name"]').click()
  ok('a claim of "jakob" is refused: "This name is reserved."', Boolean(await until(async () => /This name is reserved\./.test(await status(a)) ? true : null)), await status(a))
  await shot(a, '02_jakob_reserved')
  await a.locator('[data-username]').fill(MAIN)
  await a.locator('[data-act="claim-name"]').click()
  ok(`A claims @${MAIN}`, Boolean(await until(async () => new RegExp(`@${MAIN} is yours`).test(await status(a)) ? true : null)), await status(a))
  await a.locator('[data-alias]').fill(ALIAS)
  await a.locator('[data-act="claim-alias"]').click()
  ok(`and the alias @${ALIAS}`, Boolean(await until(async () => new RegExp(`@${ALIAS} is yours`).test(await status(a)) ? true : null)), await status(a))
  for (const n of [MAIN, ALIAS]) {
    const w = await plainGet(`${run.origin}/who/${n}`)
    ok(`GET /who/${n} is a 302 to ${run.origin}/c/<code>`, w.status === 302 && w.location === `${run.origin}/c/${run.code}`, `${w.status} ${w.location}`)
  }
  for (const n of ['japossert', 'jakob']) ok(`GET /who/${n} is 404 (reserved, not granted yet)`, (await plainGet(`${run.origin}/who/${n}`)).status === 404)
  ok('the public /admin/names is not served (404)', (await plainGet(`${run.origin}/admin/names`)).status === 404)
  await shot(a, '03_names_held')
}

async function stepB(browser) {
  console.log(`\n[3] mode TrustWeb + WhatsApp: B scans, the card shows Message on WhatsApp only`)
  const a = run.a
  await chooseMode(a, 'trustweb-whatsapp')
  ok('A chose TrustWeb + WhatsApp and the QR is still the /c/ link', (await a.getAttribute('.qrwrap', 'data-payload')) === `${run.origin}/c/${run.code}`)
  const b = await newPhone(browser, errors, { viewport: { width: 390, height: 844 } })
  run.b = b
  await startPhone(b, HOST + '/', NAME_B)
  await b.goto(`${run.origin}/c/${run.code}`)
  await b.locator('.sheet.on [data-connect-add-title]').waitFor({ timeout: 25_000 })
  ok('B\'s add sheet offers "Is this safe?" on a scan landing', (await b.locator('.sheet.on [data-safety-link], .sheet.on [data-act="safety"]').count()) >= 1 || /Is this safe\?/.test(await b.locator('.sheet.on').innerText()))
  await shot(b, '04_b_add_sheet')
  await b.locator('.sheet.on [data-connect-add]').click()
  await b.locator('.sheet.on h3', { hasText: NAME_A }).waitFor({ timeout: 15_000 })
  const wa = b.locator('.sheet.on a', { hasText: /Message on WhatsApp/ })
  const href = await until(async () => ((await wa.count()) === 1 ? await wa.getAttribute('href') : null), 30_000)
  ok('A\'s card on B shows "Message on WhatsApp" (the contact text over the real relay)', Boolean(href))
  ok('its href is A\'s fake wa.me/qr link', href === WA_LINK, String(href).slice(0, 40))
  ok('and there is NO Signal button (the mode narrowed the contact to WhatsApp)', (await b.locator('.sheet.on a', { hasText: /Message on Signal/ }).count()) === 0)
  await shot(b, '05_b_card_whatsapp')
}

async function cleanup() {
  console.log('\n[4] release the throwaway names')
  const a = run.a
  if (!a || a.isClosed()) return
  // The per-address budget (6 POSTs a minute, 20 GETs a minute) is used up by the steps above: wait it out, then release, with retries.
  await new Promise((r) => setTimeout(r, 70_000))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await openAdvanced(a)
      for (const act of ['release-alias', 'release-name']) {
        const btn = a.locator(`[data-act="${act}"]:visible`)
        if ((await btn.count()) > 0) { await btn.first().click(); await new Promise((r) => setTimeout(r, 2500)) }
      }
    } catch (e) { console.log(`  WARN release by the page failed: ${String(e?.message ?? e).split('\n')[0]}`) }
    if ((await a.locator('[data-act="release-alias"]:visible, [data-act="release-name"]:visible').count()) === 0) break
    await new Promise((r) => setTimeout(r, 20_000))
  }
  for (const n of [MAIN, ALIAS]) {
    const w = await until(async () => ((await plainGet(`${run.origin}/who/${n}`)).status === 404 ? true : null), 45_000)
    ok(`@${n} is released (404)`, Boolean(w))
    if (!w) console.log(`  WARN release @${n} by hand`)
  }
}

let browser
try {
  browser = await launch()
  if (await stepA(browser)) { await stepNames(); await stepB(browser) }
} catch (e) {
  c.failures++
  console.log(`  FAIL  ${String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ')}`)
  await shot(run.a, 'err_a'); await shot(run.b, 'err_b')
} finally {
  try { await cleanup() } catch (e) { console.log(`  WARN cleanup ${e}`) }
  ok('no page error in any phone', errors.length === 0, errors.join(' | '))
  await browser?.close().catch(() => {})
}
console.log(c.failures ? `\n${c.failures} FAILURE(S)` : '\nCONNECT LIVE 6e: ALL PASS')
process.exit(c.failures ? 1 : 0)
