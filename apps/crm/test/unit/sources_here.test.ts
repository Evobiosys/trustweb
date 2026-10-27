// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { canRunSource, isPhone } from '../../src/sources_here'

describe('canRunSource', () => {
  it('runs every source on a computer', () => {
    for (const p of ['tana', 'apple-notes', 'obsidian-logseq']) expect(canRunSource(p, { phone: false })).toBe('here')
  })
  it('puts every source elsewhere on a phone', () => {
    for (const p of ['tana', 'apple-notes', 'obsidian-logseq']) expect(canRunSource(p, { phone: true })).toBe('elsewhere')
  })
})

describe('isPhone', () => {
  it('reads a coarse pointer or a narrow window', () => {
    expect(isPhone({ coarse: true, width: 1200 })).toBe(true)
    expect(isPhone({ coarse: false, width: 390 })).toBe(true)
    expect(isPhone({ coarse: false, width: 1440 })).toBe(false)
  })
})
