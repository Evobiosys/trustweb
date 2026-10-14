/**
 * The timeline: "when we met someone and what happened then" (roadmap wish,
 * 2026-09). Pure and DOM-free, derived on every read from TrustWeb's record
 * plus the CRM's own records; nothing here is stored twice.
 *
 * Sources, each one event kind:
 *   met        Person.metAt (Ring.Intending people are "planned", not met)
 *   note       NoteLine.notedAt, with the line's tag
 *   reviewed   NoteLine.checkedAt when later than notedAt ("Still true?" answered)
 *   connected  Peer.connectedAt for a person with that peerId
 *   ask        LogEntry with a peerId that maps to a person: they asked my web
 *   interaction CRM Interaction (met again, call, message, event)
 *   followup   CRM FollowUp at its due date; done ones carry doneAt
 */
import type { AppState, LogEntry, NoteLine, Person } from '../../trustweb/src/model'
import { LineStatus, Ring } from '../../trustweb/src/model'
import type { CrmState, CrmView, FollowUp, Interaction } from './model'

export enum EventKind {
  Met = 'met',
  Planned = 'planned',
  Note = 'note',
  Reviewed = 'reviewed',
  Connected = 'connected',
  Ask = 'ask',
  Interaction = 'interaction',
  FollowUp = 'followup',
}

export interface TimelineEvent {
  id: string
  at: number
  kind: EventKind
  personId: string
  text: string
  /** The source record, for a view that wants the tag, outcome or done state. */
  line?: NoteLine
  log?: LogEntry
  interaction?: Interaction
  followUp?: FollowUp
}

function personEvents(p: Person): TimelineEvent[] {
  const out: TimelineEvent[] = []
  const planned = p.ring === Ring.Intending
  out.push({ id: `met:${p.id}`, at: p.metAt, kind: planned ? EventKind.Planned : EventKind.Met, personId: p.id, text: p.context })
  for (const line of p.lines) {
    if (line.status !== LineStatus.Current) continue
    out.push({ id: `note:${p.id}:${line.id}`, at: line.notedAt, kind: EventKind.Note, personId: p.id, text: line.text, line })
    if (line.checkedAt > line.notedAt) {
      out.push({ id: `rev:${p.id}:${line.id}`, at: line.checkedAt, kind: EventKind.Reviewed, personId: p.id, text: line.text, line })
    }
  }
  return out
}

function peerEvents(app: AppState, byPeer: Map<string, Person>): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const peer of app.peers) {
    const p = byPeer.get(peer.id)
    if (!p) continue
    out.push({ id: `conn:${peer.id}`, at: peer.connectedAt, kind: EventKind.Connected, personId: p.id, text: peer.displayName })
  }
  for (const entry of app.log) {
    const p = entry.peerId ? byPeer.get(entry.peerId) : undefined
    if (!p) continue
    out.push({ id: `ask:${entry.id}`, at: entry.at, kind: EventKind.Ask, personId: p.id, text: entry.text, log: entry })
  }
  return out
}

function crmEvents(crm: CrmState): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const i of crm.interactions) {
    out.push({ id: `int:${i.id}`, at: i.at, kind: EventKind.Interaction, personId: i.personId, text: i.text, interaction: i })
  }
  for (const f of crm.followUps) {
    out.push({ id: `fu:${f.id}`, at: f.dueAt, kind: EventKind.FollowUp, personId: f.personId, text: f.text, followUp: f })
  }
  return out
}

/** Every event across every person, newest first. */
export function timeline(view: CrmView): TimelineEvent[] {
  const byPeer = new Map<string, Person>()
  for (const p of view.app.people) if (p.peerId) byPeer.set(p.peerId, p)
  const events = [
    ...view.app.people.flatMap(personEvents),
    ...peerEvents(view.app, byPeer),
    ...crmEvents(view.crm),
  ]
  return events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}

/** One person's events, newest first. */
export function personTimeline(view: CrmView, personId: string): TimelineEvent[] {
  return timeline(view).filter((e) => e.personId === personId)
}

/** When something last happened with a person (0 when nothing is known). */
export function lastActivity(view: CrmView, personId: string): number {
  return personTimeline(view, personId).reduce((m, e) => Math.max(m, e.at), 0)
}

/** Open follow-ups due on or before `now`, oldest due first. */
export function dueFollowUps(crm: CrmState, now: number): FollowUp[] {
  return crm.followUps.filter((f) => !f.doneAt && f.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt)
}

/** Open follow-ups due after `now`, soonest first. */
export function upcomingFollowUps(crm: CrmState, now: number): FollowUp[] {
  return crm.followUps.filter((f) => !f.doneAt && f.dueAt > now).sort((a, b) => a.dueAt - b.dueAt)
}
