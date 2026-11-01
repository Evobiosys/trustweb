// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** A12 (Jakob 2026-10-30): the person page types Signal / WhatsApp links into the record and hands them to the host. */
import { describe, expect, it } from 'vitest'
import { saveLink } from '../../src/connect_links'

const files = import.meta.glob(['../../src/*.svelte'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('saveLink', () => {
  it('sets a link on the person and tells the host', () => {
    const people = [{ id: 'a' }] as never[]
    const seen: unknown[] = []
    expect(saveLink(people, { setLinks: (id, l) => seen.push([id, l]) }, 'a', 'signal', ' https://signal.me/#p/x ')).toBe(true)
    expect(seen).toEqual([['a', { signal: 'https://signal.me/#p/x' }]])
  })
  it('refuses a non-web link and an unknown person, host untouched', () => {
    const seen: unknown[] = []
    const host = { setLinks: (id: string, l: unknown) => seen.push([id, l]) }
    expect(saveLink([{ id: 'a' }] as never[], host, 'a', 'signal', 'nope')).toBe(false)
    expect(saveLink([], host, 'zz', 'signal', 'https://x.y')).toBe(false)
    expect(seen).toEqual([])
  })
  it('clearing the last link tells the host undefined', () => {
    const seen: unknown[] = []
    const people = [{ id: 'a', links: { whatsapp: 'https://wa.me/1' } }] as never[]
    expect(saveLink(people, { setLinks: (_i, l) => seen.push(l) }, 'a', 'whatsapp', '')).toBe(true)
    expect(seen).toEqual([undefined])
  })
})

describe('the person page', () => {
  it('shows the connect panel on the full page only', () => {
    expect(files['../../src/person.svelte']).toMatch(/\{#if !embedded\}<ConnectPanel/)
  })
})
