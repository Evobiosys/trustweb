// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** review-fixes-43c: unit proofs of the fixes of the wave-43c review (DEVLOG/wave43/review-fixes-43c_result-report.txt). */
import { describe, expect, it } from 'vitest'
import { layoutShareAllowed } from '../../src/ext/community-mighty/community_server.ts'

describe('F: trusted-only closes the dashboard aggregate server path too', () => {
  it('needs the per-community opt-in AND servers allowed', () => {
    expect(layoutShareAllowed({}, true)).toBe(true)
    expect(layoutShareAllowed({}, false)).toBe(false)
    expect(layoutShareAllowed({ trustedOnly: true }, true)).toBe(false)
  })
})
