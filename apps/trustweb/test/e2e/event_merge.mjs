// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events (headless, stock dev server, synthetic record): a host of both events merges from the event page (+ merge > pick > Merge now):
 * the people move over, the other event goes to Recently deleted, its old link opens the kept event; a host of only one asks the other host (Waiting
 * for ...); an ask to me shows as a card with Merge / Not now. 360x780 and 1280x900.
 * PORT=5470 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node event_merge.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5470}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const day = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)
const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const E = (id, name, over = {}) => ({ id, name, from: day(3), where: 'Alm', createdAt: 1, attended: true, ...over })
const people = [P('b', 'Ben Gruber', { events: ['e2'] }), P('c', 'Cleo Maier', { events: ['e1'] }), P('o', 'Omar Co', { peerId: 'peer-o' })]
const events = [
  E('e1', 'Winter Gathering', { hosts: ['Ana Host'] }),
  E('e2', 'Gathering in Winter', { hosts: ['Ana Host'], resources: [{ id: 'r9', text: 'Speaker' }] }),
  E('e3', 'Omar Fest', { hosts: ['Omar Co'], fromLink: true }),
  E('e4', 'My Picnic', { hosts: ['Ana Host'] }),
]
const asks = [{ dir: 'in', keep: 'e3', gone: 'e4', peer: 'peer-o', from: 'Omar Co', at: 1 }]
const record = { v: 1, me: { id: 'me1', displayName: 'Ana Host' }, peers: [{ id: 'peer-o', displayName: 'Omar' }], log: [], inventory: [], people, events, eventMergeAsks: asks }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); sessionStorage.clear() }, JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    const openEvent = async (id) => {
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
      if (await page.locator('[data-cal-all]').count()) await page.locator('[data-cal-all]').click()
      await page.waitForTimeout(200)
      await page.locator(`[data-event="${id}"]`).first().click(); await page.waitForTimeout(400)
    }
    // the ask to me: a card on my event's page; Not now ends it
    await openEvent('e4')
    check(`${w}: the ask from Omar is a card on My Picnic`, /Omar Co asks to merge your event into Omar Fest/.test(await page.locator('[data-event-merge-ask="e3"]').textContent().catch(() => '')))
    await page.locator('[data-event-merge-ask="e3"]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/merge-events-ask-${w}.png` })
    await page.locator('[data-event-merge-no]').click(); await page.waitForTimeout(400)
    check(`${w}: Not now ends the ask and merges nothing`, !(await rec(page)).eventMergeAsks && (await rec(page)).events.length === 4 && (await page.locator('[data-event-merge-ask]').count()) === 0)
    // host of both: merge now
    await openEvent('e1')
    const chip = page.locator('[data-event-merge="e1"]')
    check(`${w}: a host sees + merge on the event page`, (await chip.count()) === 1 && (await chip.textContent()) === '+ merge')
    await chip.scrollIntoViewIfNeeded(); await chip.click(); await page.waitForTimeout(300)
    check(`${w}: the sheet lists the other events`, (await page.locator('[data-event-merge-pick]').evaluateAll((n) => n.map((x) => x.dataset.eventMergePick).join())) === 'e2,e3,e4')
    await page.locator('[data-event-merge-pick="e2"]').click(); await page.waitForTimeout(200)
    check(`${w}: host of both: Merge now`, (await page.locator('[data-event-merge-go]').getAttribute('data-event-merge-go')) === 'now' && /keeps its link/.test(await page.locator('[data-event-merge-hint]').textContent()))
    await page.screenshot({ path: `${SHOTS}/merge-events-sheet-${w}.png` })
    await page.locator('[data-event-merge-go]').click(); await page.waitForTimeout(600)
    const r = await rec(page)
    check(`${w}: merged: Gathering in Winter is gone, in Recently deleted, its id redirects`, !r.events.some((e) => e.id === 'e2') && r.trash?.some((t) => t.kind === 'event' && t.id === 'e2') && r.eventMerged?.e2 === 'e1', JSON.stringify(r.eventMerged))
    check(`${w}: Ben moved over, the resource too`, r.people.find((p) => p.id === 'b').events.join() === 'e1' && r.events.find((e) => e.id === 'e1').resources?.[0]?.text === 'Speaker')
    // host of only the kept one: asks the other host
    await openEvent('e1')
    await page.locator('[data-event-merge="e1"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-event-merge-pick="e3"]').click(); await page.waitForTimeout(200)
    check(`${w}: host of one: Ask Omar Co`, (await page.locator('[data-event-merge-go]').textContent()) === 'Ask Omar Co to merge')
    await page.locator('[data-event-merge-go]').click(); await page.waitForTimeout(600)
    check(`${w}: the ask waits (out), nothing merged`, (await rec(page)).eventMergeAsks?.[0]?.dir === 'out' && (await rec(page)).events.some((e) => e.id === 'e3'))
    await openEvent('e1')
    check(`${w}: the page says Waiting for Omar Co`, (await page.locator('[data-event-merge-waiting]').textContent().catch(() => '')) === 'Waiting for Omar Co to say yes.')
    await page.screenshot({ path: `${SHOTS}/merge-events-waiting-${w}.png` })
    // an old link of the merged event opens the kept one
    const link = await page.evaluate(async () => { const m = await import('/src/event_link.ts'); return m.encodeEventLink({ id: 'e2', name: 'Gathering in Winter', from: '2026-12-30', where: 'Alm' }, location.origin, 'peer') })
    await page.goto(link); await page.waitForTimeout(1200)
    check(`${w}: the old link opens Winter Gathering`, (await page.locator('[data-event-merge="e1"]').count()) === 1 && (await page.locator('.sheet h2').count()) === 0)
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
