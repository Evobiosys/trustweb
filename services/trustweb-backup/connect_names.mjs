// Username rules of the connect codes (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
// A name is 3 to 30 characters of [a-z0-9._-], starts and ends with [a-z0-9], must not look like a connect code (22 characters of
// [A-Za-z0-9_-]) and must not be reserved. The server never folds case: the client lowercases what the person types.
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

const squash = (name) => name.replace(/[._-]/g, '')

/** Is `name` reserved? */
export function isReserved(name) {
  return RESERVED_SET.has(squash(name))
}

/** Does `name` have the right shape (charset, length, edges) and not look like a code? Says nothing about reservation. */
export function isNameShape(name) {
  return typeof name === 'string' && NAME_RE.test(name) && !CODE_RE.test(name)
}

/** Can a person claim `name`? (shape and not reserved) */
export function isClaimableName(name) {
  return isNameShape(name) && !isReserved(name)
}
