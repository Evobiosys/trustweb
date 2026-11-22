// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-people-list, MCP parity of the event page's "People at this event": event_people_list reads the list as the page shows it (hosts
 * first, then who joins; a long one shows its first 10 until Show all), event_people_add is "Add people" (tags a person with the event).
 */
import { PEOPLE_COLLAPSE_AT, PEOPLE_SHOWN, peopleAtEvent, visiblePeople } from '../../trustweb/src/event_people_list.ts'
import { commitTo, findPerson, load, needText, schema, S, type Rec, type RecordToolsOptions } from './record_tools.ts'
import type { Tool } from './protocol.ts'

type Ev = { id: string; name: string; hosts?: string[]; organizers?: unknown }
const findEvent = (r: Rec, q: unknown): Ev => {
  const key = needText(q, 'event')
  const evs = Array.isArray(r.events) ? (r.events as Ev[]) : []
  const e = evs.find((x) => x.id === key) ?? evs.find((x) => x.name.toLowerCase() === key.toLowerCase())
  if (!e) throw new Error(`no event "${key}"`)
  return e
}

export function eventPeopleTools(o: RecordToolsOptions): Tool[] {
  const now = o.now ?? (() => new Date())
  return [
    {
      name: 'event_people_list', description: `"People at this event" as the event page lists it: the hosts first, then who joins (id, name, host). More than ${PEOPLE_COLLAPSE_AT} people: shown = the first ${PEOPLE_SHOWN} unless all:true (Show all).`,
      inputSchema: schema({ event: S('event id or exact name'), all: { type: 'boolean', description: 'true = Show all' } }, ['event']),
      run: (a) => {
        const r = load(o.file)
        const e = findEvent(r, a.event)
        const hosts = (e.hosts?.length ? e.hosts : (e.organizers as string[] | undefined) ?? []).map(String)
        const hostSet = new Set(hosts.map((n) => n.trim().toLowerCase()))
        const joining = r.people.filter((p) => p.deleted_at === undefined && !p.via && Array.isArray(p.events) && (p.events as string[]).includes(e.id) && !hostSet.has(p.name.trim().toLowerCase()))
        const all = peopleAtEvent(r.people, hosts, joining)
        return { total: all.length, people: visiblePeople(all, a.all === true).map((x) => ({ id: x.id ?? null, name: x.name, host: x.host })) }
      },
    },
    ...(o.write ? [{
      name: 'event_people_add', description: 'Add people: tag a person (id or exact name) with an event, so the page lists them under People at this event.',
      inputSchema: schema({ event: S('event id or exact name'), person: S('person id or exact name') }, ['event', 'person']),
      run: (a: Record<string, unknown>) => {
        let out: unknown = null
        commitTo(o.file, now, (r) => {
          const e = findEvent(r, a.event)
          const p = findPerson(r, a.person)
          const have = Array.isArray(p.events) ? (p.events as string[]) : []
          if (!have.includes(e.id)) p.events = [...have, e.id]
          out = { event: e.id, person: p.id }
        })
        return out
      },
    }] : []),
  ]
}
