// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (D4): tags nest. `tag:child nested_in tag:parent`; a member of a child is a member of its parents. The graph is a DAG,
 * at most MAX_DEPTH levels deep (a root tag is level 1), and a cycle is refused at write. Pure: the store is never mutated.
 */
import type { Store, Tuple } from './tuples'

export const MAX_DEPTH = 4

const parentsOf = (store: Store, tag: string): string[] =>
  store.filter((t) => t.subject === tag && t.relation === 'nested_in').map((t) => t.object)

/** Every tag above `tag` (its parents, their parents, ...), without `tag` itself. */
export function ancestors(store: Store, tag: string): Set<string> {
  const out = new Set<string>()
  const queue = [tag]
  while (queue.length) {
    for (const p of parentsOf(store, queue.shift()!)) {
      if (!out.has(p)) { out.add(p); queue.push(p) }
    }
  }
  return out
}

/** Levels from this tag up to its top: a root is 1; the longest chain wins (a DAG). A cycle is cut, not followed. */
export function depthOf(store: Store, tag: string, path: ReadonlySet<string> = new Set()): number {
  if (path.has(tag)) return 0
  const next = new Set([...path, tag])
  return 1 + Math.max(0, ...parentsOf(store, tag).map((p) => depthOf(store, p, next)))
}

/** Adds `child nested_in parent`, or throws: a cycle, or more than MAX_DEPTH levels anywhere. The given store is untouched. */
export function nest(store: Store, child: string, parent: string, by: string, since: Date): Store {
  if (child === parent || ancestors(store, parent).has(child)) throw new Error(`share sink: ${child} under ${parent} would make a cycle`)
  const tuple: Tuple = { subject: child, relation: 'nested_in', object: parent, since: since.toISOString(), by }
  const next = [...store, tuple]
  const tags = new Set(next.filter((t) => t.relation === 'nested_in').flatMap((t) => [t.subject, t.object]))
  const deepest = Math.max(0, ...[...tags].map((t) => depthOf(next, t)))
  if (deepest > MAX_DEPTH) throw new Error(`share sink: tag nesting deeper than ${MAX_DEPTH} levels`)
  return next
}
