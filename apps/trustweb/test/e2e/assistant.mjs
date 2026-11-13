// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 assistant proof (headless, synthetic record, mocked providers on the page's own origin):
 *   PORT=5415 EXE=<chromium headless shell> PW=<playwright-core index.js> SHOTS=<dir> node assistant.mjs
 * Berget (mock) answers 402, pc24 (mock) answers and names its model; the heads-up with Retry; the remove-person card with Approve and Undo;
 * the layout before / during / after the pane; the gear menu and the slash commands; no control lies over another.
 */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const BASE = `http://127.0.0.1:${process.env.PORT ?? 5415}`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? `  (${extra})` : ''}`); if (!cond) failed = true }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const NOW = Date.now()
const people = [
  { id: 'p1', name: 'Bo Tester', ring: 'close', lines: [], context: '', metAt: NOW, fields: {} },
  { id: 'p2', name: 'Cy Sample', ring: 'friend', lines: [], context: '', metAt: NOW, fields: {} },
]
const record = (extra = {}) => ({ v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people, ...extra })
const advanced = { ai: { preset: 'custom', name: 'pc24', baseUrl: `${BASE}/mock-pc24/v1`, apiKey: '', model: 'qwen3.6:35b' }, assistant: { providers: { berget: { baseUrl: `${BASE}/mock-berget/v1`, apiKey: 'k-berget', model: 'berget-70b' } } } }
const block = (obj) => '```tw-actions\n' + JSON.stringify(obj) + '\n```'
const sse = (text) => (text.match(/[\s\S]{1,18}/g) ?? []).map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
const rec = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const box = (page, sel) => page.locator(sel).first().boundingBox()
const meet = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const mode = { berget: '402', pc24: 'ok' }
    const systems = []
    const asked = []
    await page.route(`${BASE}/mock-berget/v1/chat/completions`, async (r) => {
      asked.push('berget')
      if (mode.berget === 'hang') return   // never answers
      await r.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: { message: 'no credits' } }) })
    })
    await page.route(`${BASE}/mock-pc24/v1/chat/completions`, async (r) => {
      asked.push('pc24')
      const body = JSON.parse(r.request().postData() ?? '{}')
      systems.push(body.messages?.[0]?.content ?? '')
      if (mode.pc24 === '401') return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'bad key' } }) })
      const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const text = /remove/i.test(last) ? 'I take Bo Tester out of your web.\n\n' + block({ actions: [{ type: 'remove-person', args: { person: 'Bo Tester' }, why: 'you asked' }], done: false })
        : /model/i.test(last) ? `I run on pc24 with the model ${body.model}.` : 'Tell me more.'
      await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(text) })
    })
    await page.goto(BASE + '/'); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify(record({ advanced })))
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    const width = () => page.evaluate(() => Math.round((document.querySelector('.phone') ?? document.body).getBoundingClientRect().width))
    const before = await width()

    // 1. Berget (no credits) falls through to pc24; the AI names its real model; the footer names who answered.
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(600)
    check(`${name}: panel opens`, await page.locator('[data-assistant-panel]').isVisible())
    const during = await width()
    if (name === '1280') check(`${name}: the pane takes room while open (content ${before} -> ${during})`, during < before)
    check(`${name}: the footer shows the order before any answer`, /Berget > pc24/.test(await page.locator('[data-assistant-provider]').innerText()))
    await page.locator('[data-assistant-input]').fill('which model are you running?')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1500)
    const log1 = await page.locator('[data-assistant-log]').innerText()
    check(`${name}: Berget asked first, then pc24`, asked[0] === 'berget' && asked.includes('pc24'), asked.join())
    check(`${name}: the answer names the configured model`, log1.includes('qwen3.6:35b'), log1)
    check(`${name}: the system prompt carried provider and model`, systems[0].includes('"pc24"') && systems[0].includes('"qwen3.6:35b"'))
    check(`${name}: the footer says who answered`, /Answered by pc24 \(qwen3.6:35b\)/.test(await page.locator('[data-assistant-provider]').innerText()))
    await page.screenshot({ path: `${SHOTS}/assistant-${name}-1-chain.png` })

    // 2. Everything fails: the heads-up with the reasons and Retry; Retry works once a provider answers.
    mode.pc24 = '401'
    await page.locator('[data-assistant-input]').fill('hello again')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1500)
    const logFail = await page.locator('[data-assistant-log]').innerText()
    check(`${name}: heads-up when none answers`, /No AI provider answered \(Berget, pc24 all failed\)/.test(logFail), logFail.slice(-200))
    check(`${name}: ... with the reason of each`, /Berget: HTTP 402: no credits; pc24: HTTP 401: bad key/.test(logFail))
    check(`${name}: ... and a Retry button`, await page.locator('[data-assistant-retry]').isVisible())
    await page.screenshot({ path: `${SHOTS}/assistant-${name}-2-headsup.png` })
    mode.pc24 = 'ok'
    await page.locator('[data-assistant-retry]').click(); await page.waitForTimeout(1500)
    check(`${name}: Retry asks again and the answer shows; the heads-up is gone`, (await page.locator('[data-assistant-retry]').count()) === 0 && (await page.locator('[data-assistant-msg="assistant"]').last().innerText()).includes('Tell me more'))

    // 3. Remove a person: card, Approve live, Undo.
    await page.locator('[data-assistant-input]').fill('remove Bo Tester')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1200)
    check(`${name}: remove-person is proposed as a card, nothing changed yet`, (await page.locator('[data-assistant-card][data-state="proposed"]').count()) === 1 && !(await rec(page)).people.find((p) => p.id === 'p1').deleted_at)
    await page.locator('[data-assistant-watch]').check()
    check(`${name}: Apply as I watch does not apply it by itself`, (await page.locator('[data-assistant-card][data-state="proposed"]').count()) === 1)
    await page.locator('[data-assistant-watch]').uncheck()
    await page.locator('[data-assistant-approve]').first().click(); await page.waitForTimeout(500)
    let r = await rec(page)
    check(`${name}: Approve removes Bo (30-day tombstone, still in the record)`, r.people.some((p) => p.id === 'p1' && p.deleted_at && p.ring === 'none'))
    await page.screenshot({ path: `${SHOTS}/assistant-${name}-3-removed.png` })
    await page.locator('[data-assistant-undo]').first().click(); await page.waitForTimeout(500)
    r = await rec(page)
    check(`${name}: Undo brings Bo back on the close ring`, r.people.some((p) => p.id === 'p1' && !p.deleted_at && p.ring === 'close'))

    if (name === '1280') (await import('node:fs')).writeFileSync(`${SHOTS}/assistant-transcript.txt`, await page.locator('[data-assistant-log]').innerText())

    // 4. Gear menu: model picker, thinking, clear chat; it never lies over the X or the header.
    await page.locator('[data-assistant-gear]').click(); await page.waitForTimeout(300)
    check(`${name}: gear menu opens`, await page.locator('[data-assistant-gearmenu]').isVisible())
    const gm = await box(page, '[data-assistant-gearmenu]'); const xb = await box(page, '[data-assistant-close]'); const gb = await box(page, '[data-assistant-gear]')
    check(`${name}: P06 gear menu does not overlay the X or the gear`, !meet(gm, xb) && !meet(gm, gb))
    check(`${name}: P06 gear and X do not overlap`, !meet(gb, xb))
    check(`${name}: the picker lists the chain`, (await page.locator('[data-assistant-provider-row]').count()) === 3 && /not set up/.test(await page.locator('[data-assistant-provider-row="infomaniak"]').innerText()))
    await page.screenshot({ path: `${SHOTS}/assistant-${name}-4-gear.png` })
    await page.locator('[data-assistant-pick="pc24"]').click(); await page.waitForTimeout(300)
    check(`${name}: picking pc24 puts it first (saved in the record)`, (await rec(page)).advanced.assistant.prefer === 'pc24' && /Order: pc24 > Berget|Answered by/.test(await page.locator('[data-assistant-provider]').innerText()))
    await page.locator('[data-assistant-thinking]').selectOption('high'); await page.waitForTimeout(200)
    check(`${name}: the thinking level is saved`, (await rec(page)).advanced.assistant.thinking === 'high')
    asked.length = 0
    await page.locator('[data-assistant-input]').fill('which model now?'); await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1200)
    check(`${name}: with pc24 first, Berget is not asked`, asked[0] === 'pc24', asked.join())
    await page.locator('[data-assistant-clear]').click(); await page.waitForTimeout(300)
    check(`${name}: Clear chat empties the chat`, (await page.locator('[data-assistant-msg]').count()) === 0)

    // 5. Slash commands.
    await page.locator('[data-assistant-gear]').click()
    const say = async (t) => { await page.locator('[data-assistant-input]').fill(t); await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(300) }
    await say('/model berget')
    check(`${name}: /model berget puts Berget first`, (await rec(page)).advanced.assistant.prefer === 'berget')
    await say('/model my-model-1')
    check(`${name}: /model <id> sets the model of the first link`, (await rec(page)).advanced.assistant.model === 'my-model-1' && /Berget answers first now, with my-model-1/.test(await page.locator('[data-assistant-log]').innerText()))
    await say('/o')
    check(`${name}: /o without pi: one-line notice`, /pi is not connected/.test(await page.locator('[data-assistant-log]').innerText()))
    await say('/dance')
    check(`${name}: an unknown command is explained, not sent`, /Unknown command \/dance/.test(await page.locator('[data-assistant-log]').innerText()))
    await say('/clear')
    check(`${name}: /clear empties the chat`, (await page.locator('[data-assistant-msg]').count()) === 0)

    // 6. Berget that never answers: pc24 takes over inside the 20 s budget.
    await page.evaluate(() => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); delete r.advanced.assistant.prefer; delete r.advanced.assistant.model; localStorage.setItem('trustweb.v1.me', JSON.stringify(r)) })
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    mode.berget = 'hang'; asked.length = 0
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-assistant-input]').fill('which model are you running?'); await page.locator('[data-assistant-send]').click()
    const t0 = Date.now()
    await page.waitForFunction(() => document.querySelector('[data-assistant]')?.shadowRoot?.querySelector('[data-assistant-log]')?.textContent?.includes('qwen3.6:35b'), null, { timeout: 20_000 })
    check(`${name}: a silent Berget costs at most its share of 20 s, then pc24 answers (${Date.now() - t0} ms)`, Date.now() - t0 < 20_000 && asked.includes('pc24'))

    // 7. B10: closing restores the content width at once, both ways of closing.
    await page.locator('[data-assistant-close]').click(); await page.waitForTimeout(300)
    check(`${name}: after ✕ the content width is as before (${before} vs ${await width()})`, (await width()) === before)
    check(`${name}: ... and no leftover attribute`, !(await page.evaluate(() => document.documentElement.hasAttribute('data-assistant-open'))))
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(400)
    if (name === '1280') check(`${name}: opened again: room is made`, (await width()) < before)
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(300)   // the sparkle toggles it shut
    check(`${name}: after the sparkle closes it, width is as before (${await width()})`, (await width()) === before)
    await page.screenshot({ path: `${SHOTS}/assistant-${name}-5-closed.png` })
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
console.log(failed ? 'FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
