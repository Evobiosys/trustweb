// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-event (F03): the event assembler's change cards in the assistant's registry (actions.ts). Each card needs its own
 * approval (auto: false) and can be taken back. Pure: the host (main.ts) gives the record and the redraw.
 */
import { str, type Actions } from './actions'
import { addRole, askResource, buildEvent, setDoc, EVENT_DOCS } from './event_plan'
import type { AppState, TwEvent } from './model'

export interface EventActionHost {
  state(): Pick<AppState, 'events'>
  save(): void
  newId(): string
  /** The community the assistant was opened for ("New event" inside a community); absent = none. */
  community?(): string | undefined
}

export function defineEventActions(reg: Actions, host: EventActionHost): void {
  const find = (ref: string): TwEvent => {
    const all = host.state().events ?? []
    const hit = all.find((e) => e.id === ref) ?? all.filter((e) => e.name.trim().toLowerCase() === ref.trim().toLowerCase())[0]
    if (!hit) throw new Error(`no event "${ref}"`)
    return hit
  }
  const edit = (ev: TwEvent, change: (e: TwEvent) => void): () => void => {
    const before = JSON.stringify(ev)
    change(ev)
    host.save()
    return () => { Object.keys(ev).forEach((k) => delete (ev as unknown as Record<string, unknown>)[k]); Object.assign(ev, JSON.parse(before)); host.save() }
  }

  reg.define<{ name: string; from: string; to?: string; where: string }>({
    type: 'event-create', doc: 'Makes a new event (its sign-up sheet starts empty) in the community the person is in. Needs approval.', shape: '{"name": text, "from": "YYYY-MM-DD", "to"?: "YYYY-MM-DD", "where"?: text}',
    parse: (a) => ({ name: str(a, 'name', 120)!, from: str(a, 'from', 16)!, to: str(a, 'to', 16, true), where: str(a, 'where', 160, true) ?? '' }),
    label: (a) => `New event: ${a.name} (${a.from})`, auto: false,
    apply: (a) => {
      const ev = buildEvent({ ...a, community: host.community?.() }, host.newId(), Date.now())
      const s = host.state() as { events?: TwEvent[] }
      s.events = [...(s.events ?? []), ev]
      host.save()
      return () => { s.events = (s.events ?? []).filter((e) => e !== ev); host.save() }
    },
  })
  reg.define<{ event: string; kind: (typeof EVENT_DOCS)[number]; text: string }>({
    type: 'event-doc', doc: 'Writes the description or the follow-up note of an event. Needs approval.', shape: '{"event": id or name, "kind": "description"|"followup", "text": text}',
    parse: (a) => {
      const kind = str(a, 'kind', 20)!
      if (!(EVENT_DOCS as readonly string[]).includes(kind)) throw new Error(`kind must be one of ${EVENT_DOCS.join(', ')}`)
      return { event: str(a, 'event', 120)!, kind: kind as (typeof EVENT_DOCS)[number], text: str(a, 'text', 2000)! }
    },
    label: (a) => `Event ${a.kind}: ${a.text.slice(0, 40)}`, auto: false,
    apply: (a) => edit(find(a.event), (ev) => setDoc(ev, a.kind, a.text)),
  })
  reg.define<{ event: string; name: string }>({
    type: 'event-role', doc: 'Adds a named role (a slot a member can take) to the roles list of an event. Needs approval.', shape: '{"event": id or name, "name": text}',
    parse: (a) => ({ event: str(a, 'event', 120)!, name: str(a, 'name', 80)! }),
    label: (a) => `Role: ${a.name}`, auto: false,
    apply: (a) => edit(find(a.event), (ev) => { if (!addRole(ev, a.name)) throw new Error(`the role "${a.name}" exists`) }),
  })
  reg.define<{ event: string; text: string }>({
    type: 'event-resource', doc: 'Adds a resource the event needs (a loudspeaker, tables) to its resource list; members can say "I bring it". Needs approval.', shape: '{"event": id or name, "text": text}',
    parse: (a) => ({ event: str(a, 'event', 120)!, text: str(a, 'text', 120)! }),
    label: (a) => `Resource: ${a.text}`, auto: false,
    apply: (a) => edit(find(a.event), (ev) => { askResource(ev, a.text, host.newId()) }),
  })
}
