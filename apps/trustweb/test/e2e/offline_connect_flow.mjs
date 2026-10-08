/**
 * Wave 6f, THE ONE THING: whoever opens my shared link appears in MY web too, also when I was not online at that moment.
 * Headless phones over a REAL test relay (the same store-and-forward RelayServer as production, in memory) on the app origin
 * https://app.trustweb.one (a TLS front on loopback), with the connect service stubbed in the browser (fake_connect_server.mjs).
 *   A  offline sharer: A shows its code, CLOSES its page; B opens /c/<code>, adds A, writes a chat line; A reopens: B is in A's web, the line is there
 *   B  two tabs of the same app (one browser profile, the same identity): B adds; the tab A looks at shows B, and B survives the other tab's next save
 *   C  B's first ack never left (its relay POST failed): B re-sends it on its next start, A sees B without B doing anything
 *   D  a connection A already holds without a card (an older build, a lost card): the next ack makes the card
 *   E  an ask that arrived while A was away: no consent prompt for a long gone asker, but "<B> asked while you were away"
 *   F  cross-host: A on app.trustweb.one, B on app.trustintheweb.org adds A by its code; A closed meanwhile; both orders
 *   G  A on the Meet page while two people connect one after the other: two people in A's web, not one merged card
 *   H  (review 6f) two tabs; a card's sheet stays open in the tab that does not drain while a new person lands in the other tab: the
 *      switch flipped in that open sheet afterwards is saved AND the new person stays (the take-over keeps the sheet's objects live)
 *   I  (review 6f) a FIRST visit from the link (no record at page load) whose ack POST fails: the network comes back in the same
 *      visit, the laptop "sleeps" and wakes (fresh socket); the ack is re-sent without a reload and Ada gets Bo (about 2.5 min:
 *      the per-visit attempt gap of ack_retry.ts is 2 min)
 * Ports: Vite TW_PORT (8970), TLS fronts TW_PORT+1 and TW_PORT+2. TW_SHOTS=<dir> for screenshots. PARTS=a,b,... to run a subset.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/offline_connect_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const HOST = 'app.trustweb.one'
const HOST2 = 'app.trustintheweb.org'
const ORIGIN = `https://${HOST}`
const ORIGIN2 = `https://${HOST2}`
const SHOTS = process.env.TW_SHOTS
const t = tally()
const errors = []

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) }) }
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 250)) }
  return null
}
const record = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const payload = (page) => page.getAttribute('.qrwrap', 'data-payload')
/** The names drawn in the web (every node but the centre). */
const webNames = (page) => page.locator('.node:not(.you)').allInnerTexts().then((xs) => xs.map((x) => x.trim()))
const inWeb = async (page, name) => (await webNames(page)).some((x) => x.includes(name))

async function newPhone(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await server.install(ctx)
  const page = await newTab(ctx)
  return { ctx, page }
}

async function newTab(ctx) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  return page
}

async function startPhone(page, name, origin = ORIGIN) {
  await page.goto(origin + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

/** Opens the app again in a fresh tab of the same profile (what reopening a closed tab or the installed app does). */
async function reopen(ctx, origin = ORIGIN) {
  const page = await newTab(ctx)
  await page.goto(origin + '/')
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  return page
}

/** Shows the code on Meet and waits for the short link; returns the code. */
async function showCode(page, server, origin = ORIGIN) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return until(async () => {
    const codes = [...server.codes.keys()]
    const shown = await payload(page)
    return codes.find((c) => shown === `${origin}/c/${c}`) ?? null
  }, 15_000)
}

async function backHome(page) {
  await page.getByRole('button', { name: 'Back' }).click().catch(() => {})
}

/** B opens A's code link, adds A (ring as given), and writes one chat line from the card. */
async function openAndAdd(page, code, { ring = 'friend', chat = null, origin = ORIGIN } = {}) {
  await page.goto(`${origin}/c/${code}`)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  await page.locator(`.sheet.on [data-ring="${ring}"]`).click()
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 10_000 })
  if (chat) {
    await page.locator('.sheet.on [data-chat-open]').click()
    await page.getByPlaceholder('Write a message').fill(chat)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await until(async () => JSON.stringify((await record(page)).chats ?? {}).includes('"delivered"'), 10_000)
  }
}

const hasChat = async (page, text) => JSON.stringify((await record(page)).chats ?? {}).includes(text)

async function partA(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Sharer')
  const code = await showCode(a.page, server)
  t.ok('a: Ada shows her code', !!code)
  await a.page.close() // her laptop tab is closed (or asleep) from here on

  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Opener')
  await openAndAdd(b.page, code, { chat: 'hello while you were away' })
  t.ok('a: Bo has Ada in his web', (await record(b.page)).people.some((p) => p.name === 'Ada Sharer'))
  await b.page.waitForTimeout(1500)

  const back = await reopen(a.ctx)
  t.ok('a: Ada reopens: Bo is in her web', !!(await until(() => inWeb(back, 'Bo Opener'), 20_000)), JSON.stringify(await webNames(back)))
  t.ok('a: and in her record, as a person linked to the connection', !!(await until(async () => {
    const r = await record(back)
    const peer = r.peers.find((p) => p.displayName === 'Bo Opener')
    return peer && r.people.some((p) => p.peerId === peer.id)
  })))
  t.ok('a: his chat line is there', !!(await until(() => hasChat(back, 'hello while you were away'))))
  t.ok('a: Bo learns her name from her hello (his card is named)', !!(await until(async () => (await record(b.page)).people.some((p) => p.name === 'Ada Sharer'))))
  await shot(back, 'f6_a_reopened.png')
  await a.ctx.close(); await b.ctx.close()
}

async function partB(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Twotabs')
  const code = await showCode(a.page, server)
  await backHome(a.page)
  const tab2 = await reopen(a.ctx) // the installed app and a browser tab, or two tabs: one profile, one identity
  await a.page.waitForTimeout(4000)

  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Tabs')
  await openAndAdd(b.page, code, { chat: 'two tabs line' })
  const seen1 = await until(() => inWeb(a.page, 'Bo Tabs'), 15_000)
  const seen2 = await until(() => inWeb(tab2, 'Bo Tabs'), 15_000)
  t.ok('b: the first tab shows Bo', !!seen1, JSON.stringify(await webNames(a.page)))
  t.ok('b: the second tab shows Bo', !!seen2, JSON.stringify(await webNames(tab2)))
  // each tab saves once more (a name change is a save); Bo must survive both
  for (const [page, name] of [[tab2, 'Ada Twotabs'], [a.page, 'Ada Twotabs']]) {
    await page.locator('.node.you').click()
    await page.locator('.sheet input[aria-label="Your name"]').fill(name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForTimeout(500)
  }
  const r = await record(a.page)
  t.ok('b: after both tabs saved, Bo is still in the record', r.peers.some((p) => p.displayName === 'Bo Tabs') && r.people.some((p) => p.name === 'Bo Tabs'), JSON.stringify(r.people.map((p) => p.name)))
  t.ok('b: and his chat line too', await hasChat(a.page, 'two tabs line'))
  await a.ctx.close(); await b.ctx.close()
}

async function partC(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Waiting')
  const code = await showCode(a.page, server)
  await backHome(a.page)

  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Flaky')
  // Bo's network drops every relay POST for a while (a train tunnel): his ack never leaves
  let blocked = true
  await b.ctx.route('**/relay/send', (route) => (blocked ? route.abort('internetdisconnected') : route.continue()))
  await openAndAdd(b.page, code)
  await a.page.waitForTimeout(3000)
  t.ok('c: while Bo is offline, Ada does not have him yet', !(await inWeb(a.page, 'Bo Flaky')))
  blocked = false
  await b.page.close()
  const bBack = await reopen(b.ctx) // Bo opens TrustWeb again later; he does nothing else
  t.ok('c: Bo opens the app again (nothing else): Ada gets him', !!(await until(() => inWeb(a.page, 'Bo Flaky'), 25_000)), JSON.stringify(await webNames(a.page)))
  const rb = await until(async () => { const r = await record(bBack); return r.peers[0]?.heardAt ? r : null }, 15_000)
  t.ok('c: Bo\'s phone marks the connection answered once Ada\'s hello came (no more re-sends)', !!rb)
  await a.ctx.close(); await b.ctx.close()
}

async function partD(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Cardless')
  const code = await showCode(a.page, server)
  await backHome(a.page)
  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Cardless')
  await openAndAdd(b.page, code)
  await until(() => inWeb(a.page, 'Bo Cardless'))
  // an older build or a lost card: the connection stays, the card is gone
  await a.page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.people = r.people.filter((p) => p.name !== 'Bo Cardless')
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  await a.page.close()
  const back = await reopen(a.ctx)
  t.ok('d: a connection without a card gets one when the app opens', !!(await until(() => inWeb(back, 'Bo Cardless'), 10_000)), JSON.stringify(await webNames(back)))
  await a.ctx.close(); await b.ctx.close()
}

async function partE(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Away')
  const code = await showCode(a.page, server)
  await backHome(a.page)
  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Asker')
  await openAndAdd(b.page, code)
  await until(() => inWeb(a.page, 'Bo Asker'))
  // Ada has a ladder for friends of friends, and Bo is a friend; then her tab is closed (written straight to the record, then closed unsaved)
  await a.page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    for (const x of [...r.peers, ...r.people]) if ((x.displayName ?? x.name) === 'Bo Asker') x.ring = 'friend'
    r.inventory.push({ id: 'ladder6f01', text: 'Ladder, three metres, to lend', audience: 'fof', included: true, createdAt: Date.now() })
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  await a.page.close()
  // Bo asks while Ada is away (his ask waits its window and ends with no answer)
  await b.page.locator('.sheet.on .sheet-home').click().catch(() => {})
  await b.page.locator('nav.tabs button', { hasText: 'Web' }).click()
  if (await b.page.locator('.query-dock').count() === 0) await b.page.getByRole('button', { name: 'Call into your web', exact: true }).click()
  await b.page.locator('.query-dock textarea').fill('does anyone have a ladder')
  await b.page.getByRole('button', { name: 'Call into my web' }).click()
  await b.page.waitForTimeout(2500)
  // Ada opens TrustWeb twenty minutes later (her clock runs ahead in this tab: the ask's own issuedAt is long past its window)
  const back = await newTab(a.ctx)
  await back.addInitScript(() => { const real = Date.now.bind(Date); Date.now = () => real() + 20 * 60_000 })
  await back.goto(ORIGIN + '/')
  await back.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  const notice = await until(async () => /Bo Asker asked while you were away/.test(await back.locator('body').innerText()), 15_000)
  t.ok('e: "Bo Asker asked while you were away" is there for her, with his words', !!notice && /does anyone have a ladder/.test(await back.locator('body').innerText()))
  t.ok('e: no consent prompt for an asker who stopped waiting long ago', (await back.locator('.overlay.on').count()) === 0)
  const r = await record(back)
  t.ok('e: logged as an ask that came while away (no answer sent)', (r.log ?? []).some((e) => e.text === 'does anyone have a ladder' && e.away === true && e.outcome === 'no-match'))
  await shot(back, 'f6_e_away.png')
  await back.locator('[data-away-message]').click()
  t.ok('e: "Message Bo Asker" opens the chat with him', await back.getByPlaceholder('Write a message').waitFor({ timeout: 5000 }).then(() => true, () => false))
  t.ok('e: and the notice is gone (dismissed)', (liveAway(await record(back))).length === 0)
  await a.ctx.close(); await b.ctx.close()
}

const liveAway = (r) => r.awayAsks ?? []

async function partF(browser) {
  for (const [aOrigin, bOrigin] of [[ORIGIN, ORIGIN2], [ORIGIN2, ORIGIN]]) {
    const tag = aOrigin === ORIGIN ? 'one-org' : 'org-one'
    const server = fakeConnectServer(aOrigin)
    const a = await newPhone(browser, server)
    await startPhone(a.page, `Ada ${tag}`, aOrigin)
    await showCode(a.page, server, aOrigin)
    const long = (await record(a.page)).connectCode?.url
    await a.page.close()
    const b = await newPhone(browser, server)
    await startPhone(b.page, `Bo ${tag}`, bOrigin)
    // Bo already has TrustWeb on the other host: he pastes Ada's link into "Add someone" and writes to her
    await b.page.locator('.rings-wrap').click({ position: { x: 12, y: 12 } })
    await b.page.locator('.sheet.on [data-add-code]').fill(long)
    await b.page.locator('.sheet.on [data-ring="friend"]').click({ timeout: 3000 }).catch(() => b.page.getByRole('button', { name: /^Friend/ }).first().click())
    await b.page.locator('.sheet.on [data-add-person]').click()
    await b.page.locator('.sheet.on h3', { hasText: `Ada ${tag}` }).waitFor({ timeout: 15_000 }).catch(async () => { if (SHOTS) await shot(b.page, `f6_f_${tag}_nocard.png`) })
    await b.page.locator('.sheet.on [data-chat-open]').click({ timeout: 15_000 })
    await b.page.getByPlaceholder('Write a message').fill(`line ${tag}`)
    await b.page.getByRole('button', { name: 'Send', exact: true }).click()
    await b.page.waitForTimeout(2000)
    const back = await reopen(a.ctx, aOrigin)
    t.ok(`f ${tag}: Ada reopens: Bo (other host) is in her web`, !!(await until(() => inWeb(back, `Bo ${tag}`), 20_000)), JSON.stringify(await webNames(back)))
    t.ok(`f ${tag}: and his chat line is there`, !!(await until(() => hasChat(back, `line ${tag}`))))
    await a.ctx.close(); await b.ctx.close()
  }
}

async function partG(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Meeting')
  const code = await showCode(a.page, server) // she keeps her code on screen the whole time
  const p = await newPhone(browser, server)
  await startPhone(p.page, 'Pat First')
  await openAndAdd(p.page, code)
  await until(async () => (await record(a.page)).people.some((x) => x.name === 'Pat First'))
  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Second')
  await openAndAdd(b.page, code)
  await until(async () => (await record(a.page)).peers.length === 2)
  const r = await record(a.page)
  const names = r.people.map((x) => x.name)
  t.ok('g: with her code on screen, two people who connect one after the other are two people in her web', names.includes('Pat First') && names.includes('Bo Second'), JSON.stringify(names))
  t.ok('g: each card is linked to its own connection', new Set(r.people.map((x) => x.peerId).filter(Boolean)).size === 2)
  await a.ctx.close(); await p.ctx.close(); await b.ctx.close()
}

async function partH(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Sheets')
  const code = await showCode(a.page, server)
  await backHome(a.page)
  const b = await newPhone(browser, server)
  await startPhone(b.page, 'Bo Card')
  await openAndAdd(b.page, code)
  t.ok('h: Bo is in her web', !!(await until(() => inWeb(a.page, 'Bo Card'), 15_000)))
  const tab2 = await reopen(a.ctx) // opened later: it is in front and takes the drain
  await a.page.waitForTimeout(3000)
  // In the first tab Ada opens Bo's card and leaves it open.
  await a.page.locator('.node:not(.you)', { hasText: 'Bo Card' }).click()
  await a.page.locator('.sheet.on [data-pass-on]').waitFor({ timeout: 5_000 })
  const c = await newPhone(browser, server)
  await startPhone(c.page, 'Cy Later')
  await openAndAdd(c.page, code)
  const landed = await until(async () => (await record(tab2)).people.some((p) => p.name === 'Cy Later'), 20_000)
  t.ok('h: Cy lands while the card stays open in the other tab', !!landed && await a.page.locator('.sheet.on [data-pass-on]').isVisible())
  await a.page.waitForTimeout(800)
  await a.page.locator('.sheet.on [data-pass-on]').click()
  await a.page.waitForTimeout(800)
  const r = await record(a.page)
  t.ok('h: the switch flipped in the open sheet is saved', r.people.find((p) => p.name === 'Bo Card')?.passOn === true, JSON.stringify(r.people.map((p) => [p.name, p.passOn])))
  t.ok('h: and Cy is still in the record (the open sheet did not write the older copy back)', r.people.some((p) => p.name === 'Cy Later') && r.peers.some((p) => p.displayName === 'Cy Later'), JSON.stringify(r.people.map((p) => p.name)))
  // The other tab saves once more (a name change is a save): it took the switch over and does not write it away.
  await tab2.locator('.node.you').click()
  await tab2.locator('.sheet input[aria-label="Your name"]').fill('Ada Sheets')
  await tab2.getByRole('button', { name: 'Save', exact: true }).click()
  await tab2.waitForTimeout(800)
  const r2 = await record(tab2)
  t.ok('h: after the other tab saved too, both the switch and Cy are kept', r2.people.find((p) => p.name === 'Bo Card')?.passOn === true && r2.people.some((p) => p.name === 'Cy Later'), JSON.stringify(r2.people.map((p) => [p.name, p.passOn])))
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close()
}

/** Simulates a laptop lid: the page reads hidden, then visible again after `ms` (main.ts opens a fresh socket after 60 s hidden). */
async function sleepAndWake(page, ms) {
  await page.evaluate(() => {
    window.__hidden = true
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hidden ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(ms)
  await page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
}

async function partI(browser) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server)
  await startPhone(a.page, 'Ada Steady')
  const code = await showCode(a.page, server)
  await backHome(a.page)

  const b = await newPhone(browser, server)
  let blocked = true
  await b.ctx.route('**/relay/send', (route) => (blocked ? route.abort('internetdisconnected') : route.continue()))
  // His first visit: the link opens the Start screen (no record yet); he types his name there.
  await b.page.goto(`${ORIGIN}/c/${code}`)
  await b.page.getByLabel('Your first name').fill('Bo Firstvisit')
  await b.page.getByRole('button', { name: 'Connect', exact: true }).click()
  await b.page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  await b.page.locator('.sheet.on [data-connect-add]').click()
  const t0 = Date.now()
  await a.page.waitForTimeout(3000)
  t.ok('i: his first POST failed: Ada does not have him yet', !(await inWeb(a.page, 'Bo Firstvisit')))
  blocked = false
  // Same visit, no reload: past the attempt gap his laptop sleeps for a minute and wakes with a fresh socket.
  const gap = 2 * 60 * 1000 + 2000 - (Date.now() - t0)
  await sleepAndWake(b.page, Math.max(gap, 61_000))
  t.ok('i: without a reload Ada gets him', !!(await until(() => inWeb(a.page, 'Bo Firstvisit'), 20_000)), JSON.stringify(await webNames(a.page)))
  await a.ctx.close(); await b.ctx.close()
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let front2 = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: PORT + 1, appPort: PORT, host: HOST })
    front2 = await startHttpsOrigin({ port: PORT + 2, appPort: PORT, host: HOST2 })
    browser = await launch([`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT + 1}, MAP ${HOST2} 127.0.0.1:${PORT + 2}`])
    console.log(`offline_connect_flow: app ${app.base}, https fronts ${front.origin} ${front2.origin}`)
    const parts = (process.env.PARTS || 'a,b,c,d,e,f,g,h,i').split(',')
    const run = { a: partA, b: partB, c: partC, d: partD, e: partE, f: partF, g: partG, h: partH, i: partI }
    for (const p of parts) {
      try { await run[p](browser) } catch (e) { t.ok(`${p}: ran to the end`, false, String(e?.message ?? e).split('\n')[0]) }
    }
  } finally {
    await browser?.close()
    await front?.stop()
    await front2?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nOFFLINE CONNECT FLOW: ALL PASS' : `\nOFFLINE CONNECT FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
