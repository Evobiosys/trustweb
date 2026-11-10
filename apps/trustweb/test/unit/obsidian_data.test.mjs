// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { mergeObsidian, parseObsidian } from '../../src/ext/obsidian/obsidian_data.ts'

describe('the extData slice', () => {
  it('keeps the vault name and the sync time, drops everything else and wrong types', () => {
    expect(parseObsidian({ vault: 'Greenhouse', syncedAt: 5, secret: 'x' })).toEqual({ vault: 'Greenhouse', syncedAt: 5 })
    expect(parseObsidian({ vault: 7, syncedAt: 'no' })).toEqual({})
    for (const bad of [null, undefined, 'x', [], 3]) expect(parseObsidian(bad)).toEqual({})
  })
  it('two devices: the newer sync wins the name, the later time is kept', () => {
    expect(mergeObsidian({ vault: 'Old', syncedAt: 1 }, { vault: 'New', syncedAt: 2 })).toEqual({ vault: 'New', syncedAt: 2 })
    expect(mergeObsidian({ vault: 'Mine', syncedAt: 9 }, { vault: 'Theirs', syncedAt: 2 })).toEqual({ vault: 'Mine', syncedAt: 9 })
    expect(mergeObsidian({ vault: 'Mine' }, {})).toEqual({ vault: 'Mine' })
  })
})
