/**
 * Wave 6 LIVE acceptance of friends of friends: the real two-hop ask over the deployed app and its real relay.
 *   Ann-live -- Ben-live -- Cleo-live: three fresh headless phones (390x844) on the live app, throwaway names only.
 *   Cleo notes "Ladder, 3 m, to lend" (acquaintances; by default it travels one degree on).
 *   1. Ann asks with "How far? Friends of friends" (maxHops 2), Ben lets Ann's asks go on: Cleo is asked
 *      "Ann-live asks, through Ben-live", says yes, and Ann gets the ladder marked "through Ben-live" at Ben's
 *      fixed moment (two windows, about 60 s).
 *   2. "My contacts" (the default, maxHops 1): Cleo is never asked and nothing comes back.
 * The timestamps (ask sent, Cleo prompted, Cleo's tap, answer received) and the elapsed times are printed.
 *
 * Unlike hops_three_phones.mjs this starts NO local Vite and NO relay: TW_URL is required and names the live app.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_URL=https://app.trustintheweb.org/ TW_SHOTS=<dir> \
 *     ../../node_modules/.bin/tsx ../trustweb/test/e2e/hops_live.mjs
 * TW_SHOTS=<dir> saves live_hops_<host>_<what>.png (Cleo's prompt, Ann's answer card, the ask dock).
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone } from './swiss_harness.mjs'

const LIVE = process.env.TW_URL
const SHOTS = process.env.TW_SHOTS
const VIEWPORT = { width: 390, height: 844 }
const LADDER = 'Ladder, 3 m, to lend'
const [ANN, BEN, CLEO] = ['Ann-live', 'Ben-live', 'Cleo-live']
const WINDOW_MS = 30_000
const c = checker()
const ok = c.ok
const errors = []
const stamps = {}

if (!LIVE) { console.error('hops_live.mjs needs TW_URL (the live app, e.g. https://app.trustintheweb.org/)'); process.exit(2) }
const HOST = new URL(LIVE).hostname

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const stamp = (label) => { stamps[label] = Date.now(); console.log(`  [t] ${label}  ${new Date(stamps[label]).toISOString()}`) }
const until = async (fn, ms = 30_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
async function shot(page, what) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `live_hops_${HOST}_${what}.png`) })
}

/** `joiner` opens `host`'s code and connects (one scan): both hold the other as an acquaintance. */
async function connect(host, joiner, joinerName, hostName) {
  await tab(host, 'Web')
  await host.locator('.hdr [aria-label^="Show my code"]').click()
  await host.locator('.qrwrap canvas').waitFor({ timeout: 20_000 })
  const url = await host.getAttribute('.qrwrap', 'data-payload')
  console.log(`  [code] ${hostName}'s code, opened by ${joinerName}, carries origin ${new URL(url).origin}`)
  const before = (await record(host)).peers.length
  await joiner.goto(url)
  await joiner.getByLabel('Your first name').fill(joinerName)
  await joiner.getByRole('button', { name: 'Connect', exact: true }).click()
  await until(async () => (await record(host)).peers.length === before + 1, 60_000)
  await host.getByRole('button', { name: 'Back' }).click().catch(() => {})
  await joiner.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 30_000 })
}

/** On `page`, the person card of `name`: switch "Pass their asks on" to `on`. */
async function setPassOn(page, name, on) {
  await tab(page, 'Web')
  await page.locator('.node', { hasText: name }).first().click()
  const row = page.locator('.sheet.on [data-pass-on]')
  await row.waitFor({ timeout: 10_000 })
  if ((await row.getAttribute('aria-checked')) !== String(on)) await row.click()
  await page.locator(`.sheet.on [data-pass-on][aria-checked="${on}"]`).waitFor({ timeout: 10_000 })
  await closeSheet(page)
}

/** Ann's ask with the reach chosen in the dock; resolves with the result card's text and how long it took. */
async function ask(page, text, reachChoice) {
  await tab(page, 'Web')
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Ask your web', exact: true }).click()
  await page.locator('.query-dock').waitFor({ timeout: 10_000 })
  await page.locator(`.query-dock [data-reach-choice="${reachChoice}"]`).click()
  await page.locator('.query-dock textarea').fill(text)
  await shot(page, `ann_dock_${reachChoice}`)
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Ask my web' }).click()
  await page.locator('.card.asked .outcome').waitFor({ timeout: 240_000 })
  return { text: await page.locator('.card.asked').innerText(), ms: Date.now() - t0, sentAt: t0, answeredAt: Date.now() }
}

/** Waits for the ask overlay on `page`, takes its picture, answers it; resolves with the overlay's text, or null when none came. */
async function answerAsk(page, share, shotName, ms = 150_000) {
  const shown = await page.locator('.overlay.on').waitFor({ timeout: ms }).then(() => true).catch(() => false)
  if (!shown) return null
  stamp('cleo_prompted')
  await page.waitForTimeout(600)
  const text = await page.locator('.overlay').innerText()
  await shot(page, shotName)
  await page.getByRole('button', { name: share ? 'Share these' : 'Don\'t share' }).click()
  stamp('cleo_tapped')
  await page.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  return text
}

const logCount = async (page, text) => ((await record(page)).log ?? []).filter((e) => e.text === text).length

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  console.log('trustweb live two-hop ask against ' + LIVE)
  const browser = await launch()
  try {
    const ann = await newPhone(browser, errors, { viewport: VIEWPORT })
    const ben = await newPhone(browser, errors, { viewport: VIEWPORT })
    const cleo = await newPhone(browser, errors, { viewport: VIEWPORT })
    await startPhone(ann, LIVE, ANN)
    await connect(ann, ben, BEN, ANN)
    await connect(ben, cleo, CLEO, BEN)
    const counts = [(await record(ann)).peers.length, (await record(ben)).peers.length, (await record(cleo)).peers.length]
    ok('Ann - Ben - Cleo: a chain, Ann and Cleo do not know each other', counts.join() === '1,2,1', counts.join())

    // Cleo notes the ladder (acquaintances; one degree onward by default).
    await tab(cleo, 'My Resources')
    await cleo.getByPlaceholder(/Motorbike/).fill(LADDER)
    await cleo.getByRole('button', { name: 'Add', exact: true }).click()
    const row = cleo.locator('.inv', { hasText: LADDER })
    await row.waitFor({ timeout: 10_000 })
    ok('Cleo\'s ladder travels one degree by default (friends of friends)', /\+1 degree/.test(await row.locator('.inv-actions').innerText()))

    // 1. friends of friends, Ben passing Ann's asks on (on by default since 2026-10-09)
    await tab(ann, 'Web')
    await ann.getByRole('button', { name: 'Ask your web', exact: true }).click()
    ok('"How far?": my contacts by default, five choices', (await ann.locator('[data-reach-choice]').count()) === 5
      && (await ann.locator('[data-reach-choice="contacts"]').getAttribute('aria-checked')) === 'true')
    const benAnn = (await record(ben)).people.find((p) => p.name === ANN)
    ok('Ben holds Ann as an acquaintance; her asks go on by default', benAnn?.ring === 'acquaintance' && benAnn.passOn === undefined, JSON.stringify(benAnn))
    await setPassOn(ben, ANN, true)
    ok('"Pass their asks on" is on for Ann without a tap', (await record(ben)).people.find((p) => p.name === ANN)?.passOn !== false)
    const q1 = 'Does anyone have a ladder I could borrow?'
    const cleoSaw = answerAsk(cleo, true, 'cleo_prompt')
    const r1 = await ask(ann, q1, 'fof')
    // The exact send moment is ask()'s own (the click on "Ask my web"), so the elapsed figures start there.
    stamps.ask1_sent = r1.sentAt
    stamps.ask1_answered = r1.answeredAt
    console.log(`  [t] ask1_sent  ${new Date(r1.sentAt).toISOString()}`)
    console.log(`  [t] ask1_answered  ${new Date(r1.answeredAt).toISOString()}`)
    const seen1 = await cleoSaw
    ok('Cleo is asked "Ann-live asks", through Ben-live', Boolean(seen1) && /Ann-live asks/.test(seen1) && /Through Ben-live/i.test(seen1) && seen1.includes(LADDER), seen1 ?? 'no overlay')
    ok('Ann gets Cleo\'s ladder, from Ben, marked "through Ben-live", on a card that says Ben passed it on', /Ben-live passed this on/.test(r1.text) && !/Ben-live chose to share/.test(r1.text) && r1.text.includes(LADDER) && /through Ben-live/.test(r1.text), r1.text)
    ok('it comes at Ben\'s fixed moment: two windows (about 60 s), not before, and within 150 s', r1.ms >= 2 * WINDOW_MS - 2_000 && r1.ms <= 150_000, String(r1.ms))
    await ann.locator('.card.asked .outcome').scrollIntoViewIfNeeded()
    await shot(ann, 'ann_answer_through_ben')
    await until(async () => (await record(ben)).log.find((e) => e.text === q1)?.passedOn === 1, 30_000)
    const bl = (await record(ben)).log.find((e) => e.text === q1)
    ok('Ben\'s log: no match of his own, passed on to 1, 1 came back', bl?.outcome === 'no-match' && bl.passedOn === 1 && bl.cameBack === 1, JSON.stringify(bl))
    ok('Ann\'s finds keep the "through" mark', JSON.stringify((await record(ann)).found?.[0]?.shared?.[0]?.items?.[0]?.via) === `["${BEN}"]`)
    console.log(`  [elapsed] ask sent -> Cleo prompted ${stamps.cleo_prompted - stamps.ask1_sent} ms; ask sent -> answer received ${r1.ms} ms; Cleo prompted -> answer ${stamps.ask1_answered - stamps.cleo_prompted} ms`)

    // 2. my contacts only (the default): Cleo is never asked
    await ann.locator('.query-dock .x').click().catch(() => {})
    await ann.getByRole('button', { name: 'Ask your web', exact: true }).click()
    const q2 = 'Anyone with a ladder, just my contacts?'
    const cleoSaw2 = answerAsk(cleo, false, 'cleo_unexpected_prompt', 60_000)
    const r2 = await ask(ann, q2, 'contacts')
    ok('maxHops 1: nothing comes back', /No match|nothing/i.test(r2.text) && !r2.text.includes(LADDER), r2.text)
    ok('and Cleo was never asked (no prompt, nothing in her log)', (await cleoSaw2) === null && (await logCount(cleo, q2)) === 0)
    ok('the default ask is answered at one window (about 30 s), as before', r2.ms >= 28_000 && r2.ms < 70_000, String(r2.ms))
    await shot(ann, 'ann_answer_my_contacts')

    ok('no page errors', errors.length === 0, errors.join(' | '))
  } finally {
    await browser.close()
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
