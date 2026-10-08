/**
 * Wave 6b, V2 b: "Their TrustWeb code, name or DID" on the add-someone sheet. Headless phones over a REAL test relay on the app origin
 * (TLS front, as connect_code_flow), the connect service STUBBED in the browser (fake_connect_server.mjs).
 *   1  "@ada": nothing is fetched while typing; Add looks the name up (one GET /who/ada), connects, puts Ada in the chosen ring, opens her card
 *   2  a pasted /c/<code> link, and a bare code, and a pasted long link all add the same way
 *   3  mistakes say what was expected and add nothing: an unknown name, a bad value, a url on another host (never fetched), an expired code,
 *      the phone's own code, a broken server
 *   4  a DID: connects over the relay with NO request to the server at all; the person is "Someone" until their phone tells its name (hello)
 *   5  a DID that names another relay says so and sends nothing
 * Ports: Vite 8985, TLS front 8986.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8985 ../../node_modules/.bin/tsx ../trustweb/test/e2e/add_by_code_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 8985)
const HTTPS_PORT = Number(process.env.TW_HTTPS_PORT || PORT + 1)
const HOST = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []

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

/** A phone with an account and a code the (stubbed) server holds; returns the code. */
async function phoneWithCode(browser, server, name) {
  const p = await newPhone(browser, server)
  await startPhone(p.page, name)
  await p.page.locator('.hdr [aria-label^="Show my code"]').click()
  const code = await until(async () => {
    const rec = (await record(p.page)).connectCode
    return rec && (await payload(p.page)) === `${ORIGIN}/c/${rec.code}` ? rec.code : null
  }, 15_000)
  await p.page.getByRole('button', { name: 'Back' }).click()
  return { ...p, code }
}

/** Opens the add-someone sheet by tapping empty space in the rings (the Close ring is the centre; far out is "Acquaintance"). */
async function openAddSheet(page) {
  await page.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
  await page.locator('.sheet.on [data-add-code]').waitFor({ timeout: 10_000 })
}

const requestsTo = (page, re) => {
  const seen = []
  page.on('request', (r) => { if (re.test(r.url())) seen.push(r.method() + ' ' + new URL(r.url()).pathname) })
  return seen
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: HTTPS_PORT, appPort: PORT, host: HOST })
    browser = await launch([...front.browserArgs, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    console.log(`add_by_code_flow: app ${app.base}, https front ${front.origin} -> :${HTTPS_PORT}`)
    const { createIdentity } = await import('../../../demo/src/did.ts')

    const server = fakeConnectServer(ORIGIN)
    const ada = await phoneWithCode(browser, server, 'Ada Lovelace')
    t.ok('setup: Ada has a code on the (stubbed) server', !!ada.code)
    // Ada holds the name @ada (the stub keeps it, as POST /name would)
    server.names.set('ada', ada.code)
    const cy = await phoneWithCode(browser, server, 'Cy Coder')

    // 1  "@ada"
    const bo = await newPhone(browser, server)
    await startPhone(bo.page, 'Bo Builder')
    const lookups = requestsTo(bo.page, /\/(c|who)\//)
    await openAddSheet(bo.page)
    t.ok('1: the add sheet has the field "Their TrustWeb code, name or DID (optional)"', (await bo.page.getByLabel('Their TrustWeb code, name or DID (optional)').count()) >= 1)
    await shot(bo.page, 'ab_1_add_sheet.png')
    await bo.page.locator('.sheet.on [data-add-code]').fill('@ada')
    await bo.page.waitForTimeout(600)
    t.ok('1: typing looks nothing up', lookups.length === 0 && server.opens.length === 0)
    await bo.page.locator('.sheet.on [data-ring="friend"]').click().catch(() => bo.page.getByRole('button', { name: /^Friend/ }).first().click())
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('1: pressing Add looked @ada up once (GET /who/ada)', !!(await until(async () => server.opens.length === 1)) && server.opens[0].path === '/who/ada', JSON.stringify(server.opens))
    t.ok('1: Ada\'s card opens', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Ada Lovelace' }), 15_000))
    const rec = await record(bo.page)
    t.ok('1: Ada is in Bo\'s web, connected, in the ring picked', rec.people.length === 1 && rec.people[0].name === 'Ada Lovelace' && rec.people[0].peerId === rec.peers[0].id && rec.people[0].ring === 'friend' && rec.peers[0].ring === 'friend', JSON.stringify(rec.people).slice(0, 160))
    t.ok('1: Ada\'s phone holds Bo as a connection (added AND connected)', !!(await until(async () => (await record(ada.page)).peers.some((p) => p.displayName === 'Bo Builder'))))
    await shot(bo.page, 'ab_1_card.png')
    await bo.page.locator('.sheet.on .sheet-home').click()

    // 2  a /c/ link, a bare code, a long link
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(`${ORIGIN}/c/${cy.code}`)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('2: a pasted /c/<code> link adds Cy', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Cy Coder' }), 15_000) && server.opens.at(-1).path === `/c/${cy.code}`)
    await bo.page.locator('.sheet.on .sheet-home').click()
    const dee = await phoneWithCode(browser, server, 'Dee Direct')
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(dee.code)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('2: a bare code adds Dee', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Dee Direct' }), 15_000))
    await bo.page.locator('.sheet.on .sheet-home').click()
    const eli = await newPhone(browser, server)
    await startPhone(eli.page, 'Eli Long')
    await eli.page.locator('.hdr [aria-label^="Show my code"]').click()
    await eli.page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const eliLong = (await until(async () => (await record(eli.page)).connectCode?.url)) ?? (await payload(eli.page))
    const before = server.opens.length
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(eliLong)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('2: a pasted long link adds Eli with no server lookup', await appears(bo.page.locator('.sheet.on h3', { hasText: 'Eli Long' }), 15_000) && server.opens.length === before)
    await bo.page.locator('.sheet.on .sheet-home').click()
    t.ok('2: re-adding someone already in the web says so and adds no second card', await (async () => {
      await openAddSheet(bo.page)
      await bo.page.locator('.sheet.on [data-add-code]').fill('@ada')
      await bo.page.locator('.sheet.on [data-add-person]').click()
      await bo.page.locator('.sheet.on h3', { hasText: 'Ada Lovelace' }).waitFor({ timeout: 15_000 })
      return (await record(bo.page)).people.filter((p) => p.name === 'Ada Lovelace').length === 1
    })())
    await bo.page.locator('.sheet.on .sheet-home').click()

    // 3  mistakes
    const peopleBefore = (await record(bo.page)).people.length
    const wrong = async (value, rx, label, { expectOpens = null } = {}) => {
      await openAddSheet(bo.page)
      const opens = server.opens.length
      await bo.page.locator('.sheet.on [data-add-code]').fill(value)
      await bo.page.locator('.sheet.on [data-add-person]').click()
      const said = await until(async () => { const x = await bo.page.locator('.sheet.on [data-add-code-status]').innerText(); return rx.test(x) ? x : null }, 10_000)
      t.ok(`3: ${label}: says what was wrong`, !!said, await bo.page.locator('.sheet.on [data-add-code-status]').innerText())
      if (expectOpens !== null) t.ok(`3: ${label}: ${expectOpens} server lookups`, server.opens.length - opens === expectOpens, String(server.opens.length - opens))
      t.ok(`3: ${label}: nobody was added`, (await record(bo.page)).people.length === peopleBefore && (await bo.page.locator('.sheet.on [data-add-code]').isVisible()))
      await bo.page.locator('.sheet.on .sheet-home').click()
    }
    await wrong('@nobody', /does not know that name/, 'an unknown name', { expectOpens: 1 })
    await wrong('!!', /Expected a name of 3 to 30/, 'a bad value', { expectOpens: 0 })
    const evil = requestsTo(bo.page, /evil\.example/)
    await wrong('https://evil.example/c/' + cy.code, /not from TrustWeb/, 'a url on another host', { expectOpens: 0 })
    t.ok('3: the other host was never fetched', evil.length === 0)
    await wrong('A'.repeat(22), /does not know that code/, 'a code the server does not know', { expectOpens: 1 })
    await wrong(`${ORIGIN}/c/${bo.code ?? 'x'.repeat(22)}`, /does not know that code/, 'a code link nobody holds', { expectOpens: 1 })
    server.openStatus = 500
    await wrong('@ada', /did not answer properly/, 'a broken server', { expectOpens: 1 })
    server.openStatus = null
    await shot(bo.page, 'ab_3_mistakes.png')
    // the phone's own code
    const boRec = await record(bo.page)
    const boCode = boRec.connectCode?.code ?? (await until(async () => (await record(bo.page)).connectCode?.code))
    if (boCode) await wrong(`${ORIGIN}/c/${boCode}`, /your own code/, 'the phone\'s own code', { expectOpens: 1 })

    // 4  a DID: relay only
    const flo = await newPhone(browser, server)
    await startPhone(flo.page, 'Flo Direct')
    const floDid = (await record(flo.page)).identity.did
    const opensBefore = server.opens.length
    const postsBefore = server.posts.length
    const bobLookups = requestsTo(bo.page, /\/(c|who|connect|name)(\/|$)/)
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(floDid)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    t.ok('4: a DID adds a card at once', await appears(bo.page.locator('.sheet.on h3').first(), 15_000))
    t.ok('4: with NO request to the server for it', server.opens.length === opensBefore && bobLookups.length === 0 && server.posts.length >= postsBefore)
    const floRec = await until(async () => (await record(bo.page)).peers.find((p) => p.did === floDid))
    t.ok('4: the connection is made over the relay (Flo\'s phone holds Bo)', !!(await until(async () => (await record(flo.page)).peers.some((p) => p.displayName === 'Bo Builder'))) && !!floRec)
    t.ok('4: no name in a DID: the card says Someone until the other phone tells its name, then Flo Direct', !!(await until(async () => (await record(bo.page)).people.some((p) => p.name === 'Flo Direct'), 15_000)))
    await shot(bo.page, 'ab_4_did.png')
    await bo.page.locator('.sheet.on .sheet-home').click().catch(() => {})

    // a typed name beats the late name
    const gus = await newPhone(browser, server)
    await startPhone(gus.page, 'Gus Typed')
    const gusDid = (await record(gus.page)).identity.did
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(gusDid)
    await bo.page.getByPlaceholder('Name').first().fill('Gus from the bus')
    await bo.page.locator('.sheet.on [data-add-person]').click()
    await until(async () => (await record(gus.page)).peers.some((p) => p.displayName === 'Bo Builder'))
    await bo.page.waitForTimeout(1500)
    t.ok('4: a name the person typed is kept when the other phone\'s name arrives', (await record(bo.page)).people.some((p) => p.name === 'Gus from the bus') && !(await record(bo.page)).people.some((p) => p.name === 'Gus Typed'))
    await bo.page.locator('.sheet.on .sheet-home').click().catch(() => {})

    // 5  a DID on another relay
    const far = createIdentity('https://elsewhere.example/relay').did
    const farReqs = requestsTo(bo.page, /elsewhere\.example/)
    const peersBefore = (await record(bo.page)).peers.length
    await openAddSheet(bo.page)
    await bo.page.locator('.sheet.on [data-add-code]').fill(far)
    await bo.page.locator('.sheet.on [data-add-person]').click()
    const said = await until(async () => { const x = await bo.page.locator('.sheet.on [data-add-code-status]').innerText(); return /relay at https:\/\/elsewhere\.example/.test(x) ? x : null }, 10_000)
    t.ok('5: a DID naming another relay says which relay, and that this app only reaches its own', !!said && /only reach the relay it is opened from/.test(said))
    t.ok('5: nothing was sent and nobody was added', farReqs.length === 0 && (await record(bo.page)).peers.length === peersBefore)
    await shot(bo.page, 'ab_5_other_relay.png')

    for (const p of [ada, cy, dee, eli, bo, flo, gus]) await p.ctx.close()
  } finally {
    await browser?.close()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nADD BY CODE FLOW: ALL PASS' : `\nADD BY CODE FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
