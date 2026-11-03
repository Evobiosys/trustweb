// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// @ts-nocheck  (fs/os/path: the crm tsconfig carries no node types; vitest runs this in node)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeBlocks, stripBlocks } from '../../scripts/notes_page.mjs'
import { cleanup } from '../../scripts/notes_cleanup.mjs'
import { serve } from '../../scripts/notes_bridge.mjs'
import { cleanupArgs } from '../../scripts/notes_sync.mjs'

const NOW = Date.UTC(2026, 9, 20, 8, 15)
const block = (id, name, ring = 'friend') => `<!-- trustweb:begin ${id} -->\n- TrustWeb: ${name} · ring: ${ring} · updated: 2026-10-16T09:30:00.000Z\n- 2026-07-11 Keeps bees <!-- tw:${id}-0 -->\n<!-- trustweb:end ${id} -->\n`
const TARO = block('tana-taro', 'Taro Lindqvist')
const INES = block('local-ines', 'Ines Oyelaran', 'close')
const person = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], fields: {} })

describe('removeBlocks (pure)', () => {
  it('cuts the blocks whose id is not kept (with the blank line before), returns their exact text; the kept block stays', () => {
    const before = '- Met Taro and Ines at the market.\n'
    const r = removeBlocks(`${before}\n${TARO}\n${INES}`, new Set(['local-ines']))
    expect(r.removed).toEqual([{ id: 'tana-taro', block: TARO }])
    expect(r.text).toBe(`${before}\n${INES}`)
    expect(removeBlocks(`${before}\n${TARO}`, ['local-ines']).text).toBe(before)
  })
  it('nothing to remove: the same text back, removed []', () => {
    const t = `# Notes\n\n${INES}\nmore text\n`
    const r = removeBlocks(t, ['local-ines'])
    expect(r.text).toBe(t)
    expect(r.removed).toEqual([])
    expect(removeBlocks('plain note\n', []).text).toBe('plain note\n')
  })
  it('a block in the middle keeps the text around it byte for byte (same whitespace rule as stripBlocks)', () => {
    const t = `# Day\n\n- first\n\n${TARO}\n- after the block\n  - nested\n`
    const r = removeBlocks(t, [])
    expect(r.text).toBe('# Day\n\n- first\n\n- after the block\n  - nested\n')
    expect(r.text).toBe(stripBlocks(t))
    expect(r.removed.map((x) => x.id)).toEqual(['tana-taro'])
  })
  it('a block at the very start leaves no stray newline', () => {
    expect(removeBlocks(`${TARO}rest\n`, []).text).toBe('rest\n')
  })
})

function vault() {
  const v = mkdtempSync(path.join(tmpdir(), 'vault-clean-'))
  mkdirSync(path.join(v, 'journals')); mkdirSync(path.join(v, 'pages')); mkdirSync(path.join(v, 'node_modules', 'x'), { recursive: true })
  writeFileSync(path.join(v, 'journals', '2026_07_11.md'), `- Met Taro at the bee club.\n\n${TARO}\n${INES}`)
  writeFileSync(path.join(v, 'pages', 'Ines.md'), `# Ines\n\n${INES}`)
  writeFileSync(path.join(v, 'pages', 'Opted.md'), `#no-trustweb\nprivate\n\n${TARO}`)
  writeFileSync(path.join(v, 'pages', 'Plain.md'), '# nothing here\n')
  writeFileSync(path.join(v, 'node_modules', 'x', 'a.md'), TARO)
  return v
}
const keep = () => [person('local-ines', 'Ines Oyelaran')]

describe('cleanup on a vault', () => {
  it('archives the gone person\'s blocks with a header, rewrites the notes minus the block, keeps the rest, logs, and is a no-op the second time', () => {
    const v = vault()
    const r = cleanup(v, keep(), { now: NOW })
    const arch = path.join(v, 'archive', 'trustweb-blocks')
    const a1 = path.join(arch, '2026-10-20', 'journals__2026_07_11.md.tana-taro.md')
    const a2 = path.join(arch, '2026-10-20', 'pages__Opted.md.tana-taro.md')
    expect(r.removed).toEqual([
      { id: 'tana-taro', name: 'Taro Lindqvist', path: 'journals/2026_07_11.md', archived: 'archive/trustweb-blocks/2026-10-20/journals__2026_07_11.md.tana-taro.md' },
      { id: 'tana-taro', name: 'Taro Lindqvist', path: 'pages/Opted.md', archived: 'archive/trustweb-blocks/2026-10-20/pages__Opted.md.tana-taro.md' },
    ])
    expect(r.scanned).toBe(4)
    expect(r.unchanged).toBe(1)
    expect(r.errors).toEqual([])
    expect(readFileSync(a1, 'utf8')).toBe(`# archived TrustWeb block\nnote: journals/2026_07_11.md\nperson: tana-taro Taro Lindqvist\narchived: 2026-10-20T08:15:00.000Z\n\n${TARO}`)
    expect(existsSync(a2)).toBe(true)
    expect(existsSync(path.join(arch, '.trustweb-generated'))).toBe(true)
    expect(readFileSync(path.join(v, 'journals', '2026_07_11.md'), 'utf8')).toBe(`- Met Taro at the bee club.\n\n${INES}`)
    expect(readFileSync(path.join(v, 'pages', 'Ines.md'), 'utf8')).toBe(`# Ines\n\n${INES}`)
    expect(readFileSync(path.join(v, 'pages', 'Opted.md'), 'utf8')).toBe('#no-trustweb\nprivate\n')
    expect(readFileSync(path.join(v, 'node_modules', 'x', 'a.md'), 'utf8')).toBe(TARO)
    const log = readFileSync(path.join(v, 'assets', 'local-notes', 'cleanup.log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(log).toEqual([
      { at: '2026-10-20T08:15:00.000Z', path: 'journals/2026_07_11.md', id: 'tana-taro', archived: 'archive/trustweb-blocks/2026-10-20/journals__2026_07_11.md.tana-taro.md' },
      { at: '2026-10-20T08:15:00.000Z', path: 'pages/Opted.md', id: 'tana-taro', archived: 'archive/trustweb-blocks/2026-10-20/pages__Opted.md.tana-taro.md' },
    ])
    const again = cleanup(v, keep(), { now: NOW + 1000 })
    expect(again.removed).toEqual([])
    expect(again.unchanged).toBe(2)
    expect(readFileSync(path.join(v, 'assets', 'local-notes', 'cleanup.log.jsonl'), 'utf8').trim().split('\n').length).toBe(2)
  })
  it('dry run reports what would go and writes nothing', () => {
    const v = vault()
    const before = readFileSync(path.join(v, 'journals', '2026_07_11.md'), 'utf8')
    const r = cleanup(v, keep(), { now: NOW, dryRun: true })
    expect(r.removed.map((x) => x.path)).toEqual(['journals/2026_07_11.md', 'pages/Opted.md'])
    expect(readFileSync(path.join(v, 'journals', '2026_07_11.md'), 'utf8')).toBe(before)
    expect(existsSync(path.join(v, 'archive'))).toBe(false)
    expect(existsSync(path.join(v, 'assets', 'local-notes', 'cleanup.log.jsonl'))).toBe(false)
  })
  it('a second archive of the same block on the same day never overwrites the first', () => {
    const v = vault()
    cleanup(v, keep(), { now: NOW })
    writeFileSync(path.join(v, 'journals', '2026_07_11.md'), `x\n\n${TARO}`)
    const r = cleanup(v, keep(), { now: NOW + 60_000 })
    expect(r.removed[0].archived).toBe('archive/trustweb-blocks/2026-10-20/journals__2026_07_11.md.tana-taro.2.md')
    expect(readdirSync(path.join(v, 'archive', 'trustweb-blocks', '2026-10-20')).length).toBe(3)
  })
  it('an empty people list removes nothing (a missing record never empties the vault)', () => {
    const v = vault()
    const r = cleanup(v, [], { now: NOW })
    expect(r.removed).toEqual([])
    expect(r.errors.length).toBe(1)
    expect(readFileSync(path.join(v, 'pages', 'Opted.md'), 'utf8')).toContain('trustweb:begin tana-taro')
  })
  it('an unreadable vault is an error, not a throw', () => {
    const r = cleanup(path.join(tmpdir(), 'no-such-vault-clean'), keep(), { now: NOW })
    expect(r).toMatchObject({ scanned: 0, removed: [], unchanged: 0 })
    expect(r.errors.length).toBe(1)
  })
})

describe('notes_sync cleanup', () => {
  it('passes vault, record, archive and dry-run through to notes_cleanup.mjs', () => {
    expect(cleanupArgs({ vault: '/v', record: '/r.json' })).toEqual(['--vault', '/v', '--record', '/r.json'])
    expect(cleanupArgs({ vault: '/v', record: '/r.json', archive: '/a', 'dry-run': true })).toEqual(['--vault', '/v', '--record', '/r.json', '--archive', '/a', '--dry-run'])
  })
})

describe('cleanup over the bridge', () => {
  it('POST /cleanup: dry run, then the real run; bad people is 400, a wrong token 401', async () => {
    const v = vault()
    const server = await new Promise((resolve) => serve({ vault: v, port: 0, token: 't0k3n' }, resolve))
    const port = server.address().port
    const call = (body, token = 't0k3n') => fetch(`http://127.0.0.1:${port}/cleanup`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const dry = await (await call({ people: keep(), dryRun: true })).json()
    expect(dry.removed.length).toBe(2)
    expect(readFileSync(path.join(v, 'pages', 'Opted.md'), 'utf8')).toContain('trustweb:begin tana-taro')
    const real = await (await call({ people: keep() })).json()
    expect(real.removed.length).toBe(2)
    expect(readFileSync(path.join(v, 'pages', 'Opted.md'), 'utf8')).toBe('#no-trustweb\nprivate\n')
    expect((await call({ people: 'x' })).status).toBe(400)
    expect((await call({ people: keep() }, 'nope')).status).toBe(401)
    server.close()
  })
})
