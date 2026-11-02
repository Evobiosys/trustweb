// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The record log: the owner's record as an append-only list of small signed-off-by-hash changes, one chain per device.
 *
 * Why a log instead of the v3 bundle (apps/trustweb/src/sync_core.ts): v3 ships the whole record and merges two STATES. A state cannot say
 * what happened, only what is, so v3 has to guess: a stamp found at sync time, the newer wall clock wins, and nothing can ever be deleted
 * (a deletion looks exactly like "the other side never had it"). A log ships the CHANGES. Every change keeps its author device, its place in
 * that device's history and what that device had already seen, so "edited after seeing the other edit" and "edited at the same time" are
 * facts, not guesses, and a delete is a change like any other (a tombstone; nothing is ever removed from the log itself).
 *
 * Why vector clocks: each entry carries `vc`, the heads (highest contiguous seq per device) its device knew when it was written. If one
 * entry's vc dominates another's, it was written after seeing it: it wins, and nobody is asked. Only when neither dominates (two devices
 * edited the same field without having synced in between) is there a real conflict; then a fixed rule picks a winner and the loser is
 * listed for "Review merge", never silently dropped.
 *
 * Deterministic means: the result of materialize() depends only on the SET of entries, not on the order they arrived in nor on which
 * device computes it. Two devices holding the same entries produce byte-identical JSON (keys sorted, conflicts sorted, entries copied
 * into one canonical shape). That is what lets both sides show the same record and the same conflicts after one sync round.
 *
 * Integrity: an entry's `hash` is SHA-256 over the canonical JSON of everything else, and `prev` links it to its device's previous entry,
 * so a relay or a buggy peer cannot alter, reorder or drop the middle of a device's history unnoticed. merge() verifies and REPORTS
 * every rejection (malformed / bad-hash / chain-gap / fork). The hashes are integrity, not authentication: who may send entries at all is
 * decided by the sealed channel (seal.ts, pair keys), not here.
 *
 * Wall-clock caveat: `at` is the author's clock. It never overrides causality, but between two CONCURRENT edits the larger `at` wins
 * (device id as tiebreak), so a device with a clock far ahead wins those ties it should not. The loser stays visible as a FieldConflict.
 * Between a concurrent delete and edit the delete wins regardless of clocks (conservative: an edit made without knowing about the delete
 * does not resurrect the entity; a later edit made after seeing the delete does).
 *
 * Limits (honest labeling, I7): no compaction or snapshots yet, so the log only grows and materialize() is O(entries²) per entity; it is
 * meant for one owner's 2–5 devices, not for many writers. merge() does not require causal completeness across devices (an entry may name
 * a device whose entries we do not have yet); dominance is then judged on what we hold, and a full sync round fixes it. A fork (one device
 * id, two different histories, e.g. a device restored from an old backup that kept writing) is rejected, not repaired: that device has to
 * continue under a new device key / id. Nothing here is encrypted; that is seal.ts.
 */
import { canonicalJson, sha256, toB64u, utf8 } from './bytes.ts'

export type Op = { t: 'put'; kind: string; id: string; field: string; value: unknown } | { t: 'del'; kind: string; id: string }
export interface LogEntry { id: string; device: string; seq: number; vc: Record<string, number>; at: number; prev: string; hash: string; op: Op }
export type RejectReason = 'malformed' | 'bad-hash' | 'chain-gap' | 'fork'
export interface MergeReport { added: number; duplicates: number; rejected: { id: string; reason: RejectReason }[] }
/** `field` is '' for an entity-level conflict (a put that lost against a concurrent del). */
export interface FieldConflict { kind: string; id: string; field: string; kept: LogEntry; dropped: LogEntry }
/** entities[kind][id][field]; a deleted entity is absent. */
export interface Materialized { entities: Record<string, Record<string, Record<string, unknown>>>; conflicts: FieldConflict[] }
export interface LogJson { v: 1; device: string; entries: LogEntry[] }

/** toB64u(sha256(utf8(canonicalJson(e)))) over every field except `hash` (a stray `hash` key is ignored). */
export async function entryHash(e: Omit<LogEntry, 'hash'>): Promise<string> {
  const { id, device, seq, vc, at, prev, op } = e
  return toB64u(await sha256(utf8(canonicalJson({ id, device, seq, vc, at, prev, op }))))
}

/** a >= b on every device named in b. */
export function dominates(a: Record<string, number>, b: Record<string, number>): boolean {
  for (const [d, n] of Object.entries(b)) if ((a[d] ?? 0) < n) return false
  return true
}

/** Neither vc dominates the other. */
export function isConcurrent(a: LogEntry, b: LogEntry): boolean {
  return !dominates(a.vc, b.vc) && !dominates(b.vc, a.vc)
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** The one total order used by materialize: (at, device, seq) ascending. Plain code-unit string compare, never locale. */
export function compareEntries(a: LogEntry, b: LogEntry): number {
  return a.at - b.at || cmpStr(a.device, b.device) || a.seq - b.seq
}

// ---- shape: parse untrusted input into one canonical, frozen shape --------------------------------------------------------------

const ENTRY_KEYS = new Set(['id', 'device', 'seq', 'vc', 'at', 'prev', 'hash', 'op'])
const PUT_KEYS = new Set(['t', 'kind', 'id', 'field', 'value'])
const DEL_KEYS = new Set(['t', 'kind', 'id'])

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const onlyKeys = (o: Record<string, unknown>, allowed: Set<string>): boolean => Object.keys(o).every((k) => allowed.has(k))
const isSeq = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1

/** A fresh JSON copy of a JSON value (sorted keys), or undefined when it is not JSON. */
function jsonCopy(v: unknown): unknown {
  if (v === undefined) return undefined
  try {
    return JSON.parse(canonicalJson(v)) as unknown
  } catch {
    return undefined
  }
}

function parseOp(x: unknown): Op | null {
  if (!isRecord(x) || typeof x['kind'] !== 'string' || typeof x['id'] !== 'string') return null
  if (x['t'] === 'del') return onlyKeys(x, DEL_KEYS) ? { t: 'del', kind: x['kind'], id: x['id'] } : null
  if (x['t'] !== 'put' || !onlyKeys(x, PUT_KEYS) || typeof x['field'] !== 'string') return null
  const value = jsonCopy(x['value'])
  return value === undefined ? null : { t: 'put', kind: x['kind'], id: x['id'], field: x['field'], value }
}

/** Sets an own enumerable property, so a key like '__proto__' (from the wire) is data, never the prototype. */
function setOwn(o: object, k: string, v: unknown): void {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
}

function sortedVc(vc: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const k of Object.keys(vc).sort()) setOwn(out, k, vc[k])
  return out
}

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}

/** Shape check only (no hash, no chain). Returns a fresh, canonical, frozen copy, or null. */
function parseEntry(x: unknown): LogEntry | null {
  if (!isRecord(x) || !onlyKeys(x, ENTRY_KEYS)) return null
  const { id, device, seq, vc, at, prev, hash } = x
  if (typeof device !== 'string' || device === '' || !isSeq(seq) || id !== `${device}:${seq}`) return null
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof prev !== 'string' || typeof hash !== 'string') return null
  if (!isRecord(vc) || vc[device] !== seq) return null
  for (const [d, n] of Object.entries(vc)) if (d === '' || !isSeq(n)) return null
  const op = parseOp(x['op'])
  if (!op) return null
  return canonicalEntry({ id, device, seq, vc: vc as Record<string, number>, at, prev, hash, op })
}

/**
 * The one shape every stored entry has: fixed top-level key order, vc keys sorted, frozen. JSON.stringify of an entry (as it appears in
 * materialize().conflicts) is then the same on every device, whether the entry was appended here or merged in.
 */
function canonicalEntry(e: LogEntry): LogEntry {
  return deepFreeze({ id: e.id, device: e.device, seq: e.seq, vc: sortedVc(e.vc), at: e.at, prev: e.prev, hash: e.hash, op: e.op })
}

const idOf = (x: unknown): string => (isRecord(x) && typeof x['id'] === 'string' ? x['id'] : '')

// ---- the log -------------------------------------------------------------------------------------------------------------------

export class RecordLog {
  readonly device: string
  private readonly list: LogEntry[] = []
  private readonly byId = new Map<string, LogEntry>()
  /** append() and merge() await hashing; this queue keeps them from interleaving (two appends must not take the same seq). */
  private tail: Promise<unknown> = Promise.resolve()

  /** `entries` are trusted (from own storage): copied into canonical shape, not verified. A repeated id keeps the first. */
  constructor(device: string, entries?: LogEntry[]) {
    this.device = device
    for (const e of entries ?? []) {
      if (this.byId.has(e.id)) continue
      this.add(canonicalEntry({ ...e, op: parseOp(e.op) ?? structuredClone(e.op) }))
    }
  }

  /** Insertion order. The entries are frozen. */
  entries(): readonly LogEntry[] {
    return this.list.slice()
  }

  /** device → highest contiguous seq known. */
  heads(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const d of [...new Set(this.list.map((e) => e.device))].sort()) {
      let n = 0
      while (this.byId.has(`${d}:${n + 1}`)) n++
      if (n > 0) out[d] = n
    }
    return out
  }

  async append(op: Op, at: number): Promise<LogEntry> {
    const clean = parseOp(op)
    if (!clean) throw new TypeError('RecordLog.append: op is not a valid put/del with a JSON value')
    if (!Number.isFinite(at)) throw new TypeError('RecordLog.append: at must be a finite number')
    return this.locked(async () => {
      const heads = this.heads()
      const seq = (heads[this.device] ?? 0) + 1
      const prev = seq === 1 ? '' : (this.byId.get(`${this.device}:${seq - 1}`)?.hash ?? '')
      const body = { id: `${this.device}:${seq}`, device: this.device, seq, vc: sortedVc({ ...heads, [this.device]: seq }), at, prev, op: clean }
      const entry = canonicalEntry({ ...body, hash: await entryHash(body) })
      this.add(entry)
      return entry
    })
  }

  /** Every entry (device, seq) with seq > heads[device] ?? 0, ordered by device then seq. */
  since(heads: Record<string, number>): LogEntry[] {
    return this.list.filter((e) => e.seq > (heads[e.device] ?? 0)).sort((a, b) => cmpStr(a.device, b.device) || a.seq - b.seq)
  }

  /** Set union by id with verification; every rejection is reported. Never throws on bad input; never keeps a reference to it. */
  async merge(incoming: unknown[]): Promise<MergeReport> {
    return this.locked(async () => {
      const report: MergeReport = { added: 0, duplicates: 0, rejected: [] }
      const parsed: LogEntry[] = []
      for (const x of Array.isArray(incoming) ? incoming : []) {
        const e = parseEntry(x)
        if (e) parsed.push(e)
        else report.rejected.push({ id: idOf(x), reason: 'malformed' })
      }
      parsed.sort((a, b) => cmpStr(a.device, b.device) || a.seq - b.seq)
      for (const e of parsed) {
        if ((await entryHash(e)) !== e.hash) {
          report.rejected.push({ id: e.id, reason: 'bad-hash' })
          continue
        }
        const known = this.byId.get(e.id)
        if (known) {
          if (known.hash === e.hash) report.duplicates++
          else report.rejected.push({ id: e.id, reason: 'fork' })
          continue
        }
        // Accepted entries of this batch are already in byId, so "earlier in the batch" is covered; a rejected one is not, so its
        // successors land here as chain-gaps instead of being accepted on top of a hole.
        const expectedPrev = e.seq === 1 ? '' : this.byId.get(`${e.device}:${e.seq - 1}`)?.hash
        if (expectedPrev === undefined || expectedPrev !== e.prev) {
          report.rejected.push({ id: e.id, reason: 'chain-gap' })
          continue
        }
        this.add(e)
        report.added++
      }
      return report
    })
  }

  /**
   * The record, decided only by the set of entries. Per entity (kind, id), over all its puts and dels:
   * - the "live" candidates are those no other entry of the entity causally follows. If one of them is a del, the entity is deleted
   *   (a del beats a concurrent put) and every put the del did not see is listed (field ''), one per field branch.
   * - otherwise the entity exists, built from the puts no del causally follows (a revival keeps only what came after / beside the del).
   *   Per field: of the puts no other put on that field follows, the largest (at, device, seq) wins; the others are FieldConflicts.
   * A causally later put therefore always wins, whatever its wall clock, and nothing superseded can come back as a winner.
   */
  materialize(): Materialized {
    const groups = new Map<string, { kind: string; id: string; puts: LogEntry[]; dels: LogEntry[] }>()
    for (const e of [...this.list].sort(compareEntries)) {
      const key = `${e.op.kind.length}:${e.op.kind}|${e.op.id}`
      let g = groups.get(key)
      if (!g) groups.set(key, (g = { kind: e.op.kind, id: e.op.id, puts: [], dels: [] }))
      ;(e.op.t === 'put' ? g.puts : g.dels).push(e)
    }
    const entities = new Map<string, Map<string, Map<string, unknown>>>()
    const conflicts: FieldConflict[] = []
    for (const g of groups.values()) {
      const live = frontier([...g.puts, ...g.dels])
      const liveDels = live.filter((e) => e.op.t === 'del')
      const puts = g.puts.filter((p) => !g.dels.some((d) => follows(d, p)))
      const byField = new Map<string, LogEntry[]>()
      for (const p of puts) {
        const f = (p.op as { field: string }).field
        byField.set(f, [...(byField.get(f) ?? []), p])
      }
      if (liveDels.length > 0) {
        const kept = best(liveDels)
        for (const ps of byField.values()) for (const p of frontier(ps)) conflicts.push({ kind: g.kind, id: g.id, field: '', kept, dropped: p })
        continue
      }
      const fields = new Map<string, unknown>()
      for (const [field, ps] of byField) {
        const heads = frontier(ps)
        const winner = best(heads)
        fields.set(field, (winner.op as { value: unknown }).value)
        for (const p of heads) if (p !== winner) conflicts.push({ kind: g.kind, id: g.id, field, kept: winner, dropped: p })
      }
      if (!entities.has(g.kind)) entities.set(g.kind, new Map())
      entities.get(g.kind)!.set(g.id, fields)
    }
    conflicts.sort((a, b) => cmpStr(a.kind, b.kind) || cmpStr(a.id, b.id) || cmpStr(a.field, b.field) || compareEntries(a.dropped, b.dropped))
    return { entities: toSortedObject(entities) as Materialized['entities'], conflicts }
  }

  toJSON(): LogJson {
    return { v: 1, device: this.device, entries: this.list.slice() }
  }

  /** null when `v` is not a LogJson (entry shapes are checked; hashes are not: this is our own storage). */
  static fromJSON(v: unknown): RecordLog | null {
    if (!isRecord(v) || v['v'] !== 1 || typeof v['device'] !== 'string' || v['device'] === '' || !Array.isArray(v['entries'])) return null
    const entries: LogEntry[] = []
    for (const x of v['entries']) {
      const e = parseEntry(x)
      if (!e) return null
      entries.push(e)
    }
    return new RecordLog(v['device'], entries)
  }

  private add(e: LogEntry): void {
    this.list.push(e)
    this.byId.set(e.id, e)
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn)
    this.tail = run.catch(() => undefined)
    return run
  }
}

/** a causally follows b: a's clock covers b's and not the other way round (equal clocks count as concurrent). */
function follows(a: LogEntry, b: LogEntry): boolean {
  return a !== b && dominates(a.vc, b.vc) && !dominates(b.vc, a.vc)
}

/** The entries no other entry of the list causally follows. */
function frontier(list: LogEntry[]): LogEntry[] {
  return list.filter((e) => !list.some((o) => follows(o, e)))
}

/** The largest by compareEntries, i.e. the larger (at, device), seq as the last tiebreak. `list` is non-empty. */
function best(list: LogEntry[]): LogEntry {
  return list.reduce((w, e) => (compareEntries(e, w) > 0 ? e : w))
}

/** Maps become plain objects and every object's keys are sorted (byte-identical JSON on every device); values are fresh copies. */
function toSortedObject(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(toSortedObject)
  const src = v instanceof Map ? v : isRecord(v) ? new Map(Object.entries(v)) : null
  if (!src) return v
  const out = {}
  for (const k of [...src.keys()].sort(cmpStr)) setOwn(out, k as string, toSortedObject(src.get(k)))
  return out
}
