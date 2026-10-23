/**
 * Wave 6e (E2, slice S3): the General note on a person's card, in a real headless browser.
 *   1  the card has "Advanced", collapsed; "Your notes on them" stays where it was; a voice note still transcribing is named next to the
 *      typed note and the typed note is there at once
 *   2  typing autosaves into the record (after a pause) and on blur (at once); the status line says so
 *   3  the disclosure collapses on navigation, but is OPEN again on the next card (any person: one stamp for the phone) within two minutes,
 *      and collapsed after two minutes; closing it by hand forgets it
 *   4  the note survives a reload, shows in "Your notes on them" and is found by the same words
 *   5  PRIVACY: what was typed never appears in a request or a websocket frame of the phone
 * Local only: relay on an ephemeral port, Vite on TW_PORT (default 8972).
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8972 ../../node_modules/.bin/tsx ../trustweb/test/e2e/person_general_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startVite } from './swiss_harness.mjs'

const PORT = Number(process.env.TW_PORT || 8972)
const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const STAMP = 'trustweb.ui.personAdvancedAt'
const SECRET = 'GENERAL-NOTE-SECRET-chess-and-tea'

const tab = (page, name) => page.locator('nav.tabs button', { hasText: name }).click()
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 150)) }
  return null
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) }
const patch = (page, src, arg) => page.evaluate(([code, a]) => {
  const k = 'trustweb.v1.me'
  const s = JSON.parse(localStorage.getItem(k))
  // eslint-disable-next-line no-new-func
  new Function('s', 'a', code)(s, a)
  localStorage.setItem(k, JSON.stringify(s))
}, [src, arg])
const personOf = async (page, name) => (await record(page)).people.find((p) => p.name === name)
const openPerson = async (page, name) => {
  await tab(page, 'Membranes')
  await page.locator('.node', { hasText: name }).first().click()
  await page.locator('.sheet.on [data-person-advanced]').waitFor({ timeout: 8_000 })
}
const closeCard = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const expanded = (page) => page.locator('.sheet.on [data-act="person-advanced"]').getAttribute('aria-expanded')

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const vite = await startVite(PORT, { relayPort })
  const browser = await launch()
  try {
    const ada = await newPhone(browser, errors)
    const leaks = []
    ada.on('request', (r) => { if ((r.postData() ?? '').includes('GENERAL-NOTE-SECRET') || r.url().includes('GENERAL-NOTE-SECRET')) leaks.push(r.url()) })
    ada.on('websocket', (ws) => ws.on('framesent', (f) => { if (String(f.payload).includes('GENERAL-NOTE-SECRET')) leaks.push('ws ' + ws.url()) }))
    await startPhone(ada, vite.base, 'Ada')
    const now = Date.now()
    await patch(ada, `
      s.people.push({ id: 'pdana0001', name: 'Dana', context: 'at the market', ring: 'friend', metAt: a.now - 86400000, lines: [
        { id: 'l1', text: 'Dana grows tomatoes', tag: 'note', audience: 'only-me', status: 'current', notedAt: a.now - 86400000, checkedAt: a.now - 86400000 } ] })
      s.people.push({ id: 'peli00002', name: 'Eli', context: 'choir', ring: 'acquaintance', metAt: a.now - 86400000, lines: [] })
      s.meetings = [{ id: 'mdana0001', about: 'Dana', kind: 'who', personId: 'pdana0001', where: 'market', startedAt: a.now - 3600000, endedAt: a.now - 3000000, durationMs: 600000,
        meeting: false, lines: [], transcript: [], late: { keyText: 'TW1R-NOTAREALKEY', since: a.now - 1000 } }]
    `, { now })
    await ada.reload()
    await ada.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })

    // 1 collapsed, the notes list stays, transcribing named next to the typed note
    await openPerson(ada, 'Dana')
    ok('1. the card has "Advanced", collapsed', (await expanded(ada)) === 'false' && (await ada.locator('.sheet.on [data-general-note]').isHidden()))
    ok('1. "Your notes on them" is still on the card', (await ada.locator('.sheet.on [data-person-notes]').count()) === 1)
    ok('1. a meeting whose transcript is still on its way has a "Transcribing..." mark in the list', (await ada.locator('.sheet.on [data-pn-transcribing]').count()) === 1)
    await ada.locator('.sheet.on [data-act="person-advanced"]').click()
    ok('1. opening it shows the General notes field and the arrow turns', (await expanded(ada)) === 'true' && (await ada.locator('.sheet.on [data-general-note]').isVisible()))
    ok('1. a voice note still transcribing is named next to the typed note', /still being transcribed\. Your typed note is already here/.test(await ada.locator('.sheet.on [data-general-transcribing]').innerText()))
    ok('1. the page says it is Only me', /Only me/.test(await ada.locator('.sheet.on [data-person-advanced-panel]').innerText()))
    await shot(ada, 'e2-general-01-open')

    // 2 autosave
    await ada.locator('.sheet.on [data-general-note]').fill(`Likes ${SECRET}. Allergic to nuts.`)
    ok('2. while typing, the status says saving and nothing is written yet', /Saving/.test(await ada.locator('.sheet.on [data-general-status]').innerText()))
    const saved = await until(async () => (await personOf(ada, 'Dana'))?.generalNote?.includes('Allergic to nuts') ? true : null, 5000)
    ok('2. after the pause it is in the record, and the status says saved', !!saved && /Saved on this phone/.test(await ada.locator('.sheet.on [data-general-status]').innerText()))
    await ada.locator('.sheet.on [data-general-note]').fill(`Likes ${SECRET}. Allergic to nuts. Birthday in May.`)
    await ada.locator('.sheet.on [data-general-note]').blur()
    ok('2. on blur it is saved at once (no waiting for the pause)', (await personOf(ada, 'Dana'))?.generalNote?.includes('Birthday in May') === true)
    ok('2. a general note is not a note line: the lines of Dana are as they were', (await personOf(ada, 'Dana')).lines.length === 1)
    await shot(ada, 'e2-general-02-saved')

    // 3 two-minute memory, one stamp for the phone
    await closeCard(ada)
    await openPerson(ada, 'Eli')
    ok('3. another person\'s card opens with Advanced still open (one stamp for the phone, two minutes)', (await expanded(ada)) === 'true')
    ok('3. and Eli\'s note is empty (the note is per person)', (await ada.locator('.sheet.on [data-general-note]').inputValue()) === '')
    await closeCard(ada)
    await ada.evaluate((k) => localStorage.setItem(k, String(Date.now() - 121_000)), STAMP)
    await openPerson(ada, 'Dana')
    ok('3. after more than two minutes it starts collapsed again', (await expanded(ada)) === 'false')
    await ada.evaluate((k) => localStorage.setItem(k, String(Date.now() - 60_000)), STAMP)
    await closeCard(ada)
    await openPerson(ada, 'Dana')
    ok('3. at one minute it is still remembered', (await expanded(ada)) === 'true' && (await ada.locator('.sheet.on [data-general-note]').inputValue()).includes('Birthday in May'))
    await ada.locator('.sheet.on [data-act="person-advanced"]').click()
    ok('3. closing it by hand forgets it', (await expanded(ada)) === 'false' && (await ada.evaluate((k) => localStorage.getItem(k), STAMP)) === null)
    await closeCard(ada)
    await openPerson(ada, 'Dana')
    ok('3. the next card starts collapsed', (await expanded(ada)) === 'false')
    await closeCard(ada)

    // 4 reload, list, search
    await ada.reload()
    await ada.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    ok('4. the note survives a reload (record)', (await personOf(ada, 'Dana')).generalNote.includes(SECRET))
    await openPerson(ada, 'Dana')
    ok('4. it shows in "Your notes on them" as the General note', /Allergic to nuts/.test(await ada.locator('.sheet.on [data-pn-general]').innerText()))
    await ada.locator('.sheet.on .person-notes-field').fill('allergic nuts')
    ok('4. and is found by the same words (case and accents ignored)', (await ada.locator('.sheet.on [data-pn-general]').count()) === 1)
    await ada.locator('.sheet.on .person-notes-field').fill('zebra')
    ok('4. other words do not find it', (await ada.locator('.sheet.on [data-pn-general]').count()) === 0)
    await ada.locator('.sheet.on .person-notes-field').fill('')
    await ada.locator('.sheet.on [data-act="person-advanced"]').click()
    ok('4. after the reload the field holds the note', (await ada.locator('.sheet.on [data-general-note]').inputValue()).includes('Allergic to nuts'))
    await ada.locator('.sheet.on [data-general-note]').fill('')
    await ada.locator('.sheet.on [data-general-note]').blur()
    ok('4. clearing it removes the field from the record', (await personOf(ada, 'Dana')).generalNote === undefined)
    await shot(ada, 'e2-general-04-list')

    // 5 privacy
    ok('5. what was typed appeared in no request and no websocket frame of the phone', leaks.length === 0, leaks.join(' | '))
  } finally {
    await browser.close()
    vite.stop()
    await relay.close?.().catch(() => {})
  }
  ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\n${c.failures ? 'FAILED' : 'OK'}: ${c.passes} passed, ${c.failures} failed`)
  process.exit(c.failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
