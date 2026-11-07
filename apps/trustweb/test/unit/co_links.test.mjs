// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Co-notes name chips and the Logseq link (src/ext/co_notes/co_links.ts).
import {
  chipToken, degradeChips, forSend, fromEdit, fromLogseq, logseqUrl, parseChips, parseLogseqRef, toEdit, toLogseq,
} from '../../src/ext/co_notes/co_links.ts'
import { fromText, insertAfter, newDoc, setShare, toText, tree } from '../../src/ext/co_notes/co_doc.ts'

const A = { did: 'did:a', name: 'Anna' }
const UUID = '6543b2a1-1234-4abc-8def-0123456789ab'

describe('chips', () => {
  it('formats and parses both token kinds', () => {
    expect(chipToken('Ben', 'did:key:zB')).toBe('@[Ben](did:key:zB)')
    expect(chipToken('Ben', 'tw:p7')).toBe('@[Ben](tw:p7)')
    expect(parseChips('hi @[Ben](did:key:zB) and @[Cara](tw:p7)!')).toEqual([
      { text: 'hi ' }, { chip: { name: 'Ben', ref: 'did:key:zB' } }, { text: ' and ' }, { chip: { name: 'Cara', ref: 'tw:p7' } }, { text: '!' },
    ])
  })
  it('keeps brackets out of names and ignores half tokens', () => {
    expect(chipToken('Be]n (x)', 'tw:1')).toBe('@[Be n x](tw:1)')
    expect(parseChips('@[Ben](') ).toEqual([{ text: '@[Ben](' }])
    expect(parseChips('')).toEqual([])
  })
  it('degrades only local (tw:) tokens for sending', () => {
    expect(degradeChips('x @[Ben](did:key:zB) @[Cara](tw:p7)')).toBe('x @[Ben](did:key:zB) @Cara')
  })
  it('edit form drops the reference and restores it from the known names', () => {
    const t = 'ask @[Ben](did:key:zB) now'
    expect(toEdit(t)).toBe('ask @[Ben] now')
    const refs = new Map([['Ben', 'did:key:zB']])
    expect(fromEdit('ask @[Ben] now', refs)).toBe(t)
    expect(fromEdit('ask @[Nobody] now', refs)).toBe('ask @[Nobody] now')
  })
})

describe('forSend', () => {
  it('degrades tw: chips and strips lines kept at "me" with everything under them', () => {
    let d = newDoc({ id: 'd', title: 't', me: A, at: 1 })
    const a = insertAfter(d, null, 'open @[Cara](tw:p7)', A, 1); d = a.doc
    const b = insertAfter(d, a.id, 'private', A, 1); d = setShare(b.doc, b.id, 'me', A)
    const c = insertAfter(d, b.id, 'shared', A, 1, { share: 'event' }); d = c.doc
    const out = forSend(d)
    expect(tree(out).map((r) => r.text)).toEqual(['open @Cara', 'shared'])
    expect(out.blocks.some((x) => x.text === 'private')).toBe(false)
  })
})

describe('logseq link', () => {
  it('parses the URL and the short form, rejects junk', () => {
    expect(parseLogseqRef(`logseq://graph/My%20Graph?block-id=${UUID}`)).toEqual({ graph: 'My Graph', uuid: UUID })
    expect(parseLogseqRef(`  mygraph/${UUID} `)).toEqual({ graph: 'mygraph', uuid: UUID })
    expect(parseLogseqRef('logseq://graph/x?block-id=nope')).toBeNull()
    expect(parseLogseqRef('')).toBeNull()
    expect(parseLogseqRef(`/${UUID}`)).toBeNull()
  })
  it('builds the URL back', () => {
    expect(logseqUrl({ graph: 'My Graph', uuid: UUID })).toBe(`logseq://graph/My%20Graph?block-id=${UUID}`)
  })
  it('exports chips as [[Name]] page references and carries the id property', () => {
    let d = newDoc({ id: 'd', title: 't', me: A, at: 1 })
    d = fromText(d, '- call @[Ben](did:key:zB)\n  - sub', A, 1)
    d = { ...d, logseq: { graph: 'g', uuid: UUID } }
    expect(toLogseq(d)).toBe(`- call [[Ben]]\n  id:: ${UUID}\n  - sub`)
    expect(toLogseq({ ...d, logseq: undefined })).toBe('- call [[Ben]]\n  - sub')
  })
  it('imports markdown: drops property lines, takes the first id', () => {
    const md = `- first\n  id:: ${UUID}\n  collapsed:: true\n  - child\n- second\n  id:: 11111111-1111-4111-8111-111111111111`
    expect(fromLogseq(md)).toEqual({ text: '- first\n  - child\n- second', uuid: UUID })
    expect(fromLogseq('- a\n- b')).toEqual({ text: '- a\n- b' })
    expect(fromLogseq('- a\n  id:: nonsense')).toEqual({ text: '- a' })
  })
  it('round trips through toText', () => {
    const d = fromText(newDoc({ id: 'd', title: 't', me: A, at: 1 }), '- a\n  - b', A, 1)
    expect(fromLogseq(toLogseq(d)).text).toBe(toText(d))
  })
})
