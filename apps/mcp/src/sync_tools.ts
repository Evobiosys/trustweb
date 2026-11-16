// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c sync-devices (POLICY P02, MCP parity): the device sync as tools. sync_status reads the record's copy of Settings > My devices
 * (syncStatus, written by the app; syncAutoOff); sync_now queues the app's "sync-now" action for the open preview (only the app holds the
 * pairing keys). Auto sync itself is the setting general.syncAuto (settings_set).
 */
import { announce } from './events.ts'
import { load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Status = { devices: number; lastAt: number }
const statusOf = (r: Record<string, unknown>): Status | null => {
  const s = r.syncStatus as Partial<Status> | undefined
  return s && typeof s.devices === 'number' && typeof s.lastAt === 'number' ? { devices: s.devices, lastAt: s.lastAt } : null
}

export function syncTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool = {
    name: 'sync_status', description: 'Device sync: how many of my devices are linked, when the last sync with any of them was (ISO time or null) and whether Auto sync is on.',
    inputSchema: schema({}),
    run: () => {
      const r = load(o.file) as Record<string, unknown>
      const s = statusOf(r)
      return { devices: s?.devices ?? 0, lastAt: s?.lastAt ? new Date(s.lastAt).toISOString() : null, auto: r.syncAutoOff !== true }
    },
  }
  if (!o.write) return [read]
  const write: Tool = {
    name: 'sync_now', description: 'Queue "Sync now" with every linked device for the open TrustWeb preview (the recovery path; Auto sync runs by itself). Returns {queued:true, devices}.',
    inputSchema: schema({}),
    run: () => {
      const devices = statusOf(load(o.file) as Record<string, unknown>)?.devices ?? 0
      announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'sync_now', summary: 'sync-now {}', action: { type: 'sync-now', args: {} } })
      return { queued: true, devices }
    },
  }
  return [read, write]
}
