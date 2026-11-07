// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 ai-subscription, end to end on 127.0.0.1: the app (stock vite) talks to the real release controller (sibling ops worktree)
 * with a fake SMTP sink and a fake OpenAI upstream. Sign up -> mail -> operator approves -> app shows Active -> Ask your web gets
 * the relayed answer -> quota counted; plus host/origin negatives. Nothing leaves the machine; the token is never printed.
 *   cd apps/trustweb && PLAYWRIGHT_PACKAGE=<playwright-core>/index.mjs CHROMIUM_PATH=<chrome-headless-shell> \
 *     TW_VITE_BIN=../crm/node_modules/vite/bin/vite.js TW_STOCK=1 node test/e2e/ai_subscription.mjs
 * Env: TW_OPS_DIR (controller worktree; default the sibling wave36-ai-subscription-ops), TW_SHOTS (screenshot dir; default none).
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checker, launch, newPhone, record, startPhone, startVite, waitForServer } from './swiss_harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OPS = path.resolve(process.env.TW_OPS_DIR || path.join(HERE, '../../../../../wave36-ai-subscription-ops'))
const SHOTS = process.env.TW_SHOTS
const c = checker()
const errors = []
const children = []
const ports = []
const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }) } catch { return '' } }
const portFree = (p) => sh('lsof', ['-nP', `-iTCP:${p}`, '-sTCP:LISTEN', '-t']).trim() === ''
const nextPorts = (n) => { const out = []; for (let p = 5400 + Math.floor(Math.random() * 400); out.length < n; p++) if (portFree(p) && !ports.includes(p)) { out.push(p); ports.push(p) } return out }
const jsonLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const shot = async (page, w, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `ai-subscription-e2e-${w}-${name}.png`) }) } }

const tmp = mkdtempSync('/tmp/twsub-e2e-')
const ROOT = path.join(tmp, 'root'); const STATIC = path.join(tmp, 'static')
mkdirSync(ROOT); mkdirSync(STATIC)
const smtpLog = path.join(tmp, 'smtp.jsonl'); const upLog = path.join(tmp, 'upstream.jsonl')
const [vitePort, ctlPort] = nextPorts(2)
const ctl = `http://127.0.0.1:${ctlPort}`

let vite, browser, smtp, upstream
try {
  smtp = await (await import(pathToFileURL(path.join(OPS, 'test/fakes/fake_smtp.mjs')))).start(0, smtpLog)
  upstream = await (await import(pathToFileURL(path.join(OPS, 'test/fakes/fake_upstream.mjs')))).start(0, upLog)
  ports.push(smtp.port, upstream.port)
  const opsEnv = { ...process.env, TWREL_ROOT: ROOT, TWREL_PORT: String(ctlPort), TWREL_STATIC: STATIC }
  const server = spawn(process.execPath, [path.join(OPS, 'controller/server.mjs')], {
    cwd: OPS, stdio: 'ignore',
    env: {
      ...opsEnv, TWREL_NO_POLL: '1', TW_API_EXTRA_HOSTS: '127.0.0.1',
      TW_API_EXTRA_ORIGINS: `http://localhost:${vitePort},http://127.0.0.1:${vitePort}`,
      TW_SMTP_HOST: '127.0.0.1', TW_SMTP_PORT: String(smtp.port), TW_SMTP_SECURE: 'plain', TW_SMTP_FROM: 'noreply@e2e.example',
      TW_AI_UPSTREAM: `http://127.0.0.1:${upstream.port}/v1`,
    },
  })
  children.push(server)
  await waitForServer(`${ctl}/api/subscribe/TW-NOPE00`, 15_000)

  process.env.VITE_TW_API_BASE = ctl
  process.env.TW_STOCK = '1'
  vite = await startVite(vitePort)
  browser = await launch()
  const subs = () => JSON.parse(readFileSync(path.join(ROOT, 'state/subscriptions.json'), 'utf8'))
  const rows = () => { const s = subs(); return Array.isArray(s) ? s : (s.rows ?? Object.values(s)) }

  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const first = w === 360
    const page = await newPhone(browser, errors, { viewport: { width: w, height: h } })
    await page.context().addInitScript(() => { const st = document.createElement('style'); st.textContent = '.twf-ok{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(st)) })
    await startPhone(page, vite.base, 'Ana')
    await page.evaluate(() => ['advanced', 'advanced-web', 'advanced-inventory', 'advanced-record'].forEach((k) => localStorage.setItem(`trustweb.ui.settings.${k}`, '1')))
    await page.locator('[data-settings-gear]').click()
    await page.locator('[data-settings-group="general"] > summary').click()
    await page.locator('[data-ai]').evaluate((n) => { for (let d = n.closest('details'); d && !d.open; d = d.parentElement?.closest('details')) d.open = true })
    await page.locator('[data-ai]').scrollIntoViewIfNeeded()

    // 2 settings: groups, no pc24, plan prices
    const groups = await page.locator('[data-ai-group]').evaluateAll((g) => g.map((x) => x.getAttribute('data-ai-group')))
    c.ok(`${w}: subscription group first`, groups.join() === 'sub,byok', groups.join())
    const aiText = await page.locator('[data-ai]').innerText()
    c.ok(`${w}: no pc24 anywhere in stock`, !/pc24/i.test(aiText) && (await page.locator('[data-ai-preset="pc24"]').count()) === 0)
    const plans = await page.locator('[data-ai-plan]').allInnerTexts()
    c.ok(`${w}: plans show 18 € and 5 €`, plans.length === 2 && /18 €/.test(plans[0]) && /5 €/.test(plans[1]), plans.join(' | '))
    await page.locator('[data-ai-plan="ai"]').click()
    await page.locator('[data-ai-signup]').click()
    await page.locator('[data-ai-email]').fill('e2e@example.org')
    const mailsBefore = jsonLines(smtpLog).length
    await page.locator('[data-ai-sent]').click()
    await page.locator('[data-ai-sub-state="pending"]').waitFor({ timeout: 10_000 })
    const sub = (await record(page)).advanced.ai.sub
    c.ok(`${w}: pending state shows the ref`, Boolean(sub?.ref) && (await page.locator('[data-ai-sub-state]').innerText()).includes(sub.ref), sub?.ref)
    c.ok(`${w}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    await page.locator('[data-ai]').scrollIntoViewIfNeeded()
    await shot(page, w, 'pending')

    // 3 mail + stored row
    for (let i = 0; i < 20 && jsonLines(smtpLog).length === mailsBefore; i++) await new Promise((r) => setTimeout(r, 150))
    const mails = jsonLines(smtpLog)
    const mail = mails[mailsBefore]
    c.ok(`${w}: one new mail to connect@trustweb.one`, mails.length === mailsBefore + 1 && mail?.to?.join() === 'connect@trustweb.one', `${mails.length} before ${mailsBefore} to ${JSON.stringify(mail?.to)}`)
    c.ok(`${w}: mail holds the ref and Reply-To`, Boolean(mail) && mail.data.includes(sub.ref) && /^Reply-To: .*e2e@example\.org/mi.test(mail.data))
    const row = rows().find((r) => r.ref === sub.ref)
    c.ok(`${w}: subscriptions.json holds the pending row`, row?.state === 'pending' && row.email === 'e2e@example.org')

    // 4 operator approves
    if (first) await page.locator('[data-ai-check-now]').click() // still pending
    const out = execFileSync(path.join(OPS, 'bin/tw_subscriptions.sh'), ['approve', sub.ref], { env: { ...opsEnv, TW_SUBS_LOCAL: '1' }, encoding: 'utf8' })
    c.ok(`${w}: operator approve answers ok (token redacted)`, /"ok": true/.test(out) && !out.includes('undefined'))

    // 5 Check now -> Active
    await page.locator('[data-ai-check-now]').click().catch(() => {})
    await page.locator('[data-ai-sub-state="active"]').waitFor({ timeout: 10_000 })
    const active = await page.locator('[data-ai-sub-state]').innerText()
    c.ok(`${w}: Check now shows Active with the quota`, /0 of 1500/.test(active), active)
    const ai = (await record(page)).advanced.ai
    c.ok(`${w}: endpoint switched to the subscription`, ai.preset === 'tw-subscription' && ai.baseUrl === `${ctl}/api/ai` && ai.apiKey.length > 20)
    await page.locator('[data-ai]').scrollIntoViewIfNeeded()
    await shot(page, w, 'active')

    // 5b review: the token never follows to another provider; "Use the subscription again" brings it back
    await page.locator('[data-ai-preset="openai"]').click()
    const openai = (await record(page)).advanced.ai
    c.ok(`${w}: picking OpenAI leaves no subscription token as key`, openai.preset === 'openai' && openai.apiKey === '' && openai.sub?.state === 'active', `${openai.preset} key ${openai.apiKey ? 'set' : 'empty'}`)
    await page.locator('[data-ai-use-sub]').click()
    const back = (await record(page)).advanced.ai
    c.ok(`${w}: Use the subscription again restores it`, back.preset === 'tw-subscription' && back.apiKey === ai.apiKey)

    // 6 Ask your web -> relay through the fake upstream
    await page.evaluate(() => {
      const r = JSON.parse(localStorage.getItem('trustweb.v1.me'))
      r.inventory = [...(r.inventory ?? []), { id: 'e2e-bike', text: 'cargo bike for weekends', audience: 'trusted', included: true, createdAt: Date.now() }]
      localStorage.setItem('trustweb.v1.me', JSON.stringify(r))
    })
    await page.reload(); await page.getByRole('heading', { name: 'TrustZones' }).waitFor()
    await page.locator('[data-open-query]').click()
    await page.locator('[data-ask-input]').fill('cargo bike')
    await page.locator('[data-ask-summarise]').click()
    await page.locator('[data-ask-summary]').getByText('fake answer').waitFor({ timeout: 15_000 })
    c.ok(`${w}: the summary holds "fake answer"`, /fake answer/.test(await page.locator('[data-ask-summary]').innerText()))
    c.ok(`${w}: upstream saw model qwen3.6:35b`, jsonLines(upLog).at(-1)?.model === 'qwen3.6:35b', JSON.stringify(jsonLines(upLog).at(-1)))
    const listed = JSON.parse(execFileSync(process.execPath, [path.join(OPS, 'controller/cli.mjs'), 'subs'], { env: opsEnv, encoding: 'utf8' }).replace(/^[^{]*/, ''))
    c.ok(`${w}: controller list shows used_this_month 1`, listed.rows.find((r) => r.ref === sub.ref)?.used_this_month === 1, JSON.stringify(listed.rows.find((r) => r.ref === sub.ref)))
    await page.context().close()
  }

  // 7 negatives
  const evilHost = await fetch(`${ctl}/api/subscribe/TW-AAAAAA`, { headers: { Host: 'evil.example.com' } }).catch((e) => ({ status: 'error ' + e.message }))
  c.ok('Host: evil.example.com is rejected', evilHost.status !== 200, String(evilHost.status))
  const evilOrigin = await fetch(`${ctl}/api/subscribe`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })
  c.ok('POST /api/subscribe with Origin https://evil.example -> 403', evilOrigin.status === 403, String(evilOrigin.status))
} catch (e) {
  c.ok('run without exception', false, e.stack ?? String(e))
} finally {
  await browser?.close().catch(() => {})
  vite?.stop()
  await smtp?.close().catch(() => {})
  await upstream?.close().catch(() => {})
  for (const ch of children) ch.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 800))
  const busy = ports.filter((p) => !portFree(p))
  c.ok('no listener left on the test ports', busy.length === 0, busy.join(','))
}
c.ok('no page errors', errors.length === 0, errors.join(' | '))
console.log(`${c.passes} passed, ${c.failures} failed`)
process.exit(c.failures ? 1 : 0)
