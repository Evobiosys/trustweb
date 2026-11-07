/** TrustWeb wave 33: QueryEnvelope.kind 'intro' + target. Optional, both together, malformed rejects, absent parses as before. */
import { describe, expect, it } from 'vitest'
import { decodeFromQr } from '../src/wire'

const BASE = {
  v: 1, t: 'query', from: { id: 'ann', displayName: 'Ann' }, templateId: 'free', templateVersion: 1,
  qid: 'q1', issuedAt: 1, freeText: 'Could you introduce me to Tara?',
}
const parse = (o: Record<string, unknown>): unknown => decodeFromQr(JSON.stringify(o))

describe('query kind intro', () => {
  it('round-trips and an ordinary ask has neither key', () => {
    expect(parse({ ...BASE, kind: 'intro', target: 'Tara' })).toMatchObject({ kind: 'intro', target: 'Tara' })
    const plain = parse(BASE) as Record<string, unknown>
    expect('kind' in plain || 'target' in plain).toBe(false)
  })
  it('rejects one without the other, another kind, an empty or too long target', () => {
    for (const bad of [{ kind: 'intro' }, { target: 'Tara' }, { kind: 'x', target: 'Tara' }, { kind: 'intro', target: '' }, { kind: 'intro', target: 'x'.repeat(81) }]) {
      expect(parse({ ...BASE, ...bad })).toBeNull()
    }
  })
})
