import { describe, expect, it } from 'vitest'
import { Kind, LAST_NAME_KEY, Section, emptyPlacement, labelOf, layout, mergePlacements, move } from '../../src/placement'
import { Presence, effectivePerson, entityValues, favLink, presence, splitName } from '../../src/person_view'
import { Channel, Ring } from '../../../trustweb/src/model'
import { PERSON_FIELDS } from '../../src/person_fields'

const ids = (l: { id: string }[]): string[] => l.map((f) => f.id)

describe('layout', () => {
  it('puts the five default fields in simple and everything else in advanced', () => {
    const lay = layout(Kind.Person, emptyPlacement(), {})
    expect(ids(lay.simple)).toEqual(['tw-first', LAST_NAME_KEY, 'tw-context', 'tw-ring', 'tw-fav'])
    expect(lay.advanced.length).toBe(PERSON_FIELDS.length - 5)
    expect(lay.collapsed).toEqual([])
  })
  it('shows a filled, unplaced field in simple; an explicitly advanced one stays advanced', () => {
    const values = { Bxw7k4FWptqp: 'a@b.org' }
    expect(ids(layout(Kind.Person, emptyPlacement(), values).simple)).toContain('Bxw7k4FWptqp')
    const p = { sections: { Bxw7k4FWptqp: Section.Advanced }, order: [] }
    expect(ids(layout(Kind.Person, p, values).advanced)).toContain('Bxw7k4FWptqp')
  })
  it('moves a field across the boundary, before another, and keeps it there when empty', () => {
    const p = move(Kind.Person, emptyPlacement(), {}, 'Bxw7k4FWptqp', Section.Simple, 'tw-ring')
    const lay = layout(Kind.Person, p, {})
    expect(ids(lay.simple)).toEqual(['tw-first', LAST_NAME_KEY, 'tw-context', 'Bxw7k4FWptqp', 'tw-ring', 'tw-fav'])
    expect(ids(lay.advanced)).not.toContain('Bxw7k4FWptqp')
  })
  it('hides and collapses', () => {
    const p = move(Kind.Person, move(Kind.Person, emptyPlacement(), {}, 'tw-fav', Section.Hidden, null), {}, 'tw-context', Section.Collapsed, null)
    const lay = layout(Kind.Person, p, {})
    expect(ids(lay.hidden)).toEqual(['tw-fav'])
    expect(ids(lay.collapsed)).toEqual(['tw-context'])
  })
  it('lets a stronger layer win per field', () => {
    const net = { sections: { 'tw-fav': Section.Hidden }, order: [] }
    const mine = { sections: { 'tw-fav': Section.Simple }, order: [] }
    expect(mergePlacements([net, mine]).sections['tw-fav']).toBe(Section.Simple)
    expect(mergePlacements([net]).sections['tw-fav']).toBe(Section.Hidden)
  })
  it('relabels context while not met yet', () => {
    const f = PERSON_FIELDS.find((x) => x.id === 'tw-context')!
    expect(labelOf(f, { 'tw-ring': 'intending' })).toBe('Intending to connect')
    expect(labelOf(f, { 'tw-ring': 'friend' })).toBe('Met in which context')
  })
})

describe('person view values', () => {
  it('derives first and last name from the name until typed', () => {
    expect(splitName('Anna Maria Beispiel')).toEqual({ first: 'Anna Maria', last: 'Beispiel' })
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: '' })
    const v = entityValues({ name: 'Anna Beispiel', context: 'Graz' }, { [LAST_NAME_KEY]: 'Muster' }, undefined)
    expect(v['tw-first']).toBe('Anna')
    expect(v[LAST_NAME_KEY]).toBe('Muster')
  })
  it('lays edits over name, context and ring', () => {
    const p = { name: 'Anna Beispiel', context: '', ring: Ring.Acquaintance }
    expect(effectivePerson(p, { 'tw-ring': 'friend', 'tw-context': 'Café', 'tw-first': 'Anne' })).toMatchObject({ name: 'Anne Beispiel', context: 'Café', ring: 'friend' })
    expect(effectivePerson(p, undefined)).toBe(p)
  })
  it('shows the TrustWeb icon by activity window', () => {
    const now = 100 * 86_400_000
    expect(presence({}, now, 7, now)).toBe(Presence.None)
    expect(presence({ peerId: 'x' }, now - 6 * 86_400_000, 7, now)).toBe(Presence.Active)
    expect(presence({ peerId: 'x' }, now - 8 * 86_400_000, 7, now)).toBe(Presence.Idle)
    expect(presence({ peerId: 'x' }, undefined, 7, now)).toBe(Presence.Idle)
  })
  it('builds the favourite deep link', () => {
    const person = { channels: { [Channel.WhatsApp]: '+436601234567' } }
    expect(favLink(person, { 'tw-fav': 'whatsapp' })?.href).toBe('https://wa.me/436601234567')
    expect(favLink(person, { 'tw-fav': 'email', Bxw7k4FWptqp: [{ label: 'a@b.org' }] })?.href).toBe('mailto:a@b.org')
    expect(favLink({}, { 'tw-fav': 'sms' }, [{ kind: 'phone' as never, value: '+43 660 1' }])?.href).toBe('sms:+436601')
    expect(favLink({}, { 'tw-fav': 'signal' })).toBeNull()
    expect(favLink({}, {})).toBeNull()
  })
})
