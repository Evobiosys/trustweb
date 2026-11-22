// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events (Jakob 2026-11-19): two events become one. The kept event keeps its id; the gone event's joiners, resources, roles,
 * sign-ups, docs, notes and Feed posts move over; the gone event goes to the trash (trash.ts, never deleted) and its id redirects
 * (AppState.eventMerged, resolveEvent): an old link, a late `joined` record or a note that names it opens the kept event.
 * A host of both merges at once (mayMerge 'now'); a host of only the kept one asks the other host (event_merge_flow.ts, sealed). Pure.
 */
import type { AppState, TwEvent } from './model'
import { mayApprove } from './event_roles'
import { trashItems } from './trash'
import { tagOfEvent } from './feed_social'
import { sameEventTag } from './event_tag'
import { mergeActivities } from './open_space'

/** A merge ask between two hosts: `in` = the other host asks me (I host `gone`); `out` = I asked them (I host `keep`). `link` = the kept event as an event link (in only). */
export interface MergeAsk { dir: 'in' | 'out'; keep: string; gone: string; peer: string; from: string; at: number; link?: string }
export interface MergeResult { people: number; resources: number }

/** Follows the redirects of merged events to the event that holds them now; an id still held (or restored) is its own. */
export function resolveEvent(s: Pick<AppState, 'events' | 'eventMerged'>, id: string): string {
  const seen = new Set<string>()
  let at = id
  while (!s.events?.some((e) => e.id === at) && s.eventMerged?.[at] && !seen.has(at)) { seen.add(at); at = s.eventMerged[at] }
  return at
}

/** The held event a merged (no longer held) id redirects to; undefined when the id is held itself, unknown, or its target is gone too. */
export function mergedInto(s: Pick<AppState, 'events' | 'eventMerged'>, id: string): string | undefined {
  const to = resolveEvent(s, id)
  return to !== id && s.events?.some((e) => e.id === to) ? to : undefined
}

/** 'now' = I host (or organize) both; 'ask' = only the kept one (its other host decides); 'no' = not mine to merge. */
export function mayMerge(s: Pick<AppState, 'events' | 'me' | 'people'>, keepId: string, goneId: string): 'now' | 'ask' | 'no' {
  const keep = s.events?.find((e) => e.id === keepId)
  const gone = s.events?.find((e) => e.id === goneId)
  if (!keep || !gone || keep === gone || !mayApprove(keep, s.me.displayName, s.people)) return 'no'
  return mayApprove(gone, s.me.displayName, s.people) ? 'now' : 'ask'
}

/** The events that could merge into this one: every other event I hold. */
export const mergeCandidates = (s: Pick<AppState, 'events'>, id: string): TwEvent[] => (s.events ?? []).filter((e) => e.id !== id)

const union = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined, key: (x: T) => string = String): T[] | undefined => {
  const out = [...(a ?? [])]
  for (const x of b ?? []) if (!out.some((y) => key(y) === key(x))) out.push(x)
  return out.length ? out : undefined
}
const joinText = (a: string | undefined, b: string | undefined): string | undefined => (!a ? b : !b || a.includes(b) ? a : `${a}\n\n${b}`)
const FILL = ['where', 'to', 'core', 'conditions', 'srv', 'attachment', 'communityId', 'community', 'celebration', 'showAll', 'linkMode', 'hostDefault'] as const

function joinEvent(keep: TwEvent, gone: TwEvent): number {
  const before = keep.resources?.length ?? 0
  const set = <K extends keyof TwEvent>(k: K, v: TwEvent[K] | undefined): void => { if (v === undefined) delete keep[k]; else keep[k] = v }
  for (const k of FILL) if ((keep[k] === undefined || keep[k] === '') && gone[k] !== undefined && gone[k] !== '') (keep as unknown as Record<string, unknown>)[k] = gone[k]
  if (keep.conditions !== gone.conditions && keep.conditions && gone.conditions) keep.conditions = joinText(keep.conditions, gone.conditions)
  set('hosts', union(keep.hosts, gone.hosts))
  set('organizers', union(keep.organizers, gone.organizers))
  set('techSupport', union(keep.techSupport, gone.techSupport))
  set('themes', union(keep.themes, gone.themes))
  set('people', union(keep.people, gone.people))
  set('signup', union(keep.signup, gone.signup))
  set('invitees', union(keep.invitees, gone.invitees))
  set('confTo', union(keep.confTo, gone.confTo))
  set('conference', union(keep.conference, gone.conference, (c) => c.url))
  set('roles', union(keep.roles, gone.roles, (r) => r.name.trim().toLowerCase()))
  set('resources', union(keep.resources, gone.resources, (r) => r.text.trim().toLowerCase()))
  if (gone.docs) {
    const docs = { description: joinText(keep.docs?.description, gone.docs.description), followup: joinText(keep.docs?.followup, gone.docs.followup) }
    keep.docs = Object.fromEntries(Object.entries(docs).filter(([, v]) => v !== undefined))
  }
  if (gone.openSpace) { keep.openSpace ??= { acts: [] }; mergeActivities(keep, gone.openSpace.acts) }
  if (gone.attended) keep.attended = true
  return (keep.resources?.length ?? 0) - before
}

/**
 * Merges `goneId` into `keepId` on this device: the event fields join (nothing the kept event has is overwritten; lists join without doubles;
 * the docs append), every record that names the gone id names the kept one, the gone event goes to the trash, its id redirects. Null (and nothing
 * changed) when either is not held or both are the same.
 */
export function mergeEvents(s: AppState, keepId: string, goneId: string, now: number): MergeResult | null {
  const keep = s.events?.find((e) => e.id === keepId)
  const gone = s.events?.find((e) => e.id === goneId)
  if (!keep || !gone || keep === gone) return null
  const repoint = (id: string | undefined): string | undefined => (id === goneId ? keepId : id)
  let people = 0
  for (const p of s.people) {
    if (p.events?.includes(goneId)) { p.events = [...new Set(p.events.map((e) => (e === goneId ? keepId : e)))]; people++ }
    if (p.eventShow?.[goneId]) { const { [goneId]: show, ...rest } = p.eventShow; p.eventShow = { [keepId]: show, ...rest } }
    if (p.seen?.event === goneId) p.seen = { ...p.seen, event: keepId }
    for (const l of p.lines) if (l.eventId === goneId) l.eventId = keepId
  }
  const resources = joinEvent(keep, gone)
  for (const i of s.inventory ?? []) if (i.eventId === goneId) i.eventId = keepId
  for (const f of s.feedPosts ?? []) {
    if (f.eventId === goneId) f.eventId = keepId
    if (sameEventTag(f.tag, tagOfEvent(gone))) f.tag = tagOfEvent(keep)
  }
  for (const n of s.notifInbox ?? []) if (n.eventId === goneId) n.eventId = keepId
  if (s.atEvent?.eventId === goneId) s.atEvent = { ...s.atEvent, eventId: keepId }
  if (s.uiRings) {
    if (s.uiRings.eventMode === goneId) s.uiRings.eventMode = keepId
    for (const k of ['show', 'hide'] as const) if (s.uiRings[k]) s.uiRings[k] = [...new Set(s.uiRings[k].map((c) => (c === `event:${goneId}` ? `event:${keepId}` : c)))]
  }
  s.eventMerged = { ...Object.fromEntries(Object.entries(s.eventMerged ?? {}).map(([from, to]) => [from, repoint(to) as string])), [goneId]: keepId }
  trashItems(s, 'event', [goneId], now)
  return { people, resources }
}
