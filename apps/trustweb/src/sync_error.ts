// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 sync-errors-retry: the cause of a failed sync or relay send, and the first fix that suits it (UI text: strings.ts S.syncErr). */

export type SyncCause = 'airplane' | 'relay' | 'schema' | 'auth' | 'device-off' | 'too-large' | 'receive-only' | 'other'

/** `online` = navigator.onLine. The messages are sync_link.ts's own ("offline", "version", ...), relay.ts's "responded <status>" and fetch's network TypeError. */
export function classifySyncError(err: unknown, online: boolean): SyncCause {
  if (!online) return 'airplane'
  const m = err instanceof Error ? err.message : ''
  if (m === 'version' || /^Schema version \d+ is newer/.test(m)) return 'schema'   // the latter is SchemaNewerError's message (schema_version.ts)
  if (m === 'not linked') return 'auth'
  if (m === 'offline') return 'device-off'
  if (m === 'too large') return 'too-large'
  if (m === 'receive only') return 'receive-only'
  const status = /responded (\d{3})$/.exec(m)?.[1]
  if (status === '401' || status === '403') return 'auth'
  if (err instanceof TypeError || (status && (status[0] === '5' || status === '404' || status === '429'))) return 'relay'
  return 'other'
}

/** The first fix for each cause, the text of the error row and of MCP sync_status. Import-free: the MCP server loads this file under plain node, where strings.ts does not run. */
export const SYNC_HINT: Record<SyncCause, string> = {
  airplane: 'Turn off airplane mode / check Wi-Fi',
  relay: 'The relay is down, retry in a minute',
  schema: 'Update the app',
  auth: 'Pair again',
  'device-off': 'The other device is not on. Open TrustWeb there and try again.',
  'too-large': 'This record is too large to send between devices.',
  'receive-only': 'This device only receives. Press Sync now on your phone, or switch the setting off.',
  other: 'Sending failed. Check the connection and try again.',
}
