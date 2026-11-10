// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 google-connect-flag live check (headless, dev only, stock record). No real Google call: accounts.google.com, the token,
 * People API and revoke endpoints are answered by page.route. Fake client id, synthetic people (example.at).
 * PORT=5480 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node google_connect_flag.mjs   (360 px touch, then 1280 px)
 */
import { mkdirSync } from 'node:fs'

const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const SHOTS = process.env.SHOTS ?? '/tmp/wave40-google-connect-flag/shots'
const PORT = process.env.PORT ?? 5480
const BASE = `http://127.0.0.1:${PORT}/`
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const ck = (n, c, d = '') => { if (!c) failures++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)) }
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) })
const member = (id) => ({ contactGroupMembership: { contactGroupId: id, contactGroupResourceName: `contactGroups/${id}` } })

async function run(label, viewport, touch) {
  console.log(`--- ${label} ${viewport.width}px`)
  const b = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errs = []
  const outside = []
  let revoked = 0
  let authUrl = null
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('dialog', (d) => d.accept())
  const hit = (loc) => (touch ? loc.tap() : loc.click())
  const wait = (ms = 300) => page.waitForTimeout(ms)
  const shot = (n) => page.screenshot({ path: `${SHOTS}/google-connect-${viewport.width}-${n}.png` })
  const noHScroll = async (n) => ck(`${n}: no horizontal scroll`, await page.evaluate(() => { const p = [...document.querySelectorAll('.page-layer')].pop(); return !p || p.scrollWidth <= p.clientWidth + 1 }))

  await page.route(/^https:\/\/(accounts|oauth2|people)\.google(apis)?\.com\//, (route) => {
    const u = new URL(route.request().url())
    outside.push(u.origin + u.pathname)
    if (u.hostname === 'accounts.google.com') {
      authUrl = u
      return route.fulfill({ status: 302, headers: { location: `${BASE}?code=fake-code&state=${u.searchParams.get('state')}` } })
    }
    if (u.pathname === '/token') return json(route, { access_token: 'fake-token' })
    if (u.pathname === '/revoke') { revoked++; return json(route, {}) }
    if (u.pathname === '/v1/contactGroups') return json(route, { contactGroups: [
      { resourceName: 'contactGroups/myContacts', groupType: 'SYSTEM_CONTACT_GROUP', formattedName: 'My Contacts' },
      { resourceName: 'contactGroups/fam', groupType: 'USER_CONTACT_GROUP', formattedName: 'Family Circle' },
    ] })
    if (u.pathname === '/v1/people/me/connections') return json(route, { connections: [
      { resourceName: 'people/c1', names: [{ displayName: 'Greta Beispiel' }], emailAddresses: [{ value: 'greta@example.at' }], memberships: [member('myContacts'), member('fam')] },
      { resourceName: 'people/c2', names: [{ displayName: 'Hans Muster' }], phoneNumbers: [{ value: '+43 660 1234567' }], memberships: [member('myContacts')] },
    ] })
    return json(route, {}, 404)
  })

  await page.goto(BASE); await wait(1200)
  await page.evaluate(() => { localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ben Beispiel' }, peers: [], log: [], inventory: [], people: [{ id: 'have1', name: 'Hugo Ivanov', context: '', ring: 'friend', metAt: 1, lines: [], fields: {} }] })) })
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await wait(1000)

  const openImport = async () => {
    await hit(page.locator('[data-settings-gear]')); await wait(500)
    if (!(await page.locator('[data-people-import]').first().isVisible())) { await hit(page.locator('summary', { hasText: 'Your web' }).first()); await wait(300) }
    await hit(page.locator('[data-people-import]').first()); await wait(500)
  }

  // 1. flag off by default: no Google part on the Import page
  await openImport()
  ck('Import page opens', await page.locator('[data-page="import-services"]').count() === 1)
  ck('flag off: no Connect Google part', await page.locator('[data-google-sync]').count() === 0)
  ck('flag off: nothing sent to Google', outside.length === 0)
  await shot('01-flag-off')
  await hit(page.locator('[data-page-back]').last()); await wait(400)

  // 2. Settings > Advanced > Flags switch
  const sw = page.locator('[data-flag-toggle="googleConnect"] input')
  if (!(await page.locator('.sheet.on').count())) { await hit(page.locator('[data-settings-gear]')); await wait(500) }
  // the Advanced part sits inside its group, which sits folded: open Advanced and every folded part around it
  await page.evaluate(() => { for (let d = document.querySelector('[data-settings-advanced]'); d; d = d.parentElement?.closest('details')) d.open = true })
  await sw.scrollIntoViewIfNeeded().catch(() => {})
  ck('Flags switch exists in Advanced, off', await sw.count() === 1 && !(await sw.isChecked()), String(await sw.count()))
  await shot('02-flags')
  await sw.check(); await wait(500)
  ck('flag remembered', await page.evaluate(() => localStorage.getItem('tw-google-connect')) === '1')

  // 3. flag on: the Google part shows; connect needs a client id
  await page.keyboard.press('Escape'); await wait(300)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await wait(900)
  await openImport()
  ck('flag on: Connect Google part shows', await page.locator('[data-google-sync]').count() === 1)
  ck('heading carries the alpha label', await page.locator('[data-google-sync] [data-alpha-label]').count() === 1)
  ck('connect button reads "Connect Google contacts"', /Connect Google contacts/.test(await page.locator('[data-google-connect]').innerText()))
  ck('no client id yet: button disabled', await page.locator('[data-google-connect]').isDisabled())
  await page.locator('[data-google-clientid]').fill('1234567890-fake.apps.googleusercontent.com'); await page.locator('[data-google-clientid]').blur(); await wait(400)
  ck('client id set: button enabled', await page.locator('[data-google-connect]').isEnabled())
  await noHScroll('google part'); await shot('03-flag-on')

  // 4. connect (mocked Google), contacts come back with their groups as labels
  await hit(page.locator('[data-google-connect]')); await page.waitForURL(/code=|127\.0\.0\.1/, { timeout: 8000 }).catch(() => {}); await wait(2500)
  ck('auth request: code + S256 + contacts.readonly only', !!authUrl && authUrl.searchParams.get('code_challenge_method') === 'S256' && authUrl.searchParams.get('scope') === 'https://www.googleapis.com/auth/contacts.readonly' && authUrl.searchParams.get('client_id') === '1234567890-fake.apps.googleusercontent.com', String(authUrl))
  ck('redirect uri is the app origin + path', authUrl?.searchParams.get('redirect_uri') === BASE, authUrl?.searchParams.get('redirect_uri'))
  ck('return trip cleaned from the address', !/code=|state=/.test(page.url()), page.url())
  ck('token is in sessionStorage only', await page.evaluate(() => sessionStorage.getItem('tw_google_token') === 'fake-token' && !JSON.stringify(localStorage).includes('fake-token')))
  ck('only mocked Google hosts were called', outside.every((o) => /accounts\.google\.com|oauth2\.googleapis\.com|people\.googleapis\.com/.test(o)))
  const summary = page.locator('[data-svc-summary]')
  ck('summary offers the 2 Google people', await summary.count() === 1 && /2 proposals/.test(await summary.innerText()), await page.locator('body').innerText().then((t) => t.slice(0, 300)))
  await shot('04-summary')
  await hit(page.locator('[data-svc-yes]')); await wait(700)
  ck('curate page opens', await page.locator('[data-page="import-curate"]').count() === 1)
  ck('group becomes a tag pill, "My Contacts" does not', await page.locator('[data-cur-pill]', { hasText: 'Family Circle' }).count() >= 1 && await page.locator('[data-cur-pill]', { hasText: 'My Contacts' }).count() === 0)
  await noHScroll('curate'); await shot('05-curate')
  await hit(page.locator('[data-page-back]').last()); await wait(500)

  // 5. nudge after connecting, dismiss is remembered
  if (!(await page.locator('[data-google-sync]').count())) await openImport()
  const nudge = page.locator('[data-google-nudge]')
  ck('nudge shows after connecting', await nudge.count() === 1 && /You can leave Google later: TrustWeb exports everything\. We will offer a systematic switch when a good alternative exists\./.test(await nudge.innerText()), await page.locator('[data-google-sync]').innerText().catch(() => 'no google part'))
  await noHScroll('nudge'); await shot('06-nudge')
  await hit(page.locator('[data-google-nudge-dismiss]')); await wait(400)
  ck('Dismiss hides the nudge', await page.locator('[data-google-nudge]').count() === 0)
  ck('Dismiss is remembered across reload', await (async () => { await page.reload(); await wait(1000); await openImport(); return (await page.locator('[data-google-nudge]').count()) === 0 && (await page.locator('[data-google-disconnect]').count()) === 1 })())

  // 6. Disconnect forgets the token and revokes it
  await hit(page.locator('[data-google-disconnect]')); await wait(700)
  ck('Disconnect forgets the token', await page.evaluate(() => sessionStorage.getItem('tw_google_token') === null))
  ck('Disconnect revokes at Google', revoked === 1, String(revoked))
  ck('Disconnect button gone, Connect remains', await page.locator('[data-google-disconnect]').count() === 0 && await page.locator('[data-google-connect]').count() === 1)
  await shot('07-disconnected')
  ck('no page errors', errs.length === 0, errs.join(';'))
  await b.close()
}

await run('phone', { width: 360, height: 780 }, true)
await run('desktop', { width: 1280, height: 900 }, false)
console.log(failures ? `FAILURES ${failures}` : 'ALL PASS')
process.exit(failures ? 1 : 0)
