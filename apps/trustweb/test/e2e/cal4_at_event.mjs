// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24 cal4 proof (headless, dev only): PORT=5453 SHOTS=<dir> EXE=<chromium headless shell> node cal4_at_event.mjs. */
import { chromium } from 'playwright-core'

const URL = `http://127.0.0.1:${process.env.PORT ?? 5453}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const p2 = (n) => String(n).padStart(2, '0')
const d = new Date()
const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const EVENT = { id: 'e1', name: 'Graz Fair', from: today, where: 'Graz', createdAt: 1, attended: true, people: ['p1'] }
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

async function run(label, viewport, mobile) {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const tap = (sel) => (mobile ? page.locator(sel).first().tap() : page.locator(sel).first().click())
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ev) => localStorage.setItem('trustweb.v1.me', JSON.stringify({
    v: 1, me: { id: 'me1', displayName: 'Jakob' }, log: [], inventory: [], peers: [], events: [ev],
    people: [{ id: 'p1', name: 'Ada', context: '', ring: 'acquaintance', metAt: 1, lines: [] }, { id: 'p2', name: 'Ben', context: '', ring: 'acquaintance', metAt: 1, lines: [], events: ['e1'] }],
  })), EVENT)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await tap('.events-btn'); await page.waitForTimeout(300)
  await tap('[data-cal-event="e1"]'); await page.waitForTimeout(300)
  check(`${label}: no frame before arriving`, (await page.locator('.at-event-frame').count()) === 0)
  await tap('[data-at-event-arrive]'); await page.waitForTimeout(300)
  check(`${label}: frame shows`, (await page.locator('.at-event-frame').count()) === 1)
  check(`${label}: record holds atEvent`, (await rec(page)).atEvent?.eventId === 'e1')
  for (const [name, sel] of [['Web', '[data-go="web"]'], ['Record', '[data-go="record"]'], ['Resources', '[data-go="inventory"]']]) {
    await tap(sel); await page.waitForTimeout(300)
    const box = await page.locator('.at-event-frame').boundingBox()
    const phone = await page.locator('.phone').boundingBox()
    check(`${label}: frame on ${name}, ~18% high, inside the phone`, !!box && box.height >= 96 && box.y >= phone.y && box.y + box.height <= phone.y + phone.height)
    await page.screenshot({ path: `${SHOTS}/cal4-${label}-${name.replace(' ', '')}.png` })
  }
  await tap('[data-go="record"]'); await page.waitForTimeout(300)
  check(`${label}: recording draft shows the event chip`, (await page.locator('[data-rec-event="e1"]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/cal4-${label}-chip.png` })
  // latch: tap opens, tap closes, a downward drag opens
  await tap('[data-at-event-latch]'); await page.waitForTimeout(200)
  check(`${label}: latch opens, lists Ada, Ben (new: none) and no shares`, await page.locator('[data-at-event-panel]').isVisible() && (await page.locator('[data-at-event-person]').count()) === 2)
  await page.screenshot({ path: `${SHOTS}/cal4-${label}-latch.png` })
  await tap('[data-at-event-latch]'); await page.waitForTimeout(200)
  check(`${label}: latch closes`, !(await page.locator('[data-at-event-panel]').isVisible()))
  const l = await page.locator('[data-at-event-latch]').boundingBox()
  await page.mouse.move(l.x + l.width / 2, l.y + l.height / 2); await page.mouse.down(); await page.mouse.move(l.x + l.width / 2, l.y + l.height / 2 + 60, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200)
  check(`${label}: a downward drag opens the latch`, await page.locator('[data-at-event-panel]').isVisible())
  await tap('[data-at-event-latch]'); await page.waitForTimeout(100)
  // bell
  await tap('[data-at-event-bell]'); await page.waitForTimeout(200)
  check(`${label}: bell off is stored`, (await rec(page)).atEvent.bell === false)
  await tap('[data-at-event-bell]'); await page.waitForTimeout(200)
  check(`${label}: bell on removes the key`, !('bell' in (await rec(page)).atEvent))
  // chip x
  await tap('[data-rec-event-drop]'); await page.waitForTimeout(200)
  check(`${label}: x removes the chip`, (await page.locator('[data-rec-event]').count()) === 0)
  // name opens the event sheet
  await tap('[data-at-event-name]'); await page.waitForTimeout(300)
  check(`${label}: tapping the name opens the event`, (await page.locator('[data-at-event-leave]').count()) >= 1 && (await page.locator('[data-cal-invitees]').count()) === 1)
  // leave
  await tap('.at-event-frame [data-at-event-leave]'); await page.waitForTimeout(300)
  check(`${label}: Leave clears the frame and the record`, (await page.locator('.at-event-frame').count()) === 0 && !(await rec(page)).atEvent)
  check(`${label}: no page errors`, errors.length === 0)
  await page.context().close()
}

/** Desk width (>= 900): the Desk covers the phone's controls, so only the layout is checked, with atEvent seeded. */
async function desk() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ev) => localStorage.setItem('trustweb.v1.me', JSON.stringify({
    v: 1, me: { id: 'me1', displayName: 'Jakob' }, log: [], inventory: [], peers: [], events: [ev], people: [], atEvent: { eventId: 'e1', since: Date.now() },
  })), EVENT)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(800)
  const box = await page.locator('.at-event-frame').boundingBox()
  const phone = await page.locator('.phone').boundingBox()
  check('1280: frame draws only inside .phone', !!box && box.x >= phone.x && box.x + box.width <= phone.x + phone.width && box.y >= phone.y && box.y + box.height <= phone.y + phone.height)
  await page.screenshot({ path: `${SHOTS}/cal4-1280.png` })
  await page.context().close()
}

try {
  await run('390', { width: 390, height: 844 }, true)
  await run('360', { width: 360, height: 780 }, true)
  await desk()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
