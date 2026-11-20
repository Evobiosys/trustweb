// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-open-space (MCP parity): what an online open space offers a person, over the record file: propose an activity into the shared
 * schedule and join or leave one. The record has no network: the app sends the schedule to the people at the event once it is open.
 * Make an event an open space, or set the host flag, with event_settings_set (openSpace, showAll).
 */
import { joinActivity, joinedOf, leaveActivity, proposeActivity, tokenOf } from '../../trustweb/src/open_space.ts'
import { addPollOption, leadingOption, tallyOf, useDate, votePoll } from '../../trustweb/src/open_space_poll.ts'
import { isEventHost } from '../../trustweb/src/event_roles.ts'
import type { TwEvent } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
type Rec = { me?: { displayName: string }; people?: { id: string; name: string }[]; events?: TwEvent[] }
export interface OpenSpaceEnv { load: () => Rec; commit: (change: (r: Rec) => void) => boolean; now: () => Date }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })
let counter = 0

function eventOf(r: Rec, ref: unknown): TwEvent {
  const key = str(ref).trim()
  const hit = (r.events ?? []).find((e) => e.id === key) ?? (r.events ?? []).find((e) => e.name.trim().toLowerCase() === key.toLowerCase())
  if (!hit) throw new Error(`no event "${key}"`)
  return hit
}

export function openSpaceTools(e: OpenSpaceEnv): { read: Tool[]; write: Tool[] } {
  const me = (r: Rec): string => r.me?.displayName ?? ''
  /* wave45 open-space-date-poll */
  const hostOf = (r: Rec, ev: TwEvent): void => { if (!isEventHost(ev, me(r), r.people ?? [])) throw new Error('only a host of the event does this') }
  const optionView = (ev: TwEvent, id: string, token: string): Obj => {
    const o = ev.openSpace?.poll?.options.find((x) => x.id === id)
    return o ? { id: o.id, from: o.from, ...(o.to ? { to: o.to } : {}), ...tallyOf(o), mine: o.votes[token]?.v ?? null } : {}
  }
  const rnd = (): string => `${e.now().getTime().toString(36)}${(counter++).toString(36)}`
  return {
    read: [{
      name: 'open_space_poll_get', description: 'The date poll of an online open space (event id or exact name): every proposed date with its yes / maybe / no counts and my answer, the leading date and the chosen one.',
      inputSchema: schema({ event: S('event id or exact name') }, ['event']),
      run: (a) => {
        const r = e.load()
        const ev = eventOf(r, a.event)
        const token = tokenOf(ev.id, me(r))
        const poll = ev.openSpace?.poll
        return { event: ev.id, options: (poll?.options ?? []).map((o) => optionView(ev, o.id, token)), leading: leadingOption(poll)?.id ?? null, chosen: poll?.chosen ?? null }
      },
    }],
    write: [
      {
        name: 'open_space_propose', description: 'Propose an activity into the shared schedule of an online open space (event id or exact name): a title, a slot HH:MM inside the event window, and optionally a short description. You join it yourself.',
        inputSchema: schema({ event: S('event id or exact name'), title: S('the activity, e.g. Somatics class'), slot: S('start time HH:MM, inside the window of the event'), description: S('a short description (optional)') }, ['event', 'title', 'slot']),
        run: (a) => {
          let out: Obj = {}
          e.commit((r) => {
            const ev = eventOf(r, a.event)
            const act = proposeActivity(ev, { title: str(a.title), slot: str(a.slot), ...(str(a.description) ? { description: str(a.description) } : {}) }, me(r), `${e.now().getTime().toString(36)}${(counter++).toString(36)}`, e.now().getTime())
            out = { event: ev.id, id: act.id, title: act.title, slot: act.slot, joined: joinedOf(act).length }
          })
          return out
        },
      },
      {
        name: 'open_space_join', description: 'Join an activity of an online open space (join true, default) or leave it (join false); event id or exact name, activity id. Changes nothing when you are already in that state.',
        inputSchema: schema({ event: S('event id or exact name'), activity: S('activity id'), join: { type: 'boolean', description: 'true = join (default), false = leave' } }, ['event', 'activity']),
        run: (a) => {
          let out: Obj = {}
          e.commit((r) => {
            const ev = eventOf(r, a.event)
            const token = tokenOf(ev.id, me(r))
            const changed = (a.join === false ? leaveActivity : joinActivity)(ev, str(a.activity), token, e.now().getTime())
            out = { event: ev.id, activity: str(a.activity), changed, joined: joinedOf(ev.openSpace?.acts.find((x) => x.id === str(a.activity)) ?? { joins: {} }).length }
          })
          return out
        },
      },
      {
        name: 'open_space_poll_add', description: 'Host only: propose a date in the date poll of an online open space (event id or exact name): from YYYY-MM-DDTHH:MM, optionally an end on the same day. The first date starts the poll.',
        inputSchema: schema({ event: S('event id or exact name'), from: S('start, YYYY-MM-DDTHH:MM'), to: S('end on the same day, YYYY-MM-DDTHH:MM (optional)') }, ['event', 'from']),
        run: (a) => {
          let out: Obj = {}
          e.commit((r) => {
            const ev = eventOf(r, a.event)
            hostOf(r, ev)
            const o = addPollOption(ev, { from: str(a.from), ...(str(a.to) ? { to: str(a.to) } : {}) }, rnd())
            out = { event: ev.id, ...optionView(ev, o.id, tokenOf(ev.id, me(r))) }
          })
          return out
        },
      },
      {
        name: 'open_space_poll_vote', description: 'Answer yes, maybe or no to one date of the date poll of an online open space (event id or exact name, option id from open_space_poll_get). Changes nothing when the answer stays the same.',
        inputSchema: schema({ event: S('event id or exact name'), option: S('date option id'), vote: { type: 'string', enum: ['yes', 'maybe', 'no'], description: 'yes, maybe or no' } }, ['event', 'option', 'vote']),
        run: (a) => {
          let out: Obj = {}
          e.commit((r) => {
            const ev = eventOf(r, a.event)
            const token = tokenOf(ev.id, me(r))
            const changed = votePoll(ev, str(a.option), token, str(a.vote), e.now().getTime())
            out = { event: ev.id, changed, ...optionView(ev, str(a.option), token) }
          })
          return out
        },
      },
      {
        name: 'open_space_poll_use', description: 'Host only: "Use this date": the chosen date of the date poll becomes the date of the online open space (event id or exact name, option id) and closes the poll.',
        inputSchema: schema({ event: S('event id or exact name'), option: S('date option id') }, ['event', 'option']),
        run: (a) => {
          let out: Obj = {}
          e.commit((r) => {
            const ev = eventOf(r, a.event)
            hostOf(r, ev)
            useDate(ev, str(a.option))
            out = { event: ev.id, from: ev.from, ...(ev.to ? { to: ev.to } : {}), chosen: str(a.option) }
          })
          return out
        },
      },
    ],
  }
}
