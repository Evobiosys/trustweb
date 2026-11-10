// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { NETWORKS } from '../../src/selectors'

describe('selector table', () => {
  it('has the four networks, each with composer and submit selectors', () => {
    expect(Object.keys(NETWORKS).sort()).toEqual(['facebook', 'linkedin', 'mastodon', 'x'])
    for (const n of Object.values(NETWORKS)) {
      expect(n.composer.length).toBeGreaterThan(0)
      expect(n.submit.length).toBeGreaterThan(0)
    }
  })
  it('every selector is a non-empty string', () => {
    for (const n of Object.values(NETWORKS)) for (const s of [...n.composer, ...n.submit]) expect(s.trim()).not.toBe('')
  })
})
