// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 import-curate live check (headless, dev only, stock record, synthetic vcf of 30 cards incl. 3 date-named junk).
 * PORT=5471 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node import_curate.mjs
 * Runs once at 360 px (touch) and once at 1280 px.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { syntheticVcf } from '../fixtures/synthetic_contacts.mjs'

const { chromium } = await import(process.env.PW ?? 'playwright-core')
const SHOTS = process.env.SHOTS ?? '/tmp/wave39-import-curate/shots'
const TMP = '/tmp/wave39-import-curate'
mkdirSync(SHOTS, { recursive: true })
writeFileSync(`${TMP}/contacts.vcf`, syntheticVcf())
writeFileSync(`${TMP}/more.vcf`, ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Zora Extra', 'EMAIL:zora@example.org', 'CATEGORIES:Levitin Lab', 'UID:z1', 'END:VCARD', ''].join('\r\n'))
const key = (n) => n.toString(16).padStart(16, '0')
writeFileSync(`${TMP}/trustweb-inventory-import.json`, JSON.stringify({ format: 'trustweb-inventory-import', version: 1, exportedOn: '2026-11-10', items: [1, 2, 3].map((i) => ({ key: key(i), text: `Synthetic resource line ${i}`, audience: 'me', provenance: 'tana' })) }))

let failures = 0
const ck = (n, c, d = '') => { if (!c) failures++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)) }

async function run(label, viewport, touch) {
  console.log(`--- ${label} ${viewport.width}px`)
  const b = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('dialog', (d) => d.accept())
  const hit = (loc) => (touch ? loc.tap() : loc.click())
  const wait = (ms = 300) => page.waitForTimeout(ms)
  const shot = (n) => page.screenshot({ path: `${SHOTS}/import-curate-${viewport.width}-${n}.png` })
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  const noHScroll = async (n) => ck(`${n}: no horizontal scroll`, await page.evaluate(() => { const p = [...document.querySelectorAll('.page-layer')].pop(); return !p || p.scrollWidth <= p.clientWidth + 1 }))

  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5471}/`); await wait(1200)
  await page.evaluate(() => { localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ben Beispiel' }, peers: [], log: [], inventory: [], people: [{ id: 'have1', name: 'Hugo Ivanov', context: '', ring: 'friend', metAt: 1, lines: [], fields: {} }, ...['a', 'b', 'c'].map((x) => ({ id: 'tana-' + x, name: 'Tana Test ' + x, context: '', ring: 'unsorted', metAt: 1, lines: [] }))] })) })
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await wait(1000)

  // 1. one Import home, reached from Settings > Web
  await hit(page.locator('[data-settings-gear]')); await wait(500)
  if (!(await page.locator('[data-people-import]').first().isVisible())) { await hit(page.locator('summary', { hasText: 'Your web' }).first()); await wait(300) }
  await hit(page.locator('[data-people-import]').first()); await wait(500)
  ck('Import page opens', await page.locator('[data-page="import-services"]').count() === 1)
  ck('Contacts picker names vcf, csv, json and several', /vcf, csv, json\), several at once/.test(await page.locator('[data-svc-open]').innerText()))
  ck('Tana people are counted and listed on the Not yet sorted ring', await page.locator('[data-import-tana="3/3"]').count() === 1, await page.locator('[data-import-home]').innerText())
  ck('Resources file section', await page.locator('[data-import-open]').count() === 1)
  ck('Tana section', /Tana/.test(await page.locator('[data-import-home]').innerText()))
  await noHScroll('import home'); await shot('01-import-home')

  // 2. several files at once -> summary -> yes
  await page.setInputFiles('[data-svc-file]', [`${TMP}/contacts.vcf`, `${TMP}/more.vcf`]); await wait(900)
  const sum = await page.locator('[data-svc-summary]').innerText()
  ck('summary counts 31 rows from two files', /31 proposals/.test(sum), sum)
  ck('nothing written before Yes', (await record()).people.length === 4)
  await shot('02-summary')
  await hit(page.locator('[data-svc-yes]')); await wait(600)
  ck('curate page opens', await page.locator('[data-page="import-curate"]').count() === 1)
  const body = await page.locator('[data-page="import-curate"]').innerText()
  ck('no "S 0.00" and no "Same person as"', !/S 0\.00/.test(body) && !/Same person as/.test(body))
  ck('vcf rows say there is no chat history', /No chat history, the ring is a default/.test(body))
  ck('rows show e-mail and phone', await page.locator('[data-cur-contact]').first().innerText().then((t) => /@/.test(t) && /\+43/.test(t)))
  ck('tag pills on rows', await page.locator('[data-cur-pill]').count() > 5)
  ck('date-named and phone-only rows grouped (collapsed) under Unnamed numbers', await page.locator('[data-cur-unnamed="6"]').count() === 1 && await page.locator('[data-svc-row]').count() <= 25)
  ck('scroll-to-top button under the long list', await page.locator('[data-cur-scroll-top]').count() === 1)
  await page.evaluate(() => { [...document.querySelectorAll('.page-layer')].pop().scrollTop = 900 })
  await hit(page.locator('[data-cur-scroll-top]')); await wait(2000)
  const topAt = await page.evaluate(() => [...document.querySelectorAll('.page-layer')].pop().scrollTop)
  ck('scroll-to-top returns to the top', topAt < 5, String(topAt))
  const firstNames = await page.locator('[data-svc-row] b').evaluateAll((l) => l.slice(0, 3).map((x) => x.textContent))
  ck('useful rows first (no date names on top)', !firstNames.some((n) => /20\d\d/.test(n)), firstNames.join('|'))
  await noHScroll('curate'); await shot('03-curate')

  // 3. filter by tag, select all shown, bulk steps before Accept
  await page.selectOption('[data-cur-filter]', 'Minerva'); await wait(300)
  ck('filter by tag shows only Minerva rows', await page.locator('[data-svc-row]').count() === 11, String(await page.locator('[data-svc-row]').count()))
  await page.locator('[data-cur-select-all]').check(); await wait(300)
  ck('bulk panel for 11 selected', await page.locator('[data-cur-bulk-panel="11"]').count() === 1)
  await page.locator('[data-cur-tag-input="bulk"]').fill('Friends of X'); await wait(200)
  await hit(page.locator('[data-cur-tag-create]').first()); await wait(300)
  ck('tag added to all selected rows (pill on each)', await page.locator('[data-cur-pill="Friends of X"]').count() === 11)
  await page.locator('[data-cur-connected-input="bulk"]').fill('@Hugo'); await wait(200)
  await hit(page.locator('[data-cur-connect-person="have1"]').first()); await wait(300)
  await page.selectOption('[data-cur-bulk-ring]', 'friend'); await hit(page.locator('[data-cur-bulk-ring-set]')); await wait(300)
  await page.locator('[data-cur-bulk-note]').fill('met at the fair'); await hit(page.locator('[data-cur-bulk-note-add]')); await wait(300)
  await shot('04-bulk')
  await hit(page.locator('[data-cur-accept-selected]')); await wait(800)
  let rec = await record()
  const added = rec.people.filter((p) => p.id !== 'have1' && !p.id.startsWith('tana-'))
  ck('11 rows accepted: 9 new people, Hugo and the duplicate Alma merge into who is already there', added.length === 9, String(added.length))
  const alma = added.find((p) => p.name === 'Alma Brandt')
  ck('person holds the label as a tag + the system tag', alma && String(alma.fields.minerva) === 'true' && String(alma.fields['friends-of-x']) === 'true' && Object.keys(alma.fields).some((k) => k.startsWith('import:')), JSON.stringify(alma?.fields))
  ck('ring Friend and the shared note written', alma?.ring === 'friend' && alma.fields.note === 'met at the fair', JSON.stringify([alma?.ring, alma?.fields?.note]))
  const tagDefs = JSON.parse(await page.evaluate(() => localStorage.getItem('trustweb.v1.colourtags')))
  ck('selected rows are connected with the person (knows)', Array.isArray(alma?.knows) && alma.knows.includes('have1'), JSON.stringify(alma?.knows))
  ck('system tag defined but flagged system; label tags defined', tagDefs.some((t) => t.system && t.id.startsWith('import:')) && tagDefs.some((t) => t.id === 'minerva'))

  // 4. by tag -> ring, accept all as Acquaintances
  await page.selectOption('[data-cur-filter]', ''); await wait(300)
  await page.locator('[data-cur-bytag-bar] summary').click(); await page.selectOption('[data-cur-bytag]', 'Keep Contact'); await page.selectOption('[data-cur-bytag-ring]', 'friend'); await hit(page.locator('[data-cur-bytag-apply]')); await wait(300)
  ck('by tag -> ring changed rows, nothing accepted yet', (await record()).people.length === rec.people.length)

  // 5. advanced notes per row: edit name, connected with
  const row = page.locator('[data-svc-row]').first()
  const rowKey = await row.getAttribute('data-svc-row')
  await hit(row.locator('summary', { hasText: 'Notes and all fields' })); await wait(300)
  await page.locator(`[data-cur-advanced="${rowKey}"] [data-cur-field="name"]`).fill('Renamed in notes')
  await page.locator(`[data-cur-connected-input="${rowKey}"]`).fill('@Hugo'); await wait(200)
  await hit(page.locator('[data-cur-connect-person="have1"]').first()); await wait(300)
  ck('connected-with chip, name kept after redraw', await page.locator(`[data-cur-advanced="${rowKey}"] [data-cur-connected-chip="person:have1"]`).count() === 1 && await page.locator(`[data-cur-advanced="${rowKey}"] [data-cur-field="name"]`).inputValue() === 'Renamed in notes')
  ck('AI stub button present', await page.locator(`[data-cur-ai="${rowKey}"]`).count() === 1)
  await shot('05-advanced')

  // 6. dedupe view
  const dupes = page.locator('[data-cur-dupes]')
  ck('possible duplicates entry', await dupes.count() === 1)
  await hit(dupes); await wait(600)
  ck('dedupe page with pairs side by side', await page.locator('[data-cur-pair]').count() >= 1 && await page.locator('.cur-sides').first().isVisible())
  ck('dedupe never says Same person as', !/Same person as/.test(await page.locator('[data-page="import-dupes"]').innerText()))
  await noHScroll('dedupe'); await shot('06-dedupe')
  const pairs = await page.locator('[data-cur-pair]').count()
  console.log('pairs before', JSON.stringify(await page.locator('[data-cur-pair]').evaluateAll((l) => l.map((x) => x.innerText.replace(/\n/g, ' / ')))))
  await hit(page.locator('[data-cur-merge]').first()); await wait(500)
  const after = await page.locator('[data-cur-pair]').count()
  console.log('pairs after', JSON.stringify(await page.locator('[data-cur-pair]').evaluateAll((l) => l.map((x) => x.innerText.replace(/\n/g, ' / ')))))
  ck('Merge removes the pair', after < pairs, `${pairs} -> ${after}`)
  if (after) { await hit(page.locator('[data-cur-keep-both]').first()); await wait(400) }
  await hit(page.locator('[data-page-back]').last()); await wait(400)

  // 7. accept all as Acquaintances, scroll-to-top
  const accept = page.locator('[data-svc-bulk]')
  ck('Accept all as Acquaintances offered', await accept.count() === 1 && !(await accept.isDisabled()))
  await hit(accept); await wait(800)
  rec = await record()
  ck('unnamed numbers stay unaccepted', !rec.people.some((p) => /^Mar 15|^Feb 16|^Dec 16/.test(p.name)))
  await hit(page.locator('[data-cur-unnamed-toggle]')); await wait(300)
  ck('Unnamed numbers group opens with the 6 rows', await page.locator('[data-svc-row]').count() === 6, String(await page.locator('[data-svc-row]').count()))
  await page.locator('[data-cur-select-all]').check(); await wait(200)
  await shot('07-unnamed')
  await hit(page.locator('[data-page-back]').last()); await wait(500)

  // 8. success box inside the Import page + earlier imports + undo with edits kept
  ck('result dialog inside the Import page', /ready to review/.test(await page.locator('[data-import-done]').innerText()))
  await page.setInputFiles('[data-import-file]', `${TMP}/trustweb-inventory-import.json`); await wait(500)
  await hit(page.locator('[data-import-apply]')); await wait(500)
  ck('resources import result shows inside the Import page', /3 lines added/.test(await page.locator('[data-import-done]').innerText()))
  ck('earlier imports list: contacts + resources, Undo each', await page.locator('[data-svc-undo]').count() === 1 && await page.locator('[data-import-undo]').count() === 1)
  await page.setInputFiles('[data-svc-file]', `${TMP}/more.vcf`); await wait(700)
  await hit(page.locator('[data-svc-yes]')); await wait(500)
  await hit(page.locator('[data-page-back]').last()); await wait(400)
  ck('a second contacts import joins the list', await page.locator('[data-svc-undo]').count() === 2)
  ck('default import note', /Only focused on people/.test(await page.locator('[data-import-note]').first().inputValue()))
  await shot('08-imports-list')
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('trustweb.v1.me')); const p = s.people.find((x) => x.name === 'Alma Brandt'); p.name = 'Alma Brandt (mine)'; localStorage.setItem('trustweb.v1.me', JSON.stringify(s)) })
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await wait(800)
  await hit(page.locator('[data-settings-gear]')); await wait(500)
  if (!(await page.locator('[data-people-import]').first().isVisible())) { await hit(page.locator('summary', { hasText: 'Your web' }).first()); await wait(300) }
  await hit(page.locator('[data-people-import]').first()); await wait(500)
  ck('person edited since is highlighted in the list', await page.locator('[data-import-edited]').count() === 1 && /Alma Brandt \(mine\)/.test(await page.locator('[data-import-edited]').innerText()))
  await shot('09-edited-highlight')
  for (const id of await page.locator('[data-import-pick]').evaluateAll((l) => l.map((x) => x.dataset.importPick))) await page.locator(`[data-import-pick="${id}"]`).check()
  await wait(200)
  ck('Undo several: one button for the 3 picked imports', await page.locator('[data-import-undo-selected="3"]').count() === 1)
  await hit(page.locator('[data-import-undo-selected]')); await wait(700)
  rec = await record()
  const mine = rec.people.find((p) => p.name === 'Alma Brandt (mine)')
  ck('edited person kept, the others left the web', mine && mine.ring !== 'none' && rec.people.filter((p) => p.ring === 'none').length >= 10, JSON.stringify(rec.people.map((p) => p.ring).reduce((a, r) => ({ ...a, [r]: (a[r] ?? 0) + 1 }), {})))
  ck('the tags it wrote are gone from archived people, the person edited keeps theirs', rec.people.filter((p) => p.ring === 'none').every((p) => !Object.keys(p.fields ?? {}).some((k) => k === 'minerva' || k.startsWith('import:'))) && String(mine.fields.minerva) === 'true')
  ck('resources of that import are gone, list empty', rec.inventory.length === 0 && await page.locator('[data-import-list-none]').count() === 1)
  await shot('10-after-undo')

  // 9. system tags hidden by default; the Tools toggle
  await hit(page.locator('[data-page-back]').last()); await wait(400)
  await page.evaluate(() => { document.querySelector('[data-settings-gear]'); })
  ck('system tags are hidden by default', await page.evaluate(() => localStorage.getItem('trustweb.v1.showsystemtags')) === null)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await wait(900)
  // wave 39 review: since small-ui-a the Tools rows open in a sheet on a phone (and fold inline on desktop): open Tools when the toggle is not shown
  if (!(await page.locator('[data-show-system-tags]').count())) { await hit(page.locator('[data-zone-side-toggle]').first()); await wait(500) }
  const toggle = page.locator('[data-show-system-tags]')
  ck('Tools has the toggle "Show system tags", off', await toggle.count() === 1 && !(await toggle.isChecked()))
  await toggle.check(); await wait(300)
  ck('toggle on is remembered', await page.evaluate(() => localStorage.getItem('trustweb.v1.showsystemtags')) === '1' && await page.locator('[data-show-system-tags]').isChecked())
  ck('no page errors', errs.length === 0, errs.join(';'))
  await b.close()
}

await run('phone', { width: 360, height: 780 }, true)
await run('desktop', { width: 1280, height: 900 }, false)
console.log(failures ? `FAILURES ${failures}` : 'ALL PASS')
process.exit(failures ? 1 : 0)
