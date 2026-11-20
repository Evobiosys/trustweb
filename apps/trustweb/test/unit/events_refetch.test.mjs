// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 events-refetch: Events re-fetch on open / pull-down from the connected people, 5-min cache like the feed; the host replays its announced events. Fake data only. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { readEvents } from '../../../mcp/src/events.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { EVENTS_TTL_MS, PULL_PX, REPLAY_GAP_MS, createEventsRefetch, onPullDown, refetchDue } from '../../src/events_refetch.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { communityMembers } from '../../src/event_visibility.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { createActions } from '../../src/actions.ts'
import { defineEventsRefetchAction } from '../../src/events_refetch_actions.ts'
import { ACTION_MCP } from '../../src/ext/assistant/actions.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const NOW = Date.UTC(2026, 10, 20, 12)

describe('the 5-minute cache', () => {
  it('is due when never read or older than 5 minutes; a manual refresh always', () => {
    expect(EVENTS_TTL_MS).toBe(5 * 60_000)
    expect(refetchDue(undefined, NOW, false)).toBe(true)
    expect(refetchDue(NOW - 60_000, NOW, false)).toBe(false)
    expect(refetchDue(NOW - EVENTS_TTL_MS - 1, NOW, false)).toBe(true)
    expect(refetchDue(NOW - 1000, NOW, true)).toBe(true)
  })
  it('asks every connected person once, then waits for the cache; explicit asks again; a failed send does not stop the rest', async () => {
    let t = NOW
    const sent = []
    const r = createEventsRefetch({ now: () => t, peers: () => [{ id: 'p1' }, { id: 'p2' }], send: async (p, env) => { if (p.id === 'p1') throw new Error('offline'); sent.push([p.id, env]) } })
    expect(await r.run(false)).toBe(2)
    expect(sent).toEqual([['p2', { v: 1, t: 'event', sync: true }]])
    t += 60_000
    expect(await r.run(false)).toBeNull()
    expect(await r.run(true)).toBe(2)
    t += EVENTS_TTL_MS + 1
    expect(await r.run(false)).toBe(2)
  })
})

describe('pull down', () => {
  const scroller = (top) => { const on = {}; return { scrollTop: top, addEventListener: (n, f) => { on[n] = f }, fire: (n, y) => on[n]({ touches: [{ clientY: y }], changedTouches: [{ clientY: y }] }) } }
  it('fires when a drag of PULL_PX or more starts at the top of the list', () => {
    const s = scroller(0); let n = 0
    onPullDown(s, () => { n++ })
    s.fire('touchstart', 100); s.fire('touchend', 100 + PULL_PX - 1)
    expect(n).toBe(0)
    s.fire('touchstart', 100); s.fire('touchend', 100 + PULL_PX)
    expect(n).toBe(1)
  })
  it('never fires from a list scrolled down, or on a drag upwards', () => {
    const s = scroller(40); let n = 0
    onPullDown(s, () => { n++ })
    s.fire('touchstart', 100); s.fire('touchend', 300)
    s.scrollTop = 0; s.fire('touchstart', 300); s.fire('touchend', 100)
    expect(n).toBe(0)
  })
})

describe('the wire: {sync:true}', () => {
  it('round trips; anything else next to want or link is dropped', () => {
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', sync: true }))).toEqual({ v: 1, t: 'event', sync: true })
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', sync: 'yes' }))).toBeNull()
    expect(decodeFromQr(JSON.stringify({ v: 1, t: 'event', sync: true, want: 'e1' }))).toBeNull()
  })
})

const ORIGIN = 'https://app.trustweb.one'
const ev = (over = {}) => ({ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, communityId: 'iyg', shareCommunity: true, announcedAt: 5, ...over })
function harness(events) {
  const sent = []
  let now = NOW
  const state = { me: { id: 'me', displayName: 'Ben Example' }, events, people: [{ id: 'a', name: 'Ada', peerId: 'pa', fields: { iyg: 'true' } }, { id: 'b', name: 'Bob', peerId: 'pb', fields: {} }], notifInbox: [] }
  const host = {
    state: () => state, save: () => {}, now: () => now, link: (e) => encodeEventLink(e, ORIGIN, 'peer', { name: 'Ben Example' }),
    send: async (peer, env) => { sent.push({ to: peer.id, env }) }, pending: () => null, setPending: () => {}, changed: () => {}, later: () => {},
    members: (tag) => communityMembers(state, tag).map((p) => ({ id: p.peerId })),
  }
  return { env: createEventEnvelopes(host), sent, state, tick: (ms) => { now += ms } }
}

describe('the host answers {sync:true}', () => {
  it('replays the announced events of a community the asker belongs to, as announce envelopes', async () => {
    const h = harness([ev()])
    expect(await h.env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })).toBe('answered')
    expect(h.sent.map((x) => x.to)).toEqual(['pa'])
    expect(h.sent[0].env).toMatchObject({ v: 1, t: 'event', announce: true, show: 'discoverable' })
  })
  it('sends nothing to a person outside the community, for an unannounced or unshared event', async () => {
    const h = harness([ev(), ev({ id: 'e2', announcedAt: undefined }), ev({ id: 'e3', shareCommunity: undefined })])
    expect(await h.env.onEnvelope({ id: 'pb' }, { v: 1, t: 'event', sync: true })).toBe('ignored')
    expect(await h.env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })).toBe('answered')
    expect(h.sent).toHaveLength(1)
  })
  it('answers the same person at most once a minute', async () => {
    const h = harness([ev()])
    await h.env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })
    expect(await h.env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })).toBe('ignored')
    h.tick(REPLAY_GAP_MS + 1)
    expect(await h.env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })).toBe('answered')
    expect(h.sent).toHaveLength(2)
  })
})

describe('MCP parity', () => {
  it('the action events-refetch runs the re-fetch as a manual refresh', () => {
    const calls = []
    const reg = createActions()
    defineEventsRefetchAction(reg, { refetch: async (explicit) => { calls.push(explicit); return 2 } })
    reg.do('events-refetch', {})
    expect(calls).toEqual([true])
    expect(ACTION_MCP['events-refetch']).toBe('events_refetch')
    expect(MCP_TOOLS.find((t) => t.name === 'events_refetch')).toEqual({ name: 'events_refetch', write: true })
  })
  it('events_refetch queues the action for the open app; read-only mode hides it', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w45-refetch-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], events: [] }))
    const by = (write) => Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-20T10:00:00Z') }).map((t) => [t.name, t]))
    expect(by(false).events_refetch).toBeUndefined()
    expect(by(true).events_refetch.run({})).toEqual({ queued: true })
    expect(readEvents(file, 0).events.at(-1)).toMatchObject({ kind: 'action', tool: 'events_refetch', action: { type: 'events-refetch', args: {} } })
  })
})
