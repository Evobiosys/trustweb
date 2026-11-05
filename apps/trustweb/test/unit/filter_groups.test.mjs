// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: the Web sidebar's filter groups (TrustZones fold, default open) and the plain two-state "connected" checkbox. */
import { describe, expect, it } from 'vitest'
import { S } from '../../src/strings.ts'
import { connectionsOn, groupOpen, setGroupOpen } from '../../src/filter_groups.ts'

describe('filter groups', () => {
  it('a group is open by default and a fold saves in uiRings', () => {
    const s = {}
    expect(groupOpen(s, 'trustzones')).toBe(true)
    setGroupOpen(s, 'trustzones', false)
    expect(groupOpen(s, 'trustzones')).toBe(false)
    setGroupOpen(s, 'trustzones', true)
    expect(groupOpen(s, 'trustzones')).toBe(true)
  })
  it('connections is two-state: only true is checked; legacy third states count as unchecked', () => {
    expect(connectionsOn({})).toBe(false)
    expect(connectionsOn({ uiRings: { connections: true } })).toBe(true)
    expect(connectionsOn({ uiRings: { connections: false } })).toBe(false)
    for (const legacy of ['mixed', 'indeterminate', null, 2, 'some']) expect(connectionsOn({ uiRings: { connections: legacy } })).toBe(false)
  })
  it('strings: group heading TrustZones, tag heading Tags', () => {
    expect(S.filterGroupTrustZones).toBe('TrustZones')
    expect(S.filterTagsTitle).toBe('Tags')
  })
})
