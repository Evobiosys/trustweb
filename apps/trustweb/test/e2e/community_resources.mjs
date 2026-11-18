// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave44c community-resources (headless, stock dev only, synthetic record): the community menu lists Resources and References; the community
 * Resources page reads "Resources of <community>" with Shared by me, New (badge) and General folded behind an expander; My resources shows every
 * tag as a chip and a tap filters by it; community filter mode scopes the Resources screen. Bounding boxes at 360x780 and 1280x900 (D-P06).
 * PORT=5471 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node community_resources.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5471}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, the eye menu lives on the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }, { id: 'garden', colour: '#aa3300', label: 'Garden' }]
const item = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: 1000, ...over })
const inventory = [
  item('i1', 'Mine tagged', { tagAudience: ['iyg'], createdAt: 5 }),
  item('i2', 'Fresh from Ben', { sharedBy: 'p1', communityId: 'iyg', createdAt: 9 }),
  item('i3', 'Plain thing', { tagAudience: ['garden'] }),
  item('i4', 'Tagged reference', { kind: 'reference', tagAudience: ['iyg'] }),
  item('i5', 'Other reference', { kind: 'reference' }),
]
const people = [{ id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, fields: { iyg: 'true' }, peerId: 'peer-p1' }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory, people, events: [], extData, twSettings: { extensions: { 'community-mighty': true } } })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const open = async (extra = (s) => s) => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [JSON.stringify(extra(JSON.parse(record))), JSON.stringify(tags)])
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      for (const t of ['Not now', 'No thanks']) await page.getByText(t).first().click({ timeout: 2500 }).catch(() => {})
      return page
    }
    const noScroll = async (page) => (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))

    // 1. the community menu
    let page = await open()
    await page.locator('.view-menu-btn').first().click(); await page.waitForTimeout(250)
    await page.locator('[data-mod-view="community"]').click(); await page.waitForTimeout(700)
    if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
    check(`${w}: the community menu has Resources and References`, (await page.locator('[data-community-nav="resources"]').count()) === 1 && (await page.locator('[data-community-nav="references"]').count()) === 1)
    await page.locator('[data-community-nav="resources"]').click(); await page.waitForTimeout(400)
    check(`${w}: title says Resources of IYG`, (await page.locator('[data-rs-title="resources"]').textContent()) === 'Resources of IYG')
    const keys = await page.locator('[data-rs-section]').evaluateAll((n) => n.map((x) => x.getAttribute('data-rs-section')))
    check(`${w}: sections in order shared, fresh, general`, JSON.stringify(keys) === '["shared","fresh","general"]', JSON.stringify(keys))
    check(`${w}: shared holds my tagged resource, new holds the received one with a badge of 1`, (await page.locator('[data-rs-list="shared"] [data-item="i1"]').count()) === 1 && (await page.locator('[data-rs-list="fresh"] [data-item="i2"]').count()) === 1 && (await page.locator('[data-rs-badge]').textContent()) === '1')
    check(`${w}: General is collapsed (my general resources are not listed)`, (await page.locator('[data-rs-list="general"]').count()) === 0 && (await page.locator('[data-rs-general-toggle]').getAttribute('aria-expanded')) === 'false')
    check(`${w}: the references are not on the Resources page`, (await page.locator('[data-item="i4"]').count()) === 0)
    const tog = await page.locator('[data-rs-general-toggle]').boundingBox()
    const ttl = await page.locator('[data-rs-title]').boundingBox()
    check(`${w}: no control overlays another; no document scroll`, !overlap(tog, ttl) && (await noScroll(page)))
    await page.screenshot({ path: `${SHOTS}/community-resources-${w}.png` })
    await page.locator('[data-rs-general-toggle]').click(); await page.waitForTimeout(200)
    check(`${w}: the expander shows General`, (await page.locator('[data-rs-list="general"] [data-item="i3"]').count()) === 1)
    // opening the received one marks it opened: it leaves New
    await page.locator('[data-rs-list="fresh"] [data-item="i2"]').click(); await page.waitForTimeout(400)
    const opened = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).inventory.find((i) => i.id === 'i2').openedAt)
    check(`${w}: opening a received item stamps openedAt`, typeof opened === 'number', String(opened))
    await page.close()

    // references
    page = await open()
    await page.locator('.view-menu-btn').first().click(); await page.waitForTimeout(250)
    await page.locator('[data-mod-view="community"]').click(); await page.waitForTimeout(700)
    if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
    await page.locator('[data-community-nav="references"]').click(); await page.waitForTimeout(400)
    check(`${w}: References of IYG lists the tagged reference, the other one sits in General`, (await page.locator('[data-rs-title="references"]').textContent()) === 'References of IYG' && (await page.locator('[data-rs-list="shared"] [data-item="i4"]').count()) === 1 && (await page.locator('[data-item="i5"]').count()) === 0)
    await page.close()

    // 3. my resources: every tag as a chip, a tap filters
    page = await open()
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${w}: My resources shows the tag chips of an item`, (await page.locator('[data-item-tags="i1"] [data-tag-chip="iyg"]').count()) === 1 && (await page.locator('[data-item-tags="i3"] [data-tag-chip="garden"]').count()) === 1)
    await page.locator('[data-item-tags="i3"] [data-tag-chip="garden"]').click(); await page.waitForTimeout(300)
    check(`${w}: tapping a chip filters by that tag`, (await page.locator('[data-item="i3"]').count()) >= 1 && (await page.locator('[data-item="i1"]').count()) === 0)
    await page.close()

    // community filter mode scopes the Resources screen
    page = await open((s) => ({ ...s, uiRings: { show: ['tag:iyg'] } }))
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(500)
    check(`${w}: community filter mode: the Resources screen is scoped`, (await page.locator('[data-scoped-resources="community"] [data-rs-title]').textContent()) === 'Resources of IYG' && (await page.locator('[data-rs-list="general"]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/community-resources-filter-${w}.png` })
    await page.close()
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
