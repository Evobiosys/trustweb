// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 23 (share sink): export. JSONL is the primary format (the store itself); Markdown is one page per person or tag. */
import { canAccess, personZone } from './check'
import { type Store, type Tuple, isLive } from './tuples'
import { ALL_ZONES, type Zone } from './zones'

const KEYS = ['subject', 'relation', 'object', 'zone', 'tag', 'since', 'until', 'by'] as const

/** One line per tuple, keys in a fixed order, so the same store always writes the same bytes. */
export const toJsonl = (store: Store): string =>
  store.map((t) => JSON.stringify(Object.fromEntries(KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])))).join('\n') + (store.length ? '\n' : '')

const line = (t: Tuple): string => `${t.subject} ${t.relation} ${t.object}`
const list = (xs: string[], none: string): string => (xs.length ? xs : [none]).map((x) => `- ${x}`).join('\n')
const items = (store: Store): string[] =>
  [...new Set(store.filter((t) => /^(item|file):/.test(t.object)).map((t) => t.object))].sort()

/** A page for `person:<id>` (zone, tags, what they can see and why) or `tag:<id>` (who carries it, what it opens). */
export function toMarkdown(store: Store, id: string, now: Date, active: readonly Zone[] = ALL_ZONES): string {
  const live = store.filter((t) => isLive(t, now))
  if (id.startsWith('tag:')) {
    const carriers = live.filter((t) => t.relation === 'has_tag' && t.object === id).map((t) => t.subject).sort()
    const opened = items(live.filter((t) => t.subject === id))
    return `# ${id}\n\n## Carried by\n\n${list(carriers, 'nobody')}\n\n## Opens\n\n${list(opened, 'nothing')}\n`
  }
  const tags = live.filter((t) => t.subject === id && t.relation === 'has_tag').map((t) => t.object).sort()
  const seen = items(live).flatMap((item) => {
    const r = canAccess(live, id, item, now, active)
    return r.allowed ? [`${item}\n${r.why.map((t) => `  - ${line(t)}`).join('\n')}`] : []
  })
  return `# ${id}\n\n- zone: ${personZone(live, id, now, active).zone}\n- tags: ${tags.join(', ') || 'none'}\n\n## Can see\n\n${list(seen, 'nothing')}\n`
}
