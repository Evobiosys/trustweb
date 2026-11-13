/** Wave 8 rings-zoom (whole Web screen body) proof (headless, dev only): PORT=5316 W=1280 H=900 [SHOT=/path.png] node rings_zoom.mjs. EXE=<chromium headless shell> if the default is not installed; PW=<playwright-core index.mjs>; SHOTS=<dir> for the wave 42 screens (web-zoom-dots-<W>-k<k>.png). */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5316}/`
const W = +(process.env.W ?? 1280), H = +(process.env.H ?? 900)
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 1, lines: [] })
try {
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage()
  const wrap = page.locator('.rings-wrap')
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'acquaintance')])
  await page.reload(); await wrap.waitFor()
  await page.addStyleTag({ content: '.demo-friends { position: fixed !important; top: auto !important; bottom: 0 !important; left: 0; right: 0; z-index: 99 } .twf, .twf-ok, .twp { display: none !important }' })
  const state = () => page.evaluate(() => ({ t: document.querySelector('.rings-zoom').style.transform, z: document.querySelector('.rings-wrap').dataset.ringsZoom, vv: window.visualViewport.scale }))
  const phoneBox = () => page.locator('.phone').boundingBox()
  const box = await wrap.boundingBox()
  const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  // dispatches a wheel at the centre (or `at`) of the element `sel` ('body' = a corner of the phone); true when the page default was prevented
  const wheel = (sel, deltaY, ctrlKey, at) => page.evaluate(([q, d, ctrl, pt]) => {
    const t = document.querySelector(q === 'body' ? '.phone' : q)
    const r = t.getBoundingClientRect()
    const x = pt?.x ?? (q === 'body' ? 4 : r.left + r.width / 2), y = pt?.y ?? (q === 'body' ? 4 : r.top + r.height / 2)
    return !(q === 'body' ? document.body : t).dispatchEvent(new WheelEvent('wheel', { deltaY: d, ctrlKey: ctrl, clientX: x, clientY: y, bubbles: true, cancelable: true }))
  }, [sel, deltaY, ctrlKey, at])
  // the tap target at k = 1: Anna's dot opens her card
  const tapOpens = async (pid) => { await page.locator(`.rings-wrap [data-pid="${pid}"]`).click(); await page.waitForTimeout(400); const t = await page.evaluate(() => document.body.innerText.split('\n').slice(0, 6).join('|')); await page.locator('[data-go="web"]').click(); await page.waitForTimeout(500); return t }   // wave 42: the card is a page now (back = the Web tab), not a sheet with [data-sheet-home]
  const dot = await page.locator('.rings-wrap [data-pid="b1"]').boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
  const first = await tapOpens('b1')
  const firstA = await tapOpens('a1')
  check('taps at k = 1 open two different cards', first.length > 0 && first !== firstA)
  const before = await phoneBox()
  const home = (await state()).z   // the first fit zoom without a phone frame (1 on a phone)
  check('plain wheel over the rings is not prevented, no zoom', !(await wheel('.rings-wrap', -300, false)) && (await state()).z === home)
  check('ctrl+wheel outside the rings is not prevented, no zoom', !(await wheel('body', -300, true)) && (await state()).z === home)
  check('ctrl+wheel over the app header is not prevented, no zoom', !(await wheel('.hdr', -300, true)) && (await state()).z === home)
  check('ctrl+wheel over the tab bar is not prevented, no zoom', !(await wheel('.tabs', -300, true)) && (await state()).z === home)
  const sc = await page.locator('.scroll').boundingBox()
  check('ctrl+wheel on empty Web body space (beside the rings) is prevented and zooms', (await wheel('.scroll', -70, true, { x: sc.x + 6, y: sc.y + 6 })) && +(await state()).z > 1)
  await page.mouse.dblclick(sc.x + 6, sc.y + 6); await page.waitForTimeout(500)
  if (+home === 1) check('dblclick on empty body space returns home', (await state()).z === home); else console.log('SKIP dblclick-home checks: the fit layout (no phone frame) has its own home zoom, covered by rings_fit tests')
  check('ctrl+wheel over the rings is prevented', await wheel('.rings-wrap', -70, true, dot))
  let s = await state()
  check('rings zoomed (scale > 1), ringsZoom > 1', /scale\((?:[2-9]|1\.\d)/.test(s.t) && +s.z > 1)
  check('visualViewport.scale 1', s.vv === 1)
  const after = await phoneBox()
  check('phone box unchanged', JSON.stringify(before) === JSON.stringify(after))
  s = await state()
  if (+home === 1) check('zoom around 2', +s.z > 1.9 && +s.z < 2.1)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  const second = await tapOpens('b1')
  check('tap on the same dot at k > 1 opens the same person', second === first)
  await page.mouse.move(c.x + 60, c.y + 60); await page.mouse.down(); await page.mouse.move(c.x + 90, c.y + 90, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300)
  check('drag pans without opening the add sheet', (await state()).t.includes('translate') && (await page.locator('[data-add-person]').count()) === 0)
  await page.mouse.dblclick(c.x + 100, c.y + 100); await page.waitForTimeout(200)
  s = await state()
  if (+home === 1) check('dblclick returns home', s.z === home)
  await page.waitForTimeout(600)
  check('no add sheet after dblclick', (await page.locator('[data-add-person]').count()) === 0)

  // ---- wave 42 web-zoom-dots: dots, names and overlays follow EVERY zoom path; a phone pinch never zooms the page ----
  const SHOTS = process.env.SHOTS
  const avaW = () => page.evaluate(() => document.querySelector('.node:not(.you) .ava').getBoundingClientRect().width)
  const lblPx = () => page.evaluate(() => { const n = document.querySelector('.node:not(.you)'); return parseFloat(getComputedStyle(n.querySelector('span')).fontSize) * +document.querySelector('.rings-wrap').dataset.ringsZoom })
  const zoomTo = async (target) => {
    for (let i = 0; i < 4; i++) {
      const k = +(await state()).z
      if (Math.abs(k - target) < 0.02) break
      await wheel('.scroll', -Math.log(target / k) * 100, true, { x: sc.x + 6, y: sc.y + 6 })
    }
  }
  const fresh = async () => { await page.reload(); await wrap.waitFor(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900) }
  await fresh()
  const widths = {}, labels = {}
  for (const k of [2, 4]) {
    await zoomTo(k); widths[k] = await avaW(); labels[k] = await lblPx()
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-zoom-dots-${W}-k${k}.png` })
  }
  check(`wave42 ${W}: dot width ratio k4/k2 = 2 +-10 % (${Math.round(widths[2])} -> ${Math.round(widths[4])} px)`, Math.abs(widths[4] / widths[2] - 2) < 0.2)
  check(`wave42 ${W}: label px on screen ratio k4/k2 = 2 +-10 % (${labels[2].toFixed(1)} -> ${labels[4].toFixed(1)})`, Math.abs(labels[4] / labels[2] - 2) < 0.2)
  await fresh()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-zoom-dots-${W}-k1.png` })
  // ring card follows the zoom, stays inside the clip, above the bottom bar, no mid-word title break
  const cardAt = async () => {
    const hit = await page.evaluate(() => { const c = [...document.querySelectorAll('.rings-wrap circle[data-ring]')].sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[2].getBoundingClientRect(); const a = Math.PI * 1.25; return { x: c.x + c.width / 2 + (c.width / 2) * Math.cos(a), y: c.y + c.height / 2 + (c.width / 2) * Math.sin(a) } })
    await page.mouse.move(hit.x - 30, hit.y - 30); await page.mouse.move(hit.x, hit.y, { steps: 4 }); await page.mouse.move(hit.x + 1, hit.y + 1); await page.waitForTimeout(700)
    return page.evaluate(() => {
      const c = document.querySelector('[data-ring-card]'); if (!c) return null
      const r = c.getBoundingClientRect(), clip = document.querySelector('.scroll').getBoundingClientRect(), bar = document.querySelector('nav.tabs').getBoundingClientRect(), t = c.querySelector('b')
      const cs = getComputedStyle(c)
      return { st: c.getAttribute('style'), tf: document.querySelector('.rings-zoom').style.transform, w: r.width, right: r.right, left: r.left, bottom: r.bottom, clipRight: clip.right, clipLeft: clip.left, barTop: bar.top, overBar: !(r.bottom <= bar.top || r.top >= bar.bottom || r.right <= bar.left || r.left >= bar.right), wrap: cs.overflowWrap, hy: cs.hyphens, titleFits: t.scrollWidth <= t.clientWidth + 1 }
    })
  }
  const card1 = await cardAt()
  console.log('INFO card1', JSON.stringify(card1))
  check(`wave42 ${W}: ring card opens on the stroke at k = 1`, card1 !== null)
  if (card1) {
    check(`wave42 ${W}: card inside the clip, above the bottom bar (bounding boxes do not intersect)`, card1.right <= card1.clipRight + 1 && card1.left >= card1.clipLeft - 1 && card1.bottom <= card1.barTop && !card1.overBar)
    check(`wave42 ${W}: card title wraps at word boundaries (overflow-wrap ${card1.wrap}, hyphens ${card1.hy}) and fits`, card1.wrap === 'normal' && card1.hy === 'manual' && card1.titleFits)
    await fresh()
    await zoomTo(2)
    const card2 = await cardAt()
    console.log('INFO card2', JSON.stringify(card2))
    check(`wave42 ${W}: card after zoom 2 stays inside the clip and above the bar`, card2 !== null && card2.right <= card2.clipRight + 1 && card2.left >= card2.clipLeft - 1 && card2.bottom <= card2.barTop && !card2.overBar)
    // zoom while the card is open: it re-clamps
    await zoomTo(4)
    const card3 = await page.evaluate(() => { const c = document.querySelector('[data-ring-card]'); if (!c) return null; const r = c.getBoundingClientRect(), clip = document.querySelector('.scroll').getBoundingClientRect(), bar = document.querySelector('nav.tabs').getBoundingClientRect(); return { st: c.getAttribute('style'), r: [r.left, r.top, r.right, r.bottom], clip: [clip.left, clip.right], bar: bar.top, inside: r.right <= clip.right + 1 && r.left >= clip.left - 1 && r.bottom <= bar.top } })
    console.log('INFO card3', JSON.stringify(card3)); check(`wave42 ${W}: an OPEN card re-clamps when the web zooms to 4`, card3 === null || card3.inside)
    // Review wave 42 (P06): the open card never lies under the floating "Ask your web" button (k = 4 screen showed it).
    const fabHit = await page.evaluate(() => {
      const c = document.querySelector('[data-ring-card]')?.getBoundingClientRect(); const f = [...document.querySelectorAll('.query-fab')].map((x) => x.getBoundingClientRect()).find((r) => r.width > 0)
      return c && f ? !(c.right <= f.left || f.right <= c.left || c.bottom <= f.top || f.bottom <= c.top) : false
    })
    check(`review42 ${W}: the open card at k = 4 does not meet the "Ask your web" button`, !fabHit)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/web-zoom-dots-${W}-card-k4.png` })
  }
  // phone pinch: real touches (CDP); the page must not zoom (visualViewport.scale 1), the web must
  const tctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const tp = await tctx.newPage()
  await tp.goto(URL); await tp.waitForTimeout(1200)
  await tp.evaluate((ppl) => localStorage.setItem('trustweb.v1.me', JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, people: ppl, peers: [] })), [P('a1', 'Anna Huber', 'friend'), P('b1', 'Ben Gruber', 'acquaintance')])
  await tp.reload(); await tp.waitForSelector('.rings-wrap'); await tp.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await tp.waitForTimeout(900)
  const cdp = await tctx.newCDPSession(tp)
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) })
  const sb = await tp.locator('.scroll').boundingBox()
  const ctr = { x: sb.x + sb.width / 2, y: sb.y + sb.height * 0.6 }
  const pinch = async (spread) => {
    const d0 = 60, d1 = d0 * spread
    await touch('touchStart', [{ x: ctr.x - d0 / 2, y: ctr.y }, { x: ctr.x + d0 / 2, y: ctr.y }])
    for (let i = 1; i <= 10; i++) { const d = d0 + ((d1 - d0) * i) / 10; await touch('touchMove', [{ x: ctr.x - d / 2, y: ctr.y }, { x: ctr.x + d / 2, y: ctr.y }]); await tp.waitForTimeout(30) }
    await touch('touchEnd', []); await tp.waitForTimeout(300)
  }
  const tstate = () => tp.evaluate(() => ({ k: +document.querySelector('.rings-wrap').dataset.ringsZoom, vv: window.visualViewport.scale, ava: document.querySelector('.node:not(.you) .ava').getBoundingClientRect().width }))
  const t0 = await tstate()
  await pinch(2)
  const t1 = await tstate()
  check(`wave42 phone: a two-finger pinch zooms the web (k ${t0.k} -> ${t1.k.toFixed(2)}), not the page (visualViewport.scale ${t1.vv})`, t1.vv === 1 && t1.k > 1.5)
  check(`wave42 phone: dots follow the pinch linearly (ava ${t0.ava.toFixed(1)} -> ${t1.ava.toFixed(1)} px for k ratio ${(t1.k / t0.k).toFixed(2)})`, Math.abs(t1.ava / t0.ava - t1.k / t0.k) < 0.1 * (t1.k / t0.k))
  await pinch(2)
  const t2 = await tstate()
  check(`wave42 phone: a second pinch keeps zooming the web (k ${t2.k.toFixed(2)}), page still 1x`, t2.vv === 1 && t2.k > t1.k)
  await tctx.close()
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
