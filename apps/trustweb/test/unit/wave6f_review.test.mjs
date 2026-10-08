/**
 * Wave 6f review + fix (the rules the review added or changed):
 *   ack_retry.ts   this visit's attempts per connection are spaced and capped, whatever their outcome (a timed-out send may have been stored)
 *   peer_cards.ts  the unmerge-by-name step runs ONCE per record; a card its owner renames later is never moved by it
 *   tab_sync.ts    what a tab does with a record another tab saved: adopt, wait while a sheet holds it, or stop when reset or re-owned
 */
import { attemptAllowed, nextAttempts, ACK_ATTEMPT_GAP_MS, ACK_ATTEMPTS_PER_VISIT } from '../../src/ack_retry.ts'
import { repairPeerCards } from '../../src/peer_cards.ts'
import { StoredChange, storedChange } from '../../src/tab_sync.ts'

const NOW = 1_800_000_000_000
const H = 60 * 60 * 1000
const peer = (id, name, extra = {}) => ({ id, displayName: name, did: 'did:peer:2.' + id, ring: 'acquaintance', connectedAt: NOW - H, ...extra })
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'acquaintance', metAt: NOW - H, lines: [], ...extra })
const ids = () => { let n = 0; return () => `new${++n}` }
const state = (people, peers, extra = {}) => ({ v: 1, me: { id: 'me', displayName: 'Me' }, people, peers, inventory: [], log: [], notificationsOn: false, ...extra })

describe('ack_retry: attempts within one visit', () => {
  it('the first attempt is always allowed', () => {
    expect(attemptAllowed(undefined, NOW)).toBe(true)
  })
  it('a second attempt waits the attempt gap, whatever the first one\'s outcome', () => {
    const once = nextAttempts(undefined, NOW)
    expect(once).toEqual({ at: NOW, n: 1 })
    expect(attemptAllowed(once, NOW + ACK_ATTEMPT_GAP_MS - 1)).toBe(false)
    expect(attemptAllowed(once, NOW + ACK_ATTEMPT_GAP_MS)).toBe(true)
  })
  it('stops after the per-visit cap, however long the visit', () => {
    let a
    for (let i = 0; i < ACK_ATTEMPTS_PER_VISIT; i++) a = nextAttempts(a, NOW + i * ACK_ATTEMPT_GAP_MS)
    expect(a.n).toBe(ACK_ATTEMPTS_PER_VISIT)
    expect(attemptAllowed(a, NOW + 1000 * H)).toBe(false)
  })
})

describe('peer_cards: the unmerge step runs once per record', () => {
  it('mends a merged card on the first start and sets the marker', () => {
    const merged = person('p1', 'Pat', { peerId: 'y' })
    const s = state([merged], [peer('x', 'Pat'), peer('y', 'Guest Two')])
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(true)
    expect(merged.peerId).toBe('x')
    expect(s.peerCardsUnmergedAt).toBe(NOW)
  })
  it('later, a card its owner renamed to the name of a connection without a card is NOT moved (that connection gets its own card)', () => {
    // Ann's card, renamed by its owner to "Bob"; a connection called Bob without a card: the same shape as a merge, but not one.
    const renamed = person('p1', 'Bob', { peerId: 'ann' })
    const s = state([renamed], [peer('ann', 'Ann'), peer('bob', 'Bob')], { peerCardsUnmergedAt: NOW - 24 * H })
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(true)
    expect(renamed.peerId).toBe('ann')
    expect(s.people.find((p) => p.peerId === 'bob')).toMatchObject({ name: 'Bob', context: 'ctx' })
    expect(s.peerCardsUnmergedAt).toBe(NOW - 24 * H)
  })
  it('a record whose marker is set and every connection has a card is left exactly as it is', () => {
    const s = state([person('p1', 'Pat', { peerId: 'x' })], [peer('x', 'Pat')], { peerCardsUnmergedAt: NOW - H })
    const before = JSON.stringify(s)
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('tab_sync: a record another tab of this profile saved', () => {
  const mine = { me: { id: 'me' } }
  it('the same identity, nothing open: adopt it', () => {
    expect(storedChange(mine, false, 'me', false)).toBe(StoredChange.Adopt)
  })
  it('the same identity while a sheet or a field holds the current record: wait (an edit there must not land on a record no longer saved)', () => {
    expect(storedChange(mine, false, 'me', true)).toBe(StoredChange.Wait)
  })
  it('removed (Reset this phone in another tab): this tab is superseded and must never write its copy back', () => {
    expect(storedChange(null, true, 'me', false)).toBe(StoredChange.Superseded)
    expect(storedChange(null, true, 'me', true)).toBe(StoredChange.Superseded)
  })
  it('another identity (a hand-over taken, a restore): superseded, also while busy', () => {
    expect(storedChange({ me: { id: 'other' } }, false, 'me', false)).toBe(StoredChange.Superseded)
    expect(storedChange({ me: { id: 'other' } }, false, 'me', true)).toBe(StoredChange.Superseded)
  })
  it('unreadable: ignored, this tab carries on with its own', () => {
    expect(storedChange(null, false, 'me', false)).toBe(StoredChange.Ignore)
  })
})
