/**
 * From the demo to the live app (src/demo_to_live.ts, wave 1733 item 6 / A2):
 * what a demo phone hands over (both answers), that no demo identity, peer or
 * key ever travels, that the live app is never overwritten, and that applying
 * the same carry-over twice changes nothing.
 */
import { Audience, LineStatus, Ring, Tag, isDemoItem, isDemoPerson } from '../../src/model.ts'
import { DemoContext, Persona, seedState } from '../../src/seed.ts'
import {
  CarryPlan, DemoCleanChoice, buildCarryOver, carryPlan, dummyIds, freshFromCarry, mergeCarryOver, parseCarry,
} from '../../src/demo_to_live.ts'

const NOW = 1_760_000_000_000
const line = (id, text) => ({ id, text, tag: Tag.Note, audience: Audience.Friends, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW })

/** The demo's first phone as solo.ts leaves it: seeded under the typed name, plus what the person did. */
function demoPhone(ctx = DemoContext.Generic) {
  const seed = seedState(Persona.Holder, NOW - 1000, ctx)
  const s = { ...seed, me: { id: 'demo-me-id', displayName: 'Jakob' } }
  s.identity = { v: 1, secret: 'DEMO-SECRET-KEY' }
  s.peers = [{ id: 'peer-jonas', displayName: 'Jonas', did: 'did:peer:2.demo', ring: Ring.Friend, connectedAt: NOW }]
  s.log = [{ id: 'l1', at: NOW, from: 'Jonas', text: 'motorbike?', outcome: 'shared' }]
  // someone the person added themselves, with a note
  s.people.push({ id: 'own-1', name: 'Max', context: 'Café Prückel', ring: Ring.Friend, metAt: NOW, lines: [line('n1', 'Knows a 3D printer')] })
  // the other demo phone, connected over the relay
  s.people.push({ id: 'dev-jonas', name: 'Jonas', context: '', ring: Ring.Friend, metAt: NOW, lines: [], peerId: 'peer-jonas' })
  // a note the person added to a seeded (dummy) contact
  s.people[0].lines.push(line('n2', 'Added by me to a dummy'))
  s.inventory.push({ id: 'own-thing', text: 'Cargo bike, weekends', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW })
  s.meetings = [
    { id: 'm-own', about: 'Max', kind: 'who', personId: 'own-1', where: 'Café', startedAt: NOW, endedAt: NOW, durationMs: 1, meeting: true, lines: [], transcript: [] },
    { id: 'm-dummy', about: s.people[0].name, kind: 'who', personId: s.people[0].id, where: '', startedAt: NOW - 5, endedAt: NOW, durationMs: 1, meeting: false, lines: [], transcript: [] },
  ]
  return s
}

const live = (people = []) => ({
  v: 1, me: { id: 'live-me', displayName: 'Jakob P.' }, identity: { v: 1, secret: 'LIVE-KEY' },
  peers: [{ id: 'real-peer', displayName: 'Anna', did: 'did:peer:2.live', ring: Ring.Close, connectedAt: 1 }],
  people, inventory: [], log: [], notificationsOn: true,
})

describe('dummyIds', () => {
  it('recognises the seeded friends and things by name and context, not the person\'s own', () => {
    const s = demoPhone()
    const d = dummyIds(s, DemoContext.Generic)
    expect(d.people.size).toBe(6)
    expect(d.people.has('own-1')).toBe(false)
    expect(d.inventory.size).toBe(2)
    expect(d.inventory.has('own-thing')).toBe(false)
  })
  it('works for every context (the ea seed included)', () => {
    for (const ctx of [DemoContext.Emergent, DemoContext.Ea]) {
      const s = demoPhone(ctx)
      expect(dummyIds(s, ctx).people.size).toBe(seedState(Persona.Holder, 0, ctx).people.length)
    }
  })
  it('also counts what "Show demo content" added (state.demo)', () => {
    const s = demoPhone()
    s.demo = { people: ['own-1'], inventory: [] }
    expect(dummyIds(s, DemoContext.Generic).people.has('own-1')).toBe(true)
  })
})

describe('buildCarryOver', () => {
  it('"Start clean": only the person\'s own content, no dummy, no demo devices', () => {
    const c = buildCarryOver(demoPhone(), DemoContext.Generic, DemoCleanChoice.StartClean, NOW)
    expect(c.name).toBe('Jakob')
    expect(c.people.map((p) => p.id)).toEqual(['own-1'])
    expect(c.inventory.map((i) => i.id)).toEqual(['own-thing'])
    expect(c.demo).toEqual({ people: [], inventory: [] })
    // the meeting about a dropped dummy stays, without pointing at them
    expect(c.meetings.map((m) => m.id)).toEqual(['m-own', 'm-dummy'])
    expect(c.meetings[1].personId).toBeUndefined()
    expect(c.meetings[0].personId).toBe('own-1')
  })
  it('"Keep them": the dummy content too, still marked dummy', () => {
    const c = buildCarryOver(demoPhone(), DemoContext.Generic, DemoCleanChoice.KeepThem, NOW)
    expect(c.people).toHaveLength(7)
    expect(c.demo.people).toHaveLength(6)
    expect(c.demo.inventory).toHaveLength(2)
    expect(c.people.some((p) => p.lines.some((l) => l.text === 'Added by me to a dummy'))).toBe(true)
  })
  it('never carries the demo identity, its key, its peers, its log or its id', () => {
    for (const choice of [DemoCleanChoice.StartClean, DemoCleanChoice.KeepThem]) {
      const raw = JSON.stringify(buildCarryOver(demoPhone(), DemoContext.Generic, choice, NOW))
      expect(raw).not.toMatch(/DEMO-SECRET-KEY|did:peer|demo-me-id|peer-jonas|motorbike\?/)
      expect(raw).not.toMatch(/"peerId"/)
      expect(raw).not.toMatch(/"Jonas"/)
    }
  })
})

describe('carryPlan', () => {
  it('fresh where the live app has nothing, quiet merge where it has no people, ask where it has', () => {
    expect(carryPlan(null)).toBe(CarryPlan.Fresh)
    expect(carryPlan(live([]))).toBe(CarryPlan.MergeQuietly)
    expect(carryPlan(live([{ id: 'x', name: 'Ben', context: '', ring: Ring.Friend, metAt: 1, lines: [] }]))).toBe(CarryPlan.Ask)
  })
})

describe('mergeCarryOver / freshFromCarry', () => {
  const carry = buildCarryOver(demoPhone(), DemoContext.Generic, DemoCleanChoice.KeepThem, NOW)
  it('keeps the live identity, name, peers and people; adds the carried ones; marks the dummy', () => {
    const ben = { id: 'ben', name: 'Ben', context: '', ring: Ring.Friend, metAt: 1, lines: [] }
    const out = mergeCarryOver(live([ben]), carry)
    expect(out.me).toEqual({ id: 'live-me', displayName: 'Jakob P.' })
    expect(out.identity.secret).toBe('LIVE-KEY')
    expect(out.peers.map((p) => p.id)).toEqual(['real-peer'])
    expect(out.people[0]).toBe(ben)
    expect(out.people).toHaveLength(1 + carry.people.length)
    expect(isDemoPerson(out, carry.demo.people[0])).toBe(true)
    expect(isDemoPerson(out, 'own-1')).toBe(false)
    expect(isDemoItem(out, carry.demo.inventory[0])).toBe(true)
  })
  it('is idempotent: the same carry-over applied twice adds nothing more', () => {
    const once = mergeCarryOver(live([]), carry)
    const twice = mergeCarryOver(once, carry)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })
  it('a fresh live record: the carried name, a new id, no identity yet (the app makes its own)', () => {
    const out = freshFromCarry(carry, 'new-live-id')
    expect(out.me).toEqual({ id: 'new-live-id', displayName: 'Jakob' })
    expect(out.identity).toBeUndefined()
    expect(out.peers).toEqual([])
    expect(out.log).toEqual([])
    expect(out.people).toHaveLength(carry.people.length)
  })
})

describe('parseCarry', () => {
  it('reads its own record and nothing else', () => {
    const carry = buildCarryOver(demoPhone(), DemoContext.Generic, DemoCleanChoice.StartClean, NOW)
    expect(parseCarry(JSON.stringify(carry), NOW)?.name).toBe('Jakob')
    expect(parseCarry(JSON.stringify(carry), NOW)).toEqual(carry)
    expect(parseCarry(null, NOW)).toBeNull()
    expect(parseCarry('{oops', NOW)).toBeNull()
    expect(parseCarry(JSON.stringify({ v: 2, name: 'x' }), NOW)).toBeNull()
    expect(parseCarry(JSON.stringify({ ...carry, people: 'x' }), NOW)).toBeNull()
  })
})
