// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Edit stream: diff of two records into edit lines, replay of those lines onto the older record. */
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diffRecords, applyEdit } from '../../src/record_diff.ts'
import { replay } from '../../scripts/replay_edits.mjs'
import { liveRecordReply, editStreamInfo } from '../../vite_dev_record.mjs'

const P = (id, over = {}) => ({ id, name: id.toUpperCase(), ring: 'friend', lines: [], ...over })
const rec = (people, extra = {}) => ({ v: 1, people, sameAs: {}, meetings: [], ...extra })
const meta = { at: '2026-11-07T10:00:00.000Z', previewId: '127.0.0.1:5400' }
const edit = (prev, next) => diffRecords(prev, next, meta)

describe('diffRecords', () => {
  it('is empty when nothing changed', () => expect(edit(rec([P('a')]), rec([P('a')]))).toEqual([]))
  it('names ring moves, archive, unarchive, delete, restore, rename, note and other fields', () => {
    const base = rec([P('a'), P('b'), P('c', { ring: 'none', prevRing: 'close' }), P('d', { ring: 'none', prevRing: 'friend', deleted_at: 'x' }), P('e'), P('f')])
    const next = rec([
      P('a', { ring: 'close', angle: 1 }),
      P('b', { ring: 'none', prevRing: 'friend' }),
      P('c', { ring: 'close' }),
      P('d', { ring: 'friend' }),
      P('e', { name: 'Eve' }),
      P('f', { generalNote: 'hi' }),
    ])
    const kinds = Object.fromEntries(edit(base, next).map((e) => [e.ids[0], e.kind]))
    expect(kinds).toEqual({ a: 'ring-move', b: 'archive', c: 'unarchive', d: 'restore', e: 'rename', f: 'note' })
    expect(edit(rec([P('a')]), rec([P('a', { ring: 'friend', context: 'x' })]))[0].kind).toBe('field')
    expect(edit(rec([P('a')]), rec([P('a', { deleted_at: 'x', ring: 'none', prevRing: 'friend' })]))[0].kind).toBe('delete')
  })
  it('keeps before/after minimal and flags removed keys', () => {
    const [e] = edit(rec([P('a', { prevRing: 'close' })]), rec([P('a', { ring: 'close' })]))
    expect(e).toMatchObject({ ...meta, kind: 'ring-move', ids: ['a'], before: { ring: 'friend', prevRing: 'close' }, after: { ring: 'close' } })
  })
  it('reads a new sameAs link as one merge and leaves the two people out of the per-person diff', () => {
    const merged = P('a', { generalNote: 'joined' })
    const out = edit(rec([P('a'), P('b')]), rec([merged], { sameAs: { b: 'a' } }))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'merge', ids: ['b', 'a'], before: P('b'), after: merged })
  })
  it('records added people and hard removals', () => {
    const out = edit(rec([P('a')]), rec([P('z')]))
    expect(out.map((e) => [e.kind, e.ids[0]])).toEqual([['delete', 'a'], ['add', 'z']])
  })
})

describe('replay', () => {
  it('rebuilds the newer record from the older one plus the stream (merge, archive, ring move, delete, rename, add)', () => {
    const v0 = rec([P('a'), P('b'), P('c'), P('d'), P('e')], { meetings: [{ personId: 'b' }], demo: { people: ['b', 'a'] } })
    const v1 = rec([P('a', { generalNote: 'joined' }), P('c'), P('d'), P('e')], { sameAs: { b: 'a' }, meetings: [{ personId: 'a' }], demo: { people: ['a'] } })
    const v2 = rec(v1.people.map((p) => (p.id === 'c' ? P('c', { ring: 'none', prevRing: 'friend' }) : p)), v1)
    const v3 = rec(v2.people.map((p) => (p.id === 'd' ? P('d', { ring: 'close' }) : p)), v1)
    const v4 = rec(v3.people.map((p) => (p.id === 'e' ? P('e', { ring: 'none', prevRing: 'friend', deleted_at: 't' }) : p.id === 'a' ? P('a', { generalNote: 'joined', name: 'Ann' }) : p)).concat(P('n')), v1)
    const lines = [[v0, v1], [v1, v2], [v2, v3], [v3, v4]].flatMap(([x, y]) => edit(x, y)).map((e) => JSON.stringify(e)).join('\n')
    const out = replay(v0, lines)
    expect(out).toEqual(v4)
    expect(v0.people).toHaveLength(5)
  })
  it('skips an edit about a missing person and removes keys the edit removed', () => {
    const r = applyEdit(rec([P('a', { prevRing: 'close' })]), { ...meta, kind: 'unarchive', ids: ['a'], before: { prevRing: 'close', ring: 'none' }, after: { ring: 'close' } })
    expect(r.people[0]).toEqual(P('a', { ring: 'close' }))
    expect(applyEdit(rec([]), { ...meta, kind: 'rename', ids: ['x'], before: { name: 'a' }, after: { name: 'b' } })).toEqual(rec([]))
  })
})

describe('edit stream on the dev server', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'twedits-'))
  const file = path.join(dir, 'dev-record.live.json')
  const edits = path.join(dir, 'dev-edits.jsonl')
  const hdr = { host: '127.0.0.1:5401' }
  const post = (r, opts = {}) => liveRecordReply(file, 'POST', hdr, JSON.stringify(r), { gapMs: 0, editsFile: edits, ...opts })
  const lines = () => readFileSync(edits, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  it('writes nothing for the first record, then one line per edit with the preview id, and never rewrites old lines', () => {
    post(rec([P('a'), P('b')]))
    expect(() => readFileSync(edits)).toThrow()
    post(rec([P('a', { ring: 'close' }), P('b')]))
    const first = readFileSync(edits, 'utf8')
    post(rec([P('a', { ring: 'close' }), P('b', { name: 'Bob' })]))
    post(rec([P('a', { ring: 'close' }), P('b', { name: 'Bob' })]))
    expect(readFileSync(edits, 'utf8').startsWith(first)).toBe(true)
    const l = lines()
    expect(l.map((e) => e.kind)).toEqual(['ring-move', 'rename'])
    expect(l[0]).toMatchObject({ previewId: '127.0.0.1:5401', ids: ['a'] })
    expect(Date.parse(l[0].at)).toBeGreaterThan(0)
  })
  it('keeps the record write when the stream cannot be written', () => {
    const r = post(rec([P('a', { ring: 'none' })]), { editsFile: path.join(dir, 'no', 'such', 'f.jsonl') })
    expect(r.code).toBe(200)
  })
  it('rotates by size into dev-edits.<date>.jsonl and counts across files', () => {
    const before = editStreamInfo(edits).count
    post(rec([P('a', { ring: 'close' })]), { maxBytes: 10 })
    expect(readdirSync(dir).filter((n) => /^dev-edits\.\d{4}-\d{2}-\d{2}.*\.jsonl$/.test(n))).toHaveLength(1)
    const info = editStreamInfo(edits)
    expect(info.count).toBeGreaterThan(before)
    expect(Date.parse(info.since)).toBeGreaterThan(0)
  })
  it('reports zero edits for a stream that does not exist', () => expect(editStreamInfo(path.join(mkdtempSync(path.join(tmpdir(), 'twedits0-')), 'none.jsonl'))).toEqual({ count: 0, since: null }))
})
