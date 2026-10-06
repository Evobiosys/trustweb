/**
 * Server-side transcription and the meeting link that fills in later (wave
 * 1733 round B, items 5 and 3), against the LOCAL Swiss server and a fake
 * transcription provider (never production):
 *   A. Server without transcription: the one-time consent (asked once, says
 *      the audio is readable while transcribed and nothing is kept), "not
 *      switched on yet", and the recording falls back to the live engines.
 *   B. With transcription: a memo goes to the server when it stops; the
 *      Review fills with the transcript's lines; saved items link to the
 *      line and the moment (the chain of proof for server transcripts).
 *   C. "Transcribe later", then sent to the server afterwards from the past meeting.
 *   D. Two phones: a meeting sent inside TrustWeb while the server still
 *      transcribes goes up "still arriving"; the receiver sees what is there,
 *      checks cheaply, keeps it; when the transcript is done the sender
 *      replaces the pack (same key) and the receiver's kept meeting fills in.
 *   E. The app closes mid-job: after a reload the job reads "may still be
 *      charged", and nothing is sent again by itself.
 * Ports: Vite 5295 (with transcription) and 5296 (without), Swiss servers 5291
 * and 5293, fake provider 5292. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/server_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startFakeProvider, startPhone, startRelay, startSwissServer, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}

const openSettings = async (page) => {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.getByRole('button', { name: 'More' }).click()
  await page.locator('.menu-item', { hasText: 'Settings' }).click()
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 5_000 })
  // The sheet redraws once the server's status is in: wait for it, so no click lands on the old sheet.
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
}
const pickTranscription = async (page, choice) => {
  const b = page.locator(`.radio[data-transcription="${choice}"]`)
  await b.scrollIntoViewIfNeeded()
  await b.click()
}
const until = async (fn, ms = 30_000, step = 200) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await fn().catch(() => null)
    if (v) return v
    await new Promise((r) => setTimeout(r, step))
  }
  return null
}

/** A solo memo about a thing, recorded for `ms` and sent (Record > what > Send). */
async function recordMemo(page, what, ms) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.about-kind.what').click()
  await page.getByLabel('What was this about?').fill(what)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(ms)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
}

async function partA(browser, base) {
  console.log('A. server without transcription')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Nora')
  await openSettings(page)
  await pickTranscription(page, 'server')
  await page.locator('[data-consent="yes"]').waitFor({ timeout: 5_000 })
  const consent = await page.locator('.sheet.on').innerText()
  ok('choosing "The Swiss server" asks first, plainly: Switzerland, Infomaniak, readable while transcribed, nothing kept',
    /Switzerland/.test(consent) && /Infomaniak/.test(consent) && /can read the audio and the text/.test(consent) && /not end-to-end encrypted/.test(consent) && /Neither the audio nor the text is kept/.test(consent), consent)
  await shot(page, '01-consent')
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
  const r1 = await record(page)
  ok('after the yes: the choice is the Swiss server and the yes is kept', r1.transcription === 'server' && typeof r1.serverTranscriptionConsentAt === 'number')
  ok('Settings says it is not switched on yet (GET /hosted/status)', await page.locator('[data-server-transcribe="off"]').count() === 1 && /not switched on yet/.test(await page.locator('[data-server-transcribe]').innerText()))
  await shot(page, '02-settings-not-switched-on')
  await pickTranscription(page, 'later')
  await pickTranscription(page, 'server')
  await page.waitForTimeout(400)
  ok('the consent is asked once: choosing it again asks nothing', await page.locator('[data-consent]').count() === 0 && (await record(page)).transcription === 'server')
  ok('after the yes, "Automatic" says it may send audio to the Swiss server (review-app-b)', /Swiss server \(you said yes/.test(await page.locator('[data-transcription="auto"]').innerText()))
  // review-app-b: the yes can be taken back; then nothing goes there, also not under "Automatic", until asked again
  await page.locator('[data-consent-withdraw]').click()
  await page.waitForTimeout(300)
  const rw = await record(page)
  ok('"Take back my yes": the yes is gone, "The Swiss server" becomes "Automatic", which no longer mentions it', rw.serverTranscriptionConsentAt === undefined && rw.transcription === 'auto'
    && !/Swiss server/.test(await page.locator('[data-transcription="auto"]').innerText()) && await page.locator('[data-consent-withdraw]').count() === 0)
  await pickTranscription(page, 'server')
  await page.locator('[data-consent="yes"]').waitFor({ timeout: 5_000 })
  ok('choosing the Swiss server again asks again', true)
  await page.locator('[data-consent="yes"]').click()
  await page.waitForTimeout(300)
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  await page.locator('nav.tabs .tab-record').click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(800)
  const warn = await page.locator('.memo .warn').innerText().catch(() => '')
  ok('recording: "not switched on yet, transcribing on this device instead" (falls back to the next transcriber)', /not switched on/.test(warn), warn)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByLabel('Who was this about?').fill('Lena')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
  const r2 = await record(page)
  ok('nothing was sent to a server that does not transcribe (no job on any meeting)', !(r2.meetings ?? []).some((m) => m.serverJob))
  ok('the memo falls back to "transcribe later"', /to transcribe later/.test(await page.locator('.line-card textarea').first().inputValue()))
  await page.context().close()
}

async function partBC(browser, base, provider) {
  console.log('B. the Swiss server transcribes a memo; C. "transcribe later", sent afterwards')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Jakob')
  await openSettings(page)
  await pickTranscription(page, 'server')
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  ok('Settings: the Swiss server transcribes, you said yes', /You said yes/.test(await page.locator('[data-server-transcribe]').innerText()))
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  const submits0 = provider.state.submits
  await recordMemo(page, 'Cargo bike', 2_500)
  const filled = await until(async () => {
    const values = await page.locator('.line-card textarea').evaluateAll((els) => els.map((e) => e.value))
    return values.some((v) => /cargo bike on weekends/i.test(v)) && values.some((v) => /flat in Graz/.test(v)) ? values : null
  })
  ok('Review fills with the lines of the server transcript (the stand-in memo line goes)', Boolean(filled) && !filled.some((v) => /to transcribe later/.test(v)), JSON.stringify(filled))
  await shot(page, '03-review-from-server-transcript')
  const r1 = await record(page)
  const memo = r1.meetings?.[0]
  ok('the memo was stored before the job, and the job is done', memo?.serverJob?.state === 'done' && memo.serverJob.takesDone === 1)
  ok('its transcript: the segments as lines, speaker 1, on the recording timeline', JSON.stringify(memo?.transcript) === JSON.stringify([{ speaker: 1, atMs: 0, text: 'I can lend my cargo bike on weekends.' }, { speaker: 1, atMs: 2100, text: 'We are looking for a flat in Graz.' }]), JSON.stringify(memo?.transcript))
  ok('one take, one call to the provider', provider.state.submits - submits0 === 1)
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
  const r2 = await record(page)
  const flat = r2.inventory.find((i) => /flat in Graz/.test(i.text))
  ok('a saved item keeps the transcript line and the moment it came from (chain of proof)', flat?.source?.kind === 'recorded-solo' && flat.source.meetingId === memo.id && flat.source.line === 1 && flat.source.atMs === 2100, JSON.stringify(flat?.source))
  await page.locator(`.inv-text[data-item="${flat.id}"]`).click()
  await page.locator('.sheet.on .src-link').click()
  await page.locator('.sheet.on .pm-hit').waitFor({ timeout: 5_000 })
  ok('its link opens the memo at exactly that transcript line', /flat in Graz/.test(await page.locator('.sheet.on .pm-hit').innerText()))
  ok('the memo says it was transcribed on the Swiss server', await page.locator('.sheet.on [data-job="done"]').count() === 1)
  await shot(page, '04-memo-transcribed-on-server')
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

  // C. Transcribe later, then send it to the server from the past meeting
  await openSettings(page)
  await pickTranscription(page, 'later')
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  await recordMemo(page, 'Ladder', 1_500)
  ok('"Transcribe later": nothing goes to the server when it stops', (await record(page)).meetings.length === 1)
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
  await page.locator('nav.tabs .tab-record').click()
  await page.getByRole('button', { name: 'Just me' }).click({ timeout: 2_000 }).catch(() => {})
  await page.locator('.past-link').click()
  await page.locator('.pm-row', { hasText: 'Ladder' }).click()
  const start = page.locator('.sheet.on [data-job-start]')
  await start.waitFor({ timeout: 10_000 })
  ok('a memo transcribed later offers "Transcribe on the Swiss server"', /Transcribe on the Swiss server/.test(await start.innerText()))
  await shot(page, '05-transcribe-later-offer')
  await start.click()
  await page.locator('.sheet.on [data-job="done"]').waitFor({ timeout: 30_000 })
  const ladder = (await record(page)).meetings.find((m) => m.about === 'Ladder')
  ok('sent afterwards: transcribed, the sheet shows the transcript', ladder?.serverJob?.state === 'done' && ladder.transcript.length === 2 && await page.locator('.sheet.on .tr-static .tr-row').count() === 2)
  await page.context().close()
}

async function partD(browser, base, provider) {
  console.log('D. two phones: the pack that fills in later')
  const a = await newPhone(browser, errors)
  const b = await newPhone(browser, errors)
  await startPhone(a, base, 'Jakob')
  await openSettings(a)
  await pickTranscription(a, 'server')
  await a.locator('[data-consent="yes"]').click()
  await a.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  // Anna connects to Jakob with his code.
  await a.locator('.status-pill.qr').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await a.getAttribute('.qrwrap', 'data-payload')
  await b.goto(url)
  await b.getByLabel('Your first name').fill('Anna')
  await b.getByRole('button', { name: 'Connect', exact: true }).click()
  await until(async () => (await record(a)).peers.length === 1, 20_000)
  ok('Anna is connected to Jakob', (await record(a)).peers.length === 1)

  provider.state.hold = true
  await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await a.locator('nav.tabs .tab-record').click()
  // Connecting on Meet named the draft after Anna (existing rule), so Record keeps that draft: switch it to a meeting.
  if (!(await a.getByRole('heading', { name: 'Meeting', exact: true }).isVisible())) await a.getByRole('button', { name: 'Meeting', exact: true }).click()
  await a.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 10_000 })
  await a.getByLabel('Who are you meeting?').fill('Anna')
  await a.getByLabel('Where are you meeting?').fill('Café Prückel')
  await a.locator('#consent').check()
  await a.getByRole('button', { name: 'Start recording' }).click()
  await a.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await a.waitForTimeout(2_000)
  await a.getByRole('button', { name: 'End meeting' }).click()
  await a.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
  ok('End meeting: the meeting is stored and the server is transcribing it', (await record(a)).meetings?.[0]?.serverJob?.state === 'running')
  await a.getByRole('button', { name: 'Send inside TrustWeb to...' }).click()
  await a.locator('.sheet [data-send-to]').first().click()
  await a.locator('.toast.on', { hasText: 'The transcript follows by itself' }).waitFor({ timeout: 30_000 })
  const aMeeting = (await record(a)).meetings[0]
  ok('the sender keeps the early pack\'s key with the meeting until the full version went out (A3)', aMeeting.outbox?.length === 1 && /^TW1R-/.test(aMeeting.outbox[0].keyText) && !aMeeting.fullSentAt)

  const card = b.locator('.demo-friends')
  await card.waitFor({ timeout: 30_000 })
  await card.getByRole('button', { name: 'Open', exact: true }).click()
  await b.locator('.sheet.on [data-pack-pending]').waitFor({ timeout: 30_000 })
  const packText = await b.locator('.sheet.on').innerText()
  ok('the receiver: "the transcript is still arriving", with who, where, when already there', /still arriving/.test(packText) && /About Anna/.test(packText) && /Café Prückel/.test(packText), packText.slice(0, 300))
  await shot(b, '06-receiver-still-arriving')
  await b.locator('.sheet.on [data-pack-check]').click()
  await b.locator('.toast.on', { hasText: 'Nothing new yet' }).waitFor({ timeout: 10_000 })
  ok('"Check again" asks cheaply and says nothing is new yet', true)
  await b.locator('.sheet.on [data-pack-keep]').click()
  const bKept = (await record(b)).meetings?.[0]
  ok('kept while still arriving: the meeting remembers where to look (key and version)', Boolean(bKept?.late?.keyText) && Boolean(bKept.late.etag) && bKept.transcript.length === 0 && (await record(b)).received?.[0]?.pending === true)

  provider.state.hold = false
  const sent = await until(async () => { const m = (await record(a)).meetings[0]; return m.serverJob?.state === 'done' && !m.outbox && m.fullSentAt ? m : null }, 45_000)
  ok('the transcript is done: the sender replaced the pack under the same key and dropped the key', Boolean(sent) && sent.transcript.length === 2)
  await a.locator('nav.tabs button', { hasText: 'Web' }).click()
  await a.locator('nav.tabs .tab-record').click()
  await a.locator('.past-link').click()
  await a.locator('.pm-row', { hasText: 'Anna' }).first().click()
  ok('the sender sees that the full version went out', await a.locator('.sheet.on [data-full-sent]').count() === 1)
  await shot(a, '07-sender-full-version-went-out')

  await b.locator('nav.tabs .tab-record').click()
  await b.getByRole('button', { name: 'Just me' }).click({ timeout: 2_000 }).catch(() => {})
  await b.locator('.past-link').click()
  // Kept from Jakob: it is filed under him.
  await b.locator('.pm-row', { hasText: 'Jakob' }).first().click()
  const filled = await until(async () => { const m = (await record(b)).meetings[0]; return m.transcript.length === 2 && !m.late ? m : null }, 20_000)
  ok('the receiver\'s kept meeting filled in with the full transcript and stopped looking', Boolean(filled))
  await until(async () => (await b.locator('.sheet.on .tr-static .tr-row').count()) === 2, 5_000)
  ok('and shows it', await b.locator('.sheet.on .tr-static .tr-row').count() === 2 && await b.locator('.sheet.on [data-late]').count() === 0)
  await shot(b, '08-receiver-filled-in')
  await a.context().close()
  await b.context().close()
}

async function partE(browser, base, provider) {
  console.log('E. the app closes mid-job')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Mia')
  await openSettings(page)
  await pickTranscription(page, 'server')
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  provider.state.hold = true
  await recordMemo(page, 'Drill', 1_500)
  await until(async () => (await record(page)).meetings?.[0]?.serverJob?.state === 'running', 10_000)
  // The audio reached the provider (the job is accepted, so it is charged): now the app closes.
  const submitted = provider.state.submits
  await until(async () => provider.state.submits === submitted + 1 || null, 15_000)
  const before = provider.state.submits
  await page.reload()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1_500)
  const m = (await record(page)).meetings[0]
  ok('after a reload the cut-off job reads "may still be charged"', m.serverJob?.state === 'maybe-charged', JSON.stringify(m.serverJob))
  ok('and nothing was sent again by itself', provider.state.submits === before)
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.past-link').click()
  await page.locator('.pm-row', { hasText: 'Drill' }).click()
  ok('the meeting says so and offers "Try again" (the person decides)', await page.locator('.sheet.on [data-job="maybe-charged"]').count() === 1 && await page.locator('.sheet.on [data-job-start]').count() === 1)
  await shot(page, '09-maybe-charged')
  provider.state.hold = false
  await page.context().close()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const provider = await startFakeProvider(5292)
  const withT = await startSwissServer(5291, { providerUrl: provider.url })
  const without = await startSwissServer(5293)
  const relay = await startRelay()
  const vite1 = await startVite(5295, { relayPort: relay.port, backupPort: 5291 })
  const vite2 = await startVite(5296, { relayPort: relay.port, backupPort: 5293 })
  let browser = null
  try {
    browser = await launch()
    await partA(browser, vite2.base)
    await partBC(browser, vite1.base, provider)
    await partD(browser, vite1.base, provider)
    await partE(browser, vite1.base, provider)
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite1.stop(); vite2.stop()
    await withT.stop(); await without.stop(); await provider.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nserver-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
