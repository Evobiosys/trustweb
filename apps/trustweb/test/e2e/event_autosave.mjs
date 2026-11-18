// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (headless, stock dev only): drafts are kept silently. Event editor: type, switch tab, come back = still there; reload and
 * reopen = "Draft restored" with Discard. The same for the ask composer and the resources outliner. Settings > Drafts lists them with sizes.
 * Conference link: a guest who has not accepted sees "Revealed once you accept"; the host sees the link. P06 bounding box on the notice.
 * PORT=5474 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.js> node event_autosave.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5474}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const ROOM = 'https://kmeet.infomaniak.com/fake-room-1'
const EVENTS = [
  { id: 'host1', name: 'My circle', from: '2027-12-30', where: 'Online', createdAt: 1, attended: true, conference: [{ provider: 'kmeet', url: ROOM }] },
  { id: 'guest1', name: 'Their circle', from: '2027-12-31', where: 'Online', createdAt: 1, attended: false, fromLink: true, hosts: ['Hanna Host'], confHidden: true },
]
const blk = (id, text, children = []) => ({ id, text, children })
const RECORD = { v: 1, me: { id: 'me1', displayName: 'Tester' }, people: [{ id: 'p1', name: 'Test Peer', context: '', ring: 'friend', metAt: 1, lines: [], peerId: 'k1', fields: {} }], peers: [{ id: 'k1', did: 'did:key:zFake', name: 'Test Peer', ring: 'friend' }], log: [],
  inventory: [{ id: 'r1', text: 'Reading list', audience: 'friends', included: true, createdAt: 1, blocks: [blk('a', 'Books', [blk('a1', 'Dune')])] }], events: EVENTS, feed: { on: true } }

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.ui.keepcopy.offered', '1'); localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, RECORD)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    const tab = async (id) => { await page.locator(`.tabs [data-go="${id}"]`).first().click(); await page.waitForTimeout(400) }
    const toEvents = async () => { await tab('events'); if (await page.locator('[data-cal-all]').count()) { await page.locator('[data-cal-all]').click(); await page.waitForTimeout(200) } }

    // --- event editor: type, switch tab, back; then reload = Draft restored
    await toEvents()
    await page.locator('[data-event-add]').click(); await page.waitForTimeout(300)
    await page.locator('[data-editor-name]').fill('Picnic draft')
    await page.locator('[data-editor-where]').fill('Prater')
    await tab('web')
    await page.waitForTimeout(700)
    check(`${w}: a tab switch saved the event draft silently`, (await store()).drafts?.['event:new']?.value?.name === 'Picnic draft')
    check(`${w}: no draft dialog on a tab switch`, (await page.locator('[data-draft-dialog]').count()) === 0)
    await toEvents()
    if (!(await page.locator('[data-editor-name]').count())) { await page.locator('[data-event-add]').click(); await page.waitForTimeout(300) }
    check(`${w}: back in Events, the typed name is there`, (await page.locator('[data-editor-name]').inputValue()) === 'Picnic draft')
    await page.reload(); await page.waitForTimeout(900)
    await toEvents()
    await page.locator('[data-event-add]').click(); await page.waitForTimeout(400)
    check(`${w}: after a reload the editor reopens with the draft`, (await page.locator('[data-editor-name]').inputValue()) === 'Picnic draft' && (await page.locator('[data-editor-where]').inputValue()) === 'Prater')
    check(`${w}: "Draft restored" with Discard shows`, (await page.locator('[data-draft-restored]').count()) === 1 && (await page.locator('[data-draft-restored]').innerText()).includes('Draft restored'))
    const nb = await page.locator('[data-draft-restored]').boundingBox()
    const nameBox = await page.locator('[data-editor-name]').boundingBox()
    check(`${w}: P06 the notice overlays no control`, nb && !overlap(nb, nameBox), JSON.stringify([nb, nameBox]))
    await page.screenshot({ path: `${SHOTS}/event-autosave-${w}-restored.png` })
    await page.locator('[data-draft-restored-discard]').click(); await page.waitForTimeout(700)
    check(`${w}: Discard empties the form and drops the draft`, (await page.locator('[data-editor-name]').inputValue()) === '' && !(await store()).drafts?.['event:new'])
    await page.locator('[data-editor-name]').fill('Keep for settings'); await page.waitForTimeout(700)

    // --- conference: the host sees the link, the guest who has not accepted sees "Revealed once you accept"
    await page.locator('[data-event-cancel]').click(); await page.waitForTimeout(200)
    if (await page.locator('[data-draft-keep]').count()) { await page.locator('[data-draft-save]').click(); await page.waitForTimeout(300) }
    await page.evaluate(() => { location.hash = '' })
    await toEvents()
    await page.locator('[data-event-row="host1"], [data-event-open="host1"], [data-event="host1"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
    const hostConf = await page.locator('[data-event-conference]').getAttribute('data-event-conference').catch(() => null)
    check(`${w}: the host's event page shows the conference link under Location`, hostConf === 'links' && (await page.locator('[data-event-conference] a').getAttribute('href')) === ROOM, String(hostConf))
    await toEvents()
    await page.locator('[data-event-row="guest1"], [data-event-open="guest1"], [data-event="guest1"]').first().click().catch(() => {})
    await page.waitForTimeout(300)
    check(`${w}: the guest sees "Revealed once you accept"`, (await page.locator('[data-event-conference="hidden"]').innerText().catch(() => '')) === 'Revealed once you accept')
    const whereY = (await page.locator('[data-event-where]').boundingBox())?.y ?? -1
    check(`${w}: the line sits under Location`, ((await page.locator('[data-event-conference]').boundingBox())?.y ?? -1) > whereY)
    check(`${w}: the guest page holds no conference link`, !(await page.content()).includes('kmeet.infomaniak.com/fake'))
    await page.screenshot({ path: `${SHOTS}/event-autosave-${w}-guest.png` })

    // --- ask composer: type, switch tab, reload, reopen = restored
    await tab('web')
    if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: /Ask your web/ }).first().click().catch(() => {})
    await page.waitForTimeout(300)
    const askOpen = (await page.locator('.query-dock textarea').count()) > 0
    check(`${w}: the ask composer opens`, askOpen)
    if (askOpen) {
      await page.locator('.query-dock textarea').fill('Who has a ladder?')
      await tab('events'); await page.waitForTimeout(700)
      check(`${w}: the ask text is kept as a draft`, JSON.stringify((await store()).drafts?.['ask:new']?.value ?? {}).includes('Who has a ladder?'))
      await page.reload(); await page.waitForTimeout(900)
      await tab('web')
      if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: /Ask your web/ }).first().click().catch(() => {})
      await page.waitForTimeout(500)
      check(`${w}: the ask composer reopens with the draft and the notice`, (await page.locator('.query-dock textarea').inputValue()) === 'Who has a ladder?' && (await page.locator('.query-dock [data-draft-restored]').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/event-autosave-${w}-ask.png` })
      await page.locator('.query-dock .dock-head .x').click({ timeout: 2000 }).catch(() => {})
    }

    // --- outliner: a line typed and left by a tab switch (no Enter, no blur first) is kept
    await tab('inventory')
    await page.locator('[data-item="r1"]').first().click(); await page.waitForTimeout(400)
    await page.locator('[data-ol-text="a1"]').click(); await page.keyboard.press('End'); await page.keyboard.type(' Messiah')
    await page.waitForTimeout(700)
    const kept = JSON.stringify((await store()).inventory[0].blocks)
    check(`${w}: the outliner keeps a typed line 500 ms later`, kept.includes('Dune Messiah'), kept)
    await page.reload(); await page.waitForTimeout(900)
    await tab('inventory')
    await page.locator('[data-item="r1"]').first().click(); await page.waitForTimeout(400)
    check(`${w}: after a reload the outliner shows it`, (await page.locator('[data-ol-text="a1"]').inputValue()) === 'Dune Messiah')

    // --- Settings > Drafts lists them with sizes; Discard drops one
    await page.keyboard.press('Escape'); await page.waitForTimeout(200)
    if (await page.locator('.sheet-veil.on').count()) { await page.locator('.sheet-veil.on').click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(300) }
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    for (const g of ['advanced-all', 'general']) { const d = page.locator(`[data-settings-group="${g}"]`).first(); if (!(await d.evaluate((x) => x.open))) await d.locator('> summary').click(); await page.waitForTimeout(200) }
    await page.locator('[data-settings-section="drafts"] > summary').scrollIntoViewIfNeeded(); await page.locator('[data-settings-section="drafts"] > summary').click(); await page.waitForTimeout(200)
    const rows = await page.locator('[data-draft-row]').count()
    check(`${w}: Settings > Drafts lists the drafts with sizes`, rows >= 1 && /\d+(\.\d)? (B|KB)/.test(await page.locator('[data-draft-row]').first().innerText()), String(rows))
    await page.screenshot({ path: `${SHOTS}/event-autosave-${w}-settings.png` })
    await page.locator('[data-draft-discard]').first().click(); await page.waitForTimeout(300)
    check(`${w}: Discard in Settings drops one`, (await page.locator('[data-draft-row]').count()) === rows - 1)
    check(`${w}: no document scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
