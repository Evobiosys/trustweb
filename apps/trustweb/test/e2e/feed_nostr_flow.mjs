// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Feed over Nostr relays (wave 32), the real app, no network: the Feed from the ⋮ sheet, a request posted to two groups at
 * once (local-only, "not sent: no relay set"), the relay field in Settings > Feed. Port 5471.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/feed_nostr_flow.mjs
 */
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const c = checker()
const errors = []
const vite = await startVite(5471)
let browser = null
try {
  browser = await launch()
  const a = await newPhone(browser, errors, { viewport: { width: 360, height: 800 } })
  await a.context().addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(s) })) // the dev preview banner
  await startPhone(a, vite.base, 'Jakob')
  await a.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.events = [{ id: 'e1', name: 'Hike', attended: true }, { id: 'e2', name: 'Picnic', attended: true }]; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
  await a.reload()
  await a.locator('[data-bar-more]').waitFor({ timeout: 15_000 })
  const sent = []
  a.on('websocket', (w) => sent.push(w.url()))

  await a.locator('[data-bar-more]').click()
  await a.locator('[data-bar-opt="feed"]').click()
  await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  await a.locator('[data-feed-post]').click()
  c.ok('the Post sheet offers four types', await a.locator('.sheet.on [data-feed-type]').count() === 4)
  await a.locator('.sheet.on [data-feed-type="request"]').click()
  c.ok('request is selected', await a.locator('.sheet.on [data-feed-type="request"]').getAttribute('aria-pressed') === 'true')
  await a.locator('.sheet.on [data-feed-to="event:e2"]').click()
  await a.locator('.sheet.on [data-feed-text]').fill('Does anyone have a rope?')
  await a.locator('.sheet.on [data-feed-send]').click()
  const rec = await record(a)
  c.ok('one post per picked group, type request, key generated', rec.groupPosts?.length === 2 && rec.groupPosts.every((p) => p.type === 'request' && !p.sent) && /^[0-9a-f]{64}$/.test(rec.nostrKey ?? ''), JSON.stringify(rec.groupPosts))
  await a.locator('[data-post-type="request"]').first().waitFor({ timeout: 5000 })
  c.ok('posts show the type chip and the grey no-relay note', await a.locator('[data-post-type="request"]').count() === 2 && /not sent: no relay set/.test(await a.locator('[data-post-unsent]').first().innerText()))
  c.ok('no horizontal scroll at 360 px', await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  c.ok('nothing left the phone', sent.length === 0, sent.join(','))

  await a.evaluate(() => { localStorage.setItem('trustweb.ui.settings.advanced', '1'); localStorage.setItem('trustweb.ui.settings.features', '1') })
  await a.locator('[data-settings-gear]').first().click()
  await a.locator('[data-feed-relay]').waitFor({ timeout: 5000 })
  await a.locator('[data-feed-relay]').fill('https://nope.example')
  await a.locator('[data-save-for="data-feed-relay"]').click()
  c.ok('a non-wss address is refused', (await record(a)).feed?.relays === undefined)
  await a.locator('[data-feed-relay]').fill('wss://relay.example.org/')
  await a.locator('[data-save-for="data-feed-relay"]').click()
  c.ok('a wss relay is kept', JSON.stringify((await record(a)).feed?.relays) === '["wss://relay.example.org"]')

  await a.locator('[data-feed-channel-input="event:e1"]').fill('Gear')
  await a.locator('[data-feed-channel-add="event:e1"]').click()
  await a.locator('[data-feed-gov-set="event:e2|vouch"]').click()
  const meta = (await record(a)).feed?.groupMeta
  c.ok('channel and governance are kept', meta?.['event:e1']?.channels?.[0]?.id === 'gear' && meta?.['event:e2']?.governance === 'vouch', JSON.stringify(meta))
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  await a.locator('[data-feed-post]').click()
  c.ok('the Post sheet offers the channel, three hops and the vouch note', await a.locator('.sheet.on [data-feed-channel="event:e1|gear"]').count() === 1 && await a.locator('.sheet.on [data-feed-hops]').count() === 3 && await a.locator('.sheet.on [data-feed-needs-vouch="event:e2"]').count() === 1)
  await a.locator('.sheet.on [data-feed-channel="event:e1|gear"]').click()
  await a.locator('.sheet.on [data-feed-hops="1"]').click()
  await a.locator('.sheet.on [data-feed-text]').fill('Gear swap')
  await a.locator('.sheet.on [data-feed-send]').click()
  const gp = (await record(a)).groupPosts
  c.ok('posted to the channel with hops 1', gp.some((p) => p.channel === 'gear' && p.hops === 1 && p.text === 'Gear swap'), JSON.stringify(gp))
  c.ok('the Groups chips show group > channel', await a.locator('[data-feed-channel-chip="event:e1|gear"]').count() === 1)
  await a.locator('[data-feed-channel-chip="event:e1|gear"]').click()
  c.ok('the governance label shows', await a.locator('[data-feed-governance="open"]').count() === 1)
  c.ok('no horizontal scroll at 360 px (channels)', await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  c.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  vite.stop()
}
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
