/**
 * Wave 5 app flows, one part per owner item (2026-10-07). Parts are selected with PARTS=a,b,f (default: all).
 *   a  "Dismiss them" under "Got it": the embedded demo drops its seeded web, a live phone only what "Show demo content" added
 *   b  the demo's Install button carries "for yourself" beneath it (outside the button)
 *   f  the installed app (display-mode: standalone, navigator.standalone) hides "Add a device" and "Show demo content"
 *   g  the demo page removes a device (never the first); a removed middle phone's persona is reused, never doubled
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8984 ../../node_modules/.bin/tsx ../trustweb/test/e2e/wave5_flow.mjs
 */
import { launch, startApp, startPhone, tally } from '../helpers/e2e_harness.mjs'

const t = tally()
const PARTS = (process.env.PARTS || 'a,b,f,g').split(',')
const errors = []
const people = (page) => page.locator('.node:not(.you)')

async function newPage(browser, viewport, init) {
  const ctx = await browser.newContext({ viewport, permissions: ['microphone'] })
  if (init) await ctx.addInitScript(init)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page }
}

/** The embedded demo phone, as the demo page runs it (one iframe per device). */
const demoDevice = (page, n) => page.frameLocator(`iframe[title="Device ${n}"]`)

async function partB(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
  await page.goto(base + 'demo/')
  const btn = page.locator('[data-demo-install]')
  t.ok('b: the Install button is still named exactly "Install"', (await btn.innerText()).trim() === 'Install')
  const sub = page.locator('.demo-install-sub')
  t.ok('b: "for yourself" sits beneath it, outside the button', (await sub.innerText()).trim() === 'for yourself' && await btn.locator('.demo-install-sub').count() === 0)
  const [bb, sb] = await Promise.all([btn.boundingBox(), sub.boundingBox()])
  t.ok('b: it is below the button', sb.y >= bb.y + bb.height - 1, JSON.stringify([bb, sb]))
  const look = await page.evaluate(() => {
    const b = document.querySelector('[data-demo-install]'); const s = document.querySelector('.demo-install-sub')
    const cb = getComputedStyle(b); const cs = getComputedStyle(s)
    return { bSize: parseFloat(cb.fontSize), sSize: parseFloat(cs.fontSize), bWeight: Number(cb.fontWeight), sWeight: Number(cs.fontWeight), bColor: cb.color, sColor: cs.color }
  })
  t.ok('b: smaller font, lighter weight, another colour than the button', look.sSize < look.bSize && look.sWeight < look.bWeight && look.sColor !== look.bColor, JSON.stringify(look))
  t.ok('b: the topbar still holds ONE visible button (the device switch is hidden with one device)', await page.locator('.demo-topbar button:visible').count() === 1)
  t.ok('b: the button points at its sub-line as its description', (await btn.getAttribute('aria-describedby')) === (await sub.getAttribute('id')))
  await ctx.close()
}

async function partA(browser, base) {
  // Embedded demo: the seeded web goes, a person added meanwhile stays.
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
    await page.goto(base + 'demo/')
    const phone = demoDevice(page, 1)
    await phone.getByLabel('Your first name').fill('Jakob')
    await phone.getByRole('button', { name: 'Start on this phone' }).click()
    await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    const popup = phone.locator('.demo-friends')
    await popup.waitFor({ timeout: 5_000 })
    t.ok('a: the popup carries "Dismiss them" under "Got it"', (await popup.locator('.notice-actions button').allInnerTexts()).map((x) => x.trim()).join('|') === 'Got it|Dismiss them')
    const sizes = await popup.evaluate((p) => { const g = getComputedStyle(p.querySelector('.btn')); const d = getComputedStyle(p.querySelector('.notice-dismiss')); return { gs: parseFloat(g.fontSize), ds: parseFloat(d.fontSize), gc: g.color, dc: d.color } })
    t.ok('a: "Dismiss them" is smaller and another colour than "Got it"', sizes.ds < sizes.gs && sizes.dc !== sizes.gc, JSON.stringify(sizes))
    const before = await people(phone).count()
    t.ok('a: the seeded friends are there first', before >= 5, String(before))
    await phone.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
    await phone.getByPlaceholder('Name').first().fill('Max')
    await phone.getByRole('button', { name: 'Add to my web' }).click()
    await phone.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
    await popup.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {})
    if (await popup.isHidden()) t.ok('a: (the popup went by itself before Dismiss; part skipped)', false)
    else {
      await popup.locator('.notice-dismiss').click()
      await phone.locator('.toast.on').waitFor({ timeout: 3_000 })
      t.ok('a: after "Dismiss them" the seeded friends are gone', await people(phone).count() === 1, String(await people(phone).count()))
      t.ok('a: the person added meanwhile stays', await phone.locator('.node', { hasText: 'Max' }).count() === 1)
      t.ok('a: the popup is closed', await popup.isHidden())
    }
    await ctx.close()
  }
  // Live phone: "Show demo content", then "Dismiss them" takes only those; a real person stays.
  {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
    await startPhone(page, base, 'Real Person')
    await page.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
    await page.getByPlaceholder('Name').first().fill('Max')
    await page.getByRole('button', { name: 'Add to my web' }).click()
    await page.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
    const toggle = page.locator('.demo-toggle')
    await toggle.waitFor({ timeout: 5_000 })
    await toggle.click()
    const popup = page.locator('.demo-friends')
    await popup.waitFor({ timeout: 5_000 })
    t.ok('a: live phone, the demo friends came in next to Max', await people(page).count() > 1)
    await popup.locator('.notice-dismiss').click()
    await page.locator('.toast.on').waitFor({ timeout: 3_000 })
    t.ok('a: live phone, only Max is left after "Dismiss them"', await people(page).count() === 1 && await page.locator('.node', { hasText: 'Max' }).count() === 1)
    t.ok('a: live phone, the toggle offers "Show demo content" again', (await toggle.innerText()).trim() === 'Show demo content')
    await ctx.close()
  }
}

async function partF(browser, base) {
  const standaloneMedia = () => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { ...real(q), matches: true, media: q } : real(q))
  }
  const iosStandalone = () => { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }) }
  const cases = [['a browser tab', undefined, false], ['display-mode: standalone', standaloneMedia, true], ['navigator.standalone (iOS)', iosStandalone, true]]
  for (const [label, init, installed] of cases) {
    const { ctx, page } = await newPage(browser, { width: 1280, height: 900 }, init)
    await startPhone(page, base, 'Installed Person')
    await page.waitForTimeout(300)
    const addVisible = await page.locator('.add-device').count() > 0 && await page.locator('.add-device').isVisible()
    const toggleVisible = await page.locator('.demo-toggle').isVisible()
    t.ok(`f: ${label}: "Add a device" is ${installed ? 'hidden' : 'shown'}`, addVisible === !installed)
    t.ok(`f: ${label}: "Show demo content" (dock) is ${installed ? 'hidden' : 'shown'}`, toggleVisible === !installed)
    t.ok(`f: ${label}: "See it in action" stays`, await page.locator('.see-action').isVisible())
    await page.locator('nav.tabs button', { hasText: 'Web' }).click()
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByText('Settings', { exact: true }).first().click().catch(() => {})
    await page.locator('.sheet.on').waitFor({ timeout: 5_000 })
    const settingsHasDemo = await page.locator('.sheet.on').getByText('Show demo content').count() > 0
    t.ok(`f: ${label}: Settings ${installed ? 'offers no' : 'offers'} "Show demo content"`, settingsHasDemo === !installed)
    await ctx.close()
  }
}

async function partG(browser, base) {
  const { ctx, page } = await newPage(browser, { width: 1280, height: 900 })
  await page.goto(base + 'demo/')
  const titles = () => page.locator('iframe').evaluateAll((fs) => fs.map((f) => f.title))
  const devicesKey = () => page.evaluate(() => localStorage.getItem('trustweb.demo.devices.generic'))
  const first = demoDevice(page, 1)
  await first.getByLabel('Your first name').fill('Maya')
  await first.getByRole('button', { name: 'Start on this phone' }).click()
  await first.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('.dock .add').click()
  await page.locator('.dock .add').click()
  t.ok('g: three devices after two "Add a device"', JSON.stringify(await titles()) === JSON.stringify(['Device 1', 'Device 2', 'Device 3']), JSON.stringify(await titles()))
  t.ok('g: the first device has no remove, the others have one', await page.locator('.col').nth(0).locator('.remove-device').count() === 0 && await page.locator('.remove-device').count() === 2)
  t.ok('g: the page remembers the open devices as a list', (await devicesKey()) === 'holder,seeker,third', String(await devicesKey()))
  await page.locator('.col[data-persona="seeker"] .remove-device').click()
  t.ok('g: removing the middle phone leaves Device 1 and Device 3', JSON.stringify(await titles()) === JSON.stringify(['Device 1', 'Device 3']), JSON.stringify(await titles()))
  t.ok('g: its stored record is gone, the first device keeps its own', await page.evaluate(() => localStorage.getItem('trustweb.v1.generic.seeker') === null && localStorage.getItem('trustweb.v1.generic.holder') !== null))
  t.ok('g: the remembered list follows', (await devicesKey()) === 'holder,third', String(await devicesKey()))
  t.ok('g: Device 3 is in front, so the switch offers Device 1', /Switch to device 1/.test(await page.locator('.switch').innerText()))
  await page.locator('.switch').click()
  t.ok('g: from Device 1 the switch offers Device 3, numbered by the phone\'s own title, not by its position', /Switch to device 3/.test(await page.locator('.switch').innerText()), await page.locator('.switch').innerText())
  await page.locator('.dock .add').click()
  const after = await titles()
  t.ok('g: "Add a device" reuses the freed persona and never opens one twice', JSON.stringify(after) === JSON.stringify(['Device 1', 'Device 3', 'Device 2']) && new Set(after).size === after.length, JSON.stringify(after))
  await page.reload()
  await page.locator('iframe').first().waitFor()
  t.ok('g: after a reload the same three devices come back', JSON.stringify((await titles()).sort()) === JSON.stringify(['Device 1', 'Device 2', 'Device 3']), JSON.stringify(await titles()))
  // all but the first can go; the first stays whatever is pressed
  await page.locator('.col[data-persona="seeker"] .remove-device').click()
  await page.locator('.col[data-persona="third"] .remove-device').click()
  t.ok('g: with every added phone removed one device is left, and the page says "demo" again', JSON.stringify(await titles()) === JSON.stringify(['Device 1']) && /TrustWeb demo/.test(await page.title()), JSON.stringify(await titles()) + ' / ' + await page.title())
  t.ok('g: no remove is offered on the last one', await page.locator('.remove-device').count() === 0)
  await ctx.close()
}

async function main() {
  const app = await startApp(Number(process.env.TW_PORT || 8984))
  const browser = await launch()
  try {
    if (PARTS.includes('b')) await partB(browser, app.base)
    if (PARTS.includes('a')) await partA(browser, app.base)
    if (PARTS.includes('f')) await partF(browser, app.base)
    if (PARTS.includes('g')) await partG(browser, app.base)
  } finally {
    await browser.close()
    await app.stop()
  }
  t.ok('no page errors', errors.length === 0, errors.join(' | '))
  console.log(t.failures ? `\n${t.failures} FAILED` : '\nALL PASS')
  process.exit(t.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
