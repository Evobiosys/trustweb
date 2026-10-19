/**
 * Wave 2 (2026-10-07) in the real app, local only:
 *   1. P9: the Feed is off by default (the old bar); querying ("Call into your
 *      web") is one tap from Web, in both query styles, and from Inventory.
 *   4. P22, P26: an inventory item's sheet offers all three tiers and "Only me";
 *      the pill cycles through the same four.
 *   7. B8: "Search the web instead" below the contact search and below an
 *      ask's answers: Google, Ecosia, Qwant, Brave as plain links (new tab,
 *      noopener, no referrer), "outside TrustWeb, untrusted"; nothing is
 *      requested from those hosts without a tap (the suite never taps one).
 *   8. B4, B7: imported lines say "unreviewed, from an import" until kept
 *      ("Reviewed" on the item sheet; "Mark all reviewed" for the import);
 *      typed lines say "created step by step".
 *   9. P20: Settings > About says "App version <git short sha>, data format v1"
 *      (the recordings-and-hours allowance is checked in hosting_flow).
 *  10. B10: the Start screen leads with "Find people and things through people you trust".
 * Ports: Vite 5281, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/wave2_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    // The start screen's name field leaves the phone frame scrolled in headless Chromium: show the frame from its top.
    await page.evaluate(() => { window.scrollTo(0, 0); const p = document.querySelector('.phone'); if (p) p.scrollTop = 0 })
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const tabLabels = (page) => page.locator('nav.tabs > button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()))
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const dockOpen = async (page) => (await page.locator('.query-dock').count()) === 1 && await page.locator('.query-dock').isVisible()

/** Item 1: Feed off, the query one tap away from Web and Inventory. */
async function partQuery(a) {
  ok('the bar is the old one by default: Web | Record | My Resources', JSON.stringify(await tabLabels(a)) === JSON.stringify(['Web', 'Record', 'My Resources']), JSON.stringify(await tabLabels(a)))
  await a.locator('[data-open-query="1"]').click()
  ok('Web: one tap on "Ask your web" opens the query', await dockOpen(a))
  await a.locator('.query-dock .x').click()

  await tab(a, 'My Resources')
  const call = a.locator('[data-open-query="inventory"]')
  ok('Inventory: "Ask your web" is there', await call.isVisible() && (await call.getAttribute('aria-label')) === 'Ask your web')
  const [cb, rb] = [await call.boundingBox(), await a.locator('.requests-fab').boundingBox()]
  ok('it sits opposite "Review requests", never over it', Boolean(cb && rb) && cb.x + cb.width <= rb.x, JSON.stringify({ cb, rb }))
  await shot(a, 'w2-01-inventory-call')
  await call.click()
  ok('Inventory: one tap lands on Web with the query open', await dockOpen(a) && await a.getByRole('heading', { name: 'Your TrustWeb' }).isVisible())
  await shot(a, 'w2-02-query-from-inventory')
  await a.locator('.query-dock .x').click()

  // The other query style (Settings: the magnifier means querying): still one tap.
  await tab(a, 'My Resources')
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('.sheet.on .radio', { has: a.locator('b', { hasText: /^Query$/ }) }).click()
  await closeSheet(a)
  await tab(a, 'Web')
  await a.locator('[data-open-query="1"]').click()
  ok('query style "search": one tap still opens the query', await dockOpen(a))
  await a.locator('.query-dock .x').click()
}

/** Item 4: who can ask about an inventory item: acquaintances, friends, close friends, only me. */
async function partAudience(a) {
  await tab(a, 'My Resources')
  await a.getByPlaceholder(/Motorbike/).fill('Spare room in Vienna for visitors')
  await a.getByRole('button', { name: 'Add', exact: true }).click()
  const row = a.locator('.inv', { hasText: 'Spare room in Vienna for visitors' })
  await row.locator('.inv-text').click()
  const choices = await a.locator('.sheet.on [data-item-audience]').evaluateAll((bs) => bs.map((b) => b.querySelector('b').textContent))
  ok('the item sheet offers all three tiers and "Only me"', JSON.stringify(choices) === JSON.stringify(['Acquaintances', 'Friends', 'Close friends', 'Only me']), JSON.stringify(choices))
  await a.locator('.sheet.on [data-item-audience="close"]').click()
  const item = () => a.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).inventory.find((i) => i.text === 'Spare room in Vienna for visitors'))
  ok('choosing "Close friends" is kept, and the sheet says so', (await item()).audience === 'close' && (await a.locator('.sheet.on [data-item-audience="close"]').getAttribute('aria-pressed')) === 'true'
    && /Who can ask: Close friends/.test(await a.locator('.sheet.on').innerText()))
  await shot(a, 'w2-05-item-audience')
  await closeSheet(a)
  const seen = []
  for (let i = 0; i < 4; i++) { seen.push((await row.locator('.aud').innerText()).trim()); await row.locator('.aud').click() }
  ok('the pill cycles through the same four', JSON.stringify(seen) === JSON.stringify(['Close friends', 'Only me', 'Acquaintances', 'Friends']), JSON.stringify(seen))
}

const ENGINE_HOSTS = /google\.|ecosia\.|qwant\.|brave\./
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const links = (scope) => scope.locator('[data-web-search] a').evaluateAll((as) => as.map((a) => ({
  engine: a.dataset.engine, text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel, ref: a.getAttribute('referrerpolicy'),
})))
const safeLinks = (ls) => ls.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel) && l.ref === 'no-referrer')

/** Item 7: the web search fallback. Never clicks a link (no request may reach a real search engine from this suite). */
async function partWebSearch(browser, base, a) {
  const engineRequests = []
  a.on('request', (r) => { if (ENGINE_HOSTS.test(new URL(r.url()).hostname)) engineRequests.push(r.url()) })
  // Back to the "Ask your web" style, where the magnifier searches contacts.
  await tab(a, 'My Resources')
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('.sheet.on .radio', { has: a.locator('b', { hasText: /^Ask your web$/ }) }).click()
  await closeSheet(a)
  await tab(a, 'Web')
  await a.getByRole('button', { name: 'Search contacts' }).click()
  ok('no words, no web row', await a.locator('[data-web-search]').isHidden())
  await a.locator('.search-field').fill('cargo  bike & trailer')
  const ls = await links(a)
  ok('below the contact search: Google, Ecosia, Qwant, Brave', JSON.stringify(ls.map((l) => l.text)) === JSON.stringify(['Google', 'Ecosia', 'Qwant', 'Brave']), JSON.stringify(ls))
  ok('each opens the words in that engine (encoded, spaces collapsed)', ls[0].href === 'https://www.google.com/search?q=cargo%20bike%20%26%20trailer'
    && ls[1].href === 'https://www.ecosia.org/search?q=cargo%20bike%20%26%20trailer' && ls[2].href === 'https://www.qwant.com/?q=cargo%20bike%20%26%20trailer'
    && ls[3].href === 'https://search.brave.com/search?q=cargo%20bike%20%26%20trailer', JSON.stringify(ls.map((l) => l.href)))
  ok('new tab, no opener, no referrer', safeLinks(ls), JSON.stringify(ls))
  ok('it says: outside TrustWeb, untrusted results', /Search the web instead/.test(await a.locator('[data-web-search]').innerText()) && /Outside TrustWeb, untrusted results/.test(await a.locator('[data-web-search]').innerText()))
  await shot(a, 'w2-08-web-search-contacts')
  await a.locator('.search-field').fill('')
  ok('words cleared: the row hides again', await a.locator('[data-web-search]').isHidden())
  await a.getByRole('button', { name: 'Close search' }).click()

  // Below an ask's answers: a second phone that has nothing for it.
  await a.locator('.hdr [aria-label^="Show my code"]').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await a.getAttribute('.qrwrap', 'data-payload')
  const b = await newPhone(browser, errors)
  await b.goto(url)
  await b.getByLabel('Your first name').fill('Ben')
  await b.getByRole('button', { name: 'Connect', exact: true }).click()
  await acceptAdd(b)
  await until(async () => (await record(a)).peers.length === 1)
  await a.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await tab(a, 'Web')
  await a.locator('[data-open-query="1"]').click()
  await a.locator('.query-dock textarea').fill('Does anyone have a sailing boat?')
  await a.getByRole('button', { name: 'Ask my web' }).click()
  await a.locator('.query-dock [data-web-search]').waitFor({ timeout: 200_000 })
  const ql = await links(a.locator('.query-dock'))
  ok('after the answers (here: nothing found), the same row with the asked words', ql.length === 4 && ql[3].href === 'https://search.brave.com/search?q=Does%20anyone%20have%20a%20sailing%20boat%3F' && safeLinks(ql), JSON.stringify(ql))
  await shot(a, 'w2-09-web-search-after-ask')
  ok('no request ever went to a search engine (none was tapped)', engineRequests.length === 0, engineRequests.join(' | '))
  await b.context().close()
}

/** Item 8: the three provenance states on screen. */
async function partProvenance(a) {
  const file = JSON.stringify({ format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-10-07', items: [
    { key: '0123456789abcdef', text: 'Knows the Graz housing co-op board' },
    { key: 'fedcba9876543210', text: 'Can lend a cargo bike on weekends' },
  ] })
  await tab(a, 'My Resources')
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('[data-import-file]').setInputFiles({ name: 'trustweb-inventory-import.json', mimeType: 'application/json', buffer: Buffer.from(file) })
  await a.locator('[data-import-apply]').click()
  await a.locator('.inv-text', { hasText: 'Knows the Graz housing co-op board' }).waitFor({ timeout: 5_000 })
  ok('imported lines say "unreviewed" in the list', await a.locator('.inv-text:has([data-unreviewed])').count() === 2)
  await shot(a, 'w2-10-unreviewed-list')
  await a.locator('.inv-text', { hasText: 'Knows the Graz housing co-op board' }).click()
  ok('its sheet: "Unreviewed, from an import" and a one-tap "Reviewed"', /Unreviewed, from an import/.test(await a.locator('.sheet.on [data-prov-state]').innerText()) && await a.locator('.sheet.on [data-item-reviewed]').count() === 1)
  await shot(a, 'w2-11-unreviewed-sheet')
  await a.locator('.sheet.on [data-item-reviewed]').click()
  ok('one tap: "From an import, reviewed"; the button goes; the list chip goes', (await a.locator('.sheet.on [data-prov-state]').getAttribute('data-prov-state')) === 'mass-imported'
    && await a.locator('.sheet.on [data-item-reviewed]').count() === 0 && await a.locator('.inv-text:has([data-unreviewed])').count() === 1)
  await closeSheet(a)
  await a.locator('.inv-text', { hasText: 'Spare room in Vienna for visitors' }).click()
  ok('a typed line: "Created step by step"', /Created step by step/.test(await a.locator('.sheet.on [data-prov-state]').innerText()))
  await closeSheet(a)
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('[data-import-reviewed]').click()
  const inv = (await record(a)).inventory.filter((i) => i.source?.kind === 'tana')
  ok('"Mark all reviewed" in the import\'s row: the rest of that import is kept too', inv.length === 2 && inv.every((i) => typeof i.source.reviewedAt === 'number'))
  await a.getByRole('button', { name: 'Settings' }).click().catch(() => {})
  ok('then the button is gone (nothing left to review)', await a.locator('[data-import-reviewed]').count() === 0 && await a.locator('[data-import-undo]').count() === 1)
  await closeSheet(a)
  ok('no "unreviewed" chip left', await a.locator('.inv-text:has([data-unreviewed])').count() === 0)
}

/** Item 9: Settings > About names the build and the data format. */
async function partAbout(a) {
  await tab(a, 'My Resources')
  await a.getByRole('button', { name: 'Settings' }).click()
  await a.locator('.sheet.on [data-server-transcribe]').waitFor({ timeout: 10_000 }).catch(() => {})
  const line = a.locator('.sheet.on .about-version')
  await line.scrollIntoViewIfNeeded()
  ok('Settings > About: "App version <git short sha>, data format v1"', /^App version [0-9a-f]{7,40}(-dirty)?, data format v1$/.test((await line.innerText()).trim()), await line.innerText())
  await shot(a, 'w2-12-about-version')
  await closeSheet(a)
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(Number(process.env.TW_PORT || 5281), { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    const a = await newPhone(browser, errors)
    await a.goto(vite.base)
    ok('item 10 (B10): the Start screen leads with "Find people and things through people you trust"', /^Find people and things through people you trust\./.test((await a.locator('.start .lead').innerText()).trim()))
    await shot(a, 'w2-00-start')
    await startPhone(a, vite.base, 'Jakob')
    await partQuery(a)
    await partAudience(a)
    await partWebSearch(browser, vite.base, a)
    await partProvenance(a)
    await partAbout(a)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nwave2-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
