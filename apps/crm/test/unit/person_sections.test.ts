// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 25: a person's notes list shows the newest note on top (person_sections.ts).
import { describe, expect, it } from 'vitest'
import { newestFirst } from '../../src/person_sections'

describe('newestFirst', () => {
  it('sorts by notedAt descending without touching the input', () => {
    const lines = [{ id: 'a', notedAt: 1 }, { id: 'c', notedAt: 3 }, { id: 'b', notedAt: 2 }]
    expect(newestFirst(lines).map((l) => l.id)).toEqual(['c', 'b', 'a'])
    expect(lines.map((l) => l.id)).toEqual(['a', 'c', 'b'])
  })
})
