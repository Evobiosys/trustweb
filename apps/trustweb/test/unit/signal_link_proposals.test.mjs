// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-signal-link): zone proposals from imported Signal metadata (pure). */
import { acceptProposal, deepLink, proposals, ringFor, stripWords, threadsOf } from '../../src/ext/signal-link/proposals.ts'
import { Channel, Ring } from '../../src/model.ts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 31)
const conv = (e164, o = {}) => ({ e164, name: 'Test ' + e164.slice(-2), n365: 0, out: 0, in: 0, firstTs: 0, lastTs: 0, ...o })
const person = (id, e164, ring = Ring.Acquaintance) => ({ id, name: 'Pat ' + id, context: '', ring, metAt: 1, lines: [], channels: { [Channel.Signal]: e164 } })

describe('signal-link: ring for a conversation', () => {
  it('lots of recent two-way talk is Friends-level (Ring.Friend; the app has no separate Community ring)', () => {
    expect(ringFor({ n365: 200, out: 100, in: 100, lastTs: NOW - DAY }, NOW)).toBe(Ring.Friend)
  })
  it('little or old contact is Acquaintance; never Closest or Close', () => {
    expect(ringFor({ n365: 1, out: 1, in: 0, lastTs: NOW - 300 * DAY }, NOW)).toBe(Ring.Acquaintance)
    expect(ringFor({ n365: 100000, out: 50000, in: 50000, lastTs: NOW }, NOW)).toBe(Ring.Friend)
  })
  it('middle score (Community level) also maps to Friend', () => {
    expect(ringFor({ n365: 10, out: 5, in: 5, lastTs: NOW - 5 * DAY }, NOW)).toBe(Ring.Friend)
  })
})

describe('signal-link: proposals', () => {
  it('stripWords drops the histogram and anything not a number or string', () => {
    const out = stripWords([{ ...conv('+436600000001'), words: [['secret', 9]], extra: 1 }, { e164: 'x' }])
    expect(out).toEqual([conv('+436600000001')])
    expect(JSON.stringify(out)).not.toContain('secret')
  })
  it('sorted by score, existing people matched by E.164 carry their id (no duplicate)', () => {
    const ps = proposals([conv('+436600000001'), conv('+436600000002', { n365: 150, out: 70, in: 80, lastTs: NOW - DAY })], [person('p1', '+436600000001')], NOW)
    expect(ps.map((p) => p.e164)).toEqual(['+436600000002', '+436600000001'])
    expect(ps[1].personId).toBe('p1')
    expect(ps[0].personId).toBeUndefined()
  })
})

describe('signal-link: accepting', () => {
  it('a new person is added only on accept, with Channel.Signal', () => {
    const s = { people: [] }
    const id = acceptProposal(s, { e164: '+436600000003', name: 'Test 03' }, Ring.Friend, () => 'n1', NOW)
    expect(id).toBe('n1')
    expect(s.people).toHaveLength(1)
    expect(s.people[0]).toMatchObject({ id: 'n1', name: 'Test 03', ring: Ring.Friend, channels: { [Channel.Signal]: '+436600000003' } })
  })
  it('an existing person is re-ringed, never duplicated', () => {
    const s = { people: [person('p1', '+436600000001')] }
    acceptProposal(s, { e164: '+436600000001', name: 'Test 01', personId: 'p1' }, Ring.Friend, () => 'zz', NOW)
    expect(s.people).toHaveLength(1)
    expect(s.people[0].ring).toBe(Ring.Friend)
  })
  it('accepting the same number twice finds the first person', () => {
    const s = { people: [] }
    acceptProposal(s, { e164: '+436600000003', name: 'A' }, Ring.Acquaintance, () => 'n1', NOW)
    acceptProposal(s, { e164: '+436600000003', name: 'A' }, Ring.Friend, () => 'n2', NOW)
    expect(s.people).toHaveLength(1)
  })
})

describe('signal-link: threads and deep link', () => {
  it('threads from the imported record, newest first, titled by the person when known', () => {
    const imp = { at: NOW, conversations: [conv('+436600000001', { lastTs: 5, n365: 1 }), conv('+436600000002', { lastTs: 9, n365: 2 })] }
    const t = threadsOf(imp, [person('p1', '+436600000001')])
    expect(t.map((x) => x.id)).toEqual(['+436600000002', '+436600000001'])
    expect(t[1]).toMatchObject({ title: 'Pat p1', unread: 0, lastAt: 5 })
  })
  it('sgnl link with https fallback', () => {
    expect(deepLink('+436600000001')).toEqual({ href: 'sgnl://signal.me/#p/+436600000001', fallback: 'https://signal.me/#p/+436600000001' })
  })
})
