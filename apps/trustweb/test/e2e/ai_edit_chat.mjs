// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat proof (headless, synthetic record, mocked AI endpoint on the page's own origin):
 *   PORT=5481 EXE=<chromium headless shell> PW=<playwright-core index.js> SHOTS=<dir> node ai_edit_chat.mjs
 * The mock answers like an OpenAI-compatible server with a server-sent-event stream; what it answers depends on the message.
 */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const BASE = `http://127.0.0.1:${process.env.PORT ?? 5481}`
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
const row = (key, name, labels) => ({ key, name, source: 'vcf', file: 'synthetic.vcf', n365: 0, out: 0, in: 0, ids: [], sig: key, labels, emails: [`${key}@example.org`] })
const record = () => ({
  v: 1, me: { id: 'me1', displayName: 'Me' }, peers: [], log: [], inventory: [], people,
  serviceImports: [{ id: 'b1', at: NOW, counts: { vcf: 3 }, rows: [row('k1', 'Ada Lovelace', ['Minerva']), row('k2', 'Grace Hopper', ['Minerva']), row('k3', 'Alan Turing', [])], done: {} }],
})

const block = (obj) => '```tw-actions\n' + JSON.stringify(obj) + '\n```'
function answer(body) {
  const sys = body.messages?.[0]?.content ?? ''
  const last = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? ''
  if (sys.includes('remember a contact')) return 'Grace Hopper was a computer scientist and US Navy rear admiral.\nShe worked on COBOL. (Mock answer.)'
  if (sys.includes('"image"')) return '{"image":"https://pictures.example.org/grace.png","page":"https://pictures.example.org/grace"}'
  if (/curate/i.test(last)) {
    return 'I bring you to Curate, tag Ada #Board, give her the Friend ring and accept her.\n\n' + block({ actions: [
      { type: 'open', args: { place: 'curate' }, why: 'the import rows are there' },
      { type: 'row-add-tag', args: { row: 'k1', tag: 'Board' } },
      { type: 'row-set-ring', args: { row: 'k1', ring: 'friend' } },
      { type: 'accept-row', args: { row: 'k1' } },
    ], done: true })
  }
  if (/variation/i.test(last)) {
    return 'Here is a calm reader variation.\n\n' + block({ actions: [
      { type: 'create-variation', args: { name: 'Calm reader', base: 'reader', look: 'sleek', modules: { feed: false }, tokens: { '--trust': '#335577' } } },
      { type: 'set-profile', args: { profile: 'custom-calm-reader' } },
      { type: 'open', args: { place: 'variations' } },
      { type: 'delete-everything', args: {} },
    ] })
  }
  return 'Tell me more.'
}
const sse = (text) => {
  const parts = text.match(/[\s\S]{1,18}/g) ?? []
  return parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** Phone: after the assistant opened a place the sheet folds to its header; this opens the chat again. */
async function showChat(page) { if (await page.locator('[data-assistant-expand="min"]').count()) { await page.locator('[data-assistant-expand="min"]').click(); await page.waitForTimeout(200) } }
async function rec(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me'))) }

try {
  for (const [name, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    let calls = 0
    let lastSystem = ''
    await page.route(`${BASE}/mock-ai/v1/chat/completions`, async (r) => {
      calls++
      const body = JSON.parse(r.request().postData() ?? '{}')
      if (body.stream) lastSystem = body.messages?.[0]?.content ?? ''
      const text = answer(body)
      if (body.stream) await r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(text) })
      else await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: text } }] }) })
    })
    await page.route('https://pictures.example.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await page.goto(BASE + '/'); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify(record()))
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)

    // 1. No AI set up: the sparkle opens the chat, which explains and leads to the plans.
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(500)
    const panel = page.locator('[data-assistant-panel]')
    check(`${name}: sparkle opens the assistant`, await panel.isVisible())
    check(`${name}: no AI: the chat explains and links to the plans`, await page.locator('[data-assistant-plans]').isVisible())
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-1-no-ai.png` })
    await page.locator('[data-assistant-plans]').click(); await page.waitForTimeout(700)
    check(`${name}: "Choose your AI plan" opens Settings at the plans`, await page.locator('[data-ai-group="sub"]').isVisible())
    check(`${name}: the chat steps aside for the plans`, !(await panel.isVisible()))
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // 2. With a (mocked) endpoint.
    await page.evaluate((base) => { const r = JSON.parse(localStorage.getItem('trustweb.v1.me')); localStorage.setItem('trustweb.v1.me', JSON.stringify({ ...r, advanced: { ai: { preset: 'custom', name: 'mock', baseUrl: `${base}/mock-ai/v1`, apiKey: '', model: 'mock' } } })) }, BASE)
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(1200)
    await page.locator('[data-ai-button]').first().click(); await page.waitForTimeout(500)
    check(`${name}: hello line with an AI set up`, await page.locator('[data-assistant-hello]').isVisible())
    await page.locator('[data-assistant-input]').fill('On curate: tag Ada #Board, ring friend, accept her')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1200)
    check(`${name}: the endpoint was asked (streamed)`, calls >= 1)
    check(`${name}: four action cards, all waiting (Apply as I watch is off)`, (await page.locator('[data-assistant-card][data-state="proposed"]').count()) === 4, String(await page.locator('[data-assistant-card]').count()))
    check(`${name}: the reply shows its words, not the JSON block`, !(await page.locator('[data-assistant-log]').innerText()).includes('tw-actions'))
    check(`${name}: nothing changed before approval`, !(await rec(page)).people.some((p) => p.name === 'Ada Lovelace'))
    await page.locator('[data-assistant-approve="1"]').click(); await page.waitForTimeout(400)
    check(`${name}: "open" brings me to Curate`, await page.locator('[data-svc-row="k1"]').count() === 1)
    check(`${name}: the place pulses`, await page.locator('.tw-pulse').count() === 1)
    check(`${name}: phone: the sheet folds so the place shows; desktop: the pane stays`, (await page.locator('[data-assistant-expand="min"]').count()) === (name === '360' ? 1 : 0))
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-2a-brought-there.png` })
    await showChat(page)
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-2-cards.png` })
    await page.locator('[data-assistant-approve-all]').click(); await page.waitForTimeout(600)
    check(`${name}: all four applied`, (await page.locator('[data-assistant-card][data-state="applied"]').count()) === 4)
    let r = await rec(page)
    const ada = r.people.find((p) => p.name === 'Ada Lovelace')
    check(`${name}: Ada accepted with the Friend ring and #Board`, ada?.ring === 'friend' && String(ada?.fields?.board) === 'true', JSON.stringify(ada?.fields))
    check(`${name}: the Curate page underneath shows it at once (Ada's row gone)`, (await page.locator('[data-svc-row="k1"]').count()) === 0)
    check(`${name}: done: the review opens by itself`, await page.locator('[data-assistant-review]').isVisible())
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-3-review.png` })
    await page.locator('[data-assistant-review-undo="4"]').click(); await page.waitForTimeout(500)
    r = await rec(page)
    check(`${name}: Undo of the accept takes Ada out again; her row waits again`, !r.people.some((p) => p.name === 'Ada Lovelace') && !r.serviceImports[0].done.k1)
    check(`${name}: ... and her row is back on the Curate page`, (await page.locator('[data-svc-row="k1"]').count()) === 1)
    await page.locator('[data-assistant-review-close]').click()

    // 3. Apply as I watch: a variation made by talking; unknown actions are left out.
    await page.locator('[data-assistant-watch]').check()
    await page.locator('[data-assistant-input]').fill('Make me a calm reader variation')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(1500)
    check(`${name}: the variation is listed under Variations with the alpha label`, (await page.locator('[data-variation="custom-calm-reader"]').count()) === 1 && /untested alpha feature/.test(await page.locator('[data-variation="custom-calm-reader"]').innerText()))
    check(`${name}: it is the current one; its token overlay applies`, (await page.locator('[data-variation="custom-calm-reader"]').getAttribute('aria-checked')) === 'true' && (await page.evaluate(() => document.documentElement.style.getPropertyValue('--trust'))) === '#335577')
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-4-variation.png` })
    // the person's own taps go through the same registry: back to Full TrustWeb from Variations
    await page.locator('[data-variation="full"]').click(); await page.waitForTimeout(600)
    check(`${name}: leaving the variation takes its overlay and its look off`, (await page.evaluate(() => document.documentElement.style.getPropertyValue('--trust') === '' && !document.documentElement.hasAttribute('data-look'))))
    await showChat(page)
    check(`${name}: watching: the three steps applied at once`, (await page.locator('[data-assistant-card][data-state="applied"]').count()) === 3 + 3)
    check(`${name}: the unknown action is rejected, not run`, await page.locator('[data-assistant-rejected="1"]').isVisible())
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)

    // 4. The AI button on an import row: quick answer at once, the longer one after, an image only after the consent line.
    await page.locator('[data-assistant-watch]').uncheck()
    await page.locator('[data-assistant-input]').fill('Back to curate: tag Ada #Board, ring friend, accept her')
    await page.locator('[data-assistant-send]').click(); await page.waitForTimeout(900)
    check(`${name}: my own taps reach the assistant as recent steps`, lastSystem.includes('user: Variation: Full TrustWeb'))
    check(`${name}: the AI gets the waiting rows but no e-mail`, lastSystem.includes('k2: Grace Hopper') && !lastSystem.includes('@example.org'))
    const openCard = page.locator('[data-assistant-card][data-state="proposed"]').first()
    await openCard.locator('[data-assistant-approve]').click(); await page.waitForTimeout(500)
    const adv = page.locator('[data-cur-advanced="k2"] > summary')
    await adv.scrollIntoViewIfNeeded(); await adv.click(); await page.waitForTimeout(200)
    const t0 = Date.now()
    await page.locator('[data-cur-ai="k2"]').click()
    await page.locator('[data-assistant-look-quick]').last().waitFor({ timeout: 1000 })
    const quickMs = Date.now() - t0
    check(`${name}: quick answer from this device in under 1 s (${quickMs} ms)`, quickMs < 1000)
    check(`${name}: quick answer names the tag and no e-mail`, /#Minerva/.test(await page.locator('[data-assistant-look-quick]').last().innerText()) && !/k2@example\.org/.test(await page.locator('[data-assistant-look-quick]').last().innerText()))
    await page.waitForTimeout(800)
    check(`${name}: the longer answer arrives from the AI`, /computer scientist/.test(await page.locator('[data-assistant-look-longer]').last().innerText()))
    check(`${name}: "Search online" is a link (opens only on tap)`, (await page.locator('[data-assistant-search]').last().getAttribute('href'))?.includes('Grace') === true)
    check(`${name}: no image before asking`, (await page.locator('[data-assistant-image-shown]').count()) === 0)
    await page.locator('[data-assistant-image]').last().click(); await page.waitForTimeout(200)
    check(`${name}: "Find an image" shows the consent line first`, await page.locator('[data-assistant-image-consent]').isVisible())
    await page.locator('[data-assistant-image-yes]').click(); await page.waitForTimeout(800)
    check(`${name}: after Yes the picture shows`, (await page.locator('[data-assistant-image-shown]').count()) === 1)
    await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-5-lookup.png` })

    // 5. Layout.
    const box = await panel.boundingBox()
    if (name === '360') {
      check(`${name}: phone: a sheet at the bottom`, box && Math.round(box.y + box.height) === 780 && box.width === 360)
      const h0 = box.height
      await page.locator('[data-assistant-expand]').click(); await page.waitForTimeout(200)
      check(`${name}: phone: Expand makes it taller`, (await panel.boundingBox()).height > h0 + 100)
      await page.screenshot({ path: `${SHOTS}/ai-edit-chat-${name}-6-expanded.png` })
    } else {
      check(`${name}: desktop: a pane on the right`, box && box.x === 900 && box.width === 380 && box.height === 900)
      const right = await page.evaluate(() => document.querySelector('.phone').getBoundingClientRect().right)
      check(`${name}: desktop: the app makes room (right edge ${right})`, right <= 900)
    }
    check(`${name}: buttons in the panel are underlined`, (await page.locator('[data-assistant-image-yes], [data-assistant-search], [data-assistant-close], [data-assistant-send]').evaluateAll((l) => l.every((b) => getComputedStyle(b).textDecorationLine === 'underline'))))
    check(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    check(`${name}: no page errors`, errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
