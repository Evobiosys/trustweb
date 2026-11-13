// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-event: the event sheet of a community event (sign-up, roles, resource asks, "I bring it") and the celebration gate (P04),
 * at 360 and 1280. A stock user without an invite sees no celebration anywhere; an invited one sees it; no two controls overlap.
 * Synthetic data only (fresh browser contexts, stock mode).
 * Run (PORT 5417): cd apps/demo && PLAYWRIGHT_PACKAGE=<playwright-core> TW_VITE=<vite bin> TW_CHROMIUM_EXE=<headless shell> SHOTS=<dir> ../../node_modules/.bin/tsx ../trustweb/test/e2e/community_event.mjs
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createIdentity, serializeIdentity } from '../../../demo/src/did.ts'
import { launch, tally } from '../helpers/e2e_harness.mjs'

const TW_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** Vite on loopback with its output dropped (the harness pipes it and nobody reads, so a long run would block). */
async function startApp(port) {
  const vite = spawn(process.execPath, [process.env.TW_VITE, '--strictPort'], { cwd: TW_ROOT, env: { ...process.env, TW_PORT: String(port) }, stdio: 'ignore' })
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 300)) }
  return { base: `http://127.0.0.1:${port}/`, stop: async () => { vite.kill('SIGTERM') } }
}

const PORT = Number(process.env.PORT || 5417)
const SHOTS = process.env.SHOTS
const t = tally()
const P = (id, name, ring, did, fields = {}) => ({ id, name, context: '', ring, metAt: 1, lines: [], did, fields, peerId: `peer-${id}` })
const EV = (extra = {}) => ({ id: 'e1', name: 'Summer fest', from: '2027-06-01', where: 'Garden', createdAt: 1, attended: true, community: 'iyg', signup: ['p2'], roles: [{ name: 'Sound' }, { name: 'Cook', who: 'p2' }], resources: [{ id: 'r1', text: 'Tables' }], docs: { description: 'A party for all' }, ...extra })
const ident = () => serializeIdentity(createIdentity('https://relay.example/'))
const INVITED = ident()
const record = (events, identity) => ({ v: 1, me: { id: 'me1', displayName: 'Anna' }, peers: [], log: [], inventory: [], events, ...(identity ? { identity } : {}),
  people: [P('p2', 'Ben', 'closest', 'did:ben'), P('p3', 'Cara', 'friend', 'did:cara', { iyg: 'true' })] })

const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const app = await startApp(PORT)
const browser = await launch(['--use-mock-keychain', '--password-store=basic'])
const errors = []
try {
  for (const [name, opts] of [['360', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }], ['1280', { viewport: { width: 1280, height: 900 } }]]) {
    for (const [who, events] of [['owner', [EV({ celebration: true, invitees: [INVITED.did] })]], ['stranger', [EV({ fromLink: true, celebration: true, invitees: [INVITED.did] })]], ['invitee', [EV({ fromLink: true, celebration: true, invitees: [INVITED.did] })]]]) {
      const page = await (await browser.newContext(opts)).newPage()
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto(app.base); await page.waitForTimeout(1200)
      await page.evaluate((rec) => localStorage.setItem('trustweb.v1.me', JSON.stringify(rec)), record(events, who === 'invitee' ? INVITED : who === 'stranger' ? ident() : undefined))
      await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok, .twp { display: none !important }' }); await page.waitForTimeout(900)
      const tap = (sel) => (name === '360' ? page.locator(sel).first().tap() : page.locator(sel).first().click())
      await tap('[data-go="events"]'); await page.waitForTimeout(300)
      await tap('[data-cal-all]'); await page.waitForTimeout(200)
      await tap('[data-event="e1"]'); await page.waitForTimeout(300)
      const n = (sel) => page.locator(sel).count()
      const celebrate = await n('[data-event-celebration]')
      t.ok(`${name} ${who}: celebration ${who === 'stranger' ? 'absent, no teaser' : 'shown'}`, celebrate === (who === 'stranger' ? 0 : 1))
      if (who === 'stranger') { const txt = await page.locator('.events-page').innerText(); t.ok(`${name} stranger: nothing of the invite in the page text`, !/celebration/i.test(txt), txt) }
      if (who !== 'owner') { await page.close(); continue }

      t.ok(`${name}: sheet shows description, sign-up, roles, resources`, (await n('[data-event-signup]')) === 1 && (await n('[data-event-roles]')) === 1 && (await n('[data-event-resources]')) === 1 && /A party for all/.test(await page.locator('.events-page').innerText()))
      await tap('[data-event-join]'); await page.waitForTimeout(250)
      t.ok(`${name}: one tap joins the sheet`, /2 people are in/.test(await page.locator('[data-event-signup-count]').innerText()) && (await n('[data-event-leave]')) === 1)
      await tap('[data-event-role-take]'); await page.waitForTimeout(250)
      t.ok(`${name}: a role is taken`, (await n('[data-event-role-take]')) === 0)
      await tap('[data-event-resource-bring]'); await page.waitForTimeout(250)
      t.ok(`${name}: "I bring it" covers the resource`, /0 open, 1 covered/.test(await page.locator('[data-event-resource-summary]').innerText()))
      await page.locator('[data-event-resource-input]').fill('Loudspeaker')
      await tap('[data-event-resource-ask]'); await page.waitForTimeout(400)
      const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
      t.ok(`${name}: asking the community adds an open row`, rec.events[0].resources.some((r) => r.text === 'Loudspeaker' && !r.by))
      t.ok(`${name}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
      const boxes = await page.locator('[data-event-signup] button, [data-event-roles] button, [data-event-resources] button, [data-event-resources] input').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height } }))
      let clash = 0
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) { clash++; console.log('   overlap', JSON.stringify(boxes[i]), JSON.stringify(boxes[j])) }
      t.ok(`${name}: no control overlays another on the event sheet (${boxes.length} controls)`, clash === 0)
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `community-event-${name}.png`) })
      await page.close()
    }
  }
  t.ok('no page errors', errors.length === 0, errors.join(' | '))
} finally { await browser.close(); await app.stop() }
console.log(t.failures ? `${t.failures} FAILED` : 'ALL PASS')
process.exit(t.failures ? 1 : 0)
