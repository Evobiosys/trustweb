// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 event-desires live proof (headless, dev only): PORT=5461 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.js> node event_desires.mjs. The Your AI endpoint is stubbed with page.route; no model runs. */
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium

const PORT = process.env.PORT ?? 5461
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, did) => ({ id, name, context: '', ring: 1, metAt: 1, lines: [], did })
const EV = { id: 'e1', name: "New Year's retreat", from: '2026-12-27', to: '2027-01-08', core: { from: '2026-12-30', to: '2027-01-04' }, where: 'Hut', createdAt: 1, attended: true, people: ['p2', 'p3'] }
const PAST = { id: 'e2', name: 'Autumn walk', from: '2026-10-01', where: 'Woods', createdAt: 1, attended: true, people: ['p2'] }
const AI = { preset: 'custom', baseUrl: 'http://stub.invalid/v1', apiKey: '', model: 'stub-model' }
const record = (withAi) => ({ v: 1, me: { id: 'me1', displayName: 'Anna' }, peers: [], log: [], inventory: [], coNotesOn: true, events: [EV, PAST], people: [P('p2', 'Ben', 'did:key:zBen000000002'), P('p3', 'Cara', 'did:key:zCara00000003')], ...(withAi ? { advanced: { ai: AI } } : {}) })
try {
  for (const [name, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { viewport: { width: 1280, height: 860 } }],
  ]) {
    const page = await (await browser.newContext(opts)).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    let body = ''
    await page.route('**/stub.invalid/**', (route) => {
      body = route.request().postData() ?? ''
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: '- Sauna daily (honours Anna, Ben)\n- Long hikes (honours Ben)\n- Tension: quiet mornings against the sauna' } }] }) })
    })
    await page.goto(URL); await page.waitForTimeout(1500)
    // Ben has already written two lines (one private on his phone, so only the shared one is here) and arrived through the relay.
    await page.evaluate(async (rec) => {
      const d = await import('/src/ext/co_notes/co_doc.ts')
      const x = await import('/src/ext/co_notes/co_desires.ts')
      const ben = { did: 'did:key:zBen000000002', name: 'Ben' }
      const anna = { did: 'local', name: 'Anna' }
      let doc = x.desiresDoc({ kind: 'desires', ev: { id: 'e1', name: "New Year's retreat" }, me: ben, others: [anna], at: 1 })
      const h = x.ensureMine(doc, ben, 1)
      const l = d.insertAfter(h.doc, h.id, 'long hikes', ben, 1, { share: 'event' })
      doc = d.indent(l.doc, l.id, ben)
      rec.coNotes = [doc]
      localStorage.setItem('trustweb.v1.me', JSON.stringify(rec))
    }, record(true))
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    const tap = (sel) => (name === '360' ? page.locator(sel).first().tap() : page.locator(sel).first().click())
    const noScroll = async (label) => check(`${name}: ${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const snap = (n) => page.screenshot({ path: `${SHOTS}/event-desires-${name}-${n}.png` })
    const openEvent = async (id) => { await tap('[data-go="events"]'); await page.waitForTimeout(300); await tap('[data-cal-all]'); await page.waitForTimeout(200); await tap(`[data-event="${id}"]`); await page.waitForTimeout(300) }

    await openEvent('e1')
    check(`${name}: event view shows the core line`, (await page.locator('[data-event-core]').innerText()) === 'Core time 30 Dec – 4 Jan')
    check(`${name}: Desires offered, Memories not yet`, (await page.locator('[data-co-desires]').count()) === 1 && (await page.locator('[data-co-memories]').count()) === 0)
    await noScroll('event view'); await snap('event')

    await tap('[data-event-edit]'); await page.waitForTimeout(300)
    check(`${name}: form has the two core date fields`, (await page.locator('input[type=date]').count()) === 4 && (await page.locator('input[type=date]').nth(2).inputValue()) === '2026-12-30')
    await tap('[data-event-save]'); await page.waitForTimeout(300)

    await tap('[data-co-desires]'); await page.waitForTimeout(500)
    check(`${name}: Desires opens as a note titled for the event`, (await page.locator('[data-co-title]').inputValue()) === "Desires: New Year's retreat")
    const heads = await page.locator('.co-head').allInnerTexts()
    check(`${name}: one block per person (me and Ben), my chip first-created`, heads.length === 2 && heads.includes('@Anna') && heads.includes('@Ben'))
    check(`${name}: Ben's line is read-only (no input, no share button)`, (await page.locator('[data-co-text]:has-text("long hikes")').getAttribute('tabindex')) === null && (await page.locator('[data-co-share-plain="event"]').count()) === 1 && (await page.locator('[data-co-share]').count()) === 0)
    await page.locator('[data-co-text]:has-text("long hikes")').click(); await page.waitForTimeout(150)
    check(`${name}: tapping Ben's line opens no editor`, (await page.locator('[data-co-input]').count()) === 0)

    await tap('[data-co-add-wish]'); await page.waitForTimeout(200)
    await page.keyboard.type('sauna every day'); await page.keyboard.press('Enter')
    await page.keyboard.type('quiet mornings'); await page.keyboard.press('Enter')
    await page.keyboard.type('a private thing'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); await page.locator('[data-co-title]').click(); await page.waitForTimeout(300)
    check(`${name}: Tab and Shift+Tab leave my lines under my name`, (await page.locator('[data-co-block]:has([data-co-share])').evaluateAll((r) => r.map((e) => e.getAttribute('aria-level')))).every((l) => l === '2'))
    const chips = page.locator('[data-co-share]')
    check(`${name}: three lines, all start at "Only me"`, (await chips.count()) === 3 && (await chips.evaluateAll((c) => c.map((e) => e.textContent))).every((t) => t === 'Only me'))
    await chips.nth(0).click(); await page.waitForTimeout(150)
    await chips.nth(1).click(); await page.waitForTimeout(150); await chips.nth(1).click(); await page.waitForTimeout(150)
    const labels = await page.locator('[data-co-share]').evaluateAll((c) => c.map((e) => e.textContent))
    check(`${name}: chip cycles me -> event -> zones`, JSON.stringify(labels) === JSON.stringify(['People at this event', 'My trust zones', 'Only me']))
    check(`${name}: share chips are underlined`, (await page.locator('[data-co-share]').first().evaluate((e) => getComputedStyle(e).textDecorationLine)) === 'underline')
    await noScroll('desires'); await snap('desires')

    await tap('[data-co-combine]'); await page.waitForTimeout(900)
    check(`${name}: request holds shared lines only`, body.includes('sauna every day') && body.includes('quiet mornings') && body.includes('long hikes') && !body.includes('a private thing'))
    const ai = await page.locator('[data-co-ai]').count()
    const text = await page.locator('.co-editor').innerText()
    check(`${name}: Combined block, marked AI-made`, ai >= 4 && text.includes('Combined by my AI (stub-model,') && text.includes('Tension: quiet mornings against the sauna'))
    check(`${name}: the stored AI lines are shared with the event`, await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).coNotes[0].blocks.filter((b) => b.ai).every((b) => b.share === 'event')))
    await noScroll('combined'); await snap('combined')

    // Past event: Memories.
    await page.goBack(); await page.waitForTimeout(300)
    await openEvent('e2')
    check(`${name}: past event offers Memories`, (await page.locator('[data-co-memories]').count()) === 1)
    await tap('[data-co-memories]'); await page.waitForTimeout(400)
    check(`${name}: Memories note, no Combine`, (await page.locator('[data-co-title]').inputValue()) === 'Memories: Autumn walk' && (await page.locator('[data-co-combine]').count()) === 0)
    await snap('memories')

    // No endpoint: the plain notice, no model call.
    await page.evaluate((rec) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.advanced; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) }, null)
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
    body = ''
    await openEvent('e1'); await tap('[data-co-desires]'); await page.waitForTimeout(400)
    await tap('[data-co-combine]'); await page.waitForTimeout(400)
    check(`${name}: no endpoint -> "Set up Your AI in Settings first", no call`, (await page.getByText('Set up Your AI in Settings first').count()) >= 1 && body === '')
    check(`${name}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
