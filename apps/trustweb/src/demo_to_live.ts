/**
 * From the demo to the live app (wave 1733, item 6 / amendment A2): the demo
 * page's one [Install] button asks "Make it your personal account" (keep or drop the demo contacts) and
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
 * The record lives in localStorage, so the live app trusts none of it
 * (parseCarry checks every element, drops stale records, strips relay links,
 * and lets only carried ids be marked dummy) and never applies it over a live
 * record it could not read (store.ts wasUnreadable).
 */
import type { AppState, InventoryItem, NoteLine, PastMeeting, Person } from './model'
import { AboutKind, AUDIENCES, isDemoItem, isDemoPerson, LineStatus, RINGS, TAGS } from './model'
import { DemoContext, Persona, seedState } from './seed'

/** The one-shot record the demo page leaves for the live app (same origin). */
export const CARRY_KEY = 'trustweb.carry.v1'

/**
 * A carry-over older than this is stale and dropped unread: the demo page
 * opens the live app at once, so a record still lying around a day later was
 * never meant for this visit (review-app-a, wave 1733).
 */
export const CARRY_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Clock skew tolerated for a record that says it was made in the future. */
const CARRY_FUTURE_SKEW_MS = 60 * 60 * 1000
/** At most this many of each in one carry-over (a demo phone holds a handful). */
export const CARRY_MAX = { people: 500, inventory: 1000, meetings: 200 } as const

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
  // Nor their fediverse address: on the live phone it could fetch from a third party with no tap (review-app-b).
  const { peerId: _peer, fediverse: _fed, ...rest } = p
  return rest
}

/** A carried thing without its picture id (pictures live in the demo persona's own store, never carried). */
function withoutPicture(i: InventoryItem): InventoryItem {
  const { imageId: _img, ...rest } = i
  return rest
}

/**
 * A carried meeting without the round-B fields that act by themselves on the
 * live phone (review-app-b): an outbox would PUT packs at boot, a late link
 * would poll, a server job would read "may still be charged" for another account.
 */
function quietMeeting(m: PastMeeting): PastMeeting {
  const { outbox: _o, late: _l, serverJob: _j, fullSentAt: _f, ...rest } = m
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
  const inventory = demo.inventory.filter((i) => !(clean && dummy.inventory.has(i.id))).map(withoutPicture)
  const kept = new Set(people.map((p) => p.id))
  const meetings = (demo.meetings ?? []).map((m): PastMeeting => {
    if (!m.personId || kept.has(m.personId)) return quietMeeting(m)
    const { personId: _gone, ...rest } = quietMeeting(m)
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
  // Never a relay link: a carried person is a contact here (also where a record was not built by buildCarryOver).
  const people = carry.people.filter((p) => !havePeople.has(p.id)).map(unlinked)
  const inventory = carry.inventory.filter((i) => !haveThings.has(i.id)).map(withoutPicture)
  const meetings = carry.meetings.filter((m) => !haveMeetings.has(m.id)).map(quietMeeting)
  const out: AppState = {
    ...live,
    people: [...live.people, ...people],
    inventory: [...live.inventory, ...inventory],
  }
  if (meetings.length || live.meetings) out.meetings = [...(live.meetings ?? []), ...meetings].sort((a, b) => b.startedAt - a.startedAt)
  // Only what this merge ADDS can be marked dummy: a live person or thing never is, whatever the record lists.
  const added = { people: new Set(people.map((p) => p.id)), inventory: new Set(inventory.map((i) => i.id)) }
  const demoPeople = carry.demo.people.filter((id) => added.people.has(id))
  const demoThings = carry.demo.inventory.filter((id) => added.inventory.has(id))
  if (demoPeople.length || demoThings.length) {
    out.demo = { people: union(live.demo?.people, demoPeople), inventory: union(live.demo?.inventory, demoThings) }
  }
  return out
}

/** A live record made from the carry-over alone: their name, a fresh id; the identity is made when the app starts. */
export function freshFromCarry(carry: CarryOver, newId: string): AppState {
  const base: AppState = { v: 1, me: { id: newId, displayName: carry.name }, peers: [], people: [], inventory: [], log: [], notificationsOn: false, demoOffered: true }
  return mergeCarryOver(base, carry)
}

// ---------------------------------------------------------------------------
// reading a carry-over: it comes from localStorage, so every element is
// checked before it can reach the live record (a damaged, stale, replayed or
// hand-edited record must never break or pollute the person's real data)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isId = (v: unknown): v is string => isStr(v) && v.length > 0 && v.length <= 64
const oneOf = <T>(set: readonly T[], v: unknown): v is T => set.includes(v as T)

function isNoteLine(v: unknown): v is NoteLine {
  return isRec(v) && isId(v.id) && isStr(v.text) && oneOf(TAGS, v.tag) && oneOf(AUDIENCES, v.audience)
    && oneOf([LineStatus.Current, LineStatus.Gone], v.status) && isNum(v.notedAt) && isNum(v.checkedAt)
}

/** A carried person with only well-formed notes, never a relay link; null where the person itself is malformed. */
function cleanPerson(v: unknown): Person | null {
  if (!isRec(v) || !isId(v.id) || !isStr(v.name) || !isStr(v.context) || !oneOf(RINGS, v.ring) || !isNum(v.metAt) || !Array.isArray(v.lines)) return null
  return unlinked({ ...(v as unknown as Person), lines: v.lines.filter(isNoteLine) })
}

function isItem(v: unknown): v is InventoryItem {
  return isRec(v) && isId(v.id) && isStr(v.text) && oneOf(AUDIENCES, v.audience) && typeof v.included === 'boolean' && isNum(v.createdAt)
}

function isMeeting(v: unknown): v is PastMeeting {
  return isRec(v) && isId(v.id) && isStr(v.about) && oneOf([AboutKind.Who, AboutKind.What], v.kind) && isStr(v.where)
    && (v.personId === undefined || isId(v.personId))
    && isNum(v.startedAt) && isNum(v.endedAt) && isNum(v.durationMs) && typeof v.meeting === 'boolean'
    && Array.isArray(v.lines) && v.lines.every((l) => isRec(l) && isStr(l.text) && oneOf(TAGS, l.tag))
    && Array.isArray(v.transcript) && v.transcript.every((t) => isRec(t) && isNum(t.speaker) && isNum(t.atMs) && isStr(t.text))
}

/** The first of each id only, at most `max`. */
function uniqueById<T extends { id: string }>(xs: readonly T[], max: number): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const x of xs) {
    if (out.length >= max) break
    if (seen.has(x.id)) continue
    seen.add(x.id)
    out.push(x)
  }
  return out
}

/**
 * Reads a carry-over record. Anything malformed or stale counts as none;
 * malformed people, notes, things and meetings inside an otherwise good
 * record are left out; nobody carried is a relay contact; only carried ids
 * can be marked dummy.
 */
export function parseCarry(raw: string | null, now: number = Date.now()): CarryOver | null {
  if (!raw) return null
  let c: unknown
  try { c = JSON.parse(raw) } catch { return null }
  if (!isRec(c) || c.v !== 1 || !isStr(c.name) || !isNum(c.at)) return null
  if (now - c.at > CARRY_MAX_AGE_MS || c.at - now > CARRY_FUTURE_SKEW_MS) return null
  const demo = c.demo
  if (!Array.isArray(c.people) || !Array.isArray(c.inventory) || !Array.isArray(c.meetings) || !isRec(demo)
    || !Array.isArray(demo.people) || !Array.isArray(demo.inventory)) return null
  const people = uniqueById(c.people.map(cleanPerson).filter((p): p is Person => p !== null), CARRY_MAX.people)
  const inventory = uniqueById(c.inventory.filter(isItem), CARRY_MAX.inventory).map(withoutPicture)
  const meetings = uniqueById(c.meetings.filter(isMeeting), CARRY_MAX.meetings).map(quietMeeting)
  const carried = { people: new Set(people.map((p) => p.id)), inventory: new Set(inventory.map((i) => i.id)) }
  return {
    v: 1, at: c.at, name: c.name.trim().slice(0, 40), people, inventory, meetings,
    demo: {
      people: union(demo.people.filter((id): id is string => isStr(id) && carried.people.has(id))),
      inventory: union(demo.inventory.filter((id): id is string => isStr(id) && carried.inventory.has(id))),
    },
  }
}

/**
 * The carry-over waiting for the live app, if any. A record that is unreadable
 * or stale is dropped on the way (it can never apply); a browser that blocks
 * storage simply has none.
 */
export function readCarry(now: number = Date.now()): CarryOver | null {
  let raw: string | null
  try { raw = localStorage.getItem(CARRY_KEY) } catch { return null }
  const c = parseCarry(raw, now)
  if (raw && !c) dropCarry()
  return c
}

export function writeCarry(c: CarryOver): boolean {
  try { localStorage.setItem(CARRY_KEY, JSON.stringify(c)); return true } catch { return false }
}

export function dropCarry(): void {
  try { localStorage.removeItem(CARRY_KEY) } catch { /* nothing stored */ }
}
