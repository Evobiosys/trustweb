/**
 * Wave 2 (2026-10-07) on the side-by-side demo page (app/demo/), local only:
 *   3. P12, P13: coming back to the demo shows it as it was left: the first
 *      phone's people and things, and every device that was open; the one
 *      [Install] button reads "Make it your personal account" and carries the
 *      notes, people and things over (nobody types them again); "Start over"
 *      forgets it all.
 *   5. P23, P24: the device switch (one tap, one "whoosh" to the other phone)
 *      and the scripted second-degree query (a yes at each hop, "through Jonas").
 * Ports: Vite 5282, relay on 0. TW_SHOTS=<dir> for screenshots (phone + desktop).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/demo_wave2.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
}

const device = (page, n) => page.frameLocator(`iframe[title="Device ${n}"]`)
const recordOf = (page, persona) => page.evaluate((p) => {
  const k = Object.keys(localStorage).find((x) => x.endsWith('.' + p))
  return k ? JSON.parse(localStorage.getItem(k)) : null
}, persona)
const holderRecord = (page) => recordOf(page, 'holder')
/** Who each of the two phones holds: names of people and peers, to see that a visit adds nobody twice. */
const webs = async (page) => Object.fromEntries(await Promise.all(['holder', 'seeker'].map(async (p) => {
  const r = await recordOf(page, p)
  return [p, { people: (r?.people ?? []).map((x) => x.name).sort(), peers: (r?.peers ?? []).map((x) => x.displayName).sort() }]
})))

/** Starts the first phone as Jakob, adds Max to his web and a thing to his inventory. */
async function startHolder(page) {
  const phone = device(page, 1)
  await phone.getByLabel('Your first name').fill('Jakob')
  await phone.getByRole('button', { name: 'Start on this phone' }).click()
  await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const gotIt = phone.getByRole('button', { name: 'Got it' })
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click()
  await phone.locator('.rings-wrap').click({ position: { x: 176 + 152, y: 176 } })
  await phone.getByPlaceholder('Name').first().fill('Max')
  await phone.getByRole('button', { name: 'Add to my web' }).click()
  await phone.locator('.node', { hasText: 'Max' }).waitFor({ timeout: 5_000 })
  await phone.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await phone.getByPlaceholder(/Motorbike/).fill('Ladder, 3 m, to lend')
  await phone.getByRole('button', { name: 'Add', exact: true }).click()
  await phone.locator('.inv-text', { hasText: 'Ladder, 3 m, to lend' }).waitFor({ timeout: 5_000 })
}

/** Item 3: a second visit shows the demo as it was left; Install carries it over; Start over forgets it. */
async function partComeBack(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => void d.accept())
  await page.goto(base + 'demo/')
  await startHolder(page)
  await page.locator('.dock .add').click()
  await device(page, 2).getByRole('button', { name: 'Connect', exact: true }).click({ timeout: 30_000 })
  await device(page, 2).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  ok('first visit: two devices, the second one started', await page.locator('iframe').count() === 2)
  // Settled: both phones hold each other as a peer (the pairing went over the relay).
  for (let i = 0; i < 100; i++) {
    const w = await webs(page)
    if (w.holder.peers.length === 1 && w.seeker.peers.length === 1) break
    await page.waitForTimeout(200)
  }
  const before = await webs(page)

  // The second visit: the same browser, the page opened again.
  await page.goto('about:blank')
  await page.goto(base + 'demo/')
  const phone = device(page, 1)
  await phone.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  ok('second visit: the first phone opens on Jakob\'s web, not the start screen', await phone.locator('.node', { hasText: 'Max' }).count() === 1)
  await phone.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  ok('second visit: the thing he noted is still there', await phone.locator('.inv-text', { hasText: 'Ladder, 3 m, to lend' }).count() === 1)
  await device(page, 2).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  ok('second visit: both devices are open again, the second one as it was', await page.locator('iframe').count() === 2)
  // The second phone is reopened on the first one's connect link: that must not pair them again or add anyone twice.
  await page.waitForTimeout(4_000)
  const after = await webs(page)
  ok('second visit: nobody added twice on either phone (same people, same peers)', JSON.stringify(after) === JSON.stringify(before) && before.holder.peers.length === 1 && before.seeker.peers.length === 1,
    JSON.stringify({ before, after }))
  await shot(page, 'w2-03-demo-second-visit')

  // The one button: "Make it your personal account", then the live app holds the notes.
  await page.locator('[data-demo-install]').click()
  await page.getByRole('dialog', { name: 'Make it your personal account' }).waitFor({ timeout: 5_000 })
  ok('Install reads "Make it your personal account"; nothing is typed again', /Nothing needs to be typed again/.test(await page.locator('.d2l').innerText())
    && (await page.locator('[data-demo-install]').getAttribute('title')) === 'Make it your personal account, then install TrustWeb')
  await shot(page, 'w2-04-make-it-personal')
  // Wave 3 (front door = per user): one honest line, a static link to the hosted service, "coming soon".
  const fd = page.locator('.d2l [data-d2l-front-door]')
  const fdLink = fd.locator('a')
  ok('wave 3: "Your own front door ... comes with the hosted service; coming soon" with a link to TrustInTheWeb.com (new tab, no opener, no referrer)',
    /Your own front door \(an always-on inventory that answers while your phone is off\) comes with the hosted service; coming soon/.test(await fd.innerText())
      && (await fdLink.innerText()) === 'TrustInTheWeb.com' && (await fdLink.getAttribute('href')) === 'https://trustintheweb.com/'
      && (await fdLink.getAttribute('target')) === '_blank' && /noopener/.test(await fdLink.getAttribute('rel')) && (await fdLink.getAttribute('referrerpolicy')) === 'no-referrer')
  await shot(page, 'w3-06-front-door-line')
  await page.locator('[data-d2l="clean"]').click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const live = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  ok('the personal account has Jakob, Max and the ladder: carried over, not retyped', live?.me?.displayName === 'Jakob'
    && live.people.some((p) => p.name === 'Max') && live.inventory.some((i) => i.text === 'Ladder, 3 m, to lend'), JSON.stringify({ people: live?.people?.map((p) => p.name), inv: live?.inventory?.map((i) => i.text) }))
  ok('the demo itself is kept (it can be opened again)', (await holderRecord(page))?.me?.displayName === 'Jakob')

  // Start over forgets the demo: one device, the start screen.
  await page.goto(base + 'demo/')
  await device(page, 1).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('.restart').click()
  await page.waitForLoadState('load')
  await device(page, 1).getByLabel('Your first name').waitFor({ timeout: 15_000 })
  ok('"Start over": one device, the start screen, the demo forgotten', await page.locator('iframe').count() === 1 && (await holderRecord(page)) === null)
  await ctx.close()
}

/** Item 5: the device switch (one tap, one whoosh) and the scripted second-degree query. */
async function partSwitchAndSecondDegree(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + 'demo/')
  ok('one device: no switch yet', await page.locator('[data-switch-device]').isHidden())
  await startHolder(page)
  await page.locator('.dock .add').click()
  await device(page, 2).getByRole('button', { name: 'Connect', exact: true }).click({ timeout: 30_000 })
  await device(page, 2).getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 20_000 })
  const sw = page.locator('[data-switch-device]')
  ok('two devices on a phone: the switch shows, top right next to Install, and names the other device', await sw.isVisible() && (await sw.innerText()).trim() === 'Switch to device 1')
  const top = async (n) => Math.round((await page.locator(`iframe[title="Device ${n}"]`).boundingBox()).y)
  await sw.click()
  const cls = await page.locator('.col').first().getAttribute('class')
  await page.waitForTimeout(450)
  ok('one tap: device 1 slides in (the whoosh) and lands at the top, under the bar', /whoosh/.test(cls) && Math.abs(await top(1) - 56) <= 12, String(await top(1)))
  ok('the switch now names device 2', (await sw.innerText()).trim() === 'Switch to device 2')
  await sw.click()
  await page.waitForTimeout(450)
  ok('and back: device 2 at the top after one tap, no finger scrolling', Math.abs(await top(2) - 56) <= 12, String(await top(2)))
  await shot(page, 'w2-06-device-whoosh')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  ok('reduced motion: no animation, still one step', await page.locator('.col.whoosh').evaluate((e) => getComputedStyle(e).animationName) === 'none')

  // The scripted second-degree query (the live phones do one hop): a yes at each hop, the answer "through Jonas".
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('.dock .see').click()
  await page.getByRole('tab', { name: '3 people' }).click()
  await page.locator('.wt-tick').nth(2).click()
  const relay = await page.locator('.wt-screen').nth(1).innerText()
  ok('hop 1: Jonas\'s yes is his standing setting, shown on his phone', /Sam asks your friends/.test(relay) && /you said yes once/.test(relay), relay)
  await page.locator('.wt-tick').nth(3).click()
  ok('hop 2: Maya decides for this ask', /Sam, through Jonas, asks/.test(await page.locator('.wt-screen').nth(2).innerText()))
  await page.locator('.wt-tick').nth(5).click()
  const answer = await page.locator('.wt-screen').nth(0).innerText()
  ok('the answer is labelled "through Jonas", from Maya\'s inventory, not Jonas\'s', /through Jonas/.test(answer) && /Not in Jonas's inventory: in Maya's/.test(answer), answer)
  ok('honest: scripted, the live phones do one hop', /scripted/.test(await page.locator('.wt-note').innerText()) && /one hop today/.test(await page.locator('.wt-note').innerText()))
  await shot(page, 'w2-07-second-degree')
  await ctx.close()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(5282, { relayPort: relay.port })
  let browser = null
  try {
    browser = await launch()
    await partComeBack(browser, vite.base)
    await partSwitchAndSecondDegree(browser, vite.base)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\ndemo-wave2: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
