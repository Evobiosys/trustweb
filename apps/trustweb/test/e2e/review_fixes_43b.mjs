// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b review fixes (headless, stock dev server, synthetic record): PORT=5447 SHOTS=<dir> EXE=<chromium> PLAYWRIGHT_PACKAGE=<path> node review_fixes_43b.mjs.
 * P06 sweep (no two visible controls overlap, clipped to their scrollers and the viewport, shadow roots included) at 360x780 and 1280x900 on:
 * Ask page + audience filter (Advanced open), notifications page, community menu / Home / Chat page / settings, Resources views, the event QR page.
 * Plus the fixes: zones outside the cut struck through (P2), the Hide-from hint when the ask travels further (I7), Play on a protected row without its link (B20),
 * a protected resource offers no QR in its sheet (B17), the event QR states that place / conditions / themes need the link (I7).
 */
const pw = await import(process.env.PLAYWRIGHT_PACKAGE ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default?.chromium
const PORT = process.env.PORT ?? 5447
const URL = `http://127.0.0.1:${PORT}/`
const SHOTS = process.env.SHOTS ?? '/tmp'
const { ringsFirst } = await import('./rings_first.mjs') // wave44c home-default: Home is first, these checks are about the rings
const browser = ringsFirst(await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] }))
let failed = false
const check = (name, cond, info = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ' ' + info}`); if (!cond) failed = true }
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const P = (id, name, ring, fields = {}) => ({ id: 'p-' + id, name, context: '', ring, metAt: 1, lines: [], fields, peerId: id })
const people = [P('cy', 'Cy Probe', 'closest', { iyg: 'true' }), P('di', 'Di Probe', 'close', { iyg: 'true' }), P('ed', 'Ed Probe', 'friend'), P('an', 'Anna Probe', 'acquaintance')]
const peers = people.map((p) => ({ id: p.peerId, displayName: p.name, did: 'did:test:' + p.peerId, ring: 'friend', connectedAt: Date.now() - 3600e3 }))
const tags = [{ id: 'iyg', colour: '#13847C', label: 'IYG circle', community: true }, { id: 'family', colour: '#7b1fa2', label: 'family' }]
const EVENT = { id: 'e1', name: 'Winter Probe', from: `${today}T09:30`, to: today, where: 'Probe Hall', conditions: 'Bring a mug', themes: ['soil'], createdAt: 1, attended: true, hosts: ['Tester'], communityId: 'iyg' }
const local = `http://127.0.0.1:${PORT}/#played`
const inventory = [
  { id: 'i1', text: 'Garden tools', audience: 'friends', included: true, createdAt: 1, kind: 'other' },
  { id: 'i2', text: 'A book on soil', audience: 'friends', included: true, createdAt: 2, kind: 'book', sharedBy: 'p-di' },
  { id: 'i3', text: 'Protected talk', audience: 'friends', included: true, createdAt: 3, kind: 'recording', protected: true, link: local },
]
const extData = { 'community-mighty': { tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['me'] } } } }
const record = { v: 1, bwMode: true, me: { id: 'me1', displayName: 'Tester' }, people, peers, log: [], inventory, events: [EVENT], extData,
  chats: { cy: { unread: 1, messages: [{ key: 'k1', dir: 'in', text: 'Hello there', at: Date.now() - 600e3, sentAt: Date.now() - 600e3, state: 'received' }] } } }

/** Every visible control, shadow roots included, its box clipped to the viewport and to every scrolling / clipping ancestor (across shadow hosts). */
const overlaps = (page) => page.evaluate(() => {
  const sel = 'button, input:not([type=hidden]), select, textarea, a[href], summary, [role=switch]'
  const all = []
  const walk = (root) => { all.push(...root.querySelectorAll(sel)); for (const n of root.querySelectorAll('*')) if (n.shadowRoot) walk(n.shadowRoot) }
  walk(document)
  const up = (n) => n.parentElement ?? (n.parentNode instanceof ShadowRoot ? n.parentNode.host : null)
  const clip = (n) => {
    const r = n.getBoundingClientRect()
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom }
    for (let a = up(n); a; a = up(a)) {
      const cs = getComputedStyle(a)
      if (/(auto|scroll|hidden|clip)/.test(cs.overflow + cs.overflowY + cs.overflowX)) {
        const q = a.getBoundingClientRect()
        box = { l: Math.max(box.l, q.left), t: Math.max(box.t, q.top), r: Math.min(box.r, q.right), b: Math.min(box.b, q.bottom) }
      }
    }
    box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, innerWidth), b: Math.min(box.b, innerHeight) }
    return box.r - box.l > 1 && box.b - box.t > 1 ? box : null
  }
  const shown = (n) => n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && n.getClientRects().length > 0
  // Wave 43c shell-fix-2: no exclusions any more (hint "i", bar ⋮, raised centre tab, demo chip and the requests button were fixed or moved); `known` stays as the hook.
  const known = () => false
  // The community drawer and its veil are a modal layer too (inside the community shadow root).
  const layer = (x) => x?.closest('.page-layer, .sheet.on, [role=dialog], .scrim, .veil, .drawer-open .nav') ?? null
  const deepTop = (x, y) => { let t = document.elementFromPoint(x, y); while (t?.shadowRoot) { const inner = t.shadowRoot.elementFromPoint(x, y); if (!inner || inner === t) break; t = inner } return t }
  const underModal = (n, b) => {
    const top = deepTop((b.l + b.r) / 2, (b.t + b.b) / 2)
    return !!top && !n.contains(top) && !!layer(top) && layer(top) !== layer(n)
  }
  const list = all.filter(shown).filter((n) => !known(n)).map((n) => ({ n, b: clip(n) })).filter((x) => x.b && !underModal(x.n, x.b))
  const hits = []
  const label = (n) => `${n.tagName}[${(n.textContent || n.getAttribute('aria-label') || n.getAttribute('placeholder') || '').trim().slice(0, 20)}]`
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const A = list[i], B = list[j]
    if (A.n.contains(B.n) || B.n.contains(A.n)) continue
    const w = Math.min(A.b.r, B.b.r) - Math.max(A.b.l, B.b.l), h = Math.min(A.b.b, B.b.b) - Math.max(A.b.t, B.b.t)
    if (w > 2 && h > 2) hits.push(`${label(A.n)} x ${label(B.n)}`)
  }
  return hits
})
const sweep = async (page, label) => {
  const scrollers = '.scroll, .sheet.on, .sheet.on *, .page-layer *'
  const steps = await page.evaluate((q) => { const s = [...document.querySelectorAll(q)].filter((n) => n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)); return s.length ? Math.ceil(Math.max(...s.map((n) => n.scrollHeight / Math.max(1, n.clientHeight)))) : 1 }, scrollers)
  const found = new Set()
  for (let i = 0; i < Math.min(steps, 8); i++) {
    await page.evaluate(([q, k]) => { for (const n of document.querySelectorAll(q)) if (n.scrollHeight > n.clientHeight + 4) n.scrollTop = k * n.clientHeight * 0.8 }, [scrollers, i])
    await page.waitForTimeout(120)
    for (const o of await overlaps(page)) found.add(o)
  }
  await page.evaluate((q) => { for (const n of document.querySelectorAll(q)) n.scrollTop = 0 }, scrollers)
  check(`${label}: no two controls overlap`, found.size === 0, [...found].slice(0, 6).join(' | '))
}
const noDocScroll = (page) => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)

try {
  for (const [w, h] of [[360, 780], [1280, 900]]) {
    const phone = w < 600
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: phone, isMobile: phone, deviceScaleFactor: phone ? 2 : 1 })
    const errors = []
    const fresh = async () => {
      const page = await ctx.newPage()
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(URL); await page.waitForTimeout(900)
      await page.evaluate(([r, t]) => { localStorage.setItem('trustweb.v1.me', r); localStorage.setItem('trustweb.v1.colourtags', t); localStorage.setItem('trustweb.ui.webView', 'rings'); sessionStorage.clear() }, [JSON.stringify(record), JSON.stringify(tags)])
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(1100)
      await page.getByText('No thanks').click({ timeout: 1000 }).catch(() => {})
      // a one-off migration notice (older than 43b) is closed first; the sweep checks the screen itself
      for (const x of await page.locator('[data-notice-close]').all()) await x.click({ timeout: 1000 }).catch(() => {})
      return page
    }
    const shot = (page, n) => page.screenshot({ path: `${SHOTS}/review-fixes-43b-${w}-${n}.png` })

    // ---- Ask page + audience filter
    let page = await fresh()
    await page.locator('[data-open-query]').first().click(); await page.waitForTimeout(500)
    check(`${w}: Ask your web is a page`, (await page.locator('[data-ask-page]').count()) === 1)
    await page.locator('[data-aud-zone="close"]').click(); await page.waitForTimeout(300)
    const states = await page.locator('[data-aud-zone]').evaluateAll((b) => b.map((x) => `${x.getAttribute('data-aud-zone')}:${x.getAttribute('data-aud-zone-state')}:${getComputedStyle(x).textDecorationLine.includes('line-through')}`))
    check(`${w}: P2 Close picked: Closest in, Close on, wider zone struck through`, states.join() === 'closest:in:false,close:on:false,friend:off:true', states.join())
    await page.locator('[data-aud-input="exclude"]').fill('@Ed'); await page.waitForTimeout(200)
    await page.locator('[data-aud-pick="person:p-ed"]').click(); await page.waitForTimeout(300)
    check(`${w}: no travel hint while the ask stays with direct contacts`, (await page.locator('[data-aud-hide-travels]').count()) === 0)
    await page.locator('[data-aud-advanced] summary').click(); await page.waitForTimeout(200)
    await page.locator('[data-reach-choice]').nth(1).click(); await page.waitForTimeout(400)
    check(`${w}: I7 Hide from + 2 steps: the hint says a friend may pass it on`, (await page.locator('[data-aud-hide-travels]').count()) === 1)
    await sweep(page, `${w} ask page + filter (Advanced open)`); await shot(page, 'ask')
    for (const id of ['cy', 'di']) { await page.locator('[data-aud-input="exclude"]').fill('@' + id); await page.waitForTimeout(150); await page.locator(`[data-aud-pick="person:p-${id}"]`).click(); await page.waitForTimeout(250) }
    check(`${w}: a filter that reaches nobody says so`, (await page.locator('[data-aud-nobody]').count()) === 1)
    check(`${w}: no document scroll on the Ask page`, !phone || await noDocScroll(page))
    await page.close()

    // ---- notifications page
    page = await fresh()
    await page.locator('[data-notify-bell]').click(); await page.waitForTimeout(500)
    check(`${w}: notifications page open`, (await page.locator('[data-notify-section]').count()) === 4)
    await sweep(page, `${w} notifications page`); await shot(page, 'notify')
    await page.close()

    // ---- community: menu, Home, Chat page, settings
    page = await fresh()
    await page.locator('[data-mode="community"]').click(); await page.locator('[data-community]').waitFor({ timeout: 15_000 }); await page.waitForTimeout(500)
    const menu = async () => { if (phone && (await page.locator('[data-community-menu][aria-expanded="true"]').count()) === 0) { await page.locator('[data-community-menu]').click(); await page.waitForTimeout(200) } }
    await menu()
    await sweep(page, `${w} community menu`); await shot(page, 'community-menu')
    await page.locator('[data-community-nav="home"]').click(); await page.waitForTimeout(300)
    await sweep(page, `${w} community Home`); await shot(page, 'community-home')
    await menu(); await page.locator('[data-community-nav="chat"]').click(); await page.waitForTimeout(400)
    await sweep(page, `${w} community Chat page`); await shot(page, 'community-chat')
    await menu(); await page.locator('[data-community-settings]').click(); await page.waitForTimeout(400)
    await sweep(page, `${w} community settings`); await shot(page, 'community-settings')
    await page.close()

    // ---- Resources views
    page = await fresh()
    await page.locator('[data-go="inventory"]').first().click(); await page.waitForTimeout(600)
    await sweep(page, `${w} resources list`); await shot(page, 'resources-list')
    await page.locator('[data-rv-filters-toggle]').click(); await page.waitForTimeout(300)
    await sweep(page, `${w} resources filters open`)
    check(`${w}: B20 protected row offers Play`, (await page.locator('[data-rv-play="i3"]').count()) === 1)
    const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null)
    await page.locator('[data-rv-play="i3"]').click()
    const opened = await popup
    check(`${w}: Play opens the recording without showing its link`, !!opened && (await page.locator('[data-rv-link]').count()) === 0)
    await opened?.close()
    for (const v of ['outliner', 'person']) { await page.locator(`[data-rv-view="${v}"]`).click(); await page.waitForTimeout(300); await sweep(page, `${w} resources ${v}`) }
    await page.locator('[data-rv-view="list"]').click(); await page.waitForTimeout(300)
    await shot(page, 'resources-protected')
    await page.close()

    // ---- event QR page
    page = await fresh()
    await page.locator('[data-go="events"]').first().click(); await page.waitForTimeout(500)
    await page.getByText('Winter Probe').first().click(); await page.waitForTimeout(500)
    await page.locator('[data-event-qr]').first().click(); await page.waitForTimeout(900)
    const words = await page.locator('body').innerText()
    check(`${w}: I7 the event QR says place / conditions / themes need the link`, /send the event link/i.test(words) && !/follow once you are connected/i.test(words))
    await sweep(page, `${w} event QR page`); await shot(page, 'event-qr')
    await page.close()

    check(`${w}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '))
    await ctx.close()
  }
} catch (e) {
  console.log('FAIL  run aborted:', String(e).split('\n')[0]); failed = true
} finally {
  await browser.close()
}
console.log(failed ? 'SOME FAILED' : 'ALL PASS')
process.exit(failed ? 1 : 0)
