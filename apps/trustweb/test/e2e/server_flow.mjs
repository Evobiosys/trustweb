/**
 * Server-side transcription and the meeting link that fills in later (wave
 * 1733 round B, items 5 and 3), against the LOCAL Swiss server and a fake
 * transcription provider (never production):
 *   A. Server without transcription: the server button is hidden (wave 2), "not
 *      switched on yet"; a phone that chose it before falls back to the live engines.
 *   A2. With transcription: wave 3: the server is NOT in the engine list but an extra button
 *      "Transcribe on a server (see where)"; its sheet names where (here Infomaniak, Switzerland, the
 *      harness's provider), the data policy and the consent; the yes is stored with the route and
 *      asked again when the route changes; "Automatic" never sends a recording to the server.
 *   B. With transcription: a memo goes to the server when it stops; the
 *      Review fills with the transcript's lines; saved items link to the
 *      line and the moment (the chain of proof for server transcripts).
 *   C. "Transcribe later", then sent to the server afterwards from the past meeting.
 *      Wave 2: an answer with estimated times (approx) reads "rough times".
 *   D. Two phones: a meeting sent inside TrustWeb while the server still
 *      transcribes goes up "still arriving"; the receiver sees what is there,
 *      checks cheaply, keeps it; when the transcript is done the sender
 *      replaces the pack (same key) and the receiver's kept meeting fills in.
 *   E. The app closes mid-job: after a reload the job's answer is lost ("maybe-charged" state),
 *      it says "not charged to you" (wave 3), and nothing is sent again by itself.
 * Ports: Vite 5295 (with transcription) and 5296 (without), Swiss servers 5291
 * and 5293, fake provider 5292. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/server_flow.mjs
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startFakeProvider, startPhone, startRelay, startSwissServer, startVite } from './swiss_harness.mjs'
import { acceptAdd } from '../helpers/connect_add.mjs'

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
/** Wave 3: the extra button below the engine list opens the "see where" sheet. */
const openServerSheet = async (page) => {
  const b = page.locator('[data-server-button]')
  await b.scrollIntoViewIfNeeded()
  await b.click()
  await page.locator('.sheet.on [data-server-where]').waitFor({ timeout: 5_000 })
}
/** Chooses the server: the sheet, then its yes; Settings comes back. */
const chooseServer = async (page) => {
  await openServerSheet(page)
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
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
  console.log('A. server without transcription (it says transcribe:false, as production does today)')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Nora')
  await openSettings(page)
  ok('wave 2: the server button stays hidden while the server does not transcribe', await page.locator('[data-server-button]').count() === 0 && await page.locator('.radio[data-transcription="server"]').count() === 0)
  ok('Settings says it is not switched on yet (GET /hosted/status)', await page.locator('[data-server-transcribe="off"]').count() === 1 && /not switched on yet/.test(await page.locator('[data-server-transcribe]').innerText()))
  await shot(page, '02-settings-not-switched-on')
  // A phone that chose it while it was on (then the server switched it off): it still shows as chosen, and falls back.
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.transcription = 'server'
    r.serverTranscriptionConsentAt = Date.now()
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await openSettings(page)
  ok('a phone that chose it before still sees its choice (so it can move away)', await page.locator('[data-server-button].on').count() === 1)
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

/** The one-time consent, on a server that transcribes (wave 2: the choice is offered only there). */
async function partConsent(browser, base, provider) {
  console.log('A2. the server button and the yes bound to its route (server with transcription)')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Nora')
  await openSettings(page)
  await page.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  const engines = await page.locator('.radio[data-transcription]').evaluateAll((bs) => bs.map((b) => b.dataset.transcription))
  ok('wave 3: the engine list is Automatic, TalkWeave, On this device, Transcribe later (no server in it)', JSON.stringify(engines) === JSON.stringify(['auto', 'talkweave', 'on-device', 'later']), JSON.stringify(engines))
  const btn = page.locator('[data-server-button]')
  ok('below it, the extra button "Transcribe on a server (see where)", not chosen', await btn.count() === 1 && /Transcribe on a server \(see where\)/.test(await btn.innerText()) && (await btn.getAttribute('aria-pressed')) === 'false')
  ok('"Automatic" is still the choice and its hint never mentions our server', (await record(page)).transcription === undefined && !/our server/.test(await page.locator('[data-transcription="auto"]').innerText()))
  await btn.scrollIntoViewIfNeeded()
  await shot(page, '00-settings-server-button')
  await openServerSheet(page)
  const consent = await page.locator('.sheet.on').innerText()
  // Since the merge of tw3/transcribe the server's status says fallback: null for infomaniak (one provider, no chain), so the
  // sheet says so plainly instead of leaving it out (fallback undefined = an older server that does not say).
  ok('the sheet says where first: "Processed by: Infomaniak, Switzerland.", its data policy and "No fallback" (the server says none)',
    /Processed by: Infomaniak, Switzerland\./.test(await page.locator('.sheet.on [data-server-where]').innerText())
      && /its own terms apply/.test(await page.locator('.sheet.on [data-server-policy]').innerText())
      && /^No fallback: if it cannot transcribe, no other service is tried\.$/.test((await page.locator('.sheet.on [data-server-fallback]').innerText()).trim()), consent)
  // review-wave2: the copy follows the server's provider block. This harness runs the infomaniak provider (its fake speaks that
  // path), so the consent must name Infomaniak in Switzerland and NOT OpenRouter, the US or a data policy (unit: the OpenRouter copy).
  ok('choosing it asks first, plainly, naming what THIS server reports (infomaniak, ch): readable while transcribed, nothing kept by us, rough times, the free hours from its plan',
    /our server/.test(consent) && /transcription service of Infomaniak in Switzerland/.test(consent)
      && /can read the audio and the text/.test(consent) && /not end-to-end encrypted/.test(consent)
      && /We keep neither the audio nor the text/.test(consent) && /rough/.test(consent) && /up to 10 hours of audio per person/.test(consent)
      && !/OpenRouter|United States|DeepInfra|data policy/.test(consent), consent)
  await shot(page, '01-consent')
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
  const r1 = await record(page)
  ok('after the yes: the choice is the server and the yes is kept WITH its route (D7), no bare timestamp',
    r1.transcription === 'server' && r1.serverTranscriptionConsent?.provider === 'infomaniak' && r1.serverTranscriptionConsent.region === 'ch'
      && r1.serverTranscriptionConsent.fallback === null && typeof r1.serverTranscriptionConsent.at === 'number' && r1.serverTranscriptionConsentAt === undefined, JSON.stringify(r1.serverTranscriptionConsent))
  ok('the button shows it chosen and names where: "Chosen: Infomaniak, Switzerland"', await page.locator('[data-server-button].on').count() === 1 && /Chosen: Infomaniak, Switzerland/.test(await page.locator('[data-server-button]').innerText())
    && await page.locator('.radio.on[data-transcription]').count() === 0)
  await page.locator('[data-server-button]').scrollIntoViewIfNeeded()
  await shot(page, '01b-server-chosen')
  await pickTranscription(page, 'later')
  await openServerSheet(page)
  ok('the yes covers this route: choosing it again asks nothing new ("Use it for my recordings")', (await page.locator('[data-consent="yes"]').innerText()).trim() === 'Use it for my recordings' && await page.locator('[data-server-ask-again]').count() === 0)
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
  ok('and it is the choice again', (await record(page)).transcription === 'server')

  // "Automatic" never uses the server, even with a yes on this phone (wave 3).
  await pickTranscription(page, 'auto')
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  const submits0 = provider.state.submits
  await recordMemo(page, 'Garden hose', 1_500)
  await page.waitForTimeout(1_500)
  const rAuto = await record(page)
  ok('"Automatic" with a yes on this phone: the memo is NOT sent to the server (no job, no provider call)', !(rAuto.meetings ?? []).some((m) => m.serverJob) && provider.state.submits === submits0)
  ok('it waits to be transcribed later instead', /to transcribe later/.test(await page.locator('.line-card textarea').first().inputValue()))
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })

  // The route changes (the server moved to another provider): the yes does not cover it, nothing is sent, it asks again.
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.transcription = 'server'
    r.serverTranscriptionConsent = { ...r.serverTranscriptionConsent, provider: 'openrouter', region: 'us', dataPolicy: 'deny' }
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const submits1 = provider.state.submits
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.about-kind.what').click()
  await page.getByLabel('What was this about?').fill('Tent')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_200)
  const warn = await page.locator('.memo .warn').innerText().catch(() => '')
  ok('a yes for another route: recording says it asks again and transcribes on this device instead', /has changed since your yes/.test(warn), warn)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_000)
  ok('nothing was sent to the server under a yes for another route', provider.state.submits === submits1 && !((await record(page)).meetings ?? []).some((m) => m.serverJob))
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
  await openSettings(page)
  await openServerSheet(page)
  ok('the sheet names the earlier route and asks again', /Your earlier yes was for OpenRouter, USA/.test(await page.locator('.sheet.on [data-server-ask-again]').innerText())
    && (await page.locator('[data-consent="yes"]').innerText()).trim() === 'Yes, transcribe my recordings there')
  await shot(page, '01c-route-changed-asks-again')
  await page.locator('[data-consent="yes"]').click()
  await page.locator('[data-server-transcribe]').waitFor({ timeout: 10_000 })
  ok('the new yes names the route in force now', (await record(page)).serverTranscriptionConsent?.provider === 'infomaniak')
  // review-app-b: the yes can be taken back; then nothing goes there, also not under "Automatic", until asked again
  await page.locator('[data-consent-withdraw]').click()
  await page.waitForTimeout(300)
  const rw = await record(page)
  ok('"Take back my yes": the yes is gone (both generations), the choice becomes "Automatic", which never mentions the server',
    rw.serverTranscriptionConsent === undefined && rw.serverTranscriptionConsentAt === undefined && rw.transcription === 'auto'
    && !/our server/.test(await page.locator('[data-transcription="auto"]').innerText()) && await page.locator('[data-consent-withdraw]').count() === 0)
  await openServerSheet(page)
  ok('choosing it again asks again', (await page.locator('[data-consent="yes"]').innerText()).trim() === 'Yes, transcribe my recordings there')
  await page.context().close()
}

async function partBC(browser, base, provider) {
  console.log('B. our server transcribes a memo; C. "transcribe later", sent afterwards')
  const page = await newPhone(browser, errors)
  await startPhone(page, base, 'Jakob')
  await openSettings(page)
  await chooseServer(page)
  await page.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  ok('Settings: our server can also transcribe, you said yes to its route', /You said yes/.test(await page.locator('[data-server-transcribe]').innerText()))
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
  ok('the memo says it was transcribed through our server, with exact times (no "rough times")', await page.locator('.sheet.on [data-job="done"]').count() === 1 && !/rough times/i.test(await page.locator('.sheet.on [data-job="done"]').innerText()))
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
  ok('a memo transcribed later offers "Transcribe through our server"', /Transcribe through our server/.test(await start.innerText()))
  await shot(page, '05-transcribe-later-offer')
  await start.click()
  await page.locator('.sheet.on [data-job="done"]').waitFor({ timeout: 30_000 })
  const ladder = (await record(page)).meetings.find((m) => m.about === 'Ladder')
  ok('sent afterwards: transcribed, the sheet shows the transcript', ladder?.serverJob?.state === 'done' && ladder.transcript.length === 2 && await page.locator('.sheet.on .tr-static .tr-row').count() === 2)
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

  // Wave 2: an answer whose times the server estimated per sentence (contract v1.4 "approx": true; the server side of it is
  // covered by the services suite, which this fake Infomaniak path does not reach): the app keeps the lines and says "rough times".
  await page.route('**/transcribe', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ text: 'The drill is in the shed. Ask me before Friday.', language: 'en', secondsCharged: 2, approx: true,
      segments: [{ start: 0, end: 1, text: 'The drill is in the shed.' }, { start: 1, end: 1.6, text: 'Ask me before Friday.' }] }),
  }))
  await openSettings(page)
  await chooseServer(page)
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  await recordMemo(page, 'Drill', 1_500)
  const rough = await until(async () => {
    const m = (await record(page)).meetings.find((x) => x.about === 'Drill')
    return m?.serverJob?.state === 'done' ? m : null
  })
  ok('approx answer: lines with estimated times, the meeting marked rough', rough?.transcript?.length === 2 && rough.roughTimes === true, JSON.stringify(rough))
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to my inventory' }).click()
  await page.getByRole('heading', { name: 'My inventory' }).waitFor({ timeout: 10_000 })
  await page.locator('nav.tabs .tab-record').click()
  await page.getByRole('button', { name: 'Just me' }).click({ timeout: 2_000 }).catch(() => {})
  await page.locator('.past-link').click()
  await page.locator('.pm-row', { hasText: 'Drill' }).click()
  await page.locator('.sheet.on [data-job="done"]').waitFor({ timeout: 10_000 })
  ok('its past meeting says "rough times"', /rough times/i.test(await page.locator('.sheet.on [data-job="done"]').innerText()))
  await shot(page, '05b-rough-times')
  await page.context().close()
}

async function partD(browser, base, provider) {
  console.log('D. two phones: the pack that fills in later')
  const a = await newPhone(browser, errors)
  const b = await newPhone(browser, errors)
  await startPhone(a, base, 'Jakob')
  await openSettings(a)
  await chooseServer(a)
  await a.locator('[data-server-transcribe="on"]').waitFor({ timeout: 10_000 })
  await a.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  // Anna connects to Jakob with his code.
  await a.locator('.status-pill.qr').click()
  await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const url = await a.getAttribute('.qrwrap', 'data-payload')
  await b.goto(url)
  await b.getByLabel('Your first name').fill('Anna')
  await b.getByRole('button', { name: 'Connect', exact: true }).click()
  await acceptAdd(b)
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
  await chooseServer(page)
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
  ok('after a reload the cut-off job\'s answer counts as lost (state "maybe-charged", kept for older builds)', m.serverJob?.state === 'maybe-charged', JSON.stringify(m.serverJob))
  ok('and nothing was sent again by itself', provider.state.submits === before)
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.past-link').click()
  await page.locator('.pm-row', { hasText: 'Drill' }).click()
  ok('the meeting says so and offers "Try again" (the person decides)', await page.locator('.sheet.on [data-job="maybe-charged"]').count() === 1 && await page.locator('.sheet.on [data-job-start]').count() === 1)
  ok('wave 3: and says it is not charged to the person', /Not charged to you: failures are not charged to your allowance/.test(await page.locator('.sheet.on [data-not-charged]').innerText())
    && !/may still have been charged/.test(await page.locator('.sheet.on').innerText()))
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
    await partConsent(browser, vite1.base, provider)
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
