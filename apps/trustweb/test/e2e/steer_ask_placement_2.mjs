// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-placement-2 (headless, stock dev only): sparkle back top right; community "Add event" opens the editor with no assistant; "Which AI answers?" switches in one tap.
 *  PORT=5295 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node steer_ask_placement_2.mjs */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5295}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const person = (id, name, ring, fields) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, peerId: `peer-${id}` })
const people = [person('p1', 'Ben Gruber', 'close', { iyg: 'true' }), person('p2', 'Cleo Maier', 'friend', { iyg: 'true' })]
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'] } } } }
const pc24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: 'k', model: 'qwen3.6:35b' }
const sub = { ref: 'r', claim: 'c', plan: 'ai', state: 'active', token: 'tok' }
const record = (advanced) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people, events: [], extData, ...(advanced ? { advanced } : {}), missedPopupOff: true })
const hide = '.twf, .twf-ok, .twp { display: none !important }'
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const errors = []
    const open = async (rec) => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [rec, JSON.stringify(tags)])
      await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)
      await page.getByText('No thanks').click({ timeout: 1500 }).catch(() => {})
      return page
    }
    // 1: sparkle back, far right, after the gear
    let page = await open(record())
    const labels = await page.locator('.hdr .hdr-right button').evaluateAll((bs) => bs.map((b) => (b.getAttribute('data-ai-button') !== null ? 'ai' : b.getAttribute('aria-label'))))
    check(`${w}: sparkle at the far right after settings`, labels.at(-1) === 'ai' && /settings/i.test(labels.at(-2) ?? ''), JSON.stringify(labels))
    check(`${w}: Ask pill still floats (no Ask in the bar)`, (await page.locator('.query-fab[data-open-query]:visible').count()) === 1)
    // 2: provider chooser inside Your AI (sparkle without an AI opens it)
    await page.locator('[data-ai-button]').click(); await page.waitForTimeout(400)
    check(`${w}: Your AI shows "Which AI answers?" with two options`, (await page.locator('[data-ai-group="choice"] [data-ai-choice]').count()) === 2)
    await page.locator('[data-ai-choice="claude"]').click(); await page.waitForTimeout(200)
    check(`${w}: Claude without a subscription says so and changes nothing`, (await page.locator('[data-ai-choice-note]').innerText()).length > 0 && (await page.locator('[data-ai-choice="own"]').getAttribute('aria-pressed')) === 'true')
    await page.screenshot({ path: `${SHOTS}/steer-ask-placement-2-ai-${w}.png` })
    await page.close()
    // 3: both set up -> one tap switches, remembered across reload
    page = await open(record({ ai: { ...pc24, sub } }))
    await page.locator('.hdr [aria-label*="ettings" i]').first().click(); await page.waitForTimeout(500)
    const pressed = (c) => page.evaluate((x) => document.querySelector(`[data-ai-choice="${x}"]`)?.getAttribute('aria-pressed'), c)
    const tapChoice = async (c) => { await page.evaluate((x) => document.querySelector(`[data-ai-choice="${x}"]`).click(), c); await page.waitForTimeout(250) }
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
    check(`${w}: own is the active choice`, (await pressed('own')) === 'true')
    await tapChoice('claude')
    check(`${w}: one tap makes Claude active`, (await pressed('claude')) === 'true' && (await pressed('own')) === 'false')
    let rec = await stored()
    check(`${w}: remembered, and the own endpoint is kept`, rec.advanced.ai.preset === 'tw-subscription' && rec.advanced.aiAlt.baseUrl === pc24.baseUrl)
    await tapChoice('own')
    rec = await stored()
    check(`${w}: back to own restores its address and key`, rec.advanced.ai.baseUrl === pc24.baseUrl && rec.advanced.ai.apiKey === 'k')
    await page.close()
    // 4: community Add event opens the editor, community preselected, no assistant gate
    page = await open(record())
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    if (w < 900 && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(150) }
    await page.locator('[data-community-add-event]').click(); await page.waitForTimeout(150)
    await page.locator('[data-community-add-event-kind="informal"]').click(); await page.waitForTimeout(600)
    check(`${w}: the event editor opens (name field + community picker)`, (await page.locator('[data-event-community]').count()) === 1)
    check(`${w}: that community is preselected`, (await page.locator('[data-event-community]').inputValue().catch(() => '')) === 'iyg')
    check(`${w}: no "Turn on the assistant" message`, !(await page.locator('body').innerText()).includes('Turn on the assistant'))
    await page.screenshot({ path: `${SHOTS}/steer-ask-placement-2-event-${w}.png` })
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
