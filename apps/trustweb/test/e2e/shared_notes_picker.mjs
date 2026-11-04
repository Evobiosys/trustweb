// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (shared-notes): the Share picker (@ people, # tags, chips) and the Notes outliner view. PORT=5480 EXE=<chromium> PW=<playwright-core index.mjs> node shared_notes_picker.mjs. */
const { chromium } = await import(process.env.PW ?? 'playwright-core')

const URL = `http://127.0.0.1:${process.env.PORT ?? 5480}/`
const browser = await chromium.launch({ headless: true, executablePath: process.env.EXE, args: ['--use-mock-keychain', '--password-store=basic'] })
let failed = false
const check = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed = true }
const ben = { did: 'did:ben', name: 'Ben' }
const note = { id: 'n1', title: 'Baby things', blocks: [
  { id: 'b1', text: 'Pram', children: [{ id: 'b2', text: 'second hand is fine', children: [], by: ben, at: 1 }], by: ben, at: 1 },
  { id: 'b3', text: 'Cot', children: [], by: ben, at: 1 }], origin: { by: ben, at: 1 }, chain: [], perms: 'annotate' }
const record = JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Jakob' }, peers: [], log: [], inventory: [],
  people: [{ id: 'p2', name: 'Kaja', ring: 1, lines: [], context: 'Fair', metAt: Date.now() - 86_400_000, peerId: 'x1', sharedNotes: [note] },
    { id: 'p3', name: 'Ludo', ring: 2, lines: [], context: '', metAt: Date.now() - 86_400_000 }] })
try {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 780 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(URL); await page.waitForTimeout(1500)
  await page.evaluate((r) => localStorage.setItem('trustweb.v1.me', r), record)
  await page.reload(); await page.addStyleTag({ content: '.twf, .twf-ok { display: none !important }' }); await page.waitForTimeout(500)

  await page.locator('.rings-wrap [data-pid="p2"]').last().click(); await page.waitForTimeout(400)
  await page.locator('[data-card-open="p2"]').click(); await page.waitForTimeout(500)
  await page.locator('[data-note-share]').first().click(); await page.waitForTimeout(200)
  const input = page.locator('[data-note-audience-input]')
  await input.fill('@lu'); await page.waitForTimeout(200)
  check('@ offers people', (await page.locator('[data-note-audience-suggest="person:p3"]').count()) === 1)
  await input.fill('@'); await page.waitForTimeout(200)
  check('a bare @ lists only people', (await page.locator('[data-note-audience-suggest^="tag:"]').count()) === 0 && (await page.locator('[data-note-audience-suggest^="person:"]').count()) >= 1)
  await page.locator('[data-note-audience-suggest="person:p3"]').click(); await page.waitForTimeout(200)
  check('chosen audience shows as a chip', (await page.locator('[data-note-audience] [data-note-audience-chip="person:p3"]').count()) === 1)
  await page.locator('[data-note-audience-chip="person:p3"]').click(); await page.waitForTimeout(200)
  check('the chip removes itself', (await page.locator('[data-note-audience-chip]').count()) === 0)

  await page.goto(URL); await page.waitForTimeout(800)
  await page.locator('.view-menu-btn').click(); await page.waitForTimeout(200)
  await page.locator('[data-view-drop] [data-view=notes]').click(); await page.waitForTimeout(300)
  check('Notes view opens', (await page.locator('[data-notes-view]').count()) === 1)
  check('person > note > blocks visible', (await page.locator('[data-outline-row]').count()) === 5)
  check('provenance greyed at the end of the note line', (await page.locator('.outline-meta').first().textContent())?.includes('from Ben'))
  check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.locator('[data-outline-row="p:p2"]').focus()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown')
  check('arrow down moves to the next row', await page.evaluate(() => document.activeElement?.getAttribute('data-outline-row') === 'b:p2/n1/b1'))
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100)
  check('arrow left folds the block', (await page.locator('[data-outline-row]').count()) === 4)
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100)
  await page.locator('[data-outline-row="b:p2/n1/b3"]').focus()
  await page.keyboard.press('Enter'); await page.waitForTimeout(200)
  check('Enter adds a sibling and focuses it', (await page.locator('[data-outline-row]').count()) === 6)
  await page.keyboard.type('Bath'); await page.keyboard.press('Tab'); await page.waitForTimeout(200)
  check('Tab indents under the block above', await page.evaluate(() => JSON.parse(localStorage.getItem('trustweb.v1.me')).people[0].sharedNotes[0].blocks[1].children.length === 1))
  check('no page errors', errors.length === 0)
  if (errors.length) console.log(errors)
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
