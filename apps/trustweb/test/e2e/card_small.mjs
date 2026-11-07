// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 card-small proof (headless, dev only): PORT=5477 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node card_small.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5477}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const day = 86_400_000
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [
    { id: 'p2', name: 'Ben Beispiel', ring: 'friend', lines: [], context: 'Fair 2015', metAt: Date.now() - day, channels: { signal: '+436601234567' },
      timeline: [1, 2, 3, 4, 5].map((n) => ({ at: Date.now() - n * 3_600_000, channel: 'note', direction: 'both', summary: `entry ${n}`, source: 'manual' })) },
    { id: 'p1', name: 'Ana Anders', ring: 'close', lines: [], context: '', metAt: Date.now() - 2 * day, peerId: 'x1', channels: { signal: '+436601234568' } },
    { id: 'p3', name: 'Uli Unplaced', ring: 'unsorted', lines: [], context: '', metAt: Date.now() - 3 * day },
  ] })
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const setup = async (opts, name) => {
  const page = await (await browser.newContext(opts)).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(600)
  return { page, errors, name }
}
const open = async (page, id) => { await page.locator(`[data-pid="${id}"]`).last().click(); await page.waitForTimeout(500) }
try {
  for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1440, height: 900 } }]]) {
    const { page, errors } = await setup(opts, name)
    const tap = (sel) => (opts.hasTouch ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    // Small card of an unconnected person.
    await open(page, 'p2')
    const h = await page.locator('[data-small-card]').evaluate((e) => e.getBoundingClientRect().height)
    console.log(`${name}: small card height ${Math.round(h)} px`)
    check(`${name}: no Chat button for a person not connected on TrustWeb; Connect stays`, (await page.locator('[data-chat-open="p2"]').count()) === 0 && (await page.locator('[data-connect-first="p2"]').count()) === 1)
    check(`${name}: a Signal icon, no TrustWeb one`, (await page.locator('[data-connected-place="signal"]').count()) === 1 && (await page.locator('[data-connected-place="trustweb"]').count()) === 0)
    check(`${name}: QR visible top right on the small card`, await page.locator('[data-small-card] [data-card-qr="p2"]').isVisible())
    check(`${name}: name editable on the small card`, (await page.locator('[data-card-name-edit="p2"]').count()) === 1)
    await tap('[data-card-name-edit="p2"]'); await page.locator('.tap-edit-input').fill('Benedikt Beispiel'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    check(`${name}: rename saved`, (await rec(page)).people.find((p) => p.id === 'p2').name === 'Benedikt Beispiel')
    // Ring edit: chip and "visible to" line.
    check(`${name}: ring chip shows the zone`, /Friends/.test(await page.locator('[data-card-zone]').innerText()))
    await tap('[data-card-zone]'); await page.waitForTimeout(150)
    check(`${name}: picker lists the five zones`, (await page.locator('[data-ring-choice]').count()) === 5 && await page.locator('[data-ring-pick]').isVisible())
    await tap('[data-ring-choice="acquaintance"]'); await page.waitForTimeout(500)
    check(`${name}: ring changed from the chip`, (await rec(page)).people.find((p) => p.id === 'p2').ring === 'acquaintance')
    await tap('[data-card-shares]'); await page.waitForTimeout(150)
    check(`${name}: the "visible to" line opens the same picker`, await page.locator('[data-ring-pick]').isVisible())
    // Tags.
    await tap('[data-tag-add]'); await page.waitForTimeout(150)
    check(`${name}: "+ tag" offers a tag`, (await page.locator('[data-tag-choice]').count()) >= 1)
    await tap('[data-tag-choice]'); await page.waitForTimeout(400)
    check(`${name}: tag added shows on the card`, (await page.locator('[data-card-tag]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-small.png` })
    // Extended.
    await tap('[data-card-open="p2"]'); await page.waitForTimeout(800)
    check(`${name}: timeline shows the last three; arrow and plus on the header's line`, (await page.locator('[data-person-timeline] [data-tl-entry]').count()) === 3 && await page.evaluate(() => {
      const a = document.querySelector('[data-tl-all]').getBoundingClientRect(); const b = document.querySelector('[data-tl-add]').getBoundingClientRect(); const t = document.querySelector('[data-act="person-timeline"]').getBoundingClientRect()
      return Math.abs(a.top - b.top) < 4 && Math.abs(a.top - t.top) < 4
    }))
    check(`${name}: Merge with and Import timeline are not on the extended card`, (await page.locator('[data-card-more] [data-tl-import]').count()) === 0 && (await page.locator('[data-card-more]').evaluate((e) => !/Merge with/.test(e.textContent ?? ''))))
    check(`${name}: QR still top right while extended`, await page.locator('[data-small-card] [data-card-qr="p2"]').isVisible() && (await page.locator('[data-card-more] [data-card-qr]').count()) === 0)
    // Fields collapsed; duplicates hidden.
    await page.waitForSelector('[data-action="toggle-fields"]', { timeout: 8000 })
    check(`${name}: Fields collapsed with an outliner triangle`, (await page.locator('[data-action="toggle-fields"]').getAttribute('aria-expanded')) === 'false' && /^▸/.test(await page.locator('[data-action="toggle-fields"]').innerText()))
    await page.locator('[data-action="toggle-fields"]').click(); await page.waitForTimeout(300)
    const fieldsShown = () => page.evaluate(() => [...(document.querySelector('[data-card-more] .curator-person')?.shadowRoot ?? document).querySelectorAll('[data-slot]')].map((e) => e.getAttribute('data-slot')))
    const before = await fieldsShown()
    check(`${name}: duplicate fields (names, ring, context) hidden by default`, !before.includes('tw-first') && !before.includes('tw-ring') && !before.includes('tw-context'))
    await page.evaluate(() => (document.querySelector('[data-card-more] .curator-person').shadowRoot.querySelector('[data-action="show-all-fields"]')).click()); await page.waitForTimeout(300)
    const after = await fieldsShown()
    check(`${name}: "Show all fields" shows them with the hint`, after.includes('tw-first') && after.includes('tw-ring') && after.includes('tw-context'))
    // Timeline: the Met date is editable.
    await page.locator('[data-person-timeline] [data-act="person-timeline"]').scrollIntoViewIfNeeded()
    // Plus: add form opens.
    await tap('[data-tl-add]'); await page.waitForTimeout(200)
    check(`${name}: plus opens the add form`, await page.locator('[data-tl-form]').isVisible())
    await tap('[data-tl-all]'); await page.waitForTimeout(500)
    check(`${name}: arrow opens the whole timeline as a page (6+ entries incl. Met)`, (await page.locator('[data-page="card-timeline"] [data-tl-entry]').count()) >= 6 && (await page.locator('[data-page="card-timeline"] [data-tl-all]').count()) === 0)
    await page.locator('[data-page="card-timeline"] [data-tl-entry="in_person"]').first().click()
    await page.locator('[data-page="card-timeline"] [data-tl-met-when]').fill('2015-06-01T10:00'); await page.waitForTimeout(400)
    check(`${name}: met date edited on the timeline entry`, new Date((await rec(page)).people.find((p) => p.id === 'p2').metAt).getFullYear() === 2015)
    check(`${name}: the Met entry words carry no date`, /Met: Fair$/.test(await page.locator('[data-page="card-timeline"] [data-tl-entry="in_person"] .tl-sum').first().innerText()))
    await page.goBack(); await page.waitForTimeout(400)
    // Curate page.
    await page.locator('button[data-card-curate]').scrollIntoViewIfNeeded()
    await tap('button[data-card-curate]'); await page.waitForTimeout(1200)
    const cur = '[data-page="card-curate"]'
    check(`${name}: Curate shows the name`, (await page.locator(`${cur} [data-card-name]`).innerText()).includes('Benedikt'))
    check(`${name}: Import timeline lives in Curate`, (await page.locator(`${cur} [data-tl-import]`).count()) === 1)
    const merge = await page.evaluate(() => { const r = document.querySelector('[data-page="card-curate"] .curator-person')?.shadowRoot; return { merge: Boolean(r?.querySelector('[data-part="merge"], .merge, button')), keep: Boolean(r?.querySelector('[data-field="keep-in-touch"]')) } })
    check(`${name}: Keep in touch (with "Not now") reachable in Curate`, merge.keep)
    await page.screenshot({ path: `${SHOTS}/${name}-curate.png` })
    await page.goBack(); await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/${name}-extended.png`, fullPage: true })
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    // Connected person: Chat, solid glyph, Advanced send.
    await page.goBack(); await page.waitForTimeout(300)
    await page.goBack().catch(() => undefined); await page.waitForTimeout(300)
    await open(page, 'p1')
    check(`${name}: a connected person has Chat, a solid glyph and the Advanced box`, (await page.locator('[data-chat-open="p1"]').count()) === 1 && (await page.locator('[data-connected-place="trustweb"]').count()) === 1 && (await page.locator('[data-card-advanced="p1"]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/${name}-small-connected.png` })
    await page.locator('[data-card-advanced="p1"] summary').click()
    await page.locator('[data-send-unread-text="p1"]').fill('hello without reading'); await page.locator('[data-send-unread="p1"]').click(); await page.waitForTimeout(500)
    check(`${name}: Send without reading puts the message in the chat book`, (await rec(page)).chats?.x1?.messages?.some((m) => m.text === 'hello without reading'))
    await page.goBack(); await page.waitForTimeout(300)
    // Unplaced person.
    await open(page, 'p3')
    check(`${name}: unplaced person: honest line, zone chip says Not placed yet`, /Not placed/.test(await page.locator('[data-card-zone]').innerText()) && !/yet yet/.test(await page.locator('[data-card-shares]').innerText()))
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
