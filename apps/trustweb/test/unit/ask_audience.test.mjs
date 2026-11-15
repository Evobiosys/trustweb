// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter: the stored ask audience (AppState.askAudience + askReach) and who the hints and intro asks reach. */
import { allowedPeerIds, askFilterOf, saveAskFilter } from '../../src/ask_audience.ts'
import { Ring } from '../../src/model.ts'

const p = (id, ring, extra = {}) => ({ id, name: id, ring, peerId: 'peer-' + id, fields: {}, ...extra })
const base = () => ({ people: [p('a', Ring.Closest), p('b', Ring.Close), p('c', Ring.Friend), p('d', Ring.Acquaintance, { fields: { yoga: 'true' } })], peers: [] })
const tags = [{ id: 'yoga', colour: '#112233', label: 'yoga' }]

describe('ask audience of the hints and intro asks', () => {
  it('nothing stored = the filter is off: everybody is asked (null)', () => {
    const s = base()
    expect(askFilterOf(s)).toEqual({ zone: undefined, add: [], exclude: [], degree: 1 })
    expect(allowedPeerIds(s, tags)).toBeNull()
  })
  it('a zone, adds and excludes decide the peers; the degree is the stored reach', () => {
    const s = { ...base(), askReach: 2, askAudience: { zone: 'close', add: ['tag:yoga'], exclude: ['person:a'] } }
    expect(askFilterOf(s).degree).toBe(2)
    expect(allowedPeerIds(s, tags)).toEqual(['peer-b', 'peer-d'])
  })
  it('exclude alone leaves everybody else in', () => {
    expect(allowedPeerIds({ ...base(), askAudience: { add: [], exclude: ['person:c'] } }, tags)).toEqual(['peer-a', 'peer-b', 'peer-d'])
  })
  it('a broken stored value reads as the off filter; saving writes only what is set', () => {
    expect(askFilterOf({ ...base(), askAudience: { zone: 'wide' } }).zone).toBeUndefined()
    const s = base()
    saveAskFilter(s, { zone: 'friend', add: ['person:b'], exclude: [], degree: 1 })
    expect(s.askAudience).toEqual({ zone: 'friend', add: ['person:b'], exclude: [] })
    saveAskFilter(s, { zone: undefined, add: [], exclude: [], degree: 1 })
    expect(s.askAudience).toBeUndefined()
  })
})
