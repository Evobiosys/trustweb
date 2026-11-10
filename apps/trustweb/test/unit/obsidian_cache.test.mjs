// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { openVaultStore } from '../../src/ext/obsidian/obsidian_cache.ts'

describe('B16 one database connection per record, closed when another tab upgrades', () => {
  let opens
  let reqs
  beforeEach(() => { opens = []; reqs = []; globalThis.indexedDB = { open: (name) => { opens.push(name); const r = {}; reqs.push(r); return r } } })
  afterEach(() => { delete globalThis.indexedDB })
  it('the same record gets the same store and one open call', () => {
    expect(openVaultStore('a')).toBe(openVaultStore('a'))
    expect(openVaultStore('b')).not.toBe(openVaultStore('a'))
    expect(opens).toEqual(['trustweb-obsidian.a', 'trustweb-obsidian.b'])
  })
  it('onversionchange closes the connection and the next call opens a fresh one', () => {
    const first = openVaultStore('v')
    let closed = 0
    const db = { close: () => { closed++ } }
    reqs[0].result = db
    reqs[0].onsuccess()
    db.onversionchange()
    expect(closed).toBe(1)
    expect(openVaultStore('v')).not.toBe(first)
    expect(opens).toHaveLength(2)
  })
})
