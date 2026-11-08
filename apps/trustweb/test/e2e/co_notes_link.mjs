// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 co-notes-link live proof (headless, dev only): PORT=5472 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.js> node co_notes_link.mjs
 * Several fresh browser contexts stand for several phones. One shared in-memory relay (Playwright routes on /notes/relay) keeps the real server's
 * first-claim rule, so the single-use refusal is the relay's, not a test double of the app.
 */
import { createHash } from 'node:crypto'

const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const PORT = process.env.PORT ?? 5472
const ORIGIN = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const sha = (s) => createHash('sha256').update(s).digest('hex')
const P = (id, name, did) => ({ id, name, context: '', ring: 'close', metAt: 1, lines: [], did })
const EV = { id: 'e1', name: "New Year's retreat", from: '2026-12-27', to: '2027-01-08', where: 'Hut', createdAt: 1, attended: true, people: ['p2'] }
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], coNotesOn: true, events: [EV], people: [P('p2', 'Ben', 'did:key:zBen0000000002')] }

/** services/trustweb-backup/notes_relay.mjs in miniature, shared by every context. */
function relayServer() {
  const box = []
  const claims = new Map()
  let n = 0
  const auth = (role, did, token, mayClaim) => {
    const k = `${role}\0${did}`
    if (!claims.has(k)) { if (!mayClaim) return false; claims.set(k, sha(token)); return true }
    return claims.get(k) === sha(token)
  }
  const handler = async (route) => {
    const req = route.request()
    const u = new URL(req.url())
    const token = req.headers()['x-relay-token'] ?? ''
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}')
      if (!auth('send', body.from, token, true)) return json(404, {})
      const id = `id${n++}`
      box.push({ id, at: n, ...body })
      return json(201, { id })
    }
    const to = u.searchParams.get('for')
    const mine = box.filter((x) => x.to === to)
    if (!mine.length || !auth('read', to, token, true)) return json(404, {})
    if (req.method() === 'DELETE') { const i = box.findIndex((x) => x.id === u.searchParams.get('id')); if (i >= 0) box.splice(i, 1); return route.fulfill({ status: 204 }) }
    const id = u.searchParams.get('id')
    if (id) { const m = mine.find((x) => x.id === id); return m ? json(200, m) : json(404, {}) }
    return json(200, { items: mine.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) })
  }
  return { handler, box }
}

/** The app builds links for its live host; the proof opens them on the dev server. */
const local = (l) => { const u = new URL(l); return `${ORIGIN}${u.pathname}${u.search}${u.hash}` }
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/co-notes-link-${name}.png` })
const text = (page, sel) => page.locator(sel).first().innerText()
const settle = (page, ms = 400) => page.waitForTimeout(ms)
const recordOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))

async function phone(ctxOpts, relay, seed) {
  const ctx = await browser.newContext({ ...ctxOpts, permissions: ['clipboard-read', 'clipboard-write'] })
  await ctx.route('**/notes/relay**', relay.handler)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.errors = errors
  if (seed) {
    await page.goto(ORIGIN + '/'); await settle(page, 1200)
    await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), seed)
    await page.reload(); await settle(page, 1200)
  }
  await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }).catch(() => {})
  return page
}

/** A fresh visitor opens a link, types a name and lands in the app. */
async function arrive(page, link, name) {
  await page.goto(link); await settle(page, 1500)
  await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }).catch(() => {})
  const hadLine = (await page.locator('[data-co-start-invite]').count()) === 1
  await page.locator('.start-form input').fill(name)
  await page.locator('.start-form .btn-electric').click(); await settle(page, 1200)
  return hadLine
}

async function openNotes(page) {
  await page.locator('[data-tab="inventory"], .tab:has-text("Resources")').first().click(); await settle(page, 400)
  await page.locator('.view-menu-btn').first().click()
  await page.locator('[data-view-drop] [data-view="notes"], [data-screen-view="notes"]').first().click(); await settle(page, 500)
}

try {
  for (const [name, opts] of [
    ['360', { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['1280', { viewport: { width: 1280, height: 860 } }],
  ]) {
    const relay = relayServer()
    const noScroll = async (page, label) => check(`${name}: ${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    const owner = await phone(opts, relay, record)

    // 1 Owner: a co-note, then the share sheet.
    await openNotes(owner)
    await owner.locator('[data-co-new]').click(); await settle(owner, 500)
    await owner.locator('[data-co-title]').fill('Retreat plan'); await owner.locator('[data-co-title]').blur()
    await owner.locator('[data-co-first]').click(); await settle(owner, 200)
    await owner.keyboard.type('Book the house'); await owner.locator('[data-co-title]').click(); await settle(owner, 300)
    await owner.locator('[data-co-share-open]').click(); await settle(owner, 500)
    check(`${name}: share sheet opens`, (await owner.locator('[data-co-share-sheet]').count()) === 1)
    check(`${name}: title names the note`, (await text(owner, '[data-page="co-note-share"] h2')).includes('Share "Retreat plan"'))
    check(`${name}: Add people field, five rings, People with access with me as Owner`, (await owner.locator('[data-co-share-input]').count()) === 1 && (await owner.locator('[data-co-ring]').count()) === 5 && (await text(owner, '[data-co-access-row="owner"]')).includes('Owner'))
    check(`${name}: General access is Restricted by default, Advanced collapsed`, (await text(owner, '[data-co-restricted]')) === 'Restricted' && (await owner.locator('[data-co-advanced]').evaluate((d) => d.open)) === false)
    check(`${name}: ring default is Intending to connect`, (await owner.locator('[data-co-ring="intending"]').getAttribute('aria-pressed')) === 'true')
    await noScroll(owner, 'share sheet'); await shot(owner, `${name}-owner-share`)

    // 2 Typeahead: a match lists the person and no single-use offer; no match offers one.
    await owner.locator('[data-co-share-input]').fill('Be'); await settle(owner, 200)
    check(`${name}: typing Be lists Ben and offers no new link`, (await owner.locator('[data-co-share-hit="p2"]').count()) === 1 && (await owner.locator('[data-co-share-offer]').count()) === 0)
    await owner.locator('[data-co-share-input]').fill('Cara'); await settle(owner, 200)
    check(`${name}: typing Cara (nobody) offers "Single-use link for Cara"`, (await text(owner, '[data-co-share-offer]')) === 'Single-use link for Cara')
    await owner.locator('[data-co-ring="friend"]').click()
    await owner.locator('[data-co-share-input]').fill('Cara'); await settle(owner, 200)
    await owner.locator('[data-co-share-offer]').click(); await settle(owner, 800)
    const rec1 = await recordOf(owner)
    const inv = rec1.coInvites?.[0]
    check(`${name}: the invite is stored: single use, ring Friend, state invited`, inv?.mode === 'person' && inv.ring === 'friend' && inv.state === 'invited' && inv.name === 'Cara')
    const link = local(await owner.evaluate(() => navigator.clipboard.readText()))
    const lu = new URL(link)
    check(`${name}: link has ?note=<id> and the key only after #`, lu.searchParams.get('note') === inv?.id && !lu.search.includes(inv?.key) && lu.hash.includes(`k=${inv?.key}`))
    check(`${name}: the relay holds ciphertext only`, relay.box.length === 1 && !JSON.stringify(relay.box).includes('Book the house'))
    check(`${name}: access list shows Cara with her ring and "invited"`, (await text(owner, '[data-co-access-row="guest"]')).includes('Cara') && (await text(owner, '[data-co-access-row="guest"]')).includes('invited'))
    await shot(owner, `${name}-owner-invited`)

    // 3 Guest A: new phone, start line, connect gate, accept, nested shell.
    const a = await phone(opts, relay)
    const startLine = await arrive(a, link, 'Cara')
    check(`${name}: a new visitor sees the invitation on the start screen`, startLine)
    check(`${name}: connect gate shows`, (await a.locator('[data-co-connect-gate]').count()) === 1 && (await text(a, '[data-co-connect-gate]')).includes('Jakob invites you to a shared note'))
    check(`${name}: gate says the sender appears in my Intending to connect ring`, (await text(a, '[data-co-connect-gate] + p')).includes('Intending to connect'))
    check(`${name}: nothing opened before Accept`, !((await recordOf(a)).coNotes?.length))
    await noScroll(a, 'gate'); await shot(a, `${name}-guest-gate`)
    await a.locator('[data-co-accept]').click(); await settle(a, 2500)
    check(`${name}: guest shell on`, (await a.locator('[data-guest-shell]').count()) === 1)
    const tabIds = await a.locator('[data-guest-shell] [data-go]').evaluateAll((t) => t.map((x) => x.getAttribute('data-go')))
    check(`${name}: bar = Web, Chat, Resources only`, JSON.stringify(tabIds) === JSON.stringify(['web', 'chat', 'inventory']))
    check(`${name}: Chat is the centre button, highlighted`, (await a.locator('[data-guest-shell] [data-go="chat"]').evaluate((e) => e.classList.contains('tab-primary'))) === true)
    check(`${name}: the note is open with its text in Chat`, (await text(a, '[data-guest-note]')).includes('Book the house') && (await a.locator('[data-co-title]').inputValue()) === 'Retreat plan')
    check(`${name}: a guest cannot pass the note on (no Share)`, (await a.locator('[data-co-share-open]').count()) === 0)
    const recA = await recordOf(a)
    const jak = recA.people.find((p) => p.name === 'Jakob')
    check(`${name}: guest's web has Jakob in Intending to connect`, jak?.ring === 'intending')
    check(`${name}: guest is a participant, extension on`, recA.coNotesOn === true && recA.coNotes?.[0]?.people.some((p) => p.name === 'Cara'))
    await noScroll(a, 'guest shell'); await shot(a, `${name}-guest-shell`)

    // 4 A second phone, same single-use link: refused, nothing stored.
    const b = await phone(opts, relay)
    await arrive(b, link, 'Eve')
    await b.locator('[data-co-accept]').click(); await settle(b, 2500)
    check(`${name}: second phone is refused in plain words`, (await text(b, '[data-co-guest-message="refused"]')).includes('has been used already'))
    check(`${name}: refused phone got no note and no shell`, !((await recordOf(b)).coNotes?.length) && (await b.locator('[data-guest-shell]').count()) === 0)
    await noScroll(b, 'refused'); await shot(b, `${name}-guest-refused`)

    // 5 Owner hears it: state connected, Cara in the web in the ring I chose, in the note, logged.
    await owner.waitForFunction(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); return s.coInvites?.[0]?.state === 'connected' }, null, { timeout: 30000 }).catch(() => {})
    const rec2 = await recordOf(owner)
    check(`${name}: owner's invite moved to connected`, rec2.coInvites?.[0]?.state === 'connected')
    const cara = rec2.people.find((p) => p.name === 'Cara')
    check(`${name}: Cara sits in my web in the ring I set (Friend), bound to her did`, cara?.ring === 'friend' && !!cara.did)
    check(`${name}: Cara is a participant of the note`, rec2.coNotes?.[0]?.people.some((p) => p.name === 'Cara'))
    check(`${name}: invite create and open are logged (I6)`, (rec2.coNotesLog ?? []).some((l) => l.includes('single-use link for Cara')) && (rec2.coNotesLog ?? []).some((l) => l.includes('opened "Retreat plan"')))
    await settle(owner, 9000)
    check(`${name}: share sheet shows the state "connected"`, (await text(owner, '[data-co-access-row="guest"]')).includes('connected'))
    await shot(owner, `${name}-owner-connected`)

    // 6 Group chat: guest writes, owner reads; a participant chip opens the 1:1 chat.
    await a.locator('[data-co-chat-input]').fill('See you at the house'); await a.locator('[data-co-chat-send]').click(); await settle(a, 800)
    check(`${name}: guest sees own message in the group chat`, (await a.locator('[data-co-msg]').count()) === 1)
    check(`${name}: chat label is honest`, (await text(a, '[data-co-chat-honest]')).includes('End-to-end encrypted on your device') && (await text(a, '[data-co-chat-honest]')).includes('within seconds when both are online'))
    await owner.goBack(); await settle(owner, 400)
    await owner.waitForFunction(() => document.querySelector('[data-co-msg]'), null, { timeout: 30000 }).catch(() => {})
    check(`${name}: owner receives the message sealed, from Cara`, (await owner.locator('[data-co-msg]').count()) === 1 && (await text(owner, '[data-co-msg]')).includes('See you at the house'))
    check(`${name}: relay still holds no readable chat`, !JSON.stringify(relay.box).includes('See you'))
    await shot(owner, `${name}-owner-chat`)
    await owner.locator('.co-people [data-co-chip]').first().click(); await settle(owner, 600)
    check(`${name}: participant chip opens a 1:1 chat with Cara`, (await owner.locator('.sheet.on').count()) >= 1 && (await owner.locator('.sheet.on').first().innerText()).includes('Cara'))
    await owner.keyboard.press('Escape'); await settle(owner, 300)
    // Closing the chat sheet closes the pages under it: back into the note from the Notes list.
    await owner.goto(ORIGIN + '/'); await settle(owner, 1500); await owner.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
    await openNotes(owner)
    await owner.locator('[data-co-open]').first().click(); await settle(owner, 500)

    // 7 Advanced: an anonymous link with "show me when someone watches"; the reader needs no connection and cannot edit.
    await owner.locator('[data-co-share-open]').click(); await settle(owner, 500)
    await owner.locator('[data-co-advanced] summary').click()
    await owner.locator('[data-co-watch]').check()
    await owner.locator('[data-co-anon-create]').click(); await settle(owner, 800)
    const anonLink = local(await owner.evaluate(() => navigator.clipboard.readText()))
    check(`${name}: anonymous link says so, watch flag in the fragment`, new URL(anonLink).hash.includes('a=1') && new URL(anonLink).hash.includes('w=1'))
    const c = await phone(opts, relay)
    await arrive(c, anonLink, 'Reader')
    await settle(c, 2000)
    check(`${name}: anonymous reader gets no connect gate and opens the note`, (await c.locator('[data-co-connect-gate]').count()) === 0 && (await text(c, '[data-guest-note]')).includes('Book the house'))
    check(`${name}: anonymous copy is read-only and says so`, (await c.locator('[data-co-first], [data-co-input], [data-co-chat-input], [data-co-add-people]').count()) === 0 && (await c.locator('[data-co-anon-note]').count()) === 1)
    check(`${name}: anonymous reader connected to nobody`, (await recordOf(c)).people.length === 0)
    await shot(c, `${name}-guest-anonymous`)
    await owner.waitForFunction(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).coInvites?.some((i) => i.mode === 'anyone' && i.state === 'opened'), null, { timeout: 30000 }).catch(() => {})
    check(`${name}: owner sees that someone watches (no identity)`, (await recordOf(owner)).coInvites.some((i) => i.mode === 'anyone' && i.state === 'opened'))

    // 8 A note linked to an event: Events joins the bar and is highlighted; Chat is not.
    await owner.goto(ORIGIN + '/'); await settle(owner, 1500); await owner.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' })
    await owner.locator('[data-go="events"]').first().click(); await settle(owner, 400)
    await owner.locator('[data-cal-all]').first().click().catch(() => {}); await settle(owner, 200)
    await owner.locator('[data-event="e1"]').first().click(); await settle(owner, 400)
    await owner.locator('[data-co-desires]').click(); await settle(owner, 600)
    await owner.locator('[data-co-share-open]').click(); await settle(owner, 500)
    await owner.locator('[data-co-share-input]').fill('Dee'); await settle(owner, 200)
    await owner.locator('[data-co-share-offer]').click(); await settle(owner, 800)
    const evLink = local(await owner.evaluate(() => navigator.clipboard.readText()))
    const d = await phone(opts, relay)
    await arrive(d, evLink, 'Dee')
    await d.locator('[data-co-accept]').click(); await settle(d, 3000)
    const evTabs = await d.locator('[data-guest-shell] [data-go]').evaluateAll((t) => t.map((x) => [x.getAttribute('data-go'), x.classList.contains('tab-primary')]))
    check(`${name}: event note bar = Web, Chat, Events, Resources`, JSON.stringify(evTabs.map((t) => t[0])) === JSON.stringify(['web', 'chat', 'events', 'inventory']))
    check(`${name}: Events is highlighted, Chat is not`, evTabs.find((t) => t[0] === 'events')?.[1] === true && evTabs.find((t) => t[0] === 'chat')?.[1] === false)
    check(`${name}: guest has only that event`, ((await recordOf(d)).events ?? []).map((e) => e.name).join() === "New Year's retreat")
    await noScroll(d, 'event shell'); await shot(d, `${name}-guest-event-shell`)
    await d.locator('[data-guest-shell] [data-go="chat"]').click(); await settle(d, 500)
    check(`${name}: the note still opens from Chat`, (await d.locator('[data-guest-note]').count()) === 1)

    // 9 Extension off: nothing of this shows (I9).
    const off = await phone(opts, relay, { ...record, coNotesOn: false })
    await openNotes(off)
    check(`${name}: extension off: no co-notes, no share`, (await off.locator('[data-co-new], [data-co-share-open], [data-guest-shell]').count()) === 0)

    const all = [owner, a, b, c, d, off]
    check(`${name}: no page errors anywhere`, all.every((p) => p.errors.length === 0))
    for (const p of all) if (p.errors.length) console.log(p.errors)
    for (const p of all) await p.context().close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
