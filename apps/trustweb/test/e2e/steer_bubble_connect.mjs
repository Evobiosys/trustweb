// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-bubble-connect: short hold of one bubble on another = introduce sheet, long hold = merge offer. PORT=5302 EXE=<chromium> PW=<playwright-core index.mjs> SHOTS=<dir> node steer_bubble_connect.mjs. Mouse at 1280x900, synthesized touch pointers at 360x780. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')
const URL = `http://127.0.0.1:${process.env.PORT ?? 5302}/`
const SHOTS = process.env.SHOTS
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, extra = {}) => ({ id, name, ring: 'friend', lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, peerId: `peer-${id}`, ...extra })
const peer = (id, name) => ({ id: `peer-${id}`, displayName: name, did: `did:peer:2.${id}`, nonceSelf: 'x', noncePeer: 'y', connectedAt: 1, blocked: false })
const record = (extra = {}) => JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [peer('p2', 'Kaja'), peer('p3', 'Ben'), peer('p4', 'Cleo')], log: [], inventory: [],
  people: [person('p2', 'Kaja'), person('p3', 'Ben'), person('p4', 'Cleo', { introducePermission: 'ask-first' })], ...extra })
const centre = async (page, id) => { const b = await page.locator(`.rings-wrap [data-pid="${id}"]:visible`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }

/** Drag p2 onto `to`, hold `ms` there, release. kind: mouse | touch. Returns after the release. */
async function drag(page, kind, from, to, ms, release = true) {
  const a = await centre(page, from); const b = await centre(page, to)
  if (kind === 'mouse') {
    await page.mouse.move(a.x, a.y); await page.mouse.down()
    await page.mouse.move(a.x + 12, a.y + 12, { steps: 3 }); await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.waitForTimeout(ms)
    if (release) await page.mouse.up()
    return
  }
  const fire = (type, target, p) => page.evaluate(([t, tg, q]) => {
    const e = new PointerEvent(t, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 7, clientX: q.x, clientY: q.y, button: 0, buttons: t === 'pointerup' ? 0 : 1 })
    ;(tg === 'window' ? window : document.querySelector(`.rings-wrap [data-pid="${tg}"]`)).dispatchEvent(e)
  }, [type, target, p])
  await fire('pointerdown', from, a); await page.waitForTimeout(400) // the 300 ms lift
  await fire('pointermove', 'window', { x: a.x + 12, y: a.y + 12 })
  for (let i = 1; i <= 8; i++) await fire('pointermove', 'window', { x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 })
  await page.waitForTimeout(ms)
  if (release) await fire('pointerup', 'window', b)
}

try {
  for (const [width, height, kind] of [[1280, 900, 'mouse'], [360, 780, 'touch']]) {
    const tag = `${width}`
    const page = await (await browser.newContext({ viewport: { width, height }, hasTouch: kind === 'touch' })).newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const fresh = async (rec = record()) => {
      await page.goto(URL); await page.waitForTimeout(1200)
      await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), rec)
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)
      await page.locator('[data-go="web"]').first().click(); await page.waitForTimeout(500)
    }
    await fresh()
    // 1. short hold: progress ring while held, sheet on release, nothing sent before Introduce
    await drag(page, kind, 'p2', 'p3', 700, false)
    check(`${tag}: progress ring drawn on the held-on bubble`, (await page.locator('.rings-wrap [data-pid="p3"] [data-hold-ring]').count()) === 1)
    check(`${tag}: no merge offer after a short hold`, (await page.locator('[data-merge-offer]').count()) === 0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/steer-bubble-connect-${tag}-ring.png` })
    await (kind === 'mouse' ? page.mouse.up() : page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7 }))))
    await page.waitForTimeout(400)
    check(`${tag}: ring gone after release`, (await page.locator('[data-hold-ring]').count()) === 0)
    const sheetText = await page.locator('[data-introduce-sheet]').innerText()
    check(`${tag}: sheet reads Introduce <dragged> to <dropped onto>, Ben is asked first`, /Introduce Kaja to Ben\?/.test(sheetText) && /Ben is asked first/.test(sheetText) && /Kaja gets Ben's code only after Ben accepts/.test(sheetText))
    check(`${tag}: nothing sent before the tap`, await page.evaluate(() => !JSON.parse(localStorage.getItem('trustweb.v1.me')).chats))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/steer-bubble-connect-${tag}-sheet.png` })
    check(`${tag}: sheet fits the viewport`, await page.locator('[data-introduce-yes]').evaluate((n) => { const r = n.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth }))
    await page.locator('[data-introduce-yes]').click(); await page.waitForTimeout(600)
    const sent = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return { chats: r.chats, log: r.log, pending: r.introPending } })
    const texts = (id) => (sent.chats?.[id]?.messages ?? []).map((m) => m.text)
    // stock has no relay: the request to Ben cannot go out, so the acceptance gate holds: Kaja is NOT given Ben's code, nothing stays pending
    check(`${tag}: no code reaches the dragged person before the dropped-onto one accepted`, !texts('peer-p2').some((t) => t.includes('did%3Apeer')))
    check(`${tag}: offline: says so, nothing pending`, /No connection/.test(await page.locator('body').innerText()) && !sent.pending)
    // 2. Cancel sends nothing
    await fresh()
    await drag(page, kind, 'p2', 'p3', 600)
    await page.waitForTimeout(300)
    await page.locator('[data-introduce-no]').click(); await page.waitForTimeout(300)
    check(`${tag}: Cancel sends nothing`, await page.evaluate(() => !JSON.parse(localStorage.getItem('trustweb.v1.me')).chats))
    // 3. ask-first person is refused: a toast says so, no sheet
    check(`${tag}: sheet gone after Cancel`, (await page.locator('.sheet.on [data-introduce-sheet]').count()) === 0)
    await drag(page, kind, 'p2', 'p4', 600)
    await page.waitForTimeout(300)
    check(`${tag}: ask-first person: no sheet`, (await page.locator('.sheet.on [data-introduce-sheet]').count()) === 0)
    check(`${tag}: ask-first person: says why`, /asked first/.test(await page.locator('body').innerText()))
    // 4. long hold = merge offer, no introduce sheet
    await fresh()
    await drag(page, kind, 'p2', 'p3', 1900, false)
    check(`${tag}: long hold shows the merge offer`, (await page.locator('[data-merge-offer]').count()) === 1)
    check(`${tag}: long hold has no introduce sheet`, (await page.locator('[data-introduce-sheet]').count()) === 0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/steer-bubble-connect-${tag}-merge.png` })
    await (kind === 'mouse' ? page.mouse.up() : page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', isPrimary: true, pointerId: 7 }))))
    await page.waitForTimeout(300)
    check(`${tag}: releasing the merge offer cancels it, nobody introduced`, await page.evaluate(() => !JSON.parse(localStorage.getItem('trustweb.v1.me')).chats))
    // 5. an introduced link adds the person into Friends & acquainted community members
    check(`${tag}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${tag}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
