// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 B11: a zone proposal names its zone once (the dropdown), not again in the text line. */
import { metaLead } from '../../src/curate_meta.ts'

describe('curate row meta line', () => {
  it('with history: score first, no zone name', () => expect(metaLead(true, 'Score 0.4')).toBe('Score 0.4 · '))
  it('without history: nothing before the note, no zone name', () => expect(metaLead(false, 'Score 0.4')).toBe(''))
  it('never carries a ring label', () => {
    for (const h of [true, false]) expect(metaLead(h, 'x')).not.toMatch(/Acquaintance|Friend|Close/)
  })
})
