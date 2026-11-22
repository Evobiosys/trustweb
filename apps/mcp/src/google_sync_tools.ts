// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 google-contacts-sync over MCP: google_sync_status (the switch, Keep in sync, how many people follow Google, the last run's counts)
 * and google_sync_set (Keep in sync on/off). A sync run needs the Google token, which lives only in the browser tab, never in the record:
 * the open app runs it. Never answers contact data or the sync token. Written straight into the record.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { GOOGLE_CONTACTS_SYNC_ENABLED } from '../../trustweb/src/google_flag.ts'
import type { Tool } from './protocol.ts'

interface Rec { people?: { sources?: { key: string }[] }[]; googleSync?: { on?: boolean; seen?: Record<string, { deleted?: boolean }>; base?: object; last?: object } }

export function googleSyncTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const status: Tool = {
    name: 'google_sync_status',
    description: 'Settings > Import > Google: available (TrustWeb\'s own Google sign-in exists), keepInSync (the owner\'s choice), linked (people that follow a Google contact), known (Google contacts the last sync saw), lastRun {at, updated, kept, fresh, gone}. No contact data.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run: () => {
      const r = load()
      const gs = r.googleSync
      return {
        available: GOOGLE_CONTACTS_SYNC_ENABLED,
        keepInSync: !!gs?.on,
        linked: (r.people ?? []).filter((p) => p.sources?.some((x) => x.key.startsWith('google-api:people/'))).length,
        known: Object.values(gs?.seen ?? {}).filter((c) => !c.deleted).length,
        lastRun: gs?.last ?? null,
      }
    },
  }
  const set: Tool = {
    name: 'google_sync_set',
    description: 'Settings > Import > Google > Keep in sync: on = the open app follows changes in the owner\'s Google contacts (fields the owner edited stay theirs). Runs only once TrustWeb\'s Google sign-in is available (google_sync_status.available).',
    inputSchema: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'], additionalProperties: false },
    run: (a) => {
      if (typeof a.on !== 'boolean') throw new Error('on must be true or false')
      const r = load()
      r.googleSync = { ...(r.googleSync ?? { seen: {}, base: {} }), on: a.on }
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return { keepInSync: a.on }
    },
  }
  return o.write ? [status, set] : [status]
}
