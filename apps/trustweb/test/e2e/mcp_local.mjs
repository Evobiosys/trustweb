// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 mcp-local proof (headless); since wave 42 the commands carry the checkout's absolute path, so it needs a personal preview (dev server with TW_DEV_RECORD + TW_DEV_LIVE set, e.g. to /tmp copies): PORT=5460 EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node mcp_local.mjs. Synthetic record and a faked https MCP server only. */
const pw = await import(process.env.PW ?? 'playwright-core'); const chromium = (pw.default ?? pw).chromium
const URL = `http://127.0.0.1:${process.env.PORT ?? 5460}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const person = (id, name, ring, fields = {}, generalNote) => ({ id, name, ring, lines: [], context: '', metAt: Date.now(), fields, ...(generalNote ? { generalNote } : {}), channels: { email: `${id}@example.org` } })
const people = [person('p1', 'Ben Gruber', 'close', { mentor: 'true' }, 'plays chess'), person('p2', 'Cleo Maier', 'friend')]
const record = { v: 1, me: { id: 'me1', displayName: 'Ana' }, peers: [], log: [], inventory: [], people }
const hide = '.twf, .twf-ok, .twp { display: none !important }'
const SERVER = 'https://mcp.sumbios.test/mcp'
const tools = [
  { name: 'list_contacts', description: 'List contacts', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_contact', description: 'Add a contact', inputSchema: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' }, tags: { type: 'array' }, email: { type: 'string' } }, required: ['name'] } },
]

try {
  for (const [vw, vp] of [['360', { width: 360, height: 780 }], ['1280', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage()
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)))
    const calls = []
    await page.route(SERVER, async (r) => {
      const req = r.request()
      if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      const msg = JSON.parse(req.postData() ?? '{}'); calls.push({ msg, auth: req.headers().authorization })
      const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'mcp-session-id' }
      if (msg.id === undefined) return r.fulfill({ status: 202, headers: cors, body: '' })
      const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 's', version: '1' } }
        : msg.method === 'tools/list' ? { tools }
          : msg.params.name === 'list_contacts' ? { content: [{ type: 'text', text: JSON.stringify([{ id: 'x1', name: 'Dora Imported', email: 'dora@example.org' }, { name: 'Emil Imported' }]) }] }
            : { content: [{ type: 'text', text: '{"ok":true}' }] }
      return r.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) })
    })
    await page.goto(URL); await page.waitForTimeout(1200)
    await page.evaluate((r) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.ui.webView', 'rings') }, JSON.stringify(record))
    await page.reload(); await page.addStyleTag({ content: hide }); await page.waitForTimeout(900)

    await page.locator('[data-settings-gear]').click(); await page.waitForTimeout(600)
    await page.locator('[data-settings-advanced-all] > summary').click(); await page.waitForTimeout(400)   // wave 42: Advanced holds the groups
    await page.locator('[data-settings-group="general"] > summary').click().catch(() => {}); await page.waitForTimeout(300)
    const ext = page.locator('[data-settings-section="extensions"]')
    await ext.locator('summary').first().scrollIntoViewIfNeeded(); await ext.locator('summary').first().click(); await page.waitForTimeout(300)
    check(`${vw}: MCP & agents is off by default, no module chunk loaded`, (await page.locator('[data-mcp-settings]').count()) === 0
      && !(await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /mcp_body/.test(e.name)))))
    await page.locator('[data-ext-module="mcp-local"]').click(); await page.waitForTimeout(1200)
    const box = page.locator('[data-mcp-settings]')
    check(`${vw}: switched on: the section shows, with the alpha subscript`, (await box.count()) === 1 && /untested alpha feature/.test(await box.innerText()))
    check(`${vw}: pi, Claude Code and Mistral are listed; OpenAI, Gemini and Grok sit under Others`,
      (await page.locator('[data-mcp-client]').evaluateAll((n) => n.map((x) => x.dataset.mcpClient))).join() === 'pi,claude-code,mistral,openai,gemini,grok'
      && await page.evaluate(() => { const o = document.querySelector('[data-mcp-others]'); return ['openai', 'gemini', 'grok'].every((id) => !!(o.compareDocumentPosition(document.querySelector(`[data-mcp-client="${id}"]`)) & Node.DOCUMENT_POSITION_FOLLOWING)) && !(o.compareDocumentPosition(document.querySelector('[data-mcp-client="mistral"]')) & Node.DOCUMENT_POSITION_FOLLOWING) }))
    const cc = () => page.locator('[data-mcp-snippet="claude-code"]').innerText()
    check(`${vw}: read-only snippet has no write switch`, /^claude mcp add trustweb( -e TW_RECORD=\S+)? -- node --disable-warning=\S+ \/\S+\/apps\/mcp\/src\/server\.ts$/.test(await cc()) && !(await cc()).includes('TW_MCP_WRITE'))
    await page.locator('[data-mcp-write]').click(); await page.waitForTimeout(200)
    check(`${vw}: Allow writes puts TW_MCP_WRITE=1 into the snippet`, / -e TW_MCP_WRITE=1 /.test(await cc()))
    await page.locator('[data-mcp-tool-row="search"] input').uncheck(); await page.waitForTimeout(200)
    { const t = await cc(); check(`${vw}: unticking a tool narrows TW_MCP_TOOLS`, /TW_MCP_TOOLS=list_people,get_person,list_tags,list_notes,/.test(t) && !/TW_MCP_TOOLS=\S*\bsearch\b/.test(t) && /\badd_note\b/.test(t)) }
    await page.locator('[data-mcp-client="grok"] summary').click()
    check(`${vw}: no horizontal scrolling with a snippet open`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.locator('[data-mcp-write]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/mcp-local-${vw}-1-settings.png` })

    // external servers: Sumbios preset, empty address
    const sum = page.locator('[data-mcp-server="sumbios"]')
    await sum.scrollIntoViewIfNeeded()
    check(`${vw}: Sumbios preset with an empty address that says what to enter`, (await page.locator('[data-mcp-url="sumbios"]').inputValue()) === '' && /Sumbios gives you/.test((await page.locator('[data-mcp-url="sumbios"]').getAttribute('placeholder')) ?? ''))
    await page.locator('[data-mcp-url="sumbios"]').fill('http://evil.example.org/mcp'); await page.locator('[data-mcp-save="sumbios"]').click(); await page.waitForTimeout(200)
    check(`${vw}: a plain http address is refused`, /must start with https/.test(await page.locator('[data-mcp-status="sumbios"]').innerText()))
    await page.locator('[data-mcp-url="sumbios"]').fill(SERVER); await page.locator('[data-mcp-token="sumbios"]').fill('secret-token'); await page.locator('[data-mcp-save="sumbios"]').click(); await page.waitForTimeout(400)
    await page.locator('[data-mcp-connect="sumbios"]').click(); await page.waitForTimeout(800)
    check(`${vw}: connect sends the key and lists the tools`, calls.length >= 3 && calls[0].auth === 'Bearer secret-token' && (await page.locator('[data-mcp-tool="in"] option').allInnerTexts()).join() === 'list_contacts' && (await page.locator('[data-mcp-tool="out"] option').allInnerTexts()).join() === 'add_contact')
    await sum.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/mcp-local-${vw}-2-servers.png` })

    // out: nobody is sent without a tick; only name, note, tags leave
    await page.locator('[data-mcp-find="sumbios"]').fill('ben'); await page.waitForTimeout(200)
    check(`${vw}: the person list starts unticked and the send button hidden`, (await page.locator('[data-mcp-person="p1"]').isChecked()) === false && !(await page.locator('[data-mcp-send="sumbios"]').isVisible()))
    await page.locator('[data-mcp-person="p1"]').check(); await page.waitForTimeout(100)
    const before = calls.length
    await page.locator('[data-mcp-send="sumbios"]').click(); await page.waitForTimeout(700)
    const sent = calls.slice(before).filter((c) => c.msg.method === 'tools/call')
    check(`${vw}: only the ticked person went out, with name, note and tags and nothing else`, sent.length === 1 && JSON.stringify(sent[0].msg.params.arguments) === JSON.stringify({ name: 'Ben Gruber', note: 'plays chess', tags: ['mentor'] }))
    check(`${vw}: the result is told`, /1 sent/.test(await page.locator('[data-mcp-status="sumbios"]').innerText()))

    // in: people go to Curate, none into the record yet
    await page.locator('[data-mcp-read="sumbios"]').click(); await page.waitForTimeout(1200)
    check(`${vw}: Read people opens the import summary with the two people`, (await page.locator('[data-import-services]').count()) >= 1 && /MCP server 2/.test(await page.locator('[data-import-services]').first().innerText()))
    await page.screenshot({ path: `${SHOTS}/mcp-local-${vw}-3-import.png` })
    const names = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me') ?? '{}').people?.map((p) => p.name) ?? [])
    check(`${vw}: nothing entered the record before accepting`, !names.includes('Dora Imported'))
    check(`${vw}: no page errors`, errors.length === 0)
    if (errors.length) console.log(errors.join('\n'))
    await ctx.close()
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
