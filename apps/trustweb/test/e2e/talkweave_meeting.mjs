/**
 * The Meeting view against a REAL TalkWeave, in a real browser: Chromium's
 * fake microphone plays a speech WAV (macOS `say`), the app streams it to
 * TalkWeave through the same-origin /talkweave proxy, and the Tana-style
 * transcript must show recognised words, labelled with the chosen speaker.
 *
 * Needs, already running: the TrustWeb dev server (TW_URL, default
 * http://127.0.0.1:5190/), TalkWeave on 127.0.0.1:8990 and its ASR engine.
 * TW_SPEECH_WAV: a 16-bit PCM WAV with clear speech. The page reaches TalkWeave
 * either through the dev server's same-origin /talkweave proxy (start the dev
 * server with TW_TALKWEAVE_PROXY) or, with no proxy, directly at
 * http://127.0.0.1:8990 across origins, which TalkWeave only allows for this
 * page's origin (its built-in list holds https://app.idea2.site; for a plain
 * local origin start TalkWeave with TALKWEAVE_EXTRA_ORIGINS=<that origin>).
 *
 * Optional environment:
 *   TW_MIRROR_ORIGIN  e.g. https://app.idea2.site: the page is loaded at that
 *                     real https origin, its files served from TW_URL through
 *                     Playwright's request interception. Nothing is deployed;
 *                     this exercises the https page -> http://127.0.0.1 path.
 *   TW_PERMISSIONS    extra browser permissions, comma separated. Chromium asks
 *                     before a public page may reach 127.0.0.1 and denies it
 *                     headless unless granted: local-network-access.
 *   TW_NO_SPEECH     1: remove Web Speech from the page, as the other e2e tests
 *                     do. Needed when TalkWeave is expected NOT to be used: the
 *                     on-device check then crashes headless Chromium.
 *   TW_LABEL_ONLY    1: stop after the Start tap and only REPORT which engine the
 *                     page picked (and the console), without asserting it.
 *   TW_DIRECT         0: leave Settings > Recording > "Transcribed by" on Automatic (no loopback probe)
 *                     (default: switch it on, so the direct path is tried).
 *   TW_BROWSER        chromium (default), webkit or firefox. Only Chromium
 *                     plays TW_SPEECH_WAV as the microphone; elsewhere only the
 *                     engine label is checked and the console is reported.
 *
 * Run from apps/demo/:
 *   TW_SPEECH_WAV=/path/speech.wav PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/talkweave_meeting.mjs
 */
const BASE = process.env.TW_URL || 'http://127.0.0.1:5190/'
const WAV = process.env.TW_SPEECH_WAV
const SHOT = process.env.TW_SHOT
const BROWSER = process.env.TW_BROWSER || 'chromium'
const MIRROR = process.env.TW_MIRROR_ORIGIN
const EXTRA_PERMISSIONS = (process.env.TW_PERMISSIONS || '').split(',').filter(Boolean)
const NO_SPEECH = process.env.TW_NO_SPEECH === '1'
const FAKE_MIC = BROWSER === 'chromium'
const LABEL_ONLY = process.env.TW_LABEL_ONLY === '1' || !FAKE_MIC

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function main() {
  if (!WAV) throw new Error('set TW_SPEECH_WAV')
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw[BROWSER] ? pw : pw.default)[BROWSER]
  const browser = await engine.launch({
    headless: true,
    args: FAKE_MIC ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`] : [],
  })
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone', ...EXTRA_PERMISSIONS] })
    if (NO_SPEECH) await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
    if (MIRROR) {
      // Serve the https mirror origin from the local dev server (a leading /trustweb is the live base path).
      await ctx.route(`${MIRROR}/**`, async (route) => {
        const u = new URL(route.request().url())
        const upstream = new URL(u.pathname.replace(/^\/trustweb(?=\/|$)/, '') + u.search, BASE)
        const res = await route.fetch({ url: upstream.href })
        await route.fulfill({ response: res })
      })
    }
    const page = await ctx.newPage()
    const errors = []
    const consoleLines = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`[${m.type()}] ${m.text()}`) })
    console.log(`browser: ${BROWSER} ${browser.version()}  page origin: ${MIRROR || new URL(BASE).origin}`)
    await page.goto(MIRROR ? `${MIRROR}/trustweb/` : BASE)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    // Reaching TalkWeave directly (no same-origin proxy) is opt-in, in Settings.
    if (process.env.TW_DIRECT !== '0') {
      await page.getByRole('button', { name: 'More' }).click()
      await page.locator('.menu-item', { hasText: 'Settings' }).click()
      await page.locator('.radio[data-transcription="talkweave"]').click()
      await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
    }
    await page.locator('nav.tabs .tab-record').click()
    // exact: the closed Settings sheet stays in the DOM, and its radios mention meetings too
    await page.getByRole('button', { name: 'Meeting', exact: true }).click()
    await page.getByLabel('Who are you meeting?').fill('Maya')
    await page.locator('#consent').check()
    await page.locator('.speakers .chip', { hasText: 'Speaker 2' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    // Before the Start tap's probe finishes the label reads "A transcriber is looked for when you start."
    const label = page.locator('.tr-engine').first()
    await page.waitForFunction(
      () => /^(Transcribing|No transcriber)/.test(document.querySelector('.tr-engine')?.textContent?.trim() ?? ''),
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    const engineText = (await label.innerText()).trim()
    console.log(`  engine label: ${engineText}`)
    if (!LABEL_ONLY) ok('the engine is TalkWeave on this computer', engineText === 'Transcribing with TalkWeave on this computer', engineText)
    if (LABEL_ONLY) {
      console.log(FAKE_MIC ? '  (label only: words not checked)' : `  (${BROWSER} has no fake microphone: words not checked)`)
      if (consoleLines.length) console.log('  console:\n    ' + consoleLines.join('\n    '))
      console.log(failures ? `\n${failures} FAILURE(S)` : '\ntalkweave-meeting: DONE (engine label reported, not asserted)')
      await browser.close()
      process.exit(failures ? 1 : 0)
    }
    // The WAV loops; give TalkWeave a couple of windows to finalise.
    await page.locator('.tr-row').first().waitFor({ timeout: 45_000 })
    await page.waitForTimeout(12_000)
    const rows = await page.locator('.tr-row').allInnerTexts()
    const all = rows.join(' | ')
    ok('transcript rows appear', rows.length > 0, all)
    ok('the words are recognised (flat / Graz / cargo bike)', /flat|graz|cargo|bike|maya/i.test(all), all.slice(0, 300))
    ok('rows carry the chosen speaker and a timestamp', /Speaker 2/.test(all) && /\d\d:\d\d:\d\d/.test(all), all.slice(0, 200))
    if (SHOT) await page.screenshot({ path: SHOT })
    await page.getByRole('button', { name: 'End meeting' }).click()
    await page.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 15_000 })
    ok('End meeting works with a live transcriber', true)
    ok('no page errors', errors.length === 0, JSON.stringify(errors))
    if (consoleLines.length) console.log('  console:\n    ' + consoleLines.join('\n    '))
  } finally {
    await browser.close()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\ntalkweave-meeting: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
