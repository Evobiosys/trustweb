// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 home-dashboard (POLICY P02, MCP parity): the Home tile board's layout (read, move a tile, reset) and opening a Dashboard.
 * The layout is a record field; the Dashboard is a screen, so dashboard_open queues the step for the open preview (events.ts).
 */
import { listAffiliations, affiliationById } from '../../trustweb/src/affiliation.ts'
import { eventTagSlug as eventTag } from '../../trustweb/src/event_tag.ts'
import { MODULE_ID, parseCommunity } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import { findRequest, requestGroups } from '../../trustweb/src/home_data.ts'
import { HOME_COLS, HOME_TILES, isDefaultLayout, layoutOf, moveTile, resetLayout, setHomeLayout } from '../../trustweb/src/home_layout.ts'
import { announce } from './events.ts'
import { commitTo, load, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
const shown = (r: Obj) => ({ ...layoutOf(r), isDefault: isDefaultLayout(layoutOf(r)) })
/** An affiliation id: a tag one cannot be checked here (colour tags live in the app, not the record). */
const TAG_ID = /^tag:[^\s:]{1,80}$/

export function homeTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool[] = [{
    name: 'home_layout_get', description: 'The Home tile board: which tiles sit in the left, centre and right column (asksToMe, connects, web, asksSent, invites), and whether it is the default.',
    inputSchema: schema({}), run: () => shown(load(o.file)),
  }, {
    /* wave44c home-default */
    name: 'requests_list', description: 'The Existing requests tile: every open request, grouped (toMe = asks of you, connects = want to connect, sent = your asks) plus how many invitations you sent. Text only.',
    inputSchema: schema({}), run: () => requestGroups(load(o.file) as never),
  }]
  if (!o.write) return read
  const write: Tool[] = [
    {
      name: 'home_layout_set', description: 'Move one Home tile to a column (left | center | right) at an index, or reset the board to the default (reset: true).',
      inputSchema: schema({ tile: S(HOME_TILES.join(' | ')), column: S(HOME_COLS.join(' | ')), index: { type: 'number', description: 'position in the column, 0 = top (default: end)' }, reset: { type: 'boolean', description: 'back to the default layout' } }),
      run: (a) => {
        let out: Obj = {}
        if (a.reset === true) { commitTo(o.file, now, (r) => { resetLayout(r as never); out = shown(r) }); return out }
        if (!(HOME_TILES as readonly unknown[]).includes(a.tile)) throw new Error(`tile must be one of: ${HOME_TILES.join(', ')} (or reset: true)`)
        if (!(HOME_COLS as readonly unknown[]).includes(a.column)) throw new Error(`column must be one of: ${HOME_COLS.join(', ')}`)
        const at = typeof a.index === 'number' && Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER
        commitTo(o.file, now, (r) => { setHomeLayout(r as never, moveTile(layoutOf(r as never), a.tile as string, a.column as string, at)); out = shown(r) })
        return out
      },
    },
    {
      name: 'dashboard_open', description: 'Open a Dashboard in the open TrustWeb preview: community:<tag>, group:<tag> (other group), event:<id> or tag:<tag> (as home_layout and community_list name them). No id opens the chooser. Queued as a card.',
      inputSchema: schema({ affiliation: S('affiliation id, e.g. community:iyg') }),
      run: (a) => {
        const id = typeof a.affiliation === 'string' ? a.affiliation.trim() : ''
        if (id) {
          const r = load(o.file)
          const data = parseCommunity((r.extData as Obj | undefined)?.[MODULE_ID])
          const tags = Object.entries(data.meta ?? {}).map(([tag, m]) => ({ id: tag, label: m.name, community: true }))
          const events = ((r.events as { id: string; name: string; from: string }[] | undefined) ?? [])
          if (!affiliationById(listAffiliations({ eventTag, data, tags, events, people: r.people }), id) && !TAG_ID.test(id)) throw new Error(`no affiliation "${id}"`)
        }
        announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'dashboard_open', summary: `dashboard-open ${id}`.trim(), action: { type: 'dashboard-open', args: id ? { affiliation: id } : {} } })
        return { queued: true, ...(id ? { affiliation: id } : {}) }
      },
    },
    {
      name: 'home_open_request', description: 'Open one request (an id from requests_list) as its card on the Web of the open TrustWeb preview. Queued as a card.',
      inputSchema: schema({ id: S('request id from requests_list') }),
      run: (a) => {
        const id = typeof a.id === 'string' ? a.id.trim() : ''
        const found = id ? findRequest(load(o.file) as never, id) : null
        if (!found) throw new Error(`no open request "${id}"`)
        announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'home_open_request', summary: `home-open-request ${id}`, action: { type: 'home-open-request', args: { id } } })
        return { queued: true, kind: found.kind }
      },
    },
  ]
  return [...read, ...write]
}
