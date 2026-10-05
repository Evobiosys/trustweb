/**
 * The Record tab (owner's voice memo, 2026-10-05): mic centred at the top,
 * recording by myself by default, points to cover that can be ticked off
 * and still edited while recording, "Recording meeting" in the top-right pill
 * on every screen, a Transcript button top right with the audio file, a
 * shared recording that needs the other person's yes and then offers the
 * Meet code, and the Inventory settings that swap the outer tabs.
 *
 * Chromium's fake microphone stands in for a real one, so MediaRecorder
 * really records. Local only: a real RelayServer + Vite dev server.
 * TW_SHOTS=<dir> also saves a screenshot per step.
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
  const browser = await engine.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  })
  let n = 0
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_${name}.png`) }) }
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
    await page.goto(base)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
    await shot(page, 'web')

    // Record tab: mic first, solo by default, no consent needed
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 10_000 })
    const heroFirst = await page.evaluate(() => {
      const scroll = document.querySelector('.screen .scroll')
      return scroll?.firstElementChild?.classList.contains('rec-hero') ?? false
    })
    ok('the mic sits at the top of Record, above the fields', heroFirst)
    ok('"Just me" is the default mode', (await page.locator('.rec-mode button.on').innerText()).trim() === 'Just me')
    ok('no transcript-consent wording on Record', !/agreed to a transcript/.test(await page.locator('.screen').innerText()))
    await shot(page, 'record_idle')

    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.status-pill.rec').waitFor({ timeout: 10_000 })
    ok('top-right pill says "Recording meeting" while recording', (await page.locator('.status-pill.rec').innerText()).trim() === 'Recording meeting')

    await page.getByLabel('Who are you meeting?').fill('Maya')
    await page.getByLabel('Where are you meeting?').fill('coffee at the Hub')
    const addPoint = async (t) => {
      await page.getByPlaceholder('Add a point, e.g. ask about the flat').fill(t)
      await page.getByRole('button', { name: 'Add', exact: true }).click()
    }
    await addPoint('Ask about the flat in Graz')
    await addPoint('Mention the motorbike')
    await page.locator('.point').first().locator('input[type=checkbox]').check()
    ok('a ticked point is marked addressed', await page.locator('.point.done').count() === 1)
    await page.locator('.point').first().locator('.point-text').fill('Ask about the flat in Graz (she has one from March)')
    ok('a ticked point stays editable while recording',
      (await page.locator('.point').first().locator('.point-text').inputValue()).includes('from March'))
    await page.locator('textarea.note').fill('She can lend a cargo bike. Looking for a co-founder.')
    await page.waitForTimeout(1500)
    await shot(page, 'record_live')

    // the pill follows you to other screens and brings you back
    await page.getByRole('button', { name: 'Web' }).click()
    ok('"Recording meeting" shows on the Web screen too', await page.locator('.status-pill.rec').isVisible())
    await page.locator('.status-pill.rec').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    ok('tapping the pill returns to the recording, draft intact', (await page.getByLabel('Who are you meeting?').inputValue()) === 'Maya')

    // a new note never silently drops the live recording
    await page.getByRole('button', { name: 'Web' }).click()
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('button', { name: /Note someone new/ }).click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })
    ok('"Note someone new" during a recording returns to it instead of dropping it',
      (await page.getByLabel('Who are you meeting?').inputValue()) === 'Maya' && await page.locator('.status-pill.rec').isVisible())

    // Manage > Connect shares no notes from the draft in progress
    await page.getByRole('button', { name: 'Web' }).click()
    await page.getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('button', { name: 'Connect with someone' }).click()
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const manageLink = await page.getAttribute('.qrwrap', 'data-payload')
    ok('a code shown from Manage carries no notes', !/#n=/.test(manageLink ?? '#n='), manageLink ?? '')
    ok('Meet from Manage is not titled after the draft', await page.getByRole('heading', { name: 'Meet', exact: true }).isVisible())
    await page.locator('.status-pill.rec').click()
    await page.getByRole('heading', { name: 'Record' }).waitFor({ timeout: 5_000 })

    await page.getByRole('button', { name: 'Stop recording' }).click()
    // The clock shows while live too, so wait for the mic to flip back instead.
    await page.getByRole('button', { name: 'Start recording' }).waitFor({ timeout: 5_000 })
    ok('the pill drops "Recording meeting" once stopped', await page.locator('.status-pill.rec').count() === 0)

    // transcript sheet: audio file for later transcription on a computer
    await page.getByRole('button', { name: 'Transcript' }).click()
    const saveBtn = page.getByRole('button', { name: /Save audio file/ })
    ok('Transcript offers the recorded audio file', await saveBtn.isVisible())
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), saveBtn.click()])
    ok('the audio file downloads with a sensible name', /^trustweb-Maya-.*\.(webm|m4a|ogg)$/.test(download.suggestedFilename()), download.suggestedFilename())
    await shot(page, 'transcript_sheet')
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })

    // shared recording: needs the yes, info hint, then offers Meet
    await page.getByRole('button', { name: 'Shared', exact: true }).click()
    ok('shared mode shows "<name> agreed to the recording."', await page.getByText('Maya agreed to the recording.').isVisible())
    await page.getByRole('button', { name: 'How to start' }).click()
    ok('the info button shows how to start', await page.getByText('Okay, we\'re recording now.', { exact: false }).isVisible())
    await page.getByRole('button', { name: 'Start recording' }).click()
    ok('a shared recording waits for the tick', await page.getByText('For a shared recording, tick the line above first.').isVisible())
    await page.locator('#consent').check()
    await shot(page, 'record_shared')
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.locator('.status-pill.rec').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await page.getByRole('heading', { name: 'Connect with Maya?' }).waitFor({ timeout: 5_000 })
    ok('after a shared recording it offers to connect', true)
    await shot(page, 'connect_prompt')
    await page.getByRole('button', { name: 'Show my code' }).click()
    await page.getByRole('heading', { name: 'Meet Maya' }).waitFor({ timeout: 5_000 })
    await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const payload = await page.getAttribute('.qrwrap', 'data-payload')
    ok('Meet shows the QR with the notes in the fragment', /#n=/.test(payload ?? ''), payload ?? '')
    ok('Meet shows exactly which notes are shared', /cargo bike/.test(await page.locator('.shared-notes').innerText()))
    ok('Meet explains NFC honestly where it is unavailable', await page.getByText(/Tap-to-connect needs Chrome on Android/).isVisible())
    await shot(page, 'meet')

    // back to Record, make notes: points and notes both arrive in Review, with the audio card
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByRole('button', { name: 'Make notes' }).click()
    await page.getByRole('heading', { name: /Notes about Maya/ }).waitFor({ timeout: 10_000 })
    const lines = await page.locator('.line-text').evaluateAll((els) => els.map((e) => e.value))
    ok('Review holds the points and the notes', lines.some((l) => /flat in Graz/.test(l)) && lines.some((l) => /cargo bike/.test(l)), JSON.stringify(lines))
    ok('Review offers the audio before it is dropped', await page.locator('.rec-card').isVisible())
    ok('a second take is kept, not overwritten', /2 takes/.test(await page.locator('.rec-card').innerText())
      && await page.locator('.rec-card button').count() === 2)
    await shot(page, 'review')

    // Inventory settings swap the outer tabs; Record stays in the middle
    await page.getByRole('button', { name: 'Inventory' }).click()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Inventory on the left, Web on the right' }).click()
    await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    const tabs = (await page.locator('nav.tabs button').allInnerTexts()).map((t) => t.trim())
    ok('settings swap Web and Inventory around Record', JSON.stringify(tabs) === JSON.stringify(['Inventory', 'Record', 'Web']), JSON.stringify(tabs))
    await page.reload()
    const tabsAfter = (await page.locator('nav.tabs button').allInnerTexts()).map((t) => t.trim())
    ok('the tab order survives a reload', JSON.stringify(tabsAfter) === JSON.stringify(['Inventory', 'Record', 'Web']), JSON.stringify(tabsAfter))

    // the Web screen's query dock keeps the rings in view
    await page.getByRole('button', { name: 'Web' }).click()
    await page.getByRole('button', { name: 'Query' }).click()
    ok('Query opens a dock under the rings', await page.locator('.query-dock').isVisible() && await page.locator('.rings-wrap').isVisible())
    await shot(page, 'web_query')
    ok('no page errors', errors.length === 0, JSON.stringify(errors))

    // a populated web: with the dock open, every person stays above it
    const demo = await ctx.newPage()
    await demo.goto(base + 'ea-demo/')
    const maya = demo.frameLocator('iframe[title="Maya\'s phone"]')
    await maya.getByRole('button', { name: 'Query' }).click({ timeout: 30_000 })
    await demo.waitForTimeout(400)
    const fit = await demo.evaluate(() => {
      const f = [...document.querySelectorAll('iframe')].find((i) => i.title === "Maya's phone")
      const doc = f?.contentDocument
      const dock = doc?.querySelector('.query-dock')?.getBoundingClientRect()
      const nodes = [...(doc?.querySelectorAll('.rings-wrap .node') ?? [])].map((n) => n.getBoundingClientRect().bottom)
      return { dockTop: dock?.top ?? 0, lowest: Math.max(...nodes), count: nodes.length }
    })
    ok(`all ${fit.count} people stay above the query dock`, fit.count > 3 && fit.lowest <= fit.dockTop, JSON.stringify(fit))
    if (SHOTS) await demo.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}_ea_demo_query.png`) })
    await demo.close()

    // the phone ending a take (call, lock, mic taken) keeps what was recorded
    const ctx2 = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    await ctx2.addInitScript(() => {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (c) => { const st = await orig(c); window.__streams = [...(window.__streams || []), st]; return st }
    })
    const p2 = await ctx2.newPage()
    await p2.goto(base)
    await p2.getByLabel('Your first name').fill('Jakob')
    await p2.getByRole('button', { name: 'Start on this phone' }).click()
    await p2.locator('nav.tabs .tab-record').click()
    await p2.getByRole('button', { name: 'Start recording' }).click()
    await p2.locator('.status-pill.rec').waitFor({ timeout: 10_000 })
    await p2.waitForTimeout(1500)
    await p2.evaluate(() => { for (const st of window.__streams) for (const t of st.getTracks()) { t.stop(); t.dispatchEvent(new Event('ended')) } })
    await p2.getByText('The recording was stopped by the phone', { exact: false }).waitFor({ timeout: 5_000 })
    ok('a take ended by the phone says so', true)
    await p2.getByRole('button', { name: 'Transcript' }).click()
    ok('and its audio is kept', await p2.getByRole('button', { name: /Save audio file/ }).isVisible())
    ok('the pill drops "Recording meeting" after the phone ends it', await p2.locator('.status-pill.rec').count() === 0)
    await ctx2.close()
  } finally {
    await browser.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nrecord-flow: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
