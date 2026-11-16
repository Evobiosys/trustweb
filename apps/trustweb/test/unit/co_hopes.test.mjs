// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Hopes and wishes (wave 44 feed-hopes): the bottom line is always an empty line of mine; Enter appends at the bottom, never twice in a row.
import { desiresDoc, ensureMine, mineId } from '../../src/ext/co_notes/co_desires.ts'
import { bottomLine } from '../../src/ext/co_notes/co_lines.ts'
import { editText, tree } from '../../src/ext/co_notes/co_doc.ts'
import { S } from '../../src/strings.ts'

const A = { did: 'did:key:zAnna0000001', name: 'Anna' }
const B = { did: 'did:key:zBen000000002', name: 'Ben' }
const T = 1_800_000_000_000
const base = () => ensureMine(desiresDoc({ kind: 'desires', ev: { id: 'ev1', name: 'Retreat' }, me: A, others: [B], at: T }), A, T).doc
const mine = (d) => tree(d).filter((r) => r.depth === 1 && r.by.did === A.did)

describe('bottomLine', () => {
  it('makes one empty line under my chip when I have none, shared as "me"', () => {
    const r = bottomLine(base(), A, T)
    expect(mine(r.doc).map((x) => x.text)).toEqual([''])
    expect(mine(r.doc)[0]).toMatchObject({ id: r.id, share: 'me' })
    expect(tree(r.doc)[0].id).toBe(mineId(A))
  })
  it('reuses an empty last line instead of adding another', () => {
    const one = bottomLine(base(), A, T)
    const two = bottomLine(one.doc, A, T)
    expect(two.id).toBe(one.id)
    expect(two.doc).toBe(one.doc)
  })
  it('appends an empty line after the last filled one, at the bottom', () => {
    const a = bottomLine(base(), A, T)
    const filled = editText(a.doc, a.id, 'sauna', A)
    const b = bottomLine(filled, A, T)
    const c = bottomLine(editText(b.doc, b.id, 'hikes', A), A, T)
    expect(mine(c.doc).map((x) => x.text)).toEqual(['sauna', 'hikes', ''])
    expect(mine(c.doc)[2].id).toBe(c.id)
  })
  it('leaves other people\'s lines alone (only my block grows)', () => {
    const r = bottomLine(base(), A, T)
    expect(tree(r.doc).filter((x) => x.by.did === B.did)).toEqual([])
  })
})

describe('wording', () => {
  it('calls the list hopes and wishes and explains it', () => {
    expect(S.coDesires.desires).toBe('Hopes and wishes')
    expect(S.coDesires.desiresTitle('X')).toBe('Hopes and wishes: X')
    expect(S.coDesires.explain).toMatch(/Enter adds the next line/)
  })
})
