/**
 * TrustWeb wave 6 (U1): the optional hop fields of a query (types.ts
 * QueryEnvelope, between the wave-6 markers). Same strictness as `direct`:
 * absent is fine, present-and-malformed rejects the whole envelope, and an
 * ask without them parses to exactly the shape it had before.
 */
import { describe, expect, it } from 'vitest'
import { decodeFromQr, encodeForQr } from '../src/wire'
import { HOP_CAP, HOPS_UNBOUNDED, SEEN_MAX } from '../src/types'

const BASE = {
  v: 1, t: 'query', from: { id: 'ann', displayName: 'Ann' }, templateId: 'free', templateVersion: 1,
  qid: 'q1', issuedAt: 1, freeText: 'Who has a ladder?',
}
const parse = (o: Record<string, unknown>): unknown => decodeFromQr(JSON.stringify(o))

describe('query hop fields', () => {
  it('an ask without them parses exactly as before (no hop key appears)', () => {
    const back = parse(BASE) as Record<string, unknown>
    expect(back).toEqual(BASE)
    for (const k of ['maxHops', 'hop', 'root', 'seen', 'via', 'door']) expect(k in back).toBe(false)
  })

  it('well-formed fields round-trip', () => {
    const q = { ...BASE, relayed: true, maxHops: 3, hop: 1, root: 'rootABC123', seen: ['0123456789abcdef'], via: ['Ann'], door: true }
    expect(decodeFromQr(encodeForQr(q as never))).toEqual(q)
    expect(parse({ ...BASE, maxHops: HOPS_UNBOUNDED })).toMatchObject({ maxHops: HOPS_UNBOUNDED })
    expect(parse({ ...BASE, maxHops: HOP_CAP, hop: HOP_CAP - 1 })).toMatchObject({ maxHops: HOP_CAP, hop: HOP_CAP - 1 })
    expect(parse({ ...BASE, seen: [], via: [] })).toMatchObject({ seen: [], via: [] })
  })

  it.each([
    ['maxHops 0', { maxHops: 0 }],
    ['maxHops above the cap', { maxHops: HOP_CAP + 1 }],
    ['maxHops -2', { maxHops: -2 }],
    ['maxHops as text', { maxHops: '2' }],
    ['maxHops Infinity (serialises as null)', { maxHops: null }],
    ['maxHops fractional', { maxHops: 2.5 }],
    ['hop negative', { hop: -1 }],
    ['hop at the cap', { hop: HOP_CAP }],
    ['root too short', { root: 'ab' }],
    ['root with odd characters', { root: 'root ABC!' }],
    ['seen not a list', { seen: 'abc' }],
    ['seen entry not 16 hex', { seen: ['XYZ'] }],
    ['seen too long', { seen: Array(SEEN_MAX + 1).fill('0123456789abcdef') }],
    ['via empty name', { via: [''] }],
    ['via name too long', { via: ['x'.repeat(41)] }],
    ['via too many', { via: Array(HOP_CAP + 1).fill('B') }],
    ['via a number', { via: [3] }],
    ['door false', { door: false }],
  ])('rejects the whole envelope: %s', (_name, extra) => {
    expect(parse({ ...BASE, ...extra })).toBeNull()
  })
})
