// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 feed-sources: Feed > Sources, in the real app, local only, at 360x780 and 1280x900. Three section headings, toggle Bluesky (struck through
 * when off), a slider changes the plain-language sentence, "Only <source>" on the Feed, the publish target (stored, nothing sent), no overlap,
 * no horizontal scroll, nothing leaves the phone. Port 5448. TW_SHOTS=<dir> writes screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/feed_sources_page.mjs
 */
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const errors = []
const vite = await startVite(Number(process.env.PORT ?? 5448))
let browser = null
const overlaps = (page, sel) => page.evaluate((s) => {
  const r = [...document.querySelectorAll(s)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0)
  return r.flatMap((a, i) => r.slice(i + 1).filter((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).map(() => i))
}, sel)
try {
  browser = await launch()
  const a = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
  await a.context().addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(s) }))
  const external = []
  a.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')) external.push(r.url()) })
  await startPhone(a, vite.base, 'Jakob')
  await a.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.feed = { on: true }; r.events = [{ id: 'e1', name: 'Hike', attended: true }]; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
  await a.reload()
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  // a group post of mine: a source ("nostr") for the "Only" chip
  await a.locator('[data-feed-post]').click()
  await a.locator('.sheet.on [data-feed-text]').fill('Rope swap')
  await a.locator('.sheet.on [data-feed-send]').click()
  await a.locator('.sheet.on').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 900 }]) {
    const tag = `${vp.width}x${vp.height}`
    await a.setViewportSize(vp)
    await a.locator('[data-feed-sources]').click()
    await a.locator('[data-sources-page]').waitFor({ timeout: 5000 })
    const heads = await a.locator('[data-sources-section]').evaluateAll((n) => n.map((x) => x.dataset.sourcesSection))
    c.ok(`${tag}: three sections and the algorithm panel`, JSON.stringify(heads) === '["techno","alt","open","algo"]', heads.join(','))
    c.ok(`${tag}: techno-feudal rows are off (struck through), open ones on`, await a.locator('[data-source-toggle="x"].tw-off[aria-pressed="false"]').count() === 1 && await a.locator('[data-source-toggle="mastodon"][aria-pressed="true"]').count() === 1)
    const bluesky = a.locator('[data-source-toggle="bluesky"]')
    await bluesky.scrollIntoViewIfNeeded()
    await bluesky.click()
    c.ok(`${tag}: Bluesky on is stored`, (await record(a)).feed?.sources?.bluesky?.on === true && await bluesky.getAttribute('aria-pressed') === 'true')
    await bluesky.click()
    c.ok(`${tag}: Bluesky off again leaves no trace and is struck through`, (await record(a)).feed?.sources === undefined && /tw-off/.test(await bluesky.getAttribute('class')))
    await a.locator('[data-source-expander="mastodon"]').scrollIntoViewIfNeeded()
    await a.locator('[data-source-expander="mastodon"]').click()
    await a.locator('[data-source-trusted="mastodon"]').click()
    c.ok(`${tag}: "Only people I trust" is stored behind the expander`, (await record(a)).feed?.sources?.mastodon?.trustedOnly === true)
    await a.locator('[data-source-trusted="mastodon"]').click()
    await a.locator('[data-source-expander="mastodon"]').click()
    const slider = a.locator('[data-algo-trust]')
    await slider.scrollIntoViewIfNeeded()
    const before = await a.locator('[data-algo-explain]').innerText()
    await slider.evaluate((n) => { n.value = '0.9'; n.dispatchEvent(new Event('input', { bubbles: true })) })
    const after = await a.locator('[data-algo-explain]').innerText()
    c.ok(`${tag}: the sentence changes with the slider`, before !== after && /far higher/.test(after), `${before} -> ${after}`)
    c.ok(`${tag}: the weights are stored`, (await record(a)).feed?.algo?.trust === 0.9)
    await slider.evaluate((n) => { n.value = '0.3'; n.dispatchEvent(new Event('input', { bubbles: true })) })
    await a.locator('[data-sources-nopublic]').scrollIntoViewIfNeeded()
    await a.locator('[data-sources-nopublic]').click()
    c.ok(`${tag}: "Never read public content" is its own switch`, (await record(a)).feed?.noPublicRead === true)
    await a.locator('[data-sources-nopublic]').click()
    c.ok(`${tag}: no overlap between rows, no horizontal scroll`, (await overlaps(a, '.sources-page .src-main')).length === 0 && await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    if (SHOTS) { await a.locator('[data-sources-page]').evaluate((n) => n.scrollIntoView()); await a.screenshot({ path: path.join(SHOTS, `feed-sources-${tag}.png`) }) }
    await a.keyboard.press('Escape')
    await a.locator('.sheet-veil').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await a.locator('.sheet.on').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
  }

  await a.setViewportSize({ width: 360, height: 780 })
  c.ok('the Feed offers "Only Nostr relays" for the one source it shows', await a.locator('[data-feed-only="nostr"]').count() === 1)
  await a.locator('[data-feed-only="nostr"]').click()
  c.ok('selecting it keeps its posts and marks the chip', await a.locator('[data-feed-only="nostr"][aria-pressed="true"]').count() === 1 && await a.locator('.post').count() >= 1)
  await a.locator('[data-feed-only="nostr"]').click()

  await a.locator('[data-feed-target-box] summary').click()
  c.ok('the publish target defaults to the fediverse', await a.locator('[data-feed-target="fediverse"][aria-pressed="true"]').count() === 1)
  await a.locator('[data-feed-target="x"]').click()
  c.ok('X is discouraged: struck through, with its off-ramp, and only stored', /Move off/.test(await a.locator('[data-feed-target-offramp]').innerText()) && (await record(a)).feed?.publishTarget === 'x')
  await a.locator('[data-feed-target="bluesky"]').click()
  c.ok('Bluesky is stored and the note says posting comes with the account link', (await record(a)).feed?.publishTarget === 'bluesky' && /account link/.test(await a.locator('[data-feed-target-note]').innerText()))
  c.ok('no overlap in the composer, no horizontal scroll', (await overlaps(a, '.feed-compose > *')).length === 0 && await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'feed-sources-feed-360x780.png') })
  c.ok('nothing left the phone', external.length === 0, external.join(','))
  c.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  vite.stop()
}
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
