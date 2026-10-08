/**
 * Wave 6f review + fix (the rules the review added or changed):
 *   ack_retry.ts   this visit's attempts per connection are spaced and capped, whatever their outcome (a timed-out send may have been stored)
 *   peer_cards.ts  the unmerge-by-name step runs ONCE per record; a card its owner renames later is never moved by it
 *   tab_sync.ts    what a tab does with a record another tab saved: adopt it in place (objects kept by id), or stop when reset or re-owned
 */
import { attemptAllowed, nextAttempts, ACK_ATTEMPT_GAP_MS, ACK_ATTEMPTS_PER_VISIT } from '../../src/ack_retry.ts'
import { repairPeerCards } from '../../src/peer_cards.ts'
import { StoredChange, adoptInPlace, storedChange } from '../../src/tab_sync.ts'

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
  it('the same identity: adopt it', () => {
    expect(storedChange(mine, false, 'me')).toBe(StoredChange.Adopt)
  })
  it('removed (Reset this phone in another tab): this tab is superseded and must never write its copy back', () => {
    expect(storedChange(null, true, 'me')).toBe(StoredChange.Superseded)
  })
  it('another identity (a hand-over taken, a restore): superseded', () => {
    expect(storedChange({ me: { id: 'other' } }, false, 'me')).toBe(StoredChange.Superseded)
  })
  it('unreadable: ignored, this tab carries on with its own', () => {
    expect(storedChange(null, false, 'me')).toBe(StoredChange.Ignore)
  })
})

describe('tab_sync: adoptInPlace keeps the objects a sheet holds', () => {
  it('an edit through an object held from before the take-over lands on the adopted record (not on a copy no longer saved)', () => {
    const ann = person('ann', 'Ann', { peerId: 'a' })
    const cur = state([ann], [peer('a', 'Ann')])
    const next = JSON.parse(JSON.stringify(cur))
    next.peers.push(peer('bo', 'Bo')) // the other tab received Bo
    next.people.push(person('bo-card', 'Bo', { peerId: 'bo' }))
    next.people[0].ring = 'friend' // and changed Ann there
    const out = adoptInPlace(cur, next)
    expect(out).toBe(cur)
    expect(cur.people[0]).toBe(ann) // the very object the open sheet holds
    expect(ann.ring).toBe('friend')
    ann.passOn = true // the sheet's "Pass their asks on", after the take-over
    const saved = JSON.parse(JSON.stringify(cur))
    expect(saved.people.find((p) => p.id === 'ann').passOn).toBe(true)
    expect(saved.peers.map((p) => p.id)).toEqual(['a', 'bo'])
    expect(saved.people.map((p) => p.id)).toEqual(['ann', 'bo-card'])
  })
  it('keys and items the newer record no longer has are gone; order follows the newer record', () => {
    const cur = { a: 1, gone: 2, list: [{ id: 'x', v: 1 }, { id: 'y', v: 2 }], plain: [1, 2, 3] }
    const x = cur.list[0]
    adoptInPlace(cur, { a: 3, list: [{ id: 'z', v: 9 }, { id: 'x', v: 5 }], plain: [4] })
    expect(cur).toEqual({ a: 3, list: [{ id: 'z', v: 9 }, { id: 'x', v: 5 }], plain: [4] })
    expect(cur.list[1]).toBe(x)
  })
  it('a duplicate id reuses the held object once only', () => {
    const cur = { list: [{ id: 'x', v: 1 }] }
    adoptInPlace(cur, { list: [{ id: 'x', v: 2 }, { id: 'x', v: 3 }] })
    expect(cur.list[0]).not.toBe(cur.list[1])
    expect(cur.list.map((i) => i.v)).toEqual([2, 3])
  })
  it('never copies a key that reaches a prototype', () => {
    const cur = { me: { id: 'me' } }
    adoptInPlace(cur, JSON.parse('{"me":{"id":"me"},"__proto__":{"polluted":1},"x":{"constructor":{"prototype":{"bad":1}}}}'))
    expect({}.polluted).toBeUndefined()
    expect({}.bad).toBeUndefined()
    expect(Object.getPrototypeOf(cur)).toBe(Object.prototype)
  })
  it('a change of type takes the newer value', () => {
    expect(adoptInPlace({ a: 1 }, [1])).toEqual([1])
    expect(adoptInPlace([1], 'x')).toBe('x')
  })
})
