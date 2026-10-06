/**
 * The Feed and Mastodon/Pixelfed as services (wave 1733 round B, items 1, 2),
 * in the real app, local only:
 *   1. Bar layout: Web | Record | Feed | Inventory; Settings > Feed off gives
 *      exactly the old bar; the empty Feed explains what will show up; opening
 *      it sends nothing.
 *   2. Posts from a second phone: Ben shares a line in an answer; it shows in
 *      Jakob's Feed (who, when, what, "shared with you") and opens Ben.
 *   3. A picture on an item: kept in IndexedDB (not the record), shown in the Feed.
 *   4. A fake Mastodon instance: an address added on a person; CORS allowed
 *      (public posts as plain text, pictures only when switched on), CORS
 *      refused (a link out only), the instance down (said so, nothing breaks).
 *   5. Share to...: Mastodon's share link with the text for a text item, Pixelfed
 *      first for an item with a picture. Molly is named next to Signal on Android only.
 * Ports: Vite 5295, fake instance 5292 (CORS), 5293 (no CORS). TW_SHOTS=<dir>.
 *   cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> npx tsx ../trustweb/test/e2e/feed_flow.mjs
 */
import http from 'node:http'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { checker, launch, newPhone, record, startPhone, startRelay, startVite } from './swiss_harness.mjs'

const SHOTS = process.env.TW_SHOTS
const c = checker()
const ok = c.ok
const errors = []
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAMCAIAAADkharWAAAAFUlEQVR4nGM4EaBBEmIY1TCqATsCACp48AE9ullEAAAAAElFTkSuQmCC', 'base64')

async function shot(page, name) {
  if (!SHOTS) return
  for (const s of [{ name: 'phone', width: 390, height: 844 }, { name: 'desktop', width: 1280, height: 900 }]) {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.waitForTimeout(250)
    await page.screenshot({ path: path.join(SHOTS, `${name}_${s.name}.png`) })
  }
  await page.setViewportSize({ width: 430, height: 900 })
}
const until = async (fn, ms = 20_000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise((r) => setTimeout(r, 200)) }
  return null
}
const tabLabels = (page) => page.locator('nav.tabs > button').evaluateAll((bs) => bs.map((b) => b.textContent.trim()))
const closeSheet = (page) => page.locator('.sheet-veil').click({ position: { x: 20, y: 20 } }).catch(() => {})
const openSettings = async (page) => {
  await closeSheet(page)
  await page.locator('nav.tabs button', { hasText: 'Inventory' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.locator('[data-feed-toggle]').waitFor({ timeout: 5_000 })
}

/** A fake Mastodon-compatible instance: lookup, public statuses (HTML, an image), the image itself. */
function fakeInstance(port, cors) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push(req.url)
    const head = { 'Content-Type': 'application/json', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) }
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/api/v1/accounts/lookup') {
      if (url.searchParams.get('acct') !== 'anna') { res.writeHead(404, head); res.end('{}'); return }
      res.writeHead(200, head); res.end(JSON.stringify({ id: '1091', acct: 'anna' })); return
    }
    if (url.pathname === '/api/v1/accounts/1091/statuses') {
      res.writeHead(200, head)
      res.end(JSON.stringify([
        { id: 's1', created_at: new Date(Date.now() - 3600_000).toISOString(), visibility: 'public', url: `http://127.0.0.1:${port}/@anna/s1`,
          content: '<p>Spare <b>bike</b> parts at the repair café<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"></p>',
          media_attachments: [{ type: 'image', preview_url: `http://127.0.0.1:${port}/media/p.png`, description: 'bike parts' }] },
      ]))
      return
    }
    if (url.pathname === '/media/p.png') { res.writeHead(200, { 'Content-Type': 'image/png', ...(cors ? { 'Access-Control-Allow-Origin': '*' } : {}) }); res.end(PNG); return }
    res.writeHead(404, head); res.end('{}')
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    seen, stop: () => new Promise((r) => { server.closeAllConnections(); server.close(r) }),
  })))
}

async function addAddress(page, personName, address) {
  await page.locator('nav.tabs button', { hasText: 'Web' }).click()
  await page.locator('.node', { hasText: personName }).first().click()
  if (await page.locator('.sheet.on [data-fed-add]').count()) await page.locator('.sheet.on [data-fed-add]').click()
  else await page.locator('.sheet.on [data-fed-row] .mini').click()
  await page.locator('.sheet.on [data-fed-input]').fill(address)
  await page.locator('.sheet.on [data-fed-save]').click()
}

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true })
  const relay = await startRelay()
  const vite = await startVite(5295, { relayPort: relay.port })
  const corsOk = await fakeInstance(5292, true)
  const noCors = await fakeInstance(5293, false)
  let browser = null
  try {
    browser = await launch()
    const a = await newPhone(browser, errors)
    await startPhone(a, vite.base, 'Jakob')

    // 1. the bar, the empty Feed, nothing sent
    ok('the bar: Web | Record | Feed | Inventory', JSON.stringify(await tabLabels(a)) === JSON.stringify(['Web', 'Record', 'Feed', 'Inventory']), JSON.stringify(await tabLabels(a)))
    const sent = []
    a.on('request', (r) => sent.push(r.method() + ' ' + r.url()))
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    await a.locator('[data-feed-empty]').waitFor({ timeout: 5_000 })
    ok('an empty Feed explains what will show up here', /What will show up here/.test(await a.locator('.scroll.feed').innerText()) && /meetings people sent you/.test(await a.locator('.scroll.feed').innerText()))
    await a.waitForTimeout(500)
    ok('opening the Feed sends nothing', sent.length === 0, sent.join(' | '))
    await shot(a, '17-feed-empty')
    await openSettings(a)
    await a.locator('[data-feed-toggle]').click()
    ok('Settings > Feed off: the bar is exactly as before (Web | Record | Inventory)', JSON.stringify(await tabLabels(a)) === JSON.stringify(['Web', 'Record', 'Inventory']) && (await record(a)).feed.on === false)
    await a.locator('[data-feed-toggle]').click()
    ok('and on again', JSON.stringify(await tabLabels(a)) === JSON.stringify(['Web', 'Record', 'Feed', 'Inventory']))
    await closeSheet(a)

    // 2. posts from a second phone
    await a.locator('.status-pill.qr').click()
    await a.locator('.qrwrap canvas').waitFor({ timeout: 15_000 })
    const url = await a.getAttribute('.qrwrap', 'data-payload')
    const b = await newPhone(browser, errors)
    await b.goto(url)
    await b.getByLabel('Your first name').fill('Ben')
    await b.getByRole('button', { name: 'Connect', exact: true }).click()
    await until(async () => (await record(a)).peers.length === 1)
    await b.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await b.getByLabel('e.g. Motorbike, can lend it for a weekend').fill('Cargo bike to lend on weekends')
    await b.getByRole('button', { name: 'Add', exact: true }).click()
    await a.locator('nav.tabs button', { hasText: 'Web' }).click()
    await a.getByRole('button', { name: 'Call into your web' }).click()
    await a.locator('.query-dock textarea').fill('Does anyone have a cargo bike?')
    await a.getByRole('button', { name: 'Ask my web' }).click()
    await b.getByRole('button', { name: 'Share these' }).click({ timeout: 30_000 })
    await until(async () => (await record(a)).found?.length === 1, 90_000)
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    const post = a.locator('[data-post-kind="answer"]').first()
    await post.waitFor({ timeout: 10_000 })
    const pt = await post.innerText()
    ok('Ben\'s answer shows in Jakob\'s Feed: who, when, what, the question, "shared with you"', /Ben/.test(pt) && /Cargo bike to lend on weekends/.test(pt) && /today/.test(pt) && /You asked/.test(pt) && /shared with you/i.test(pt), pt)
    await shot(a, '18-feed-answer-from-second-phone')
    await post.locator('.post-main').click()
    ok('the post opens Ben', await a.locator('.sheet.on h3', { hasText: 'Ben' }).count() === 1)
    await closeSheet(a)

    // 3. a picture on an item
    await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await a.getByLabel('e.g. Motorbike, can lend it for a weekend').fill('Spare bike wheels')
    await a.getByRole('button', { name: 'Add', exact: true }).click()
    await a.locator('.inv-text', { hasText: 'Spare bike wheels' }).click()
    await a.locator('.sheet.on [data-item-image-file]').setInputFiles({ name: 'wheels.png', mimeType: 'image/png', buffer: PNG })
    await a.locator('.sheet.on [data-item-image]').waitFor({ timeout: 10_000 })
    const rec = await record(a)
    const item = rec.inventory.find((i) => i.text === 'Spare bike wheels')
    ok('the picture is kept on the phone (IndexedDB), the record holds its id only', Boolean(item?.imageId) && !JSON.stringify(rec).includes('iVBOR') && await a.evaluate(async (id) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('trustweb-images.me', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      return new Promise((res) => { const g = db.transaction('images').objectStore('images').get(id); g.onsuccess = () => res(Boolean(g.result?.blob?.size)) })
    }, item.imageId))
    await shot(a, '19-item-with-picture')
    await closeSheet(a)
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    await a.locator(`[data-post="mine:${item.id}"] img[data-local-image]`).waitFor({ timeout: 10_000 })
    ok('the Feed shows the item with its picture', await a.locator(`[data-post="mine:${item.id}"] img`).evaluate((i) => i.src.startsWith('blob:')))

    // 4. Mastodon as a service: a fake instance with CORS, one without, one down
    await addAddress(a, 'Ben', 'anna@127.0.0.1:5292')
    await a.locator('.sheet.on [data-fed-show]').waitFor({ timeout: 10_000 })
    const ben = (await record(a)).people.find((p) => p.name === 'Ben')
    ok('an address the instance lets this page read: kept, reach "api", posts off until switched on', ben.fediverse?.handle === 'anna@127.0.0.1:5292' && ben.fediverse.reach === 'api' && ben.fediverse.show === false)
    await a.locator('.sheet.on [data-fed-show]').click()
    await closeSheet(a)
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    await a.waitForTimeout(800)
    ok('with "Also show posts from" still off, nothing is fetched', corsOk.seen.filter((u) => u.includes('/statuses')).length === 0 && await a.locator('[data-post-kind="remote"]').count() === 0)
    await openSettings(a)
    ok('Settings says plainly that the instance sees this phone\'s IP', /IP address/.test(await a.locator('[data-feed-remote]').innerText()) && (await a.locator('[data-feed-remote]').getAttribute('aria-pressed')) === 'false')
    await a.locator('[data-feed-remote]').click()
    await closeSheet(a)
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    const remotePost = a.locator('[data-post-kind="remote"]').first()
    await remotePost.waitFor({ timeout: 10_000 })
    const rt = await remotePost.locator('.post-text').innerText()
    ok('their public post shows as plain text (no markup, no script ran)', /^Spare bike parts at the repair café$/.test(rt.trim()) && await remotePost.locator('.post-text script, .post-text b, .post-text img').count() === 0 && await a.evaluate(() => window.__pwned === undefined), rt)
    ok('pictures stay off until switched on (nothing requested)', await remotePost.locator('img').count() === 0 && !corsOk.seen.some((u) => u.includes('/media/')))
    await openSettings(a)
    await a.locator('[data-feed-images]').click()
    await closeSheet(a)
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    await a.locator('[data-post-kind="remote"] img.post-img').first().waitFor({ timeout: 10_000 })
    await until(async () => corsOk.seen.some((u) => u.includes('/media/')), 10_000)
    ok('pictures on: the picture loads from their instance', corsOk.seen.some((u) => u.includes('/media/p.png')))
    await shot(a, '20-feed-remote-post')

    // CORS refused: only a link out
    await b.context().close()
    await addAddress(a, 'Ben', 'anna@127.0.0.1:5293')
    await a.locator('.sheet.on [data-fed-reach="link"]').waitFor({ timeout: 15_000 })
    ok('an instance that refuses this page (CORS): kept as a link out, "Open their profile"', (await record(a)).people.find((p) => p.name === 'Ben').fediverse.reach === 'link' && /Open their profile/.test(await a.locator('.sheet.on [data-fed-row]').innerText()))
    await shot(a, '21-fediverse-link-only')
    // back to the instance that reads, then it goes down
    await a.locator('.sheet.on [data-fed-row] .mini').click()
    await a.locator('.sheet.on [data-fed-input]').fill('anna@127.0.0.1:5292')
    await a.locator('.sheet.on [data-fed-save]').click()
    await a.locator('.sheet.on [data-fed-show]').waitFor({ timeout: 10_000 })
    await corsOk.stop()
    await a.evaluate(() => { /* the cache is in memory: a reload forgets it */ })
    await a.reload()
    await a.locator('nav.tabs button', { hasText: 'Feed' }).click()
    await a.locator('[data-remote-problem]').waitFor({ timeout: 15_000 })
    ok('the instance is down: the Feed says so and still shows the rest', /did not answer/.test(await a.locator('[data-remote-problem]').innerText()) && await a.locator('[data-post-kind="answer"]').count() === 1)

    // 5. Share to...
    await a.locator(`[data-post="mine:${item.id}"] [data-share-post]`).click()
    const order = await a.locator('.sheet.on [data-share-target]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-share-target')))
    ok('an item with a picture: Pixelfed first', JSON.stringify(order) === '["pixelfed","mastodon"]', JSON.stringify(order))
    ok('Pixelfed says honestly that the text has to be pasted', /paste it there/.test(await a.locator('.sheet.on [data-share-target="pixelfed"]').innerText()))
    await closeSheet(a)
    await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await a.getByLabel('e.g. Motorbike, can lend it for a weekend').fill('Lend a ladder & drill')
    await a.getByRole('button', { name: 'Add', exact: true }).click()
    await a.locator('.inv-text', { hasText: 'Lend a ladder' }).click()
    await a.locator('.sheet.on [data-share-item]').click()
    const order2 = await a.locator('.sheet.on [data-share-target]').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-share-target')))
    ok('a text item: Mastodon first', JSON.stringify(order2) === '["mastodon","pixelfed"]')
    // A local stand-in instance (the dev build accepts 127.0.0.1:<port>): the test never reaches the internet.
    await a.locator('.sheet.on [data-share-instance="mastodon"]').fill('127.0.0.1:5293')
    const [popup] = await Promise.all([a.context().waitForEvent('page'), a.locator('.sheet.on [data-share-go="mastodon"]').click()])
    const shareUrl = popup.url()
    await popup.close()
    ok('Mastodon: their own share page with the text, opened by the tap (nothing posted by the app)', shareUrl === 'http://127.0.0.1:5293/share?text=Lend%20a%20ladder%20%26%20drill', shareUrl)
    ok('the instance is remembered for next time', (await record(a)).feed.myInstance === '127.0.0.1:5293')
    await closeSheet(a)

    // Molly: named next to Signal on Android only
    const android = await browser.newContext({ viewport: { width: 400, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' })
    const d = await android.newPage()
    await startPhone(d, vite.base, 'Dana')
    await d.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await d.getByRole('button', { name: 'Settings' }).click()
    await d.getByRole('button', { name: /Add ways to reach you/ }).click()
    ok('Android: "Signal or Molly"', /Signal or Molly/.test(await d.locator('.sheet.on .channels').innerText()))
    await android.close()
    await a.locator('nav.tabs button', { hasText: 'Inventory' }).click()
    await a.getByRole('button', { name: 'Settings' }).click()
    await a.getByRole('button', { name: /Add ways to reach you/ }).click()
    ok('elsewhere (iPhone, desktop): "Signal" only (Molly exists on Android only)', !/Molly/.test(await a.locator('.sheet.on .channels').innerText()))
    ok('no page errors', errors.length === 0, errors.join(' | '))
  } catch (e) {
    c.failures++
    console.log('  FAIL  run aborted: ' + (e?.stack ?? e))
  } finally {
    await browser?.close()
    vite.stop()
    await corsOk.stop().catch(() => {})
    await noCors.stop()
    await relay.stop()
  }
  console.log(c.failures ? `\n${c.failures} FAILURE(S), ${c.passes} passed` : `\nfeed-flow: ALL PASS (${c.passes})`)
  process.exit(c.failures ? 1 : 0)
}

void main()
