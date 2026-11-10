// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { acceptPath, fromInput, walkHandle, NOTE_MAX_BYTES, NOTES_MAX } from '../../src/ext/obsidian/obsidian_files.ts'
import { scanAll, syncVault, memoryCache } from '../../src/ext/obsidian/obsidian_scan.ts'
import { NOTES, VAULT } from '../fixtures/synthetic_vault.mjs'

const file = (text, name = 'x.md', rel) => ({ name, size: new TextEncoder().encode(text).length, webkitRelativePath: rel, text: async () => text })
const entries = (over = {}) => Object.entries({ ...NOTES, ...over }).filter(([p]) => acceptPath(p)).map(([path, t]) => ({ path, file: file(t) }))

describe('acceptPath', () => {
  it('markdown notes only; dot folders (.obsidian, .trash, .git) and dot files out', () => {
    expect(acceptPath('People/A.md')).toBe(true)
    expect(acceptPath('People/A.MD')).toBe(true)
    for (const p of ['.obsidian/workspace.json', 'People/a.png', '.trash/A.md', 'x/.git/A.md', '.hidden.md', 'noext']) expect(acceptPath(p)).toBe(false)
  })
})

describe('fromInput (directory input)', () => {
  const list = [
    file('a', 'A.md', `${VAULT}/People/A.md`), file('{}', 'workspace.json', `${VAULT}/.obsidian/workspace.json`),
    file('b', 'B.md', `${VAULT}/B.md`), file('img', 'p.png', `${VAULT}/p.png`),
  ]
  it('vault name = the picked folder, paths relative to it, only notes', () => {
    const r = fromInput(list)
    expect(r.vault).toBe(VAULT)
    expect(r.files.map((f) => f.path)).toEqual(['People/A.md', 'B.md'])
    expect(r.skipped).toEqual({ tooBig: 0, tooMany: 0 })
  })
  it('files picked one by one (no folder): vault unknown, path = name', () => {
    const r = fromInput([file('a', 'A.md', '')])
    expect(r.vault).toBe('')
    expect(r.files.map((f) => f.path)).toEqual(['A.md'])
  })
  it('a note over the size cap is skipped and counted; past the note cap the rest is counted', () => {
    const big = { ...file('x', 'Big.md', `${VAULT}/Big.md`), size: NOTE_MAX_BYTES + 1 }
    expect(fromInput([big]).skipped.tooBig).toBe(1)
    const many = Array.from({ length: NOTES_MAX + 2 }, (_, i) => file('x', `n${i}.md`, `${VAULT}/n${i}.md`))
    const r = fromInput(many)
    expect(r.files).toHaveLength(NOTES_MAX)
    expect(r.skipped.tooMany).toBe(2)
  })
})

describe('walkHandle (File System Access API)', () => {
  const fileHandle = (name, text) => ({ kind: 'file', name, getFile: async () => file(text, name) })
  const dir = (name, kids) => ({ kind: 'directory', name, entries: async function* () { for (const k of kids) yield [k.name, k] } })
  it('walks folders, keeps notes, skips dot folders', async () => {
    const root = dir(VAULT, [dir('People', [fileHandle('A.md', 'a'), fileHandle('p.png', 'x')]), dir('.obsidian', [fileHandle('c.md', 'no')]), fileHandle('B.md', 'b')])
    const r = await walkHandle(root)
    expect(r.vault).toBe(VAULT)
    expect(r.files.map((f) => f.path).sort()).toEqual(['B.md', 'People/A.md'])
  })
})

describe('scanAll', () => {
  it('hashes every note; parses only new and changed ones', async () => {
    const first = await scanAll(entries(), {})
    expect(first.changed).toHaveLength(20)
    expect(first.same).toEqual([])
    const known = Object.fromEntries(first.changed.map((c) => [c.path, c.hash]))
    const again = await scanAll(entries(), known)
    expect(again.changed).toEqual([])
    expect(again.same).toHaveLength(20)
    const edited = await scanAll(entries({ 'People/Alma Brandt.md': NOTES['People/Alma Brandt.md'] + 'More.\n' }), known)
    expect(edited.changed.map((c) => c.path)).toEqual(['People/Alma Brandt.md'])
    expect(edited.changed[0].note.name).toBe('Alma Brandt')
    expect(edited.same).toHaveLength(19)
  })
  it('a note that cannot be read is reported, the rest goes on; progress counts every note', async () => {
    const list = [{ path: 'a.md', file: file('hello') }, { path: 'b.md', file: { name: 'b.md', size: 1, text: async () => { throw new Error('gone') } } }]
    const seen = []
    const r = await scanAll(list, {}, (done, total) => seen.push([done, total]))
    expect(r.failed).toEqual(['b.md'])
    expect(r.changed.map((c) => c.path)).toEqual(['a.md'])
    expect(seen.at(-1)).toEqual([2, 2])
  })
})

describe('syncVault with the cache', () => {
  it('first sync parses all 20, a second one nothing, an edit one; removed notes leave the cache', async () => {
    const cache = memoryCache()
    const a = await syncVault(entries(), cache)
    expect(a.diff).toEqual({ added: 20, changed: 0, removed: 0, same: 0 })
    expect(a.notes).toHaveLength(20)
    const b = await syncVault(entries(), cache)
    expect(b.diff).toEqual({ added: 0, changed: 0, removed: 0, same: 20 })
    expect(b.notes).toHaveLength(20)
    expect(b.notes.find((n) => n.path === 'People/Alma Brandt.md').name).toBe('Alma Brandt')   // from the cache
    const c = await syncVault(entries({ 'Journal/Autumn.md': 'Changed [[Hugo Ivanov]]' }), cache)
    expect(c.diff).toEqual({ added: 0, changed: 1, removed: 0, same: 19 })
    expect(c.notes.find((n) => n.path === 'Journal/Autumn.md').links).toEqual(['Hugo Ivanov'])
    const gone = entries().filter((e) => e.path !== 'Journal/Winter.md')
    const d = await syncVault(gone, cache)
    expect(d.diff.removed).toBe(1)
    expect(d.notes).toHaveLength(19)
    expect((await cache.all())).toHaveLength(19)
  })
  it('the cache keeps no note text, only what was parsed', async () => {
    const cache = memoryCache()
    await syncVault(entries(), cache)
    const text = JSON.stringify(await cache.all())
    expect(text).not.toContain('Hot compost needs nitrogen. #garden/soil\n')
    expect(text.length).toBeLessThan(40_000)
  })
  it('clear forgets the vault', async () => {
    const cache = memoryCache()
    await syncVault(entries(), cache)
    await cache.clear()
    expect(await cache.all()).toEqual([])
  })
})
