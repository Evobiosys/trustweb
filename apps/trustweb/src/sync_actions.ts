// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices (POLICY P02): "Sync now" with every linked device as an action of the assistant's registry (actions.ts), reached by MCP sync_now. */
import type { Actions } from './actions'
import { S } from './strings'

export interface SyncActionHost { syncAll(): Promise<number>; /** Wave 44c: the Link a device sheet (QR and link). */ showLink(): void }

export function defineSyncActions(reg: Actions, host: SyncActionHost): void {
  reg.define({
    type: 'sync-now', doc: 'Starts Sync now with every linked device (the automatic sync runs by itself; this is the recovery). Cannot be undone.', shape: '{}',
    parse: () => ({}),
    label: () => S.syncDev.syncAll,
    apply: () => { void host.syncAll() },
    undoable: false,
  })
  /* wave44c sync-seamless */
  reg.define({
    type: 'sync-pair-link', doc: 'Opens Link a device: the QR and the link a phone camera app opens (TrustWeb joins and asks to confirm).', shape: '{}',
    parse: () => ({}),
    label: () => S.syncSeamless.pairLinkLabel,
    apply: () => host.showLink(),
    undoable: false,
  })
}
