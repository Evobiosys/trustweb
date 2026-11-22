// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor (MCP parity D-P02): what the calendar-style event editor offers, over the record file: keep an unsaved event as a
 * draft, invite people directly (co-hosts too), set repeat / conference links / attachment / description / calendar, add a calendar and switch
 * calendars on and off by tag. Pure logic in apps/trustweb/src/event_draft.ts.
 */
import { addCalendar, applyEventDetails, calendarsOf, draftsOf, emptyFields, inviteGuests, saveDraft, toggleCalendarTag } from '../../trustweb/src/event_draft.ts'
import type { EditorFields } from '../../trustweb/src/event_draft.ts'
import type { AppState, TwEvent } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'
import { mayInviteRecord } from './bulk_invite_tools.ts' // answers-45a: the UI's mayInvite gate
import type { Rec as RecordRec } from './record_tools.ts'

type Obj = Record<string, unknown>
interface Person { id: string; name: string; deleted_at?: string }
type Rec = Pick<AppState, 'eventDrafts' | 'calendars'> & { me?: { displayName: string }; people: Person[]; events?: TwEvent[] }
export interface EventEditorEnv { load: () => Rec; commit: (change: (r: Rec) => void) => boolean; now: () => Date }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })
let counter = 0
const newId = (now: Date): string => `${now.getTime().toString(36)}${(counter++).toString(36)}`

function eventOf(r: Rec, ref: unknown): TwEvent {
  const key = str(ref).trim()
  const all = r.events ?? []
  const hit = all.find((e) => e.id === key) ?? all.find((e) => e.name.trim().toLowerCase() === key.toLowerCase())
  if (!hit) throw new Error(`no event "${key}"`)
  return hit
}

function personId(r: Rec, who: string): string {
  const hits = r.people.filter((p) => p.deleted_at === undefined && (p.id === who || p.name.trim().toLowerCase() === who.trim().toLowerCase()))
  if (hits.length !== 1) throw new Error(hits.length ? `more than one person is named "${who}": use the id` : `no person "${who}"`)
  return hits[0].id
}

const TEXT_FIELDS = ['name', 'from', 'to', 'where', 'description', 'attachment', 'conditions', 'themes', 'tagName'] as const

export function eventEditorTools(e: EventEditorEnv): { read: Tool[]; write: Tool[] } {
  const write: Tool[] = [
    {
      name: 'event_draft_save', description: 'Keep an event that is not saved yet as a draft (listed under Events with a Draft pill; never an event until it is saved in the app). Fields: name, from, to (YYYY-MM-DD, optionally THH:MM), where, description, attachment, conditions, themes, tagName. Give id to change a draft; without id a new draft is made. Returns {id}.',
      inputSchema: schema({ id: S('draft id to change'), ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, S(k)])) }),
      run: (a) => {
        let id = str(a.id).trim()
        e.commit((r) => {
          const now = e.now()
          const old = id ? draftsOf(r).find((d) => d.id === id) : undefined
          if (id && !old) throw new Error(`no draft "${id}"`)
          const fields: EditorFields = old?.fields ?? emptyFields(now.toISOString().slice(0, 10), r.me?.displayName ?? '')
          for (const k of TEXT_FIELDS) if (a[k] !== undefined) fields[k] = str(a[k])
          id = saveDraft(r, fields, now.getTime(), id || newId(now), old?.eventId)
        })
        return { id }
      },
    },
    {
      name: 'event_invite', description: 'Invite people to an event directly (id or exact name each), not only co-organizers. cohost:true also makes them co-hosts. Nobody is invited twice.',
      inputSchema: schema({ event: S('event id or exact name'), people: { type: 'array', items: { type: 'string' }, description: 'people by id or exact name' }, cohost: { type: 'boolean' } }, ['event', 'people']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          if (!mayInviteRecord(ev, r as unknown as RecordRec)) throw new Error(`you may not invite to "${ev.name}" (the app shows Invite only to whom may invite)`) // answers-45a (review-45 Q9)
          const ids = (Array.isArray(a.people) ? a.people : []).map((p) => personId(r, str(p)))
          inviteGuests(ev, ids, a.cohost === true)
          out = { id: ev.id, people: ev.people ?? [], hosts: ev.hosts ?? [] }
        })
        return out
      },
    },
    {
      name: 'event_details_set', description: 'Change an event\'s details: repeat none|daily|weekly|monthly|yearly, conference [{provider: kmeet|zoom|jitsi|custom, url: https link}] (replaces the list; empty clears), attachment (a kDrive https link; empty clears), description, calendar (a calendar id from calendar_add, or mine). Only the fields given change.',
      inputSchema: schema({
        event: S('event id or exact name'), repeat: S('none | daily | weekly | monthly | yearly'),
        conference: { type: 'array', items: { type: 'object', properties: { provider: { type: 'string' }, url: { type: 'string' } }, required: ['provider', 'url'] } },
        attachment: S('https link, empty clears'), description: S('text, empty clears'), calendar: S('calendar id'),
      }, ['event']),
      run: (a) => {
        let out: Obj = {}
        e.commit((r) => {
          const ev = eventOf(r, a.event)
          if (a.calendar !== undefined && !calendarsOf(r).some((c) => c.id === str(a.calendar)) && str(a.calendar) !== 'shared') throw new Error(`no calendar "${str(a.calendar)}"`)
          applyEventDetails(ev, {
            ...(a.repeat !== undefined ? { repeat: str(a.repeat) } : {}),
            ...(Array.isArray(a.conference) ? { conference: a.conference.map((c) => ({ provider: str((c as Obj).provider), url: str((c as Obj).url) })) } : {}),
            ...(a.attachment !== undefined ? { attachment: str(a.attachment) } : {}),
            ...(a.description !== undefined ? { description: str(a.description) } : {}),
            ...(a.calendar !== undefined ? { calendar: str(a.calendar) } : {}),
          })
          out = { id: ev.id, repeat: ev.repeat ?? 'none', conference: ev.conference ?? [], ...(ev.attachment ? { attachment: ev.attachment } : {}), ...(ev.calendar ? { calendar: ev.calendar } : {}) }
        })
        return out
      },
    },
    {
      name: 'calendar_add', description: 'Add a calendar of mine with tags ("#here #anna" or comma separated) that the calendar view switches on and off. Returns {id}.',
      inputSchema: schema({ name: S('calendar name'), tags: S('tags, e.g. #here #anna') }, ['name']),
      run: (a) => {
        let id = ''
        e.commit((r) => { id = addCalendar(r, str(a.name), str(a.tags), `cal-${newId(e.now())}`) })
        return { id }
      },
    },
    {
      name: 'calendar_tag_toggle', description: 'Switch a calendar tag off (every calendar carrying it is hidden in the calendar view) or on. on absent = flip.',
      inputSchema: schema({ tag: S('tag, with or without #'), on: { type: 'boolean' } }, ['tag']),
      run: (a) => {
        const tag = str(a.tag).replace(/^#+/, '').trim().toLowerCase()
        if (!tag) throw new Error('give a tag')
        let on = false
        e.commit((r) => { on = toggleCalendarTag(r, tag, typeof a.on === 'boolean' ? a.on : undefined) })
        return { tag, on }
      },
    },
  ]
  const read: Tool[] = [
    {
      name: 'event_drafts_list', description: 'List the event drafts (events not saved yet): id, name, from, where.',
      inputSchema: schema({}),
      run: () => draftsOf(e.load()).map((d) => ({ id: d.id, name: d.fields.name, from: d.fields.from, where: d.fields.where })),
    },
  ]
  return { read, write }
}
