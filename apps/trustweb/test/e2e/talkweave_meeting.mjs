/**
 * The Meeting view against a REAL TalkWeave, in a real browser: Chromium's
 * fake microphone plays a speech WAV (macOS `say`), the app streams it to
 * TalkWeave through the same-origin /talkweave proxy, and the Tana-style
 * transcript must show recognised words, labelled with the chosen speaker.
 *
 * Needs, already running: the TrustWeb dev server with TW_TALKWEAVE_PROXY
 * (TW_URL, default http://127.0.0.1:5190/), TalkWeave on that proxy target, and
 * its ASR engine. TW_SPEECH_WAV: a 16-bit PCM WAV with clear speech.
 *
 * Run from apps/demo/:
 *   TW_SPEECH_WAV=/path/speech.wav PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/talkweave_meeting.mjs
 */
const BASE = process.env.TW_URL || 'http://127.0.0.1:5190/'
const WAV = process.env.TW_SPEECH_WAV
const SHOT = process.env.TW_SHOT

let failures = 0
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`)
  else { failures++; console.log(`  FAIL  ${name}${detail ? '  ->  ' + detail : ''}`) }
}

async function main() {
  if (!WAV) throw new Error('set TW_SPEECH_WAV')
  const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
  const engine = (pw.chromium ? pw : pw.default).chromium
  const browser = await engine.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  })
  try {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(BASE)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await page.locator('nav.tabs .tab-record').click()
    await page.getByRole('button', { name: 'Meeting' }).click()
    await page.getByLabel('Who are you meeting?').fill('Maya')
    await page.locator('#consent').check()
    await page.locator('.speakers .chip', { hasText: 'Speaker 2' }).click()
    await page.getByRole('button', { name: 'Start recording' }).click()
    await page.getByText('Transcribing with TalkWeave on this computer').waitFor({ timeout: 15_000 })
    ok('the engine is TalkWeave on this computer', true)
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
  } finally {
    await browser.close()
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\ntalkweave-meeting: ALL PASS')
  process.exit(failures ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
