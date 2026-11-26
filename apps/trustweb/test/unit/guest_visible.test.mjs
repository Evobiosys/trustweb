// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * hotfix guest-visible (2026-11-26, production): a guest who opened an event link (blank browser) was held by the event but unknown to the host, and so
 * to the other guests: the plain event link carried no way to reach the host, and a chat-trimmed link dropped the host's did. Proven here: the link keeps
 * a short reach code when the did goes, the joiner connects to a host it does not hold yet (event_reach.ts), and nothing private leaks. Invented names only.
 */
import { CHAT_TEXT_MAX } from '../../src/chat.ts'
import { decodeEventLink, encodeEventLink, leanForLink, LINK_LEAN_MAX } from '../../src/event_link.ts'
import { hostToReach } from '../../src/event_reach.ts'
import { rosterNames } from '../../src/event_roster.ts'
import { revealedBy, NAME_REVEALS } from '../../src/events.ts'
import { fittingInviteText, inviteText } from '../../src/ext/calendar/invitees.ts'

const ORIGIN = 'https://app.trustweb.one'
const DID = 'did:peer:2' + 'z'.repeat(190)
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'   // 22 base64url characters, the shape the server mints
const BY = { name: 'Ana Example', did: DID, code: CODE }
const ev = (extra = {}) => ({ id: 'e1gather', name: 'Gathering', from: '2027-01-08', to: '2027-01-12', where: 'Almhaus, Example', hosts: ['Ana Example'], hostDefault: 'discoverable', showAll: true, createdAt: 1, attended: true, ...extra })
const decoded = (text) => decodeEventLink(text.slice(text.indexOf('#')))
const linkAt = (e, by = BY) => (lean) => { const l = leanForLink(e, by, lean); return encodeEventLink(l.ev, ORIGIN, 'peer', l.by) }

describe('the link carries a short reach code beside the did', () => {
  it('round trips the code; a malformed code is ignored, the rest stays', () => {
    expect(decoded(encodeEventLink(ev(), ORIGIN, 'peer', BY)).by).toEqual(BY)
    const odd = (code) => decoded(encodeEventLink(ev(), ORIGIN, 'peer', { name: 'Ana', code })).by
    for (const bad of ['short', CODE + 'x', CODE.slice(1) + '!', '<script>alert(1)</script>']) expect(odd(bad)).toEqual({ name: 'Ana' })
  })
  it('a link without a code (an old link) still decodes', () => {
    expect(decoded(encodeEventLink(ev(), ORIGIN, 'peer', { name: 'Ana', did: DID })).by).toEqual({ name: 'Ana', did: DID })
  })
  it('lean step 1 swaps the 200-character did for the 22-character code; without a code only the did goes', () => {
    expect(leanForLink(ev(), BY, 1).by).toEqual({ name: 'Ana Example', code: CODE })
    expect(leanForLink(ev(), { name: 'Ana Example', did: DID }, 1).by).toEqual({ name: 'Ana Example' })
    expect(leanForLink(ev(), BY, 0).by).toEqual(BY)
  })
  it('the production case: the trimmed invite fits one chat message AND still names how to reach the host', () => {
    const text = fittingInviteText('Gathering', linkAt(ev()))
    expect(text).not.toBeNull()
    expect(text.length).toBeLessThanOrEqual(CHAT_TEXT_MAX)
    expect(decoded(text).by).toEqual({ name: 'Ana Example', code: CODE })
    expect(decoded(text)).toMatchObject({ id: 'e1gather', showAll: true, hosts: ['Ana Example'] })
  })
})

describe('privacy: the reach code travels only where the name does', () => {
  it('first name, nickname and hidden never put a did or a code in the link', () => {
    for (const mode of NAME_REVEALS) {
      if (mode === 'full') continue
      const by = revealedBy({ ...BY, nick: 'Fox' }, { nameReveal: mode })
      expect(by?.did).toBeUndefined()
      expect(by?.code).toBeUndefined()
    }
    expect(revealedBy(BY, { nameReveal: 'hidden' })).toBeUndefined()
    expect(revealedBy(BY, { nameReveal: 'full' })).toEqual(BY)
  })
  it('property: over generated names and modes a hidden link holds no name, did or code', () => {
    let seed = 3
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    for (let i = 0; i < 200; i++) {
      const by = revealedBy({ name: 'N' + 'x'.repeat(rnd(20)), did: 'did:peer:2' + 'q'.repeat(rnd(100)), code: CODE }, { nameReveal: ['hidden', 'first', 'nick', 'full'][rnd(4)] })
      const text = encodeEventLink(ev(), ORIGIN, 'peer', by)
      const raw = Buffer.from(text.split('#ev=')[1], 'base64url').toString()
      if (!by) expect(raw).not.toMatch(/"by"|did:peer|AbCdEf/)
      else if (!by.did) expect(raw).not.toMatch(/did:peer|AbCdEf/)
    }
  })
  it('the roster never names an invitee who did not join, nor anybody when "Everyone can see everyone" is off', () => {
    const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], metAt: 0, ...over })
    const people = [P('a', 'Anna', { events: ['e1gather'], peerId: 'pa' }), P('i', 'Invited Ina', { peerId: 'pi' })]
    const s = { me: { id: 'm', displayName: 'Ana Example' }, people, peers: people.map((p) => ({ id: p.peerId, displayName: p.name })), events: [] }
    const e = ev({ people: ['i'], hosts: ['Ana Example'], fromLink: undefined })
    expect(rosterNames(s, e)).toEqual(['Anna'])
    expect(rosterNames(s, { ...e, showAll: false })).toEqual([])
  })
})

describe('hostToReach: who a joiner connects to when it accepts the event', () => {
  const none = { people: [], peers: [] }
  it('a host I do not hold: the did first, else the code', () => {
    expect(hostToReach(BY, none)).toBe(DID)
    expect(hostToReach({ name: 'Ana Example', code: CODE }, none)).toBe(CODE)
  })
  it('nothing to reach: no inviter, a name only', () => {
    expect(hostToReach(undefined, none)).toBeNull()
    expect(hostToReach({ name: 'Ana Example' }, none)).toBeNull()
  })
  it('a host I am connected to already (by did, or by the name of a connected card): no second connect', () => {
    expect(hostToReach(BY, { people: [{ id: 'p', name: 'x', peerId: 'q1' }], peers: [{ id: 'q1', did: DID }] })).toBeNull()
    expect(hostToReach({ name: 'Ana Example', code: CODE }, { people: [{ id: 'p', name: ' Ana Example ', peerId: 'q1' }], peers: [{ id: 'q1', did: 'did:other' }] })).toBeNull()
  })
  it('a card of that name without a connection, or a deleted one, does not count as connected', () => {
    expect(hostToReach(BY, { people: [{ id: 'p', name: 'Ana Example' }], peers: [] })).toBe(DID)
    expect(hostToReach(BY, { people: [{ id: 'p', name: 'Ana Example', peerId: 'q1', deleted_at: 5 }], peers: [{ id: 'q1', did: 'did:other' }] })).toBe(DID)
  })
})
