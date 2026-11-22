// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 community-events-invite-only (MCP parity): community_event_visibility reads or sets who sees a community's events:
 * members (its members; a non-member only through a personal invitation) or invited (only people invited personally).
 */
import { EVENT_ACCESS, eventAccessOf, isEventAccess, setEventAccess } from '../../trustweb/src/community_event_access.ts'
import { canEditSettings, parseCommunity } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import { commitTo, load, needText, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function communityEventAccessTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  return [{
    name: 'community_event_visibility',
    description: `Who sees a community's events: members (default: its members; a non-member only through a personal invitation, then only that event) or invited (only people invited personally, members too, and nothing goes to the community as a whole). Without mode: reads the current one.`,
    inputSchema: schema({ community: S('community tag id'), mode: { type: 'string', enum: [...EVENT_ACCESS], description: 'members | invited; omit to read' } }, ['community']),
    run: (a) => {
      const tag = needText(a.community, 'community')
      if (a.mode === undefined) return { community: tag, mode: eventAccessOf(load(o.file) as never, tag) }
      if (!isEventAccess(a.mode)) throw new Error('mode must be members or invited')
      commitTo(o.file, now, (r) => {
        const ext = (r as { extData?: Record<string, unknown> }).extData
        if (!canEditSettings(parseCommunity(ext?.['community-mighty']), tag)) throw new Error('only an organizer may change this community') // review-45: the UI toggle is disabled then
        setEventAccess(r as never, tag, a.mode as never)
      })
      return { community: tag, mode: a.mode }
    },
  }]
}
