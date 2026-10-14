/**
 * From picked files to a reviewed list of contacts (wave 7). Pure: no DOM, no storage.
 * plan() reads and groups; apply() turns the person's answers into the new contact list.
 */
import type { Contact, ContactOrigin } from '../model'
import { findDuplicates, mergeContacts } from './dedup'
import type { DupGroup } from './dedup'
import { parseFile } from './detect'
import type { ContactSource, ImportedContact } from './types'

export interface FileInput {
  name: string
  text: string
}

export interface FileSummary {
  name: string
  format: ContactSource | null
  count: number
  skipped: number
}

export type Decision = 'same' | 'different'

export interface IntakePlan {
  files: FileSummary[]
  /** Contacts in the files that are not stored yet. */
  fresh: ImportedContact[]
  alreadyHere: number
  /** Stored contacts first, then `fresh`; the indexes of `groups` point in here. */
  combined: ImportedContact[]
  groups: DupGroup[]
}

const originKey = (o: ContactOrigin): string => `${o.source}\n${o.file}\n${o.sourceRef}`

function originOf(c: ImportedContact): ContactOrigin {
  return { source: c.source, file: c.file, sourceRef: c.sourceRef }
}

/** A stored contact in the parsers' shape, so it can be grouped and merged with new ones. */
function asImported(c: Contact): ImportedContact {
  const { id: _id, sources, ...rest } = c
  return { ...rest, ...sources[0] }
}

/** At most one stored contact per group (earlier "not the same" answers stand); fewer than two members drops it. */
function keepStoredApart(groups: DupGroup[], storedCount: number): DupGroup[] {
  return groups.flatMap((g) => {
    const firstStored = g.members.find((i) => i < storedCount)
    const members = g.members.filter((i) => i >= storedCount || i === firstStored)
    return members.length > 1 ? [{ ...g, members }] : []
  })
}

export function plan(stored: readonly Contact[], files: readonly FileInput[]): IntakePlan {
  const known = new Set(stored.flatMap((c) => c.sources.map(originKey)))
  const summaries: FileSummary[] = []
  const fresh: ImportedContact[] = []
  let alreadyHere = 0
  for (const f of files) {
    const { format, result } = parseFile(f.name, f.text)
    summaries.push({ name: f.name, format, count: result.contacts.length, skipped: result.skipped })
    for (const c of result.contacts) {
      if (known.has(originKey(originOf(c)))) alreadyHere++
      else fresh.push(c)
    }
  }
  const combined = [...stored.map(asImported), ...fresh]
  const groups = keepStoredApart(findDuplicates(combined), stored.length)
  return { files: summaries, fresh, alreadyHere, combined, groups }
}

/** The answer for a group: its own decision, else merged when sure and kept apart when unsure. */
export function decisionFor(plan: IntakePlan, decisions: Readonly<Record<number, Decision>>, group: number): Decision {
  return decisions[group] ?? (plan.groups[group].sure ? 'same' : 'different')
}

function toContact(merged: ImportedContact, id: string, sources: ContactOrigin[]): Contact {
  const { source: _s, file: _f, sourceRef: _r, ...rest } = merged
  return { ...rest, id, sources }
}

function mergeGroup(members: ImportedContact[], storedAt: Contact | undefined, newId: () => string): Contact {
  const seen = new Set<string>()
  const sources = [...(storedAt?.sources ?? []), ...members.map(originOf)].filter((o) => {
    const key = originKey(o)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return toContact(mergeContacts(members), storedAt?.id ?? newId(), sources)
}

/** The new contact list: stored order kept, a merged group sitting where its stored member was, new contacts last. */
export function apply(
  stored: readonly Contact[], p: IntakePlan, decisions: Readonly<Record<number, Decision>>, newId: () => string,
): Contact[] {
  const merged = new Map<number, Contact>()
  const consumed = new Set<number>()
  p.groups.forEach((g, gi) => {
    if (decisionFor(p, decisions, gi) !== 'same') return
    const storedIdx = g.members.find((i) => i < stored.length)
    const out = mergeGroup(g.members.map((i) => p.combined[i]), storedIdx === undefined ? undefined : stored[storedIdx], newId)
    g.members.forEach((i) => consumed.add(i))
    merged.set(g.members[0], out)
  })
  const result: Contact[] = []
  p.combined.forEach((c, i) => {
    const m = merged.get(i)
    if (m) result.push(m)
    else if (i < stored.length) result.push(stored[i])
    else if (!consumed.has(i)) result.push(toContact(c, newId(), [originOf(c)]))
  })
  return result
}
