// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b profile-page (headless, stock dev server only, synthetic record): Settings > Your Profile opens the page; Discoverable opens its dependent
 * toggle on and collapses it off; the V expander holds the phone-book fields, bio, links; visibility chips cycle; nothing overlaps (D-P06).
 *   cd apps/demo && PORT=5452 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> ../../node_modules/.bin/tsx ../trustweb/test/e2e/profile_page.mjs
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const BASE = `http://127.0.0.1:${process.env.PORT ?? 5452}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const hit = (a, b) => !(a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5)
const REC = { v: 1, me: { id: 'me1', displayName: 'Ada Lovelace' }, people: [], peers: [], log: [], inventory: [] }

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.route((u) => u.pathname.startsWith('/directory'), (route) => route.fulfill({ status: 204 }))
    await page.goto(BASE); await page.waitForTimeout(1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), REC)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(300)
    await page.locator('[data-settings-gear]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-setting="ui.profile"]').click(); await page.waitForTimeout(600)

    check(`${w}: Your profile is a page`, (await page.locator('[data-profile-page]').count()) === 1)
    check(`${w}: the minimum shows: name + Discoverable; the rest is behind the V expander`, (await page.locator('[data-profile-name]').isVisible()) && (await page.locator('[data-social-switch=discoverable]').isVisible()) && (await page.locator('[data-profile-more]').isHidden()))
    check(`${w}: Discoverable off: its dependent toggle is collapsed and its label struck through (P2)`, (await page.locator('[data-social-more]').isHidden()) && (await page.locator('[data-social=discoverable] b.tw-off').count()) === 1)

    // 1. Discoverable on opens the dependent toggle by itself, off collapses it
    await page.locator('[data-social-switch=discoverable]').click(); await page.waitForTimeout(700)
    check(`${w}: Discoverable on opens "Open to connect" by itself`, (await page.locator('[data-social-more]').isVisible()) && (await page.locator('[data-social-switch=open]').isVisible()))
    await page.locator('[data-social-switch=open]').click(); await page.waitForTimeout(300)
    check(`${w}: a dependent toggle that is off is struck through`, (await page.locator('[data-social=open] b.tw-off').count()) === 1)
    await page.locator('[data-social-switch=discoverable]').click(); await page.waitForTimeout(600)
    check(`${w}: Discoverable off collapses it again`, await page.locator('[data-social-more]').isHidden())

    // 2. the V expander: phone-book entry, bio, links
    await page.locator('[data-profile-expander]').click(); await page.waitForTimeout(200)
    check(`${w}: the expander shows prefix, first, middle, last, suffix, nickname`, (await Promise.all(['prefix', 'first', 'middle', 'last', 'suffix', 'nickname', 'bio', 'pronouns', 'languages', 'location'].map((k) => page.locator(`[data-profile-field=${k}]`).isVisible()))).every(Boolean))
    await page.locator('[data-profile-field=prefix]').fill('Countess'); await page.locator('[data-profile-field=prefix]').blur()
    await page.locator('[data-profile-field=nickname]').fill('Ad'); await page.locator('[data-profile-field=nickname]').blur()
    await page.locator('[data-profile-field=bio]').fill('Maths and engines'); await page.locator('[data-profile-field=bio]').blur()
    let s = await store()
    check(`${w}: fields are stored (nickname in me.nickname)`, s.me.profile?.fields?.prefix === 'Countess' && s.me.nickname === 'Ad' && s.me.profile?.fields?.bio === 'Maths and engines', JSON.stringify(s.me))
    // 3. visibility chip: me -> trusted -> discoverable
    const chip = page.locator('[data-profile-vis=bio]')
    check(`${w}: a chip starts at "Only me"`, (await chip.getAttribute('data-vis')) === 'me')
    await chip.click(); await chip.click()
    s = await store()
    check(`${w}: two presses reach "Directory" and store it`, (await chip.getAttribute('data-vis')) === 'discoverable' && s.me.profile?.vis?.bio === 'discoverable', JSON.stringify(s.me.profile))
    // links
    await page.locator('[data-profile-link-label]').fill('Site'); await page.locator('[data-profile-link-url]').fill('https://example.test/ada'); await page.locator('[data-profile-link-add]').click(); await page.waitForTimeout(200)
    check(`${w}: a link is added, with a rel=me check button`, (await page.locator('[data-prof-link]').count()) === 1 && (await page.locator('[data-profile-link-check]').count()) === 1, await page.locator('[data-prof-link]').evaluateAll((n) => n.map((x) => x.outerHTML.slice(0, 120)).join(' || ')))
    await page.locator('[data-profile-link-url]').fill('http://example.test/x'); await page.locator('[data-profile-link-label]').fill('Bad'); await page.locator('[data-profile-link-add]').click(); await page.waitForTimeout(200)
    check(`${w}: a non-https link is refused`, (await page.locator('[data-prof-link]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/profile-page-${w}.png` })

    // D-P06: no control overlays another, no document scroll
    const boxes = await page.locator('[data-profile-page] input, [data-profile-page] textarea, [data-profile-page] button, [data-profile-page] label').evaluateAll((ns) => ns.filter((n) => n.offsetParent !== null).map((n) => { const r = n.getBoundingClientRect(); return { n: n.getAttribute('data-profile-field') ?? n.className, x: r.x, y: r.y, width: r.width, height: r.height } }))
    let clash = null
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) clash = clash ?? `${boxes[i].n} x ${boxes[j].n}`
    check(`${w}: no control overlays another`, clash === null, clash)
    check(`${w}: the document does not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${w}: no page errors`, errors.length === 0, errors.join('|'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
