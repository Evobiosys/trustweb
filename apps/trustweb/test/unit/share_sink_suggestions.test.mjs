// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23: suggestions on request, from cross-item patterns, with a credence; who may see credence and why (share_sink/suggestions.ts). */
import { mayExplain, suggestSharing } from '../../src/share_sink/suggestions.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { Zone } from '../../src/share_sink/zones.ts'
import { JSONL, NOW } from '../helpers/share_sink_store.mjs'

const store = parseJsonl(JSONL)

describe('share sink: suggestions', () => {
  it('after a share, suggests the items that share its tags and zones, most credible first, never one already open', () => {
    // eve (friend) was just given seeds (tag:garden); tools carries garden too, plus zone close; ladder is open to her already (community).
    const s = suggestSharing(store, { personId: 'person:eve', itemId: 'item:seeds' }, NOW)
    expect(s.map((x) => [x.itemId, x.credence, x.zone])).toEqual([['item:tools', 0.5, Zone.Close]])
    expect(s[0].why.map((t) => `${t.subject} ${t.relation} ${t.object}`)).toEqual(['tag:garden may_read item:seeds', 'tag:garden may_read item:tools'])
    expect(s[0].personId).toBe('person:eve')
  })
  it('suggests nothing without a shared pattern', () => {
    expect(suggestSharing(store, { personId: 'person:bo', itemId: 'item:recipe' }, NOW)).toEqual([])
  })
  it('credence and why: the owner always; the person it is about only from one zone closer than the zone it grants; nobody else', () => {
    const s = { personId: 'person:ada', itemId: 'item:x', credence: 0.5, zone: Zone.Community, why: [] }
    expect(mayExplain(store, s, 'person:owner', 'person:owner', NOW)).toBe(true)
    expect(mayExplain(store, s, 'person:ada', 'person:owner', NOW)).toBe(true)
    expect(mayExplain(store, { ...s, zone: Zone.Close }, 'person:ada', 'person:owner', NOW)).toBe(false)
    expect(mayExplain(store, { ...s, zone: Zone.Friend }, 'person:ada', 'person:owner', NOW)).toBe(true)
    expect(mayExplain(store, { ...s, personId: 'person:bo' }, 'person:bo', 'person:owner', NOW)).toBe(false)
    expect(mayExplain(store, s, 'person:eve', 'person:owner', NOW)).toBe(false)
  })
})
