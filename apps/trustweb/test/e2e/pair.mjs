// Two-phone QR pairing (default: the LIVE deployment, TW_URL overrides): Anna's
// connect-link QR carries her notes in the URL fragment (never sent to the
// server, see screenMeet() in main.ts); Ben opens it, connects, and must receive those
// notes. Confirms no did:peer string ever reaches the DOM on either phone.
// Run: PW=<path to playwright-core> S=<screenshot dir> npx tsx pair.mjs
const pwm = await import(process.env.PW); const pw = pwm.chromium ? pwm : pwm.default
const S = process.env.S, B = process.env.TW_URL || 'https://app.idea2.site/trustweb/'
const browser = await pw.chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const errs = []
const mk = async () => { const c = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] }); await c.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p }
const a = await mk(), b = await mk()
await a.goto(B); await a.fill('input.field', 'Anna'); await a.click('text=Start on this phone')
// Notes ride along only from a meeting: Record > Meeting, consent, record, End meeting, Meet Ben.
// (Transcription off: headless Chromium crashes on the on-device speech probe.)
await a.locator('nav.tabs .tab-record').click(); await a.getByRole('button', { name: 'Meeting' }).click()
await a.fill('input[aria-label="Who are you meeting?"]', 'Ben'); await a.check('#consent')
await a.getByRole('switch', { name: /Transcribing/ }).click()
await a.getByRole('button', { name: 'Start recording' }).click(); await a.waitForTimeout(1200)
await a.getByRole('button', { name: 'End meeting' }).click()
await a.getByRole('button', { name: 'Meet Ben' }).click(); await a.waitForSelector('.qrwrap canvas')
const url = await a.getAttribute('.qrwrap', 'data-payload')
console.log('qr url has did param:', /connect=did/.test(url), 'len', url.length, 'notes:', /#n=/.test(url))
await b.goto(url); await b.screenshot({ path: S + '/p1_invite.png' })
await b.fill('input.field', 'Ben'); await b.getByRole('button', { name: 'Connect', exact: true }).click()
await a.waitForSelector('.toast.on', { timeout: 20000 }); console.log('A toast:', await a.textContent('.toast'))
await b.waitForTimeout(800); console.log('B toast:', await b.textContent('.toast'))
await b.click('.node:not(.you)'); await b.waitForTimeout(400); await b.screenshot({ path: S + '/p2_b_sheet.png' })
console.log('B sheet:', (await b.textContent('.sheet')).slice(0, 300))
// B asks, A has no inventory -> silent -> No match
await b.click('.sheet-veil', { position: { x: 30, y: 30 } }); await b.getByRole('button', { name: 'Query' }).click()
await b.fill('textarea', 'Anyone have a ladder?'); await b.click('text=Ask my web')
await b.waitForSelector('.card.asked .outcome', { timeout: 90000 }); console.log('B result:', await b.textContent('.card.asked .outcome'))
await a.screenshot({ path: S + '/p3_a_after.png' })
// check A's DOM contains no did string
console.log('A shows DID anywhere:', /did:peer/.test(await a.content()), 'B:', /did:peer/.test(await b.content()))
console.log('errors', JSON.stringify(errs))
await browser.close()
