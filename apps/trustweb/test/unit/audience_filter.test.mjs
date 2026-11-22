// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter: the one audience filter (zones as "this zone and more intimate", add / exclude by @ and #, degree wording, steps diagram). */
import {
  DEFAULT_FILTER, PUBLIC_ASK_ENABLED, ZONES, degreeLabel, parseFilter, peopleFor, stepsDiagram, suggest, zonesWithin,
} from '../../src/audience_filter.ts'
import { Ring } from '../../src/model.ts'

const p = (id, ring, extra = {}) => ({ id, name: id === 'anna' ? 'Anna Huber' : id, ring, peerId: 'peer-' + id, fields: {}, ...extra })
const people = [p('a', Ring.Closest), p('b', Ring.Close), p('c', Ring.Friend), p('d', Ring.Acquaintance), p('e', Ring.Acquaintance, { fields: { yoga: 'true' } }), { id: 'g', name: 'g', ring: Ring.Closest, fields: {} }, p('anna', Ring.Friend)]
const hasTag = (x, t) => x.fields?.[t] === 'true'
const ids = (l) => l.map((x) => x.id)
const f = (o = {}) => ({ ...DEFAULT_FILTER, ...o })

describe('zones: this zone and more intimate', () => {
  it('three zones, narrowest first; a cut holds itself and every narrower zone', () => {
    expect(ZONES).toEqual(['closest', 'close', 'friend'])
    expect(zonesWithin('closest')).toEqual(['closest'])
    expect(zonesWithin('close')).toEqual(['closest', 'close'])
    expect(zonesWithin('friend')).toEqual(['closest', 'close', 'friend'])
  })
  it('Closest few as the cut never reaches Close friends and allies', () => {
    expect(ids(peopleFor(f({ zone: 'closest' }), people, hasTag))).toEqual(['a'])
    expect(ids(peopleFor(f({ zone: 'close' }), people, hasTag))).toEqual(['a', 'b'])
    expect(ids(peopleFor(f({ zone: 'friend' }), people, hasTag))).toEqual(['a', 'b', 'c', 'anna'])
  })
  it('no zone chosen (hints, intros) = every connected person', () => {
    expect(ids(peopleFor(f({ zone: undefined }), people, hasTag))).toEqual(['a', 'b', 'c', 'd', 'e', 'anna'])
  })
})

describe('add and exclude', () => {
  it('add takes a person or a tag (its holders) on top of the zone', () => {
    expect(ids(peopleFor(f({ zone: 'closest', add: ['person:d', 'tag:yoga'] }), people, hasTag))).toEqual(['a', 'd', 'e'])
  })
  it('exclude wins over zone and add; it takes a person or a tag', () => {
    expect(ids(peopleFor(f({ zone: 'friend', add: ['person:d'], exclude: ['person:a', 'person:d'] }), people, hasTag))).toEqual(['b', 'c', 'anna'])
    expect(ids(peopleFor(f({ zone: undefined, exclude: ['tag:yoga'] }), people, hasTag))).toEqual(['a', 'b', 'c', 'd', 'anna'])
  })
  it('only (a community scope) keeps just that tag inside the Friends zone, Closest few stay in', () => {
    expect(ids(peopleFor(f({ zone: 'friend', only: 'yoga' }), people, hasTag))).toEqual(['a'])
    expect(ids(peopleFor(f({ zone: 'friend', only: 'yoga', add: ['person:b'] }), people, hasTag))).toEqual(['a', 'b'])
  })
  it('notClosest drops Closest few unless added', () => {
    expect(ids(peopleFor(f({ zone: 'close', notClosest: true }), people, hasTag))).toEqual(['b'])
    expect(ids(peopleFor(f({ zone: 'close', notClosest: true, add: ['person:a'] }), people, hasTag))).toEqual(['a', 'b'])
  })
})

describe('suggest while typing', () => {
  const tags = [{ id: 'family', colour: '#7b1fa2', label: 'family' }, { id: 'yoga', colour: '#112233', label: 'Yoga crew' }]
  it('@ finds people by folded name, # finds tags by label', () => {
    expect(suggest('@ann', people, tags).map((s) => [s.kind, s.id])).toEqual([['person', 'anna']])
    expect(suggest('#yo', tags ? people : [], tags).map((s) => [s.kind, s.id])).toContainEqual(['tag', 'yoga'])
    expect(suggest('@', people, tags).length).toBeGreaterThan(0)
  })
  it('# with no exact tag adds a "Create tag" row last; an exact tag does not', () => {
    const rows = suggest('#climbing', people, tags)
    expect(rows[rows.length - 1]).toEqual({ kind: 'create', label: 'climbing' })
    expect(suggest('#family', people, tags).some((s) => s.kind === 'create')).toBe(false)
    expect(suggest('#', people, tags).some((s) => s.kind === 'create')).toBe(false)
  })
  it('chips already chosen are not offered again; plain text finds both kinds', () => {
    expect(suggest('@ann', people, tags, ['person:anna'])).toEqual([])
    expect(suggest('fam', people, tags).map((s) => s.kind)).toEqual(['tag'])
  })
})

describe('degree wording follows the zone', () => {
  it('2nd and 3rd degree name the zone twice or thrice', () => {
    expect(degreeLabel('close', 2)).toBe('friends of friends')
    expect(degreeLabel('friend', 2)).toBe('acquaintances of acquaintances')
    expect(degreeLabel('closest', 2)).toBe('closest few of closest few')
    expect(degreeLabel('friend', 3)).toBe('acquaintances of acquaintances of acquaintances')
    expect(degreeLabel('close', 1)).toBe('friends')
  })
})

describe('parseFilter (MCP and storage)', () => {
  it('fills the defaults; public is refused while the switch is off', () => {
    expect(PUBLIC_ASK_ENABLED).toBe(false)
    expect(parseFilter({ zone: 'close', add: ['person:x'], exclude: ['tag:y'], degree: 2 })).toEqual({ zone: 'close', add: ['person:x'], exclude: ['tag:y'], degree: 2 })
    expect(parseFilter({})).toEqual({ zone: undefined, add: [], exclude: [], degree: 1 })
    expect(() => parseFilter({ degree: 'public' })).toThrow(/public/)
    expect(() => parseFilter({ zone: 'wide' })).toThrow(/zone/)
    expect(() => parseFilter({ degree: 4 })).toThrow(/degree/)
    expect(() => parseFilter({ add: ['bob'] })).toThrow(/person:<id>/)
    expect(() => parseFilter({ add: 'x' })).toThrow(/list/)
  })
})

describe('steps diagram (A7)', () => {
  const labels = { you: 'You', ring: (n) => `Ring ${n}`, alt: (n) => `Your ask travels ${n} step${n === 1 ? '' : 's'}` }
  it.each([1, 2, 3])('%i step(s): you, then that many highlighted rings', (n) => {
    const svg = stepsDiagram(n, labels)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('role="img"')
    expect(svg).toContain(`<title>${labels.alt(n)}</title>`)
    expect((svg.match(/data-step-on/g) ?? []).length).toBe(n)
    expect((svg.match(/data-step-off/g) ?? []).length).toBe(3 - n)
  })
  it('custom shows the add and exclude sets as chips around the rings, text escaped', () => {
    const svg = stepsDiagram(2, labels, { add: ['Anna <b>'], exclude: ['Ben'] })
    expect(svg).toContain('data-set-add')
    expect(svg).toContain('data-set-exclude')
    expect(svg).toContain('Anna &lt;b&gt;')
    expect(svg).not.toContain('<b>')
  })
  it('more than three steps shows three rings and an ellipsis', () => {
    expect(stepsDiagram(5, labels)).toContain('data-step-more')
  })
})

/* wave45 ask-event-limit */
describe('event chips: limit an ask by who attended', () => {
  const att = (id, ring, events) => ({ ...p(id, ring), events })
  const crowd = [att('a', Ring.Closest, []), att('b', Ring.Friend, ['ev1']), att('c', Ring.Acquaintance, ['ev1']), att('d', Ring.Acquaintance, ['ev2'])]
  it('parseFilter accepts event:<id> chips', () => {
    expect(parseFilter({ add: ['event:ev1'], exclude: ['event:ev2'] })).toEqual({ zone: undefined, add: ['event:ev1'], exclude: ['event:ev2'], degree: 1 })
  })
  it('add event:<id> reaches its attendees on top of the zone', () => {
    expect(ids(peopleFor(f({ zone: 'closest', add: ['event:ev1'] }), crowd, hasTag))).toEqual(['a', 'b', 'c'])
  })
  it('exclude event:<id> hides its attendees', () => {
    expect(ids(peopleFor(f({ zone: 'friend', exclude: ['event:ev1'] }), crowd, hasTag))).toEqual(['a'])
  })
  it('# suggests events by tag label or plain name', () => {
    const evs = [{ id: 'ev1', name: 'Winter IYG' }]
    expect(suggest('#event:win', [], [], [], evs)).toEqual([{ kind: 'event', id: 'ev1', label: 'event:Winter IYG' }, { kind: 'create', label: 'event:win' }])
    expect(suggest('#iyg', [], [], [], evs).map((s) => s.kind)).toEqual(['event', 'create'])
    expect(suggest('@win', [], [], [], evs)).toEqual([])
    expect(suggest('#event:win', [], [], ['event:ev1'], evs).map((s) => s.kind)).toEqual(['create'])
  })
})
