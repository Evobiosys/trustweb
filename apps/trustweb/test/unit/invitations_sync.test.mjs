// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: invitations ride the device sync as an optional part; old bundles and old builds are unaffected; an ask never sees them. */
import { bundleOf, mergeBundle, parseBundle, refreshStamps, SYNC_EXCLUDED } from '../../src/sync_core.ts'
import { askSources } from '../../src/cascade.ts'

const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const inv = (id, extra = {}) => ({ id, kind: 'invitation', status: 'open', place: 'Sonoma', ...extra })

describe('invitations in the sync bundle', () => {
  it('are sent only when there are some, and survive parseBundle', () => {
    expect(bundleOf(state(), {}).invitations).toBeUndefined()
    const b = bundleOf(state({ invitations: [inv('a')] }), {})
    expect(parseBundle(JSON.parse(JSON.stringify(b))).invitations).toEqual([inv('a')])
  })
  it('a malformed list makes the bundle nothing; a bundle without the field still parses', () => {
    const ok = JSON.parse(JSON.stringify(bundleOf(state(), {})))
    expect(parseBundle({ ...ok, invitations: [{ nope: 1 }] })).toBeNull()
    expect(parseBundle(ok)).not.toBeNull()
  })
  it('merge brings a new invitation in and keeps mine when the other side has none', () => {
    const mine = state({ invitations: [inv('m')] })
    mergeBundle(mine, refreshStamps(mine, {}, 1, 'T'), bundleOf(state({ invitations: [inv('t', { place: 'Brazil' })] }), refreshStamps(state({ invitations: [inv('t', { place: 'Brazil' })] }), {}, 2, 'U')), 0)
    expect(mine.invitations.map((i) => i.id).sort()).toEqual(['m', 't'])
    mergeBundle(mine, {}, bundleOf(state(), {}), 0)
    expect(mine.invitations).toHaveLength(2)
  })
  it('the field is an entity, not a setting', () => {
    expect(SYNC_EXCLUDED.has('invitations')).toBe(true)
  })
})

describe('an incoming ask', () => {
  it('never sees invitations', () => {
    const s = state({ invitations: [inv('a')], ring: 'friend' })
    expect(JSON.stringify(askSources(s, 'friend', 1))).not.toContain('Sonoma')
  })
})
