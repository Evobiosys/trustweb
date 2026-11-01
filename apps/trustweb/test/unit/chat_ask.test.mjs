// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 26 A8: the Chat screen carries the same Ask button (queryFab) as the Web screen.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const main = readFileSync(path.join(import.meta.dirname, '../../src/main.ts'), 'utf8')

describe('chat ask button', () => {
  it('screenChat returns queryFab()', () => {
    const body = main.slice(main.indexOf('function screenChat()'), main.indexOf('function chatNewSheet()'))
    expect(body).toMatch(/queryFab\(\)/)
  })
})
