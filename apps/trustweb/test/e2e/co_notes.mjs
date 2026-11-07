// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 co-notes-core live proof (headless, dev only): PORT=5441 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.js> node co_notes.mjs. */
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium

const URL = `http://127.0.0.1:${process.env.PORT ?? 5441}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Ben', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, did: 'did:key:zBen' }] })
try {
  for (const [name, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { viewport: { width: 1280, height: 860 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1500)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(600)
    const tap = (sel) => (name === '360' ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    const noScroll = async (label) => check(`${name}: ${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const snap = (n) => page.screenshot({ path: `${SHOTS}/co-notes-core-${name}-${n}.png` })

    // Off by default: the Notes page shows no co-notes UI.
    await tap('[data-tab="inventory"], .tab:has-text("Resources")'); await page.waitForTimeout(500)
    await tap('.view-menu-btn'); await tap('[data-view-drop] [data-view="notes"], [data-screen-view="notes"]'); await page.waitForTimeout(500)
    check(`${name}: off by default, no list`, (await page.locator('[data-co-list]').count()) === 0)

    // Switch on in Settings > Extensions.
    await tap('.hdr-btn[aria-label*="ettings"], [data-settings-open]'); await page.waitForTimeout(500)
    await page.locator('[data-settings-group="general"] > summary').click(); await page.waitForTimeout(200)
    await page.locator('[data-settings-section="extensions"] summary').first().click(); await page.waitForTimeout(200)
    check(`${name}: Settings has the Extensions row`, (await page.locator('[data-ext-co-notes]').count()) === 1)
    await snap('settings')
    await page.locator('[data-ext-co-notes]').click(); await page.waitForTimeout(300)
    check(`${name}: switched on is stored`, await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).coNotesOn === true))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
    if (await page.locator('.sheet.on').count()) await page.locator('.veil.on').click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)

    check(`${name}: on shows the list and New co-note`, (await page.locator('[data-co-new]').count()) === 1)
    await snap('notes-page')
    await tap('[data-co-new]'); await page.waitForTimeout(500)
    check(`${name}: editor opens as a page`, (await page.locator('[data-co-editor]').count()) === 1)
    check(`${name}: honest label`, (await page.locator('[data-co-honest]').innerText()).includes('within seconds when both are online'))

    // Three blocks, indent the second.
    await page.locator('[data-co-title]').fill('Retreat plan'); await page.locator('[data-co-title]').blur()
    await page.locator('[data-co-first]').click(); await page.waitForTimeout(200)
    await page.keyboard.type('Book the house'); await page.keyboard.press('Enter')
    await page.keyboard.type('Ask about food'); await page.keyboard.press('Enter')
    await page.keyboard.type('Vegetarian'); await page.keyboard.press('Tab'); await page.waitForTimeout(200)
    // An @ chip.
    await page.keyboard.type(' for @Be'); await page.waitForTimeout(200)
    check(`${name}: @ lists Ben`, (await page.locator('[data-co-hit="p2"]').count()) === 1)
    await page.locator('[data-co-hit="p2"]').click(); await page.keyboard.type('please'); await page.keyboard.press('Enter'); await page.keyboard.press('Backspace'); await page.waitForTimeout(300)
    await page.locator('[data-co-text]').first().click(); await page.waitForTimeout(100)
    await page.locator('[data-co-input]').blur(); await page.waitForTimeout(200)
    const rows = await page.locator('[data-co-block]').count()
    check(`${name}: three blocks`, rows === 3)
    const depths = await page.locator('[data-co-block]').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-level')))
    check(`${name}: third is indented`, JSON.stringify(depths) === JSON.stringify(['1', '1', '2']))
    check(`${name}: chip rendered, underlined`, (await page.locator('[data-co-chip]').count()) >= 1 && (await page.locator('.co-text [data-co-chip]').first().evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'underline')
    await noScroll('outline'); await snap('outline')

    // Toolbar under the focused block (mobile and desktop).
    await page.locator('[data-co-text]').nth(0).click({ position: { x: 4, y: 4 } }); await page.waitForTimeout(200)
    check(`${name}: toolbar under the focused block`, (await page.locator('[data-co-toolbar] [data-co-tool]').count()) === 4)
    await page.locator('[data-co-tool="indent"]').click(); await page.waitForTimeout(200)
    check(`${name}: toolbar indent works`, JSON.stringify(await page.locator('[data-co-block]').evaluateAll((rs) => rs.map((r) => r.getAttribute('aria-level')))) === JSON.stringify(['1', '2', '3']))
    await page.locator('[data-co-tool="outdent"]').click(); await page.waitForTimeout(200)
    await page.locator('[data-co-input]').blur()

    // Plain text and back.
    await page.locator('[data-co-mode="text"]').click(); await page.waitForTimeout(200)
    const txt = await page.locator('textarea[data-co-input]').inputValue()
    check(`${name}: plain text is the outline`, txt.startsWith('- Book the house\n- Ask about food\n  - Vegetarian for @[Ben]'))
    await page.locator('textarea[data-co-input]').fill(`${txt}\n- Added in text`); await page.locator('[data-co-mode="outline"]').click(); await page.waitForTimeout(300)
    check(`${name}: back to outline keeps the new line and the chip`, (await page.locator('[data-co-block]').count()) === 4 && (await page.locator('[data-co-chip]').count()) >= 1)
    await noScroll('after text round trip')

    // The "…" page.
    await page.locator('[data-co-more]').click(); await page.waitForTimeout(300)
    check(`${name}: … page has Logseq field, copy, import`, (await page.locator('[data-co-logseq]').count()) === 1 && (await page.locator('[data-co-copy-logseq]').count()) === 1 && (await page.locator('[data-co-import]').count()) === 1)
    await page.locator('[data-co-logseq]').fill('mygraph/6543b2a1-1234-4abc-8def-0123456789ab'); await page.locator('[data-co-logseq-save]').click(); await page.waitForTimeout(200)
    check(`${name}: Open in Logseq link`, (await page.locator('[data-co-open-logseq]').getAttribute('href')) === 'logseq://graph/mygraph?block-id=6543b2a1-1234-4abc-8def-0123456789ab')
    await noScroll('more page'); await snap('more')
    await page.goBack(); await page.waitForTimeout(300)

    // Add people.
    await page.locator('[data-co-add-people]').click(); await page.locator('[data-co-people-input]').fill('Be'); await page.waitForTimeout(200)
    check(`${name}: Add people lists Ben`, (await page.locator('[data-co-add="p2"]').count()) === 1)
    await page.locator('[data-co-add="p2"]').click(); await page.waitForTimeout(200)
    check(`${name}: Ben is a participant`, await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).coNotes[0].people.some((p) => p.name === 'Ben')))
    await snap('people')
    // A chip opens the person's card.
    await page.locator('[data-co-text] [data-co-chip]').first().click(); await page.waitForTimeout(600)
    check(`${name}: tapping a chip opens Ben's card`, (await page.locator('[data-co-editor]').count()) === 0 && (await page.locator('body').innerText()).includes('Ben'))
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
    await page.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
