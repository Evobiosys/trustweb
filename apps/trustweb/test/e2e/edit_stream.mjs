// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 edit-stream proof (headless): a merge, an archive, a ring move and a delete made through the real UI of personal preview A land in
 * the live record, survive a reload and show on a second dev server B; the dev server wrote one line per edit; replay rebuilds the live record.
 * Start A and B with TW_DEV_RECORD=<seed copy in /tmp> TW_DEV_LIVE=<copy of the live record in /tmp> (never the real file), then:
 * PORT_A=5430 PORT_B=5432 TW_DEV_LIVE=<same copy> EXE=<chromium> PW=<playwright-core index.js> SHOTS=<dir> node edit_stream.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const pw = await import(process.env.PW ?? 'playwright-core')
const chromium = pw.chromium ?? pw.default.chromium
const [A, B] = [process.env.PORT_A ?? 5430, process.env.PORT_B ?? 5432]
const LIVE = process.env.TW_DEV_LIVE
const EDITS = path.join(path.dirname(LIVE), 'dev-edits.jsonl')
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond, evidence = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${evidence ? `  [${evidence}]` : ''}`); if (!cond) failed = true }
const open = async (port, viewport = { width: 1280, height: 900 }) => {
  const page = await (await browser.newContext({ viewport })).newPage()
  page.on('pageerror', (e) => { console.log('pageerror', String(e)); failed = true })
  await page.goto(`http://127.0.0.1:${port}/`)
  await page.waitForTimeout(2500)
  return page
}
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')))
const live = () => JSON.parse(readFileSync(LIVE, 'utf8'))
const person = (r, id) => r.people.find((p) => p.id === id)
const waitLive = async (test) => { for (let i = 0; i < 40; i++) { const r = live(); if (test(r)) return r; await new Promise((s) => setTimeout(s, 250)) } return live() }
const card = async (page, id) => {
  await page.locator(`.rings-wrap [data-pid="${id}"]`).click(); await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Extended' }).click(); await page.waitForTimeout(400)
}
const curate = async (page, id) => { await card(page, id); await page.locator(`[data-card-curate="${id}"]`).click(); await page.waitForTimeout(500) }
const backToWeb = async (page) => { await page.goto(page.url()); await page.waitForTimeout(2000) }
try {
  const base = live()
  const ids = (await (async () => { const p = await open(A); const v = await p.evaluate(() => [...document.querySelectorAll('.rings-wrap .node:not(.you)')].map((n) => n.dataset.pid)); await p.close(); return v })())
  const pick = ids.filter((id) => person(base, id) && !person(base, id).deleted_at && person(base, id).ring !== 'none')
  const [mergeA, mergeB, archiveId, deleteId, moveId] = pick
  const keepRing = person(base, moveId).ring
  const a = await open(A)
  // archive: the dustbin's archive bin (the Curate button files the person through the Tana curator, not locally)
  {
    const nb = await a.locator(`.rings-wrap [data-pid="${archiveId}"]`).boundingBox()
    await a.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2); await a.mouse.down()
    await a.mouse.move(nb.x + nb.width / 2 + 8, nb.y + nb.height / 2 + 8, { steps: 3 })
    const bin = await a.locator('[data-bin=archive]').boundingBox()
    await a.mouse.move(bin.x + bin.width / 2, bin.y + bin.height / 2, { steps: 8 }); await a.mouse.up(); await a.waitForTimeout(1500)
  }
  // delete
  await backToWeb(a); await curate(a, deleteId); await a.locator(`[data-delete-person="${deleteId}"]`).click(); await a.waitForTimeout(1000)
  // ring move
  await backToWeb(a); await card(a, moveId)
  const target = keepRing === 'acquaintance' ? 'friend' : 'acquaintance'
  await a.locator(`[data-ring-pick="${moveId}"]`).evaluate((e) => { e.hidden = false })
  await a.locator(`[data-ring-choice="${target}"]`).click(); await a.waitForTimeout(800)
  // merge
  await backToWeb(a); await curate(a, mergeA); await a.locator(`[data-same-person="${mergeA}"]`).click(); await a.waitForTimeout(400)
  await a.locator('[data-same-search]').fill(person(base, mergeB).name); await a.waitForTimeout(300)
  // the picker sheet opens under the Curate page layer in headless (pointer events blocked): click through the DOM
  await a.locator(`[data-same-pick="${mergeB}"]`).evaluate((e) => e.click()); await a.waitForTimeout(500)
  await a.locator('[data-same-keep]').first().evaluate((e) => e.click()); await a.waitForTimeout(1500)
  await a.screenshot({ path: `${SHOTS}/edit-stream-a-1280.png` })
  const rec = await waitLive((r) => r.sameAs && Object.keys(r.sameAs).length > Object.keys(base.sameAs ?? {}).length)
  const gone = (id) => !person(rec, id) || person(rec, id).deleted_at
  check('archive reached the live file', person(rec, archiveId)?.ring === 'none', `ring=${person(rec, archiveId)?.ring}`)
  check('delete reached the live file', Boolean(person(rec, deleteId)?.deleted_at), `deleted_at=${person(rec, deleteId)?.deleted_at}`)
  check('ring move reached the live file', person(rec, moveId)?.ring === target, `${keepRing} -> ${person(rec, moveId)?.ring}`)
  check('merge reached the live file', Boolean(rec.sameAs?.[mergeA] || rec.sameAs?.[mergeB]) && (!person(rec, mergeA) || !person(rec, mergeB)), JSON.stringify(rec.sameAs))
  await a.reload(); await a.waitForTimeout(2500)
  const after = await stored(a)
  check('A keeps all four after a reload', person(after, archiveId)?.ring === 'none' && Boolean(person(after, deleteId)?.deleted_at) && person(after, moveId)?.ring === target && Object.keys(after.sameAs ?? {}).length > Object.keys(base.sameAs ?? {}).length)
  const b = await open(B)
  const sb = await stored(b)
  check('B (second port) reads the same four from the file', person(sb, archiveId)?.ring === 'none' && Boolean(person(sb, deleteId)?.deleted_at) && person(sb, moveId)?.ring === target && Object.keys(sb.sameAs ?? {}).length > Object.keys(base.sameAs ?? {}).length)
  const lines = readFileSync(EDITS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const kinds = lines.map((e) => e.kind)
  check('edit stream holds archive, delete, ring-move and merge', ['archive', 'delete', 'ring-move', 'merge'].every((k) => kinds.includes(k)), kinds.join(','))
  check('every line names the preview', lines.every((e) => e.previewId === `127.0.0.1:${A}`))
  await b.locator('[data-settings-gear]').click(); await b.waitForTimeout(500)
  await b.locator('details[data-settings-group]:has(details[data-settings-advanced]) > summary').click(); await b.waitForTimeout(300)
  await b.locator('details[data-settings-advanced] > summary').click(); await b.waitForTimeout(800)
  const line = b.locator('[data-edit-stream-count]')
  const text = await line.innerText().catch(() => '')
  check('Settings > Advanced shows "Edits kept: N (since date)"', new RegExp(`^Edits kept: ${lines.length} \\(since \\d{4}-\\d\\d-\\d\\d\\)$`).test(text), text)
  await line.scrollIntoViewIfNeeded().catch(() => {})
  await b.screenshot({ path: `${SHOTS}/edit-stream-1280.png` })
  const m = await open(B, { width: 360, height: 780 })
  await m.locator('[data-settings-gear]').click(); await m.waitForTimeout(500)
  await m.locator('details[data-settings-group]:has(details[data-settings-advanced]) > summary').click(); await m.waitForTimeout(300)
  await m.locator('details[data-settings-advanced] > summary').click(); await m.waitForTimeout(800)
  await m.locator('[data-edit-stream-count]').scrollIntoViewIfNeeded().catch(() => {})
  check('360 px: no horizontal scroll', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await m.screenshot({ path: `${SHOTS}/edit-stream-360.png` })
  // replay: the stream onto the record from before the edits gives the record now
  const baseFile = process.env.BASE_RECORD
  if (baseFile) {
    const out = path.join(path.dirname(LIVE), 'replayed.json')
    execFileSync('node', [path.join(import.meta.dirname, '../../scripts/replay_edits.mjs'), EDITS, baseFile, out])
    const re = JSON.parse(readFileSync(out, 'utf8'))
    const cur = live()
    const strip = (r) => r.people.map((p) => p.id).sort().join()
    check('replay of the stream onto the old record gives the same people', strip(re) === strip(cur))
    check('replay keeps the four edits', person(re, archiveId)?.ring === 'none' && Boolean(person(re, deleteId)?.deleted_at) && person(re, moveId)?.ring === target && re.sameAs?.[mergeA] !== undefined || re.sameAs?.[mergeB] !== undefined)
  }
} finally { await browser.close() }
process.exit(failed ? 1 : 0)
