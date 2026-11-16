// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-open-space (MCP parity): what an online open space offers a person, over the record file: propose an activity into the shared
 * schedule and join or leave one. The record has no network: the app sends the schedule to the people at the event once it is open.
 * Make an event an open space, or set the host flag, with event_settings_set (openSpace, showAll).
 */
import { joinActivity, joinedOf, leaveActivity, proposeActivity, tokenOf } from '../../trustweb/src/open_space.ts'
import type { TwEvent } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
type Rec = { me?: { displayName: string }; events?: TwEvent[] }
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

export function openSpaceTools(e: OpenSpaceEnv): { write: Tool[] } {
  const me = (r: Rec): string => r.me?.displayName ?? ''
  return {
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
    ],
  }
}
