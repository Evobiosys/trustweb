// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { HELP_MAIL } from '../../src/help_mail'

describe('help mail link', () => {
  it('is a mailto to connect@japossert.com with only the subject', () => {
    expect(HELP_MAIL).toBe('mailto:connect@japossert.com?subject=TrustWeb%20help')
  })
  it('carries no body', () => {
    expect(HELP_MAIL).not.toMatch(/body=/i)
  })
})
