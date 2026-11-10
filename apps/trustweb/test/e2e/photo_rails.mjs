// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 photo-rails proof (headless, stock mode, synthetic record and synthetic pictures only):
 *   PORT=5461 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node photo_rails.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { png } from '../unit/helpers/png.mjs'

const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5461}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, extra = {}) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), ...extra })
const people = [person('p1', 'Ana Berg', 'friend'), person('p2', 'Ben Gruber', 'close', { channels: { whatsapp: '+436601234567' } }), person('p3', 'Cleo Maier', 'acquaintance')]
const record = { v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [], people }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

// Synthetic folder: Seoul 2018/{day1 x2, top x1, 'WhatsApp +436601234567' x2} (no real photo anywhere)
const DIR = '/tmp/photo_rails_e2e/Seoul 2018'
for (const [rel, rgb] of [['day1/a.png', [200, 40, 40]], ['day1/b.png', [40, 200, 40]], ['top.png', [40, 40, 200]], ['WhatsApp +436601234567/w1.png', [200, 200, 40]], ['WhatsApp +436601234567/w2.png', [40, 200, 200]]]) {
  const f = `${DIR}/${rel}`; mkdirSync(f.slice(0, f.lastIndexOf('/')), { recursive: true }); writeFileSync(f, png(64, 48, rgb))
}

/** A coloured canvas as JPEG bytes in the page; withExif inserts an APP1 "Exif" segment (what a camera writes). */
const makeJpeg = (page, w, h, colour, withExif) => page.evaluate(async ([w, h, colour, withExif]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const g = c.getContext('2d'); g.fillStyle = colour; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w / 4, h / 4, w / 2, h / 2)
  const bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer())
  if (!withExif) return Array.from(bytes)
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 0, 0x47, 0x50, 0x53]   // "Exif", then a stub TIFF header and the letters GPS
  const seg = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 255, ...exif]
  return [bytes[0], bytes[1], ...seg, ...bytes.slice(2)]
}, [w, h, colour, withExif]).then((a) => Buffer.from(a))

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const outside = []; const seen = []; page.on('request', (r) => { const u = r.url(); seen.push(u); if (!/^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u) })
    const shot = (n) => page.screenshot({ path: `${SHOTS}/photo-rails-${vw}-${n}.png` })
    await page.goto(URL); await page.waitForTimeout(1200)
    const face = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#2a7'; g.fillRect(0, 0, 64, 64); return c.toDataURL('image/jpeg', 0.7) })
    const rec = { ...record, people: record.people.map((p) => (p.id === 'p1' ? { ...p, image: face } : p)) }
    await page.evaluate(([r]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, [JSON.stringify(rec)])
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)

    const openDetails = async (sel) => { const d = page.locator(sel); await d.scrollIntoViewIfNeeded(); if (!(await d.evaluate((e) => e.open))) { await d.locator('summary').first().click(); await page.waitForTimeout(300) } }
    const fresh = async () => { await page.goto(URL); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900) }
    // A. off by default
    const chunk = async () => seen.some((u) => /photos_body|photo_store/.test(u))
    check(`${vw}: off by default: the photos chunk is not loaded`, !(await chunk()))
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
    check(`${vw}: off: no Photos section on the card`, (await page.locator('[data-photos-host]').count()) === 0)

    // B. Tools > Images exists without the module and works on the avatar picture (data-pic)
    const openTools = async () => { if (!(await page.locator('[data-images-mode]').first().isVisible().catch(() => false))) { await page.locator('[data-zone-side-toggle]').first().click(); await page.waitForTimeout(400) } }
    await fresh()
    await openTools()
    check(`${vw}: Tools has the Images row with Show / Grey out / Hide, Show current`, (await page.locator('[data-images-mode]').count()) === 3 && (await page.locator('[data-images-mode="show"]').getAttribute('aria-pressed')) === 'true')
    await shot('1-tools-images')
    /** Ana's small card: her avatar element, and whether it carries the picture. */
    const anaFace = async () => {
      await fresh()
      await page.locator('[data-pid="p1"]').last().click(); await page.waitForTimeout(500)
      const r = await page.evaluate(() => { const a = document.querySelector('[data-card-face="p1"] .ava'); return a ? { pic: a.dataset.pic === '1', text: a.textContent, bg: a.style.background, filter: getComputedStyle(a).filter, bgImage: getComputedStyle(a).backgroundImage } : null })
      await fresh()
      return r
    }
    const mode = async (m) => { await openTools(); await page.locator(`[data-images-mode="${m}"]`).click(); await page.waitForTimeout(500) }
    let a = await anaFace()
    check(`${vw}: show: the profile picture is drawn`, a?.pic === true && a.bg.includes('data:image') && a.text === '')
    await mode('grey')
    a = await anaFace()
    check(`${vw}: grey out: body flag, picture kept but grey, remembered on this device`, a?.pic === true && a.filter.includes('grayscale') && await page.evaluate(() => document.body.dataset.twImages === 'grey' && localStorage.getItem('trustweb.v1.imagemode') === 'grey'))
    await mode('hide')
    a = await anaFace()
    check(`${vw}: hide: the initial instead of the picture`, a?.pic === false && a.text === 'A' && !a.bg.includes('data:image') && await page.evaluate(() => document.body.dataset.twImages === 'hide'))
    await mode('show')
    a = await anaFace()
    check(`${vw}: show again: picture back, stored as nothing`, a?.pic === true && await page.evaluate(() => localStorage.getItem('trustweb.v1.imagemode') === null && document.body.dataset.twImages === 'show'))

    // C. switch the module on (loads at once)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    await openDetails('[data-settings-section="extensions"]')
    check(`${vw}: Extensions: Photos switch, "loads only when on"`, /loads only when on/.test(await page.locator('[data-ext-module="photos"]').innerText()))
    await page.locator('[data-ext-module="photos"]').click(); await page.waitForTimeout(1500)
    check(`${vw}: on: chunk loaded, settings rows (storage line, folder import)`, (await chunk()) && (await page.locator('[data-photos-storage-line]').count()) === 1 && (await page.locator('[data-photos-import-open]').count()) === 1)
    await openDetails('[data-settings-section="advanced"]')
    check(`${vw}: Advanced: "Match faces on this device (alpha)", off`, (await page.locator('[data-photos-face-match]').count()) === 1 && (await page.locator('[data-photos-face-match]').getAttribute('aria-checked')) === 'false' && /Match faces on this device \(alpha\)/.test(await page.locator('[data-photos-face-match]').innerText()))
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)

    // D. Ben's card: add 3 pictures (one 3000x2000, one with EXIF)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(700)
    const host = page.locator('[data-photos-host="p2"]')
    check(`${vw}: card: Photos section in a shadow root with the alpha subscript`, (await host.count()) === 1 && await page.evaluate(() => !!document.querySelector('[data-photos-host="p2"]').shadowRoot) && /untested alpha feature/.test(await page.locator('[data-photos-section] [data-alpha-label]').innerText()))
    await page.locator('[data-photos-section]').scrollIntoViewIfNeeded(); await shot('2-card-empty')
    const big = await makeJpeg(page, 3000, 2000, '#c33', false)
    const withExif = await makeJpeg(page, 800, 600, '#36c', true)
    const plain = await makeJpeg(page, 640, 480, '#3a6', false)
    check(`${vw}: the test picture really carries Exif`, withExif.includes(Buffer.from('Exif')))
    await page.locator('[data-photo-input="p2"]').setInputFiles([{ name: 'big.jpg', mimeType: 'image/jpeg', buffer: big }, { name: 'cam.jpg', mimeType: 'image/jpeg', buffer: withExif }, { name: 'plain.jpg', mimeType: 'image/jpeg', buffer: plain }])
    await page.waitForFunction(() => document.querySelector('[data-photos-host="p2"]')?.shadowRoot?.querySelectorAll('[data-photo-tile]').length === 3, null, { timeout: 20000 })
    check(`${vw}: three tiles in the grid`, true)
    const db = await page.evaluate(async () => {
      const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n.startsWith('trustweb-photos.'))
      const open = await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result) })
      const all = (s) => new Promise((res) => { const r = open.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result) })
      const metas = await all('meta'); const blobs = await all('blobs')
      const dim = async (b) => { const bm = await createImageBitmap(b); const d = [bm.width, bm.height]; bm.close(); return d }
      const out = []
      for (const b of blobs) {
        const bytes = new Uint8Array(await b.full.arrayBuffer()); const tb = new Uint8Array(await b.thumb.arrayBuffer())
        const has = (u) => { for (let i = 0; i + 5 < u.length; i++) if (u[i] === 0x45 && u[i + 1] === 0x78 && u[i + 2] === 0x69 && u[i + 3] === 0x66) return true; return false }
        out.push({ id: b.id, full: await dim(b.full), thumb: await dim(b.thumb), exif: has(bytes) || has(tb) })
      }
      return { db: name, metas: metas.map((m) => ({ id: m.id, people: m.people, source: m.source, bytes: m.bytes, hash: m.hash.length })), blobs: out }
    })
    check(`${vw}: store: 3 photos linked to Ben, source note, sha-256 hash`, db.metas.length === 3 && db.metas.every((m) => m.people.join() === 'p2' && m.source === 'picked on this phone' && m.hash === 64))
    check(`${vw}: store: kept picture <= 1280 px, thumbnail <= 256 px`, db.blobs.every((b) => Math.max(...b.full) <= 1280 && Math.max(...b.thumb) <= 256) && db.blobs.some((b) => Math.max(...b.full) === 1280))
    check(`${vw}: store: EXIF stripped from every kept picture and thumbnail`, db.blobs.every((b) => !b.exif))
    check(`${vw}: the photos are not in the record (this phone only)`, await page.evaluate(() => !/photo/i.test(Object.keys(JSON.parse(localStorage.getItem('trustweb.v1.me'))).join(',')) && !JSON.stringify(JSON.parse(localStorage.getItem('trustweb.v1.me')).people).includes('blob')))
    check(`${vw}: storage line shows used / quota`, /Photos on this phone: [\d.]+ (B|KB|MB)/.test(await page.locator('[data-photo-storage]').innerText()))
    await page.locator('[data-photos-section]').scrollIntoViewIfNeeded(); await shot('3-card-photos')
    check(`${vw}: no horizontal scroll with the grid`, await noHScroll(page))

    // E. same picture again = no duplicate; remove = tombstone, Recently removed, Restore
    await page.locator('[data-photo-input="p2"]').setInputFiles([{ name: 'plain-again.jpg', mimeType: 'image/jpeg', buffer: plain }])
    await page.waitForFunction(() => /already there/.test(document.querySelector('[data-photos-host="p2"]')?.shadowRoot?.querySelector('[data-photo-note]')?.textContent ?? ''), null, { timeout: 15000 })
    check(`${vw}: the same picture twice is kept once`, (await host.locator('[data-photo-tile]').count()) === 3)
    await host.locator('[data-photo-tile]').first().click(); await page.waitForTimeout(500)
    check(`${vw}: tap opens the viewer with Remove and Share`, (await host.locator('[data-photo-viewer]').count()) === 1 && (await host.locator('[data-photo-remove]').count()) === 1 && (await host.locator('[data-photo-share-one]').count()) === 1)
    await shot('4-viewer')
    await host.locator('[data-photo-remove]').click(); await page.waitForTimeout(700)
    check(`${vw}: removed: 2 tiles left, "Recently removed (1)"`, (await host.locator('[data-photo-tile]').count()) === 2 && /Recently removed \(1\)/.test(await host.locator('[data-photo-trash]').innerText()))
    check(`${vw}: tombstone stamped in the store, picture still kept`, await page.evaluate(async () => {
      const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n.startsWith('trustweb-photos.'))
      const open = await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result) })
      const metas = await new Promise((res) => { const r = open.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => res(r.result) })
      const blobs = await new Promise((res) => { const r = open.transaction('blobs').objectStore('blobs').getAll(); r.onsuccess = () => res(r.result) })
      return metas.filter((m) => typeof m.deletedAt === 'number').length === 1 && blobs.length === 3
    }))
    await host.locator('[data-photo-trash]').click(); await page.waitForTimeout(500)
    await host.locator('[data-photo-restore]').click(); await page.waitForTimeout(700)
    check(`${vw}: restore brings it back`, (await host.locator('[data-photo-tile]').count()) === 3 && (await host.locator('[data-photo-trash]').count()) === 0)

    // F. images mode on the grid
    await page.evaluate(() => { localStorage.setItem('trustweb.v1.imagemode', 'hide') })
    await page.evaluate(() => { document.body.dataset.twImages = 'hide' })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(900)
    check(`${vw}: Images hide: tiles say "Image hidden", no picture drawn`, (await host.locator('[data-photo-tile] img').count()) === 0 && /Image hidden/.test(await host.locator('[data-photo-tile]').first().innerText()))
    await page.evaluate(() => { localStorage.setItem('trustweb.v1.imagemode', 'grey') })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(900)
    check(`${vw}: Images grey out: tiles greyed`, (await host.locator('[data-photo-tile].grey').count()) === 3 && await host.locator('[data-photo-tile].grey img').first().evaluate((i) => getComputedStyle(i).filter.includes('grayscale')))
    await host.locator('[data-photos-section]').scrollIntoViewIfNeeded(); await shot('5-card-grey')
    await page.evaluate(() => { localStorage.removeItem('trustweb.v1.imagemode') })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)

    // G. share rail: select two, Share with a zone
    await page.locator('[data-pid="p2"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(900)
    await host.locator('[data-photo-select]').click(); await page.waitForTimeout(400)
    await host.locator('[data-photo-tile]').nth(0).click(); await page.waitForTimeout(200)
    await host.locator('[data-photo-tile]').nth(1).click(); await page.waitForTimeout(300)
    check(`${vw}: select mode: "Share 2 with…"`, /Share 2 with/.test(await host.locator('[data-photo-share-n]').innerText()))
    await shot('6-select')
    await host.locator('[data-photo-share-n]').click(); await page.waitForTimeout(700)
    check(`${vw}: share page: the app's own scope editor, the stub honesty line`, (await page.locator('[data-photo-share] [data-share-zone]').count()) > 0 && /not sent yet/.test(await page.locator('[data-photo-share-note]').innerText()))
    await page.locator('[data-photo-share] [data-share-zone="friend"]').click().catch(async () => { await page.locator('[data-photo-share] [data-share-zone]').nth(3).click() }); await page.waitForTimeout(400)
    check(`${vw}: preview says who would see it`, /would see this/.test(await page.locator('[data-photo-share] .scope-editor').innerText()))
    await shot('7-share')
    check(`${vw}: share page: no horizontal scroll`, await noHScroll(page))
    await page.locator('[data-photo-share-go]').click(); await page.waitForTimeout(900)
    const shared = await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); return { lines: (r.shares ?? []).filter((l) => l.id.startsWith('item:photos:')), bundles: r.extData?.photos?.bundles ?? [] } })
    check(`${vw}: one share line for the bundle, scope kept`, shared.lines.length === 1 && shared.lines[0].op === 'share' && shared.lines[0].scope.zone.length > 0)
    check(`${vw}: bundle entry: 2 ids + 2 hashes, transport stub, no picture bytes`, shared.bundles.length === 1 && shared.bundles[0].photoIds.length === 2 && shared.bundles[0].hashes.length === 2 && shared.bundles[0].transport === 'stub' && !JSON.stringify(shared.bundles).includes('data:image'))

    // H. folder import (module settings)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    await openDetails('[data-settings-section="extensions"]')
    await page.locator('[data-photos-import-open]').scrollIntoViewIfNeeded(); await page.locator('[data-photos-import-open]').click(); await page.waitForTimeout(800)
    const imp = page.locator('[data-photos-import]')
    check(`${vw}: import page: folder picker + several-files picker`, (await imp.locator('[data-review-folder-input]').count()) === 1 && (await imp.locator('[data-review-files-input]').count()) === 1)
    await imp.locator('[data-review-folder-input]').setInputFiles(DIR); await page.waitForTimeout(1200)
    check(`${vw}: review lists the 5 pictures with their sub-folders`, (await imp.locator('[data-review-item]').count()) === 5 && (await imp.locator('[data-review-folder]').count()) === 2)
    check(`${vw}: no suggestions while the opt-in is off`, (await imp.locator('[data-review-suggest]').count()) === 0 && (await imp.locator('[data-review-group]').count()) === 0)
    await shot('8-import-review')
    // type a name for the day1 folder, existing people only
    await imp.locator('[data-review-folder="day1"] [data-review-folder-who]').fill('Zzz'); await page.waitForTimeout(300)
    check(`${vw}: a name nobody has: told so, no new person made`, (await imp.locator('[data-who-none]').count()) === 1)
    await imp.locator('[data-review-folder="day1"] [data-review-folder-who]').fill('Ana'); await page.waitForTimeout(300)
    await imp.locator('[data-review-folder="day1"] [data-who-hit="p1"]').click(); await page.waitForTimeout(400)
    check(`${vw}: the whole folder is assigned in one go`, (await imp.locator('[data-review-clear]').count()) === 2 && /2 with a person/.test(await imp.locator('[data-review-count]').innerText()))
    // switch on the opt-in: a phone number in the folder name becomes a suggestion for Ben, nothing is assigned yet
    await page.goBack().catch(() => {}); await page.waitForTimeout(600)
    await page.locator('[data-settings-gear]').click().catch(() => {}); await page.waitForTimeout(500)
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); r.extData = { ...r.extData, photos: { ...r.extData.photos, faceMatch: true } }; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    await openDetails('[data-settings-section="extensions"]')
    await page.locator('[data-photos-import-open]').scrollIntoViewIfNeeded(); await page.locator('[data-photos-import-open]').click(); await page.waitForTimeout(800)
    await imp.locator('[data-review-folder-input]').setInputFiles(DIR); await page.waitForTimeout(1200)
    check(`${vw}: opt-in on: the number in the folder name suggests Ben for both, assigned to no one yet`, (await imp.locator('[data-review-suggest]').count()) === 2 && /Ben Gruber\?/.test(await imp.locator('[data-review-suggest]').first().innerText()) && /0 with a person/.test(await imp.locator('[data-review-count]').innerText()))
    check(`${vw}: opt-in on: the placeholder honesty line and the group button`, (await imp.locator('[data-review-group]').count()) === 1 && (await imp.getByText('Placeholder model').count()) === 1)
    await imp.locator('[data-review-take]').click(); await page.waitForTimeout(400)
    check(`${vw}: Take suggestions assigns them`, (await imp.locator('[data-review-clear]').count()) === 2 && (await imp.locator('[data-review-suggest]').count()) === 0)
    await imp.locator('[data-review-folder="day1"] [data-review-folder-who]').fill('Ana'); await page.waitForTimeout(300)
    await imp.locator('[data-review-folder="day1"] [data-who-hit="p1"]').click(); await page.waitForTimeout(400)
    await imp.locator('[data-review-group]').click(); await page.waitForTimeout(2500)
    await shot('9-import-assigned')
    await imp.locator('[data-review-keep]').click()
    await page.waitForFunction(() => /kept/.test(document.querySelector('[data-photos-import]')?.shadowRoot?.querySelector('[data-review-note]')?.textContent ?? ''), null, { timeout: 30000 })
    check(`${vw}: kept 4: result line; Done`, /4 kept/.test(await imp.locator('[data-review-note]').innerText()) && (await imp.locator('[data-review-done]').count()) === 1)
    await shot('10-import-done')
    check(`${vw}: import: no horizontal scroll`, await noHScroll(page))
    await imp.locator('[data-review-done]').click(); await page.waitForTimeout(500)
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    await page.locator('[data-pid="p1"]').last().click(); await page.waitForTimeout(400)
    await page.locator('[data-card-open="p1"]').click(); await page.waitForTimeout(900)
    check(`${vw}: Ana's card now shows her 2 imported photos`, (await page.locator('[data-photos-host="p1"]').locator('[data-photo-tile]').count()) === 2)

    check(`${vw}: nothing left this device (no request outside localhost)`, outside.length === 0)
    check(`${vw}: no page errors`, errors.length === 0)
    if (outside.length) console.log('INFO outside:', outside.slice(0, 5))
    if (errors.length) console.log('INFO errors:', errors.slice(0, 3))
    await ctx.close()
  }
} catch (e) { console.log('FAIL  crashed:', e.message.split('\n').slice(0, 6).join(' | ')); failed = true }
await browser.close()
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
