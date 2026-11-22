// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** review-45 (adversarial review of chain-45a): one regression test per confirmed finding. Fake names only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SYNC_EXCLUDED, settingsOf } from '../../src/sync_core.ts'
import { createEventGroupChat, memberNames, threadOf } from '../../src/event_group_chat.ts'
import { mergeEvents } from '../../src/event_merge.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { communityMembers } from '../../src/event_visibility.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { setEventAccess } from '../../src/community_event_access.ts'
import { enqueue, markFailed, markSent, holdDue, dueItems, shownItems, OUTBOX_MAX_ITEMS, OUTBOX_HORIZON_MS } from '../../src/outbox.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { createEventMerge } from '../../src/event_merge_flow.ts'
import { mayInvite } from '../../src/events.ts'
import { mayInviteRecord } from '../../../mcp/src/bulk_invite_tools.ts'

const P = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 0, lines: [], ...over })

describe('F1 sync: this-device-only fields never ride the device sync', () => {
  it('sendQueue (unsealed outbox envelopes) and settingsShare stay out of the synced settings', () => {
    expect(SYNC_EXCLUDED.has('sendQueue')).toBe(true)
    expect(SYNC_EXCLUDED.has('settingsShare')).toBe(true)
    const s = { sendQueue: [{ id: 'q1' }], settingsShare: { inbox: [] }, eventChats: {} }
    expect(Object.keys(settingsOf(s))).toEqual(['eventChats'])
  })
})

const EV = { id: 'ev1', name: 'Winter OG', from: '2026-12-30', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'] }
function chatDevice(me, people) {
  const s = { v: 1, me: { id: 'me', displayName: me }, people, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId })), events: [{ ...EV }] }
  const sent = []
  let ids = 0
  let t = 1000
  const chat = createEventGroupChat({ state: () => s, save: () => {}, now: () => (t += 10), newId: () => `m${me[0]}${++ids}`, peers: () => s.peers, send: async (peer, env) => { sent.push({ to: peer.id, env }) }, changed: () => {} })
  return { s, sent, chat }
}

describe('F2 event chat: a stranger\'s yes is no join', () => {
  it('the host neither announces nor sends the history to a connected peer who is not at the event', async () => {
    const d = chatDevice('Hanna', [P('pb', 'Ben', { peerId: 'peer-b', events: ['ev1'] }), P('px', 'Xena', { peerId: 'peer-x' })])
    await d.chat.send('ev1', 'secret plan')
    d.sent.length = 0
    await d.chat.afterEnvelope({ id: 'peer-x' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } }, 'ignored')
    expect(d.sent.filter((x) => x.to === 'peer-x')).toEqual([])
    expect(threadOf(d.s, 'ev1').items.filter((i) => i.k === 'join')).toEqual([])
  })
  it('a person at the event still gets the join and the history', async () => {
    const d = chatDevice('Hanna', [P('pb', 'Ben', { peerId: 'peer-b', events: ['ev1'] }), P('pc', 'Cleo', { peerId: 'peer-c', events: ['ev1'] })])
    await d.chat.send('ev1', 'hello')
    d.sent.length = 0
    await d.chat.afterEnvelope({ id: 'peer-c' }, { v: 1, t: 'event', rsvp: { id: 'ev1', yes: true } }, 'answered')
    expect(d.sent.some((x) => x.to === 'peer-c' && x.env.gc.k === 'msg')).toBe(true)
  })
})

describe('F3 event chat: a host-announced leave updates the guest\'s member list', () => {
  it('Ben drops Cleo after Hanna says Cleo left, and adds her back on her join', async () => {
    const d = chatDevice('Ben', [P('ph', 'Hanna', { peerId: 'peer-h' }), P('pc', 'Cleo', { events: ['ev1'] })])
    expect(memberNames(d.s, d.s.events[0])).toContain('Cleo')
    expect(await d.chat.onEnvelope({ id: 'peer-h' }, { id: 'ev1', m: 'mh1', k: 'leave', by: 'Cleo', ts: 900 })).toBe(true)
    expect(memberNames(d.s, d.s.events[0])).not.toContain('Cleo')
    expect(await d.chat.onEnvelope({ id: 'peer-h' }, { id: 'ev1', m: 'mh2', k: 'join', by: 'Cleo', ts: 950 })).toBe(true)
    expect(memberNames(d.s, d.s.events[0])).toContain('Cleo')
  })
})

describe('F4 merge: the gone event\'s chat moves to the kept event', () => {
  it('items and membership join the kept thread; the gone thread is gone', () => {
    const it1 = { m: 'a1', k: 'msg', by: 'Ben', ts: 10, at: 10, text: 'from gone' }
    const it2 = { m: 'b1', k: 'msg', by: 'Ada', ts: 20, at: 20, text: 'from keep' }
    const s = { v: 1, me: { displayName: 'Hanna' }, people: [], events: [{ ...EV, id: 'k1' }, { ...EV, id: 'g1' }], eventChats: { k1: { items: [it2], unread: 1 }, g1: { items: [it1], unread: 2, mem: { pb: { on: false, at: 5 } } } } }
    expect(mergeEvents(s, 'k1', 'g1', 100)).not.toBeNull()
    expect(s.eventChats.g1).toBeUndefined()
    expect(s.eventChats.k1.items.map((i) => i.m)).toEqual(['a1', 'b1'])
    expect(s.eventChats.k1.mem).toEqual({ pb: { on: false, at: 5 } })
    expect(s.eventChats.k1.unread).toBe(3)
  })
})

describe('F5 refetch: an invite-only community\'s events are not replayed', () => {
  it('a member asking {sync:true} gets nothing when the community is set to invited', async () => {
    const sent = []
    const state = { me: { id: 'me', displayName: 'Ben' }, people: [{ id: 'a', name: 'Ada', peerId: 'pa', fields: { iyg: 'true' } }], notifInbox: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, communityId: 'iyg', shareCommunity: true, announcedAt: 5 }] }
    setEventAccess(state, 'iyg', 'invited')
    const env = createEventEnvelopes({
      state: () => state, save: () => {}, now: () => 1e12, link: (e) => encodeEventLink(e, 'https://app.trustweb.one', 'peer', { name: 'Ben' }),
      send: async (peer, e) => { sent.push({ to: peer.id, e }) }, pending: () => null, setPending: () => {}, changed: () => {}, later: () => {},
      members: (tag) => communityMembers(state, tag).map((p) => ({ id: p.peerId })),
    })
    expect(await env.onEnvelope({ id: 'pa' }, { v: 1, t: 'event', sync: true })).toBe('ignored')
    expect(sent).toEqual([])
  })
})

describe('F6 outbox: nothing lost, nothing piled up', () => {
  const NOW = 1_000_000
  it('the same envelope to the same person waits once', () => {
    const s = {}
    const a = enqueue(s, { peerId: 'p1', kind: 'event', env: { v: 1, t: 'event', sync: true } }, NOW)
    const b = enqueue(s, { peerId: 'p1', kind: 'event', env: { v: 1, t: 'event', sync: true } }, NOW + 5)
    expect(b.id).toBe(a.id)
    enqueue(s, { peerId: 'p2', kind: 'event', env: { v: 1, t: 'event', sync: true } }, NOW + 6)
    expect(s.sendQueue).toHaveLength(2)
  })
  it('failed items are never evicted to make room; sent ones are', () => {
    const s = {}
    const first = enqueue(s, { peerId: 'p', kind: 'text', env: { n: -1 } }, NOW)
    markFailed(s, first.id, NOW + OUTBOX_HORIZON_MS + 1)
    expect(s.sendQueue[0].state).toBe('failed')
    for (let i = 0; i < OUTBOX_MAX_ITEMS + 5; i++) { const x = enqueue(s, { peerId: 'p', kind: 'text', env: { n: i } }, NOW + i); markSent(s, x.id, NOW + i) }
    expect(s.sendQueue.some((x) => x.id === first.id)).toBe(true)
    expect(shownItems(s, NOW + 300).some((x) => x.id === first.id)).toBe(true)
  })
  it('holdDue: after a refused send, the other due items wait for the same gap', () => {
    const s = {}
    const a = enqueue(s, { peerId: 'p', kind: 'text', env: { n: 1 } }, NOW)
    enqueue(s, { peerId: 'p', kind: 'text', env: { n: 2 } }, NOW)
    markFailed(s, a.id, NOW)
    const at = s.sendQueue[0].nextAt
    holdDue(s, NOW, at)
    expect(dueItems(s, NOW)).toEqual([])
    expect(s.sendQueue[1]).toMatchObject({ nextAt: at, tries: 0, state: 'waiting' })
  })
})

describe('F7 MCP mirrors the UI gates', () => {
  function tools(rec) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-rv45-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify(rec))
    return { by: Object.fromEntries(allTools({ file, write: true, now: () => new Date('2026-11-20T10:00:00Z') }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('invite_bulk refuses an event I may not invite to', () => {
    const f = tools({ v: 1, me: { displayName: 'Jakob' }, people: [P('a', 'Ada', { fields: { cook: 'true' } })], events: [{ id: 'e9', name: 'Their party', from: '2026-12-01', where: 'Prater', createdAt: 0, attended: false, hosts: ['Someone Else'] }] })
    expect(() => f.by.invite_bulk.run({ event: 'e9', include: ['tag:cook'], confirm: true })).toThrow(/may not invite/)
    expect(f.rec().events[0].people).toBeUndefined()
  })
  it('community_event_visibility refuses to change a community I do not organize', () => {
    const f = tools({ v: 1, me: { displayName: 'Jakob' }, people: [], extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['someone-else'] } } } } })
    expect(() => f.by.community_event_visibility.run({ community: 'iyg', mode: 'invited' })).toThrow(/organizer/)
    expect(f.by.community_event_visibility.run({ community: 'iyg' })).toEqual({ community: 'iyg', mode: 'members' })
  })
})

describe('F8 merge: a guest told "done" merges quietly', () => {
  it('the guest\'s device sends nothing on (only a host tells the people)', async () => {
    const sent = []
    const s = { v: 1, me: { displayName: 'Ben' }, people: [P('ph', 'Hanna', { peerId: 'peer-h' }), P('pc', 'Cleo', { peerId: 'peer-c', events: ['g1'] })], events: [{ ...EV, id: 'k1', attended: false }, { ...EV, id: 'g1' }] }
    const m = createEventMerge({ state: () => s, save: () => {}, now: () => 100, changed: () => {}, link: (e) => encodeEventLink(e, 'https://app.trustweb.one', 'peer', { name: 'Ben' }), send: async (peer, env) => { sent.push({ to: peer.id, env }) }, peers: () => [{ id: 'peer-h' }, { id: 'peer-c' }], recipients: () => [{ id: 'peer-h' }, { id: 'peer-c' }] })
    expect(await m.onEnvelope({ id: 'peer-h' }, { step: 'done', keep: 'k1', gone: 'g1' })).toBe(true)
    expect(s.eventMerged).toEqual({ g1: 'k1' })
    expect(sent).toEqual([])
  })
})

describe('F7b the MCP invite gate equals the app\'s mayInvite', () => {
  it('agrees over hosts, attendance, policy and rings (family closeness included)', () => {
    const rings = [['closest'], ['close'], ['friend'], ['acquaintance'], ['family'], ['family', 'closest'], ['family', 'friend'], ['family', 'bogus'], ['unsorted']]
    let n = 0
    for (const me of ['Hanna', 'Ben'])
      for (const attended of [true, false])
        for (const invitePolicy of [undefined, 'everyone', 'trusted', 'hosts'])
          for (const [ring, closeness] of rings) {
            const people = [P('ph', 'Hanna', { ring, ...(closeness ? { fields: { 'tw-closeness': closeness } } : {}) })]
            const ev = { ...EV, attended, ...(invitePolicy ? { invitePolicy } : {}) }
            const r = { me: { displayName: me }, people }
            expect(mayInviteRecord(ev, r)).toBe(mayInvite(ev, r))
            n++
          }
    expect(n).toBe(144)
  })
})
