/**
 * State migration and storage safety in the real app (review-app-a, wave 1733).
 * The deploy after this round lands on a phone whose data exists nowhere else.
 *   A. A record saved by the build BEFORE wave 1733 (test/fixtures/pre_wave_state.mjs)
 *      plus a second persona, a demo phone and the backup info: loads with
 *      nothing lost or duplicated, other keys untouched, the second boot saves
 *      the very same bytes.
 *   B. A record that is there but unreadable (damaged, or from a later build),
 *      with a demo carry-over waiting: never overwritten, kept aside, the
 *      carry-over not applied, the Start screen says so; starting again keeps
 *      the copy aside.
 *   C. A hand-edited carry-over (live ids listed as dummy, a relay link, a
 *      malformed person): merged only on a yes, and it cannot mark real people
 *      dummy, link anyone to the relay, or break the app.
 *   D. Roll back: the record the new build saved loads in the OLD build
 *      (TW_OLD_DIST, the pre-wave dist), an old-build save keeps every new
 *      field, and the new build reads it back without a change.
 *   G. (wave 6e) The fields of this wave: kept, repaired when damaged, kept by the OLD build's saves (TW_OLD_DIST = the live build 206c1d7).
 *   E. The audio store failing (IndexedDB refused; quota on write): recording
 *      and saving still work, the memo and its notes are stored, no player.
 *
 * Local only: Vite dev server for the new build (TW_PORT, default 5196) and a
 * static server for the old build (TW_OLD_PORT, default 5197). Prepare the old
 * build once (no checkout, no install; the pre-wave tree from git archive):
 *   OB=<scratch>/oldbuild; mkdir -p $OB && git archive trustweb-pre-wave-1733-2026-10-06 apps/trustweb apps/demo packages tsconfig.base.json package.json | tar -x -C $OB
 *   ln -s <repo>/node_modules $OB/node_modules; ln -s <repo>/apps/demo/node_modules $OB/apps/demo/node_modules (and packages/<p>/node_modules)
 *   cd $OB/apps/trustweb && TW_BASE=/ node $OB/apps/demo/node_modules/vite/bin/vite.js build --outDir <scratch>/olddist
 * Without TW_OLD_DIST part D is skipped and says so.
 *
 *   cd apps/demo && TW_OLD_DIST=<scratch>/olddist PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/state_migration.mjs
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOW, preWaveState as fixture, roundBFields, roundBState } from '../fixtures/pre_wave_state.mjs'
import { createIdentity, serializeIdentity } from '../../../demo/src/did.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TW_ROOT = path.resolve(HERE, '../..')
const DEMO_ROOT = path.resolve(TW_ROOT, '../demo')
const PORT = Number(process.env.TW_PORT || 5196)
const OLD_PORT = Number(process.env.TW_OLD_PORT || 5197)
const OLD_DIST = process.env.TW_OLD_DIST

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

/** The old build's dist, loopback only, files under the dist folder only. */
function serveDist(dir, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    let file = path.join(dir, decodeURIComponent(url.pathname))
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!existsSync(file)) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

/**
 * The fixture as a phone holds it today: a real relay identity (the app
 * starts its relay with it) and a demo account that has not expired yet
 * (the app ends expired ones at start, by design).
 */
const IDENTITY = serializeIdentity(createIdentity('https://app.idea2.site/relay'))
function preWaveState() {
  const s = fixture()
  s.identity = IDENTITY
  s.testAccounts[0].expiresAt = Date.now() + 6 * 86_400_000
  return s
}

const ME = 'trustweb.v1.me'
const readAll = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('trustweb.')).map((k) => [k, localStorage.getItem(k)])))
const counts = (s) => ({
  people: s.people.length, notes: s.people.reduce((n, p) => n + p.lines.length, 0), inventory: s.inventory.length,
  meetings: (s.meetings ?? []).length, peers: s.peers.length, log: s.log.length, testAccounts: (s.testAccounts ?? []).length, received: (s.received ?? []).length,
})
const sourcesEverywhere = (s) => [...s.inventory, ...s.people.flatMap((p) => p.lines)].every((x) => x.source && typeof x.source.kind === 'string')
const noDupIds = (s) => {
  const ids = [...s.people.map((p) => p.id), ...s.inventory.map((i) => i.id), ...(s.meetings ?? []).map((m) => m.id), ...s.people.flatMap((p) => p.lines.map((l) => 'l:' + l.id))]
  return new Set(ids).size === ids.length
}

/** Opens a page with exactly these TrustWeb keys in localStorage (set once, before the app's first boot). */
async function pageWith(browser, base, keys, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, permissions: ['microphone'] })
  await ctx.addInitScript(() => { delete window.SpeechRecognition; delete window.webkitSpeechRecognition })
  if (opts.init) await ctx.addInitScript(opts.init)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [pageerror]', e.message) })
  page.on('dialog', (d) => void d.accept())
  // a blank page on the same origin first, so the keys are in place before the app boots
  await page.route(base + 'seed-blank', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>seed</title>' }))
  await page.goto(base + 'seed-blank')
  await page.evaluate((kv) => { localStorage.clear(); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v) }, keys)
  await page.goto(base)
  return { ctx, page, errors }
}

const webUp = (page) => page.getByRole('heading', { name: 'Your TrustWeb' }).waitFor({ timeout: 15_000 })

async function partA(browser, base) {
  console.log('A. a pre-wave record in the new build')
  const old = preWaveState()
  const second = { ...preWaveState(), me: { id: 'demo-acc', displayName: 'Jakob-demo' }, testOf: { name: 'Jakob', createdAt: NOW, accountId: 'acc1' } }
  const keys = {
    [ME]: JSON.stringify(old),
    'trustweb.v1.demo-acc1': JSON.stringify(second),
    'trustweb.v1.generic.holder': JSON.stringify({ ...preWaveState(), me: { id: 'h', displayName: 'Holder' } }),
    'trustweb.backup.me': JSON.stringify({ keyText: 'TW1-xxxx', fromPassphrase: false, lastAt: NOW, lastBytes: 4000 }),
  }
  const { ctx, page, errors } = await pageWith(browser, base, keys)
  await webUp(page)
  const after1 = await readAll(page)
  const s1 = JSON.parse(after1[ME])
  ok('nothing lost: people, notes, things, meetings, peers, log, demo accounts, received shares', JSON.stringify(counts(s1)) === JSON.stringify(counts(old)), JSON.stringify([counts(s1), counts(old)]))
  ok('nothing duplicated (every id once)', noDupIds(s1))
  ok('the identity, name and settings are untouched', JSON.stringify(s1.identity) === JSON.stringify(IDENTITY) && s1.me.id === 'jakob-me-id' && s1.tabOrder === 'inventory-left' && s1.defaultRecording === 'meeting' && s1.talkWeaveLocal === true)
  ok('unknown fields kept at three levels', s1.unknownTopLevel?.n === 1 && s1.people[1].futureField?.keep === 'me' && s1.meetings[2].laterField === 7)
  ok('every item and note now has a source', sourcesEverywhere(s1))
  ok('the other keys are byte-identical (second persona, demo phone, backup info)',
    ['trustweb.v1.demo-acc1', 'trustweb.v1.generic.holder', 'trustweb.backup.me'].every((k) => after1[k] === keys[k]))
  ok('no key kept aside, no carry-over left', !Object.keys(after1).some((k) => k.startsWith('trustweb.unreadable.') || k === 'trustweb.carry.v1'))
  console.log(`        record: ${keys[ME].length} -> ${after1[ME].length} bytes`)
  await page.reload()
  await webUp(page)
  const after2 = await readAll(page)
  ok('the second boot saves the very same bytes (idempotent)', after2[ME] === after1[ME])
  await page.locator('nav.tabs button', { hasText: 'My Resources' }).click()
  ok('Inventory lists the three things', await page.locator('.inv').count() === 3)
  await page.locator('[data-item="i2"]').click()
  ok('a migrated thing links to the memo it was noted in', /^From your memo about Cargo bike, /.test(await page.locator('.sheet.on .src-link').innerText().catch(() => '')))
  await page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } })
  ok('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
  return after1[ME]
}

async function partB(browser, base) {
  console.log('B. an unreadable record is never overwritten')
  for (const [name, raw] of [['damaged JSON', '{"v":1,"me":{"id":"jakob-me-id","displayName":"Jak'], ['a later build (v 2)', JSON.stringify({ ...preWaveState(), v: 2 })]]) {
    const carry = JSON.stringify({ v: 1, at: Date.now(), name: 'Demo me', people: [], inventory: [], meetings: [], demo: { people: [], inventory: [] } })
    const { ctx, page, errors } = await pageWith(browser, base, { [ME]: raw, 'trustweb.carry.v1': carry })
    await page.getByLabel('Your first name').waitFor({ timeout: 15_000 })
    const kv = await readAll(page)
    ok(`${name}: the record is untouched`, kv[ME] === raw)
    ok(`${name}: and kept aside, byte for byte`, kv['trustweb.unreadable.v1.me'] === raw)
    ok(`${name}: the waiting carry-over is not applied over it (still waiting)`, kv['trustweb.carry.v1'] === carry)
    ok(`${name}: the Start screen says it is kept aside`, await page.locator('[data-record-kept-aside]').count() === 1)
    await page.getByLabel('Your first name').fill('Jakob')
    await page.getByRole('button', { name: 'Start on this phone' }).click()
    await webUp(page)
    const kv2 = await readAll(page)
    ok(`${name}: starting again keeps the copy aside untouched`, kv2['trustweb.unreadable.v1.me'] === raw && JSON.parse(kv2[ME]).me.displayName === 'Jakob')
    ok(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
}

async function partC(browser, base) {
  console.log('C. a hand-edited carry-over cannot pollute the live record')
  const live = preWaveState()
  const carry = {
    v: 1, at: Date.now(), name: 'Demo me',
    people: [
      { id: 'c-own', name: 'Kim', context: 'Demo', ring: 'friend', metAt: NOW, peerId: 'peer-anna', lines: [] },
      { id: 'c-broken', name: 'No lines' },
      { id: 'anna', name: 'NOT ANNA', context: '', ring: 'friend', metAt: NOW, lines: [] },
    ],
    inventory: [{ id: 'c-thing', text: 'Drill from the demo', audience: 'friends', included: true, createdAt: NOW }],
    meetings: [],
    demo: { people: ['anna', 'max', 'c-own'], inventory: ['i1'] },
  }
  const { ctx, page, errors } = await pageWith(browser, base, { [ME]: JSON.stringify(live), 'trustweb.carry.v1': JSON.stringify(carry) })
  await page.locator('[data-carry="merge"]').waitFor({ timeout: 15_000 })
  ok('the live app already has people: it asks first; none of the carry-over is written before the answer (only the migration saved)', (await readAll(page))[ME].includes('"source"') === true && !(await readAll(page))[ME].includes('c-own'))
  await page.locator('[data-carry="merge"]').click()
  const s = JSON.parse((await readAll(page))[ME])
  ok('the well-formed carried person and thing arrive', s.people.some((p) => p.id === 'c-own') && s.inventory.some((i) => i.id === 'c-thing'))
  ok('the malformed carried person is left out', !s.people.some((p) => p.id === 'c-broken'))
  ok('the live Anna is not replaced', s.people.find((p) => p.id === 'anna').name === 'Anna' && s.people.filter((p) => p.id === 'anna').length === 1)
  ok('no carried person is linked to the relay', s.people.find((p) => p.id === 'c-own').peerId === undefined)
  ok('real people and things are never marked dummy', !s.demo.people.includes('anna') && !s.demo.people.includes('max') && !s.demo.inventory.includes('i1') && s.demo.people.includes('c-own'))
  ok('the carry-over is used up', (await readAll(page))['trustweb.carry.v1'] === undefined)
  await page.reload()
  await webUp(page)
  ok('the app still starts after the merge', true)
  ok('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function partD(browser, base, newRecord) {
  console.log('D. roll back: the new record in the OLD build, and back')
  if (!OLD_DIST || !existsSync(path.join(OLD_DIST, 'index.html'))) { console.log('  SKIP  no TW_OLD_DIST (see the header)'); return }
  const server = await serveDist(OLD_DIST, OLD_PORT)
  const oldBase = `http://127.0.0.1:${OLD_PORT}/`
  try {
    const { ctx, page, errors } = await pageWith(browser, oldBase, { [ME]: newRecord })
    await webUp(page)
    ok('the old build opens the new record on the web (not the Start screen)', await page.getByLabel('Your first name').count() === 0)
    await page.locator('nav.tabs button', { hasText: /Inventory|My Resources/ }).click()
    ok('the old build lists the same three things', await page.locator('.inv').count() === 3)
    // an old-build save: switch the first thing off and on again
    await page.locator('.inv .mini').first().click()
    await page.locator('.inv .mini').first().click()
    const back = JSON.parse((await readAll(page))[ME])
    const n = JSON.parse(newRecord)
    ok('after an old-build save: nothing lost', JSON.stringify(counts(back)) === JSON.stringify(counts(n)))
    ok('after an old-build save: every source and moment is kept (unknown to the old build)', sourcesEverywhere(back) && JSON.stringify(back.inventory.map((i) => i.source)) === JSON.stringify(n.inventory.map((i) => i.source)))
    ok('old build: no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
    const again = await pageWith(browser, base, { [ME]: JSON.stringify(back) })
    await webUp(again.page)
    ok('and the new build reads it back without a change', (await readAll(again.page))[ME] === JSON.stringify(back))
    await again.ctx.close()
  } finally {
    await new Promise((r) => server.close(r))
  }
}

/**
 * F (wave 1733 round B): a record holding every field round B adds. The new
 * build keeps them all (only a job cut off mid-call turns "may still be
 * charged", by design); the pre-wave build opens it and its saves keep every
 * one of them; the new build reads that back unchanged.
 */
async function partF(browser, base) {
  console.log('F. round B fields: kept by this build and by the pre-wave build (rollback)')
  const rb = roundBState()
  rb.identity = IDENTITY
  rb.testAccounts[0].expiresAt = Date.now() + 6 * 86_400_000
  const raw = JSON.stringify(rb)
  const { ctx, page, errors } = await pageWith(browser, base, { [ME]: raw })
  await webUp(page)
  await page.waitForTimeout(1_500)
  const s1 = JSON.parse((await readAll(page))[ME])
  const expected = JSON.parse(raw)
  expected.meetings[1].serverJob.state = 'maybe-charged'
  ok('round B record: opens on the web, nothing lost', JSON.stringify(counts(s1)) === JSON.stringify(counts(expected)))
  ok('round B record: every round-B field kept; only the cut-off job now reads "may still be charged"', roundBFields(s1) === roundBFields(expected), roundBFields(s1))
  ok('round B record: unknown fields kept at three levels', s1.unknownTopLevel?.n === 1 && s1.people[1].futureField?.keep === 'me' && s1.meetings[2].laterField === 7)
  ok('round B record: no page errors', errors.length === 0, errors.join(' | '))
  const settled = (await readAll(page))[ME]
  await ctx.close()
  if (!OLD_DIST || !existsSync(path.join(OLD_DIST, 'index.html'))) { console.log('  SKIP  no TW_OLD_DIST: the rollback half of F'); return }
  const server = await serveDist(OLD_DIST, OLD_PORT)
  const oldBase = `http://127.0.0.1:${OLD_PORT}/`
  try {
    const old = await pageWith(browser, oldBase, { [ME]: settled })
    await webUp(old.page)
    ok('the pre-wave build opens the round-B record on the web', await old.page.getByLabel('Your first name').count() === 0)
    await old.page.locator('nav.tabs button', { hasText: /Inventory|My Resources/ }).click()
    ok('the pre-wave build lists every thing', await old.page.locator('.inv').count() === JSON.parse(settled).inventory.length)
    await old.page.locator('.inv .mini').first().click()
    await old.page.locator('.inv .mini').first().click()
    const back = JSON.parse((await readAll(old.page))[ME])
    ok('after a pre-wave-build save: nothing lost', JSON.stringify(counts(back)) === JSON.stringify(counts(JSON.parse(settled))))
    ok('after a pre-wave-build save: every round-B field is still there', roundBFields(back) === roundBFields(JSON.parse(settled)), roundBFields(back))
    ok('pre-wave build: no page errors', old.errors.length === 0, old.errors.join(' | '))
    await old.ctx.close()
    const again = await pageWith(browser, base, { [ME]: JSON.stringify(back) })
    await webUp(again.page)
    await again.page.waitForTimeout(1_000)
    ok('and this build reads it back without a change', (await readAll(again.page))[ME] === JSON.stringify(back))
    await again.ctx.close()
  } finally {
    await new Promise((r) => server.close(r))
  }
}

/**
 * G (wave 6e): the fields this wave adds (shareMode, sharePins, Person.generalNote, safetyLinkShownAt, connectCode.aliases and lockedNames,
 * contactSentChannels). A record that holds them well-formed keeps every one in this build; a record that holds them damaged (an unknown mode,
 * a pin list of junk, a note that is not text or far too long) is repaired at boot without throwing and without losing anything else; the
 * pre-wave build opens it, and its saves keep every new field; this build reads that back without a change.
 */
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'
const SECRET = 'S'.repeat(43)
const sixEFields = (s) => JSON.stringify({
  mode: s.shareMode, pins: s.sharePins, seen: s.safetyLinkShownAt, sent: s.contactSentChannels,
  notes: s.people.map((p) => p.generalNote ?? null), code: s.connectCode ? { n: s.connectCode.name, a: s.connectCode.aliases, l: s.connectCode.lockedNames } : null,
})
async function partG(browser, base) {
  console.log('G. wave 6e fields: kept, repaired when damaged, and kept by the pre-wave build (rollback)')
  const good = preWaveState()
  good.shareMode = 'trustweb-whatsapp'
  good.sharePins = ['only-signal', 'trustweb-whatsapp']
  good.myChannels = { signal: 'https://signal.me/#eu/adaUsernameCode0123456789', whatsapp: 'https://wa.me/qr/ABCDEFGH12345' }
  good.safetyLinkShownAt = NOW
  good.contactSentChannels = { peerx: { signal: 'https://signal.me/#eu/adaUsernameCode0123456789' } }
  good.people[0].generalNote = 'Likes chess.\nBirthday in May.'
  good.connectCode = { code: CODE, secret: SECRET, url: 'https://app.idea2.site/?connect=x', updatedAt: NOW, name: 'ada', aliases: ['ada2'], lockedNames: ['ada2'] }
  const raw = JSON.stringify(good)
  const { ctx, page, errors } = await pageWith(browser, base, { [ME]: raw })
  await webUp(page)
  await page.waitForTimeout(1_000)
  const s1 = JSON.parse((await readAll(page))[ME])
  ok('wave 6e record: opens on the web, nothing lost', JSON.stringify(counts(s1)) === JSON.stringify(counts(good)))
  ok('wave 6e record: every wave 6e field kept as it was', sixEFields(s1) === sixEFields(good), sixEFields(s1))
  ok('wave 6e record: no page errors', errors.length === 0, errors.join(' | '))
  const settled = (await readAll(page))[ME]
  await ctx.close()

  const bad = preWaveState()
  bad.shareMode = 'both'
  bad.sharePins = ['nope', 'only-signal', 'only-signal', 'trustweb-signal', 'only-trustweb']
  bad.people[0].generalNote = 12345
  bad.people[1].generalNote = 'x'.repeat(9000)
  bad.people[2].generalNote = '   '
  bad.connectCode = { code: CODE, secret: SECRET, url: 'https://app.idea2.site/?connect=x', updatedAt: NOW, name: 'ada', aliases: ['A!', 'ada', 'ada3', 'ada4', 'ada5'], lockedNames: ['gone', 'ada3'] }
  const d = await pageWith(browser, base, { [ME]: JSON.stringify(bad) })
  await webUp(d.page)
  await d.page.waitForTimeout(1_000)
  const fixed = JSON.parse((await readAll(d.page))[ME])
  ok('damaged 6e fields: opens on the web, nothing else lost', JSON.stringify(counts(fixed)) === JSON.stringify(counts(bad)))
  ok('damaged 6e fields: an unknown mode is dropped, the pin list is cleaned to known, unique, at most two', fixed.shareMode === undefined && JSON.stringify(fixed.sharePins) === JSON.stringify(['only-signal', 'trustweb-signal']), JSON.stringify([fixed.shareMode, fixed.sharePins]))
  ok('damaged 6e fields: a note that is not text is dropped, an over-long one cut to 4000, an empty one removed',
    fixed.people[0].generalNote === undefined && fixed.people[1].generalNote.length === 4000 && fixed.people[2].generalNote === undefined)
  ok('damaged 6e fields: the code record keeps a valid name, at most two aliases and locked only for names held',
    fixed.connectCode?.name === 'ada' && JSON.stringify(fixed.connectCode.aliases) === JSON.stringify(['ada3', 'ada4']) && JSON.stringify(fixed.connectCode.lockedNames) === JSON.stringify(['ada3']), JSON.stringify(fixed.connectCode))
  ok('damaged 6e fields: no page errors', d.errors.length === 0, d.errors.join(' | '))
  const boot1 = (await readAll(d.page))[ME]
  await d.page.reload()
  await webUp(d.page)
  ok('damaged 6e fields: the second boot saves the very same bytes (idempotent)', (await readAll(d.page))[ME] === boot1)
  await d.ctx.close()

  if (!OLD_DIST || !existsSync(path.join(OLD_DIST, 'index.html'))) { console.log('  SKIP  no TW_OLD_DIST: the rollback half of G'); return }
  const server = await serveDist(OLD_DIST, OLD_PORT)
  const oldBase = `http://127.0.0.1:${OLD_PORT}/`
  try {
    const old = await pageWith(browser, oldBase, { [ME]: settled })
    await webUp(old.page)
    ok('the pre-wave build opens the wave 6e record on the web', await old.page.getByLabel('Your first name').count() === 0)
    await old.page.locator('nav.tabs button', { hasText: /Inventory|My Resources/ }).click()
    await old.page.locator('.inv .mini').first().click()
    await old.page.locator('.inv .mini').first().click()
    const back = JSON.parse((await readAll(old.page))[ME])
    ok('after a pre-wave-build save: nothing lost', JSON.stringify(counts(back)) === JSON.stringify(counts(JSON.parse(settled))))
    ok('after a pre-wave-build save: every wave 6e field is still there', sixEFields(back) === sixEFields(JSON.parse(settled)), sixEFields(back))
    ok('pre-wave build: no page errors', old.errors.length === 0, old.errors.join(' | '))
    await old.ctx.close()
    const again = await pageWith(browser, base, { [ME]: JSON.stringify(back) })
    await webUp(again.page)
    await again.page.waitForTimeout(1_000)
    ok('and this build reads it back without a change', (await readAll(again.page))[ME] === JSON.stringify(back))
    await again.ctx.close()
  } finally {
    await new Promise((r) => server.close(r))
  }
}

/** Wave 6i: the fields of this wave (a quote on a chat message, re-ask bookkeeping on both sides, late answers' ask time). */
const sixIFields = (s) => JSON.stringify({
  re: Object.values(s.chats ?? {}).flatMap((t) => t.messages.map((m) => m.re ?? null)),
  reaskSeen: s.reaskSeen ?? null,
  sentTo: (s.sentAsks ?? []).map((a) => a.to),
  late: (s.lateAnswers ?? []).map((a) => [a.askedAt, a.earlier]),
})

async function partH(browser, base) {
  console.log('H. wave 6i fields: kept by this build; what the live build (TW_OLD_DIST = 19739d7) keeps when it saves (rollback)')
  const T = Date.now() - 60_000
  const good = preWaveState()
  const peerId = good.peers[0].id
  good.chats = { [peerId]: { messages: [
    { key: `i:${T}:6i`, dir: 'in', text: 'I do', at: T, sentAt: T, state: 'received', re: { qid: 'Qfirst6i01', text: 'does anyone have a spare room?', at: T - 60_000 } },
    { key: `o:${T + 1}:6i`, dir: 'out', text: 'great, thanks', at: T + 1, sentAt: T + 1, state: 'delivered' },
  ], unread: 0 } }
  good.sentAsks = [{ id: 'root6i0001', text: 'spare room', at: T - 2 * 86_400_000, to: [{ peerId, qid: 'Qagain6i01', at: T, reaskOf: 'Qfirst6i01', reasks: 1 }] }]
  good.lateAnswers = [{ id: 'Qagain6i01', at: T, peerId, from: 'Anna', ask: 'spare room', items: [{ text: 'Guest room', when: '', context: '' }], releasedAt: T, askedAt: T - 2 * 86_400_000, earlier: true }]
  good.reaskSeen = [{ id: 'Qolder6i01', at: T, peerId, ring: 'friend' }]
  const { ctx, page, errors } = await pageWith(browser, base, { [ME]: JSON.stringify(good) })
  await webUp(page)
  await page.waitForTimeout(1_500)
  const s1 = JSON.parse((await readAll(page))[ME])
  ok('wave 6i record: opens on the web, nothing lost', JSON.stringify(counts(s1)) === JSON.stringify(counts(good)))
  ok('wave 6i record: every wave 6i field kept as it was', sixIFields(s1) === sixIFields(good), sixIFields(s1))
  ok('wave 6i record: no page errors', errors.length === 0, errors.join(' | '))
  const settled = (await readAll(page))[ME]
  await ctx.close()

  const bad = JSON.parse(JSON.stringify(good))
  bad.chats[peerId].messages[0].re = { qid: 'has space', text: 7, at: -1 }
  bad.reaskSeen = [{ id: 1 }, 'x', { id: 'Q', at: T, peerId, ring: 'family' }]
  bad.sentAsks[0].to[0].reasks = 'many'
  const d = await pageWith(browser, base, { [ME]: JSON.stringify(bad) })
  await webUp(d.page)
  await d.page.waitForTimeout(1_500)
  const fixed = JSON.parse((await readAll(d.page))[ME])
  ok('damaged 6i fields: opens on the web, nothing else lost; a bad quote goes, its message stays', JSON.stringify(counts(fixed)) === JSON.stringify(counts(bad))
    && fixed.chats[peerId].messages.length === 2 && fixed.chats[peerId].messages[0].re === undefined && fixed.chats[peerId].messages[0].text === 'I do')
  ok('damaged 6i fields: no page errors', d.errors.length === 0, d.errors.join(' | '))
  await d.ctx.close()

  if (!OLD_DIST || !existsSync(path.join(OLD_DIST, 'index.html'))) { console.log('  SKIP  no TW_OLD_DIST: the rollback half of H'); return }
  const server = await serveDist(OLD_DIST, OLD_PORT)
  const oldBase = `http://127.0.0.1:${OLD_PORT}/`
  try {
    const old = await pageWith(browser, oldBase, { [ME]: settled })
    await webUp(old.page)
    ok('the live build opens the wave 6i record on the web', await old.page.getByLabel('Your first name').count() === 0)
    await old.page.locator('nav.tabs button', { hasText: /Inventory|My Resources/ }).click()
    await old.page.locator('.inv .mini').first().click()
    await old.page.locator('.inv .mini').first().click()
    const back = JSON.parse((await readAll(old.page))[ME])
    const before = JSON.parse(settled)
    ok('after a live-build save: nothing lost (people, lines, things, chat messages)', JSON.stringify(counts(back)) === JSON.stringify(counts(before))
      && JSON.stringify(back.chats[peerId].messages.map((m) => m.text)) === JSON.stringify(before.chats[peerId].messages.map((m) => m.text)))
    ok('after a live-build save: the re-ask bookkeeping and the late answers\' ask time are still there',
      JSON.stringify(back.reaskSeen) === JSON.stringify(before.reaskSeen) && JSON.stringify((back.sentAsks ?? []).map((a) => a.to)) === JSON.stringify(before.sentAsks.map((a) => a.to))
      && JSON.stringify((back.lateAnswers ?? []).map((a) => [a.askedAt, a.earlier])) === JSON.stringify(before.lateAnswers.map((a) => [a.askedAt, a.earlier])), JSON.stringify([back.reaskSeen, back.sentAsks, back.lateAnswers]))
    // Known and accepted (reported): the live build's chat repair rebuilds each message from its own known fields, so a rollback drops the quotes (never a message).
    console.log(`  NOTE  live build after its save: chat quotes kept = ${back.chats[peerId].messages.filter((m) => m.re).length} of 1`)
    ok('live build: no page errors', old.errors.length === 0, old.errors.join(' | '))
    await old.ctx.close()
  } finally {
    await new Promise((r) => server.close(r))
  }
}

async function recordAndSaveMemo(page) {
  await page.locator('nav.tabs .tab-record').click()
  await page.locator('.about-kind.what').click()
  await page.getByLabel('What was this about?').fill('Lawn mower')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Start recording' }).click()
  await page.locator('.rec-circle.live').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(1_500)
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.getByLabel('Add: resource').fill('can lend it in spring')
  await page.getByLabel('Add: resource').press('Enter')
  await page.getByRole('button', { name: 'Send' }).click()
  await page.locator('.line-card').first().waitFor({ timeout: 10_000 })
  await page.locator('.cta .btn').click()
  await page.getByRole('button', { name: 'Save to My Resources' }).click()
  await page.getByRole('heading', { name: 'My Resources' }).waitFor({ timeout: 10_000 })
}

async function partE(browser, base) {
  console.log('E. the audio store failing never breaks recording or saving')
  const variants = [
    ['IndexedDB refused (private mode / blocked)', () => { Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } }) }],
    ['quota exceeded on writing the take', () => { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError') } }],
  ]
  for (const [name, init] of variants) {
    const { ctx, page, errors } = await pageWith(browser, base, { [ME]: JSON.stringify({ ...preWaveState(), defaultRecording: 'solo' }) }, { init })
    await webUp(page)
    await recordAndSaveMemo(page)
    const s = JSON.parse((await readAll(page))[ME])
    const memo = s.meetings[0]
    const item = s.inventory.find((i) => /can lend it in spring/.test(i.text))
    ok(`${name}: the memo is stored and the item saved with its source`, memo?.about === 'Lawn mower' && item?.source?.meetingId === memo.id)
    await page.locator(`[data-item="${item?.id}"]`).click()
    await page.locator('.sheet.on .src-link').click()
    await page.waitForTimeout(800)
    ok(`${name}: the memo opens, with no player (absent, not broken)`, await page.locator('.sheet.on .pm-player').count() === 0 && await page.locator('.sheet.on [data-pm-note]').count() > 0)
    ok(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
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
  let browser = null
  try {
    await waitForServer(base)
    console.log('state-migration against ' + base)
    const pw = await import(process.env.PLAYWRIGHT_PACKAGE || 'playwright')
    const engine = (pw.chromium ? pw : pw.default).chromium
    browser = await engine.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
    const newRecord = await partA(browser, base)
    await partB(browser, base)
    await partC(browser, base)
    await partD(browser, base, newRecord)
    await partE(browser, base)
    await partF(browser, base)
    await partG(browser, base)
    await partH(browser, base)
  } catch (e) {
    failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    viteProc.kill()
    await relay.close?.()
  }
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS')
  process.exit(failures ? 1 : 0)
}

void main()
