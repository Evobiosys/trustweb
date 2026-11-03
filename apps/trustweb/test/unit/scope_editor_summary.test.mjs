// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** E3 profile sections: the "Who sees this" line, the chip labels and the "as seen by" viewer keys (scope_summary.ts). Invented names. */
import { chipLabel, scopeSummary, VIEWER_ZONES, viewerKey, viewerOf } from '../../src/scope_summary.ts'

const words = { zone: (z) => ({ friend: 'Friends and closer', self: 'Only me' })[z] ?? z, also: 'also', except: 'except' }
const mark = (l) => `${l} (event)`
const names = { 'person:ada': 'Ada Probe', 'tag:garden': 'garden', 'event:e1': 'Forum Probe' }
const label = (id) => chipLabel(id, names[id] ?? id, mark)

describe('chipLabel', () => {
  it('people get @, tags #, events the event mark', () => {
    expect(label('person:ada')).toBe('@Ada Probe')
    expect(label('tag:garden')).toBe('#garden')
    expect(label('event:e1')).toBe('Forum Probe (event)')
  })
})

describe('scopeSummary', () => {
  it('the zone alone when nothing is added or excluded', () => {
    expect(scopeSummary({ zone: 'friend', include: [], exclude: [] }, label, words)).toBe('Friends and closer')
  })
  it('zone, then also, then except, joined with a middle dot', () => {
    expect(scopeSummary({ zone: 'friend', include: ['tag:garden', 'event:e1'], exclude: ['person:ada'] }, label, words))
      .toBe('Friends and closer · also #garden, Forum Probe (event) · except @Ada Probe')
  })
  it('Only me plus one event', () => {
    expect(scopeSummary({ zone: 'self', include: ['event:e1'], exclude: [] }, label, words)).toBe('Only me · also Forum Probe (event)')
  })
})

describe('viewer keys', () => {
  it('lists the five zones from the most intimate out', () => {
    expect([...VIEWER_ZONES]).toEqual(['close', 'friend', 'acquaintance', 'intending', 'public'])
  })
  it('round-trips every viewer kind', () => {
    for (const v of [{ kind: 'zone', zone: 'friend' }, { kind: 'tag', id: 'garden' }, { kind: 'event', id: 'e1' }, { kind: 'person', id: 'ada' }]) {
      expect(viewerOf(viewerKey(v))).toEqual(v)
    }
  })
  it('refuses anything else', () => {
    for (const k of ['', 'zone:nobody', 'zone:self', 'person:', 'item:x', 'garden']) expect(viewerOf(k)).toBe(null)
  })
  it('an id may hold a colon', () => {
    expect(viewerOf('tag:a:b')).toEqual({ kind: 'tag', id: 'a:b' })
  })
})
