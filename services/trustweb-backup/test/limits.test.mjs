// Unit tests of the in-memory limiters (review 2026-10-06). No server, no port.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDailyMeter, createInFlight, createSlots, ipKey } from '../limits.mjs'

test('ipKey: IPv4 as is, IPv6 by its /64 (every spelling of one network is one key), IPv4-mapped as IPv4', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9')
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9')
  const k = ipKey('2001:db8:1:2::1')
  assert.equal(k, '2001:db8:1:2::/64')
  for (const v of ['2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:DB8:1:2:ffff::', '2001:db8:1:2:0:0:0:7']) assert.equal(ipKey(v), k)
  assert.notEqual(ipKey('2001:db8:1:3::1'), k)
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(ipKey('::1'), '0:0:0:0::/64')
})

test('createInFlight: per-key and total bounds; release is idempotent and frees the key', () => {
  const f = createInFlight({ total: 3, perKey: 2 })
  const a1 = f.tryAcquire('a')
  const a2 = f.tryAcquire('a')
  assert.equal(f.tryAcquire('a'), null)
  const b1 = f.tryAcquire('b')
  assert.equal(f.tryAcquire('c'), null) // total
  a1()
  a1()
  assert.equal(f.count(), 2)
  assert.notEqual(f.tryAcquire('c'), null)
  a2()
  b1()
})

test('createSlots: one slot, a bounded queue served in order, full() before anything is read', async () => {
  const s = createSlots({ slots: 1, queue: 1 })
  const r1 = await s.acquire()
  assert.equal(s.full(), false)
  const waiting = s.acquire()
  assert.equal(s.full(), true)
  assert.equal(s.acquire(), null)
  let granted = false
  waiting.then(() => {
    granted = true
  })
  await new Promise((r) => setImmediate(r))
  assert.equal(granted, false)
  r1()
  r1() // idempotent: must not free a second slot
  const r2 = await waiting
  assert.equal(granted, true)
  assert.equal(s.full(), false)
  const r3 = s.acquire()
  assert.equal(s.full(), true) // r2 still holds the slot, r3 waits
  r2()
  ;(await r3)()
})

test('createDailyMeter.close: nothing more fits today, the next UTC day starts fresh', () => {
  let t = Date.UTC(2026, 9, 6, 12)
  const m = createDailyMeter({ limit: 100, now: () => t })
  m.add(null, 10)
  m.close(null)
  assert.equal(m.fits(null, 1), false)
  t = Date.UTC(2026, 9, 7, 0, 0, 1)
  assert.equal(m.fits(null, 100), true)
})

test('createSlots: a waiter that waits longer than waitMs gets null and leaves the queue', async () => {
  const s = createSlots({ slots: 1, queue: 1 })
  const r1 = await s.acquire()
  const late = await s.acquire(30)
  assert.equal(late, null)
  assert.equal(s.full(), false) // its queue place is free again
  r1()
  const r2 = await s.acquire(30)
  assert.equal(typeof r2, 'function')
  r2()
})
