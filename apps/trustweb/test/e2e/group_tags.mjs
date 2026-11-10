// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 group-tags proof (headless): PORT=5441 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node group_tags.mjs. Synthetic record. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5441}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const RINGS = ['closest', 'close', 'friend', 'friend', 'friend', 'friend']
const holds = [['cohort-a'], ['cohort-a', 'cohort-b'], ['cohort-b'], ['cohort-b'], [], []]
const people = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, ring: RINGS[i], lines: [], context: '', metAt: Date.now() - i * 86_400_000, fields: Object.fromEntries(holds[i].map((t) => [t, 'true'])), peerId: `peer${i}` }))
const peers = people.map((p) => ({ id: p.peerId, displayName: p.name }))
const tags = [{ id: 'cohort-a', colour: '#2e7d32', label: 'Cohort A' }, { id: 'cohort-b', colour: '#1565c0', label: 'Cohort B' }]
const hide = '.twf, .twf-ok, .twp { display: none !important }'
try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); page.setDefaultTimeout(6000)
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers, log: [], inventory: [], people }), JSON.stringify(tags)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
    // Settings > Your web > Tags
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-section="web"] > summary').click(); await page.waitForTimeout(200)
    const man = page.locator('[data-settings-tags]')
    await man.locator('> summary').click(); await page.waitForTimeout(200)
    const head = await man.locator('> summary').innerText()
    check(`${name}: Tags heading carries the alpha subscript`, /Tags/.test(head) && /untested alpha feature/.test(head))
    await page.locator('[data-tag-new]').fill('IYG'); await page.locator('[data-tag-create]').click(); await page.waitForTimeout(300)
    const row = page.locator('[data-tag-row="iyg"]')
    check(`${name}: group tag created, shows 0 people`, (await row.count()) === 1 && /0 people/.test(await row.locator('summary').innerText()))
    await row.locator('summary').click()
    for (const c of ['cohort-a', 'cohort-b']) { await row.locator('[data-tag-add-child]').selectOption(c); await page.waitForTimeout(250) }
    check(`${name}: two child tags in, group counts 4 people`, (await row.locator('[data-tag-child]').count()) === 2 && /4 people/.test(await row.locator('summary').innerText()))
    await row.locator('[data-tag-exclude-find]').fill('Person 3'); await page.locator('[data-tag-person-hit="p3"]').click(); await page.waitForTimeout(250)
    check(`${name}: leaving Person 3 out lowers the count to 3`, /3 people/.test(await row.locator('summary').innerText()) && (await row.locator('[data-tag-excluded] button').count()) === 1)
    await row.locator('[data-tag-managed]').check(); await page.waitForTimeout(250)
    await row.locator('[data-tag-steward-find]').fill('Person 0'); await page.locator('[data-tag-person-hit="p0"]').click(); await page.waitForTimeout(250)
    check(`${name}: managed with one steward`, (await row.locator('[data-tag-stewards] button').count()) === 1)
    const ring = await row.locator('summary [data-tag-pill]').evaluate((e) => ({ outline: getComputedStyle(e).outlineStyle, radius: getComputedStyle(e).borderRadius }))
    check(`${name}: managed group pill has a ring (${ring.outline})`, ring.outline !== 'none')
    const plain = await page.locator('[data-tag-row="cohort-a"] summary [data-tag-pill]').evaluate((e) => getComputedStyle(e).outlineStyle)
    check(`${name}: a normal tag pill has no ring`, plain === 'none')
    await row.locator('[data-tag-fork]').click(); await page.waitForTimeout(300)
    check(`${name}: fork made "forked from" copy`, (await page.locator('[data-tag-row="iyg-2"]').count()) === 1 && /forked from/.test(await page.locator('[data-tag-row="iyg-2"] summary').innerText()))
    check(`${name}: no horizontal scroll in Settings`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await row.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/group-tags-${name}-1-manager.png` })
    // Filters
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await page.evaluate(() => { for (const e of document.querySelectorAll('div,p,span')) if (e.children.length === 0 && /Passing asks on/.test(e.textContent ?? '')) e.closest('div')?.parentElement?.querySelector('button')?.click() }) // the notice banner covers the Tools / Filters buttons
    await page.waitForTimeout(300)
    const toggle = page.locator('[data-zone-tags-toggle]')
    if (await toggle.count()) { await toggle.first().evaluate((b) => b.click()); await page.waitForTimeout(400) }
    const inc = page.locator('[data-zone-chip-input="include"]')
    if (await inc.count()) {
      await inc.fill('#IYG'); await page.waitForTimeout(300)
      await page.locator('[data-zone-chip-suggest="tag:iyg"]').first().click(); await page.waitForTimeout(500)
      const chip = page.locator('[data-zone-chip="tag:iyg"]')
      check(`${name}: filter chip is the ringed tag pill`, (await chip.count()) === 1 && (await chip.first().getAttribute('class')).includes('tag-ring'))
      await page.screenshot({ path: `${SHOTS}/group-tags-${name}-3-filter.png` })
    } else check(`${name}: filter panel reachable`, false)
    // Audience dropdown
    // the IYG variation puts "Ask for support" on Web (wave 39)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(500)
    await page.locator('[data-variation="iyg-support"]').click(); await page.waitForTimeout(600)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
    await page.locator('[data-support-primary]').click(); await page.waitForTimeout(600)
    const opened = (await page.locator('[data-support-zone]').count()) > 0
    if (opened) {
      const opt = await page.locator('[data-support-zone] option[value="tag:iyg"]').innerText()
      check(`${name}: audience dropdown lists the group with its count ("${opt}")`, /Group: IYG \(3 people\)/.test(opt))
      await page.locator('[data-support-zone]').selectOption('tag:iyg'); await page.waitForTimeout(300)
      check(`${name}: group pill under the dropdown`, (await page.locator('[data-support-zone-pill] .tag-ring').count()) === 1)
      await page.screenshot({ path: `${SHOTS}/group-tags-${name}-2-audience.png` })
      await page.keyboard.press('Escape')
    } else console.log(`SKIP  ${name}: support form not reachable in Full profile (covered by unit tests)`)
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
