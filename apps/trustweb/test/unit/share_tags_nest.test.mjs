// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: tags nest (tag:child nested_in tag:parent), a DAG, depth cap 4, cycles rejected at write (D4). */
import { canAccess } from '../../src/share_sink/check.ts'
import { nest, depthOf, MAX_DEPTH } from '../../src/share_sink/tags.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { NOW } from '../helpers/share_sink_store.mjs'

const row = (s, r, o) => JSON.stringify({ subject: s, relation: r, object: o, since: '2026-01-01T00:00:00.000Z', by: 'device:laptop' })
const store = (...rows) => parseJsonl(rows.join('\n'))
const WHEN = new Date(NOW)

describe('exclusion beats tag (T2)', () => {
  it('a tag the item excludes closes the item for its members', () => {
    const s = store(row('person:ada', 'has_tag', 'tag:garden'), row('tag:garden', 'may_read', 'item:seeds'), row('tag:garden', 'excludes', 'item:seeds'))
    expect(canAccess(s, 'person:ada', 'item:seeds', NOW).allowed).toBe(false)
  })
})

describe('nested tags (T3)', () => {
  it('a person holding a child tag gets the parent tag\'s items; the why lists the nesting', () => {
    const s = store(
      row('tag:b', 'nested_in', 'tag:a'), row('tag:c', 'nested_in', 'tag:b'),
      row('person:ada', 'has_tag', 'tag:c'), row('tag:a', 'may_read', 'item:x'),
    )
    const r = canAccess(s, 'person:ada', 'item:x', NOW)
    expect(r.allowed).toBe(true)
    expect(r.why.map((t) => t.relation)).toEqual(['has_tag', 'nested_in', 'nested_in', 'may_read'])
  })
  it('a parent-only holder does not get the child tag\'s items', () => {
    const s = store(row('tag:c', 'nested_in', 'tag:b'), row('person:ada', 'has_tag', 'tag:b'), row('tag:c', 'may_read', 'item:y'))
    expect(canAccess(s, 'person:ada', 'item:y', NOW).allowed).toBe(false)
  })
  it('depth 4 is allowed, depth 5 is rejected at write', () => {
    expect(MAX_DEPTH).toBe(4)
    let s = []
    s = nest(s, 'tag:b', 'tag:a', 'device:laptop', WHEN)
    s = nest(s, 'tag:c', 'tag:b', 'device:laptop', WHEN)
    s = nest(s, 'tag:d', 'tag:c', 'device:laptop', WHEN)
    expect(depthOf(s, 'tag:d')).toBe(4)
    expect(() => nest(s, 'tag:e', 'tag:d', 'device:laptop', WHEN)).toThrow()
  })
})

describe('cycles and the DAG (T4, T5)', () => {
  it('a cycle is rejected at write and the store is left as it was', () => {
    let s = []
    s = nest(s, 'tag:b', 'tag:a', 'device:laptop', WHEN)
    s = nest(s, 'tag:c', 'tag:b', 'device:laptop', WHEN)
    const before = JSON.stringify(s)
    expect(() => nest(s, 'tag:a', 'tag:c', 'device:laptop', WHEN)).toThrow()
    expect(() => nest(s, 'tag:a', 'tag:a', 'device:laptop', WHEN)).toThrow()
    expect(JSON.stringify(s)).toBe(before)
  })
  it('two parents: membership through either counts', () => {
    const s = store(
      row('tag:x', 'nested_in', 'tag:a'), row('tag:x', 'nested_in', 'tag:b'),
      row('person:ada', 'has_tag', 'tag:x'), row('tag:a', 'may_read', 'item:a1'), row('tag:b', 'may_read', 'item:b1'),
    )
    expect(canAccess(s, 'person:ada', 'item:a1', NOW).allowed).toBe(true)
    expect(canAccess(s, 'person:ada', 'item:b1', NOW).allowed).toBe(true)
    expect(canAccess(store(row('person:bo', 'has_tag', 'tag:y'), row('tag:a', 'may_read', 'item:a1')), 'person:bo', 'item:a1', NOW).allowed).toBe(false)
  })
})
