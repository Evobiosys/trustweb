/**
 * From picked files to a reviewed list of contacts (wave 7). Pure: no DOM, no storage.
 * plan() reads and groups; apply() turns the person's answers into the new contact list.
 */
import type { Contact, ContactOrigin } from '../model'
import { findDuplicates, mergeContacts, normalizeName, normalizePhone } from './dedup'
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

function identity(c: ImportedContact): string {
  if (!c.sourceRef.startsWith('#')) return `${c.source}\n${c.sourceRef}`
  const phones = c.phones.map((p) => normalizePhone(p) || p).sort()
  return [c.source, normalizeName(c.name), [...c.emails].sort().join(' '), phones.join(' ')].join('\n')
}

function originOf(c: ImportedContact): ContactOrigin {
  return { source: c.source, file: c.file, sourceRef: c.sourceRef, key: identity(c) }
}

/** A stored contact in the parsers' shape, so it can be grouped and merged with new ones. */
function asImported(c: Contact): ImportedContact {
  const { id: _id, sources, ...rest } = c
  const { key: _k, ...origin } = sources[0]
  return { ...rest, ...origin }
}

/** Groups again over `idx` only; indexes map back into `combined`. */
function regroup(combined: readonly ImportedContact[], idx: readonly number[]): DupGroup[] {
  return findDuplicates(idx.map((i) => combined[i])).map((g) => ({ ...g, members: g.members.map((k) => idx[k]) }))
}

/**
 * At most one stored contact per group (earlier "not the same" answers stand). A group holding several is
 * grouped again around each stored contact in turn, so a new contact only joins one it links to itself.
 */
function keepStoredApart(groups: DupGroup[], combined: readonly ImportedContact[], storedCount: number): DupGroup[] {
  return groups.flatMap((g) => {
    const stored = g.members.filter((i) => i < storedCount)
    if (stored.length < 2) return [g]
    let rest = g.members.filter((i) => i >= storedCount)
    const out: DupGroup[] = []
    for (const s of stored) {
      const mine = regroup(combined, [s, ...rest]).filter((sg) => sg.members[0] === s)
      out.push(...mine)
      rest = rest.filter((i) => !mine.some((sg) => sg.members.includes(i)))
    }
    return [...out, ...regroup(combined, rest)]
  })
}

export function plan(stored: readonly Contact[], files: readonly FileInput[]): IntakePlan {
  const known = new Set(stored.flatMap((c) => c.sources.map((o) => o.key)))
  const summaries: FileSummary[] = []
  const fresh: ImportedContact[] = []
  let alreadyHere = 0
  for (const f of files) {
    const { format, result } = parseFile(f.name, f.text)
    summaries.push({ name: f.name, format, count: result.contacts.length, skipped: result.skipped })
    for (const c of result.contacts) {
      if (known.has(identity(c))) alreadyHere++
      else fresh.push(c)
    }
  }
  const combined = [...stored.map(asImported), ...fresh]
  const groups = keepStoredApart(findDuplicates(combined), combined, stored.length)
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

/** `fresh` are the group's new members; the stored one (if any) brings its own sources. */
function mergeGroup(members: ImportedContact[], fresh: ImportedContact[], storedAt: Contact | undefined, newId: () => string): Contact {
  return toContact(mergeContacts(members), storedAt?.id ?? newId(), [...(storedAt?.sources ?? []), ...fresh.map(originOf)])
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
    const fresh = g.members.filter((i) => i >= stored.length).map((i) => p.combined[i])
    const out = mergeGroup(g.members.map((i) => p.combined[i]), fresh, storedIdx === undefined ? undefined : stored[storedIdx], newId)
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
