import { describe, expect, it } from 'vitest'
import { Audience, LineStatus, Provenance, Ring, Tag, threadsForRing } from '../../src/model.ts'
import { hiddenSources, lineShown, onlyFrom, personShown, removeSource, setHiddenSources, setSourceHidden, shown, sourceCount, sourceOfLine, sourceOfPerson } from '../../src/sources.ts'
import { personNotes } from '../../src/person_notes.ts'

const line = (id, text, source) => ({ id, text, tag: Tag.Note, audience: Audience.FriendsOfFriends, status: LineStatus.Current, notedAt: 1000, checkedAt: 1000, ...(source ? { source } : {}) })
const state = () => ({
  v: 1, me: { id: 'me', displayName: 'Me' }, peers: [], inventory: [], log: [], notificationsOn: false, meetings: [],
  people: [
    { id: 'tana-a', name: 'Anna Tana', context: '', ring: Ring.Friend, metAt: 1, lines: [line('tana-a-0', 'Plays chess'), line('tana-a-1', 'Knows a 3D printer', { kind: Provenance.Local, path: 'j.md' })], fields: {} },
    { id: 'tana-b', name: 'Ben Tana', context: '', ring: Ring.Close, metAt: 1, lines: [line('tana-b-0', 'Has a ladder', { kind: Provenance.Tana, ref: 'x' })], fields: {} },
    { id: 'local-c', name: 'Cara Notes', context: '', ring: Ring.Unsorted, metAt: 1, lines: [line('local-c-0', 'Runs a repair café', { kind: Provenance.Local, path: 'p.md' })] },
    { id: 'd', name: 'Dora Typed', context: '', ring: Ring.Friend, metAt: 1, lines: [line('d-0', 'Typed by hand', { kind: Provenance.Typed }), { ...line('d-1', 'Old Tana line without source'), tanaId: 'n9' }] },
  ],
})

describe('which source', () => {
  it('a person belongs to the source that made its id; a line to its provenance, or Tana by tanaId', () => {
    expect(sourceOfPerson({ id: 'tana-a' })).toBe(Provenance.Tana)
    expect(sourceOfPerson({ id: 'local-c' })).toBe(Provenance.Local)
    expect(sourceOfPerson({ id: 'd' })).toBeNull()
    expect(sourceOfLine({ source: { kind: Provenance.Local } })).toBe(Provenance.Local)
    expect(sourceOfLine({ tanaId: 'n9' })).toBe(Provenance.Tana)
    expect(sourceOfLine({ source: { kind: Provenance.Typed } })).toBeNull()
    expect(sourceOfLine({}, { id: 'tana-a' })).toBe(Provenance.Tana)
    expect(sourceOfLine({ source: { kind: Provenance.Typed } }, { id: 'tana-a' })).toBeNull()
  })
  it('counts persons made by the source and lines it added anywhere', () => {
    expect(sourceCount(state(), Provenance.Tana)).toEqual({ people: 2, lines: 3 })
    expect(sourceCount(state(), Provenance.Local)).toEqual({ people: 1, lines: 2 })
  })
})

describe('hide (a view choice)', () => {
  it('stores only while something is hidden; unknown kinds are ignored', () => {
    const s = state()
    setSourceHidden(s, Provenance.Tana, true)
    expect(s.hiddenSources).toEqual(['tana'])
    setSourceHidden(s, Provenance.Local, true)
    setSourceHidden(s, Provenance.Tana, false)
    expect(s.hiddenSources).toEqual(['local'])
    setSourceHidden(s, Provenance.Local, false)
    expect(s.hiddenSources).toBeUndefined()
    expect(hiddenSources({ hiddenSources: ['demo', 'tana'] })).toEqual(['tana'])
  })
  it('shown(): hidden Tana leaves out persons known only from Tana and Tana lines; a Tana person with a note line stays, without the Tana line', () => {
    const s = state()
    expect(shown(s)).toBe(s)
    setSourceHidden(s, Provenance.Tana, true)
    const v = shown(s)
    expect(v.people.map((p) => p.id)).toEqual(['tana-a', 'local-c', 'd'])
    expect(v.people[0].lines.map((l) => l.text)).toEqual(['Knows a 3D printer'])
    expect(v.people[1]).toBe(s.people[2])
    expect(v.people[2].lines.map((l) => l.text)).toEqual(['Typed by hand'])
    expect(onlyFrom(s.people[0])).toBeNull()
    expect(onlyFrom(s.people[1])).toBe(Provenance.Tana)
    expect(personShown(s, s.people[1])).toBe(false)
    expect(lineShown(s, { tanaId: 'n9' })).toBe(false)
    expect(s.people).toHaveLength(4)
    setHiddenSources(s, ['local', 'demo'])
    expect(s.hiddenSources).toEqual(['local'])
    setHiddenSources(s, [])
    expect(s.hiddenSources).toBeUndefined()
  })
  it('hidden local notes leave Tana persons in place without their note lines; the card lists the same', () => {
    const s = state()
    setSourceHidden(s, Provenance.Local, true)
    const v = shown(s)
    expect(v.people.map((p) => p.id)).toEqual(['tana-a', 'tana-b', 'd'])
    expect(v.people[0].lines.map((l) => l.text)).toEqual(['Plays chess'])
    expect(personNotes(s, 'tana-a', '', () => []).flatMap((d) => d.lines.map((l) => l.text))).toEqual(['Plays chess'])
  })
  it('still answers asks: what an asker is matched against does not change', () => {
    const s = state()
    const before = threadsForRing(s, Ring.Friend)
    setSourceHidden(s, Provenance.Tana, true)
    setSourceHidden(s, Provenance.Local, true)
    const after = threadsForRing(s, Ring.Friend)
    expect(JSON.stringify(after.threads)).toBe(JSON.stringify(before.threads))
    expect(after.refs.size).toBe(before.refs.size)
  })
})

describe('remove (one shot)', () => {
  it('Tana: its persons and lines leave; a Tana person with note lines stays as a person of no source', () => {
    const s = state()
    setSourceHidden(s, Provenance.Tana, true)
    expect(removeSource(s, Provenance.Tana, () => 'fresh1')).toEqual({ people: 2, lines: 3 })
    expect(s.people.map((p) => p.id)).toEqual(['fresh1', 'local-c', 'd'])
    expect(s.people[0].name).toBe('Anna Tana')
    expect(s.people[0].lines.map((l) => l.text)).toEqual(['Knows a 3D printer'])
    expect(s.people[0].fields).toBeUndefined()
    expect(s.people[2].lines.map((l) => l.text)).toEqual(['Typed by hand'])
    expect(s.hiddenSources).toBeUndefined()
    expect(sourceCount(s, Provenance.Tana)).toEqual({ people: 0, lines: 0 })
  })
  it('local notes: only its person and lines leave', () => {
    const s = state()
    expect(removeSource(s, Provenance.Local, () => 'never')).toEqual({ people: 1, lines: 2 })
    expect(s.people.map((p) => p.id)).toEqual(['tana-a', 'tana-b', 'd'])
    expect(s.people[0].lines.map((l) => l.text)).toEqual(['Plays chess'])
  })
})
