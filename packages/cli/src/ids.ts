// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Typed ids, the share sink's spelling: `person:<id>`, `tag:<id>`, `zone:<ladder zone>`, `item:<id>`. On the command line
 * a bare id is allowed where the kind is clear (`trustweb person add ada` = person:ada); a prefixed id is always accepted
 * and checked against the kind the command expects. Nothing here touches the record.
 */
import { Zone, isZone, LADDER } from './sink.ts'

export type Kind = 'person' | 'tag' | 'zone' | 'item'
export const KINDS: readonly Kind[] = ['person', 'tag', 'zone', 'item']

/** A bare id: starts with a letter or digit; letters, digits, `. _ - @` after; at most 80 characters; never a colon or a space. */
export const BARE_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,79}$/

/** An id the command line could not use (exit code 1). */
export class IdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdError'
  }
}

export interface TypedId {
  kind: Kind
  bare: string
  /** The full `kind:bare` spelling. */
  id: string
}

/** Reads `kind:bare` or a bare id of `fallback` kind; `allowed` limits which kinds the command takes. */
export function parseId(text: string, fallback: Kind, allowed: readonly Kind[] = [fallback]): TypedId {
  const colon = text.indexOf(':')
  const kind = colon > 0 ? text.slice(0, colon) : fallback
  const bare = colon > 0 ? text.slice(colon + 1) : text
  if (!KINDS.includes(kind as Kind)) throw new IdError(`"${text}": unknown id kind "${kind}" (one of ${KINDS.join(', ')})`)
  if (!allowed.includes(kind as Kind)) throw new IdError(`"${text}": a ${allowed.join(' or ')} id is expected here, not a ${kind}`)
  if (kind === 'zone') {
    if (!isZone(bare)) throw new IdError(`"${bare}" is not a trust zone (the ladder: ${LADDER.join(' < ')})`)
  } else if (!BARE_ID.test(bare)) {
    throw new IdError(`"${bare}" is not a valid ${kind} id (letters, digits, . _ - @; starts with a letter or digit; at most 80 characters)`)
  }
  return { kind: kind as Kind, bare, id: `${kind}:${bare}` }
}

export const personId = (text: string): TypedId => parseId(text, 'person')
export const tagId = (text: string): TypedId => parseId(text, 'tag')
export const itemId = (text: string): TypedId => parseId(text, 'item')

/** A ladder zone from `friend` or `zone:friend`. */
export function zoneOf(text: string): Zone {
  return parseId(text, 'zone').bare as Zone
}

/** `person:ada` -> `ada`; a bare id stays as it is. */
export const bare = (id: string): string => (id.includes(':') ? id.slice(id.indexOf(':') + 1) : id)
