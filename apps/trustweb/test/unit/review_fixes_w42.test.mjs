// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** @vitest-environment jsdom
 * Review wave 42: one "No match found" helper (empty_state.ts noMatchLine) on every search surface. */
import { meetingSearchPanel } from '../../src/meeting_search_view.ts'
import { S } from '../../src/strings.ts'

describe('B08: past-meeting search uses the shared no-match line', () => {
  it('a query without hits shows [data-no-match] with S.noMatch', () => {
    const m = { id: 'm1', about: 'Coffee', kind: 'person', where: 'Cafe', startedAt: 0, endedAt: 1, durationMs: 1, meeting: true, lines: [], transcript: [] }
    const panel = meetingSearchPanel({
      meetings: () => [m], query: 'zzzz', onQuery: () => {}, onClose: () => {}, onOpen: () => {},
      dateLabels: () => [], meta: () => '', dummy: () => null, clock: () => '',
    })
    expect(panel.querySelector('[data-no-match]')?.textContent).toBe(S.noMatch)
  })
})
