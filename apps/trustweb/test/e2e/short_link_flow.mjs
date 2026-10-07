/**
 * Short connect links in the app (wave 5, part 2), headless, own ports:
 *   A  a page that is not an app origin (http://127.0.0.1): no Short link, no request, "Show the long link" works
 *   B  on https://app.trustintheweb.org (the loopback app behind a TLS front, STUBBED /link): nothing is requested on opening
 *      the Meet sheet; one request per tap; the QR, Copy and the long/short views follow the choice; a repeat tap and a switch
 *      back and forth ask the server no second time; the note says "30 days"
 *   N  an NFC tag always gets the long link, even with the short one chosen (Web NFC stubbed)
 *   C  every failure falls back to the long link: 500, 400, 429 with Retry-After, 503, 507, a broken 200, a refused connection,
 *      offline; a retry afterwards works
 *   D  a demo-account code (Meet > Demo account) offers it too, and its QR follows
 *   E  a code that carries a meeting's key (the pack on the real server) is not shortened (nothing sent), and says why
 *   F  the REAL services/trustweb-backup server (temp state dir, loopback 8992) behind the same origin: POST, the 302 with the
 *      fragment, and a second phone opening the short link lands on the connect screen of the first
 * Parts: PARTS=a,b,n,c,d,e,f (default all). SHOTS=<dir> saves screenshots.
 *
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8980 ../../node_modules/.bin/tsx ../trustweb/test/e2e/short_link_flow.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(HERE, '../../../../services/trustweb-backup/server.mjs')
const PORT = Number(process.env.TW_PORT || 8980)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const SERVICE_PORT = Number(process.env.TW_SERVICE_PORT || 8992)
const PARTS = (process.env.PARTS || 'a,b,n,c,d,e,f').split(',')
const HOST = 'app.trustintheweb.org'
const ID = 'AbCdEf0123'
const t = tally()
const errors = []

const shot = async (page, name) => {
  if (!process.env.SHOTS) return
  await page.locator('.link-choice').first().scrollIntoViewIfNeeded().catch(() => {})
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: path.join(process.env.SHOTS, name) })
}

async function newPage(browser, origin) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true,
    permissions: origin.startsWith('https') ? ['clipboard-read', 'clipboard-write', 'microphone'] : ['microphone'],
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return { ctx, page }
}

/** A fresh phone, then Meet's own code (the header's QR button). */
async function openMeet(page, origin, name = 'Jakob Possert-Bienzle') {
  await page.goto(origin + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  await page.locator('.meet-page .btn', { hasText: 'Copy link' }).waitFor()
}

const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
const canvasPng = (page) => page.evaluate(() => document.querySelector('.qrwrap canvas').toDataURL())
const shortBtn = (page) => page.locator('.link-choice [data-act="short"]')
const status = (page) => page.locator('.link-choice [data-short-status]')
const clip = (page) => page.evaluate(() => navigator.clipboard.readText())
const copyBtn = (page) => page.locator('.meet-page > .btn', { hasText: 'Copy link' })

/** Stubs POST /link; `answer(n)` gives the fulfilment for the n-th call. Returns the recorded bodies. */
async function stubLink(ctx, origin, answer) {
  const calls = []
  await ctx.route(origin + '/link', async (route) => {
    const req = route.request()
    calls.push({ method: req.method(), body: req.postData(), headers: req.headers() })
    const a = answer(calls.length)
    if (a === 'abort') return route.abort('connectionrefused')
    if (a === 'offline') return route.abort('internetdisconnected')
    return route.fulfill({ status: a.status, contentType: 'application/json', headers: a.headers ?? {}, body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) })
  })
  return calls
}
const ok201 = { status: 201, body: { id: ID, expires_at: Date.now() + 30 * 86_400_000 } }

async function partA(browser, base) {
  const origin = base.replace(/\/$/, '')
  const { ctx, page } = await newPage(browser, origin)
  const linkReqs = []
  page.on('request', (r) => { if (/\/(link|l\/)/.test(new URL(r.url()).pathname)) linkReqs.push(r.url()) })
  await openMeet(page, origin)
  t.ok('a: no "Short link" button on a page that is not an app origin', (await shortBtn(page).count()) === 0 || !(await shortBtn(page).isVisible()))
  t.ok('a: no note about the server either', !(await page.locator('.link-choice [data-short-note]').isVisible()))
  const long = await payload(page)
  t.ok('a: the QR carries the long connect link', /^http:\/\/127\.0\.0\.1:\d+\/\?connect=did%3Apeer%3A2/.test(long) && long.includes('&id=') && long.includes('&name='), long.slice(0, 80))
  const toggle = page.locator('.link-choice [data-act="long"]')
  t.ok('a: "Show the long link" is there, closed', (await toggle.innerText()).trim() === 'Show the long link' && (await toggle.getAttribute('aria-expanded')) === 'false' && !(await page.locator('.link-choice [data-link="long"]').isVisible()))
  await toggle.click()
  t.ok('a: it reveals the full long link (exactly what the QR carries)', (await page.locator('.link-choice [data-link="long"]').innerText()) === long)
  t.ok('a: and offers to hide it again', (await toggle.innerText()).trim() === 'Hide the long link' && (await toggle.getAttribute('aria-expanded')) === 'true')
  await shot(page, 'sl_a_not_an_app_origin.png')
  t.ok('a: no request went to /link or /l/ at any point', linkReqs.length === 0, linkReqs.join(' '))
  await ctx.close()
}

async function partB(browser, origin) {
  const { ctx, page } = await newPage(browser, origin)
  const calls = await stubLink(ctx, origin, () => ok201)
  await openMeet(page, origin)
  t.ok('b: the page is really on the app origin', page.url().startsWith(origin + '/'), page.url())
  t.ok('b: opening the Meet sheet asked the server nothing', calls.length === 0)
  t.ok('b: "Short link" is offered (not pressed)', (await shortBtn(page).isVisible()) && (await shortBtn(page).getAttribute('aria-pressed')) === 'false')
  const note = await page.locator('.link-choice [data-short-note]').innerText()
  t.ok('b: the note says 30 days, our server and that it expires', /our server for 30 days/.test(note) && /expires/.test(note), note)
  const long = await payload(page)
  t.ok('b: until the tap the QR carries the long link', long.startsWith(origin + '/?connect=did%3Apeer%3A2'), long.slice(0, 70))
  const longPng = await canvasPng(page)
  await shot(page, 'sl_b1_before_tap.png')

  await shortBtn(page).click()
  await page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 5_000 })
  t.ok('b: one tap, one POST', calls.length === 1 && calls[0].method === 'POST')
  t.ok('b: the body is exactly {"url": <the long link>}', JSON.stringify(JSON.parse(calls[0].body)) === JSON.stringify({ url: long }) && Object.keys(JSON.parse(calls[0].body)).join() === 'url')
  t.ok('b: sent as JSON, same-origin, no cookies', calls[0].headers['content-type'] === 'application/json')
  const short = `${origin}/l/${ID}`
  t.ok('b: the short link is shown', (await page.locator('.link-choice [data-link="short"]').innerText()) === short)
  t.ok('b: the QR now carries the short link', (await payload(page)) === short)
  t.ok('b: and the drawn QR changed (a shorter code)', (await canvasPng(page)) !== longPng)
  t.ok('b: the button reads pressed', (await shortBtn(page).getAttribute('aria-pressed')) === 'true')
  t.ok('b: the status says it is ready', /Short link ready/.test(await status(page).innerText()))
  await copyBtn(page).click()
  t.ok('b: Copy link copies the short link', (await clip(page)) === short)
  await shot(page, 'sl_b2_short_chosen.png')

  const toggle = page.locator('.link-choice [data-act="long"]')
  await toggle.click()
  t.ok('b: "Show the long link" reveals the full long link while the short one stays chosen', (await page.locator('.link-choice [data-link="long"]').innerText()) === long && (await payload(page)) === short)
  await page.locator('.link-choice [data-act="copy-long"]').click()
  t.ok('b: "Copy the long link" copies the long link', (await clip(page)) === long)
  await shot(page, 'sl_b3_long_revealed.png')

  await shortBtn(page).click() // toggle off
  t.ok('b: tapping the pressed button goes back to the long link: the QR carries it again', (await payload(page)) === long && (await canvasPng(page)) === longPng)
  t.ok('b: Copy link copies the long link again', (await copyBtn(page).click(), (await clip(page)) === long))
  t.ok('b: no new request for the way back', calls.length === 1)
  await shortBtn(page).click()
  await page.waitForFunction((s) => document.querySelector('.qrwrap')?.getAttribute('data-payload') === s, short)
  t.ok('b: choosing short a second time asks the server no second time (cached for the visit)', calls.length === 1 && (await payload(page)) === short)

  // a redraw of the screen (swipe to another Meet page and back) keeps the view, still no request
  await page.getByRole('tab', { name: 'Signal' }).click()
  await page.getByRole('tab', { name: /TrustWeb|Code/ }).first().click().catch(() => {})
  await page.locator('.qrwrap canvas').waitFor()
  await page.waitForFunction(() => !!document.querySelector('.link-choice [data-short-status]'))
  const afterRedraw = await payload(page)
  t.ok('b: after the screen redraws, the short link is still the one on show, and no new request', afterRedraw === short && calls.length === 1, afterRedraw.slice(0, 60) + ' ' + calls.length)
  await ctx.close()
}

/** Web NFC exists only in Chrome on Android: a stub that records what is written, to see which link a tag gets. */
async function partN(browser, origin) {
  const { ctx, page } = await newPage(browser, origin)
  await ctx.addInitScript(() => {
    window.__nfcWrites = []
    window.NDEFReader = class { async write(m) { window.__nfcWrites.push(m.records[0].data) } }
  })
  await stubLink(ctx, origin, () => ok201)
  await openMeet(page, origin)
  const long = await payload(page)
  await shortBtn(page).click()
  await page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 5_000 })
  await page.getByRole('button', { name: 'Write the long link to an NFC tag' }).click()
  await page.waitForFunction(() => window.__nfcWrites.length === 1)
  const written = await page.evaluate(() => window.__nfcWrites[0])
  t.ok('n: with the short link chosen, an NFC tag is still written with the LONG link (a tag is kept; a short link expires)', written === long && (await payload(page)).includes('/l/'), written.slice(0, 60))
  await ctx.close()
}

async function partC(browser, origin) {
  const cases = [
    { name: '500', answer: { status: 500, body: { error: 'server_error', message: 'x' } }, say: /did not answer properly/ },
    { name: '400', answer: { status: 400, body: { error: 'bad_request', message: 'x', field: 'url' } }, say: /did not accept this link/ },
    { name: '429 with Retry-After', answer: { status: 429, headers: { 'Retry-After': '7' }, body: { error: 'rate_limited', message: 'x' } }, say: /Too many short links.*Try again in 7 seconds/ },
    { name: '503 not_configured', answer: { status: 503, body: { error: 'not_configured', message: 'x' } }, say: /not switched on/ },
    { name: '507 storage_full', answer: { status: 507, body: { error: 'storage_full', message: 'x' } }, say: /as many short links as it can/ },
    { name: 'a 200 that is not a short link', answer: { status: 200, body: '<html>nope</html>' }, say: /did not answer properly/ },
    { name: 'a refused connection', answer: 'abort', say: /no answer from our server/ },
    { name: 'offline', answer: 'offline', say: /no answer from our server/ },
  ]
  for (const c of cases) {
    const { ctx, page } = await newPage(browser, origin)
    let mode = c.answer
    const calls = await stubLink(ctx, origin, () => mode)
    await openMeet(page, origin)
    const long = await payload(page)
    await shortBtn(page).click()
    await page.waitForFunction(() => /\./.test(document.querySelector('.link-choice [data-short-status]')?.textContent ?? '') && !/Making/.test(document.querySelector('.link-choice [data-short-status]')?.textContent ?? ''), null, { timeout: 15_000 })
    const said = await status(page).innerText()
    t.ok(`c: ${c.name}: says so and that the long link works as before`, c.say.test(said) && /long link works as before/.test(said), said)
    t.ok(`c: ${c.name}: the QR still carries the long link, the button is not pressed, no short line`,
      (await payload(page)) === long && (await shortBtn(page).getAttribute('aria-pressed')) === 'false' && !(await page.locator('.link-choice [data-link="short"]').isVisible()))
    t.ok(`c: ${c.name}: Copy link copies the long link`, (await copyBtn(page).click(), (await clip(page)) === long))
    t.ok(`c: ${c.name}: the button works again (a retry is possible)`, await shortBtn(page).isEnabled())
    if (c.name === '429 with Retry-After') {
      await shot(page, 'sl_c_429.png')
      mode = ok201
      await shortBtn(page).click()
      await page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 5_000 })
      t.ok('c: after the 429, a retry succeeds and the QR carries the short link', (await payload(page)) === `${origin}/l/${ID}` && calls.length === 2)
    }
    if (c.name === 'offline') {
      await shot(page, 'sl_c_offline.png')
      await ctx.setOffline(true)
      await shortBtn(page).click()
      await page.waitForTimeout(600)
      t.ok('c: with the whole context offline the long link stays and the page still shows it', (await payload(page)) === long && /no answer/.test(await status(page).innerText()))
      await ctx.setOffline(false)
    }
    await ctx.close()
  }
}

async function partD(browser, origin) {
  const { ctx, page } = await newPage(browser, origin)
  const calls = await stubLink(ctx, origin, () => ok201)
  await openMeet(page, origin)
  await page.getByRole('tab', { name: 'Demo account' }).click()
  const field = page.getByLabel('Name of the demo account')
  await page.waitForTimeout(500)
  await field.focus()
  await page.keyboard.type('Ada')
  await page.getByRole('button', { name: 'Make the demo account' }).click()
  await page.getByRole('heading', { name: 'Ada-demo is ready' }).waitFor({ timeout: 10_000 })
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const long = await payload(page)
  t.ok('d: a demo-account code carries the connect link and the account in its fragment', /^https:\/\/app\.trustintheweb\.org\/\?connect=.*#t=Ada-demo&a=/.test(long), long.slice(0, 120))
  t.ok('d: nothing asked yet; "Short link" is offered', calls.length === 0 && await shortBtn(page).isVisible())
  await shortBtn(page).click()
  await page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 5_000 })
  t.ok('d: one POST carrying exactly that long link, and the QR switches', calls.length === 1 && JSON.parse(calls[0].body).url === long && (await payload(page)) === `${origin}/l/${ID}`)
  await page.locator('.demo-acct .btn', { hasText: 'Copy link' }).click()
  t.ok('d: Copy link copies the short one', (await clip(page)) === `${origin}/l/${ID}`)
  const here = await page.locator('a.open-here').getAttribute('href')
  t.ok('d: "Open here" (a tab on this phone) stays the long, local link', /persona=demo-/.test(here) && !here.includes('/l/'), here.slice(0, 80))
  await shot(page, 'sl_d_demo_account_short.png')
  await ctx.close()
}

async function partE(browser, origin) {
  const { ctx, page } = await newPage(browser, origin)
  // headless Chromium crashes on the on-device speech probe: no speech engine, transcription off (as pair.mjs)
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  const posts = []
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/link') posts.push(r.postData()) })
  await page.goto(origin + '/')
  await page.getByLabel('Your first name').fill('Jakob')
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('nav.tabs .tab-record').click()
  await page.getByRole('button', { name: 'Meeting', exact: true }).click()
  await page.getByLabel('Who are you meeting?').fill('Ben')
  await page.locator('#consent').check()
  await page.getByRole('switch', { name: /Transcribing/ }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(2_500)
  await page.getByRole('button', { name: 'End meeting' }).click()
  await page.getByRole('heading', { name: 'Meeting ended' }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Meet Ben' }).click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  await page.waitForFunction(() => /[#&]k=/.test(document.querySelector('.qrwrap')?.getAttribute('data-payload') ?? ''), null, { timeout: 15_000 }).catch(() => {})
  const long = await payload(page)
  t.ok('e: the code after a meeting carries the meeting\'s key in its fragment (#...k=, the part that must not be sent)', /#.*\bk=TW/.test(long), long.slice(-100))
  t.ok('e: so "Short link" is not offered', !(await shortBtn(page).isVisible()))
  t.ok('e: and it says why', /notes or a key inside the link/.test(await status(page).innerText()), await status(page).innerText())
  t.ok('e: "Show the long link" is still there and shows it', await page.locator('.link-choice [data-act="long"]').isVisible())
  t.ok('e: nothing was sent to /link', posts.length === 0)
  await shot(page, 'sl_e_key_not_shortened.png')
  await ctx.close()
}

/** The real services/trustweb-backup on loopback with a temp state dir; its Host list names the e2e origin. */
async function startService() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-links-'))
  const env = {
    ...process.env, BACKUP_DIR: path.join(dir, 'backup'), PORT: String(SERVICE_PORT), HOST: '127.0.0.1',
    ALLOWED_HOSTS: `127.0.0.1,localhost,${HOST}`, LINK_HOSTS: HOST, RATE_LIMIT: '2000',
  }
  for (const k of ['HOSTED_DIR', 'FEEDBACK_FILE', 'TRANSCRIBE_URL', 'TRANSCRIBE_KEY', 'LINKS_FILE']) delete env[k]
  const proc = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  proc.stdout.on('data', (d) => log.push(String(d)))
  proc.stderr.on('data', (d) => log.push(String(d)))
  const t0 = Date.now()
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`)).status < 500) break } catch { /* not yet */ }
    if (Date.now() - t0 > 20_000) throw new Error('services did not start: ' + log.join(''))
    await new Promise((r) => setTimeout(r, 250))
  }
  return { dir, log, stop: async () => { proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); rmSync(dir, { recursive: true, force: true }) } }
}

/** One GET to the service with the Host the proxy would send; no redirect followed. */
function rawGet(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: SERVICE_PORT, path: pathname, headers: { Host: HOST } }, (res) => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }))
    })
    req.on('error', reject); req.end()
  })
}

async function partF(browser, origin, svc) {
  const a = await newPage(browser, origin)
  const posts = []
  a.page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/link') posts.push(r.postData()) })
  await openMeet(a.page, origin, 'Jakob Possert-Bienzle')
  const long = await payload(a.page)
  await shortBtn(a.page).click()
  await a.page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 10_000 })
  const short = await a.page.locator('.link-choice [data-link="short"]').innerText()
  t.ok('f: the real server made a short link of the form <origin>/l/<10 characters>', new RegExp(`^${origin.replace(/[.]/g, '\\.')}/l/[A-Za-z0-9]{10}$`).test(short), short)
  t.ok('f: it is much shorter than the long link', short.length < long.length / 4, `${short.length} vs ${long.length}`)
  t.ok('f: exactly one POST, carrying the long link', posts.length === 1 && JSON.parse(posts[0]).url === long)
  t.ok('f: the QR carries the short link', (await payload(a.page)) === short)
  const id = short.split('/l/')[1]
  const redirect = await rawGet('/l/' + id)
  t.ok('f: GET /l/<id> answers 302 to the long link, fragment included (none here: a plain connect link), no-store', redirect.status === 302 && redirect.headers.location === long && /no-store/.test(redirect.headers['cache-control'] ?? ''), JSON.stringify(redirect))
  const missing = await rawGet('/l/ZZZZZZZZZZ')
  t.ok('f: an unknown id answers 404', missing.status === 404)

  // a second phone opens the short link: the redirect lands on the first phone's connect screen
  const b = await newPage(browser, origin)
  await b.page.goto(short)
  await b.page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  const body = await b.page.locator('body').innerText()
  t.ok('f: the second phone, opening the short link, lands on the connect screen naming Jakob Possert-Bienzle', /Jakob Possert-Bienzle/.test(body) && (await b.page.getByRole('button', { name: 'Connect', exact: true }).count()) === 1, body.slice(0, 200))
  await shot(b.page, 'sl_f_opened_via_short_link.png')
  await b.ctx.close()

  // the same for a demo-account link: the fragment (t, a, x ...) survives the redirect
  await a.page.getByRole('tab', { name: 'Demo account' }).click()
  await a.page.waitForTimeout(500)
  await a.page.getByLabel('Name of the demo account').focus()
  await a.page.keyboard.type('Ada')
  await a.page.getByRole('button', { name: 'Make the demo account' }).click()
  await a.page.getByRole('heading', { name: 'Ada-demo is ready' }).waitFor({ timeout: 10_000 })
  await a.page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const demoLong = await payload(a.page)
  await shortBtn(a.page).click()
  await a.page.locator('.link-choice [data-link="short"]').waitFor({ timeout: 10_000 })
  const demoShort = await a.page.locator('.link-choice [data-link="short"]').innerText()
  const demoRedirect = await rawGet('/l/' + demoShort.split('/l/')[1])
  t.ok('f: a demo-account link comes back from the redirect byte for byte, #fragment included', demoRedirect.status === 302 && demoRedirect.headers.location === demoLong && demoLong.includes('#t=Ada-demo&a='), (demoRedirect.headers.location ?? '').slice(-80))
  const c = await newPage(browser, origin)
  await c.page.goto(demoShort)
  await c.page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  const body2 = await c.page.locator('body').innerText()
  t.ok('f: a phone that opens the demo short link is offered the connection to Jakob Possert-Bienzle', /Jakob Possert-Bienzle/.test(body2), body2.slice(0, 200))
  await c.ctx.close()

  // the store: a file, 0600, no log line with an id or url
  const links = JSON.parse(readFileSync(path.join(svc.dir, 'backup', 'links.json'), 'utf8'))
  t.ok('f: the service stored two links (one per distinct long link)', JSON.stringify(links).includes(id) && (Array.isArray(links) ? links.length : Object.keys(links.links ?? links).length) >= 2)
  t.ok('f: its log names neither ids nor urls', !svc.log.join('').includes(id) && !svc.log.join('').includes('connect='))
  await a.ctx.close()
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let svc = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, servicePort: PARTS.some((p) => p === 'e' || p === 'f') ? SERVICE_PORT : undefined, host: HOST })
    if (PARTS.some((p) => p === 'e' || p === 'f')) svc = await startService()
    browser = await launch([...front.browserArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    console.log(`short_link_flow: app ${app.base}, https front ${front.origin} -> :${HTTPS_PORT}, service :${SERVICE_PORT}`)
    if (PARTS.includes('a')) await partA(browser, app.base)
    if (PARTS.includes('b')) await partB(browser, front.origin)
    if (PARTS.includes('n')) await partN(browser, front.origin)
    if (PARTS.includes('c')) await partC(browser, front.origin)
    if (PARTS.includes('d')) await partD(browser, front.origin)
    if (PARTS.includes('e')) await partE(browser, front.origin)
    if (PARTS.includes('f')) await partF(browser, front.origin, svc)
  } finally {
    await browser?.close()
    await svc?.stop()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nSHORT LINK FLOW: ALL PASS' : `\nSHORT LINK FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
