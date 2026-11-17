// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter (headless, stock dev only): Ask your web is a page with Back, the filter view (zones, @ / # rows, Create tag overlay, Advanced degree + disabled Public + diagram), overlap sweep P06. PORT=5443 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node ask_page_filter.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5443}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const peer = (id, name) => ({ id, displayName: name, did: 'did:test:' + id, ring: 'friend', connectedAt: 1 })
const P = (id, name, ring) => ({ id: 'p-' + id, name, context: '', ring, metAt: 1, lines: [], fields: {}, peerId: id })
const PEOPLE = [P('cy', 'Cy Stone', 'closest'), P('di', 'Di Moss', 'close'), P('ed', 'Ed Park', 'friend'), P('an', 'Anna Huber', 'acquaintance')]
const rect = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } })
const apart = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([ppl, peers]) => {
      localStorage.setItem('trustweb.v1.colourtags', JSON.stringify([{ id: 'family', colour: '#7b1fa2', label: 'family' }]))
      localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers, log: [], inventory: [], events: [] }))
    }, [PEOPLE, PEOPLE.map((p) => peer(p.peerId, p.name))])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(900)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

    // 1. a plain entry, no floating pill; it opens a page of its own with Back
    check(`${w}: no floating Ask pill on the Web`, (await page.locator('.query-fab[data-open-query]').count()) === 0)
    const entry = page.locator('.hdr [data-open-query]:visible').first()
    check(`${w}: the Ask entry is a header button`, (await entry.count()) === 1)
    await entry.click(); await page.waitForTimeout(400)
    check(`${w}: Ask your web is its own page (not an overlay on the Web)`, (await page.locator('[data-ask-page]').count()) === 1 && (await page.locator('.screen.askpage').count()) === 1 && (await page.locator('.screen.querying').count()) === 0 && (await page.locator('.rings-wrap').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/ask-page-filter-page-${w}.png` })

    // 2. the filter view: zones as "this zone and more intimate"
    check(`${w}: three zones and the wording`, (await page.locator('[data-aud-zone]').count()) === 3 && (await page.locator('[data-aud-zone-hint]').innerText()) === 'this zone and more intimate')
    check(`${w}: the word Tag is not in the zone picker`, !/\btag\b/i.test(await page.locator('[data-aud-zones]').innerText()))
    await page.locator('[data-aud-zone="close"]').click(); await page.waitForTimeout(200)
    check(`${w}: pressing a zone stores the cut`, (await store()).askAudience?.zone === 'close', JSON.stringify((await store()).askAudience))

    // 3. add by @ and exclude by #, suggestions while typing
    await page.locator('[data-aud-input="add"]').fill('@ann'); await page.waitForTimeout(150)
    check(`${w}: @ann suggests the person`, (await page.locator('[data-aud-found="add"] [data-aud-pick="person:p-an"]').count()) === 1)
    await page.locator('[data-aud-found="add"] [data-aud-pick="person:p-an"]').click(); await page.waitForTimeout(250)
    check(`${w}: the person became an Also include chip`, (await page.locator('[data-aud-chips="add"] [data-aud-chip="person:p-an"]').count()) === 1)
    await page.locator('[data-aud-input="exclude"]').fill('#fam'); await page.waitForTimeout(150)
    await page.locator('[data-aud-found="exclude"] [data-aud-pick="tag:family"]').click(); await page.waitForTimeout(250)
    const a1 = (await store()).askAudience
    check(`${w}: stored add and exclude chips`, a1?.add?.join() === 'person:p-an' && a1?.exclude?.join() === 'tag:family', JSON.stringify(a1))

    // 4. "Create tag" row -> a small overlay -> people -> the tag lands on the row
    await page.locator('[data-aud-input="add"]').fill('#climbing'); await page.waitForTimeout(150)
    await page.locator('[data-aud-create="climbing"]').click(); await page.waitForTimeout(300)
    check(`${w}: the Create tag overlay lists the people`, (await page.locator('[data-aud-new-person]').count()) === 4)
    await page.locator('[data-aud-new-person="p-ed"]').click()
    await page.screenshot({ path: `${SHOTS}/ask-page-filter-newtag-${w}.png` })
    await page.locator('[data-aud-new-save]').click(); await page.waitForTimeout(300)
    const s2 = await store()
    check(`${w}: the new tag is added to the row and held by the picked person`, s2.askAudience?.add?.includes('tag:climbing') && s2.people.find((p) => p.id === 'p-ed')?.fields?.climbing === true, JSON.stringify(s2.askAudience))

    // 5. Advanced: degree wording from the zone, Public disabled, the steps diagram
    await page.locator('[data-aud-advanced] summary').click(); await page.waitForTimeout(200)
    check(`${w}: the degree wording follows the zone`, (await page.locator('[data-reach-choice="fof"]').innerText()) === 'Friends of friends', await page.locator('[data-reach-choice="fof"]').innerText())
    check(`${w}: Public shows, disabled, with the reason`, (await page.locator('[data-reach-public][disabled]').count()) === 1 && /Mastodon/.test(await page.locator('[data-reach-public]').innerText()))
    await page.locator('[data-reach-choice="three"]').click(); await page.waitForTimeout(250)
    check(`${w}: three steps draws the diagram with 3 reached rings`, (await page.locator('[data-steps-diagram="3"] [data-step-on]').count()) === 3 && (await page.locator('[data-steps-diagram] title').count()) === 1)
    await page.locator('[data-reach-choice="custom"]').click(); await page.waitForTimeout(250)
    check(`${w}: custom shows the chosen sets around the rings`, (await page.locator('[data-steps-diagram] [data-set-add]').count()) === 1 && (await page.locator('[data-steps-diagram] [data-set-exclude]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/ask-page-filter-advanced-${w}.png` })

    // 6. zone cut: Closest few set -> the support form never offers a wider zone below it
    await page.locator('[data-ask-mode="support"]').click(); await page.waitForTimeout(300)
    await page.locator('[data-aud-zone="closest"]').click(); await page.waitForTimeout(200)
    check(`${w}: support, Closest few = 1 person (Close friends and allies not reached)`, (await page.locator('[data-support-count]').getAttribute('data-support-count')) === '1')
    await page.locator('[data-aud-zone="close"]').click(); await page.waitForTimeout(200)
    check(`${w}: support, Close friends and allies = 2 people`, (await page.locator('[data-support-count]').getAttribute('data-support-count')) === '2')
    await page.screenshot({ path: `${SHOTS}/ask-page-filter-support-${w}.png` })

    // 7. P06: nothing overlays anything; the bottom bar sits at the bottom
    const hdr = await page.locator('.hdr .hdr-right > *:visible').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }))
    check(`${w}: header buttons do not overlap`, hdr.every((a, i) => hdr.every((b, j) => i === j || apart(a, b))))
    const tabs = await rect(page, '.tabs'); const scroll = await rect(page, '.ask-page')
    check(`${w}: the bottom bar does not overlay the page`, apart(tabs, scroll), JSON.stringify({ tabs, scroll }))
    check(`${w}: the bottom bar sits at the bottom of the window`, Math.abs(tabs.b - h) <= 1 || w > 600, JSON.stringify(tabs))
    check(`${w}: no sideways scroll`, !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)))

    // 8. Back returns to the Web
    await page.locator('.hdr .back').click(); await page.waitForTimeout(400)
    check(`${w}: Back returns to the Web`, (await page.locator('[data-ask-page]').count()) === 0 && (await page.locator('.rings-wrap').count()) >= 1)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
