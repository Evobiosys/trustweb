/**
 * Wave 6 (U4 b to f), the app wiring in a real headless browser over the test relay:
 *   W1  the Web header glyph is the outliner (never a magnifier; the magnifier stays on past-meetings search), the search panel
 *       says it only looks through the people and offers "Ask your web instead", a visible Home on every sheet, the rings
 *       stay, the ask dock carries the neighbourhood line, Settings > Advanced "Let asks match my notes too".
 *   W2  a person's card "Your notes on them": every line and past meeting per day, searchable, a meeting opens and goes back to the card.
 *   W3  notes through me: a meeting note answers an ask only with the person's yes; the setting off silences it.
 *   W4  a guest account stays: "Make it your personal account" on the guest's phone, kept on the owner's phone (no end, no Extend),
 *       "End it after a week" returns it; an account nobody touched shows 7 days and Extend exactly as before.
 *
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8970). TW_SHOTS=<dir> saves screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/u4_wiring.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const DAY = 86_400_000

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const patch = (page, fn, arg) => page.evaluate(([src, a]) => {
  const k = 'trustweb.v1.me'
  const s = JSON.parse(localStorage.getItem(k))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', src)(s, a)
  localStorage.setItem(k, JSON.stringify(s))
}, [fn, arg])

async function connect(host, joiner, joinerName, fresh) {
  await tab(host, 'Web')
  await host.locator('.hdr [aria-label^="Show my code"]').click()
  await host.getByRole('tab', { name: 'TrustWeb' }).click()
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

// ---------------------------------------------------------------------------
async function w1(jakob) {
  console.log('W1 glyphs, search panel, Home, Settings')
  await tab(jakob, 'Web')
  const webBtn = jakob.locator('.hdr .search-btn')
  const webSvg = await webBtn.innerHTML()
  ok('W1 the Web header button is the outliner glyph (three dots, three lines), not a magnifier', /cx="4.5"/.test(webSvg) && /M9 6h11M9 12h11M9 18h11/.test(webSvg) && !/m21 21/.test(webSvg), webSvg)
  ok('W1 its name says manage and search contacts', /Manage and search contacts/.test((await webBtn.getAttribute('aria-label')) ?? ''))
  ok('W1 the rings are still there (N8f)', await jakob.locator('.rings-wrap').isVisible())
  await webBtn.click()
  const panel = jakob.locator('[data-search-not-ask]')
  await panel.waitFor({ timeout: 5_000 })
  ok('W1 the search panel says it only looks through the people', /looks through the people already in your web/.test(await panel.innerText()))
  await shot(jakob, 'u4-w1-search-panel')
  await jakob.locator('[data-search-ask-instead]').click()
  await jakob.locator('.query-dock').waitFor({ timeout: 5_000 })
  ok('W1 "Ask your web instead" opens the ask dock', true)
  ok('W1 the dock carries the neighbourhood line and the scope', /like a neighbourhood, just online and much faster/.test(await jakob.locator('.query-dock').innerText()) && /opportunities, resources and wants/.test(await jakob.locator('.query-dock').innerText()))
  await jakob.locator('.query-dock .x').click()
  await tab(jakob, 'Record')
  const pastBtn = jakob.locator('.hdr .past-search-btn')
  ok('W1 Record keeps the magnifier for past meetings', /m21 21/.test(await pastBtn.innerHTML()))
  await tab(jakob, 'My Resources')
  await jakob.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await jakob.getByRole('button', { name: 'Settings' }).click()
  await jakob.locator('.sheet.on [data-notes-match]').waitFor({ timeout: 10_000 })
  await jakob.waitForTimeout(400)
  ok('W1 every sheet has a visible Home', (await jakob.locator('.sheet.on [data-sheet-home]').count()) === 1 && /Home/.test(await jakob.locator('.sheet.on [data-sheet-home]').innerText()))
  const sw = jakob.locator('.sheet.on [data-notes-match]')
  ok('W1 Settings > Advanced "Let asks match my notes too" is ON for a personal account', (await sw.getAttribute('aria-pressed')) === 'true' && !('asksMatchNotes' in (await record(jakob))))
  await sw.click()
  await until(async () => (await record(jakob)).asksMatchNotes === false)
  ok('W1 switching it off stores false', (await record(jakob)).asksMatchNotes === false)
  await jakob.locator('.sheet.on [data-notes-match]').click()
  await until(async () => !('asksMatchNotes' in (await record(jakob))))
  ok('W1 switching it on again drops the field (the default)', !('asksMatchNotes' in (await record(jakob))))
  // a personal phone that SHOWS demo content stays on (its demo-account askers are scoped to the demo content anyway)
  await patch(jakob, 's.demo = { people: [], inventory: [] }', {})
  await jakob.reload()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await tab(jakob, 'My Resources')
  await jakob.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await jakob.getByRole('button', { name: 'Settings' }).click()
  await jakob.locator('.sheet.on [data-notes-match]').waitFor({ timeout: 10_000 })
  ok('W1 with demo content on, the switch is still ON for a personal account', (await jakob.locator('.sheet.on [data-notes-match]').getAttribute('aria-pressed')) === 'true')
  await patch(jakob, 'delete s.demo', {})
  await jakob.locator('.sheet.on [data-sheet-home]').click()
  await until(async () => (await jakob.locator('.sheet.on').count()) === 0, 5_000)
  ok('W1 Home closes the sheet', (await jakob.locator('.sheet.on').count()) === 0)
}

// ---------------------------------------------------------------------------
async function w2(jakob) {
  console.log('W2 your notes on them')
  const now = Date.now()
  await patch(jakob, `
    s.people.push({ id: 'anna1', name: 'Anna Berger', context: 'Café Prückel', ring: 'friend', metAt: a.now - 9 * a.day, lines: [
      { id: 'l1', text: 'Looking for a pickleball court', tag: 'looking', audience: 'friends', status: 'current', notedAt: a.now - 5 * a.day, checkedAt: a.now },
      { id: 'l2', text: 'Plays the cello', tag: 'note', audience: 'me', status: 'current', notedAt: a.now - 5 * a.day, checkedAt: a.now },
      { id: 'l3', text: 'Moved to Graz', tag: 'note', audience: 'friends', status: 'gone', notedAt: a.now - 2 * a.day, checkedAt: a.now } ] })
    s.meetings = [{ id: 'm1', about: 'Anna Berger', kind: 'who', personId: 'anna1', where: 'Café Prückel', startedAt: a.now - 5 * a.day, endedAt: a.now - 5 * a.day + 1000, durationMs: 1000, meeting: true,
      lines: [{ text: 'Talked about the cello recital', tag: 'note', audience: 'friends' }], transcript: [] }]
  `, { now, day: DAY })
  await jakob.reload()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await tab(jakob, 'Web')
  await jakob.locator('.node', { hasText: 'Anna Berger' }).first().click()
  const sec = jakob.locator('.sheet.on [data-person-notes]')
  await sec.waitFor({ timeout: 5_000 })
  ok('W2 the card has "Your notes on them" with every line (also the one no longer true) and the meeting, per day',
    (await sec.locator('[data-pn-line]').count()) === 3 && (await sec.locator('[data-pn-meeting]').count()) >= 1 && (await sec.locator('[data-pn-day]').count()) >= 2)
  ok('W2 the line that is no longer true is flagged', /no longer true/.test(await sec.locator('[data-pn-line="l3"]').innerText()))
  await shot(jakob, 'u4-w2-person-notes')
  await sec.locator('.person-notes-field').fill('cello')
  ok('W2 searching "cello" keeps the line and the meeting about the cello', (await sec.locator('[data-pn-line]').count()) === 1 && (await sec.locator('[data-pn-meeting]').count()) === 1)
  await sec.locator('.person-notes-field').fill('zeppelin')
  ok('W2 searching "zeppelin" says nothing was found', /Nothing about "zeppelin"/.test(await sec.innerText()))
  await sec.locator('.person-notes-field').fill('')
  await sec.locator('[data-pn-meeting="m1"]').click()
  await jakob.locator('.sheet.on .back-link[data-back="person"]').waitFor({ timeout: 5_000 })
  ok('W2 the meeting opens with its notes', /Talked about the cello recital/.test(await jakob.locator('.sheet.on').innerText()))
  await jakob.locator('.sheet.on .back-link[data-back="person"]').click()
  await jakob.locator('.sheet.on [data-person-notes]').waitFor({ timeout: 5_000 })
  ok('W2 and back goes to the card', true)
  await closeSheet(jakob)
}

// ---------------------------------------------------------------------------
async function w3(jakob, anna) {
  console.log('W3 notes through me')
  await patch(jakob, `
    s.meetings.push({ id: 'm2', about: 'Someone', kind: 'who', where: 'Lake', startedAt: a.now - 3 * a.day, endedAt: a.now - 3 * a.day + 1000, durationMs: 1000, meeting: true,
      lines: [{ text: 'Cold-water sauna raft at the old Danube, bookable by the hour', tag: 'note', audience: 'fof' },
              { text: 'Private sauna thoughts about a friend', tag: 'note', audience: 'me' }], transcript: [] })
  `, { now: Date.now(), day: DAY })
  await jakob.reload()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await connect(jakob, anna, 'Anna', true)
  await tab(anna, 'Web')
  await anna.getByRole('button', { name: 'Ask your web', exact: true }).click()
  await anna.locator('.query-dock textarea').fill('Does anyone know a sauna raft?')
  await anna.getByRole('button', { name: 'Ask my web' }).click()
  await jakob.locator('.overlay.on').waitFor({ timeout: 25_000 })
  const prompt = await jakob.locator('.overlay').innerText()
  ok('W3 the meeting note goes in front of Jakob for his yes (never auto-answered)', /Anna asks/.test(prompt) && /Cold-water sauna raft/.test(prompt), prompt)
  ok('W3 the "Only me" line is not in the prompt', !/Private sauna/.test(prompt))
  ok('W3 the prompt names no meeting, place or person', !/Lake|Someone/.test(prompt.replace(/Anna asks/g, '')))
  await shot(jakob, 'u4-w3-notes-prompt')
  await jakob.getByRole('button', { name: 'Share these' }).click()
  await anna.locator('.card.asked .outcome').first().waitFor({ timeout: 200_000 })
  const got = await anna.locator('.card.asked').first().innerText()
  ok('W3 Anna gets the one line, with the generic context', /Cold-water sauna raft/.test(got) && /A note I took in a meeting/.test(got) && !/Private sauna/.test(got), got)
  await jakob.getByRole('button', { name: 'Back to the app' }).click({ timeout: 10_000 }).catch(() => {})
  // a General note typed on Record is saved WITH its audience (Only me until widened) and never answers an ask
  await tab(jakob, 'Web') // Record opens "Just me" from Web (a meeting from Inventory or Meet)
  await tab(jakob, 'Record')
  await jakob.locator('[data-general-notes]').fill('Pickleball court at the lake, Fridays')
  await jakob.getByRole('button', { name: 'Send' }).click()
  // the draft already names Anna (she just connected), so Send goes straight to Review
  await jakob.getByRole('heading', { name: /Notes about Anna/ }).waitFor({ timeout: 10_000 })
  await jakob.getByRole('button', { name: 'Looks right' }).click()
  await jakob.getByRole('button', { name: 'Save to my web' }).click()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 10_000 })
  const typed = (await record(jakob)).meetings.find((m) => (m.lines ?? []).some((l) => /Pickleball court at the lake/.test(l.text)))
  ok('W3 a Review save stores each meeting line WITH its audience (the typed General note: Only me)', typed?.lines.find((l) => /Pickleball/.test(l.text))?.audience === 'me', JSON.stringify(typed?.lines))
  await tab(anna, 'Web')
  await anna.getByRole('button', { name: /Ask your web again|Close/ }).first().click().catch(() => {})
  await anna.getByRole('button', { name: 'Ask your web', exact: true }).click().catch(() => {})
  await anna.locator('.query-dock textarea').fill('Is there a pickleball court at the lake?')
  await anna.getByRole('button', { name: 'Ask my web' }).click()
  await anna.locator('.card.asked .outcome').first().waitFor({ timeout: 200_000 })
  ok('W3 the Only me General note never answers: Jakob is not asked, Anna sees no match', (await jakob.locator('.overlay.on').count()) === 0 && /No match/.test(await anna.locator('.card.asked').first().innerText()))
  // the setting off: nothing reaches him
  await patch(jakob, 's.asksMatchNotes = false', {})
  await jakob.reload()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await anna.getByRole('button', { name: /Ask your web again|Close/ }).first().click().catch(() => {})
  await anna.getByRole('button', { name: 'Ask your web', exact: true }).click().catch(() => {})
  await anna.locator('.query-dock textarea').fill('Is there a sauna raft anywhere?')
  await anna.getByRole('button', { name: 'Ask my web' }).click()
  await anna.locator('.card.asked .outcome').first().waitFor({ timeout: 200_000 })
  ok('W3 with the setting off Jakob is not asked and Anna sees no match', (await jakob.locator('.overlay.on').count()) === 0 && /No match/.test(await anna.locator('.card.asked').first().innerText()))
}

// ---------------------------------------------------------------------------
async function makeAccount(jakob, first) {
  await tab(jakob, 'Web')
  await jakob.locator('.hdr [aria-label^="Show my code"]').click()
  await jakob.getByRole('tab', { name: 'Demo account' }).click()
  const field = jakob.getByLabel('Name of the demo account')
  await jakob.waitForTimeout(500)
  await field.focus()
  await jakob.keyboard.type(first)
  await jakob.getByRole('button', { name: 'Make the demo account' }).click()
  await jakob.getByRole('heading', { name: `${first}-demo is ready` }).waitFor({ timeout: 10_000 })
  await jakob.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return jakob.getAttribute('.qrwrap', 'data-payload')
}

async function admit(jakob, guest, link, first) {
  await guest.goto(link)
  await guest.getByRole('button', { name: `Start as ${first}-demo` }).click()
  await guest.locator('.query-dock').waitFor({ timeout: 20_000 })
  await jakob.getByRole('button', { name: 'Back' }).click().catch(() => {})
  const card = jakob.locator('.demo-friends')
  await card.waitFor({ timeout: 20_000 })
  await card.getByRole('button', { name: 'Allow', exact: true }).click()
  await guest.locator('.toast.on', { hasText: 'Jakob allowed it' }).waitFor({ timeout: 20_000 })
}

async function w4(jakob, browser) {
  console.log('W4 a guest account stays')
  const linkA = await makeAccount(jakob, 'Gina')
  ok('W4 a fresh demo account\'s link carries its end (7 days), as before', /&x=\d{13}/.test(linkA), linkA)
  const gina = await newPhone(browser, errors)
  await admit(jakob, gina, linkA, 'Gina')
  const linkB = await makeAccount(jakob, 'Hugo')
  const hugo = await newPhone(browser, errors)
  await admit(jakob, hugo, linkB, 'Hugo')

  // Gina's phone: Settings > Make it your personal account
  await tab(gina, 'My Resources')
  await gina.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await gina.getByRole('button', { name: 'Settings' }).click()
  const ask = gina.locator('.sheet.on [data-keep-ask]')
  await ask.waitFor({ timeout: 10_000 })
  ok('W4 the guest\'s Settings offer "Make it your personal account"', /Make it your personal account/.test(await ask.innerText()))
  ok('W4 the guest\'s Settings show when the demo ends (as before)', /ends in/.test(await gina.locator('.sheet.on').innerText()))
  await shot(gina, 'u4-w4-guest-settings')
  await ask.click()
  await until(async () => (await record(gina)).testOf?.keepAsked === true)
  ok('W4 asking marks the guest\'s record, and its own end stays until the owner says yes', (await record(gina)).testOf.keepAsked === true && typeof (await record(gina)).testOf.expiresAt === 'number')
  // Jakob's phone keeps it by default (his rule) and says so
  await jakob.locator('.toast.on', { hasText: 'is a personal account now' }).waitFor({ timeout: 30_000 })
  const acct = (await record(jakob)).testAccounts.find((t) => t.name === 'Gina-demo')
  ok('W4 Jakob\'s record: kept, and the stored end is a century away (older builds keep it too)', acct.keep === true && acct.expiresAt > Date.now() + 90 * 365 * DAY, JSON.stringify(acct))
  await until(async () => (await record(gina)).testOf?.kept === true, 30_000)
  const g = (await record(gina)).testOf
  ok('W4 the guest\'s record: kept, no end, no pending ask', g.kept === true && g.expiresAt === undefined && g.keepAsked === undefined, JSON.stringify(g))
  await gina.reload()
  await gina.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await tab(gina, 'My Resources')
  await gina.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await gina.getByRole('button', { name: 'Settings' }).click()
  await gina.locator('.sheet.on').waitFor({ timeout: 5_000 })
  const gtext = await gina.locator('.sheet.on').innerText()
  ok('W4 the guest\'s Settings: "personal account, kept by Jakob", "stays until you leave", no more asking', /personal account, kept by Jakob/.test(gtext) && /Your account stays until you leave/.test(gtext) && (await gina.locator('.sheet.on [data-keep-ask]').count()) === 0, gtext)

  // Jakob's Settings
  await tab(jakob, 'My Resources')
  await jakob.evaluate(() => localStorage.setItem('trustweb.ui.settings.advanced', '1')) // Settings > Advanced is folded by default
  await jakob.getByRole('button', { name: 'Settings' }).click()
  const sheet = jakob.locator('.sheet.on')
  await sheet.getByRole('button', { name: 'Keep this account Hugo-demo' }).waitFor({ timeout: 10_000 })
  const st = await sheet.innerText()
  ok('W4 Jakob\'s Settings: Gina-demo reads "kept, stays until they leave"; Hugo-demo still "7 days left"', /Gina-demo\s+connected · kept, stays until they leave/.test(st) && /Hugo-demo\s+connected · 7 days left/.test(st), st)
  ok('W4 a kept account has no Extend button; an untouched one keeps Extend a week and Keep this account',
    (await sheet.getByRole('button', { name: 'Extend a week Gina-demo' }).count()) === 0 && (await sheet.getByRole('button', { name: 'Extend a week Hugo-demo' }).count()) === 1
    && (await sheet.getByRole('button', { name: 'Keep this account Hugo-demo' }).count()) === 1)
  await shot(jakob, 'u4-w4-owner-settings')
  const hugoBefore = (await record(jakob)).testAccounts.find((t) => t.name === 'Hugo-demo')
  ok('W4 the untouched account still has its end of about 7 days and no keep field', !('keep' in hugoBefore) && Math.abs(hugoBefore.expiresAt - (hugoBefore.createdAt + 7 * DAY)) < 5_000, JSON.stringify(hugoBefore))
  // "Keep this account" for an existing one sends the notice to Hugo's phone
  await sheet.getByRole('button', { name: 'Keep this account Hugo-demo' }).click()
  await until(async () => (await record(jakob)).testAccounts.find((t) => t.name === 'Hugo-demo')?.keep === true)
  await until(async () => (await record(hugo)).testOf?.kept === true, 30_000)
  ok('W4 "Keep this account" keeps Hugo-demo and tells his phone (its own end goes)', (await record(hugo)).testOf.kept === true && (await record(hugo)).testOf.expiresAt === undefined)
  // back to a week
  await jakob.locator('.sheet.on').getByRole('button', { name: 'End it after a week Hugo-demo' }).click()
  await until(async () => !('keep' in ((await record(jakob)).testAccounts.find((t) => t.name === 'Hugo-demo') ?? {})))
  const hugoAgain = (await record(jakob)).testAccounts.find((t) => t.name === 'Hugo-demo')
  ok('W4 "End it after a week" gives a fresh week and drops the keep', !('keep' in hugoAgain) && Math.abs(hugoAgain.expiresAt - (Date.now() + 7 * DAY)) < 60_000)
  // the owner's sweep never takes a kept account down: age Gina-demo's createdAt far back, reload
  await patch(jakob, `s.testAccounts.find((t) => t.name === 'Gina-demo').createdAt = a.old`, { old: Date.now() - 400 * DAY })
  await jakob.reload()
  await jakob.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  ok('W4 a kept account survives the owner\'s sweep however old', (await record(jakob)).testAccounts.some((t) => t.name === 'Gina-demo'))
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(PORT, { relayPort: relay.port })
  const browser = await launch()
  try {
    const jakob = await newPhone(browser, errors)
    await startPhone(jakob, vite.base, 'Jakob')
    await w1(jakob)
    await w2(jakob)
    const anna = await newPhone(browser, errors)
    await w3(jakob, anna)
    await w4(jakob, browser)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  exception  ->  ' + (e instanceof Error ? e.stack ?? e.message : String(e)))
  } finally {
    await browser.close()
    vite.stop()
    await relay.stop()
  }
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
