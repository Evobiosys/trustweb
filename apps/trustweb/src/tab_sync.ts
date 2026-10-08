/**
 * Wave 6f, review: what a tab does when another tab (or the installed app) of the same browser profile saved this persona's record.
 *
 * Since 6f only ONE tab drains the relay (drain_lock.ts), so a new connection or a message lands in that tab and is saved there; the
 * other tabs must take that record over instead of writing their older copy back over it on their next save. Taking it over is not
 * always safe at once, and sometimes the other tab's change means this tab must stop altogether:
 *
 *   Adopt       the same identity saved a newer record and nothing here holds on to the old one: take it, draw it again.
 *   Wait        the same identity, but an open sheet or a field being typed in holds objects of the current record (a card's
 *               "Pass their asks on", a name being corrected): taking the record now would let that edit land on objects that are no
 *               longer saved, and it would be lost without a word. Take it as soon as the sheet closes or the field is left.
 *   Superseded  the record was removed (Reset this phone) or now belongs to another identity (a hand-over taken on this profile,
 *               a restore): this tab's copy must never be written back. It stops its drain and starts again from what is stored.
 *   Ignore      not a record this build can read (it stays as it is; this tab carries on with its own).
 *
 * Pure and DOM-free.
 */

export enum StoredChange {
  Adopt = 'adopt',
  Wait = 'wait',
  Superseded = 'superseded',
  Ignore = 'ignore',
}

/** The parts of a stored record this decision reads. */
export interface OwnedRecord {
  me: { id: string }
}

/**
 * `next`: the record the other tab saved, parsed (null: unreadable). `removed`: the record was taken away (the storage event's newValue
 * is null). `myId`: the identity this tab runs as. `busy`: a sheet is open or a field has the focus.
 */
export function storedChange(next: OwnedRecord | null, removed: boolean, myId: string, busy: boolean): StoredChange {
  if (removed) return StoredChange.Superseded
  if (!next) return StoredChange.Ignore
  if (next.me.id !== myId) return StoredChange.Superseded
  return busy ? StoredChange.Wait : StoredChange.Adopt
}
