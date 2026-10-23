/**
 * Search past meetings, and Record's default by origin (wave 1733, items 2 and 3):
 *   - the magnifier sits on Record and on Meeting where Web has its contact search;
 *   - it finds person, place, date, notes and transcript text, older notes
 *     (listed by person and day) included; empty and no-result states;
 *   - a result opens that past meeting at the line, highlighted and in view;
 *   - Record opens "Just me" from Web, a meeting from Inventory and from Meet
 *     (the QR), the Settings default from anywhere else, and a live take is
 *     never switched.
 * Past meetings with transcripts are placed in the phone's record directly
 * (headless Chromium has no speech engine); the search UI is what is tested.
 *
 * Local only: RelayServer + Vite dev server (TW_PORT, default 5192). TW_SHOTS=<dir>.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/search_origin.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5192)
const SHOTS = process.env.TW_SHOTS

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function waitForServer(url, ms = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('server did not come up: ' + url)
}

const DAY = 86_400_000
const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]

/** Two stored meetings (one with a long transcript) and a person with older notes. */
function seedRecord(now) {
  const transcript = Array.from({ length: 40 }, (_, i) => ({ speaker: (i % 2) + 1, atMs: i * 15_000, text: `Line ${i} of the conversation about everyday things.` }))
  transcript[31] = { speaker: 2, atMs: 31 * 15_000, text: 'There is a laser cutter in the basement of the Hub, ask Doris for the key.' }
  return {
    meetings: [
      { id: 'mx1', about: 'Max', kind: 'who', where: 'Café Prückel', startedAt: now - DAY, endedAt: now - DAY + 600_000, durationMs: 600_000, meeting: true,
        lines: [{ text: 'Knows a 3D printer to borrow', tag: 'offer' }], transcript },
      { id: 'mx2', about: 'Cargo bike', kind: 'what', where: '', startedAt: now - 3 * DAY, endedAt: now - 3 * DAY, durationMs: 5_000, meeting: false,
        lines: [], transcript: [{ speaker: 1, atMs: 2_000, text: 'The cargo bike is free on weekends.' }] },
    ],
    person: { id: 'lena1', name: 'Lena', context: 'former colleague', ring: 'friend', metAt: now - 400 * DAY, lines: [
      { id: 'ln1', text: 'Moving to Lisbon in spring', tag: 'note', audience: 'me', status: 'current', notedAt: now - 10 * DAY, checkedAt: now - 10 * DAY },
    ] },
  }
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitForServer(base)
  console.log('search-origin against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  const shot = async (page, name) => {
    if (!SHOTS) return
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.width, height: s.height })
      await page.waitForTimeout(250)
      // a resize re-lays the sheet out: bring the highlighted line back into view, as the app did
      await page.locator('.pm-hit').first().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
      await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
    }
    await page.setViewportSize({ width: 430, height: 900 })
  }
  try {
    browser = await engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    page.on('dialog', (d) => void d.accept())
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })

    // --- origin (item 3) ---
    const tab = page.locator('nav.tabs .tab-record')
    const heading = async () => (await page.locator('.hdr h2').innerText()).trim()
    await tab.click()
    ok('from Web, Record opens "Just me"', await heading() === 'Record')
    // the search: empty state on a phone with no past meetings
    const webSearch = await (async () => {
      await page.getByRole('button', { name: 'Membranes', exact: true }).click()
      return page.locator('.hdr .search-btn').boundingBox()
    })()
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await tab.click()
    ok('from Inventory, Record opens a meeting', await heading() === 'Meeting')
    await page.getByRole('button', { name: 'Membranes', exact: true }).click()
    await page.locator('.hdr .status-pill.qr').click()
    await page.getByRole('heading', { name: 'Meet', exact: true }).waitFor({ timeout: 10_000 })
    await tab.click()
    ok('from Meet (the QR code), Record opens a meeting', await heading() === 'Meeting')
    // a live take is never switched: record solo from Web, then tap Record from Inventory
    await page.getByRole('button', { name: 'Membranes', exact: true }).click()
    await tab.click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await tab.click()
    ok('a live take is never switched: from Inventory, Record still shows the solo take', await heading() === 'Record' && await page.locator('.rec-circle.live').count() === 1)
    await page.getByRole('button', { name: 'Discard' }).click()

    // --- search (item 2) ---
    const recSearch = await page.locator('.hdr .past-search-btn').boundingBox()
    ok('Record has the magnifier where Web has its search', Math.abs(recSearch.x - webSearch.x) < 1 && Math.abs(recSearch.y - webSearch.y) < 1, JSON.stringify([webSearch, recSearch]))
    await page.locator('.hdr .past-search-btn').click()
    ok('no past meetings yet: says so', /No past meetings yet/.test(await page.locator('#past-search-results').innerText()))
    await page.locator('.hdr .past-search-btn').click()

    // place two stored meetings and a person with older notes, then reload
    await page.evaluate((seed) => {
      const k = Object.keys(localStorage).find((x) => x === 'trustweb.v1.me')
      const s = JSON.parse(localStorage.getItem(k))
      s.meetings = seed.meetings
      s.people.push(seed.person)
      localStorage.setItem(k, JSON.stringify(s))
    }, seedRecord(Date.now()))
    await page.reload()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await tab.click()
    ok('Meeting has the magnifier too, in the same place', await page.locator('.hdr .past-search-btn').count() === 1 && Math.abs((await page.locator('.hdr .past-search-btn').boundingBox()).x - webSearch.x) < 1)
    await page.locator('.hdr .past-search-btn').click()
    const field = page.getByPlaceholder('Search past meetings and memos')
    const results = page.locator('#past-search-results')
    ok('empty query: says what can be searched, with the count', /Search your 3 past meetings and memos/.test(await results.innerText()), await results.innerText())
    await field.fill('zeppelin')
    ok('no result: says so', /Nothing found for "zeppelin"/.test(await results.innerText()))
    await field.fill('max')
    ok('finds the person', (await page.locator('.ms-result').count()) === 1 && /Max/.test(await results.innerText()))
    await field.fill('pruckel')
    ok('finds the place, accents ignored', (await page.locator('.ms-result').count()) === 1 && /Café Prückel/.test(await results.innerText()))
    await field.fill('lisbon')
    ok('finds older notes (listed by person and day)', /Lena/.test(await results.innerText()) && await page.locator('.ms-hit', { hasText: 'Lisbon' }).count() === 1)
    const iso = await page.evaluate(() => { const d = new Date(Date.now() - 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
    await field.fill(iso)
    ok('finds a date', /Max/.test(await results.innerText()), iso)
    await field.fill('laser cutter')
    const hit = page.locator('.ms-hit', { hasText: 'laser' })
    ok('finds transcript text: the matching line with context and its time', await hit.count() === 1 && /Transcript 00:07:45/.test(await hit.innerText()) && /basement of the Hub/.test(await hit.innerText()), await hit.innerText().catch(() => ''))
    await shot(page, '10_search_results')
    await hit.click()
    await page.locator('.sheet.on').getByRole('heading', { name: 'Max', exact: true }).waitFor({ timeout: 5_000 })
    await page.waitForTimeout(400)
    const lit = page.locator('.sheet .tr-static .pm-hit')
    const inView = await lit.evaluate((e) => {
      const r = e.getBoundingClientRect()
      const box = e.closest('.tr-static').getBoundingClientRect()
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1
    }).catch(() => false)
    ok('opening it shows that meeting with the line highlighted and scrolled into view', await lit.count() === 1 && /laser cutter/.test(await lit.innerText()) && inView)
    await shot(page, '11_search_opened_line')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('closing the meeting returns to the results, typing kept', await field.inputValue() === 'laser cutter')
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await tab.click()
    ok('leaving Record/Meeting closes the search', await page.locator('.past-search').count() === 0)
    // Review P3 (round B): a Meeting draft with only "where" typed is a draft in progress: the next Record tap keeps it.
    await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByLabel('Where are you meeting?').fill('Volkskundemuseum')
    await page.locator('nav.tabs button', { hasText: 'Membranes' }).click()
    await page.locator('nav.tabs .tab-record').click()
    ok('a Meeting draft with only "where" typed is kept by the next Record tap (review P3)', await page.getByLabel('Where are you meeting?').inputValue().catch(() => '') === 'Volkskundemuseum')
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nsearch-origin: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
