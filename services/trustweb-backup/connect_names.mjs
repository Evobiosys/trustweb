// Username rules of the connect codes (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
// A name is 3 to 30 characters of [a-z0-9._-], starts and ends with [a-z0-9], must not look like a connect code (22 characters of
// [A-Za-z0-9_-]) and must not be reserved (the built-in list; since wave 6e the env RESERVED_NAMES too, checked by the store, not by the shape).
// The server never folds case: the client lowercases what the person types.
// Pure functions, no I/O, no logging.

export const CODE_RE = /^[A-Za-z0-9_-]{22}$/
export const NAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/

/** Names that stay with the service. Compared exactly, after "." "_" "-" are removed from both sides ("no-reply" == "noreply"). "jakob" is not reserved. */
const RESERVED = [
  'admin', 'administrator', 'root', 'trustweb', 'trustintheweb', 'support', 'evobiosys', 'idea2', 'help', 'info', 'security',
  'abuse', 'postmaster', 'webmaster', 'hostmaster', 'noreply', 'mail', 'www', 'api', 'app', 'connect', 'name', 'who', 'link',
  'relay', 'backup', 'hosted', 'system', 'official', 'staff', 'team', 'mod', 'moderator', 'null', 'undefined', 'anonymous',
  'everyone', 'signal', 'tana',
]
const RESERVED_SET = new Set(RESERVED)

/** The comparison form of a name: "." "_" "-" removed ("ja-kob" == "jakob"). */
export const squash = (name) => name.replace(/[._-]/g, '')

const CONFUSABLES = { 0: 'o', 1: 'l', 3: 'e', 5: 's', 7: 't' }

/** The lookalike form of a name: squashed, with the usual confusables mapped (0 to o, 1 to l, 3 to e, 5 to s, 7 to t, rn to m). "jap0ssert" == "japossert". */
export const confusableKey = (name) => squash(name).replace(/rn/g, 'm').replace(/[01357]/g, (c) => CONFUSABLES[c])

/** Is `name` on the built-in reserved list? (the env list of wave 6e is added by reservedChecker) */
export function isReserved(name) {
  return RESERVED_SET.has(squash(name))
}

/** Parses the RESERVED_NAMES setting: a comma list, trimmed, lowercased, empty items dropped. */
export function parseReservedList(raw) {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * The reserved predicate of a running service: the built-in list UNION `extra` (the env RESERVED_NAMES entries), both compared exactly
 * after squash. Returns (name) => boolean. A name that is reserved AND held by a code is a name the admin granted ("locked", wave 6e).
 */
export function reservedChecker(extra = []) {
  const extraSet = new Set(extra.map((n) => squash(String(n).trim().toLowerCase())).filter(Boolean))
  return (name) => {
    const key = squash(name)
    return RESERVED_SET.has(key) || extraSet.has(key)
  }
}

/** Does `name` have the right shape (charset, length, edges) and not look like a code? Says nothing about reservation. */
export function isNameShape(name) {
  return typeof name === 'string' && NAME_RE.test(name) && !CODE_RE.test(name)
}

/** Can a person claim `name`? (shape and not reserved) */
export function isClaimableName(name) {
  return isNameShape(name) && !isReserved(name)
}
