/**
 * Wave 6 (U1), the sharing cascade (src/cascade.ts), table-driven: the
 * audience x degrees admission matrix, the defaults, the chooser, and
 * askSources (the matcher's input: lines that may not answer never take part),
 * plus one Jakob (src/one_jakob.ts) and the pass-on default (model.ts).
 */
import { matchTemplate } from '../../../demo/src/match/lexical.ts'
import { askTemplate } from '../../src/lexicon.ts'
import {
  admitsAtHop, askSources, DEGREES_CHOICES, DEGREES_MAX, DEGREES_UNBOUNDED, DegreesChoice, defaultDegrees, degreesChoice, degreesFor, isDegrees,
  itemDegrees, lineDegrees,
} from '../../src/cascade.ts'
import { joinFrontDoor, mergeOneJakob, personOfPeer, sameName } from '../../src/one_jakob.ts'
import { Audience, LineStatus, passesAsksOn, Ring, Tag } from '../../src/model.ts'

const A = Audience
const R = Ring

describe('the admission matrix: audience first, then degrees', () => {
  // [audience, degrees, ring of whoever handed me the ask, hop, admitted]
  const rows = [
    // hop 0: the audience alone decides (each tier admits itself and everyone closer)
    [A.FriendsOfFriends, 0, R.Acquaintance, 0, true],
    [A.FriendsOfFriends, 0, R.Friend, 0, true],
    [A.FriendsOfFriends, 0, R.Close, 0, true],
    [A.Friends, 0, R.Acquaintance, 0, false],
    [A.Friends, 0, R.Friend, 0, true],
    [A.Friends, 0, R.Close, 0, true],
    [A.Close, 0, R.Friend, 0, false],
    [A.Close, 0, R.Close, 0, true],
    [A.OnlyMe, DEGREES_UNBOUNDED, R.Close, 0, false],
    [A.FriendsOfFriends, 3, R.Intending, 0, false],
    // hop 1 (friends of friends): degrees >= 1 AND the forwarding contact's ring admitted
    [A.FriendsOfFriends, 1, R.Acquaintance, 1, true],
    [A.FriendsOfFriends, 0, R.Acquaintance, 1, false],
    [A.Friends, 1, R.Acquaintance, 1, false],
    [A.Friends, 1, R.Friend, 1, true],
    [A.Close, 1, R.Close, 1, true],
    [A.Close, 1, R.Friend, 1, false],
    [A.OnlyMe, DEGREES_UNBOUNDED, R.Close, 1, false],
    // further out
    [A.FriendsOfFriends, 1, R.Friend, 2, false],
    [A.FriendsOfFriends, 2, R.Friend, 2, true],
    [A.FriendsOfFriends, DEGREES_UNBOUNDED, R.Acquaintance, 5, true],
    ['everyone', DEGREES_UNBOUNDED, R.Close, 0, false],
  ]
  it.each(rows)('%s with %s degrees, handed over by %s at hop %s: %s', (aud, deg, ring, hop, want) => {
    expect(admitsAtHop(aud, deg, ring, hop)).toBe(want)
  })
})

describe('degrees: defaults, stored values, the chooser', () => {
  it('Jakob\'s defaults: acquaintances travel one degree, everything narrower none', () => {
    expect(defaultDegrees(A.FriendsOfFriends)).toBe(1)
    expect(defaultDegrees(A.Friends)).toBe(0)
    expect(defaultDegrees(A.Close)).toBe(0)
    expect(defaultDegrees(A.OnlyMe)).toBe(0)
  })
  it('an item: what was set, else the default; a note line: what was set, else 0 (fail closed)', () => {
    expect(itemDegrees({ audience: A.FriendsOfFriends })).toBe(1)
    expect(itemDegrees({ audience: A.Friends })).toBe(0)
    expect(itemDegrees({ audience: A.Friends, degrees: 2 })).toBe(2)
    expect(itemDegrees({ audience: A.Friends, degrees: 'x' })).toBe(0)
    expect(itemDegrees({ audience: A.FriendsOfFriends, degrees: 99 })).toBe(1)
    expect(lineDegrees({ audience: A.FriendsOfFriends })).toBe(0)
    expect(lineDegrees({ degrees: 1 })).toBe(1)
  })
  it.each([[0, true], [DEGREES_MAX, true], [DEGREES_UNBOUNDED, true], [DEGREES_MAX + 1, false], [-2, false], [1.5, false], ['1', false]])(
    'isDegrees(%s) = %s', (v, want) => expect(isDegrees(v)).toBe(want))
  it('the chooser round-trips; Custom is clamped to 1..DEGREES_MAX', () => {
    expect(DEGREES_CHOICES).toEqual([DegreesChoice.Contacts, DegreesChoice.FriendsOfFriends, DegreesChoice.Two, DegreesChoice.Custom, DegreesChoice.NoLimit])
    for (const d of [0, 1, 2, DEGREES_UNBOUNDED]) expect(degreesFor(degreesChoice(d), 0)).toBe(d)
    expect(degreesChoice(4)).toBe(DegreesChoice.Custom)
    expect(degreesFor(DegreesChoice.Custom, 4)).toBe(4)
    expect(degreesFor(DegreesChoice.Custom, 50)).toBe(DEGREES_MAX)
    expect(degreesFor(DegreesChoice.Custom, 0)).toBe(1)
  })
})

describe('askSources: only lines this step admits ever reach the matcher', () => {
  const now = Date.UTC(2026, 9, 8)
  const line = (id, text, audience, extra = {}) => ({ id, text, tag: Tag.Note, audience, status: LineStatus.Current, notedAt: now, checkedAt: now, ...extra })
  const state = {
    v: 1, me: { id: 'cleo', displayName: 'Cleo' }, peers: [], log: [], notificationsOn: false,
    inventory: [
      { id: 'i1', text: 'Ladder, 3 m, to lend', audience: A.FriendsOfFriends, included: true, createdAt: now },
      { id: 'i2', text: 'Spare ladder for close friends', audience: A.Close, included: true, createdAt: now },
      { id: 'i3', text: 'Ladder hooks, friends only, raised', audience: A.Friends, included: true, createdAt: now, degrees: 1 },
      { id: 'i4', text: 'Ladder paused', audience: A.FriendsOfFriends, included: false, createdAt: now },
    ],
    people: [{ id: 'p1', name: 'Dana', context: 'met', ring: R.Friend, metAt: now, lines: [line('l1', 'Dana has a ladder', A.FriendsOfFriends)] }],
  }
  const ids = (ring, hop) => askSources(state, ring, hop).threads.map((t) => t.id).sort()
  it.each([
    [R.Acquaintance, 0, ['inv:i1', 'note:p1:l1']],
    [R.Close, 0, ['inv:i1', 'inv:i2', 'inv:i3', 'note:p1:l1']],
    [R.Acquaintance, 1, ['inv:i1']],
    [R.Friend, 1, ['inv:i1', 'inv:i3']],
    [R.Close, 2, []],
  ])('handed over by %s at hop %s', (ring, hop, want) => expect(ids(ring, hop)).toEqual(want))
  it('a line that may not answer never takes the top score away from one that may (filter before the match)', () => {
    const { threads } = askSources(state, R.Acquaintance, 1)
    const m = matchTemplate(askTemplate('ladder'), threads)
    expect(m.hits.map((h) => h.threadId)).toEqual(['inv:i1'])
  })
})

describe('pass their asks on: the default by ring, the setting wins', () => {
  it.each([[R.Close, true], [R.Friend, true], [R.Acquaintance, false], [R.Intending, false]])('%s: %s', (ring, want) => {
    expect(passesAsksOn({ ring })).toBe(want)
  })
  it('the per-person setting wins either way', () => {
    expect(passesAsksOn({ ring: R.Acquaintance, passOn: true })).toBe(true)
    expect(passesAsksOn({ ring: R.Close, passOn: false })).toBe(false)
  })
})

describe('one Jakob (N6)', () => {
  const DOOR = 'His public demo lines, on the Swiss server'
  const person = (id, name, extra = {}) => ({ id, name, context: '', ring: R.Acquaintance, metAt: 1, lines: [], ...extra })
  it('sameName: NFC, spaces, case', () => {
    expect(sameName(' Jakob ', 'jakob')).toBe(true)
    expect(sameName('Jakob', 'Anna')).toBe(false)
    expect(sameName('', '')).toBe(false)
  })
  it('joinFrontDoor: joins only the inviter of the same name', () => {
    const jakob = person('p1', 'Jakob', { peerId: 'jp' })
    expect(joinFrontDoor(jakob, 'door', 'Jakob')).toBe(true)
    expect(jakob.doorPeerId).toBe('door')
    const anna = person('p2', 'Anna', { peerId: 'ap' })
    expect(joinFrontDoor(anna, 'door', 'Jakob')).toBe(false)
    expect(anna.doorPeerId).toBeUndefined()
    expect(joinFrontDoor(undefined, 'door', 'Jakob')).toBe(false)
  })
  it('personOfPeer finds a person by their own peer or as their front door', () => {
    const s = { people: [person('p1', 'Jakob', { peerId: 'jp', doorPeerId: 'door' })] }
    expect(personOfPeer(s, 'jp')?.id).toBe('p1')
    expect(personOfPeer(s, 'door')?.id).toBe('p1')
    expect(personOfPeer(s, 'nobody')).toBeUndefined()
  })
  it('mergeOneJakob folds an older record\'s second Jakob into the first, once', () => {
    const s = {
      testOf: { name: 'Jakob', createdAt: 1 },
      people: [person('p1', 'Jakob', { peerId: 'jp' }), person('p2', 'Jakob', { peerId: 'door', context: DOOR }), person('p3', 'Ben', { peerId: 'bp' })],
    }
    expect(mergeOneJakob(s, DOOR)).toBe(true)
    expect(s.people.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(s.people[0].doorPeerId).toBe('door')
    expect(mergeOneJakob(s, DOOR)).toBe(false)
  })
  it('mergeOneJakob leaves everything else alone and never throws', () => {
    const own = { people: [person('p1', 'Jakob', { peerId: 'jp' }), person('p2', 'Jakob', { peerId: 'door', context: DOOR })] }
    expect(mergeOneJakob(own, DOOR)).toBe(false)
    const notes = { testOf: { name: 'Jakob', createdAt: 1 }, people: [person('p1', 'Jakob', { peerId: 'jp' }), person('p2', 'Jakob', { peerId: 'door', context: DOOR, lines: [{ id: 'l' }] })] }
    expect(mergeOneJakob(notes, DOOR)).toBe(false)
    const other = { testOf: { name: 'Anna', createdAt: 1 }, people: [person('p1', 'Anna', { peerId: 'ap' }), person('p2', 'Jakob', { peerId: 'door', context: DOOR })] }
    expect(mergeOneJakob(other, DOOR)).toBe(false)
    expect(mergeOneJakob({ testOf: { name: 'Jakob' }, people: 'broken' }, DOOR)).toBe(false)
    expect(mergeOneJakob({ testOf: { name: 'Jakob' } }, DOOR)).toBe(false)
  })
})
