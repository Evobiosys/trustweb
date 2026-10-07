/**
 * "Dismiss them" (wave 5, item a; owner 2026-10-07): the small line under "Got it" in the
 * "imaginary friends" popup, and Settings > Remove demo content, both take the dummy demo content away.
 * One function, two scopes, so neither can reach further than it should:
 *
 *   Seeded  an embedded demo phone (?solo=1): the seeded web (seed.ts, recognised by dummyIds) plus anything
 *           "Show demo content" added. Whatever the visitor added themselves stays.
 *   Added   a live phone: ONLY the ids "Show demo content" recorded in state.demo. Never matched by name or text,
 *           so a real person or thing can not be taken by this path.
 *
 * Connected people (a peerId) are never dummy content and stay in both scopes. A past meeting that pointed at a
 * removed person keeps its notes and transcript but no longer points at them. Pure: it changes the state it is given.
 */
import type { AppState } from './model'
import { dummyIds } from './demo_to_live'
import type { DemoContext } from './seed'

export enum DismissScope {
  Seeded = 'seeded',
  Added = 'added',
}

/** How much one dismissal took away. */
export interface Dismissed {
  people: number
  things: number
}

function idsToRemove(s: AppState, ctx: DemoContext, scope: DismissScope): { people: ReadonlySet<string>; inventory: ReadonlySet<string> } {
  if (scope === DismissScope.Seeded) return dummyIds(s, ctx)
  return { people: new Set(s.demo?.people ?? []), inventory: new Set(s.demo?.inventory ?? []) }
}

/** Removes the dummy people and things of `scope`, forgets the demo marking, and unlinks their past meetings. */
export function removeDummyContent(s: AppState, ctx: DemoContext, scope: DismissScope): Dismissed {
  const ids = idsToRemove(s, ctx, scope)
  const gone = new Set(s.people.filter((p) => !p.peerId && ids.people.has(p.id)).map((p) => p.id))
  const before = { people: s.people.length, things: s.inventory.length }
  s.people = s.people.filter((p) => !gone.has(p.id))
  s.inventory = s.inventory.filter((i) => !ids.inventory.has(i.id))
  for (const m of s.meetings ?? []) if (m.personId && gone.has(m.personId)) delete m.personId
  delete s.demo
  return { people: before.people - s.people.length, things: before.things - s.inventory.length }
}
