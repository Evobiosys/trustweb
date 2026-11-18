// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation (headless, stock dev only): custom reach on the main Ask form, the "show who was asked" switch under Advanced, the incoming "x people asked" + tip card, the escalate step, physical thing needs a place. PORT=5303 SHOTS=<dir> EXE=<chromium headless shell> PLAYWRIGHT_PACKAGE=<path> node ask_escalation.mjs. */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5303}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + (info ?? '')}`); if (!cond) failed = true }
const peer = (id, name, ring, did) => ({ id, displayName: name, did, ring, connectedAt: 1 })
const P = (id, name, ring) => ({ id: 'p-' + id, name, context: '', ring, metAt: 1, lines: [], fields: {}, peerId: id })
const PEOPLE = [P('cy', 'Cy Stone', 'closest'), P('di', 'Di Moss', 'close'), P('ed', 'Ed Park', 'friend')]
try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e.stack ?? e).split('\n').slice(0, 3).join(' <- ')))
    await page.goto(URL); await page.waitForTimeout(1200)
    const held = { qid: 'qheld000001', peerId: 'cy', text: 'Who has a ladder?', fromName: 'Cy Stone', through: [], doorName: null, relayed: false, matches: [], receivedAt: Date.now(), deadline: Date.now() - 1000, lateMode: true, arrivedLate: true, know: true, askedNames: ['Di Moss', 'Ed Park'] }
    // A real did:peer:2 for the connection (the held ask's answer key is derived from it).
    const did = await page.evaluate(async (path) => (await import(/* @vite-ignore */ path)).createIdentity('https://relay.invalid').did, `/@fs${process.cwd()}/../demo/src/did.ts`)
    PEOPLE.forEach((p) => { p.did = did })
    await page.evaluate(([ppl, peers, heldAsk]) => {
      localStorage.setItem('trustweb.v1.me', JSON.stringify({
        v: 1, me: { id: 'me1', displayName: 'Tester' }, people: ppl, peers, log: [], events: [], heldAsks: [heldAsk],
        inventory: [{ id: 'r1', text: 'Ladder', audience: 'fof', included: true, createdAt: 1 }],
      }))
    }, [PEOPLE, PEOPLE.map((p) => peer(p.peerId, p.name, p.ring, did)), held])
    await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(1500)
    const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

    // A. an incoming second-round ask: the card asks for a tip; "x people asked" opens the names
    await page.locator('.ask [data-know-note]').waitFor({ timeout: 8000 }).catch(() => undefined)
    const askVisible = (await page.locator('.ask [data-know-note]').count()) === 1
    check(`${w}: the incoming second-round ask shows the tip box (held ask restored)`, askVisible)
    if (askVisible) {
      check(`${w}: "2 people asked" is a tappable line`, (await page.locator('[data-asked-who]').innerText()) === '2 people asked')
      check(`${w}: the names are hidden until the tap`, (await page.locator('[data-asked-who-list]').isHidden()))
      await page.locator('[data-asked-who]').click(); await page.waitForTimeout(150)
      check(`${w}: a tap lists who was asked`, (await page.locator('[data-asked-who-list] li').allInnerTexts()).join() === 'Di Moss,Ed Park')
      check(`${w}: Send tip waits for a tip`, await page.locator('[data-know-send]').isDisabled())
      await page.locator('[data-know-note]').fill('Ask Dora'); await page.waitForTimeout(100)
      check(`${w}: a tip enables Send`, await page.locator('[data-know-send]').isEnabled())
      await page.screenshot({ path: `${SHOTS}/steer-ask-escalation-know-${w}.png` })
      await page.locator('[data-know-no]').click(); await page.waitForTimeout(300)
      check(`${w}: a no is only a no`, (await page.locator('.ask .ask-done').count()) === 1)
      await page.locator('.overlay.on .ask .btn-ghost').last().click(); await page.waitForTimeout(300)
    }

    // B. the Ask page: How far? sits on the main form, Custom stays Custom for 2
    await page.locator('[data-open-query]:visible').first().click(); await page.waitForTimeout(500)
    check(`${w}: How far? is on the main form, not under Advanced`, (await page.locator('[data-reach]').count()) === 1 && (await page.locator('[data-aud-advanced] [data-reach]').count()) === 0)
    await page.locator('[data-reach-choice="custom"]').click(); await page.waitForTimeout(250)
    check(`${w}: Custom shows its number box`, (await page.locator('[data-reach-custom]').count()) === 1)
    await page.locator('[data-reach-custom]').fill('2'); await page.locator('[data-reach-custom]').dispatchEvent('change'); await page.waitForTimeout(300)
    const s1 = await store()
    check(`${w}: Custom 2 stays Custom and travels 2 steps`, s1.askReach === 2 && s1.askReachCustom === true && (await page.locator('[data-reach-choice="custom"][aria-checked="true"]').count()) === 1 && (await page.locator('[data-reach-custom]').count()) === 1, JSON.stringify([s1.askReach, s1.askReachCustom]))
    await page.locator('[data-reach-choice="fof"]').click(); await page.waitForTimeout(250)
    check(`${w}: a fixed choice leaves Custom`, (await store()).askReachCustom === undefined && (await page.locator('[data-reach-custom]').count()) === 0)
    await page.screenshot({ path: `${SHOTS}/steer-ask-escalation-reach-${w}.png` })

    // C. Advanced: show who was asked (default on), switch off per ask
    await page.locator('[data-aud-advanced] summary').click(); await page.waitForTimeout(200)
    check(`${w}: the show-who-was-asked switch is on by default`, (await page.locator('[data-ask-show-asked] [role=switch]').getAttribute('aria-checked')) === 'true')
    await page.locator('[data-ask-show-asked] [role=switch]').click(); await page.waitForTimeout(250)
    check(`${w}: switching it off is stored`, (await store()).askShowAsked === false)

    // D. a queued escalation (from an assistant) waits for Send or Discard
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.askEscalate = { text: 'Who has a drill?', zone: 'close' }; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.waitForTimeout(1200)
    if ((await page.locator('[data-escalate-queued]').count()) === 0) { await page.locator('[data-open-query]:visible').first().click(); await page.waitForTimeout(500) }
    check(`${w}: a queued second round shows Send and Discard`, (await page.locator('[data-escalate-queued]').count()) === 1)
    await page.locator('[data-escalate-queued-discard]').click(); await page.waitForTimeout(250)
    check(`${w}: Discard drops it`, (await store()).askEscalate === undefined && (await page.locator('[data-escalate-queued]').count()) === 0)


    // E. a physical thing needs a place: empty = one "Are you sure?" dialog (Continue / Add place)
    await page.reload(); await page.waitForTimeout(1500)
    await page.locator('[data-pid="p-di"]').last().click(); await page.waitForTimeout(600)
    await page.locator('[data-card-shares-cat]').first().click(); await page.waitForTimeout(300)
    check(`${w}: the card lists the resource with a physical button`, (await page.locator('[data-card-shares-physical="r1"]').count()) === 1)
    await page.locator('[data-card-shares-physical="r1"]').click(); await page.locator('[data-card-shares-place-input]').press('Enter'); await page.waitForTimeout(300)
    check(`${w}: no place asks once: Are you sure?`, (await page.locator('[data-place-continue]').count()) === 1 && /Without a place nobody can pick it up/.test(await page.locator('.sheet.on').innerText()))
    await page.screenshot({ path: `${SHOTS}/steer-ask-escalation-place-${w}.png` })
    await page.locator('[data-place-add]').click(); await page.waitForTimeout(300)
    check(`${w}: Add place changes nothing`, (await store()).inventory[0].physical === undefined)
    await page.locator('[data-card-shares-cat]').first().click(); await page.waitForTimeout(200)
    if ((await page.locator('[data-card-shares-physical="r1"]').count()) === 0) await page.locator('[data-card-shares-cat]').first().click()
    await page.locator('[data-card-shares-physical="r1"]').click(); await page.locator('[data-card-shares-place-input]').fill('Garage, Linz'); await page.locator('[data-card-shares-place-input]').press('Enter'); await page.waitForTimeout(300)
    const it = (await store()).inventory[0]
    check(`${w}: a place saves without a dialog`, it.physical === true && it.place === 'Garage, Linz' && (await page.locator('.sheet.on [data-place-continue]').count()) === 0, JSON.stringify(it))

    check(`${w}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
