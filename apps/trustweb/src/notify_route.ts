// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27: where an arrival belongs. Chat is only for people already connected; a connect request lives in Web. No DOM. */
import type { NotifyKind } from './notify_kinds'

export type NotifyHome = 'chat' | 'inventory' | 'web' | 'events'

/** The screen that owns a kind of arrival: messages -> Chat, asks about an item -> Inventory, connect requests -> Web, reminders and events -> Events. */
export function route(kind: NotifyKind): NotifyHome {
  switch (kind) {
    case 'chat': return 'chat'
    case 'ask': return 'inventory'
    case 'connect': return 'web'
    case 'reminder': case 'event': return 'events'
  }
}
