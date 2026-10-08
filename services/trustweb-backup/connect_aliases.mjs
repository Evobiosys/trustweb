// The rules of a code's names (wave 6e; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10.9).
//
// A code holds at most MAX_NAMES names: one primary and up to two aliases. The functions here are PURE: they take the names a code holds now
// (an ordered list, the primary first) and say what should happen, as an Outcome. The store applies it (and persists it). No I/O, no logging.
//
//   Outcome   {kind: 'noop'}                       nothing changes (idempotent re-claim, release of a name not held)
//             {kind: 'set', names: string[]}       the code holds exactly this ordered list afterwards (primary first)
//             {kind: 'locked' | 'reserved' | 'taken' | 'too_many' | 'not_held'}   refused
//
// "Locked" = reserved AND held by this code: the admin granted it, so the app can neither release nor replace it.

export const MAX_NAMES = 3

const NOOP = Object.freeze({ kind: 'noop' })
const refuse = (kind) => Object.freeze({ kind })
const set = (names) => ({ kind: 'set', names })

/** The ordered names of an entry: the primary, then the aliases. */
export function namesOf(entry) {
  return [...(typeof entry.name === 'string' ? [entry.name] : []), ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
}

/** The entry fields for an ordered name list: `name` is the primary, `aliases` the rest and absent when empty. */
export function fieldsFor(names) {
  return { ...(names.length > 0 ? { name: names[0] } : {}), ...(names.length > 1 ? { aliases: names.slice(1) } : {}) }
}

/**
 * The answer body of POST /name and the admin routes: the primary (or ""), the aliases, and `locked`, the held names that are reserved (so granted by the admin and
 * beyond the app's reach: the app shows them with a lock and no Release button), in held order. `reserved`: (name) => boolean.
 */
export function answerFor(names, reserved = () => false) {
  return { name: names[0] ?? '', aliases: names.slice(1), locked: names.filter(reserved) }
}

/**
 * A CLAIM by the code's holder. `held`: the names now; `name`: the one wanted; `alias`: as an alias (else as the primary);
 * `reserved`: (name) => boolean; `takenByOther`: is `name` held by another live code?
 */
export function planClaim({ held, name, alias, reserved, takenByOther }) {
  const isHeld = held.includes(name)
  if (alias ? isHeld : held[0] === name) return NOOP
  if (!alias && isHeld) return reserved(held[0]) ? refuse('locked') : set([name, ...held.filter((n) => n !== name)]) // promote: a swap, the count stays
  if (!alias && held.length > 0 && reserved(held[0])) return refuse('locked') // would replace a granted name
  if (reserved(name)) return refuse('reserved')
  if (takenByOther) return refuse('taken')
  if (alias) return held.length >= MAX_NAMES ? refuse('too_many') : set([...held, name]) // no primary yet: the name becomes the primary
  return set([name, ...held.slice(1)]) // a new primary replaces the old one (6b: one primary per code)
}

/** A RELEASE by the holder. `name` = the name to free, or null for the legacy "release the primary". */
export function planRelease({ held, name, reserved }) {
  const target = name === null ? held[0] : name
  if (target === undefined || !held.includes(target)) return NOOP
  return reserved(target) ? refuse('locked') : set(held.filter((n) => n !== target))
}

/** A GRANT by the admin (reserved allowed): `takenByOther` as in planClaim. The old primary is demoted to an alias, never freed. */
export function planGrant({ held, name, alias, takenByOther }) {
  const isHeld = held.includes(name)
  if (alias ? isHeld : held[0] === name) return NOOP
  if (!alias && isHeld) return set([name, ...held.filter((n) => n !== name)])
  if (takenByOther) return refuse('taken')
  if (held.length >= MAX_NAMES) return refuse('too_many')
  return set(alias ? [...held, name] : [name, ...held])
}

/** A REMOVE by the admin (also a locked name). */
export function planRemove({ held, name }) {
  return held.includes(name) ? set(held.filter((n) => n !== name)) : refuse('not_held')
}
