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

import { clearObsidianData, obsidianDbName, PREF_KEYS } from '../../src/ext/obsidian/obsidian_data.ts'

describe('B17 merge ties are deterministic and commutative', () => {
  it('equal sync time, different vault: both devices pick the same one', () => {
    const a = { vault: 'Alpha', syncedAt: 5 }
    const b = { vault: 'Beta', syncedAt: 5 }
    expect(mergeObsidian(a, b)).toEqual(mergeObsidian(b, a))
    expect(mergeObsidian(a, b).vault).toBe('Beta')
  })
})

describe('B15 a forgotten vault stays forgotten across the device sync', () => {
  it('the tombstone beats an older vault from the other device', () => {
    const r = mergeObsidian({ forgotAt: 10 }, { vault: 'Old', syncedAt: 4 })
    expect(r).toEqual({ forgotAt: 10 })
    expect(mergeObsidian({ vault: 'Old', syncedAt: 4 }, { forgotAt: 10 })).toEqual({ forgotAt: 10 })
  })
  it('a sync after the Forget wins and keeps the tombstone time', () => {
    expect(mergeObsidian({ forgotAt: 10 }, { vault: 'New', syncedAt: 12 })).toEqual({ vault: 'New', syncedAt: 12, forgotAt: 10 })
  })
  it('parseObsidian keeps forgotAt', () => {
    expect(parseObsidian({ forgotAt: 3, junk: 1 })).toEqual({ forgotAt: 3 })
  })
})

describe('B1 Reset this phone clears what the module remembers', () => {
  const fakeIdb = () => {
    const deleted = []
    return { deleted, idb: { deleteDatabase: (name) => { deleted.push(name); const r = {}; setTimeout(() => r.onsuccess?.(), 0); return r } } }
  }
  const fakeStorage = (init) => {
    const m = new Map(Object.entries(init))
    return { m, storage: { removeItem: (k) => { m.delete(k) }, getItem: (k) => m.get(k) ?? null } }
  }
  it('deletes the per-record database and every module preference key', async () => {
    const { deleted, idb } = fakeIdb()
    const { m, storage } = fakeStorage(Object.fromEntries(PREF_KEYS.map((k) => [k, '1']).concat([['other', 'keep']])))
    await clearObsidianData('me42', idb, storage)
    expect(deleted).toEqual([obsidianDbName('me42')])
    expect(obsidianDbName('me42')).toBe('trustweb-obsidian.me42')
    expect([...m.keys()]).toEqual(['other'])
  })
  it('settles when IndexedDB never answers (blocked) and without IndexedDB', async () => {
    const hang = { deleteDatabase: () => ({}) }
    await clearObsidianData('me42', hang, { removeItem: () => undefined }, 20)
    await clearObsidianData('me42', undefined, { removeItem: () => undefined })
  })
})

// Wave 42 (F05): the suggestions the owner has not decided on yet ride the slice so every device (and the MCP server) sees the same list.
describe('suggestions in the slice', () => {
  const s1 = { path: 'Daily/a.md', name: 'Leonie', confidence: 0.8, why: 'Coffee with Leonie' }
  it('kept with their time; malformed entries and extra keys are dropped; capped', () => {
    expect(parseObsidian({ suggestions: [s1, { path: 'x' }, 'junk', { ...s1, secret: 1 }], suggestedAt: 7 })).toEqual({ suggestions: [s1, s1], suggestedAt: 7 })
    expect(parseObsidian({ suggestions: 'no' })).toEqual({})
    expect(parseObsidian({ suggestions: Array.from({ length: 500 }, () => s1) }).suggestions).toHaveLength(200)
  })
  it('the list with the later time wins (an empty list written later empties it everywhere), the vault merge is unchanged', () => {
    expect(mergeObsidian({ vault: 'V', syncedAt: 5, suggestions: [s1], suggestedAt: 6 }, { vault: 'V', syncedAt: 5, suggestions: [], suggestedAt: 9 })).toEqual({ vault: 'V', syncedAt: 5, suggestions: [], suggestedAt: 9 })
    const a = { suggestions: [s1], suggestedAt: 3 }
    const b = { suggestions: [{ ...s1, name: 'Other' }], suggestedAt: 3 }
    expect(mergeObsidian(a, b)).toEqual(mergeObsidian(b, a))
  })
  it('Forget this vault takes the suggestions with it', () => {
    expect(mergeObsidian({ forgotAt: 10 }, { vault: 'Old', syncedAt: 4, suggestions: [s1], suggestedAt: 4 })).toEqual({ forgotAt: 10 })
  })
})
