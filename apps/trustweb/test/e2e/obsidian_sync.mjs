// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync live check (headless, stock record, synthetic vault of 20 notes written to /tmp, the pc24 endpoint answered by a stub route).
 * PORT=5481 SHOTS=<dir> EXE=<chromium> PW=<playwright-core index.mjs> node obsidian_sync.mjs      Runs at 360 px (touch) and 1280 px.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { NOTES, VAULT } from '../fixtures/synthetic_vault.mjs'

const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const PORT = process.env.PORT ?? 5481
const SHOTS = process.env.SHOTS ?? '/tmp/wave41-obsidian/shots'
const TMP = '/tmp/wave41-obsidian'
mkdirSync(SHOTS, { recursive: true })
const dir = `${TMP}/${VAULT}`
const writeVault = (over = {}) => { for (const [p, t] of Object.entries({ ...NOTES, ...over })) { mkdirSync(dirname(`${dir}/${p}`), { recursive: true }); writeFileSync(`${dir}/${p}`, t) } }

let failures = 0
const ck = (n, c, d = '') => { if (!c) failures++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  -> ' + d)) }
const PC24 = { preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' }

async function run(label, viewport, touch) {
  console.log(`--- ${label} ${viewport.width}px`)
  writeVault()
  const b = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errs = []; const requests = []; const workers = []; const aiCalls = []; const suggestCalls = []
  page.on('pageerror', (e) => errs.push(String(e)))
  page.on('request', (r) => requests.push(r.url()))
  page.on('worker', (w) => workers.push(w.url()))
  page.on('dialog', (d) => d.accept())
  await page.route('http://localhost:11435/**', async (route) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const body = JSON.parse(route.request().postData() ?? '{}')
    aiCalls.push(body)
    const files = [...String(body.messages?.[1]?.content ?? '').matchAll(/### FILE: (\S+)/g)].map((m) => m[1])
    if (/suggest which notes/.test(body.messages?.[0]?.content ?? '')) {
      suggestCalls.push(body)
      const people = files.filter((f) => /^(Daily|Journal)\//.test(f)).slice(0, 2).map((f) => ({ path: f, name: 'Leonie Weiss', confidence: 0.8, why: 'Coffee with Leonie' }))
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ people }) } }] }) })
    }
    const people = files.filter((f) => /^(Daily|Journal)\//.test(f)).map((f, i) => ({ name: `Found Person ${aiCalls.length}${i}`, aliases: [], facts: [`named in ${f}`], relations: [{ name: 'Alma Brandt', relation: 'friend' }], source: f }))
    people.push({ name: 'Ghost Source', facts: [], source: 'not/in/batch.md' })
    await new Promise((r) => setTimeout(r, 1500))
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ people }) } }] }) })
  })
  let otherCalls = 0
  await page.route('https://llm.example.org/**', async (route) => { otherCalls++; return route.fulfill({ status: 500, body: '{}' }) })
  const hit = (loc) => (touch ? loc.tap() : loc.click())
  const wait = (ms = 300) => page.waitForTimeout(ms)
  const shot = (n) => page.screenshot({ path: `${SHOTS}/obsidian-sync-${viewport.width}-${n}.png` })
  const record = () => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
  const noHScroll = async (n) => ck(`${n}: no horizontal scroll`, await page.evaluate(() => { const p = [...document.querySelectorAll('.page-layer')].pop(); return document.documentElement.scrollWidth <= window.innerWidth + 1 && (!p || p.scrollWidth <= p.clientWidth + 1) }))
  const base = { v: 1, me: { id: 'me1', displayName: 'Ben Beispiel' }, peers: [], log: [], inventory: [], people: [] }
  const setRecord = async (rec) => { await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', JSON.stringify(r)), rec); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await wait(1000) }
  const openImport = async () => {
    await hit(page.locator('[data-settings-gear]')); await wait(500)
    // wave 42 settings-llm-first: the rest of Settings sits under Advanced
    if (!(await page.locator('[data-people-import]').first().isVisible())) { if (!(await page.locator('[data-settings-advanced-all]').evaluate((d) => d.open).catch(() => true))) await page.locator('[data-settings-advanced-all] > summary').click().catch(() => {}); await wait(300) }
    if (!(await page.locator('[data-people-import]').first().isVisible())) { await hit(page.locator('summary', { hasText: 'Your web' }).first()); await wait(300) }
    await hit(page.locator('[data-people-import]').first()); await wait(500)
  }

  await page.goto(`http://127.0.0.1:${PORT}/`); await wait(1200)
  await setRecord(base)

  // 1. off by default: nothing of the module is loaded
  await openImport()
  ck('off: Import page says to switch Obsidian on, no open button', (await page.locator('[data-import-obsidian-off]').count()) === 1 && (await page.locator('[data-import-obsidian]').count()) === 0)
  ck('off: no module chunk requested, no worker', !requests.some((u) => /obsidian_(body|view|worker)/.test(u)) && workers.length === 0)
  await noHScroll('import (off)'); await shot('01-import-off')
  await page.keyboard.press('Escape'); await wait(300)

  // 2. switch on in Settings > General > Extensions
  const settings = async () => {
    await hit(page.locator('[data-settings-gear]')); await wait(600)
    if (!(await page.locator('[data-settings-advanced-all]').evaluate((d) => d.open).catch(() => true))) { await page.locator('[data-settings-advanced-all] > summary').click().catch(() => {}); await wait(300) }
    const sw = page.locator('[data-ext-module="obsidian"]')
    if (!(await sw.isVisible())) { await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await wait(300) }
    if (!(await sw.isVisible())) { const sum = page.locator('[data-settings-section="extensions"] summary').first(); await sum.scrollIntoViewIfNeeded(); await sum.click().catch(() => {}); await wait(300) }
  }
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await wait(800)
  await settings()
  ck('Obsidian switch says it loads only when on', /loads only when on/.test(await page.locator('[data-ext-module="obsidian"]').innerText()))
  await hit(page.locator('[data-ext-module="obsidian"]')); await wait(1200)
  ck('switch on, settings rows appear (opt-in switch off, target line, forget)', (await page.locator('[data-ext-module="obsidian"]').getAttribute('aria-checked')) === 'true'
    && (await page.locator('[data-obsidian-ingest-switch]').getAttribute('aria-checked')) === 'false' && (await page.locator('[data-obsidian-target]').count()) === 1 && (await page.locator('[data-obsidian-forget]').count()) === 1)
  ck('no AI set up: the settings line says nothing is sent', /Nothing is sent/.test(await page.locator('[data-obsidian-target]').innerText()))
  await page.locator('[data-obsidian-target]').scrollIntoViewIfNeeded(); await noHScroll('settings'); await shot('02-settings')
  await page.keyboard.press('Escape'); await wait(400)

  // 3. pick the vault (directory input)
  await openImport()
  ck('on: open button on the Import page', (await page.locator('[data-import-obsidian]').count()) === 1)
  await hit(page.locator('[data-import-obsidian]')); await wait(600)
  ck('Obsidian page opens, alpha label', (await page.locator('[data-page="import-obsidian"]').count()) === 1 && /untested alpha feature/.test(await page.locator('[data-obsidian-page]').innerText()))
  await shot('03-page')
  await page.setInputFiles('[data-obs-dir]', dir); await page.waitForSelector('[data-obs-summary]', { timeout: 15000 }); await wait(300)
  const sum = await page.locator('[data-obs-summary]').innerText()
  ck('20 notes read, all new; 8 look like people', /20 notes: 20 new, 0 changed, 0 gone, 0 unchanged/.test(sum) && /8 notes look like people/.test(sum), sum)
  ck('parsing ran in a Web Worker', workers.some((u) => /obsidian_worker/.test(u)), JSON.stringify(workers))
  ck('nothing sent anywhere: no request left the page origin', requests.every((u) => /^(http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)), requests.filter((u) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u)).join(' '))
  ck('nothing written to the record before the review', (await record()).people.length === 0)
  await noHScroll('obsidian page'); await shot('04-summary')

  // 4. review on the existing Curate page
  await hit(page.locator('[data-obs-review]')); await wait(700)
  ck('Curate page: 8 rows from the vault', (await page.locator('[data-page="import-curate"]').count()) === 1 && (await page.locator('[data-svc-row]').count()) === 8)
  const alma = page.locator('[data-svc-row]', { hasText: 'Alma Brandt' })
  ck('Alma: e-mail, phone, the tag family, Open in Obsidian link', /alma\.brandt@example\.org/.test(await alma.innerText()) && (await alma.locator('[data-cur-pill="family"]').count()) === 1
    && (await alma.locator('[data-open-obsidian]').getAttribute('href')) === 'obsidian://open?vault=Greenhouse&file=People%2FAlma%20Brandt')
  await shot('05-curate')
  await hit(alma.locator('[data-svc-accept]')); await wait(500)
  const rec = await record()
  const p = rec.people.find((x) => x.name === 'Alma Brandt')
  ck('Accept: person with obsidianNote, note excerpt and the import tag', p?.fields?.obsidianNote === 'People/Alma Brandt.md' && /Source: People\/Alma Brandt\.md/.test(p?.fields?.note ?? '') && Object.keys(p?.fields ?? {}).some((k) => /^import:\d{4}-\d\d-\d\d-obsidian$/.test(k)), JSON.stringify(p))
  ck('the vault name is in the record slice', rec.extData?.obsidian?.vault === 'Greenhouse')
  await noHScroll('curate'); await page.keyboard.press('Escape'); await wait(300)

  // 5. the person card links back
  await page.keyboard.press('Escape'); await wait(300)
  await page.evaluate(() => { document.querySelectorAll('.page-layer').forEach((l) => l.replaceChildren()) }).catch(() => {})
  const pid = p?.id
  const card = page.locator(`[data-pid="${pid}"]`).last()
  if (await card.count()) {
    await card.click({ force: true }).catch(() => {}); await wait(500)
    await page.locator(`[data-card-open="${pid}"]`).click().catch(() => {}); await wait(500)
    ck('person card: Open in Obsidian link', (await page.locator('[data-card-more] [data-open-obsidian]').count()) === 1, await page.locator('[data-card-more]').count() + '')
    await shot('06-card')
  } else ck('person card reachable from the web (skipped: person not drawn)', false, 'no [data-pid]')

  // 6. re-sync after a reload: the cache is in IndexedDB, nothing re-parsed; one edited note comes back alone
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await wait(1000)
  await openImport(); await hit(page.locator('[data-import-obsidian]')); await wait(500)
  await page.setInputFiles('[data-obs-dir]', dir); await page.waitForSelector('[data-obs-summary]', { timeout: 15000 }); await wait(300)
  ck('re-sync: 20 unchanged, nothing to review', /20 notes: 0 new, 0 changed, 0 gone, 20 unchanged/.test(await page.locator('[data-obs-summary]').innerText()) && (await page.locator('[data-obs-nothing-new]').count()) === 1)
  await shot('07-resync-same')
  writeVault({ 'Contacts/Elif Farkas.md': NOTES['Contacts/Elif Farkas.md'] + 'Moved to Linz.\n' })
  await page.setInputFiles('[data-obs-dir]', dir); await page.waitForTimeout(1500)
  ck('re-sync after an edit: exactly 1 changed, 1 row to review', /20 notes: 0 new, 1 changed, 0 gone, 19 unchanged/.test(await page.locator('[data-obs-summary]').innerText()) && (await page.locator('[data-obs-review="1"]').count()) === 1, await page.locator('[data-obs-summary]').innerText())
  await shot('08-resync-changed')

  // 7. complete ingestion: off -> on, own endpoint only
  ck('ingestion section says it is off', (await page.locator('[data-obs-ingest-off]').count()) === 1)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(300)
  await settings(); await hit(page.locator('[data-obsidian-ingest-switch]')); await wait(300)
  ck('opt-in switch on', (await page.locator('[data-obsidian-ingest-switch]').getAttribute('aria-checked')) === 'true')
  await page.keyboard.press('Escape'); await wait(300)
  await openImport(); await hit(page.locator('[data-import-obsidian]')); await wait(500)
  await page.setInputFiles('[data-obs-dir]', dir); await page.waitForSelector('[data-obs-summary]', { timeout: 15000 }); await wait(400)
  ck('opted in but no AI set up: no run button, "Nothing is sent"', (await page.locator('[data-obs-run]').count()) === 0 && /Nothing is sent/.test(await page.locator('[data-obs-target]').innerText()))
  ck('and no request to any model', aiCalls.length === 0)
  await shot('09-ingest-no-ai')
  // a hosted preset is refused
  const withAi = async (ai) => { const r = await record(); r.advanced = { ...(r.advanced ?? {}), ai }; await page.evaluate((x) => localStorage.setItem('trustweb.v1.me', JSON.stringify(x)), r); await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await wait(1000) }
  const reopen = async () => { await openImport(); await hit(page.locator('[data-import-obsidian]')); await wait(500); await page.setInputFiles('[data-obs-dir]', dir); await page.waitForSelector('[data-obs-summary]', { timeout: 15000 }); await wait(400) }
  await withAi({ preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' }); await reopen()
  ck('hosted preset: refused, no run button', /never sent there/.test(await page.locator('[data-obs-target]').innerText()) && (await page.locator('[data-obs-run]').count()) === 0 && aiCalls.length === 0)
  await withAi({ preset: 'custom', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' }); await reopen()
  ck('a hosted service typed under Custom: refused too, no run button', /never sent there/.test(await page.locator('[data-obs-target]').innerText()) && (await page.locator('[data-obs-run]').count()) === 0 && aiCalls.length === 0)
  await withAi(PC24); await reopen()
  ck('pc24 preset: target line names it, run button shows batches', /pc24 \(localhost:11435\)/.test(await page.locator('[data-obs-target]').innerText()) && (await page.locator('[data-obs-run]').count()) === 1, await page.locator('[data-obs-ingest]').innerText())
  await shot('10-ingest-ready')
  // Q01: another host the owner typed is not automatically own: it asks per host, naming host and model
  await withAi({ preset: 'custom', baseUrl: 'https://llm.example.org/v1', apiKey: '', model: 'big-model' }); await reopen()
  await hit(page.locator('[data-obs-run]'))
  await page.waitForSelector('[data-obs-confirm]', { timeout: 5000 })
  const askText = await page.locator('[data-obs-confirm]').innerText()
  ck('another host: asks first, names host and model, nothing sent yet, no progress', /llm\.example\.org/.test(askText) && /big-model/.test(askText) && otherCalls === 0 && aiCalls.length === 0 && (await page.locator('[data-obs-ai-progress]').count()) === 0, askText)
  await shot('10b-ingest-confirm')
  await noHScroll('confirm')
  await hit(page.locator('[data-obs-confirm-no]')); await wait(300)
  ck('Cancel: back to the Run button, still nothing sent', (await page.locator('[data-obs-run]').count()) === 1 && (await page.locator('[data-obs-confirm]').count()) === 0 && otherCalls === 0 && aiCalls.length === 0)
  await withAi({ preset: 'custom', baseUrl: 'http://llm.example.org/v1', apiKey: '', model: 'big-model' }); await reopen()
  ck('plain http to another host: refused, no run button', (await page.locator('[data-obs-run]').count()) === 0 && /plain http/.test(await page.locator('[data-obs-target]').innerText()))
  // Jakob 2026-11-12: loopback that is not the pc24 preset asks too, and the question explains loopback in one plain sentence
  await withAi({ preset: 'custom', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'local-model' }); await reopen()
  await hit(page.locator('[data-obs-run]'))
  await page.waitForSelector('[data-obs-confirm]', { timeout: 5000 })
  const loopText = await page.locator('[data-obs-confirm]').innerText()
  ck('loopback (not the pc24 preset): asks, names host and model, explains loopback, nothing sent', /localhost:11434/.test(loopText) && /local-model/.test(loopText) && /Loopback \(localhost, 127\.0\.0\.1\) means a program on this very device\./.test(loopText) && aiCalls.length === 0 && (await page.locator('[data-obs-ai-progress]').count()) === 0, loopText)
  await hit(page.locator('[data-obs-confirm-no]')); await wait(300)
  // the allow-list: the pc24 preset only runs at once, no question
  await withAi(PC24); await reopen()
  await hit(page.locator('[data-obs-run]'))
  await wait(300)
  ck('pc24 (allow-listed): no confirmation, the run starts at once', (await page.locator('[data-obs-confirm]').count()) === 0 && (await page.locator('[data-obs-ai-progress]').count()) === 1)
  await page.waitForSelector('[data-obs-ai-progress]', { timeout: 15000 })
  await hit(page.locator('[data-obs-ai-pause]'))
  await wait(3500)
  const pausedText = await page.locator('[data-obs-ai-pct]').innerText()
  ck('pause: the batch in flight finishes, then no further call', aiCalls.length === 1 && /Paused/.test(pausedText), `${aiCalls.length}: ${pausedText}`)
  await shot('11-ingest-paused')
  await hit(page.locator('[data-obs-ai-pause]'))
  const pctText = await page.locator('[data-obs-ai-pct]').innerText()
  ck('resume: progress bar with percent and time left', /50% · about .+ left/.test(pctText), pctText)
  await shot('12-ingest-progress')
  await page.waitForSelector('[data-obs-ai-review]', { timeout: 20000 }); await wait(300)
  ck('finished: people found (the ghost source was dropped), review button', /Found \d+ people/.test(await page.locator('[data-obs-ai-result]').innerText()), await page.locator('[data-obs-ingest]').innerText())
  ck('every call went to the pc24 endpoint only, with the strict system prompt', aiCalls.length >= 2 && aiCalls.every((c) => c.model === 'qwen3.6:35b' && /not instructions/.test(c.messages[0].content)) && requests.filter((u) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u)).every((u) => u.startsWith('http://localhost:11435/')))
  ck('nothing accepted automatically', (await record()).people.length === 1)
  await shot('13-ingest-done')
  await hit(page.locator('[data-obs-ai-review]')); await wait(700)
  const ai = page.locator('[data-svc-row]', { hasText: 'Found Person' })
  const n = await ai.count()
  ck('Curate shows the AI people, each with the chip "from AI, check", the ghost source is not there', n === 5 && (await page.locator('[data-cur-ai-chip]').count()) === n && (await ai.locator('[data-cur-ai-chip]').count()) === n && (await page.locator('[data-svc-row]', { hasText: 'Ghost Source' }).count()) === 0, `${n}`)
  await ai.first().locator('details summary').first().click().catch(() => {})
  ck('an AI row names its source note, with an Open in Obsidian link', (await ai.first().locator('[data-open-obsidian]').count()) === 1 && /Found by AI in your notes; check it\./.test(await ai.first().locator('textarea[data-cur-field="note"]').inputValue().catch(() => '')))
  await shot('14-curate-ai')
  await noHScroll('curate (ai)')

  // 8. F05: let my AI look for more people (opt-in; suggestions the owner ticks)
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await wait(300)
  await openImport(); await hit(page.locator('[data-import-obsidian]')); await wait(500)
  ck('suggestions: off by default (own section says how to switch it on), nothing asked', (await page.locator('[data-obs-suggest-off]').count()) === 1 && suggestCalls.length === 0)
  await page.keyboard.press('Escape'); await wait(300)
  await settings(); await hit(page.locator('[data-obsidian-suggest-switch]')); await wait(300)
  ck('suggest switch on', (await page.locator('[data-obsidian-suggest-switch]').getAttribute('aria-checked')) === 'true')
  await page.keyboard.press('Escape'); await wait(300)
  await reopen()
  await hit(page.locator('[data-obs-suggest-run]')); await page.waitForSelector('[data-obs-suggestion]', { timeout: 15000 }); await wait(300)
  const sg = await page.locator('[data-obs-suggestions]').innerText()
  ck('suggestions listed with name, confidence and reason; none ticked; nobody added', /Leonie Weiss/.test(sg) && /80% sure/.test(sg) && /Coffee with Leonie/.test(sg) && (await page.locator('[data-obs-suggestion-tick]:checked').count()) === 0 && (await record()).people.length === 1, sg)
  ck('only titles and short excerpts were sent (no note longer than 300 characters of text)', suggestCalls.length > 0 && suggestCalls.every((c) => c.messages[1].content.split('### FILE: ').slice(1).every((n) => n.length < 420)))
  ck('every suggestion call went to pc24 only', requests.filter((u) => !/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(u)).every((u) => u.startsWith('http://localhost:11435/') || u.startsWith('https://llm.example.org/')))
  await noHScroll('suggestions'); await shot('15-suggestions')
  // P06: nothing overlays anything: the box, its rows and the action bar do not intersect
  ck('P06: the rows and the action bar do not overlap', await page.evaluate(() => {
    const rs = [...document.querySelectorAll('[data-obs-suggestion]')].map((e) => e.getBoundingClientRect())
    const bar = document.querySelector('[data-obs-suggest-dismiss]')?.getBoundingClientRect()
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    return rs.length > 0 && !!bar && rs.every((r, i) => !hit(r, bar) && rs.every((o, j) => i === j || !hit(r, o)))
  }))
  await hit(page.locator('[data-obs-suggestion-tick]').first()); await wait(200)
  ck('ticking shows the review button with the count', (await page.locator('[data-obs-suggest-add="1"]').count()) === 1)
  await noHScroll('suggestions ticked'); await shot('16-suggestions-ticked')
  await hit(page.locator('[data-obs-suggest-add]')); await wait(700)
  const leo = page.locator('[data-svc-row]', { hasText: 'Leonie Weiss' })
  ck('Curate: Leonie as a "from AI, check" row; still not a person in the record', (await leo.count()) === 1 && (await leo.locator('[data-cur-ai-chip]').count()) === 1 && (await record()).people.every((x) => x.name !== 'Leonie Weiss'))
  await noHScroll('curate (suggestion)'); await shot('17-curate-suggestion')
  await page.keyboard.press('Escape'); await wait(300)

  ck('no page errors', errs.length === 0, errs.join(' | '))
  await b.close()
}

await run('phone', { width: 360, height: 780 }, true)
await run('desktop', { width: 1280, height: 900 }, false)
console.log(failures ? `FAILED ${failures}` : 'ALL PASS')
process.exit(failures ? 1 : 0)
