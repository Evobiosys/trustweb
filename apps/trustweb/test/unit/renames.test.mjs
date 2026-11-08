// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 renames: the view names, the Web tab press that leaves a card page, the browser-only notice. */
import { S } from '../../src/strings.ts'
import { webTabAction } from '../../src/page_stack.ts'
import { shouldShowBrowserOnly, BROWSER_ONLY_AFTER_MS } from '../../src/browser_only_notice.ts'

describe('view names', () => {
  it('Complete is called Table, People is called Simple list; keys stay', () => {
    expect(S.viewNames.complete).toBe('Table')
    expect(S.viewNames.people).toBe('Simple list')
    expect(S.peopleTitle).toBe('Simple list')
  })
  it('the "All people as a table" button string is gone', () => {
    expect('completeOpen' in S).toBe(false)
  })
})

describe('webTabAction', () => {
  it('a card page open: the Web press leaves it', () => {
    expect(webTabAction({ kind: 'card', id: 'p1' })).toBe('leave-page')
    expect(webTabAction({ kind: 'more', ring: 'close' })).toBe('leave-page')
  })
  it('no page open: the normal tab press', () => {
    expect(webTabAction(null)).toBe('tab')
  })
})

describe('shouldShowBrowserOnly', () => {
  const base = { dismissed: false, demo: false, openedAt: 1000, wasHidden: false }
  it('not in the first minutes of a visit', () => {
    expect(shouldShowBrowserOnly(base, 1000 + BROWSER_ONLY_AFTER_MS - 1)).toBe(false)
  })
  it('after five minutes of use', () => {
    expect(shouldShowBrowserOnly(base, 1000 + BROWSER_ONLY_AFTER_MS)).toBe(true)
  })
  it('on return after the page was hidden, even early', () => {
    expect(shouldShowBrowserOnly({ ...base, wasHidden: true }, 1500)).toBe(true)
  })
  it('never once dismissed, never in the demo', () => {
    expect(shouldShowBrowserOnly({ ...base, wasHidden: true, dismissed: true }, 1e9)).toBe(false)
    expect(shouldShowBrowserOnly({ ...base, wasHidden: true, demo: true }, 1e9)).toBe(false)
  })
})
