// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c feed-ext (θ ι κ): in the real app, local only, at 360x780 and 1280x900. The public networks are a stubbed server (Playwright routes
 * answer for public.api.bsky.app, a PeerTube instance and phanpy.trustweb.one (answers-44c) with the unit fixtures; every other outside request is counted and
 * must stay zero). Sources page: follow a Bluesky account and a PeerTube channel, their posts show in the Feed, Bridgy Fed builds the
 * bridged handle, "Never read public content" stops every read. Settings > Feed > Extensions: Phanpy off = no frame and no request to
 * Phanpy; on = "Open in Phanpy" mounts the sandboxed frame. The Meta row is struck through. A person's card offers "Follow via Bridgy Fed".
 * No overlap, no horizontal scroll. Port 5476. TW_SHOTS=<dir> writes screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/feed_ext.mjs
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const fx = (n) => readFileSync(new URL(`../unit/fixtures/feed_ext/${n}`, import.meta.url), 'utf8')
const c = checker()
const errors = []
const vite = await startVite(Number(process.env.PORT ?? 5476))
let browser = null
const overlaps = (page, sel) => page.evaluate((s) => {
  const r = [...document.querySelectorAll(s)].map((n) => n.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0)
  return r.flatMap((a, i) => r.slice(i + 1).filter((b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1).map(() => i))
}, sel)
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
const closeSheet = async (page) => {
  await page.keyboard.press('Escape')
  await page.locator('.sheet-veil').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await page.locator('.sheet.on').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
}
const waitFor = async (fn, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 150)) } return false }

try {
  browser = await launch()
  const a = await newPhone(browser, errors, { viewport: { width: 360, height: 780 } })
  await a.context().addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(s) }))
  const external = []
  const stubbed = { bsky: 0, tube: 0, phanpy: 0 }
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }
  await a.context().route('https://public.api.bsky.app/**', (r) => { stubbed.bsky++; return r.fulfill({ status: 200, headers: cors, body: fx('bluesky_author_feed.json') }) })
  await a.context().route('https://tube.test.example.org/**', (r) => { stubbed.tube++; return r.fulfill({ status: 200, headers: cors, body: fx('peertube_account_videos.json') }) })
  await a.context().route('https://phanpy.trustweb.one/**', (r) => { stubbed.phanpy++; return r.fulfill({ status: 200, headers: { 'Content-Type': 'text/html' }, body: '<!doctype html><title>Phanpy stub</title><p>Phanpy stub</p>' }) })
  await a.context().route(/^https:\/\/(cdn\.bsky\.app|video\.bsky\.app)\//, (r) => r.abort())
  a.on('request', (r) => { const u = r.url(); if (!u.startsWith('http://127.0.0.1') && !/^https:\/\/(public\.api\.bsky\.app|tube\.test\.example\.org|phanpy\.trustweb\.one)\//.test(u) && !u.startsWith('data:')) external.push(u) })
  await startPhone(a, vite.base, 'Jakob')
  await a.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.feed = { on: true }; r.uiBar = { order: ['web', 'chat', 'feed', 'events', 'inventory'], orderVersion: 2 }; r.people = [...(r.people ?? []), { id: 'p2', name: 'Ben Test', ring: 'friend', lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, theirProfile: { norms: [], at: Date.now(), website: 'https://ben.example.org' } }]; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
  await a.reload()
  await a.waitForTimeout(1500)
  await a.locator('.sheet.on').getByRole('button', { name: 'Not now' }).click({ timeout: 2500 }).catch(() => {})   // the "Keep a copy" offer
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  await a.locator('[data-feed-sources]').waitFor({ timeout: 8000 })

  c.ok('Phanpy off: no "Open in Phanpy", no frame, no request to Phanpy', await a.locator('[data-feed-open-phanpy]').count() === 0 && await a.locator('[data-phanpy-frame]').count() === 0 && stubbed.phanpy === 0)
  c.ok('nothing is read before a follow', stubbed.bsky === 0 && stubbed.tube === 0)

  // ---- Sources page: follow on Bluesky and PeerTube, Bridgy Fed, at both sizes ----
  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 900 }]) {
    const tag = `${vp.width}x${vp.height}`
    await a.setViewportSize(vp)
    await a.locator('[data-feed-sources]').click()
    await a.locator('[data-ext-follows]').waitFor({ timeout: 5000 })
    c.ok(`${tag}: the Sources page has the follow section`, await a.locator('[data-sources-section="ext"]').count() === 1)
    if (vp.width === 360) {
      await a.locator('[data-ext-kind="bluesky"]').click()
      await a.locator('[data-ext-input]').fill('@Alice.test.bsky.social')
      await a.locator('[data-ext-add]').click()
      const r1 = await record(a)
      c.ok('Bluesky follow stored in canonical form and Bluesky switched on', JSON.stringify(r1.feed?.extFollows) === '[{"kind":"bluesky","handle":"alice.test.bsky.social"}]' && r1.feed?.sources?.bluesky?.on === true)
      await a.locator('[data-ext-kind="peertube"]').click()
      await a.locator('[data-ext-input]').fill('https://tube.test.example.org/a/garden')
      await a.locator('[data-ext-add]').click()
      await a.locator('[data-ext-kind="bridgy"]').click()
      c.ok('Bridgy Fed explains the opt-in and links its docs', /opted in/.test(await a.locator('[data-ext-bridgy-note]').innerText()) && await a.locator('[data-ext-bridgy-note] a[href="https://fed.brid.gy/docs"]').count() === 1)
      await a.locator('[data-ext-input]').fill('https://example.org/blog')
      await a.locator('[data-ext-add]').click()
      c.ok('Bridgy Fed builds the bridged handle and offers to copy it', await a.locator('[data-ext-follow="bridgy:@example.org@web.brid.gy"] [data-ext-copy="@example.org@web.brid.gy"]').count() === 1)
      await a.locator('[data-ext-input]').fill('not a site at all')
      await a.locator('[data-ext-kind="peertube"]').click()
      await a.locator('[data-ext-input]').fill('garden')
      await a.locator('[data-ext-add]').click()
      c.ok('a bad address is refused in words, nothing stored', /not a PeerTube address/.test(await a.locator('[data-ext-follows]').innerText()) && (await record(a)).feed.extFollows.length === 3)
    }
    c.ok(`${tag}: three follows listed, each with Refresh and Remove`, await a.locator('[data-ext-follow] [data-ext-refresh]').count() === 3 && await a.locator('[data-ext-follow] [data-ext-remove]').count() === 3)
    c.ok(`${tag}: no overlap in the follow section, no horizontal scroll`, (await overlaps(a, '[data-ext-follows] > *')).length === 0 && await noHScroll(a))
    if (SHOTS) { await a.locator('[data-ext-follows]').evaluate((n) => n.scrollIntoView()); await a.screenshot({ path: path.join(SHOTS, `feed-ext-sources-${tag}.png`) }) }
    await closeSheet(a)
  }

  // ---- the Feed reads the followed accounts on open ----
  await a.setViewportSize({ width: 360, height: 780 })
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  c.ok('the Bluesky post shows in the Feed (text + link card)', await waitFor(async () => (await a.locator('.posts').innerText()).includes('Seed swap on Saturday')))
  c.ok('the PeerTube video shows as text with its title', await waitFor(async () => (await a.locator('.posts').innerText()).includes('Composting basics')))
  c.ok('an author who asked not to be shown logged-out is not shown', !(await a.locator('.posts').innerText()).includes('Only for logged-in readers'))
  c.ok('"Only Bluesky" and "Only PeerTube" chips appear', await a.locator('[data-feed-only="bluesky"]').count() === 1 && await a.locator('[data-feed-only="peertube"]').count() === 1)
  const reads = stubbed.bsky + stubbed.tube
  await a.locator('[data-feed-only="bluesky"]').click()
  await a.locator('[data-feed-only="bluesky"]').click()
  c.ok('redraws within the wait read nothing again', stubbed.bsky + stubbed.tube === reads, `${reads} -> ${stubbed.bsky + stubbed.tube}`)
  if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'feed-ext-feed-360x780.png') })

  // ---- Refresh reads again; "Never read public content" stops it ----
  await a.locator('[data-feed-sources]').click()
  await a.locator('[data-ext-refresh="bluesky:alice.test.bsky.social"]').click()
  c.ok('Refresh reads that one source again', await waitFor(async () => stubbed.bsky > 1 || stubbed.bsky + stubbed.tube > reads))
  await a.locator('[data-sources-nopublic]').scrollIntoViewIfNeeded()
  await a.locator('[data-sources-nopublic]').click()
  const frozen = stubbed.bsky + stubbed.tube
  await a.locator('[data-ext-refresh="peertube:garden@tube.test.example.org"]').click()
  await closeSheet(a)
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  await a.waitForTimeout(800)
  c.ok('"Never read public content": no read on Refresh or open, the followed posts are gone', stubbed.bsky + stubbed.tube === frozen && !(await a.locator('.scroll.feed').innerText()).includes('Seed swap'))
  await a.locator('[data-feed-sources]').click()
  await a.locator('[data-sources-nopublic]').scrollIntoViewIfNeeded()
  await a.locator('[data-sources-nopublic]').click()
  await closeSheet(a)

  // ---- Settings > Feed > Extensions ----
  await a.locator('nav.tabs button', { hasText: 'Resources' }).click()
  await a.evaluate(() => { localStorage.setItem('trustweb.ui.settings.advanced', '1'); localStorage.setItem('trustweb.ui.settings.features', '1') })
  await a.getByRole('button', { name: 'Settings' }).first().click()
  await a.locator('[data-feed-extensions]').waitFor({ state: 'attached', timeout: 6000 })
  const unfold = () => a.locator('[data-feed-extensions]').evaluate((n) => { for (let d = n.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true; n.scrollIntoView() })
  await unfold()   // Settings > Feed sits in a folded section
  c.ok('Extensions: Phanpy off (struck through), Bridgy Fed + Threads on', await a.locator('[data-ext-switch-phanpy].tw-off[aria-pressed="false"]').count() === 1 && await a.locator('[data-ext-switch-bridges][aria-pressed="true"]').count() === 1)
  c.ok('the Meta import row is struck through and cannot be switched', await a.locator('[data-meta-portability].tw-off[disabled]').count() === 1 && /needs Meta approval/.test(await a.locator('[data-meta-portability]').innerText()))
  c.ok('still no request to Phanpy', stubbed.phanpy === 0)
  await a.locator('[data-ext-switch-phanpy]').scrollIntoViewIfNeeded()
  await a.locator('[data-ext-switch-phanpy]').click()
  await a.waitForTimeout(500)
  await unfold().catch(() => {})
  c.ok('Phanpy on: stored, its address field shows (default phanpy.trustweb.one)', await waitFor(async () => (await record(a)).twSettings?.extensions?.phanpy === true && await a.locator('[data-phanpy-url]').count() === 1) && await a.locator('[data-phanpy-url]').inputValue() === 'https://phanpy.trustweb.one/')
  c.ok('no request to Phanpy by switching it on', stubbed.phanpy === 0)
  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 900 }]) c.ok(`${vp.width}: no overlap among the Extensions rows`, await a.setViewportSize(vp).then(() => overlaps(a, '.sheet.on [data-feed-extensions], .sheet.on [data-ext-switch-phanpy], .sheet.on .ext-phanpy-url, .sheet.on [data-feed-open-phanpy], .sheet.on [data-ext-switch-bridges], .sheet.on [data-meta-portability]')).then((o) => o.length === 0))
  if (SHOTS) { await a.locator('[data-feed-extensions]').evaluate((n) => n.scrollIntoView()); await a.screenshot({ path: path.join(SHOTS, 'feed-ext-settings-1280x900.png') }) }
  await a.setViewportSize({ width: 360, height: 780 })
  await closeSheet(a)

  // ---- Open in Phanpy ----
  await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
  await a.locator('[data-feed-open-phanpy]').first().click()
  await a.locator('[data-phanpy-frame]').waitFor({ timeout: 8000 })
  const frame = a.locator('[data-phanpy-frame]')
  c.ok('the frame is sandboxed, without referrer, on phanpy.trustweb.one', (await frame.getAttribute('sandbox')) === 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox' && (await frame.getAttribute('referrerpolicy')) === 'no-referrer' && (await frame.getAttribute('src')) === 'https://phanpy.trustweb.one/')
  c.ok('the third-party note names the site and offers a new tab', /phanpy\.trustweb\.one/.test(await a.locator('[data-phanpy-note]').innerText()) && await a.locator('[data-phanpy-newtab][href="https://phanpy.trustweb.one/"]').count() === 1)
  c.ok('the frame loaded the (stubbed) Phanpy', await waitFor(async () => stubbed.phanpy > 0))
  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 900 }]) {
    await a.setViewportSize(vp)
    c.ok(`${vp.width}: note and frame do not overlap, no horizontal scroll`, (await overlaps(a, '[data-phanpy-view] > *')).length === 0 && await noHScroll(a))
    if (SHOTS) await a.screenshot({ path: path.join(SHOTS, `feed-ext-phanpy-${vp.width}x${vp.height}.png`) })
  }
  await a.setViewportSize({ width: 360, height: 780 })

  // ---- a person's card: Follow via Bridgy Fed (their shared web site prefilled) ----
  await a.locator('nav.tabs button', { hasText: 'Web' }).click()
  await a.locator('[data-pid="p2"]').last().click()
  await a.locator('[data-card-open="p2"]').click()
  await a.locator('[data-ext-person-open]').scrollIntoViewIfNeeded()
  await a.locator('[data-ext-person-open]').click()
  c.ok('the card offers Bridgy Fed with their web site filled in', await a.locator('[data-ext-kind="bridgy"][aria-pressed="true"]').count() === 1 && await a.locator('[data-ext-person-input]').inputValue() === 'https://ben.example.org')
  await a.locator('[data-ext-person-add]').click()
  const r2 = await record(a)
  c.ok('the follow belongs to the person', r2.feed.extFollows.some((f) => f.handle === '@ben.example.org@web.brid.gy' && f.personId === 'p2'))
  c.ok('no overlap on the card section', (await overlaps(a, '[data-ext-person] > *')).length === 0 && await noHScroll(a))
  if (SHOTS) await a.screenshot({ path: path.join(SHOTS, 'feed-ext-card-360x780.png') })

  c.ok('nothing else left the phone', external.length === 0, external.join(','))
  c.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally {
  await browser?.close()
  vite.stop()
}
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
