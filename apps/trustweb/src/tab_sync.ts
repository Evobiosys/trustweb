/**
 * Wave 6f, review: what a tab does when another tab (or the installed app) of the same browser profile saved this persona's record.
 *
 * Since 6f only ONE tab drains the relay (drain_lock.ts), so a new connection or a message lands in that tab and is saved there; the
 * other tabs take that record over at once, or their next save would write their older copy back over it.
 *
 *   Adopt       the same identity saved a newer record: take it over IN PLACE (adoptInPlace). The record object, and every object in
 *               it that carries an id (a card, a connection, a line, a demo account), stays the very object this tab already holds,
 *               with the newer contents. An open sheet's handlers hold such objects ("Pass their asks on" sets p.passOn, the add sheet
 *               sets person.name): their edit lands on the live record and is saved with it, instead of on a copy no longer saved.
 *   Superseded  the record was removed (Reset this phone) or now belongs to another identity (a hand-over taken on this profile,
 *               a restore): this tab's copy must never be written back. It stops its drain and starts again from what is stored.
 *   Ignore      not a record this build can read (it stays as it is; this tab carries on with its own).
 *
 * Pure and DOM-free.
 */

export enum StoredChange {
  Adopt = 'adopt',
  Superseded = 'superseded',
  Ignore = 'ignore',
}

/** The parts of a stored record this decision reads. */
export interface OwnedRecord {
  me: { id: string }
}

/** `next`: the record the other tab saved, parsed (null: unreadable). `removed`: it was taken away. `myId`: the identity this tab runs as. */
export function storedChange(next: OwnedRecord | null, removed: boolean, myId: string): StoredChange {
  if (removed) return StoredChange.Superseded
  if (!next) return StoredChange.Ignore
  return next.me.id === myId ? StoredChange.Adopt : StoredChange.Superseded
}

type Plain = Record<string, unknown>

const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Keys that would reach an object's prototype if assigned: never copied (a record is JSON, it has no business holding them). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function adoptObject(cur: Plain, next: Plain): Plain {
  for (const k of Object.keys(cur)) if (!Object.prototype.hasOwnProperty.call(next, k)) delete cur[k]
  for (const k of Object.keys(next)) {
    if (UNSAFE_KEYS.has(k)) continue
    cur[k] = adoptInPlace(cur[k], next[k])
  }
  return cur
}

function adoptArray(cur: unknown[], next: unknown[]): unknown[] {
  const byId = new Map<string, Plain>()
  for (const x of cur) if (isPlain(x) && typeof x.id === 'string' && !byId.has(x.id)) byId.set(x.id, x)
  const items = next.map((n) => {
    if (!isPlain(n) || typeof n.id !== 'string') return n
    const old = byId.get(n.id)
    if (!old) return n
    byId.delete(n.id) // one object, one place
    return adoptObject(old, n)
  })
  cur.length = 0
  for (const x of items) cur.push(x)
  return cur
}

/**
 * `cur` with the contents of `next`, keeping object identity wherever it can: the same plain object, the same array, and in an array
 * the same object for the same `id`. Anything else (a value, an object without id in an array, a change of type) is `next`'s.
 * Keys `next` does not have are removed. Never throws on JSON values.
 */
export function adoptInPlace(cur: unknown, next: unknown): unknown {
  if (Array.isArray(cur) && Array.isArray(next)) return adoptArray(cur, next)
  if (isPlain(cur) && isPlain(next)) return adoptObject(cur, next)
  return next
}
