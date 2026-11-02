// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The append-only record log (src/log.ts): chain, vector clocks, verified merge, deterministic materialize. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RecordLog, compareEntries, dominates, entryHash, isConcurrent } from './log.ts'
import type { FieldConflict, LogEntry, Op } from './log.ts'

const put = (id: string, field: string, value: unknown, kind = 'person'): Op => ({ t: 'put', kind, id, field, value })
const del = (id: string, kind = 'person'): Op => ({ t: 'del', kind, id })

/** A copy of `e` with `patch` applied and the hash recomputed, so only the chain / identity check can catch it. */
async function rehashed(e: LogEntry, patch: Partial<LogEntry>): Promise<LogEntry> {
  const { hash: _h, ...rest } = { ...structuredClone(e), ...patch }
  return { ...rest, hash: await entryHash(rest) }
}

const conflictKey = (c: FieldConflict) => `${c.kind}|${c.id}|${c.field}|${c.kept.id}|${c.dropped.id}`
const sortedConflicts = (cs: FieldConflict[]) => cs.map(conflictKey).sort()

/** Two devices that both merged everything: the shared state after a full sync. */
async function syncBoth(a: RecordLog, b: RecordLog): Promise<void> {
  await a.merge(b.since(a.heads()))
  await b.merge(a.since(b.heads()))
}

describe('append', () => {
  it('builds the per-device chain, sequence, id and vector clock', async () => {
    const log = new RecordLog('Phone')
    const e1 = await log.append(put('p1', 'name', 'alpha'), 100)
    const e2 = await log.append(put('p1', 'city', 'beta'), 200)
    assert.equal(e1.id, 'Phone:1')
    assert.equal(e1.seq, 1)
    assert.equal(e1.prev, '')
    assert.deepEqual(e1.vc, { Phone: 1 })
    assert.equal(e2.id, 'Phone:2')
    assert.equal(e2.prev, e1.hash)
    assert.deepEqual(e2.vc, { Phone: 2 })
    assert.equal(e2.at, 200)
    const { hash, ...rest } = e2
    assert.equal(hash, await entryHash(rest))
    assert.deepEqual(log.heads(), { Phone: 2 })
    assert.deepEqual(log.entries().map((e) => e.id), ['Phone:1', 'Phone:2'])
  })

  it('the vector clock names every device known at append time', async () => {
    const laptop = new RecordLog('Laptop')
    await laptop.append(put('p1', 'name', 'alpha'), 1)
    await laptop.append(put('p1', 'name', 'beta'), 2)
    const phone = new RecordLog('Phone')
    await phone.merge([...laptop.entries()])
    const e = await phone.append(put('p1', 'city', 'gamma'), 3)
    assert.deepEqual(e.vc, { Laptop: 2, Phone: 1 })
  })

  it('serializes concurrent appends (no duplicate seq)', async () => {
    const log = new RecordLog('Phone')
    const es = await Promise.all([1, 2, 3].map((i) => log.append(put('p1', 'n', i), i)))
    assert.deepEqual(es.map((e) => e.seq), [1, 2, 3])
    assert.equal(es[2]!.prev, es[1]!.hash)
  })

  it('returned entries are frozen and changing the op passed in later does not change the log', async () => {
    const log = new RecordLog('Phone')
    const mutableOp: { t: 'put'; kind: string; id: string; field: string; value: string[] } = { t: 'put', kind: 'person', id: 'p1', field: 'tags', value: ['a'] }
    const e = await log.append(mutableOp, 1)
    mutableOp.value.push('b')
    assert.deepEqual(log.materialize().entities['person']!['p1']!['tags'], ['a'])
    assert.ok(Object.isFrozen(e))
    assert.throws(() => { (e as { at: number }).at = 9 })
  })

  it('refuses an op that is not JSON', async () => {
    const log = new RecordLog('Phone')
    await assert.rejects(log.append(put('p1', 'x', undefined), 1))
    await assert.rejects(log.append(put('p1', 'x', () => 1), 1))
    await assert.rejects(log.append({ t: 'nope' } as unknown as Op, 1))
    assert.deepEqual(log.heads(), {})
  })
})

describe('entryHash, dominates, isConcurrent, compareEntries', () => {
  it('the hash covers every field but `hash` and does not depend on key order', async () => {
    const e = { id: 'Phone:1', device: 'Phone', seq: 1, vc: { Phone: 1, Laptop: 2 }, at: 5, prev: '', op: put('p1', 'name', { b: 1, a: 2 }) }
    const reordered = { op: { value: { a: 2, b: 1 }, field: 'name', id: 'p1', kind: 'person', t: 'put' as const }, prev: '', at: 5, vc: { Laptop: 2, Phone: 1 }, seq: 1, device: 'Phone', id: 'Phone:1' }
    const h = await entryHash(e)
    assert.match(h, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(await entryHash(reordered), h)
    assert.equal(await entryHash({ ...e, hash: 'ignored' } as typeof e), h)
    for (const patch of [{ at: 6 }, { prev: 'x' }, { vc: { Phone: 1 } }, { op: put('p1', 'name', 'other') }]) {
      assert.notEqual(await entryHash({ ...e, ...patch }), h)
    }
  })

  it('dominates and isConcurrent', () => {
    assert.ok(dominates({ A: 2, B: 1 }, { A: 1 }))
    assert.ok(dominates({ A: 1 }, { A: 1 }))
    assert.ok(!dominates({ A: 1 }, { A: 1, B: 1 }))
    const e = (vc: Record<string, number>) => ({ vc }) as LogEntry
    assert.ok(isConcurrent(e({ A: 1 }), e({ B: 1 })))
    assert.ok(!isConcurrent(e({ A: 1 }), e({ A: 1, B: 1 })))
  })

  it('compareEntries: (at, device, seq) ascending', () => {
    const e = (at: number, device: string, seq: number) => ({ at, device, seq }) as LogEntry
    const list = [e(2, 'A', 1), e(1, 'B', 2), e(1, 'B', 1), e(1, 'A', 9)]
    assert.deepEqual(list.sort(compareEntries).map((x) => `${x.at}${x.device}${x.seq}`), ['1A9', '1B1', '1B2', '2A1'])
  })
})

describe('heads and since', () => {
  it('heads are the highest CONTIGUOUS seq per device', async () => {
    const src = new RecordLog('Phone')
    const [a, , c] = [await src.append(put('p1', 'n', 1), 1), await src.append(put('p1', 'n', 2), 2), await src.append(put('p1', 'n', 3), 3)]
    assert.deepEqual(new RecordLog('Laptop', [a!, c!]).heads(), { Phone: 1 })
  })

  it('since(heads) returns exactly the missing entries, by device then seq', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    for (let i = 1; i <= 3; i++) await phone.append(put('p1', 'n', i), i)
    for (let i = 1; i <= 2; i++) await laptop.append(put('p2', 'n', i), 10 + i)
    await laptop.merge([...phone.entries()])
    assert.deepEqual(laptop.since({ Phone: 1 }).map((e) => e.id), ['Laptop:1', 'Laptop:2', 'Phone:2', 'Phone:3'])
    assert.deepEqual(laptop.since({ Phone: 3, Laptop: 1 }).map((e) => e.id), ['Laptop:2'])
    assert.deepEqual(laptop.since(laptop.heads()), [])
    assert.equal(laptop.since({}).length, 5)
  })
})

describe('merge', () => {
  it('is idempotent: a second merge of the same batch counts duplicates and adds nothing', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'name', 'alpha'), 1)
    await phone.append(put('p1', 'city', 'beta'), 2)
    const laptop = new RecordLog('Laptop')
    assert.deepEqual(await laptop.merge([...phone.entries()]), { added: 2, duplicates: 0, rejected: [] })
    const before = JSON.stringify(laptop.materialize())
    assert.deepEqual(await laptop.merge([...phone.entries(), ...phone.entries()]), { added: 0, duplicates: 4, rejected: [] })
    assert.equal(laptop.entries().length, 2)
    assert.equal(JSON.stringify(laptop.materialize()), before)
  })

  it('sorts the batch, so an out-of-order batch still chains', async () => {
    const phone = new RecordLog('Phone')
    for (let i = 1; i <= 3; i++) await phone.append(put('p1', 'n', i), i)
    const laptop = new RecordLog('Laptop')
    const r = await laptop.merge([...phone.entries()].reverse())
    assert.deepEqual(r, { added: 3, duplicates: 0, rejected: [] })
    assert.deepEqual(laptop.heads(), { Phone: 3 })
  })

  it('is commutative: A∪B and B∪A give byte-identical materialized JSON', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    await phone.append(put('p1', 'name', 'alpha'), 10)
    await phone.append(put('r1', 'title', 'Bike', 'resource'), 11)
    await laptop.append(put('p1', 'name', 'beta'), 12)
    await laptop.append(del('r1', 'resource'), 13)
    await laptop.append(put('p2', 'name', 'gamma'), 14)
    const ab = new RecordLog('X')
    await ab.merge([...phone.entries()])
    await ab.merge([...laptop.entries()])
    const ba = new RecordLog('Y')
    await ba.merge([...laptop.entries()])
    await ba.merge([...phone.entries()])
    await syncBoth(phone, laptop)
    const json = JSON.stringify(ab.materialize())
    assert.equal(JSON.stringify(ba.materialize()), json)
    assert.equal(JSON.stringify(phone.materialize()), json)
    assert.equal(JSON.stringify(laptop.materialize()), json)
  })

  it('tampered entry → bad-hash, not added; the rest of that device in the batch become chain-gaps', async () => {
    const phone = new RecordLog('Phone')
    for (let i = 1; i <= 3; i++) await phone.append(put('p1', 'n', `v${i}`), i)
    const [e1, e2, e3] = phone.entries()
    const tampered = { ...structuredClone(e2!), op: put('p1', 'n', 'evil') }
    const laptop = new RecordLog('Laptop')
    const r = await laptop.merge([e1, tampered, e3])
    assert.deepEqual(r, { added: 1, duplicates: 0, rejected: [{ id: 'Phone:2', reason: 'bad-hash' }, { id: 'Phone:3', reason: 'chain-gap' }] })
    assert.deepEqual(laptop.heads(), { Phone: 1 })
    assert.deepEqual(laptop.entries().map((e) => e.id), ['Phone:1'])
  })

  it('missing predecessor → chain-gap; delivering it later then accepts both', async () => {
    const phone = new RecordLog('Phone')
    for (let i = 1; i <= 2; i++) await phone.append(put('p1', 'n', i), i)
    const [e1, e2] = phone.entries()
    const laptop = new RecordLog('Laptop')
    assert.deepEqual((await laptop.merge([e2])).rejected, [{ id: 'Phone:2', reason: 'chain-gap' }])
    assert.equal(laptop.entries().length, 0)
    assert.deepEqual(await laptop.merge([e1, e2]), { added: 2, duplicates: 0, rejected: [] })
  })

  it('a correctly hashed entry whose prev does not match the predecessor we hold → fork (two histories), not chain-gap', async () => {
    const phone = new RecordLog('Phone')
    for (let i = 1; i <= 2; i++) await phone.append(put('p1', 'n', i), i)
    const [e1, e2] = phone.entries()
    const bad = await rehashed(e2!, { prev: 'A'.repeat(43) })
    const laptop = new RecordLog('Laptop')
    assert.deepEqual((await laptop.merge([e1, bad])).rejected, [{ id: 'Phone:2', reason: 'fork' }])
    const badFirst = await rehashed(e1!, { prev: 'x' })
    assert.deepEqual((await new RecordLog('Tablet').merge([badFirst])).rejected, [{ id: 'Phone:1', reason: 'fork' }])
  })

  it('a forged "next" entry under another device id is caught as a fork when the real one arrives, and reported, not silently kept', async () => {
    // Laptop (compromised) writes Phone:2 itself and sends it to Tablet first; Phone's real Phone:2 then arrives.
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'n', 'real-1'), 1)
    await phone.append(put('p1', 'n', 'real-2'), 2)
    const [real1, real2] = phone.entries()
    const forged = await rehashed(real2!, { op: put('p1', 'n', 'forged'), at: 99 })
    const tablet = new RecordLog('Tablet')
    assert.deepEqual(await tablet.merge([real1, forged]), { added: 2, duplicates: 0, rejected: [] })
    const r = await tablet.merge([real2])
    assert.deepEqual(r.rejected, [{ id: 'Phone:2', reason: 'fork' }])
    // The forgery stays (entries are not signed: this is what the honest label admits); the report makes it visible.
    assert.equal(tablet.materialize().entities['person']!['p1']!['n'], 'forged')
  })

  it('entries carrying MY OWN device id are refused (own) unless recovery is asked for', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'n', 'mine'), 1)
    const mine = phone.entries()[0]!
    const forgedNext = await rehashed(mine, { id: 'Phone:2', seq: 2, vc: { Phone: 2 }, prev: mine.hash, op: put('p1', 'n', 'not mine') })
    assert.deepEqual((await phone.merge([forgedNext])).rejected, [{ id: 'Phone:2', reason: 'own' }])
    assert.equal(phone.heads()['Phone'], 1)
    // recovery: a fresh log for the same device takes its history back from a peer only when asked
    const restored = new RecordLog('Phone')
    assert.deepEqual((await restored.merge([mine])).rejected, [{ id: 'Phone:1', reason: 'own' }])
    assert.deepEqual(await restored.merge([mine], { acceptOwn: true }), { added: 1, duplicates: 0, rejected: [] })
    assert.equal((await restored.append(put('p1', 'n', 'after recovery'), 5)).seq, 2)
  })

  it('device ids are base64url names; a name like a prototype property is plain data everywhere', async () => {
    assert.throws(() => new RecordLog('has space'))
    assert.throws(() => new RecordLog(''))
    assert.throws(() => new RecordLog('a|b'))
    const odd = new RecordLog('constructor')
    await odd.append(put('p1', 'n', 'odd'), 1)
    const laptop = new RecordLog('Laptop')
    assert.deepEqual(await laptop.merge(odd.entries() as unknown[]), { added: 1, duplicates: 0, rejected: [] })
    assert.equal(Object.hasOwn(laptop.heads(), 'constructor'), true)
    assert.equal(laptop.heads()['constructor'], 1)
    assert.equal(laptop.since({}).length, 1)
    assert.equal(laptop.since({ constructor: 1 } as Record<string, number>).length, 0)
    assert.equal(laptop.since({ constructor: 0 } as Record<string, number>).length, 1)
    // a vc naming __proto__ (an own key from JSON) is data too: nothing is polluted, dominance reads own keys only
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'n', 1), 1)
    const e = phone.entries()[0]!
    const evilVc = await rehashed(e, { vc: JSON.parse('{"Phone":1,"__proto__":3}') as Record<string, number> })
    assert.deepEqual(await new RecordLog('Tablet').merge([evilVc]), { added: 1, duplicates: 0, rejected: [] })
    assert.equal(({} as Record<string, unknown>)['__proto__'] === Object.prototype, true, 'untouched prototype')
    assert.equal(dominates({}, JSON.parse('{"constructor":5}') as Record<string, number>), false)
  })

  it('same id with different content → fork, the known entry stays', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'n', 'alpha'), 1)
    const laptop = new RecordLog('Laptop')
    await laptop.merge([...phone.entries()])
    const forked = await rehashed(phone.entries()[0]!, { op: put('p1', 'n', 'omega') })
    assert.deepEqual(await laptop.merge([forked]), { added: 0, duplicates: 0, rejected: [{ id: 'Phone:1', reason: 'fork' }] })
    assert.equal(laptop.materialize().entities['person']!['p1']!['n'], 'alpha')
  })

  it('malformed input → malformed (never throws), with the id when there is one', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'n', 'alpha'), 1)
    const good = phone.entries()[0]!
    const variants: unknown[] = [
      null, 'x', 42, [],
      { ...good, op: undefined },
      { ...good, id: 'Phone:2' },
      { ...good, seq: 0, id: 'Phone:0' },
      { ...good, seq: 1.5, id: 'Phone:1.5' },
      { ...good, vc: { Phone: 2 } },
      { ...good, vc: { Phone: 1, Laptop: -1 } },
      { ...good, at: 'now' },
      { ...good, hash: 5 },
      { ...good, extra: true },
      { ...good, op: { t: 'put', kind: 'person', id: 'p1', field: 'n' } },
      { ...good, op: { t: 'zap', kind: 'person', id: 'p1' } },
      { ...good, op: { t: 'del', kind: 'person', id: 7 } },
      { ...good, op: { ...good.op, value: { n: Number.NaN } } },
    ]
    const laptop = new RecordLog('Laptop')
    const r = await laptop.merge(variants)
    assert.equal(r.added, 0)
    assert.equal(r.rejected.length, variants.length)
    assert.ok(r.rejected.every((x) => x.reason === 'malformed'), JSON.stringify(r.rejected))
    assert.ok(r.rejected.some((x) => x.id === 'Phone:1'))
    assert.equal(laptop.entries().length, 0)
  })

  it('never mutates or keeps a reference to the incoming objects', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'tags', ['a']), 1)
    const wire = JSON.parse(JSON.stringify(phone.entries())) as LogEntry[]
    const snapshot = JSON.stringify(wire)
    const laptop = new RecordLog('Laptop')
    await laptop.merge(wire)
    assert.equal(JSON.stringify(wire), snapshot)
    ;(wire[0]!.op as { value: string[] }).value.push('b')
    wire[0]!.vc['Phone'] = 99
    assert.deepEqual(laptop.materialize().entities['person']!['p1']!['tags'], ['a'])
    assert.deepEqual(laptop.heads(), { Phone: 1 })
    await assert.doesNotReject(laptop.merge([Object.freeze(structuredClone(phone.entries()[0]!))]))
  })
})

describe('materialize', () => {
  it('folds puts into entities[kind][id][field]', async () => {
    const log = new RecordLog('Phone')
    await log.append(put('p1', 'name', 'alpha'), 1)
    await log.append(put('p1', 'name', 'beta'), 2)
    await log.append(put('r1', 'title', 'Bike', 'resource'), 3)
    assert.deepEqual(log.materialize(), { entities: { person: { p1: { name: 'beta' } }, resource: { r1: { title: 'Bike' } } }, conflicts: [] })
  })

  it('concurrent puts on one field: one winner (later at), one FieldConflict, the same on both devices', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    const a = await phone.append(put('p1', 'name', 'alpha'), 100)
    const b = await laptop.append(put('p1', 'name', 'beta'), 200)
    await syncBoth(phone, laptop)
    for (const log of [phone, laptop]) {
      const m = log.materialize()
      assert.equal(m.entities['person']!['p1']!['name'], 'beta')
      assert.equal(m.conflicts.length, 1)
      assert.deepEqual(m.conflicts[0], { kind: 'person', id: 'p1', field: 'name', kept: b, dropped: a })
    }
    assert.equal(JSON.stringify(phone.materialize()), JSON.stringify(laptop.materialize()))
  })

  it('equal wall clocks: the device id decides (string compare), deterministically', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    await phone.append(put('p1', 'name', 'alpha'), 100)
    await laptop.append(put('p1', 'name', 'beta'), 100)
    await syncBoth(phone, laptop)
    assert.equal(phone.materialize().entities['person']!['p1']!['name'], 'alpha') // 'Phone' > 'Laptop'
    assert.equal(laptop.materialize().entities['person']!['p1']!['name'], 'alpha')
  })

  it('a causally later put wins without a conflict, even with an EARLIER wall clock', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'name', 'alpha'), 1000)
    const laptop = new RecordLog('Laptop')
    await laptop.merge([...phone.entries()])
    await laptop.append(put('p1', 'name', 'beta'), 5) // the Laptop clock is wrong, but it saw alpha
    await syncBoth(phone, laptop)
    for (const log of [phone, laptop]) assert.deepEqual(log.materialize(), { entities: { person: { p1: { name: 'beta' } } }, conflicts: [] })
  })

  it('a winner is never an entry that something else causally replaced (clock skew)', async () => {
    // a (Phone, at 5) and b (Tablet, at 10) are concurrent; c (Laptop, at 3) saw b and replaced it.
    // The live candidates are a and c; a has the larger at. b must not come back just because its clock is largest.
    const phone = new RecordLog('Phone')
    const tablet = new RecordLog('Tablet')
    const laptop = new RecordLog('Laptop')
    const a = await phone.append(put('p1', 'name', 'alpha'), 5)
    await tablet.append(put('p1', 'name', 'beta'), 10)
    await laptop.merge([...tablet.entries()])
    const c = await laptop.append(put('p1', 'name', 'gamma'), 3)
    const all = new RecordLog('X', [...phone.entries(), ...tablet.entries(), ...laptop.entries()])
    const m = all.materialize()
    assert.equal(m.entities['person']!['p1']!['name'], 'alpha')
    assert.deepEqual(sortedConflicts(m.conflicts), [conflictKey({ kind: 'person', id: 'p1', field: 'name', kept: a, dropped: c })])
  })

  it('del concurrent with a put: the tombstone wins and the put is listed (field "")', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'name', 'alpha'), 1)
    const laptop = new RecordLog('Laptop')
    await laptop.merge([...phone.entries()])
    const p = await phone.append(put('p1', 'city', 'beta'), 50)
    const d = await laptop.append(del('p1'), 10) // earlier clock, still wins: deletes win over concurrent edits
    await syncBoth(phone, laptop)
    for (const log of [phone, laptop]) {
      const m = log.materialize()
      assert.deepEqual(m.entities, {})
      assert.deepEqual(m.conflicts, [{ kind: 'person', id: 'p1', field: '', kept: d, dropped: p }])
    }
  })

  it('a put dominated by the del is simply gone (no conflict)', async () => {
    const log = new RecordLog('Phone')
    await log.append(put('p1', 'name', 'alpha'), 1)
    await log.append(del('p1'), 2)
    assert.deepEqual(log.materialize(), { entities: {}, conflicts: [] })
  })

  it('a put that causally follows the del revives the entity, without the fields the del erased', async () => {
    const log = new RecordLog('Phone')
    await log.append(put('p1', 'name', 'alpha'), 1)
    await log.append(del('p1'), 2)
    await log.append(put('p1', 'city', 'beta'), 3)
    assert.deepEqual(log.materialize(), { entities: { person: { p1: { city: 'beta' } } }, conflicts: [] })
  })

  it('revival after a concurrent del/put keeps the concurrent put (the del never saw it)', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(put('p1', 'name', 'alpha'), 1)
    const laptop = new RecordLog('Laptop')
    await laptop.merge([...phone.entries()])
    await phone.append(put('p1', 'city', 'beta'), 5)
    await laptop.append(del('p1'), 6)
    await syncBoth(phone, laptop)
    await phone.append(put('p1', 'note', 'gamma'), 7) // after seeing the del
    await syncBoth(phone, laptop)
    for (const log of [phone, laptop]) {
      assert.deepEqual(log.materialize(), { entities: { person: { p1: { city: 'beta', note: 'gamma' } } }, conflicts: [] })
    }
  })

  it('keys like "__proto__" from the wire stay data (no prototype pollution) and the result is a fresh copy', async () => {
    const phone = new RecordLog('Phone')
    await phone.append(JSON.parse('{"t":"put","kind":"__proto__","id":"__proto__","field":"__proto__","value":{"__proto__":{"polluted":true}}}') as Op, 1)
    const laptop = new RecordLog('Laptop')
    assert.equal((await laptop.merge(JSON.parse(JSON.stringify(phone.entries())) as unknown[])).added, 1)
    const m = laptop.materialize()
    assert.equal(({} as Record<string, unknown>)['polluted'], undefined)
    assert.ok(Object.hasOwn(m.entities, '__proto__'))
    assert.equal(JSON.stringify(m.entities), '{"__proto__":{"__proto__":{"__proto__":{"__proto__":{"polluted":true}}}}}')
    const own = new RecordLog('Phone')
    await own.append(put('p1', 'tags', ['a']), 1)
    ;(own.materialize().entities['person']!['p1']!['tags'] as string[]).push('b')
    assert.deepEqual(own.materialize().entities['person']!['p1']!['tags'], ['a'])
  })

  it('the same entry set in any insertion order → identical JSON and identical conflicts', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    const tablet = new RecordLog('Tablet')
    await phone.append(put('p1', 'name', 'alpha'), 10)
    await laptop.append(put('p1', 'name', 'beta'), 10)
    await tablet.append(put('p1', 'name', 'gamma'), 9)
    await phone.append(put('r1', 'title', 'Bike', 'resource'), 11)
    await laptop.append(del('r1', 'resource'), 12)
    await tablet.append(put('r1', 'title', 'Car', 'resource'), 13)
    await syncBoth(phone, laptop)
    await syncBoth(tablet, laptop)
    await syncBoth(phone, laptop)
    await tablet.append(put('p1', 'city', 'delta'), 1)
    await phone.append(put('p2', 'name', 'epsilon'), 20)
    const all = [...phone.entries(), ...laptop.entries().filter((e) => !phone.entries().some((x) => x.id === e.id)), ...tablet.entries().filter((e) => e.id === 'Tablet:4')]
    assert.equal(new Set(all.map((e) => e.id)).size, all.length)
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const reference = new RecordLog('A', all).materialize()
    assert.ok(reference.conflicts.length >= 2)
    for (let round = 0; round < 20; round++) {
      const shuffled = [...all].sort(() => rand() - 0.5)
      const m = new RecordLog('B', shuffled).materialize()
      assert.equal(JSON.stringify(m), JSON.stringify(reference))
      assert.deepEqual(sortedConflicts(m.conflicts), sortedConflicts(reference.conflicts))
    }
  })
})

describe('toJSON / fromJSON', () => {
  it('round-trips through JSON text', async () => {
    const phone = new RecordLog('Phone')
    const laptop = new RecordLog('Laptop')
    await phone.append(put('p1', 'name', 'alpha'), 1)
    await laptop.append(put('p1', 'name', 'beta'), 2)
    await syncBoth(phone, laptop)
    const json = phone.toJSON()
    assert.equal(json.v, 1)
    assert.equal(json.device, 'Phone')
    const back = RecordLog.fromJSON(JSON.parse(JSON.stringify(json)))
    assert.ok(back)
    assert.equal(back.device, 'Phone')
    assert.deepEqual(back.entries(), phone.entries())
    assert.deepEqual(back.heads(), phone.heads())
    assert.equal(JSON.stringify(back.materialize()), JSON.stringify(phone.materialize()))
    const next = await back.append(put('p1', 'city', 'gamma'), 3)
    assert.equal(next.seq, 2)
    assert.equal(next.prev, phone.entries().find((e) => e.id === 'Phone:1')!.hash)
  })

  it('returns null for anything that is not a LogJson', () => {
    for (const v of [null, 1, 'x', {}, { v: 2, device: 'Phone', entries: [] }, { v: 1, device: '', entries: [] }, { v: 1, device: 'Phone' }, { v: 1, device: 'Phone', entries: [{ id: 'x' }] }]) {
      assert.equal(RecordLog.fromJSON(v), null, JSON.stringify(v))
    }
    assert.ok(RecordLog.fromJSON({ v: 1, device: 'Phone', entries: [] }))
  })
})
