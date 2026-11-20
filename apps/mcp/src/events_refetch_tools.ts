// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 events-refetch: events_refetch asks the connected people for new events of my communities now (the Events list's Refresh); queued for the open app, which holds the relay keys. */
import { announce } from './events.ts'
import { schema, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function eventsRefetchTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  return o.write ? [{
    name: 'events_refetch', description: 'Ask the connected people for new events of my communities now (the Refresh of the Events list; the app also does it when Events opens, at most every 5 minutes). Queued for the open TrustWeb app.',
    inputSchema: schema({}),
    run: () => { announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'events_refetch', summary: 'events-refetch {}', action: { type: 'events-refetch', args: {} } }); return { queued: true } },
  }] : []
}
