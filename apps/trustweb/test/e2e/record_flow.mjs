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
 * answers-44a: rewritten on the current flows (ring tap by data-ring, Curate in
 * Settings, search through the header magnifier, the card's Connect panel,
 * Record through the Note taker variation, the ⋮ arrange list); the main flow
 * runs at 360x780 and 1280x900, data attributes instead of fixed pixels.
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
import { chooseMode, openAdvanced, saveChannel } from '../helpers/share_box.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5198)
const SHOTS = process.env.TW_SHOTS

let failures = 0
/** review-44 / answers-44a: the dev overlays (.twf/.twp) stay out of the way on every load of a context (a reload drops a style tag). */
const hideOverlays = (ctx) => ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st)
}))
/** answers-44a: the ring a tap lands on, from the drawn circle (data-ring), never a fixed pixel: a point on its right edge. */
async function tapRing(page, ring) {
  const c = await page.locator(`.rings-wrap circle[data-ring="${ring}"]`).boundingBox()
  await page.mouse.click(c.x + c.width - 1, c.y + c.height / 2)
}
/** answers-44a: Settings with every fold open, settled; a sheet closes with Escape (at 360 the sheet covers the veil's corner). */
async function openSettings(page) {
  await page.locator('.hdr [data-settings-gear]').click()
  await page.locator('.sheet.on').waitFor(); await page.waitForTimeout(400)
  await page.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
}
async function closeSheet(page) {
  await page.keyboard.press('Escape'); await page.locator('.sheet.on').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {}); await page.waitForTimeout(300)
}
/** answers-44a: Record left the stock bar (wave 33 presets); the Note taker variation brings it back. */
async function noteTaker(page) {
  await openSettings(page)
  await page.locator('.sheet.on .radio', { hasText: 'Note taker' }).first().click(); await page.waitForTimeout(300)
  await closeSheet(page)
}
let ok = null
const okAt = (name, cond, detail = '') => {
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
  // review-44: the vite of swiss_harness.mjs (TW_VITE_BIN, apps/crm's Vite 8 that the app config needs), else apps/demo's.
  const viteProc = spawn(process.execPath, [process.env.TW_VITE_BIN || path.join(DEMO_ROOT, 'node_modules/vite/bin/vite.js'), '--strictPort'], {
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
    browser = await engine.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-mock-keychain', '--password-store=basic', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }) // review-44: the local headless shell
    // answers-44a: the main flow at 360x780 and 1280x900 (the wide one in its default full-width layout)
    for (const [w, h] of [[360, 780], [1280, 900]]) {
      ok = (name, cond, detail) => okAt(`${w}: ${name}`, cond, detail)
      await phoneRun(browser, base, w, h, shot)
    }
    ok = okAt
    await extras(browser, base, shot)
  } finally {
    await browser?.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nrecord-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

/** No on-device speech in these runs: headless Chromium crashes on the SpeechRecognition.available() probe, so the browser behaves like one
 * without it (the TalkWeave path has its own live test). */
const noSpeech = () => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition }

async function phoneRun(browser, base, w, h, shot) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(noSpeech)
  await hideOverlays(ctx)
  try {
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    page.on('dialog', (d) => void d.accept())
    await page.goto(base)
    // review-44: a fresh dev server reloads once after optimising dependencies
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await page.locator('.demo-friends').getByRole('button', { name: 'No thanks' }).click({ timeout: 3_000 }).catch(() => {})

    // Web: no welcome line, no ring caption; QR in the header; Curate; tap to add
    const webText = await page.locator('.screen').innerText()
    ok('Web has no welcome/count line and no ring caption', !/Welcome to your TrustWeb/.test(webText) && !/The rings: close friends/.test(webText))
    ok('the header shows a QR button, not an "Online" dot', await page.locator('.hdr .status-pill.qr svg').count() === 1 && !/Online/.test(await page.locator('.hdr').innerText()))
    await tapRing(page, 'friend') // answers-44a: the ring from its drawn circle (data-ring), no fixed pixel
    await page.getByRole('heading', { name: 'Add someone to your web?' }).waitFor({ timeout: 5_000 })
    ok('tapping empty space in the web offers to add someone', true)
    ok('the ring is preselected by where you tapped', await page.locator('.add-rings .radio.on').getAttribute('data-ring') === 'friend')
    await page.getByPlaceholder('Name').first().fill('Lena')
    await page.locator('[data-add-person]').click()
    await page.locator('.node', { hasText: 'Lena' }).waitFor({ timeout: 5_000 })
    ok('the new person appears on the rings', true)
    await shot(page, `web_${w}`)
    // answers-44a: search is the magnifier in the header (wave 28): the field opens over the view heading, Enter opens People with the query.
    await page.locator('.hdr .web-search-btn').click()
    await page.locator('[data-web-search]').fill('len')
    await page.locator('[data-web-search]').press('Enter')
    await page.locator('.screen', { hasText: 'Lena' }).first().waitFor({ timeout: 5_000 })
    ok('search finds Lena', /Lena/.test(await page.locator('.screen').innerText()))
    await page.goBack(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 5_000 })
    // answers-44a: Curate is Settings > "Curate your web" (the Contacts sheet of the Web Curator)
    await openSettings(page)
    await page.locator('[data-settings-curate]').first().scrollIntoViewIfNeeded(); await page.locator('[data-settings-curate]').first().click()
    const cur = page.locator('.sheet[data-kind="curator"]')
    await cur.locator('[data-action="toggle-all-groups"]').click({ timeout: 15_000 })
    await cur.getByText('Lena').first().waitFor({ timeout: 10_000 })
    ok('Curate lists the connections', true)
    await closeSheet(page)
    await noteTaker(page)

    // the person's card: messenger links in the owner's order, opening the apps (answers-44a: the card page's Connect panel, person_links.ts)
    await page.locator('.node', { hasText: 'Lena' }).click()
    await page.getByRole('heading', { name: 'Card' }).waitFor({ timeout: 5_000 })
    const panel = page.locator('[data-connect-panel]')
    ok('ways to reach them start folded behind Connect', await panel.isHidden() && await page.locator('[data-connect-first]').isVisible())
    await page.locator('[data-connect-first]').click()
    const kinds = await panel.locator('[data-add-link]').evaluateAll((els) => els.map((e) => e.getAttribute('data-add-link')))
    ok('messengers in order: Signal, WhatsApp, other', JSON.stringify(kinds) === JSON.stringify(['signal', 'whatsapp', 'other']), JSON.stringify(kinds))
    const addLink = async (kind, value) => {
      await panel.locator(`[data-add-link="${kind}"]`).click()
      await panel.locator(`[data-link-input="${kind}"]`).fill(value)
      await panel.locator(`[data-link-save="${kind}"]`).click()
    }
    await addLink('signal', 'https://signal.me/#p/+436601234567')
    await addLink('whatsapp', 'https://wa.me/436601234567')
    await addLink('other', 'lena-without-server')
    ok('a link that is not an http(s) address is refused', await panel.locator('[data-card-link="other"]').count() === 0 && await panel.locator('[data-link-input="other"]').count() === 1)
    await panel.locator('[data-link-input="other"]').fill('https://matrix.to/#/@lena:matrix.example.org')
    await panel.locator('[data-link-save="other"]').click()
    const hrefs = await panel.locator('[data-card-link] a').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    ok('links open the apps directly', JSON.stringify(hrefs) === JSON.stringify([
      'https://signal.me/#p/+436601234567', 'https://wa.me/436601234567', 'https://matrix.to/#/@lena:matrix.example.org',
    ]), JSON.stringify(hrefs))
    await shot(page, `person_channels_${w}`)
    await page.goBack(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 5_000 })
    await page.locator('.node', { hasText: 'Lena' }).click()
    await page.getByRole('heading', { name: 'Card' }).waitFor({ timeout: 5_000 })
    ok('reopened, only the known messengers show', await page.locator('[data-connect-panel] [data-card-link]').count() === 3)
    await page.goBack(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 5_000 })

    // Meet: ONE code (wave 6b); my Signal link rides in it, or becomes the code under Advanced > Only Signal
    await page.locator('.hdr .status-pill.qr').click()
    await saveChannel(page, 'signal', 'https://signal.me/#eu/jakobDemo123')
    await page.locator('.qrwrap canvas').waitFor({ timeout: 10_000 })
    ok('Meet has no Signal page any more: no Signal tab', (await page.getByRole('tab', { name: 'Signal' }).count()) === 0)
    await chooseMode(page, 'only-signal')
    ok('Advanced > Only Signal: Meet shows my Signal code once added', (await page.getAttribute('.qrwrap', 'data-payload')) === 'https://signal.me/#eu/jakobDemo123')
    // answers-44a: a mode chosen once moves onto the Meet row ([data-share-row]); the press goes to whichever copy is shown
    await openAdvanced(page)
    await page.locator('[data-mode="trustweb-signal"]:visible').first().click()
    ok('the unified code is the TrustWeb code', /connect=|\/c\//.test(await page.getAttribute('.qrwrap', 'data-payload') ?? ''))
    await page.getByRole('button', { name: 'Back' }).click()
    ok('the call button explains itself on hover', /Ask your web and feel the vibrations come back/.test(await page.locator('[data-open-query]').first().getAttribute('title') ?? ''))

    // Record (solo): Tana voice-memo layout
    const qrOnWeb = await page.locator('.status-pill.qr').boundingBox()
    const gearOnWeb = await page.locator('.hdr [data-settings-gear]').boundingBox()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 10_000 })
    ok('Record has the Tana-style circle and clock, discard and send (the circle itself records)',
      await page.locator('.rec-circle').count() === 1 && await page.locator('.memo-controls .round').count() === 2)
    ok('Record carries the Meeting button (two people, handshake) top right', await page.getByRole('button', { name: 'Meeting', exact: true }).isVisible() && await page.locator('.meet-btn svg circle').count() === 2 && await page.locator('.meet-btn svg rect').count() === 2)
    const meetSlot = await page.locator('.meet-btn').boundingBox()
    const qrOnRecord = await page.locator('.status-pill.qr').boundingBox()
    const gearOnRecord = await page.locator('.hdr [data-settings-gear]').boundingBox()
    // answers-44a (header-layout, item 23): the top right ends the same everywhere (Settings, AI); on Record the Meeting button sits before the QR.
    ok('the Settings gear sits exactly where it sits on Web, the QR on the same row (muscle memory)', gearOnRecord !== null && Math.abs(gearOnRecord.x - gearOnWeb.x) < 1 && Math.abs(gearOnRecord.y - gearOnWeb.y) < 1 && qrOnRecord !== null && Math.abs(qrOnRecord.y - qrOnWeb.y) < 1, JSON.stringify([gearOnWeb, gearOnRecord, qrOnWeb, qrOnRecord]))
    ok('no consent wording on solo Record', !/agreed to/.test(await page.locator('.screen').innerText()))
    // "Listen for" prompts (owner 2026-10-06): what to note or create; a tap opens that Advanced section
    ok('Record prompts what to listen for: opportunity, resource, looking for, offer, talent', await page.locator('.rec-prompts .chip.prompt').count() === 5 && /Listen for/.test(await page.locator('.rec-prompts').innerText()))
    await page.locator('.rec-prompts .chip.prompt', { hasText: 'what they offer' }).click()
    ok('a prompt opens Advanced with that field focused', await page.locator('.adv.open').count() === 1 && await page.evaluate(() => document.activeElement?.closest('[data-adv]')?.getAttribute('data-adv')) === 'offer')
    await page.locator('.screen .adv-toggle').click()
    ok('the Past recordings link sits under the recording (solo Record names them recordings)', /Past recordings/.test(await page.locator('.past-link').innerText()))
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
    await page.locator('nav.tabs [data-go="web"]').click()
    ok('the pill follows you to Web', await page.locator('.status-pill.rec').isVisible())
    await page.locator('.status-pill.rec').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    // answers-44a: Send no longer asks; who it was about is picked on the About row ("Who"), its sheet lists the people
    await page.locator('.screen .about-kind.who').click()
    await page.getByRole('heading', { name: 'Who was this about?' }).waitFor({ timeout: 5_000 })
    ok('the About row asks who it was about', true)
    await page.locator('.sheet.on .chip', { hasText: 'Lena' }).click()
    ok('the About row then names Lena', (await page.locator('.about-row .about-value').innerText()) === 'Lena')
    await page.locator('[data-record-send]').click()
    await page.getByRole('heading', { name: /Notes about Lena/ }).waitFor({ timeout: 10_000 })
    ok('then goes to Review with the recording card', await page.locator('.rec-card').isVisible())
    const memoLines = await page.locator('.line-text').evaluateAll((els) => els.map((e) => e.value))
    ok('with no transcriber the memo itself is a line (never a dead end)', memoLines.some((l) => /Voice memo, 0:0\d, to transcribe later/.test(l)), JSON.stringify(memoLines))
    await shot(page, 'review_solo')
    await page.getByRole('button', { name: 'Looks right' }).click()
    await page.getByRole('button', { name: 'Save to my web' }).click()
    await page.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 10_000 })
    ok('a solo memo saves to the web', true)
    await page.locator('nav.tabs .tab-record').click()
    ok('Record starts fresh after saving: "Who or what was this about?"', /Who\s*or\s*what\s*was this about\?/.test(await page.locator('.about-row').innerText()))
    await page.locator('.rec-circle').click()
    await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(800)
    await page.locator('[data-record-discard]').click()
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
    ok('the Meeting view prompts what to listen for too', await page.locator('.rec-prompts .chip.prompt').count() === 5 && await page.locator('.screen .adv-toggle').isVisible())
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
    const ways = await page.locator('[data-ways]').allInnerTexts()
    ok('Meet says how to connect (wave 2, P29, P32): QR code and link now, a moving QR code soon, NFC, Bluetooth, AirDrop later; never UWB',
      /QR code, or the link/.test(ways[0]) && /Coming soon: a moving QR code/.test(ways[1]) && /Coming later: NFC, Bluetooth and AirDrop/.test(ways[2]) && !/UWB/.test(await page.locator('.meet-page').innerText()), JSON.stringify(ways))
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
    await page.locator('nav.tabs [data-go="web"]').click()
    await page.locator('.hdr .status-pill.qr').click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const qrLink = await page.getAttribute('.qrwrap', 'data-payload')
    ok('the header QR opens Meet with no notes', !/#n=/.test(qrLink ?? '#n=') && await page.getByRole('heading', { name: 'Meet', exact: true }).isVisible(), qrLink ?? '')
    await page.getByRole('button', { name: 'Back' }).click()

    // Inventory: cog settings, backup question
    await page.locator('nav.tabs [data-go="inventory"]').click()
    ok('Inventory settings sit behind a cog (Lucide settings path)', await page.locator('.hdr-btn.icon-only svg path[d^="M12.22 2h"]').count() === 1)
    await page.waitForTimeout(500)
    ok('without a backup service the backup card stays hidden (backup_flow covers it live)', await page.getByText('Do you want to back it up on a Swiss server?').count() === 0)
    await shot(page, 'inventory')
    // answers-44a: the row is arranged in the ⋮ sheet (wave 40, data-bar-move): Web one place to the right
    await page.locator('nav.tabs [data-bar-more]').click()
    await page.locator('.sheet.on [data-bar-open-settings]').click()
    await page.locator('.sheet.on [data-bar-move="web:1"]').first().click()
    await closeSheet(page)
    const tabs = (await page.locator('nav.tabs button').allInnerTexts()).map((t) => t.trim())
    ok('the ⋮ arrows move Web one place to the right', tabs[0] === 'Chat' && tabs[1] === 'Web', JSON.stringify(tabs))
    // the alternative: magnifier "Query", Curate list top right; switched in the ⋮ menu's Settings
    await page.locator('nav.tabs [data-go="web"]').click()
    await openSettings(page)
    await page.locator('.sheet.on .radio', { hasText: 'A magnifying glass' }).click()
    await closeSheet(page)
    // answers-44a: the header is the same everywhere (item 23), so Curate stays in Settings; the button itself turns into the magnifier "Query"
    const fab = page.locator('[data-open-query]').first()
    ok('the Query alternative shows a magnifier "Query" in place of "Ask your web"',
      await fab.isVisible() && await fab.getAttribute('aria-label') === 'Query' && !(await fab.getAttribute('class')).includes('call'))
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
  } finally {
    await ctx.close()
  }
}

/** The populated web, dark mode, the wide page, a take the phone ends, Settings > Recording: once each. */
async function extras(browser, base, shot) {
  const errors = []

    // a populated web: no person sits under the "Ask your web" button (answers-44a: Ask opens its own page now, so the wave-6 query dock
    // over the rings is gone; the check is on the web before asking), and the button opens Ask
    const demoCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await hideOverlays(demoCtx)
    const demo = await demoCtx.newPage()
    await demo.goto(base + 'ea-demo/')
    await demo.waitForLoadState('networkidle').catch(() => {}); await demo.waitForTimeout(1000)
    const maya = demo.frameLocator('iframe[title="Device 1"]')
    await maya.getByLabel('Your first name').fill('Maya')
    await maya.getByRole('button', { name: 'Start on this phone' }).click()
    await maya.locator('.rings-wrap .node:not(.you)').first().waitFor({ timeout: 30_000 })
    const fit = await demo.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === 'Device 1')
      const doc = f?.contentDocument
      const fab = doc?.querySelector('[data-open-query]')?.getBoundingClientRect()
      const nodes = [...(doc?.querySelectorAll('.rings-wrap .node') ?? [])].map((x) => x.getBoundingClientRect())
      const under = nodes.filter((r) => fab && r.right > fab.left && r.left < fab.right && r.bottom > fab.top && r.top < fab.bottom).length
      return { count: nodes.length, under }
    })
    ok(`all ${fit.count} people stay clear of the "Ask your web" button`, fit.count > 3 && fit.under === 0, JSON.stringify(fit))
    await maya.locator('[data-open-query]').first().click()
    await maya.getByRole('heading', { name: 'Ask your web' }).first().waitFor({ timeout: 10_000 })
    ok('"Ask your web" opens Ask', true)
    await demoCtx.close()

    // dark mode is a real palette, not a darkened beige
    const dark = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
    await hideOverlays(dark)
    const dp = await dark.newPage()
    await dp.goto(base + 'ea-demo/')
    const dm = dp.frameLocator('iframe[title="Device 1"]')
    await dm.getByLabel('Your first name').fill('Maya')
    await dm.getByRole('button', { name: 'Start on this phone' }).click()
    await dm.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 30_000 })
    const bg = await dp.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Device 1")
      const s = f?.contentDocument?.querySelector('.screen')
      return s ? getComputedStyle(s).backgroundColor : ''
    })
    // answers-44a: the design system (2026-11-07, design/tokens.css --surface-1 dark #26241F) replaced the plum night surface
    ok('dark mode uses the design system\'s dark surface', bg === 'rgb(38, 36, 31)', bg)
    if (SHOTS) await dp.locator('iframe[title="Device 1"]').screenshot({ path: path.join(SHOTS, `record_flow_dark_web.png`) })
    await dark.close()

    // wide screen: a "+" outside the phone opens the side-by-side demo
    const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await hideOverlays(wide)
    // answers-44a: the phone frame on a wide tab is Settings > "TrustWeb mobile" (layout_pick.ts); full width by default hides the dock
    await wide.addInitScript(() => localStorage.setItem('trustweb.ui.layout', 'mobile'))
    const wp = await wide.newPage()
    await wp.goto(base)
    await wp.waitForLoadState('networkidle').catch(() => {}); await wp.waitForTimeout(1000)
    const addLink = wp.getByRole('link', { name: /Add another device to see how it works side by side/ })
    ok('the "+ add another device" link sits outside the phone on a wide screen', await addLink.isVisible() && /\/demo\/$/.test(await addLink.getAttribute('href') ?? ''))
    await wide.close()

    // the phone ending a take (call, lock, mic taken) keeps what was recorded
    const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['microphone'] })
    await ctx2.addInitScript(noSpeech)
    await ctx2.addInitScript(() => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await orig(c); window.__streams = [...(window.__streams || []), st]; return st }
    })
    await hideOverlays(ctx2)
    const p2 = await ctx2.newPage()
    await p2.goto(base)
    await p2.waitForLoadState('networkidle').catch(() => {}); await p2.waitForTimeout(1500)
    await p2.getByLabel('Your first name').fill('Jakob')
    await p2.getByRole('button', { name: 'Start on this phone' }).click()
    await p2.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await p2.locator('.demo-friends').getByRole('button', { name: 'No thanks' }).click({ timeout: 3_000 }).catch(() => {})
    await noteTaker(p2)
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
    const ctx3 = await browser.newContext({ viewport: { width: 360, height: 780 }, permissions: ['microphone'] })
    await ctx3.addInitScript(noSpeech)
    await hideOverlays(ctx3)
    const p3 = await ctx3.newPage()
    const loopback = []
    p3.on('request', (r) => { if (/127\.0\.0\.1:8990|\/talkweave\//.test(r.url())) loopback.push(r.url()) })
    p3.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await p3.goto(base)
    await p3.waitForLoadState('networkidle').catch(() => {}); await p3.waitForTimeout(1500)
    await p3.getByLabel('Your first name').fill('Jakob')
    await p3.getByRole('button', { name: 'Start on this phone' }).click()
    await p3.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    await p3.locator('.demo-friends').getByRole('button', { name: 'No thanks' }).click({ timeout: 3_000 }).catch(() => {})
    await noteTaker(p3)
    // an older record that opted into "Use TalkWeave on this computer" keeps it
    await p3.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        const v = JSON.parse(localStorage.getItem(k) ?? 'null')
        if (v && v.v === 1 && v.me) { v.talkWeaveLocal = true; delete v.transcription; localStorage.setItem(k, JSON.stringify(v)) }
      }
    })
    await p3.reload()
    await p3.getByRole('heading', { name: 'TrustZones' }).waitFor({ timeout: 15_000 })
    // The sheet redraws once the server's status is in (no server here: "did not answer"); wait for that, so no click lands on the old sheet.
    await openSettings(p3)
    await p3.locator('.sheet.on [data-server-transcribe]').waitFor({ timeout: 10_000 })
    await p3.waitForTimeout(400)
    await p3.evaluate(() => document.querySelectorAll('.sheet.on details').forEach((d) => { d.open = true }))
    const onLabel = async (attr) => (await p3.locator(`.radio.on[${attr}]`).allInnerTexts()).map((t) => t.split('\n')[0].trim())
    ok('Settings > Recording: an old TalkWeave opt-in reads as "TalkWeave on this computer"', JSON.stringify(await onLabel('data-transcription')) === '["TalkWeave on this computer"]', JSON.stringify(await onLabel('data-transcription')))
    ok('the Record tab starts with "Just me" by default', JSON.stringify(await onLabel('data-default-recording')) === '["Just me"]')
    await p3.locator('.radio[data-transcription="later"]').scrollIntoViewIfNeeded()
    await shot(p3, 'settings_recording')
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
    await closeSheet(p3)
    // answers-44a: a person's card no longer starts a recording ("Add a note" of the wave-6 person sheet is gone: notes live on the card);
    // the origin rule is what stays: from Web, the Record tab opens "Just me" whatever Settings says.
    await tapRing(p3, 'friend')
    await p3.getByRole('heading', { name: 'Add someone to your web?' }).waitFor({ timeout: 5_000 })
    await p3.getByPlaceholder('Name').first().fill('Lena')
    await p3.locator('[data-add-person]').click()
    await p3.locator('.node', { hasText: 'Lena' }).waitFor({ timeout: 5_000 })
    p3.on('dialog', (d) => void d.accept())
    await p3.locator('nav.tabs [data-go="web"]').click()
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
    await shot(p3, 'meeting_default')
    await ctx3.close()
    ok('no page errors in the settings run', errors.length === 0, JSON.stringify(errors))
}

main().catch((e) => { console.error(e); process.exit(1) })
