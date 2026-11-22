// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync live check (headless, dev only, stock record). A fake People API (page.route) with a sync token: connect ->
 * preview (nothing saved) -> accept -> Sync now (photo + tags) -> Google changes + an owner edit -> Sync now (Google wins on the untouched
 * field, the owner's edit stays, a new contact goes to the preview) -> expired token (410) -> full list again. Keep in sync is struck through
 * while GOOGLE_CONTACTS_SYNC_ENABLED is off. Fake client id, synthetic people (example.at).
 * PORT=5478 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node google_contacts_sync.mjs   (360 px touch, then 1280 px)
 */
import { mkdirSync } from 'node:fs'

const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const SHOTS = process.env.SHOTS ?? '/tmp/wave45-google-contacts-sync/shots'
const PORT = process.env.PORT ?? 5478
const BASE = `http://127.0.0.1:${PORT}/`
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const ck = (n, c, d = '') => { if (!c) failures++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)) }
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) })
const member = (id) => ({ contactGroupMembership: { contactGroupId: id, contactGroupResourceName: `contactGroups/${id}` } })
const greta = (email) => ({ resourceName: 'people/c1', names: [{ displayName: 'Greta Beispiel' }], emailAddresses: [{ value: email }], photos: [{ url: 'https://lh3.example.at/greta' }], memberships: [member('fam')] })
const hans = (phone) => ({ resourceName: 'people/c2', names: [{ displayName: 'Hans Muster' }], phoneNumbers: [{ value: phone }] })

async function run(label, viewport, touch) {
  console.log(`--- ${label} ${viewport.width}px`)
  const { ringsFirst, quietKeepCopy } = await import('./rings_first.mjs')
  const b = quietKeepCopy(ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })))
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  // the preview's feature notes stay hidden on every load, also after the trip to (fake) Google
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.twf, .twf-ok, .twp { display: none !important }'; document.head.append(st) }))
  const errs = []
  const syncTokens = []
  // the fake Google account: what a call with a given sync token answers
  let phase = 'first'
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('dialog', (d) => d.accept())
  const hit = (loc) => (touch ? loc.tap() : loc.click())
  const wait = (ms = 300) => page.waitForTimeout(ms)
  const shot = (n) => page.screenshot({ path: `${SHOTS}/google-contacts-sync-${viewport.width}-${n}.png` })
  const rec = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  const person = async (key) => (await rec()).people.find((p) => p.sources?.some((s) => s.key === key))
  const noHScroll = async (n) => ck(`${n}: no horizontal scroll`, await page.evaluate(() => { const p = [...document.querySelectorAll('.page-layer')].pop(); return !p || p.scrollWidth <= p.clientWidth + 1 }))

  await page.route(/^https:\/\/(accounts|oauth2|people)\.google(apis)?\.com\//, (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === 'accounts.google.com') return route.fulfill({ status: 302, headers: { location: `${BASE}?code=fake-code&state=${u.searchParams.get('state')}` } })
    if (u.pathname === '/token') return json(route, { access_token: 'fake-token' })
    if (u.pathname === '/revoke') return json(route, {})
    if (u.pathname === '/v1/contactGroups') return json(route, { contactGroups: [{ resourceName: 'contactGroups/fam', groupType: 'USER_CONTACT_GROUP', formattedName: 'Family Circle' }] })
    if (u.pathname === '/v1/people/me/connections') {
      const tok = u.searchParams.get('syncToken')
      syncTokens.push(tok)
      if (!tok) return json(route, { connections: phase === 'resync' ? [greta('greta.neu@example.at'), hans('+43 660 2220002'), { resourceName: 'people/c3', names: [{ displayName: 'Ida Neu' }] }] : [greta('greta@example.at'), hans('+43 660 1110001')], nextSyncToken: 'S1' })
      if (tok === 'S1' && phase === 'first') return json(route, { connections: [], nextSyncToken: 'S1' })
      if (tok === 'S1' && phase === 'changed') return json(route, { connections: [greta('greta.neu@example.at'), hans('+43 660 2220002'), { resourceName: 'people/c3', names: [{ displayName: 'Ida Neu' }] }], nextSyncToken: 'S2' })
      if (tok === 'S2') return json(route, { error: { code: 410, status: 'FAILED_PRECONDITION' } }, 410)
      return json(route, { connections: [], nextSyncToken: tok })
    }
    return json(route, {}, 404)
  })

  await page.goto(BASE); await wait(1200)
  await page.evaluate(() => {
    localStorage.setItem('tw-google-connect', '1')
    localStorage.setItem('tw_google_client_id', '1234567890-fake.apps.googleusercontent.com')
    localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ben Beispiel' }, peers: [], log: [], inventory: [], people: [] }))
  })
  await page.reload(); await wait(1000)
  const openImport = async () => {
    await hit(page.locator('[data-settings-gear]')); await wait(500)
    // Settings > Import: the entry sits in folded groups; open the ones around it
    await page.evaluate(() => { for (let d = document.querySelector('[data-people-import]')?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true })
    const entry = page.locator('[data-people-import]').first()
    await entry.scrollIntoViewIfNeeded(); await hit(entry); await wait(500)
  }

  // 1. connect: the first sync is the one-shot import, shown as a preview; nothing is saved before the owner says yes
  await openImport()
  ck('not connected: no sync part', await page.locator('[data-gsync]').count() === 0)
  await hit(page.locator('[data-google-connect]')); await page.waitForURL(/127\.0\.0\.1/, { timeout: 8000 }).catch(() => {}); await wait(2500)
  ck('first sync asked for the whole list (no sync token)', syncTokens[0] === null, JSON.stringify(syncTokens))
  const summary = page.locator('[data-svc-summary]')
  ck('preview offers the 2 Google people', await summary.count() === 1 && /2 proposals/.test(await summary.innerText()))
  ck('preview: nobody saved yet', (await rec()).people.length === 0)
  await shot('01-preview')
  await hit(page.locator('[data-svc-yes]')); await wait(700)
  const bulk = page.locator('[data-svc-bulk]')
  ck('curate page offers accept all', await bulk.count() === 1, await page.locator('body').innerText().then((t) => t.slice(0, 200)))
  await hit(bulk); await wait(700)
  ck('both people saved, linked by the Google contact', !!(await person('google-api:people/c1')) && !!(await person('google-api:people/c2')))
  await hit(page.locator('[data-page-back]').last()); await wait(500)

  // 2. Sync now: the accepted people get their photo and tags; Keep in sync is struck through while the switch is off
  if (!(await page.locator('[data-gsync]').count())) await openImport()
  ck('sync part shows once connected', await page.locator('[data-gsync]').count() === 1)
  const keep = page.locator('[data-gsync-keep]')
  ck('Keep in sync: off, struck through, disabled (switch off)', await keep.getAttribute('aria-pressed') === 'false' && /tw-off/.test(await keep.getAttribute('class')) && await keep.isDisabled() && await page.evaluate(() => getComputedStyle(document.querySelector('[data-gsync-keep]')).textDecorationLine.includes('line-through')))
  await hit(page.locator('[data-gsync-now]')); await wait(1200)
  const g1 = await person('google-api:people/c1')
  ck('photo came with the sync', g1?.fields?.photo === 'https://lh3.example.at/greta', JSON.stringify(g1?.fields))
  ck('the Google label is a tag', Object.entries(g1?.fields ?? {}).some(([k, v]) => v === true && /family/i.test(k)), JSON.stringify(g1?.fields))
  ck('later syncs send the sync token', syncTokens.at(-1) === 'S1', JSON.stringify(syncTokens))
  ck('last run line', /Synced .*: 1 updated/.test(await page.locator('[data-gsync-last]').innerText()), await page.locator('[data-gsync-last]').innerText())
  await noHScroll('sync part'); await shot('02-synced')

  // 3. the owner edits Hans' phone here; Google changes Greta's e-mail and Hans' phone and adds Ida
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
    r.people.find((p) => p.name === 'Hans Muster').fields.phone = '+436609990009'
    localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
  })
  phase = 'changed'
  await page.reload(); await wait(1000)
  await openImport()
  await hit(page.locator('[data-gsync-now]')); await wait(1500)
  const g1b = await person('google-api:people/c1')
  const h2 = await person('google-api:people/c2')
  ck('Google wins on the field the owner never edited', Object.values(g1b?.fields ?? {}).includes('greta.neu@example.at'), JSON.stringify(g1b?.fields))
  ck('TrustWeb wins on the field the owner edited', h2?.fields?.phone === '+436609990009', JSON.stringify(h2?.fields))
  ck('the new Google contact opens the preview', await page.locator('[data-svc-summary]').count() === 1 && /1 proposal/.test(await page.locator('[data-svc-summary]').innerText()), await page.locator('[data-svc-summary]').innerText().catch(() => 'no summary'))
  ck('the new one is not saved before the yes', (await rec()).people.length === 2)
  await shot('03-new-in-preview')
  ck('last run counts the kept edit', /1 kept as you edited them, 1 new/.test(await page.locator('[data-gsync-last]').innerText()), await page.locator('[data-gsync-last]').innerText())
  ck('Review new stays available until decided', await page.locator('[data-gsync-review="1"]').count() === 1)

  // 4. Google says the sync token expired (410): a full list again, nothing lost
  phase = 'resync'
  await hit(page.locator('[data-gsync-now]')); await wait(1500)
  ck('expired token -> full list asked for', syncTokens.slice(-2).join(',') === 'S2,', JSON.stringify(syncTokens))
  ck('people kept after the full resync', (await rec()).people.length === 2 && (await person('google-api:people/c2'))?.fields?.phone === '+436609990009')
  await noHScroll('after resync'); await shot('04-resync')

  // 5. Disconnect forgets the sync token (it belongs to that Google account)
  if (!(await page.locator('[data-google-disconnect]').count())) { await hit(page.locator('[data-page-back]').last()); await wait(400) }
  if (!(await page.locator('[data-google-disconnect]').count())) await openImport()
  await hit(page.locator('[data-google-disconnect]')); await wait(700)
  ck('Disconnect: sync token gone, sync part gone', !(await rec()).googleSync?.syncToken && await page.locator('[data-gsync]').count() === 0)
  ck('record never holds the access token', !JSON.stringify(await rec()).includes('fake-token'))
  ck('no page errors', errs.length === 0, errs.join(';'))
  await b.close()
}

await run('phone', { width: 360, height: 780 }, true)
await run('desktop', { width: 1280, height: 900 }, false)
console.log(failures ? `FAILURES ${failures}` : 'ALL PASS')
process.exit(failures ? 1 : 0)
