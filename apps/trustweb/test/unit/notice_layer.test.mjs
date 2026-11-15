// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c chat-notices: the one notice layer's stack (notice_layer.ts): order, the cap, what is listed. */
import { NOTICE_CAP, NOTICE_KINDS, describeNotices, visibleKinds } from '../../src/notice_layer.ts'

describe('notice layer stack', () => {
  it('the kinds are listed top to bottom: cards, wants, update, notice, message, toast', () => {
    expect(NOTICE_KINDS).toEqual(['cards', 'wants', 'update', 'notice', 'message', 'toast'])
  })
  it('shows what is active, in order', () => {
    expect(visibleKinds(new Set(['toast', 'cards']))).toEqual(['cards', 'toast'])
  })
  it('never more than the cap: the ones nearest the bottom bar stay, the top ones wait', () => {
    expect(NOTICE_CAP).toBe(3)
    expect(visibleKinds(new Set(NOTICE_KINDS))).toEqual(['notice', 'message', 'toast'])
    expect(visibleKinds(new Set(['cards', 'wants', 'update', 'notice']), 2)).toEqual(['update', 'notice'])
  })
  it('nothing active, nothing shown; unknown kinds are ignored', () => {
    expect(visibleKinds(new Set())).toEqual([])
    expect(visibleKinds(new Set(['bogus']))).toEqual([])
  })
  it('describeNotices lists every active kind with its text and whether it shows', () => {
    const rows = describeNotices([{ kind: 'toast', text: 'Saved' }, { kind: 'cards', text: 'Ask result' }, { kind: 'wants', text: 'w' }, { kind: 'update', text: 'u' }, { kind: 'notice', text: 'n' }], 3)
    expect(rows.map((r) => [r.kind, r.visible])).toEqual([['cards', false], ['wants', false], ['update', true], ['notice', true], ['toast', true]])
  })
})
