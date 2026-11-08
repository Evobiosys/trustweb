// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The one help link (wave 24b): a mailto with only the subject, shared by the app and the Desk. */
import { readFileSync } from 'node:fs'
import { HELP_MAIL } from '../../src/help_mail.ts'
import { AboutPage, aboutUrl } from '../../src/about.ts'
import { S } from '../../src/strings.ts'

describe('HELP_MAIL', () => {
  it('is a mailto to connect@evobiosys.org with only the subject', () => {
    expect(HELP_MAIL).toBe('mailto:connect@evobiosys.org?subject=TrustWeb%20help')
  })
  it('is what About > Feedback opens', () => {
    expect(aboutUrl(AboutPage.Feedback)).toBe(HELP_MAIL)
  })
  it('no user-facing string names idea2.site; the chat list offers New message', () => {
    expect(readFileSync(new URL('../../src/strings.ts', import.meta.url), 'utf8')).not.toMatch(/idea2/)
    expect(S.chatNew).toBe('New message')
  })
})

describe('contact address (wave 37)', () => {
  it('is connect@evobiosys.org', async () => {
    const { HELP_MAIL } = await import('../../src/help_mail.ts')
    expect(HELP_MAIL.startsWith('mailto:connect@evobiosys.org?')).toBe(true)
  })
})
