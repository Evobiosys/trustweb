// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 22 small-wording: "See TrustWeb in action", and the lock / "(primary)" on username rows. */
import { readFileSync } from 'node:fs'
import { S } from '../../src/strings.ts'

const src = (f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8')

describe('See TrustWeb in action', () => {
  it('the button string says it', () => {
    expect(S.seeInAction).toBe('See TrustWeb in action')
  })
  it('no source still says "See it in action" (solo.ts, walkthrough.ts, strings.ts)', () => {
    for (const f of ['solo.ts', 'strings.ts']) expect(src(f)).not.toMatch(/See it in action['<]|See it in action:/)
    expect(src('walkthrough.ts')).not.toMatch(/aria-label', 'See it in action/)
    expect(src('solo.ts')).toContain('<b>See TrustWeb in action</b>')
    expect(S.startSoloSub).toMatch(/see TrustWeb in action\.$/)
  })
})

describe('username rows', () => {
  it('the lock is a button that explains itself; the primary row carries "(primary)"', () => {
    const v = src('sync_view.ts')
    expect(v).toMatch(/'data-un-lock': name, title: S\.unLockedWhy, 'aria-label': S\.unLockedWhy, onclick: \(\) => h\.toast\(S\.unLockedWhy\)/)
    expect(v).toContain('S.unPrimaryHint')
    expect(S.unLockedWhy).toBe('Locked: this name was granted by the operator. The app can neither release nor replace it.')
    expect(S.unPrimaryHint).toBe('(primary)')
  })
})
