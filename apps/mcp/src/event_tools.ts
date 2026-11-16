// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-event (POLICY P02, MCP parity): what the event sheet offers a person, as tools over the record file: make an event from a
 * template inside a community, join its sign-up sheet, ask for / bring a resource, set who the celebration is shown to. The record has no
 * network: a resource ask is written as one queued support ask and the app shows a card and sends it on a tap (support_flush.ts). On this side the
 * person is always "me".
 */
import { applyEventSettings, setEventTimes } from '../../trustweb/src/event_press.ts'
import { addRole, askResource, buildEvent, coverResource, queueResourceAsk, resourceSummary, setDoc, setInvitees, signUp } from '../../trustweb/src/event_plan.ts'
import { identifyPerson, ROLE_KEYS, setRoles } from '../../trustweb/src/event_roles.ts'
import { parseCommunity } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import type { SupportAsk } from '../../trustweb/src/support_ask.ts'
import type { AppState, TwEvent } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Person extends Obj { id: string; name: string; ring: string; peerId?: string; did?: string; fields?: Record<string, unknown>; deleted_at?: string }
interface Rec extends Obj { me?: { displayName: string; nickname?: string }; people: Person[]; events?: TwEvent[]; extData?: Record<string, unknown>; supportAsks?: SupportAsk[] }

export interface EventToolsEnv { load: () => Rec; commit: (change: (r: Rec) => void) => boolean; now: () => Date }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x) => x.trim()) : [])
let counter = 0
const newId = (now: Date): string => `${now.getTime().toString(36)}${(counter++).toString(36)}`

function eventOf(r: Rec, ref: unknown): TwEvent {
  const key = str(ref).trim()
  const all = r.events ?? []
  const hit = all.find((e) => e.id === key) ?? all.find((e) => e.name.trim().toLowerCase() === key.toLowerCase())
  if (!hit) throw new Error(`no event "${key}"`)
  return hit
}

function personOf(r: Rec, who: string): Person {
  const hits = r.people.filter((p) => p.deleted_at === undefined && (p.id === who || p.name.trim().toLowerCase() === who.trim().toLowerCase()))
  if (hits.length !== 1) throw new Error(hits.length ? `more than one person is named "${who}": use the id` : `no person "${who}"`)
  return hits[0]
}

export function eventTools(e: EventToolsEnv): { write: Tool[] } {
  const write: Tool[] = [
    {
      name: 'event_create', description: 'Make an event inside a community from a template: name, from (YYYY-MM-DD), to, where, description, roles (named slots), resources (what it needs), followup (note). The sign-up sheet starts empty.',
      inputSchema: schema({
        community: S('community id'),
        template: { type: 'object', description: 'name, from, to?, where?, description?, roles?: [text], resources?: [text], followup?: text' },
      }, ['community', 'template']),
      run: (a) => {
        const t = (a.template && typeof a.template === 'object' ? a.template : {}) as Obj
        let out: Obj = {}
        e.commit((r) => {
          const community = str(a.community).trim()
          if (!parseCommunity(r.extData?.['community-mighty']).meta?.[community]) throw new Error(`no community "${community}"`)
          const now = e.now()
          const ev = buildEvent({ name: str(t.name), from: str(t.from), to: str(t.to), where: str(t.where), community }, `ev${newId(now)}`, now.getTime())
          if (str(t.description).trim()) setDoc(ev, 'description', str(t.description))
          if (str(t.followup).trim()) setDoc(ev, 'followup', str(t.followup))
          list(t.roles).forEach((n) => addRole(ev, n))
          list(t.resources).forEach((x) => askResource(ev, x, `r${newId(now)}`))
          r.events = [...(r.events ?? []), ev]
          out = { id: ev.id, name: ev.name, roles: ev.roles?.length ?? 0, resources: ev.resources?.length ?? 0 }
        })
        return out
      },
    },
    {
      name: 'event_signup', description: 'Join the sign-up sheet of an event (id or exact name). Joining twice changes nothing.',
      inputSchema: schema({ event: S('event id or exact name') }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => { const ev = eventOf(r, a.event); const joined = signUp(ev, 'me'); out = { id: ev.id, joined, signups: ev.signup?.length ?? 0 } })
        return out
      },
    },
    {
      name: 'event_resource_ask', description: 'Ask the community for a resource the event needs (a loudspeaker): one row on the event, and one support ask to the community\'s members (Friends or closer, Closest few) that the app shows as a card and sends only when the person taps Send. ask:false only adds the row.',
      inputSchema: schema({ event: S('event id or exact name'), text: S('the resource'), ask: { type: 'boolean', description: 'also ask the community (default true)' } }, ['event', 'text']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          const now = e.now()
          const res = askResource(ev, str(a.text), `r${newId(now)}`)
          const ask = a.ask === false ? undefined : queueResourceAsk(r as never, ev, res, now.getTime(), `mcp${newId(now)}`)
          if (ask) ask.agent = true   // I9: the app shows a card; the person's tap sends it
          out = { event: ev.id, resource: res.id, asked: ask?.to.length ?? 0, queued: !!ask }
        })
        return out
      },
    },
    {
      name: 'event_resource_cover', description: 'Say "I bring it" for a resource of an event (resource id from the event). The first volunteer covers it; I stay visible as the volunteer.',
      inputSchema: schema({ event: S('event id or exact name'), resource: S('resource id') }, ['event', 'resource']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => { const ev = eventOf(r, a.event); const covered = coverResource(ev, str(a.resource).trim(), 'me'); const s = resourceSummary(ev); out = { event: ev.id, covered, open: s.open, coveredCount: s.covered } })
        return out
      },
    },
    {
      name: 'event_invitees_set', description: 'Set who the event\'s celebration is shown to (people by id or exact name). Everybody else sees nothing, not even a hint. Replaces the list; a person needs a connection identity.',
      inputSchema: schema({ event: S('event id or exact name'), people: { type: 'array', items: { type: 'string' }, description: 'ids or exact names' } }, ['event', 'people']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          const dids = list(a.people).map((w) => { const p = personOf(r, w); if (!p.did) throw new Error(`${p.name} has no identity yet: connect first`); return p.did })
          setInvitees(ev, dids)
          out = { event: ev.id, invitees: ev.invitees?.length ?? 0 }
        })
        return out
      },
    },
    {
      name: 'event_roles_set', description: 'Set who organizes, hosts and gives technical support for an event (id or exact name). Each list takes people by id or exact name (a name nobody carries stays a free name); a list left out stays as it is, an empty list clears it. Technical support = whoever sets this app up for the organizers; it never goes into an event link.',
      inputSchema: schema({ event: S('event id or exact name'), organizers: { type: 'array', items: { type: 'string' } }, hosts: { type: 'array', items: { type: 'string' } }, techSupport: { type: 'array', items: { type: 'string' } } }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          const refs = (v: unknown): string[] => list(v).map((w) => r.people.find((p) => p.deleted_at === undefined && (p.id === w || p.name.trim().toLowerCase() === w.trim().toLowerCase()))?.id ?? w)
          setRoles(r as unknown as AppState, ev, Object.fromEntries(ROLE_KEYS.filter((k) => Array.isArray(a[k])).map((k) => [k, refs(a[k])])))
          out = { id: ev.id, organizers: ev.organizers ?? [], hosts: ev.hosts ?? [], techSupport: ev.techSupport ?? [] }
        })
        return out
      },
    },
    {
      name: 'event_person_identify', description: 'Identify a person for an event by name: the person already called that (exact name, any case) is returned; otherwise a new person is made (ring Not yet sorted) and tagged with the event. Returns {personId, created}.',
      inputSchema: schema({ event: S('event id or exact name'), name: S('the person\'s name') }, ['event', 'name']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          const now = e.now()
          const done = identifyPerson(r as unknown as AppState, ev.id, str(a.name), { id: `p${newId(now)}`, now: now.getTime() })
          if (!done) throw new Error('a name is needed')
          out = done
        })
        return out
      },
    },
    // Wave 43 event-press-share
    {
      name: 'event_settings_set', description: 'Change an event on this device (id or exact name): invitePolicy hosts|trusted|everyone (who may invite), notify (notifications of this event), nameReveal full|first|hidden|nick (what my links say of me). Only the fields given change.',
      inputSchema: schema({ event: S('event id or exact name'), invitePolicy: S('hosts | trusted | everyone'), notify: { type: 'boolean' }, nameReveal: S('full | first | hidden | nick') }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          applyEventSettings(ev, { ...(a.invitePolicy !== undefined ? { invitePolicy: str(a.invitePolicy) } : {}), ...(typeof a.notify === 'boolean' ? { notify: a.notify } : {}), ...(a.nameReveal !== undefined ? { nameReveal: str(a.nameReveal) } : {}) })
          out = { id: ev.id, invitePolicy: ev.invitePolicy ?? 'hosts', notify: ev.notify !== false, nameReveal: ev.nameReveal ?? 'full' }
        })
        return out
      },
    },
    {
      name: 'event_offers_set', description: 'Switch what an event offers (all off by default): support (ask for support), resources (ask for resources, borrowing), feed (the event feed). Only the switches given change.',
      inputSchema: schema({ event: S('event id or exact name'), support: { type: 'boolean' }, resources: { type: 'boolean' }, feed: { type: 'boolean' } }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          applyEventSettings(ev, { offers: Object.fromEntries(['support', 'resources', 'feed'].filter((k) => typeof a[k] === 'boolean').map((k) => [k, a[k]])) })
          out = { id: ev.id, offers: { support: false, resources: false, feed: false, ...ev.offers } }
        })
        return out
      },
    },
    {
      name: 'event_times_set', description: 'Change when I am at an event, e.g. stay longer: from and/or to (YYYY-MM-DD, optionally THH:MM); an empty to removes the end. A core time that no longer fits is dropped.',
      inputSchema: schema({ event: S('event id or exact name'), from: S('start'), to: S('end, empty = none') }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          const bad = setEventTimes(ev, a.from !== undefined ? str(a.from).trim() : ev.from, a.to !== undefined ? str(a.to).trim() : ev.to ?? '')
          if (bad) throw new Error(`${bad}: not a valid date, or the end is before the start`)
          out = { id: ev.id, from: ev.from, ...(ev.to ? { to: ev.to } : {}) }
        })
        return out
      },
    },
    {
      name: 'me_nickname_set', description: 'Set my nickname (empty clears it): what event links say instead of my name when an event\'s name reveal is "nick".',
      inputSchema: schema({ nickname: S('nickname, empty = none') }, ['nickname']),
      run: (a) => {
        const nickname = str(a.nickname).trim()
        e.commit((r) => { if (!r.me) throw new Error('no profile in the record'); if (nickname) r.me.nickname = nickname; else delete r.me.nickname })
        return { nickname }
      },
    },
  ]
  return { write }
}
