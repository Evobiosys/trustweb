// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-host): which extended messenger "Extend" on the Chat screen opens. Geb is the default once set up. Pure, no DOM. */
import type { MessengerSource } from './ext/registry'

export type Extended = { kind: 'source'; source: MessengerSource } | { kind: 'setup'; sources: MessengerSource[] }

export function pickExtended(sources: readonly MessengerSource[], chosenId?: string): Extended {
  const ready = sources.filter((s) => s.status() !== 'needs-setup')
  const source = ready.find((s) => s.id === chosenId) ?? ready.find((s) => s.id === 'geb') ?? ready[0]
  return source ? { kind: 'source', source } : { kind: 'setup', sources: [...sources] }
}
