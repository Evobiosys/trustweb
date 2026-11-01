// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: a share line becomes scope tuples; the preview and enforcement use the same check (S4, S5, T12). */
import { scopeTuples, previewShare, appendShare, oneOffVisible } from '../../src/share_sink/share_lines.ts'
import { canAccess } from '../../src/share_sink/check.ts'
import { parseJsonl } from '../../src/share_sink/tuples.ts'
import { NOW } from '../helpers/share_sink_store.mjs'

const WHEN = new Date(NOW)
const base = parseJsonl([
  '{"subject":"person:ada","relation":"in_zone","object":"zone:friend","since":"2026-01-01T00:00:00.000Z","by":"device:laptop"}',
  '{"subject":"person:bo","relation":"in_zone","object":"zone:acquaintance","since":"2026-01-01T00:00:00.000Z","by":"device:laptop"}',
  '{"subject":"person:bo","relation":"has_tag","object":"tag:garden","since":"2026-01-01T00:00:00.000Z","by":"device:laptop"}',
].join('\n'))
const scope = { zone: 'friend', include: ['tag:garden'], exclude: ['person:ada'] }

describe('scope to tuples (S2)', () => {
  it('the zone, the inclusions and the exclusions become tuples about the item, with a one-year until', () => {
    const t = scopeTuples(scope, 'item:bike', 'device:laptop', WHEN)
    expect(t.map((x) => `${x.subject} ${x.relation} ${x.object}`)).toEqual([
      'zone:friend may_read item:bike', 'tag:garden may_read item:bike', 'person:ada excludes item:bike',
    ])
    expect(t[0].until).toBe(new Date(+WHEN + 365 * 86_400_000).toISOString())
  })
})

describe('preview equals enforcement (T12)', () => {
  it('the preview lists exactly the people canAccess lets in, and not the excluded one', () => {
    const p = previewShare(base, scope, ['person:ada', 'person:bo', 'person:cy'], 'item:bike', WHEN)
    const augmented = [...base, ...scopeTuples(scope, 'item:bike', 'device:laptop', WHEN)]
    const enforced = ['person:ada', 'person:bo', 'person:cy'].filter((id) => canAccess(augmented, id, 'item:bike', WHEN).allowed)
    expect(p.names).toEqual(enforced)
    expect(p.count).toBe(enforced.length)
    expect(p.names).toEqual(['person:bo'])
  })
})

describe('share line (S5) and the one-off cutoff', () => {
  it('appendShare numbers the line and cutoffs at the head seq', () => {
    const lines = appendShare([], { id: 'shr:1', scope, to: 'person:bo', ts: WHEN.toISOString() })
    expect(lines.length).toBe(1)
    expect(lines[0]).toEqual({ op: 'share', id: 'shr:1', seq: 1, scope, cutoff: 1, to: 'person:bo', terms: 'read-keep', ts: WHEN.toISOString() })
  })
  it('a one-off share shows lines up to its cutoff only, never later ones', () => {
    const share = { op: 'share', id: 'shr:1', seq: 1, scope, cutoff: 5, to: 'person:bo', terms: 'read-keep', ts: WHEN.toISOString() }
    expect(oneOffVisible(share, 5)).toBe(true)
    expect(oneOffVisible(share, 6)).toBe(false)
  })
})
