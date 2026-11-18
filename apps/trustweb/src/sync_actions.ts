// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices (POLICY P02): "Sync now" with every linked device as an action of the assistant's registry (actions.ts), reached by MCP sync_now. */
import type { Actions } from './actions'
import { S } from './strings'

export interface SyncActionHost { syncAll(): Promise<number>; /** Wave 44c: the Link a device sheet (QR and link). */ showLink(): void; /** answers-44c: the new device shows its code (Signal-like). */ showNewCode(): void; /** answers-44c: the trusted device scans a new device's code. */ scanNew(): void }

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
  /* wave44c answers-44c */
  reg.define({
    type: 'sync-pair-show-new', doc: 'On a new device: shows its own pairing code (QR) for the device already in use to scan (Signal-like).', shape: '{}',
    parse: () => ({}), label: () => S.a44cPair.showNewLabel, apply: () => host.showNewCode(), undoable: false,
  })
  reg.define({
    type: 'sync-pair-scan', doc: 'On the device already in use: opens the camera to scan the code a new device shows, then asks to confirm.', shape: '{}',
    parse: () => ({}), label: () => S.a44cPair.scanNewLabel, apply: () => host.scanNew(), undoable: false,
  })
}
