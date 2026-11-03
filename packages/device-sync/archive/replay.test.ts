// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REPLAY_WINDOW, createReplayGuard } from './replay.ts'

test('window is 1024 (wider than one sync round of 200 pieces)', () => {
  assert.equal(REPLAY_WINDOW, 1024)
})

test('fresh guard: empty state, first counter accepted', () => {
  const g = createReplayGuard()
  assert.deepEqual(g.state(), { high: 0, seen: [] })
  assert.equal(g.accept(1), true)
  assert.deepEqual(g.state(), { high: 1, seen: [1] })
})

test('a guard may start anywhere (counters need not begin at 1)', () => {
  const g = createReplayGuard()
  assert.equal(g.accept(1000), true)
  assert.equal(g.accept(999), true)
  assert.deepEqual(g.state(), { high: 1000, seen: [999, 1000] })
})

test('duplicate rejected', () => {
  const g = createReplayGuard()
  assert.equal(g.accept(5), true)
  assert.equal(g.accept(5), false)
  assert.equal(g.accept(6), true)
  assert.equal(g.accept(5), false)
  assert.equal(g.accept(6), false)
})

test('too old (≤ high - window) rejected, just inside accepted', () => {
  const g = createReplayGuard()
  assert.equal(g.accept(2000), true)
  assert.equal(g.accept(2000 - REPLAY_WINDOW), false)
  assert.equal(g.accept(1), false)
  assert.equal(g.accept(2000 - REPLAY_WINDOW + 1), true)
  assert.equal(g.accept(2000 - REPLAY_WINDOW + 1), false)
})

test('out of order inside the window accepted exactly once', () => {
  const g = createReplayGuard()
  for (const c of [3, 1, 2, 10, 7, 9, 8, 4]) assert.equal(g.accept(c), true, String(c))
  for (const c of [1, 2, 3, 4, 7, 8, 9, 10]) assert.equal(g.accept(c), false, String(c))
  assert.equal(g.accept(5), true)
  assert.equal(g.accept(6), true)
  assert.deepEqual(g.state(), { high: 10, seen: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })
})

test('state keeps only counters inside the window, sorted, including high', () => {
  const g = createReplayGuard()
  for (let c = 1; c <= 2000; c++) assert.equal(g.accept(c), true)
  const s = g.state()
  assert.equal(s.high, 2000)
  assert.equal(s.seen.length, REPLAY_WINDOW)
  assert.equal(s.seen[0], 2000 - REPLAY_WINDOW + 1)
  assert.equal(s.seen[s.seen.length - 1], 2000)
  assert.equal(g.accept(5000), true)
  assert.deepEqual(g.state(), { high: 5000, seen: [5000] })
})

test('state() is a fresh copy', () => {
  const g = createReplayGuard()
  g.accept(1)
  const s = g.state()
  s.seen.push(99)
  s.high = 99
  assert.deepEqual(g.state(), { high: 1, seen: [1] })
  assert.equal(g.accept(2), true)
})

test('state round-trips through JSON and keeps rejecting what it saw', () => {
  const g = createReplayGuard()
  for (const c of [10, 12, 15, 11]) g.accept(c)
  const restored = createReplayGuard(JSON.parse(JSON.stringify(g.state())))
  assert.deepEqual(restored.state(), g.state())
  for (const c of [10, 11, 12, 15]) assert.equal(restored.accept(c), false)
  assert.equal(restored.accept(13), true)
  assert.equal(restored.accept(16), true)
})

test('the initial state passed in is copied, not aliased', () => {
  const init = { high: 3, seen: [3] }
  const g = createReplayGuard(init)
  g.accept(4)
  assert.deepEqual(init, { high: 3, seen: [3] })
})

test('malformed initial state → empty', () => {
  const bad: unknown[] = [
    null,
    42,
    'x',
    [],
    {},
    { high: -1, seen: [] },
    { high: 1.5, seen: [] },
    { high: '3', seen: [3] },
    { high: 3, seen: 'x' },
    { high: 3, seen: [] }, // high not in seen
    { high: 3, seen: [3, 2] }, // not ascending
    { high: 3, seen: [2, 2, 3] }, // duplicate
    { high: 3, seen: [0, 3] }, // non-positive
    { high: 3, seen: [3, 4] }, // above high
    { high: 2000, seen: [2000 - REPLAY_WINDOW, 2000] }, // outside the window
    { high: 3, seen: [1.5, 3] },
    { high: 0, seen: [1] },
    { high: Number.MAX_SAFE_INTEGER + 1, seen: [Number.MAX_SAFE_INTEGER + 1] },
  ]
  for (const b of bad) {
    const g = createReplayGuard(b as never)
    assert.deepEqual(g.state(), { high: 0, seen: [] }, JSON.stringify(b))
  }
})

test('non-integer / non-positive / unsafe ctr rejected and not recorded', () => {
  const g = createReplayGuard()
  for (const c of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2' as unknown as number, null as unknown as number]) {
    assert.equal(g.accept(c), false, String(c))
  }
  assert.deepEqual(g.state(), { high: 0, seen: [] })
  assert.equal(g.accept(Number.MAX_SAFE_INTEGER), true)
})
