/** Wave 19 review: fitting together asks never starve the others; a hosted dev record that could not be stored never reports a change. */
import { queueAsk } from '../../src/together_match.ts'
import { seedHostedDevRecord } from '../../src/dev_record.ts'

describe('queueAsk', () => {
  const fits = (a) => a.fit
  it('puts a fitting ask ahead of the waiting non-fitting ones, a non-fitting one at the end', () => {
    const q = [{ id: 'n1', fit: false }]
    const jumped = new WeakSet()
    queueAsk(q, { id: 'f1', fit: true }, fits, jumped)
    queueAsk(q, { id: 'n2', fit: false }, fits, jumped)
    expect(q.map((a) => a.id)).toEqual(['f1', 'n1', 'n2'])
  })
  it('overtakes each non-fitting ask at most once, so a stream of fitting asks cannot starve it', () => {
    const q = [{ id: 'n1', fit: false }]
    const jumped = new WeakSet()
    for (const id of ['f1', 'f2', 'f3']) queueAsk(q, { id, fit: true }, fits, jumped)
    expect(q.map((a) => a.id)).toEqual(['f1', 'n1', 'f2', 'f3'])
  })
})

describe('hosted dev record, storage write fails', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('reports no change (no reload loop) when the record cannot be stored', async () => {
    const m = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (k === 'trustweb.v1.me') throw new Error('QuotaExceededError'); m.set(k, v) }, removeItem: (k) => m.delete(k) })
    const text = JSON.stringify({ v: 1, me: { id: 'x', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
    const fetch = async () => ({ ok: true, status: 200, text: async () => text, headers: { get: () => 'r.json' } })
    const doc = { querySelector: () => ({}) }
    expect(await seedHostedDevRecord('me', { fetch, doc })).toBe(false)
    expect(m.has('trustweb.v1.me.seed')).toBe(false)
  })
})
