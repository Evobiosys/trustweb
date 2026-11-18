// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c seen-through (headless, stock dev only): the bubble outside the rings opens "via Lena" with Ask Lena to introduce; the show-ask card; the tip card's optional "who has it"; the host's Introduce section. PORT=5475 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node seen_through.mjs. The wire round trip with three Nets: test/unit/seen_through_net.test.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5475}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const P = (id, name, ring, extra = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], fields: {}, ...extra })
const EV = { id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, organizers: ['me1x'] }
const box = (loc) => loc.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(URL); await page.waitForTimeout(1200)
    const did = await page.evaluate(async (path) => (await import(/* @vite-ignore */ path)).createIdentity('https://relay.invalid').did, `/@fs${process.cwd()}/../demo/src/did.ts`)
    const PEOPLE = [
      P('l1', 'Lena Test', 'close', { peerId: 'pl', events: ['e1'] }), P('k1', 'Kai Test', 'friend', { peerId: 'pk', events: ['e1'] }),
      P('o1', 'Omar Test', 'none', { via: 'l1', seen: { source: 'ask', at: 1, resource: 'Who has a ladder?' } }),
      P('z1', '', 'none', { via: 'l1', anonymous: true, seen: { source: 'ask', at: 2, resource: 'Who has a drill?' } }),
    ]
    const PEERS = [{ id: 'pl', displayName: 'Lena Test', did, ring: 'close', connectedAt: 1 }, { id: 'pk', displayName: 'Kai Test', did, ring: 'friend', connectedAt: 1 }]
    const seed = (extra = {}) => page.evaluate(([ev, ppl, peers, ex]) => (localStorage.setItem('trustweb.ui.keepcopy.offered', '1'), localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers, log: [], events: [ev], ...ex }))), [{ ...EV, organizers: ['Tester'] }, PEOPLE, PEERS, extra])
    const fresh = async (extra) => { await seed(extra); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1200) }

    // 1. bubbles outside the rings: named Omar, nameless one; a tap opens the card "via Lena" with Ask Lena to introduce
    await fresh()
    const omar = page.locator('[data-beyond="o1"]'), anon = page.locator('[data-beyond="z1"]')
    check(`${w}: both second-hand people drawn outside the rings`, (await omar.count()) === 1 && (await anon.count()) === 1)
    check(`${w}: the nameless one shows no name`, (await anon.locator('span').count()) === 0)
    await anon.click(); await page.waitForTimeout(400)
    const card = page.locator('[data-seen-card="z1"]')
    check(`${w}: a tap on the nameless bubble opens its card`, (await card.count()) === 1)
    if (await card.count()) {
      check(`${w}: the card says via Lena`, (await card.locator('[data-seen-via]').textContent()) === 'via Lena Test')
      check(`${w}: nameless: "Someone" and the resource chip`, (await card.locator('[data-seen-name]').innerText()) === 'Someone' && (await card.locator('[data-seen-resource]').innerText()) === 'Who has a drill?')
      check(`${w}: the intro ask is prefilled`, (await card.locator('[data-seen-prefill]').innerText()).includes('Could you introduce me to the person who can help with'))
      const btn = card.locator('[data-seen-ask]')
      check(`${w}: Ask Lena to introduce`, (await btn.innerText()) === 'Ask Lena Test to introduce' && await btn.isEnabled())
      const bb = await box(btn), cb = await box(card.locator('.btn-ghost').last())
      check(`${w}: the card's buttons do not overlap`, !overlap(bb, cb), JSON.stringify([bb, cb]))
      await page.screenshot({ path: `${SHOTS}/seen-through-card-${w}.png` })
      await card.locator('.btn-ghost').last().click(); await page.waitForTimeout(300)
    }
    await omar.click(); await page.waitForTimeout(400)
    check(`${w}: the named one's card names Omar`, (await page.locator('[data-seen-card="o1"] [data-seen-name]').innerText().catch(() => '')) === 'Omar Test')
    if (await page.locator('[data-seen-card="o1"]').count()) await page.locator('[data-seen-card="o1"] .btn-ghost').last().click()
    await page.waitForTimeout(300)

    // 2. a show ask: the friend asks whether the person further out may see me: a plain yes / no
    const held = (extra) => ({ qid: 'qseen' + Math.random().toString(36).slice(2, 8), peerId: 'pl', text: 'Who has a ladder?', fromName: 'Lena Test', through: [], doorName: null, relayed: false, matches: [], receivedAt: Date.now(), deadline: Date.now() - 1000, lateMode: true, arrivedLate: true, ...extra })
    await fresh({ heldAsks: [held({ show: 'Anna' })] })
    await page.locator('[data-show-card]').waitFor({ timeout: 8000 }).catch(() => undefined)
    check(`${w}: the show-ask card asks "may Anna see you?"`, (await page.locator('[data-show-card] .ask-lbl').innerText().catch(() => '')) === 'Lena Test asks: may Anna see you?')
    check(`${w}: yes and no`, (await page.locator('[data-show-yes]').count()) === 1 && (await page.locator('[data-show-no]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/seen-through-show-${w}.png` })
    if (await page.locator('[data-show-no]').count()) { await page.locator('[data-show-no]').click(); await page.waitForTimeout(300) }
    check(`${w}: a no is only a no`, (await page.locator('.ask .ask-done').count()) === 1)

    // 3. the tip card: the optional "who has it" box, small and greyed (P7)
    await fresh({ heldAsks: [held({ know: true })] })
    await page.locator('[data-know-who]').waitFor({ timeout: 8000 }).catch(() => undefined)
    const who = page.locator('[data-know-who]')
    check(`${w}: the tip card has the optional who box`, (await who.count()) === 1)
    if (await who.count()) {
      check(`${w}: it looks optional (greyed)`, Number(await who.evaluate((n) => getComputedStyle(n).opacity)) < 1)
      check(`${w}: my people are the suggestions`, (await page.locator('#seen-who-list option').count()) === 2)
      await page.screenshot({ path: `${SHOTS}/seen-through-know-${w}.png` })
    }

    // 4. the host's Introduce section on the event page
    await fresh()
    const opened = (await page.locator('[data-go="events"]').count()) > 0
    if (opened) {
      await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(300)
      await page.locator('[data-cal-all]').click().catch(() => undefined); await page.waitForTimeout(200)
      await page.locator('[data-event="e1"]').first().click().catch(() => undefined); await page.waitForTimeout(500)
    }
    const intro = page.locator('[data-seen-intro="e1"]')
    check(`${w}: the host sees "Introduce to the people here"`, (await intro.count()) === 1, `bar opened: ${opened}`)
    if (await intro.count()) {
      check(`${w}: attendees to pick, nobody seen-through`, (await intro.locator('option').allInnerTexts()).sort().join() === 'Kai Test,Lena Test')
      await intro.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${SHOTS}/seen-through-event-${w}.png` })
    }
    const sx = await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)
    check(`${w}: no sideways scroll`, sx)
    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
