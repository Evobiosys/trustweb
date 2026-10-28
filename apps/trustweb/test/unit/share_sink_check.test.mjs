// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: canAccess decides by individual grant, tag, or zone, and says why (share_sink/check.ts). */
import { canAccess } from '../../src/share_sink/check.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { ALL_ZONES, Zone } from '../../src/share_sink/zones.ts'
import { JSONL, NOW } from '../helpers/share_sink_store.mjs'

const store = parseJsonl(JSONL)
const why = (r) => r.why.map((t) => `${t.subject} ${t.relation} ${t.object}`)

describe('share sink: canAccess', () => {
  it('a zone at least as intimate as the item\'s zone opens it; the most intimate zone counts', () => {
    const r = canAccess(store, 'person:ada', 'item:bike', NOW)
    expect(r.allowed).toBe(true)
    expect(why(r)).toEqual(['person:ada in_zone zone:close', 'zone:friend may_read item:bike'])
    expect(canAccess(store, 'person:eve', 'item:bike', NOW).allowed).toBe(true)
    expect(canAccess(store, 'person:eve', 'item:tools', NOW)).toEqual({ allowed: false, why: [] })
  })
  it('a tag the person carries and the item carries opens it', () => {
    expect(canAccess(store, 'person:bo', 'item:bike', NOW)).toEqual({ allowed: false, why: [] })
    expect(why(canAccess(store, 'person:bo', 'item:seeds', NOW))).toEqual(['person:bo has_tag tag:garden', 'tag:garden may_read item:seeds'])
  })
  it('an individual grant opens it', () => {
    expect(why(canAccess(store, 'person:cy', 'item:bike', NOW))).toEqual(['person:cy may_read item:bike'])
  })
  it('a public item is open to anyone, a person the store has never heard of too', () => {
    expect(why(canAccess(store, 'person:nobody', 'item:recipe', NOW))).toEqual(['zone:public may_read item:recipe'])
    expect(canAccess(store, 'person:nobody', 'item:ladder', NOW).allowed).toBe(false)
  })
  it('lists every path that opens it', () => {
    expect(why(canAccess(store, 'person:ada', 'item:tools', NOW))).toEqual(['person:ada in_zone zone:close', 'zone:close may_read item:tools'])
    const both = [...store, { subject: 'person:bo', relation: 'may_read', object: 'item:seeds', since: '2026-02-01T00:00:00.000Z', by: 'device:laptop' }]
    expect(why(canAccess(both, 'person:bo', 'item:seeds', NOW))).toEqual(['person:bo may_read item:seeds', 'person:bo has_tag tag:garden', 'tag:garden may_read item:seeds'])
  })
  it('honours rings switched off: on the person\'s side and on the item\'s (an item in an off ring moves one ring in)', () => {
    const noClose = ALL_ZONES.filter((z) => z !== Zone.Close)
    expect(canAccess(store, 'person:ada', 'item:bike', NOW, noClose).allowed).toBe(false)
    expect(why(canAccess(store, 'person:ada', 'item:ladder', NOW, noClose))).toEqual(['person:ada in_zone zone:community', 'zone:community may_read item:ladder'])
    const noFriend = ALL_ZONES.filter((z) => z !== Zone.Friend)
    expect(canAccess(store, 'person:ada', 'item:bike', NOW, noFriend).allowed).toBe(true)
    expect(canAccess(store, 'person:eve', 'item:bike', NOW, noFriend).allowed).toBe(false)
  })
  it('ignores a tuple that is not live yet or any more', () => {
    const later = [{ subject: 'person:dee', relation: 'may_read', object: 'item:bike', since: '2027-01-01T00:00:00.000Z', by: 'd' }]
    const gone = [{ subject: 'person:dee', relation: 'may_read', object: 'item:bike', since: '2025-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z', by: 'd' }]
    expect(canAccess(later, 'person:dee', 'item:bike', NOW).allowed).toBe(false)
    expect(canAccess(gone, 'person:dee', 'item:bike', NOW).allowed).toBe(false)
  })
})
