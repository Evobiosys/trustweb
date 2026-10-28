// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24: true exactly once per device, for the first chat notification (it then carries "Turn these off"). Blocked storage: never. */
const FLAG = 'trustweb.notify.chatOffered'

export function firstChatNotice(store: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    if (store.getItem(FLAG)) return false
    store.setItem(FLAG, '1')
    return true
  } catch {
    return false
  }
}
