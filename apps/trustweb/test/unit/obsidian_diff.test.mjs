// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { diffHashes, sha256Hex } from '../../src/ext/obsidian/obsidian_diff.ts'

describe('sha256Hex', () => {
  it('is the standard sha-256 of the text (utf-8)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(await sha256Hex('ä')).toHaveLength(64)
  })
})

describe('diffHashes', () => {
  const known = { 'a.md': '1', 'b.md': '2', 'c.md': '3' }
  it('added, changed, removed, same', () => {
    expect(diffHashes(known, { 'a.md': '1', 'b.md': 'X', 'd.md': '4' })).toEqual({ added: ['d.md'], changed: ['b.md'], removed: ['c.md'], same: ['a.md'] })
  })
  it('first sync: everything is added; nothing changed: all same', () => {
    expect(diffHashes({}, known).added).toEqual(['a.md', 'b.md', 'c.md'])
    expect(diffHashes(known, known)).toEqual({ added: [], changed: [], removed: [], same: ['a.md', 'b.md', 'c.md'] })
  })
  it('lists are sorted so the result is stable', () => {
    expect(diffHashes({}, { 'z.md': '1', 'a.md': '1' }).added).toEqual(['a.md', 'z.md'])
  })
})
