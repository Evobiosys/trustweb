// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 2 (headless, stock dev server, synthetic record): Resources > Community has "+ Add resource" at the top of Shared by me (the
 * personal add row, pre-tagged with the community tag); every item there and in New reads "shared by <name> · <age>" (absolute time as tooltip);
 * the same on References. 360x780 and 1280x900, bounding boxes (D-P06).
 * PORT=5485 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<playwright-core index.mjs> node a44d_resources_plus.mjs
 */
import { quietKeepCopy, ringsFirst } from './rings_first.mjs'
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5485}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG', community: true }]
const H = 3600_000
const item = (id, text, over = {}) => ({ id, text, audience: 'friends', included: true, createdAt: Date.now() - 2 * H, ...over })
const inventory = [item('i1', 'Mine tagged', { tagAudience: ['iyg'] }), item('i2', 'Fresh from Ben', { sharedBy: 'p1', communityId: 'iyg', createdAt: Date.now() - 5 * H }), item('i4', 'Tagged reference', { kind: 'reference', tagAudience: ['iyg'] })]
const people = [{ id: 'p1', name: 'Ben Gruber', ring: 'close', lines: [], context: '', metAt: 1, fields: { iyg: 'true' }, peerId: 'peer-p1' }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'informal', organizers: ['me'] } } } }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory, people, events: [], extData, twSettings: { extensions: { 'community-mighty': true } } })
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(900)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); sessionStorage.clear() }, [record, JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
    for (const t of ['Not now', 'No thanks']) await page.getByText(t).first().click({ timeout: 2500 }).catch(() => {})
    const nav = async (key) => {
      if (!(await page.locator('[data-community-menu], [data-community-nav]').count())) {
        await page.locator('.view-menu-btn').first().click(); await page.waitForTimeout(250)
        await page.locator('[data-mod-view="community"]').click(); await page.waitForTimeout(700)
      }
      if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
      await page.locator(`[data-community-nav="${key}"]`).click(); await page.waitForTimeout(400)
    }
    await nav('resources')
    const shared = page.locator('[data-rs-section="shared"]')
    check(`${w}: "+ Add resource" sits at the top of Shared by me`, (await shared.locator('[data-rs-add]').textContent()) === '+ Add resource' && (await shared.locator(':scope > *').nth(1).getAttribute('data-rs-add-row')) === '')
    check(`${w}: my item reads "shared by me · 2h"`, (await page.locator('[data-item="i1"] [data-shared-by]').textContent()) === 'shared by me · 2h')
    check(`${w}: the received one reads "shared by Ben Gruber · 5h", absolute time in the tooltip`, (await page.locator('[data-item="i2"] [data-shared-by]').textContent()) === 'shared by Ben Gruber · 5h' && /\d/.test((await page.locator('[data-item="i2"] [data-shared-by]').getAttribute('title')) ?? ''))
    const add = await page.locator('[data-rs-add]').boundingBox(); const ttl = await page.locator('[data-rs-title]').boundingBox(); const first = await page.locator('[data-item="i1"]').boundingBox()
    check(`${w}: the add row overlays neither the title nor the first item`, !overlap(add, ttl) && !overlap(add, first))
    await page.screenshot({ path: `${SHOTS}/answers-44d-resources-plus-${w}.png` })
    await page.locator('[data-rs-add]').click(); await page.waitForTimeout(200)
    await page.locator('[data-rs-add-input]').fill('Sled for the kids'); await page.keyboard.press('Enter'); await page.waitForTimeout(400)
    const made = (await rec(page)).inventory.find((i) => i.text === 'Sled for the kids')
    check(`${w}: the new resource is tagged with the community, only it sees it`, !!made && JSON.stringify(made.tagAudience) === '["iyg"]' && made.audience === 'me', JSON.stringify(made))
    check(`${w}: it shows under Shared by me`, (await page.locator(`[data-rs-list="shared"] [data-item="${made?.id}"]`).count()) === 1)
    await nav('references')
    check(`${w}: References: the add row and "shared by me" too`, (await page.locator('[data-rs-add]').count()) === 1 && (await page.locator('[data-item="i4"] [data-shared-by]').textContent()) === 'shared by me · 2h')
    check(`${w}: no document scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
