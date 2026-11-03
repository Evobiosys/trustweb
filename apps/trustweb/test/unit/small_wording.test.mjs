// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 22 small-wording: "See TrustWeb in action", and the lock / "(primary)" on username rows. */
import { readFileSync } from 'node:fs'
import { S } from '../../src/strings.ts'
import { demoUrl } from '../../src/page_foot.ts'

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
    expect(v).toMatch(/'data-un-lock': name, 'aria-label': S\.unLockedWhy/)
    expect(v).toContain("'data-un-lock-why': name")
    expect(v).toContain('onpointerenter')
    expect(v).not.toContain('h.toast(S.unLockedWhy)')
    expect(v).toContain('S.unPrimaryHint')
    expect(S.unLockedWhy).toBe('Locked: this name was granted by the operator. The app can neither release nor replace it.')
    expect(S.unPrimaryHint).toBe('(primary)')
  })
})

describe('connect and share page foot', () => {
  it('links "See TrustWeb in action" to the demo build, from both pages', () => {
    expect(demoUrl('https://x.test/app/')).toBe('https://x.test/app/demo/')
    expect(S.seeInAction).toBe('See TrustWeb in action')
    expect(src('share_page_view.ts')).toContain('seeInActionFoot()')
    expect(src('main.ts')).toContain('seeInActionFoot(),')
  })
})
