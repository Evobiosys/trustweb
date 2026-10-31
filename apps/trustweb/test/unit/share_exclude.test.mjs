// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: exclusions beat zones and tags (D3). An exclusion is a tuple subject(person|tag) excludes item. */
import { canAccess } from '../../src/share_sink/check.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { NOW } from '../helpers/share_sink_store.mjs'

const row = (s, r, o, until) => JSON.stringify({ subject: s, relation: r, object: o, since: '2026-01-01T00:00:00.000Z', ...(until && { until }), by: 'device:laptop' })
const store = (...rows) => parseJsonl(rows.join('\n'))
const why = (r) => r.why.map((t) => `${t.subject} ${t.relation} ${t.object}`)

describe('exclusion beats zone (T1)', () => {
  const base = [row('zone:friend', 'may_read', 'item:x'), row('person:ada', 'in_zone', 'zone:friend')]
  it('a friend sees the item until the item excludes them', () => {
    expect(canAccess(store(...base), 'person:ada', 'item:x', NOW).allowed).toBe(true)
    const r = canAccess(store(...base, row('person:ada', 'excludes', 'item:x')), 'person:ada', 'item:x', NOW)
    expect(r.allowed).toBe(false)
    expect(why(r)).toEqual(['person:ada excludes item:x'])
  })
  it('an exclusion of one person leaves the others in the zone', () => {
    const s = store(...base, row('person:ada', 'excludes', 'item:x'), row('person:bo', 'in_zone', 'zone:friend'))
    expect(canAccess(s, 'person:bo', 'item:x', NOW).allowed).toBe(true)
  })
  it('an exclusion beats an individual grant too', () => {
    const s = store(row('person:cy', 'may_read', 'item:x'), row('person:cy', 'excludes', 'item:x'))
    expect(canAccess(s, 'person:cy', 'item:x', NOW).allowed).toBe(false)
  })
  it('an exclusion past its until no longer counts (I9: expires)', () => {
    const s = store(...base, row('person:ada', 'excludes', 'item:x', '2025-06-01T00:00:00.000Z'))
    expect(canAccess(s, 'person:ada', 'item:x', NOW).allowed).toBe(true)
  })
})
