// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Device sync v2, the record log (prototype; design: docs/design/device-sync-e2ee.md, "Conflicts"). Pure: no DOM, no network, no storage.
 *
 * The record as an append-only log of operations, one chain per device: sovereign_switch.ts already calls the append-only JSONL log "the
 * shape the record moves to"; this is that log with what two devices need to merge it.
 * - An op is never edited or removed. `put` sets an entity (a person, a resource, a setting ... under its sync_core.ts key), `add` puts an
 *   element into a grow-only set (note lines, chat messages), `retract` hides an entity (the value stays in the log, readable).
 * - Each op names its device (`dev`, a random id, not a DID), its number on that device (`n`) and the id of the op before (`prev`); its id
 *   is the SHA-256 of all of that, so a changed op is a different op and an altered one is refused.
 * - Ordering is a hybrid logical clock (HLC: wall time, plus a counter, and never behind anything already seen). An edit made after seeing
 *   another device's edit therefore orders after it, whatever the two wall clocks say (v1's caveat: "a wrong clock can win").
 * - `base` is the op the device saw as current for that key when it wrote. Two ops on one key with the same base were written without
 *   seeing each other: that is a conflict. The later one (HLC) is shown, the other is listed and stays in the log.
 * Merging two logs is the union of their ops (by id): the same on every device, in any order, any number of times (a CRDT, conflict-free
 * replicated data type). materialise() folds a log into values in one total order, so every device shows the same record.
 */

export interface Hlc { t: number; c: number }

export type OpKind = 'put' | 'add' | 'retract'

export interface Op {
  id: string
  dev: string
  n: number
  prev: string | null
  hlc: Hlc
  key: string
  op: OpKind
  val?: unknown
  base?: string | null
}

export interface DeviceLog {
  /** This device's id in the log (random; a log restored from a backup should take a new one, see the design note). */
  dev: string
  clock: Hlc
  /** In the order this device learnt them. */
  ops: Op[]
}

export interface Conflict { key: string; base: string | null; ops: string[]; kept: string }

export interface Materialised {
  values: Record<string, unknown>
  sets: Record<string, unknown[]>
  conflicts: Conflict[]
}

export type Frontier = Record<string, number>

const MAX_KEY = 200
const MAX_DEV = 64

export const emptyLog = (dev: string): DeviceLog => ({ dev, clock: { t: 0, c: 0 }, ops: [] })

// ---------------------------------------------------------------------------
// Hybrid logical clock
// ---------------------------------------------------------------------------

export function compareHlc(a: Hlc, b: Hlc): number {
  return a.t - b.t || a.c - b.c
}

/** The stamp of a local event. */
export function tick(clock: Hlc, now: number): Hlc {
  return now > clock.t ? { t: now, c: 0 } : { t: clock.t, c: clock.c + 1 }
}

/** The clock after seeing `remote`: past both it and the own clock. */
export function recvClock(clock: Hlc, remote: Hlc, now: number): Hlc {
  const t = Math.max(clock.t, remote.t, now)
  if (t === clock.t && t === remote.t) return { t, c: Math.max(clock.c, remote.c) + 1 }
  if (t === clock.t) return { t, c: clock.c + 1 }
  if (t === remote.t) return { t, c: remote.c + 1 }
  return { t, c: 0 }
}

/** The one order every device folds in: clock, then device, then id. */
export function compareOps(a: Op, b: Op): number {
  return compareHlc(a.hlc, b.hlc) || (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Content ids
// ---------------------------------------------------------------------------

/** JSON with object keys sorted at every level, so the same value always hashes the same, wherever it was parsed. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

function b64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function idOf(o: Omit<Op, 'id'>): Promise<string> {
  const body = canonical({ v: 1, dev: o.dev, n: o.n, prev: o.prev, hlc: o.hlc, key: o.key, op: o.op, val: o.val, base: o.base ?? null })
  return b64u(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(body) as BufferSource)))
}

export async function verifyOp(op: Op): Promise<boolean> {
  const { id, ...rest } = op
  return id === (await idOf(rest))
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The untrusted-input boundary: an op from another device is exactly this shape, or nothing. */
export function isOp(v: unknown): v is Op {
  if (!isObj(v) || !isObj(v.hlc)) return false
  if (typeof v.id !== 'string' || v.id.length !== 43) return false
  if (typeof v.dev !== 'string' || !v.dev || v.dev.length > MAX_DEV) return false
  if (!isNat(v.n) || v.n < 1 || !isNat(v.hlc.t) || !isNat(v.hlc.c)) return false
  if (v.prev !== null && typeof v.prev !== 'string') return false
  if ((v.n === 1) !== (v.prev === null)) return false
  if (typeof v.key !== 'string' || !v.key || v.key.length > MAX_KEY) return false
  if (v.base !== undefined && v.base !== null && typeof v.base !== 'string') return false
  if (v.op === 'put') return v.val !== undefined
  if (v.op === 'add') return isObj(v.val) && typeof v.val.id === 'string'
  return v.op === 'retract' && v.val === undefined
}

// ---------------------------------------------------------------------------
// Appending
// ---------------------------------------------------------------------------

/** The op currently deciding `key` (the last put or retract in the fold order), or undefined. */
function headOf(ops: Op[], key: string): Op | undefined {
  let head: Op | undefined
  for (const o of ops) if (o.key === key && o.op !== 'add' && (!head || compareOps(o, head) > 0)) head = o
  return head
}

function lastOwn(log: DeviceLog): Op | undefined {
  let last: Op | undefined
  for (const o of log.ops) if (o.dev === log.dev && (!last || o.n >= last.n)) last = o
  return last
}

export interface Change { key: string; op: OpKind; val?: unknown }

/** One more op on this device's chain. Returns a new log; the one given is not changed. */
export async function append(log: DeviceLog, ch: Change, now: number): Promise<{ log: DeviceLog; op: Op }> {
  const last = lastOwn(log)
  const hlc = tick(log.clock, now)
  const rest: Omit<Op, 'id'> = { dev: log.dev, n: (last?.n ?? 0) + 1, prev: last?.id ?? null, hlc, key: ch.key, op: ch.op }
  if (ch.op !== 'retract') rest.val = ch.val
  if (ch.op !== 'add') rest.base = headOf(log.ops, ch.key)?.id ?? null
  const op: Op = { id: await idOf(rest), ...rest }
  return { log: { dev: log.dev, clock: hlc, ops: [...log.ops, op] }, op }
}

/**
 * The bridge from today's record (sync_core.ts keeps no history): every [key, value] whose value differs from what the log shows becomes a
 * put. Run before each sync, like sync_core.ts refreshStamps, so none of the edit sites needs to change.
 */
export async function observe(log: DeviceLog, entries: [string, unknown][], now: number): Promise<{ log: DeviceLog; appended: number }> {
  const shown = materialise(log.ops).values
  let out = log
  let appended = 0
  for (const [key, val] of entries) {
    if (Object.prototype.hasOwnProperty.call(shown, key) && canonical(shown[key]) === canonical(val)) continue
    out = (await append(out, { key, op: 'put', val }, now)).log
    appended++
  }
  return { log: out, appended }
}

// ---------------------------------------------------------------------------
// Exchange and merge
// ---------------------------------------------------------------------------

/** Per device, the highest op number this log holds (a version vector). */
export function frontier(log: DeviceLog): Frontier {
  const f: Frontier = {}
  for (const o of log.ops) if ((f[o.dev] ?? 0) < o.n) f[o.dev] = o.n
  return f
}

/** What a device with frontier `theirs` lacks, each device's chain in order. */
export function missingFor(log: DeviceLog, theirs: Frontier): Op[] {
  const has = (dev: string): number => (Object.prototype.hasOwnProperty.call(theirs, dev) && isNat(theirs[dev]) ? theirs[dev] : 0)
  return log.ops.filter((o) => o.n > has(o.dev)).sort((a, b) => (a.dev < b.dev ? -1 : a.dev > b.dev ? 1 : a.n - b.n))
}

export interface MergeOutcome {
  log: DeviceLog
  added: Op[]
  /** shape: not an op; hash: the id does not match the content; gap: its predecessor is not known (it may come with a later sync). */
  rejected: { id: string; why: 'shape' | 'hash' | 'gap' }[]
  /** A device number seen with two different ops: that device reused its counter (restored from a backup). Both ops are kept. */
  forks: { dev: string; n: number }[]
}

/** The union of `mine` and `incoming`, each op checked. Returns a new log; the clock moves past every op taken in. */
export async function mergeLogs(mine: DeviceLog, incoming: unknown[], now: number): Promise<MergeOutcome> {
  const known = new Map(mine.ops.map((o) => [o.id, o]))
  const rejected: MergeOutcome['rejected'] = []
  let pending: Op[] = []
  for (const x of incoming) {
    if (!isOp(x)) { rejected.push({ id: isObj(x) && typeof x.id === 'string' ? x.id.slice(0, 43) : '', why: 'shape' }); continue }
    if (known.has(x.id) || pending.some((p) => p.id === x.id)) continue
    if (!(await verifyOp(x))) { rejected.push({ id: x.id, why: 'hash' }); continue }
    pending.push(x)
  }
  const added: Op[] = []
  const forks: MergeOutcome['forks'] = []
  for (let progress = true; progress && pending.length;) {
    progress = false
    const wait: Op[] = []
    for (const o of pending) {
      const p = o.prev === null ? null : known.get(o.prev)
      if (o.prev !== null && !(p && p.dev === o.dev && p.n === o.n - 1)) { wait.push(o); continue }
      if ([...known.values()].some((k) => k.dev === o.dev && k.n === o.n) && !forks.some((f) => f.dev === o.dev && f.n === o.n)) forks.push({ dev: o.dev, n: o.n })
      known.set(o.id, o)
      added.push(o)
      progress = true
    }
    pending = wait
  }
  for (const o of pending) rejected.push({ id: o.id, why: 'gap' })
  let clock = mine.clock
  for (const o of added) clock = recvClock(clock, o.hlc, now)
  return { log: { dev: mine.dev, clock: added.length ? clock : mine.clock, ops: [...mine.ops, ...added] }, added, rejected, forks }
}

// ---------------------------------------------------------------------------
// Folding a log into a record
// ---------------------------------------------------------------------------

/** The values (last put per key, unless retracted), the sets (elements by id, the later op winning), and the conflicts, the same on every device. */
export function materialise(ops: Op[]): Materialised {
  const sorted = [...ops].sort(compareOps)
  const reg = new Map<string, Op>()
  const sets = new Map<string, Map<string, unknown>>()
  const siblings = new Map<string, Map<string | null, Op[]>>()
  for (const o of sorted) {
    if (o.op === 'add') {
      const s = sets.get(o.key) ?? new Map<string, unknown>()
      s.set((o.val as { id: string }).id, o.val)
      sets.set(o.key, s)
      continue
    }
    reg.set(o.key, o)
    const byBase = siblings.get(o.key) ?? new Map<string | null, Op[]>()
    const base = o.base ?? null
    byBase.set(base, [...(byBase.get(base) ?? []), o])
    siblings.set(o.key, byBase)
  }
  const values: Record<string, unknown> = {}
  for (const [k, o] of [...reg.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) if (o.op === 'put') values[k] = o.val
  const outSets: Record<string, unknown[]> = {}
  for (const [k, s] of [...sets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    outSets[k] = [...s.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v)
  }
  const conflicts: Conflict[] = []
  for (const [key, byBase] of [...siblings.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    for (const [base, group] of byBase) {
      if (group.length < 2) continue
      conflicts.push({ key, base, ops: group.map((o) => o.id), kept: group[group.length - 1].id })
    }
  }
  return { values, sets: outSets, conflicts }
}
