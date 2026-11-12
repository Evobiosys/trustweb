// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { confirmHost, hostConfirmed, ingestOptIn, setIngestOptIn } from '../../src/ext/obsidian/obsidian_prefs.ts'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) } } }

describe('B4 the owner confirms each host once, on this device', () => {
  beforeEach(() => { globalThis.localStorage = mem() })
  afterEach(() => { delete globalThis.localStorage })
  it('unknown host: not confirmed; confirmed host stays confirmed; another host is asked again', () => {
    expect(hostConfirmed('localhost:11435')).toBe(false)
    confirmHost('localhost:11435')
    expect(hostConfirmed('localhost:11435')).toBe(true)
    expect(hostConfirmed('llm.example.org')).toBe(false)
    confirmHost('llm.example.org')
    expect(hostConfirmed('localhost:11435')).toBe(true)
  })
  it('the host is compared whole, case-insensitively', () => {
    confirmHost('LLM.example.org')
    expect(hostConfirmed('llm.example.org')).toBe(true)
    expect(hostConfirmed('llm.example.org:8080')).toBe(false)
  })
  it('without usable storage nothing counts as confirmed (fails closed)', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => undefined }
    confirmHost('a.example.org')
    expect(hostConfirmed('a.example.org')).toBe(false)
  })
  it('the ingest opt-in still round-trips', () => {
    expect(ingestOptIn()).toBe(false)
    setIngestOptIn(true)
    expect(ingestOptIn()).toBe(true)
    setIngestOptIn(false)
    expect(ingestOptIn()).toBe(false)
  })
})
