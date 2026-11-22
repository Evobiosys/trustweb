// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 community-documents (headless, stock dev only, synthetic record): on an event of a community, "by <community>" opens the Community view,
 * and its Home lists the community's documents (title link, who added it) with a count and an "All documents" button to the Docs page; a hidden
 * one is left out. Bounding boxes at 360x780 and 1280x900.
 * PORT=5475 EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> SHOTS=<dir> node community_documents.mjs
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
const doc = (id, title, by = 'me') => ({ id, title, url: `https://example.org/${id}`, by, at: 1 })
const events = [{ id: 'e1', name: 'Summer fest', from: '2027-06-01', where: 'Garden', createdAt: 1, attended: true, community: 'iyg' }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] } }, resources: [doc('d1', 'Charter'), doc('d2', 'Minutes', 'Ben'), doc('d3', 'Hidden plan')], mine: { owner: 'me', order: ['d1'], hidden: ['d3'] } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people: [], events, extData, twSettings: { extensions: { 'community-mighty': true } } })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5


try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    for (const t of ['Not now', 'No thanks']) await page.getByText(t).first().click({ timeout: 2500 }).catch(() => {})
    const tap = (sel) => (w < 600 ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    await tap('[data-go="events"]'); await page.waitForTimeout(300)
    await page.locator('[data-cal-all]').first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(200)
    await tap('[data-event="e1"]'); await page.waitForTimeout(400)
    await tap('[data-event-by-community="iyg"]'); await page.waitForTimeout(800)
    const sec = page.locator('[data-community-documents]')
    check(`${w}: the Community view shows the documents section`, (await sec.count()) === 1 && (await sec.isVisible()))
    check(`${w}: it counts 2 documents (the hidden one is left out)`, (await sec.getAttribute('data-community-documents')) === '2' && /2 documents/.test(await sec.textContent()))
    check(`${w}: my order first: Charter, then Minutes by Ben`, JSON.stringify(await page.locator('[data-community-document] a').allTextContents()) === '["Charter","Minutes"]' && (await page.locator('[data-community-document="d2"]').textContent()).includes('Ben'))
    const all = await page.locator('[data-community-documents-all]').boundingBox()
    check(`${w}: no document scroll; the All button sits inside the viewport`, (await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)) && !!all && all.x >= 0 && all.x + all.width <= w + 1)
    await page.screenshot({ path: `${SHOTS}/community-documents-${w}.png` })
    await page.locator('[data-community-documents-all]').click(); await page.waitForTimeout(400)
    check(`${w}: All documents opens the Docs page`, (await page.locator('[data-community-res="d1"]').count()) === 1)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
