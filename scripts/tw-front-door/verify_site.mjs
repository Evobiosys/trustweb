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
      // "#x" points into the page it is on; "./#x" into the front page
      const target = file === '' ? name : file === './' ? 'index.html' : file
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
  // every endpoint the page can reach is mocked: a live-draft run must never really sign anyone up
  const side = []
  let sideOk = true
  for (const url of ['https://idea2.site/rebiosys/api/waitlist', 'https://subscriber.questhub.eco/subscribe']) {
    await page.route(url, (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST, OPTIONS' } })
      side.push({ url, body: JSON.parse(req.postData() ?? '{}') })
      return sideOk ? route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }) : route.fulfill({ status: 500, headers: { 'access-control-allow-origin': '*' }, body: '{}' })
    })
  }
  const WL = 'https://idea2.site/rebiosys/api/waitlist', SUB = 'https://subscriber.questhub.eco/subscribe'
  await page.goto(BASE + 'feedback.html?kind=pricing')
  check('feedback: ?kind=pricing preselects the kind', (await page.inputValue('#fb-kind')) === 'pricing')
  check('feedback: both boxes (notify, newsletter) are UNTICKED on load, with an info button',
    !(await page.isChecked('#fb-notify')) && !(await page.isChecked('#fb-news')) && (await page.locator('#fb-info-btn').count()) === 1)
  check('feedback: info text hidden until the info button is pressed', await page.$eval('#fb-info', (e) => e.hidden))
  await page.click('#fb-info-btn')
  check('feedback: info button opens the note (pre-ticking is not valid consent)', !(await page.$eval('#fb-info', (e) => e.hidden)) && /does not count/.test(await page.textContent('#fb-info')) && (await page.getAttribute('#fb-info-btn', 'aria-expanded')) === 'true')
  await page.fill('#fb-text', 'Ten hours seems fair.')
  await page.fill('#fb-contact', 'me@example.org')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.startsWith('Thank you'))
  check('feedback: success posts JSON with text, kind, page, contact and an empty honeypot',
    posted && posted.method === 'POST' && /json/.test(posted.type) && posted.body.text === 'Ten hours seems fair.' &&
    posted.body.kind === 'pricing' && posted.body.contact === 'me@example.org' && posted.body.homepage === '' && /feedback\.html$/.test(posted.body.page), JSON.stringify(posted?.body))
  check('feedback: text cleared after success', (await page.inputValue('#fb-text')) === '')
  check('feedback: with an email typed but no box ticked, NOTHING goes to the waitlist or the newsletter', side.length === 0, JSON.stringify(side))
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

  // ---- the two boxes ----
  await page.goto(BASE + 'feedback.html')
  mode204 = true; status = 204; side.length = 0; posted = null
  await page.check('#fb-news')
  await page.fill('#fb-contact', 'not-an-email')
  await page.click('#fb-send')
  check('boxes: a bad email is refused locally, no request leaves', (await page.textContent('#fb-msg')).includes('real email address') && side.length === 0 && posted === null)
  await page.fill('#fb-contact', 'someone@gmial.com')
  await page.click('#fb-send')
  check('boxes: a typo domain gets a "did you mean" hint first, nothing sent yet', (await page.textContent('#fb-email-msg')).includes('gmail.com') && side.length === 0)
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.includes('confirmation email'))
  check('boxes: newsletter only (no message needed) posts exactly the join form request, no feedback post',
    side.length === 1 && side[0].url === SUB && JSON.stringify(side[0].body) === JSON.stringify({ email: 'someone@gmial.com', project: 'questhub', source: 'trustweb', gdpr: true }) && posted === null, JSON.stringify(side))
  check('boxes: the newsletter answer mentions the confirmation email (real-address check)', (await page.textContent('#fb-msg')).includes('click the link'))
  await page.click('#fb-send')
  check('boxes: pressing Send again for the same address never subscribes twice', side.length === 1 && (await page.textContent('#fb-msg')).includes('nothing more to send'))

  // notify + newsletter + feedback together
  await page.goto(BASE + 'feedback.html')
  side.length = 0; posted = null
  await page.fill('#fb-text', 'Looks promising.')
  await page.fill('#fb-contact', 'person@example.org')
  await page.check('#fb-notify'); await page.check('#fb-news')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.includes('confirmation email'))
  const wlCall = side.find((c) => c.url === WL), subCall = side.find((c) => c.url === SUB)
  check('boxes: notify posts {email, note, channel} to the waitlist; newsletter the join-form payload; feedback its own post',
    JSON.stringify(wlCall?.body) === JSON.stringify({ email: 'person@example.org', note: 'trustweb:notify-ready', channel: 'human' }) &&
    JSON.stringify(subCall?.body) === JSON.stringify({ email: 'person@example.org', project: 'questhub', source: 'trustweb', gdpr: true }) &&
    posted?.body.text === 'Looks promising.' && posted.body.contact === 'person@example.org', JSON.stringify(side))

  // a failed feedback post keeps the text and a retry does not sign up twice
  await page.goto(BASE + 'feedback.html')
  side.length = 0; mode204 = false
  await page.fill('#fb-text', 'Keep me.')
  await page.fill('#fb-contact', 'again@example.org')
  await page.check('#fb-news')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.includes('Could not send right now'))
  mode204 = true
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.startsWith('Thank you'))
  check('boxes: failed feedback keeps the text; the retry sends it and subscribes the address only once',
    side.filter((c) => c.url === SUB).length === 1 && (await page.inputValue('#fb-text')) === '')

  // a failing newsletter service is reported on its own
  await page.goto(BASE + 'feedback.html')
  side.length = 0; sideOk = false
  await page.fill('#fb-contact', 'down@example.org')
  await page.check('#fb-notify')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.includes('notification list'))
  check('boxes: a failing waitlist says so and is not reported as done', (await page.$eval('#fb-msg', (e) => e.className)).includes('err'))
  sideOk = true

  // a filled honeypot sends no side request
  await page.goto(BASE + 'feedback.html')
  side.length = 0; posted = null
  await page.evaluate(() => { document.getElementById('fb-homepage').value = 'bot' })
  await page.fill('#fb-text', 'spam')
  await page.fill('#fb-contact', 'bot@example.org')
  await page.check('#fb-notify'); await page.check('#fb-news')
  await page.click('#fb-send')
  await page.waitForFunction(() => document.querySelector('#fb-msg').textContent.startsWith('Thank you'))
  check('boxes: a filled honeypot sends no waitlist or newsletter request', side.length === 0)
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
    'f-web', 'f-record', 'f-notes', 'f-inventory', 'f-ask', 'f-consent', 'f-demo', 'f-backup', 'f-connect', 'f-send',
    'uc-events', 'uc-introductions', 'uc-marketplace', 'uc-housing', 'uc-questhub', 'uc-resources', 'uc-curations'].filter((i) => !document.getElementById(i)))
  check('index: every anchor the footer and use-case cards need exists', ids.length === 0, ids.join(', '))
  const text = await page.evaluate(() => document.body.innerText)
  check('index: Source code statement (will be published as part of EvoBioSys, public copy older)', /published as part of EvoBioSys/.test(text) && /older than the live app/.test(text))
  check('index: Marketplace says coming soon and 1 %', /Coming soon/i.test(text) && /1 %/.test(text))
  check('index: join form still at the bottom', await page.evaluate(() => !!document.querySelector('#join #join-form')))
  // wave 2 (B10): the first line under the name leads with finding people and things through people you trust
  const lead = await page.evaluate(() => {
    const l = document.querySelector('.hero .herolead'), ex = document.querySelector('.hero .heroex')
    return { text: l?.textContent.trim(), before: !!(l && ex && (l.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING)) }
  })
  check('index: first line leads with "Find people and things through people you trust"', lead.text === 'Find people and things through people you trust.' && lead.before, String(lead.text))
  // wave 2 (P29, P32): contact methods
  check('index: contact methods (QR code and link now, moving QR code soon, NFC/Bluetooth/AirDrop later)',
    /QR code, to show that you met in person/.test(text) && /link, for people you are not meeting in person/.test(text) &&
    /Coming soon: a moving QR code/.test(text) && /Coming later: NFC, Bluetooth and AirDrop/.test(text))
  check('index: Finding housing is a use case labelled Planned', await page.evaluate(() => {
    const c = document.getElementById('uc-housing'); return !!c && /^Planned$/i.test(c.querySelector('.ucstate')?.textContent.trim() ?? '') && /Finding housing/.test(c.textContent)
  }))
  // wave 2 (P16): exactly one GitHub link, on the underlined words "open source", labelled as a paused public copy
  const gh = await page.evaluate(() => [...document.querySelectorAll('a[href*="github" i]')].map((a) => ({
    href: a.getAttribute('href'), text: a.textContent.trim(), title: a.title, inSource: !!a.closest('#source-code'),
    underlined: getComputedStyle(a).textDecorationLine.includes('underline') })))
  check('index: one link to the public copy, on the underlined words "open source", in Source code, labelled as a paused copy with a pause notice',
    gh.length === 1 && gh[0].href === 'https://github.com/evobiosys/web-of-trust' && gh[0].text === 'open source' && gh[0].inSource && gh[0].underlined && /pause notice/i.test(gh[0].title) && /paused public copy/.test(text), JSON.stringify(gh))
  for (const name of pageNames) {
    await page.goto(BASE + (name === 'index.html' ? '' : name))
    const t = await page.evaluate(() => document.documentElement.outerHTML)
    // the one permitted link target is removed first; the word must not appear anywhere else
    check(`${name}: no "github" except the one permitted link`, !/github/i.test(t.split('https://github.com/evobiosys/web-of-trust').join('')))
    check(`${name}: no unresolved <!--IF:...--> marker left in the output`, !/<!--\/?IF/.test(t))
    check(`${name}: no em dash (char or entity)`, !/—|&mdash;|&#8212;|&#x2014;/i.test(t))
    const vis = await page.evaluate(() => document.body.innerText)
    check(`${name}: no "UWB", no names (Max, Kaya, Manuel), no "Infomaniak AI", no "Switzerland ... transcri" claim`,
      !/\bUWB\b|\bMax\b|\bKaya\b|\bManuel\b|Infomaniak AI/.test(t) && !/transcri[^.]{0,200}Infomaniak|Infomaniak[^.]{0,200}transcri/i.test(vis))
    check(`${name}: no HTML comment carries a meeting or a person`, !/<!--[^>]*(meeting with|transcript of the conversation|max-meeting)/i.test(t))
  }
  // wave 2: pricing (P17, P10, P20) and FAQ (12 questions) and privacy (OpenRouter)
  await page.goto(BASE + 'pricing.html')
  const pr = await page.evaluate(() => document.querySelector('main, .wrap')?.innerText ?? document.body.innerText)
  check('pricing: B2B copy (solid agreement, contact us, prices only go down, recordings stay on the phone, free while we test)',
    /solid agreement/.test(pr) && /Contact us/.test(pr) && /Prices only ever go down later/.test(pr) && /Recordings stay on your phone/.test(pr) && /Free while we test/.test(pr))
  check('pricing: allowance in recordings with hours in brackets', /the equivalent of 10 recordings of up to an hour each/.test(pr) && /\(10 hours in total\)/.test(pr))
  check('pricing: smooth updates for hosted, offline installs on their own', /hosted version<\/b>|The hosted version/.test(pr) && /promises smooth updates and migrations/.test(pr) && /offline install/i.test(pr) && /on its own/.test(pr))
  check('pricing: no price list (no currency amounts, no "fair")', !/[€$£]\s?\d|\d\s?(EUR|USD|CHF)\b|\bfair\b/i.test(pr), pr.match(/[€$£]\s?\d|\d\s?(EUR|USD|CHF)\b|\bfair\b/i)?.[0] ?? '')
  check('pricing: server transcription via OpenRouter, see privacy, no free promise', /outside providers via OpenRouter, see privacy/i.test(pr) && /promise nothing free/.test(pr))
  await page.goto(BASE + 'faq.html')
  const faq = await page.evaluate(() => ({ n: document.querySelectorAll('details.q').length, ids: [...document.querySelectorAll('details.q')].map((d) => d.id),
    text: document.body.innerText + [...document.querySelectorAll('details.q')].map((d) => d.textContent).join(' ') }))
  check('faq: exactly 12 questions', faq.n === 12 && new Set(faq.ids).size === 12, faq.ids.join(','))
  check('faq: Facebook one-liner, revenue "being worked out, see pricing", German brackets', /Facebook lets you repost\. TrustWeb lets you ask/.test(faq.text) && /Being worked out, see pricing/.test(faq.text) && /\(Ist das nicht Facebook/.test(faq.text))
  check('faq: nothing says multi-degree querying works today', !/travels? (further|on) .{0,40}today/i.test(faq.text) && /Today a question reaches the people you are directly connected with/.test(faq.text))
  await page.goto(BASE + 'privacy.html')
  const pv = await page.evaluate(() => document.getElementById('transcription')?.textContent.replace(/\s+/g, ' ') ?? '')
  check('privacy: transcription via OpenRouter to a US provider, data policy "deny", nothing kept by us, approximate times, no Infomaniak/Switzerland claim',
    /OpenRouter/.test(pv) && /United States/.test(pv) && /DeepInfra, Groq or Together/.test(pv) && /"deny"/.test(pv) && /keeps neither the audio nor the text/.test(pv) && /approximate/.test(pv) && !/Infomaniak|Switzerland/.test(pv), pv.slice(0, 120))
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
