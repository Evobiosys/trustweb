/**
 * Wave 6 (U1) ACCEPTANCE: friends of friends, live, three headless phones over the test relay.
 *   Ann -- Ben -- Cleo. Cleo notes "Ladder, 3 m, to lend" (acquaintances; by default it travels one degree on).
 *   1. Ann asks with "How far? Friends of friends" (maxHops 2), Ben lets Ann's asks go on: Cleo is asked
 *      "Ann asks, through Ben", says yes, and Ann gets the ladder marked "through Ben", from Ben, at Ben's moment.
 *   2. "My contacts" (maxHops 1, the default; the ask of the build before): Cleo is never asked, nothing comes back.
 *   3. Ben's "Pass their asks on" off: Cleo is never asked, and Ann's answer comes at the same moment as in 1.
 *   4. A cycle (Cleo also connected to Ann, "3 steps"): Ann is never asked her own question, Cleo once.
 *   5. "Ask only my direct contacts" (Settings > Advanced) wins over any reach: the chooser is held, Cleo is never asked.
 *   Plus the item sheet (X top right, on/off switch, audience, degrees), the (i) under Settings, Ben's log.
 * The rest of the protocol (an old-build ask, two paths, a front door, every deadline) is in the unit tests
 * (test/unit/hops_net.test.mjs, hops.test.mjs, services/trustweb-peer/test/peer.test.mjs).
 *
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8970). TW_SHOTS=<dir> saves screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/hops_three_phones.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const SHOTS = process.env.TW_SHOTS
const LADDER = 'Ladder, 3 m, to lend'
const c = checker()
const ok = c.ok
const errors = []

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
async function shot(page, name) {
  if (!SHOTS) return
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

/** `joiner` opens `host`'s code and connects (one scan): both hold the other as an acquaintance. */
async function connect(host, joiner, joinerName, fresh) {
  await tab(host, 'Web')
  await host.locator('.hdr [aria-label^="Show my code"]').click()
  await host.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await host.getAttribute('.qrwrap', 'data-payload')
  const before = (await record(host)).peers.length
  await joiner.goto(url)
  if (fresh) {
    await joiner.getByLabel('Your first name').fill(joinerName)
    await joiner.getByRole('button', { name: 'Connect', exact: true }).click()
  }
  await acceptAdd(joiner)
  await until(async () => (await record(host)).peers.length === before + 1)
  await host.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await joiner.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
}

/** On `page`, the person card of `name`: switch "Pass their asks on" to `on`. */
async function setPassOn(page, name, on) {
  await tab(page, 'Web')
  await page.locator('.node', { hasText: name }).first().click()
  const row = page.locator('.sheet.on [data-pass-on]')
  await row.waitFor({ timeout: 5_000 })
  if ((await row.getAttribute('aria-pressed')) !== String(on)) await row.click()
  await page.locator(`.sheet.on [data-pass-on][aria-pressed="${on}"]`).waitFor({ timeout: 5_000 })
  await closeSheet(page)
}

/** Ann's ask with the reach chosen in the dock; resolves with the result card's text and how long it took. */
async function ask(page, text, reachChoice) {
  await tab(page, 'Web')
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Call into your web', exact: true }).click()
  await page.locator('.query-dock').waitFor({ timeout: 5_000 })
  if (reachChoice) await page.locator(`.query-dock [data-reach-choice="${reachChoice}"]`).click()
  await page.locator('.query-dock textarea').fill(text)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Call into my web' }).click()
  await page.locator('.card.asked .outcome').waitFor({ timeout: 330_000 })
  return { text: await page.locator('.card.asked').innerText(), ms: Date.now() - t0 }
}

/** Waits for the ask overlay on `page` and answers it; resolves with the overlay's text, or null when none came. */
async function answerAsk(page, share, ms = 90_000) {
  const shown = await page.locator('.overlay.on').waitFor({ timeout: ms }).then(() => true).catch(() => false)
  if (!shown) return null
  const text = await page.locator('.overlay').innerText()
  await page.getByRole('button', { name: share ? 'Share these' : 'Don\'t share' }).click()
  await page.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  return text
}

const logCount = async (page, text) => ((await record(page)).log ?? []).filter((e) => e.text === text).length

async function itemSheetChecks(cleo) {
  await tab(cleo, 'My Resources')
  await cleo.getByPlaceholder(/Motorbike/).fill(LADDER)
  await cleo.getByRole('button', { name: 'Add', exact: true }).click()
  const row = cleo.locator('.inv', { hasText: LADDER })
  await row.waitFor({ timeout: 5_000 })
  ok('inventory row: the X and the on/off switch sit on the right, the degrees pill next to the audience', await row.locator('.inv-side .x').count() === 1
    && await row.locator('.inv-side [role="switch"][aria-checked="true"]').count() === 1 && /\+1 degree/.test(await row.locator('.inv-actions').innerText()))
  ok('the (i) just below Settings explains who can ask and how far, with the tech-setup example', await (async () => {
    await cleo.locator('[data-cascade-info]').click()
    const t = await cleo.locator('.sheet.on').innerText()
    await closeSheet(cleo)
    return /Who can ask, and how far/.test(t) && /friends of friends/i.test(t) && /tech setup/.test(t) && /"no" looks exactly like "no match"/.test(t)
  })())
  await shot(cleo, 'u1-01-inventory-row')
  await row.locator('.inv-text').click()
  const sheet = cleo.locator('.sheet.on')
  await sheet.locator('[data-item-degrees]').first().waitFor({ timeout: 5_000 })
  ok('item sheet: X top right, then the switch, then who can ask, then how far', await sheet.locator('.item-head-side [data-item-close]').count() === 1
    && await sheet.locator('.item-head-side [data-item-switch]').count() === 1
    && await sheet.evaluate((n) => { const t = n.textContent; return t.indexOf('Who can ask about it') > 0 && t.indexOf('Who can ask about it') < t.indexOf('How far it may travel') }))
  ok('an acquaintances line travels one degree by default (friends of friends)', (await sheet.locator('[data-item-degrees="fof"]').getAttribute('aria-pressed')) === 'true')
  await cleo.waitForTimeout(500)
  await shot(cleo, 'u1-02-item-sheet')
  await sheet.locator('[data-item-degrees="contacts"]').click()
  await until(async () => (await record(cleo)).inventory[0].degrees === 0)
  ok('choosing "My contacts only" stores degrees 0', (await record(cleo)).inventory[0].degrees === 0)
  await cleo.locator('.sheet.on [data-item-degrees="fof"]').click()
  await until(async () => (await record(cleo)).inventory[0].degrees === 1)
  ok('and back to friends of friends (1)', (await record(cleo)).inventory[0].degrees === 1)
  await cleo.locator('.sheet.on [data-item-switch]').click()
  await until(async () => (await record(cleo)).inventory[0].included === false)
  ok('the switch pauses it', (await record(cleo)).inventory[0].included === false)
  await cleo.locator('.sheet.on [data-item-switch]').click()
  await until(async () => (await record(cleo)).inventory[0].included === true)
  await cleo.locator('.sheet.on [data-item-close]').click()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(PORT, { relayPort: relay.port })
  const browser = await launch()
  try {
    const ann = await newPhone(browser, errors)
    const ben = await newPhone(browser, errors)
    const cleo = await newPhone(browser, errors)
    await startPhone(ann, vite.base, 'Ann')
    await connect(ann, ben, 'Ben', true)
    await connect(ben, cleo, 'Cleo', true)
    ok('Ann - Ben - Cleo: a chain, Ann and Cleo do not know each other', (await record(ann)).peers.length === 1 && (await record(ben)).peers.length === 2 && (await record(cleo)).peers.length === 1)
    await itemSheetChecks(cleo)

    // the dock's chooser
    await tab(ann, 'Web')
    await ann.getByRole('button', { name: 'Call into your web', exact: true }).click()
    ok('"How far?": my contacts by default, five choices', (await ann.locator('[data-reach-choice]').count()) === 5
      && (await ann.locator('[data-reach-choice="contacts"]').getAttribute('aria-checked')) === 'true' && !('askReach' in (await record(ann))))
    await ann.locator('[data-reach-choice="custom"]').click()
    await ann.locator('[data-reach-custom]').fill('5')
    await ann.locator('[data-reach-custom]').dispatchEvent('change')
    await until(async () => (await record(ann)).askReach === 5)
    ok('custom: 5 steps, remembered on this phone', (await record(ann)).askReach === 5 && /up to about 10 min/.test(await ann.locator('[data-reach-hint]').innerText()))
    await ann.locator('[data-reach-choice="no-limit"]').click()
    await until(async () => (await record(ann)).askReach === -1)
    ok('no limit: stored as the sentinel, never Infinity, and it says where it stops', (await record(ann)).askReach === -1 && /at most 6 steps/.test(await ann.locator('[data-reach-hint]').innerText()))
    await ann.locator('[data-reach-choice="fof"]').click()
    await until(async () => (await record(ann)).askReach === 2)
    await shot(ann, 'u1-03-ask-dock-how-far')

    // 1. friends of friends, Ben passing Ann's asks on (an acquaintance's asks do not go on by default)
    const benAnn = (await record(ben)).people.find((p) => p.name === 'Ann')
    ok('Ben holds Ann as an acquaintance; her asks do not go on by default', benAnn?.ring === 'acquaintance' && benAnn.passOn === undefined)
    await setPassOn(ben, 'Ann', true)
    ok('Ben switches on "Pass their asks on" for Ann', (await record(ben)).people.find((p) => p.name === 'Ann')?.passOn === true)
    const q1 = 'Does anyone have a ladder I could borrow?'
    const cleoSaw = answerAsk(cleo, true)
    const r1 = await ask(ann, q1)
    const seen1 = await cleoSaw
    // (the overlay's text was read before the tap; a picture of it for the evidence comes from the next ask in step 4)
    ok('Cleo is asked "Ann asks", through Ben', Boolean(seen1) && /Ann asks/.test(seen1) && /Through Ben/i.test(seen1) && seen1.includes(LADDER), seen1 ?? 'no overlay')
    ok('Ann gets Cleo\'s ladder, from Ben, marked "through Ben", on a card that says Ben passed it on (not that he chose to share)', /Ben passed this on/.test(r1.text) && !/Ben chose to share/.test(r1.text) && r1.text.includes(LADDER) && /through Ben/.test(r1.text), r1.text)
    ok('it comes at Ben\'s fixed moment: two windows (about 240 s since wave 6h), not before', r1.ms >= 238_000, String(r1.ms))
    await ann.locator('.card.asked .outcome').scrollIntoViewIfNeeded()
    await shot(ann, 'u1-04-ann-through-ben')
    await until(async () => (await record(ben)).log.find((e) => e.text === q1)?.passedOn === 1)
    const bl = (await record(ben)).log.find((e) => e.text === q1)
    ok('Ben\'s log: no match of his own, passed on to 1, 1 came back; Ben was never shown Cleo\'s line', bl?.outcome === 'no-match' && bl.passedOn === 1 && bl.cameBack === 1, JSON.stringify(bl))
    ok('Ann\'s finds keep the "through" mark', JSON.stringify((await record(ann)).found?.[0]?.shared?.[0]?.items?.[0]?.via) === '["Ben"]')

    // 2. my contacts only (the default)
    await ann.locator('.query-dock .x').click()
    await ann.getByRole('button', { name: 'Call into your web', exact: true }).click()
    const q2 = 'Anyone with a ladder, just my contacts?'
    const r2 = await ask(ann, q2, 'contacts')
    ok('maxHops 1: nothing comes back', /No match|nothing/i.test(r2.text) && !r2.text.includes(LADDER), r2.text)
    ok('and Cleo was never asked', (await logCount(cleo, q2)) === 0)
    ok('the default ask is answered at one window (about 120 s since wave 6h)', r2.ms >= 118_000 && r2.ms < 150_000, String(r2.ms))

    // 3. Ben's pass-on off: nothing, at the same moment as 1
    await setPassOn(ben, 'Ann', false)
    await ann.locator('.query-dock .x').click()
    await ann.getByRole('button', { name: 'Call into your web', exact: true }).click()
    const q3 = 'Ladder again, Ben not passing it on?'
    const r3 = await ask(ann, q3, 'fof')
    ok('Ben\'s "Pass their asks on" off: nothing comes back', !r3.text.includes(LADDER), r3.text)
    ok('and Cleo was never asked', (await logCount(cleo, q3)) === 0)
    ok('the answer comes at the same moment as with it on (timing says nothing)', Math.abs(r3.ms - r1.ms) < 6_000, `${r3.ms} vs ${r1.ms}`)
    await setPassOn(ben, 'Ann', true)

    // 4. a cycle: Cleo also knows Ann, Ann asks 3 steps
    await connect(cleo, ann, 'Ann', false)
    ok('now a triangle', (await record(ann)).peers.length === 2 && (await record(cleo)).peers.length === 2)
    await ann.locator('.query-dock .x').click().catch(() => {})
    await ann.getByRole('button', { name: 'Call into your web', exact: true }).click()
    const q4 = 'Ladder in a circle of friends?'
    const cleoSaw4 = answerAsk(cleo, true)
    const annSaw4 = ann.locator('.overlay.on').waitFor({ timeout: 100_000 }).then(() => true).catch(() => false)
    const r4 = await ask(ann, q4, 'three')
    await cleoSaw4
    ok('cycle: Ann is never asked her own question', !(await annSaw4) && (await logCount(ann, q4)) === 0)
    await new Promise((r) => setTimeout(r, 2_000))
    ok('cycle: Cleo is asked once (the copy through Ben is answered like no match, not logged again)', (await logCount(cleo, q4)) === 1, String(await logCount(cleo, q4)))
    ok('cycle: Ann gets the ladder once', (r4.text.match(/Ladder, 3 m, to lend/g) ?? []).length === 1, r4.text)

    // 5. "Ask only my direct contacts" wins over any reach
    await tab(ann, 'My Resources')
    await ann.getByRole('button', { name: 'Settings' }).click()
    await ann.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 5_000 })
    // The sheet redraws once the server's status is in (wave3_flow does the same): wait for it, so no click lands on the old sheet.
    await ann.locator('.sheet.on [data-server-transcribe]').waitFor({ timeout: 10_000 }).catch(() => {})
    await ann.waitForTimeout(300)
    await ann.locator('.sheet.on [data-direct-only]').click()
    await ann.locator('.sheet.on [data-direct-only][aria-pressed="true"]').waitFor({ timeout: 5_000 })
    await closeSheet(ann)
    await until(async () => (await ann.locator('.sheet.on').count()) === 0, 5_000)
    await tab(ann, 'Web')
    await ann.locator('.query-dock .x').click().catch(() => {})
    await ann.getByRole('button', { name: 'Call into your web', exact: true }).click()
    ok('direct only: the chooser is held at "My contacts"', await ann.locator('[data-reach-choice="fof"][disabled]').count() === 1)
    const q5 = 'Ladder, direct contacts only?'
    const cleoSaw5 = answerAsk(cleo, false)
    const r5 = await ask(ann, q5)
    await cleoSaw5
    await new Promise((r) => setTimeout(r, 2_000))
    ok('a direct ask is never passed on: Cleo is asked only by Ann herself, once', (await logCount(cleo, q5)) === 1 && (await logCount(ben, q5)) === 1, `${await logCount(cleo, q5)} / ${await logCount(ben, q5)}`)
    ok('and nothing came back through Ben', !/through Ben/.test(r5.text), r5.text)

    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
