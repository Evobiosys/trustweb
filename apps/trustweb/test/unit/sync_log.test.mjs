// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Device sync v2, the record log (src/sync_log.ts): append-only ops, hybrid clock, verify, frontier, merge of two device logs. */
import { append, compareHlc, emptyLog, frontier, materialise, mergeLogs, missingFor, observe, recvClock, tick, verifyOp } from '../../src/sync_log.ts'

const T = 1_800_000_000_000
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...extra })

/** Exchange both ways, as the link does: each side sends what the other's frontier lacks. */
async function syncBoth(a, b, now) {
  const toB = missingFor(a, frontier(b))
  const toA = missingFor(b, frontier(a))
  const rb = await mergeLogs(b, toB, now)
  const ra = await mergeLogs(a, toA, now)
  return { a: ra.log, b: rb.log, ra, rb }
}

describe('hybrid logical clock', () => {
  it('tick follows the wall clock and counts within one millisecond', () => {
    const c1 = tick({ t: 0, c: 0 }, T)
    expect(c1).toEqual({ t: T, c: 0 })
    expect(tick(c1, T)).toEqual({ t: T, c: 1 })
    expect(tick(c1, T - 5000)).toEqual({ t: T, c: 1 })
  })
  it('receiving a later stamp moves the clock past it, so the next local edit orders after what was seen', () => {
    const remote = { t: T + 3_600_000, c: 4 }
    const c = recvClock({ t: T, c: 0 }, remote, T)
    expect(compareHlc(c, remote)).toBeGreaterThan(0)
    expect(compareHlc(tick(c, T), remote)).toBeGreaterThan(0)
  })
})

describe('append-only log', () => {
  it('chains each device op to the one before and gives it a content id', async () => {
    let log = emptyLog('dev-phone')
    let op
    ;({ log, op } = await append(log, { key: 'p:1', op: 'put', val: person('1', 'Example One') }, T))
    expect(op).toMatchObject({ dev: 'dev-phone', n: 1, prev: null, base: null })
    const first = op
    ;({ log, op } = await append(log, { key: 'p:1', op: 'put', val: person('1', 'Example One B') }, T + 1))
    expect(op).toMatchObject({ n: 2, prev: first.id, base: first.id })
    expect(await verifyOp(op)).toBe(true)
    expect(await verifyOp({ ...op, val: person('1', 'Changed in transit') })).toBe(false)
    expect(log.ops).toHaveLength(2)
  })
  it('never edits or removes an op: a retraction is one more op, and the value it hid is still in the log', async () => {
    let log = emptyLog('d1')
    ;({ log } = await append(log, { key: 'i:bike', op: 'put', val: { id: 'bike', text: 'A bike' } }, T))
    ;({ log } = await append(log, { key: 'i:bike', op: 'retract' }, T + 1))
    expect(materialise(log.ops).values['i:bike']).toBeUndefined()
    expect(log.ops.map((o) => o.op)).toEqual(['put', 'retract'])
    expect(log.ops[0].val).toEqual({ id: 'bike', text: 'A bike' })
  })
  it('grow-only sets: added elements are united by id', async () => {
    let log = emptyLog('d1')
    ;({ log } = await append(log, { key: 'l:1', op: 'add', val: { id: 'a', text: 'first' } }, T))
    ;({ log } = await append(log, { key: 'l:1', op: 'add', val: { id: 'b', text: 'second' } }, T + 1))
    expect(materialise(log.ops).sets['l:1'].map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('observe turns a record into put ops only for what changed since the log last saw it', async () => {
    let log = emptyLog('d1')
    let r = await observe(log, [['p:1', person('1', 'One')], ['g:city', 'Example City']], T)
    expect(r.appended).toBe(2)
    r = await observe(r.log, [['p:1', person('1', 'One')], ['g:city', 'Example City']], T + 1)
    expect(r.appended).toBe(0)
    r = await observe(r.log, [['p:1', person('1', 'One renamed')], ['g:city', 'Example City']], T + 2)
    expect(r.appended).toBe(1)
    expect(materialise(r.log.ops).values['p:1'].name).toBe('One renamed')
  })
})

describe('merge of two device logs', () => {
  it('offline edits on both devices end in the same record on both, nothing lost', async () => {
    let phone = emptyLog('dev-phone')
    let laptop = emptyLog('dev-laptop')
    ;({ log: phone } = await append(phone, { key: 'p:1', op: 'put', val: person('1', 'Met on the train') }, T))
    ;({ log: phone } = await append(phone, { key: 'l:1', op: 'add', val: { id: 'n1', text: 'likes tea' } }, T + 1))
    ;({ log: laptop } = await append(laptop, { key: 'p:2', op: 'put', val: person('2', 'Met at the market') }, T + 2))
    ;({ log: laptop } = await append(laptop, { key: 'l:1', op: 'add', val: { id: 'n2', text: 'bakes bread' } }, T + 3))
    const s = await syncBoth(phone, laptop, T + 10)
    expect(s.ra.added).toHaveLength(2)
    expect(s.rb.added).toHaveLength(2)
    const ma = materialise(s.a.ops)
    expect(ma).toEqual(materialise(s.b.ops))
    expect(Object.keys(ma.values).sort()).toEqual(['p:1', 'p:2'])
    expect(ma.sets['l:1'].map((x) => x.id)).toEqual(['n1', 'n2'])
    expect(frontier(s.a)).toEqual({ 'dev-laptop': 2, 'dev-phone': 2 })
    expect(missingFor(s.a, frontier(s.b))).toHaveLength(0)
  })
  it('is idempotent and order-free: merging twice or in another order gives the same record', async () => {
    let a = emptyLog('A')
    let b = emptyLog('B')
    for (let i = 0; i < 5; i++) {
      ;({ log: a } = await append(a, { key: 'p:' + (i % 2), op: 'put', val: person(String(i % 2), 'a' + i) }, T + i))
      ;({ log: b } = await append(b, { key: 'p:' + (i % 3), op: 'put', val: person(String(i % 3), 'b' + i) }, T + i))
    }
    const ab = (await mergeLogs(a, b.ops, T + 100)).log
    const ba = (await mergeLogs(b, a.ops, T + 100)).log
    const again = await mergeLogs(ab, b.ops, T + 101)
    expect(again.added).toHaveLength(0)
    expect(materialise(ab.ops)).toEqual(materialise(ba.ops))
    expect(materialise(again.log.ops)).toEqual(materialise(ab.ops))
    const shuffled = (await mergeLogs(emptyLog('C'), [...b.ops].reverse().concat([...a.ops].reverse()), T + 100)).log
    expect(materialise(shuffled.ops)).toEqual(materialise(ab.ops))
  })
  it('an edit made after seeing the other device wins, even when the other device clock runs an hour ahead', async () => {
    let fast = emptyLog('dev-fast')
    let slow = emptyLog('dev-slow')
    ;({ log: fast } = await append(fast, { key: 'p:1', op: 'put', val: person('1', 'Old name') }, T + 3_600_000))
    let s = await syncBoth(fast, slow, T)
    slow = s.b
    ;({ log: slow } = await append(slow, { key: 'p:1', op: 'put', val: person('1', 'Corrected name') }, T + 1000))
    s = await syncBoth(s.a, slow, T + 2000)
    for (const log of [s.a, s.b]) {
      const m = materialise(log.ops)
      expect(m.values['p:1'].name).toBe('Corrected name')
      expect(m.conflicts).toHaveLength(0)
    }
  })
  it('edits of the same entity made without seeing each other are listed as a conflict, identically on both, the loser kept', async () => {
    let a = emptyLog('dev-a')
    ;({ log: a } = await append(a, { key: 'p:1', op: 'put', val: person('1', 'Start') }, T))
    let b = (await mergeLogs(emptyLog('dev-b'), a.ops, T)).log
    ;({ log: a } = await append(a, { key: 'p:1', op: 'put', val: person('1', 'Edit on A') }, T + 10))
    ;({ log: b } = await append(b, { key: 'p:1', op: 'put', val: person('1', 'Edit on B') }, T + 20))
    const s = await syncBoth(a, b, T + 30)
    const ma = materialise(s.a.ops)
    const mb = materialise(s.b.ops)
    expect(ma).toEqual(mb)
    expect(ma.values['p:1'].name).toBe('Edit on B')
    expect(ma.conflicts).toHaveLength(1)
    const c = ma.conflicts[0]
    expect(c.key).toBe('p:1')
    expect(c.ops).toHaveLength(2)
    const loser = s.a.ops.find((o) => c.ops.includes(o.id) && o.id !== c.kept)
    expect(loser.val.name).toBe('Edit on A')
  })
  it('refuses a forged or altered op and holds back one whose predecessor is missing', async () => {
    let a = emptyLog('A')
    ;({ log: a } = await append(a, { key: 'p:1', op: 'put', val: person('1', 'one') }, T))
    ;({ log: a } = await append(a, { key: 'p:2', op: 'put', val: person('2', 'two') }, T + 1))
    const forged = { ...a.ops[0], val: person('1', 'forged') }
    const r1 = await mergeLogs(emptyLog('B'), [forged], T)
    expect(r1.added).toHaveLength(0)
    expect(r1.rejected).toEqual([{ id: forged.id, why: 'hash' }])
    const r2 = await mergeLogs(emptyLog('B'), [a.ops[1]], T)
    expect(r2.added).toHaveLength(0)
    expect(r2.rejected).toEqual([{ id: a.ops[1].id, why: 'gap' }])
    const r3 = await mergeLogs(emptyLog('B'), [a.ops[1], a.ops[0]], T)
    expect(r3.added).toHaveLength(2)
    const bad = await mergeLogs(emptyLog('B'), [{ nonsense: true }, null, 'x'], T)
    expect(bad.added).toHaveLength(0)
    expect(bad.rejected.every((x) => x.why === 'shape')).toBe(true)
  })
  it('notices a device that reused its counter (restored from an old backup) and keeps both versions', async () => {
    let a = emptyLog('A')
    ;({ log: a } = await append(a, { key: 'p:1', op: 'put', val: person('1', 'before backup') }, T))
    const backup = a
    ;({ log: a } = await append(a, { key: 'p:2', op: 'put', val: person('2', 'lost by restore') }, T + 1))
    let b = (await mergeLogs(emptyLog('B'), a.ops, T + 2)).log
    let restored = backup
    ;({ log: restored } = await append(restored, { key: 'p:3', op: 'put', val: person('3', 'after restore') }, T + 3))
    const r = await mergeLogs(b, restored.ops, T + 4)
    expect(r.forks).toEqual([{ dev: 'A', n: 2 }])
    b = r.log
    const m = materialise(b.ops)
    expect(Object.keys(m.values).sort()).toEqual(['p:1', 'p:2', 'p:3'])
  })
})
