// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 bulk-invite-filter (MCP parity): invite_bulk, the filter view of Event > Invite many. include / exclude are chips `person:<id>` / `tag:<id>`.
 * Without confirm it only previews (who, who is not a member of the event's community); with confirm it invites. A community event with non-members
 * needs accept_non_members too (they see the community's events only through this invitation). Rules: apps/trustweb/src/bulk_invite.ts.
 */
import { nonMembers, toInvite } from '../../trustweb/src/bulk_invite.ts'
import { inviteGuests } from '../../trustweb/src/event_draft.ts'
import type { TwEvent } from '../../trustweb/src/model.ts'
import { commitTo, load, needText, S, schema, type RecordToolsOptions, type Rec } from './record_tools.ts'
import type { Tool } from './protocol.ts'

const chips = (v: unknown, what: string): string[] => {
  const list = Array.isArray(v) ? v.map(String) : []
  const bad = list.find((c) => !/^(person|tag):.+/.test(c))
  if (bad) throw new Error(`${what}: "${bad}" is not a chip (person:<id> or tag:<id>)`)
  return list
}
const eventOf = (r: Rec, q: unknown): TwEvent => {
  const key = needText(q, 'event')
  const all = (r.events ?? []) as TwEvent[]
  const ev = all.find((e) => e.id === key) ?? all.find((e) => e.name.toLowerCase() === key.toLowerCase())
  if (!ev) throw new Error(`no event "${key}"`)
  return ev
}
const arr = (description: string): Record<string, unknown> => ({ type: 'array', items: { type: 'string' }, description })

export function bulkInviteTools(o: RecordToolsOptions): Tool[] {
  if (!o.write) return []
  const now = o.now ?? (() => new Date())
  return [{
    name: 'invite_bulk',
    description: 'Invite many people to an event with a filter: include chips (person:<id> or tag:<id>) say who to add, exclude chips who not (exclusion wins). Without confirm: a preview {event, count, people, notMembers, community, invited:false}, nothing changes. With confirm:true it invites; when the event belongs to a community and some are not its members (notMembers), it also needs accept_non_members:true: they see the community\'s events only through this invitation.',
    inputSchema: schema({ event: S('event id or exact name'), include: arr('chips to add'), exclude: arr('chips to leave out'), confirm: { type: 'boolean', description: 'true = invite now' }, accept_non_members: { type: 'boolean', description: 'true = invite the non-members of the event\'s community too' } }, ['event', 'include']),
    run: (a) => {
      const include = chips(a.include, 'include')
      const exclude = chips(a.exclude, 'exclude')
      const view = (r: Rec, ev: TwEvent, invited: boolean): Record<string, unknown> => {
        const who = toInvite(r, ev, include, exclude)
        const nm = nonMembers(who, ev)
        return { event: ev.id, count: who.length, people: who.map((p) => p.id), notMembers: nm.people.map((p) => p.id), community: nm.community, invited }
      }
      if (a.confirm !== true) return view(load(o.file), eventOf(load(o.file), a.event), false)
      let out: Record<string, unknown> = {}
      commitTo(o.file, now, (r) => {
        const ev = eventOf(r, a.event)
        const v = view(r, ev, true)
        if ((v.notMembers as string[]).length && a.accept_non_members !== true) throw new Error(`${(v.notMembers as string[]).length} are not members of ${String(v.community)}: they see the community's events only through this invitation; pass accept_non_members:true to invite them`)
        inviteGuests(ev, v.people as string[])
        out = v
      })
      return out
    },
  }]
}
