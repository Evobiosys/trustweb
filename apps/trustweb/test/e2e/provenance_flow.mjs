/**
 * The chain of proof (wave 1733, item 4): an item made on Record keeps where it
 * came from and links to that meeting at exactly that line; items from
 * elsewhere carry their tag; older records migrate to "typed" / "demo".
 *   1. Real flow (fake microphone): a "what" memo, a line added by hand DURING
 *      the take (stamped with the moment), saved to the inventory; the item's
 *      sheet says "recorded by you" and "From your memo about ..."; the link
 *      opens that memo with the line highlighted.
 *   2. A stored meeting with a transcript and a note picked from transcript
 *      line 31: the person sheet links it; the link opens the meeting with
 *      transcript line 31 highlighted and in view.
 *   3. An item typed in Inventory says "typed"; older items without a source
 *      read "typed", and demo things "demo", after a reload (migration).
 *
 * Local only: RelayServer + Vite (TW_PORT, default 5194). TW_SHOTS=<dir>.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/provenance_flow.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5194)
const BACKUP_PORT = Number(process.env.TW_BACKUP_PORT || 8968)
const SERVER = path.resolve(TW_ROOT, '../../services/trustweb-backup/server.mjs')
/** Tolerance for "plays from exactly that moment" in this run (Chromium, a WebM take with its Duration written). */
const SEEK_TOLERANCE_MS = 250
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

const SIZES = [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const { RelayServer } = await import('../../../../packages/transport/src/relay_server.ts')
  const { InMemoryRelayQueueStore } = await import('../../../../packages/transport/src/relay_queue_store.ts')
  const relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port: relayPort } = await relay.listen(0, '127.0.0.1')
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-prov-'))
  const backupProc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, BACKUP_DIR: dir, PORT: String(BACKUP_PORT), HOST: '127.0.0.1', ALLOWED_HOSTS: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const viteProc = spawn(process.execPath, [path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
    cwd: TW_ROOT,
    env: { ...process.env, TW_PORT: String(PORT), TW_RELAY_PROXY: `http://127.0.0.1:${relayPort}`, TW_BACKUP_PROXY: `http://127.0.0.1:${BACKUP_PORT}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const base = `http://127.0.0.1:${PORT}/`
  await waitForServer(base)
  await waitForServer(`http://127.0.0.1:${BACKUP_PORT}/backup/health`).catch(() => {})
  console.log('provenance-flow against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  const shot = async (page, name) => {
    if (!SHOTS) return
    for (const s of SIZES) {
      await page.setViewportSize({ width: s.width, height: s.height })
      await page.waitForTimeout(250)
      await page.locator('.pm-hit').first().evaluate((e) => e.scrollIntoView({ block: 'center' })).catch(() => {})
      await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
    }
    await page.setViewportSize({ width: 430, height: 900 })
  }
  try {
    browser = await engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
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

    // 1. a "what" memo with a line added by hand during the take
    await page.locator('nav.tabs .tab-record').click()
    await page.locator('.about-kind.what').click()
    await page.getByLabel('What was this about?').fill('Cargo bike')
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(2_300)
    await page.getByRole('button', { name: /Advanced/ }).click()
    await page.getByLabel('Add: resource').fill('can lend it on weekends')
    await page.getByLabel('Add: resource').press('Enter')
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Send' }).click()
    await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
    await page.locator('.cta .btn').click()
    await page.getByRole('button', { name: 'Save to my inventory' }).click()
    await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
    const rec1 = await record(page)
    const item = rec1.inventory.find((i) => /can lend it on weekends/.test(i.text))
    const memo = rec1.meetings?.[0]
    ok('the item keeps where it came from: recorded by you, the memo, and the moment in the take', item?.source?.kind === 'recorded-solo' && item.source.meetingId === memo?.id && item.source.atMs >= 2_000 && item.source.atMs < 8_000, JSON.stringify(item?.source))
    ok('the memo stores the same note with its moment', memo?.lines?.find((l) => l.text === 'can lend it on weekends')?.atMs === item?.source?.atMs, JSON.stringify(memo?.lines))
    await page.locator(`[data-item="${item.id}"]`).click()
    const sheet = page.locator('.sheet.on')
    await sheet.getByText('recorded by you').waitFor({ timeout: 5_000 })
    ok('the item sheet shows the provenance tag', await sheet.locator('[data-provenance="recorded-solo"]').count() === 1)
    const link = sheet.locator('.src-link')
    ok('and "From your memo about Cargo bike, <date>" as a link', /^From your memo about Cargo bike, /.test(await link.innerText()), await link.innerText())
    await shot(page, '12_item_provenance')
    await link.click()
    await sheet.getByRole('heading', { name: 'Cargo bike', exact: true }).waitFor({ timeout: 5_000 })
    ok('the link opens that memo with the note highlighted (no transcript here)', /can lend it on weekends/.test(await page.locator('.sheet .pm-hit').innerText()))
    // 4b: the audio was kept, so the memo plays from exactly that moment
    const fromBtn = page.locator('.sheet.on [data-play-from]')
    await fromBtn.waitFor({ timeout: 10_000 })
    ok('the memo\'s audio was kept: a player and "Play from this moment" appear', await page.locator('.sheet.on .pm-player').count() === 1 && /^Play from this moment/.test(await fromBtn.innerText()))
    await fromBtn.click()
    await page.waitForFunction(() => document.querySelector('.sheet.on .pm-player')?.dataset.playing === '1', null, { timeout: 5_000 })
    const pos = await page.locator('.sheet.on .pm-audio').evaluate((a) => a.currentTime * 1000)
    const dur = await page.locator('.sheet.on .pm-audio').evaluate((a) => a.duration)
    console.log(`        measured: moment ${item.source.atMs} ms, playing from ${Math.round(pos)} ms, take duration ${dur} s`)
    ok(`it plays from that moment (within ${SEEK_TOLERANCE_MS} ms, Chromium)`, Math.abs(pos - item.source.atMs) <= SEEK_TOLERANCE_MS, JSON.stringify({ atMs: item.source.atMs, pos }))
    ok('the take knows its length (the WebM Duration was written)', Number.isFinite(dur) && dur > 2, String(dur))
    await shot(page, '15_player_from_moment')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('closing the sheet stops playback', await page.locator('.pm-audio').evaluateAll((as) => as.every((a) => a.paused)))

    // 2. a stored meeting with a transcript; a note picked from transcript line 31
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      const now = Date.now()
      const transcript = Array.from({ length: 40 }, (_, i) => ({ speaker: (i % 2) + 1, atMs: i * 15_000, text: `Line ${i} of the conversation.` }))
      transcript[31] = { speaker: 2, atMs: 465_000, text: 'Anna knows someone who repairs old cargo bikes in Ottakring.' }
      s.meetings.unshift({ id: 'mtg31', about: 'Anna', kind: 'who', personId: 'anna31', where: 'Café Sperl', startedAt: now - 3_600_000, endedAt: now - 3_000_000, durationMs: 600_000, meeting: true,
        lines: [{ text: 'Knows someone who repairs old cargo bikes in Ottakring', tag: 'offer', atMs: 465_000, line: 31 }], transcript })
      s.people.push({ id: 'anna31', name: 'Anna', context: 'Café Sperl', ring: 'friend', metAt: now - 3_600_000, lines: [
        { id: 'al1', text: 'Knows someone who repairs old cargo bikes in Ottakring', tag: 'offer', audience: 'friends', status: 'current', notedAt: now, checkedAt: now,
          source: { kind: 'recorded-meeting', meetingId: 'mtg31', atMs: 465_000, line: 31 } },
      ] })
      // older records: an item and a demo thing without any source
      s.inventory.push({ id: 'old1', text: 'Old drill, from before', audience: 'fof', included: true, createdAt: now - 1e9 })
      s.inventory.push({ id: 'dem1', text: 'Dummy kayak', audience: 'fof', included: true, createdAt: now - 1e9 })
      s.demo = { people: [], inventory: ['dem1'] }
      localStorage.setItem('trustweb.v1.me', JSON.stringify(s))
    })
    await page.reload()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.locator('.node', { hasText: 'Anna' }).click()
    const pLink = page.locator('.sheet.on .sline .src-link')
    ok('the person sheet links the note: "From the meeting with Anna, <date>"', /^From the meeting with Anna, /.test(await pLink.innerText()) && await page.locator('.sheet.on [data-provenance="recorded-meeting"]').count() === 1)
    await shot(page, '13_person_note_provenance')
    await pLink.click()
    await page.locator('.sheet.on').getByRole('heading', { name: 'Anna', exact: true }).waitFor({ timeout: 5_000 })
    await page.waitForTimeout(400)
    const lit = page.locator('.sheet .tr-static .pm-hit')
    const inView = await lit.evaluate((e) => {
      const r = e.getBoundingClientRect()
      const box = e.closest('.tr-static').getBoundingClientRect()
      return r.top >= box.top - 1 && r.bottom <= box.bottom + 1
    }).catch(() => false)
    ok('the link opens the meeting at transcript line 31, highlighted and in view', await lit.count() === 1 && /repairs old cargo bikes/.test(await lit.innerText()) && inView)
    await shot(page, '14_meeting_at_line')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // 3. typed, migrated, demo
    await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await page.getByPlaceholder('e.g. Motorbike, can lend it for a weekend').fill('Sewing machine')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const rec3 = await record(page)
    ok('an item typed in Inventory is "typed"', rec3.inventory.find((i) => i.text === 'Sewing machine')?.source?.kind === 'typed')
    ok('older items migrate once: no source -> typed, demo -> demo', rec3.inventory.find((i) => i.id === 'old1')?.source?.kind === 'typed' && rec3.inventory.find((i) => i.id === 'dem1')?.source?.kind === 'demo')
    await page.locator('[data-item="dem1"]').click()
    ok('the demo thing\'s sheet says demo, with no link', await page.locator('.sheet.on [data-provenance="demo"]').count() === 1 && await page.locator('.sheet.on .src-link').count() === 0)
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // 4. tap a transcript line to play from it; the line being spoken is lit. The memo's audio is reused
    //    for a meeting with lines at 0, 1.5 and 3 s (headless Chromium has no speech engine for a real transcript).
    const audioDb = 'trustweb-audio.me'
    await page.evaluate(async (dbName) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(dbName, 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      const all = await new Promise((res) => { const r = db.transaction('audio').objectStore('audio').getAll(); r.onsuccess = () => res(r.result) })
      const src = all[0]
      await new Promise((res) => { const tx = db.transaction('audio', 'readwrite'); tx.objectStore('audio').put({ ...src, meetingId: 'mtgTap', savedAt: Date.now() }); tx.oncomplete = res })
      const s = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      const now = Date.now()
      s.meetings.unshift({ id: 'mtgTap', about: 'Tap test', kind: 'what', where: '', startedAt: now, endedAt: now, durationMs: 5000, meeting: false, lines: [],
        transcript: [{ speaker: 1, atMs: 0, text: 'First line.' }, { speaker: 1, atMs: 1500, text: 'Second line.' }, { speaker: 1, atMs: 3000, text: 'Third line.' }] })
      localStorage.setItem('trustweb.v1.me', JSON.stringify(s))
    }, audioDb)
    await page.reload()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await page.locator('nav.tabs .tab-record').click()
    await page.locator('.past-link').click()
    await page.locator('.sheet .pm-row', { hasText: 'Tap test' }).click()
    await page.locator('.sheet.on .pm-player').waitFor({ timeout: 10_000 })
    const third = page.locator('.sheet.on .tr-row.playable', { hasText: 'Third line.' })
    ok('transcript lines are tappable where the audio is kept', await page.locator('.sheet.on .tr-row.playable').count() === 3)
    await third.click()
    await page.waitForFunction(() => document.querySelector('.sheet.on .pm-player')?.dataset.playing === '1', null, { timeout: 5_000 })
    const tapPos = await page.locator('.sheet.on .pm-audio').evaluate((a) => a.currentTime * 1000)
    console.log(`        measured: line at 3000 ms, playing from ${Math.round(tapPos)} ms`)
    ok(`tapping "Third line." plays from 0:03 (within ${SEEK_TOLERANCE_MS} ms)`, Math.abs(tapPos - 3000) <= SEEK_TOLERANCE_MS, String(tapPos))
    ok('the line being played is lit', /Third line/.test(await page.locator('.sheet.on .tr-row.tr-now').innerText()))
    await shot(page, '16_player_tap_line')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    // a meeting without kept audio has no play control (absent, not broken)
    await page.locator('.past-link').click()
    await page.locator('.sheet .pm-row', { hasText: 'Anna' }).first().click()
    await page.waitForTimeout(800)
    ok('a meeting without kept audio shows no player', await page.locator('.sheet.on .pm-player').count() === 0 && await page.locator('.sheet.on .tr-row.playable').count() === 0)
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // 5. Settings says what is kept; audio is in neither the backup nor a sent meeting
    const audioBytes = await page.evaluate(async (dbName) => {
      const db = await new Promise((res) => { const r = indexedDB.open(dbName, 1); r.onsuccess = () => res(r.result) })
      const all = await new Promise((res) => { const r = db.transaction('audio').objectStore('audio').getAll(); r.onsuccess = () => res(r.result) })
      return all.reduce((n, e) => n + e.bytes, 0)
    }, audioDb)
    await page.getByRole('button', { name: 'Web', exact: true }).click()
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.menu-item', { hasText: 'Settings' }).click()
    await page.waitForFunction(() => /Recordings kept on this phone: \d/.test(document.querySelector('[data-audio-kept]')?.textContent ?? ''), null, { timeout: 5_000 })
    const keptLine = await page.locator('[data-audio-kept]').innerText()
    ok('Settings > Recording says what is kept, the caps, and that audio is not in backups or sent meetings', /Recordings kept on this phone: 2 /.test(keptLine) && /At most 20 or 300 MB/.test(keptLine) && /not part of backups/.test(keptLine) && /not sent with "Send inside TrustWeb"/.test(keptLine), keptLine)
    await page.locator('[data-audio-kept]').scrollIntoViewIfNeeded()
    await shot(page, '17_settings_audio_kept')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const puts = []
    page.on('request', (r) => { if (r.method() === 'PUT' && /\/backup\//.test(r.url())) puts.push(r.postDataBuffer()?.length ?? 0) })
    // a meeting (from Inventory: a meeting), ended, then Meet: the Meet code uploads the same pack "Send inside TrustWeb" sends
    await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByLabel('Who are you meeting?').fill('Ben')
    await page.locator('#consent').check()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(6_000)
    await page.getByRole('button', { name: 'End meeting' }).click()
    await page.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Meet Ben' }).click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const packBody = puts.length ? Math.max(...puts) : -1
    const meetingAudio = await page.evaluate(async (dbName) => {
      const db = await new Promise((res) => { const r = indexedDB.open(dbName, 1); r.onsuccess = () => res(r.result) })
      const all = await new Promise((res) => { const r = db.transaction('audio').objectStore('audio').getAll(); r.onsuccess = () => res(r.result) })
      return Math.max(...all.map((e) => e.bytes))
    }, audioDb)
    ok('the meeting\'s pack (the same as "Send inside TrustWeb") is uploaded without the audio', packBody > 0 && packBody < meetingAudio / 2, JSON.stringify({ packBody, meetingAudio }))
    await page.getByRole('button', { name: 'Back' }).click()
    // the backup: the whole record, never the audio
    await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    puts.length = 0
    await page.getByRole('button', { name: 'Back up, with a key made on this phone' }).click()
    await page.locator('#bk-saved').check()
    await page.getByRole('button', { name: 'Back up now' }).click()
    await page.locator('.toast.on', { hasText: 'Backed up' }).waitFor({ timeout: 15_000 })
    const recordBytes = (await page.evaluate(() => localStorage.getItem('trustweb.v1.me'))).length
    const totalAudio = audioBytes + meetingAudio
    const bk = puts.length ? Math.max(...puts) : -1
    ok('the backup is the size of the record, not of the audio (audio is not part of backups)', bk > 0 && bk < recordBytes * 2 + 4096 && bk < totalAudio / 2, JSON.stringify({ backupBody: bk, recordBytes, totalAudio }))
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    backupProc.kill()
    rmSync(dir, { recursive: true, force: true })
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nprovenance-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
