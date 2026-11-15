// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-press-share proof (headless, stock dev server): PORT=5432 SHOTS=<dir> EXE=<chromium headless shell> node event_press_share.mjs. */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? 5432
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const p2 = (n) => String(n).padStart(2, '0')
const now = new Date()
const day = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
const later = new Date(now.getTime() + 3 * 86400000)
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
const dayNext = iso(new Date(now.getTime() + 86400000))
const dayLater = `${later.getFullYear()}-${p2(later.getMonth() + 1)}-${p2(later.getDate())}`
const EV = [
  { id: 'e1', name: 'Winter Forum', from: `${day}T09:30`, to: dayLater, core: { from: dayNext, to: dayLater }, where: 'Innsbruck', conditions: 'Bring a mug', themes: ['soil'], createdAt: 1, attended: true, hosts: ['Jakob'] },
  { id: 'e2', name: 'Other Gathering', from: day, where: 'Graz', createdAt: 2, attended: true, hosts: ['Somebody Else'], fromLink: true, invitePolicy: 'hosts' },
]
const PEOPLE = [{ id: 'p1', name: 'Anna Berger', context: '', ring: 'friend', metAt: 1, lines: [] }]
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const evOf = async (page, id = 'e1') => (await stored(page)).events.find((e) => e.id === id)
// A touch held for 500 ms: what contextPress listens to.
const hold = async (page, selector) => {
  await page.locator(selector).evaluate((n) => n.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true, clientX: 10, clientY: 10 })))
  await page.waitForTimeout(650)
  // The long press may have replaced the view already: the release then has no target.
  await page.locator(selector).evaluate((n) => n.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true, clientX: 10, clientY: 10 })), null, { timeout: 500 }).catch(() => {})
  await page.waitForTimeout(150)
}
const overlap = (a, b) => a && b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
const openEvent = async (page, id) => {
  await page.locator('[data-go="events"]').first().tap(); await page.waitForTimeout(300)
  await page.locator('[data-cal-all]').first().tap(); await page.waitForTimeout(200)
  await page.locator(`[data-event="${id}"]`).first().tap(); await page.waitForTimeout(300)
}
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate(([ev, people]) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people, peers: [], log: [], events: ev })), [EV, PEOPLE])
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await openEvent(page, 'e1')

  // 1 since line
  check('since line: since 09:30 today', (await page.locator('[data-event-since]').innerText()).includes('since 09:30 today'))
  check('collapsed: no until, no core days', (await page.locator('[data-event-until]').count()) === 0 && (await page.locator('[data-event-core]').count()) === 0)
  await page.locator('[data-event-since]').tap(); await page.waitForTimeout(200)
  check('press expands: until and core days show', (await page.locator('[data-event-until]').count()) === 1 && (await page.locator('[data-event-core]').count()) === 1)
  await hold(page, '[data-event-since]')
  check('long press opens the time editor', (await page.locator('[data-event-times]').count()) === 1)
  const newTo = new Date(later.getTime() + 2 * 86400000)
  const toIso = `${newTo.getFullYear()}-${p2(newTo.getMonth() + 1)}-${p2(newTo.getDate())}T18:00`
  await page.locator('[data-event-times] input').nth(1).fill(toIso)
  await page.locator('.events-page').tap({ position: { x: 352, y: 3 } }); await page.waitForTimeout(300)   // focus leaves the editor
  check('staying longer saves on blur', (await evOf(page)).to === toIso)
  check('the editor closes once focus leaves it', (await page.locator('[data-event-times]').count()) === 0)
  await page.screenshot({ path: `${SHOTS}/event-press-share-360-since.png` })

  // 2 notifications
  const notify = page.locator('[data-event-notify]')
  await notify.scrollIntoViewIfNeeded()
  check('notifications on: aria-pressed true, not struck', (await notify.getAttribute('aria-pressed')) === 'true' && (await notify.evaluate((n) => getComputedStyle(n).textDecorationLine)) === 'none')
  await notify.tap(); await page.waitForTimeout(200)
  check('off: aria-pressed false and struck through', (await notify.getAttribute('aria-pressed')) === 'false' && (await notify.evaluate((n) => getComputedStyle(n).textDecorationLine)).includes('line-through'))
  check('off is stored on the event', (await evOf(page)).notify === false)
  await hold(page, '[data-event-notify]')
  check('long press: one sentence appears', (await page.locator('[data-event-notify-hint]').count()) === 1)

  // 3 share row, host toggle
  const link = page.locator('[data-event-share]'), qr = page.locator('[data-event-qr]')
  await link.scrollIntoViewIfNeeded()
  const [bl, bq] = [await link.boundingBox(), await qr.boundingBox()]
  check('link and QR icons sit side by side, labelled', !!bl && !!bq && Math.abs(bl.y - bq.y) < 4 && bl.x < bq.x && !!(await link.getAttribute('aria-label')) && !!(await qr.getAttribute('aria-label')))
  const host = page.locator('[data-event-host-toggle]')
  check('host toggle off: struck through plus the note', (await host.getAttribute('aria-pressed')) === 'false' && (await host.evaluate((n) => getComputedStyle(n).textDecorationLine)).includes('line-through') && (await page.locator('[data-event-host-off]').count()) === 1)
  check('no overlay: share icons, host toggle', !overlap(bl, bq) && !overlap(bq, await host.boundingBox()) && !overlap(bl, await host.boundingBox()))
  await host.tap(); await page.waitForTimeout(200)
  check('host toggle on: not struck, no note, preview shows the host link', (await host.getAttribute('aria-pressed')) === 'true' && (await page.locator('[data-event-host-off]').count()) === 0 && (await page.locator('[data-event-link-preview]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/event-press-share-360-share.png` })

  // 4 name reveal: nickname by long press
  await hold(page, '[data-event-reveal-seg]')
  check('long press on the name segment reaches Nickname', (await evOf(page)).nameReveal === 'nick' && (await page.locator('[data-event-name-reveal="nick"][aria-pressed="true"]').count()) === 1)
  await page.locator('[data-event-nickname]').fill('Jaki'); await page.locator('.events-page').tap({ position: { x: 352, y: 3 } }); await page.waitForTimeout(200)
  check('the nickname is saved on me', (await stored(page)).me.nickname === 'Jaki')

  // 5 advanced: offers and invite policy
  await page.locator('[data-event-advanced] summary').scrollIntoViewIfNeeded(); await page.locator('[data-event-advanced] summary').tap(); await page.waitForTimeout(200)
  const offerAttrs = ['support', 'resources', 'feed']
  check('three offers, all off and struck through', (await Promise.all(offerAttrs.map(async (k) => (await page.locator(`[data-event-offer-${k}]`).getAttribute('aria-pressed')) === 'false' && (await page.locator(`[data-event-offer-${k}]`).evaluate((n) => getComputedStyle(n).textDecorationLine)).includes('line-through')))).every(Boolean))
  await page.locator('[data-event-offer-feed]').tap(); await page.waitForTimeout(200)
  check('feed on is stored', (await evOf(page)).offers?.feed === true && (await page.locator('[data-event-advanced]').evaluate((n) => n.open)))
  await page.locator('[data-event-offer-support]').tap(); await page.waitForTimeout(200)
  check('support on shows the ask button on the page', (await page.locator('[data-event-ask-support]').count()) === 1)
  await page.locator('[data-event-invite-policy-opt="hosts"]').tap(); await page.waitForTimeout(200)
  check('invite policy hosts stored (answers-43: everyone is the default and is not stored)', (await evOf(page)).invitePolicy === 'hosts')
  check('a host still sees the invite box', (await page.locator('[data-cal-invitees]').count()) === 1)
  await page.screenshot({ path: `${SHOTS}/event-press-share-360-advanced.png` })

  // 6 static lines: long press edits that field
  await hold(page, '[data-event-where]')
  check('long press on the place opens the edit sheet on that field', (await page.locator('[data-event-save]').count()) === 1 && (await page.evaluate(() => document.activeElement?.value)) === 'Innsbruck')
  await page.locator('[data-event-save]').tap(); await page.waitForTimeout(300)
  check('saving keeps the local settings', (await evOf(page)).invitePolicy === 'hosts' && (await evOf(page)).notify === false)
  await page.locator('[data-event-conditions]').click(); await page.waitForTimeout(300)
  check('a single press on a line with nothing to expand edits it', (await page.locator('[data-event-save]').count()) === 1)
  await page.locator('[data-event-save]').tap(); await page.waitForTimeout(300)

  // 7 invite policy: an event I do not host
  await page.evaluate(() => document.querySelector('.hdr-back, [data-back]')?.click())
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
  await openEvent(page, 'e2')
  check('not a host, policy hosts: no invite box', (await page.locator('[data-cal-invitees]').count()) === 0)
  check('not a host: no invite policy control', (await page.locator('[data-event-invite-policy]').count()) === 0)

  // 8 desktop frame: no horizontal scroll, no overlap
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.waitForTimeout(300)
  check('1280: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: `${SHOTS}/event-press-share-1280.png` })
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
