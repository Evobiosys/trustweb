// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Co-created notes (src/ext/co_notes/co_doc.ts): fractional keys, ops, tombstones, CRDT merge laws, text round trip, hostile JSON.
import {
  between, cleanDoc, editText, fromText, indent, insertAfter, merge, moveDown, moveUp, newDoc, outdent, remove, setLogseq, setShare, setTitle, textOver, toText, tree,
} from '../../src/ext/co_notes/co_doc.ts'

const A = { did: 'did:a', name: 'Anna' }
const B = { did: 'did:b', name: 'Ben' }
const C = { did: 'did:c', name: 'Cara' }
const T = 1_800_000_000_000
const texts = (d) => tree(d).map((r) => `${r.depth}:${r.text}`)
/** A doc with the given root-level lines, written by A. */
function seeded(lines) {
  let d = newDoc({ id: 'd1', title: 'Plan', me: A, at: T })
  let last = null
  for (const t of lines) { const r = insertAfter(d, last, t, A, T); d = r.doc; last = r.id }
  return d
}
const idOf = (d, text) => tree(d).find((r) => r.text === text).id

describe('fractional keys', () => {
  it('between() sorts strictly between its bounds', () => {
    expect(between('', '') > '').toBe(true)
    const m = between('', 'V')
    expect(m < 'V').toBe(true)
    const n = between('V', '')
    expect(n > 'V').toBe(true)
    expect(between('a', 'b') > 'a' && between('a', 'b') < 'b').toBe(true)
  })
  it('stays ordered after 60 inserts at the same spot', () => {
    let lo = 'a'
    const hi = 'b'
    for (let i = 0; i < 60; i++) { const k = between(lo, hi); expect(k > lo && k < hi).toBe(true); lo = k }
  })
})

describe('ops', () => {
  it('inserts in order, indents, outdents, moves', () => {
    let d = seeded(['one', 'two', 'three'])
    expect(texts(d)).toEqual(['0:one', '0:two', '0:three'])
    d = indent(d, idOf(d, 'two'), A)
    expect(texts(d)).toEqual(['0:one', '1:two', '0:three'])
    d = outdent(d, idOf(d, 'two'), A)
    expect(texts(d)).toEqual(['0:one', '0:two', '0:three'])
    d = moveUp(d, idOf(d, 'three'), A)
    expect(texts(d)).toEqual(['0:one', '0:three', '0:two'])
    d = moveDown(d, idOf(d, 'one'), A)
    expect(texts(d)).toEqual(['0:three', '0:one', '0:two'])
  })
  it('refuses what cannot change: first block indent, top-level outdent, edges, same text', () => {
    const d = seeded(['one', 'two'])
    expect(indent(d, idOf(d, 'one'), A)).toBe(d)
    expect(outdent(d, idOf(d, 'one'), A)).toBe(d)
    expect(moveUp(d, idOf(d, 'one'), A)).toBe(d)
    expect(moveDown(d, idOf(d, 'two'), A)).toBe(d)
    expect(editText(d, idOf(d, 'one'), 'one', A)).toBe(d)
  })
  it('indent stops at the depth limit', () => {
    let d = seeded(['a'])
    for (let i = 0; i < 8; i++) { const r = insertAfter(d, idOf(d, 'a'), `n${i}`, A, T); d = r.doc }
    for (let i = 0; i < 8; i++) d = indent(d, idOf(d, `n${i}`), A)
    expect(Math.max(...tree(d).map((r) => r.depth))).toBeLessThan(6)
  })
  it('insertAfter puts the new block behind its sibling (after that sibling\'s children), same level', () => {
    let d = seeded(['one', 'two'])
    d = indent(d, idOf(d, 'two'), A)
    d = insertAfter(d, idOf(d, 'two'), 'two b', A, T).doc
    d = insertAfter(d, idOf(d, 'one'), 'one b', A, T).doc
    expect(texts(d)).toEqual(['0:one', '1:two', '1:two b', '0:one b'])
    expect(texts(d).filter((t) => t.startsWith('1:'))).toEqual(['1:two', '1:two b'])
  })
  it('remove tombstones the block and its children; the block stays in the data', () => {
    let d = seeded(['one', 'two', 'three'])
    d = indent(d, idOf(d, 'two'), A)
    const before = d.blocks.length
    d = remove(d, idOf(d, 'one'), A)
    expect(texts(d)).toEqual(['0:three'])
    expect(d.blocks.length).toBe(before)
    expect(d.blocks.filter((b) => b.del).length).toBe(2)
  })
  it('every op bumps the lamport clock and stamps with my did', () => {
    let d = seeded(['x'])
    const c = d.clock
    d = editText(d, idOf(d, 'x'), 'y', B)
    expect(d.clock).toBe(c + 1)
    expect(d.blocks[0].st.text).toEqual([c + 1, 'did:b'])
  })
  it('caps block text and block count; setTitle and setShare work', () => {
    let d = seeded(['x'])
    d = editText(d, idOf(d, 'x'), 'y'.repeat(900), A)
    expect(tree(d)[0].text.length).toBe(500)
    d = setTitle(d, 'New title', A)
    expect(d.title).toBe('New title')
    d = setShare(d, tree(d)[0].id, 'event', A)
    expect(d.blocks[0].share).toBe('event')
  })
})

describe('merge laws', () => {
  const base = seeded(['one', 'two', 'three'])
  const forkA = (() => { let d = base; d = editText(d, idOf(d, 'one'), 'one (A)', A); d = indent(d, idOf(d, 'two'), A); return d })()
  const forkB = (() => { let d = base; d = editText(d, idOf(d, 'two'), 'two (B)', B); d = insertAfter(d, idOf(d, 'three'), 'four', B, T).doc; return d })()
  const forkC = (() => { let d = base; d = remove(d, idOf(d, 'three'), C); d = moveUp(d, idOf(d, 'two'), C); return d })()

  it('is commutative, associative, idempotent', () => {
    expect(merge(forkA, forkB)).toEqual(merge(forkB, forkA))
    expect(merge(merge(forkA, forkB), forkC)).toEqual(merge(forkA, merge(forkB, forkC)))
    const m = merge(forkA, forkB)
    expect(merge(m, m)).toEqual(m)
    expect(merge(m, forkA)).toEqual(m)
    expect(merge(forkA, forkA)).toEqual(merge(forkA, merge(forkA, forkA)))
  })
  it('three replicas converge to the same text and tree in any merge order', () => {
    const orders = [[forkA, forkB, forkC], [forkC, forkB, forkA], [forkB, forkA, forkC], [forkC, forkA, forkB]]
    const results = orders.map(([x, y, z]) => merge(merge(x, y), z))
    for (const r of results) expect(r).toEqual(results[0])
    expect(toText(results[0])).toBe(toText(results[3]))
    expect(texts(results[0])).toContain('0:four')
    expect(texts(results[0]).join('|')).toContain('one (A)')
    expect(texts(results[0]).join('|')).toContain('two (B)')
    expect(texts(results[0]).join('|')).not.toContain('three')
  })
  it('a move and an edit of the same block both survive', () => {
    const moved = indent(base, idOf(base, 'two'), A)
    const edited = editText(base, idOf(base, 'two'), 'two edited', B)
    const m = merge(moved, edited)
    expect(texts(m)).toEqual(['0:one', '1:two edited', '0:three'])
    expect(merge(edited, moved)).toEqual(m)
  })
  it('the later stamp wins a text conflict; a tie goes to the larger did', () => {
    const x = editText(base, idOf(base, 'one'), 'from A', A)
    const y = editText(base, idOf(base, 'one'), 'from B', B)
    expect(texts(merge(x, y))[0]).toBe('0:from B')
    const z = editText(editText(base, idOf(base, 'one'), 'first', A), idOf(base, 'one'), 'second', A)
    expect(texts(merge(x, z))[0]).toBe('0:second')
  })
  it('concurrent indents that would make a cycle still show every block once', () => {
    const b2 = insertAfter(seeded(['X']), null, 'Y', A, T).doc // X, Y
    const x = idOf(b2, 'X'); const y = idOf(b2, 'Y')
    const a = indent(b2, y, A) // Y under X
    const bb = indent(moveDown(b2, x, B), x, B) // order Y, X then X under Y
    const m = merge(a, bb)
    const rows = tree(m)
    expect(rows.map((r) => r.text).sort()).toEqual(['X', 'Y'])
    expect(tree(merge(bb, a)).map((r) => `${r.depth}:${r.text}`)).toEqual(rows.map((r) => `${r.depth}:${r.text}`))
  })
  it('keeps participants, takes the newer title, never mixes up documents', () => {
    const t1 = setTitle(forkA, 'Title A', A)
    const t2 = setTitle(forkB, 'Title B', B)
    const withB = { ...forkB, people: [...forkB.people, B] }
    expect(merge(t1, t2).title).toBe(merge(t2, t1).title)
    expect(merge(forkA, withB).people.map((p) => p.did)).toEqual(['did:a', 'did:b'])
  })
  it('the clock after a merge is above everything seen', () => {
    const m = merge(forkA, forkB)
    const top = Math.max(...m.blocks.flatMap((b) => [b.st.text[0], b.st.place[0]]))
    expect(m.clock).toBeGreaterThanOrEqual(top)
  })
})

describe('who edited when', () => {
  it('an op stamps my did in seen, a merge keeps the latest per person, junk is cleaned', () => {
    const before = Date.now()
    const one = seeded(['a'])
    const x = editText(one, tree(one)[0].id, 'b', B)
    expect(x.seen?.['did:b']).toBeGreaterThanOrEqual(before)
    const m = merge({ ...x, seen: { 'did:a': 5, 'did:b': 9 } }, { ...x, seen: { 'did:a': 7, 'did:b': 1 } })
    expect(m.seen).toEqual({ 'did:a': 7, 'did:b': 9 })
    expect(merge({ ...x, seen: { 'did:b': 1 } }, { ...x, seen: { 'did:b': 2 } })).toEqual(merge({ ...x, seen: { 'did:b': 2 } }, { ...x, seen: { 'did:b': 1 } }))
    const raw = JSON.parse(JSON.stringify(x))
    raw.seen = { 'did:b': 'soon', 'did:c': 3, __proto__: 5 }
    expect(cleanDoc(raw).seen).toEqual({ 'did:c': 3 })
  })
})

describe('text mode', () => {
  it('toText is the Logseq/Tana outline', () => {
    let d = seeded(['one', 'two'])
    d = indent(d, idOf(d, 'two'), A)
    expect(toText(d)).toBe('- one\n  - two')
  })
  it('fromText round-trips an outline and keeps the ids of unchanged lines', () => {
    const x = '- a\n  - b\n  - c\n- d'
    const d = fromText(seeded([]), x, A, T)
    expect(toText(d)).toBe(x)
    const idB = idOf(d, 'b')
    const d2 = fromText(d, '- a\n  - b\n  - c changed\n  - new\n- d', A, T)
    expect(toText(d2)).toBe('- a\n  - b\n  - c changed\n  - new\n- d')
    expect(idOf(d2, 'b')).toBe(idB)
  })
  it('fromText tombstones removed lines and moves re-indented ones', () => {
    const d = fromText(seeded([]), '- a\n- b\n- c', A, T)
    const d2 = fromText(d, '- a\n  - c', A, T)
    expect(toText(d2)).toBe('- a\n  - c')
    expect(d2.blocks.filter((b) => b.del).length).toBe(1)
    expect(idOf(d2, 'c')).toBe(idOf(d, 'c'))
  })
  it('fromText on equal text changes nothing (clock stays)', () => {
    const d = fromText(seeded([]), '- a\n- b', A, T)
    const d2 = fromText(d, toText(d), A, T)
    expect(d2).toBe(d)
  })
})

describe('cleanDoc', () => {
  const snapshot = JSON.stringify(seeded(['one', 'two']))
  const good = () => JSON.parse(snapshot)
  it('accepts a real doc unchanged', () => {
    expect(cleanDoc(good())).toEqual(good())
  })
  it('never throws on hostile input and returns null for non-documents', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { id: 1 }, { id: 'a', blocks: 'x' }, { id: 'a', title: {}, blocks: [null, 5, { id: {} }] }]) {
      expect(() => cleanDoc(bad)).not.toThrow()
    }
    expect(cleanDoc(null)).toBeNull()
    expect(cleanDoc({})).toBeNull()
  })
  it('drops broken blocks, clamps text, positions, stamps and counts', () => {
    const raw = good()
    raw.blocks[0].text = 'x'.repeat(5000)
    raw.blocks[1].pos = 'not valid!'
    raw.blocks[1].st.text = ['NaN', 5]
    raw.clock = Infinity
    raw.blocks.push({ ...raw.blocks[0], id: raw.blocks[0].id })
    const d = cleanDoc(raw)
    expect(d.blocks.length).toBe(1)
    expect(d.blocks[0].text.length).toBe(500)
    expect(Number.isFinite(d.clock)).toBe(true)
    const many = good()
    many.blocks = Array.from({ length: 2000 }, (_, i) => ({ ...many.blocks[0], id: `b${i}` }))
    expect(cleanDoc(many).blocks.length).toBeLessThanOrEqual(1000)
  })
  it('strips unsafe characters and unknown share values', () => {
    const raw = good()
    raw.blocks[0].text = 'a‮b\u0000c'
    raw.blocks[0].share = 'everyone'
    const d = cleanDoc(raw)
    expect(d.blocks[0].text).toBe('abc')
    expect(d.blocks[0].share).toBeUndefined()
  })
  it('__proto__ keys do not leak', () => {
    const d = cleanDoc(JSON.parse('{"__proto__":{"x":1},"id":"q","title":"t","blocks":[],"people":[],"clock":0,"mode":"outline"}'))
    expect(d?.x).toBeUndefined()
    expect({}.x).toBeUndefined()
  })
})

describe('review fixes (wave36b)', () => {
  it('a deleted line carries no words to anyone, and the blank wins over the old text in a merge', () => {
    const d = seeded(['keep', 'secret'])
    const gone = remove(d, idOf(d, 'secret'), A)
    expect(gone.blocks.find((b) => b.del).text).toBe('')
    expect(merge(d, gone).blocks.find((b) => b.del).text).toBe('')
  })
  it('a long note typed line after line survives the wire (keys grow but are not dropped)', () => {
    let d = newDoc({ id: 'd1', title: 'Long', me: A, at: T })
    let last = null
    for (let i = 0; i < 500; i++) { const r = insertAfter(d, last, `line ${i}`, A, T); d = r.doc; last = r.id }
    expect(cleanDoc(JSON.parse(JSON.stringify(d))).blocks.length).toBe(500)
  })
  it('a key ending in the lowest digit is refused from the wire (nothing could ever sort before it)', () => {
    const d = seeded(['x'])
    const raw = JSON.parse(JSON.stringify(d))
    raw.blocks[0].pos = 'V0'
    expect(cleanDoc(raw).blocks.length).toBe(0)
  })
  it('a re-linked Logseq block wins over the older link in a merge, both ways', () => {
    const d = setLogseq(seeded(['x']), { graph: 'g', uuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }, A)
    const relinked = setLogseq(d, { graph: 'g', uuid: '00000000-0000-4000-8000-000000000000' }, A)
    expect(merge(d, relinked).logseq.uuid).toBe('00000000-0000-4000-8000-000000000000')
    expect(merge(relinked, d).logseq.uuid).toBe('00000000-0000-4000-8000-000000000000')
    const unlinked = setLogseq(relinked, undefined, A)
    expect(merge(relinked, unlinked).logseq).toBeUndefined()
    expect(cleanDoc(JSON.parse(JSON.stringify(relinked))).logseqSt).toEqual(relinked.logseqSt)
  })
  it('a line added in the middle in plain text does not move the lines after it', () => {
    const d = seeded(['one', 'two', 'three', 'four'])
    const next = fromText(d, '- one\n- new\n- two\n- three\n- four', A, T)
    expect(texts(next)).toEqual(['0:one', '0:new', '0:two', '0:three', '0:four'])
    for (const t of ['two', 'three', 'four']) {
      const before = d.blocks.find((b) => b.text === t)
      const after = next.blocks.find((b) => b.text === t)
      expect(after.st.place).toEqual(before.st.place)
    }
  })
  it('plain text typed over an older copy keeps what others added meanwhile', () => {
    const base = seeded(['one', 'two'])
    const theirs = insertAfter(base, idOf(base, 'two'), 'from Ben', B, T).doc
    const mine = textOver(base, theirs, '- one\n- two edited\n- new', A, T)
    expect(texts(mine.doc).sort()).toEqual(['0:from Ben', '0:new', '0:one', '0:two edited'])
    expect(textOver(base, theirs, toText(base), A, T).doc).toBe(theirs)
    // a second commit of the same box text (blur again) adds nothing twice
    const again = textOver(mine.base, mine.doc, '- one\n- two edited\n- new', A, T)
    expect(again.doc).toBe(mine.doc)
  })
})
