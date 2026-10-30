// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: Do Not Disturb on the Chat tab silences chat notifications only. */
import { wantsKind } from '../../src/notify_kinds.ts'

describe('wantsKind with chats hidden', () => {
  const s = { notificationsOn: true, chatsHidden: true }
  it('chat notifications go quiet', () => expect(wantsKind(s, 'chat')).toBe(false))
  it('other kinds still notify', () => expect(wantsKind(s, 'ask')).toBe(true))
  it('absent chatsHidden changes nothing', () => expect(wantsKind({ notificationsOn: true }, 'chat')).toBe(true))
})
