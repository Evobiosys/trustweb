// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c sync-devices (POLICY P02, MCP parity): the device sync as tools. sync_status reads the record's copy of Settings > My devices
 * (syncStatus, written by the app; syncAutoOff); sync_now queues the app's "sync-now" action for the open preview (only the app holds the
 * pairing keys). Auto sync itself is the setting general.syncAuto (settings_set).
 */
import { announce } from './events.ts'
import { load, schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Status = { devices: number; lastAt: number; unacked: number; held: number }
const statusOf = (r: Record<string, unknown>): Status | null => {
  const s = r.syncStatus as Partial<Status> | undefined
  return s && typeof s.devices === 'number' && typeof s.lastAt === 'number' ? { devices: s.devices, lastAt: s.lastAt, unacked: s.unacked ?? 0, held: s.held ?? 0 } : null
}

export function syncTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool = {
    name: 'sync_status', description: 'Device sync: how many of my devices are linked, when the last sync with any of them was (ISO time or null), whether Auto sync is on, how many linked devices still owe an acknowledgement of my last send (unacked) and how many newer items wait for an update of this device (held).',
    inputSchema: schema({}),
    run: () => {
      const r = load(o.file) as Record<string, unknown>
      const s = statusOf(r)
      return { devices: s?.devices ?? 0, lastAt: s?.lastAt ? new Date(s.lastAt).toISOString() : null, auto: r.syncAutoOff !== true, unacked: s?.unacked ?? 0, held: s?.held ?? 0 }
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
  const link: Tool = {
    name: 'sync_pair_link', description: 'Queue "Link a device" for the open TrustWeb preview: it shows the QR and the link (a phone camera app opens TrustWeb from it and asks to confirm). Returns {queued:true}.',
    inputSchema: schema({}),
    run: () => {
      announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'sync_pair_link', summary: 'sync-pair-link {}', action: { type: 'sync-pair-link', args: {} } })
      return { queued: true }
    },
  }
  /* wave44c answers-44c: the Signal-like direction (the new device shows, the device in use scans) */
  const queue = (name: string, type: string, description: string): Tool => ({
    name, description, inputSchema: schema({}),
    run: () => {
      announce(o.file, { at: now().toISOString(), kind: 'action', tool: name, summary: `${type} {}`, action: { type, args: {} } })
      return { queued: true }
    },
  })
  const showNew = queue('sync_pair_show_new', 'sync-pair-show-new', 'Queue "Show a code for my other device" on the open TrustWeb preview (a new device): it shows its own pairing QR for the device already in use to scan. Returns {queued:true}.')
  const scan = queue('sync_pair_scan', 'sync-pair-scan', 'Queue "Scan a new device" on the open TrustWeb preview (the device already in use): it opens the camera for the code the new device shows, then asks to confirm. Returns {queued:true}.')
  return [read, write, link, showNew, scan]
}
