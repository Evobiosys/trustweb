/**
 * Wave 6b, V2 a + d: the connect code on the Meet page, and a scan that lands on the person. Headless phones over a REAL test relay,
 * on the app origin https://app.trustintheweb.org (a TLS front on loopback, as short_link_flow), with the connect service STUBBED in the
 * browser (test/helpers/fake_connect_server.mjs: POST /connect, GET /c/<code> as a 302 to the stored long link).
 *   A  the Meet page: the long link until the server answers (a SLOW server), then /c/<code> in the QR, in the line, in Copy; the POST
 *      holds only the link; a new name UPDATES the same code; a refused server leaves the long link, and the next visit retries
 *   B  a phone with an account opens /c/<code> (the 302 keeps the fragment): the add sheet names the sharer, the ring is chosen, "Add to my
 *      web" adds AND connects, the card opens with "Message on Signal" (the sharer's username link) once it arrives; "Not now" keeps an acquaintance
 *   C  the first-time visitor is not swallowed: the Connect screen names the sharer, and after the account is made the add sheet follows
 *   D  a link with no name (a bare DID): "Waiting for their name..." in an EDITABLE field; typing is never overwritten by the late name, no typing
 *      is replaced by it; "Add to my web" never waits for it (a DELAYED relay)
 *   E  a demo-account link keeps the direct flow (no add sheet)
 * Ports: Vite 8983, TLS front 8984. TW_SHOTS=<dir> for screenshots.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8983 ../../node_modules/.bin/tsx ../trustweb/test/e2e/connect_code_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'
import { saveChannel } from '../helpers/share_box.mjs'

const PORT = Number(process.env.TW_PORT || 8983)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const USERNAME_LINK = 'https://signal.me/#eu/adaUsernameCode0123456789'
const t = tally()
const errors = []

/** The registrations only: since wave 6e Meet also READs the names with a POST /name (the names block), which these counts are not about. */
const connectPosts = (srv) => srv.posts.filter((p) => p.path === '/connect')
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
/** Waits for a locator to show (locator.isVisible() does not wait). */
const appears = (locator, ms = 10_000) => locator.waitFor({ timeout: ms }).then(() => true, () => false)
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')

async function newPhone(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write', 'microphone'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return { ctx, page }
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

async function openMeet(page) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
}

const addSheetOpen = (page) => page.locator('.sheet.on [data-connect-add-title]').waitFor({ timeout: 20_000 }).then(() => true, () => false)

async function addToWeb(page) {
  await page.locator('.sheet.on [data-connect-add]').click()
}

/** Ada's phone: an account, Meet open, the code made; her Signal username link saved (shared on connect). */
async function adaPhone(browser, server, name = 'Ada Lovelace') {
  const a = await newPhone(browser, server)
  await startPhone(a.page, name)
  return a
}

async function partA(browser) {
  const server = fakeConnectServer(ORIGIN)
  server.delayMs = 1200
  const { ctx, page } = await newPhone(browser, server)
  await startPhone(page, 'Ada Lovelace')
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const first = await payload(page)
  t.ok('a: before the server answers the QR carries the long connect link', /^https:\/\/app\.trustintheweb\.org\/\?connect=did%3Apeer%3A2/.test(first) && first.includes('&id=') && first.includes('&name=Ada'), first.slice(0, 90))
  t.ok('a: and the page says so ("Long link, until the server answers")', /Long link, until the server answers/.test(await page.locator('[data-code-status]').innerText()))
  t.ok('a: Copy link copies the long link meanwhile', (await page.locator('.meet-page > .btn', { hasText: 'Copy link' }).click(), (await page.evaluate(() => navigator.clipboard.readText())) === first))
  const code = await until(async () => { const c = [...server.codes.keys()][0]; return c && (await payload(page)) === `${ORIGIN}/c/${c}` ? c : null }, 15_000)
  t.ok('a: then the QR carries the code link https://<host>/c/<22 chars>', !!code && /^[A-Za-z0-9_-]{22}$/.test(code), String(code))
  t.ok('a: shown as a line too, and the status line is gone', (await page.locator('[data-link="code"]').innerText()) === `${ORIGIN}/c/${code}` && (await page.locator('[data-code-status]').innerText()) === '')
  t.ok('a: exactly one POST, holding only the long link (no code, no secret)', connectPosts(server).length === 1 && JSON.stringify(Object.keys(connectPosts(server)[0].body)) === '["url"]' && connectPosts(server)[0].body.url === first.split('#')[0])
  t.ok('a: the QR is short now (well under a third of the long link)', (await payload(page)).length < first.length / 3)
  await page.locator('.meet-page > .btn', { hasText: 'Copy link' }).click()
  t.ok('a: Copy link copies the code link', (await page.evaluate(() => navigator.clipboard.readText())) === `${ORIGIN}/c/${code}`)
  const rec = (await record(page)).connectCode
  t.ok('a: the phone keeps {code, secret, url, updatedAt}', rec && rec.code === code && rec.secret === server.codes.get(code).secret && rec.url === first && typeof rec.updatedAt === 'number')
  t.ok('a: the secret is on no page url and in no visible text', !page.url().includes(rec.secret) && !(await page.locator('body').innerText()).includes(rec.secret))
  await page.locator('[data-act="long"]').click()
  t.ok('a: "Show the long link" still shows the long link', (await page.locator('[data-link="long"]').innerText()) === first)
  await shot(page, 'cc_a_code_link.png')

  // a new name: the same code, updated
  server.delayMs = 0
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Ada Lovelace' }).click()
  await page.locator('.sheet input[aria-label="Your name"]').fill('Ada Byron')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const updated = await until(async () => connectPosts(server).length === 2 && connectPosts(server)[1].body)
  t.ok('a: a new name sends an UPDATE (url, the same code and its secret)', !!updated && updated.code === code && updated.secret === rec.secret && updated.url.includes('name=Ada+Byron'), JSON.stringify(updated).slice(0, 120))
  t.ok('a: the record keeps the same code, with the new url', (await until(async () => (await record(page)).connectCode.url.includes('name=Ada+Byron'))) && (await record(page)).connectCode.code === code)
  await ctx.close()

  // a broken server: the long link stays, nothing blocks; the next visit asks again
  const broken = fakeConnectServer(ORIGIN)
  broken.failNext = 1 // the first attempt, made when Meet opens (the server is not told of a phone before its code is shown)
  const b = await newPhone(browser, broken)
  await startPhone(b.page, 'Bo Broken')
  await openMeet(b.page)
  await until(async () => connectPosts(broken).length >= 1)
  await b.page.waitForTimeout(500)
  const long = await payload(b.page)
  t.ok('a: a 500 from the server: the long link stays in the QR, and no error page', /\?connect=did%3Apeer%3A2/.test(long) && (await b.page.locator('.meet-page').isVisible()))
  t.ok('a: Copy link still works and copies the long link', (await b.page.locator('.meet-page > .btn', { hasText: 'Copy link' }).click(), (await b.page.evaluate(() => navigator.clipboard.readText())) === long))
  t.ok('a: no record was kept', (await record(b.page)).connectCode === undefined)
  await b.page.waitForTimeout(3200) // review 6b: right after a failure a redraw does not ask again (CONNECT_MIN_GAP_MS)
  await b.page.getByRole('button', { name: 'Back' }).click()
  await b.page.locator('.hdr [aria-label^="Show my code"]').click()
  const code2 = await until(async () => { const c = [...broken.codes.keys()][0]; return c && (await payload(b.page)) === `${ORIGIN}/c/${c}` ? c : null }, 15_000)
  t.ok('a: opening Meet again asks again and the code arrives', !!code2 && connectPosts(broken).length === 2)
  await b.ctx.close()
}

async function partB(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await adaPhone(browser, server)
  // Ada's Signal username link, ticked by default (a username link is)
  await a.page.locator('.hdr [aria-label^="Show my code"]').click()
  await saveChannel(a.page, 'signal', USERNAME_LINK)
  await a.page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const code = await until(async () => { const c = [...server.codes.keys()][0]; return c && (await payload(a.page)) === `${ORIGIN}/c/${c}` ? c : null }, 15_000)
  t.ok('b: Ada\'s code is on screen', !!code)

  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Builder')
  const opensBefore = server.opens.length
  await b.page.goto(`${ORIGIN}/c/${code}#n=${encodeURIComponent('Notes from Ada')}`)
  t.ok('b: Bo opens /c/<code>: the 302 reached the app', server.opens.length === opensBefore + 1)
  t.ok('b: the add sheet opens, naming Ada (from the link)', await addSheetOpen(b.page))
  t.ok('b: title "Add Ada Lovelace to your web?" and the name field holds her name', (await b.page.locator('.sheet.on [data-connect-add-title]').innerText()) === 'Add Ada Lovelace to your web?' && (await b.page.locator('.sheet.on [data-connect-add-name]').inputValue()) === 'Ada Lovelace')
  t.ok('b: the address bar no longer holds the link', !b.page.url().includes('connect=') && !b.page.url().includes('#n='))
  const recB = await record(b.page)
  t.ok('b: already connected underneath (the handshake ran), and the 302 kept the fragment (her notes arrived)', recB.peers.length === 1 && recB.peers[0].displayName === 'Ada Lovelace' && JSON.stringify(recB.people).includes('Notes from Ada'), JSON.stringify(recB.people).slice(0, 160))
  t.ok('b: Ada\'s phone got Bo as a connection too', !!(await until(async () => (await record(a.page)).peers.length === 1)))
  await shot(b.page, 'cc_b_add_sheet.png')
  await b.page.locator('.sheet.on [data-ring="friend"]').click()
  await addToWeb(b.page)
  t.ok('b: the card of Ada opens', await appears(b.page.locator('.sheet.on h3', { hasText: 'Ada Lovelace' }), 5000))
  const afterAdd = await record(b.page)
  t.ok('b: she is in the Friend ring, on the person AND on the connection', afterAdd.people[0].ring === 'friend' && afterAdd.peers[0].ring === 'friend')
  const msg = b.page.locator('.sheet.on a', { hasText: 'Message on Signal' })
  t.ok('b: the card shows "Message on Signal" with Ada\'s username link (it arrives with the handshake)', !!(await until(async () => (await msg.count()) === 1 && (await msg.getAttribute('href')) === USERNAME_LINK)))
  t.ok('b: marked "Shared by Ada Lovelace when you connected"', /Shared by Ada Lovelace when you connected/.test(await b.page.locator('.sheet.on').innerText()))
  t.ok('b: the "no link yet" line is gone once the link is there', (await b.page.locator('[data-no-messenger]').count()) === 0)
  await shot(b.page, 'cc_b_card_molly.png')
  t.ok('b: chat stays reachable from the card (the Chat button is there)', await b.page.locator('.sheet.on [data-chat-open]').isVisible())
  await b.page.locator('.sheet.on [data-chat-open]').click()
  await b.page.getByPlaceholder('Write a message').fill('hello from Bo')
  await b.page.getByRole('button', { name: 'Send', exact: true }).click()
  t.ok('b: a chat message reaches Ada', !!(await until(async () => JSON.stringify((await record(a.page)).chats ?? {}).includes('hello from Bo'))))

  // "Not now": connected, an acquaintance, no card forced open
  const c = await newPhone(browser, server)
  await startPhone(c.page, 'Cy Later')
  await c.page.goto(`${ORIGIN}/c/${code}`)
  await addSheetOpen(c.page)
  await c.page.locator('.sheet.on [data-connect-later]').click()
  const recC = await record(c.page)
  t.ok('b: "Not now" keeps the connection as an acquaintance and closes the sheet', recC.peers.length === 1 && recC.people[0].ring === 'acquaintance' && (await c.page.locator('.sheet.on').count()) === 0)
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close()

  // a card with no messenger link at all says so plainly
  const s2 = fakeConnectServer(ORIGIN)
  const d = await adaPhone(browser, s2, 'Dee Plain')
  await d.page.locator('.hdr [aria-label^="Show my code"]').click()
  const code2 = await until(async () => { const x = [...s2.codes.keys()][0]; return x && (await payload(d.page)) === `${ORIGIN}/c/${x}` ? x : null }, 15_000)
  const e = await newPhone(browser, s2)
  await startPhone(e.page, 'Eli Scan')
  await e.page.goto(`${ORIGIN}/c/${code2}`)
  await addSheetOpen(e.page)
  await addToWeb(e.page)
  t.ok('b: Dee shared no messenger link: the card says so plainly', await appears(e.page.locator('[data-no-messenger]'), 5000) && /No messenger link from Dee Plain yet/.test(await e.page.locator('[data-no-messenger]').innerText()))
  await shot(e.page, 'cc_b_card_no_link.png')
  await d.ctx.close(); await e.ctx.close()
}

async function partC(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await adaPhone(browser, server)
  await a.page.locator('.hdr [aria-label^="Show my code"]').click()
  const code = await until(async () => { const c = [...server.codes.keys()][0]; return c && (await payload(a.page)) === `${ORIGIN}/c/${c}` ? c : null }, 15_000)
  const f = await newPhone(browser, server)
  await f.page.goto(`${ORIGIN}/c/${code}`)
  await f.page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  const body = await f.page.locator('body').innerText()
  t.ok('c: a first-time visitor sees the Connect screen naming Ada Lovelace', /Ada Lovelace wants to connect with you on TrustWeb/.test(body) && (await f.page.getByRole('button', { name: 'Connect', exact: true }).count()) === 1)
  await shot(f.page, 'cc_c_first_time.png')
  await f.page.getByLabel('Your first name').fill('Fay Newcomer')
  await f.page.getByRole('button', { name: 'Connect', exact: true }).click()
  t.ok('c: after the account is made the add sheet follows, with Ada selected', await addSheetOpen(f.page) && (await f.page.locator('.sheet.on [data-connect-add-name]').inputValue()) === 'Ada Lovelace')
  await addToWeb(f.page)
  const rec = await record(f.page)
  t.ok('c: Ada is in Fay\'s web, connected', rec.people.length === 1 && rec.people[0].name === 'Ada Lovelace' && rec.people[0].peerId === rec.peers[0].id)
  t.ok('c: Ada\'s phone knows Fay by the name she typed', !!(await until(async () => (await record(a.page)).people.some((p) => p.name === 'Fay Newcomer'))))
  t.ok('c: the server has been told of no one but Ada: Fay has not shown a code yet', server.codes.size === 1)
  await f.page.locator('.sheet.on .sheet-home').click()
  await openMeet(f.page)
  t.ok('c: when Fay shows her own code, her phone asks the server for one (a personal account)', !!(await until(async () => server.codes.size === 2)))
  await a.ctx.close(); await f.ctx.close()
}

async function partD(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await adaPhone(browser, server, 'Ada Lovelace')
  await a.page.locator('.hdr [aria-label^="Show my code"]').click()
  await a.page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const long = (await record(a.page)).connectCode?.url ?? await until(async () => (await record(a.page)).connectCode?.url)
  const bare = long.replace(/&name=[^&#]*/, '')
  t.ok('d: the link without a name has none', !bare.includes('name=') && bare.includes('connect=') && bare.includes('&id='))
  // Ada's relay answers slowly from now on: the handshake delivers her name late
  await a.page.route('**/relay/send', async (route) => { await new Promise((r) => setTimeout(r, 3500)); await route.continue() })

  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Typist')
  await b.page.goto(bare)
  t.ok('d: the add sheet opens at once, before any name', await addSheetOpen(b.page))
  const field = b.page.locator('.sheet.on [data-connect-add-name]')
  t.ok('d: the field is empty with the "Waiting for their name..." placeholder, and editable', (await field.inputValue()) === '' && (await field.getAttribute('placeholder')) === 'Waiting for their name...' && await field.isEditable())
  t.ok('d: the title does not claim a name', (await b.page.locator('.sheet.on [data-connect-add-title]').innerText()) === 'Add this person to your web?')
  await shot(b.page, 'cc_d_waiting_name.png')
  await field.fill('Ada from the tram')
  t.ok('d: the late name does NOT replace what the person typed', await (async () => {
    await b.page.waitForTimeout(6500)
    return (await field.inputValue()) === 'Ada from the tram' && (await b.page.locator('.sheet.on [data-connect-add-title]').innerText()) === 'Add Ada Lovelace to your web?'
  })())
  await addToWeb(b.page)
  const rec = await record(b.page)
  t.ok('d: "Add to my web" stored the typed name', rec.people.some((p) => p.name === 'Ada from the tram'))
  await b.ctx.close()

  // no typing: the name fills in by itself; and Add never waits for it
  const c = await newPhone(browser, server)
  await startPhone(c.page, 'Cy Waiter')
  await c.page.goto(bare)
  await addSheetOpen(c.page)
  await c.page.waitForTimeout(500)
  const early = await c.page.locator('.sheet.on [data-connect-add]').isEnabled()
  t.ok('d: "Add to my web" is available before the name came', early)
  const filled = await until(async () => (await c.page.locator('.sheet.on [data-connect-add-name]').inputValue()) === 'Ada Lovelace', 15_000)
  t.ok('d: untouched, the field takes the name when the handshake delivers it', !!filled && !(await c.page.locator('.sheet.on [data-connect-add-waiting]').isVisible()))
  await addToWeb(c.page)
  t.ok('d: and the person is stored under it', (await record(c.page)).people.some((p) => p.name === 'Ada Lovelace'))
  await c.ctx.close()

  // pressed Add before the name came: Add never blocks; the card carries the placeholder until the name arrives
  const d = await newPhone(browser, server)
  await startPhone(d.page, 'Di Quick')
  await d.page.goto(bare)
  await addSheetOpen(d.page)
  await addToWeb(d.page)
  const early2 = await record(d.page)
  t.ok('d: Add pressed before the name: stored as "Someone" for now', early2.people.length === 1 && early2.people[0].name === 'Someone')
  t.ok('d: then the handshake names the card', !!(await until(async () => (await record(d.page)).people[0].name === 'Ada Lovelace', 15_000)))
  await d.ctx.close(); await a.ctx.close()
}

async function partE(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await adaPhone(browser, server)
  await a.page.locator('.hdr [aria-label^="Show my code"]').click()
  await a.page.getByRole('tab', { name: 'Demo account' }).click()
  await a.page.waitForTimeout(500)
  await a.page.getByLabel('Name of the demo account').focus()
  await a.page.keyboard.type('Gus')
  await a.page.getByRole('button', { name: 'Make the demo account' }).click()
  await a.page.getByRole('heading', { name: 'Gus-demo is ready' }).waitFor({ timeout: 10_000 })
  await a.page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  const link = await payload(a.page)
  t.ok('e: a demo-account code still carries the long link with its fragment (the /l/ shortening is its own)', /\?connect=.*#t=Gus-demo&a=/.test(link))
  const g = await newPhone(browser, server)
  await g.page.goto(link)
  await g.page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
  await g.page.getByRole('button', { name: /Start|Connect/ }).first().click()
  await g.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await g.page.waitForTimeout(1500)
  t.ok('e: a demo account is connected directly: no add sheet', (await g.page.locator('.sheet.on [data-connect-add-title]').count()) === 0 && (await record(g.page)).peers.length >= 1)
  t.ok('e: and a demo account asks for no connect code of its own', server.codes.size === 1)
  await a.ctx.close(); await g.ctx.close()
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    console.log(`connect_code_flow: app ${app.base}, https front ${front.origin} -> :${HTTPS_PORT}`)
    const parts = (process.env.PARTS || 'a,b,c,d,e').split(',')
    if (parts.includes('a')) await partA(browser)
    if (parts.includes('b')) await partB(browser)
    if (parts.includes('c')) await partC(browser)
    if (parts.includes('d')) await partD(browser)
    if (parts.includes('e')) await partE(browser)
  } finally {
    await browser?.close()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nCONNECT CODE FLOW: ALL PASS' : `\nCONNECT CODE FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
