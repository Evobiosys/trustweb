/**
 * Record and Meeting (owner's voice memos and follow-ups, 2026-10-05):
 * - Record is solo by default and laid out like Tana mobile's voice memo:
 *   circle + clock, an About row, then discard / pause / send.
 * - Pause stops the clock; the pill says "Recording" and follows you around.
 * - Top-right Meeting opens the meeting view: who/where, "<name> agreed to
 *   recording the meeting." with an info hint, an active-transcribing switch,
 *   manual speaker chips, a Tana-style transcript, and End meeting, which
 *   offers Send as is / Meet <name> / Make notes.
 * - Every header carries a QR button (Meet) instead of the "Online" dot; Meet
 *   from there shares no notes, Meet after a meeting is named after them.
 * - Tapping empty space in the web adds someone; Curate lists connections;
 *   the Inventory settings sit behind a cog; the backup card asks about the
 *   Swiss server; a take the phone ends is kept; dark mode is a real palette.
 *
 * Chromium's fake microphone stands in for a real one. Local only: a real
 * RelayServer + Vite dev server. TW_SHOTS=<dir> saves a screenshot per step.
 *
 * Run from apps/demo/ (it has tsx and the toolchain):
 *   PLAYWRIGHT_PACKAGE=<path to playwright-core> npx tsx ../trustweb/test/e2e/record_flow.mjs
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5198)
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

const clockSecs = (t) => t.trim().split(':').map(Number).reduce((a, b) => a * 60 + b, 0)

async function main() {
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
  console.log('record-flow against ' + base)

  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  let browser = null
  let n = 0
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_${name}.png`) }) }
  try {
    browser = await engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
    // No on-device speech in this run: headless Chromium crashes on the
    // SpeechRecognition.available() probe, so the browser behaves like one
    // without it (the TalkWeave path has its own live test).
    const noSpeech = () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition }
    await ctx.addInitScript(noSpeech)
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    page.on('dialog', (d) => void d.accept())
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })

    // Web: no welcome line, no ring caption; QR in the header; Curate; tap to add
    const webText = await page.locator('.screen').innerText()
    ok('Web has no welcome/count line and no ring caption', !/Welcome to your TrustWeb/.test(webText) && !/The rings: close friends/.test(webText))
    ok('the header shows a QR button, not an "Online" dot', await page.locator('.hdr .status-pill.qr svg').count() === 1 && !/Online/.test(await page.locator('.hdr').innerText()))
    await page.locator('.rings-wrap').click({ position: { x: 176 + 114, y: 176 } })
    await page.getByRole('heading', { name: 'Add someone to your web?' }).waitFor({ timeout: 5_000 })
    ok('tapping empty space in the web offers to add someone', true)
    ok('the ring is preselected by where you tapped', (await page.locator('.add-rings .radio.on').innerText()).startsWith('Friend'))
    await page.getByPlaceholder('Name').first().fill('Lena')
    await page.getByRole('button', { name: 'Add to my web' }).click()
    await page.locator('.node', { hasText: 'Lena' }).waitFor({ timeout: 5_000 })
    ok('the new person appears on the rings', true)
    await shot(page, 'web')
    // search: contacts only, with "Curate your web" as the first option
    await page.getByRole('button', { name: 'Search contacts' }).click()
    await page.getByPlaceholder('Search your contacts').fill('len')
    ok('search finds Lena', /Lena/.test(await page.locator('#search-results').innerText()))
    await page.getByPlaceholder('Search your contacts').fill('zzz')
    ok('search says when nobody matches', /Nobody by that name yet/.test(await page.locator('#search-results').innerText()))
    await page.getByRole('button', { name: /Curate your web/ }).click()
    await page.getByRole('heading', { name: 'Curate' }).waitFor({ timeout: 5_000 })
    ok('Curate is reached from search and lists the connections', /Lena/.test(await page.locator('.ppl').innerText()))
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Close search' }).click()

    // the person sheet: messenger links in the owner's order, opening the apps
    await page.locator('.node', { hasText: 'Lena' }).click()
    ok('contact info starts collapsed: no empty rows, one "Add other ways" button',
      await page.locator('.ch-row').count() === 0 && await page.getByRole('button', { name: /Add other ways to contact them/ }).isVisible())
    await page.getByRole('button', { name: /Add other ways to contact them/ }).click()
    const chOrder = (await page.locator('.ch-name').allInnerTexts()).map((t) => t.trim())
    ok('messengers in order: Signal, WhatsApp, Matrix, Delta Chat, Telegram, Messenger',
      JSON.stringify(chOrder) === JSON.stringify(['Signal', 'WhatsApp', 'Matrix', 'Delta Chat', 'Telegram', 'Messenger']), JSON.stringify(chOrder))
    const addCh = async (i, value) => {
      await page.locator('.ch-row').nth(i).getByRole('button', { name: /Add/ }).click()
      await page.locator('.ch-row.editing input').fill(value)
      await page.locator('.ch-row.editing').getByRole('button', { name: 'Save' }).click()
    }
    await addCh(0, '+43 660 123 4567')
    await addCh(1, '0043 660 123 4567')
    await page.locator('.ch-row').nth(2).getByRole('button', { name: /Add/ }).click()
    await page.locator('.ch-row.editing input').fill('lena-without-server')
    await page.locator('.ch-row.editing').getByRole('button', { name: 'Save' }).click()
    ok('a malformed Matrix address is refused', /A Matrix address looks like/.test(await page.locator('.ch-row.editing').innerText()))
    await page.locator('.ch-row.editing input').fill('@lena:matrix.example.org')
    await page.locator('.ch-row.editing').getByRole('button', { name: 'Save' }).click()
    await addCh(4, '@lena_tw')
    const hrefs = await page.locator('.ch-open').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    ok('links open the apps directly', JSON.stringify(hrefs) === JSON.stringify([
      'https://signal.me/#p/+436601234567', 'https://wa.me/436601234567', 'https://matrix.to/#/@lena:matrix.example.org', 'https://t.me/lena_tw',
    ]), JSON.stringify(hrefs))
    await shot(page, 'person_channels')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await page.locator('.node', { hasText: 'Lena' }).click()
    ok('reopened, only the known messengers show', await page.locator('.ch-row').count() === 4)
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // Meet shows my Signal code next to the TrustWeb code (Tana 2026-08-24)
    await page.locator('.hdr .status-pill.qr').click()
    await page.getByRole('tab', { name: 'Signal' }).click()
    await page.locator('.meet-page .ch-row.editing input').fill('https://signal.me/#eu/jakobDemo123')
    await page.locator('.meet-page').getByRole('button', { name: 'Save' }).click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 10_000 })
    ok('Meet shows my Signal code once added', (await page.getAttribute('.qrwrap', 'data-payload')) === 'https://signal.me/#eu/jakobDemo123')
    await page.getByRole('tab', { name: 'TrustWeb' }).click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 10_000 })
    ok('the TrustWeb code is the first page', /connect=/.test(await page.getAttribute('.qrwrap', 'data-payload') ?? ''))
    await page.getByRole('button', { name: 'Back' }).click()
    ok('the call button explains itself on hover', /resonance/.test(await page.getByRole('button', { name: 'Call into your web' }).getAttribute('title') ?? ''))

    // Record (solo): Tana voice-memo layout
    const qrOnWeb = await page.locator('.status-pill.qr').boundingBox()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 10_000 })
    ok('Record has the Tana-style circle and clock, discard and send (the circle itself records)',
      await page.locator('.rec-circle').count() === 1 && await page.locator('.memo-controls .round').count() === 2)
    ok('Record carries the Meeting button (two people, handshake) top right', await page.getByRole('button', { name: 'Meeting', exact: true }).isVisible() && await page.locator('.meet-btn svg circle').count() === 2 && await page.locator('.meet-btn svg rect').count() === 2)
    const meetSlot = await page.locator('.meet-btn').boundingBox()
    const qrOnRecord = await page.locator('.status-pill.qr').boundingBox()
    ok('the QR sits exactly where it sits on Web (muscle memory)', qrOnRecord !== null && Math.abs(qrOnRecord.x - qrOnWeb.x) < 1 && Math.abs(qrOnRecord.y - qrOnWeb.y) < 1, JSON.stringify([qrOnWeb, qrOnRecord]))
    ok('no consent wording on solo Record', !/agreed to/.test(await page.locator('.screen').innerText()))
    // "Listen for" prompts (owner 2026-10-06): what to note or create; a tap opens that Advanced section
    ok('Record prompts what to listen for: opportunity, resource, looking for, offer, talent', await page.locator('.rec-prompts .chip.prompt').count() === 5 && /Listen for/.test(await page.locator('.rec-prompts').innerText()))
    await page.locator('.rec-prompts .chip.prompt', { hasText: 'what they offer' }).click()
    ok('a prompt opens Advanced with that field focused', await page.locator('.adv.open').count() === 1 && await page.evaluate(() => document.activeElement?.closest('[data-adv]')?.getAttribute('data-adv')) === 'offer')
    await page.locator('.adv-toggle').click()
    ok('the Past meetings link sits under the recording', /Past meetings/.test(await page.locator('.past-link').innerText()))
    await shot(page, 'record_idle')
    await page.locator('.rec-circle').click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    ok('while recording, Record keeps the QR (no "Recording" pill)', await page.locator('.status-pill.rec').count() === 0 && await page.locator('.status-pill.qr').isVisible())
    await page.waitForTimeout(2200)
    await page.locator('.rec-circle').click()
    const atPause = clockSecs(await page.locator('#rec-clock').innerText())
    await page.waitForTimeout(1600)
    const later = clockSecs(await page.locator('#rec-clock').innerText())
    ok('pause stops the clock', atPause >= 2 && later === atPause, `${atPause} -> ${later}`)
    ok('paused: the circle and the line under it say so, no "Paused" pill', /Paused/.test(await page.locator('.rec-status').innerText()) && await page.locator('.status-pill.rec').count() === 0)
    await shot(page, 'record_paused')
    await page.locator('.rec-circle').click()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Web' }).click()
    ok('the pill follows you to Web', await page.locator('.status-pill.rec').isVisible())
    await page.locator('.status-pill.rec').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Send' }).click()
    await page.getByRole('heading', { name: 'Who was this about?' }).waitFor({ timeout: 5_000 })
    ok('send asks who it was about', true)
    await page.locator('.sheet .chip', { hasText: 'Lena' }).click()
    await page.getByRole('heading', { name: /Notes about Lena/ }).waitFor({ timeout: 10_000 })
    ok('then goes to Review with the recording card', await page.locator('.rec-card').isVisible())
    const memoLines = await page.locator('.line-text').evaluateAll((els) => els.map((e) => e.value))
    ok('with no transcriber the memo itself is a line (never a dead end)', memoLines.some((l) => /Voice memo, 0:0\d, to transcribe later/.test(l)), JSON.stringify(memoLines))
    await shot(page, 'review_solo')
    await page.getByRole('button', { name: 'Looks right' }).click()
    await page.getByRole('button', { name: 'Save to my web' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 10_000 })
    ok('a solo memo saves to the web', true)
    await page.locator('nav.tabs .tab-record').click()
    ok('Record starts fresh after saving: "Who or what was this about?"', /Who\s*or\s*what\s*was this about\?/.test(await page.locator('.about-row').innerText()))
    await page.locator('.rec-circle').click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: 'Discard' }).click()
    ok('discard drops a take in progress', await page.locator('.rec-circle.live, .rec-circle.paused').count() === 0 && /0:00/.test(await page.locator('#rec-clock').innerText()))

    // Meeting view
    await page.getByRole('button', { name: 'Meeting', exact: true }).click()
    await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    // "Just me" (owner 2026-10-06): one person with sound arcs, in the slot where Record shows Meeting
    const soloSlot = await page.locator('.solo-btn').boundingBox()
    ok('Meeting shows "Just me" where Record shows the Meeting button',
      await page.getByRole('button', { name: 'Just me' }).isVisible() && await page.locator('.solo-btn svg circle').count() === 1
      && soloSlot !== null && meetSlot !== null && Math.abs(soloSlot.x - meetSlot.x) < 2 && Math.abs(soloSlot.y - meetSlot.y) < 2,
      JSON.stringify([meetSlot, soloSlot]))
    ok('the QR stays put on Meeting', await page.locator('.status-pill.qr').isVisible())
    ok('Meeting has no "‹" back arrow (owner 2026-10-06): Just me and the bottom bar lead out', await page.locator('.hdr .back').count() === 0)
    await page.getByRole('button', { name: 'Just me' }).click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    ok('"Just me" switches back to recording by yourself', true)
    await page.getByRole('button', { name: 'Meeting', exact: true }).click()
    await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    await page.getByLabel('Who are you meeting?').fill('Maya')
    await page.getByLabel('Where are you meeting?').fill('coffee at the Hub')
    ok('meeting shows "Maya agreed to recording the meeting."', await page.getByText('Maya agreed to recording the meeting.').isVisible())
    await page.getByRole('button', { name: 'How to start' }).click()
    ok('the info button shows how to start', await page.getByText('Okay, we\'re recording now.', { exact: false }).isVisible())
    ok('an active-transcribing switch is there', await page.getByRole('switch', { name: /Transcribing/ }).isVisible())
    ok('the Meeting view prompts what to listen for too', await page.locator('.rec-prompts .chip.prompt').count() === 5 && await page.locator('.adv-toggle').isVisible())
    // Headless Chromium crashes on the on-device speech probe, so this run
    // records audio only; the TalkWeave path has its own live probe test.
    await page.getByRole('switch', { name: /Transcribing/ }).click()
    ok('switching transcription off says so', await page.getByText('Transcription off. Only the audio is recorded.').isVisible())
    ok('manual speaker chips are there', await page.locator('.speakers .chip').count() === 3)
    await page.getByRole('button', { name: 'Start recording' }).click()
    ok('a meeting waits for the consent tick', await page.getByText('Tick the line above once they agreed.').isVisible())
    await page.locator('#consent').check()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    ok('a live meeting says "Recording meeting" and keeps the QR', /Recording/.test(await page.locator('.meeting-clock').innerText()) && await page.locator('.status-pill.qr').isVisible())
    await page.getByRole('button', { name: 'Just me' }).click()
    await page.waitForTimeout(200)
    ok('"Just me" is refused while a take is live',
      await page.getByRole('heading', { name: 'Meeting', exact: true }).isVisible() && await page.getByText('Stop or send the recording first.').isVisible())
    await page.waitForTimeout(1500)
    // a pause leaves a divider in the transcript (from TalkWeave): when, then for how long
    await page.getByRole('button', { name: 'Pause' }).click()
    ok('a pause leaves a divider in the transcript', /^Paused at 00:00:0\d$/.test((await page.locator('.tr-pause').innerText()).trim()), await page.locator('.tr-list').innerText())
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Resume' }).click()
    ok('after resuming the divider says for how long', /^Paused at 00:00:0\d for [12] s$/.test((await page.locator('.tr-pause').innerText()).trim()), await page.locator('.tr-pause').innerText())
    await page.waitForTimeout(600)
    await shot(page, 'meeting_live')
    await page.getByRole('button', { name: 'End meeting' }).click()
    await page.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
    ok('End meeting offers Send as is and Meet Maya',
      await page.getByRole('button', { name: 'Send as is' }).isVisible() && await page.getByRole('button', { name: 'Meet Maya' }).isVisible())
    await shot(page, 'meeting_ended')
    // Send inside TrustWeb (owner 2026-10-06): pick a connected person; this phone has none yet
    await page.getByRole('button', { name: 'Send inside TrustWeb to...' }).click()
    await page.getByRole('heading', { name: 'Send inside TrustWeb' }).waitFor({ timeout: 5_000 })
    ok('"Send inside TrustWeb" asks whom, and says so when nobody is connected yet', /Nobody is connected on TrustWeb yet/.test(await page.locator('.sheet').innerText()))
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    await page.getByRole('button', { name: 'End meeting' }).click()
    await page.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
    await page.getByRole('button', { name: 'Send as is' }).click()
    await page.waitForTimeout(400)
    const shared = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '')
    ok('Send as is copies the meeting text (no share sheet headless)', /Maya/.test(shared), shared.slice(0, 120))
    await page.getByRole('button', { name: 'Meet Maya' }).click()
    await page.getByRole('heading', { name: 'Meet Maya' }).waitFor({ timeout: 5_000 })
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    ok('Meet after a meeting is named after the person', true)
    ok('Meet explains NFC honestly where it is unavailable', await page.getByText(/Tap-to-connect needs Chrome on Android/).isVisible())
    await shot(page, 'meet_after_meeting')
    await page.getByRole('button', { name: 'Back' }).click()

    // Past meetings (owner 2026-10-06): the meeting that just ended is kept with its place, openable again
    await page.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    await page.locator('.past-link').click()
    await page.getByRole('heading', { name: 'Past meetings' }).waitFor({ timeout: 5_000 })
    const pmRows = page.locator('.sheet .pm-row')
    ok('Past meetings lists the meeting with Maya, where it was, as a meeting', (await pmRows.count()) >= 1 && /Maya/.test(await pmRows.first().innerText()) && /Meeting/.test(await pmRows.first().innerText()) && /at coffee at the Hub/.test(await pmRows.first().innerText()), await pmRows.first().innerText())
    await pmRows.first().click()
    ok('opening it shows notes and transcript sections', await page.locator('.sheet').getByRole('heading', { name: 'Maya', exact: true }).isVisible() && /transcript/i.test(await page.locator('.sheet').innerText()) && /notes/i.test(await page.locator('.sheet').innerText()), await page.locator('.sheet').innerText())
    await shot(page, 'past_meeting')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // QR from a header: no notes, generic title
    await page.getByRole('button', { name: 'Web' }).click()
    await page.locator('.hdr .status-pill.qr').click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const qrLink = await page.getAttribute('.qrwrap', 'data-payload')
    ok('the header QR opens Meet with no notes', !/#n=/.test(qrLink ?? '#n=') && await page.getByRole('heading', { name: 'Meet', exact: true }).isVisible(), qrLink ?? '')
    await page.getByRole('button', { name: 'Back' }).click()

    // Inventory: cog settings, backup question
    await page.getByRole('button', { name: 'Inventory' }).click()
    ok('Inventory settings sit behind a cog (Lucide settings path)', await page.locator('.hdr-btn.icon-only svg path[d^="M12.22 2h"]').count() === 1)
    await page.waitForTimeout(500)
    ok('without a backup service the backup card stays hidden (backup_flow covers it live)', await page.getByText('Do you want to back it up on a Swiss server?').count() === 0)
    await shot(page, 'inventory')
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Inventory on the left, Web on the right' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const tabs = (await page.locator('nav.tabs button').allInnerTexts()).map((t) => t.trim())
    ok('settings swap Web and Inventory around Record', JSON.stringify(tabs) === JSON.stringify(['Inventory', 'Record', 'Web']), JSON.stringify(tabs))
    // the alternative: magnifier "Query", Curate list top right; switched in the ⋮ menu's Settings
    await page.getByRole('button', { name: 'Web', exact: true }).click()
    await page.getByRole('button', { name: 'More' }).click()
    await page.locator('.menu-item', { hasText: 'Settings' }).click()
    await page.locator('.radio', { hasText: 'A magnifying glass' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    ok('the Query alternative shows a magnifier "Query" and the Curate list top right',
      await page.getByRole('button', { name: 'Query', exact: true }).isVisible() && await page.locator('.hdr-right').getByRole('button', { name: 'Curate', exact: true }).isVisible())
    ok('no page errors', errors.length === 0, JSON.stringify(errors))

    // a populated web: with the query dock open, every person stays above it
    const demo = await ctx.newPage()
    await demo.goto(base + 'ea-demo/')
    const maya = demo.frameLocator('iframe[title="Device 1"]')
    await maya.getByLabel('Your first name').fill('Maya')
    await maya.getByRole('button', { name: 'Start on this phone' }).click()
    await maya.getByRole('button', { name: 'Call into your web' }).click({ timeout: 30_000 })
    await demo.waitForTimeout(400)
    const fit = await demo.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Device 1")
      const doc = f?.contentDocument
      const dock = doc?.querySelector('.query-dock')?.getBoundingClientRect()
      const nodes = [...(doc?.querySelectorAll('.rings-wrap .node') ?? [])].map((x) => x.getBoundingClientRect().bottom)
      return { dockTop: dock?.top ?? 0, lowest: Math.max(...nodes), count: nodes.length }
    })
    ok(`all ${fit.count} people stay above the query dock`, fit.count > 3 && fit.lowest <= fit.dockTop, JSON.stringify(fit))
    await demo.close()

    // dark mode is a real palette, not a darkened beige
    const dark = await browser.newContext({ viewport: { width: 1000, height: 1000 }, colorScheme: 'dark' })
    const dp = await dark.newPage()
    await dp.goto(base + 'ea-demo/')
    const dm = dp.frameLocator('iframe[title="Device 1"]')
    await dm.getByLabel('Your first name').fill('Maya')
    await dm.getByRole('button', { name: 'Start on this phone' }).click()
    await dm.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 30_000 })
    const bg = await dp.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Device 1")
      const s = f?.contentDocument?.querySelector('.screen')
      return s ? getComputedStyle(s).backgroundColor : ''
    })
    ok('dark mode uses the plum night surface', bg === 'rgb(31, 23, 41)', bg)
    if (SHOTS) await dp.locator('iframe[title="Device 1"]').screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_dark_web.png`) })
    await dark.close()

    // wide screen: a "+" outside the phone opens the side-by-side demo
    const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const wp = await wide.newPage()
    await wp.goto(base)
    const addLink = wp.getByRole('link', { name: /Add another device to see how it works side by side/ })
    ok('the "+ add another device" link sits outside the phone on a wide screen', await addLink.isVisible() && /\/demo\/$/.test(await addLink.getAttribute('href') ?? ''))
    await wide.close()

    // the phone ending a take (call, lock, mic taken) keeps what was recorded
    const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    await ctx2.addInitScript(noSpeech)
    await ctx2.addInitScript(() => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await orig(c); window.__streams = [...(window.__streams || []), st]; return st }
    })
    const p2 = await ctx2.newPage()
    await p2.goto(base)
    await p2.getByLabel('Your first name').fill('Jakob')
    await p2.getByRole('button', { name: 'Start on this phone' }).click()
    await p2.locator('nav.tabs .tab-record').click()
    await p2.locator('.rec-circle').click()
    await p2.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await p2.waitForTimeout(1500)
    await p2.evaluate(() => { for (const st of window.__streams) for (const t of st.getTracks()) { t.stop(); t.dispatchEvent(new Event('ended')) } })
    await p2.getByText('The recording was stopped by the phone', { exact: false }).waitFor({ timeout: 5_000 })
    ok('a take ended by the phone says so and is kept', /Recorded/.test(await p2.locator('.rec-status').innerText()))
    ok('the circle is no longer live, the QR is there', await p2.locator('.rec-circle.live').count() === 0 && await p2.locator('.status-pill.qr').isVisible())
    await ctx2.close()

    // Settings > Recording (owner 2026-10-06): transcription choice and what the Record tab starts with
    const ctx3 = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    await ctx3.addInitScript(noSpeech)
    const p3 = await ctx3.newPage()
    const loopback = []
    p3.on('request', (r) => { if (/127\.0\.0\.1:8990|\/talkweave\//.test(r.url())) loopback.push(r.url()) })
    p3.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await p3.goto(base)
    await p3.getByLabel('Your first name').fill('Jakob')
    await p3.getByRole('button', { name: 'Start on this phone' }).click()
    await p3.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    // an older record that opted into "Use TalkWeave on this computer" keeps it
    await p3.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        const v = JSON.parse(localStorage.getItem(k) ?? 'null')
        if (v && v.v === 1 && v.me) { v.talkWeaveLocal = true; delete v.transcription; localStorage.setItem(k, JSON.stringify(v)) }
      }
    })
    await p3.reload()
    await p3.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    const openSettings = async () => { await p3.getByRole('button', { name: 'More' }).click(); await p3.locator('.menu-item', { hasText: 'Settings' }).click() }
    await openSettings()
    const onLabel = async (attr) => (await p3.locator(`.radio.on[${attr}]`).allInnerTexts()).map((t) => t.split('\n')[0].trim())
    ok('Settings > Recording: an old TalkWeave opt-in reads as "TalkWeave on this computer"', JSON.stringify(await onLabel('data-transcription')) === '["TalkWeave on this computer"]', JSON.stringify(await onLabel('data-transcription')))
    ok('the Record tab starts with "Just me" by default', JSON.stringify(await onLabel('data-default-recording')) === '["Just me"]')
    await p3.locator('.radio[data-transcription="later"]').scrollIntoViewIfNeeded()
    if (SHOTS) await p3.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_settings_recording.png`) })
    await p3.locator('.radio[data-transcription="later"]').click()
    await p3.locator('.radio[data-default-recording="meeting"]').click()
    const stored = await p3.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const v = JSON.parse(localStorage.getItem(localStorage.key(i)) ?? 'null')
        if (v && v.v === 1 && v.me) return { t: v.transcription, d: v.defaultRecording, old: 'talkWeaveLocal' in v }
      }
      return null
    })
    ok('choosing replaces the old switch for good', JSON.stringify(stored) === JSON.stringify({ t: 'later', d: 'meeting', old: false }), JSON.stringify(stored))
    await p3.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    // a note started from a person stays a solo note, whatever the Record tab starts with
    await p3.locator('.rings-wrap').click({ position: { x: 176 + 114, y: 176 } })
    await p3.getByPlaceholder('Name').first().fill('Lena')
    await p3.getByRole('button', { name: 'Add to my web' }).click()
    await p3.locator('.node', { hasText: 'Lena' }).click()
    await p3.getByRole('button', { name: 'Add a note' }).click()
    await p3.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    ok('a note started from a person opens solo Record even with "A meeting"', true)
    p3.on('dialog', (d) => void d.accept())
    await p3.getByRole('button', { name: 'Discard' }).click()
    await p3.getByRole('button', { name: 'Web', exact: true }).click()
    await p3.locator('nav.tabs .tab-record').click()
    await p3.getByRole('heading', { name: 'Record', exact: true }).waitFor({ timeout: 5_000 })
    ok('from Web, the Record tab opens "Just me" even with "A meeting" in Settings (the origin wins)', true)
    await p3.locator('nav.tabs .tab-record').click()
    await p3.getByRole('heading', { name: 'Meeting', exact: true }).waitFor({ timeout: 5_000 })
    ok('from anywhere else (here: Record itself), Settings decides: the Record tab opens the Meeting view', true)
    await p3.getByLabel('Who are you meeting?').fill('Ben')
    await p3.locator('#consent').check()
    await p3.getByRole('button', { name: 'Start recording' }).click()
    await p3.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await p3.waitForTimeout(500)
    ok('"Transcribe later" says so and never reaches for TalkWeave',
      (await p3.locator('.tr-engine').innerText()).trim() === 'No transcriber here: the recording is transcribed later on your computer' && loopback.length === 0,
      JSON.stringify([await p3.locator('.tr-engine').innerText(), loopback]))
    if (SHOTS) await p3.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_meeting_default.png`) })
    await ctx3.close()
    ok('no page errors in the settings run', errors.length === 0, JSON.stringify(errors))
  } finally {
    await browser?.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nrecord-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
