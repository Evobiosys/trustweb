// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The five-ring prototype (five_rings.ts): flag, Dunbar hints, the one-to-one ladder map, the lean as a move, the ring field options, the field overview. */
import { CLOSENESS_KEY, LEANS, Ring, RINGS } from '../../src/model.ts'
import { LADDER, Zone, zoneOfPerson } from '../../src/share_sink/zones.ts'
import {
  DUNBAR_HINT, FIELD_RINGS, FIVE_RINGS_FLAG, FIVE_RINGS_PARAM, RING_FIELD_OPTIONS_V2,
  dunbarHint, fieldOverview, fiveRingsOn, flagFromUrl, leanMoves, isRingFieldValue, migrateLean, ringZone, zoneRing,
} from '../../src/five_rings.ts'

const ALL = Object.values(Ring)
let n = 0
const person = (o = {}) => ({ id: `p${++n}`, name: `Person ${n}`, context: '', ring: Ring.Acquaintance, metAt: 0, lines: [], ...o })

describe('five rings: flag', () => {
  it('reads the stored flag; only "1" is on; a throwing storage is off', () => {
    expect(FIVE_RINGS_FLAG).toBe('tw-five-rings')
    expect(fiveRingsOn(() => '1')).toBe(true)
    expect(fiveRingsOn(() => '0')).toBe(false)
    expect(fiveRingsOn(() => null)).toBe(false)
    expect(fiveRingsOn(() => { throw new Error('blocked') })).toBe(false)
  })
  it('reads ?five_rings=1|0 from the url; absent or anything else is null', () => {
    expect(FIVE_RINGS_PARAM).toBe('five_rings')
    expect(flagFromUrl('?five_rings=1')).toBe(true)
    expect(flagFromUrl('?persona=me&five_rings=0')).toBe(false)
    expect(flagFromUrl('')).toBeNull()
    expect(flagFromUrl('?five_rings=yes')).toBeNull()
    expect(flagFromUrl('?other=1')).toBeNull()
  })
})

describe('five rings: Dunbar hints', () => {
  it('the field rings are RINGS, centre out', () => {
    expect(FIELD_RINGS).toEqual([Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending])
  })
  it('one hint per field ring, cumulative and growing outwards, from <= about <= to', () => {
    expect(Object.keys(DUNBAR_HINT)).toEqual([...RINGS])
    let prev = 0
    for (const r of RINGS) {
      const h = DUNBAR_HINT[r]
      expect(h.from).toBeLessThanOrEqual(h.about)
      expect(h.about).toBeLessThanOrEqual(h.to)
      expect(h.about).toBeGreaterThan(prev)
      prev = h.about
      expect(dunbarHint(r)).toEqual(h)
    }
    expect(RINGS.map((r) => DUNBAR_HINT[r].about)).toEqual([5, 15, 50, 150, 500])
  })
  it('no hint for the rings outside the field', () => {
    for (const r of [Ring.None, Ring.Family, Ring.Unsorted]) expect(dunbarHint(r)).toBeNull()
  })
})

describe('five rings: one-to-one onto the share-sink ladder', () => {
  it('each field ring is its own zone and back', () => {
    for (const ring of RINGS) {
      expect(String(ringZone({ ring }))).toBe(String(ring))
      expect(zoneRing(ringZone({ ring }))).toBe(ring)
    }
    expect(new Set(RINGS.map((ring) => ringZone({ ring }))).size).toBe(5)
  })
  it('the zones that are no ring map to null', () => {
    for (const z of [Zone.Public, Zone.Community, Zone.Self]) expect(zoneRing(z)).toBeNull()
    expect(LADDER.filter((z) => zoneRing(z) !== null)).toHaveLength(5)
  })
  it('unsorted and none are public; family goes by its closeness', () => {
    expect(ringZone({ ring: Ring.None })).toBe(Zone.Public)
    expect(ringZone({ ring: Ring.Unsorted })).toBe(Zone.Public)
    expect(ringZone({ ring: Ring.Family })).toBe(Zone.Close)
    expect(ringZone({ ring: Ring.Family, fields: { [CLOSENESS_KEY]: Ring.Closest } })).toBe(Zone.Closest)
    expect(ringZone({ ring: Ring.Family, fields: { [CLOSENESS_KEY]: Ring.Intending } })).toBe(Zone.Intending)
  })
  it('agrees with zoneOfPerson for every ring, and for family at every closeness', () => {
    for (const ring of ALL) expect(ringZone({ ring })).toBe(zoneOfPerson({ ring }))
    for (const c of RINGS) {
      const p = { ring: Ring.Family, fields: { [CLOSENESS_KEY]: c } }
      expect(ringZone(p)).toBe(zoneOfPerson(p))
    }
  })
})

describe('five rings: the lean becomes a move suggestion', () => {
  const MOVES = { [-2]: true, [-1]: true, 0: false, 1: false, 2: false }
  it.each(LEANS.map((l) => [l]))('an acquaintance with lean %s', (lean) => {
    const p = person({ lean })
    const moves = leanMoves([p])
    expect(moves.length).toBe(MOVES[lean] ? 1 : 0)
    if (MOVES[lean]) expect(moves[0]).toEqual({ person: p, to: Ring.Friend })
  })
  it('only confirmed acquaintances move: never family, intending, suggested, archived or blocked', () => {
    const never = [
      ...ALL.filter((r) => r !== Ring.Acquaintance).map((ring) => person({ ring, lean: -2 })),
      person({ ring: Ring.Family, fields: { [CLOSENESS_KEY]: Ring.Acquaintance }, lean: -2 }),
      person({ lean: -2, ringSuggested: true }),
      person({ lean: -1, blocked: 1 }),
    ]
    expect(leanMoves(never)).toEqual([])
    expect(leanMoves([person()])).toEqual([])
  })
  it('migrateLean moves the accepted ones to friend and drops their lean', () => {
    const a = person({ lean: -2 }), b = person({ lean: -1 }), c = person({ lean: 1 })
    const s = { people: [a, b, c] }
    expect(migrateLean(s, new Set([a.id]))).toBe(1)
    expect(a.ring).toBe(Ring.Friend)
    expect('lean' in a).toBe(false)
    expect(b.ring).toBe(Ring.Acquaintance)
    expect(b.lean).toBe(-1)
    expect(c.lean).toBe(1)
  })
  it("'all' moves every suggested one and is idempotent", () => {
    const s = { people: [person({ lean: -2 }), person({ lean: -1 }), person({ lean: 2 }), person({ lean: 0 })] }
    expect(migrateLean(s, 'all')).toBe(2)
    expect(s.people.map((p) => p.ring)).toEqual([Ring.Friend, Ring.Friend, Ring.Acquaintance, Ring.Acquaintance])
    const snap = JSON.stringify(s)
    expect(migrateLean(s, 'all')).toBe(0)
    expect(JSON.stringify(s)).toBe(snap)
    expect(leanMoves(s.people)).toEqual([])
  })
  it('a stale lean (anyone not on acquaintance) is dropped when moves are accepted', () => {
    const stale = person({ ring: Ring.Close, lean: 2 }), mover = person({ lean: -1 }), kept = person({ lean: 1 })
    const s = { people: [stale, mover, kept] }
    expect(migrateLean(s, new Set([mover.id]))).toBe(2)
    expect('lean' in stale).toBe(false)
    expect(stale.ring).toBe(Ring.Close)
    expect(kept.lean).toBe(1)
  })
  it('an empty set changes nothing at all, not even a stale lean', () => {
    const s = { people: [person({ ring: Ring.Friend, lean: -2 }), person({ lean: -2 })] }
    const snap = JSON.stringify(s)
    expect(migrateLean(s, new Set())).toBe(0)
    expect(JSON.stringify(s)).toBe(snap)
  })
  it('an accepted id that is no move (family, suggested, intending) does not move', () => {
    const fam = person({ ring: Ring.Family, lean: -2 }), sug = person({ lean: -2, ringSuggested: true }), int = person({ ring: Ring.Intending })
    const s = { people: [fam, sug, int] }
    migrateLean(s, new Set([fam.id, sug.id, int.id]))
    expect(fam.ring).toBe(Ring.Family)
    expect(sug.ring).toBe(Ring.Acquaintance)
    expect(sug.lean).toBe(-2)
    expect(int.ring).toBe(Ring.Intending)
  })
})

describe('five rings: the ring field, 4 -> 5 options', () => {
  it('option ids are RINGS in order, with their labels', () => {
    expect(RING_FIELD_OPTIONS_V2.map((o) => o.id)).toEqual([...RINGS])
    expect(RING_FIELD_OPTIONS_V2.map((o) => o.label)).toEqual(['Closest few', 'Close friend', 'Friend', 'Acquaintance', 'Intending to connect'])
  })
  it('knows the five ring ids and the two placement states; a legacy or unknown value is for the Curator to re-file', () => {
    for (const v of [...RINGS, 'unsorted', 'outofweb']) expect(isRingFieldValue(v)).toBe(true)
    for (const v of ['family', 'none', 'something-else', '', undefined]) expect(isRingFieldValue(v)).toBe(false)
  })
})

describe('five rings: field overview', () => {
  it('counts per ring, cumulative from the centre, unsorted incl. suggested; archived and blocked left out', () => {
    const people = [
      person({ ring: Ring.Closest }), person({ ring: Ring.Closest }),
      person({ ring: Ring.Close }), person({ ring: Ring.Family }),
      person({ ring: Ring.Friend }),
      person({ ring: Ring.Acquaintance, lean: -1 }), person({ ring: Ring.Acquaintance, lean: 2 }), person({ ring: Ring.Acquaintance, lean: -2 }),
      person({ ring: Ring.Intending }),
      person({ ring: Ring.Unsorted }), person({ ring: Ring.Friend, ringSuggested: true }),
      person({ ring: Ring.None }), person({ ring: Ring.Close, blocked: 1 }), person({ ring: Ring.Acquaintance, lean: -2, blocked: 2 }),
    ]
    const o = fieldOverview(people)
    expect(o.rows.map((r) => r.ring)).toEqual([...RINGS])
    expect(o.rows.map((r) => r.count)).toEqual([2, 2, 1, 3, 1])
    expect(o.rows.map((r) => r.cumulative)).toEqual([2, 4, 5, 8, 9])
    expect(o.rows.map((r) => r.hint)).toEqual(RINGS.map((r) => DUNBAR_HINT[r]))
    expect(o.unsorted).toBe(2)
    expect(o.total).toBe(11)
    expect(o.leanMoves).toBe(2)
  })
  it('an empty field', () => {
    const o = fieldOverview([])
    expect(o.rows.map((r) => r.count)).toEqual([0, 0, 0, 0, 0])
    expect(o).toMatchObject({ unsorted: 0, total: 0, leanMoves: 0 })
  })
})

describe('five rings: why fold', () => {
  it('has a title and exactly three sentences, never a limit claim', async () => {
    const { S } = await import('../../src/strings.ts')
    expect(S.fieldWhyTitle).toBe('Why five rings?')
    expect(S.fieldWhy.match(/[.!?](\s|$)/g)).toHaveLength(3)
    expect(S.fieldWhy).toMatch(/average/)
  })
})
