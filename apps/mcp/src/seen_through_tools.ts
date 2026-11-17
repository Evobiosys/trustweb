// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c seen-through (POLICY P02, MCP parity): people_seen_through_list reads the people I see only through a friend (apps/trustweb/src/seen_through.ts). Read only; a nameless one carries no name.
 *  review-44c: event_introduce_person queues the host's "Introduce to the people here" (action seen-introduce) for the open TrustWeb preview. */
import { seenThroughList } from '../../trustweb/src/seen_through.ts'
import { announce } from './events.ts'
import { load, schema, S, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

export function seenThroughTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  const read: Tool = {
    name: 'people_seen_through_list',
    description: 'People seen only through a friend, drawn outside the Web rings: id, name (empty when they did not agree to be shown), anonymous, via (the friend\'s id) and viaName, source ("event" introduction, "intro" ask, resource "ask"), resource (the ask), event (its id), at.',
    inputSchema: schema({}),
    run: () => seenThroughList(load(o.file) as unknown as Parameters<typeof seenThroughList>[0]),
  }
  if (!o.write) return [read]
  const introduce: Tool = {
    name: 'event_introduce_person',
    description: 'As a host of the event: queue "Introduce to the people here" on the open TrustWeb preview. The app first asks that person whether the people at the event may see them; their name travels only with their yes, otherwise the others see "someone via you". Returns {queued:true}.',
    inputSchema: schema({ event: S('event id'), person: S('person id (someone at the event)') }),
    run: (a) => {
      const event = typeof a.event === 'string' ? a.event.trim() : ''
      const person = typeof a.person === 'string' ? a.person.trim() : ''
      const r = load(o.file) as { events?: { id: string }[]; people?: { id: string; deleted_at?: string }[] }
      if (!(r.events ?? []).some((e) => e.id === event)) throw new Error(`no event "${event}"`)
      if (!(r.people ?? []).some((p) => p.id === person && p.deleted_at === undefined)) throw new Error(`no person "${person}"`)
      announce(o.file, { at: now().toISOString(), kind: 'action', tool: 'event_introduce_person', summary: `seen-introduce ${event} ${person}`, action: { type: 'seen-introduce', args: { event, person } } })
      return { queued: true }
    },
  }
  return [read, introduce]
}
