// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (shared-notes): outliner text <-> blocks, annotations, provenance, passing a note on, the share link. */
import {
  annotate, canAnnotate, editBlock, forward, newNote, noteShareLink, parseNoteShare, parseOutline, provenanceLine, serializeOutline,
} from '../../src/notes_outline.ts'

const ANNA = { did: 'did:anna', name: 'Anna' }
const BEN = { did: 'did:ben', name: 'Ben' }
const ME = { did: 'did:me', name: 'Me' }
const T0 = 1_700_000_000_000

const TEXT = [
  '- Baby carrier', '- Sleepsuit with zip', '- Nursing pillow', '- Cot sheets', '- Muslin cloths',
  '- Night light', '- Bath thermometer', '- Pram', '  - second hand is fine', '- Baby monitor', '- Changing mat',
].join('\n')

function fixture() {
  let n = newNote({ title: 'Baby things', text: TEXT, by: ANNA, at: T0 })
  const pram = n.blocks.find((b) => b.text === 'Pram')
  n = annotate(n, n.blocks[1].id, 'bought 2 already', BEN, T0 + 1)
  n = annotate(n, pram.id, 'brand tip: Bugaboo', ANNA, T0 + 2)
  return n
}

describe('parseOutline / serializeOutline', () => {
  it('reads "- " lines with 2-space or tab indent into a tree', () => {
    const b = parseOutline('- a\n  - b\n    - c\n\t- b2\n- d', ANNA, T0)
    expect(b.map((x) => x.text)).toEqual(['a', 'd'])
    expect(b[0].children.map((x) => x.text)).toEqual(['b', 'b2'])
    expect(b[0].children[0].children[0].text).toBe('c')
    expect(b[0].by).toEqual(ANNA)
  })
  it('plain typed lines become top-level blocks; blank lines and "* " bullets are tolerated', () => {
    expect(parseOutline('one\n\n* two\n- three', ANNA, T0).map((x) => x.text)).toEqual(['one', 'two', 'three'])
  })
  it('an indent that jumps deeper than one level attaches to the nearest parent', () => {
    const b = parseOutline('- a\n        - deep', ANNA, T0)
    expect(b[0].children[0].text).toBe('deep')
  })
  it('round-trips plain text', () => {
    expect(serializeOutline(parseOutline(TEXT, ANNA, T0))).toBe(TEXT)
  })
  it('block ids are unique', () => {
    const ids = []
    const walk = (bs) => bs.forEach((b) => { ids.push(b.id); walk(b.children) })
    walk(fixture().blocks)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('control characters are dropped', () => {
    expect(parseOutline('- a\u202Eb\u0001', ANNA, T0)[0].text).toBe('ab')
  })
})

describe('annotate / editBlock / canAnnotate', () => {
  it('fixture: 10+ items, 2 annotations by 2 people, marked as annotations', () => {
    const n = fixture()
    expect(n.blocks).toHaveLength(10)
    expect(n.blocks[1].children[0]).toMatchObject({ text: 'bought 2 already', by: BEN, at: T0 + 1, annotation: true })
    expect(n.blocks[7].children.map((c) => c.annotation === true)).toEqual([false, true])
  })
  it('does not change the note it was given', () => {
    const n = newNote({ title: 't', text: '- a', by: ANNA, at: T0 })
    annotate(n, n.blocks[0].id, 'x', ANNA, T0)
    expect(n.blocks[0].children).toEqual([])
  })
  it('a note on a note goes under that note', () => {
    let n = fixture()
    const ann = n.blocks[1].children[0]
    n = annotate(n, ann.id, 'which shop?', ME, T0 + 5)
    expect(n.blocks[1].children[0].children[0]).toMatchObject({ text: 'which shop?', by: ME, annotation: true })
  })
  it('read-only for a receiver; the author may always add', () => {
    const n = { ...fixture(), perms: 'read' }
    expect(canAnnotate(n, ME)).toBe(false)
    expect(canAnnotate(n, ANNA)).toBe(true)
    expect(() => annotate(n, n.blocks[0].id, 'x', ME, T0)).toThrow()
    expect(canAnnotate({ ...n, perms: 'annotate' }, ME)).toBe(true)
  })
  it('unknown block: throws', () => {
    expect(() => annotate(fixture(), 'nope', 'x', ANNA, T0)).toThrow()
  })
  it('only the block\'s author edits it', () => {
    const n = fixture()
    const id = n.blocks[1].children[0].id
    expect(editBlock(n, id, 'bought 3', BEN).blocks[1].children[0].text).toBe('bought 3')
    expect(() => editBlock(n, id, 'x', ANNA)).toThrow()
  })
})

describe('provenanceLine', () => {
  it('mine: written by you', () => {
    expect(provenanceLine(newNote({ title: 't', text: '- a', by: ME, at: T0 }), ME)).toBe('written by you')
  })
  it('from Anna, passed on by Ben', () => {
    let n = fixture()
    n = forward(n, 'Ben', ANNA, T0 + 10)
    n = forward(n, 'Me', BEN, T0 + 20)
    expect(provenanceLine(n, ME)).toBe('from Anna, passed on by Ben')
  })
  it('straight from the author: from Anna', () => {
    expect(provenanceLine(forward(fixture(), 'Me', ANNA, T0 + 10), ME)).toBe('from Anna')
  })
  it('several hops, and me among the passers', () => {
    let n = forward(fixture(), 'Ben', ANNA, T0 + 10)
    n = forward(n, 'Cleo', BEN, T0 + 20)
    n = forward(n, 'Dan', { did: 'did:cleo', name: 'Cleo' }, T0 + 30)
    expect(provenanceLine(n, ME)).toBe('from Anna, passed on by Ben, Cleo')
    expect(provenanceLine(forward(forward(fixture(), 'Me', ANNA, T0), 'Dan', ME, T0 + 1), ME)).toBe('from Anna, passed on by you')
  })
})

describe('forward', () => {
  it('extends the chain and keeps every block author and time', () => {
    const n = fixture()
    const f = forward(n, 'Me', BEN, T0 + 10)
    expect(f.chain).toEqual([{ by: BEN, at: T0 + 10, to: 'Me' }])
    expect(f.origin).toEqual(n.origin)
    expect(f.blocks).toEqual(n.blocks)
    expect(n.chain).toEqual([])
  })
  it('the permission can go down, never up', () => {
    const n = { ...fixture(), perms: 'read' }
    expect(forward(n, 'x', BEN, T0, 'annotate').perms).toBe('read')
    expect(forward({ ...n, perms: 'annotate' }, 'x', BEN, T0, 'read').perms).toBe('read')
    expect(forward({ ...n, perms: 'annotate' }, 'x', BEN, T0).perms).toBe('annotate')
  })
})

describe('noteShareLink / parseNoteShare', () => {
  const BASE = 'https://app.trustweb.one/?connect=abc#k=1'
  it('round-trips the whole note through the fragment', () => {
    const n = fixture()
    const url = noteShareLink(BASE, n)
    expect(url.startsWith(`${BASE}&sn=`)).toBe(true)
    expect(parseNoteShare(new URL(url).hash)).toEqual(n)
  })
  it('no fragment, no note, or damage: null, never a throw', () => {
    expect(parseNoteShare('')).toBeNull()
    expect(parseNoteShare('#sn=%%%')).toBeNull()
    expect(parseNoteShare('#sn=e30')).toBeNull()
  })
  it('a hostile payload is cleaned: unknown perms read as read, long text cut, control characters dropped', () => {
    const bad = { ...fixture(), perms: 'owner', title: 'T\u202E'.padEnd(500, 'x') }
    const got = parseNoteShare(new URL(noteShareLink(BASE, bad)).hash)
    expect(got.perms).toBe('read')
    expect(got.title.length).toBeLessThanOrEqual(120)
    expect(got.title).not.toContain('\u202E')
  })
})
