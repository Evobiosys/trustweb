/**
 * Wave 6i, THE ONE THING: an ask and its answer stay one conversation. Headless phones over a REAL test relay (the production
 * store-and-forward RelayServer, in memory) on https://app.trustweb.one (a TLS front on loopback), the connect service stubbed in the
 * browser (fake_connect_server.mjs). Ada is the ASKED person, Bo the asker (he opened her code: on her side an acquaintance).
 *   A  reply carries the question: Bo asks; Ada shares from the prompt, then "Message Bo" from it and writes "I do": BOTH chats show
 *      the question above the reply. Bo's "new message" card (on Web, above the rings) opens the chat with one tap on its underlined
 *      "open"; off the Web screen the notice is tappable as a whole. Bo's answer card in the dock has "Message Ada" carrying the ask.
 *   B  tightening: Ada's line is for friends, Bo (an acquaintance) asks: nothing for him, the quiet card for her. She makes him a
 *      friend on his card: his phone sends his earlier ask again, she sees "Earlier ask from Bo", says yes, and Bo gets the answer.
 *   C  loosening: Ada moves Bo back out: nothing at all travels (no POST /relay/send from either phone).
 *   D  the quiet card never covers the web (it is in the flow above the rings) and an ordinary node under it is tappable.
 *   E  Record: a line added on Review starts as "Close friends" and is saved so.
 * Ports: Vite TW_PORT (8970), TLS front TW_PORT+1. TW_SHOTS=<dir> for screenshots. PARTS=a,b,... to run a subset.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_PORT=8970 ../../node_modules/.bin/tsx ../trustweb/test/e2e/conversation_flow.mjs
 */
import path from 'node:path'
import { launch, startApp, tally } from '../helpers/e2e_harness.mjs'
import { startHttpsOrigin } from '../helpers/https_origin.mjs'
import { fakeConnectServer } from '../helpers/fake_connect_server.mjs'

const PORT = Number(process.env.TW_PORT || 8970)
const HOST = 'app.trustweb.one'
const ORIGIN = `https://${HOST}`
const SHOTS = process.env.TW_SHOTS
const PARTS = (process.env.PARTS || 'a,b,c,d,e').split(',')
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
const inWeb = async (page, name) => (await page.locator('.node:not(.you)').allInnerTexts()).some((x) => x.includes(name))
const bodyText = (page) => page.locator('body').innerText()
/** The prompt's text now ('' when none is up): never waits for it to appear. */
const overlayText = (page) => page.evaluate(() => document.querySelector('.overlay.on')?.innerText ?? '')

async function newPhone(browser, server, sends) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  // every sealed wire that leaves this phone (C: loosening must send none)
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/relay/send')) sends.n++ })
  return { ctx, page, sends }
}

async function startPhone(page, name) {
  await page.goto(ORIGIN + '/')
  await page.getByLabel('Your first name').fill(name)
  await page.getByRole('button', { name: 'Start on this phone' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'No thanks' }).click({ timeout: 1500 }).catch(() => {})
}

async function showCode(page, server) {
  await page.locator('.hdr [aria-label^="Show my code"]').click()
  await page.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
  return until(async () => {
    const shown = await payload(page)
    return [...server.codes.keys()].find((c) => shown === `${ORIGIN}/c/${c}`) ?? null
  }, 15_000)
}

async function openAndAdd(page, code, ring = 'friend') {
  await page.goto(`${ORIGIN}/c/${code}`)
  await page.locator('.sheet.on [data-connect-add]').waitFor({ timeout: 25_000 })
  await page.locator(`.sheet.on [data-ring="${ring}"]`).click()
  await page.locator('.sheet.on [data-connect-add]').click()
  await page.locator('.sheet.on h3').waitFor({ timeout: 10_000 })
}

/** Ada (asked) and Bo (asker, opened her code: an acquaintance on her side). Ada's resources are written to her record first. */
async function pair(browser, tag, lines) {
  const server = fakeConnectServer(ORIGIN)
  const a = await newPhone(browser, server, { n: 0 })
  await startPhone(a.page, `Ada ${tag}`)
  const code = await showCode(a.page, server)
  await a.page.getByRole('button', { name: 'Back' }).click().catch(() => {})
  const b = await newPhone(browser, server, { n: 0 })
  await startPhone(b.page, `Bo ${tag}`)
  await openAndAdd(b.page, code)
  await until(() => inWeb(a.page, `Bo ${tag}`))
  await a.page.evaluate((ls) => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    ls.forEach((l, i) => r.inventory.push({ id: `c6i${i}line`, text: l.text, audience: l.audience, included: true, createdAt: Date.now() }))
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  }, lines)
  await a.page.reload()
  await a.page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await closeSheets(b.page)
  return { a, b, tag }
}

async function closeSheets(page) {
  await page.locator('.sheet.on .sheet-home').click({ timeout: 1000 }).catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
}

async function toWeb(page) {
  await closeSheets(page)
  await page.locator('nav.tabs button', { hasText: 'Membranes' }).click()
}

/** Bo asks; resolves at once (the dock keeps waiting on its own). */
async function ask(page, text) {
  await toWeb(page)
  if (await page.locator('.query-dock').count() === 0) await page.getByRole('button', { name: 'Ask your web', exact: true }).click()
  await page.locator('.query-dock textarea').fill(text)
  await page.getByRole('button', { name: 'Ask my web' }).click()
}

async function closeDock(page) {
  await page.locator('.query-dock .dock-head .x').click({ timeout: 2000 }).catch(() => {})
}

async function openCard(page, name) {
  await toWeb(page)
  await page.locator('.node', { hasText: name }).first().click()
  await page.locator('.sheet.on').waitFor({ timeout: 5_000 })
}

async function setRing(page, name, label) {
  await openCard(page, name)
  await page.locator('.sheet.on .rlabel').click()
  await page.locator('.sheet.on .rchip', { hasText: new RegExp(`^${label}$`) }).click()
  await page.locator('.sheet.on .rlabel', { hasText: new RegExp(`^${label}$`) }).waitFor({ timeout: 5_000 })
  await closeSheets(page)
}

const chatRe = (page) => page.locator('.sheet.on .chat-msg .chat-re').allInnerTexts()

// ---------------------------------------------------------------------------

async function partA(browser) {
  console.log('A  the reply carries the question; "new message" opens with one tap')
  const { a, b, tag } = await pair(browser, 'Reply', [{ text: 'Spare room in Vienna', audience: 'fof' }])
  const ASK = 'does anyone have a spare room?'
  await ask(b.page, ASK)
  const prompt = await until(async () => /Bo Reply asks/.test(await overlayText(a.page)), 30_000)
  t.ok('a: Ada gets the prompt', !!prompt)
  await a.page.locator('.overlay.on').getByRole('button', { name: 'Share these' }).click()
  const msgBtn = a.page.locator('.overlay.on [data-ask-message]')
  t.ok('a: after her yes the prompt offers "Message Bo"', await msgBtn.isVisible() && /Message Bo Reply/.test(await msgBtn.innerText()))
  await msgBtn.click()
  const ctxLine = a.page.locator('.sheet.on [data-chat-context]')
  await ctxLine.waitFor({ timeout: 5_000 })
  t.ok('a: the chat opens with the ask above the composer (not in the message text)', /Replying to “does anyone have a spare room\?”/.test(await ctxLine.innerText())
    && (await a.page.getByPlaceholder('Write a message').inputValue()) === '')
  await shot(a.page, 'c6i_a1_ada_context.png')
  await a.page.getByPlaceholder('Write a message').fill('I do')
  await a.page.getByRole('button', { name: 'Send', exact: true }).click()
  await a.page.locator('.sheet.on .chat-msg.chat-out', { hasText: 'I do' }).waitFor({ timeout: 10_000 })
  const adaRe = await chatRe(a.page)
  t.ok('a: Ada\'s chat shows the question above "I do"', adaRe.length === 1 && /^Re: “does anyone have a spare room\?”/.test(adaRe[0]), JSON.stringify(adaRe))
  t.ok('a: the context line is gone after that message', await a.page.locator('.sheet.on [data-chat-context]').count() === 0)
  await shot(a.page, 'c6i_a2_ada_thread.png')
  // Bo, on the Web screen (the dock open): the answer arrives at its moment, then the message
  await b.page.locator('.query-dock .outcome.shared').waitFor({ timeout: 160_000 })
  const ansMsg = b.page.locator('.query-dock [data-answer-message]')
  t.ok('a: Bo\'s answer card has "Message Ada"', await ansMsg.count() === 1 && /Message Ada Reply/.test(await ansMsg.innerText()))
  await closeDock(b.page)
  const card = b.page.locator('[data-stack-card="message"]')
  await card.waitFor({ timeout: 30_000 })
  t.ok('a: Bo sees "New message from Ada" as a card above the rings, with an underlined "open" on its right',
    /New message from Ada Reply/.test(await card.innerText()) && await card.locator('[data-card-open]').innerText() === 'open'
    && await card.locator('[data-card-open]').evaluate((n) => getComputedStyle(n).textDecorationLine.includes('underline')))
  const cardBox = await card.boundingBox()
  const ringsBox = await b.page.locator('.rings-wrap').boundingBox()
  t.ok('a: the card sits above the rings, never over them', cardBox && ringsBox && cardBox.y + cardBox.height <= ringsBox.y + 1, JSON.stringify([cardBox, ringsBox]))
  await shot(b.page, 'c6i_a3_bo_card.png')
  await card.locator('[data-card-open]').click()
  await b.page.locator('.sheet.on .chat-msg.chat-in', { hasText: 'I do' }).waitFor({ timeout: 10_000 })
  const boRe = await chatRe(b.page)
  t.ok('a: "open" opens the chat; Bo sees the question above "I do"', boRe.length === 1 && /^Re: “does anyone have a spare room\?”/.test(boRe[0]), JSON.stringify(boRe))
  t.ok('a: the thread is at that message (marked)', await b.page.locator('.sheet.on .chat-msg.chat-focus', { hasText: 'I do' }).count() === 1)
  await shot(b.page, 'c6i_a4_bo_thread.png')
  await closeSheets(b.page)
  t.ok('a: read: the card is gone', await until(async () => (await b.page.locator('[data-stack-card="message"]').count()) === 0, 5_000) !== null)
  // off the Web screen: a tappable notice
  await b.page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  await a.page.getByPlaceholder('Write a message').fill('the room is free from Friday')
  await a.page.getByRole('button', { name: 'Send', exact: true }).click()
  const notice = b.page.locator('[data-msg-notice].on')
  await notice.waitFor({ timeout: 20_000 })
  t.ok('a: on My Resources a notice "New message from Ada" with "open" on its right', /New message from Ada Reply/.test(await notice.innerText()) && /open/.test(await notice.locator('[data-card-open]').innerText()))
  await notice.locator('.msg-notice-text').click()
  await b.page.locator('.sheet.on .chat-msg.chat-in', { hasText: 'free from Friday' }).waitFor({ timeout: 10_000 })
  t.ok('a: a tap anywhere on the notice opens the chat at that message', await b.page.locator('.sheet.on .chat-msg.chat-focus', { hasText: 'free from Friday' }).count() === 1)
  // review 6i (R4): with a sheet open, the notice sits in the top strip, never over the sheet's controls
  await closeSheets(b.page)
  await openCard(b.page, 'Ada Reply')
  await a.page.getByPlaceholder('Write a message').fill('or from Saturday')
  await a.page.getByRole('button', { name: 'Send', exact: true }).click()
  const top = b.page.locator('[data-msg-notice].on.top')
  await top.waitFor({ timeout: 20_000 })
  const topBox = await top.boundingBox()
  const sheetBox = await b.page.locator('.sheet.on').boundingBox()
  t.ok('a: with a card open, the notice sits in the top strip above the sheet, not over it', topBox && sheetBox && topBox.y + topBox.height <= sheetBox.y + 1, JSON.stringify([topBox, sheetBox]))
  await shot(b.page, 'c6i_a5_bo_notice_over_sheet.png')
  await closeSheets(b.page)
  // the record keeps the quote on both phones
  const adaChat = Object.values((await record(a.page)).chats ?? {}).flatMap((th) => th.messages)
  const boChat = Object.values((await record(b.page)).chats ?? {}).flatMap((th) => th.messages)
  t.ok('a: both records keep the quote with "I do" (the same qid)', adaChat.find((m) => m.text === 'I do')?.re?.qid === boChat.find((m) => m.text === 'I do')?.re?.qid
    && boChat.find((m) => m.text === 'I do')?.re?.text === ASK)
  void tag
  await a.ctx.close(); await b.ctx.close()
}

async function partBC(browser) {
  console.log('B  tightening brings back the earlier ask; C  loosening sends nothing')
  const { a, b } = await pair(browser, 'Ring', [{ text: 'Cargo bike to lend', audience: 'friends' }])
  await ask(b.page, 'cargo bike')
  const card = await until(async () => { const x = await bodyText(a.page); return /Bo Ring asked about/.test(x) && /cargo bike/.test(x) ? x : null }, 30_000)
  t.ok('b: Bo is an acquaintance on her side: no prompt, the quiet card for Ada', !!card && await a.page.locator('.overlay.on').count() === 0)
  // his ask settles (nothing for him at the moment)
  await until(async () => /No match/.test(await b.page.locator('.query-dock').innerText()), 160_000)
  t.ok('b: Bo sees "No match" (the same as a decline)', /No match/.test(await b.page.locator('.query-dock').innerText()))
  await closeDock(b.page)
  await setRing(a.page, 'Bo Ring', 'Friend')
  const earlier = await until(async () => { const x = await overlayText(a.page); return /Earlier ask from Bo Ring/i.test(x) && /cargo bike/.test(x) ? x : null }, 30_000)
  t.ok('b: Ada makes Bo a friend: his earlier ask comes back as "Earlier ask from Bo (<time>)"', !!earlier, (await bodyText(a.page)).slice(0, 300))
  await shot(a.page, 'c6i_b1_ada_earlier.png')
  t.ok('b: the quiet card of its first time is gone', !/Bo Ring asked about/.test(await bodyText(a.page)))
  await a.page.locator('.overlay.on').getByRole('button', { name: 'Share these' }).click()
  await a.page.locator('.overlay.on').getByRole('button', { name: 'Back to the app' }).click()
  const got = await until(async () => { const x = await bodyText(b.page); return /Ada Ring answered your earlier ask/.test(x) && /Cargo bike to lend/.test(x) ? x : null }, 160_000)
  t.ok('b: Bo gets the answer at its moment: "Ada answered your earlier ask" with her line', !!got)
  await shot(b.page, 'c6i_b2_bo_answer.png')
  const lateCard = b.page.locator('[data-stack-card="late"]')
  t.ok('b: that card carries the question and opens the conversation', /Re: “cargo bike”/.test(await lateCard.innerText()) && await lateCard.locator('[data-card-open]').count() === 1)
  await lateCard.locator('[data-card-open]').click()
  await b.page.locator('.sheet.on [data-chat-context]').waitFor({ timeout: 5_000 })
  t.ok('b: "open" on it opens the chat with Ada, carrying the ask', /Replying to “cargo bike”/.test(await b.page.locator('.sheet.on [data-chat-context]').innerText()))
  await closeSheets(b.page)

  console.log('C  loosening')
  // let everything settle, then count every sealed wire for a quiet stretch around the lowering
  await new Promise((r) => setTimeout(r, 5_000))
  const before = { a: a.sends.n, b: b.sends.n }
  await setRing(a.page, 'Bo Ring', 'Acquaintance')
  await new Promise((r) => setTimeout(r, 15_000))
  t.ok('c: Ada moves Bo back out: no POST /relay/send from her phone', a.sends.n === before.a, `${before.a} -> ${a.sends.n}`)
  t.ok('c: and none from his (his phone cannot notice anything)', b.sends.n === before.b, `${before.b} -> ${b.sends.n}`)
  t.ok('c: no prompt, no card, nothing new on either side', await a.page.locator('.overlay.on').count() === 0 && !/answered your earlier ask[\s\S]*answered your earlier ask/.test(await bodyText(b.page)))
  const boPeer = (await record(a.page)).peers.find((p) => p.displayName === 'Bo Ring')
  t.ok('c: her record holds him as an acquaintance again, nothing waiting to be sent', boPeer?.ring === 'acquaintance' && boPeer.askAgainDue === undefined)
  await a.ctx.close(); await b.ctx.close()
}

async function partD(browser) {
  console.log('D  the quiet card never covers the web')
  const { a, b } = await pair(browser, 'Cover', [{ text: 'Ladder, three metres', audience: 'fof' }])
  await ask(b.page, 'a sailing boat')
  const card = a.page.locator('[data-stack-card="unmatched"]')
  await card.waitFor({ timeout: 30_000 })
  const cs = await card.evaluate((n) => getComputedStyle(n).position)
  t.ok('d: the nothing-matched card is in the flow (not floating)', cs === 'static' || cs === 'relative', cs)
  const node = a.page.locator('.node', { hasText: 'Bo Cover' }).first()
  const box = await node.boundingBox()
  const hit = await a.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.node')?.textContent ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  t.ok('d: the node under where the card used to float takes the tap', /Bo Cover/.test(hit ?? ''), String(hit))
  await shot(a.page, 'c6i_d1_card_in_flow.png')
  await node.click()
  t.ok('d: tapping Bo opens his card while the quiet card is on screen', await a.page.locator('.sheet.on').count() === 1)
  await closeSheets(a.page)
  // the quiet card hides itself after 20 s (it stays kept)
  t.ok('d: the quiet card hides itself after 20 s', await until(async () => (await a.page.locator('[data-stack-card="unmatched"]').count()) === 0, 30_000) !== null)
  t.ok('d: and stays kept for the next open', ((await record(a.page)).unmatchedAsks ?? []).length === 1)
  await a.ctx.close(); await b.ctx.close()
}

async function partE(browser) {
  console.log('E  Record: lines start as Close friends')
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, permissions: ['microphone'] })
  // No live transcriber in a headless phone (the memo itself becomes a line, as in record_flow)
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  const server = fakeConnectServer(ORIGIN)
  await server.install(ctx)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  await startPhone(page, 'Ada Record')
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.people.push({ id: 'c6iperson', name: 'Cy Record', context: 'met at the market', ring: 'friend', metAt: Date.now(), lines: [] })
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  await page.reload()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.rec-circle').click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Send' }).click()
  await page.getByRole('heading', { name: 'Who was this about?' }).waitFor({ timeout: 5_000 })
  await page.locator('.sheet .chip', { hasText: 'Cy Record' }).click()
  await page.getByRole('heading', { name: /Notes about Cy Record/ }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: '+ Add a line' }).click()
  await page.locator('.line-text').last().fill('Knows a good bike mechanic')
  await page.getByRole('button', { name: 'Looks right' }).click()
  const pills = await page.locator('.aud-row').evaluateAll((rows) => rows.map((r) => [r.querySelector('span')?.textContent, r.querySelector('.aud')?.textContent]))
  t.ok('e: on "Who can ask", the line added on Review starts as Close friends (the memo line stays Only me)',
    pills.some(([txt, aud]) => txt === 'Knows a good bike mechanic' && aud === 'Close friends') && pills.some(([txt, aud]) => /Voice memo/.test(txt) && aud === 'Only me'), JSON.stringify(pills))
  await shot(page, 'c6i_e1_place_close.png')
  await page.getByRole('button', { name: 'Save to my web' }).click()
  await page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 10_000 })
  const cy = (await record(page)).people.find((p) => p.name === 'Cy Record')
  t.ok('e: saved as Close friends', cy?.lines.find((l) => l.text === 'Knows a good bike mechanic')?.audience === 'close', JSON.stringify(cy?.lines))
  await ctx.close()
}

async function main() {
  const app = await startApp(PORT)
  let front = null
  let browser = null
  try {
    front = await startHttpsOrigin({ port: PORT + 1, appPort: PORT, host: HOST })
    browser = await launch([`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT + 1}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'])
    console.log(`conversation_flow: app ${app.base}, https front ${front.origin}`)
    const run = { a: partA, b: partBC, d: partD, e: partE }
    for (const p of PARTS) {
      if (!run[p]) continue
      try { await run[p](browser) } catch (e) { t.ok(`${p}: ran to the end`, false, String(e?.message ?? e).split('\n')[0]) }
    }
  } finally {
    await browser?.close()
    await front?.stop()
    await app.stop()
  }
  t.ok('no page error in any phone', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(t.failures === 0 ? '\nCONVERSATION FLOW: ALL PASS' : `\nCONVERSATION FLOW: ${t.failures} FAILED`)
  process.exit(t.failures === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(2) })
