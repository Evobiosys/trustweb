/**
 * From the demo to the live app (wave 1733, item 6 / amendment A2): the demo
 * page's one [Install] button asks "Clean out your demo contacts first?" and
 * then opens the live app, carrying over what is the person's own.
 *
 * What a demo device is (read from the code, solo.ts / store.ts / seed.ts):
 * the side-by-side page runs each phone as an iframe of this app under
 * persona holder / seeker / third / fourth, stored at
 * trustweb.v1.<context>.<persona> (store.ts storageKey; the ea context's key
 * carries a "-2"). The person's own phone is the first one (holder): it was
 * started with their name and seeded with Maya's imaginary friends and things
 * (seed.ts), and it connected over the relay to the other demo phones. The live
 * app on the same origin uses trustweb.v1.me.
 *
 * Carried over: their name, the people and things they added themselves, the
 * notes on them, and past meetings. NEVER the demo identity, its relay key,
 * its peers or its log: the live app makes or keeps its own identity. People
 * connected over the relay (the other demo phones) are demo devices and stay
 * behind. "Start clean" drops exactly the dummy content; "Keep them" brings it
 * along still marked dummy (AppState.demo, so isDemoPerson/isDemoItem keep
 * saying so and "Remove demo content" can take it away later).
 *
 * The demo page never writes the live record itself (an open live tab would
 * overwrite it on its next save): it leaves a one-shot carry-over record,
 * and the live app applies it at boot, asking first when it already has people.
 */
import type { AppState, InventoryItem, PastMeeting, Person } from './model'
import { isDemoItem, isDemoPerson } from './model'
import { DemoContext, Persona, seedState } from './seed'

/** The one-shot record the demo page leaves for the live app (same origin). */
export const CARRY_KEY = 'trustweb.carry.v1'

/** What the demo page hands to the live app. */
export interface CarryOver {
  v: 1
  at: number
  /** The person's own name, typed on the demo's first phone. */
  name: string
  people: Person[]
  inventory: InventoryItem[]
  meetings: PastMeeting[]
  /** The carried people and things that are dummy content ("Keep them"); empty after "Start clean". */
  demo: { people: string[]; inventory: string[] }
}

/** The person's two answers to "Clean out your demo contacts first?". */
export enum DemoCleanChoice {
  StartClean = 'clean',
  KeepThem = 'keep',
}

/** What the live app does with a carry-over it found. */
export enum CarryPlan {
  /** Nothing on this phone yet: the carry-over becomes the live record. */
  Fresh = 'fresh',
  /** A live record without people: merged in without asking (nothing to overwrite). */
  MergeQuietly = 'merge-quietly',
  /** The live app already has people: ask merge or cancel, never overwrite. */
  Ask = 'ask',
}

/**
 * The demo's dummy content: what "Show demo content" added (state.demo) plus
 * what the demo phone was seeded with (seed.ts). A seeded phone never recorded
 * which ids came from the seed, so seeded people are recognised by name and
 * context, seeded things by their text (both fixed per context; ids and dates are random).
 */
export function dummyIds(s: AppState, ctx: DemoContext): { people: Set<string>; inventory: Set<string> } {
  const seed = seedState(Persona.Holder, 0, ctx)
  const seedPeople = new Set(seed.people.map((p) => `${p.name}\u0000${p.context}`))
  const seedThings = new Set(seed.inventory.map((i) => i.text))
  return {
    people: new Set(s.people.filter((p) => isDemoPerson(s, p.id) || seedPeople.has(`${p.name}\u0000${p.context}`)).map((p) => p.id)),
    inventory: new Set(s.inventory.filter((i) => isDemoItem(s, i.id) || seedThings.has(i.text)).map((i) => i.id)),
  }
}

/** Without the relay link: a carried person is a contact here, not a connected peer (that connection was the demo identity's). */
function unlinked(p: Person): Person {
  const { peerId: _peer, ...rest } = p
  return rest
}

/**
 * What the demo's first phone hands over. People connected over the relay
 * (the other demo phones, or anyone that demo identity connected with) stay
 * behind; with "Start clean" so does every dummy person and thing, together
 * with the notes on them. Past meetings come along; one about a person who
 * stays behind keeps its name and notes but no longer points at them.
 */
export function buildCarryOver(demo: AppState, ctx: DemoContext, choice: DemoCleanChoice, now: number): CarryOver {
  const dummy = dummyIds(demo, ctx)
  const clean = choice === DemoCleanChoice.StartClean
  const people = demo.people.filter((p) => !p.peerId && !(clean && dummy.people.has(p.id))).map(unlinked)
  const inventory = demo.inventory.filter((i) => !(clean && dummy.inventory.has(i.id))).map((i) => ({ ...i }))
  const kept = new Set(people.map((p) => p.id))
  const meetings = (demo.meetings ?? []).map((m): PastMeeting => {
    if (!m.personId || kept.has(m.personId)) return { ...m }
    const { personId: _gone, ...rest } = m
    return rest
  })
  return {
    v: 1, at: now, name: demo.me.displayName, people, inventory, meetings,
    demo: clean
      ? { people: [], inventory: [] }
      : { people: people.filter((p) => dummy.people.has(p.id)).map((p) => p.id), inventory: inventory.filter((i) => dummy.inventory.has(i.id)).map((i) => i.id) },
  }
}

/** Fresh, quiet merge, or ask: the live app never overwrites people it already has. */
export function carryPlan(live: AppState | null): CarryPlan {
  if (!live) return CarryPlan.Fresh
  return live.people.length > 0 ? CarryPlan.Ask : CarryPlan.MergeQuietly
}

function union(a: readonly string[] = [], b: readonly string[] = []): string[] {
  return [...new Set([...a, ...b])]
}

/**
 * Merges a carry-over into the live record (a copy; the live identity, name,
 * peers, log and settings stay as they are). Idempotent: whatever is already
 * there by id is not added twice, so applying the same carry-over again
 * changes nothing.
 */
export function mergeCarryOver(live: AppState, carry: CarryOver): AppState {
  const ids = <T extends { id: string }>(xs: readonly T[]): Set<string> => new Set(xs.map((x) => x.id))
  const havePeople = ids(live.people)
  const haveThings = ids(live.inventory)
  const haveMeetings = ids(live.meetings ?? [])
  const people = carry.people.filter((p) => !havePeople.has(p.id))
  const inventory = carry.inventory.filter((i) => !haveThings.has(i.id))
  const meetings = carry.meetings.filter((m) => !haveMeetings.has(m.id))
  const out: AppState = {
    ...live,
    people: [...live.people, ...people],
    inventory: [...live.inventory, ...inventory],
  }
  if (meetings.length || live.meetings) out.meetings = [...(live.meetings ?? []), ...meetings].sort((a, b) => b.startedAt - a.startedAt)
  if (carry.demo.people.length || carry.demo.inventory.length) {
    out.demo = { people: union(live.demo?.people, carry.demo.people), inventory: union(live.demo?.inventory, carry.demo.inventory) }
  }
  return out
}

/** A live record made from the carry-over alone: their name, a fresh id; the identity is made when the app starts. */
export function freshFromCarry(carry: CarryOver, newId: string): AppState {
  const base: AppState = { v: 1, me: { id: newId, displayName: carry.name }, peers: [], people: [], inventory: [], log: [], notificationsOn: false, demoOffered: true }
  return mergeCarryOver(base, carry)
}

/** Reads a carry-over record; anything malformed counts as none. */
export function parseCarry(raw: string | null): CarryOver | null {
  if (!raw) return null
  try {
    const c = JSON.parse(raw) as Partial<CarryOver>
    const ok = c && c.v === 1 && typeof c.name === 'string' && Array.isArray(c.people) && Array.isArray(c.inventory)
      && Array.isArray(c.meetings) && c.demo && Array.isArray(c.demo.people) && Array.isArray(c.demo.inventory)
    return ok ? c as CarryOver : null
  } catch {
    return null
  }
}

/** Storage around the record; a browser that blocks storage simply has none. */
export function readCarry(): CarryOver | null {
  try { return parseCarry(localStorage.getItem(CARRY_KEY)) } catch { return null }
}

export function writeCarry(c: CarryOver): boolean {
  try { localStorage.setItem(CARRY_KEY, JSON.stringify(c)); return true } catch { return false }
}

export function dropCarry(): void {
  try { localStorage.removeItem(CARRY_KEY) } catch { /* nothing stored */ }
}
