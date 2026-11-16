// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 41 community-mode proof (headless): PORT=5471 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node community_mode.mjs. Synthetic record only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5471}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' }), person('p3', 'Dan Huber', 'acquaintance', {})]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const ymd = (d) => { const x = new Date(Date.now() + d * 86_400_000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const events = [{ id: 'e1', name: 'Community picnic', from: ymd(0), where: 'Augarten, Wien', createdAt: 1, attended: true, hosts: ['Ben Gruber'] }, { id: 'e2', name: 'Autumn circle', from: ymd(-20), where: 'Online', createdAt: 1, attended: false }]
const record = (evs) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), log: [], inventory: [], people, events: evs, twSettings: { custom: [{ id: 'custom-fest', name: 'Fest', base: 'full', modules: {} }] } })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
/** Wave 44: a section of the Community view through its own menu (the drawer on a phone). */
const cgo = async (page, n) => {
  const nav = page.locator(`[data-community-nav="${n}"]`)
  if (!(await nav.isVisible())) await page.locator('[data-community-menu]').click()
  await nav.click(); await page.waitForTimeout(400)
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp })
    const errors = []
    const open = async (evs) => {
      const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [record(evs), JSON.stringify(tags)])
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {}) // the one-time demo-content card would cover the switch in the shots
      return page
    }
    const shot = (page, n) => page.screenshot({ path: `${SHOTS}/community-mode-${vw}-${n}.png` })
    const mode = (page) => page.locator('[data-mode-pill] .mode-opt.on').getAttribute('data-mode')
    const viewTo = async (page, v) => {
      if (!(await page.locator('.view-drop').count())) await page.locator('.view-menu-btn').click()
      if (!(await page.locator(`.view-drop [data-view="${v}"]`).count())) await page.locator('[data-view-other]').click()
      await page.locator(`.view-drop [data-view="${v}"]`).click(); await page.waitForTimeout(500)
    }

    const openExtensions = async (page) => { await page.evaluate(() => { for (const s of ['[data-settings-group="general"]', '[data-settings-section="extensions"]']) { const d = document.querySelector(s); if (d) d.open = true } }); await page.waitForTimeout(300) } // sections remember open/closed, so set it
    // ---- no event today: plain Personal shell with the switch beside the TrustZone heading
    let page = await open([events[1]])
    check(`${vw}: Personal by default, switch beside the TrustZone heading`, (await mode(page)) === 'personal' && (await page.locator('.web-view-row [data-mode-pill]').count()) === 1)
    check(`${vw}: switch is underlined and fits`, (await page.locator('[data-mode="community"]').evaluate((b) => getComputedStyle(b).textDecorationLine)) === 'underline' && await noHScroll(page))
    check(`${vw}: no notice without an event today`, (await page.locator('[data-mode-notice]').count()) === 0)
    await shot(page, '1-web-personal')
    for (const v of ['network', 'people', 'complete', 'compact', 'rings']) {
      await viewTo(page, v)
      check(`${vw}: switch on the ${v} view`, (await page.locator('[data-mode-pill]').count()) === 1)
    }
    await viewTo(page, 'complete'); await shot(page, '2-table'); await viewTo(page, 'network'); await shot(page, '2-network'); await viewTo(page, 'rings')

    // ---- Community: the whole shell
    await page.locator('[data-mode="community"]').click(); await page.waitForTimeout(1500)
    check(`${vw}: Community shows the Community view`, (await page.locator('[data-community]').count()) === 1 && (await mode(page)) === 'community')
    // wave 44 steer-community-bar: the bottom bar stays the Personal one; the sections sit in the Community view's own menu
    check(`${vw}: bottom bar = the Personal bar (no community: buttons, Web present)`, (await page.locator('.tabs [data-go^="community:"]').count()) === 0 && (await page.locator('.tabs [data-go="web"]').count()) === 1)
    check(`${vw}: Home marked`, (await page.locator('[data-community-nav="home"][aria-current="page"]').count()) === 1)
    await cgo(page, 'spaces')
    check(`${vw}: Spaces opens Spaces and is marked`, (await page.locator('[data-community-space]').count()) === 1 && (await page.locator('[data-community-nav="spaces"][aria-current="page"]').count()) === 1)
    await cgo(page, 'members')
    check(`${vw}: Members tab shows the two members`, (await page.locator('[data-community-member]').count()) === 2)
    await shot(page, '3-community-members')
    await cgo(page, 'chat')
    check(`${vw}: Chat opens the chat pane`, (await page.locator('[data-community-chat]').count()) === 1)
    await page.locator('.tabs [data-go="web"]').click(); await page.waitForTimeout(500)
    check(`${vw}: Web tab shows the Web, switch says Community`, (await page.locator('.rings-zoom').count()) === 1 && (await page.locator('.tabs [data-go="web"].on').count()) === 1 && (await mode(page)) === 'community')
    await shot(page, '4-community-web')
    await page.locator('[data-mode="personal"]').click(); await page.waitForTimeout(600)
    check(`${vw}: Personal brings today's bottom row back`, (await page.locator('.tabs [data-go^="community:"]').count()) === 0 && (await page.locator('.tabs [data-go="web"]').count()) === 1 && (await mode(page)) === 'personal')
    check(`${vw}: no horizontal scrolling`, await noHScroll(page))

    // ---- Settings > Variations: default interface, layout, versions
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.evaluate(() => { for (const q of ['[data-settings-group="variations"]', '[data-settings-section="variations"]']) { const d = document.querySelector(q); if (d) d.open = true } }); await page.waitForTimeout(300) // wave 44: sections remember open/closed, so set it (a click toggled it shut)
    check(`${vw}: Variations has Default interface per variation and the Community layout`, (await page.locator('[data-mode-default]').count()) === 5 && (await page.locator('[data-mode-default="custom-fest"]').count()) === 1 && (await page.locator('[data-mode-item]').count()) === 7)
    check(`${vw}: Default interface heading carries the alpha subscript`, (await page.locator('[data-settings-group="variations"] [data-alpha-label]').count()) >= 2)
    await page.locator('[data-mode-item="docs"]').evaluate((e) => e.click()); await page.waitForTimeout(300)
    await page.locator('[data-mode-move="web:-1"]').click().catch(() => {}); await page.waitForTimeout(200)
    await page.locator('[data-mode-version-name]').evaluate((e) => { e.value = 'Festival' }); await page.locator('[data-mode-save]').evaluate((e) => e.click()); await page.waitForTimeout(300)
    check(`${vw}: Save as my version lists it`, (await page.locator('[data-mode-version]').count()) === 1 && /Festival/.test(await page.locator('[data-mode-version]').textContent()))
    await page.locator('[data-mode-item="chat"]').evaluate((e) => e.click()); await page.waitForTimeout(300)
    await page.locator('[data-mode-use]').evaluate((e) => e.click()); await page.waitForTimeout(300)
    check(`${vw}: Use restores the saved layout (chat back, docs still out)`, (await page.locator('[data-mode-item="chat"]').isChecked()) && !(await page.locator('[data-mode-item="docs"]').isChecked()))
    await shot(page, '5-settings')
    await page.locator('[data-mode-default="full"]').evaluate((e) => { e.value = 'community'; e.dispatchEvent(new Event('change')) }); await page.waitForTimeout(1500)
    check(`${vw}: choosing Community as the default switches now`, (await mode(page)) === 'community')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    await page.close()
    // a new tab opens in the default interface
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); await page.goto(URL); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1800)
    check(`${vw}: new session opens in Community (the default)`, (await mode(page)) === 'community' && (await page.locator('[data-community]').count()) === 1 && (await page.locator('[data-community-nav="home"][aria-current="page"]').count()) === 1)
    await page.locator('[data-mode="personal"]').click(); await page.waitForTimeout(500)
    await page.close()

    // ---- event today + going: the notice
    const ctx2 = ctx
    await ctx2.clearCookies()
    page = await open(events)
    check(`${vw}: notice names the event today`, /Community picnic/.test(await page.locator('[data-mode-notice]').innerText()))
    check(`${vw}: notice has Switch, Not now, Never for this event (underlined)`, (await page.locator('[data-mode-switch], [data-mode-later], [data-mode-never]').evaluateAll((b) => b.map((x) => getComputedStyle(x).textDecorationLine))).join() === 'underline,underline,underline')
    await shot(page, '6-notice')
    check(`${vw}: no horizontal scroll with the notice`, await noHScroll(page))
    await page.locator('[data-mode-later]').click(); await page.waitForTimeout(400)
    check(`${vw}: Not now hides it`, (await page.locator('[data-mode-notice]').count()) === 0)
    await page.reload(); await page.waitForTimeout(900)
    check(`${vw}: Not now is remembered for today`, (await page.locator('[data-mode-notice]').count()) === 0)
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.extData['community-mode'].suggest; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.waitForTimeout(900)
    await page.locator('[data-mode-never]').click(); await page.waitForTimeout(400)
    await page.reload(); await page.waitForTimeout(900)
    check(`${vw}: Never for this event is remembered`, (await page.locator('[data-mode-notice]').count()) === 0)
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.extData['community-mode'].suggest; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.waitForTimeout(900)
    await page.locator('[data-mode-switch]').click(); await page.waitForTimeout(1500)
    check(`${vw}: Switch opens Community on Events`, (await mode(page)) === 'community' && (await page.locator('[data-community-nav="events"][aria-current="page"]').count()) === 1 && (await page.locator('[data-community-event="e1"]').count()) === 1)
    await shot(page, '7-switched-events')
    check(`${vw}: no notice once in Community`, (await page.locator('[data-mode-notice]').count()) === 0)
    await page.close()

    // ---- Community module switched off while in Community: back to the Personal bar, no dead Community bar (A1)
    page = await open(events)
    await page.locator('[data-mode="community"]').click(); await page.waitForTimeout(1500)
    await page.locator('[data-settings-gear]').click().catch(() => {}); await page.waitForTimeout(600)
    await openExtensions(page)
    await page.locator('[data-ext-module="community-mighty"]').evaluate((e) => e.click()); await page.waitForTimeout(800)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check(`${vw}: Community module off while in Community: Personal bar and switch say Personal`, (await page.locator('.tabs [data-go^="community:"]').count()) === 0 && (await page.locator('.tabs [data-go="web"]').count()) === 1 && (await mode(page)) === 'personal')
    await page.close()

    // ---- Extensions switch: off = Personal only
    page = await open(events)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await openExtensions(page)
    await page.locator('[data-ext-module="community-mode"]').evaluate((e) => e.click()); await page.waitForTimeout(600)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    check(`${vw}: module off: Personal bar, no dead Community bar`, (await page.locator('.tabs [data-go^="community:"]').count()) === 0)
    check(`${vw}: module off: no switch, no notice`, (await page.locator('[data-mode-pill]').count()) === 0 && (await page.locator('[data-mode-notice]').count()) === 0)
    await page.close()
    check(`${vw}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
