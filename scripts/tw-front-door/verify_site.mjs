// Headless check of a built TrustInTheWeb site (real Chromium, five widths: 360, 390, 768, 1024, 1280).
//
//   PLAYWRIGHT_PACKAGE=/Users/personal/Documents/SingularStructure/code/other/signal-orbit/node_modules/playwright-core/index.js \
//   [TW_SITE=org|com] [TW_APP_BASE=https://app.idea2.site/trustweb] [TW_SITE_HOST=idea2.site] \
//   node scripts/tw-front-door/verify_site.mjs <built-dir> <screens-dir> <draft|prod> [<live-base-url>]
//
// TW_TRANSCRIBE_PROVIDER=openrouter|berget|berget-only (default openrouter) is the setting the build was given
// (see tw_site.py): the transcription copy must name that provider, and Berget must not appear at all unless it is on.
//
// TW_SITE=org (default) checks the website, TW_SITE=com the hosting site. TW_APP_BASE is the app base the
// build was given (Demo is <base>/demo/, Install <base>/?install=1); TW_SITE_HOST the host it was built for.

// With a live base URL (e.g. https://idea2.site/trustweb/draft/) the same checks run against the
// deployed pages (<built-dir> then only supplies the page list). Otherwise it serves <built-dir> itself on 127.0.0.1:$TW_VERIFY_PORT (default 8981; loopback only, closed at the end),
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
const PORT = Number(process.env.TW_VERIFY_PORT ?? 8981)
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  console.error('TW_VERIFY_PORT must be an integer from 1024 to 65535')
  process.exit(2)
}
const BASE = liveBase ?? `http://127.0.0.1:${PORT}/`
const WIDTHS = [360, 390, 768, 1024, 1280]
const SITE = process.env.TW_SITE ?? 'org'
if (!['org', 'com'].includes(SITE)) { console.error('TW_SITE must be org or com'); process.exit(2) }
const APP = (process.env.TW_APP_BASE ?? 'https://app.idea2.site/trustweb').replace(/\/$/, '')
const SITE_HOST = process.env.TW_SITE_HOST ?? 'idea2.site'
const ORG = SITE === 'org'
// terms.html is built in a draft, or when production was given --publish-terms (TW_PUBLISH_TERMS=1): set it the same way here
const TERMS_PUBLISHED = mode === 'draft' || process.env.TW_PUBLISH_TERMS === '1'
const TX_PROVIDER = process.env.TW_TRANSCRIBE_PROVIDER ?? 'openrouter'
if (!['openrouter', 'berget', 'berget-only'].includes(TX_PROVIDER)) { console.error('TW_TRANSCRIBE_PROVIDER must be openrouter, berget or berget-only'); process.exit(2) }
const OTHER_HOST = ORG ? 'https://TrustInTheWeb.com' : 'https://TrustInTheWeb.org'
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
    barBrand: document.querySelectorAll('.sitebar-brand').length,
    barLeft: (() => { const first = document.querySelector('.sitebar-in')?.firstElementChild; return first ? first.className : null })(),
    legal: [...document.querySelectorAll('.sitefooter .sf-col')].filter((c) => c.querySelector('.sf-h')?.textContent.trim() === 'Legal').flatMap((c) => [...c.querySelectorAll('a')].map((a) => a.textContent.trim())),
    legalHrefs: [...document.querySelectorAll('.sitefooter .sf-col')].filter((c) => c.querySelector('.sf-h')?.textContent.trim() === 'Legal').flatMap((c) => [...c.querySelectorAll('a')].map((a) => a.getAttribute('href'))),
    hostHeader: (() => { const a = document.querySelector('.sitebar-sub a.hostlink'); if (!a) return null; const r = a.getBoundingClientRect()
      return { href: a.getAttribute('href'), title: a.title, text: a.textContent.trim(), inView: r.left >= 0 && r.right <= vw && r.width > 30 } })(),
    hostFooter: [...document.querySelectorAll('.sitefooter a.hostlink')].map((a) => ({ href: a.getAttribute('href'), title: a.title, text: a.textContent.trim() })),
    pricingLinks: [...document.querySelectorAll('a[href]')].filter((a) => /pricing/i.test(a.getAttribute('href').replace(/[?&]kind=pricing/, '').replace('#fair-pricing', '')) || /^pricing$/i.test(a.textContent.trim())).map((a) => a.getAttribute('href')),
    terms: !!document.querySelector('.sitefooter a[href="terms.html"]'),
    strip: !!document.querySelector('.draftstrip'),
    divInPOrSpan: document.querySelectorAll('p div, span div, p section').length,
    popsOutside: [...document.querySelectorAll('.pop')].filter((p) => !p.parentElement?.classList.contains('term')).length,
    robots: document.querySelector('meta[name=robots]')?.content ?? null,
    canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
    heroLabel: document.querySelectorAll('header.hero .eyebrow, .comhero .eyebrow').length,
    love: [...document.querySelectorAll('.sitefooter .sf-love')].map((e) => e.textContent.trim()),
    footerOther: [...document.querySelectorAll('.sitefooter a')].filter((a) => a.getAttribute('href').replace(/\/$/, '').toLowerCase() === 'https://trustintheweb.org').length,
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

// the two swirls behind the mark and the wordmark itself (index pages only)
const heroGeometry = () => {
  const vw = window.innerWidth
  const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }
  const field = document.querySelector('.knot-field')
  const swirls = [...document.querySelectorAll('.knot-field svg.knot')].map((el) => ({ cls: el.getAttribute('class'), ...rect(el) }))
  const h1 = document.querySelector('h1.wot')
  const lines = h1 ? [...h1.querySelectorAll('.wm-l')].map((l) => ({
    text: l.textContent.trim(), top: Math.round(l.getBoundingClientRect().top), regular: Number(getComputedStyle(l).fontWeight),
    bold: [...l.querySelectorAll('b')].map((b) => ({ t: b.textContent, w: Number(getComputedStyle(b).fontWeight) })) })) : []
  return { vw, field: field ? rect(field) : null, swirls, lines, h1Text: h1?.textContent.replace(/\s+/g, ' ').trim(), h1: h1 ? rect(h1) : null }
}

const inside = (a, box, tol = 0.5) => a.l >= box.l - tol && a.r <= box.r + tol && a.t >= box.t - tol && a.b <= box.b + tol

async function heroChecks(page, tag) {
  const g = await page.evaluate(heroGeometry)
  const vp = { l: 0, r: g.vw, t: -1e6, b: 1e6 }
  check(`${tag}: two swirls, both with a real size`, g.swirls.length === 2 && g.swirls.every((x) => x.w > 40 && x.h > 40), JSON.stringify(g.swirls.map((x) => Math.round(x.w))))
  check(`${tag}: BOTH swirls fully inside the viewport (left ${g.swirls[0] ? Math.round(g.swirls[0].l) : '?'}..${g.swirls[0] ? Math.round(g.swirls[0].r) : '?'}, right ${g.swirls[1] ? Math.round(g.swirls[1].l) : '?'}..${g.swirls[1] ? Math.round(g.swirls[1].r) : '?'} of ${g.vw})`,
    g.swirls.length === 2 && g.swirls.every((x) => inside(x, vp)))
  check(`${tag}: BOTH swirls fully inside the hero box that crops them (nothing cut off)`, !!g.field && g.swirls.length === 2 && g.swirls.every((x) => inside(x, g.field)),
    g.field ? JSON.stringify(g.swirls.filter((x) => !inside(x, g.field)).map((x) => [x.cls, Math.round(x.l - g.field.l), Math.round(g.field.r - x.r)])) : 'no .knot-field')
  check(`${tag}: the swirls do not overlap each other`, g.swirls.length === 2 && g.swirls[0].r <= g.swirls[1].l)
  check(`${tag}: wordmark: "Trust in" over "the Web", Trust and Web bold, in and the regular, second line below the first`,
    g.lines.length === 2 && g.lines[0].text === 'Trust in' && g.lines[1].text === 'the Web' && g.lines[1].top > g.lines[0].top &&
    g.lines.every((l) => l.regular <= 500 && l.bold.length === 1 && l.bold[0].w >= 600) && g.lines[0].bold[0].t === 'Trust' && g.lines[1].bold[0].t === 'Web', JSON.stringify(g.lines))
  check(`${tag}: wordmark inside the viewport`, !!g.h1 && g.h1.l >= -0.5 && g.h1.r <= g.vw + 0.5)
}

async function checkPage(browser, name, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: 'light' })
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
  check(`${tag}: Demo/Install links (${APP})`, c.demoHref === `${APP}/demo/` && c.installHref === `${APP}/?install=1`, `${c.demoHref} ${c.installHref}`)
  const wantCols = ORG ? 'Features|Resources|Use cases|Legal' : 'Hosting|The app|Resources|Legal'
  check(`${tag}: footer columns ${wantCols}`, c.cols.join('|') === wantCols, c.cols.join('|'))
  check(`${tag}: footer wraps (${width <= 900 ? '2' : '5'} per row)`, width <= 900 ? c.perRow === 2 : c.perRow === 5, `perRow=${c.perRow}`)
  check(`${tag}: no site name top left of the bar (wave 5: the small "${ORG ? 'TrustInTheWeb.org' : 'TrustInTheWeb.com'}" wordmark is gone; the bar starts with the buttons)`,
    c.barBrand === 0 && c.barLeft === 'sitebar-actions', JSON.stringify([c.barBrand, c.barLeft]))
  check(`${tag}: header link to the ${ORG ? 'hosting' : 'app'} site: visible, title exactly ${OTHER_HOST}, href the live site`,
    !!c.hostHeader && c.hostHeader.inView && c.hostHeader.title === OTHER_HOST && c.hostHeader.href.toLowerCase().replace(/\/$/, '') === OTHER_HOST.toLowerCase() && c.hostHeader.text === (ORG ? 'Do you need hosting?' : 'About the infrastructure'), JSON.stringify(c.hostHeader))
  if (ORG) {
    check(`${tag}: footer carries "Do you need hosting?" with the same title and target`,
      c.hostFooter.length === 1 && c.hostFooter[0].text === 'Do you need hosting?' && c.hostFooter[0].title === OTHER_HOST && c.hostFooter[0].href.toLowerCase().replace(/\/$/, '') === OTHER_HOST.toLowerCase(), JSON.stringify(c.hostFooter))
    check(`${tag}: tw.org is free of pricing (no link to a pricing page, no "Pricing" entry)`, c.pricingLinks.length === 0, c.pricingLinks.join(', '))
  }
  check(`${tag}: no small site label (eyebrow) under the header`, c.heroLabel === 0, String(c.heroLabel))
  check(`${tag}: footer says "with love from Vienna"`, c.love.length === 1 && c.love[0] === 'with love from Vienna', JSON.stringify(c.love))
  if (!ORG) check(`${tag}: the footer links back to TrustInTheWeb.org`, c.footerOther >= 1, String(c.footerOther))
  check(`${tag}: brand slot links to evobiosys.org`, c.brandHref === 'https://evobiosys.org' && c.brandText.startsWith('TrustWeb, by EvoBioSys'))
  check(`${tag}: no div in p/span, no stray pop`, c.divInPOrSpan === 0 && c.popsOutside === 0)
  check(`${tag}: terms link in the footer exactly when terms are published (both sites)`, c.terms === TERMS_PUBLISHED, String(c.terms))
  check(`${tag}: footer Legal column: Privacy Policy, Data policy, ${TERMS_PUBLISHED ? 'Terms, ' : ''}Imprint, in that order`,
    c.legal.join('|') === ['Privacy Policy', 'Data policy', ...(TERMS_PUBLISHED ? ['Terms'] : []), 'Imprint'].join('|') &&
    c.legalHrefs.join('|') === ['privacy.html', 'data-policy.html', ...(TERMS_PUBLISHED ? ['terms.html'] : []), 'imprint.html'].join('|'), c.legal.join('|'))
  check(`${tag}: draft strip only in draft`, c.strip === (mode === 'draft'))
  if (mode === 'draft') check(`${tag}: draft is noindex`, /noindex/.test(c.robots ?? ''))
  if (name === 'index.html' && ORG && mode === 'prod') check(`${tag}: canonical is the site's own front page`, c.canonical === (SITE_HOST === 'idea2.site' ? 'https://idea2.site/trustweb/' : `https://${SITE_HOST}/`), String(c.canonical))
  if (name === 'index.html') await heroChecks(page, tag)
  if (name === 'index.html' && ORG) {
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
  // not live yet or not ours to probe: the app's own routes and the two new domains until infra serves them
  const LATER = [/\?install=1$/, /\/feedback$/, /\/\/(app\.)?trustintheweb\.(org|com)/i]
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
  // feedback form: ONE request (POST /feedback), the address only for a ticked box, nothing real is posted (every route mocked)
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const posts = []
  let mode204 = true, status = 204
  await page.route(`${new URL(APP).origin}/feedback`, async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST, OPTIONS' } })
    posts.push({ method: req.method(), type: req.headers()['content-type'], body: JSON.parse(req.postData() ?? '{}') })
    if (!mode204) return route.abort('failed')
    return route.fulfill({ status, headers: { 'access-control-allow-origin': '*' } })
  })
  // tripwires: the feedback page must never call the newsletter service or the waitlist itself (the server forwards).
  // The routes also keep a live-draft run from ever really signing anyone up.
  const trip = []
  const DIRECT = /subscriber\.questhub\.eco|\/rebiosys\/api\/waitlist/
  page.on('request', (r) => { if (DIRECT.test(r.url())) trip.push(r.url()) })
  for (const url of ['https://idea2.site/rebiosys/api/waitlist', 'https://subscriber.questhub.eco/subscribe']) {
    await page.route(url, (route) => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: '{}' }))
  }
  const last = () => posts[posts.length - 1]?.body
  const msg = async () => (await page.textContent('#fb-msg')) ?? ''
  const fresh = async (query = '') => { await page.goto(BASE + 'feedback.html' + query); posts.length = 0; mode204 = true; status = 204 }
  const press = async (waitFor) => {
    await page.click('#fb-send')
    await page.waitForFunction((t) => document.querySelector('#fb-msg').textContent.includes(t), waitFor, { timeout: 8000 })
  }
  const ticks = async () => [await page.isChecked('#fb-reply'), await page.isChecked('#fb-notify'), await page.isChecked('#fb-news')]

  await fresh('?kind=pricing')
  check('feedback: ?kind=pricing preselects the kind', (await page.inputValue('#fb-kind')) === 'pricing')
  check('feedback: all three boxes (write back, notify, newsletter) are UNTICKED on load, with an info button',
    (await ticks()).every((t) => !t) && (await page.locator('#fb-info-btn').count()) === 1)
  const labels = await page.evaluate(() => ({
    email: document.querySelector('label[for="fb-email"]')?.textContent.replace(/\s+/g, ' ').trim(),
    reply: document.querySelector('#fb-reply')?.closest('label')?.textContent.replace(/\s+/g, ' ').trim(),
    notify: document.querySelector('#fb-notify')?.closest('label')?.textContent.replace(/\s+/g, ' ').trim(),
    news: document.querySelector('#fb-news')?.closest('label')?.textContent.replace(/\s+/g, ' ').trim() }))
  check('feedback: labels (Your email + hint, Write back to me, Notify me, Stay informed)',
    labels.email === 'Your email Only needed if you tick a box below. Sent only then.' &&
    labels.reply === 'Write back to me about this message' &&
    labels.notify === 'Notify me when it is ready (one email, once)' &&
    labels.news === 'Stay informed with our newsletter (at most every one or two weeks)', JSON.stringify(labels))
  check('feedback: info text hidden until the info button is pressed', await page.$eval('#fb-info', (e) => e.hidden))
  await page.click('#fb-info-btn')
  const info = ((await page.textContent('#fb-info')) ?? '').replace(/\s+/g, ' ')
  check('feedback: info button opens the note (pre-ticking is not valid consent; the newsletter service sends the confirmation)',
    !(await page.$eval('#fb-info', (e) => e.hidden)) && /does not count/.test(info) && /our newsletter service first sends you a confirmation email/.test(info) &&
    (await page.getAttribute('#fb-info-btn', 'aria-expanded')) === 'true')
  const small = (await page.textContent('#form-card')) ?? ''
  check('feedback: small print says what is stored (message, kind, page; email only with a box; no address, no browser details)',
    /We store your message, the kind and the page you sent it from\. Your email only if you tick a box\. No network address, no browser details\./.test(small.replace(/\s+/g, ' ')) &&
    (await page.locator('#form-card a[href="privacy.html"]').count()) === 1)

  // no box ticked, address filled: the address must not travel at all
  await page.fill('#fb-text', 'Ten hours seems fair.')
  await page.fill('#fb-email', 'me@example.org')
  await press('Thank you')
  const b1 = last()
  check('feedback: no box ticked, email typed: ONE POST with text, kind, page, empty honeypot, notify=false, newsletter=false and neither email nor contact',
    posts.length === 1 && posts[0].method === 'POST' && /json/.test(posts[0].type) && b1.text === 'Ten hours seems fair.' && b1.kind === 'pricing' &&
    b1.homepage === '' && /feedback\.html$/.test(b1.page) && b1.notify === false && b1.newsletter === false && !('email' in b1) && !('contact' in b1), JSON.stringify(b1))
  check('feedback: after a 204 the message is cleared and the three boxes are unticked',
    (await page.inputValue('#fb-text')) === '' && (await ticks()).every((t) => !t))
  check('feedback: the thank-you line carries no newsletter or notify promise when no box was ticked',
    (await msg()).startsWith('Thank you. Your message arrived.') && !/confirmation|once, when/.test(await msg()))

  // junk in the email field never blocks plain feedback
  await fresh()
  await page.fill('#fb-text', 'Plain feedback.')
  await page.fill('#fb-email', 'not-an-email')
  await press('Thank you')
  check('feedback: a junk address with no box ticked does not block, and is not sent', posts.length === 1 && !('email' in last()) && !('contact' in last()))

  // newsletter ticked
  await fresh()
  await page.fill('#fb-text', 'Looks promising.')
  await page.fill('#fb-email', 'person@example.org')
  await page.check('#fb-news')
  await press('confirmation email')
  const b2 = last()
  check('feedback: newsletter ticked: newsletter===true, notify===false, email present, contact absent',
    posts.length === 1 && b2.newsletter === true && b2.notify === false && b2.email === 'person@example.org' && !('contact' in b2) && b2.text === 'Looks promising.', JSON.stringify(b2))
  check('feedback: the newsletter thank-you names the confirmation email and the click (no direct signup claim); boxes unticked, text cleared',
    /^Thank you\. Your message arrived\. A confirmation email will follow; you join the newsletter only after you click the link in it\.$/.test(await msg()) &&
    (await ticks()).every((t) => !t) && (await page.inputValue('#fb-text')) === '')

  // notify ticked
  await fresh()
  await page.fill('#fb-text', 'Tell me.')
  await page.fill('#fb-email', 'notify@example.org')
  await page.check('#fb-notify')
  await press('once, when TrustWeb is ready')
  const b3 = last()
  check('feedback: notify ticked: notify===true, newsletter===false, email present, contact absent; the line says one note when ready',
    b3.notify === true && b3.newsletter === false && b3.email === 'notify@example.org' && !('contact' in b3) && !/confirmation/.test(await msg()), JSON.stringify(b3))

  // an empty message with only the newsletter ticked posts with text ""
  await fresh()
  await page.fill('#fb-email', 'only@example.org')
  await page.check('#fb-news')
  await press('confirmation email')
  check('feedback: an empty message with only the newsletter ticked posts with text "" and newsletter===true',
    posts.length === 1 && last().text === '' && last().newsletter === true && last().email === 'only@example.org', JSON.stringify(last()))

  // write back to me
  await fresh()
  await page.fill('#fb-text', 'Please send me the source code.')
  await page.fill('#fb-email', 'reply@example.org')
  await page.check('#fb-reply')
  await press('Thank you')
  const b4 = last()
  check('feedback: "Write back to me" ticked: contact present, email absent, notify and newsletter false',
    b4.contact === 'reply@example.org' && !('email' in b4) && b4.notify === false && b4.newsletter === false, JSON.stringify(b4))
  await fresh()
  await page.fill('#fb-text', 'Both please.')
  await page.fill('#fb-email', 'both@example.org')
  await page.check('#fb-reply'); await page.check('#fb-news')
  await press('confirmation email')
  check('feedback: "Write back to me" and newsletter together send contact and email', last().contact === 'both@example.org' && last().email === 'both@example.org' && last().newsletter === true, JSON.stringify(last()))
  await fresh()
  await page.fill('#fb-email', 'reply@example.org')
  await page.check('#fb-reply')
  await page.click('#fb-send')
  check('feedback: "Write back to me" with an empty message is refused locally ("Please write the message we should answer."), no request',
    (await msg()) === 'Please write the message we should answer.' && posts.length === 0)
  await page.check('#fb-news')
  await page.click('#fb-send')
  check('feedback: "Write back to me" plus the newsletter still needs the message', (await msg()) === 'Please write the message we should answer.' && posts.length === 0)

  // refused before any request
  await fresh()
  await page.check('#fb-news')
  const refused = []
  for (const [label, addr] of [['not an address', 'not-an-email'], ['zero-width space U+200B', 'me​@example.org'], ['bidi override U+202E', 'me@exam‮ple.org'],
    ['inner space', 'me @example.org'], ['too long', 'a'.repeat(250) + '@example.org'], ['double dot', 'me@exa..mple.org'], ['numeric top-level domain', 'me@example.123']]) {
    await page.fill('#fb-email', addr)
    await page.click('#fb-send')
    if (!(await msg()).includes('real email address') || posts.length !== 0) refused.push(label)
  }
  check('feedback: bad addresses (junk, U+200B, U+202E, space, over 254, "..", digits-only domain) are refused before any request', refused.length === 0, refused.join(', '))
  await page.fill('#fb-email', 'someone@gmial.com')
  await page.click('#fb-send')
  check('feedback: a typo domain gets a "did you mean" hint first, nothing sent yet', (await page.textContent('#fb-email-msg')).includes('gmail.com') && posts.length === 0)
  await press('confirmation email')
  check('feedback: the second press with the same address goes through', posts.length === 1 && last().email === 'someone@gmial.com')

  // rate limit and network failure keep the text and the ticks
  await fresh()
  status = 429
  await page.fill('#fb-text', 'again')
  await page.fill('#fb-email', 'keep@example.org')
  await page.check('#fb-news')
  await press('several messages')
  check('feedback: 429 keeps the text and the ticks and says so', (await page.inputValue('#fb-text')) === 'again' && (await page.isChecked('#fb-news')))
  mode204 = false
  await press('Could not send right now')
  check('feedback: network failure says "could not send right now" and keeps the text', (await page.inputValue('#fb-text')) === 'again')
  check('feedback: send button usable again', !(await page.$eval('#fb-send', (b) => b.disabled)))
  mode204 = true; status = 204
  await press('Thank you')
  check('feedback: the retry sends once more and then clears', posts.filter((p) => p.body.newsletter === true && p.body.email === 'keep@example.org').length >= 1 && (await page.inputValue('#fb-text')) === '')

  // empty message, no box
  await fresh()
  await page.click('#fb-send')
  check('feedback: empty message with no box is refused locally ("write a message first")', (await msg()).includes('write a message') && posts.length === 0)
  const hp = await page.$eval('#fb-homepage', (e) => ({ left: e.closest('.hp').getBoundingClientRect().left, tab: e.tabIndex }))
  check('feedback: honeypot is off-screen and not tabbable', hp.left < -1000 && hp.tab === -1)

  // a filled honeypot still posts exactly once (the server drops it)
  await fresh()
  await page.evaluate(() => { document.getElementById('fb-homepage').value = 'bot' })
  await page.fill('#fb-text', 'spam')
  await page.fill('#fb-email', 'bot@example.org')
  await page.check('#fb-news')
  await press('Thank you')
  check('feedback: a filled honeypot still sends exactly one POST (honeypot travels)', posts.length === 1 && last().homepage === 'bot', JSON.stringify(last()))

  await fresh('?topic=source-code')
  check('feedback: ?topic=source-code prefills a request to read the code and ticks nothing', (await page.inputValue('#fb-text')).includes('source code') && (await ticks()).every((t) => !t))

  check('feedback: no request ever went to subscriber.questhub.eco or /rebiosys/api/waitlist from the feedback page', trip.length === 0, trip.join(', '))
  await ctx.close()

  if (ORG) {
    // wave 5: the notify form on the index page posts ONCE to this site's own feedback route (the old direct calls to the
    // ReBioSys relay and the subscriber service are refused by those servers for the TrustInTheWeb origins, so a browser could not send them)
    const ctx2 = await browser.newContext()
    const p2 = await ctx2.newPage()
    const calls = [], direct = []
    p2.on('request', (r) => { if (/subscriber\.questhub\.eco|\/rebiosys\/api\/waitlist/.test(r.url())) direct.push(r.url()) })
    await p2.route(`${new URL(APP).origin}/feedback`, (route) => {
      const req = route.request()
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST, OPTIONS' } })
      calls.push({ type: req.headers()['content-type'], body: JSON.parse(req.postData() ?? '{}') })
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    })
    await p2.goto(BASE)
    await p2.fill('#j-email', 'someone@example.org')
    await p2.click('#j-submit')
    await p2.waitForFunction(() => document.querySelector('#j-msg').textContent.includes('Thank you'))
    const one = calls[0]?.body
    check('join form: ONE POST to the feedback route with notify:true, newsletter:false, the address, an empty text',
      calls.length === 1 && /application\/json/.test(calls[0].type) && one.notify === true && one.newsletter === false && one.email === 'someone@example.org' && one.text === '' && one.kind === 'feedback', JSON.stringify(calls))
    check('join form: no word of the old "waitlist" in the success message, and the box is cleared', !/waitlist/i.test(await p2.textContent('#j-msg')) && (await p2.inputValue('#j-email')) === '')
    calls.length = 0
    await p2.fill('#j-email', 'other@example.org')
    await p2.check('#j-newsletter')
    await p2.click('#j-submit')
    await p2.waitForFunction(() => document.querySelector('#j-nl-status').textContent.includes('A confirmation email will follow'))
    check('join form: with the newsletter box ticked the same single POST carries newsletter:true', calls.length === 1 && calls[0].body.newsletter === true && calls[0].body.notify === true && calls[0].body.email === 'other@example.org', JSON.stringify(calls))
    await p2.fill('#j-email', 'not-an-address')
    calls.length = 0
    await p2.click('#j-submit')
    check('join form: an invalid address sends nothing and shows the hint', calls.length === 0 && await p2.isVisible('#j-err'))
    check('join form: no request ever went to the subscriber service or the ReBioSys waitlist from the main page', direct.length === 0, direct.join(', '))
    await ctx2.close()
  }
}

// every page, both sites: the same hygiene rules
const LEGAL_PAGES = ['privacy.html', 'data-policy.html', 'terms.html', 'imprint.html']

async function everyPageChecks(page) {
  let reqs = []
  page.on('request', (r) => { try { reqs.push(new URL(r.url()).host) } catch { /* data: urls and the like */ } })
  for (const name of pageNames) {
    reqs = []
    await page.goto(BASE + (name === 'index.html' ? '' : name))
    const t = await page.evaluate(() => document.documentElement.outerHTML)
    const hosts = [...new Set(reqs)], own = new URL(BASE).host
    const allowedHosts = ORG ? [own, 'fonts.googleapis.com', 'fonts.gstatic.com'] : [own]
    check(`${name}: the page loads only from ${allowedHosts.join(', ')}${ORG ? ' (Google Fonts, named in the privacy policy)' : ' (nothing from any third party)'}`, hosts.every((h) => allowedHosts.includes(h)), hosts.join(','))
    check(`${name}: no cookie, nothing in local or session storage (the privacy policy says so)`, await page.evaluate(() => document.cookie === '' && localStorage.length === 0 && sessionStorage.length === 0))
    const banner = await page.evaluate(() => {
      const b = document.querySelector('main > aside.ai-draft'), h1 = document.querySelector('main h1')
      return { n: document.querySelectorAll('aside.ai-draft').length, text: b?.textContent.trim().slice(0, 40), before: !!(b && h1 && (b.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING)),
        prev: b?.previousElementSibling?.className ?? null, top: b ? Math.round(b.getBoundingClientRect().top) : null }
    })
    check(`${name}: ${LEGAL_PAGES.includes(name) ? 'opens with the visible banner "AI drafted, subject to review" (right under the back link, before the heading)' : 'carries no AI-draft banner'}`,
      LEGAL_PAGES.includes(name) ? banner.n === 1 && /^AI drafted, subject to review\./.test(banner.text ?? '') && banner.before && banner.prev === 'back' && banner.top < 200 : banner.n === 0, JSON.stringify(banner))
    // the one permitted link target is removed first; the word must not appear anywhere else
    check(`${name}: no "github" except the one permitted link`, !/github/i.test(t.split('https://github.com/evobiosys/web-of-trust').join('')))
    check(`${name}: no unresolved <!--IF:...--> marker and no unresolved {{TOKEN}} left in the output`, !/<!--\/?IF/.test(t) && !/\{\{[A-Z_]+\}\}/.test(t))
    check(`${name}: no em dash (char or entity)`, !/—|&mdash;|&#8212;|&#x2014;/i.test(t))
    check(`${name}: no "promise nothing free", no "hop by hop", no "DeepInfra"`, !/promise nothing free|hop by hop|DeepInfra/i.test(t.replace(/\s+/g, ' ')))
    const vis = await page.evaluate(() => document.body.innerText)
    check(`${name}: no "UWB", no names (Max, Kaya, Manuel), no "Infomaniak AI", no "Switzerland ... transcri" claim, no Berget unless it is switched on`,
      !/\bUWB\b|\bMax\b|\bKaya\b|\bManuel\b|Infomaniak AI/.test(t) && !/transcri[^.]{0,200}Infomaniak|Infomaniak[^.]{0,200}transcri/i.test(vis) && (TX_PROVIDER !== 'openrouter' || !/Berget/i.test(t)))
    check(`${name}: no HTML comment carries a meeting or a person`, !/<!--[^>]*(meeting with|transcript of the conversation|max-meeting)/i.test(t) && !/<!--(?:(?!-->)[\s\S])*(GAPS for|Jakob)/.test(t))
    check(`${name}: names itself ${ORG ? 'TrustInTheWeb.org' : 'TrustInTheWeb.com'} (title), never idea2.site as its name`,
      /<title>[^<]*TrustInTheWeb\.(org|com)<\/title>/.test(t) && new RegExp(`<title>[^<]*TrustInTheWeb\\.${SITE}</title>`).test(t) && !/<title>[^<]*idea2\.site/.test(t))
    check(`${name}: neither "the app and its website" nor "the app and website" nor "app and the website" appears (title, meta, body)`, !/the app and (its |the )?web ?site|app and website/i.test(t.replace(/\s+/g, ' ')))
    if (!ORG) check(`${name}: the hosting site fetches no font or other third-party asset (no fonts.googleapis / fonts.gstatic)`, !/fonts\.(googleapis|gstatic)/.test(t))
    check(`${name}: the page names itself in the bar only (no "TRUSTINTHEWEB" eyebrow before the first heading)`, await page.evaluate(() => { const h = document.querySelector('h1'); return ![...document.querySelectorAll('.eyebrow')].some((e) => h && (e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) && /trustintheweb\.(org|com)/i.test(e.textContent)) }))
    check(`${name}: the hosting sentence says "The app is hosted on Infomaniak in Switzerland"`, /The app is hosted on Infomaniak in Switzerland/.test(vis))
  }
}

async function contentChecksCom(page) {
  await page.goto(BASE)
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  check('com index: names the hosted service and what it hosts (encrypted copy of recordings, backups, relay), encrypted before it leaves',
    /Hosting for TrustWeb/.test(text) && /encrypted copy of your recordings/i.test(text) && /relay/i.test(text) && /ciphertext it cannot read/.test(text))
  check('com index: free while we test, the allowance as 10 recordings of up to an hour each (10 hours in total)',
    /free while we test/i.test(text) && /the equivalent of 10 recordings of up to an hour each/.test(text) && /\(10 hours in total\)/.test(text))
  check('com index: smooth updates and migrations; an offline install is on its own', /smooth updates and migrations/.test(text) && /offline install is on its own/i.test(text))
  check('com index: "Contact us to make a solid agreement" with a contact button to the feedback form',
    /Contact us to make a solid agreement/.test(text) && (await page.locator('a[href="feedback.html?kind=pricing"]').count()) >= 2)
  check('com index: the anchors the footer needs exist (what, free, updates, agreement)', await page.evaluate(() => ['what', 'free', 'updates', 'agreement'].every((i) => document.getElementById(i))))
  check('com index: links to the website TrustInTheWeb.org', (await page.locator('a[href="https://trustintheweb.org/"]').count()) >= 1)
  check(`com: pages are index, pricing, feedback, imprint, privacy, data policy${TERMS_PUBLISHED ? ', terms' : ''} (nothing else)`,
    pageNames.join(',') === `data-policy.html,feedback.html,imprint.html,index.html,pricing.html,privacy.html${TERMS_PUBLISHED ? ',terms.html' : ''}`, pageNames.join(','))
  await page.goto(BASE + 'pricing.html')
  const pr = await page.evaluate(() => document.querySelector('main, .wrap')?.innerText ?? document.body.innerText)
  check('pricing: B2B copy (solid agreement, contact us, prices only go down, recordings stay on the phone, free while we test)',
    /solid agreement/.test(pr) && /Contact us/.test(pr) && /Prices only ever go down later/.test(pr) && /Recordings stay on your phone/.test(pr) && /Free while we test/.test(pr))
  check('pricing: allowance in recordings with hours in brackets', /the equivalent of 10 recordings of up to an hour each/.test(pr) && /\(10 hours in total\)/.test(pr))
  check('pricing: smooth updates for hosted, offline installs on their own', /hosted version<\/b>|The hosted version/.test(pr) && /promises smooth updates and migrations/.test(pr) && /offline install/i.test(pr) && /on its own/.test(pr))
  check('pricing: no price list (no currency amounts, no "fair")', !/[€$£]\s?\d|\d\s?(EUR|USD|CHF)\b|\bfair\b/i.test(pr), pr.match(/[€$£]\s?\d|\d\s?(EUR|USD|CHF)\b|\bfair\b/i)?.[0] ?? '')
  const prRoute = { openrouter: /outside providers via OpenRouter, see privacy/i, berget: /Berget AI in Sweden, with OpenRouter in the United States as a fallback, see privacy/i, 'berget-only': /Berget AI in Sweden, see privacy/i }[TX_PROVIDER]
  check(`pricing: server transcription via ${TX_PROVIDER}, see privacy, with the allowance (10 hours of audio per person, shared daily budget), failures not charged`,
    prRoute.test(pr) && /free while we test: up to 10 hours of audio per person, within a daily budget shared by everyone/i.test(pr) && !/promise nothing free/i.test(pr) &&
    /A transcription that fails is not counted against that allowance and is not charged to you/.test(pr) && (TX_PROVIDER === 'berget-only' ? !/OpenRouter/.test(pr) : /OpenRouter/.test(pr)))
  check('pricing: marketplace is coming soon, fee 80 percent of what others charge, no 1 %', /Coming soon: fee, 80 percent of what others charge/.test(pr) && /our fee is 80 percent of what others charge/.test(pr) && !/1 %/.test(pr))
  check('pricing: its own links stay on the hosting site, the marketplace link goes to the website',
    (await page.locator('a[href="privacy.html#server"]').count()) === 1 && (await page.locator('a[href="https://trustintheweb.org/#uc-marketplace"]').count()) === 1)
  await page.goto(BASE + 'feedback.html')
  check('com feedback: the kind list says "Pricing or an agreement for your group", value pricing',
    await page.evaluate(() => { const o = document.querySelector('#fb-kind option[value="pricing"]'); return o?.textContent === 'Pricing or an agreement for your group' }))
  await page.goto(BASE + 'imprint.html')
  const imp = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  check('com imprint: the same imprint (name, Einzelunternehmen, Vienna)', /Jakob Possert-Bienzle/.test(imp) && /Einzelunternehmen \(Austrian EPU\)/.test(imp) && /Vienna, Austria/.test(imp))
}

async function contentChecksOrg(page) {
  await page.goto(BASE)
  const ids = await page.evaluate(() => ['source-code', 'licence', 'features', 'use-cases', 'team', 'ea-groups', 'useful',
    'f-web', 'f-ask', 'f-record', 'f-notes', 'f-inventory', 'f-backup', 'faq', 'join', 'lineage',
    'uc-events', 'uc-introductions', 'uc-marketplace', 'uc-housing', 'uc-quests', 'uc-resources', 'uc-curations'].filter((i) => !document.getElementById(i)))
  check('index: every anchor the footer and use-case cards need exists', ids.length === 0, ids.join(', '))
  const text = await page.evaluate(() => document.body.innerText)
  check('index: Source code statement (will be published as part of EvoBioSys, public copy older)', /published as part of EvoBioSys/.test(text) && /older than the live app/.test(text))
  const lic = (await page.evaluate(() => document.getElementById('licence')?.innerText ?? '')).replace(/\s+/g, ' ')
  check('index: licence line is AGPL, dual licensing under the Adapted Modular Public License on request, cost for well-funded organisations from a 100k budget',
    lic === 'Licence: AGPL. Dual licensing under the Adapted Modular Public License on request; for well-funded organisations (budget from 100k per year) at a cost.', lic)
  check('index: AMPL is no longer called the licence of the open source copy', !/open source\s*\(under the Adapted/i.test(text.replace(/\s+/g, ' ')))
  const mk = await page.evaluate(() => document.getElementById('uc-marketplace')?.innerText.replace(/\s+/g, ' ') ?? '')
  check('index: Marketplace says coming soon and "Fee: 80 percent of what others charge" (confirmed by Jakob 11:44 and the intake report), no 1 %', /Coming soon/i.test(mk) && /Fee: 80 percent of what others charge\./.test(mk) && !/1 %|1 percent/.test(mk), mk)
  check('index: join form still at the bottom', await page.evaluate(() => !!document.querySelector('#join #join-form')))
  // wave 2 (B10): the first line under the name leads with finding people and things through people you trust
  const lead = await page.evaluate(() => {
    const l = document.querySelector('.hero .herolead'), ex = document.querySelector('.hero .heroex')
    return { text: l?.textContent.trim(), before: !!(l && ex && (l.compareDocumentPosition(ex) & Node.DOCUMENT_POSITION_FOLLOWING)) }
  })
  check('index: first line leads with "Find people and things through people you trust"', lead.text === 'Find people and things through people you trust.' && lead.before, String(lead.text))
  // wave 3: the hero says what it can do today, asking first, with a link "the vision" to why.html
  const today = await page.evaluate(() => {
    const box = document.querySelector('.hero .herotoday')
    const items = [...(box?.querySelectorAll('li') ?? [])].map((li) => li.querySelector('b')?.textContent.trim())
    const link = [...(box?.querySelectorAll('a') ?? [])].find((a) => a.textContent.trim() === 'the vision')
    return { heading: box?.querySelector('.herotoday-h')?.textContent.trim(), items, link: link?.getAttribute('href') }
  })
  check('index: hero says what it can do today: call into your web FIRST, then people you trust, record and keep a meeting, inventory',
    today.heading === 'What it can do today' && today.items.join('|') === 'Call into your web|Keep the people you trust|Record and keep a meeting|Keep an inventory', JSON.stringify(today))
  check('index: the hero links "the vision" to why.html', today.link === 'why.html', String(today.link))
  const always = await page.evaluate(() => { const a = document.querySelector('.hero a.alwayslink'); return { text: a?.textContent, href: a?.getAttribute('href'), tag: a?.closest('p')?.textContent.replace(/\s+/g, ' ').trim() } })
  const wantAlways = SITE_HOST === 'trustintheweb.org' && mode === 'prod' ? 'https://trustintheweb.org/whitepaper.html#bonobos' : 'whitepaper.html#bonobos'
  check(`index: "always" in "We have always trusted our friends" links to the white paper's bonobo section (${wantAlways})`,
    always.text === 'always' && always.href === wantAlways && /^We have always trusted our friends/.test(always.tag ?? ''), JSON.stringify(always))
  // order: querying first in the features and use-case lists, the footer, and how it works
  const order = await page.evaluate(() => ({
    features: [...document.querySelectorAll('#features .fcard')].map((c) => c.id),
    useCases: [...document.querySelectorAll('#use-cases .ucard')].map((c) => c.id),
    featureTitles: [...document.querySelectorAll('#features .fcard h3')].map((h) => h.textContent.trim()),
    footerFeatures: [...document.querySelectorAll('.sitefooter .sf-col:first-child a')].map((a) => a.textContent.trim()),
    footerFeatureHrefs: [...document.querySelectorAll('.sitefooter .sf-col:first-child a')].map((a) => a.getAttribute('href')),
    footerUse: [...document.querySelectorAll('.sitefooter .sf-col:nth-child(3) li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()),
    coin: [...document.querySelectorAll('.coin .side h3')].map((h) => h.textContent.trim()) }))
  check('index: the feature grid has exactly six cards in Jakob\'s order: Your web of connections, Call into your web, Record a meeting, Transcribe and send a meeting, Inventory, Encrypted Swiss backup',
    order.featureTitles.join('|') === 'Your web of connections|Call into your web|Record a meeting|Transcribe and send a meeting|Inventory|Encrypted Swiss backup' && order.features.join(',') === 'f-web,f-ask,f-record,f-notes,f-inventory,f-backup', order.featureTitles.join('|'))
  check('index: the footer Features list is the same six, in the same order, each linking to its card',
    order.footerFeatures.join('|') === order.featureTitles.join('|') && order.footerFeatureHrefs.join(',') === './#f-web,./#f-ask,./#f-record,./#f-notes,./#f-inventory,./#f-backup', order.footerFeatures.join('|'))
  check('index: use cases lead with Introductions (asking) before Events and Marketplace', order.useCases[0] === 'uc-introductions' && order.useCases.indexOf('uc-introductions') < order.useCases.indexOf('uc-events'), order.useCases.join(','))
  check('index: the footer Use cases list: Introductions first, "Coordinating Quests" in place of QuestHub', order.footerUse.join('|') === 'Introductions|Events|Sharing resources|Finding housing planned|Marketplace coming soon|Coordinating Quests|Info sharing as curations', order.footerUse.join('|'))
  check('index: how it works puts Querying before Taking notes', order.coin.join('|') === 'Querying|Taking notes', order.coin.join('|'))
  check('index: Introductions is a use-case card AND a footer entry', order.useCases.includes('uc-introductions') && order.footerUse.includes('Introductions'))
  // wave 2 (P29, P32): contact methods
  check('index: contact methods (QR code and link now, moving QR code soon, NFC/Bluetooth/AirDrop later)',
    /QR code, which shows that you met/.test(text) && /link for people you are not meeting in person/.test(text) &&
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
  check('index: the lineage "you are here" link and the app links follow the build (self URL, app base)',
    await page.evaluate(([self, app]) => document.querySelector('a.lineage-here-link')?.getAttribute('href') === self && document.querySelectorAll(`a[href="${app}/demo/"]`).length >= 5,
      [SITE_HOST === 'idea2.site' ? 'https://idea2.site/trustweb/' : `https://${SITE_HOST}/`, APP]))
  // pricing is gone from the website
  check('org: no pricing page is built', !pageNames.includes('pricing.html'), pageNames.join(','))
  // wave 2: FAQ (10 questions since wave 3) and privacy (OpenRouter)
  await page.goto(BASE + 'faq.html')
  const faq = await page.evaluate(() => ({ n: document.querySelectorAll('details.q').length, ids: [...document.querySelectorAll('details.q')].map((d) => d.id),
    text: document.body.innerText + [...document.querySelectorAll('details.q')].map((d) => d.textContent).join(' ') }))
  check('faq: exactly 10 questions, "what motivates people" and the app-fatigue question are gone',
    faq.n === 10 && new Set(faq.ids).size === 10 && !faq.ids.includes('q-incentive') && !faq.ids.includes('q-need-it') &&
    !/Was motiviert die Leute|What makes people put their information in|worn out by apps|Brauche ich das wirklich/.test(faq.text), faq.ids.join(','))
  check('faq: Facebook one-liner, revenue "being worked out", German brackets, no pricing link', /Facebook lets you repost\. TrustWeb lets you ask/.test(faq.text) && /Being worked out\./.test(faq.text) && /\(Ist das nicht Facebook/.test(faq.text) &&
    (await page.locator('a[href*="pricing"]').count()) === 0)
  check('faq: nothing says multi-degree querying works today', !/travels? (further|on) .{0,40}today/i.test(faq.text) && /Today a question reaches the people you are directly connected with/.test(faq.text))
  check('faq: Q1 and the introductions question keep "a question reaches the people you are directly connected with" and point to the demo walkthrough',
    (faq.text.replace(/\s+/g, ' ').match(/a question reaches the people you are directly connected with; the demo walkthrough shows a scripted example of the next step/gi) ?? []).length >= 2 && !/Jonas/.test(faq.text))
  check('faq: audience of a line is acquaintances (everyone in your rings), friends, close friends, or only you',
    /acquaintances \(everyone in your rings\), friends, close friends, or only you/.test(faq.text.replace(/\s+/g, ' ')))
  check('faq: import lines are "unreviewed" until kept, typed or recorded lines are "created step by step"',
    /unreviewed until you keep them/.test(faq.text.replace(/\s+/g, ' ')) && /created step by step/.test(faq.text.replace(/\s+/g, ' ')))
  check('faq: web fallback exists (Google, Ecosia, Qwant, Brave; labelled untrusted; nothing sent before a tap; no referrer) and the trusted answer comes first',
    (() => { const t = faq.text.replace(/\s+/g, ' '); return /Search the web instead/.test(t) && /Google, Ecosia, Qwant and Brave/.test(t) && /untrusted/.test(t) && /nothing is sent to any engine until you tap one/.test(t) && /no referrer/.test(t) &&
    /The trusted answer comes first\. The open web only comes second\./.test(t) && !/not in the app yet|is planned and not/.test(t) && !/calls no search service/.test(t) && /Show results here/.test(t) && /a Brave based search engine/.test(t) })())
  check('faq: the feed is optional, early and off by default', /optional and early: it is off by default/.test(faq.text.replace(/\s+/g, ' ')))
  await page.goto(BASE + 'why.html')
  const why = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  check('why: "scalable" says built for one hop further with today\'s limit, not that it travels hop by hop today', /is built so a question can travel one hop further/.test(why) && /Today a question reaches your direct connections/.test(why))
  check('why: labelled as the vision, keeps the full picture, points to what works today', /The vision/.test(why) && /where TrustWeb is headed/.test(why) && (await page.locator('a[href="./#features"]').count()) === 1)
  await page.goto(BASE + 'whitepaper.html')
  const wp = await page.evaluate(() => ({ h2: document.querySelector('#bonobos h2')?.textContent.trim(), line: document.querySelector('#bonobos p:not(.eyebrow)')?.textContent.trim() }))
  check('whitepaper: a placeholder page whose #bonobos section has a heading and one honest line "Outline in progress."', /Bonobos/.test(wp.h2 ?? '') && wp.line === 'Outline in progress.', JSON.stringify(wp))
  await page.goto(BASE + 'imprint.html')
  const imp = await page.evaluate(() => document.querySelector('#operator dd')?.innerText.replace(/\s+/g, ' ').trim())
  check('imprint: the name with "Einzelunternehmen (Austrian EPU), part of EvoBioSys" under it', imp === 'Jakob Possert-Bienzle Einzelunternehmen (Austrian EPU), part of EvoBioSys', String(imp))
  await page.goto(BASE + 'feedback.html')
  check('org feedback: the kind list says "Hosting or an agreement for your group" (no pricing word on the website)',
    await page.evaluate(() => document.querySelector('#fb-kind option[value="pricing"]')?.textContent === 'Hosting or an agreement for your group'))
  await page.goto(BASE)
  const hero = await page.evaluate(() => [...document.querySelectorAll('.term .pop')].map((p) => p.textContent.replace(/\s+/g, ' ')).join(' | '))
  check('index: the "more scalable" popup says built for one hop further, today direct connections', /is built so a question can travel one hop further, with consent at each step \(today it reaches your direct connections; the demo shows the next hop\)/.test(hero))
}

// ---- wave 5 (Jakob 2026-10-07 15:37): the main page items, org only ----
async function wave5OrgChecks(page) {
  await page.goto(BASE)
  const w = await page.evaluate(() => {
    const note = document.querySelector('#join .joinnote')?.textContent.trim()
    const faq = document.getElementById('faq')
    const qs = [...document.querySelectorAll('#faq details.q')]
    const all = [...document.querySelectorAll('#faq a')].find((a) => /All questions/.test(a.textContent))
    const useText = document.getElementById('use-cases')?.innerText.replace(/\s+/g, ' ') ?? ''
    const outsideLineage = (() => { const c = document.body.cloneNode(true); for (const s of c.querySelectorAll('#lineage, #team, footer, script, style')) s.remove(); return c.textContent })()
    return {
      note, button: document.getElementById('j-submit')?.textContent.trim(), heading: document.querySelector('#join h2')?.textContent.trim(),
      faqPresent: !!faq, faqIds: qs.map((d) => d.id), faqClosed: qs.every((d) => !d.open), allHref: all?.getAttribute('href'),
      faqAfterUse: !!(document.getElementById('use-cases') && faq && (document.getElementById('use-cases').compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING)),
      questhubCard: !!document.getElementById('uc-questhub'), questsTitle: document.querySelector('#uc-quests h3')?.textContent.trim(), useText,
      questhubOutside: /QuestHub/i.test(outsideLineage), barBrandText: document.querySelector('.sitebar')?.textContent.replace(/\s+/g, ' ').trim(),
      heroWordmark: document.querySelector('header.hero h1.wot')?.textContent.replace(/\s+/g, ' ').trim(),
    }
  })
  check('main page: waitlist copy is exactly "You can use it right now. If you want to be notified once it is stable, leave your email here."',
    w.note === 'You can use it right now. If you want to be notified once it is stable, leave your email here.', String(w.note))
  check('main page: the notify box reads as the notice for the production build (button "Notify me", heading about being told when it is stable)', w.button === 'Notify me' && /stable/.test(w.heading ?? ''), `${w.button} / ${w.heading}`)
  check('main page: FAQ is a section (id faq) after the use cases, with the same 10 questions as faq.html, all closed, and an "All questions" link to faq.html',
    w.faqPresent && w.faqIds.length === 10 && new Set(w.faqIds).size === 10 && w.faqClosed && w.allHref === 'faq.html' && w.faqAfterUse, w.faqIds.join(','))
  await page.goto(BASE + 'faq.html')
  const pageIds = await page.evaluate(() => [...document.querySelectorAll('details.q')].map((d) => d.id))
  check('faq.html still exists with the same question ids as the main page section', pageIds.join(',') === w.faqIds.join(','), pageIds.join(','))
  check('main page: use case "QuestHub" is now "Coordinating Quests" (no uc-questhub card, QuestHub named nowhere outside the lineage and the team text)',
    !w.questhubCard && w.questsTitle === 'Coordinating Quests' && !/QuestHub/i.test(w.useText) && !w.questhubOutside, JSON.stringify([w.questhubCard, w.questsTitle, w.questhubOutside]))
  check('main page: the hero keeps the big wordmark "Trust in the Web", the bar has no site name', w.heroWordmark === 'Trust in the Web' && !/TrustInTheWeb\.org/.test(w.barBrandText), `${w.heroWordmark} / ${w.barBrandText}`)
}

// ---- lineage: overlapping fields, in both schemes, at the narrowest width ----
const lineageInPage = () => {
  const svg = document.querySelector('.lineage-svg')
  if (!svg) return { ok: false }
  const vb = svg.viewBox.baseVal
  const scale = svg.getBoundingClientRect().width / vb.width
  const parse = (c) => { const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/); return m ? [+m[1], +m[2], +m[3]] : null }
  const circles = Object.fromEntries([...svg.querySelectorAll('circle.fld')].map((c) => [c.getAttribute('class').split(/\s+/).find((x) => x.startsWith('fld-')), { x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r'), stroke: parse(getComputedStyle(c).stroke) }]))
  const texts = [...svg.querySelectorAll('text')].map((el) => {
    const b = el.getBBox(), cs = getComputedStyle(el)
    return { text: el.textContent.trim(), px: parseFloat(cs.fontSize) * scale, fill: parse(cs.fill), halo: parse(cs.stroke), inBox: b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vb.width + 0.5 && b.y + b.height <= vb.height + 0.5, cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width }
  })
  const paper = parse(getComputedStyle(document.body).backgroundColor)
  return { ok: true, scale, vb: [vb.width, vb.height], circles, texts, paper, caption: svg.parentElement.querySelector('figcaption')?.textContent.trim(), titled: !!svg.querySelector('title') && !!svg.querySelector('desc'), role: svg.getAttribute('role'), svgText: svg.outerHTML }
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const overlaps = (a, b) => dist(a, b) < a.r + b.r
async function lineageChecks(browser) {
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 1280]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme })
      const page = await ctx.newPage()
      await page.goto(BASE)
      await page.locator('#lineage').scrollIntoViewIfNeeded()
      const L = await page.evaluate(lineageInPage)
      const tag = `lineage (${scheme} scheme, ${width}px)`
      if (!L.ok) { check(`${tag}: the SVG exists`, false); await ctx.close(); continue }
      const c = L.circles
      check(`${tag}: four overlapping fields: EvoBioSys and the others overlap, QuestHub sits in both, TrustWeb overlaps the lens of the first two`,
        Object.keys(c).sort().join(',') === 'fld-evo,fld-others,fld-quest,fld-tw' && overlaps(c['fld-evo'], c['fld-others']) && overlaps(c['fld-quest'], c['fld-evo']) && overlaps(c['fld-quest'], c['fld-others']) &&
        dist(c['fld-quest'], c['fld-evo']) + c['fld-quest'].r <= c['fld-evo'].r && dist(c['fld-quest'], c['fld-others']) + c['fld-quest'].r <= c['fld-others'].r &&
        (overlaps(c['fld-tw'], c['fld-evo']) && overlaps(c['fld-tw'], c['fld-others'])), JSON.stringify(c))
      check(`${tag}: caption is "EvoBioSys is Jakob's field; it overlaps with the fields of other people"`, L.caption === "EvoBioSys is Jakob's field; it overlaps with the fields of other people", String(L.caption))
      check(`${tag}: the labels are EvoBioSys, Other people's fields, QuestHub where they meet, TrustWeb`,
        L.texts.map((x) => x.text).join(' ') === "EvoBioSys Jakob's field Other people's fields QuestHub where they meet TrustWeb you are here", L.texts.map((x) => x.text).join('|'))
      check(`${tag}: every label renders at 12px or larger (smallest ${Math.min(...L.texts.map((x) => x.px)).toFixed(1)}px) and sits inside the figure`, L.texts.every((x) => x.px >= 12 && x.inBox), L.texts.filter((x) => x.px < 12 || !x.inBox).map((x) => x.text).join(', '))
      const lows = L.texts.filter((x) => ratio(x.fill, x.halo) < 4.5 || ratio(x.fill, L.paper) < 4.5)
      check(`${tag}: label colour on its paper halo and on the page is WCAG AA (worst ${Math.min(...L.texts.map((x) => ratio(x.fill, x.halo))).toFixed(2)})`, lows.length === 0, lows.map((x) => x.text).join(', '))
      const edge = Object.entries(c).filter(([, v]) => ratio(v.stroke, L.paper) < 3)
      check(`${tag}: circle edges are at least 3:1 against the page (worst ${Math.min(...Object.values(c).map((v) => ratio(v.stroke, L.paper))).toFixed(2)})`, edge.length === 0, edge.map(([k]) => k).join(', '))
      check(`${tag}: accessible (role img, title and description) and no em dash`, L.titled && L.role === 'img' && !/—|&mdash;/.test(L.svgText))
      if (width === 360) {
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        check(`${tag}: no horizontal scroll`, fits)
        fs.mkdirSync(shots, { recursive: true })
        await page.locator('#lineage').screenshot({ path: path.join(shots, `${liveBase ? 'live-' : ''}${mode}_lineage_${scheme}_${width}.png`) })
      }
      await ctx.close()
    }
  }
}

// ---- wave 5: the four legal pages say what the code and the servers do ----
async function legalChecks(page) {
  const text = async (name) => { await page.goto(BASE + name); return page.evaluate(() => document.querySelector('main').innerText.replace(/\s+/g, ' ')) }
  const pv = await text('privacy.html')
  check('privacy: controller named, GDPR rights, complaint to the Austrian Datenschutzbehoerde (link), legal bases in plain words',
    /Verantwortlicher/.test(pv) && /Jakob Possert-Bienzle/.test(pv) && /erasure|delete it \(erasure\)/.test(pv) && /Datenschutzbehörde/.test(pv) && (await page.locator('a[href="https://www.dsb.gv.at"]').count()) === 1 &&
    /Legal bases, in plain words/.test(pv) && /Art\. 6\(1\)\(b\)/.test(pv) && /Art\. 6\(1\)\(a\)/.test(pv) && /Art\. 6\(1\)\(f\)/.test(pv))
  check('privacy: the per-address counters are said to be in memory and NOT anonymous; no "anonymous counters" claim anywhere', /not anonymous/.test(pv) && !/anonymous (in-memory )?counters/i.test(pv))
  check('privacy: relay hold time (72 hours), front doors (demo and personal), short links (30 days, random id, never logged), newsletter unsubscribe deletes, no cookies and nothing stored in the browser',
    /72 hours/.test(pv) && /two, both run by the person named in the imprint: the "Demo inventory"/.test(pv) && /personal one/.test(pv) && /under a random ten-character id for up to 30 days/.test(pv) && /do not write the link or its id to any log/.test(pv) &&
    /unsubscribe link in any newsletter email, which deletes your address/.test(pv) && /nothing stored in your browser/.test(pv))
  check('privacy: the web server keeps no access log; its error log can note the address; no "the web server writes no access log" overclaim and no "only in memory" claim for addresses without the error-log caveat',
    /keeps no access log/.test(pv) && /error log, in the server's system journal, can note the network address/.test(pv))
  check('privacy: server hosting is Infomaniak in Switzerland; US providers flagged "to confirm" for the transfer safeguards', /Infomaniak/.test(pv) && /safeguards for a transfer of personal data out of the EU/.test(pv) && (await page.locator('.tbc').count()) >= 2)
  const dp = await text('data-policy.html')
  const sections = await page.evaluate(() => [...document.querySelectorAll('section[id^="d-"]')].map((s) => ({ id: s.id, dts: [...s.querySelectorAll('dt')].map((d) => d.textContent.trim()).join('|') })))
  check('data policy: sixteen data kinds, each answering What / Where / How long / Who can read it / How to delete it',
    sections.length === 16 && sections.every((s) => s.dts === 'What|Where|How long|Who can read it|How to delete it'), sections.map((s) => `${s.id}:${s.dts.split('|').length}`).join(' '))
  check('data policy: says what the code does (90 days by hand not on a timer, 72 hours relay, 30 days short links, per-recording delete in the app, 14-day newsletter snapshot, Caddy keeps no access log, counters not anonymous, no cookies)',
    /not on a timer yet/.test(dp) && /72 hours at most/.test(dp) && /30 days, then it stops working/.test(dp) && /remove the recording; it is deleted from the server at once/.test(dp) && /for 14 days/.test(dp) && /Caddy\) keeps no access log/.test(dp) && /not anonymous/.test(dp) && /No cookies/.test(dp))
  check('data policy: unsettled facts are marked "to confirm" (backup deletion, retention, journal limit, snapshots by the host)', (await page.locator('.tbc').count()) >= 6, String(await page.locator('.tbc').count()))
  if (pageNames.includes('terms.html')) {
    const tm = await text('terms.html')
    const title = await page.title()
    check('terms: binding web-results sentence, AGPL-3.0-or-later with dual licence on request, freemium limits (10 recordings, 1 hour, 90 days), no warranty "to the extent the law allows", no "draft, not in force"',
      /you agree not to scrape, store, cache or redistribute the results\. They come from Brave, and they are shown only to you, for the moment\./.test(tm) && /AGPL-3\.0-or-later/.test(tm) && /dual licence/.test(tm) && /10 recordings of up to 1 hour each/.test(tm) && /90 days/.test(tm) &&
      /To the extent the law allows, we give no warranty/.test(tm) && !/not in force|Draft, not/i.test(tm) && !/draft\)/i.test(title) && !/draft terms/i.test(await page.evaluate(() => document.querySelector('meta[name=description]').content)), title)
  }
  const im = await text('imprint.html')
  const ph = await page.evaluate(() => [...document.querySelectorAll('.tbc')].filter((e) => /to be completed by the owner/.test(e.textContent)).length)
  check('imprint: every missing legal field is a visibly flagged "[to be completed by the owner]" (postal address, UID, register, trade, seat, purpose), none invented (no street, postcode, UID or phone number)',
    ph >= 6 && !/\b\d{4}\s+Wien\b|ATU\s?\d{8}|\+\d{2}[\s\d]{6,}|\bFN\s?\d+|\b\d{1,3}\s?\/\s?\d{1,3}\b|(?:straße|strasse|gasse|platz)\s+\d/i.test(im) && /Einzelunternehmen/.test(im) && /Vienna, Austria/.test(im), `${ph} placeholders`)
}

async function contentChecks(browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await everyPageChecks(page)
  if (ORG) await contentChecksOrg(page)
  else await contentChecksCom(page)
  if (ORG) await wave5OrgChecks(page)
  await legalChecks(page)
  await page.goto(BASE + 'privacy.html')
  const fbp = await page.evaluate(() => document.getElementById('site')?.textContent.replace(/\s+/g, ' ') ?? '')
  check('privacy: feedback form bullets (email only with a box, stored in Switzerland, write back / notify / newsletter via the newsletter service with confirmation)',
    /your email address only if you tick a box|email address only if you tick a box/.test(fbp) && /stored on our server in Switzerland/.test(fbp) && /Write back to me about this message": we keep your address so we can answer/.test(fbp) &&
    /Notify me when it is ready": we keep it for one note when TrustWeb is ready/.test(fbp) && /our server passes it on to our newsletter service, which first sends you a confirmation email/.test(fbp) && /only after you click the link in it/.test(fbp) && !/our waitlist/.test(fbp))
  const wr = await page.evaluate(() => document.getElementById('web-results')?.textContent.replace(/\s+/g, ' ') ?? '')
  check('privacy: "Using web results" (production page, not draft-gated): binding sentence, words go to Brave Search without the address, Brave may log them, we keep no copy, Powered by Brave',
    /you agree not to scrape, store, cache or redistribute the results\. They come from Brave, and they are shown only to you, for the moment\./.test(wr) && /Show results here/.test(wr) &&
    /go through our server to Brave Search, a Brave based search engine, without your network address\. Brave may log them under its own terms/.test(wr) &&
    /keeps no copy of your words or of the results/.test(wr) && /Powered by Brave/.test(wr) && !/Mojeek/i.test(wr), wr.slice(0, 120))
  check('privacy: Brave is named in the third-party list', await page.evaluate(() => /Brave Software/.test(document.getElementById('third-parties')?.textContent ?? '')))
  check(`privacy: fonts line matches the site (${ORG ? 'Google Fonts named' : 'device typefaces, Google not named'})`,
    await page.evaluate((org) => { const t = document.body.textContent; return org ? /Typefaces load from Google Fonts/.test(t) : /Typefaces come from your own device/.test(t) && !/Google Fonts/.test(t) }, ORG))
  const pv = await page.evaluate(() => document.getElementById('transcription')?.textContent.replace(/\s+/g, ' ') ?? '')
  const pvCommon = /Free while we test: up to 10 hours of audio per person, within a daily budget shared by everyone/.test(pv) && /not charged to you/.test(pv) && /keeps neither the audio nor the text/.test(pv) && /approximate/.test(pv) && !/Infomaniak|Switzerland/.test(pv)
  const pvOr = /OpenRouter/.test(pv) && /United States/.test(pv) && /OpenRouter picks which one; we cannot/.test(pv) && !/DeepInfra|Groq|Together/.test(pv) && /"deny"/.test(pv)
  const pvBerget = /Berget AI/.test(pv) && /Sweden/.test(pv)
  const pvOk = TX_PROVIDER === 'openrouter' ? pvOr && !/Berget/i.test(pv) : TX_PROVIDER === 'berget' ? pvBerget && pvOr : pvBerget && !/OpenRouter|United States/.test(pv)
  check(`privacy: transcription route is ${TX_PROVIDER} (names only the provider that runs), nothing kept by us, approximate times, failures not charged, no Infomaniak/Switzerland claim`, pvOk && pvCommon, pv.slice(0, 120))
  if (pageNames.includes('terms.html')) {
    await page.goto(BASE + 'terms.html')
    const tm = await page.evaluate(() => document.getElementById('web-results')?.textContent.replace(/\s+/g, ' ') ?? '')
    check('terms: the web results section binds users: not scrape, store, cache or redistribute; from Brave; Powered by Brave',
      /you agree not to scrape, store, cache or redistribute the results\. They come from Brave, and they are shown only to you, for the moment\./.test(tm) && /Powered by Brave/.test(tm), tm.slice(0, 100))
  }
  await ctx.close()
}

// ---- the hosting site's own face: inverse palette, other typefaces, WCAG AA contrast, in both system schemes ----
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
// every text-bearing thing a visitor reads, with the size class it is judged by (AA: 4.5, large text 3)
const CONTRAST_TARGETS = [
  ['body text', 'main p', 4.5], ['section heading', 'section h2', 4.5], ['page heading', 'h1:not(.wot)', 3], ['wordmark', 'h1.wot .wm-b', 3],
  ['eyebrow', 'section .eyebrow', 4.5], ['link in text', 'main a:not(.btn-primary):not(.btn-ghost):not(.back)', 4.5], ['back link', 'a.back', 4.5],
  ['primary button', '.btn-primary', 4.5], ['ghost button', '.btn-ghost', 4.5], ['bar Demo', '.tw-btn-demo', 4.5], ['bar Install', '.tw-btn-install', 4.5],
  ['bar link to the other site', '.hostlink', 4.5], ['AI draft banner', '.banner.ai-draft', 4.5], ['AI draft banner label', '.banner.ai-draft b', 4.5], ['to confirm chip', '.tbc', 4.5],
  ['FAQ question', '#faq details.q summary', 4.5], ['FAQ answer', '#faq details.q p', 4.5], ['lineage caption', '.lineage-wrap figcaption', 4.5], ['notify note', '.joinnote', 4.5], ['stamp', '.stamp', 4.5], ['draft strip', '.draftstrip', 4.5],
  ['fact label', 'dl.facts dt', 4.5], ['table cell', 'table.plain td', 4.5], ['note', 'section p.note', 4.5], ['list item', 'main li', 4.5],
  ['footer heading', '.sitefooter .sf-h', 4.5], ['footer link', '.sitefooter a', 4.5], ['footer brand text', '.sf-brand p', 4.5], ['footer fine print', '.sf-fine', 4.5],
  ['footer love line', '.sf-love', 4.5], ['footer tag', '.sf-soon', 4.5],
]
const contrastInPage = (targets) => {
  const parse = (c) => { const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null }
  const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)) }
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] === 1) break } }
    let base = [255, 255, 255]; for (const c of stack.reverse()) base = over(c, base); return base }
  const out = []
  for (const [label, sel, min] of targets) {
    for (const el of document.querySelectorAll(sel)) {
      if (!el.textContent.trim() || el.closest('.skip, .hp, [hidden]') || getComputedStyle(el).display === 'none') continue
      const fg = parse(getComputedStyle(el).color); if (!fg) continue
      const bg = bgOf(el), flat = over(fg, bg)
      out.push({ label, sel, min, fg: flat.map(Math.round), bg: bg.map(Math.round), text: el.textContent.trim().slice(0, 24) })
    }
  }
  const body = getComputedStyle(document.body)
  const h1 = document.querySelector('h1')
  return { items: out, bodyBg: parse(body.backgroundColor), bodyFont: body.fontFamily, h1Font: h1 ? getComputedStyle(h1).fontFamily : '', btn: (() => { const i = document.querySelector('.tw-btn-install'); return i ? { bg: parse(getComputedStyle(i).backgroundColor), font: getComputedStyle(i).fontFamily } : null })() }
}

async function contrastChecks(browser) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })
    const page = await ctx.newPage()
    const lows = [], seen = new Set()
    let worst = 99, count = 0
    for (const name of pageNames) {
      await page.goto(BASE + (name === 'index.html' ? '' : name))
      const r = await page.evaluate(contrastInPage, CONTRAST_TARGETS)
      for (const it of r.items) {
        const cr = ratio(it.fg, it.bg); count++
        worst = Math.min(worst, cr)
        if (cr < it.min) lows.push(`${name} ${it.label} ${it.text} ${cr.toFixed(2)} (${it.fg} on ${it.bg})`)
        seen.add(it.label)
      }
      if (name === pageNames[0] && !ORG) {
        const L = lum(r.bodyBg.slice(0, 3))
        check(`com look (system ${scheme}): the page is ${scheme === 'light' ? 'DARK (inverse of the website, which is cream)' : 'LIGHT (inverse of the website, which is navy)'}`, scheme === 'light' ? L < 0.05 : L > 0.5, `body background ${r.bodyBg}`)
        check(`com look (system ${scheme}): own typefaces, not the website's (display ${r.h1Font.slice(0, 40)}; text ${r.bodyFont.slice(0, 40)})`,
          /Avenir Next|Segoe UI|Helvetica Neue/.test(r.h1Font) && /Charter|Iowan|Georgia|Cambria|Sitka/.test(r.bodyFont) && !/Fraunces|IBM Plex/.test(r.h1Font + r.bodyFont))
        check(`com look (system ${scheme}): Install button is the swapped primary (${scheme === 'light' ? 'rose' : 'wine red'}), not the website's navy`,
          !!r.btn && (scheme === 'light' ? r.btn.bg[0] > r.btn.bg[2] && r.btn.bg[0] > 200 : r.btn.bg[0] > r.btn.bg[2] * 2 && r.btn.bg[0] > 120), JSON.stringify(r.btn))
      }
    }
    check(`${SITE} contrast (system ${scheme}): ${count} text samples on ${pageNames.length} pages, ${seen.size} kinds, all at WCAG AA (worst ${worst.toFixed(2)})`, lows.length === 0, lows.slice(0, 4).join(' | '))
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(BASE)
      fs.mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: path.join(shots, `${liveBase ? 'live-' : ''}${mode}_index_${scheme === 'dark' ? 'dark' : 'light'}scheme_${width}.png`), fullPage: true })
    }
    await ctx.close()
  }
}

const server = liveBase ? null : await serve()
const browser = await chromium.launch({ headless: true })
try {
  for (const name of pageNames) for (const w of WIDTHS) await checkPage(browser, name, w)
  await contentChecks(browser)
  await contrastChecks(browser)
  if (ORG) await lineageChecks(browser)
  await formChecks(browser)
  await linkAudit(browser)
} finally {
  await browser.close()
  if (server) await new Promise((resolve) => server.close(resolve))
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
