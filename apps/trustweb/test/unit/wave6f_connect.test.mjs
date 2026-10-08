/**
 * Wave 6f, THE ONE THING (whoever opens my link appears in MY web, also when I was offline): the pure rules.
 *   ack_retry.ts   when the phone that opened a link re-sends its connect-ack, and when it stops
 *   peer_cards.ts  one card per connection; the Meet draft never moves a card to a second person; repair of merged and missing cards
 *   away_asks.ts   an ask that arrives after its asker stopped waiting, and the bounded list kept for the person
 *   drain_lock.ts  one relay drain per identity per browser profile (Web Locks), with the tab in front taking it
 */
import { ackDue, ackGapMs, noteAckSent, noteHeard, ACK_GAP_BASE_MS, ACK_GAP_MAX_MS, ACK_MAX_TRIES, ACK_RETRY_HORIZON_MS } from '../../src/ack_retry.ts'
import { cardForNewPeer, personOf, repairPeerCards } from '../../src/peer_cards.ts'
import { addAwayAsk, dismissAwayAsk, isAwayAsk, liveAwayAsks, AWAY_ASKS_MAX, AWAY_ASK_KEEP_MS, AWAY_MARGIN_MS, AWAY_TEXT_MAX } from '../../src/away_asks.ts'
import { createDrainLock, drainLockName } from '../../src/drain_lock.ts'

const NOW = 1_800_000_000_000
const H = 60 * 60 * 1000

const peer = (id, name, extra = {}) => ({ id, displayName: name, did: 'did:peer:2.' + id, ring: 'acquaintance', connectedAt: NOW - H, ...extra })
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'acquaintance', metAt: NOW - H, lines: [], ...extra })
const ids = () => { let n = 0; return () => `new${++n}` }

describe('ack_retry: the opener re-sends its connect-ack until the sharer answers', () => {
  it('is due at once when no ack was ever accepted (a failed first POST, or an older record)', () => {
    expect(ackDue(peer('a', 'A'), NOW)).toBe(true)
    expect(ackDue(peer('a', 'A', { ackTries: 0 }), NOW)).toBe(true)
  })
  it('is never due once this phone heard from them', () => {
    expect(ackDue(peer('a', 'A', { heardAt: NOW - 5 }), NOW)).toBe(false)
  })
  it('waits a doubling gap after each accepted send, capped', () => {
    expect(ackGapMs(1)).toBe(ACK_GAP_BASE_MS)
    expect(ackGapMs(2)).toBe(ACK_GAP_BASE_MS * 2)
    expect(ackGapMs(30)).toBe(ACK_GAP_MAX_MS)
    expect(ackGapMs(Number.NaN)).toBe(ACK_GAP_BASE_MS)
    const p = peer('a', 'A')
    noteAckSent(p, NOW)
    expect(p.ackTries).toBe(1)
    expect(ackDue(p, NOW + ACK_GAP_BASE_MS - 1)).toBe(false)
    expect(ackDue(p, NOW + ACK_GAP_BASE_MS)).toBe(true)
  })
  it('stops after the cap and after the horizon', () => {
    expect(ackDue(peer('a', 'A', { ackTries: ACK_MAX_TRIES, ackSentAt: NOW - 100 * H }), NOW)).toBe(false)
    expect(ackDue(peer('a', 'A', { connectedAt: NOW - ACK_RETRY_HORIZON_MS - 1 }), NOW)).toBe(false)
  })
  it('sends nothing on a malformed record', () => {
    expect(ackDue(peer('a', 'A', { connectedAt: 'yesterday' }), NOW)).toBe(false)
  })
  it('noteHeard sets heardAt once', () => {
    const p = peer('a', 'A')
    expect(noteHeard(p, NOW)).toBe(true)
    expect(noteHeard(p, NOW + 5)).toBe(false)
    expect(p.heardAt).toBe(NOW)
  })
})

describe('peer_cards: the Meet draft never moves a card to a second person', () => {
  it('the first person to connect claims the draft card that no connection holds', () => {
    const people = [person('p1', 'Pat')]
    expect(cardForNewPeer(people, { id: 'x' }, 'Pat')).toBe(people[0])
  })
  it('a second person, while the draft still carries the first one\'s name, gets no card of anyone else (root cause of 6f)', () => {
    const people = [person('p1', 'Pat', { peerId: 'x' })]
    expect(cardForNewPeer(people, { id: 'y' }, 'Pat')).toBeUndefined()
  })
  it('a connection keeps its own card (also a front door joined to a person)', () => {
    const people = [person('p1', 'Pat', { peerId: 'x' }), person('p2', 'Jo', { doorPeerId: 'door' })]
    expect(cardForNewPeer(people, { id: 'x' }, 'Someone else')).toBe(people[0])
    expect(personOf(people, 'door')).toBe(people[1])
  })
  it('names compare like everywhere else (case, spaces)', () => {
    const people = [person('p1', 'Pat  Lee')]
    expect(cardForNewPeer(people, { id: 'x' }, 'pat lee')).toBe(people[0])
    expect(cardForNewPeer(people, { id: 'x' }, '   ')).toBeUndefined()
  })
})

describe('peer_cards: repairPeerCards mends records that already went wrong', () => {
  const state = (people, peers) => ({ v: 1, me: { id: 'me', displayName: 'Me' }, people, peers, inventory: [], log: [], notificationsOn: false })

  it('a merged card goes back to its own connection and the hidden person gets a card (with what came over the wire after they connected)', () => {
    const first = peer('x', 'Pat', { connectedAt: NOW - 3 * H })
    const second = peer('y', 'Guest Two', { connectedAt: NOW - H })
    const merged = person('p1', 'Pat', { peerId: 'y', lines: [{ id: 'l', text: 'about Pat' }], theirChannels: { signal: 'https://signal.me/#eu/x' }, theirChannelsAt: NOW - H / 2 })
    const s = state([merged], [first, second])
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(true)
    expect(merged.peerId).toBe('x')
    expect(merged.lines).toHaveLength(1)
    expect(merged.theirChannels).toBeUndefined()
    const own = s.people.find((p) => p.peerId === 'y')
    expect(own).toMatchObject({ name: 'Guest Two', ring: 'acquaintance', context: 'ctx', theirChannels: { signal: 'https://signal.me/#eu/x' } })
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(false) // idempotent
  })
  it('keeps contact links that arrived before the second person connected on the original card', () => {
    const merged = person('p1', 'Pat', { peerId: 'y', theirChannels: { signal: 'a' }, theirChannelsAt: NOW - 5 * H })
    const s = state([merged], [peer('x', 'Pat'), peer('y', 'Guest Two', { connectedAt: NOW - H })])
    repairPeerCards(s, () => true, ids(), 'ctx', NOW)
    expect(merged.theirChannels).toEqual({ signal: 'a' })
  })
  it('a card renamed by its owner ("Ada from the tram") is not touched', () => {
    const s = state([person('p1', 'Ada from the tram', { peerId: 'x' })], [peer('x', 'Ada')])
    // Review 6f: true only for the once-marker (peerCardsUnmergedAt); the card stays as it is.
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(true)
    expect(s.people).toHaveLength(1)
    expect(s.people[0]).toMatchObject({ name: 'Ada from the tram', peerId: 'x' })
    expect(repairPeerCards(s, () => true, ids(), 'ctx', NOW)).toBe(false)
  })
  it('a connection without any card gets one; a connection the caller leaves out does not', () => {
    const s = state([], [peer('x', 'Pat'), peer('z', 'Skip')])
    expect(repairPeerCards(s, (p) => p.id !== 'z', ids(), 'ctx', NOW)).toBe(true)
    expect(s.people.map((p) => p.name)).toEqual(['Pat'])
  })
  it('never throws on a malformed record', () => {
    expect(repairPeerCards({ people: null, peers: [] }, () => true, ids(), 'ctx', NOW)).toBe(false)
    expect(repairPeerCards({ people: [null], peers: [peer('x', 'Pat')] }, () => true, ids(), 'ctx', NOW)).toBe(false)
  })
})

describe('away_asks: an ask whose asker stopped waiting', () => {
  it('is away only well past the asker\'s wait plus the clock margin', () => {
    const waits = 35_000
    expect(isAwayAsk(NOW - waits - AWAY_MARGIN_MS - 1, NOW, waits)).toBe(true)
    expect(isAwayAsk(NOW - waits - AWAY_MARGIN_MS, NOW, waits)).toBe(false)
    expect(isAwayAsk(NOW - 5_000, NOW, waits)).toBe(false)
    expect(isAwayAsk(NOW + 60 * H, NOW, waits)).toBe(false) // a clock far ahead only ever looks live
    expect(isAwayAsk(undefined, NOW, waits)).toBe(false)
    expect(isAwayAsk('x', NOW, waits)).toBe(false)
  })
  it('is kept bounded, newest first, deduped by id, trimmed, and dropped after the keep time', () => {
    let list = []
    for (let i = 0; i < AWAY_ASKS_MAX + 5; i++) list = addAwayAsk(list, { id: 'q' + i, at: NOW + i, peerId: 'p', from: 'Bo', text: 'x'.repeat(AWAY_TEXT_MAX + 50) }, NOW + i)
    expect(list).toHaveLength(AWAY_ASKS_MAX)
    expect(list[0].id).toBe('q' + (AWAY_ASKS_MAX + 4))
    expect([...list[0].text]).toHaveLength(AWAY_TEXT_MAX)
    expect(addAwayAsk(list, { ...list[0] }, NOW + 100)).toHaveLength(AWAY_ASKS_MAX)
    expect(liveAwayAsks(list, NOW + AWAY_ASK_KEEP_MS + 10 * H)).toHaveLength(0)
    expect(dismissAwayAsk(list, list[0].id, NOW + 100).some((a) => a.id === list[0].id)).toBe(false)
  })
  it('reads a malformed list as empty and skips malformed entries', () => {
    expect(liveAwayAsks('nope', NOW)).toEqual([])
    expect(liveAwayAsks([null, { id: 1 }, { id: 'a', at: NOW, peerId: 'p', from: 'B', text: 't' }], NOW)).toHaveLength(1)
  })
})

describe('drain_lock: one relay drain per identity per browser profile', () => {
  /** A minimal Web Locks stand-in: one holder per name, a queue, steal rejects the holder with AbortError. */
  function fakeLocks() {
    const held = new Map()
    const queue = new Map()
    const grant = (name, entry) => {
      held.set(name, entry)
      entry.cb().then(() => { if (held.get(name) === entry) { held.delete(name); next(name) } entry.resolve() })
    }
    const next = (name) => { const q = queue.get(name) ?? []; const e = q.shift(); if (e) grant(name, e) }
    return {
      request(name, opts, cb) {
        return new Promise((resolve, reject) => {
          const entry = { cb, resolve, reject }
          const cur = held.get(name)
          if (opts.steal && cur) { held.delete(name); cur.reject(Object.assign(new Error('stolen'), { name: 'AbortError' })); grant(name, entry); return }
          if (!cur) { grant(name, entry); return }
          queue.set(name, [...(queue.get(name) ?? []), entry])
        })
      },
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const tab = (locks, name) => {
    const log = []
    const lock = createDrainLock(name, locks, { onGranted: () => log.push('on'), onLost: () => log.push('off') })
    return { lock, log }
  }

  it('names the lock after the DID', () => {
    expect(drainLockName('did:peer:2.x')).toBe('trustweb-drain:did:peer:2.x')
  })
  it('without the Web Locks API every tab drains at once, as before', () => {
    const a = tab(undefined, 'n')
    a.lock.request(false)
    expect(a.lock.held()).toBe(true)
    expect(a.log).toEqual(['on'])
  })
  it('a second tab waits; the tab in front takes it, the other closes and queues again', async () => {
    const locks = fakeLocks()
    const a = tab(locks, 'n')
    const b = tab(locks, 'n')
    a.lock.request(false); await tick()
    b.lock.request(false); await tick()
    expect([a.lock.held(), b.lock.held()]).toEqual([true, false])
    b.lock.request(true); await tick(); await tick()
    expect([a.lock.held(), b.lock.held()]).toEqual([false, true])
    expect(a.log).toEqual(['on', 'off'])
    a.lock.request(true); await tick(); await tick()
    expect([a.lock.held(), b.lock.held()]).toEqual([true, false])
    expect(b.log).toEqual(['on', 'off'])
  })
  it('a tab that is closed for good (hand-over) hands the drain on to a waiting tab', async () => {
    const locks = fakeLocks()
    const a = tab(locks, 'n')
    const b = tab(locks, 'n')
    a.lock.request(false); await tick()
    b.lock.request(false); await tick()
    a.lock.release(); await tick(); await tick()
    expect(b.lock.held()).toBe(true)
    a.lock.request(true); await tick()
    expect(a.lock.held()).toBe(false)
  })
  it('a lock service that refuses (no secure page) falls back to draining', async () => {
    const a = tab({ request: () => Promise.reject(new Error('SecurityError')) }, 'n')
    a.lock.request(false); await tick()
    expect(a.lock.held()).toBe(true)
  })
})
