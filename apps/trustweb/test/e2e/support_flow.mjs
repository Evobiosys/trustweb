// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 32: "Ask for support", one headless phone at 360 px. Two people sit in the record (one Closest, one Friend); the transport is
 * covered by unit tests (support_ask.test.mjs), here the screens: the line on Web, the sheet (audience count, chips, danger line), send,
 * the sender's "open until" line, "Here for you" after an answer, and the helper's calm card with "I'm here".
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright> TW_VITE_BIN=<vite8 bin> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/support_flow.mjs
 */
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const t = checker()
const errors = []

const seed = (page, extra) => page.evaluate((x) => {
  const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
  const peer = (id, name) => ({ id, displayName: name, did: 'did:test:' + id, ring: 'friend', connectedAt: Date.now() })
  const person = (id, name, ring) => ({ id: 'p-' + id, name, context: '', ring, peerId: id, lines: [], fields: {} })
  r.peers = [peer('peer-cy', 'Cy'), peer('peer-di', 'Di')]
  r.people = [person('peer-cy', 'Cy', 'closest'), person('peer-di', 'Di', 'friend')]
  Object.assign(r, x)
  localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
}, extra)

async function main() {
  const app = await startVite(PORT)
  const browser = await launch()
  try {
    const page = await newPhone(browser, errors, { viewport: { width: 360, height: 760 } })
    await startPhone(page, app.base, 'Anna')
    const until = Date.now() + 3_600_000
    await seed(page, { supportIn: [{ id: 'in1', peerId: 'peer-cy', chips: ['listen', 'call'], note: 'long day', until }] })
    await page.reload()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await page.locator('[data-go="web"]').dispatchEvent('click')

    t.ok('Need support? line on Web', await page.locator('[data-support-line]').count() === 1)
    t.ok('helper card reads "Cy could use support: Listen, A call"', (await page.locator('[data-support-card]').innerText()).includes('Cy could use support: Listen, A call'))
    await page.locator('[data-support-here]').dispatchEvent('click')
    t.ok('"I\'m here" drops the card and opens the chat', await page.locator('[data-support-card]').count() === 0 && await page.locator('.sheet.on').count() === 1)
    await page.locator('.sheet.on .sheet-home').dispatchEvent('click')

    await page.locator('[data-support-line]').dispatchEvent('click')
    t.ok('default audience: only 1 person (Closest few)', (await page.locator('[data-support-count]').innerText()).includes('1 person'))
    t.ok('no ring wider than Friends is offered', await page.locator('[data-support-ring]').count() === 3)
    await page.locator('[data-support-ring="friend"]').dispatchEvent('click')
    t.ok('Friends: only these 2 people', (await page.locator('[data-support-count]').innerText()).includes('2 people'))
    await page.locator('[data-support-ring="closest"]').dispatchEvent('click')
    await page.locator('[data-support-chip="listen"]').dispatchEvent('click')
    t.ok('danger line is shown', /call (112|911|999)/.test(await page.locator('[data-support-danger]').innerText()))
    t.ok('no sideways scroll at 360 px', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))
    await page.locator('[data-support-send]').dispatchEvent('click')
    const mine = (await record(page)).supportAsks?.[0]
    t.ok('sent ask kept: chips, only Cy', mine?.chips.join() === 'listen' && mine.to.join() === 'peer-cy', JSON.stringify(mine))
    t.ok('Web says it is open until', (await page.locator('[data-support-mine]').innerText()).includes('open until'))

    await seed(page, { supportAsks: [{ ...mine, here: ['peer-cy'] }] })
    await page.reload()
    await page.locator('[data-go="web"]').dispatchEvent('click')
    t.ok('sender sees who answered (names only)', (await page.locator('[data-support-mine]').innerText()).includes('Here for you: Cy'))

    await page.locator('[data-go="web"]').dispatchEvent('click')
    await page.locator('[data-open-query]').first().dispatchEvent('click')
    t.ok('Ask page has the big button', await page.locator('[data-support-ask]').count() === 1)
  } finally {
    await browser.close()
    app.stop()
  }
  t.ok('no page error', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nSUPPORT FLOW: ALL PASS' : `\nSUPPORT FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
