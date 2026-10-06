// Headless check of a built TrustWeb site (real Chromium, desktop 1280 and phone 390).
//
//   PLAYWRIGHT_PACKAGE=/Users/personal/Documents/SingularStructure/code/other/signal-orbit/node_modules/playwright-core/index.js \
//   node scripts/tw-front-door/verify_site.mjs <built-dir> <screens-dir> <draft|prod> [<live-base-url>]
//
// With a live base URL (e.g. https://idea2.site/trustweb/draft/) the same checks run against the
// deployed pages (<built-dir> then only supplies the page list). Otherwise it serves <built-dir> itself on 127.0.0.1:8981 (loopback only, closed at the end),
// so no server is left behind. Structure is checked by DOM queries, never with a
// Python HTML parser (see build_tw_front_door.sh). Exit code 1 if any check fails.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const [dir, shots, mode, liveBase] = process.argv.slice(2)
if (!dir || !shots || !['draft', 'prod'].includes(mode)) {
  console.error('usage: verify_site.mjs <built-dir> <screens-dir> <draft|prod>')
  process.exit(2)
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE)
const PORT = 8981
const BASE = liveBase ?? `http://127.0.0.1:${PORT}/`
const WIDTHS = [1280, 390]
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

function serve() {
  const types = { '.html': 'text/html; charset=utf-8' }
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, BASE).pathname)
    const file = path.join(dir, p === '/' ? 'index.html' : p)
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
    res.end(fs.readFileSync(file))
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

const pageNames = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).sort()

// ---- in-page measurements (run inside the browser) ----
const measure = () => {
  const vw = window.innerWidth
  const skip = (el) => el.closest('.skip, .hp, .knot-field, [aria-hidden="true"] svg') !== null
  const wide = []
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') continue
    if (el.closest('.pop') && !el.closest('.term:hover, .term:focus-within')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (r.right > vw + 1 || r.left < -1) wide.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60))
  }
  const clipped = []
  for (const el of document.querySelectorAll('body *')) {
    if (skip(el)) continue
    const o = getComputedStyle(el)
    if (['hidden', 'auto', 'scroll'].includes(o.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      clipped.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 60))
    }
  }
  return {
    docOverflow: document.documentElement.scrollWidth > vw,
    wide: [...new Set(wide)].slice(0, 6),
    clipped: [...new Set(clipped)].slice(0, 6),
  }
}

const chrome = () => {
  const vw = window.innerWidth
  const demo = document.querySelector('.sitebar .tw-btn-demo')
  const install = document.querySelector('.sitebar .tw-btn-install')
  if (!demo || !install) return { ok: false, why: 'buttons missing' }
  const d = demo.getBoundingClientRect(), i = install.getBoundingClientRect()
  const inView = (r) => r.left >= 0 && r.right <= vw && r.width > 30
  const cols = [...document.querySelectorAll('.sitefooter .sf-h')].map((h) => h.textContent.trim())
  const tops = [...document.querySelectorAll('.sitefooter .sf-col, .sitefooter .sf-brand')].map((c) => Math.round(c.getBoundingClientRect().top))
  const perRow = tops.filter((t) => t === tops[0]).length
  const brand = document.querySelector('.sitefooter .sf-brandlink')
  return {
    ok: true,
    demoHref: demo.getAttribute('href'), installHref: install.getAttribute('href'),
    order: d.right <= i.left, installRightmost: i.right >= d.right && i.right <= vw && vw - i.right < 40,
    visible: inView(d) && inView(i),
    cols, perRow,
    brandHref: brand?.getAttribute('href'), brandText: brand?.textContent.trim(),
    terms: !!document.querySelector('.sitefooter a[href="terms.html"]'),
    strip: !!document.querySelector('.draftstrip'),
    divInPOrSpan: document.querySelectorAll('p div, span div, p section').length,
    popsOutside: [...document.querySelectorAll('.pop')].filter((p) => !p.parentElement?.classList.contains('term')).length,
    robots: document.querySelector('meta[name=robots]')?.content ?? null,
    canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
  }
}

const popups = () => {
  const vw = window.innerWidth
  const bad = []
  for (const t of document.querySelectorAll('.term')) {
    t.focus()
    const p = t.querySelector('.pop')
    const r = p.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) bad.push(t.querySelector('.trigger')?.textContent)
    t.blur()
  }
  return { count: document.querySelectorAll('.term').length, bad }
}

async function checkPage(browser, name, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()) })
  await page.goto(BASE + (name === 'index.html' ? '' : name), { waitUntil: 'load' })
  const tag = `${name} @${width}`
  const m = await page.evaluate(measure)
  check(`${tag}: no horizontal overflow (document)`, !m.docOverflow)
  check(`${tag}: no element past the viewport`, m.wide.length === 0, m.wide.join(', '))
  check(`${tag}: nothing clipped inside overflow boxes`, m.clipped.length === 0, m.clipped.join(', '))
  const c = await page.evaluate(chrome)
  check(`${tag}: header has [Demo] then [Install], both in view, Install rightmost`, c.ok && c.order && c.visible && c.installRightmost, JSON.stringify(c).slice(0, 160))
  check(`${tag}: Demo/Install links`, c.demoHref === 'https://app.idea2.site/trustweb/demo/' && c.installHref === 'https://app.idea2.site/trustweb/?install=1')
  check(`${tag}: footer columns Features|Resources|Use cases|Legal`, c.cols.join('|') === 'Features|Resources|Use cases|Legal', c.cols.join('|'))
  check(`${tag}: footer wraps (${width < 600 ? '2' : '5'} per row)`, width < 600 ? c.perRow === 2 : c.perRow === 5, `perRow=${c.perRow}`)
  check(`${tag}: brand slot links to evobiosys.org`, c.brandHref === 'https://evobiosys.org' && c.brandText.startsWith('TrustWeb, by EvoBioSys'))
  check(`${tag}: no div in p/span, no stray pop`, c.divInPOrSpan === 0 && c.popsOutside === 0)
  check(`${tag}: terms link only in draft`, c.terms === (mode === 'draft'))
  check(`${tag}: draft strip only in draft`, c.strip === (mode === 'draft'))
  if (mode === 'draft') check(`${tag}: draft is noindex`, /noindex/.test(c.robots ?? ''))
  if (name === 'index.html' && mode === 'prod') check(`${tag}: canonical is /trustweb/`, c.canonical === 'https://idea2.site/trustweb/', String(c.canonical))
  if (name === 'index.html') {
    const p = await page.evaluate(popups)
    check(`${tag}: ${p.count} term popups stay inside the viewport`, p.count >= 11 && p.bad.length === 0, p.bad.join(', '))
    await page.evaluate(() => { document.querySelector('.term')?.focus() })
    const open = await page.evaluate(measure)
    check(`${tag}: no overflow with a popup open`, !open.docOverflow && open.wide.length === 0, open.wide.join(', '))
  }
  check(`${tag}: zero console errors`, errors.length === 0, errors.join(' | ').slice(0, 200))
  fs.mkdirSync(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, `${liveBase ? 'live-' : ''}${mode}_${name.replace('.html', '')}_${width}.png`), fullPage: true })
  await ctx.close()
}

async function linkAudit(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const hrefs = new Map()
  for (const name of pageNames) {
    await page.goto(BASE + (name === 'index.html' ? '' : name))
    const found = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))
    for (const h of found) hrefs.set(h, name)
    for (const h of found.filter((x) => x.includes('#') && !/^https?:/.test(x))) {
      const [file, id] = h.split('#')
      const target = file === '' || file === './' ? 'index.html' : file
      if (!id) continue
      await page.goto(BASE + (target === 'index.html' ? '' : target))
      const exists = await page.evaluate((i) => !!document.getElementById(i), id)
      check(`anchor ${h} (from ${name}) exists`, exists)
    }
  }
  await ctx.close()
  const external = [], internal = []
  for (const [h, from] of hrefs) {
    if (h.startsWith('mailto:') || h.startsWith('#')) continue
    if (/^https?:/.test(h)) external.push([h, from]); else internal.push([h.split('#')[0].split('?')[0] || './', from])
  }
  for (const [h] of new Map(internal)) {
    const res = await fetch(BASE + (h === './' ? '' : h))
    check(`internal link ${h} resolves`, res.status === 200, String(res.status))
  }
  const LATER = [/\?install=1$/, /\/feedback$/]
  const skipped = []
  for (const [h, from] of new Map(external)) {
    if (LATER.some((re) => re.test(h))) { skipped.push(h); continue }
    let status = 'ERR'
    try {
      let r = await fetch(h, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(20000) })
      if (r.status >= 400) r = await fetch(h, { redirect: 'follow', signal: AbortSignal.timeout(20000) })
      status = r.status
    } catch { /* leave ERR */ }
    check(`external link ${h} resolves`, status === 200 || (/linkedin\.com/.test(h) && status === 999), String(status))
  }
  console.log('NOT CHECKED (go live later):', skipped.join(', '))
}

async function formChecks(browser) {
  // feedback form: success, rate limit, failure keeps text, honeypot travels, query prefill
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  let posted = null, mode204 = true, status = 204
  await page.route('https://app.idea2.site/feedback', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST, OPTIONS' } })
    posted = { method: req.method(), type: req.headers()['content-type'], body: JSON.parse(req.postData() ?? '{}') }
    if (!mode204) return route.abort('failed')
    return route.fulfill({ status, headers: { 'access-control-allow-origin': '*' } })
  })
  await page.goto(BASE + 'feedback.html?kind=pricing')
  check('feedback: ?kind=pricing preselects the kind', (await page.inputValue('#fb-kind')) === 'pricing')
  await page.fill('#fb-text', 'Ten hours seems fair.')
  await page.fill('#fb-contact', 'me@example.org')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.startsWith('Thank you'))
  check('feedback: success posts JSON with text, kind, page, contact and an empty honeypot',
    posted && posted.method === 'POST' && /json/.test(posted.type) && posted.body.text === 'Ten hours seems fair.' &&
    posted.body.kind === 'pricing' && posted.body.contact === 'me@example.org' && posted.body.homepage === '' && /feedback\.html$/.test(posted.body.page), JSON.stringify(posted?.body))
  check('feedback: text cleared after success', (await page.inputValue('#fb-text')) === '')
  status = 429
  await page.fill('#fb-text', 'again')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.includes('several messages'))
  check('feedback: 429 keeps the text and says so', (await page.inputValue('#fb-text')) === 'again')
  mode204 = false
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.startsWith('Could not send right now'))
  check('feedback: network failure says "could not send right now" and keeps the text', (await page.inputValue('#fb-text')) === 'again')
  check('feedback: send button usable again', !(await page.$eval('#fb-send', (b) => b.disabled)))
  await page.fill('#fb-text', '')
  await page.click('#fb-send')
  check('feedback: empty message is refused locally', (await page.textContent('#fb-msg')).includes('write a message'))
  const hp = await page.$eval('#fb-homepage', (e) => ({ left: e.closest('.hp').getBoundingClientRect().left, tab: e.tabIndex }))
  check('feedback: honeypot is off-screen and not tabbable', hp.left < -1000 && hp.tab === -1)
  await page.goto(BASE + 'feedback.html?topic=source-code')
  check('feedback: ?topic=source-code prefills a request to read the code', (await page.inputValue('#fb-text')).includes('source code'))
  await ctx.close()

  // join form on the index page keeps working (waitlist + newsletter)
  const ctx2 = await browser.newContext()
  const p2 = await ctx2.newPage()
  const calls = []
  for (const url of ['https://idea2.site/rebiosys/api/waitlist', 'https://subscriber.questhub.eco/subscribe']) {
    await p2.route(url, (route) => { calls.push({ url, body: JSON.parse(route.request().postData() ?? '{}') }); return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }) })
  }
  await p2.goto(BASE)
  await p2.fill('#j-email', 'someone@example.org')
  await p2.check('#j-newsletter')
  await p2.click('#j-submit')
  await p2.waitForFunction(() => document.querySelector('#j-nl-status').textContent.includes('Check your inbox'))
  const wl = calls.find((c) => c.url.includes('waitlist')), nl = calls.find((c) => c.url.includes('subscribe'))
  check('join form: waitlist POST keeps its payload', wl?.body.email === 'someone@example.org' && wl.body.note === 'web-of-trust:join' && wl.body.channel === 'human')
  check('join form: newsletter POST keeps its payload', nl?.body.email === 'someone@example.org' && nl.body.project === 'questhub' && nl.body.source === 'trustweb' && nl.body.gdpr === true)
  await ctx2.close()
}

async function contentChecks(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(BASE)
  const ids = await page.evaluate(() => ['source-code', 'features', 'use-cases', 'team', 'ea-groups', 'useful',
    'f-web', 'f-record', 'f-notes', 'f-inventory', 'f-ask', 'f-consent', 'f-demo', 'f-backup', 'f-send',
    'uc-events', 'uc-introductions', 'uc-marketplace', 'uc-questhub', 'uc-resources', 'uc-curations'].filter((i) => !document.getElementById(i)))
  check('index: every anchor the footer and use-case cards need exists', ids.length === 0, ids.join(', '))
  const text = await page.evaluate(() => document.body.innerText)
  check('index: Source code statement (will be published as part of EvoBioSys, public copy older)', /published as part of EvoBioSys/.test(text) && /older than the live app/.test(text))
  check('index: Marketplace says coming soon and 1 %', /Coming soon/i.test(text) && /1 %/.test(text))
  check('index: join form still at the bottom', await page.evaluate(() => !!document.querySelector('#join #join-form')))
  for (const name of pageNames) {
    await page.goto(BASE + (name === 'index.html' ? '' : name))
    const t = await page.evaluate(() => document.documentElement.outerHTML)
    check(`${name}: no "github"`, !/github/i.test(t))
    check(`${name}: no em dash (char or entity)`, !/—|&mdash;|&#8212;|&#x2014;/i.test(t))
  }
  await ctx.close()
}

const server = liveBase ? null : await serve()
const browser = await chromium.launch({ headless: true })
try {
  for (const name of pageNames) for (const w of WIDTHS) await checkPage(browser, name, w)
  await contentChecks(browser)
  await formChecks(browser)
  await linkAudit(browser)
} finally {
  await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
