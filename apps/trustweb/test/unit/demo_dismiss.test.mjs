/**
 * "Dismiss them" (src/demo_dismiss.ts, wave 5 item a): the dummy demo content goes, nothing else does.
 *   Seeded scope (an embedded demo phone): the seeded web goes; what the visitor added, and every connected person, stays.
 *   Added scope (a live phone): only the ids "Show demo content" recorded; never matched by name or text.
 */
import { Audience, LineStatus, Ring, Tag } from '../../src/model.ts'
import { DEMO_CONTEXTS, DemoContext, Persona, seedState } from '../../src/seed.ts'
import { demoContentForLivePhone } from '../../src/demo_to_live.ts'
import { DismissScope, removeDummyContent } from '../../src/demo_dismiss.ts'

const NOW = 1_760_000_000_000
const line = (id, text) => ({ id, text, tag: Tag.Note, audience: Audience.Friends, status: LineStatus.Current, notedAt: NOW, checkedAt: NOW })

/** A demo phone as solo.ts leaves it, plus what the visitor did. */
function demoPhone(ctx = DemoContext.Generic) {
  const s = { ...seedState(Persona.Holder, NOW - 1000, ctx), me: { id: 'me', displayName: 'Visitor' } }
  s.people.push({ id: 'own-1', name: 'Max', context: 'Cafe', ring: Ring.Friend, metAt: NOW, lines: [line('n1', 'Knows a 3D printer')] })
  s.people.push({ id: 'dev-jonas', name: 'Jonas', context: '', ring: Ring.Friend, metAt: NOW, lines: [], peerId: 'peer-jonas' })
  s.inventory.push({ id: 'own-thing', text: 'Cargo bike, weekends', audience: Audience.FriendsOfFriends, included: true, createdAt: NOW })
  return s
}

describe('Dismiss them on an embedded demo phone (Seeded)', () => {
  for (const ctx of DEMO_CONTEXTS) {
    it(`takes the seeded web of the ${ctx} demo and leaves what the visitor added and the connected phone`, () => {
      const s = demoPhone(ctx)
      const seeded = seedState(Persona.Holder, 0, ctx)
      const out = removeDummyContent(s, ctx, DismissScope.Seeded)
      expect(out).toEqual({ people: seeded.people.length, things: seeded.inventory.length })
      expect(s.people.map((p) => p.id).sort()).toEqual(['dev-jonas', 'own-1'])
      expect(s.inventory.map((i) => i.id)).toEqual(['own-thing'])
    })
  }
  it('is idempotent: a second dismissal takes nothing', () => {
    const s = demoPhone()
    removeDummyContent(s, DemoContext.Generic, DismissScope.Seeded)
    expect(removeDummyContent(s, DemoContext.Generic, DismissScope.Seeded)).toEqual({ people: 0, things: 0 })
  })
  it('keeps a seeded-looking person that is a connection (a peerId is never dummy)', () => {
    const s = demoPhone()
    s.people[0].peerId = 'peer-real'
    const id = s.people[0].id
    removeDummyContent(s, DemoContext.Generic, DismissScope.Seeded)
    expect(s.people.some((p) => p.id === id)).toBe(true)
  })
  it('a past meeting of a removed person keeps its notes but no longer points at them', () => {
    const s = demoPhone()
    const dummy = s.people[0]
    s.meetings = [
      { id: 'm1', about: dummy.name, kind: 'who', personId: dummy.id, where: '', startedAt: NOW, endedAt: NOW, durationMs: 1, meeting: false, lines: [{ text: 'a note', tag: Tag.Note }], transcript: [] },
      { id: 'm2', about: 'Max', kind: 'who', personId: 'own-1', where: '', startedAt: NOW, endedAt: NOW, durationMs: 1, meeting: false, lines: [], transcript: [] },
    ]
    removeDummyContent(s, DemoContext.Generic, DismissScope.Seeded)
    expect(s.meetings[0].personId).toBeUndefined()
    expect(s.meetings[0].lines).toHaveLength(1)
    expect(s.meetings[1].personId).toBe('own-1')
  })
})

describe('Dismiss them on a live phone (Added)', () => {
  function livePhone() {
    const seed = demoContentForLivePhone(NOW, DemoContext.Generic)
    const s = { v: 1, me: { id: 'me', displayName: 'Real' }, peers: [], log: [], notificationsOn: false, people: [], inventory: [] }
    // a REAL person who happens to share a seeded name and context, and a real thing with a seeded text
    const twin = seed.people[0]
    s.people.push({ id: 'real-twin', name: twin.name, context: twin.context, ring: Ring.Friend, metAt: NOW, lines: [line('r1', 'My own note')] })
    s.inventory.push({ id: 'real-thing', text: seed.inventory[0].text, audience: Audience.Friends, included: true, createdAt: NOW })
    s.people.push(...seed.people)
    s.inventory.push(...seed.inventory)
    s.demo = { people: seed.people.map((p) => p.id), inventory: seed.inventory.map((i) => i.id) }
    return { s, seed }
  }
  it('takes exactly the ids "Show demo content" recorded, even when a real record looks the same', () => {
    const { s, seed } = livePhone()
    const out = removeDummyContent(s, DemoContext.Generic, DismissScope.Added)
    expect(out).toEqual({ people: seed.people.length, things: seed.inventory.length })
    expect(s.people.map((p) => p.id)).toEqual(['real-twin'])
    expect(s.inventory.map((i) => i.id)).toEqual(['real-thing'])
    expect(s.demo).toBeUndefined()
  })
  it('a phone with no recorded demo content loses nothing, whatever it holds', () => {
    const { s } = livePhone()
    delete s.demo
    const before = JSON.stringify(s)
    expect(removeDummyContent(s, DemoContext.Generic, DismissScope.Added)).toEqual({ people: 0, things: 0 })
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('Remove demo content while it is hidden (2026-10-19)', () => {
  it('takes the hidden stash away too and counts it', () => {
    const s = { v: 1, me: { id: 'me', displayName: 'V' }, peers: [], log: [], notificationsOn: false,
      people: [{ id: 'own-1', name: 'Max', context: '', ring: Ring.Friend, metAt: NOW, lines: [] }], inventory: [],
      demo: { people: ['d1'], inventory: ['t1'] },
      demoHidden: { people: [{ id: 'd1', name: 'Dummy', context: '', ring: Ring.Friend, metAt: NOW, lines: [] }], inventory: [{ id: 't1', text: 'thing', audience: Audience.Friends, included: true, createdAt: NOW }] } }
    expect(removeDummyContent(s, DemoContext.Generic, DismissScope.Added)).toEqual({ people: 1, things: 1 })
    expect(s.demoHidden).toBeUndefined()
    expect(s.demo).toBeUndefined()
    expect(s.people.map((p) => p.id)).toEqual(['own-1'])
  })
})
